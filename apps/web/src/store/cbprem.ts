/**
 * Store du premium Coinbase/Binance (CBPREM) — Zustand VANILLA.
 *
 * Un run (spec 2026-07-23, branche 3) : klines spot 1h ~30 j des DEUX venues déjà
 * câblées dans le sélecteur d'exchange — Coinbase (BTC-USD/ETH-USD) et Binance
 * (BTCUSDT/ETHUSDT) — via leurs `fetchKlines` EXISTANTS (aucune nouvelle URL). Le
 * calcul (alignement par openTime + stats) est PUR (data/cbprem.ts). Pas de polling :
 * un run à l'ouverture de la fenêtre + bouton Rafraîchir. Erreur NON destructive dès
 * la v1 (patron squeeze post-v1.1) : la série existante reste affichée, `erreur` n'est
 * effacée qu'au succès. Garde de péremption `currentRunId` (double clic / changement de
 * base) : les résultats d'un run périmé sont ignorés.
 *
 * Filtrage de clôture : `serieCbprem` ne peut PAS filtrer les bougies en formation (sa
 * signature `{t, close}` n'expose pas `closed`). C'est le store qui écarte la dernière
 * bougie non clôturée (`closed === false`) AVANT l'alignement, via `versPointsClos`
 * (pure, testée) — sinon le premium « courant » refléterait une bougie partielle.
 */
import type { Candle } from "@axiom/types";
import { createStore } from "zustand/vanilla";
import { serieCbprem, statsPremium, type PointPremium } from "../data/cbprem";
import { binanceAdapter } from "../data/binance";
import { coinbaseAdapter } from "../data/coinbase";

/** Timeframe des deux venues. */
const TF = "1h" as const;
/** ~30 jours de bougies horaires. */
const CIBLE_BOUGIES = 720;
/** Coinbase plafonne à 350 bougies/appel → pagination arrière (720 tient en ≤ 3 pages). */
const COINBASE_MAX_PAGES = 3;

/** Symboles concaténés par venue (Coinbase « BTCUSD » → « BTC-USD » via splitSymbol). */
const SYMBOLES: Record<"BTC" | "ETH", { bn: string; cb: string }> = {
  BTC: { bn: "BTCUSDT", cb: "BTCUSD" },
  ETH: { bn: "ETHUSDT", cb: "ETHUSD" },
};

/**
 * Écarte la bougie en formation (`closed === false`) puis projette en `{t, close}` pour
 * `serieCbprem`. On garde `closed === true` ET `closed === undefined` (convention
 * `finaliser` de backtestData : seule la bougie explicitement non clôturée est retirée).
 * PURE & testée — c'est l'unique portion normalisation du run, isolée pour la geler
 * contre une régression silencieuse (une bougie partielle fausserait le premium courant).
 */
export function versPointsClos(candles: readonly Candle[]): { t: number; close: number }[] {
  const out: { t: number; close: number }[] = [];
  for (const c of candles) {
    if (c.closed === false) continue;
    out.push({ t: c.time, close: c.close });
  }
  return out;
}

/**
 * Klines Coinbase 1h par pagination ARRIÈRE (endTime décroissant) jusqu'à `cible`
 * bougies ou `COINBASE_MAX_PAGES` pages — Coinbase renvoie ≤ 350/appel. Réutilise
 * `coinbaseAdapter.fetchKlines` (patron SeasonalityWindow). Rejette si un appel échoue.
 */
async function fetchCoinbase1h(symbol: string, cible: number): Promise<Candle[]> {
  const pages: Candle[] = [];
  let endTime: number | undefined;
  for (let i = 0; i < COINBASE_MAX_PAGES && pages.length < cible; i++) {
    const batch = await coinbaseAdapter.fetchKlines(symbol, TF, { limit: 350, endTime });
    if (batch.length === 0) break;
    pages.unshift(...batch); // batch trié chrono ↑ ; unshift = bloc plus ancien devant
    endTime = batch[0] === undefined ? undefined : batch[0].time - 1;
  }
  return pages;
}

export interface CbpremState {
  base: "BTC" | "ETH";
  /** true pendant un run (désactive le bouton Rafraîchir). */
  enCours: boolean;
  serie: PointPremium[];
  stats: ReturnType<typeof statsPremium> | null;
  /** Message d'erreur affichable si un fetch échoue, sinon null — NON destructif. */
  erreur: string | null;
  /** Horodatage du dernier succès (fraîcheur affichée), sinon null. */
  majTs: number | null;
  setBase: (b: "BTC" | "ETH") => void;
  run: () => Promise<void>;
}

/** Identifiant du run courant : les résultats d'un run périmé (double clic / setBase) sont ignorés. */
let currentRunId = 0;

export const cbpremStore = createStore<CbpremState>((set, get) => ({
  base: "BTC",
  enCours: false,
  serie: [],
  stats: null,
  erreur: null,
  majTs: null,

  setBase: (b) => {
    set({ base: b });
    void get().run(); // relance le run sur la nouvelle base (garde currentRunId périme l'ancien)
  },

  run: async () => {
    const runId = ++currentRunId;
    // On ne remet PAS `erreur` à null ici : un bandeau reste visible pendant le retry et
    // n'est effacé qu'au succès (ci-dessous) — pas de clignotement, série préservée.
    set({ enCours: true });

    const { bn, cb } = SYMBOLES[get().base];

    let klinesBn: Candle[];
    let klinesCb: Candle[];
    try {
      // Binance : max 1000/appel → 720 en un seul fetch. Coinbase : paginé (≤ 350/appel).
      [klinesBn, klinesCb] = await Promise.all([
        binanceAdapter.fetchKlines(bn, TF, { limit: CIBLE_BOUGIES }),
        fetchCoinbase1h(cb, CIBLE_BOUGIES),
      ]);
    } catch {
      if (runId !== currentRunId) return;
      set({
        enCours: false,
        erreur: "Klines indisponibles (Coinbase ou Binance) — dernier premium conservé.",
      });
      return;
    }
    if (runId !== currentRunId) return;

    // Écarte la bougie en formation de chaque venue AVANT l'alignement, puis calcul pur.
    const serie = serieCbprem(versPointsClos(klinesCb), versPointsClos(klinesBn));
    const stats = statsPremium(serie);

    // Succès : série/stats mises à jour, `erreur` effacée, fraîcheur horodatée.
    set({ enCours: false, serie, stats, erreur: null, majTs: Date.now() });
  },
}));
