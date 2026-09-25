import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  agregerParCoin,
  assurerTableKv,
  ATTENTE_FROID_MAX_MS,
  chargerPool,
  CONCURRENCE,
  construireInstantane,
  DEBIT_POIDS_MIN,
  enregistrerHl,
  extrairePool,
  extraireTopAdresses,
  INTERVALLE_LOT_MS,
  N_VALEUR_POOL,
  obtenirInstantane,
  parserEtatCompte,
  POIDS_CLEARINGHOUSE,
  reinitialiserHl,
  RELANCE_CONSTRUCTION_S,
  SEUIL_VALEUR_USD,
  TAILLE_POOL,
  traiterHl,
  TTL_INSTANTANE_MS,
  TTL_POOL_MS,
  URL_INFO,
  URL_LEADERBOARD,
  type HorlogeScan,
  type NiveauLiqHL,
  type PositionLiq,
} from "./hyperliquid";
import { Routeur } from "./router";

const T0 = Date.UTC(2026, 7, 10, 12, 0, 0);
const A1 = "0x1111111111111111111111111111111111111111";
const A2 = "0x2222222222222222222222222222222222222222";
const A3 = "0x3333333333333333333333333333333333333333";

function baseTest(): Database {
  const d = new Database(":memory:");
  assurerTableKv(d);
  return d;
}

/**
 * Horloge FACTICE : `now()` n'avance que par les attentes demandées (et par `avancer`),
 * `setTimeout` journalise le délai et rappelle IMMÉDIATEMENT (aucun sommeil réel).
 */
function horlogeFactice(): HorlogeScan & { demandes: number[]; avancer: (ms: number) => void } {
  let t = 0;
  const demandes: number[] = [];
  return {
    demandes,
    avancer: (ms) => {
      t += ms;
    },
    now: () => t,
    setTimeout: (fn, ms) => {
      demandes.push(ms);
      t += ms;
      fn();
      return demandes.length;
    },
    clearTimeout: () => {},
  };
}

/** Adresse synthétique valide n° i (0x + 40 hex). */
function adresse(i: number): string {
  return `0x${i.toString(16).padStart(40, "0")}`;
}

/** Position brute HL (forme clearinghouseState) avec surcharges. */
function pos(patch: Record<string, unknown> = {}): unknown {
  return {
    position: {
      coin: "BTC",
      szi: "6.18756",
      entryPx: "65032.2",
      liquidationPx: "31342.31",
      positionValue: "402414.15",
      leverage: { type: "cross", value: 3 },
      ...patch,
    },
  };
}

function etat(positions: unknown[]): unknown {
  return { marginSummary: { accountValue: "59828738.33" }, assetPositions: positions };
}

/** Stub de fetch : leaderboard + POST /info par adresse. Journalise les appels. */
function stubHl(options: {
  adresses?: string[];
  etats?: Record<string, unknown>;
  leaderboardKo?: boolean;
  infoKo?: string[];
}): { fetchImpl: typeof fetch; appels: string[] } {
  const appels: string[] = [];
  const adresses = options.adresses ?? [A1, A2];
  const fetchImpl = (async (entree: RequestInfo | URL, init?: RequestInit) => {
    const url = String(entree);
    if (url === URL_LEADERBOARD) {
      appels.push("leaderboard");
      if (options.leaderboardKo) throw new Error("amont injoignable");
      return new Response(
        JSON.stringify({
          leaderboardRows: adresses.map((a, i) => ({ ethAddress: a, accountValue: String(1000 - i) })),
        }),
      );
    }
    if (url === URL_INFO) {
      const corps = JSON.parse(String(init?.body ?? "{}")) as { user?: string };
      const user = corps.user ?? "";
      appels.push(`info:${user}`);
      if (options.infoKo?.includes(user)) throw new Error("adresse en échec");
      return new Response(JSON.stringify(options.etats?.[user] ?? etat([])));
    }
    throw new Error(`URL inattendue : ${url}`);
  }) as typeof fetch;
  return { fetchImpl, appels };
}

describe("extraireTopAdresses (pure)", () => {
  test("trie par accountValue NUMÉRIQUE décroissant et tronque au top N", () => {
    // Piège : en tri lexicographique "9" passerait avant "10000000".
    const donnees = {
      leaderboardRows: [
        { ethAddress: A1, accountValue: "9" },
        { ethAddress: A2, accountValue: "10000000.5" },
        { ethAddress: A3, accountValue: "500" },
      ],
    };
    expect(extraireTopAdresses(donnees, 3)).toEqual([A2, A3, A1]);
    expect(extraireTopAdresses(donnees, 2)).toEqual([A2, A3]);
  });

  test("ignore les lignes malformées (adresse invalide, accountValue absent/non numérique)", () => {
    const donnees = {
      leaderboardRows: [
        { ethAddress: "pas-une-adresse", accountValue: "999999" },
        { ethAddress: A1, accountValue: null },
        { ethAddress: A2, accountValue: "abc" },
        { ethAddress: A3, accountValue: "42" },
        { accountValue: "12345" },
      ],
    };
    expect(extraireTopAdresses(donnees, 150)).toEqual([A3]);
  });

  test("JSON inattendu → tableau vide (jamais d'exception)", () => {
    expect(extraireTopAdresses(null, 150)).toEqual([]);
    expect(extraireTopAdresses({}, 150)).toEqual([]);
    expect(extraireTopAdresses({ leaderboardRows: "nope" }, 150)).toEqual([]);
  });
});

