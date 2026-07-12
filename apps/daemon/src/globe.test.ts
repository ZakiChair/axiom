import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { EvenementGdelt } from "./gdelt";
import { assurerTablesGlobe, ingererEvenements, lireMeta, ecrireMeta, purgerEvenements, traiterGlobe } from "./globe";

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
  });
});
