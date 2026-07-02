/**
 * Throttle par requestAnimationFrame — coalesce les mises à jour du chemin
 * store→chart (ticks WS) pour BORNER le débit de rendu à ~N updates/s PAR chart.
 *
 * Motivation (Phase 4, multi-chart) : avec 4 graphes live, chacun reçoit son propre
 * flux kline. Appliquer chaque tick immédiatement (`chart.updateData`) multiplierait
 * les recalculs KLineChart. On COALESCE donc : plusieurs `trigger()` rapprochés ne
 * produisent qu'UN seul `flush()`, au plus une fois par frame ET pas plus souvent que
 * `minIntervalMs` (défaut ~100 ms → ~10 upd/s). La dernière donnée écrite dans le store
 * gagne (le flush relit l'état courant), donc aucune bougie n'est perdue — seule la
 * cadence de RENDU est plafonnée.
 *
 * Logique PURE et TESTABLE : l'horloge (`now`) et l'ordonnanceur (`schedule`/`cancel`)
 * sont injectables (défaut = performance.now + requestAnimationFrame). Aucune dépendance
 * KLineChart : le `flush` fourni par l'appelant fait l'`updateData`.
 */

/** Ordonnanceur d'une frame (défaut rAF) ; renvoie un handle annulable. */
export interface RafThrottleOptions {
  /** Débit maximal : intervalle minimal entre deux flush (ms). Défaut 100 (~10/s). */
  minIntervalMs?: number;
  /** Horloge monotone (ms). Défaut performance.now / Date.now. */
  now?: () => number;
  /** Planifie un callback « à la prochaine frame ». Défaut requestAnimationFrame. */
  schedule?: (cb: () => void) => number;
  /** Annule une frame planifiée. Défaut cancelAnimationFrame. */
  cancel?: (handle: number) => void;
}

export interface RafThrottle {
  /** Signale qu'une mise à jour est en attente (coalescée jusqu'au prochain flush). */
  trigger: () => void;
  /** Applique immédiatement le flush en attente (sync) et annule la frame planifiée. */
  flushNow: () => void;
  /** Arrête tout : annule la frame en attente, plus aucun flush. */
  dispose: () => void;
}

/** Horloge par défaut (performance.now si dispo, sinon Date.now). */
function defaultNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

/**
 * Crée un throttle rAF qui appelle `flush` au plus une fois par frame et au plus une
 * fois par `minIntervalMs`. Si un `trigger()` arrive alors qu'on est dans la fenêtre
 * de garde, on RE-PLANIFIE une frame pour appliquer le flush dès que la garde expire
 * (aucune mise à jour perdue, seulement retardée).
 */
export function createRafThrottle(flush: () => void, options: RafThrottleOptions = {}): RafThrottle {
  const minIntervalMs = options.minIntervalMs ?? 100;
  const now = options.now ?? defaultNow;
  const schedule =
    options.schedule ??
    ((cb: () => void): number =>
      typeof requestAnimationFrame !== "undefined"
        ? requestAnimationFrame(() => cb())
        : (setTimeout(cb, 16) as unknown as number));
  const cancel =
    options.cancel ??
    ((handle: number): void => {
      if (typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(handle);
      else clearTimeout(handle);
    });

  let handle: number | null = null;
  let pending = false;
  let lastFlush = Number.NEGATIVE_INFINITY;
  let disposed = false;

  const onFrame = (): void => {
    handle = null;
    if (disposed || !pending) return;
    const elapsed = now() - lastFlush;
    if (elapsed < minIntervalMs) {
      // Encore dans la fenêtre de garde : on replanifie une frame (le flush viendra
      // dès la prochaine frame après expiration ; suffisant à la granularité rAF).
      handle = schedule(onFrame);
      return;
    }
    pending = false;
    lastFlush = now();
    flush();
  };

  const trigger = (): void => {
    if (disposed) return;
    pending = true;
    if (handle === null) handle = schedule(onFrame);
  };

  const flushNow = (): void => {
    if (disposed) return;
    if (handle !== null) {
      cancel(handle);
      handle = null;
    }
    pending = false;
    lastFlush = now();
    flush();
  };

  const dispose = (): void => {
    disposed = true;
    pending = false;
    if (handle !== null) {
      cancel(handle);
      handle = null;
    }
  };

  return { trigger, flushNow, dispose };
}
