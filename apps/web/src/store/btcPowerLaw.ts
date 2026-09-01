import { createStore } from "zustand/vanilla";
import {
  ajusterBtcPowerLaw,
  type ModeleBtcPowerLaw,
} from "../data/btcPowerLaw";
import {
  fetchCoinMetricsPriceUSDComplet,
  type PointMetrique,
} from "../data/onchain/coinmetrics";

const TTL_MS = 24 * 60 * 60 * 1000;
let currentRunId = 0;

export interface BtcPowerLawState {
  enCours: boolean;
  points: PointMetrique[];
  modele: ModeleBtcPowerLaw | null;
  erreur: string | null;
  majTs: number | null;
  perime: boolean;
  run: (force?: boolean) => Promise<void>;
}

export const btcPowerLawStore = createStore<BtcPowerLawState>((set, get) => ({
  enCours: false,
  points: [],
  modele: null,
  erreur: null,
  majTs: null,
  perime: false,

  run: async (force = false) => {
    const now = Date.now();
    const courant = get();
    if (!force && courant.modele !== null && courant.majTs !== null && now - courant.majTs < TTL_MS) return;

    const runId = ++currentRunId;
    set({ enCours: true });

    let resultat: Awaited<ReturnType<typeof fetchCoinMetricsPriceUSDComplet>>;
    try {
      resultat = await fetchCoinMetricsPriceUSDComplet();
    } catch {
      if (runId !== currentRunId) return;
      set({
        enCours: false,
        erreur: get().modele === null
          ? "Historique BTC indisponible."
          : "Historique BTC indisponible — modèle précédent conservé.",
      });
      return;
    }
    if (runId !== currentRunId) return;

    if (resultat === null || resultat.points.length === 0) {
      set({
        enCours: false,
        erreur: get().modele === null
          ? "Historique BTC indisponible."
          : "Réponse Coin Metrics vide — modèle précédent conservé.",
      });
      return;
    }

    const modele = ajusterBtcPowerLaw(resultat.points);
    if (modele === null) {
      set({
        enCours: false,
        erreur: get().modele === null
          ? "Historique insuffisant pour ajuster le modèle."
          : "Ajustement impossible — modèle précédent conservé.",
      });
      return;
    }

    set({
      enCours: false,
      points: resultat.points,
      modele,
      erreur: null,
      majTs: resultat.ts,
      perime: resultat.perime,
    });
  },
}));
