/**
 * Store de la fenêtre CYCLE (position dans le cycle de 4 ans BTC) — Zustand VANILLA.
 *
 * Un run (patron du store NETLIQ, sans fenêtre paramétrable) :
 *   1. PRIMAIRE — historique PriceUSD complet (Coin Metrics) → `decouperCycles` → 4 séries
 *      alignées jour-0. Le CHART ne dépend QUE de ça ; tout le reste est best-effort.
 *   2. Best-effort — Mayer Multiple (dérivé des mêmes prix), halving countdown
 *      (`fetchMempoolReseau`/`computeHalving`), MVRV Z-Score (bgeometrics ; repli ratio
 *      Coin Metrics `CapMVRVCur`). Un échec de ces extras laisse « — » sans casser le chart.
 *
 * Invariants NETLIQ repris : erreur NON destructive (série conservée pendant un retry),
 * garde vide (une réponse vide n'écrase pas des séries valides), garde de péremption
 * (`currentRunId`), skip TTL 24 h sauf `run(true)` (bouton Rafraîchir).
 */
import { createStore } from "zustand/vanilla";
import { decouperCycles, mayerMultiple, type SerieCycle } from "../data/cycle";
import {
  fetchCoinMetrics,
  fetchCoinMetricsPriceUSDComplet,
} from "../data/onchain/coinmetrics";
import { fetchMempoolReseau, type Halving } from "../data/onchain/mempool";
import { BG_MVRV, fetchBgeometricMetrique } from "../data/onchain/bgeometrics";
import { getBgeometricsKey } from "./onchain";

/** TTL du cache en mémoire : 24 heures (données daily). */
const TTL_MS = 24 * 60 * 60 * 1000;

/** MVRV affiché : la valeur + sa nature (Z-Score bgeometrics ou ratio Coin Metrics de repli). */
export interface MvrvCourant {
  valeur: number;
  /** true = MVRV Z-Score (bgeometrics), false = ratio MVRV (repli Coin Metrics). */
  zscore: boolean;
}

export interface CycleState {
  /** true pendant un run (désactive le bouton Rafraîchir). */
  enCours: boolean;
  /** Les 4 cycles alignés jour-0 (source unique du chart et du tableau). */
  series: SerieCycle[];
  /** Mayer Multiple (dernier prix / MM200), null si indisponible. */
  mayer: number | null;
  /** MVRV courant (Z-Score ou ratio de repli), null si aucune source ne répond. */
  mvrv: MvrvCourant | null;
  /** État du halving pour le compte à rebours (prochain bloc, temps estimé), null si absent. */
  halving: Halving | null;
  /** Message d'erreur affichable si le fetch PRIMAIRE échoue, sinon null — NON destructif. */
  erreur: string | null;
  /** Horodatage du dernier succès (fraîcheur + base du TTL), sinon null. */
  majTs: number | null;
  /** Collecte + calcul. `force` (bouton Rafraîchir) court-circuite le TTL 24 h. */
  run: (force?: boolean) => Promise<void>;
}

/** Identifiant du run courant : les résultats d'un run périmé (double clic / relance) sont ignorés. */
let currentRunId = 0;

/**
 * Récupère le MVRV courant : d'abord le Z-Score bgeometrics (préféré), puis en repli le
 * ratio Coin Metrics `CapMVRVCur`. Best-effort — toute erreur renvoie `null` (l'UI affiche « — »).
 */
async function chargerMvrv(signal?: AbortSignal): Promise<MvrvCourant | null> {
  try {
    const bg = await fetchBgeometricMetrique(BG_MVRV, getBgeometricsKey(), signal);
    const z = bg?.serie.dernier?.value;
    if (z !== undefined && Number.isFinite(z)) return { valeur: z, zscore: true };
  } catch {
    /* on tente le repli Coin Metrics */
  }
  try {
    const cm = await fetchCoinMetrics("btc", signal);
    const ratio = cm?.series["CapMVRVCur"]?.dernier?.value;
    if (ratio !== undefined && Number.isFinite(ratio)) return { valeur: ratio, zscore: false };
  } catch {
    /* MVRV indisponible → null */
  }
  return null;
}

export const cycleStore = createStore<CycleState>((set, get) => ({
  enCours: false,
  series: [],
  mayer: null,
  mvrv: null,
  halving: null,
  erreur: null,
  majTs: null,

  run: async (force = false) => {
    const nowMs = Date.now();

    // Skip TTL 24 h : pas de re-fetch si des séries sont déjà affichées et fraîches, sauf force.
    const { majTs, series: seriesCourantes } = get();
    if (!force && majTs !== null && seriesCourantes.length > 0 && nowMs - majTs < TTL_MS) return;

    const runId = ++currentRunId;
    // `erreur` n'est pas remise à null ici : le bandeau reste visible pendant le retry.
    set({ enCours: true });

    // PRIMAIRE : historique de prix complet — le chart en dépend entièrement.
    let resultat: Awaited<ReturnType<typeof fetchCoinMetricsPriceUSDComplet>>;
    try {
      resultat = await fetchCoinMetricsPriceUSDComplet();
    } catch {
      if (runId !== currentRunId) return;
      set({ enCours: false, erreur: "Historique de prix indisponible — cycles précédents conservés." });
      return;
    }
    if (runId !== currentRunId) return;

    if (resultat === null || resultat.points.length === 0) {
      if (get().series.length > 0) {
        // Garde vide : une réponse vide n'écrase pas des séries valides déjà affichées.
        set({ enCours: false, erreur: "Réponse Coin Metrics vide — cycles précédents conservés." });
      } else {
        set({ enCours: false, erreur: "Historique de prix indisponible. Réessayez avec Rafraîchir." });
      }
      return;
    }

    const series = decouperCycles(resultat.points);
    const mayer = mayerMultiple(resultat.points);

    // Extras best-effort en parallèle : leur échec ne bloque pas le chart.
    const [reseau, mvrv] = await Promise.all([
      fetchMempoolReseau().catch(() => null),
      chargerMvrv(),
    ]);
    if (runId !== currentRunId) return;

    if (series.length === 0 && get().series.length > 0) {
      set({ enCours: false, erreur: "Aucun cycle exploitable — cycles précédents conservés." });
      return;
    }

    set({
      enCours: false,
      series,
      mayer,
      mvrv,
      halving: reseau?.donnee.halving ?? null,
      erreur: null,
      majTs: Date.now(),
    });
  },
}));
