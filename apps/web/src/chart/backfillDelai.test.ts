/**
 * Chien de garde du backfill REST initial (gate G1).
 *
 * Sans délai, un `fetchKlines` qui ne répond jamais (réveil de veille, TCP
 * semi-ouvert, stall pendant un changement de symbole) laisse le slot bloqué sur
 * « Chargement des bougies… » indéfiniment. `avecDelai` borne l'attente et
 * rejette avec un message qui emprunte le `catch` existant → `failDataLoad`
 * → bouton « Réessayer ».
 *
 * NOTE environnement : `ChartInstance.tsx` est un module d'application (node sans
 * DOM ici). Son graphe d'import touche `document` (store/theme) et enregistre des
 * overlays klinecharts dès l'import — d'où le stub DOM hoisté et le mock du bundle
 * (inerte hors navigateur, cf. `indicators.throttle.test.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const noop = (): void => {};
  const faireElement = (): Record<string, unknown> => ({
    style: {},
    classList: { add: noop, remove: noop, contains: () => false, toggle: noop },
    setAttribute: noop,
    getAttribute: () => null,
    removeAttribute: noop,
    appendChild: noop,
    removeChild: noop,
    addEventListener: noop,
    removeEventListener: noop,
    getContext: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  });
  const g = globalThis as Record<string, unknown>;
  g.document = {
    documentElement: faireElement(),
    body: faireElement(),
    head: faireElement(),
    createElement: faireElement,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    removeEventListener: noop,
  };
  g.window = globalThis;
  g.matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop });
  g.requestAnimationFrame = () => 1;
  g.cancelAnimationFrame = noop;
  g.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

// Le bundle réel n'expose rien d'utilisable sous node (index.cjs délègue à l'UMD) :
// on stube la surface consommée par le graphe d'import de ChartInstance.
vi.mock("klinecharts", () => ({
  init: () => null,
  dispose: () => {},
  registerIndicator: () => {},
  registerOverlay: () => {},
  ActionType: {
    OnCrosshairChange: "onCrosshairChange",
    OnDataReady: "onDataReady",
    OnPaneDrag: "onPaneDrag",
    OnScroll: "onScroll",
    OnVisibleRangeChange: "onVisibleRangeChange",
    OnZoom: "onZoom",
  },
  DomPosition: { Main: "main", Root: "root", YAxis: "yAxis" },
  IndicatorSeries: { Normal: "normal", Price: "price", Volume: "volume" },
  LoadDataType: { Forward: "forward", Backward: "backward", Init: "init" },
  TooltipShowRule: { Always: "always", None: "none", FollowCross: "follow_cross" },
  YAxisType: { Normal: "normal", Log: "log", Percentage: "percentage" },
  OverlayFigureIgnoreEventType: { None: "none" },
  PolygonType: { Fill: "fill", Stroke: "stroke" },
  LineType: { Solid: "solid", Dashed: "dashed" },
}));

import type { Candle } from "@axiom/types";
import { avecDelai, BACKFILL_TIMEOUT_MS, delaiEssaiMs } from "./ChartInstance";
import { chargerAvecRepli, type MarcheCharge } from "./routageMarche";
import { resolveMarketCandidates, type MarketCatalog } from "../data/marketRouting";

describe("avecDelai (chien de garde du backfill)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejette après le délai quand le travail ne répond jamais", async () => {
    const jamais = new Promise<string>(() => {});
    const { promesse } = avecDelai(jamais, BACKFILL_TIMEOUT_MS);
    const attendu = expect(promesse).rejects.toThrow(/délai/i);

    await vi.advanceTimersByTimeAsync(BACKFILL_TIMEOUT_MS);
    await attendu;
  });

  it("le délai vaut 20 s", () => {
    expect(BACKFILL_TIMEOUT_MS).toBe(20_000);
  });

  it("le message de rejet est mappé sur le libellé de timeout existant", async () => {
    const jamais = new Promise<string>(() => {});
    const { promesse } = avecDelai(jamais, 20_000);
    const capture = promesse.catch((err: unknown) => err);

    await vi.advanceTimersByTimeAsync(20_000);
    const err = await capture;
    // Le mapping de ChartInstance teste /timeout|timed out|délai/i.
    expect(err).toBeInstanceOf(Error);
    expect(/timeout|timed out|délai/i.test((err as Error).message)).toBe(true);
  });

  it("nettoie le minuteur au succès (aucun minuteur en attente)", async () => {
    const { promesse } = avecDelai(Promise.resolve("ok"), 20_000);
    await expect(promesse).resolves.toBe("ok");
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("nettoie le minuteur à l'échec du travail", async () => {
    const { promesse } = avecDelai(Promise.reject(new Error("réseau")), 20_000);
    await expect(promesse).rejects.toThrow("réseau");
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("`annuler` coupe le minuteur au démontage (le travail en cours ne rejette jamais)", async () => {
    const jamais = new Promise<string>(() => {});
    const { promesse, annuler } = avecDelai(jamais, 20_000);
    let rejete = false;
    promesse.catch(() => {
      rejete = true;
    });

    annuler();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(rejete).toBe(false);
  });
});

/**
 * Provenance restaurée sur un hôte entièrement muet (catalogue ET bougies) : son catalogue a
 * échoué, elle garde la tête en essai spéculatif. Rien ne mémorise l'échec de ses bougies :
 * sans borne propre, chaque ouverture (et chaque clic de favori) attendait les 20 s du chien de
 * garde avant la place confirmée suivante.
 */
