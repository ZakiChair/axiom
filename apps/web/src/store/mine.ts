/**
 * Store MINE (coût de production du minage BTC) — Zustand VANILLA.
 *
 * Un run (spec lot v1.8, §1) : collecte en parallèle des ENTRÉES BRUTES nécessaires au
 * modèle — hashrate + difficulté 1 an et ajustement courant (mempool.space), hauteur de
 * bloc → subsidy via `computeHalving` (mempool.space), frais moyens par bloc (Coin
 * Metrics `FeeTotNtv` ÷ 144), prix spot BTC (klines Binance BTCUSDT). Aucun calcul dérivé
 * ici : le plancher électrique / all-in / hashprice sont RECALCULÉS dans la fenêtre à
 * partir de ces entrées et des PARAMÈTRES réglables (data/mine.ts, purs) — un changement
 * de paramètre ne redéclenche donc AUCUN fetch (patron `setFenetre` de NETLIQ appliqué
 * aux paramètres).
 *
 * Patron EXACT des stores CBPREM/NETLIQ :
 *   - Erreur NON destructive : les entrées existantes restent affichées pendant un retry,
 *     `erreur` n'est effacée qu'au succès.
 *   - Garde « rien d'exploitable » : un run qui ne rend aucun hashrate n'écrase PAS des
 *     entrées valides déjà affichées.
 *   - Garde de péremption `currentRunId` (double clic / relance) : run périmé ignoré.
 *   - Cache TTL 6 h en mémoire : `run()` ne re-fetch pas si des entrées fraîches existent,
 *     sauf `run(true)` (bouton Rafraîchir force ; l'ouverture de fenêtre passe false).
 *
 * Les paramètres (efficacité, $/kWh, multiplicateur) sont persistés `axiom:mine:v1`,
 * indépendamment du cycle de vie du store, et lus au démarrage (défauts sinon).
 */
import { createStore } from "zustand/vanilla";
import { binanceAdapter } from "../data/binance";
import { PARAMS_MINE_DEFAUT, type ParametresMine } from "../data/mine";
import type { PointMetrique } from "../data/onchain/coinmetrics";
import { fetchCoinMetrics } from "../data/onchain/coinmetrics";
import {
  fetchAjustementDifficulte,
  fetchHashrateDifficulte,
  fetchMempoolReseau,
  type AjustementDifficulte,
} from "../data/onchain/mempool";

/** TTL du cache en mémoire : 6 heures (les entrées les plus lentes sont daily). */
const TTL_MS = 6 * 60 * 60 * 1000;
/** Clé de persistance des paramètres réglables. */
const CLE_PARAMS = "axiom:mine:v1";

/** Entrées brutes du modèle (aucune valeur dérivée ; NaN si une source manque). */
export interface EntreesMine {
  /** Prix spot BTC ($, dernière clôture BTCUSDT). */
  prixBtc: number;
  /** Hashrate courant (H/s, dernier point de la série 1 an). */
  hashrateHs: number;
  /** Pic de hashrate sur 1 an (H/s) — pour la variation vs pic. */
  picHashrateHs: number;
  /** Récompense de bloc COURANTE (BTC) = récompense après prochain halving × 2. */
  subsidyBtc: number;
  /** Frais moyens par bloc (BTC) = FeeTotNtv/j ÷ 144 ; 0 si indisponible. */
  feesBtcParBloc: number;
  /** false si les frais n'ont pas pu être récupérés (mention « hors frais »). */
  feesDisponible: boolean;
  /** Difficulté courante (dernier point de la série 1 an). */
  difficulteCourante: number;
  /** Série hashrate 1 an (H/s) pour la sparkline. */
  hashrateSerie: PointMetrique[];
  /** Série difficulté 1 an pour la sparkline. */
  difficulteSerie: PointMetrique[];
  /** Ajustement de difficulté courant (progression + prochain retarget), ou null. */
  ajustement: AjustementDifficulte | null;
}

/** Lecture TOLÉRANTE des paramètres persistés : champ absent/invalide → défaut. */
function lireParams(): ParametresMine {
  try {
    if (typeof localStorage === "undefined") return { ...PARAMS_MINE_DEFAUT };
    const brut = localStorage.getItem(CLE_PARAMS);
    if (brut === null) return { ...PARAMS_MINE_DEFAUT };
    const o = JSON.parse(brut) as Partial<Record<keyof ParametresMine, unknown>>;
    const positif = (x: unknown, defaut: number): number => {
      const n = Number(x);
      return Number.isFinite(n) && n > 0 ? n : defaut;
    };
    return {
      efficaciteJParTh: positif(o.efficaciteJParTh, PARAMS_MINE_DEFAUT.efficaciteJParTh),
      prixKwhUsd: positif(o.prixKwhUsd, PARAMS_MINE_DEFAUT.prixKwhUsd),
      multiplicateurAllIn: positif(o.multiplicateurAllIn, PARAMS_MINE_DEFAUT.multiplicateurAllIn),
    };
  } catch {
    return { ...PARAMS_MINE_DEFAUT };
  }
}

/** Écriture best-effort des paramètres (quota / localStorage indisponible → silencieux). */
function ecrireParams(params: ParametresMine): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(CLE_PARAMS, JSON.stringify(params));
  } catch {
    /* silencieux : localStorage indisponible / readonly. */
  }
}

