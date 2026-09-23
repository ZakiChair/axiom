import { describe, expect, it, vi } from "vitest";
import type { ArchiveRunBacktest } from "../data/backtestArchive";
import type { ConfigRun } from "./backtestSignature";
import { signatureRun } from "./backtestSignature";
import { creerHistoriqueBacktest, CLE_HISTORIQUE_BT } from "./backtestHistory";
import { decoderVersion } from "../data/backtestArchive";
import { backtestStore, configCourante } from "./backtest";

const configFixture: ConfigRun = {
  symbol: "BTCUSDT", tf: "1h", plage: "6m", direction: "long", tailleFixe: 1000,
  stopPct: null, targetPct: null, stopAtr: null, risquePct: null, fraisPct: 0.05,
  slippagePct: 0.02, capitalInitial: 10_000, modeFunding: "aucun", intrabar: false,
  reglesEntree: [{ type: "comparaison", gauche: { type: "prix", champ: "close" }, comparateur: ">", droite: { type: "constante", valeur: 0 } }],
  reglesSortie: [],
};

const archiveFixture: ArchiveRunBacktest = {
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

function stockage() {
  const valeurs = new Map<string, string>();
  return {
    getItem: vi.fn((cle: string) => valeurs.get(cle) ?? null),
    setItem: vi.fn((cle: string, valeur: string) => { valeurs.set(cle, valeur); }),
    removeItem: vi.fn((cle: string) => { valeurs.delete(cle); }),
  };
}

describe("historique BT", () => {
  it("une version importée ne peut écraser aucune action ou phase du store", () => {
    const avant = backtestStore.getState();
    const version = decoderVersion({ id: "v", nom: "Import", creeMs: 1, schemaVersion: 1,
      config: { ...configFixture, run: "parasite", cancel: null, phase: "calcul", resultat: { fake: true }, signatureRun: "fausse" },
      signature: signatureRun(configFixture),
    });
    expect(version).not.toBeNull();
    backtestStore.setState({ phase: "done", signatureRun: "signature ancienne", resultat: null });
    const run = backtestStore.getState().run;
    const cancel = backtestStore.getState().cancel;
    backtestStore.getState().appliquerConfig(version!.config);
    expect(configCourante(backtestStore.getState())).toEqual(configFixture);
    expect(backtestStore.getState()).toMatchObject({ phase: "done", signatureRun: "signature ancienne", resultat: null });
    expect(backtestStore.getState().run).toBe(run);
    expect(backtestStore.getState().cancel).toBe(cancel);
    backtestStore.setState(avant);
  });
  it("garde deux runs de même configuration avec des IDs distincts après rechargement", () => {
    const storage = stockage();
    const historique = creerHistoriqueBacktest(storage);
    expect(historique.getState().ajouterRun(archiveFixture)).toBe(true);
    expect(historique.getState().ajouterRun(archiveFixture)).toBe(true);
    const recharge = creerHistoriqueBacktest(storage);
    expect(recharge.getState().runs).toHaveLength(2);
    expect(new Set(recharge.getState().runs.map((r) => r.id)).size).toBe(2);
    expect(recharge.getState().runs[0]?.stats.profitFactor).toBe(Infinity);
  });

  it("conserve une version complète, isolée des mutations, et la restitue", () => {
    const historique = creerHistoriqueBacktest(stockage());
    const source = structuredClone(configFixture);
    const id = historique.getState().sauverVersion("Réglage", source);
    expect(id).toBeTruthy();
    source.reglesEntree[0] = { type: "comparaison", gauche: { type: "prix", champ: "open" }, comparateur: "<", droite: { type: "constante", valeur: 1 } };
    const version = historique.getState().versions.find((v) => v.id === id);
    expect(version?.config.reglesEntree[0]).toMatchObject({ gauche: { champ: "close" } });
  });

  it("garde le run en mémoire en cas de quota, expose l'erreur et réessaie sans doublon", () => {
    const storage = stockage();
    storage.setItem.mockImplementationOnce(() => { throw new Error("quota"); });
    const historique = creerHistoriqueBacktest(storage);
    historique.getState().ajouterRun(archiveFixture);
    expect(historique.getState().runs).toHaveLength(1);
    expect(historique.getState().erreurSauvegarde).toMatch(/quota/i);
    expect(historique.getState().reessaiPossible).toBe(true);
    expect(historique.getState().reessayerSauvegarde()).toBe(true);
    expect(historique.getState().erreurSauvegarde).toBeNull();
    expect(historique.getState().reessaiPossible).toBe(false);
    expect(creerHistoriqueBacktest(storage).getState().runs).toHaveLength(1);
  });

  it("refuse le 51e run sans éviction et hydrate les entrées valides autour d'une corrompue", () => {
    const storage = stockage();
    const historique = creerHistoriqueBacktest(storage);
    for (let i = 0; i < 50; i++) expect(historique.getState().ajouterRun({ ...archiveFixture, id: String(i) })).toBe(true);
    expect(historique.getState().ajouterRun(archiveFixture)).toBe(false);
    expect(historique.getState().runs).toHaveLength(50);
    expect(historique.getState().erreurSauvegarde).toMatch(/50/);
    expect(historique.getState().reessaiPossible).toBe(false);
    storage.setItem(CLE_HISTORIQUE_BT, JSON.stringify({ schemaVersion: 1, runs: [JSON.parse(storage.getItem(CLE_HISTORIQUE_BT)!).runs[0], { id: "cassé" }], versions: [] }));
    expect(creerHistoriqueBacktest(storage).getState().runs).toHaveLength(1);
  });

  it("refuse la 51e version et écarte un ID dupliqué à l'hydratation", () => {
    const storage = stockage();
    const historique = creerHistoriqueBacktest(storage);
    for (let i = 0; i < 50; i++) expect(historique.getState().sauverVersion(`V${i}`, configFixture)).toBeTruthy();
    expect(historique.getState().sauverVersion("V50", configFixture)).toBeNull();
    expect(historique.getState().versions).toHaveLength(50);
    const brut = JSON.parse(storage.getItem(CLE_HISTORIQUE_BT)!);
    storage.setItem(CLE_HISTORIQUE_BT, JSON.stringify({ ...brut, versions: [brut.versions[0], brut.versions[0]] }));
    const recharge = creerHistoriqueBacktest(storage);
    expect(recharge.getState().versions).toHaveLength(1);
    expect(recharge.getState().erreurSauvegarde).toMatch(/ignorée/);
  });

  it("préserve le JSON original corrompu et bloque toute réécriture avant son export", () => {
    const storage = stockage();
    const brut = JSON.stringify({ schemaVersion: 1, runs: [JSON.parse(JSON.stringify({ ...archiveFixture, stats: { ...archiveFixture.stats, profitFactor: "Infinity" } })), { id: "cassé" }], versions: [] });
    storage.setItem(CLE_HISTORIQUE_BT, brut);
    const historique = creerHistoriqueBacktest(storage);
    expect(historique.getState().runs).toHaveLength(1);
    expect(historique.getState().ajouterRun(archiveFixture)).toBe(false);
    expect(storage.getItem(CLE_HISTORIQUE_BT)).toBe(brut);
    expect(historique.getState().exporterOriginalJSON()).toBe(brut);
    historique.getState().confirmerExportOriginal();
    expect(historique.getState().ajouterRun(archiveFixture)).toBe(true);
    expect(historique.getState().runs).toHaveLength(2);
  });
});
