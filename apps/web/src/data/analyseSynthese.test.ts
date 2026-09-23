import { describe, expect, it } from "vitest";
import type { LectureAnalyse } from "./analyseMultidomaine";
import type { ResultatRotation } from "./onchain/rotationChaines";
import type { PrixRotation } from "./onchain/prixRotation";
import { comparerSnapshotsAnalyse, creerSnapshotAnalyse, identiteSemantiqueLecture, lectureDivergenceRotationPrix, qualifierRotationPrix, validerSnapshotAnalyse } from "./analyseSynthese";

const JOUR = 86_400_000;
const FIN = Date.UTC(2026, 8, 20);
const base: LectureAnalyse = { id: "liquidite:BTCUSDT:1000USDT:achat", domaine: "liquidite", nature: "observation", conclusion: "Médiane 1 min 10 bps", tags: [{ cle: "liquidite", valeur: "mediane-1min:achat:1000USDT" }], instrument: { symbol: "BTCUSDT", source: "binance" }, horizon: { depuis: FIN - 60_000, jusqua: FIN }, unite: "bps", valeur: 10, source: "Binance spot", observeLe: null, recupereLe: FIN, validiteJusqua: FIN + 5000, statut: "frais", couverture: { presentes: 50, attendues: 60 }, limites: [], preuve: { fenetre: "DOM", reference: "stabilite:BTCUSDT:1000USDT:achat" } };
const rotation: ResultatRotation = { metrique: "tvl", horizonJours: 30, dateDebut: FIN - 30 * JOUR, dateFin: FIN, periodeFluxJours: null, source: "DefiLlama TVL", recupereLe: FIN + JOUR, perime: false, couverture: { presentes: 4, attendues: 4 }, limites: [], chaines: ["ethereum", "solana", "base", "arbitrum"].map((id) => ({ id: id as ResultatRotation["chaines"][number]["id"], niveauDebut: 100, niveauFin: 200, partDebutPct: 25, partFinPct: 40, deltaPartPp: 15, croissanceNiveauPct: 100, persistance: { gains: 1, transitions: 1, joursCouverts: 2 } })) };
const prix: PrixRotation = { symbol: "ETHUSDT", source: "Binance spot", unite: "USDT", periode: "1d", dateDebut: FIN - 30 * JOUR, dateFin: FIN, prixDebut: 100, prixFin: 90, variationPct: -10 };