describe("essai spéculatif d'une provenance restaurée (hôte muet)", () => {
  const bougie: Candle = { time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 };
  // CARDSUSDT enregistré sur OKX ; catalogue OKX en échec, MEXC cote l'actif.
  const catalogue: MarketCatalog = { instruments: [{ exchange: "mexc", symbol: "CARDSUSDT", kind: "spot" }], unavailableSources: ["okx"] };

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  /** Ouverture comme le backfill du graphe : chaque essai sous son chien de garde. */
  async function ouvrir(okxMuet: boolean): Promise<{ resultat: () => MarcheCharge | null | undefined; debut: number; fin: () => number | undefined }> {
    const candidats = await resolveMarketCandidates({ exchange: "okx", symbol: "CARDSUSDT", timeframe: "1h" }, catalogue);
    expect(candidats.map((c) => `${c.exchange}${c.speculative ? "?" : ""}`)).toEqual(["okx?", "mexc"]);
    const debut = Date.now();
    let resultat: MarcheCharge | null | undefined;
    let fin: number | undefined;
    void chargerAvecRepli(candidats, (identity) => avecDelai(
      identity.exchange === "okx" && okxMuet ? new Promise<Candle[]>(() => {}) : Promise.resolve([bougie]),
      delaiEssaiMs(identity),
    ).promesse, () => false).then((r) => { resultat = r; fin = Date.now(); });
    return { resultat: () => resultat, debut, fin: () => fin };
  }

  it("hôte muet : la provenance est abandonnée à 4 s, la place confirmée s'ouvre aussitôt", async () => {
    const { resultat, debut, fin } = await ouvrir(true);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(resultat()?.identity.exchange).toBe("mexc");
    expect((fin() ?? Infinity) - debut).toBe(4_000);
  });

  it("catalogue seul muet : la provenance répond et reste la source", async () => {
    const { resultat, debut, fin } = await ouvrir(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(resultat()?.identity).toEqual({ exchange: "okx", symbol: "CARDSUSDT", timeframe: "1h", speculative: true });
    expect(fin()).toBe(debut);
  });

  it("un candidat confirmé garde les 20 s du backfill", () => {
    expect(delaiEssaiMs({})).toBe(BACKFILL_TIMEOUT_MS);
    expect(delaiEssaiMs({ speculative: true })).toBe(4_000);
  });
});
