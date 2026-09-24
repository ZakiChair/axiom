/**
 * Badge de statut des légendes DOM (en-têtes de panes séparés ET légende des overlays) :
 * un indicateur qui ne trace rien doit le DIRE, raison comprise, au lieu d'un pane muet.
 * Rendu vérifié sur un DOM minimal (pas de jsdom dans le dépôt) : seul `document.createElement`
 * est simulé ; le contrôleur d'indicateurs, le canal de statuts et les légendes sont réels.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Chart } from "klinecharts";
import type { Candle } from "@axiom/types";
import { indicatorsStore, type ActiveIndicator } from "../store/indicators";
import { ChartIndicators } from "./indicators";
import { PaneHeaders, presentationStatut } from "./paneHeaders";
import { OverlayLegend } from "./overlayLegend";

vi.mock("klinecharts", () => ({
  registerIndicator: () => {},
  registerOverlay: () => {},
  IndicatorSeries: { Normal: "normal", Price: "price", Volume: "volume" },
  ActionType: { OnPaneDrag: "onPaneDrag", OnDataReady: "onDataReady" },
  DomPosition: { Main: "main" },
}));

/** Élément DOM minimal : arbre, attributs, texte, `querySelector("[data-role=…]")`. */
class FauxElement {
  children: FauxElement[] = [];
  parent: FauxElement | null = null;
  readonly attributs = new Map<string, string>();
  readonly style: Record<string, string> = {};
  className = "";
  title = "";
  type = "";
  offsetWidth = 40;
  offsetHeight = 14;
  private texte = "";
  constructor(readonly tagName: string) {}
  get textContent(): string {
    return this.children.length > 0 ? this.children.map((c) => c.textContent).join("") : this.texte;
  }
  set textContent(v: string) {
    this.texte = v;
    this.children = [];
  }
  setAttribute(k: string, v: string): void {
    this.attributs.set(k, String(v));
  }
  getAttribute(k: string): string | null {
    return this.attributs.get(k) ?? null;
  }
  append(...noeuds: FauxElement[]): void {
    for (const n of noeuds) {
      n.remove();
      n.parent = this;
      this.children.push(n);
    }
  }
  appendChild(n: FauxElement): FauxElement {
    this.append(n);
    return n;
  }
  after(n: FauxElement): void {
    const p = this.parent;
    if (!p) return;
    n.remove();
    n.parent = p;
    p.children.splice(p.children.indexOf(this) + 1, 0, n);
  }
  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  addEventListener(): void {}
  getBoundingClientRect() {
    return { top: 0, left: 0, width: 800, height: 400 };
  }
  querySelector(selecteur: string): FauxElement | null {
    const role = /^\[data-role=([\w-]+)\]$/.exec(selecteur)?.[1];
    for (const c of this.children) {
      if (role !== undefined && c.getAttribute("data-role") === role) return c;
      const trouve = c.querySelector(selecteur);
      if (trouve) return trouve;
    }
    return null;
  }
}

function monter() {
  const chart = {
    createIndicator: vi.fn((_c: unknown, _s: boolean, options?: { id: string }) => options?.id ?? "candle_pane"),
    overrideIndicator: vi.fn(),
    removeIndicator: vi.fn(),
    setPaneOptions: vi.fn(),
    setCustomApi: vi.fn(),
    subscribeAction: vi.fn(),
    unsubscribeAction: vi.fn(),
    getSize: () => ({ top: 0, left: 0, width: 800, height: 100, right: 800, bottom: 100 }),
  };
  const kline = chart as unknown as Chart;
  const conteneur = new FauxElement("div");
  return {
    kline,
    conteneur,
    indicators: new ChartIndicators(kline),
    enTetes: new PaneHeaders(kline, conteneur as unknown as HTMLElement),
    legende: new OverlayLegend(kline, conteneur as unknown as HTMLElement),
  };
}

function bougies(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const close = 100 - i * 0.5;
    return { time: i * 3_600_000, open: close, high: close + 1, low: close - 1, close, volume: 10, buyVolume: 7, sellVolume: 3 };
  });
}

const piege: ActiveIndicator = { instanceId: "tv-1", defId: "trappedVolume", params: { length: 96 }, couleurIdx: 0 };
const vwma: ActiveIndicator = { instanceId: "vwma-1", defId: "vwma", params: { length: 20 }, couleurIdx: 1 };

