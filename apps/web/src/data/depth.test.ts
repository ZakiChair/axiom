/**
 * Tests de la logique PURE du carnet d'ordres (depth.ts) — couture snapshot↔diffs,
 * application live, agrégation par pas et profondeur cumulée. Ces fonctions pilotent
 * le DOM/depth chart ; une régression silencieuse ici corromprait le carnet (trou non
 * détecté, niveaux mal fusionnés) sans erreur de compilation. Valeurs justifiées en
 * commentaire d'après la procédure officielle Binance.
 */
import { describe, expect, it, vi } from "vitest";
import {
  agregerNiveaux,
  appliquerDiffLive,
  construireLivre,
  coudre,
  creerMultiplexeurDepth,
  mediane,
  meilleursNiveaux,
  pasArrondi,
  profondeurCumulee,
  type DepthDiff,
  type Niveau,
  type OrderBook,
  type OrderBookSnapshot,
  type OuvreurDepth,
} from "./depth";

function snap(lastUpdateId: number, bids: Niveau[], asks: Niveau[]): OrderBookSnapshot {
  return { lastUpdateId, bids, asks };
}
function diff(U: number, u: number, bids: Niveau[] = [], asks: Niveau[] = []): DepthDiff {
  return { U, u, bids, asks };
}
/** Carnet couturé attendu "ok" (échoue le test sinon). */
function livreOk(res: ReturnType<typeof coudre>): OrderBook {
  if (res.statut !== "ok") throw new Error(`attendu ok, reçu ${res.statut}`);
  return res.livre;
}

describe("construireLivre", () => {
  it("ignore les niveaux de quantité nulle du snapshot", () => {
    const livre = construireLivre(snap(10, [[100, 2], [99, 0]], [[101, 0], [102, 3]]));
    expect(livre.bids.get(100)).toBe(2);
    expect(livre.bids.has(99)).toBe(false);
    expect(livre.asks.has(101)).toBe(false);
    expect(livre.asks.get(102)).toBe(3);
    expect(livre.lastUpdateId).toBe(10);
  });
});

describe("coudre", () => {
  it("applique des diffs contigus et fait progresser lastUpdateId", () => {
    // snapshot lastUpdateId=100 ; diffs 101-102 puis 103-104 (contigus U=u_préc+1).
    const s = snap(100, [[10, 1]], [[11, 1]]);
    const res = coudre(s, [
      diff(101, 102, [[10, 5]], [[11, 0]]), // bid 10 → 5, ask 11 supprimé
      diff(103, 104, [], [[12, 4]]), // ask 12 = 4
    ]);
    const livre = livreOk(res);
    expect(livre.bids.get(10)).toBe(5);
    expect(livre.asks.has(11)).toBe(false);
    expect(livre.asks.get(12)).toBe(4);
    expect(livre.lastUpdateId).toBe(104);
  });

  it("rejette les diffs déjà couverts par le snapshot (u <= lastUpdateId)", () => {
    // Les deux 1ers diffs sont obsolètes (u <= 100) ; seul le 3ᵉ (101-102) s'applique.
    const s = snap(100, [[10, 1]], []);
    const res = coudre(s, [
      diff(90, 95, [[10, 9]]), // obsolète
      diff(96, 100, [[10, 8]]), // obsolète (u==100)
      diff(101, 102, [[10, 7]]), // 1er exploitable (U=101 == 100+1)
    ]);
    const livre = livreOk(res);
    expect(livre.bids.get(10)).toBe(7);
    expect(livre.lastUpdateId).toBe(102);
  });

  it("signale snapshot-obsolete quand lastUpdateId < U du 1er diff bufferisé", () => {
    // 1er diff commence à U=200 mais le snapshot n'atteint que 150 → snapshot trop vieux.
    const res = coudre(snap(150, [[10, 1]], []), [diff(200, 210)]);
    expect(res.statut).toBe("snapshot-obsolete");
  });

  it("signale snapshot-obsolete quand le 1er diff exploitable dépasse lastUpdateId+1", () => {
    // Le 1er diff (90-95) est obsolète ; le 1er exploitable a U=103 > 101 → snapshot trop
    // vieux vs le buffer (à re-fetch en gardant le buffer).
    const res = coudre(snap(100, [[10, 1]], []), [diff(90, 95), diff(103, 110)]);
    expect(res.statut).toBe("snapshot-obsolete");
  });

  it("signale un trou en cas de rupture de contiguïté au milieu du buffer", () => {
    // 101-102 OK puis saut à U=104 (attendu 103) → trou.
    const res = coudre(snap(100, [], []), [diff(101, 102), diff(104, 105)]);
    expect(res.statut).toBe("trou");
  });

  it("attend quand aucun diff n'est encore bufferisé", () => {
    expect(coudre(snap(100, [], []), []).statut).toBe("attente");
  });

  it("supprime un niveau via une quantité nulle dans un diff", () => {
    const res = coudre(snap(100, [[10, 3]], []), [diff(101, 101, [[10, 0]])]);
    const livre = livreOk(res);
    expect(livre.bids.has(10)).toBe(false);
  });
});