describe("extrairePool (pure) — top accountValue complété par le volume « week » jusqu'à la taille cible", () => {
  const A4 = "0x4444444444444444444444444444444444444444";
  const A5 = "0x5555555555555555555555555555555555555555";
  const ligne = (addr: string, accountValue: string, vlmWeek?: string): unknown => ({
    ethAddress: addr,
    accountValue,
    ...(vlmWeek !== undefined
      ? {
          windowPerformances: [
            ["day", { pnl: "0", roi: "0", vlm: "1" }],
            ["week", { pnl: "0", roi: "0", vlm: vlmWeek }],
            ["month", { pnl: "0", roi: "0", vlm: "999999" }],
          ],
        }
      : {}),
  });
  const cinqLignes = {
    leaderboardRows: [
      ligne(A1, "1000", "5"), // top valeur ET présent en volume
      ligne(A2, "900", "500"),
      ligne(A3, "100", "9000"), // faible valeur, gros volume
      ligne(A4, "50"), // sans windowPerformances : valeur seule
      ligne(A5, "10", "400"),
    ],
  };

  test("ordre : top valeur d'abord, puis complément volume non déjà retenu, jusqu'à la taille cible", () => {
    // nValeur=2 → [A1, A2] ; volume décroissant [A3(9000), A2(500), A5(400), A1(5)] :
    // A3 puis A5 complètent (A2 déjà retenu) → taille cible 4 atteinte.
    expect(extrairePool(cinqLignes, 2, 4)).toEqual([A1, A2, A3, A5]);
    // Taille cible 3 : le complément s'ARRÊTE dès qu'elle est atteinte (A5 non retenue).
    expect(extrairePool(cinqLignes, 2, 3)).toEqual([A1, A2, A3]);
  });

  test("nValeur > taille cible → tronqué à la taille cible (valeur seule)", () => {
    expect(extrairePool(cinqLignes, 5, 2)).toEqual([A1, A2]);
  });

  test("nValeur > lignes disponibles : toutes les lignes valeur puis le volume sans doublon", () => {
    // 5 lignes valeur (< 10) ; toutes déjà retenues → le volume n'ajoute rien, pas de doublon.
    expect(extrairePool(cinqLignes, 10, 50)).toEqual([A1, A2, A3, A4, A5]);
  });

  test("doublons : une adresse listée deux fois (valeur ET volume, ou ligne répétée) n'apparaît qu'une fois", () => {
    const donnees = {
      leaderboardRows: [ligne(A1, "1000", "10"), ligne(A1, "999", "20"), ligne(A2, "5", "30")],
    };
    const pool = extrairePool(donnees, 2, 10);
    expect(pool).toEqual([A1, A2]);
    expect(new Set(pool).size).toBe(pool.length);
  });

  test("défauts : N_VALEUR_POOL par valeur puis complément volume jusqu'à TAILLE_POOL", () => {
    expect(TAILLE_POOL).toBe(1500);
    expect(N_VALEUR_POOL).toBe(500);
    // 2 000 lignes : valeur décroissante avec i, volume CROISSANT avec i (ordres opposés).
    const n = 2000;
    const donnees = {
      leaderboardRows: Array.from({ length: n }, (_, i) => ligne(adresse(i), String(n - i), String(i))),
    };
    const pool = extrairePool(donnees);
    expect(pool).toHaveLength(TAILLE_POOL);
    expect(new Set(pool).size).toBe(TAILLE_POOL);
    // Les 500 premières = top valeur (i = 0..499), dans l'ordre.
    expect(pool.slice(0, N_VALEUR_POOL)).toEqual(Array.from({ length: N_VALEUR_POOL }, (_, i) => adresse(i)));
    // Puis le volume décroissant : i = 1999, 1998, … (aucune n'est dans le top valeur).
    expect(pool[N_VALEUR_POOL]).toBe(adresse(n - 1));
    expect(pool[TAILLE_POOL - 1]).toBe(adresse(n - (TAILLE_POOL - N_VALEUR_POOL)));
  });

  test("tri numérique du vlm (pas lexicographique) ; lignes invalides écartées", () => {
    const donnees = {
      leaderboardRows: [
        { ethAddress: "invalide", accountValue: "999999", windowPerformances: [["week", { vlm: "999999" }]] },
        ligne(A1, "10", "9"),
        ligne(A2, "10", "10000"),
        ligne(A3, "10", "abc"),
      ],
    };
    expect(extrairePool(donnees, 0, 10)).toEqual([A2, A1]); // A3 : vlm non numérique écarté
    expect(extrairePool(null)).toEqual([]);
    expect(extrairePool({ leaderboardRows: "nope" })).toEqual([]);
  });

  test("chargerPool persiste le pool ÉLARGI en KV hl/pool", async () => {
    const d = baseTest();
    const fetchImpl = (async (entree: RequestInfo | URL) => {
      if (String(entree) !== URL_LEADERBOARD) throw new Error("URL inattendue");
      return new Response(
        JSON.stringify({
          leaderboardRows: [
            { ethAddress: A1, accountValue: "1000", windowPerformances: [["week", { vlm: "5" }]] },
            { ethAddress: A2, accountValue: "10", windowPerformances: [["week", { vlm: "5000" }]] },
          ],
        }),
      );
    }) as typeof fetch;
    expect(await chargerPool(d, fetchImpl, T0)).toEqual([A1, A2]);
    const ligne = d.query("SELECT valeur FROM kv WHERE namespace = 'hl' AND cle = 'pool'").get() as { valeur: string };
    expect(JSON.parse(ligne.valeur).adresses).toEqual([A1, A2]);
  });
});