describe("synthèse d'analyse bornée", () => {
  it("valide et copie un snapshot v1 sans dates futures, doublons ou valeurs corrompues", () => {
    const s = creerSnapshotAnalyse([base], FIN + 1000);
    expect(s).toMatchObject({ schemaVersion: 1, creeLe: FIN + 1000, lectures: [{ id: base.id }] });
    base.conclusion = "mutée";
    expect(s.lectures[0]?.conclusion).toBe("Médiane 1 min 10 bps");
    expect(validerSnapshotAnalyse({ ...s, schemaVersion: 2 })).toBeNull();
    expect(validerSnapshotAnalyse({ ...s, lectures: [s.lectures[0], s.lectures[0]] })).toBeNull();
    expect(validerSnapshotAnalyse({ ...s, lectures: [{ ...s.lectures[0], valeur: Infinity }] })).toBeNull();
    expect(validerSnapshotAnalyse({ ...s, lectures: [{ ...s.lectures[0], recupereLe: FIN + 2000 }] })).toBeNull();
    expect(validerSnapshotAnalyse({ schemaVersion: 1, creeLe: 1e20, lectures: [] })).toBeNull();
    for (const changement of [
      { horizon: { depuis: -1e20, jusqua: FIN } },
      { observeLe: -1e20 },
      { recupereLe: -1e20 },
      { validiteJusqua: 1e20 },
    ]) expect(validerSnapshotAnalyse({ ...s, lectures: [{ ...s.lectures[0], ...changement }] })).toBeNull();
  });

  it("requalifie à la date de capture une référence importée déjà expirée", () => {
    const ancien = validerSnapshotAnalyse({ schemaVersion: 1, creeLe: FIN + 1000, lectures: [{ ...base, valeur: 10, statut: "frais", validiteJusqua: FIN + 500 }] });
    expect(ancien?.lectures[0]?.statut).toBe("perime");
    const courant = creerSnapshotAnalyse([{ ...base, valeur: 20, validiteJusqua: FIN + 10_000 }], FIN + 2000);
    expect(comparerSnapshotsAnalyse(ancien!, courant)[0]).toMatchObject({ regle: "qualite-insuffisante", delta: null });
  });

  it("ne chiffre un delta que pour identité, méthode, source, unité, instrument et durée comparables", () => {
    const ancien = creerSnapshotAnalyse([{ ...base, conclusion: "ancien", valeur: 10 }], FIN + 1000);
    const courant = (changement: Partial<LectureAnalyse>) => creerSnapshotAnalyse([{ ...base, conclusion: "nouveau", valeur: 12, ...changement }], FIN + 2000);
    expect(comparerSnapshotsAnalyse(ancien, courant({}))[0]?.delta).toBe(2);
    for (const changement of [
      { source: "Bybit" }, { unite: "USD" }, { instrument: { symbol: "ETHUSDT", source: "binance" as const } },
      { horizon: { depuis: FIN - 120_000, jusqua: FIN } }, { statut: "perime" as const },
      { couverture: { presentes: 49, attendues: 60 } },
      { preuve: { fenetre: "DOM" as const, reference: "autre méthode" } },
    ]) expect(comparerSnapshotsAnalyse(ancien, courant(changement))[0]?.delta).toBeNull();
    expect(comparerSnapshotsAnalyse(ancien, courant({ couverture: { presentes: 49, attendues: 60 } }))[0]?.regle).toBe("couverture-changee");
  });

  it("l'identité sémantique garde le quadrant US distinct d'EZ même si le mois change", () => {
    const q = { ...base, id: "macro:US:2026-07:courant", domaine: "quadrant" as const, preuve: { fenetre: "RATE" as const, reference: "production-aa-us/cpi-aa-us" } };
    expect(identiteSemantiqueLecture(q)).toBe(identiteSemantiqueLecture({ ...q, id: "macro:US:2026-08:courant" }));
    expect(identiteSemantiqueLecture(q)).not.toBe(identiteSemantiqueLecture({ ...q, id: "macro:EZ:2026-07:courant", preuve: { fenetre: "RATE", reference: "production-aa-ez/cpi-aa-ez" } }));
  });

  it("compare part TVL et prix exacts : opposition descriptive, accord, zéro connu, Base exclue", () => {
    expect(qualifierRotationPrix(rotation, "ethereum", prix).etat).toBe("divergence");
    expect(qualifierRotationPrix(rotation, "ethereum", { ...prix, prixFin: 110, variationPct: 10 }).etat).toBe("concordance");
    expect(qualifierRotationPrix(rotation, "ethereum", { ...prix, prixFin: 100, variationPct: 0 }).etat).toBe("neutre");
    expect(qualifierRotationPrix(rotation, "base", null).etat).toBe("non-comparable");
    expect(qualifierRotationPrix(rotation, "ethereum", { ...prix, dateFin: FIN - JOUR }).etat).toBe("non-comparable");
    expect(qualifierRotationPrix(rotation, "ethereum", { ...prix, variationPct: 10 }).etat).toBe("non-comparable");
    expect(qualifierRotationPrix({ ...rotation, perime: true }, "ethereum", prix).etat).toBe("non-comparable");
    const lecture = lectureDivergenceRotationPrix(qualifierRotationPrix(rotation, "ethereum", prix), rotation, "ethereum", prix, FIN + JOUR);
    expect(lecture).toMatchObject({ domaine: "divergence", nature: "observation", statut: "frais", unite: null, valeur: null });
    expect(`${lecture.conclusion} ${lecture.preuve.reference}`).toMatch(/15.*pp.*-10.*%|15.*pp.*10.*%/);
  });

  it("reconnaît le changement d'état TVL/prix sans prendre valeurs et dates de preuve pour une méthode", () => {
    const divergence = lectureDivergenceRotationPrix(qualifierRotationPrix(rotation, "ethereum", prix), rotation, "ethereum", prix, FIN + JOUR);
    const prixAccord = { ...prix, prixFin: 110, variationPct: 10 };
    const concordance = lectureDivergenceRotationPrix(qualifierRotationPrix(rotation, "ethereum", prixAccord), rotation, "ethereum", prixAccord, FIN + JOUR);
    const avant = creerSnapshotAnalyse([divergence], FIN + JOUR);
    const apres = creerSnapshotAnalyse([concordance], FIN + JOUR + 1000);
    expect(comparerSnapshotsAnalyse(avant, apres)[0]).toMatchObject({ regle: "etat-change", delta: null });
    const r = { ...base, id: "rotation:tvl:30:ethereum", domaine: "rotation" as const, unite: "pp", valeur: 10, validiteJusqua: FIN + 2 * JOUR, preuve: { fenetre: "CHAIN" as const, reference: "tvl:ethereum:debut-1:fin-1" } };
    const rSuite = { ...r, valeur: 12, preuve: { fenetre: "CHAIN" as const, reference: "tvl:ethereum:debut-2:fin-2" } };
    expect(comparerSnapshotsAnalyse(creerSnapshotAnalyse([r], FIN + JOUR), creerSnapshotAnalyse([rSuite], FIN + JOUR))[0]).toMatchObject({ regle: "valeur-comparable", delta: 2 });
  });
});
