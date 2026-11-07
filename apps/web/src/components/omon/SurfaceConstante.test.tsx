import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SurfaceConstanteBloc } from "./SurfaceConstante";
import type { LectureHistorique, LectureMaturite, PointMaturiteConstante } from "../../data/surfaceConstante";

const NOW = Date.parse("2026-11-07T10:00:00Z");
const JOUR = 86_400_000;

const vide: LectureHistorique = { serie: [], percentile: null, sparkline: false, couverture: null, precedent: null };

function point(jours: 7 | 30 | 90, extra: Partial<PointMaturiteConstante> = {}): PointMaturiteConstante {
  return {
    jours, atm: 52.34, rr25: -4.2, bf25: 1.1, rr10: null, bf10: null, etat: "mesuree", aile10: "oi-insuffisante",
    avantMs: NOW + (jours - 1) * JOUR, apresMs: NOW + (jours + 2) * JOUR, ...extra,
  };
}

function lecture(p: PointMaturiteConstante, rr25: LectureHistorique = vide, atm: LectureHistorique = vide): LectureMaturite {
  return { point: p, atm, rr25, bf25: vide };
}

const props = { couverture: null, daemon: false, nbEcheancesRetenues: 9, nbEcheancesEcartees: 2, nowMs: NOW };

describe("SurfaceConstanteBloc", () => {
  it("affiche les trois horizons, masque le 10Δ peu adossé et dit pourquoi un horizon n'est pas mesuré", () => {
    const html = renderToStaticMarkup(
      <SurfaceConstanteBloc
        {...props}
        lectures={[
          lecture(point(7)),
          lecture(point(30, { rr10: -7.5, bf10: 3.25, aile10: "affichee" })),
          lecture(point(90, { etat: "non-encadree", atm: null, rr25: null, bf25: null, aile10: "non-mesuree", avantMs: null, apresMs: null })),
        ]}
      />,
    );
    expect(html).toContain("52.3 %");
    expect(html).toContain("−4.20 pt");
    expect(html).toContain("+1.10 pt");
    expect(html).toContain("masqué");
    expect(html).toContain("−7.50 pt");
    expect(html).toContain("6–9 j");
    expect(html).toContain("non mesuré : horizon non encadré");
    expect(html).toContain("9 retenues, 2 écartées");
    expect(html).toContain("aucun instantané pour l&#x27;instant");
    expect(html).toContain("ce navigateur seulement");
  });

  it("sous 90 instantanés : ni sparkline ni percentile, décompte affiché", () => {
    const rr: LectureHistorique = { ...vide, serie: [{ t: NOW - JOUR, v: -3 }], couverture: { jours: 1, joursPossibles: 2, debutMs: NOW - JOUR }, precedent: { t: Date.parse("2026-11-06T08:12:00Z"), v: -3 } };
    const html = renderToStaticMarkup(
      <SurfaceConstanteBloc {...props} daemon couverture={rr.couverture} lectures={[lecture(point(30), rr, vide)]} />,
    );
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("percentile sur 1 an");
    expect(html).toContain("1/90 instantanés");
    expect(html).toContain("Depuis l&#x27;instantané du 06/11 08:12 UTC (30 j)");
    // −4,2 − (−3) = −1,2 pt ; ATM sans point précédent : non mesuré.
    expect(html).toContain("RR25 −1.20 pt");
    expect(html).toContain("ATM —");
    expect(html).toContain("daemon + ce navigateur");
    expect(html).toContain("1 jour capturé sur 2");
  });

  it("à partir de 90 instantanés : sparkline et percentile 1 an avec n", () => {
    const serie = Array.from({ length: 120 }, (_, i) => ({ t: NOW - (i + 1) * JOUR, v: i % 7 }));
    const rr: LectureHistorique = { serie, percentile: 83, sparkline: true, couverture: { jours: 120, joursPossibles: 125, debutMs: NOW - 120 * JOUR }, precedent: null };
    const html = renderToStaticMarkup(<SurfaceConstanteBloc {...props} couverture={rr.couverture} lectures={[lecture(point(30), rr, vide)]} />);
    expect(html).toContain("<svg");
    expect(html).toContain("83e percentile sur 1 an (n = 120)");
    expect(html).toContain("120 jours capturés sur 125");
  });
});
