/**
 * Tests du scanner NAVIGATEUR de la couche LIQHL (mode Vercel, ou local sans daemon) :
 * fonctions PURES (pool stocké, publication, échéance du prochain cycle) et cycle de vie du
 * scanner avec dépendances injectées (fetch, stockage, visibilité, horloge) — pool servi par
 * le stockage, par /hlpool ou par le repli direct du leaderboard, progression publiée,
 * changement de coin sans nouveau scan, pause d'onglet caché, arrêt propre, rescan 5 min.
 *
 * ⚠️ HONNÊTETÉ : même source que le mode daemon — un ÉCHANTILLON du leaderboard, jamais
 * « toutes » les liquidations.
 */
import { describe, expect, it } from "vitest";
import {
  CLE_POOL_HL,
  creerScannerNavigateurHl,
  DELAI_REESSAI_ECHEC_MS,
  delaiProchainCycle,
  lirePoolStocke,
  PERIODE_SCAN_MS,
  publicationNavigateur,
  URL_HLPOOL,
  type DependancesScannerHl,
  type PublicationHlNavigateur,
} from "./hyperliquidLiqNavigateur";
import {
  N_VALEUR_POOL,
  TAILLE_POOL,
  TTL_POOL_MS,
  URL_INFO,
  URL_LEADERBOARD,
  type InstantaneHL,
  type NiveauLiqHL,
} from "../../../../shared/hyperliquidScan";

const T0 = Date.UTC(2026, 8, 25, 12, 0, 0);

function adresse(i: number): string {
  return `0x${i.toString(16).padStart(40, "0")}`;
}

function niveau(px: number, addr = adresse(1)): NiveauLiqHL {
  return { px, side: "long", valueUsd: 50_000, entryPx: px * 2, lev: 2, addr };
}

function instantane(parCoin: Record<string, NiveauLiqHL[]>, adressesScannees = 10, ts = T0): InstantaneHL {
  return { ts, adressesScannees, parCoin: new Map(Object.entries(parCoin)) };
}

// ─────────────────────────── Fonctions PURES ───────────────────────────

describe("lirePoolStocke — pool du stockage local", () => {
  it("JSON conforme → pool typé ; absent, corrompu ou non conforme → null", () => {
    const pool = { adresses: [adresse(1)], ts: T0, nValeur: N_VALEUR_POOL, tailleCible: TAILLE_POOL };
    expect(lirePoolStocke(JSON.stringify(pool))).toEqual(pool);
    expect(lirePoolStocke(null)).toBeNull();
    expect(lirePoolStocke("{pas du json")).toBeNull();
    expect(lirePoolStocke(JSON.stringify({ adresses: [], ts: T0 }))).toBeNull();
  });
});

