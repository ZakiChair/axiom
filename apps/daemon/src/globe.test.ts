import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { deflateRawSync } from "node:zlib";
import type { EvenementGdelt } from "./gdelt";
import { assurerTablesGlobe, demarrerBoucleGlobe, ecrireMeta, enregistrerGlobe, ingererEvenements, lireMeta, purgerEvenements, rafraichirGdelt, rafraichirUcdp, traiterGlobe, urlsTranches } from "./globe";
import { Routeur } from "./router";

const T0 = Date.UTC(2026, 6, 12, 12, 0, 0);

function evt(patch: Partial<EvenementGdelt>): EvenementGdelt {
  return {
    idGdelt: "1", dateMs: T0, lat: 48.45, lon: 35.02, codeCameo: "190", racine: "19",
    quadClass: 4, goldstein: -10, mentions: 4, acteur1: "A", acteur2: "B",
    url: "https://exemple.test", categorie: "materiel", ...patch,
  };
}

function baseTest(): Database {
  const d = new Database(":memory:");
  assurerTablesGlobe(d);
  return d;
}

describe("ingestion / purge", () => {
  test("insère, dédoublonne par idGdelt, purge au-delà de la rétention", () => {
    const d = baseTest();
    expect(ingererEvenements(d, [evt({ idGdelt: "1" }), evt({ idGdelt: "2" })])).toBe(2);
    expect(ingererEvenements(d, [evt({ idGdelt: "2" }), evt({ idGdelt: "3" })])).toBe(1);
    const vieux = evt({ idGdelt: "4", dateMs: T0 - 72 * 3_600_000 });
    ingererEvenements(d, [vieux]);
    expect(purgerEvenements(d, T0)).toBe(1); // rétention 48 h par défaut
  });
});

describe("meta (globe_instantanes)", () => {
  test("écrit puis relit un instantané avec son majA", () => {
    const d = baseTest();
    expect(lireMeta(d, "ucdp")).toBeNull();
    ecrireMeta(d, "ucdp", '{"zones":[]}', T0);
    expect(lireMeta(d, "ucdp")).toEqual({ corps: '{"zones":[]}', majA: T0 });
  });
});

describe("traiterGlobe — gardes (AVANT tout accès base)", () => {
  test("405 hors GET, 404 chemin inconnu", async () => {
    const res405 = await traiterGlobe(new Request("http://x/globe/evenements", { method: "POST" }), new URL("http://x/globe/evenements"));
    expect(res405.status).toBe(405);
    const res404 = await traiterGlobe(new Request("http://x/globe/nimporte"), new URL("http://x/globe/nimporte"));
    expect(res404.status).toBe(404);
  });
});

describe("GET /globe/evenements", () => {
  test("agrège la fenêtre demandée et renvoie majA + couverture", async () => {
    const d = baseTest();
    ingererEvenements(d, [
      evt({ idGdelt: "1", dateMs: T0 - 3_600_000 }),
      evt({ idGdelt: "2", dateMs: T0 - 2 * 3_600_000, mentions: 6 }),
      evt({ idGdelt: "3", dateMs: T0 - 30 * 3_600_000 }), // hors fenêtre 24 h
    ]);
    ecrireMeta(d, "gdelt", "{}", T0);
    const url = new URL("http://x/globe/evenements?fenetreH=24");
    const res = await traiterGlobe(new Request(url), url, d, T0);
    expect(res.status).toBe(200);
    const corps = (await res.json()) as { majA: number | null; couverture: { deMs: number; aMs: number } | null; cellules: unknown[] };
    expect(corps.majA).toBe(T0);
    expect(corps.couverture).toEqual({ deMs: T0 - 2 * 3_600_000, aMs: T0 - 3_600_000 });
    expect(corps.cellules.length).toBe(1); // même cellule, même catégorie
  });
  test("base vide → cellules [], couverture null (jamais d'erreur)", async () => {
    const url = new URL("http://x/globe/evenements");
    const res = await traiterGlobe(new Request(url), url, baseTest(), T0);
    expect(((await res.json()) as { cellules: unknown[]; couverture: null }).couverture).toBeNull();
  });
});

