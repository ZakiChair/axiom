/**
 * Tests du module PARTAGÉ shared/hyperliquidScan.ts (daemon + fonction Vercel + navigateur) :
 * options ajoutées au scan pour le mode navigateur (progression, interruption, pause avant
 * lot, journal et en-têtes injectés), règle de fraîcheur du pool, validation d'un pool
 * transporté (stockage local, réponse /hlpool) et téléchargement borné du leaderboard.
 * Le comportement PAR DÉFAUT du scan (cadence, 429, rejeu, abandon) reste couvert par
 * hyperliquid.test.ts, qui importe les mêmes symboles via la réexportation du daemon.
 */
import { describe, expect, test } from "bun:test";
import {
  CONCURRENCE,
  construireInstantane,
  LOTS_PAR_PROGRESSION,
  N_VALEUR_POOL,
  poolEstFrais,
  TAILLE_MAX_LEADERBOARD,
  TAILLE_POOL,
  telechargerPool,
  TTL_POOL_MS,
  URL_INFO,
  URL_LEADERBOARD,
  validerPoolHl,
  type HorlogeScan,
  type InstantaneHL,
} from "../../../shared/hyperliquidScan";

const T0 = Date.UTC(2026, 8, 25, 12, 0, 0);

/** Adresse synthétique valide n° i (0x + 40 hex). */
function adresse(i: number): string {
  return `0x${i.toString(16).padStart(40, "0")}`;
}

