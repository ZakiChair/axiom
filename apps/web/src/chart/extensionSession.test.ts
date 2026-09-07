/**
 * Extension du backfill aux sessions UTC ENTIÈRES (constat « VWAP et pivots
 * lisent une session tronquée »).
 *
 * Le backfill initial est borné à 500 bougies : en 1 min il démarre en milieu
 * de journée, donc la VWAP s'ancre au mauvais endroit et les pivots lisent une
 * veille tronquée. Ces deux fonctions PURES décident jusqu'où remonter et de
 * combien de bougies par page — et surtout : elles ne demandent RIEN quand
 * aucune définition sessionnée n'est active.
 *
 * NOTE environnement : même préambule que `backfillDelai.test.ts` — le graphe
 * d'import de `ChartInstance.tsx` touche `document` et enregistre des overlays
 * klinecharts dès l'import.
 */
import { describe, expect, it, vi } from "vitest";

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
import {
  bougiesAvantBuffer,
  cibleSessionUTC,
  creerOrdonnanceurExtension,
  doitEtendreSession,
  doitSignalerLimiteKraken,
  etendreSessionJusqua,
  limitePageSession,
  MESSAGE_LIMITE_KRAKEN,
  pasBougiesMs,
} from "./ChartInstance";

const JOUR_MS = 86_400_000;
const HEURE_MS = 3_600_000;
const MINUTE_MS = 60_000;

// Dernière bougie : jour UTC 20000, 13:59.
const DERNIER = 20_000 * JOUR_MS + 13 * HEURE_MS + 59 * MINUTE_MS;

describe("cibleSessionUTC", () => {
  it("aucune définition sessionnée active -> undefined (coût réseau inchangé)", () => {
    expect(cibleSessionUTC([], DERNIER)).toBeUndefined();
    expect(cibleSessionUTC(["rsi", "ema", "macd"], DERNIER)).toBeUndefined();
  });

  it("VWAP seule -> minuit UTC du jour COURANT", () => {
    expect(cibleSessionUTC(["vwap"], DERNIER)).toBe(20_000 * JOUR_MS);
    expect(cibleSessionUTC(["vwapBands"], DERNIER)).toBe(20_000 * JOUR_MS);
  });

  it("pivots -> minuit UTC de la VEILLE (la veille doit être entière)", () => {
    for (const id of ["pivotStandard", "pivotCamarilla", "pivotDemark", "pivotFibonacci", "pivotWoodie"]) {
      expect(cibleSessionUTC([id], DERNIER)).toBe(19_999 * JOUR_MS);
    }
  });

  it("prend la profondeur MAXIMALE quand VWAP et pivots coexistent", () => {
    expect(cibleSessionUTC(["vwap", "rsi", "pivotWoodie"], DERNIER)).toBe(19_999 * JOUR_MS);
  });
});

describe("limitePageSession", () => {
  it("0 quand le buffer couvre déjà la cible (rien à demander)", () => {
    expect(limitePageSession(20_000 * JOUR_MS, 20_000 * JOUR_MS, MINUTE_MS, 500)).toBe(0);
    expect(limitePageSession(20_000 * JOUR_MS + 1, 20_000 * JOUR_MS + 5, MINUTE_MS, 500)).toBe(0);
  });

  it("plafonne à la taille de page tant que le manque la dépasse", () => {
    // Buffer démarrant à 20:00 UTC : 20 h manquantes en 1 min = 1200 bougies > page.
    expect(limitePageSession(20_000 * JOUR_MS + 20 * HEURE_MS, 20_000 * JOUR_MS, MINUTE_MS, 500)).toBe(500);
  });

  it("ROGNE la dernière page au strict nécessaire (jamais plus que la cible)", () => {
    const premier = 20_000 * JOUR_MS + 5 * HEURE_MS + 40 * MINUTE_MS; // 05:40 UTC
    expect(limitePageSession(premier, 20_000 * JOUR_MS, MINUTE_MS, 500)).toBe(340);
    // En 5 min, la même profondeur ne coûte que 68 bougies.
    expect(limitePageSession(premier, 20_000 * JOUR_MS, 5 * MINUTE_MS, 500)).toBe(68);
  });

  it("timeframe non résolu (0 ms) -> 0, jamais de division par zéro", () => {
    expect(limitePageSession(DERNIER, 20_000 * JOUR_MS, 0, 500)).toBe(0);
  });
});

const bougie = (time: number): Candle => ({ time, open: 1, high: 1, low: 1, close: 1, volume: 0 });

