/**
 * Store RISQUE — capital de référence et risque toléré par trade (Zustand VANILLA).
 *
 * Sert UNIQUEMENT au dimensionnement affiché par l'outil position (chart/position.ts) :
 * aucun ordre n'est passé, aucune position réelle n'est lue. C'est un paramètre de
 * lecture du graphe, pas un état de compte.
 *
 * Persisté en localStorage (clé `axiom:risque:v1`, même pattern que store/alerts) :
 * re-saisir son capital à chaque session serait une friction absurde.
 *
 * `capital` peut être null = NON PARAMÉTRÉ. On ne suppose JAMAIS un capital par
 * défaut : afficher une taille de position calculée sur un capital inventé serait
 * pire que ne rien afficher.
 */
import { createStore } from "zustand/vanilla";

const STORAGE_KEY = "axiom:risque:v1";

/** Risque par trade par défaut, en % du capital (convention classique : 1 %). */
export const RISQUE_PCT_DEFAUT = 1;

export interface RisqueState {
  /** Capital de référence en USD, ou null si non paramétré. */
  capital: number | null;
  /** Risque toléré par trade, en % du capital. */
  risquePct: number;
  /** `null` (ou valeur non finie / négative) => capital non paramétré. */
  setCapital: (capital: number | null) => void;
  /** Ignoré si hors ]0, 100]. */
  setRisquePct: (pct: number) => void;
}

interface Persiste {
  capital: number | null;
  risquePct: number;
}

/** Lecture tolérante (localStorage indisponible / JSON corrompu => valeurs par défaut). */
function lire(): Persiste {
  const defaut: Persiste = { capital: null, risquePct: RISQUE_PCT_DEFAUT };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaut;
    const p = JSON.parse(raw) as Partial<Persiste> | null;
    if (!p || typeof p !== "object") return defaut;
    const capital =
      typeof p.capital === "number" && Number.isFinite(p.capital) && p.capital > 0
        ? p.capital
        : null;
    const risquePct =
      typeof p.risquePct === "number" && Number.isFinite(p.risquePct) && p.risquePct > 0 && p.risquePct <= 100
        ? p.risquePct
        : RISQUE_PCT_DEFAUT;
    return { capital, risquePct };
  } catch {
    return defaut;
  }
}

/** Écriture best-effort (le dimensionnement n'est pas bloquant). */
function ecrire(etat: Persiste): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(etat));
  } catch {
    /* best-effort */
  }
}

const initial = lire();

export const risqueStore = createStore<RisqueState>((set, get) => ({
  capital: initial.capital,
  risquePct: initial.risquePct,
  setCapital: (capital) => {
    const v = capital !== null && Number.isFinite(capital) && capital > 0 ? capital : null;
    set({ capital: v });
    ecrire({ capital: v, risquePct: get().risquePct });
  },
  setRisquePct: (pct) => {
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return;
    set({ risquePct: pct });
    ecrire({ capital: get().capital, risquePct: pct });
  },
}));