describe("GET /globe/evenements/zone", () => {
  test("renvoie les événements de la cellule triés par mentions, plafonnés à 20", async () => {
    const d = baseTest();
    const beaucoup: EvenementGdelt[] = [];
    for (let i = 0; i < 25; i++) beaucoup.push(evt({ idGdelt: `z${i}`, mentions: i }));
    beaucoup.push(evt({ idGdelt: "ailleurs", lat: 10, lon: 10, mentions: 999 }));
    ingererEvenements(d, beaucoup);
    const url = new URL("http://x/globe/evenements/zone?lat=48.5&lon=35&fenetreH=24");
    const res = await traiterGlobe(new Request(url), url, d, T0);
    const corps = (await res.json()) as { evenements: Array<{ mentions: number }> };
    expect(corps.evenements.length).toBe(20);
    expect(corps.evenements[0]?.mentions).toBe(24); // pas le 999 d'une autre cellule
  });
  test("400 si lat/lon absents ou non numériques", async () => {
    const url = new URL("http://x/globe/evenements/zone?lat=abc");
    const res = await traiterGlobe(new Request(url), url, baseTest(), T0);
    expect(res.status).toBe(400);
    // Piège Number(null) === 0 : des paramètres ABSENTS ne valent pas (0,0).
    const urlSans = new URL("http://x/globe/evenements/zone");
    expect((await traiterGlobe(new Request(urlSans), urlSans, baseTest(), T0)).status).toBe(400);
    const urlLonSeul = new URL("http://x/globe/evenements/zone?lon=35");
    expect((await traiterGlobe(new Request(urlLonSeul), urlLonSeul, baseTest(), T0)).status).toBe(400);
  });
});

/** Zip mono-fichier minimal (même helper que zip.test.ts — dupliqué, fixtures de test). */
// Retour `Uint8Array<ArrayBuffer>` (pas le `ArrayBufferLike` par défaut) : requis
// pour que `new Response(zipDe(...))` typecheck (BodyInit DOM exige ArrayBuffer).
function zipDe(contenu: string): Uint8Array<ArrayBuffer> {
  const donnees = new Uint8Array(deflateRawSync(Buffer.from(contenu, "utf8")));
  const entete = new Uint8Array(30);
  const dv = new DataView(entete.buffer);
  dv.setUint32(0, 0x04034b50, true);
  dv.setUint16(8, 8, true);
  dv.setUint32(18, donnees.length, true);
  const zip = new Uint8Array(30 + donnees.length);
  zip.set(entete, 0);
  zip.set(donnees, 30);
  return zip;
}

/** Ligne GDELT 61 colonnes minimale valide (racine 19, géolocalisée). */
function ligneGdeltBrute(id: string): string {
  const c: string[] = new Array(61).fill("");
  c[0] = id; c[26] = "190"; c[28] = "19"; c[29] = "4"; c[30] = "-10.0"; c[31] = "2";
  c[56] = "48.45"; c[57] = "35.02"; c[59] = "20260712001500";
  return c.join("\t");
}

describe("urlsTranches", () => {
  test("génère la tranche courante + les précédentes par pas de 15 min", () => {
    expect(urlsTranches("http://data.gdeltproject.org/gdeltv2/20260712001500.export.CSV.zip", 3)).toEqual([
      "http://data.gdeltproject.org/gdeltv2/20260712001500.export.CSV.zip",
      "http://data.gdeltproject.org/gdeltv2/20260712000000.export.CSV.zip",
      "http://data.gdeltproject.org/gdeltv2/20260711234500.export.CSV.zip",
    ]);
  });
  test("URL sans horodatage reconnaissable → juste elle-même", () => {
    expect(urlsTranches("http://x/bizarre.zip", 3)).toEqual(["http://x/bizarre.zip"]);
  });
});

