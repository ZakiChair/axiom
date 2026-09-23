import { beforeEach, describe, expect, it, vi } from "vitest";
import { actualiserAnalyseBrief, annulerActualisationAnalyseBrief, analyseBriefStore, CLE_ANALYSE_BRIEF } from "./analyseBrief";
import type { LectureAnalyse } from "../data/analyseMultidomaine";
import type { RegionMacro } from "../data/macro/catalogueMacro";
import type { ResultatQuadrants } from "../data/macro/quadrants";
import type { EconomieChainesResultat, SerieEconomie } from "../data/onchain/economieChaines";
import { lireLectures, remplacerLectures } from "./analyseMultidomaine";

const now = 1_000_000;
const lecture: LectureAnalyse = { id: "macro:US", domaine: "quadrant", nature: "observation", conclusion: "Connu", tags: [{ cle: "quadrant", valeur: "croissance-accelere-inflation-decelere" }], instrument: null, horizon: { depuis: 100, jusqua: 900 }, unite: null, valeur: null, source: "FRED", observeLe: 900, recupereLe: 950, validiteJusqua: 1_200_000, statut: "frais", couverture: { presentes: 2, attendues: 2 }, limites: [], preuve: { fenetre: "RATE", reference: "production-aa-us/cpi-aa-us" } };
let valeurs: Map<string, string>;
beforeEach(() => {
  annulerActualisationAnalyseBrief();
  valeurs = new Map();
  vi.stubGlobal("localStorage", { getItem: (key: string) => valeurs.get(key) ?? null, setItem: (key: string, value: string) => { valeurs.set(key, value); }, removeItem: (key: string) => { valeurs.delete(key); } });
  analyseBriefStore.setState({ courant: null, reference: null, erreur: null, archiveInvalide: null, pending: null });
  for (const domaine of ["quadrant", "liquidite", "rotation", "geo", "divergence"] as const) remplacerLectures(domaine, []);
});

function quadrant(region: RegionMacro, maintenant: number): ResultatQuadrants {
  const finMois = Date.UTC(2026, 7, 1) - 1;
  const croissance = { sens: "accelere" as const, courant: 2, precedent: 1, deltaPp: 1, periodeCourante: "2026-07", periodePrecedente: "2026-04", perimetre: "production", source: "FRED", observeLe: finMois, recupereLe: maintenant, perime: false, motif: null };
  const inflation = { ...croissance, sens: "decelere" as const, courant: 1, precedent: 2, deltaPp: -1, perimetre: "CPI" };
  return { connuLe: null, calculeLe: maintenant, regions: [{ region, raison: null, points: [{ mois: "2026-07", finPeriode: finMois, croissance, inflation, quadrant: "croissance-accelere-inflation-decelere", transition: null, pib: null }] }] };
}

function economie(dernierEth: number): EconomieChainesResultat {
  const fin = Date.UTC(2026, 8, 23);
  const now = fin + 2 * 86_400_000;
  const points = (value: number) => Array.from({ length: 31 }, (_, i) => ({ time: fin - (30 - i) * 86_400_000, value: i === 30 ? value : 100 }));
  const serie = (value: number): SerieEconomie => ({ disponible: true, perime: false, source: "DefiLlama TVL", recupereLe: now, serie: points(value), resume: { niveau: value, observeLe: fin, variation30jPct: null, variation90jPct: null, variation365jPct: null } });
  return { recupereLe: now, chaines: (["ethereum", "solana", "base", "arbitrum"] as const).map((id) => ({ id, libelle: id, tvl: serie(id === "ethereum" ? dernierEth : 100), dex: serie(100), stablecoins: serie(100), frais: serie(100), revenus: serie(100) })) };
}

