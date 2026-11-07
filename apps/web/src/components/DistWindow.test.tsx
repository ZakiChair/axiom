/**
 * Bouton « Bandes RV » de DIST : bascule de la source de niveaux, infobulle honnête (amplitude
 * statistique, distincte des bandes VaR) et détail du marché calculé (σ, couverture hors
 * échantillon, amplitude consommée) quand la source a publié. Rendu statique, aucun réseau.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { niveauxOverlaysStore } from "../chart/niveauxOverlays";
import { infoBandesRvStore, type BandesRvCalculees } from "../chart/niveaux/bandesRv";
import type { PrevisionHorizon } from "../data/harRv";
import { DistWindow } from "./DistWindow";

const prevision = (h: number, sigma: number): PrevisionHorizon => ({
  h, sigma, k1: 0.9, k2: 1.9, amplitude: 1.3 * sigma, filtre: false, couverture: { n: 400, dans1: 276, dans2: 381 },
});
const bande = (h: number, sigma: number) => ({
  ancre: 100, ancreMs: 0, horizonMs: h * 86_400_000, prevision: prevision(h, sigma), plus1: 102, moins1: 98, plus2: 104, moins2: 96,
});
const CALCUL: BandesRvCalculees = { jour: bande(1, 0.021), semaine: bande(7, 0.056), ancreJourMs: 0, historique: 1500 };

/** Attributs HTML décodés (apostrophes, guillemets, esperluettes). */
const decoder = (html: string): string => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

beforeEach(() => {
  // Le rendu serveur lit l'état initial des stores : on lui sert l'état courant.
  vi.spyOn(niveauxOverlaysStore, "getInitialState").mockImplementation(niveauxOverlaysStore.getState);
  vi.spyOn(infoBandesRvStore, "getInitialState").mockImplementation(infoBandesRvStore.getState);
});

afterEach(() => {
  niveauxOverlaysStore.getState().setActif("bandesRv", false);
  infoBandesRvStore.setState({ info: null });
  vi.restoreAllMocks();
});

describe("DistWindow — Bandes RV", () => {
  it("bouton éteint : infobulle générale (pas une borne, distincte des bandes VaR), aucune note", () => {
    const html = decoder(renderToStaticMarkup(<DistWindow />));
    expect(html).toMatch(/title="Bandes ±1σ\/±2σ jour et semaine prévues par HAR-RV[^"]*pas une borne[^"]*bandes VaR[^"]*"[^>]*aria-pressed="false"[^>]*>Bandes RV</);
    expect(html).not.toContain("Bandes RV (HAR");
  });

  it("bouton allumé et source publiée : couverture hors échantillon et amplitude consommée", () => {
    niveauxOverlaysStore.getState().setActif("bandesRv", true);
    infoBandesRvStore.setState({ info: { marche: "SOLUSDT (binance)", calcul: CALCUL, amplitudes: { jour: 0.63, semaine: null }, manque: null } });
    const html = decoder(renderToStaticMarkup(<DistWindow />));
    expect(html).toContain("Bandes RV (HAR, amplitude statistique, pas une borne) — SOLUSDT (binance) :");
    expect(html).toContain("jour σ 2,1 % (lignes à 0,90σ et 1,90σ), couverture hors échantillon ±1σ 69 %, ±2σ 95 % (n = 400 jours), amplitude consommée 63 %");
    expect(html).toContain("semaine σ 5,6 %");
    expect(html).toContain("amplitude consommée non mesurée");
    expect(html).toMatch(/title="[^"]*SOLUSDT \(binance\) : jour σ 2,1 %[^"]*"[^>]*aria-pressed="true"[^>]*>● Bandes RV</);
  });
});
