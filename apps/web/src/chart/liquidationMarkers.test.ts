/**
 * Heatmap de liquidations — logique PURE : taille de bucket « jolie », index de bucket,
 * colormap viridis (interpolée + clampée), et le NOUVEAU modèle d'événements bruts
 * (sérialisation v2, fusion/dédoublonnage, borne FIFO, seed Coinalyze). Le rendu
 * KLineChart et le couplage aux stores ne sont pas testés.
 */
import { beforeEach, describe, expect, it } from "vitest";

// liquidationMarkers.ts appelle registerOverlay + importe ./drawing (klinecharts) et
// ../store/theme (pose [data-theme] au chargement) + s'abonne à des flux WS/daemon à
// l'import : on stub le tout pour importer les fonctions PURES en environnement Node.
import { vi } from "vitest";
vi.mock("klinecharts", () => ({ registerOverlay: () => {} }));
vi.mock("./drawing", () => ({ getActiveChart: () => null }));
vi.mock("../store/theme", () => ({
  themeStore: { getState: () => ({ theme: "dark" }), subscribe: () => () => {} },
}));
// Espions hoistés : le refcount UI (retenirFluxLiq) est testé sur le VRAI sync() du
// singleton — on observe l'ouverture/fermeture de l'abonnement via ces spies.
const { subSpy, unsubSpy } = vi.hoisted(() => {
  const unsubSpy = vi.fn();
  const subSpy = vi.fn(() => unsubSpy);
  return { subSpy, unsubSpy };
});
vi.mock("../data/liquidations", () => ({ subscribeLiquidations: subSpy }));
// Amorçage : le daemon et le fournisseur tiers sont pilotés par test (l'ORDRE des replis
// est justement ce qu'on vérifie) ; les pures de santé (`collecteurLiqMuet`) restent RÉELLES.
const { liqGetSpy, coinalyzeSpy, santeSpy } = vi.hoisted(() => ({
  liqGetSpy: vi.fn<() => Promise<unknown[] | null>>(async () => null),
  coinalyzeSpy: vi.fn<() => Promise<unknown[]>>(async () => []),
  santeSpy: vi.fn<() => unknown>(() => null),
}));
vi.mock("../data/coinalyze", () => ({ fetchLiquidationHistory: coinalyzeSpy }));
vi.mock("../data/daemon", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../data/daemon")>()),
  liquidationsGet: liqGetSpy,
  liquidationsPush: async () => false,
  santeLiquidationsDaemon: santeSpy,
}));

import type { Candle } from "@axiom/types";
import { marketStore } from "../store/market";
import {
  bornerEvenements,
  bucketIndex,
  candleContenant,
  couleurViridis,
  deserialiserEvenements,
  fusionnerEvenements,
  liqEventsStore,
  liqMarksStore,
  retenirFluxLiq,
  seedDepuisCoinalyze,
  serialiserEvenements,
  tailleBucket,
  type LiqEvent,
} from "./liquidationMarkers";

describe("tailleBucket", () => {
  it("~0,1 % du prix arrondi à un pas joli (1/2/5 × 10ⁿ)", () => {
    expect(tailleBucket(65000)).toBe(50); // 65 → 50
    expect(tailleBucket(1900)).toBe(2); // 1.9 → 2
    expect(tailleBucket(100)).toBe(0.1); // 0.1 → 0.1
    expect(tailleBucket(0.001)).toBeCloseTo(1e-6, 12); // 1e-6 → 1e-6
  });
  it("prix nul/invalide → repli 1", () => {
    expect(tailleBucket(0)).toBe(1);
    expect(tailleBucket(NaN)).toBe(1);
  });
});

describe("bucketIndex", () => {
  it("floor(prix/taille) — même bucket dans la bande [idx·t, (idx+1)·t)", () => {
    expect(bucketIndex(65020, 50)).toBe(1300); // 65000..65050 → 1300
    expect(bucketIndex(65049, 50)).toBe(1300);
    expect(bucketIndex(65050, 50)).toBe(1301);
  });
});

