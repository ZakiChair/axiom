import { beforeEach, describe, expect, it } from "vitest";
import { statutLectureAnalyse, validerLectureAnalyse, type LectureAnalyse } from "./analyseMultidomaine";
import { capturerLectures, lireLectures, remplacerLectures } from "../store/analyseMultidomaine";

const lecture: LectureAnalyse = {
  id: "macro:US:2026-07", domaine: "quadrant", nature: "observation",
  conclusion: "Croissance accélère, inflation ralentit", tags: [{ cle: "quadrant", valeur: "accelere-ralentit" }],
  instrument: null, horizon: { depuis: 100, jusqua: 800 }, unite: "point de pourcentage", valeur: 0.3,
  source: "FRED · INDPRO/CPIAUCSL", observeLe: 800, recupereLe: 900,
  validiteJusqua: 1_000, statut: "frais", couverture: { presentes: 2, attendues: 2 },
  limites: [], preuve: { fenetre: "RATE", reference: "production-aa-us/cpi-aa-us" },
};

beforeEach(() => {
  for (const domaine of ["quadrant", "liquidite", "rotation", "geo", "divergence"] as const) remplacerLectures(domaine, []);
});

describe("preuve d'analyse multidomaine", () => {
  it("périme exactement à la limite sans rajeunir l'observation", () => {
    expect(statutLectureAnalyse(lecture, 999)).toBe("frais");
    expect(statutLectureAnalyse(lecture, 1_000)).toBe("perime");
    expect(statutLectureAnalyse({ ...lecture, statut: "partiel" }, 999)).toBe("partiel");
  });

  it("rejette valeur non finie, champ inconnu et identité de marché inventée", () => {
    expect(validerLectureAnalyse({ ...lecture, valeur: Infinity })).toBeNull();
    expect(validerLectureAnalyse({ ...lecture, injected: true })).toBeNull();
    expect(validerLectureAnalyse({ ...lecture, instrument: { symbol: "BTCUSDT", source: "faux" } })).toBeNull();
    expect(validerLectureAnalyse(lecture)).toEqual(lecture);
  });

  it("conserve une copie acquise, rejette les doublons et refuse le futur à la capture", () => {
    const producteur = structuredClone(lecture);
    remplacerLectures("quadrant", [producteur, producteur]);
    producteur.conclusion = "muté";
    producteur.tags[0]!.valeur = "muté";
    const capture = capturerLectures(950);
    expect(capture).toHaveLength(1);
    expect(capture[0]?.conclusion).toBe("Croissance accélère, inflation ralentit");
    expect(capture[0]?.tags[0]?.valeur).toBe("accelere-ralentit");
    capture[0]!.conclusion = "muté par le consommateur";
    expect(lireLectures(950)[0]?.conclusion).toBe("Croissance accélère, inflation ralentit");
    expect(lireLectures(1_000)[0]?.statut).toBe("perime");
    remplacerLectures("geo", [{ ...lecture, id: "futur", domaine: "geo", observeLe: 1_100, recupereLe: 1_100 }]);
    expect(capturerLectures(1_000).map((item) => item.id)).not.toContain("futur");
  });

  it("borne le registre partagé à 50 preuves parmi tous les domaines", () => {
    remplacerLectures("quadrant", Array.from({ length: 30 }, (_, i) => ({ ...lecture, id: `q-${i}` })));
    remplacerLectures("geo", Array.from({ length: 30 }, (_, i) => ({ ...lecture, domaine: "geo" as const, id: `g-${i}`, recupereLe: 901 })));
    const toutes = lireLectures(950);
    expect(toutes).toHaveLength(50);
    expect(toutes.some((l) => l.domaine === "quadrant")).toBe(true);
    expect(toutes.some((l) => l.domaine === "geo")).toBe(true);
  });
});
