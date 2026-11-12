/**
 * Menu du clic droit dans la bande d'une zone forte d'AXIS S/R (phase 2 d'AXIS, lot 2, 12 novembre
 * 2026) : l'alerte de prix au BORD de la zone s'ajoute sous l'en-tête ; l'en-tête, premier `div` du
 * menu, et les trois entrées au prix du clic ne changent pas.
 *
 * Le menu est ouvert par son vrai gestionnaire (`bindPriceAlertMenu`), sur un DOM minimal (pas de
 * jsdom dans le dépôt, comme `paneHeaders.test.ts`) et un faux graphe ; les stores sont les vrais.
 * Le clic droit réel est prouvé au bureau par `e2e/quatre-lots-indicateurs.e2e.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Chart } from "klinecharts";
import type { AnnotationsIndicateur, RubanAnnotation } from "@axiom/types";
import { alertsStore } from "../store/alerts";
import { indicatorsStore } from "../store/indicators";
import { toastsStore } from "../store/toasts";
import { axiomName } from "./indicators";
import { bindPriceAlertMenu, itemsMenuAlertePrix, type LigneAccrochable, type PriceAlertMarket } from "./priceAlertMenu";

type Ecouteur = (evenement: Record<string, unknown>) => void;

/** Élément DOM minimal : arbre, attributs, style, écouteurs. */
class FauxElement {
  children: FauxElement[] = [];
  parent: FauxElement | null = null;
  readonly attributs = new Map<string, string>();
  readonly style: Record<string, string> = {};
  readonly ecouteurs = new Map<string, Ecouteur[]>();
  id = "";
  type = "";
  textContent = "";
  constructor(readonly tagName: string) {}
  setAttribute(cle: string, valeur: string): void {
    this.attributs.set(cle, valeur);
  }
  getAttribute(cle: string): string | null {
    return this.attributs.get(cle) ?? null;
  }
  appendChild(n: FauxElement): FauxElement {
    n.parent = this;
    this.children.push(n);
    return n;
  }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  contains(): boolean {
    return false;
  }
  addEventListener(type: string, ecouteur: Ecouteur): void {
    this.ecouteurs.set(type, [...(this.ecouteurs.get(type) ?? []), ecouteur]);
  }
  removeEventListener(): void {}
  getBoundingClientRect(): { left: number; top: number; right: number; bottom: number; width: number; height: number } {
    return { left: 10, top: 20, right: 110, bottom: 120, width: 100, height: 100 };
  }
  emettre(type: string, evenement: Record<string, unknown> = {}): void {
    for (const ecouteur of this.ecouteurs.get(type) ?? []) ecouteur({ preventDefault: () => {}, stopPropagation: () => {}, ...evenement });
  }
}

/** Axe du faux graphe : 1 px vaut 10 de prix ; le pane des prix commence à la racine du graphe. */
const yDe = (prix: number): number => (100_000 - prix) / 10;
const rubanFort = (couleur: "--up" | "--down", bas: number, haut: number): RubanAnnotation => ({ deIdx: 0, hauts: [haut, haut], bas: [bas, bas], couleur, alpha: 0.12, info: "zone" });
const ZONES: AnnotationsIndicateur = { rubans: [rubanFort("--up", 75626.55, 76601.83), rubanFort("--down", 85314.76, 86430.38)] };

function fauxGraphe(cloture: number): Chart {
  return {
    getSize: () => ({ top: 0, left: 0, width: 800, height: 5000 }),
    getIndicatorByPaneId: (paneId: string, name: string) =>
      paneId === "candle_pane" && name === axiomName("sr-1") ? { extendData: { series: {}, annotations: ZONES } } : null,
    getDataList: () => [{ close: 1 }, { close: cloture }],
    convertToPixel: ({ value }: { value: number }) => ({ y: yDe(value) }),
    convertFromPixel: ([point]: Array<{ x: number; y: number }>) => [{ dataIndex: 1, value: 100_000 - point!.y * 10 }],
  } as unknown as Chart;
}

