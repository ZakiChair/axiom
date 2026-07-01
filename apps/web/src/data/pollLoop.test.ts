/**
 * Tests de pollLoop (pollLoop.ts) : le backoff pur (pollBackoffMs) + les garanties de
 * cycle de vie qui protègent les sources REST pollées (MEXC, Twelve Data) — pas de
 * chevauchement, backoff sur erreurs consécutives, remontée des erreurs via onError.
 * Une régression ici martèle silencieusement une source en panne/quota épuisé.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { pollBackoffMs, pollLoop } from "./pollLoop";

afterEach(() => {
  vi.useRealTimers();
});

describe("pollBackoffMs", () => {
  it("0 erreur => aucun backoff ; sinon intervalMs * 2^(n-1), plafonné à 60s", () => {
    expect(pollBackoffMs(0, 5000)).toBe(0);
    expect(pollBackoffMs(1, 5000)).toBe(5000); // 5000 * 2^0
    expect(pollBackoffMs(2, 5000)).toBe(10000); // 5000 * 2^1
    expect(pollBackoffMs(3, 5000)).toBe(20000); // 5000 * 2^2
    expect(pollBackoffMs(10, 5000)).toBe(60000); // plafonné (5000*64 = 320000 > 60000)
  });
});

describe("pollLoop — cycle de vie", () => {
  it("garde anti-chevauchement : aucun tick ne démarre tant que le précédent est en cours", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let calls = 0;
    // Initialisé à un no-op (assigné par l'exécuteur du Promise, synchrone) pour éviter
    // que TS ne rétrécisse le type à `null` au point d'appel.
    let resolveTick: () => void = () => {};
    const tick = () => {
      calls += 1;
      return new Promise<void>((res) => {
        resolveTick = res;
      }); // reste en cours jusqu'à resolveTick()
    };

    const unsub = pollLoop(tick, 1000, { immediate: true });
    await Promise.resolve(); // le tick immédiat a démarré (calls = 1)
    expect(calls).toBe(1);

    // 3 intervalles s'écoulent alors que le tick 1 est toujours en cours.
    await vi.advanceTimersByTimeAsync(3000);
    expect(calls).toBe(1); // aucun tick chevauchant

    // Le tick 1 se termine : le prochain intervalle peut relancer un cycle.
    resolveTick();
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(2);

    unsub();
  });

  it("remonte l'erreur via onError avec le nombre d'erreurs consécutives", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const onError = vi.fn();
    const tick = () => Promise.reject(new Error("boom"));

    const unsub = pollLoop(tick, 1000, { immediate: true, onError });
    await vi.advanceTimersByTimeAsync(0); // laisse le tick immédiat rejeter

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[1]).toBe(1); // 1re erreur consécutive
    unsub();
  });

  it("backoff : après une erreur, un cycle est sauté jusqu'à l'expiration du délai", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let calls = 0;
    const tick = () => {
      calls += 1;
      return Promise.reject(new Error("x"));
    };

    // interval=1000. t=1000 tick1 (err, backoff→2000). t=2000 tick2 (err, backoff→4000).
    // t=3000 SAUTÉ (backoff actif). t=4000 tick3.
    const unsub = pollLoop(tick, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(1000); // cycle sauté (backoff jusqu'à t=4000)
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(3);

    unsub();
  });

  it("reset du backoff après un cycle réussi", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let calls = 0;
    let doFail = true;
    const tick = () => {
      calls += 1;
      return doFail ? Promise.reject(new Error("x")) : Promise.resolve();
    };

    const unsub = pollLoop(tick, 1000);
    await vi.advanceTimersByTimeAsync(1000); // t=1000 échec (backoff→2000)
    expect(calls).toBe(1);
    doFail = false; // les prochains cycles réussissent
    await vi.advanceTimersByTimeAsync(1000); // t=2000 succès (backoff remis à zéro)
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(1000); // t=3000 cycle normal (plus de backoff)
    expect(calls).toBe(3);

    unsub();
  });
});
