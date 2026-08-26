import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calculateNvtHistory,
  fetchNvtHistory,
  parseBlockchainChart,
} from "./blockchainNvt";

const DAY_MS = 86_400_000;
const D1 = Date.UTC(2026, 4, 3);
const D2 = D1 + DAY_MS;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("parseBlockchainChart", () => {
  it("convertit les secondes en millisecondes, filtre les valeurs invalides et trie", () => {
    expect(
      parseBlockchainChart({
        values: [
          { x: D2 / 1000, y: "40" },
          { x: String(D1 / 1000), y: 20 },
          { x: "", y: 1 },
          { x: D1 / 1000, y: "NaN" },
          { x: Number.POSITIVE_INFINITY, y: 1 },
          { x: (D2 + DAY_MS) / 1000, y: Number.NEGATIVE_INFINITY },
          null,
          "invalide",
        ],
      }),
    ).toEqual([
      { time: D1, value: 20 },
      { time: D2, value: 40 },
    ]);
  });

  it("renvoie une série vide pour une forme inutilisable", () => {
    expect(parseBlockchainChart(null)).toEqual([]);
    expect(parseBlockchainChart({ values: "invalide" })).toEqual([]);
  });
});

describe("calculateNvtHistory", () => {
  it("joint par jour UTC, garde le dernier market cap du jour et trie la sortie", () => {
    const marketCaps = [
      { time: D2 + 23 * 3_600_000, value: 800 },
      { time: D1 + 23 * 3_600_000, value: 300 },
      { time: D2 + 3_600_000, value: 500 },
      { time: D1 + 3_600_000, value: 200 },
    ];
    const transactionVolumes = [
      { time: D2 + 30_000, value: 20 },
      { time: D1 + 30_000, value: 10 },
    ];

    expect(calculateNvtHistory(marketCaps, transactionVolumes)).toEqual([
      { time: D1, value: 30 },
      { time: D2, value: 40 },
    ]);
  });

  it("ignore les points non finis, les volumes non positifs et les ratios non finis", () => {
    const days = [D1, D2, D2 + DAY_MS, D2 + 2 * DAY_MS, D2 + 3 * DAY_MS] as const;
    expect(
      calculateNvtHistory(
        [
          { time: days[0], value: 100 },
          { time: days[1], value: Number.NaN },
          { time: days[2], value: 100 },
          { time: days[3], value: Number.MAX_VALUE },
          { time: days[4], value: 90 },
        ],
        [
          { time: days[0], value: 0 },
          { time: days[1], value: 10 },
          { time: days[2], value: -5 },
          { time: days[3], value: Number.MIN_VALUE },
          { time: days[4], value: 3 },
          { time: Number.POSITIVE_INFINITY, value: 1 },
        ],
      ),
    ).toEqual([{ time: days[4], value: 30 }]);
  });
});

describe("fetchNvtHistory", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("fetch directement les deux charts avec la profondeur demandée et transmet le signal", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T12:00:00Z"));
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      const body = url.pathname.endsWith("/market-cap")
        ? {
            status: "ok",
            values: [
              { x: (D1 + 3_600_000) / 1000, y: 900 },
              { x: (D1 + 23 * 3_600_000) / 1000, y: 1_000 },
            ],
          }
        : { status: "ok", values: [{ x: D1 / 1000, y: 10 }] };
      return jsonResponse(body);
    });
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await expect(fetchNvtHistory(D1 + 12 * 3_600_000, controller.signal)).resolves.toEqual([
      { time: D1, value: 100 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const urls = fetchMock.mock.calls.map(([input, init]) => {
      expect(init).toEqual({ signal: controller.signal });
      return new URL(String(input));
    });
    expect(urls.map((url) => url.pathname).sort()).toEqual([
      "/charts/estimated-transaction-volume-usd",
      "/charts/market-cap",
    ]);
    for (const url of urls) {
      expect(url.origin).toBe("https://api.blockchain.info");
      expect(url.searchParams.get("start")).toBe("2026-05-03");
      expect(url.searchParams.get("timespan")).toBe("91days");
      expect(url.searchParams.get("format")).toBe("json");
      expect(url.searchParams.get("sampled")).toBe("false");
      expect(url.searchParams.get("cors")).toBe("true");
    }
  });

  it("lève sur une réponse HTTP non-ok", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T12:00:00Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) =>
        String(input).includes("/market-cap?")
          ? jsonResponse({}, 503)
          : jsonResponse({ status: "ok", values: [{ x: D1 / 1000, y: 10 }] }),
      ),
    );

    await expect(fetchNvtHistory(D1)).rejects.toThrow("Blockchain.info market-cap HTTP 503");
  });

  it("lève quand un chart ne contient aucun point exploitable", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T12:00:00Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) =>
        String(input).includes("/market-cap?")
          ? jsonResponse({ status: "ok", values: [{ x: D1 / 1000, y: 1_000 }] })
          : jsonResponse({ status: "ok", values: [{ x: "invalide", y: 10 }] }),
      ),
    );

    await expect(fetchNvtHistory(D1)).rejects.toThrow(
      "Blockchain.info estimated-transaction-volume-usd format inutilisable",
    );
  });
});