describe("arrêt sur 429 amont", () => {
  test("les lots restants ne sont PAS envoyés ; les adresses restantes ne comptent pas", async () => {
    const appels: string[] = [];
    const fetchImpl = (async (entree: RequestInfo | URL, init?: RequestInit) => {
      const user = (JSON.parse(String(init?.body ?? "{}")) as { user?: string }).user ?? "";
      appels.push(user);
      if (user === A2) return new Response("quota", { status: 429 });
      return new Response(JSON.stringify(etat([])));
    }) as typeof fetch;
    // CONCURRENCE=4 : lot 1 = [A1..A4] → A2 est 429 → la 5e adresse ne part jamais.
    const adresses = [A1, A2, A3, "0x4444444444444444444444444444444444444444", "0x5555555555555555555555555555555555555555"];
    const horloge = horlogeFactice();
    const inst = await construireInstantane(adresses, fetchImpl, T0, { horloge });
    expect(appels).toEqual([A1, A2, A3, "0x4444444444444444444444444444444444444444"]);
    expect(inst.adressesScannees).toBe(3);
    expect(horloge.demandes).toEqual([]); // interrompu : aucune attente avant un lot qui ne partira pas
  });

  test("429 au 2e lot : le 3e lot n'est jamais envoyé malgré la cadence", async () => {
    const appels: string[] = [];
    const adresses = Array.from({ length: 12 }, (_, i) => adresse(i + 1));
    const fetchImpl = (async (_entree: RequestInfo | URL, init?: RequestInit) => {
      const user = (JSON.parse(String(init?.body ?? "{}")) as { user?: string }).user ?? "";
      appels.push(user);
      if (user === adresses[5]) return new Response("quota", { status: 429 });
      return new Response(JSON.stringify(etat([])));
    }) as typeof fetch;
    const horloge = horlogeFactice();
    const inst = await construireInstantane(adresses, fetchImpl, T0, { horloge });
    expect(appels).toHaveLength(2 * CONCURRENCE);
    expect(inst.adressesScannees).toBe(2 * CONCURRENCE - 1);
    expect(horloge.demandes).toEqual([INTERVALLE_LOT_MS]); // une seule attente : entre lot 1 et lot 2
  });
});

describe("cadence du scan (débit de poids plafonné)", () => {
  test("constantes : quota HL 1 200 poids/min/IP, clearinghouseState = 2, débit alloué 900/min", () => {
    expect(POIDS_CLEARINGHOUSE).toBe(2);
    expect(DEBIT_POIDS_MIN).toBe(900);
    expect(CONCURRENCE).toBe(4);
    expect(INTERVALLE_LOT_MS).toBe(Math.ceil((CONCURRENCE * POIDS_CLEARINGHOUSE * 60_000) / DEBIT_POIDS_MIN));
    expect(INTERVALLE_LOT_MS).toBe(534);
    // Débit effectif en pointe ≤ débit alloué < quota IP (marge laissée au navigateur).
    const poidsParMinute = (CONCURRENCE * POIDS_CLEARINGHOUSE * 60_000) / INTERVALLE_LOT_MS;
    expect(poidsParMinute).toBeLessThanOrEqual(DEBIT_POIDS_MIN);
    expect(DEBIT_POIDS_MIN).toBeLessThan(1200);
    // Scan complet du pool cible ≈ 200 s : sous la période de 5 min du collecteur.
    const dureeScanMs = (Math.ceil(TAILLE_POOL / CONCURRENCE) - 1) * INTERVALLE_LOT_MS;
    expect(dureeScanMs).toBeGreaterThan(190_000);
    expect(dureeScanMs).toBeLessThan(5 * 60_000);
  });

  test("N lots → N−1 attentes de INTERVALLE_LOT_MS (lots instantanés), aucune après le dernier", async () => {
    const { fetchImpl } = stubHl({});
    const horloge = horlogeFactice();
    // 10 adresses = lots de 4, 4, 2 → 2 attentes.
    const adresses = Array.from({ length: 10 }, (_, i) => adresse(i + 1));
    const inst = await construireInstantane(adresses, fetchImpl, T0, { horloge });
    expect(inst.adressesScannees).toBe(10);
    expect(horloge.demandes).toEqual([INTERVALLE_LOT_MS, INTERVALLE_LOT_MS]);
  });

  test("l'intervalle se compte de DÉMARRAGE à démarrage : la durée du lot est déduite", async () => {
    const horloge = horlogeFactice();
    // Chaque requête « dure » 100 ms d'horloge factice → un lot de 4 en dure 400.
    const fetchImpl = (async () => {
      horloge.avancer(100);
      return new Response(JSON.stringify(etat([])));
    }) as unknown as typeof fetch;
    const adresses = Array.from({ length: 12 }, (_, i) => adresse(i + 1));
    await construireInstantane(adresses, fetchImpl, T0, { horloge });
    expect(horloge.demandes).toEqual([INTERVALLE_LOT_MS - 400, INTERVALLE_LOT_MS - 400]);
  });

  test("un lot plus long que l'intervalle n'ajoute AUCUNE attente", async () => {
    const horloge = horlogeFactice();
    const fetchImpl = (async () => {
      horloge.avancer(INTERVALLE_LOT_MS); // 4 × l'intervalle par lot
      return new Response(JSON.stringify(etat([])));
    }) as unknown as typeof fetch;
    const adresses = Array.from({ length: 12 }, (_, i) => adresse(i + 1));
    const inst = await construireInstantane(adresses, fetchImpl, T0, { horloge });
    expect(inst.adressesScannees).toBe(12);
    expect(horloge.demandes).toEqual([]);
  });

  test("intervalleLotMs injectable", async () => {
    const { fetchImpl } = stubHl({});
    const horloge = horlogeFactice();
    const adresses = Array.from({ length: 9 }, (_, i) => adresse(i + 1));
    await construireInstantane(adresses, fetchImpl, T0, { horloge, intervalleLotMs: 50 });
    expect(horloge.demandes).toEqual([50, 50]);
  });
});

