import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compacterSiNecessaire, ratioFreelist } from "./db";

// Le compactage n'a de sens que sur une base FICHIER en WAL (comme la base réelle) :
// `:memory:` n'a ni fichier ni WAL, donc ne peut pas exercer la troncature.
const repertoires: string[] = [];

/** Base fichier WAL jetable, remplie de `lignes` enregistrements d'environ 300 octets. */
function baseFichier(lignes: number): { d: Database; chemin: string } {
  const rep = mkdtempSync(join(tmpdir(), "axiomd-db-"));
  repertoires.push(rep);
  const chemin = join(rep, "essai.db");
  const d = new Database(chemin, { create: true });
  d.run("PRAGMA journal_mode = WAL");
  d.run("CREATE TABLE t (id INTEGER PRIMARY KEY, x TEXT)");
  const inserer = d.query("INSERT INTO t (x) VALUES (?)");
  d.transaction(() => {
    for (let i = 0; i < lignes; i++) inserer.run("y".repeat(300));
  })();
  return { d, chemin };
}

afterEach(() => {
  for (const rep of repertoires.splice(0)) rmSync(rep, { recursive: true, force: true });
});

describe("ratioFreelist", () => {
  test("base fraîche ≈ 0, base largement purgée > 0,2", () => {
    const { d } = baseFichier(20_000);
    expect(ratioFreelist(d)).toBeLessThan(0.05);
    d.run("DELETE FROM t WHERE id < 15000"); // bloc contigu → pages entières libérées
    expect(ratioFreelist(d)).toBeGreaterThan(0.2);
  });

  test("base vide (aucune page) → 0, pas de division par zéro", () => {
    expect(ratioFreelist(new Database(":memory:"))).toBe(0);
  });
});

describe("compacterSiNecessaire", () => {
  test("au-dessus du seuil : compacte, vide la freelist et RÉDUIT le fichier", () => {
    const { d, chemin } = baseFichier(20_000);
    d.run("DELETE FROM t WHERE id < 15000");
    const tailleAvant = statSync(chemin).size;

    expect(compacterSiNecessaire(d)).toBe(true);
    expect(ratioFreelist(d)).toBe(0);
    // Assertion CLÉ : en WAL, le VACUUM seul ne tronque PAS le fichier — il faut le
    // checkpoint. Sans lui, la freelist tombe à 0 mais les 15 Mo restent sur disque.
    expect(statSync(chemin).size).toBeLessThan(tailleAvant);
  });

  test("sous le seuil : ne compacte pas", () => {
    const { d } = baseFichier(2_000);
    expect(compacterSiNecessaire(d)).toBe(false);
  });

  test("base :memory: (tests injectant une base) : inerte, ne lève pas", () => {
    expect(compacterSiNecessaire(new Database(":memory:"))).toBe(false);
  });
});
