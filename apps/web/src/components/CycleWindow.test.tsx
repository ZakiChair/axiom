/**
 * Mise en page de CYCLE : la section « Attention grand public · Wikipédia » doit vivre DANS
 * le bloc défilant `flex min-h-0 flex-1` du contenu Coin Metrics, après sa note de source.
 * Montée en frère `shrink-0` de ce bloc, elle l'écrasait dans le corps flex-col de la
 * fenêtre : le graphe, la table des cycles et les modèles de prix débordaient par-dessus
 * (revue G-attention-wiki, tour 1, constatée en vrai navigateur).
 *
 * Env vitest node (pas de jsdom) : rendu statique, puis appariement des balises `<div>` pour
 * retrouver la fin du bloc défilant. Aucun effet n'est exécuté (aucun réseau).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CycleWindow } from "./CycleWindow";
import { cycleStore } from "../store/cycle";
import { decouperCycles } from "../data/cycle";

// Le snapshot SSR de Zustand est figé à la création ; les fixtures visent ici l'état courant.
vi.mock("zustand", () => ({
  useStore: <T, U>(store: { getState: () => T }, select: (state: T) => U) => select(store.getState()),
}));

// Pas de DOM : les couleurs du thème (lues au rendu de la table des cycles) prennent leur repli.
vi.mock("../lib/canvasTokens", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/canvasTokens")>()),
  lireTokenCanvas: (_nom: string, repli: string) => repli,
}));

const initial = cycleStore.getState();
afterEach(() => cycleStore.setState(initial, true));

const JOUR_MS = 86_400_000;
const OUVERTURE_BLOC = '<div class="flex min-h-0 flex-1 flex-col px-4 py-3">';
const TITRE_WIKI = "Attention grand public · Wikipédia";

/** Indice de la balise `</div>` qui ferme le `<div` ouvert à l'indice `debut`. */
function finDiv(html: string, debut: number): number {
  const balise = /<div[\s>]|<\/div>/g;
  balise.lastIndex = debut;
  let profondeur = 0;
  for (let m = balise.exec(html); m !== null; m = balise.exec(html)) {
    profondeur += m[0] === "</div>" ? -1 : 1;
    if (profondeur === 0) return m.index;
  }
  return -1;
}

/** Positions utiles du rendu : bloc défilant [debut, fin], section Wikipédia, note Coin Metrics. */
function positions(html: string): { debut: number; fin: number; section: number; noteCm: number } {
  const debut = html.indexOf(OUVERTURE_BLOC);
  return {
    debut,
    fin: debut < 0 ? -1 : finDiv(html, debut),
    section: html.indexOf(TITRE_WIKI),
    noteCm: html.indexOf("Coin Metrics · PriceUSD daily"),
  };
}

/** Prix quotidiens synthétiques (croissance régulière) de 2010 au 2026-11-05. */
function prixSynthetiques(): { time: number; value: number }[] {
  const points: { time: number; value: number }[] = [];
  const fin = Date.parse("2026-11-05T00:00:00Z");
  for (let t = Date.parse("2010-07-18T00:00:00Z"), i = 0; t <= fin; t += JOUR_MS, i += 1) {
    points.push({ time: t, value: 0.09 * Math.exp(i * 0.0023) });
  }
  return points;
}

describe("CYCLE : section Attention Wikipédia dans le bloc défilant", () => {
  it("cycles chargés : la section suit la note Coin Metrics, à l'intérieur du bloc défilant", () => {
    const series = decouperCycles(prixSynthetiques());
    expect(series.length).toBeGreaterThan(0);
    cycleStore.setState({ series, enCours: false, erreur: null, majTs: Date.now() });
    const html = renderToStaticMarkup(<CycleWindow />);
    const p = positions(html);
    expect(p.debut).toBeGreaterThanOrEqual(0);
    expect(p.fin).toBeGreaterThan(p.debut);
    expect(html).toContain('aria-label="Cycles BTC"');
    expect(p.noteCm).toBeGreaterThan(p.debut);
    // Ordre du flux : note Coin Metrics, PUIS section Wikipédia, toutes deux avant la fin du bloc.
    expect(p.section).toBeGreaterThan(p.noteCm);
    expect(p.section).toBeLessThan(p.fin);
    // Plus rien après le bloc défilant : aucun frère qui pourrait l'écraser.
    expect(html.slice(p.fin + "</div>".length)).toBe("");
  });

  it("prix en échec : la section reste affichée, dans le bloc défilant", () => {
    cycleStore.setState({ series: [], enCours: false, erreur: "Coin Metrics indisponible (HTTP 503).", majTs: null });
    const html = renderToStaticMarkup(<CycleWindow />);
    const p = positions(html);
    expect(html).toContain("Coin Metrics indisponible (HTTP 503).");
    expect(p.section).toBeGreaterThan(p.debut);
    expect(p.section).toBeLessThan(p.fin);
  });
});