describe("obtenirInstantane({ forcer })", () => {
  for (const retard of [60_000, TTL_INSTANTANE_MS + 1]) {
    test(`un scan forcé en panne refuse le cache antérieur (${retard} ms), conservé pour l'UI`, async () => {
      reinitialiserHl();
      const d = baseTest();
      const ok = stubHl({ adresses: [A1], etats: { [A1]: etat([pos()]) } });
      await obtenirInstantane(d, ok.fetchImpl, T0);
      const ko = stubHl({ adresses: [A1], infoKo: [A1] });

      expect(await obtenirInstantane(d, ko.fetchImpl, T0 + retard, { forcer: true })).toBeNull();
      const lecture = await obtenirInstantane(d, ko.fetchImpl, T0 + retard);
      expect(lecture?.ts).toBe(T0);
      expect(lecture?.parCoin.get("BTC")?.[0]?.px).toBe(31342.31);
      d.close();
      reinitialiserHl();
    });
  }

  test("forcer ignore le cache frais mais rejoint une construction en vol", async () => {
    reinitialiserHl();
    const d = baseTest();
    const { fetchImpl, appels } = stubHl({ adresses: [A1], etats: { [A1]: etat([pos()]) } });
    await obtenirInstantane(d, fetchImpl, T0); // remplit le cache
    const nb = appels.length;
    // Cache frais : sans forcer, aucun appel de plus.
    await obtenirInstantane(d, fetchImpl, T0 + 60_000);
    expect(appels.length).toBe(nb);
    // forcer : nouvel instantané malgré le cache frais (pool encore frais → 0 leaderboard).
    const inst = await obtenirInstantane(d, fetchImpl, T0 + 60_000, { forcer: true });
    expect(inst?.ts).toBe(T0 + 60_000);
    expect(appels.filter((a) => a === "leaderboard")).toHaveLength(1);
    expect(appels.filter((a) => a.startsWith("info:")).length).toBeGreaterThan(1);
  });

  test("construction en vol + cache périmé → le cache est servi IMMÉDIATEMENT (jamais d'attente)", async () => {
    reinitialiserHl();
    const d = baseTest();
    // 1) Remplit le cache avec un instantané valide à T0.
    const { fetchImpl } = stubHl({ adresses: [A1], etats: { [A1]: etat([pos()]) } });
    const premier = await obtenirInstantane(d, fetchImpl, T0);
    expect(premier?.ts).toBe(T0);
    // 2) Nouvelle construction EN VOL dont le fetch ne résout jamais (scan infini).
    const fetchPendu = (async () => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const enVol = obtenirInstantane(d, fetchPendu, T0 + TTL_INSTANTANE_MS + 1, { forcer: true });
    void enVol;
    // 3) Lecture non forcée pendant la construction : le cache PÉRIMÉ est servi
    //    sans rejoindre la construction (le fetch pendu ne résoudrait jamais).
    const servi = await obtenirInstantane(d, fetchPendu, T0 + TTL_INSTANTANE_MS + 2);
    expect(servi?.ts).toBe(T0); // cache périmé, pas le résultat d'un scan infini
    // 4) Sans AUCUN cache, on rejoint la construction en vol (comportement inchangé).
    reinitialiserHl();
    let resolue = false;
    const attente = obtenirInstantane(d, fetchPendu, T0, { forcer: true });
    const jointure = obtenirInstantane(d, fetchPendu, T0).then((r) => {
      resolue = true;
      return r;
    });
    void attente;
    await Promise.resolve(); // microtâches seulement : la jointure ne peut pas avoir résolu
    expect(resolue).toBe(false);
    void jointure;
  });
});

describe("parserEtatCompte (pure)", () => {
  test("parse un long : chaînes numériques converties, side=long, lev scalaire", () => {
    const r = parserEtatCompte(etat([pos()]), A1);
    expect(r).toEqual([
      {
        coin: "BTC",
        niveau: { px: 31342.31, side: "long", valueUsd: 402414.15, entryPx: 65032.2, lev: 3, addr: A1 },
      },
    ]);
  });

  test("szi négatif → side=short", () => {
    const r = parserEtatCompte(etat([pos({ szi: "-2.5" })]), A1);
    expect(r[0]?.niveau.side).toBe("short");
  });

  test("liquidationPx null → position écartée", () => {
    expect(parserEtatCompte(etat([pos({ liquidationPx: null })]), A1)).toEqual([]);
  });

  test("liquidationPx ≤ 0 ou non fini → position écartée", () => {
    expect(parserEtatCompte(etat([pos({ liquidationPx: "0" })]), A1)).toEqual([]);
    expect(parserEtatCompte(etat([pos({ liquidationPx: "-12" })]), A1)).toEqual([]);
    expect(parserEtatCompte(etat([pos({ liquidationPx: "NaN" })]), A1)).toEqual([]);
  });

  test("seuil positionValue : 1000 passe, 999,99 est écarté", () => {
    expect(SEUIL_VALEUR_USD).toBe(1000);
    expect(parserEtatCompte(etat([pos({ positionValue: "1000" })]), A1)).toHaveLength(1);
    expect(parserEtatCompte(etat([pos({ positionValue: "999.99" })]), A1)).toEqual([]);
  });

  test("szi nul ou coin absent → position écartée ; état inattendu → tableau vide", () => {
    expect(parserEtatCompte(etat([pos({ szi: "0" })]), A1)).toEqual([]);
    expect(parserEtatCompte(etat([pos({ coin: undefined })]), A1)).toEqual([]);
    expect(parserEtatCompte(null, A1)).toEqual([]);
    expect(parserEtatCompte({ assetPositions: "nope" }, A1)).toEqual([]);
  });

  test("plusieurs positions dans un même état → une entrée par coin retenu", () => {
    const r = parserEtatCompte(etat([pos(), pos({ coin: "kPEPE", szi: "-1" }), pos({ coin: "SOL", liquidationPx: null })]), A2);
    expect(r.map((p) => p.coin)).toEqual(["BTC", "kPEPE"]);
  });
});

describe("agregerParCoin (pure)", () => {
  test("regroupe les niveaux par coin (casse préservée)", () => {
    const n = (addr: string): NiveauLiqHL => ({ px: 1, side: "long", valueUsd: 2000, entryPx: 2, lev: 3, addr });
    const positions: PositionLiq[] = [
      { coin: "BTC", niveau: n(A1) },
      { coin: "kPEPE", niveau: n(A2) },
      { coin: "BTC", niveau: n(A3) },
    ];
    const m = agregerParCoin(positions);
    expect(m.get("BTC")?.map((v) => v.addr)).toEqual([A1, A3]);
    expect(m.get("kPEPE")).toHaveLength(1);
    expect(m.get("KPEPE")).toBeUndefined();
  });
});

describe("chargerPool (kv namespace hl, TTL 6 h)", () => {
  test("premier appel : télécharge, persiste { adresses, ts, nValeur, tailleCible } et renvoie le pool", async () => {
    const d = baseTest();
    const { fetchImpl, appels } = stubHl({ adresses: [A1, A2] });
    expect(await chargerPool(d, fetchImpl, T0)).toEqual([A1, A2]);
    expect(appels).toEqual(["leaderboard"]);
    const ligne = d.query("SELECT valeur FROM kv WHERE namespace = ? AND cle = ?").get("hl", "pool") as { valeur: string };
    // Les PARAMÈTRES du pool (et non sa longueur réelle, ici 2) : un leaderboard maigre ne
    // doit pas provoquer un retéléchargement à chaque lecture.
    expect(JSON.parse(ligne.valeur)).toEqual({
      adresses: [A1, A2],
      ts: T0,
      nValeur: N_VALEUR_POOL,
      tailleCible: TAILLE_POOL,
    });
  });

  /** Écrit un pool persisté arbitraire (ancien format, autres paramètres…). */
  function persister(d: Database, valeur: unknown): void {
    d.query("INSERT OR REPLACE INTO kv (namespace, cle, valeur, majA) VALUES ('hl', 'pool', ?, ?)").run(
      JSON.stringify(valeur),
      T0,
    );
  }

  test("ancien format { adresses, ts } (pool 150/350) même récent : PAS frais → retéléchargé", async () => {
    const d = baseTest();
    persister(d, { adresses: [A3], ts: T0 });
    const s = stubHl({ adresses: [A1, A2] });
    expect(await chargerPool(d, s.fetchImpl, T0 + 60_000)).toEqual([A1, A2]);
    expect(s.appels).toEqual(["leaderboard"]);
    const ligne = d.query("SELECT valeur FROM kv WHERE namespace = 'hl' AND cle = 'pool'").get() as { valeur: string };
    expect(JSON.parse(ligne.valeur)).toMatchObject({ adresses: [A1, A2], tailleCible: TAILLE_POOL });
  });

  test("pool persisté avec une AUTRE taille cible ou un autre nValeur : PAS frais → retéléchargé", async () => {
    for (const autre of [
      { tailleCible: 475, nValeur: N_VALEUR_POOL },
      { tailleCible: TAILLE_POOL, nValeur: 150 },
    ]) {
      const d = baseTest();
      persister(d, { adresses: [A3], ts: T0, ...autre });
      const s = stubHl({ adresses: [A1] });
      expect(await chargerPool(d, s.fetchImpl, T0 + 60_000)).toEqual([A1]);
      expect(s.appels).toEqual(["leaderboard"]);
    }
  });

  test("ancien format ou autre taille + amont KO : le pool persisté reste le REPLI", async () => {
    for (const ancien of [{ adresses: [A3], ts: T0 }, { adresses: [A3], ts: T0, nValeur: 150, tailleCible: 475 }]) {
      const d = baseTest();
      persister(d, ancien);
      const s = stubHl({ leaderboardKo: true });
      expect(await chargerPool(d, s.fetchImpl, T0 + 60_000)).toEqual([A3]);
      expect(s.appels).toEqual(["leaderboard"]);
      // Le repli n'est PAS réécrit : la prochaine lecture retentera l'amont.
      const ligne = d.query("SELECT valeur FROM kv WHERE namespace = 'hl' AND cle = 'pool'").get() as { valeur: string };
      expect(JSON.parse(ligne.valeur)).toEqual(ancien);
    }
  });

  test("mêmes paramètres et < 6 h : frais (aucun appel), ≥ 6 h : retéléchargé", async () => {
    const d = baseTest();
    persister(d, { adresses: [A3], ts: T0, nValeur: N_VALEUR_POOL, tailleCible: TAILLE_POOL });
    const s1 = stubHl({ adresses: [A1] });
    expect(await chargerPool(d, s1.fetchImpl, T0 + TTL_POOL_MS - 1)).toEqual([A3]);
    expect(s1.appels).toEqual([]);
    const s2 = stubHl({ adresses: [A1] });
    expect(await chargerPool(d, s2.fetchImpl, T0 + TTL_POOL_MS)).toEqual([A1]);
    expect(s2.appels).toEqual(["leaderboard"]);
  });

  test("pool frais (< 6 h) : AUCUN re-téléchargement des 34 Mo", async () => {
    const d = baseTest();
    const s1 = stubHl({ adresses: [A1, A2] });
    await chargerPool(d, s1.fetchImpl, T0);
    const s2 = stubHl({ adresses: [A3] });
    expect(await chargerPool(d, s2.fetchImpl, T0 + 5 * 3_600_000)).toEqual([A1, A2]);
    expect(s2.appels).toEqual([]);
  });

  test("pool périmé + amont en échec : réutilise le pool persisté périmé", async () => {
    const d = baseTest();
    await chargerPool(d, stubHl({ adresses: [A1, A2] }).fetchImpl, T0);
    const s = stubHl({ leaderboardKo: true });
    expect(await chargerPool(d, s.fetchImpl, T0 + 7 * 3_600_000)).toEqual([A1, A2]);
    expect(s.appels).toEqual(["leaderboard"]);
  });

  test("aucun pool persisté + amont en échec → tableau vide (pas d'exception)", async () => {
    const d = baseTest();
    expect(await chargerPool(d, stubHl({ leaderboardKo: true }).fetchImpl, T0)).toEqual([]);
  });
});

describe("construireInstantane (concurrence bornée, échecs isolés)", () => {
  test("agrège tous les coins et ne compte que les adresses ayant répondu", async () => {
    const { fetchImpl, appels } = stubHl({
      etats: {
        [A1]: etat([pos()]),
        [A2]: etat([pos({ coin: "ETH", szi: "-3", liquidationPx: "4200.5" })]),
      },
      infoKo: [A3],
    });
    const inst = await construireInstantane([A1, A2, A3], fetchImpl, T0);
    expect(inst.ts).toBe(T0);
    expect(inst.adressesScannees).toBe(2); // A3 a échoué → ignorée, pas d'échec global
    expect(inst.parCoin.get("BTC")?.map((n) => n.addr)).toEqual([A1]);
    expect(inst.parCoin.get("ETH")?.[0]?.side).toBe("short");
    expect(appels.filter((a) => a.startsWith("info:"))).toHaveLength(3);
  });

  test("ne dépasse jamais CONCURRENCE (4) requêtes en vol", async () => {
    let enVol = 0;
    let maxEnVol = 0;
    const fetchImpl = (async (_entree: RequestInfo | URL) => {
      enVol += 1;
      maxEnVol = Math.max(maxEnVol, enVol);
      await new Promise((r) => setTimeout(r, 1));
      enVol -= 1;
      return new Response(JSON.stringify(etat([])));
    }) as typeof fetch;
    const adresses = Array.from({ length: 20 }, (_, i) => `0x${String(i).padStart(40, "0")}`);
    const inst = await construireInstantane(adresses, fetchImpl, T0, { horloge: horlogeFactice() });
    expect(maxEnVol).toBe(CONCURRENCE);
    expect(inst.adressesScannees).toBe(20);
  });
});

describe("GET /hl/liqlevels/:coin", () => {
  test("réponse { ts, coin, adressesScannees, niveaux } et cache 5 min partagé entre coins", async () => {
    reinitialiserHl();
    const d = baseTest();
    const { fetchImpl, appels } = stubHl({
      adresses: [A1, A2],
      etats: { [A1]: etat([pos(), pos({ coin: "ETH", liquidationPx: "4200.5" })]), [A2]: etat([pos({ szi: "-1" })]) },
    });
    const url = new URL("http://x/hl/liqlevels/BTC");
    const res = await traiterHl(new Request(url), url, d, T0, fetchImpl);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const corps = (await res.json()) as { ts: number; coin: string; adressesScannees: number; niveaux: NiveauLiqHL[] };
    expect(corps).toEqual({
      ts: T0,
      coin: "BTC",
      adressesScannees: 2,
      niveaux: [
        { px: 31342.31, side: "long", valueUsd: 402414.15, entryPx: 65032.2, lev: 3, addr: A1 },
        { px: 31342.31, side: "short", valueUsd: 402414.15, entryPx: 65032.2, lev: 3, addr: A2 },
      ],
    });
    const nbAppels = appels.length;

    // /ETH juste après : servi par le même instantané → AUCUN appel HL supplémentaire.
    const urlEth = new URL("http://x/hl/liqlevels/ETH");
    const resEth = await traiterHl(new Request(urlEth), urlEth, d, T0 + 60_000, fetchImpl);
    const corpsEth = (await resEth.json()) as { coin: string; niveaux: NiveauLiqHL[]; ts: number };
    expect(corpsEth.coin).toBe("ETH");
    expect(corpsEth.ts).toBe(T0); // horodatage de l'instantané, pas de la requête
    expect(corpsEth.niveaux).toHaveLength(1);
    expect(appels.length).toBe(nbAppels);
  });

  test("coin sans niveau → tableau vide (200)", async () => {
    reinitialiserHl();
    const d = baseTest();
    const { fetchImpl } = stubHl({ adresses: [A1], etats: { [A1]: etat([pos()]) } });
    const url = new URL("http://x/hl/liqlevels/DOGE");
    const res = await traiterHl(new Request(url), url, d, T0, fetchImpl);
    expect(res.status).toBe(200);
    expect((await res.json()) as { niveaux: unknown[] }).toMatchObject({ coin: "DOGE", niveaux: [] });
  });

  test("aucun pool disponible (amont KO, rien de persisté) → 503", async () => {
    reinitialiserHl();
    const d = baseTest();
    const url = new URL("http://x/hl/liqlevels/BTC");
    const res = await traiterHl(new Request(url), url, d, T0, stubHl({ leaderboardKo: true }).fetchImpl);
    expect(res.status).toBe(503);
    // 503 « pool indisponible » : DISTINCT du 503 « en construction » (pas de relance courte).
    const corps = (await res.json()) as { erreur: string; enConstruction?: boolean };
    expect(corps.erreur).toContain("pool");
    expect(corps.enConstruction).toBeUndefined();
    expect(res.headers.get("retry-after")).toBeNull();
    // Un 503 ne doit RIEN figer : la requête suivante retente l'amont.
    const s = stubHl({ adresses: [A1], etats: { [A1]: etat([pos()]) } });
    const res2 = await traiterHl(new Request(url), url, d, T0, s.fetchImpl);
    expect(res2.status).toBe(200);
    expect(s.appels).toContain("leaderboard");
  });

  test("cache expiré (> 5 min) → périmé servi TOUT DE SUITE, nouvel instantané construit en arrière-plan", async () => {
    reinitialiserHl();
    const d = baseTest();
    const s = stubHl({ adresses: [A1], etats: { [A1]: etat([pos()]) } });
    // Après le 1er scan, les requêtes de compte restent en vol jusqu'à `verrou.resolve()`.
    let bloquer = false;
    const verrou = Promise.withResolvers<void>();
    const fetchImpl = (async (entree: RequestInfo | URL, init?: RequestInit) => {
      if (bloquer && String(entree) === URL_INFO) await verrou.promise;
      return s.fetchImpl(entree, init);
    }) as typeof fetch;
    const url = new URL("http://x/hl/liqlevels/BTC");
    await traiterHl(new Request(url), url, d, T0, fetchImpl);
    const nb = s.appels.length;
    bloquer = true;
    // Le scan d'un pool de ~1 500 adresses dure ≈ 200 s : une lecture ne l'attend JAMAIS
    // quand un cache (même périmé) existe — elle le sert et relance la construction.
    const res = await traiterHl(new Request(url), url, d, T0 + 6 * 60_000, fetchImpl);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ts: number }).ts).toBe(T0);
    // La construction lancée par cette lecture est EN VOL : un appel forcé la rejoint.
    const forcee = obtenirInstantane(d, fetchImpl, T0 + 6 * 60_000 + 1, { forcer: true });
    verrou.resolve();
    expect((await forcee)?.ts).toBe(T0 + 6 * 60_000);
    expect(s.appels.length).toBeGreaterThan(nb);
    expect(s.appels.filter((a) => a === "leaderboard")).toHaveLength(1); // pool encore frais
    const res2 = await traiterHl(new Request(url), url, d, T0 + 6 * 60_000 + 2, fetchImpl);
    expect(((await res2.json()) as { ts: number }).ts).toBe(T0 + 6 * 60_000);
  });

  test("cold-start simultané : un SEUL instantané construit (pas de rafale)", async () => {
    reinitialiserHl();
    const d = baseTest();
    const { fetchImpl, appels } = stubHl({ adresses: [A1, A2], etats: { [A1]: etat([pos()]) } });
    const u1 = new URL("http://x/hl/liqlevels/BTC");
    const u2 = new URL("http://x/hl/liqlevels/ETH");
    await Promise.all([
      traiterHl(new Request(u1), u1, d, T0, fetchImpl),
      traiterHl(new Request(u2), u2, d, T0, fetchImpl),
    ]);
    expect(appels.filter((a) => a === "leaderboard")).toHaveLength(1);
    expect(appels.filter((a) => a.startsWith("info:"))).toHaveLength(2);
  });

  test("gardes : 405 hors GET, 404 chemin inconnu, 400 coin manquant", async () => {
    reinitialiserHl();
    const u = new URL("http://x/hl/liqlevels/BTC");
    expect((await traiterHl(new Request(u, { method: "POST" }), u)).status).toBe(405);
    const uInconnu = new URL("http://x/hl/nimporte");
    expect((await traiterHl(new Request(uInconnu), uInconnu)).status).toBe(404);
    const uVide = new URL("http://x/hl/liqlevels");
    expect((await traiterHl(new Request(uVide), uVide)).status).toBe(400);
  });

  test("GET /hl/positions/:coin : agrégats long/short + top trié, MÊME instantané (0 appel de plus)", async () => {
    reinitialiserHl();
    const d = baseTest();
    const { fetchImpl, appels } = stubHl({
      adresses: [A1, A2],
      etats: {
        // A1 : long 402 k$ ; A2 : short 900 k$ (plus grosse → première du top).
        [A1]: etat([pos()]),
        [A2]: etat([pos({ szi: "-2", positionValue: "900000" })]),
      },
    });
    const urlLevels = new URL("http://x/hl/liqlevels/BTC");
    await traiterHl(new Request(urlLevels), urlLevels, d, T0, fetchImpl);
    const nbAppels = appels.length;

    const url = new URL("http://x/hl/positions/BTC");
    const res = await traiterHl(new Request(url), url, d, T0 + 60_000, fetchImpl);
    expect(res.status).toBe(200);
    const corps = (await res.json()) as {
      ts: number;
      coin: string;
      agregats: { longUsd: number; shortUsd: number; nbLong: number; nbShort: number };
      positions: NiveauLiqHL[];
    };
    expect(corps.ts).toBe(T0); // même instantané que liqlevels
    expect(appels.length).toBe(nbAppels); // aucun appel amont supplémentaire
    expect(corps.agregats).toEqual({ longUsd: 402414.15, shortUsd: 900000, nbLong: 1, nbShort: 1 });
    expect(corps.positions.map((p) => p.valueUsd)).toEqual([900000, 402414.15]); // tri décroissant
  });

  test("enregistrerHl branche le préfixe /hl sur le routeur", async () => {
    const routeur = new Routeur();
    enregistrerHl(routeur);
    const u = new URL("http://x/hl/liqlevels/BTC");
    // POST : la route matche et répond 405 AVANT tout accès base/réseau.
    const res = await routeur.gerer(new Request(u, { method: "POST" }), u);
    expect(res?.status).toBe(405);
    const uAutre = new URL("http://x/autre");
    expect(await routeur.gerer(new Request(uAutre), uAutre)).toBeNull();
  });
});