describe("publicationNavigateur — ce que la couche affiche", () => {
  const partiel = instantane({ BTC: [niveau(30_000)] }, 20);

  it("coin inextricable (symbole synthétique) → « vide », rien à montrer", () => {
    expect(publicationNavigateur({ complet: null, partiel, phase: "scan", progression: null, coin: null })).toEqual({
      etat: "vide",
      niveaux: [],
      ts: 0,
      adressesScannees: 0,
      progression: null,
    });
  });

  it("pool en chargement → « chargement » SANS progression (légende « chargement du pool »)", () => {
    const p = publicationNavigateur({ complet: null, partiel: null, phase: "pool", progression: null, coin: "BTC" });
    expect(p.etat).toBe("chargement");
    expect(p.progression).toBeNull();
  });

  it("scan en cours : niveaux PARTIELS du coin + progression ; « chargement » tant qu'aucun niveau", () => {
    const prog = { faites: 20, total: 1500 };
    const avec = publicationNavigateur({ complet: null, partiel, phase: "scan", progression: prog, coin: "BTC" });
    expect(avec).toEqual({ etat: "ok", niveaux: [niveau(30_000)], ts: T0, adressesScannees: 20, progression: prog });
    const sans = publicationNavigateur({ complet: null, partiel, phase: "scan", progression: prog, coin: "ETH" });
    expect(sans.etat).toBe("chargement"); // jamais « aucun niveau » avant la fin du scan
    expect(sans.progression).toEqual(prog);
    const debut = publicationNavigateur({
      complet: null,
      partiel: null,
      phase: "scan",
      progression: { faites: 0, total: 1500 },
      coin: "BTC",
    });
    expect(debut.etat).toBe("chargement");
    expect(debut.progression).toEqual({ faites: 0, total: 1500 });
  });

  it("instantané complet → « ok » ou « vide » selon le coin, sans progression (rescan silencieux)", () => {
    const complet = instantane({ BTC: [niveau(30_000), niveau(31_000)] }, 1480);
    const btc = publicationNavigateur({ complet, partiel, phase: "scan", progression: { faites: 8, total: 1500 }, coin: "BTC" });
    expect(btc).toEqual({
      etat: "ok",
      niveaux: [niveau(30_000), niveau(31_000)],
      ts: T0,
      adressesScannees: 1480,
      progression: null,
    });
    const eth = publicationNavigateur({ complet, partiel: null, phase: null, progression: null, coin: "ETH" });
    expect(eth.etat).toBe("vide");
    expect(eth.adressesScannees).toBe(1480);
  });

  it("échec sans aucun instantané complet → « erreur » ; un complet antérieur reste affiché", () => {
    expect(publicationNavigateur({ complet: null, partiel: null, phase: "erreur", progression: null, coin: "BTC" }).etat).toBe(
      "erreur",
    );
    const complet = instantane({ BTC: [niveau(30_000)] });
    expect(publicationNavigateur({ complet, partiel: null, phase: "erreur", progression: null, coin: "BTC" }).etat).toBe("ok");
  });
});

describe("delaiProchainCycle — rescan 5 min, réessai 2 min après un échec", () => {
  it("aucun instantané ni échec → tout de suite", () => {
    expect(delaiProchainCycle(null, null, T0)).toBe(0);
  });
  it("instantané complet : 5 min après SON horodatage (début du scan)", () => {
    expect(PERIODE_SCAN_MS).toBe(5 * 60_000);
    expect(delaiProchainCycle(T0, null, T0 + 240_000)).toBe(60_000);
    expect(delaiProchainCycle(T0, null, T0 + 400_000)).toBe(0);
  });
  it("échec : pas de réessai avant DELAI_REESSAI_ECHEC_MS (pas de boucle serrée contre un amont en panne)", () => {
    expect(DELAI_REESSAI_ECHEC_MS).toBe(2 * 60_000);
    expect(delaiProchainCycle(null, T0, T0 + 1_000)).toBe(DELAI_REESSAI_ECHEC_MS - 1_000);
    expect(delaiProchainCycle(T0 - 600_000, T0, T0)).toBe(DELAI_REESSAI_ECHEC_MS);
  });
});

// ─────────────────────────── Cycle de vie (dépendances injectées) ───────────────────────────

interface Minuteur {
  fn: () => void;
  ms: number;
  id: number;
}

/** Horloge manuelle : `now` réglable, minuteurs journalisés, déclenchés à la demande. */
function horlogeManuelle(): DependancesScannerHl["horloge"] & {
  t: number;
  minuteurs: Minuteur[];
  declencher: (predicat: (m: Minuteur) => boolean) => void;
} {
  let id = 0;
  const h = {
    t: T0,
    minuteurs: [] as Minuteur[],
    now: () => h.t,
    setTimeout: (fn: () => void, ms: number) => {
      id += 1;
      h.minuteurs.push({ fn, ms, id });
      return id;
    },
    clearTimeout: (x: unknown) => {
      h.minuteurs = h.minuteurs.filter((m) => m.id !== x);
    },
    declencher: (predicat: (m: Minuteur) => boolean) => {
      const choisis = h.minuteurs.filter(predicat);
      h.minuteurs = h.minuteurs.filter((m) => !predicat(m));
      for (const m of choisis) m.fn();
    },
  };
  return h;
}