describe("appliquerDiffLive", () => {
  function livre(lastUpdateId: number): OrderBook {
    return { lastUpdateId, bids: new Map([[10, 1]]), asks: new Map([[11, 1]]) };
  }

  it("applique un diff contigu (U == lastUpdateId+1) et avance lastUpdateId", () => {
    const l = livre(100);
    expect(appliquerDiffLive(l, diff(101, 105, [[10, 9]], [[11, 0]]))).toBe("ok");
    expect(l.bids.get(10)).toBe(9);
    expect(l.asks.has(11)).toBe(false);
    expect(l.lastUpdateId).toBe(105);
  });

  it("ignore un diff obsolète (u <= lastUpdateId) sans muter le carnet", () => {
    const l = livre(100);
    expect(appliquerDiffLive(l, diff(95, 100, [[10, 42]]))).toBe("obsolete");
    expect(l.bids.get(10)).toBe(1); // inchangé
    expect(l.lastUpdateId).toBe(100);
  });

  it("détecte un trou quand U > lastUpdateId+1 (event(s) manqué(s))", () => {
    const l = livre(100);
    expect(appliquerDiffLive(l, diff(103, 110, [[10, 42]]))).toBe("trou");
    expect(l.bids.get(10)).toBe(1); // non appliqué
    expect(l.lastUpdateId).toBe(100);
  });
});

describe("pasArrondi", () => {
  it("choisit un pas rond 1/2/5 × 10ⁿ selon la magnitude", () => {
    expect(pasArrondi(60000)).toBeCloseTo(20, 10); // 60000/2000=30 → 2×10
    expect(pasArrondi(100)).toBeCloseTo(0.05, 10); // 0.05 → 5×0.01
    expect(pasArrondi(1)).toBeCloseTo(0.0005, 12); // 0.0005 → 5×1e-4
  });
  it("renvoie un pas positif de repli sur prix invalide", () => {
    expect(pasArrondi(0)).toBe(1);
    expect(pasArrondi(Number.NaN)).toBe(1);
  });
});

describe("agregerNiveaux", () => {
  it("bucketise les bids vers le bas, somme et trie décroissant", () => {
    // pas=10 : 104/103 → seau 100 (floor), 96 → seau 90.
    const bids: Niveau[] = [[104, 1], [103, 2], [96, 5]];
    const agg = agregerNiveaux(bids, 10, "bid", 10);
    expect(agg).toEqual([
      { prix: 100, qte: 3 }, // 104+103 fusionnés
      { prix: 90, qte: 5 },
    ]);
  });

  it("bucketise les asks vers le haut, somme et trie croissant", () => {
    // pas=10 : 101/102 → seau 110 (ceil), 118 → seau 120.
    const asks: Niveau[] = [[101, 1], [102, 2], [118, 4]];
    const agg = agregerNiveaux(asks, 10, "ask", 10);
    expect(agg).toEqual([
      { prix: 110, qte: 3 },
      { prix: 120, qte: 4 },
    ]);
  });

  it("borne le résultat à la limite (niveaux les plus proches du mid)", () => {
    const bids: Niveau[] = [[100, 1], [90, 1], [80, 1], [70, 1]];
    const agg = agregerNiveaux(bids, 10, "bid", 2);
    expect(agg.map((n) => n.prix)).toEqual([100, 90]); // les 2 plus hauts (proches du mid)
  });
});