describe("pasBougiesMs", () => {

  it("mesure le pas réel du buffer (500 bougies 1 min)", () => {
    const buffer = Array.from({ length: 500 }, (_, i) => bougie(DERNIER - (499 - i) * MINUTE_MS));
    expect(pasBougiesMs(buffer)).toBe(MINUTE_MS);
  });

  it("0 quand le buffer n'a pas deux bougies (pas mesurable)", () => {
    expect(pasBougiesMs([])).toBe(0);
    expect(pasBougiesMs([bougie(DERNIER)])).toBe(0);
  });
});

describe("doitEtendreSession — ajout à chaud", () => {
  const premier = 20_000 * JOUR_MS + 5 * HEURE_MS + 41 * MINUTE_MS;
  const dernier = premier + 499 * MINUTE_MS;

  it("ne demande rien tant qu'aucune définition sessionnée n'est active", () => {
    expect(doitEtendreSession([], premier, dernier)).toBe(false);
    expect(doitEtendreSession(["rsi", "ema"], premier, dernier)).toBe(false);
  });

  it("500 bougies depuis 05:41 UTC + VWAP → il manque 341 bougies jusqu'à minuit (841 au total)", () => {
    expect(doitEtendreSession(["vwap"], premier, dernier)).toBe(true);
    const cible = cibleSessionUTC(["vwap"], dernier);
    expect(cible).toBe(20_000 * JOUR_MS);
    expect(limitePageSession(premier, cible!, MINUTE_MS, 500)).toBe(341);
    expect(500 + 341).toBe(841);
  });

  it("idempotent : buffer déjà depuis minuit → zéro extension", () => {
    const minuit = 20_000 * JOUR_MS;
    expect(doitEtendreSession(["vwap"], minuit, minuit + 840 * MINUTE_MS)).toBe(false);
  });

  it("l'ajout de pivots après VWAP augmente la profondeur (veille entière)", () => {
    const minuit = 20_000 * JOUR_MS;
    const fin = minuit + 840 * MINUTE_MS;
    expect(doitEtendreSession(["vwap"], minuit, fin)).toBe(false);
    expect(doitEtendreSession(["vwap", "pivotStandard"], minuit, fin)).toBe(true);
    expect(cibleSessionUTC(["vwap", "pivotStandard"], fin)).toBe(19_999 * JOUR_MS);
  });
});

