/**
 * Tests du throttle interne `recomputeThrottled` (ChartIndicators, indicators.ts) :
 * recalcul intra-bougie leading + trailing, période 500 ms, avec les DERNIERS
 * arguments reçus au flush trailing (pas les premiers — la bougie en formation a
 * changé entre-temps). `recompute` est spié pour isoler la logique de throttle de
 * tout calcul/chart réel ; horloge + `setTimeout` fakés via `vi.useFakeTimers()`.
 *
 * NOTE horloge : on avance le temps EXCLUSIVEMENT via `vi.advanceTimersByTime` une
 * fois la baseline posée par un unique `vi.setSystemTime` initial — un second appel à
 * `setSystemTime` après qu'un `setTimeout` a été programmé empêche ce timer de se
 * déclencher (comportement vérifié empiriquement des fake timers vitest/sinon).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Chart } from "klinecharts";
import { ChartIndicators } from "./indicators";
import type { ActiveIndicator } from "../store/indicators";
import type { Candle, ExchangeId } from "@axiom/types";

/** `recompute` ne touche jamais réellement `chart` une fois spié : un stub suffit. */
function makeIndicators() {
  const chart = {} as unknown as Chart;
  const indicators = new ChartIndicators(chart);
  const recomputeSpy = vi.spyOn(indicators, "recompute").mockImplementation(() => {});
  return { indicators, recomputeSpy };
}

const instances: ActiveIndicator[] = [];
const candles: Candle[] = [];

afterEach(() => {
  vi.useRealTimers();
});

describe("ChartIndicators.recomputeThrottled", () => {
  it("5 appels en 100 ms => 1 exécution immédiate (leading) + 1 trailing à t=500 ms", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const { indicators, recomputeSpy } = makeIndicators();

    indicators.recomputeThrottled(instances, candles, "binance");
    expect(recomputeSpy).toHaveBeenCalledTimes(1); // leading

    vi.advanceTimersByTime(20);
    indicators.recomputeThrottled(instances, candles, "binance"); // programme le trailing
    vi.advanceTimersByTime(20);
    indicators.recomputeThrottled(instances, candles, "binance"); // coalescé (trailing déjà programmé)
    vi.advanceTimersByTime(20);
    indicators.recomputeThrottled(instances, candles, "binance");
    vi.advanceTimersByTime(40); // t = 1_000_100
    indicators.recomputeThrottled(instances, candles, "binance");
    // Les 4 appels suivants (dans la fenêtre de garde de 500 ms) sont coalescés :
    // aucun recompute supplémentaire tant que le trailing n'a pas tourné.
    expect(recomputeSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(400); // t = 1_000_500
    expect(recomputeSpy).toHaveBeenCalledTimes(2); // trailing exécuté
  });

  it("un appel isolé (hors fenêtre de garde) s'exécute immédiatement, sans trailing", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const { indicators, recomputeSpy } = makeIndicators();

    indicators.recomputeThrottled(instances, candles, "binance");
    expect(recomputeSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2000); // largement au-delà des 500 ms de garde
    indicators.recomputeThrottled(instances, candles, "binance");
    expect(recomputeSpy).toHaveBeenCalledTimes(2); // exécution immédiate, pas de trailing programmé

    vi.advanceTimersByTime(1000);
    expect(recomputeSpy).toHaveBeenCalledTimes(2); // rien de plus : aucun trailing en attente
  });

  it("disposeThrottle annule un trailing en attente", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const { indicators, recomputeSpy } = makeIndicators();

    indicators.recomputeThrottled(instances, candles, "binance"); // leading
    vi.advanceTimersByTime(100);
    indicators.recomputeThrottled(instances, candles, "binance"); // programme un trailing à t=1_000_500

    indicators.disposeThrottle();

    vi.advanceTimersByTime(1000);
    expect(recomputeSpy).toHaveBeenCalledTimes(1); // le trailing a été annulé, pas de 2e appel
  });

  it("le trailing exécute recompute avec les DERNIERS arguments reçus, pas ceux de l'appel qui a programmé le timer", () => {
    // Ce test distingue explicitement l'appel qui PROGRAMME le trailing (B) de
    // l'appel COALESCÉ ensuite (C), qui doit gagner. Une implémentation buguée
    // qui fermerait sur les arguments de l'appel programmateur (le piège de
    // `createRafThrottle`, explicitement rejeté par le plan) retournerait B ici
    // et ferait échouer ce test.
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const { indicators, recomputeSpy } = makeIndicators();
    const exchangeA: ExchangeId = "binance";
    const exchangeB: ExchangeId = "coinbase";
    const exchangeC: ExchangeId = "okx";

    indicators.recomputeThrottled(instances, candles, exchangeA); // leading avec A
    expect(recomputeSpy).toHaveBeenLastCalledWith(instances, candles, exchangeA);

    vi.advanceTimersByTime(100);
    indicators.recomputeThrottled(instances, candles, exchangeB); // programme le trailing (args = B)

    vi.advanceTimersByTime(100);
    indicators.recomputeThrottled(instances, candles, exchangeC); // coalescé : doit remplacer les args par C

    vi.advanceTimersByTime(300); // t = 1_000_500 : le trailing se déclenche
    expect(recomputeSpy).toHaveBeenCalledTimes(2);
    expect(recomputeSpy).toHaveBeenLastCalledWith(instances, candles, exchangeC); // args du DERNIER appel (C), pas B
  });
});
