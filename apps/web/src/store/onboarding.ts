/**
 * Store onboarding premier lancement — Zustand VANILLA (hors render-loop React).
 *
 * Parcours 3 étapes (≤5 min) : (1) bienvenue + layout Scalp, (2) clé Coinalyze
 * optionnelle, (3) alerte prix démo. Persistance locale `axiom:onboarding:v1` :
 * une fois complété ou sauté, l'overlay ne s'affiche plus. Rejouable via la
 * commande palette ONBOARD (ou `rejouer()`).
 *
 * Aucune clé API dans le state ; les actions composent les stores existants
 * (windowManager, orderflow, coinalyze, alerts, market).
 */
import { createStore } from "zustand/vanilla";
import type { Candle, ExchangeId } from "@axiom/types";
// Import de TYPE uniquement (élidé au runtime) : greffe via App.tsx / enregistrerCommandes.
import type { Commande } from "../commands/registry";
import { alertsStore } from "./alerts";
import { marketStore } from "./market";
import { orderflowStore } from "./orderflow";
import { windowManagerStore } from "./windowManager";

/** Clé localStorage (export/import de sauvegarde via préfixe axiom:). */
export const ONBOARDING_STORAGE_KEY = "axiom:onboarding:v1";

/** Nombre d'étapes du parcours (0-indexées en interne : 0, 1, 2). */
export const ONBOARDING_TOTAL_STEPS = 3;

/** Dernière étape (index). */
export const ONBOARDING_LAST_STEP = ONBOARDING_TOTAL_STEPS - 1;

export interface OnboardingState {
  /** true une fois le parcours terminé ou sauté — overlay masqué. */
  completed: boolean;
  /** Étape courante (0 = bienvenue, 1 = Coinalyze, 2 = alerte démo). */
  step: number;
  /** Passe à l'étape suivante ; à la dernière, marque completed. */
  next: () => void;
  /** Saute tout le parcours (ne plus afficher). */
  skip: () => void;
  /** Marque le parcours comme terminé (équivalent skip côté persistance). */
  complete: () => void;
  /** Rejoue depuis l'étape 0 (commande ONBOARD). */
  rejouer: () => void;
  /** Force l'étape (bornée) — utile tests / navigation interne. */
  setStep: (step: number) => void;
}

/** Forme persistée (sous-ensemble sérialisable). */
export interface OnboardingPersiste {
  completed: boolean;
  step: number;
}

/**
 * Parse / normalise un objet JSON potentiellement corrompu.
 * Fonction PURE — testée unitairement.
 */
export function parseOnboardingPersiste(raw: unknown): OnboardingPersiste {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { completed: false, step: 0 };
  }
  const o = raw as Partial<OnboardingPersiste>;
  const completed = o.completed === true;
  const stepNum = typeof o.step === "number" && Number.isFinite(o.step) ? o.step : 0;
  return {
    completed,
    // Si déjà completed, on fige step à 0 (l'UI ne lit pas step tant que completed).
    step: completed ? 0 : bornerStep(stepNum),
  };
}

/** Borne un index d'étape dans [0, LAST]. PURE. */
export function bornerStep(step: number): number {
  if (!Number.isFinite(step)) return 0;
  if (step < 0) return 0;
  if (step > ONBOARDING_LAST_STEP) return ONBOARDING_LAST_STEP;
  return Math.trunc(step);
}

/**
 * Calcule l'état après « suivant » : incrémente l'étape, ou complete à la fin.
 * PURE (pas d'effet de bord).
 */
export function etatApresNext(state: OnboardingPersiste): OnboardingPersiste {
  if (state.completed) return state;
  if (state.step >= ONBOARDING_LAST_STEP) {
    return { completed: true, step: 0 };
  }
  return { completed: false, step: state.step + 1 };
}

/**
 * Niveau d'alerte démo à partir du dernier close (ou repli BTC-like).
 * Arrondi à 2 décimales, +1 % au-dessus du prix pour ne pas déclencher tout de suite.
 * PURE.
 */