export interface MineState {
  /** true pendant un run (désactive le bouton Rafraîchir). */
  enCours: boolean;
  /** Entrées brutes du modèle, ou null tant qu'aucun run n'a réussi. */
  entrees: EntreesMine | null;
  /** Paramètres réglables (persistés). */
  params: ParametresMine;
  /** Message d'erreur affichable si un fetch échoue, sinon null — NON destructif. */
  erreur: string | null;
  /** Horodatage du dernier succès (fraîcheur + base du TTL), sinon null. */
  majTs: number | null;
  /** Collecte des entrées. `force` (bouton Rafraîchir) court-circuite le TTL 6 h. */
  run: (force?: boolean) => Promise<void>;
  /** Met à jour un ou plusieurs paramètres (persisté). NE refetch PAS (recalcul pur). */
  setParams: (patch: Partial<ParametresMine>) => void;
  /** Réinitialise les paramètres aux défauts (persisté). */
  resetParams: () => void;
}

/** Identifiant du run courant : les résultats d'un run périmé sont ignorés. */
let currentRunId = 0;

/** Dernier point d'une série (ou undefined). */
function dernier(points: PointMetrique[]): PointMetrique | undefined {
  return points.length > 0 ? points[points.length - 1] : undefined;
}

export const mineStore = createStore<MineState>((set, get) => ({
  enCours: false,
  entrees: null,
  params: lireParams(),
  erreur: null,
  majTs: null,

  setParams: (patch) => {
    const params = { ...get().params, ...patch };
    ecrireParams(params);
    set({ params });
  },

  resetParams: () => {
    const params = { ...PARAMS_MINE_DEFAUT };
    ecrireParams(params);
    set({ params });
  },

  run: async (force = false) => {
    const nowMs = Date.now();
    // Cache TTL 6 h : pas de re-fetch si des entrées fraîches existent (majTs posé au
    // seul succès → un premier run vide/échoué ne fige jamais le cache), sauf force.
    const { majTs, entrees } = get();
    if (!force && majTs !== null && entrees !== null && nowMs - majTs < TTL_MS) return;

    const runId = ++currentRunId;
    // `erreur` non remise à null : le bandeau reste visible pendant le retry, effacé au succès.
    set({ enCours: true });

    // Chaque source dégrade en interne (null / throw) ; on collecte tout en parallèle.
    // Le prix Binance est le seul à jeter (fetchKlines) → try dédié pour ne pas faire
    // échouer tout le run si Binance seul est injoignable.
    const prixPromise = binanceAdapter
      .fetchKlines("BTCUSDT", "1h", { limit: 1 })
      .then((k) => k.at(-1)?.close ?? NaN)
      .catch(() => NaN);

    const [hd, ajust, reseau, cm, prixBtc] = await Promise.all([
      fetchHashrateDifficulte(),
      fetchAjustementDifficulte(),
      fetchMempoolReseau(),
      fetchCoinMetrics("btc"),
      prixPromise,
    ]);
    if (runId !== currentRunId) return;

    const hashrateSerie = hd?.donnee.hashrate.points ?? [];
    const difficulteSerie = hd?.donnee.difficulte.points ?? [];
    const hashrateHs = dernier(hashrateSerie)?.value ?? NaN;
    const picHashrateHs =
      hashrateSerie.length > 0 ? Math.max(...hashrateSerie.map((p) => p.value)) : NaN;
    const difficulteCourante = dernier(difficulteSerie)?.value ?? NaN;

    // Subsidy courant = récompense APRÈS le prochain halving × 2 (post-2024 : 3,125 BTC).
    const subsidyBtc =
      reseau !== null ? reseau.donnee.halving.recompenseApres * 2 : NaN;

    // Frais moyens par bloc = FeeTotNtv (BTC/j) ÷ 144 ; 0 + « hors frais » si indisponible.
    const feeNtvJour = cm?.series["FeeTotNtv"]?.dernier?.value;
    const feesDisponible = feeNtvJour !== undefined && Number.isFinite(feeNtvJour);
    const feesBtcParBloc = feesDisponible ? (feeNtvJour as number) / 144 : 0;

    const nouvelles: EntreesMine = {
      prixBtc,
      hashrateHs,
      picHashrateHs,
      subsidyBtc,
      feesBtcParBloc,
      feesDisponible,
      difficulteCourante,
      hashrateSerie,
      difficulteSerie,
      ajustement: ajust?.donnee ?? null,
    };

    // Garde « rien d'exploitable » : sans hashrate, le modèle n'a pas de socle — on ne
    // remplace pas des entrées valides déjà affichées (invariant erreur non destructive).
    if (!Number.isFinite(hashrateHs) && get().entrees !== null) {
      set({ enCours: false, erreur: "Sources minage indisponibles — dernières entrées conservées." });
      return;
    }
    if (!Number.isFinite(hashrateHs)) {
      set({ enCours: false, erreur: "Hashrate indisponible (mempool.space injoignable)." });
      return;
    }

    // Succès : entrées mises à jour, `erreur` effacée, fraîcheur horodatée (base du TTL).
    set({ enCours: false, entrees: nouvelles, erreur: null, majTs: Date.now() });
  },
}));
