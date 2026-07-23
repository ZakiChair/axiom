/**
 * Store du « Radar de squeeze » (SQZ) — Zustand VANILLA.
 *
 * Un run (spec 2026-07-23) : univers ticker 24 h + funding premiumIndex (mêmes
 * requêtes que le screener / la vue Signaux), échantillon top liquides à perp ∪
 * watchlist (selectionEchantillon, réutilisé d'EQS), puis ΔOI par symbole via un pool
 * de concurrence limitée (histOiUsd → oiChangePctFromHist). La fusion et la projection
 * en points sont PURES (data/squeeze.ts). Pas de polling : un run à l'ouverture de la
 * fenêtre + bouton Rafraîchir. Dégradation gracieuse : un ΔOI en échec prive le symbole
 * de son point, jamais le run ; une panne d'univers → `erreur` affichable, jamais de throw.
 */
import { createStore } from "zustand/vanilla";
import { extUrl } from "../data/extapi";
import { histOiUsd } from "../data/referentiels";
import {
  applyFunding,
  oiChangePctFromHist,
  parsePremiumIndex,
  parseTicker24h,
} from "../data/screener";
import { selectionEchantillon } from "../data/signaux";
import { construirePoints, fusionnerSources, type PointRadar } from "../data/squeeze";
import { mapPool } from "./screener";
import { watchlistStore } from "./watchlist";

const TICKER_24H_URL = "https://api.binance.com/api/v3/ticker/24hr";
/** Concurrence du pool ΔOI (1 requête histOiUsd par symbole, budget très en deçà des limites). */
const SQZ_CONCURRENCY = 5;

export interface SqueezeState {
  /** true quand la fenêtre est ouverte (Task 3 : run à l'ouverture, pas de polling). */
  open: boolean;
  /** true pendant un run (désactive le bouton Rafraîchir). */
  enCours: boolean;
  points: PointRadar[];
  /** Note de couverture honnête (mêmes limites qu'EQS : ΔOI échantillonné). */
  couverture: string;
  /** Message d'erreur affichable si l'univers est indisponible, sinon null. */
  erreur: string | null;
  run: () => Promise<void>;
}

/** Identifiant du run courant : les résultats d'un run périmé (double clic) sont ignorés. */
let currentRunId = 0;

export const squeezeStore = createStore<SqueezeState>((set) => ({
  open: false,
  enCours: false,
  points: [],
  couverture: "",
  erreur: null,

  run: async () => {
    const runId = ++currentRunId;
    set({ enCours: true, erreur: null });

    // 1. Univers + funding (mêmes sources que le screener ; funding = marqueur perp).
    let tickers: ReturnType<typeof parseTicker24h>;
    let fundingParSymbole: ReturnType<typeof parsePremiumIndex>;
    try {
      const res = await fetch(TICKER_24H_URL);
      if (!res.ok) throw new Error(`ticker24h ${res.status}`);
      tickers = parseTicker24h(await res.json());
      const fRes = await fetch(extUrl("fapi.binance.com", "fapi/v1/premiumIndex"));
      if (!fRes.ok) throw new Error(`premiumIndex ${fRes.status}`);
      fundingParSymbole = parsePremiumIndex(await fRes.json());
    } catch {
      if (runId !== currentRunId) return;
      set({
        enCours: false,
        erreur:
          "Univers indisponible (ticker 24 h ou funding Binance) — le radar est perp-based.",
      });
      return;
    }
    if (runId !== currentRunId) return;

    // 2. Échantillon honnête : top liquides à perp ∪ watchlist ∩ univers perp.
    applyFunding(tickers, fundingParSymbole);
    const echantillon = selectionEchantillon(tickers, watchlistStore.getState().symbols);

    // 3. ΔOI par symbole (pool best-effort : un fetch en échec — histOiUsd rejette sur
    //    HTTP/CORS — laisse le symbole sans ΔOI → exclu par construirePoints, jamais le run).
    const oiParSymbole = new Map<string, number>();
    await mapPool(echantillon, SQZ_CONCURRENCY, async (row) => {
      try {
        const pts = await histOiUsd(row.symbol);
        if (pts === null) return;
        const delta = oiChangePctFromHist(pts.map((p) => ({ oiUsd: p.v })));
        if (delta !== undefined) oiParSymbole.set(row.symbol, delta);
      } catch {
        /* ΔOI indisponible pour ce symbole : dégradation gracieuse */
      }
    });
    if (runId !== currentRunId) return;

    // 4. Fusion (funding × ΔOI × volume) → projection en points (data/squeeze.ts, PUR).
    const points = construirePoints(fusionnerSources(echantillon, fundingParSymbole, oiParSymbole));

    set({
      enCours: false,
      points,
      couverture: `ΔOI sur ${echantillon.length} symboles (top liquides ∪ watchlist)`,
    });
  },
}));