/** Ligne de légende d'une instance : celle qui porte son libellé. */
function ligne(conteneur: FauxElement, libelle: string): FauxElement {
  const el = conteneur.children.find((c) => c.querySelector("[data-role=label]")?.textContent.startsWith(libelle));
  if (!el) throw new Error(`ligne introuvable : ${libelle}`);
  return el;
}

beforeEach(() => {
  vi.stubGlobal("document", { createElement: (tag: string) => new FauxElement(tag) });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  indicatorsStore.setState({ indicators: [] });
});

describe("presentationStatut", () => {
  it("UNUSABLE pour un contexte incompatible, « indisponible » pour un résultat vide", () => {
    expect(presentationStatut(null)).toBeNull();
    expect(presentationStatut({ etat: "unusable", raison: "Binance seulement" })).toEqual({
      badge: "UNUSABLE",
      raison: "Binance seulement",
    });
    expect(presentationStatut({ etat: "vide", raison: "Historique insuffisant : 74 bougies, horizon 96" })).toEqual({
      badge: "indisponible",
      raison: "Historique insuffisant : 74 bougies, horizon 96",
    });
  });
});

describe("en-tête de pane séparé — badge de statut", () => {
  it("affiche la raison, suit chaque recalcul et disparaît quand les valeurs reviennent", () => {
    const { conteneur, indicators, enTetes } = monter();
    indicatorsStore.setState({ indicators: [piege] });
    enTetes.sync();
    const el = ligne(conteneur, "Volume piégé");
    expect(el.querySelector("[data-role=statut]")).toBeNull();

    // Source sans split taker (OKX) : rien n'est tracé, l'en-tête le dit.
    indicators.setMarket("BTCUSDT", "15m");
    indicators.sync([piege], bougies(120), "okx");
    const statut = el.querySelector("[data-role=statut]");
    const raison = "Volumes acheteur/vendeur historiques complets disponibles uniquement sur Binance";
    expect(statut?.title).toBe(raison);
    expect(statut?.querySelector("[data-role=statut-badge]")?.textContent).toBe("UNUSABLE");
    expect(statut?.querySelector("[data-role=statut-raison]")?.textContent).toBe(raison);
    // Placé juste après le libellé, avant ⚙ / ✕.
    const roles = el.children.map((c) => c.getAttribute("data-role"));
    expect(roles.indexOf("statut")).toBe(roles.indexOf("label") + 1);

    // 1M sur Binance, 74 bougies pour un horizon de 96.
    indicators.setMarket("SOLUSDT", "1M");
    indicators.sync([piege], bougies(74), "binance", true);
    expect(el.querySelector("[data-role=statut-badge]")?.textContent).toBe("indisponible");
    expect(el.querySelector("[data-role=statut]")?.title).toBe("Historique insuffisant : 74 bougies, horizon 96");

    // Historique suffisant : plus de badge.
    indicators.recompute([piege], bougies(110), "binance");
    expect(el.querySelector("[data-role=statut]")).toBeNull();
  });

  it("un en-tête créé APRÈS la publication reprend le statut courant ; dispose se désabonne", () => {
    const { kline, conteneur, indicators, enTetes } = monter();
    indicators.setMarket("BTCUSDT", "15m");
    indicators.sync([piege], bougies(120), "kraken");
    indicatorsStore.setState({ indicators: [piege] });
    enTetes.sync();
    expect(ligne(conteneur, "Volume piégé").querySelector("[data-role=statut-badge]")?.textContent).toBe("UNUSABLE");

    enTetes.dispose();
    expect(kline.unsubscribeAction).toHaveBeenCalled();
    expect(() => indicators.sync([piege], bougies(120), "binance", true)).not.toThrow();
  });
});

describe("légende des overlays — badge de statut", () => {
  it("un overlay UNUSABLE (volume forex Twelve Data) porte sa raison", () => {
    const { conteneur, indicators, legende } = monter();
    indicatorsStore.setState({ indicators: [vwma] });
    legende.sync();
    indicators.setMarket("EUR/USD", "1h");
    indicators.sync([vwma], bougies(60), "twelvedata");
    const statut = ligne(conteneur, "VWMA").querySelector("[data-role=statut]");
    expect(statut?.querySelector("[data-role=statut-badge]")?.textContent).toBe("UNUSABLE");
    expect(statut?.title).toBe("Twelve Data ne fournit pas de volume pour le forex");
  });
});