describe("couleurViridis", () => {
  it("arrêts exacts aux bornes et au milieu", () => {
    expect(couleurViridis(0)).toEqual([68, 1, 84]); // violet
    expect(couleurViridis(0.5)).toEqual([33, 145, 140]); // teal
    expect(couleurViridis(1)).toEqual([253, 231, 37]); // jaune
  });
  it("clampe hors [0,1]", () => {
    expect(couleurViridis(-2)).toEqual([68, 1, 84]);
    expect(couleurViridis(5)).toEqual([253, 231, 37]);
  });
  it("interpole entre deux arrêts (t=0.125 → milieu violet↔bleu)", () => {
    // seg=0.5 entre [68,1,84] et [59,82,139] → moyenne arrondie
    expect(couleurViridis(0.125)).toEqual([64, 42, 112]);
  });
});

describe("persistance des événements v2 (serialiser/deserialiser)", () => {
  const evs: LiqEvent[] = [
    { time: 1000, side: "long", price: 64000, qty: 0.5, usd: 32000, venue: "bybit" },
    { time: 2000, side: "short", price: 65400, qty: 0.2, usd: 13080, venue: "binance" },
  ];

  it("aller-retour préservant les événements (side, prix, qty, usd, venue)", () => {
    const round = deserialiserEvenements(serialiserEvenements(evs));
    expect(round).toEqual(evs);
  });

  it("ancien format v1 {t,b} → [] (jeté)", () => {
    const v1 = JSON.stringify({ t: 50, b: [[1300, 5000], [1301, 12000]] });
    expect(deserialiserEvenements(v1)).toEqual([]);
  });

  it("tolère l'absent / corrompu / mauvaise version → []", () => {
    expect(deserialiserEvenements(null)).toEqual([]);
    expect(deserialiserEvenements("pas du json")).toEqual([]);
    expect(deserialiserEvenements(JSON.stringify({ v: 1, e: [] }))).toEqual([]);
    expect(deserialiserEvenements(JSON.stringify({ v: 2 }))).toEqual([]); // e absent
  });

  it("écarte les tuples invalides (mauvaise longueur / side hors 0-1 / prix ≤ 0 / venue non-string)", () => {
    const raw = JSON.stringify({
      v: 2,
      e: [
        [1000, 0, 64000, 0.5, 32000, "bybit"], // valide
        [1000, 2, 64000, 0.5, 32000, "bybit"], // side01 invalide
        [1000, 0, -1, 0.5, 32000, "bybit"], // prix ≤ 0
        [1000, 0, 64000, 0.5, 32000], // longueur ≠ 6
        [1000, 0, 64000, 0.5, 32000, 42], // venue non-string
      ],
    });
    expect(deserialiserEvenements(raw)).toEqual([
      { time: 1000, side: "long", price: 64000, qty: 0.5, usd: 32000, venue: "bybit" },
    ]);
  });

  it("exclut les événements approx (seed Coinalyze) de la persistance", () => {
    // Le tuple v2 (6 champs, figé) ne porte pas `approx` : persister un événement approx le
    // ferait réapparaître au reload comme événement réel (et bloquerait le re-seed). On ne
    // persiste donc QUE les événements réels ; leur round-trip reste inchangé.
    const mixte: LiqEvent[] = [
      ...evs,
      { time: 3000, side: "long", price: 63000, qty: NaN, usd: 5000, venue: "coinalyze", approx: true },
    ];
    expect(deserialiserEvenements(serialiserEvenements(mixte))).toEqual(evs);
  });

  it("ne persiste que les PERSIST_EVENTS derniers événements", () => {
    // 4000 > PERSIST_EVENTS (3000) : on ne garde que les 3000 derniers (les plus récents).
    const gros: LiqEvent[] = Array.from({ length: 4000 }, (_, i) => ({
      time: i,
      side: "long",
      price: 100 + i,
      qty: 1,
      usd: 100,
      venue: "bybit",
    }));
    const round = deserialiserEvenements(serialiserEvenements(gros));
    expect(round.length).toBe(3000);
    expect(round[0]?.time).toBe(1000); // le plus ancien conservé = index 1000
    expect(round[round.length - 1]?.time).toBe(3999);
  });
});

describe("bornerEvenements (FIFO)", () => {
  it("écarte les plus anciens quand la longueur dépasse la borne", () => {
    const evs: LiqEvent[] = Array.from({ length: 5 }, (_, i) => ({
      time: i,
      side: "long",
      price: 100,
      qty: 1,
      usd: 1,
      venue: "bybit",
    }));
    const borne = bornerEvenements(evs, 3);
    expect(borne.map((e) => e.time)).toEqual([2, 3, 4]); // 3 derniers
  });

  it("renvoie tel quel si sous la borne", () => {
    const evs: LiqEvent[] = [{ time: 1, side: "long", price: 100, qty: 1, usd: 1, venue: "bybit" }];
    expect(bornerEvenements(evs, 3)).toBe(evs);
  });
});

