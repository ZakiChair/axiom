import { describe, expect, it } from "vitest";
import { parseEtfHistory, resumerEtfHistory } from "./etfHistory";
describe("historique ETF publié", () => {
  it("parse le format actuel snake_case et conserve une séance manquante", () => {
    const rows = parseEtfHistory({ code: 0, data: [
      { date: "2026-09-04", total_net_inflow: "-10", total_net_assets: "1000" },
      { date: "2026-09-03", total_net_inflow: null, total_net_assets: 1000 }, null,
      { date: "2026-02-30", total_net_inflow: 50 },
    ] });
    expect(rows).toEqual([
      { time: Date.UTC(2026, 8, 3), fluxUsd: null, encoursUsd: 1000 },
      { time: Date.UTC(2026, 8, 4), fluxUsd: -10, encoursUsd: 1000 },
    ]);
    expect(parseEtfHistory({ code: 1, data: [{ date: "2026-09-04", total_net_inflow: 10 }] })).toEqual([]);
  });
  it("cumule 5/20 séances disponibles et calcule le ratio du jour sur ses propres encours", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ time: i + 1, fluxUsd: i === 19 ? -10 : 2, encoursUsd: 100 }));
    expect(resumerEtfHistory(rows)).toMatchObject({ cumul5: -2, cumul20: 28, ratioJourPct: -10, observations: 20 });
    expect(resumerEtfHistory(rows.slice(-5)).cumul20).toBeNull();
    expect(resumerEtfHistory([...rows.slice(0, -1), { time: 20, fluxUsd: null, encoursUsd: 0 }]))
      .toMatchObject({ cumul5: null, cumul20: null, ratioJourPct: null });
  });
});
