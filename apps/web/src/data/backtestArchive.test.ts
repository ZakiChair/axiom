import { describe, expect, it } from "vitest";
import type { ConfigRun } from "../store/backtestSignature";
import { signatureRun } from "../store/backtestSignature";
import { comparerArchives, decoderArchive, encoderArchive, type ArchiveRunBacktest } from "./backtestArchive";

export const configFixture: ConfigRun = {
  symbol: "BTCUSDT", tf: "1h", plage: "6m", direction: "long", tailleFixe: 1000,
  stopPct: 2, targetPct: 4, stopAtr: null, risquePct: null, fraisPct: 0.05,
  slippagePct: 0.02, capitalInitial: 10_000, modeFunding: "aucun", intrabar: true,
  reglesEntree: [{ type: "comparaison", gauche: { type: "prix", champ: "close" }, comparateur: ">", droite: { type: "constante", valeur: 0 } }],
  reglesSortie: [],
};

export const archiveFixture: ArchiveRunBacktest = {
  id: "run-1", creeMs: 100, schemaVersion: 1, moteurVersion: "bt-2026-09-23",
  config: configFixture, signature: signatureRun(configFixture), source: "binance-spot",
  fenetreDemandee: { debutMs: 0, finMs: 1000 },
  donnees: { premiereBougieMs: 100, derniereBougieMs: 800, finDonneesMs: 900, nbBougies: 70 },
  funding: { modele: "aucun", couverture: null, total: null },
  stats: { nbTrades: 2, nbGagnants: 2, nbPerdants: 0, winRatePct: 100,
    profitFactor: Infinity, pnlTotal: 100, pnlTotalPct: 1, maxDrawdownPct: 2,
    sharpe: 1, expositionPct: 10, gainMoyenPct: 2, perteMoyennePct: 0,
    nbTradesR: 2, sommeR: 2, expectancyR: 1, maeMoyenPct: -1, mfeMoyenPct: 3 },
};

describe("archive BT synthétique", () => {
  it("conserve le profit factor infini sans inclure trades, OHLC ni courbe", () => {
    const brut = encoderArchive(archiveFixture);
    expect(brut).toContain('"profitFactor":"Infinity"');
    expect(brut).not.toContain('"trades"');
    expect(brut).not.toContain('"equity"');
    expect(decoderArchive(JSON.parse(brut))).toEqual(archiveFixture);
  });

  it("rejette une statistique perdue ou une configuration incomplète", () => {
    const sansStats = JSON.parse(encoderArchive(archiveFixture));
    delete sansStats.stats.pnlTotal;
    expect(decoderArchive(sansStats)).toBeNull();
    const sansRegles = JSON.parse(encoderArchive(archiveFixture));
    delete sansRegles.config.reglesEntree;
    expect(decoderArchive(sansRegles)).toBeNull();
  });

  it("recharge les paramètres d'indicateur nombre, booléen et chaîne", () => {
    const config: ConfigRun = { ...configFixture, reglesEntree: [{
      type: "comparaison",
      gauche: { type: "indicateur", indicateurId: "fixture", output: "value", params: { length: 20, actif: true, source: "close" } },
      comparateur: ">", droite: { type: "constante", valeur: 0 },
    }] };
    const run = { ...archiveFixture, config, signature: signatureRun(config) };
    expect(decoderArchive(JSON.parse(encoderArchive(run)))?.config).toEqual(config);
  });

  it("ne produit des deltas que sur une fenêtre et une source identiques", () => {
    const meme = { ...archiveFixture, id: "run-2", stats: { ...archiveFixture.stats, pnlTotal: 120 } };
    expect(comparerArchives(archiveFixture, meme).deltas?.pnlTotal).toBe(20);
    expect(comparerArchives(archiveFixture, { ...meme, donnees: { ...meme.donnees, premiereBougieMs: 200 } }).deltas).toBeNull();
    expect(comparerArchives(archiveFixture, { ...meme, source: "binance-perp" }).deltas).toBeNull();
    expect(comparerArchives(archiveFixture, { ...meme, config: { ...meme.config, fraisPct: 0.1 } }).avertissements).toContain("Frais différents");
  });
});
