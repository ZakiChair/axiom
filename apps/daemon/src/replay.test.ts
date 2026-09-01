import { describe, expect, test } from "bun:test";
import {
  estJourValide,
  estSymboleValide,
  LIMITE_DEFAUT,
  LIMITE_MAX,
  lireTradesDepuisProcessus,
  normaliserHorodatage,
  parseAggTradesCsv,
  parseCheminReplay,
  parseLigneTrade,
  parseRequeteTrades,
  traiterReplay,
} from "./replay";

describe("normaliserHorodatage", () => {
  test("millisecondes conservées", () => {
    expect(normaliserHorodatage(1_782_000_000_000)).toBe(1_782_000_000_000);
  });
  test("microsecondes converties en ms", () => {
    expect(normaliserHorodatage(1_782_000_000_000_000)).toBe(1_782_000_000_000);
  });
  test("non-fini → NaN", () => {
    expect(Number.isNaN(normaliserHorodatage(Number.POSITIVE_INFINITY))).toBe(true);
  });
});

describe("parseLigneTrade", () => {
  test("ligne valide (isBuyerMaker=true)", () => {
    // aggId, prix, qty, firstId, lastId, timestamp(ms), isBuyerMaker, isBestMatch
    expect(parseLigneTrade("123,42000.5,0.01,1,1,1782000000000,true,true")).toEqual({
      t: 1_782_000_000_000,
      prix: 42000.5,
      qty: 0.01,
      isBuyerMaker: 1,
    });
  });
  test("isBuyerMaker=false → 0 ; timestamp µs normalisé", () => {
    expect(parseLigneTrade("124,10,2,1,1,1782000000000000,false,true")).toEqual({
      t: 1_782_000_000_000,
      prix: 10,
      qty: 2,
      isBuyerMaker: 0,
    });
  });
  test("en-tête écarté (prix non numérique)", () => {
    expect(parseLigneTrade("agg_trade_id,price,quantity,first_trade_id,last_trade_id,transact_time,is_buyer_maker,is_best_match")).toBeNull();
  });
  test("ligne vide / champs manquants → null", () => {
    expect(parseLigneTrade("")).toBeNull();
    expect(parseLigneTrade("1,2,3")).toBeNull();
  });
  test("tolère les retours chariot \\r (CRLF)", () => {
    expect(parseLigneTrade("1,5,1,1,1,1000,1,true\r")).toEqual({ t: 1000, prix: 5, qty: 1, isBuyerMaker: 1 });
  });
});

describe("parseAggTradesCsv", () => {
  test("parse un CSV avec en-tête + lignes, écarte l'invalide", () => {
    const csv = [
      "agg_trade_id,price,quantity,first_trade_id,last_trade_id,transact_time,is_buyer_maker,is_best_match",
      "1,100,1,1,1,1000,false,true",
      "2,101,2,2,2,2000,true,true",
      "corrompue",
      "3,99,0.5,3,3,3000,false,true",
    ].join("\n");
    expect(parseAggTradesCsv(csv)).toEqual([
      { t: 1000, prix: 100, qty: 1, isBuyerMaker: 0 },
      { t: 2000, prix: 101, qty: 2, isBuyerMaker: 1 },
      { t: 3000, prix: 99, qty: 0.5, isBuyerMaker: 0 },
    ]);
  });
});

describe("estJourValide / estSymboleValide", () => {
  test("jour", () => {
    expect(estJourValide("2026-06-30")).toBe(true);
    expect(estJourValide("2026-6-30")).toBe(false);
    expect(estJourValide("30-06-2026")).toBe(false);
  });
  test("symbole", () => {
    expect(estSymboleValide("BTCUSDT")).toBe(true);
    expect(estSymboleValide("ETH-USD")).toBe(false);
    expect(estSymboleValide("../etc")).toBe(false);
    expect(estSymboleValide("A")).toBe(false);
  });
});

describe("parseCheminReplay", () => {
  test("/replay/status/:symbole/:jour", () => {
    expect(parseCheminReplay("/replay/status/BTCUSDT/2026-06-30")).toEqual({
      symbole: "BTCUSDT",
      jour: "2026-06-30",
    });
  });
  test("/replay/trades/:symbole/:jour (symbole remis en MAJ)", () => {
    expect(parseCheminReplay("/replay/trades/btcusdt/2026-06-30")).toEqual({
      symbole: "BTCUSDT",
      jour: "2026-06-30",
    });
  });
  test("formes invalides → null", () => {
    expect(parseCheminReplay("/replay/trades/BTCUSDT")).toBeNull(); // jour manquant
    expect(parseCheminReplay("/replay/trades/BTC/USDT/2026-06-30")).toBeNull(); // segment en trop
    expect(parseCheminReplay("/replay/trades/BAD!/2026-06-30")).toBeNull(); // symbole invalide
    expect(parseCheminReplay("/replay/trades/BTCUSDT/pas-une-date")).toBeNull();
  });
});

