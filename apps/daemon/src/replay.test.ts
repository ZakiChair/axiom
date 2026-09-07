import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  estJourValide,
  estSymboleValide,
  executerTelechargement,
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

describe("executerTelechargement — ZIP borné, purge, nettoyage", () => {
  const bases: Database[] = [];
  const dossiers: string[] = [];
  afterEach(() => {
    for (const d of bases.splice(0)) d.close();
    for (const dir of dossiers.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  function dossierTemporaire(prefixe: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefixe));
    dossiers.push(dir);
    return dir;
  }
  function baseReplay(): Database {
    const d = new Database(":memory:");
    bases.push(d);
    d.run(`CREATE TABLE replay_trades (
      symbole TEXT NOT NULL, jour TEXT NOT NULL, t INTEGER NOT NULL,
      prix REAL NOT NULL, qty REAL NOT NULL, isBuyerMaker INTEGER NOT NULL
    )`);
    d.run(`CREATE TABLE replay_jobs (
      symbole TEXT NOT NULL, jour TEXT NOT NULL, etat TEXT NOT NULL,
      recus INTEGER NOT NULL DEFAULT 0, octets INTEGER NOT NULL DEFAULT 0,
      erreur TEXT, majA INTEGER NOT NULL, PRIMARY KEY (symbole, jour)
    )`);
    return d;
  }

  test("dépassement du cap ZIP (réduit injecté) : abandon, tmp supprimé, jour purgé", async () => {
    const d = baseReplay();
    const dir = dossierTemporaire("axiom-replay-cap-");
    const flux = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(64).fill(1));
        c.close();
      },
    });
    await executerTelechargement("BTCUSDT", "2026-01-01", {
      db: d,
      tmpDir: dir,
      tailleMaxZip: 16,
      fetchImpl: async () => new Response(flux, { headers: { "content-type": "application/zip" } }),
      spawnUnzip: () => {
        throw new Error("unzip ne doit pas démarrer si le cap ZIP saute");
      },
    });
    const job = d.query("SELECT etat, erreur FROM replay_jobs WHERE symbole = 'BTCUSDT'").get() as {
      etat: string;
      erreur: string;
    };
    expect(job.etat).toBe("erreur");
    expect(job.erreur).toContain("volumineux");
    expect(d.query("SELECT COUNT(*) AS n FROM replay_trades").get() as { n: number }).toEqual({ n: 0 });
    expect(readdirSync(dir).filter((f) => f.endsWith(".zip"))).toEqual([]);
  });

  test("échec après insertion partielle ⇒ jour purgé et tmp supprimé", async () => {
    const d = baseReplay();
    d.exec(`CREATE TRIGGER t_fail AFTER INSERT ON replay_trades
      WHEN (SELECT COUNT(*) FROM replay_trades) >= 2
      BEGIN SELECT RAISE(FAIL, 'insert partiel'); END;`);
    const dir = dossierTemporaire("axiom-replay-part-");
    let tue = false;
    const csv = "1,100,1,1,1,1000,false,true\n2,101,2,2,2,2000,true,true\n";
    await executerTelechargement("ETHUSDT", "2026-02-02", {
      db: d,
      tmpDir: dir,
      tailleLot: 1,
      fetchImpl: async () =>
        new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "application/zip" } }),
      spawnUnzip: () => ({
        stdout: new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode(csv));
            c.close();
          },
        }),
        kill: () => { tue = true; },
        exited: Promise.resolve(0),
      }),
    });
    expect(d.query("SELECT COUNT(*) AS n FROM replay_trades").get() as { n: number }).toEqual({ n: 0 });
    const job = d.query("SELECT etat FROM replay_jobs WHERE symbole = 'ETHUSDT'").get() as { etat: string };
    expect(job.etat).toBe("erreur");
    expect(readdirSync(dir).filter((f) => f.endsWith(".zip"))).toEqual([]);
    expect(existsSync(dir)).toBe(true);
    expect(tue).toBe(true);
  });

  test("ZIP réel reçu en chunks : import complet, octets exacts, fichier temporaire supprimé", async () => {
    const d = baseReplay();
    const dir = dossierTemporaire("axiom-replay-reel-");
    const fixtures = dossierTemporaire("axiom-replay-fixture-");
    const csv = join(fixtures, "trades.csv");
    const zip = join(fixtures, "trades.zip");
    await Bun.write(csv, "1,100,1,1,1,1000,false,true\n2,101,2,2,2,2000,true,true\n");
    expect(Bun.spawnSync(["zip", "-j", zip, csv], { stdout: "ignore", stderr: "ignore" }).exitCode).toBe(0);
    const contenu = new Uint8Array(await Bun.file(zip).arrayBuffer());
    let position = 0;
    const flux = new ReadableStream<Uint8Array>({
      pull(c) {
        if (position >= contenu.length) { c.close(); return; }
        c.enqueue(contenu.slice(position, position + 17));
        position += 17;
      },
    });
    await executerTelechargement("BTCUSDT", "2026-01-01", {
      db: d, tmpDir: dir, tailleLot: 1,
      fetchImpl: async () => new Response(flux),
    });
    expect(d.query("SELECT etat, recus, octets FROM replay_jobs").get()).toEqual({
      etat: "pret", recus: 2, octets: contenu.length,
    });
    expect(d.query("SELECT t, prix FROM replay_trades ORDER BY t").all()).toEqual([
      { t: 1000, prix: 100 }, { t: 2000, prix: 101 },
    ]);
    expect(readdirSync(dir)).toEqual([]);
  });

  test.each([
    { nom: "unzip non zéro après lignes valides", code: 2, maxLignes: 10, suffixe: "\n" },
    { nom: "cap de lignes y compris dernière ligne sans newline", code: 0, maxLignes: 1, suffixe: "" },
  ])("$nom : aucun trade partiel conservé", async ({ code, maxLignes, suffixe }) => {
    const d = baseReplay();
    const dir = dossierTemporaire("axiom-replay-echec-");
    let tue = false;
    await executerTelechargement("BTCUSDT", "2026-01-01", {
      db: d, tmpDir: dir, maxLignes, tailleLot: 1,
      fetchImpl: async () => new Response(new Uint8Array([1, 2, 3])),
      spawnUnzip: () => ({
        stdout: new ReadableStream({ start(c) {
          c.enqueue(new TextEncoder().encode("1,100,1,1,1,1000,false,true\n2,101,2,2,2,2000,true,true" + suffixe));
          c.close();
        } }),
        kill: () => { tue = true; }, exited: Promise.resolve(code),
      }),
    });
    expect(d.query("SELECT etat, recus FROM replay_jobs").get()).toEqual({ etat: "erreur", recus: 0 });
    expect(d.query("SELECT COUNT(*) AS n FROM replay_trades").get()).toEqual({ n: 0 });
    expect(tue).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
  });

  test("coupure du flux ZIP après une écriture : fichier nettoyé, unzip jamais lancé", async () => {
    const d = baseReplay();
    const dir = dossierTemporaire("axiom-replay-coupure-");
    let appels = 0;
    let unzipLance = false;
    const flux = new ReadableStream<Uint8Array>({ pull(c) {
      if (appels++ === 0) c.enqueue(new Uint8Array([1, 2, 3]));
      else c.error(new Error("connexion coupée"));
    } });
    await executerTelechargement("BTCUSDT", "2026-01-01", {
      db: d, tmpDir: dir, fetchImpl: async () => new Response(flux),
      spawnUnzip: () => { unzipLance = true; throw new Error("inattendu"); },
    });
    expect(unzipLance).toBe(false);
    expect(d.query("SELECT etat, erreur FROM replay_jobs").get()).toEqual({
      etat: "erreur", erreur: "connexion coupée",
    });
    expect(readdirSync(dir)).toEqual([]);
  });

  test("une ligne CSV sans fin ne peut pas grossir sans limite", async () => {
    let tue = false;
    let annule = false;
    const proc = {
      stdout: new ReadableStream<Uint8Array>({
        pull(c) { c.enqueue(new Uint8Array(32 * 1024).fill(65)); },
        cancel() { annule = true; },
      }),
      kill: () => { tue = true; }, exited: Promise.resolve(0),
    };
    await expect(lireTradesDepuisProcessus(proc, () => {})).rejects.toThrow("ligne CSV replay trop volumineuse");
    expect(tue).toBe(true);
    expect(annule).toBe(true);
    expect(proc.stdout.locked).toBe(false);
  });
});
