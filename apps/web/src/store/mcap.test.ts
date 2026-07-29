/**
 * Tests du store CAP — backfill cadencé, recalibrage, persistance et prolongement.
 *
 * Aucun réseau : les deux fetchers sont injectés (`DepsBackfill`) et l'espacement est
 * mis à 0, ce qui neutralise aussi les attentes de repli 429. `localStorage` est absent
 * en Node : on installe le mock mémoire habituel (patron windowManager.test / persist.test).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoinTile, MarketGlobal } from "../data/marketOverview";
import { ErreurCoinGecko, JOUR_MS, STATUT_RESEAU, dominance, type SerieJour } from "../data/mcap";
import {
  CLE_BACKFILL,
  ID_ALTS,
  PLAFOND_DOMINANCES,
  lireHistoriquePersiste,
  mcapStore,
} from "./mcap";

const T0 = Date.parse("2026-07-29T00:00:00Z");

/** Série journalière synthétique de `n` jours finissant à T0, valeur constante `v`. */
function serie(n: number, v: number): SerieJour {
  return Array.from({ length: n }, (_, i) => ({ t: T0 - (n - 1 - i) * JOUR_MS, v }));
}

/** Tuile marché minimale (seuls id/symbol/mcapUsd comptent ici). */
function tuile(id: string, symbol: string, mcapUsd: number): CoinTile {
  return { id, symbol, name: symbol, mcapUsd, price: 1, changePct24h: 0 };
}

// Panier de test : 3 pièces couvrant 900 sur un total /global de 1 000 (k = 1,111…).
const MARCHES: CoinTile[] = [
  tuile("bitcoin", "BTC", 500),
  tuile("ethereum", "ETH", 250),
  tuile("solana", "SOL", 150),
];
const GLOBAL: MarketGlobal = {
  totalMcapUsd: 1_000,
  totalVolumeUsd: 0,
  btcDominance: 50, // 500 / 1 000
  ethDominance: 25,
  mcapChangePct24h: 0,
};

const HISTOS: Record<string, SerieJour> = {
  bitcoin: serie(5, 500),
  ethereum: serie(5, 250),
  solana: serie(5, 150),
};

/** Dépendances de test : tout en mémoire, sans aucune attente. */
function deps() {
  return {
    fetchMarchesEtGlobal: vi.fn(async () => ({ marches: MARCHES, global: GLOBAL })),
    fetchPiece: vi.fn(async (id: string) => HISTOS[id] ?? []),
    espacementMs: 0,
    maintenant: () => T0 + 3_600_000,
  };
}

let stockage: Map<string, string>;

beforeEach(() => {
  stockage = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k) => stockage.get(k) ?? null,
    setItem: (k, v) => void stockage.set(k, v),
    removeItem: (k) => void stockage.delete(k),
    clear: () => stockage.clear(),
    key: (i) => Array.from(stockage.keys())[i] ?? null,
    get length() {
      return stockage.size;
    },
  };
  mcapStore.setState({
    hist: null,
    marches: [],
    backfill: { enCours: false, faites: 0, total: 0, erreur: null },
    erreur: null,
    majTs: null,
    dominances: ["bitcoin", "ethereum"],
  });
});

afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe("demarrerBackfill — reconstruction recalibrée", () => {
  it("cale le dernier point sur /global et retrouve la dominance BTC annoncée", async () => {
    // LE test qui attrape l'erreur « divisé par la somme non recalibrée » : la somme
    // brute du panier vaut 900 pour un total réel de 1 000. Diviser BTC (500) par 900
    // donnerait 55,6 % au lieu des 50 % annoncés par /global.
    await mcapStore.getState().demarrerBackfill(deps());

    const hist = mcapStore.getState().hist;
    expect(hist).not.toBeNull();
    const total = hist!.total;
    expect(total[total.length - 1]).toBeCloseTo(GLOBAL.totalMcapUsd, 6);
    expect(hist!.k).toBeCloseTo(1_000 / 900, 6);
    expect(hist!.recalibre).toBe(true);

    const btcD = dominance(hist!.pieces["bitcoin"] ?? [], total);
    expect(btcD[btcD.length - 1]).toBeCloseTo(GLOBAL.btcDominance, 1);
  });

  it("met en cache les séries de BTC, ETH et des dominances suivies", async () => {
    mcapStore.setState({ dominances: ["bitcoin", "ethereum", "solana"] });
    await mcapStore.getState().demarrerBackfill(deps());

    expect(Object.keys(mcapStore.getState().hist?.pieces ?? {}).sort()).toEqual([
      "bitcoin",
      "ethereum",
      "solana",
    ]);
  });

  it("expose la progression puis la termine", async () => {
    await mcapStore.getState().demarrerBackfill(deps());
    const bf = mcapStore.getState().backfill;
    expect(bf.enCours).toBe(false);
    expect(bf.faites).toBe(MARCHES.length);
    expect(bf.total).toBe(MARCHES.length);
    expect(bf.erreur).toBeNull();
  });

  it("rejoue une pièce après un 429 sans perdre la progression", async () => {
    let essais = 0;
    const d = deps();
    d.fetchPiece = vi.fn(async (id: string) => {
      if (id === "ethereum") {
        essais += 1;
        if (essais === 1) throw new ErreurCoinGecko("429", 429, 0);
      }
      return HISTOS[id] ?? [];
    });

    await mcapStore.getState().demarrerBackfill(d);

    expect(essais).toBe(2); // rejouée une fois, puis réussie
    const hist = mcapStore.getState().hist;
    expect(hist?.total[hist.total.length - 1]).toBeCloseTo(1_000, 6);
    expect(Object.keys(hist?.pieces ?? {})).toContain("ethereum");
  });

  it("rejoue aussi sur un REJET RÉSEAU — c'est ainsi qu'un 429 se présente au navigateur", async () => {
    // Un 429 CoinGecko n'a pas d'en-tête CORS : le navigateur bloque la réponse et
    // `fetch` rejette, statut illisible. Ne retenter que sur 429 laisserait le repli
    // inopérant précisément là où il sert (constaté en run réel).
    let essais = 0;
    const d = deps();
    d.fetchPiece = vi.fn(async (id: string) => {
      if (id === "ethereum") {
        essais += 1;
        if (essais === 1) throw new ErreurCoinGecko("CORS", STATUT_RESEAU, null);
      }
      return HISTOS[id] ?? [];
    });

    await mcapStore.getState().demarrerBackfill(d);

    expect(essais).toBe(2);
    const hist = mcapStore.getState().hist;
    expect(hist?.total[hist.total.length - 1]).toBeCloseTo(1_000, 6);
  });

  it("rejoue le catalogue initial : un échec unique ne doit pas tuer tout le backfill", async () => {
    let appels = 0;
    const d = deps();
    d.fetchMarchesEtGlobal = vi.fn(async () => {
      appels += 1;
      if (appels === 1) throw new ErreurCoinGecko("CORS", STATUT_RESEAU, null);
      return { marches: MARCHES, global: GLOBAL };
    });

    await mcapStore.getState().demarrerBackfill(d);

    expect(appels).toBe(2);
    expect(mcapStore.getState().hist).not.toBeNull();
  });

  it("abandonne proprement après une erreur non 429 (série précédente préservée)", async () => {
    await mcapStore.getState().demarrerBackfill(deps());
    const avant = mcapStore.getState().hist;

    const d = deps();
    d.fetchPiece = vi.fn(async () => {
      throw new ErreurCoinGecko("500", 500, null);
    });
    await mcapStore.getState().demarrerBackfill(d);

    expect(mcapStore.getState().hist).toEqual(avant); // erreur NON destructive
    expect(mcapStore.getState().backfill.erreur).not.toBeNull();
    expect(mcapStore.getState().backfill.enCours).toBe(false);
  });

  it("sauvegarde la progression même quand il abandonne (curseur écrit dans le catch)", async () => {
    // Sans ça, un abandon reperd jusqu'à PAS_CURSEUR pièces à chaque reprise : la
    // dernière écriture périodique du curseur date d'au plus 5 pièces en arrière.
    const d = deps();
    d.fetchPiece = vi.fn(async (id: string) => {
      if (id === "solana") throw new ErreurCoinGecko("500", 500, null);
      return HISTOS[id] ?? [];
    });

    await mcapStore.getState().demarrerBackfill(d);

    expect(mcapStore.getState().backfill.erreur).not.toBeNull();
    const curseur = JSON.parse(stockage.get(CLE_BACKFILL) ?? "null");
    expect(curseur).not.toBeNull();
    expect(curseur.restants).toEqual(["solana"]); // BTC et ETH sont acquis
  });

  it("ignore un second démarrage tant que le premier tourne", async () => {
    mcapStore.setState({ backfill: { enCours: true, faites: 1, total: 3, erreur: null } });
    const d = deps();
    await mcapStore.getState().demarrerBackfill(d);
    expect(d.fetchMarchesEtGlobal).not.toHaveBeenCalled();
  });
});

describe("interrompre / reprise", () => {
  it("laisse un curseur exploitable et reprend là où le backfill s'était arrêté", async () => {
    const d = deps();
    d.fetchPiece = vi.fn(async (id: string) => {
      if (id === "ethereum") mcapStore.getState().interrompre();
      return HISTOS[id] ?? [];
    });
    await mcapStore.getState().demarrerBackfill(d);

    expect(mcapStore.getState().hist).toBeNull(); // interrompu : pas d'historique complet
    expect(stockage.get(CLE_BACKFILL)).toBeDefined();

    const d2 = deps();
    await mcapStore.getState().demarrerBackfill(d2);

    // Seule la pièce restante est re-téléchargée.
    expect(d2.fetchPiece.mock.calls.map((c) => c[0])).toEqual(["solana"]);
    const hist = mcapStore.getState().hist;
    expect(hist?.total[hist.total.length - 1]).toBeCloseTo(1_000, 6);
    expect(stockage.get(CLE_BACKFILL)).toBeUndefined(); // curseur purgé à la fin
  });
});