describe("parseRequeteTrades", () => {
  test("depuis + limite lus", () => {
    expect(parseRequeteTrades(new URLSearchParams("depuis=1000&limite=42"))).toEqual({
      depuis: 1000,
      limite: 42,
    });
  });
  test("limite absente → défaut ; depuis absent → null", () => {
    expect(parseRequeteTrades(new URLSearchParams(""))).toEqual({ depuis: null, limite: LIMITE_DEFAUT });
  });
  test("limite bornée à [1, LIMITE_MAX]", () => {
    expect(parseRequeteTrades(new URLSearchParams("limite=0")).limite).toBe(1);
    expect(parseRequeteTrades(new URLSearchParams("limite=99999999")).limite).toBe(LIMITE_MAX);
  });
});

describe("lireTradesDepuisProcessus", () => {
  /** Lance un process réel (bun -e) exécutant `script`, avec un espion sur kill(). */
  function processusScript(script: string): {
    processus: { stdout: ReadableStream<Uint8Array>; kill: () => void; exited: Promise<number> };
    tue: () => boolean;
  } {
    const proc = Bun.spawn(["bun", "-e", script], { stdout: "pipe", stderr: "ignore" });
    let aTue = false;
    return {
      processus: {
        stdout: proc.stdout as ReadableStream<Uint8Array>,
        kill: () => {
          aTue = true;
          proc.kill();
        },
        exited: proc.exited,
      },
      tue: () => aTue,
    };
  }

  /** Script imprimant `n` lignes CSV d'aggTrades valides (\n final sauf si demandé). */
  function scriptCsv(n: number, avecNewlineFinal: boolean): string {
    return (
      `let s = ""; for (let i = 0; i < ${n}; i++) ` +
      `s += i + ",100,1,1,1,1782000000000,true,true" + ((i < ${n} - 1 || ${avecNewlineFinal}) ? "\\n" : ""); ` +
      `process.stdout.write(s);`
    );
  }

  test("dépassement de maxLignes : TUE le process (borne mémoire effective) et signale deborde", async () => {
    const { processus, tue } = processusScript(scriptCsv(5_000, true));
    const lots: number[] = [];
    const res = await lireTradesDepuisProcessus(processus, (lot) => lots.push(lot.length), 1_000, 100);
    expect(res.deborde).toBe(true);
    expect(tue()).toBe(true); // unzip tué AVANT `await exited` : stdout restant jamais drainé en RSS
    // Comptage déterministe : flush par 100 jusqu'à 1000, puis 1 ligne fait déborder (flush final).
    expect(res.recus).toBe(1_001);
  });

  test("flux complet sous la borne : tout est lu, dernière ligne SANS \\n incluse, process non tué", async () => {
    const { processus, tue } = processusScript(scriptCsv(250, false));
    let total = 0;
    const res = await lireTradesDepuisProcessus(processus, (lot) => (total += lot.length), 1_000_000, 100);
    expect(res.deborde).toBe(false);
    expect(tue()).toBe(false);
    expect(res.recus).toBe(250);
    expect(total).toBe(250);
  });
});

describe("traiterReplay — purge pendant téléchargement", () => {
  test("DELETE d'un jour dont le job est EN VOL → 409, sans toucher la base", async () => {
    // Le garde `enCoursInjecte` court-circuite AVANT tout accès SQLite : ce test ne
    // touche donc jamais le fichier axiom.db réel (aucun jeu d'état à nettoyer).
    const url = new URL("http://127.0.0.1:8787/replay/trades/BTCUSDT/2026-01-01");
    const rep = await traiterReplay(
      new Request(url, { method: "DELETE" }),
      url,
      new Set(["BTCUSDT|2026-01-01"]),
    );
    expect(rep.status).toBe(409);
    const corps = (await rep.json()) as Record<string, unknown>;
    expect(corps.erreur).toBe("téléchargement en cours, purge refusée");
    expect(corps.symbole).toBe("BTCUSDT");
    expect(corps.jour).toBe("2026-01-01");
  });
});
