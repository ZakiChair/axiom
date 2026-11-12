/**
 * Store des TOASTS — notifications éphémères de feedback (Zustand VANILLA, hors render-loop).
 *
 * `pousserToast(texte, action?, dureeMs?)` empile un toast (id incrémental), le retire
 * automatiquement après 2500 ms (6000 ms si une `action` — ex. « Annuler » — est fournie), et
 * borne la pile à 3 (le plus ancien saute au-delà). Une durée explicite remplace ces deux
 * valeurs ; 0 = AVIS D'ALERTE : aucun retrait automatique, il ne quitte l'écran que par le
 * toucher (`reste`). Deux règles le garantissent dans la pure `empilerToast` (testée sans DOM) :
 * un avis ordinaire ne chasse jamais un avis d'alerte ; au-delà de 3 avis d'alerte, les plus
 * anciens sont remplacés par UN avis de synthèse (« + N alertes plus anciennes — voir le
 * journal »), qui reste lui aussi. Le composant `Toasts` (monté une fois dans App) lit ce store ;
 * un clic appelle `retirerToast(id)`.
 */
import { createStore } from "zustand/vanilla";

/** Un toast affiché : identifiant unique + texte. */
export interface Toast {
  id: number;
  texte: string;
  /** Action optionnelle (ex. « Annuler ») — le toast reste affiché plus longtemps. */
  action?: { libelle: string; executer: () => void };
  /** Avis d'alerte (durée 0) : jamais retiré par un minuteur ni chassé de la pile, seulement par le toucher. */
  reste?: true;
  /** Avis de synthèse : nombre d'avis d'alerte plus anciens qu'il remplace. */
  remplace?: number;
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

/** Texte de l'avis de synthèse : `n` avis d'alerte plus anciens ne sont plus à l'écran, le journal les garde. */
export function texteSynthese(n: number): string {
  return `+ ${n} alertes plus anciennes — voir le journal`;
}

/**
 * Empile `nouveau` sur `toasts` en bornant la pile. PURE (testée sans DOM) — renvoie une
 * nouvelle liste, du plus ancien au plus récent.
 *  - Avis d'alerte (`reste`) : `max` au plus. Au-delà, les plus anciens sont remplacés, à la
 *    place du premier, par UN avis de synthèse qui les compte et reste comme eux ; les
 *    `max − 1` plus récents gardent leur texte. Aucun ne disparaît sans trace.
 *  - Avis ordinaires : ils se partagent les places que les avis d'alerte laissent, une au
 *    moins (le retour d'une action de l'opérateur reste visible) ; au-delà, le plus ANCIEN
 *    avis ordinaire saute. Sans avis d'alerte, c'est la borne d'origine : `max`.
 * La pile compte donc `max` avis au plus, `max + 1` quand les avis d'alerte tiennent toutes
 * les places.
 */
export function empilerToast(toasts: Toast[], nouveau: Toast, max: number): Toast[] {
  let pile = [...toasts, nouveau];
  const alertes = pile.filter((t) => t.reste === true);
  const premier = alertes[0];
  if (alertes.length > max && premier !== undefined) {
    const fondus = new Set(alertes.slice(0, alertes.length - (max - 1)));
    let n = 0;
    for (const t of fondus) n += t.remplace ?? 1;
    // L'id du premier avis fondu est repris : la synthèse garde sa place et son nœud à l'écran.
    const synthese: Toast = { id: premier.id, texte: texteSynthese(n), reste: true, remplace: n };
    pile = pile.flatMap((t) => (t === premier ? [synthese] : fondus.has(t) ? [] : [t]));
  }
  const places = Math.max(1, max - Math.min(alertes.length, max));
  const ordinaires = pile.filter((t) => t.reste !== true);
  if (ordinaires.length <= places) return pile;
  const coupes = new Set(ordinaires.slice(0, ordinaires.length - places));
  return pile.filter((t) => !coupes.has(t));
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
 * auto-retiré après 2500 ms (6000 ms si `action` fournie — le temps de cliquer). `dureeMs`
 * remplace cette durée ; 0 = avis d'alerte : pas de retrait automatique, il reste jusqu'au
 * toucher et aucun autre avis ne le chasse (cf. `empilerToast`).
 */
export function pousserToast(texte: string, action?: Toast["action"], dureeMs?: number): void {
  const id = prochainId;
  prochainId += 1;
  const duree = dureeMs ?? (action !== undefined ? DUREE_ACTION_MS : DUREE_MS);
  const toast: Toast = duree > 0 ? { id, texte, action } : { id, texte, action, reste: true };
  toastsStore.setState((s) => ({ toasts: empilerToast(s.toasts, toast, MAX_TOASTS) }));
  if (duree > 0) setTimeout(() => retirerToast(id), duree);
}