/** Horloge factice : les attentes avancent `now` et rappellent tout de suite. */
function horlogeFactice(): HorlogeScan & { demandes: number[] } {
  let t = 0;
  const demandes: number[] = [];
  return {
    demandes,
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

/** Compte HL avec une position BTC exploitable (liquidationPx 30 000, 50 000 $). */
function etatAvecPosition(): unknown {
  return {
    assetPositions: [
      {
        position: {
          coin: "BTC",
          szi: "1",
          entryPx: "60000",
          liquidationPx: "30000",
          positionValue: "50000",
          leverage: { type: "cross", value: 2 },
        },
      },
    ],
  };
}

/** Stub POST /info : chaque adresse a une position ; journalise utilisateurs et en-têtes. */
function stubInfo(): {
  fetchImpl: typeof fetch;
  appels: string[];
  entetes: Array<Record<string, string>>;
} {
  const appels: string[] = [];
  const entetes: Array<Record<string, string>> = [];
  const fetchImpl = (async (entree: RequestInfo | URL, init?: RequestInit) => {
    if (String(entree) !== URL_INFO) throw new Error(`URL inattendue : ${String(entree)}`);
    appels.push((JSON.parse(String(init?.body ?? "{}")) as { user?: string }).user ?? "");
    entetes.push({ ...(init?.headers as Record<string, string>) });
    return new Response(JSON.stringify(etatAvecPosition()));
  }) as typeof fetch;
  return { fetchImpl, appels, entetes };
}

describe("construireInstantane — progression (mode navigateur)", () => {
  test("appelée tous les N lots avec l'instantané PARTIEL, jamais après le dernier lot", async () => {
    const { fetchImpl } = stubInfo();
    const adresses = Array.from({ length: 12 }, (_, i) => adresse(i + 1)); // 3 lots
    const vus: Array<{ faites: number; total: number; scannees: number; btc: number }> = [];
    const inst = await construireInstantane(adresses, fetchImpl, T0, {
      horloge: horlogeFactice(),
      lotsParProgression: 1,
      journal: () => {},
      onProgression: (partiel, faites, total) =>
        vus.push({ faites, total, scannees: partiel.adressesScannees, btc: partiel.parCoin.get("BTC")?.length ?? 0 }),
    });
    expect(vus).toEqual([
      { faites: 4, total: 12, scannees: 4, btc: 4 },
      { faites: 8, total: 12, scannees: 8, btc: 8 },
    ]);
    expect(inst.adressesScannees).toBe(12);
    expect(inst.parCoin.get("BTC")).toHaveLength(12);
  });

  test("pas par défaut LOTS_PAR_PROGRESSION ; le partiel porte l'horodatage logique du scan", async () => {
    expect(LOTS_PAR_PROGRESSION).toBe(5);
    const { fetchImpl } = stubInfo();
    const adresses = Array.from({ length: 44 }, (_, i) => adresse(i + 1)); // 11 lots
    const faites: number[] = [];
    const ts: number[] = [];
    await construireInstantane(adresses, fetchImpl, T0, {
      horloge: horlogeFactice(),
      journal: () => {},
      onProgression: (partiel: InstantaneHL, f) => {
        faites.push(f);
        ts.push(partiel.ts);
      },
    });
    expect(faites).toEqual([5 * CONCURRENCE, 10 * CONCURRENCE]);
    expect(ts).toEqual([T0, T0]);
  });

  test("le dernier lot incomplet compte ses adresses réelles (faites ≤ total)", async () => {
    const { fetchImpl } = stubInfo();
    const adresses = Array.from({ length: 10 }, (_, i) => adresse(i + 1)); // lots 4, 4, 2
    const faites: number[] = [];
    await construireInstantane(adresses, fetchImpl, T0, {
      horloge: horlogeFactice(),
      lotsParProgression: 1,
      journal: () => {},
      onProgression: (_p, f, total) => {
        faites.push(f);
        expect(total).toBe(10);
      },
    });
    expect(faites).toEqual([4, 8]);
  });
});

describe("construireInstantane — interruption (signal) et pause avant lot", () => {
  test("signal déjà interrompu : aucune requête, instantané vide", async () => {
    const { fetchImpl, appels } = stubInfo();
    const ctrl = new AbortController();
    ctrl.abort();
    const inst = await construireInstantane([adresse(1), adresse(2)], fetchImpl, T0, {
      horloge: horlogeFactice(),
      signal: ctrl.signal,
      journal: () => {},
    });
    expect(appels).toEqual([]);
    expect(inst.adressesScannees).toBe(0);
  });

  test("interrompu pendant le scan : plus AUCUN lot envoyé ensuite, le partiel est rendu", async () => {
    const { fetchImpl, appels } = stubInfo();
    const ctrl = new AbortController();
    const adresses = Array.from({ length: 20 }, (_, i) => adresse(i + 1));
    const lignes: string[] = [];
    const inst = await construireInstantane(adresses, fetchImpl, T0, {
      horloge: horlogeFactice(),
      signal: ctrl.signal,
      lotsParProgression: 1,
      journal: (l) => lignes.push(l),
      onProgression: (_p, faites) => {
        if (faites === 2 * CONCURRENCE) ctrl.abort();
      },
    });
    expect(appels).toHaveLength(2 * CONCURRENCE);
    expect(inst.adressesScannees).toBe(2 * CONCURRENCE);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toContain("(interrompu)");
  });

  test("avantLot est attendu AVANT chaque lot : rien ne part tant qu'il n'est pas résolu", async () => {
    const { fetchImpl, appels } = stubInfo();
    const adresses = Array.from({ length: 8 }, (_, i) => adresse(i + 1)); // 2 lots
    let liberer: () => void = () => {};
    let pauseAtteinte: () => void = () => {};
    const enPause = new Promise<void>((r) => (pauseAtteinte = r));
    let appelsAvantLot = 0;
    const scan = construireInstantane(adresses, fetchImpl, T0, {
      horloge: horlogeFactice(),
      journal: () => {},
      avantLot: () => {
        appelsAvantLot += 1;
        if (appelsAvantLot !== 2) return Promise.resolve();
        pauseAtteinte();
        return new Promise<void>((r) => (liberer = r)); // onglet caché jusqu'à la reprise
      },
    });
    await enPause;
    // Le 1er lot est parti ; le 2e attend la reprise (aucune requête de plus).
    await new Promise((r) => setTimeout(r, 5));
    expect(appels).toHaveLength(CONCURRENCE);
    liberer();
    const inst = await scan;
    expect(appels).toHaveLength(2 * CONCURRENCE);
    expect(appelsAvantLot).toBe(2);
    expect(inst.adressesScannees).toBe(8);
  });

  test("interrompu PENDANT une pause : aucun lot après la reprise", async () => {
    const { fetchImpl, appels } = stubInfo();
    const ctrl = new AbortController();
    const adresses = Array.from({ length: 8 }, (_, i) => adresse(i + 1));
    let n = 0;
    const inst = await construireInstantane(adresses, fetchImpl, T0, {
      horloge: horlogeFactice(),
      signal: ctrl.signal,
      journal: () => {},
      avantLot: async () => {
        n += 1;
        if (n === 2) ctrl.abort(); // la couche passe à OFF pendant que l'onglet est caché
      },
    });
    expect(appels).toHaveLength(CONCURRENCE);
    expect(inst.adressesScannees).toBe(CONCURRENCE);
  });
});

describe("construireInstantane — journal et en-têtes injectés", () => {
  test("une ligne de journal par instantané, sans préfixe imposé", async () => {
    const { fetchImpl } = stubInfo();
    const lignes: string[] = [];
    await construireInstantane([adresse(1)], fetchImpl, T0, {
      horloge: horlogeFactice(),
      journal: (l) => lignes.push(l),
    });
    expect(lignes).toEqual(["instantané HL : 1 adresses en 0.0 s"]);
  });

  test("en-têtes : JSON par défaut, complétés par ceux de l'appelant (user-agent du daemon)", async () => {
    const { fetchImpl, entetes } = stubInfo();
    await construireInstantane([adresse(1)], fetchImpl, T0, {
      horloge: horlogeFactice(),
      journal: () => {},
      entetes: { "user-agent": "axiom-test" },
    });
    expect(entetes[0]).toEqual({
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "axiom-test",
    });
  });
});

describe("poolEstFrais (PURE) — mêmes paramètres ET moins de 6 h", () => {
  const frais = { ts: T0, nValeur: N_VALEUR_POOL, tailleCible: TAILLE_POOL };
  test("paramètres courants, âge < TTL → frais", () => {
    expect(poolEstFrais(frais, T0 + TTL_POOL_MS - 1)).toBe(true);
  });
  test("âge ≥ TTL → périmé", () => {
    expect(poolEstFrais(frais, T0 + TTL_POOL_MS)).toBe(false);
  });
  test("autres paramètres (ou ancien format sans paramètres) → pas frais", () => {
    expect(poolEstFrais({ ...frais, nValeur: 150 }, T0)).toBe(false);
    expect(poolEstFrais({ ...frais, tailleCible: 500 }, T0)).toBe(false);
    expect(poolEstFrais({ ...frais, nValeur: null, tailleCible: null }, T0)).toBe(false);
  });
});

describe("validerPoolHl (PURE) — pool transporté (stockage local, réponse /hlpool)", () => {
  const A = adresse(1);
  const B = adresse(2);
  test("forme conforme → pool typé", () => {
    expect(validerPoolHl({ adresses: [A, B], ts: T0, nValeur: 500, tailleCible: 1500 })).toEqual({
      adresses: [A, B],
      ts: T0,
      nValeur: 500,
      tailleCible: 1500,
    });
  });
  test("adresses invalides écartées une à une, doublons retirés", () => {
    expect(validerPoolHl({ adresses: [A, "0xabc", 42, A, B], ts: T0, nValeur: 500, tailleCible: 1500 })?.adresses).toEqual([
      A,
      B,
    ]);
  });
  test("enveloppe non conforme ou pool vide → null", () => {
    expect(validerPoolHl(null)).toBeNull();
    expect(validerPoolHl("<!doctype html>")).toBeNull(); // repli SPA servi en 200
    expect(validerPoolHl({ adresses: [], ts: T0, nValeur: 500, tailleCible: 1500 })).toBeNull();
    expect(validerPoolHl({ adresses: ["0xabc"], ts: T0, nValeur: 500, tailleCible: 1500 })).toBeNull();
    expect(validerPoolHl({ adresses: [A], ts: "hier", nValeur: 500, tailleCible: 1500 })).toBeNull();
    expect(validerPoolHl({ adresses: [A], ts: T0, nValeur: "500", tailleCible: 1500 })).toBeNull();
    expect(validerPoolHl({ adresses: [A], ts: T0, nValeur: 500 })).toBeNull();
  });
  test("plus d'adresses que la taille cible annoncée → null (réponse aberrante)", () => {
    expect(validerPoolHl({ adresses: [A, B], ts: T0, nValeur: 1, tailleCible: 1 })).toBeNull();
  });
});

describe("telechargerPool — leaderboard borné → pool", () => {
  const lignes = (n: number): unknown => ({
    leaderboardRows: Array.from({ length: n }, (_, i) => ({ ethAddress: adresse(i + 1), accountValue: String(1000 - i) })),
  });

  test("réponse conforme → pool extrait ; URL, en-têtes et signal transmis", async () => {
    const vus: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (entree: RequestInfo | URL, init?: RequestInit) => {
      vus.push({ url: String(entree), init });
      return new Response(JSON.stringify(lignes(3)));
    }) as typeof fetch;
    const ctrl = new AbortController();
    const pool = await telechargerPool(fetchImpl, { signal: ctrl.signal, entetes: { "user-agent": "x" } });
    expect(pool).toEqual([adresse(1), adresse(2), adresse(3)]);
    expect(vus[0]?.url).toBe(URL_LEADERBOARD);
    expect(vus[0]?.init?.signal).toBe(ctrl.signal);
    expect(vus[0]?.init?.headers).toEqual({ accept: "application/json", "user-agent": "x" });
  });

  test("HTTP ≠ 2xx, content-length démesuré, JSON sans ligne exploitable → rejet", async () => {
    const reponse = (r: Response): typeof fetch => (async () => r) as unknown as typeof fetch;
    await expect(telechargerPool(reponse(new Response("x", { status: 502 })))).rejects.toThrow("leaderboard HTTP 502");
    await expect(
      telechargerPool(
        reponse(new Response("{}", { headers: { "content-length": String(TAILLE_MAX_LEADERBOARD + 1) } })),
      ),
    ).rejects.toThrow("leaderboard trop volumineux");
    await expect(telechargerPool(reponse(new Response(JSON.stringify({ leaderboardRows: [] }))))).rejects.toThrow(
      "leaderboard sans ligne exploitable",
    );
    await expect(telechargerPool(reponse(new Response("pas du json")))).rejects.toThrow();
    await expect(telechargerPool(reponse(new Response(null)))).rejects.toThrow("leaderboard sans corps");
  });

  test("corps en flux SANS content-length au-delà du plafond → rejeté et coupé, jamais lu en entier", async () => {
    // Transfert chunked aberrant : sans en-tête, seul le COMPTEUR d'octets borne la mémoire.
    let tires = 0;
    let annule = false;
    const morceau = new Uint8Array(1024).fill(0x20); // 1 Kio d'espaces (JSON valide jusqu'ici)
    const corps = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        tires += 1;
        if (tires > 1000) ctrl.close(); // ≈ 1 Mio si rien ne coupait la lecture
        else ctrl.enqueue(morceau);
      },
      cancel() {
        annule = true;
      },
    });
    const fetchImpl = (async () => new Response(corps)) as unknown as typeof fetch;
    await expect(telechargerPool(fetchImpl, { maxOctets: 4096 })).rejects.toThrow("leaderboard trop volumineux");
    expect(tires).toBeLessThan(10); // 5 Kio lus au plus (+ lecture anticipée du flux), pas 1 Mio
    expect(annule).toBe(true); // flux amont coupé (connexion libérée)
  });

  test("plafond compté en OCTETS (UTF-8) et JSON décodé morceau par morceau (caractère coupé entre deux morceaux)", async () => {
    const json = new TextEncoder().encode(
      JSON.stringify({ leaderboardRows: [{ ethAddress: adresse(1), accountValue: "1", displayName: "é€" }] }),
    );
    const corps = new ReadableStream<Uint8Array>({
      start(ctrl) {
        for (let i = 0; i < json.length; i += 3) ctrl.enqueue(json.slice(i, i + 3)); // coupe les multi-octets
        ctrl.close();
      },
    });
    const fetchImpl = (async () => new Response(corps)) as unknown as typeof fetch;
    expect(await telechargerPool(fetchImpl, { maxOctets: json.length })).toEqual([adresse(1)]);
    const trop = (async () => new Response(json)) as unknown as typeof fetch;
    await expect(telechargerPool(trop, { maxOctets: json.length - 1 })).rejects.toThrow("leaderboard trop volumineux");
  });
});

describe("module partagé : aucune dépendance d'exécution propre à un environnement", () => {
  test("ni Bun, ni node:*, ni DOM (document/window/localStorage), ni process", async () => {
    const source = await Bun.file(new URL("../../../shared/hyperliquidScan.ts", import.meta.url)).text();
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bfrom\s+["'](?:bun:|node:)/);
    expect(code).not.toMatch(/\b(?:Bun|process|document|window|localStorage|sessionStorage|navigator)\b/);
    expect(code).not.toMatch(/\bimport\b/); // module feuille : aucun import
  });
});
