/**
 * Tests du throttle rAF (logique pure) : coalescence des triggers, plafond de débit
 * (minIntervalMs), replanification dans la fenêtre de garde, flush immédiat et dispose.
 * Horloge + ordonnanceur injectés → déterministe, sans vrai requestAnimationFrame.
 */
import { describe, expect, it } from "vitest";
import { createRafThrottle } from "./rafThrottle";

/**
 * Ordonnanceur simulé : garde les callbacks en file ; `runFrame()` en exécute
 * exactement un (la plus ancienne frame planifiée). Horloge manuelle via `clock`.
 */
function harness() {
  let handle = 0;
  const frames = new Map<number, () => void>();
  let clock = 1000;
  const opts = {
    now: () => clock,
    schedule: (cb: () => void): number => {
      const h = ++handle;
      frames.set(h, cb);
      return h;
    },
    cancel: (h: number): void => void frames.delete(h),
  };
  return {
    opts,
    advance: (ms: number) => {
      clock += ms;
    },
    /** Exécute la première frame en attente (renvoie false si aucune). */
    runFrame: (): boolean => {
      const next = frames.entries().next();
      if (next.done) return false;
      const [h, cb] = next.value;
      frames.delete(h);
      cb();
      return true;
    },
    pending: () => frames.size,
  };
}

describe("createRafThrottle", () => {
  it("coalesce plusieurs triggers en un seul flush par frame", () => {
    const h = harness();
    let flushes = 0;
    const t = createRafThrottle(() => flushes++, { minIntervalMs: 100, ...h.opts });

    t.trigger();
    t.trigger();
    t.trigger();
    expect(flushes).toBe(0); // rien tant que la frame n'a pas tourné
    expect(h.pending()).toBe(1); // une seule frame planifiée pour 3 triggers

    h.advance(200); // au-delà de la garde
    h.runFrame();
    expect(flushes).toBe(1); // 3 triggers → 1 flush
  });

  it("plafonne le débit : re-planifie tant que la garde n'est pas expirée", () => {
    const h = harness();
    let flushes = 0;
    const t = createRafThrottle(() => flushes++, { minIntervalMs: 100, ...h.opts });

    t.trigger();
    h.advance(200);
    h.runFrame();
    expect(flushes).toBe(1);

    // Nouveau trigger juste après : encore dans la fenêtre de garde (elapsed=10<100).
    h.advance(10);
    t.trigger();
    h.runFrame(); // dans la garde → replanifie, pas de flush
    expect(flushes).toBe(1);
    expect(h.pending()).toBe(1); // une frame de rattrapage est en attente

    h.advance(100); // garde expirée
    h.runFrame();
    expect(flushes).toBe(2);
  });

  it("flushNow applique immédiatement et annule la frame planifiée", () => {
    const h = harness();
    let flushes = 0;
    const t = createRafThrottle(() => flushes++, { minIntervalMs: 100, ...h.opts });

    t.trigger();
    expect(h.pending()).toBe(1);
    t.flushNow();
    expect(flushes).toBe(1);
    expect(h.pending()).toBe(0); // frame annulée
  });

  it("dispose empêche tout flush ultérieur", () => {
    const h = harness();
    let flushes = 0;
    const t = createRafThrottle(() => flushes++, { minIntervalMs: 100, ...h.opts });

    t.trigger();
    t.dispose();
    h.advance(500);
    h.runFrame();
    t.trigger(); // ignoré après dispose
    expect(flushes).toBe(0);
  });
});