describe("menu du clic droit — alerte de prix au bord d'une zone forte", () => {
  const AUJOURDHUI = new Date(2026, 9, 31, 12);
  let corps: FauxElement;
  let racine: FauxElement;
  let marche: PriceAlertMarket;
  let lignes: LigneAccrochable[];
  let delier: () => void;

  const menu = (): FauxElement | undefined => corps.children.find((c) => c.id === "axiom-price-alert-menu");
  /** Ouvre le menu par un clic droit au prix donné (coordonnées client : la racine du graphe est à 10, 20). */
  const clicDroit = (prix: number): FauxElement => {
    racine.emettre("contextmenu", { clientX: 10 + 400, clientY: 20 + yDe(prix) });
    return menu()!;
  };
  const lier = (cloture = 77582.02): void => {
    delier?.();
    delier = bindPriceAlertMenu(fauxGraphe(cloture), racine as unknown as HTMLElement, () => marche, () => lignes);
  };
  const entrees = (m: FauxElement) => m.children.map((c) => ({ balise: c.tagName, role: c.getAttribute("role"), texte: c.textContent }));
  const habituelles = (niveau: number) => itemsMenuAlertePrix(niveau).map((i) => ({ balise: "button", role: "menuitem", texte: i.label }));

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AUJOURDHUI);
    corps = new FauxElement("body");
    racine = new FauxElement("div");
    marche = { symbol: "BTCUSDT", source: "binance", timeframe: "4h", rejeu: false };
    lignes = [];
    vi.stubGlobal("document", {
      createElement: (tag: string) => new FauxElement(tag),
      body: corps,
      getElementById: (id: string) => corps.children.find((c) => c.id === id) ?? null,
    });
    vi.stubGlobal("window", { innerWidth: 1440, innerHeight: 9000, addEventListener: () => {}, removeEventListener: () => {} });
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    alertsStore.setState({ defs: [], journal: [] });
    toastsStore.setState({ toasts: [] });
    indicatorsStore.setState({ indicators: [{ instanceId: "sr-1", defId: "stratAxisSr", params: {}, couleurIdx: 0 }] });
    lier();
  });
  afterEach(() => {
    delier();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    alertsStore.setState({ defs: [], journal: [] });
    toastsStore.setState({ toasts: [] });
    indicatorsStore.setState({ indicators: [] });
  });

  it("hors de toute bande forte : le menu d'origine, en-tête puis trois entrées, sans bloc de zone", () => {
    const m = clicDroit(80_000);
    expect(entrees(m)).toEqual([{ balise: "div", role: null, texte: "Prix 80,000.00" }, ...habituelles(80_000)]);
    expect(m.children.some((c) => c.attributs.has("data-alerte-zone"))).toBe(false);
  });

  it("dans la bande du support fort : l'offre s'ajoute sous l'en-tête, qui reste le premier div ; les trois entrées au prix du clic restent dessous", () => {
    const m = clicDroit(76_000);
    expect(entrees(m)).toEqual([
      { balise: "div", role: null, texte: "Prix 76,000.00" },
      { balise: "button", role: "menuitem", texte: "Alerte de prix ↓ 76,601.83 · bord du support fort · niveau fixe, 7 jours" },
      ...habituelles(76_000),
    ]);
    const offre = m.children[1]!;
    expect(offre.getAttribute("data-alerte-zone")).toBe("offre");
    expect(offre.getAttribute("aria-disabled")).toBeNull();
    // La ligne de l'offre revient à la ligne dans un menu borné en largeur ; un filet la sépare.
    expect(offre.style.cssText).toContain("white-space:normal");
    expect(offre.style.cssText).toContain("border-bottom:1px solid var(--border)");
    expect(m.style.cssText).toContain("max-width:26rem");
    // Premier `div` du menu : l'en-tête (lu par `e2e/niveaux-chart.e2e.ts`).
    expect(m.children.find((c) => c.tagName === "div")?.textContent).toBe("Prix 76,000.00");
  });

  it("dans la bande d'une résistance forte : « ↑ », bas de la zone", () => {
    expect(clicDroit(86_000).children[1]?.textContent).toBe("Alerte de prix ↑ 85,314.76 · bord de la résistance forte · niveau fixe, 7 jours");
  });

  it("clic sur l'offre : UNE alerte au bord, à niveau fixe, qui expire dans 7 jours ; le menu se ferme, l'avis de pose paraît", () => {
    clicDroit(76_000).children[1]!.emettre("click");
    expect(menu()).toBeUndefined();
    const { defs } = alertsStore.getState();
    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatchObject({
      symbol: "BTCUSDT",
      source: "binance",
      condition: { type: "prix-croise", niveau: 76601.83, sens: "baisse" },
      message: "≤ 76,601.83 · bord du support fort AXIS S/R 4h du 31/10 · niveau fixe, zone mobile",
      expireTs: AUJOURDHUI.getTime() + 7 * 24 * 3_600_000,
    });
    expect(toastsStore.getState().toasts.map((t) => [t.texte, t.action?.libelle])).toEqual([
      ["Alerte de prix posée : BTCUSDT ↓ 76,601.83 · niveau fixe · expire dans 7 jours · sonne application ouverte seulement", "Annuler"],
    ]);
  });

  it("second clic droit au même endroit : « déjà posée », grisée et sans effet ; les trois entrées gardent leur comportement", () => {
    clicDroit(76_000).children[1]!.emettre("click");
    const m = clicDroit(76_000);
    expect(entrees(m)).toEqual([
      { balise: "div", role: null, texte: "Prix 76,000.00" },
      { balise: "div", role: null, texte: "Alerte déjà posée ↓ 76,601.83 · bord du support fort" },
      ...habituelles(76_000),
    ]);
    const posee = m.children[1]!;
    expect(posee.getAttribute("data-alerte-zone")).toBe("posee");
    expect(posee.getAttribute("aria-disabled")).toBe("true");
    expect(posee.style.cssText).toContain("color:var(--text-dim)");
    expect(posee.ecouteurs.size).toBe(0);
    // L'en-tête est toujours le PREMIER div.
    expect(m.children.find((c) => c.tagName === "div")?.textContent).toBe("Prix 76,000.00");
    // Entrée habituelle « ↑ » : alerte au prix du clic, sans échéance ni message, comme avant.
    m.children[2]!.emettre("click");
    expect(menu()).toBeUndefined();
    expect(alertsStore.getState().defs).toHaveLength(2);
    const habituelle = alertsStore.getState().defs[1]!;
    expect(habituelle.condition).toEqual({ type: "prix-croise", niveau: 76_000, sens: "hausse" });
    expect(habituelle.message).toBeUndefined();
    expect(habituelle.expireTs).toBeUndefined();
  });

  it("cours déjà dans la zone : « pas d'alerte », grisée, et rien n'est créé", () => {
    lier(76_000);
    const m = clicDroit(76_300);
    expect(entrees(m)[1]).toEqual({ balise: "div", role: null, texte: "Pas d'alerte : le cours a déjà franchi le bord du support fort (76,601.83)" });
    expect(m.children[1]?.getAttribute("data-alerte-zone")).toBe("franchi");
    expect(m.children[1]?.getAttribute("aria-disabled")).toBe("true");
    m.children[1]!.emettre("click");
    expect(alertsStore.getState().defs).toEqual([]);
  });

  it("à 6 px de la bande : l'offre ; à 7 px : le menu d'origine", () => {
    expect(clicDroit(76601.83 + 60).children[1]?.getAttribute("data-alerte-zone")).toBe("offre");
    expect(entrees(clicDroit(76601.83 + 70))).toEqual([{ balise: "div", role: null, texte: "Prix 76,671.83" }, ...habituelles(76671.83)]);
  });

  it("en rejeu : aucune offre, même dans une bande forte", () => {
    marche = { ...marche, rejeu: true };
    expect(entrees(clicDroit(76_000))).toEqual([{ balise: "div", role: null, texte: "Prix 76,000.00" }, ...habituelles(76_000)]);
  });

  it("sans AXIS S/R affiché : aucune offre", () => {
    indicatorsStore.setState({ indicators: [] });
    expect(entrees(clicDroit(76_000))).toEqual([{ balise: "div", role: null, texte: "Prix 76,000.00" }, ...habituelles(76_000)]);
  });

  it("ligne de niveau accrochée dans la bande : l'en-tête et les trois entrées suivent la ligne, l'offre de zone reste entre les deux", () => {
    lignes = [{ price: 76_050, label: "PDH" }];
    const m = clicDroit(76_000);
    expect(entrees(m)).toEqual([
      { balise: "div", role: null, texte: "PDH · Prix 76,050.00" },
      { balise: "button", role: "menuitem", texte: "Alerte de prix ↓ 76,601.83 · bord du support fort · niveau fixe, 7 jours" },
      ...habituelles(76_050),
    ]);
  });
});