describe("fusionnerEvenements (fusion + dédoublonnage)", () => {
  it("dédoublonne par clé t|venue|price|qty et trie par temps croissant", () => {
    const local: LiqEvent[] = [
      { time: 2000, side: "long", price: 64000, qty: 0.5, usd: 32000, venue: "bybit" },
      { time: 1000, side: "short", price: 65000, qty: 0.1, usd: 6500, venue: "bybit" },
    ];
    const daemon: LiqEvent[] = [
      // Doublon exact du 1er événement local (même t|venue|price|qty) → écarté.
      { time: 2000, side: "long", price: 64000, qty: 0.5, usd: 32000, venue: "bybit" },
      { time: 1500, side: "long", price: 63000, qty: 0.2, usd: 12600, venue: "binance" },
    ];
    const fusion = fusionnerEvenements(local, daemon);
    expect(fusion.map((e) => e.time)).toEqual([1000, 1500, 2000]); // trié, sans doublon
  });

  it("ne confond pas deux événements de même temps mais prix/venue différents", () => {
    const a: LiqEvent[] = [{ time: 1000, side: "long", price: 64000, qty: 1, usd: 1, venue: "bybit" }];
    const b: LiqEvent[] = [{ time: 1000, side: "long", price: 64000, qty: 1, usd: 1, venue: "binance" }];
    expect(fusionnerEvenements(a, b)).toHaveLength(2);
  });
});

describe("amorçage Coinalyze (candleContenant / seedDepuisCoinalyze)", () => {
  function candle(time: number, low: number, high: number): Candle {
    return { time, open: low, high, low, close: high, volume: 1 };
  }
  const candles: Candle[] = [candle(1000, 64000, 64200), candle(2000, 65000, 65400)];

  it("candleContenant renvoie la bougie contenant t (plus grand temps ≤ t), undefined si avant", () => {
    expect(candleContenant(candles, 1500)?.time).toBe(1000);
    expect(candleContenant(candles, 2000)?.time).toBe(2000);
    expect(candleContenant(candles, 9999)?.time).toBe(2000);
    expect(candleContenant(candles, 500)).toBeUndefined();
  });

  it("place le LONG au bas et le SHORT au haut de la bougie contenante, avec approx:true", () => {
    const seed = seedDepuisCoinalyze(
      [
        { time: 1500, longUsd: 3000, shortUsd: 1000 },
        { time: 2500, longUsd: 500, shortUsd: 2000 },
      ],
      candles,
    );
    // Bougie [64000,64200] : long au low 64000, short au high 64200.
    expect(seed).toContainEqual(
      expect.objectContaining({ time: 1500, side: "long", price: 64000, usd: 3000, approx: true }),
    );
    expect(seed).toContainEqual(
      expect.objectContaining({ time: 1500, side: "short", price: 64200, usd: 1000, approx: true }),
    );
    // Bougie [65000,65400] : long au low 65000, short au high 65400.
    expect(seed).toContainEqual(
      expect.objectContaining({ time: 2500, side: "long", price: 65000, usd: 500, approx: true }),
    );
    expect(seed).toContainEqual(
      expect.objectContaining({ time: 2500, side: "short", price: 65400, usd: 2000, approx: true }),
    );
    expect(seed.every((e) => e.venue === "coinalyze")).toBe(true);
  });

  it("ignore les intervalles hors des bougies chargées et les volumes nuls", () => {
    const seed = seedDepuisCoinalyze(
      [{ time: 10, longUsd: 100, shortUsd: 100 }, { time: 1500, longUsd: 0, shortUsd: 0 }],
      candles,
    );
    expect(seed).toHaveLength(0);
  });
});

describe("liqMarksStore — mode de coloration (intensité / dominance)", () => {
  it("défaut « intensite » ; setMode force, basculerMode alterne", () => {
    expect(liqMarksStore.getState().mode).toBe("intensite");
    liqMarksStore.getState().basculerMode();
    expect(liqMarksStore.getState().mode).toBe("dominance");
    liqMarksStore.getState().basculerMode();
    expect(liqMarksStore.getState().mode).toBe("intensite");
    liqMarksStore.getState().setMode("dominance");
    expect(liqMarksStore.getState().mode).toBe("dominance");
    liqMarksStore.getState().setMode("intensite"); // remise à l'état par défaut
    expect(liqMarksStore.getState().mode).toBe("intensite");
  });
});

