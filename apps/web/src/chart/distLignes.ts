/**
 * Overlay DIST — bandes VaR du chart MAÎTRE en lignes de prix horizontales. Superpose sur le
 * pane prix les quantiles de l'horizon 20 bougies de la distribution empirique des rendements
 * (moteur PUR `data/distVar`) : p5/p95 (emphase forte, la bande VaR95) et p1/p99 (emphase
 * faible, la bande VaR99). Toggle DANS DistWindow (défaut OFF, persisté — cf. store/persist).
 *
 * SOURCE : les MÊMES bougies que la fenêtre (marketStore global du slot maître) et le MÊME
 * calcul pur `distVar` — l'overlay et la fenêtre s'accordent donc sans se parler (pas de
 * publication React → contrôleur). Il « se met à jour quand la fenêtre recalcule » car les deux
 * réagissent au même buffer : nouvelle bougie (clôture → +1 au buffer) ou nouveau jeu (dataLoad).
 * L'overlay reste fonctionnel même fenêtre FERMÉE (le toggle persisté peut être ON sans fenêtre).
 *
 * Ce module n'expose QUE : le store de bascule (persisté), le helper PUR `niveauxVarLignes`
 * (testé) et un `FournisseurLignes` singleton branché sur marketStore. Le RENDU est assuré par
 * `NiveauxLignesController` (chart/niveauxLignes.ts), instancié pour le maître par ChartInstance.
 */
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import type { Unsubscribe } from "@axiom/types";
import { distVar, type NiveauxVar } from "../data/distVar";
import { marketStore } from "../store/market";
import type { FournisseurLignes, LigneNiveau } from "./niveauxLignes";

/** Horizon (en bougies) dont on trace les bandes VaR — aligné sur la lecture « 20 b » de la fenêtre. */
const HORIZON_VAR = 20;

// ─────────────────────────── Helper PUR (testé) ───────────────────────────

/**
 * Construit les 4 lignes de niveaux VaR depuis les quantiles de l'horizon 20 bougies :
 *  - p5 et p95 → bande VaR95 (emphase FORTE, trait plein) ;
 *  - p1 et p99 → bande VaR99 (emphase FAIBLE, plus discrète).
 * Couleur NEUTRE `--text-dim` (repère de contexte, pas un signal directionnel) — le rôle des
 * lignes est de matérialiser l'amplitude probable, pas un sens de marché. Renvoie `[]` si
 * l'horizon est absent (échantillon insuffisant → `distVar` a renvoyé null). PURE.
 */
export function niveauxVarLignes(h20: NiveauxVar | null): LigneNiveau[] {
  if (h20 === null) return [];
  const n = h20.niveaux;
  return [
    { price: n.p95, label: "VaR95", couleur: "--text-dim", emphase: "forte" },
    { price: n.p5, label: "VaR95", couleur: "--text-dim", emphase: "forte" },
    { price: n.p99, label: "VaR99", couleur: "--text-dim", emphase: "faible" },
    { price: n.p1, label: "VaR99", couleur: "--text-dim", emphase: "faible" },
  ];
}

// ─────────────────────────── Bascule (store vanilla, persisté) ───────────────────────────

export interface DistOverlayState {
  actif: boolean;
  basculer: () => void;
  /** Force l'état ON/OFF (idempotent) — hydratation persistée (cf. store/persist.ts). */
  setActif: (actif: boolean) => void;
}

/** État on/off de l'overlay DIST — VANILLA, persisté via store/persist.ts (défaut OFF). */
export const distOverlayStore: StoreApi<DistOverlayState> = createStore<DistOverlayState>((set, get) => ({
  actif: false,
  basculer: () => set({ actif: !get().actif }),
  setActif: (actif) => set({ actif }),
}));

// ─────────────────────────── Fournisseur de lignes ───────────────────────────

/**
 * Fournisseur des lignes DIST pour le contrôleur : calcule `distVar` sur les closes du chart
 * maître et en extrait l'horizon 20 bougies. `subscribe` ne réagit qu'aux VRAIS changements de
 * données (nouveau jeu `dataLoad` ou nouvelle bougie = variation de la longueur du buffer) —
 * pas aux ticks intra-bougie (cadence « à la clôture », comme le recalcul automatique de la
 * fenêtre) — pour ne pas relancer `distVar` (parcours du buffer) à chaque tick WS.
 */
export const fournisseurDistLignes: FournisseurLignes = {
  getLignes(): LigneNiveau[] {
    const closes = marketStore.getState().candles.map((c) => c.close);
    const niveaux = distVar(closes);
    const h20 = niveaux?.find((nv) => nv.h === HORIZON_VAR) ?? null;
    return niveauxVarLignes(h20);
  },
  subscribe(onChange: () => void): Unsubscribe {
    let prevLoad = marketStore.getState().dataLoad;
    let prevLen = marketStore.getState().candles.length;
    return marketStore.subscribe(() => {
      const s = marketStore.getState();
      if (s.dataLoad !== prevLoad || s.candles.length !== prevLen) {
        prevLoad = s.dataLoad;
        prevLen = s.candles.length;
        onChange();
      }
    });
  },
};