describe("mediane", () => {
  it("médiane d'une série impaire", () => {
    expect(mediane([3, 1, 2])).toBe(2);
  });
  it("médiane d'une série paire (moyenne des deux centraux)", () => {
    expect(mediane([1, 2, 3, 4])).toBe(2.5);
  });
  it("série vide → 0", () => {
    expect(mediane([])).toBe(0);
  });
});

describe("creerMultiplexeurDepth", () => {
  /** Carnet factice minimal (l'identité suffit : on teste le fan-out, pas le contenu). */
  function livre(lastUpdateId: number): OrderBook {
    return { lastUpdateId, bids: new Map(), asks: new Map() };
  }

  /**
   * Ouvreur FACTICE : enregistre chaque ouverture (symbole + diffuseur + spy de fermeture),
   * sans aucun WS — c'est ce qui rend le comptage testable en Node.
   */
  function faireOuvreur() {
    const ouvertures: Array<{
      symbol: string;
      diffuser: (l: OrderBook) => void;
      fermer: ReturnType<typeof vi.fn>;
    }> = [];
    const ouvrir: OuvreurDepth = (symbol, diffuser) => {
      const fermer = vi.fn();
      ouvertures.push({ symbol, diffuser, fermer });
      return fermer;
    };
    return { ouvrir, ouvertures };
  }

  it("n'ouvre qu'UNE connexion pour N abonnés au même symbole", () => {
    const { ouvrir, ouvertures } = faireOuvreur();
    const mux = creerMultiplexeurDepth(ouvrir);
    mux.souscrire("BTCUSDT", () => {});
    mux.souscrire("BTCUSDT", () => {});
    expect(ouvertures).toHaveLength(1); // 2e abonné → pas de nouvelle ouverture
  });

  it("garde la connexion vivante sur un désabonnement PARTIEL", () => {
    const { ouvrir, ouvertures } = faireOuvreur();
    const mux = creerMultiplexeurDepth(ouvrir);
    const off1 = mux.souscrire("BTCUSDT", () => {});
    mux.souscrire("BTCUSDT", () => {});
    off1();
    expect(ouvertures[0]?.fermer).not.toHaveBeenCalled(); // un abonné reste
  });

  it("ferme la connexion au DERNIER désabonnement", () => {
    const { ouvrir, ouvertures } = faireOuvreur();
    const mux = creerMultiplexeurDepth(ouvrir);
    const off1 = mux.souscrire("BTCUSDT", () => {});
    const off2 = mux.souscrire("BTCUSDT", () => {});
    off1();
    off2();
    expect(ouvertures[0]?.fermer).toHaveBeenCalledTimes(1);
  });

  it("diffuse chaque mise à jour à TOUS les abonnés du symbole", () => {
    const { ouvrir, ouvertures } = faireOuvreur();
    const mux = creerMultiplexeurDepth(ouvrir);
    const recu1: number[] = [];
    const recu2: number[] = [];
    mux.souscrire("BTCUSDT", (l) => recu1.push(l.lastUpdateId));
    mux.souscrire("BTCUSDT", (l) => recu2.push(l.lastUpdateId));
    ouvertures[0]?.diffuser(livre(7));
    expect(recu1).toEqual([7]);
    expect(recu2).toEqual([7]);
  });

  it("cesse de livrer à un abonné désabonné (les autres continuent)", () => {
    const { ouvrir, ouvertures } = faireOuvreur();
    const mux = creerMultiplexeurDepth(ouvrir);
    const recu1: number[] = [];
    const recu2: number[] = [];
    const off1 = mux.souscrire("BTCUSDT", (l) => recu1.push(l.lastUpdateId));
    mux.souscrire("BTCUSDT", (l) => recu2.push(l.lastUpdateId));
    off1();
    ouvertures[0]?.diffuser(livre(9));
    expect(recu1).toEqual([]); // désabonné → plus rien
    expect(recu2).toEqual([9]); // l'autre reçoit toujours
  });

  it("ouvre des connexions SÉPARÉES pour des symboles différents", () => {
    const { ouvrir, ouvertures } = faireOuvreur();
    const mux = creerMultiplexeurDepth(ouvrir);
    mux.souscrire("BTCUSDT", () => {});
    mux.souscrire("ETHUSDT", () => {});
    expect(ouvertures.map((o) => o.symbol)).toEqual(["BTCUSDT", "ETHUSDT"]);
  });

  it("ré-ouvre après fermeture complète (nouvelle connexion)", () => {
    const { ouvrir, ouvertures } = faireOuvreur();
    const mux = creerMultiplexeurDepth(ouvrir);
    const off = mux.souscrire("BTCUSDT", () => {});
    off();
    mux.souscrire("BTCUSDT", () => {});
    expect(ouvertures).toHaveLength(2); // 1re fermée, 2de rouverte
  });

  it("est idempotent sur un double désabonnement (ne ferme qu'une fois)", () => {
    const { ouvrir, ouvertures } = faireOuvreur();
    const mux = creerMultiplexeurDepth(ouvrir);
    const off = mux.souscrire("BTCUSDT", () => {});
    off();
    off(); // 2e appel : sans effet
    expect(ouvertures[0]?.fermer).toHaveBeenCalledTimes(1);
  });

  it("rejoue SYNCHRONEMENT le dernier carnet diffusé au nouvel abonné tardif", () => {
    // Un 2e abonné qui rejoint une connexion vivante recevrait sinon RIEN jusqu'au prochain
    // diff du stream (~100 ms BTC, plusieurs s sur illiquide → DOM/BOOK vide). Réplay immédiat.
    const { ouvrir, ouvertures } = faireOuvreur();
    const mux = creerMultiplexeurDepth(ouvrir);
    mux.souscrire("BTCUSDT", () => {});
    ouvertures[0]?.diffuser(livre(42)); // carnet vivant caché dans l'entrée
    const recu2: number[] = [];
    mux.souscrire("BTCUSDT", (l) => recu2.push(l.lastUpdateId)); // abonné tardif
    expect(recu2).toEqual([42]); // reçu immédiatement, sans attendre un diff
  });

  it("ne rejoue RIEN au 1er abonné d'une connexion neuve (aucun carnet encore diffusé)", () => {
    const { ouvrir } = faireOuvreur();
    const mux = creerMultiplexeurDepth(ouvrir);
    const recu: number[] = [];
    mux.souscrire("BTCUSDT", (l) => recu.push(l.lastUpdateId));
    expect(recu).toEqual([]); // rien avant le 1er livre du stream
  });

  it("le réplay au nouvel abonné ne re-déclenche PAS les abonnés déjà présents", () => {
    const { ouvrir, ouvertures } = faireOuvreur();
    const mux = creerMultiplexeurDepth(ouvrir);
    const recu1: number[] = [];
    mux.souscrire("BTCUSDT", (l) => recu1.push(l.lastUpdateId));
    ouvertures[0]?.diffuser(livre(42));
    expect(recu1).toEqual([42]); // 1 seule livraison via le fan-out
    mux.souscrire("BTCUSDT", () => {}); // abonné tardif → réplay CIBLÉ
    expect(recu1).toEqual([42]); // le 1er abonné n'a pas reçu de doublon
  });
});

