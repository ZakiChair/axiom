/**
 * Boucle de polling REST partagée (MEXC, Twelve Data klines, Twelve Data quotes) —
 * sources sans flux temps réel gratuit qui simulent le live par rafraîchissement
 * périodique. Centralise le cycle de vie générique (cancelled + AbortController +
 * setInterval/clearInterval) ; `tick` fournit sa propre logique de fetch + callbacks
 * (nombre d'appels variable selon la source) et consulte `isCancelled()` après tout
 * `await` pour ne pas livrer un résultat obsolète après désabonnement.
 *
 * Robustesse (roadmap 0.2d) :
 *  - garde anti-chevauchement : aucun tick ne démarre si le précédent est encore en
 *    cours (un fetch lent ne se superpose pas au cycle suivant) ;
 *  - backoff léger sur erreurs consécutives : après une erreur, on saute des cycles
 *    (délai croissant plafonné) au lieu de marteler une source en panne/quota épuisé ;
 *  - `onError` optionnel : l'erreur est surfacée (au lieu d'être silencieusement avalée) ;
 *  - `source` optionnel : report d'état (polling/error/closed) dans le healthStore.
 */
import type { Unsubscribe } from "@axiom/types";
import { healthStore } from "../store/health";

/** Plafond du backoff de polling (ms). */
const MAX_POLL_BACKOFF_MS = 60_000;

/**
 * Délai de backoff (ms) après `consecutiveErrors` erreurs consécutives : 0 si aucune
 * erreur, sinon `intervalMs * 2^(n-1)` plafonné. PURE & testée. Exemple pour
 * intervalMs=5000 : 1→5s, 2→10s, 3→20s, …, plafonné à 60s.
 */
export function pollBackoffMs(consecutiveErrors: number, intervalMs: number): number {
  if (consecutiveErrors <= 0) return 0;
  const exp = Math.min(consecutiveErrors - 1, 6); // borne l'exposant pour éviter l'overflow
  return Math.min(MAX_POLL_BACKOFF_MS, intervalMs * 2 ** exp);
}

export interface PollLoopOptions {
  /** Premier cycle immédiat (sans attendre le 1er intervalle). */
  immediate?: boolean;
  /** Rappelé sur erreur de `tick` (réseau/quota/parse) avec le nombre d'erreurs consécutives. */
  onError?: (err: unknown, consecutiveErrors: number) => void;
  /** Identifiant de source pour le registre santé (report polling/error/closed). */
  source?: string;
}

export function pollLoop(
  tick: (signal: AbortSignal, isCancelled: () => boolean) => Promise<void>,
  intervalMs: number,
  opts?: PollLoopOptions,
): Unsubscribe {
  let cancelled = false;
  let running = false; // garde anti-chevauchement
  let consecutiveErrors = 0;
  let nextAllowedTs = 0; // aucun tick avant cet instant (backoff)
  const controller = new AbortController();
  const source = opts?.source;

  const run = async () => {
    if (cancelled || running) return; // pas de tick chevauchant le précédent
    if (Date.now() < nextAllowedTs) return; // backoff en cours après erreurs
    running = true;
    try {
      await tick(controller.signal, () => cancelled);
      consecutiveErrors = 0;
      nextAllowedTs = 0;
      if (source && !cancelled) {
        healthStore.getState().setEtat(source, "polling", { dernierMessageTs: Date.now() });
      }
    } catch (err) {
      consecutiveErrors += 1;
      nextAllowedTs = Date.now() + pollBackoffMs(consecutiveErrors, intervalMs);
      if (source) healthStore.getState().marquerErreur(source, errorMessage(err));
      opts?.onError?.(err, consecutiveErrors);
    } finally {
      running = false;
    }
  };

  if (opts?.immediate) void run();
  const timer = setInterval(() => void run(), intervalMs);

  return () => {
    cancelled = true;
    controller.abort();
    clearInterval(timer);
    if (source) healthStore.getState().setEtat(source, "closed");
  };
}

/** Message lisible d'une erreur inconnue. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