describe("etendreSessionJusqua", () => {
  it("n'ajoute pas deux fois les bougies d'une réponse chevauchant le buffer actuel", () => {
    const bougie = (time: number): Candle => ({ time, open: 100, high: 100, low: 100, close: 100, volume: 1, closed: false });
    const page = [0, 1, 2, 3].map(bougie);
    const actuel = [2, 3, 4].map(bougie);
    const nouvelles = bougiesAvantBuffer(page, actuel, 4);
    expect(nouvelles.map((c) => c.time)).toEqual([0, 1]);
    expect(nouvelles.every((c) => c.closed === true)).toBe(true);
    expect(page[0]?.closed).toBe(false); // le cache source n'est pas muté
    const complet = [...nouvelles, ...actuel];
    expect(complet.map((c) => c.time)).toEqual([0, 1, 2, 3, 4]);
    expect(bougiesAvantBuffer(page, complet, 4)).toEqual([]);
  });

  it("une page vide sans progression concurrente termine l'extension", async () => {
    const charger = vi.fn(async () => 0);
    await etendreSessionJusqua({
      cible: 0, tfMs: MINUTE_MS, limitePage: 6,
      lirePremierTime: () => 12 * MINUTE_MS, chargerPlusAncien: charger,
    });
    expect(charger).toHaveBeenCalledTimes(1);
  });

  it("continue si une pagination concurrente a déjà ajouté la page reçue", async () => {
    let tete = 12 * MINUTE_MS;
    let appels = 0;
    await etendreSessionJusqua({
      cible: 0,
      tfMs: MINUTE_MS,
      limitePage: 6,
      lirePremierTime: () => tete,
      chargerPlusAncien: async (_avant, limit) => {
        appels += 1;
        tete -= limit * MINUTE_MS;
        // Premier retour : le scroll a préfixé exactement cette page avant l'extension.
        return appels === 1 ? 0 : limit;
      },
    });
    expect(tete).toBe(0);
    expect(appels).toBe(2);
  });

  it("n'appelle pas le réseau si le buffer couvre déjà la cible", async () => {
    const charger = vi.fn(async () => 0);
    const pages = await etendreSessionJusqua({
      cible: 20_000 * JOUR_MS,
      tfMs: MINUTE_MS,
      limitePage: 500,
      lirePremierTime: () => 20_000 * JOUR_MS,
      chargerPlusAncien: charger,
    });
    expect(pages).toBe(0);
    expect(charger).not.toHaveBeenCalled();
  });

  it("demande une seule page de 341 bougies depuis 05:41, puis s'arrête (idempotent)", async () => {
    const minuit = 20_000 * JOUR_MS;
    let tete = minuit + 5 * HEURE_MS + 41 * MINUTE_MS;
    const limits: number[] = [];
    const pages = await etendreSessionJusqua({
      cible: minuit,
      tfMs: MINUTE_MS,
      limitePage: 500,
      lirePremierTime: () => tete,
      chargerPlusAncien: async (_avant, limit) => {
        limits.push(limit);
        tete = minuit;
        return limit;
      },
    });
    expect(pages).toBe(1);
    expect(limits).toEqual([341]);
    const encore = await etendreSessionJusqua({
      cible: minuit,
      tfMs: MINUTE_MS,
      limitePage: 500,
      lirePremierTime: () => tete,
      chargerPlusAncien: async () => {
        throw new Error("aucune requête attendue");
      },
    });
    expect(encore).toBe(0);
  });

  it("s'arrête si l'identité/révision a changé (estAnnule)", async () => {
    const charger = vi.fn(async () => 10);
    const pages = await etendreSessionJusqua({
      cible: 0,
      tfMs: MINUTE_MS,
      limitePage: 500,
      lirePremierTime: () => 10 * MINUTE_MS,
      chargerPlusAncien: charger,
      estAnnule: () => true,
    });
    expect(pages).toBe(0);
    expect(charger).not.toHaveBeenCalled();
  });

  it("arrête entre deux pages si la révision change en cours", async () => {
    let tete = 10 * MINUTE_MS;
    let annule = false;
    const limits: number[] = [];
    const pages = await etendreSessionJusqua({
      cible: 0,
      tfMs: MINUTE_MS,
      limitePage: 5,
      lirePremierTime: () => tete,
      chargerPlusAncien: async (_avant, limit) => {
        limits.push(limit);
        tete -= limit * MINUTE_MS;
        annule = true;
        return limit;
      },
      estAnnule: () => annule,
    });
    expect(pages).toBe(1);
    expect(limits).toHaveLength(1);
  });
});

describe("creerOrdonnanceurExtension — file d'attente et gardes", () => {
  it("n'exécute pas tant que le buffer n'est pas prêt (identité/révision)", async () => {
    const executer = vi.fn(async () => {});
    const { demander } = creerOrdonnanceurExtension({
      estAnnule: () => false,
      peutLancer: () => false,
      executer,
    });
    demander();
    await Promise.resolve();
    expect(executer).not.toHaveBeenCalled();
  });

  it("file d'attente : un second demander pendant l'exécution relance après", async () => {
    let debloque!: () => void;
    const gate = new Promise<void>((resolve) => {
      debloque = resolve;
    });
    let executions = 0;
    const { demander } = creerOrdonnanceurExtension({
      estAnnule: () => false,
      peutLancer: () => true,
      executer: async () => {
        executions += 1;
        if (executions === 1) await gate;
      },
    });
    demander();
    demander();
    expect(executions).toBe(1);
    debloque();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(executions).toBe(2);
  });

  it("n'enchaîne pas la file si l'identité/révision a changé pendant l'exécution", async () => {
    let annule = false;
    let debloque!: () => void;
    const gate = new Promise<void>((resolve) => {
      debloque = resolve;
    });
    const executer = vi.fn(async () => {
      await gate;
    });
    const { demander } = creerOrdonnanceurExtension({
      estAnnule: () => annule,
      peutLancer: () => !annule,
      executer,
    });
    demander();
    demander();
    expect(executer).toHaveBeenCalledTimes(1);
    annule = true;
    debloque();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(executer).toHaveBeenCalledTimes(1);
  });
});

describe("limite Kraken visible (PARTIAL)", () => {
  it("signale PARTIAL seulement quand Kraken ne peut plus paginer", () => {
    expect(doitSignalerLimiteKraken("kraken", 500, 0)).toBe(true);
    expect(doitSignalerLimiteKraken("kraken", 500, 220)).toBe(false);
    expect(doitSignalerLimiteKraken("binance", 500, 0)).toBe(false);
    expect(MESSAGE_LIMITE_KRAKEN).toMatch(/720/);
  });
});
