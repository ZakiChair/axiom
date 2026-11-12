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
import type { Condition } from "@axiom/alerts";
import { getIndicator } from "@axiom/indicators";
import {
  amorceMinimale,
  bougiesAvantBuffer,
  cibleSessionUTC,
  creerOrdonnanceurExtension,
  creerRelanceExtension,
  demarrerCycleDonnees,
  doitEtendreHistorique,
  doitSignalerLimiteKraken,
  etendreSessionJusqua,
  limitePageAmorce,
  limitePageSession,
  MESSAGE_LIMITE_KRAKEN,
  pasBougiesMs,
  passeExtension,
  type EtatPasseExtension,
} from "./ChartInstance";
import { alertsStore } from "../store/alerts";
import { extensionGrapheStore, indicateursAlertesMarche, indicateursExtension, publierExtension, RELANCE_EXTENSION_MS, surIndicateursAlertes } from "../alerts/amorceGraphe";
import { REFCLOSE_LIMIT } from "./auxProvider";
import { PLAFOND_BOUGIES_GRAPHE } from "../data/profondeurHistorique";

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

describe("amorce longue (AXIS : 1 500 bougies, AXIS S/R : 3 000, déclarées par la définition)", () => {
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

  it("AXIS S/R déclare 3 000 bougies : l'amorce la plus longue l'emporte, la référence et le tampon la couvrent", () => {
    expect(getIndicator("stratAxisSr")?.amorceBougies).toBe(3000);
    expect(amorceMinimale(["stratAxisSr"])).toBe(3000);
    expect(amorceMinimale(["stratAxis", "stratAxisSr", "rsi"])).toBe(3000);
    expect(amorceMinimale(["stratAxis"])).toBe(1500);
    expect(limitePageAmorce(500, 3000, 500)).toBe(500);
    expect(limitePageAmorce(2800, 3000, 500)).toBe(200);
    expect(REFCLOSE_LIMIT).toBeGreaterThanOrEqual(3000); // la référence couvre l'amorce la plus longue
    expect(PLAFOND_BOUGIES_GRAPHE).toBeGreaterThanOrEqual(3000); // data/profondeurHistorique.ts : 20 000
  });

  it("doitEtendreHistorique : AXIS sur 500 bougies → vrai ; sur 1 500 → faux ; sans AXIS → faux", () => {
    expect(doitEtendreHistorique(["stratAxis"], premier, DERNIER, 500)).toBe(true);
    expect(doitEtendreHistorique(["stratAxis"], premier, DERNIER, 1499)).toBe(true);
    expect(doitEtendreHistorique(["stratAxis"], DERNIER - 1499 * H4, DERNIER, 1500)).toBe(false);
    expect(doitEtendreHistorique(["rsi"], premier, DERNIER, 500)).toBe(false);
  });

  it("doitEtendreHistorique : AXIS S/R sur 1 500 bougies → vrai ; sur 3 000 → faux", () => {
    expect(doitEtendreHistorique(["stratAxisSr"], DERNIER - 1499 * H4, DERNIER, 1500)).toBe(true);
    expect(doitEtendreHistorique(["stratAxisSr"], DERNIER - 2999 * H4, DERNIER, 3000)).toBe(false);
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

  it("l'extension compte en BOUGIES : 500 → 3 000 en cinq pages de 500 (AXIS S/R)", async () => {
    let buffer = Array.from({ length: 500 }, (_, i) => bougie(premier + i * H4));
    const limits: number[] = [];
    const params = {
      bougiesMin: amorceMinimale(["stratAxisSr"]),
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
    // Cinq pages tiennent sous le plafond de dix par extension (`MAX_PAGES_SESSION`) :
    // un seul passage suffit, le second ne demande plus rien.
    expect(await etendreSessionJusqua(params)).toBe(5);
    expect(limits).toEqual([500, 500, 500, 500, 500]);
    expect(buffer).toHaveLength(3000);
    expect(await etendreSessionJusqua(params)).toBe(0);
    expect(limits).toHaveLength(5);
  });

  it("l'extension compte en BOUGIES : 500 → 3 000 en neuf pages de 300 (AXIS S/R), en un seul passage", async () => {
    let buffer = Array.from({ length: 500 }, (_, i) => bougie(premier + i * H4));
    const limits: number[] = [];
    const params = {
      bougiesMin: amorceMinimale(["stratAxisSr"]),
      tfMs: H4,
      limitePage: 300,
      lirePremierTime: () => buffer[0]?.time,
      lireNombre: () => buffer.length,
      chargerPlusAncien: async (avant: number, limit: number) => {
        limits.push(limit);
        buffer = [...Array.from({ length: limit }, (_, i) => bougie(avant - (limit - i) * H4)), ...buffer];
        return limit;
      },
    };
    // Neuf pages, sous le plafond par extension (`MAX_PAGES_SESSION`) : aucune n'attend un second passage.
    expect(await etendreSessionJusqua(params)).toBe(9);
    expect(limits).toEqual([300, 300, 300, 300, 300, 300, 300, 300, 100]);
    expect(buffer).toHaveLength(3000);
    expect(await etendreSessionJusqua(params)).toBe(0);
    expect(limits).toHaveLength(9);
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

// ───────────────────────────────────────────────────────────────────────────────────────────
// Lot A2 (12 novembre 2026) : la vue principale étend aussi son historique pour les indicateurs
// des alertes actives de son marché, et publie l'état de chaque passe (en cours, puis terminée
// avec les bougies obtenues). Câblage de `ChartInstance` rejoué sans React : ordonnanceur, passe,
// relance sur la liste des indicateurs d'alerte, place de N bougies servies par pages de 500.
// ───────────────────────────────────────────────────────────────────────────────────────────
describe("historique chargé pour les alertes de la vue principale (lot A2)", () => {
  const H4 = 4 * HEURE_MS;
  const MARCHE = { exchange: "binance" as const, symbol: "BTCUSDT", timeframe: "4h" as const };
  const SR: Condition = { type: "indicateur-seuil", indicateurId: "stratAxisSr", params: {}, output: "reactionSupport", comparateur: ">=", valeur: 1 };

  beforeEach(() => {
    alertsStore.setState({ defs: [], journal: [] });
  });

  /**
   * Vue de `affiches` sur une place qui sert `servies` bougies 4h ; tampon de départ : les 500
   * dernières (backfill). `bloquer()` retient les pages suivantes jusqu'à `liberer()`.
   */
  function vue(servies: number, affiches: string[], maitre = true) {
    const place = Array.from({ length: servies }, (_, i) => bougie(DERNIER - (servies - 1 - i) * H4));
    let buffer = place.slice(-500);
    const publies: EtatPasseExtension[] = [];
    const pages: number[] = [];
    const enCours: boolean[] = [];
    /** Ordre des effets d'une passe : marque d'extension, publication, réapplication du buffer. */
    const ordre: string[] = [];
    const appliques: number[] = [];
    /** Nouvelles passes programmées après un échec (la minuterie de `creerRelanceExtension`, comme dans le graphe). */
    let relances = 0;
    /** Annulations de la relance en attente par une passe finie sans échec. */
    let annulations = 0;
    let annule = false;
    let echec = false;
    let porte: Promise<void> | null = null;
    let ouvrir: () => void = () => {};
    const etendre = async (cible: number | undefined, bougiesMin: number | undefined): Promise<void> => {
      await etendreSessionJusqua({
        cible,
        bougiesMin,
        tfMs: H4,
        limitePage: 500,
        lirePremierTime: () => buffer[0]?.time,
        lireNombre: () => buffer.length,
        chargerPlusAncien: async (avantTime, limit) => {
          if (porte !== null) await porte;
          if (echec) throw new Error("réseau coupé");
          const anciennes = place.filter((c) => c.time < avantTime).slice(-limit);
          buffer = [...anciennes, ...buffer];
          pages.push(anciennes.length);
          return anciennes.length;
        },
        estAnnule: () => annule,
      });
    };
    const ordonnanceur = creerOrdonnanceurExtension({
      estAnnule: () => annule,
      peutLancer: () => !annule,
      executer: () => passeExtension({
        lireBuffer: () => buffer,
        lireIds: () => indicateursExtension(affiches, alertsStore.getState().defs, MARCHE, Date.now(), maitre),
        etendre,
        marquerEnCours: (oui) => {
          enCours.push(oui);
          ordre.push(`en cours ${oui}`);
        },
        estValide: () => !annule,
        appliquer: (complet) => {
          appliques.push(complet.length);
          ordre.push(`appliqué ${complet.length}`);
        },
        publier: (etat) => {
          publies.push(etat);
          ordre.push(`publié ${etat.terminee ? "terminée" : "en cours"} ${etat.bougies}`);
        },
        relancer: () => {
          relances += 1;
          ordre.push("relance programmée");
          relance.programmer();
        },
        annulerRelance: () => {
          annulations += 1;
          relance.annuler();
        },
      }),
    });
    // Même câblage que le graphe : la relance redemande une passe à l'ordonnanceur au délai.
    const relance = creerRelanceExtension(() => ordonnanceur.demander(), RELANCE_EXTENSION_MS);
    const desabonnerAlertes = maitre ? surIndicateursAlertes(MARCHE, () => ordonnanceur.demander()) : () => {};
    // Démontage : comme au démontage du cycle de données, aucune relance ne survit au test.
    const desabonner = (): void => {
      desabonnerAlertes();
      relance.annuler();
    };
    return {
      demander: () => ordonnanceur.demander(),
      publies, pages, enCours, appliques, ordre, desabonner,
      bloquer: () => { porte = new Promise<void>((r) => { ouvrir = r; }); },
      liberer: () => { porte = null; ouvrir(); },
      annuler: () => { annule = true; },
      couper: () => { echec = true; },
      retablir: () => { echec = false; },
      relances: () => relances,
      annulations: () => annulations,
    };
  }
  const poser = (condition: Condition): void => {
    expect(alertsStore.getState().ajouter({ symbol: "BTCUSDT", source: "binance", timeframe: "4h", condition })).toBe(true);
  };

  it("doitEtendreHistorique et amorceMinimale, avec les seuls indicateurs d'une alerte : vrai à 500 bougies, faux sans alerte ni indicateur", () => {
    const premier = DERNIER - 499 * H4;
    const ids = indicateursAlertesMarche([{ id: "sr", symbol: "BTCUSDT", source: "binance", timeframe: "4h", actif: true, declenchements: [], condition: SR }], MARCHE, Date.now());
    expect(ids).toEqual(["stratAxisSr"]);
    expect(amorceMinimale(ids)).toBe(3000);
    expect(doitEtendreHistorique(ids, premier, DERNIER, 500)).toBe(true);
    expect(doitEtendreHistorique(indicateursAlertesMarche([], MARCHE, Date.now()), premier, DERNIER, 500)).toBe(false);
  });

  it("alerte AXIS S/R, aucun indicateur affiché, place de 2 988 bougies : remontée de toute la place, « en cours » puis « terminée » à 2 988", async () => {
    const v = vue(2988, []);
    poser(SR);
    await vi.waitFor(() => expect(v.publies.at(-1)?.terminee).toBe(true));
    expect(v.publies).toEqual([
      { terminee: false, echec: false, amorceVisee: 3000, bougies: 500 },
      { terminee: true, echec: false, amorceVisee: 3000, bougies: 2988 },
    ]);
    // Cinq pages de 500, la dernière en rend 488, puis une page vide : la place est à sec.
    expect(v.pages).toEqual([500, 500, 500, 500, 488, 0]);
    expect(v.enCours).toEqual([true, false]);
    // Le buffer étendu est réappliqué au graphe AVANT que « terminée » soit publiée.
    expect(v.appliques).toEqual([2988]);
    // Ordre : la pagination est mise en attente AVANT « en cours », et « terminée » n'est publiée
    // qu'après la réapplication du buffer : le runtime réévalue alors sur le tampon final.
    expect(v.ordre).toEqual(["en cours true", "publié en cours 500", "en cours false", "appliqué 2988", "publié terminée 2988"]);
    v.desabonner();
  });

  it("vue secondaire : l'alerte du même marché ne fait rien charger", async () => {
    const v = vue(2988, [], false);
    poser(SR);
    v.demander();
    await vi.waitFor(() => expect(v.publies).toHaveLength(1));
    expect(v.publies).toEqual([{ terminee: true, echec: false, amorceVisee: 0, bougies: 500 }]);
    expect(v.pages).toEqual([]);
  });

  it("sans alerte ni indicateur à amorce (RSI, alerte de prix) : rien à charger, « terminée » publiée aussitôt", async () => {
    const v = vue(2988, ["rsi"]);
    // Une alerte de prix ne demande aucun indicateur : pas de relance.
    poser({ type: "prix-croise", niveau: 80_000, sens: "baisse" });
    await Promise.resolve();
    expect(v.publies).toEqual([]);
    // Une alerte RSI change la liste : une passe, qui n'a rien à charger.
    poser({ type: "indicateur-seuil", indicateurId: "rsi", params: {}, output: "rsi", comparateur: ">", valeur: 70 });
    await vi.waitFor(() => expect(v.publies).toHaveLength(1));
    expect(v.publies).toEqual([{ terminee: true, echec: false, amorceVisee: 0, bougies: 500 }]);
    expect(v.pages).toEqual([]);
    v.desabonner();
  });

  // Modifié à dessein (revue du lot A2) : l'échec est publié comme tel (`echec`), et une nouvelle
  // passe est programmée ; avant, il était publié comme une place à sec, sans relance.
  it("échec réseau pendant la remontée : « terminée » avec le tampon obtenu et l'échec, une relance programmée ; la relance réussie remonte toute la place", async () => {
    const v = vue(2988, ["stratAxisSr"]);
    v.couper();
    v.demander();
    await vi.waitFor(() => expect(v.publies.at(-1)?.terminee).toBe(true));
    expect(v.publies).toEqual([
      { terminee: false, echec: false, amorceVisee: 3000, bougies: 500 },
      { terminee: true, echec: true, amorceVisee: 3000, bougies: 500 },
    ]);
    expect(v.enCours).toEqual([true, false]);
    // La relance n'est programmée qu'APRÈS la publication de l'échec.
    expect(v.ordre).toEqual(["en cours true", "publié en cours 500", "en cours false", "publié terminée 500", "relance programmée"]);
    expect(v.relances()).toBe(1);
    // La minuterie échoit, le réseau est revenu : « en cours », puis la place entière, sans échec ni relance.
    v.retablir();
    v.demander();
    await vi.waitFor(() => expect(v.publies).toHaveLength(4));
    expect(v.publies.slice(2)).toEqual([
      { terminee: false, echec: false, amorceVisee: 3000, bougies: 500 },
      { terminee: true, echec: false, amorceVisee: 3000, bougies: 2988 },
    ]);
    expect(v.relances()).toBe(1);
    v.desabonner();
  });

  // Revue finale du lot A2 (sonde F5 sur le vrai graphe : relance partie 60 s après l'échec, alors
  // qu'une passe déclenchée par un RSI ajouté avait déjà remonté toute la place).
  describe("relance après un échec, sur la vraie minuterie (`creerRelanceExtension`)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("sans autre passe, la relance part au délai entier et remonte toute la place", async () => {
      const v = vue(2988, ["stratAxisSr"]);
      v.couper();
      v.demander();
      await vi.advanceTimersByTimeAsync(0);
      expect(v.publies).toEqual([
        { terminee: false, echec: false, amorceVisee: 3000, bougies: 500 },
        { terminee: true, echec: true, amorceVisee: 3000, bougies: 500 },
      ]);
      v.retablir();
      await vi.advanceTimersByTimeAsync(RELANCE_EXTENSION_MS - 1);
      expect(v.publies, `états publiés avant le délai : ${JSON.stringify(v.publies)}`).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(v.publies.slice(2)).toEqual([
        { terminee: false, echec: false, amorceVisee: 3000, bougies: 500 },
        { terminee: true, echec: false, amorceVisee: 3000, bougies: 2988 },
      ]);
      v.desabonner();
    });

    it("un échec, puis une passe réussie pour une autre cause : la relance en attente est annulée, aucune passe ne part au délai", async () => {
      const v = vue(2988, ["stratAxisSr"]);
      v.couper();
      v.demander();
      await vi.advanceTimersByTimeAsync(0);
      expect(v.relances()).toBe(1);
      // Réseau rétabli ; une autre cause (indicateur ajouté, alerte créée) demande une passe, qui
      // remonte toute la place.
      v.retablir();
      await vi.advanceTimersByTimeAsync(10_000);
      v.demander();
      await vi.advanceTimersByTimeAsync(0);
      expect(v.publies.at(-1)).toEqual({ terminee: true, echec: false, amorceVisee: 3000, bougies: 2988 });
      expect(v.annulations()).toBe(1);
      const pages = [...v.pages];
      const publies = v.publies.length;
      // Au délai de la relance, et bien après : aucune page redemandée, « en cours » jamais republié.
      await vi.advanceTimersByTimeAsync(2 * RELANCE_EXTENSION_MS);
      expect(v.pages, `pages après le délai : ${JSON.stringify(v.pages)}`).toEqual(pages);
      expect(v.publies, `états publiés après le délai : ${JSON.stringify(v.publies.slice(publies))}`).toHaveLength(publies);
      v.desabonner();
    });

    it("un échec, puis une passe qui n'a plus rien à charger (indicateur retiré) : la relance en attente est annulée", async () => {
      const affiches = ["stratAxisSr"];
      const v = vue(2988, affiches);
      v.couper();
      v.demander();
      await vi.advanceTimersByTimeAsync(0);
      expect(v.relances()).toBe(1);
      affiches.splice(0, affiches.length, "rsi");
      v.demander();
      await vi.advanceTimersByTimeAsync(0);
      expect(v.publies.at(-1)).toEqual({ terminee: true, echec: false, amorceVisee: 0, bougies: 500 });
      const publies = v.publies.length;
      await vi.advanceTimersByTimeAsync(2 * RELANCE_EXTENSION_MS);
      expect(v.publies, `états publiés après le délai : ${JSON.stringify(v.publies.slice(publies))}`).toHaveLength(publies);
      expect(v.pages).toEqual([]);
      v.desabonner();
    });
  });

  it("place à sec, rien à charger ou identité invalidée : aucune relance", async () => {
    const aSec = vue(2988, []);
    poser(SR);
    await vi.waitFor(() => expect(aSec.publies.at(-1)?.terminee).toBe(true));
    aSec.desabonner();
    alertsStore.setState({ defs: [], journal: [] });
    const rien = vue(2988, ["rsi"]);
    rien.demander();
    await vi.waitFor(() => expect(rien.publies).toHaveLength(1));
    const invalidee = vue(2988, ["stratAxisSr"]);
    invalidee.bloquer();
    invalidee.couper();
    invalidee.demander();
    await vi.waitFor(() => expect(invalidee.publies).toHaveLength(1));
    invalidee.annuler();
    invalidee.liberer();
    await vi.waitFor(() => expect(invalidee.enCours).toEqual([true, false]));
    expect([aSec.relances(), rien.relances(), invalidee.relances()]).toEqual([0, 0, 0]);
    rien.desabonner();
    invalidee.desabonner();
  });

  it("identité invalidée pendant la remontée (changement de marché) : plus rien n'est publié", async () => {
    const v = vue(2988, ["stratAxisSr"]);
    v.bloquer();
    v.demander();
    await vi.waitFor(() => expect(v.publies).toHaveLength(1));
    v.annuler();
    v.liberer();
    await vi.waitFor(() => expect(v.enCours).toEqual([true, false]));
    expect(v.publies).toEqual([{ terminee: false, echec: false, amorceVisee: 3000, bougies: 500 }]);
    v.desabonner();
  });

  it("alerte supprimée pendant la remontée : la passe va à son terme, la suivante ne charge rien et ne vise plus son amorce", async () => {
    const v = vue(2988, []);
    v.bloquer();
    poser(SR);
    await vi.waitFor(() => expect(v.publies).toHaveLength(1));
    alertsStore.getState().supprimer(alertsStore.getState().defs[0]!.id);
    v.liberer();
    await vi.waitFor(() => expect(v.publies).toHaveLength(3));
    expect(v.publies).toEqual([
      { terminee: false, echec: false, amorceVisee: 3000, bougies: 500 },
      { terminee: true, echec: false, amorceVisee: 3000, bougies: 2988 },
      { terminee: true, echec: false, amorceVisee: 0, bougies: 2988 },
    ]);
    v.desabonner();
  });

  it("alerte AXIS S/R posée pendant la remontée d'AXIS affiché (1 500) : la passe suivante vise 3 000 (correction 2 de la critique)", async () => {
    const v = vue(2988, ["stratAxis"]);
    v.bloquer();
    v.demander();
    await vi.waitFor(() => expect(v.publies).toHaveLength(1));
    poser(SR);
    v.liberer();
    await vi.waitFor(() => expect(v.publies).toHaveLength(4));
    expect(v.publies).toEqual([
      { terminee: false, echec: false, amorceVisee: 1500, bougies: 500 },
      { terminee: true, echec: false, amorceVisee: 1500, bougies: 1500 },
      { terminee: false, echec: false, amorceVisee: 3000, bougies: 1500 },
      { terminee: true, echec: false, amorceVisee: 3000, bougies: 2988 },
    ]);
    v.desabonner();
  });

  // Revue finale du lot A2 (sonde F4) : coût épinglé et consigné au contrat, pas corrigé. Sur une
  // place à sec, l'amorce n'est jamais atteinte : toute passe nouvelle (liste des indicateurs
  // d'alerte changée, indicateur ajouté au graphe) redemande une page, vide, et repasse par « en
  // cours » le temps de cette page.
  it("place à sec, alerte AXIS S/R active : une alerte RSI créée relance une passe, qui redemande une page vide et repasse par « en cours »", async () => {
    const v = vue(2988, []);
    poser(SR);
    await vi.waitFor(() => expect(v.publies).toHaveLength(2));
    poser({ type: "indicateur-seuil", indicateurId: "rsi", params: {}, output: "rsi", comparateur: ">", valeur: 70 });
    await vi.waitFor(() => expect(v.publies).toHaveLength(4));
    expect(v.publies.slice(2)).toEqual([
      { terminee: false, echec: false, amorceVisee: 3000, bougies: 2988 },
      { terminee: true, echec: false, amorceVisee: 3000, bougies: 2988 },
    ]);
    expect(v.pages).toEqual([500, 500, 500, 500, 488, 0, 0]);
    v.desabonner();
  });

  it("armements et déclenchements réécrivent les définitions sans relancer l'extension (correction 3)", async () => {
    const v = vue(2988, []);
    poser(SR);
    await vi.waitFor(() => expect(v.publies).toHaveLength(2));
    const d = alertsStore.getState().defs[0]!;
    alertsStore.getState().appliquerMisesAJour([{ ...d, arme: true }]);
    alertsStore.getState().appliquerMisesAJour([{ ...d, arme: false, declenchements: [1] }]);
    await Promise.resolve();
    expect(v.publies).toHaveLength(2);
    expect(v.pages).toEqual([500, 500, 500, 500, 488, 0]);
    v.desabonner();
  });
});

describe("relance d'une remontée échouée (revue du lot A2)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("une seule passe en attente, au bout du délai entier ; programmer de nouveau repart du délai ; annuler au démontage", () => {
    vi.useFakeTimers();
    const demander = vi.fn();
    const relance = creerRelanceExtension(demander, 60_000);
    relance.programmer();
    vi.advanceTimersByTime(59_999);
    expect(demander).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(demander).toHaveBeenCalledTimes(1);
    // Deux échecs rapprochés : une seule relance, 60 s après le second.
    relance.programmer();
    vi.advanceTimersByTime(30_000);
    relance.programmer();
    vi.advanceTimersByTime(59_999);
    expect(demander).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(demander).toHaveBeenCalledTimes(2);
    // Démontage du cycle de données pendant l'attente : rien n'est relancé.
    relance.programmer();
    relance.annuler();
    vi.advanceTimersByTime(120_000);
    expect(demander).toHaveBeenCalledTimes(2);
  });
});

describe("début d'un cycle de données : l'état de l'extension repart de rien (revue du lot A2)", () => {
  const TERMINEE = { cle: "binance|BTCUSDT|4h", terminee: true, echec: false, amorceVisee: 3000, bougies: 2988 };
  afterEach(() => {
    extensionGrapheStore.setState({ extension: null });
  });

  it("vue principale : `null` est publié AVANT que le buffer ne soit vidé ; la valeur de `demarrer` est rendue", () => {
    publierExtension(TERMINEE);
    let vuPendant: unknown = "non appelé";
    const requestId = demarrerCycleDonnees(true, () => {
      vuPendant = extensionGrapheStore.getState().extension;
      return 7;
    });
    expect(requestId).toBe(7);
    expect(vuPendant).toBeNull();
    expect(extensionGrapheStore.getState().extension).toBeNull();
  });

  it("vue secondaire : l'état publié par la vue principale n'est pas touché", () => {
    publierExtension(TERMINEE);
    expect(demarrerCycleDonnees(false, () => null)).toBeNull();
    expect(extensionGrapheStore.getState().extension).toEqual(TERMINEE);
  });
});
