import { describe, expect, it } from "vitest";
import { parseEthStaking } from "./ethStaking";
const row = { date: "2026-09-07", entry_queue: 1993972, exit_queue: 6752, entry_wait: 34.62, exit_wait: 0.12,
  staked_amount: 42856364, staked_percent: 35.13, apr: 2.6 };
describe("files Ethereum quotidiennes", () => {
  it("conserve ETH et jours post-Pectra sans multiplier par 32", () => {
    expect(parseEthStaking([row], Date.UTC(2026, 8, 7))).toEqual([{
      time: Date.UTC(2026, 8, 7), entreeEth: 1993972, sortieEth: 6752, attenteEntreeJours: 34.62,
      attenteSortieJours: 0.12, stakeEth: 42856364, stakePct: 35.13, aprPct: 2.6,
    }]);
  });
  it("exclut la rupture d'unités, les dates impossibles/futures et les données manquantes", () => {
    expect(parseEthStaking([null, { ...row, date: "2025-05-21" }, { ...row, date: "2026-02-30" },
      { ...row, date: "2026-09-08" }, { ...row, entry_queue: null }], Date.UTC(2026, 8, 7))).toEqual([]);
  });
  it("zéro file est valide ; remplace les doublons par la dernière observation", () => {
    const p = parseEthStaking([row, { ...row, exit_queue: 0 }], Date.UTC(2026, 8, 7));
    expect(p).toHaveLength(1);
    expect(p[0]?.sortieEth).toBe(0);
  });
});