describe("référence BRIEF", () => {
  it("une panne d'écriture laisse l'ancienne référence et un candidat réessayable", () => {
    analyseBriefStore.getState().publierCourant([lecture], now);
    expect(analyseBriefStore.getState().enregistrerReference()).toBe(true);
    const ancienne = valeurs.get(CLE_ANALYSE_BRIEF);
    analyseBriefStore.getState().publierCourant([{ ...lecture, conclusion: "Nouveau" }], now + 1000);
    vi.stubGlobal("localStorage", { getItem: (key: string) => valeurs.get(key) ?? null, setItem: () => { throw new Error("quota"); } });
    expect(analyseBriefStore.getState().enregistrerReference()).toBe(false);
    expect(analyseBriefStore.getState().reference?.lectures[0]?.conclusion).toBe("Connu");
    expect(analyseBriefStore.getState().pending?.lectures[0]?.conclusion).toBe("Nouveau");
    expect(valeurs.get(CLE_ANALYSE_BRIEF)).toBe(ancienne);
    vi.stubGlobal("localStorage", { getItem: (key: string) => valeurs.get(key) ?? null, setItem: (key: string, value: string) => { valeurs.set(key, value); } });
    expect(analyseBriefStore.getState().reessayerSauvegarde()).toBe(true);
    expect(analyseBriefStore.getState().reference?.lectures[0]?.conclusion).toBe("Nouveau");
  });

  it("garde le contenu d'une archive illisible sans l'effacer", () => {
    valeurs.set(CLE_ANALYSE_BRIEF, "{cassé");
    analyseBriefStore.getState().chargerReference();
    expect(analyseBriefStore.getState().archiveInvalide).toBe("{cassé");
    expect(valeurs.get(CLE_ANALYSE_BRIEF)).toBe("{cassé");
  });

  it("ignore une réponse ancienne jusque dans le registre de preuves", async () => {
    let finirAncienne!: (value: EconomieChainesResultat) => void;
    const ancienne = new Promise<EconomieChainesResultat>((resolve) => { finirAncienne = resolve; });
    const maintenant = Date.UTC(2026, 8, 25);
    const macro = async () => ({ regions: [], connuLe: null, calculeLe: maintenant });
    const premier = actualiserAnalyseBrief({ chargerMacro: macro, chargerEconomie: () => ancienne, chargerPrix: async () => null, maintenant: () => maintenant });
    const second = actualiserAnalyseBrief({ chargerMacro: macro, chargerEconomie: async () => economie(200), chargerPrix: async () => null, maintenant: () => maintenant });
    await second;
    expect(lireLectures(maintenant).find((l) => l.id === "rotation:tvl:30:ethereum")?.conclusion).toContain("+15.00 pp");
    finirAncienne(economie(300));
    await premier;
    expect(lireLectures(maintenant).find((l) => l.id === "rotation:tvl:30:ethereum")?.conclusion).toContain("+15.00 pp");
  });

  it("publie une zone rapide sans attendre l'autre et conserve les preuves des zones déjà acquises", async () => {
    const maintenant = Date.UTC(2026, 8, 25);
    let finirEz!: (valeur: ResultatQuadrants) => void;
    const ez = new Promise<ResultatQuadrants>((resolve) => { finirEz = resolve; });
    remplacerLectures("quadrant", [{ ...lecture, id: "macro:CH", preuve: { fenetre: "RATE", reference: "production-aa-ch/cpi-aa-ch" }, recupereLe: maintenant, validiteJusqua: maintenant + 86_400_000 }]);
    analyseBriefStore.getState().publierCourant([lecture], maintenant);
    analyseBriefStore.getState().enregistrerReference();
    const reference = analyseBriefStore.getState().reference;
    const sauvegarde = valeurs.get(CLE_ANALYSE_BRIEF);
    const run = actualiserAnalyseBrief({ regionsMacro: ["US", "EZ"], chargerMacro: (region) => region === "US" ? Promise.resolve(quadrant("US", maintenant)) : ez, chargerEconomie: async () => economie(200), chargerPrix: async () => null, maintenant: () => maintenant });
    await vi.waitFor(() => expect(analyseBriefStore.getState().macroZones.pretes).toBe(1));
    expect(analyseBriefStore.getState().macroZones).toEqual({ total: 2, pretes: 1, attente: 1, indisponibles: 0 });
    expect(analyseBriefStore.getState().chargements.quadrant).toBe("partiel");
    expect(lireLectures(maintenant).filter((l) => l.domaine === "quadrant").map((l) => l.preuve.reference)).toEqual(expect.arrayContaining(["production-aa-us/cpi-aa-us", "production-aa-ch/cpi-aa-ch"]));
    expect(lireLectures(maintenant).some((l) => l.domaine === "rotation")).toBe(true);
    expect(analyseBriefStore.getState().reference).toBe(reference);
    expect(valeurs.get(CLE_ANALYSE_BRIEF)).toBe(sauvegarde);
    finirEz(quadrant("EZ", maintenant));
    await run;
    expect(analyseBriefStore.getState().macroZones).toEqual({ total: 2, pretes: 2, attente: 0, indisponibles: 0 });
    expect(analyseBriefStore.getState().chargements.quadrant).toBe("pret");
  });

  it("borne une zone bloquée, n'annule pas on-chain et ignore sa réponse tardive", async () => {
    const maintenant = Date.UTC(2026, 8, 25);
    let finirEz!: (valeur: ResultatQuadrants) => void;
    let signalEz: AbortSignal | undefined;
    const ez = new Promise<ResultatQuadrants>((resolve) => { finirEz = resolve; });
    const run = actualiserAnalyseBrief({ regionsMacro: ["US", "EZ"], delaiMacroMs: 30, chargerMacro: (region, signal) => {
      if (region === "US") return Promise.resolve(quadrant("US", maintenant));
      signalEz = signal;
      return ez;
    }, chargerEconomie: async () => economie(200), chargerPrix: async () => null, maintenant: () => maintenant });
    await run;
    expect(signalEz?.aborted).toBe(true);
    expect(analyseBriefStore.getState().macroZones).toEqual({ total: 2, pretes: 1, attente: 0, indisponibles: 1 });
    expect(analyseBriefStore.getState().chargements.quadrant).toBe("partiel");
    expect(lireLectures(maintenant).some((l) => l.domaine === "rotation")).toBe(true);
    const avant = analyseBriefStore.getState().courant;
    finirEz(quadrant("EZ", maintenant));
    await Promise.resolve();
    expect(analyseBriefStore.getState().courant).toBe(avant);
    expect(lireLectures(maintenant).filter((l) => l.domaine === "quadrant").map((l) => l.preuve.reference)).not.toContain("production-aa-ez/cpi-aa-ez");
  });

  it("annule les tâches macro locales lors d'une fermeture et rejette l'ancienne génération après rafraîchissement", async () => {
    const maintenant = Date.UTC(2026, 8, 25);
    let finirAncien!: (valeur: ResultatQuadrants) => void;
    let signalAncien: AbortSignal | undefined;
    const ancien = new Promise<ResultatQuadrants>((resolve) => { finirAncien = resolve; });
    const premier = actualiserAnalyseBrief({ regionsMacro: ["US"], chargerMacro: (_region, signal) => { signalAncien = signal; return ancien; }, chargerEconomie: async () => economie(200), chargerPrix: async () => null, maintenant: () => maintenant });
    await vi.waitFor(() => expect(signalAncien).toBeDefined());
    annulerActualisationAnalyseBrief();
    expect(signalAncien?.aborted).toBe(true);
    const second = actualiserAnalyseBrief({ regionsMacro: ["US"], chargerMacro: async () => quadrant("US", maintenant), chargerEconomie: async () => economie(200), chargerPrix: async () => null, maintenant: () => maintenant });
    await second;
    const avant = analyseBriefStore.getState().courant;
    finirAncien(quadrant("EZ", maintenant));
    await premier;
    expect(analyseBriefStore.getState().courant).toBe(avant);
    expect(analyseBriefStore.getState().macroZones.pretes).toBe(1);
  });

  it("un rafraîchissement direct interrompt l'ancienne zone et protège le registre", async () => {
    const maintenant = Date.UTC(2026, 8, 25);
    let finirAncien!: (valeur: ResultatQuadrants) => void;
    let signalAncien: AbortSignal | undefined;
    const ancien = new Promise<ResultatQuadrants>((resolve) => { finirAncien = resolve; });
    const premier = actualiserAnalyseBrief({ regionsMacro: ["US"], chargerMacro: (_region, signal) => { signalAncien = signal; return ancien; }, chargerEconomie: async () => economie(200), chargerPrix: async () => null, maintenant: () => maintenant });
    await vi.waitFor(() => expect(signalAncien).toBeDefined());
    const second = actualiserAnalyseBrief({ regionsMacro: ["EZ"], chargerMacro: async () => quadrant("EZ", maintenant), chargerEconomie: async () => economie(200), chargerPrix: async () => null, maintenant: () => maintenant });
    await second;
    expect(signalAncien?.aborted).toBe(true);
    finirAncien(quadrant("US", maintenant));
    await premier;
    expect(lireLectures(maintenant).filter((l) => l.domaine === "quadrant").map((l) => l.preuve.reference)).toEqual(["production-aa-ez/cpi-aa-ez"]);
  });
});