/** Stockage en mémoire (Storage minimal) ; `jette` simule un stockage bloqué. */
function stockageMemoire(jette = false): Pick<Storage, "getItem" | "setItem"> & { donnees: Map<string, string> } {
  const donnees = new Map<string, string>();
  return {
    donnees,
    getItem: (k) => {
      if (jette) throw new Error("SecurityError");
      return donnees.get(k) ?? null;
    },
    setItem: (k, v) => {
      if (jette) throw new Error("QuotaExceededError");
      donnees.set(k, v);
    },
  };
}

/** Visibilité pilotable (onglet caché / visible). */
function visibilite(cachee = false): DependancesScannerHl["visibilite"] & { basculer: (c: boolean) => void } {
  let etat = cachee;
  const abonnes = new Set<() => void>();
  return {
    cachee: () => etat,
    surChangement: (fn) => {
      abonnes.add(fn);
      return () => abonnes.delete(fn);
    },
    basculer: (c) => {
      etat = c;
      for (const fn of [...abonnes]) fn();
    },
  };
}

/** Compte HL avec une position sur `coin`. */
function etatCompte(coin: string, px: number): unknown {
  return {
    assetPositions: [
      { position: { coin, szi: "1", entryPx: String(px * 2), liquidationPx: String(px), positionValue: "50000", leverage: { value: 2 } } },
    ],
  };
}

interface OptionsFetch {
  hlpool?: "json" | "html" | "panne";
  leaderboard?: "ok" | "panne";
  nPool?: number;
}

