import { describe, expect, it } from "vitest";
import type { LectureAnalyse } from "./analyseMultidomaine";
import type { DossierDecision } from "./decisionDossier";
import type { TradeJournal } from "./expy";
import { analyserContextes, statistiquesR } from "./expyContexte";

const lecture: LectureAnalyse = { id: "macro:US", domaine: "quadrant", nature: "observation", conclusion: "Expansion",
  tags: [{ cle: "quadrant", valeur: "expansion" }], instrument: null, horizon: { depuis: 100, jusqua: 500 },
  unite: null, valeur: null, source: "FRED", observeLe: 500, recupereLe: 600, validiteJusqua: 2000,
  statut: "frais", couverture: null, limites: [], preuve: { fenetre: "RATE", reference: "US" } };
const dossier = (id: string, tag: string, captureLe = 900): DossierDecision => ({ id, creeMs: 3000, schemaVersion: 1,
  qualite: "complete", origine: { alertId: id, ts: captureLe, symbol: "BTCUSDT", source: "binance", timeframe: "1h",
    condition: { type: "prix-croise", niveau: 100, sens: "hausse" }, valeur: 101, message: id }, contexte: {},
  analyse: { schemaVersion: 1, captureLe, lectures: [{ ...lecture, tags: [{ cle: "quadrant", valeur: tag }] }] },
  these: "", invalidation: "", revue: "" });
const trade = (id: string, decisionIds: string[], sortie = 120): TradeJournal => ({ id, symbol: "BTCUSDT", source: "binance",
  decisionIds, direction: "long", entree: 100, stopInitial: 90, taille: 1, sortie,
  ouvertTs: 1000, fermeTs: 2000, tags: [] });

describe("cohortes EXPY figées", () => {
  it("écarte sans exception les dates hors plage Date, en ouverture comme en clôture", () => {
    const res = analyserContextes([
      { ...trade("cloture", []), fermeTs: 1e20 },
      { ...trade("ouverture", []), ouvertTs: -1e20 },
      trade("valide", []),
    ], [], "");
    expect(res.exclusions.dateInvalide).toBe(2);
    expect(res.total).toBe(1);
    expect(res.groupes[0]?.joursDistincts).toBe(1);
  });
  it("respecte l'oracle de R descriptif, breakeven inclus", () => {
    const stats = statistiquesR([2, -1, 0, 1, -0.5]);
    expect(stats).toMatchObject({ nR: 5, moyenne: 0.3, mediane: 0, winRate: 0.4, profitFactor: 2,
      gains: 2, pertes: 2, breakeven: 1 });
    expect(stats.ecartType).toBeCloseTo(1.20415946, 7);
    expect(stats.erreurType).toBeCloseTo(0.53851648, 7);
  });

  it("déduplique trade et dossiers, puis isole les conflits dans la seule dimension US", () => {
    const ds = [dossier("a", "expansion"), dossier("b", "expansion"), dossier("c", "contraction")];
    const ts = [trade("t", ["a", "a", "b"]), trade("t", ["c"]), trade("u", ["a", "c"]), trade("v", ["a"], 100)];
    const res = analyserContextes(ts, ds, "quadrant:US");
    expect(res.groupes.find((g) => g.cle === "expansion")?.total).toBe(2);
    expect(res.groupes.find((g) => g.cle === "mixte")?.total).toBe(1);
    expect(res.total).toBe(3);
    expect(res.groupes.reduce((n, g) => n + g.total, 0)).toBe(3);
    expect(res.groupes.find((g) => g.cle === "expansion")?.statistiques.breakeven).toBe(1);
  });

  it("refuse source, instrument et antériorité incertains ; garde les renforts distincts", () => {
    const apres = dossier("late", "contraction", 1500);
    const basePost = dossier("post", "contraction", 2100);
    const tropTard = { ...basePost, analyse: { ...basePost.analyse!, lectures: [{ ...basePost.analyse!.lectures[0]!, validiteJusqua: 3000 }] } };
    const autreSource = { ...dossier("bybit", "contraction"), origine: { ...dossier("bybit", "contraction").origine, source: "bybit" as const } };
    const res = analyserContextes([trade("t", ["a", "late", "post", "bybit", "absent"]),
      { ...trade("sans-source", ["a"]), source: undefined }, { ...trade("sans-stop", ["a"]), stopInitial: 100 },
      { ...trade("overflow", ["a"]), entree: 1e200, stopInitial: 1e200 - 1e185, sortie: 1e300, taille: 1e100 }],
    [dossier("a", "expansion"), apres, tropTard, autreSource], "quadrant:US");
    expect(res.groupes.find((g) => g.cle === "mixte")?.total).toBe(1);
    expect(res.exclusions.sansSource).toBe(1);
    expect(res.exclusions.sansR).toBe(2);
    expect(res.exclusions.dossierAbsent).toBeGreaterThan(0);
    expect(res.exclusions.posterieurCloture).toBeGreaterThan(0);
  });

  it("sépare les zones et laisse géopolitique conditionnelle hors des cohortes observées", () => {
    const ez = { ...dossier("ez", "contraction"), analyse: { schemaVersion: 1 as const, captureLe: 900,
      lectures: [{ ...lecture, id: "macro:EZ", preuve: { fenetre: "RATE" as const, reference: "EZ" }, tags: [{ cle: "quadrant" as const, valeur: "contraction" }] }] } };
    const res = analyserContextes([trade("t", ["a", "ez"])], [dossier("a", "expansion"), ez], "quadrant:US");
    expect(res.groupes.find((g) => g.cle === "expansion")?.total).toBe(1);
    expect(res.dimensions).toContain("quadrant:EZ");
  });

  it("n'attribue pas une lecture instrumentée d'un autre marché ni un scénario à un état observé", () => {
    const eth = { ...dossier("eth", "expansion"), analyse: { schemaVersion: 1 as const, captureLe: 900,
      lectures: [{ ...lecture, instrument: { symbol: "ETHUSDT", source: "binance" as const } }] } };
    const crypto = { ...dossier("geo", "risque"), analyse: { schemaVersion: 1 as const, captureLe: 900,
      lectures: [{ ...lecture, id: "geo:energy", domaine: "geo" as const, nature: "scenario-conditionnel" as const,
        tags: [{ cle: "geo" as const, valeur: "risque" }], preuve: { fenetre: "GLOBE" as const, reference: "energy" } }] } };
    const incompatible = analyserContextes([trade("t", ["eth"])], [eth], "quadrant:US");
    expect(incompatible.groupes[0]?.cle).toBe("non-prouve");
    expect(incompatible.exclusions.lectureIncompatible).toBe(1);
    const conditionnel = analyserContextes([trade("t", ["geo"])], [crypto], "geo:geo:energy");
    expect(conditionnel.groupes[0]?.cle).toBe("non-prouve");
    expect(conditionnel.lignes[0]?.lectures[0]?.nature).toBe("scenario-conditionnel");
  });
});