describe("instantané entièrement vide (échec amont total)", () => {
  test("0 adresse scannée : PAS de cache — 503 sans cache antérieur, retente immédiate, sinon stale servi", async () => {
    reinitialiserHl();
    const d = baseTest();
    const url = new URL("http://x/hl/liqlevels/BTC");
    // 1) Toutes les adresses en échec, aucun cache antérieur → 503 (pas un 200 « 0 adresses »).
    const ko = stubHl({ adresses: [A1, A2], infoKo: [A1, A2] });
    const res = await traiterHl(new Request(url), url, d, T0, ko.fetchImpl);
    expect(res.status).toBe(503);
    // 2) La requête SUIVANTE retente immédiatement (rien n'a été caché 5 min) et réussit.
    const okStub = stubHl({ adresses: [A1], etats: { [A1]: etat([pos()]) } });
    const res2 = await traiterHl(new Request(url), url, d, T0 + 1_000, okStub.fetchImpl);
    expect(res2.status).toBe(200);
    const corps2 = (await res2.json()) as { ts: number; adressesScannees: number };
    expect(corps2.adressesScannees).toBe(2); // pool persisté [A1,A2] ; A2 → etat([]) du stub
    // 3) Cache expiré + échec amont total → l'ANCIEN instantané est servi (jamais le vide).
    const res3 = await traiterHl(new Request(url), url, d, T0 + 1_000 + TTL_INSTANTANE_MS + 1, ko.fetchImpl);
    expect(res3.status).toBe(200);
    const corps3 = (await res3.json()) as { ts: number };
    expect(corps3.ts).toBe(T0 + 1_000); // instantané de l'étape 2, pas un vide reconstruit
  });
});