describe("rafraichirGdelt (fetch stubé, zéro réseau)", () => {
  test("lit lastupdate, ingère les tranches manquantes, tolère un 404 individuel, écrit la méta", async () => {
    const d = new Database(":memory:");
    assurerTablesGlobe(d);
    const urlZip = "http://data.gdeltproject.org/gdeltv2/20260712001500.export.CSV.zip";
    const fetchStub = (async (entree: RequestInfo | URL) => {
      const u = String(entree);
      if (u.endsWith("lastupdate.txt")) return new Response(`69666 abc ${urlZip}\nreste ignoré`);
      if (u === urlZip) return new Response(zipDe(`${ligneGdeltBrute("10")}\n${ligneGdeltBrute("11")}\n`));
      return new Response("introuvable", { status: 404 }); // tranches de backfill absentes
    }) as typeof fetch;
    const r = await rafraichirGdelt(d, fetchStub, T0);
    expect(r.inseres).toBe(2);
    expect(lireMeta(d, "gdelt")?.majA).toBe(T0);
    // Second appel : lastupdate inchangé → aucun travail.
    const r2 = await rafraichirGdelt(d, fetchStub, T0 + 1);
    expect(r2).toEqual({ tranches: 0, inseres: 0 });
  });
});

describe("rafraichirUcdp + GET /globe/conflits-ucdp", () => {
  const CSV = `latitude,longitude,best,side_a,side_b,date_start\n48.6,35.1,12,"Armée A","Armée B",2026-05-05 00:00:00.000\n`;
  function fetchUcdp(ok: boolean): typeof fetch {
    return (async (entree: RequestInfo | URL) => {
      if (!ok) return new Response("boom", { status: 500 });
      const u = String(entree);
      if (u.endsWith("index.html")) return new Response('<a href="candidateged/GEDEvent_v26_0_5.csv">x</a>');
      return new Response(CSV);
    }) as typeof fetch;
  }
  test("succès → instantané écrit, route répond hit", async () => {
    const d = new Database(":memory:");
    assurerTablesGlobe(d);
    expect(await rafraichirUcdp(d, fetchUcdp(true), T0)).toBe(true);
    const url = new URL("http://x/globe/conflits-ucdp");
    const res = await traiterGlobe(new Request(url), url, d, T0);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-axiomd-cache")).toBe("hit");
    const corps = (await res.json()) as { majA: number; fichier: string; zones: unknown[] };
    expect(corps).toEqual({ majA: T0, fichier: "GEDEvent_v26_0_5.csv", zones: [{ lat: 48.5, lon: 35, morts: 12, n: 1, sideA: "Armée A", sideB: "Armée B", dernierMs: Date.UTC(2026, 4, 5) }] });
  });
  test("échec amont avec instantané présent → stale servi ; sans instantané → 502", async () => {
    const d = new Database(":memory:");
    assurerTablesGlobe(d);
    await rafraichirUcdp(d, fetchUcdp(true), T0);
    const url = new URL("http://x/globe/conflits-ucdp");
    // Instantané vieux de 25 h → la route retente, échoue, sert le périmé.
    const res = await traiterGlobe(new Request(url), url, d, T0 + 25 * 3_600_000, fetchUcdp(false));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-axiomd-cache")).toBe("stale");
    const d2 = new Database(":memory:");
    assurerTablesGlobe(d2);
    const res502 = await traiterGlobe(new Request(url), url, d2, T0, fetchUcdp(false));
    expect(res502.status).toBe(502);
  });
});

describe("enregistrerGlobe", () => {
  test("le préfixe /globe est routé", async () => {
    const routeur = new Routeur();
    enregistrerGlobe(routeur);
    const url = new URL("http://x/globe/nimporte");
    const res = await routeur.gerer(new Request(url), url);
    expect(res?.status).toBe(404); // géré par traiterGlobe (chemin inconnu), pas null
  });
});

describe("demarrerBoucleGlobe", () => {
  test("renvoie une fonction d'arrêt sans lancer de réseau immédiat bloquant", () => {
    const arreter = demarrerBoucleGlobe();
    expect(typeof arreter).toBe("function");
    arreter();
  });
});