describe("prolonger — deux appels, pas cent", () => {
  it("remplace le point du jour au lieu d'en ajouter un second", async () => {
    await mcapStore.getState().demarrerBackfill(deps());
    const nbJours = mcapStore.getState().hist!.grille.length;

    const d = deps();
    d.fetchMarchesEtGlobal = vi.fn(async () => ({
      marches: [
        tuile("bitcoin", "BTC", 600),
        tuile("ethereum", "ETH", 250),
        tuile("solana", "SOL", 150),
      ],
      global: { ...GLOBAL, totalMcapUsd: 1_100 },
    }));
    d.maintenant = () => T0 + 7_200_000; // même jour UTC que le dernier point

    await mcapStore.getState().prolonger(true, d);

    const apres = mcapStore.getState().hist!;
    expect(apres.grille).toHaveLength(nbJours); // aucun jour ajouté
    expect(apres.total[nbJours - 1]).toBeCloseTo(1_100, 6);
    expect(apres.pieces["bitcoin"]?.[nbJours - 1]).toBe(600);
  });

  it("ajoute un jour quand la date a changé", async () => {
    await mcapStore.getState().demarrerBackfill(deps());
    const nbJours = mcapStore.getState().hist!.grille.length;

    const d = deps();
    d.maintenant = () => T0 + JOUR_MS + 3_600_000;
    await mcapStore.getState().prolonger(true, d);

    expect(mcapStore.getState().hist!.grille).toHaveLength(nbJours + 1);
  });

  it("ne fige pas le TTL quand il n'y a pas encore d'historique", async () => {
    // Le catalogue alimente le sélecteur « + dominance » : le geler 10 min sur un
    // état vide priverait la fenêtre de sa liste de pièces.
    const d = deps();
    await mcapStore.getState().prolonger(false, d);
    expect(mcapStore.getState().majTs).toBeNull();

    const d2 = deps();
    await mcapStore.getState().prolonger(false, d2);
    expect(d2.fetchMarchesEtGlobal).toHaveBeenCalled();
  });

  it("respecte le TTL sans le drapeau force", async () => {
    await mcapStore.getState().demarrerBackfill(deps());
    const d = deps();
    await mcapStore.getState().prolonger(false, d);
    expect(d.fetchMarchesEtGlobal).not.toHaveBeenCalled();
  });
});

describe("sélection des dominances", () => {
  it("refuse d'aller au-delà du plafond", async () => {
    await mcapStore.getState().demarrerBackfill(deps());
    mcapStore.setState({
      dominances: ["bitcoin", "ethereum", "solana", "a", "b", "c"].slice(0, PLAFOND_DOMINANCES),
    });

    await mcapStore.getState().ajouterDominance("ripple", deps());

    expect(mcapStore.getState().dominances).toHaveLength(PLAFOND_DOMINANCES);
    expect(mcapStore.getState().erreur).not.toBeNull();
  });

  it("n'ajoute pas deux fois la même pièce", async () => {
    await mcapStore.getState().ajouterDominance("bitcoin", deps());
    expect(mcapStore.getState().dominances).toEqual(["bitcoin", "ethereum"]);
  });

  it("ajoute la dominance agrégée des alts sans aucun appel réseau", async () => {
    const d = deps();
    await mcapStore.getState().ajouterDominance(ID_ALTS, d);
    expect(mcapStore.getState().dominances).toContain(ID_ALTS);
    expect(d.fetchPiece).not.toHaveBeenCalled();
  });

  it("télécharge et met en cache la série d'une nouvelle pièce", async () => {
    await mcapStore.getState().demarrerBackfill(deps());
    const d = deps();
    d.fetchPiece = vi.fn(async () => serie(5, 42));

    await mcapStore.getState().ajouterDominance("solana", d);

    expect(d.fetchPiece.mock.calls[0]?.[0]).toBe("solana");
    expect(mcapStore.getState().hist?.pieces["solana"]).toBeDefined();
    expect(mcapStore.getState().dominances).toContain("solana");
  });

  it("retire une dominance sans purger son cache", async () => {
    await mcapStore.getState().demarrerBackfill(deps());
    mcapStore.getState().retirerDominance("ethereum");

    expect(mcapStore.getState().dominances).toEqual(["bitcoin"]);
    expect(mcapStore.getState().hist?.pieces["ethereum"]).toBeDefined();
  });
});

describe("persistance tolérante", () => {
  it("ignore un historique corrompu ou d'une version inconnue", () => {
    localStorage.setItem("axiom:mcap:v1", "{ pas du json");
    expect(lireHistoriquePersiste()).toBeNull();

    localStorage.setItem("axiom:mcap:v1", JSON.stringify({ version: 99, grille: [], total: [] }));
    expect(lireHistoriquePersiste()).toBeNull();

    localStorage.setItem("axiom:mcap:v1", JSON.stringify({ version: 1, grille: [1, 2], total: [1] }));
    expect(lireHistoriquePersiste()).toBeNull(); // longueurs incohérentes
  });

  it("relit un historique valide", async () => {
    await mcapStore.getState().demarrerBackfill(deps());
    expect(lireHistoriquePersiste()?.total).toEqual(mcapStore.getState().hist?.total);
  });
});
