/**
 * Rendu statique de l'onglet Rotation (env vitest node, sans jsdom) : nuage (quadrants
 * libellés, étiquette par actif, traîne, point hors cadre écrêté et signalé) et détail du
 * ratio X÷BTC ouvert au clic (régression de la revue du 2026-11-07 : la série BTC passait
 * par la prop réservée `ref`, retirée par React, et le clic levait une TypeError).
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DetailRatio, NuageRotation, variationRatio } from "./CorrRotation";
import type { PointRotation } from "../../data/rotationRelative";
import type { SerieCloture } from "../../data/corr";

const J = 20_399;
const JOUR = 86_400_000;

function point(symbole: string, x: number, y: number, quadrant: PointRotation["quadrant"]): PointRotation {
  return {
    symbole,
    x,
    y,
    quadrant,
    jour: J,
    traine: [
      { jour: J - 1, x: x * 0.9, y: y * 0.9 },
      { jour: J, x, y },
    ],
    nObs: 399,
  };
}

describe("NuageRotation", () => {
  it("libelle les quatre quadrants et chaque actif, trace la traîne", () => {
    const html = renderToStaticMarkup(
      <NuageRotation
        points={[point("SOLUSDT", 1.2, 0.8, "meneur"), point("ADAUSDT", -1, -0.5, "retard")]}
        selection={null}
        onSelection={() => {}}
      />,
    );
    for (const libelle of ["Meneur", "En affaiblissement", "En retard", "En amélioration"]) {
      expect(html).toContain(libelle);
    }
    expect(html).toContain(">SOL<");
    expect(html).toContain(">ADA<");
    expect(html.match(/<polyline/g)).toHaveLength(2);
    expect(html).toContain("SOLUSDT — Meneur · RS-Ratio 1.20 · RS-Momentum 0.80");
  });

  it("au-delà de ±4 z : point écrêté au bord et signalé « hors cadre »", () => {
    const html = renderToStaticMarkup(
      <NuageRotation points={[point("PEPEUSDT", 7, 1, "meneur")]} selection={null} onSelection={() => {}} />,
    );
    expect(html).toContain("hors cadre (écrêté)");
    expect(html).toContain("RS-Ratio (z) +4");
  });
});

describe("DetailRatio (clic sur un point ou une ligne)", () => {
  /** 120 jours clos : BTC en marche régulière, SOL = BTC × e^(0,001·t) (ratio croissant). */
  const NB = 120;
  const premierJour = J - NB + 1;
  const btc: SerieCloture[] = Array.from({ length: NB }, (_, t) => ({
    time: (premierJour + t) * JOUR,
    close: 30_000 * Math.exp(0.01 * Math.sin(t / 5)),
  }));
  const sol: SerieCloture[] = btc.map((p, t) => ({ time: p.time, close: (p.close / 300) * Math.exp(0.001 * t) }));
  /** Midi UTC du jour qui suit la dernière clôture. */
  const chargeA = (J + 1) * JOUR + 12 * 3_600_000;

  it("rendu exactement comme CorrRotation l'appelle : polyligne, Δ30 j et Δ90 j, bouton d'ouverture, sans exception", () => {
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToStaticMarkup(
      <DetailRatio point={point("SOLUSDT", 1.2, 0.8, "meneur")} serie={sol} serieRef={btc} chargeA={chargeA} />,
    );
    // Aucun avertissement React (« `ref` is not a prop… ») ni erreur de rendu.
    expect(erreur).not.toHaveBeenCalled();
    erreur.mockRestore();
    expect(html).toContain("SOL ÷ BTC");
    expect(html.match(/<polyline/g)).toHaveLength(1);
    // Ratio × e^(0,001) par jour : Δ30 j = e^0,03 − 1 ≈ +3,0 %, Δ90 j = e^0,09 − 1 ≈ +9,4 %.
    expect(html).toContain("Δ30 j +3.0%");
    expect(html).toContain("Δ90 j +9.4%");
    expect(html).toContain("Ouvrir SOL÷BTC sur le graphe");
  });

  it("historique trop court : variations « — » et message explicite au lieu de la courbe", () => {
    const html = renderToStaticMarkup(
      <DetailRatio point={point("SOLUSDT", 1, 1, "meneur")} serie={sol.slice(-1)} serieRef={btc} chargeA={chargeA} />,
    );
    expect(html).toContain("Δ30 j —");
    expect(html).toContain("Historique du ratio insuffisant.");
  });
});

describe("variationRatio", () => {
  it("variation sur des jours CALENDAIRES : un jour de départ manquant donne null, jamais une durée enjambée", () => {
    const jours = [1, 2, 3, 5, 6];
    const ratio = [1, 1.1, 1.2, 1.4, 1.5];
    expect(variationRatio(jours, ratio, 3)).toBeCloseTo((1.5 / 1.2 - 1) * 100, 12); // jour 3
    expect(variationRatio(jours, ratio, 2)).toBeNull(); // jour 4 manquant
    expect(variationRatio(jours, ratio, 10)).toBeNull(); // avant l'historique
    expect(variationRatio([], [], 1)).toBeNull();
  });
});
