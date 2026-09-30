import { describe, expect, it } from "vitest";
import { runBacktest } from "@axiom/backtest";
import type { ArchiveRunBacktest } from "../data/backtestArchive";
import { comparerArchives } from "../data/backtestArchive";
import { backtestStore, configCourante } from "../store/backtest";
import { signatureRun } from "../store/backtestSignature";
import { lignesComparaison } from "./BacktestHistory";

const config = configCourante(backtestStore.getInitialState());
const archive: ArchiveRunBacktest = {
  id: "a", creeMs: 1, schemaVersion: 1, moteurVersion: "bt-2026-09-30", config, signature: signatureRun(config), source: "binance-spot",
  fenetreDemandee: { debutMs: 0, finMs: 2 }, donnees: { premiereBougieMs: 0, derniereBougieMs: 1, finDonneesMs: 2, nbBougies: 2 },
  funding: { modele: "aucun", couverture: null, total: null },
  stats: { ...runBacktest([], { direction: "long", tailleFixe: 100, reglesEntree: [], reglesSortie: [] }, { capitalInitial: 1000, fraisPct: 0, slippagePct: 0 }).stats,
    nbTrades: 1, maeMoyenPct: -5, mfeMoyenPct: 8, pnlTotal: 10 },
};

describe("comparaison des excursions archivées", () => {
  it.each(["a", "b"])("affiche la borne uniquement pour le run partiel %s et masque les deux deltas", (partiel) => {
    const a = { ...archive, stats: { ...archive.stats, ...(partiel === "a" ? { nbExcursionsPartielles: 1 } : {}) } };
    const b = { ...archive, id: "b", stats: { ...archive.stats, pnlTotal: 20, ...(partiel === "b" ? { nbExcursionsPartielles: 1 } : {}) } };
    const lignes = lignesComparaison(a, b, comparerArchives(a, b).deltas);
    const mae = lignes.find((l) => l.id === "maeMoyenPct")!;
    const mfe = lignes.find((l) => l.id === "mfeMoyenPct")!;
    expect(mae[partiel as "a" | "b"]).toBe("≤ -5.00");
    expect(mfe[partiel as "a" | "b"]).toBe("≥ 8.00");
    expect(mae[partiel === "a" ? "b" : "a"]).toBe("-5.00");
    expect(mfe[partiel === "a" ? "b" : "a"]).toBe("8.00");
    expect(mae.delta).toBe("—");
    expect(mfe.delta).toBe("—");
    expect(lignes.find((l) => l.id === "pnlTotal")?.delta).toBe("10.00");
  });
});
