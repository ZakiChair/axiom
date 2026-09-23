import { beforeEach, describe, expect, it, vi } from "vitest";
import { actualiserAnalyseBrief, analyseBriefStore, CLE_ANALYSE_BRIEF } from "./analyseBrief";
import type { LectureAnalyse } from "../data/analyseMultidomaine";
import type { EconomieChainesResultat, SerieEconomie } from "../data/onchain/economieChaines";
import { lireLectures, remplacerLectures } from "./analyseMultidomaine";

const now = 1_000_000;
const lecture: LectureAnalyse = { id: "macro:US", domaine: "quadrant", nature: "observation", conclusion: "Connu", tags: [{ cle: "quadrant", valeur: "croissance-accelere-inflation-decelere" }], instrument: null, horizon: { depuis: 100, jusqua: 900 }, unite: null, valeur: null, source: "FRED", observeLe: 900, recupereLe: 950, validiteJusqua: 1_200_000, statut: "frais", couverture: { presentes: 2, attendues: 2 }, limites: [], preuve: { fenetre: "RATE", reference: "production-aa-us/cpi-aa-us" } };
let valeurs: Map<string, string>;
beforeEach(() => {
  valeurs = new Map();
  vi.stubGlobal("localStorage", { getItem: (key: string) => valeurs.get(key) ?? null, setItem: (key: string, value: string) => { valeurs.set(key, value); }, removeItem: (key: string) => { valeurs.delete(key); } });
  analyseBriefStore.setState({ courant: null, reference: null, erreur: null, archiveInvalide: null, pending: null });
  for (const domaine of ["quadrant", "liquidite", "rotation", "geo", "divergence"] as const) remplacerLectures(domaine, []);
});

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
});
