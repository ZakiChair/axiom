/**
 * Store des TOASTS — notifications éphémères de feedback (Zustand VANILLA, hors render-loop).
 *
 * `pousserToast(texte, action?)` empile un toast (id incrémental), le retire automatiquement
 * après 2500 ms (6000 ms si une `action` — ex. « Annuler » — est fournie), et borne la pile
 * à 3 (le plus ancien saute au-delà). La logique d'empilement/coupe est isolée dans la pure
 * `empilerToast` (testée sans DOM). Le composant `Toasts` (monté une fois dans App) lit ce
 * store ; un clic appelle `retirerToast(id)`.
 */
import { createStore } from "zustand/vanilla";

/** Un toast affiché : identifiant unique + texte. */
export interface Toast {
  id: number;
  texte: string;
  /** Action optionnelle (ex. « Annuler ») — le toast reste affiché plus longtemps. */
  action?: { libelle: string; executer: () => void };
}

/** Nombre maximum de toasts empilés simultanément. */
const MAX_TOASTS = 3;
/** Durée d'affichage avant retrait automatique (ms). */
const DUREE_MS = 2500;
/** Durée d'affichage d'un toast actionnable — laisse le temps de cliquer (ms). */
const DUREE_ACTION_MS = 6000;

export interface ToastsState {
  toasts: Toast[];
}

export const toastsStore = createStore<ToastsState>(() => ({ toasts: [] }));

/**
 * Empile `nouveau` sur `toasts` en bornant la pile à `max` : au-delà, les plus ANCIENS
 * (en tête) sont coupés. PURE (testée sans DOM) — renvoie une nouvelle liste.
 */
export function empilerToast(toasts: Toast[], nouveau: Toast, max: number): Toast[] {
  return [...toasts, nouveau].slice(-max);
}

/** Compteur d'id incrémental (monotone sur toute la session). */
let prochainId = 1;

/** Retire un toast par id (clic utilisateur ou expiration du minuteur) — no-op si absent. */
export function retirerToast(id: number): void {
  const { toasts } = toastsStore.getState();
  if (toasts.some((t) => t.id === id)) {
    toastsStore.setState({ toasts: toasts.filter((t) => t.id !== id) });
  }
}

/**
 * Pousse un toast de feedback : id incrémental, empilé (max 3, le plus ancien saute),
 * auto-retiré après 2500 ms (6000 ms si `action` fournie — le temps de cliquer).
 */
export function pousserToast(texte: string, action?: Toast["action"]): void {
  const id = prochainId;
  prochainId += 1;
  toastsStore.setState((s) => ({ toasts: empilerToast(s.toasts, { id, texte, action }, MAX_TOASTS) }));
  setTimeout(() => retirerToast(id), action !== undefined ? DUREE_ACTION_MS : DUREE_MS);
}
