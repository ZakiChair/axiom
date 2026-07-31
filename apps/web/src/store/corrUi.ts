/**
 * Store UI de la fenêtre CORR — Zustand VANILLA, RÉGLAGES PERSISTÉS.
 *
 * POURQUOI un store dédié : la fermeture d'une FloatingWindow DÉMONTE le composant —
 * tout réglage en useState (méthode, fenêtre, extras) était perdu à chaque fermeture
 * (leçon documentée par la spec v2.6, Lot C). Les réglages vivent donc ici et sont
 * persistés sous la clé `axiom:corr:v1` : méthode, fenêtre, extras manuels, références
 * tradfi actives, univers, tri et onglet — JAMAIS l'état `open` (déjà miroir du
 * windowManager via `mirrorOpenState`, refléter l'ouverture dans localStorage créerait
 * un double maître).
 *
 * Hydratation : lecture tolérante (localStorage indisponible / JSON corrompu → défauts)
 * déléguée à `hydraterReglagesCorr` (pure, testée dans corr.test.ts) — validation champ
 * par champ, jamais de throw. Écriture best-effort, gardée par une signature stable des
 * seuls réglages (pas d'écriture sur un simple toggle open).
 *
 * La commande palette « panneau:corr » reste déclarée dans commands/windowPanels.ts
 * (câblage historique, inchangé).
 */
import { createStore } from "zustand/vanilla";
import { windowManagerStore, mirrorOpenState } from "./windowManager";
import {
  hydraterReglagesCorr,
  FENETRES_CORR,
  type MethodeCorr,
  type OngletCorr,
  type ReglagesCorr,
  type TriCorr,
  type UniversCorr,
} from "../data/corr";

/** Clé localStorage des réglages CORR (versionnée). */
const CLE_PERSISTANCE = "axiom:corr:v1";

export interface CorrUiState extends ReglagesCorr {
  open: boolean;
  setMethode: (methode: MethodeCorr) => void;
  setFenetre: (jours: number) => void;
  setUnivers: (univers: UniversCorr) => void;
  setTri: (tri: TriCorr) => void;
  setOnglet: (onglet: OngletCorr) => void;
  ajouterExtra: (symbole: string) => void;
  retirerExtra: (symbole: string) => void;
  basculerReference: (symbole: string) => void;
  openCorr: () => void;
  closeCorr: () => void;
  toggleCorr: () => void;
}

/** Lecture tolérante des réglages persistés (défauts si indisponible/corrompu). */
function lireReglagesPersistes(): ReglagesCorr {
  try {
    if (typeof localStorage === "undefined") return hydraterReglagesCorr(undefined);
    const raw = localStorage.getItem(CLE_PERSISTANCE);
    return hydraterReglagesCorr(raw === null ? undefined : JSON.parse(raw));
  } catch {
    return hydraterReglagesCorr(undefined);
  }
}

export const corrUiStore = createStore<CorrUiState>((set, get) => ({
  open: false,
  ...lireReglagesPersistes(),
  setMethode: (methode) => set({ methode }),
  setFenetre: (jours) => {
    if (FENETRES_CORR.includes(jours)) set({ fenetreJours: jours });
  },
  setUnivers: (univers) => set({ univers }),
  setTri: (tri) => set({ tri }),
  setOnglet: (onglet) => set({ onglet }),
  ajouterExtra: (symbole) => {
    const s = symbole.trim().toUpperCase();
    if (s.length === 0 || get().extras.includes(s)) return;
    set({ extras: [...get().extras, s] });
  },
  retirerExtra: (symbole) => set({ extras: get().extras.filter((v) => v !== symbole) }),
  basculerReference: (symbole) => {
    const actives = get().referencesActives;
    set({
      referencesActives: actives.includes(symbole)
        ? actives.filter((v) => v !== symbole)
        : [...actives, symbole],
    });
  },
  openCorr: () => windowManagerStore.getState().openWindow("corr"),
  closeCorr: () => windowManagerStore.getState().closeWindow("corr"),
  toggleCorr: () => windowManagerStore.getState().toggleWindow("corr"),
}));

mirrorOpenState("corr", corrUiStore);

/** Projection persistable d'un état (les réglages SEULS — jamais `open`). */
function signatureReglages(s: CorrUiState): string {
  const reglages: ReglagesCorr = {
    methode: s.methode,
    fenetreJours: s.fenetreJours,
    extras: s.extras,
    referencesActives: s.referencesActives,
    univers: s.univers,
    tri: s.tri,
    onglet: s.onglet,
  };
  return JSON.stringify(reglages);
}

// Persistance best-effort : n'écrit que quand la signature des réglages change
// (un toggle open ne déclenche aucune écriture).
let derniereSignature = signatureReglages(corrUiStore.getState());
corrUiStore.subscribe((s) => {
  const signature = signatureReglages(s);
  if (signature === derniereSignature) return;
  derniereSignature = signature;
  try {
    localStorage.setItem(CLE_PERSISTANCE, signature);
  } catch {
    /* best-effort : quota / mode privé — la persistance des réglages n'est pas bloquante */
  }
});