describe("meilleursNiveaux", () => {
  function bk(bids: Niveau[], asks: Niveau[]): OrderBook {
    return { lastUpdateId: 1, bids: new Map(bids), asks: new Map(asks) };
  }
  it("carnet vide ou côté manquant → null", () => {
    expect(meilleursNiveaux(bk([], []))).toBeNull();
    expect(meilleursNiveaux(bk([[100, 1]], []))).toBeNull();
    expect(meilleursNiveaux(bk([], [[101, 1]]))).toBeNull();
  });
  it("meilleur bid (max), meilleur ask (min) et mid", () => {
    expect(meilleursNiveaux(bk([[99, 1], [100, 2]], [[102, 1], [101, 3]]))).toEqual({
      bestBid: 100,
      bestAsk: 101,
      mid: 100.5,
    });
  });
});

describe("profondeurCumulee", () => {
  it("cumule les bids du mid vers le bas (prix décroissant)", () => {
    const pts = profondeurCumulee([[98, 2], [100, 1], [99, 3]], "bid");
    expect(pts).toEqual([
      { prix: 100, cumul: 1 },
      { prix: 99, cumul: 4 },
      { prix: 98, cumul: 6 },
    ]);
  });
  it("cumule les asks du mid vers le haut (prix croissant)", () => {
    const pts = profondeurCumulee([[102, 2], [101, 1], [103, 3]], "ask");
    expect(pts).toEqual([
      { prix: 101, cumul: 1 },
      { prix: 102, cumul: 3 },
      { prix: 103, cumul: 6 },
    ]);
  });
});