describe("retenirFluxLiq (refcount des consommateurs UI)", () => {
  it("active l'abonnement quand SEULE la fenêtre retient le flux (heatmap OFF), le coupe à la relâche", () => {
    expect(liqMarksStore.getState().actif).toBe(false);
    subSpy.mockClear();
    unsubSpy.mockClear();
    const relacher = retenirFluxLiq();
    expect(subSpy).toHaveBeenCalledTimes(1);
    relacher();
    expect(unsubSpy).toHaveBeenCalledTimes(1);
    // Buffer vidé et publié à l'arrêt (état « inactif » propre).
    expect(liqEventsStore.getState().events).toEqual([]);
  });

  it("refcount : un seul abonnement pour deux reteneurs ; relâche idempotente", () => {
    subSpy.mockClear();
    unsubSpy.mockClear();
    const r1 = retenirFluxLiq();
    const r2 = retenirFluxLiq();
    expect(subSpy).toHaveBeenCalledTimes(1); // pas de 2e WS pour le 2e reteneur
    r1();
    r1(); // double relâche du même jeton → no-op (ne vole pas la retenue de r2)
    expect(unsubSpy).not.toHaveBeenCalled();
    r2();
    expect(unsubSpy).toHaveBeenCalledTimes(1);
  });

  it("heatmap ON : l'abonnement survit à la relâche de la fenêtre, tombe à la bascule OFF", () => {
    subSpy.mockClear();
    unsubSpy.mockClear();
    const relacher = retenirFluxLiq();
    liqMarksStore.getState().basculer(); // heatmap ON
    relacher();
    expect(unsubSpy).not.toHaveBeenCalled(); // la bascule retient encore le flux
    liqMarksStore.getState().basculer(); // heatmap OFF → plus aucun reteneur
    expect(unsubSpy).toHaveBeenCalledTimes(1);
  });
});

describe("amorce du buffer — repli tiers quand le collecteur daemon est MUET", () => {
  /** Santé d'un collecteur qui n'a jamais rien reçu depuis un daemon démarré en 1970. */
  const SANTE_MUETTE = {
    demarreTs: 0,
    venues: { bybit: { dernierMessageTs: 0, derniereErreur: null } },
  };
  const candles: Candle[] = [
    { time: 1000, open: 64000, high: 64200, low: 64000, close: 64200, volume: 1 },
  ];

  beforeEach(() => {
    // Historique d'appels remis à zéro (convention du fichier, cf. mockClear ci-dessus) :
    // sans cela le cas « collecteur vivant » lirait l'appel Coinalyze du cas précédent.
    liqGetSpy.mockClear();
    coinalyzeSpy.mockClear();
    santeSpy.mockClear();
    liqGetSpy.mockResolvedValue(null);
    coinalyzeSpy.mockResolvedValue([]);
    santeSpy.mockReturnValue(null);
    marketStore.setState({ candles });
  });

  it("daemon qui répond VIDE mais collecteur muet → repli Coinalyze", async () => {
    liqGetSpy.mockResolvedValue([]); // daemon joignable, historique vide
    santeSpy.mockReturnValue(SANTE_MUETTE);
    coinalyzeSpy.mockResolvedValue([{ time: 1500, longUsd: 3000, shortUsd: 0 }]);

    const relacher = retenirFluxLiq();
    await vi.waitFor(() => expect(liqEventsStore.getState().events.length).toBeGreaterThan(0));
    expect(liqEventsStore.getState().events[0]?.venue).toBe("coinalyze");
    relacher();
  });

  it("daemon qui répond VIDE et collecteur VIVANT → aucun repli (l'historique daemon fait foi)", async () => {
    liqGetSpy.mockResolvedValue([]);
    santeSpy.mockReturnValue({
      demarreTs: Date.now(),
      venues: { bybit: { dernierMessageTs: Date.now(), derniereErreur: null } },
    });
    coinalyzeSpy.mockResolvedValue([{ time: 1500, longUsd: 3000, shortUsd: 0 }]);

    const relacher = retenirFluxLiq();
    await vi.waitFor(() => expect(liqGetSpy).toHaveBeenCalled());
    expect(coinalyzeSpy).not.toHaveBeenCalled();
    expect(liqEventsStore.getState().events).toEqual([]);
    relacher();
  });
});
