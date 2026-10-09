/**
 * Extension du backfill aux sessions UTC ENTIÈRES (constat « VWAP et pivots
 * lisent une session tronquée ») et aux AMORCES longues (constat « AXIS sur
 * 500 bougies diffère de la série longue mesurée », 9 octobre 2026).
 *
 * Le backfill initial est borné à 500 bougies : en 1 min il démarre en milieu
 * de journée, donc la VWAP s'ancre au mauvais endroit et les pivots lisent une
 * veille tronquée ; AXIS y rend des signaux faux ou manquants dans 60 % des
 * fenêtres (mesure sur 8 séries 4h), aucun à 1 500 bougies. Ces fonctions PURES
 * décident jusqu'où remonter et de combien de bougies par page — et surtout :
 * elles ne demandent RIEN quand aucune définition active ne l'exige.
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
import { getIndicator } from "@axiom/indicators";
import {
  amorceMinimale,
  bougiesAvantBuffer,
  cibleSessionUTC,
  creerOrdonnanceurExtension,
  doitEtendreHistorique,
  doitSignalerLimiteKraken,
  etendreSessionJusqua,
  limitePageAmorce,
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

describe("doitEtendreHistorique — ajout à chaud (sessions)", () => {
  const premier = 20_000 * JOUR_MS + 5 * HEURE_MS + 41 * MINUTE_MS;
  const dernier = premier + 499 * MINUTE_MS;

  it("ne demande rien tant qu'aucune définition sessionnée ou à amorce n'est active", () => {
    expect(doitEtendreHistorique([], premier, dernier, 500)).toBe(false);
    expect(doitEtendreHistorique(["rsi", "ema"], premier, dernier, 500)).toBe(false);
  });

  it("500 bougies depuis 05:41 UTC + VWAP → il manque 341 bougies jusqu'à minuit (841 au total)", () => {
    expect(doitEtendreHistorique(["vwap"], premier, dernier, 500)).toBe(true);
    const cible = cibleSessionUTC(["vwap"], dernier);
    expect(cible).toBe(20_000 * JOUR_MS);
    expect(limitePageSession(premier, cible!, MINUTE_MS, 500)).toBe(341);
    expect(500 + 341).toBe(841);
  });

  it("idempotent : buffer déjà depuis minuit → zéro extension", () => {
    const minuit = 20_000 * JOUR_MS;
    expect(doitEtendreHistorique(["vwap"], minuit, minuit + 840 * MINUTE_MS, 841)).toBe(false);
  });

  it("l'ajout de pivots après VWAP augmente la profondeur (veille entière)", () => {
    const minuit = 20_000 * JOUR_MS;
    const fin = minuit + 840 * MINUTE_MS;
    expect(doitEtendreHistorique(["vwap"], minuit, fin, 841)).toBe(false);
    expect(doitEtendreHistorique(["vwap", "pivotStandard"], minuit, fin, 841)).toBe(true);
    expect(cibleSessionUTC(["vwap", "pivotStandard"], fin)).toBe(19_999 * JOUR_MS);
  });
});

describe("amorce longue (AXIS : 1 500 bougies déclarées par la définition)", () => {
  const H4 = 4 * HEURE_MS;
  // Backfill de 500 bougies 4h : la première ouvre 499 × 4 h avant la dernière.
  const premier = DERNIER - 499 * H4;

  it("amorceMinimale : lue sur `IndicatorDef.amorceBougies`, maximum des définitions actives, undefined sinon", () => {
    expect(getIndicator("stratAxis")?.amorceBougies).toBe(1500);
    expect(amorceMinimale([])).toBeUndefined();
    expect(amorceMinimale(["rsi", "ema", "vwap", "pivotStandard"])).toBeUndefined();
    expect(amorceMinimale(["stratAxis"])).toBe(1500);
    expect(amorceMinimale(["rsi", "stratAxis", "vwap"])).toBe(1500);
    expect(amorceMinimale(["definition-inconnue"])).toBeUndefined();
  });

  it("limitePageAmorce : le manque plafonné à la page, 0 sans amorce ou buffer assez long", () => {
    expect(limitePageAmorce(500, undefined, 500)).toBe(0);
    expect(limitePageAmorce(1500, 1500, 500)).toBe(0);
    expect(limitePageAmorce(2000, 1500, 500)).toBe(0);
    expect(limitePageAmorce(500, 1500, 500)).toBe(500);
    expect(limitePageAmorce(1000, 1500, 500)).toBe(500);
    expect(limitePageAmorce(1200, 1500, 500)).toBe(300);
  });

  it("doitEtendreHistorique : AXIS sur 500 bougies → vrai ; sur 1 500 → faux ; sans AXIS → faux", () => {
    expect(doitEtendreHistorique(["stratAxis"], premier, DERNIER, 500)).toBe(true);
    expect(doitEtendreHistorique(["stratAxis"], premier, DERNIER, 1499)).toBe(true);
    expect(doitEtendreHistorique(["stratAxis"], DERNIER - 1499 * H4, DERNIER, 1500)).toBe(false);
    expect(doitEtendreHistorique(["rsi"], premier, DERNIER, 500)).toBe(false);
  });

  it("l'extension compte en BOUGIES : 500 → 1 500 en deux pages de 500, puis rien (idempotent)", async () => {
    let buffer = Array.from({ length: 500 }, (_, i) => bougie(premier + i * H4));
    const limits: number[] = [];
    const params = {
      bougiesMin: 1500,
      tfMs: H4,
      limitePage: 500,
      lirePremierTime: () => buffer[0]?.time,
      lireNombre: () => buffer.length,
      chargerPlusAncien: async (avant: number, limit: number) => {
        limits.push(limit);
        buffer = [...Array.from({ length: limit }, (_, i) => bougie(avant - (limit - i) * H4)), ...buffer];
        return limit;
      },
    };
    expect(await etendreSessionJusqua(params)).toBe(2);
    expect(limits).toEqual([500, 500]);
    expect(buffer).toHaveLength(1500);
    expect(await etendreSessionJusqua(params)).toBe(0);
    expect(limits).toHaveLength(2);
  });

  it("session ET amorce : chaque page demande le plus grand des deux manques", async () => {
    // 1 min, 1 000 bougies depuis 05:00 UTC : la session manque 300 bougies, l'amorce 500.
    const minuit = 20_000 * JOUR_MS;
    let tete = minuit + 5 * HEURE_MS;
    let nombre = 1000;
    const limits: number[] = [];
    await etendreSessionJusqua({
      cible: minuit,
      bougiesMin: 1500,
      tfMs: MINUTE_MS,
      limitePage: 500,
      lirePremierTime: () => tete,
      lireNombre: () => nombre,
      chargerPlusAncien: async (_avant, limit) => {
        limits.push(limit);
        tete -= limit * MINUTE_MS;
        nombre += limit;
        return limit;
      },
    });
    expect(limits).toEqual([500]);
    expect(nombre).toBe(1500);
    expect(tete).toBeLessThan(minuit);
  });

  it("source à sec (historique plus court que l'amorce) : une page vide termine, sans boucle", async () => {
    const charger = vi.fn(async () => 0);
    const pages = await etendreSessionJusqua({
      bougiesMin: 1500,
      tfMs: H4,
      limitePage: 500,
      lirePremierTime: () => premier,
      lireNombre: () => 500,
      chargerPlusAncien: charger,
    });
    expect(pages).toBe(1);
    expect(charger).toHaveBeenCalledTimes(1);
  });

  it("sans `lireNombre`, `bougiesMin` est ignoré (jamais de page demandée à l'aveugle)", async () => {
    const charger = vi.fn(async () => 500);
    const pages = await etendreSessionJusqua({
      bougiesMin: 1500,
      tfMs: H4,
      limitePage: 500,
      lirePremierTime: () => premier,
      chargerPlusAncien: charger,
    });
    expect(pages).toBe(0);
    expect(charger).not.toHaveBeenCalled();
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
    expect(MESSAGE_LIMITE_KRAKEN).toMatch(/~500 bougies/);
  });
});