describe("lecture à froid bornée (aucun cache) → 503 « en construction »", () => {
  /**
   * Amont dont les requêtes de compte restent EN VOL jusqu'à `verrou.resolve()` : simule
   * le scan de ~200 s d'un pool de ~1 500 adresses sans aucun sommeil réel.
   */
  function amontLent(): { fetchImpl: typeof fetch; appels: string[]; verrou: { resolve: () => void } } {
    const s = stubHl({ adresses: [A1], etats: { [A1]: etat([pos()]) } });
    const verrou = Promise.withResolvers<void>();
    const fetchImpl = (async (entree: RequestInfo | URL, init?: RequestInit) => {
      if (String(entree) === URL_INFO) await verrou.promise;
      return s.fetchImpl(entree, init);
    }) as typeof fetch;
    return { fetchImpl, appels: s.appels, verrou };
  }

  /** Horloge dont les minuteurs ne se déclenchent JAMAIS seuls (journalise pose et annulation). */
  function horlogeFigee(): HorlogeScan & { poses: number[]; annules: unknown[] } {
    const poses: number[] = [];
    const annules: unknown[] = [];
    return {
      poses,
      annules,
      now: () => 0,
      setTimeout: (_fn, ms) => {
        poses.push(ms);
        return poses.length;
      },
      clearTimeout: (id) => {
        annules.push(id);
      },
    };
  }

  test("au-delà de ATTENTE_FROID_MAX_MS : 503 JSON enConstruction + Retry-After, puis 200 une fois le cache rempli", async () => {
    reinitialiserHl();
    const d = baseTest();
    const { fetchImpl, appels, verrou } = amontLent();
    const horloge = horlogeFactice(); // le délai de 15 s « s'écoule » immédiatement
    const url = new URL("http://x/hl/liqlevels/BTC");

    const res = await traiterHl(new Request(url), url, d, T0, fetchImpl, { horloge });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ erreur: "instantané Hyperliquid en construction", enConstruction: true });
    expect(res.headers.get("retry-after")).toBe(String(RELANCE_CONSTRUCTION_S));
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(horloge.demandes).toContain(ATTENTE_FROID_MAX_MS);
    expect(ATTENTE_FROID_MAX_MS).toBe(15_000);

    // Pendant la construction, /positions répond pareil — sans lancer un 2e scan.
    const urlPos = new URL("http://x/hl/positions/BTC");
    const resPos = await traiterHl(new Request(urlPos), urlPos, d, T0 + 30_000, fetchImpl, { horloge });
    expect(resPos.status).toBe(503);
    expect(((await resPos.json()) as { enConstruction?: boolean }).enConstruction).toBe(true);
    expect(appels.filter((a) => a === "leaderboard")).toHaveLength(1);

    // La construction a CONTINUÉ en arrière-plan : elle se termine et remplit le cache.
    const fin = obtenirInstantane(d, fetchImpl, T0 + 60_000, { forcer: true }); // rejoint le scan en vol
    verrou.resolve();
    expect((await fin)?.ts).toBe(T0);
    expect(appels.filter((a) => a.startsWith("info:"))).toEqual([`info:${A1}`]); // un seul scan

    const res2 = await traiterHl(new Request(url), url, d, T0 + 90_000, fetchImpl, { horloge });
    expect(res2.status).toBe(200);
    const corps2 = (await res2.json()) as { ts: number; niveaux: NiveauLiqHL[] };
    expect(corps2.ts).toBe(T0);
    expect(corps2.niveaux).toHaveLength(1);
  });

  test("construction terminée AVANT le délai : 200 direct et minuteur du délai annulé", async () => {
    reinitialiserHl();
    const d = baseTest();
    const { fetchImpl } = stubHl({ adresses: [A1], etats: { [A1]: etat([pos()]) } });
    const horloge = horlogeFigee(); // le délai n'expire jamais
    const url = new URL("http://x/hl/liqlevels/BTC");
    const res = await traiterHl(new Request(url), url, d, T0, fetchImpl, { horloge });
    expect(res.status).toBe(200);
    expect(horloge.poses).toEqual([ATTENTE_FROID_MAX_MS]);
    expect(horloge.annules).toHaveLength(1); // aucun minuteur de 15 s laissé pendant
  });

  test("collecteur (forcer) NON affecté : il attend la fin du scan même au-delà du délai", async () => {
    reinitialiserHl();
    const d = baseTest();
    const { fetchImpl, verrou } = amontLent();
    const horloge = horlogeFactice();
    let resolue = false;
    const collecte = obtenirInstantane(d, fetchImpl, T0, { forcer: true, horloge }).then((r) => {
      resolue = true;
      return r;
    });
    // Une lecture UI concurrente abandonne au bout du délai…
    const url = new URL("http://x/hl/liqlevels/BTC");
    const res = await traiterHl(new Request(url), url, d, T0 + 1, fetchImpl, { horloge });
    expect(res.status).toBe(503);
    // … mais le collecteur, lui, attend toujours le point neuf.
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(resolue).toBe(false);
    verrou.resolve();
    const inst = await collecte;
    expect(inst?.ts).toBe(T0);
    expect(inst?.adressesScannees).toBe(1);
  });

  test("une construction orpheline (lancée avant reinitialiserHl) n'écrit pas le cache", async () => {
    reinitialiserHl();
    const d = baseTest();
    const { fetchImpl, verrou } = amontLent();
    const orpheline = obtenirInstantane(d, fetchImpl, T0, { forcer: true });
    reinitialiserHl();
    verrou.resolve();
    expect((await orpheline)?.ts).toBe(T0); // son appelant reçoit bien son résultat…
    // … mais le cache est resté vide : une lecture avec amont KO répond 503.
    const url = new URL("http://x/hl/liqlevels/BTC");
    const ko = stubHl({ adresses: [A1], infoKo: [A1] });
    const res = await traiterHl(new Request(url), url, d, T0 + 1, ko.fetchImpl);
    expect(res.status).toBe(503);
  });
});