export function niveauAlerteDemo(candles: readonly Candle[], repli = 100_000): number {
  const last = candles[candles.length - 1];
  const base = last && Number.isFinite(last.close) && last.close > 0 ? last.close : repli;
  return Math.round(base * 1.01 * 100) / 100;
}

/** Paramètres d'une alerte prix démo (sans id). PURE. */
export function paramsAlerteDemo(
  symbol: string,
  source: ExchangeId,
  candles: readonly Candle[],
): {
  symbol: string;
  source: ExchangeId;
  condition: { type: "prix-croise"; niveau: number; sens: "hausse" };
  message: string;
} {
  return {
    symbol: symbol.toUpperCase(),
    source,
    condition: {
      type: "prix-croise",
      niveau: niveauAlerteDemo(candles),
      sens: "hausse",
    },
    message: "Alerte démo (onboarding)",
  };
}

/** true si l'overlay doit être monté / visible. PURE. */
export function doitAfficherOnboarding(completed: boolean): boolean {
  return !completed;
}

// ─────────────────────────── Persistance ───────────────────────────

function lireInitial(): OnboardingPersiste {
  try {
    const raw = localStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (!raw) return { completed: false, step: 0 };
    return parseOnboardingPersiste(JSON.parse(raw) as unknown);
  } catch {
    return { completed: false, step: 0 };
  }
}

function sauvegarder(state: OnboardingPersiste): void {
  try {
    const payload: OnboardingPersiste = {
      completed: state.completed,
      step: state.completed ? 0 : bornerStep(state.step),
    };
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* best-effort */
  }
}

const initial = lireInitial();

export const onboardingStore = createStore<OnboardingState>((set, get) => ({
  completed: initial.completed,
  step: initial.step,

  next: () => {
    const s = get();
    const next = etatApresNext({ completed: s.completed, step: s.step });
    set(next);
    sauvegarder(next);
  },

  skip: () => {
    const next: OnboardingPersiste = { completed: true, step: 0 };
    set(next);
    sauvegarder(next);
  },

  complete: () => {
    const next: OnboardingPersiste = { completed: true, step: 0 };
    set(next);
    sauvegarder(next);
  },

  rejouer: () => {
    const next: OnboardingPersiste = { completed: false, step: 0 };
    set(next);
    sauvegarder(next);
  },

  setStep: (step) => {
    const s = get();
    if (s.completed) return;
    const next: OnboardingPersiste = { completed: false, step: bornerStep(step) };
    set(next);
    sauvegarder(next);
  },
}));

// ─────────────────────────── Actions composées (side-effects) ───────────────────────────

/**
 * Playbook « Scalp » minimal (playbooks B3 pas encore là) : ouvre DES + DOM,
 * active l'orderflow, bascule le graphe en 1m.
 */
export function appliquerPlaybookScalp(): void {
  windowManagerStore.getState().openWindow("derivatives");
  windowManagerStore.getState().openWindow("dom");
  orderflowStore.getState().setEnabled(true);
  marketStore.getState().setTimeframe("1m");
}

/** Crée une alerte prix démo sur le symbole / source courants. */
export function creerAlerteDemo(): void {
  const { symbol, exchange, candles } = marketStore.getState();
  const params = paramsAlerteDemo(symbol, exchange, candles);
  alertsStore.getState().ajouter(params);
}

// ─────────────────────────── Commande palette ───────────────────────────

/** Commandes ONBOARD — greffées par l'intégrateur (`enregistrerCommandes` dans App.tsx). */
export const commandesOnboarding: Commande[] = [
  {
    id: "action:onboard",
    mnemonique: "ONBOARD",
    libelle: "Onboarding — rejouer le parcours",
    categorie: "action",
    motsCles: ["onboarding", "bienvenue", "tutoriel", "guide", "premier lancement", "aide"],
    apercu: "Relance le parcours d'accueil en 3 étapes",
    action: () => onboardingStore.getState().rejouer(),
  },
];
