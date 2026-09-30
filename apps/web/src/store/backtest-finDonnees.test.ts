import { afterEach, describe, expect, it, vi } from "vitest";
import type { Candle } from "@axiom/types";
import type { WorkerRequest } from "../workers/backtest.worker";

const { charger } = vi.hoisted(() => ({ charger: vi.fn() }));
vi.mock("../data/backtestData", async (importOriginal) => ({ ...await importOriginal<typeof import("../data/backtestData")>(), accumulerKlines: charger }));
import { backtestStore } from "./backtest";

afterEach(() => { backtestStore.getState().cancel(); vi.unstubAllGlobals(); });

describe("borne réelle transmise au worker spot", () => {
  it.each([
    { tf: "1h" as const, debut: Date.UTC(2026, 8, 1), pas: 3_600_000 },
    { tf: "1d" as const, debut: Date.UTC(2026, 1, 1), pas: 86_400_000 },
    { tf: "1w" as const, debut: Date.UTC(2026, 1, 2), pas: 604_800_000 },
  ])("$tf : la dernière clôture est connue même sans funding", async ({ tf, debut, pas }) => {
    const candles: Candle[] = Array.from({ length: 30 }, (_, i) => ({ time: debut + i * pas, open: 100, high: 100, low: 100, close: 100, volume: 1, closed: true }));
    charger.mockResolvedValue(candles);
    const messages: WorkerRequest[] = [];
    vi.stubGlobal("Worker", class { postMessage(msg: WorkerRequest) { messages.push(msg); } terminate() {} });
    backtestStore.setState({ symbol: "BTCUSDT", tf, modeFunding: "aucun", reglesEntree: [{ type: "comparaison", gauche: { type: "prix", champ: "close" }, comparateur: ">", droite: { type: "constante", valeur: 0 } }], reglesSortie: [] });
    backtestStore.getState().run();
    await vi.waitFor(() => expect(messages).toHaveLength(1));
    expect(messages[0]!.params.finDonneesMs).toBe(debut + 30 * pas);
    expect(messages[0]!.params.funding).toBeUndefined();
  });
});