/** Faux réseau : /hlpool, leaderboard, POST /info (BTC pour les adresses paires, ETH sinon). */
function reseau(o: OptionsFetch = {}): { fetchImpl: typeof fetch; appels: string[] } {
  const n = o.nPool ?? 12;
  const pool = Array.from({ length: n }, (_, i) => adresse(i + 1));
  const appels: string[] = [];
  const fetchImpl = (async (entree: RequestInfo | URL, init?: RequestInit) => {
    const url = String(entree);
    if (url === URL_HLPOOL) {
      appels.push("hlpool");
      if (o.hlpool === "panne") throw new Error("réseau");
      if (o.hlpool === "html" || o.hlpool === undefined) {
        // Vite / vite preview / daemon : repli SPA → index.html en 200.
        return new Response("<!doctype html><html></html>", { headers: { "content-type": "text/html" } });
      }
      return new Response(JSON.stringify({ ts: T0, nValeur: N_VALEUR_POOL, tailleCible: TAILLE_POOL, adresses: pool }), {
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    if (url === URL_LEADERBOARD) {
      appels.push("leaderboard");
      if (o.leaderboard === "panne") return new Response("panne", { status: 502 });
      return new Response(
        JSON.stringify({ leaderboardRows: pool.map((a, i) => ({ ethAddress: a, accountValue: String(1000 - i) })) }),
      );
    }
    if (url === URL_INFO) {
      const user = (JSON.parse(String(init?.body ?? "{}")) as { user: string }).user;
      appels.push(`info:${user}`);
      const i = pool.indexOf(user);
      return new Response(JSON.stringify(etatCompte(i % 2 === 0 ? "BTC" : "ETH", 30_000 + i)));
    }
    throw new Error(`URL inattendue ${url}`);
  }) as typeof fetch;
  return { fetchImpl, appels };
}

function monter(o: {
  fetchImpl: typeof fetch;
  stockage?: ReturnType<typeof stockageMemoire> | null;
  vis?: ReturnType<typeof visibilite>;
}) {
  const horloge = horlogeManuelle();
  const publications: PublicationHlNavigateur[] = [];
  const scanner = creerScannerNavigateurHl({
    fetchImpl: o.fetchImpl,
    stockage: () => (o.stockage === undefined ? stockageMemoire() : o.stockage),
    visibilite: o.vis ?? visibilite(),
    horloge,
    publier: (p) => publications.push(p),
    journal: () => {},
    optionsScan: { intervalleLotMs: 0, lotsParProgression: 1 },
  });
  return { scanner, horloge, publications, derniere: () => publications[publications.length - 1] };
}

describe("scanner navigateur — pool puis scan, progression publiée", () => {
  it("repli direct : /hlpool renvoie le HTML du repli SPA → leaderboard téléchargé, pool stocké", async () => {
    const { fetchImpl, appels } = reseau({ hlpool: "html" });
    const stockage = stockageMemoire();
    const { scanner, publications, derniere } = monter({ fetchImpl, stockage });
    scanner.demarrer("BTC");
    expect(derniere()?.etat).toBe("chargement"); // « chargement du pool »
    expect(derniere()?.progression).toBeNull();
    await scanner.attendreCycle();
    expect(appels.slice(0, 2)).toEqual(["hlpool", "leaderboard"]);
    const stocke = JSON.parse(stockage.donnees.get(CLE_POOL_HL) ?? "null") as { adresses: string[]; nValeur: number };
    expect(stocke.adresses).toHaveLength(12);
    expect(stocke.nValeur).toBe(N_VALEUR_POOL);
    // Progression : 0/12 au lancement du scan, puis 4/12 et 8/12 (un rappel par lot ici).
    const progressions = publications.map((p) => p.progression).filter((p) => p !== null);
    expect(progressions).toEqual([
      { faites: 0, total: 12 },
      { faites: 4, total: 12 },
      { faites: 8, total: 12 },
    ]);
    // Barres dès le premier lot (adresses 1 et 3 → BTC).
    expect(publications.find((p) => p.progression?.faites === 4)?.niveaux).toHaveLength(2);
    expect(derniere()).toMatchObject({ etat: "ok", adressesScannees: 12, progression: null, ts: T0 });
    expect(derniere()?.niveaux).toHaveLength(6);
  });

  it("/hlpool JSON conforme → ni leaderboard ni repli ; pool stocké", async () => {
    const { fetchImpl, appels } = reseau({ hlpool: "json" });
    const stockage = stockageMemoire();
    const { scanner } = monter({ fetchImpl, stockage });
    scanner.demarrer("BTC");
    await scanner.attendreCycle();
    expect(appels).not.toContain("leaderboard");
    expect(stockage.donnees.has(CLE_POOL_HL)).toBe(true);
  });

  it("pool stocké frais (mêmes paramètres, < 6 h) → aucun appel de pool", async () => {
    const { fetchImpl, appels } = reseau();
    const stockage = stockageMemoire();
    stockage.setItem(
      CLE_POOL_HL,
      JSON.stringify({ adresses: [adresse(1), adresse(2)], ts: T0 - TTL_POOL_MS + 60_000, nValeur: N_VALEUR_POOL, tailleCible: TAILLE_POOL }),
    );
    const { scanner, derniere } = monter({ fetchImpl, stockage });
    scanner.demarrer("BTC");
    await scanner.attendreCycle();
    expect(appels).toEqual([`info:${adresse(1)}`, `info:${adresse(2)}`]);
    expect(derniere()?.adressesScannees).toBe(2);
  });

  it("stockage bloqué (accès qui jette) : le scan fonctionne quand même", async () => {
    const { fetchImpl } = reseau({ hlpool: "json" });
    const { scanner, derniere } = monter({ fetchImpl, stockage: stockageMemoire(true) });
    scanner.demarrer("BTC");
    await scanner.attendreCycle();
    expect(derniere()?.etat).toBe("ok");
  });

  it("aucun pool (hlpool KO, leaderboard KO, rien de stocké) → « erreur », réessai dans 2 min", async () => {
    const { fetchImpl, appels } = reseau({ hlpool: "panne", leaderboard: "panne" });
    const { scanner, horloge, derniere } = monter({ fetchImpl });
    scanner.demarrer("BTC");
    await scanner.attendreCycle();
    expect(derniere()?.etat).toBe("erreur");
    expect(appels.filter((a) => a.startsWith("info:"))).toEqual([]);
    expect(horloge.minuteurs.map((m) => m.ms)).toEqual([DELAI_REESSAI_ECHEC_MS]);
  });

  it("pool stocké PÉRIMÉ réutilisé si /hlpool et le leaderboard échouent (repli comme le daemon)", async () => {
    const { fetchImpl } = reseau({ hlpool: "panne", leaderboard: "panne" });
    const stockage = stockageMemoire();
    stockage.setItem(CLE_POOL_HL, JSON.stringify({ adresses: [adresse(1)], ts: T0 - 2 * TTL_POOL_MS, nValeur: 150, tailleCible: 500 }));
    const { scanner, derniere } = monter({ fetchImpl, stockage });
    scanner.demarrer("BTC");
    await scanner.attendreCycle();
    expect(derniere()).toMatchObject({ etat: "ok", adressesScannees: 1 });
  });
});

describe("scanner navigateur — un instantané pour tous les coins, rescan, arrêt, pause", () => {
  it("changer de coin republie depuis le MÊME instantané, sans aucun appel réseau", async () => {
    const { fetchImpl, appels } = reseau({ hlpool: "json" });
    const { scanner, derniere } = monter({ fetchImpl });
    scanner.demarrer("BTC");
    await scanner.attendreCycle();
    const n = appels.length;
    scanner.definirCoin("ETH");
    expect(derniere()).toMatchObject({ etat: "ok", adressesScannees: 12 });
    expect(derniere()?.niveaux.every((x) => x.addr !== adresse(1))).toBe(true);
    scanner.definirCoin("SOL");
    expect(derniere()?.etat).toBe("vide");
    scanner.definirCoin(null);
    expect(derniere()?.etat).toBe("vide");
    expect(appels.length).toBe(n);
  });

  it("rescan 5 min après le début du scan ; l'instantané complet reste affiché pendant le rescan", async () => {
    const { fetchImpl, appels } = reseau({ hlpool: "json" });
    const { scanner, horloge, publications } = monter({ fetchImpl });
    scanner.demarrer("BTC");
    await scanner.attendreCycle();
    expect(horloge.minuteurs.map((m) => m.ms)).toEqual([PERIODE_SCAN_MS]);
    const avant = publications.length;
    horloge.t += PERIODE_SCAN_MS;
    horloge.declencher((m) => m.ms === PERIODE_SCAN_MS);
    await scanner.attendreCycle();
    // Pool gardé en mémoire (< 6 h) : un seul /hlpool sur les deux cycles.
    expect(appels.filter((a) => a === "hlpool")).toHaveLength(1);
    expect(appels.filter((a) => a.startsWith("info:"))).toHaveLength(24);
    // Aucune publication « chargement » ni progression pendant le rescan.
    const pendant = publications.slice(avant);
    expect(pendant.every((p) => p.etat === "ok" && p.progression === null)).toBe(true);
    expect(pendant[pendant.length - 1]?.ts).toBe(T0 + PERIODE_SCAN_MS);
  });

  it("arrêt (couche OFF) pendant le scan : plus aucun lot envoyé, plus aucune publication, minuteur coupé", async () => {
    const { fetchImpl: base, appels } = reseau({ hlpool: "json", nPool: 40 });
    let scanner: ReturnType<typeof monter>["scanner"] | null = null;
    const fetchImpl = (async (e: RequestInfo | URL, i?: RequestInit) => {
      const r = await base(e, i);
      if (appels.filter((a) => a.startsWith("info:")).length === 8) scanner?.arreter();
      return r;
    }) as typeof fetch;
    const m = monter({ fetchImpl });
    scanner = m.scanner;
    m.scanner.demarrer("BTC");
    await m.scanner.attendreCycle();
    const nPublications = m.publications.length;
    expect(appels.filter((a) => a.startsWith("info:"))).toHaveLength(8);
    expect(m.horloge.minuteurs).toEqual([]);
    m.scanner.definirCoin("ETH");
    expect(m.publications.length).toBe(nPublications);
  });

  it("re-démarrage dans les 5 min : l'instantané complet est republié tout de suite, pas de nouveau scan", async () => {
    const { fetchImpl, appels } = reseau({ hlpool: "json" });
    const { scanner, horloge, derniere } = monter({ fetchImpl });
    scanner.demarrer("BTC");
    await scanner.attendreCycle();
    scanner.arreter();
    const n = appels.length;
    horloge.t += 60_000;
    scanner.demarrer("BTC");
    expect(derniere()).toMatchObject({ etat: "ok", adressesScannees: 12 });
    expect(horloge.minuteurs.map((m) => m.ms)).toEqual([PERIODE_SCAN_MS - 60_000]);
    expect(appels.length).toBe(n);
  });

  it("onglet caché : le scan attend avant chaque lot et reprend au retour (aucune requête pendant la pause)", async () => {
    const { fetchImpl, appels } = reseau({ hlpool: "json" });
    const vis = visibilite(true);
    const { scanner, derniere } = monter({ fetchImpl, vis });
    scanner.demarrer("BTC");
    await new Promise((r) => setTimeout(r, 10));
    expect(appels).toEqual(["hlpool"]); // pool chargé, scan en pause
    expect(derniere()?.progression).toEqual({ faites: 0, total: 12 });
    vis.basculer(false);
    await scanner.attendreCycle();
    expect(appels.filter((a) => a.startsWith("info:"))).toHaveLength(12);
    expect(derniere()?.etat).toBe("ok");
  });

  it("rescan échu onglet caché : horodaté au RETOUR (pas antidaté de la pause), un seul scan, puis 5 min", async () => {
    const { fetchImpl, appels } = reseau({ hlpool: "json" });
    const vis = visibilite();
    const { scanner, horloge, derniere } = monter({ fetchImpl, vis });
    scanner.demarrer("BTC");
    await scanner.attendreCycle();
    // L'utilisateur passe sur un autre onglet ; le minuteur du rescan tombe pendant l'absence.
    vis.basculer(true);
    horloge.t += PERIODE_SCAN_MS;
    horloge.declencher((m) => m.ms === PERIODE_SCAN_MS);
    await new Promise((r) => setTimeout(r, 10));
    expect(appels.filter((a) => a.startsWith("info:"))).toHaveLength(12); // rescan en pause
    // Retour 2 h plus tard : le rescan reprend, daté du retour, et le suivant attend 5 min.
    horloge.t += 2 * 3_600_000;
    vis.basculer(false);
    await scanner.attendreCycle();
    expect(appels.filter((a) => a.startsWith("info:"))).toHaveLength(24); // PAS 36 : aucun scan enchaîné
    expect(derniere()?.ts).toBe(T0 + PERIODE_SCAN_MS + 2 * 3_600_000);
    expect(horloge.minuteurs.map((m) => m.ms)).toEqual([PERIODE_SCAN_MS]);
  });

  it("un seul scan à la fois : démarrer deux fois ne lance pas deux cycles", async () => {
    const { fetchImpl, appels } = reseau({ hlpool: "json" });
    const { scanner } = monter({ fetchImpl });
    scanner.demarrer("BTC");
    scanner.demarrer("ETH");
    await scanner.attendreCycle();
    expect(appels.filter((a) => a === "hlpool")).toHaveLength(1);
    expect(appels.filter((a) => a.startsWith("info:"))).toHaveLength(12);
  });
});
