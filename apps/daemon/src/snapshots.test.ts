import { describe, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  creerSnapshot,
  demarrerBoucleSnapshots,
  deserialiserSnapshot,
  doitDeclencherSnapshot,
  idsAPurger,
  lireEntreesKv,
  lireSnapshot,
  listerMetaSnapshots,
  MS_JOUR,
  parseCheminSnapshots,
  purgerSnapshots,
  restaurerSnapshot,
  serialiserSnapshot,
  snapshotQuotidienSiNecessaire,
  traiterSnapshots,
  type EntreeSnapshot,
} from "./snapshots";

// ─────────────────────────── Fonctions PURES ───────────────────────────

describe("doitDeclencherSnapshot", () => {
  test("aucun snapshot (null / ≤ 0) → déclenche", () => {
    const now = new Date(2026, 6, 9, 12, 0, 0).getTime();
    expect(doitDeclencherSnapshot(null, now)).toBe(true);
    expect(doitDeclencherSnapshot(0, now)).toBe(true);
  });

  test("dernier snapshot le MÊME jour calendaire → ne déclenche pas", () => {
    const matin = new Date(2026, 6, 9, 0, 5, 0).getTime();
    const soir = new Date(2026, 6, 9, 23, 55, 0).getTime();
    expect(doitDeclencherSnapshot(matin, soir)).toBe(false);
  });

  test("dernier snapshot la VEILLE → déclenche", () => {
    const veille = new Date(2026, 6, 8, 23, 55, 0).getTime();
    const aujourdhui = new Date(2026, 6, 9, 0, 5, 0).getTime();
    expect(doitDeclencherSnapshot(veille, aujourdhui)).toBe(true);
  });
});

describe("idsAPurger", () => {
  const now = 100 * MS_JOUR; // repère arbitraire

  test("écarte ce qui est dans la rétention, retient ce qui la dépasse", () => {
    const snapshots = [
      { id: 1, ts: now - 31 * MS_JOUR }, // trop vieux → purge
      { id: 2, ts: now - 10 * MS_JOUR }, // récent → gardé
      { id: 3, ts: now - 40 * MS_JOUR }, // trop vieux → purge
    ];
    expect(idsAPurger(snapshots, now)).toEqual([1, 3]);
  });

  test("borne stricte : exactement 30 jours est gardé", () => {
    expect(idsAPurger([{ id: 9, ts: now - 30 * MS_JOUR }], now)).toEqual([]);
  });

  test("rétention personnalisée", () => {
    const s = [{ id: 1, ts: now - 8 * MS_JOUR }];
    expect(idsAPurger(s, now, 7)).toEqual([1]);
    expect(idsAPurger(s, now, 30)).toEqual([]);
  });
});

describe("(dé)sérialisation du payload", () => {
  const entrees: EntreeSnapshot[] = [
    { namespace: "persist", cle: "axiom:chartState:v1", valeur: '{"symbol":"BTCUSDT"}', majA: 111 },
    { namespace: "alerts", cle: "defs", valeur: "[]", majA: 222 },
  ];

  test("aller-retour fidèle", () => {
    expect(deserialiserSnapshot(serialiserSnapshot(entrees))).toEqual(entrees);
  });

  test("JSON invalide → []", () => {
    expect(deserialiserSnapshot("{pas du json")).toEqual([]);
    expect(deserialiserSnapshot('{"x":1}')).toEqual([]); // objet, pas tableau
  });

  test("entrées mal formées écartées (le lot ne casse pas)", () => {
    const brut = JSON.stringify([
      { namespace: "a", cle: "k", valeur: "1", majA: 5 }, // ok
      { namespace: "a", cle: "k2", valeur: 42, majA: 5 }, // valeur non string
      { namespace: "a", cle: "k3", majA: 5 }, // valeur manquante
      { namespace: "a", cle: "k4", valeur: "1", majA: "x" }, // majA non nombre
      null,
    ]);
    expect(deserialiserSnapshot(brut)).toEqual([{ namespace: "a", cle: "k", valeur: "1", majA: 5 }]);
  });
});

describe("parseCheminSnapshots", () => {
  test("/kv/snapshots → liste", () => {
    expect(parseCheminSnapshots("/kv/snapshots")).toEqual({ kind: "liste" });
  });

  test("/kv/snapshots/:id/restore → restore avec id numérique", () => {
    expect(parseCheminSnapshots("/kv/snapshots/42/restore")).toEqual({ kind: "restore", id: 42 });
  });

  test("formes non reconnues → null", () => {
    expect(parseCheminSnapshots("/kv/snapshots/42")).toBeNull(); // action manquante
    expect(parseCheminSnapshots("/kv/snapshots/42/purge")).toBeNull(); // action inconnue
    expect(parseCheminSnapshots("/kv/snapshots/abc/restore")).toBeNull(); // id non numérique
    expect(parseCheminSnapshots("/kv/snapshots/0/restore")).toBeNull(); // id non positif
  });
});

// ─────────────────────────── Intégration SQLite (base en mémoire) ───────────────────────────

/** Base en mémoire avec les tables kv + kv_snapshots (schéma miroir de kv.ts/db.ts). */
function baseTest(): Database {
  const d = new Database(":memory:");
  d.run(`CREATE TABLE kv (
    namespace TEXT NOT NULL, cle TEXT NOT NULL, valeur TEXT NOT NULL, majA INTEGER NOT NULL,
    PRIMARY KEY (namespace, cle)
  )`);
  d.run(`CREATE TABLE kv_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, donnees TEXT NOT NULL
  )`);
  return d;
}

/** Insère une entrée KV. */
function semerKv(d: Database, namespace: string, cle: string, valeur: string, majA = 1): void {
  d.query("INSERT OR REPLACE INTO kv (namespace, cle, valeur, majA) VALUES (?, ?, ?, ?)").run(
    namespace,
    cle,
    valeur,
    majA,
  );
}

describe("lireEntreesKv", () => {
  test("lit toutes les entrées, tous namespaces confondus", () => {
    const d = baseTest();
    semerKv(d, "persist", "b", "2", 20);
    semerKv(d, "persist", "a", "1", 10);
    semerKv(d, "alerts", "defs", "[]", 30);
    expect(lireEntreesKv(d)).toEqual([
      { namespace: "alerts", cle: "defs", valeur: "[]", majA: 30 },
      { namespace: "persist", cle: "a", valeur: "1", majA: 10 },
      { namespace: "persist", cle: "b", valeur: "2", majA: 20 },
    ]);
  });

  test("table kv absente → [] (pas d'exception)", () => {
    const d = new Database(":memory:"); // aucune table
    expect(lireEntreesKv(d)).toEqual([]);
  });
});

describe("creerSnapshot", () => {
  test("fige l'état courant du KV et renvoie id/ts/taille", () => {
    const d = baseTest();
    semerKv(d, "persist", "a", '{"x":1}', 10);
    const meta = creerSnapshot(d, 1_000);
    expect(meta.id).toBeGreaterThan(0);
    expect(meta.ts).toBe(1_000);
    expect(meta.taille).toBeGreaterThan(0);
    const payload = lireSnapshot(d, meta.id);
    expect(payload).toEqual([{ namespace: "persist", cle: "a", valeur: '{"x":1}', majA: 10 }]);
  });
});

describe("purgerSnapshots", () => {
  test("supprime les snapshots hors rétention, garde les récents", () => {
    const d = baseTest();
    const now = 100 * MS_JOUR;
    creerSnapshot(d, now - 40 * MS_JOUR); // trop vieux
    const recent = creerSnapshot(d, now - 5 * MS_JOUR);
    expect(purgerSnapshots(d, now)).toBe(1);
    expect(listerMetaSnapshots(d).map((s) => s.id)).toEqual([recent.id]);
  });
});

describe("snapshotQuotidienSiNecessaire", () => {
  test("premier passage du jour : crée ; second passage du même jour : no-op", () => {
    const d = baseTest();
    semerKv(d, "persist", "a", "1", 10);
    const midi = new Date(2026, 6, 9, 12, 0, 0).getTime();
    const idA = snapshotQuotidienSiNecessaire(d, midi);
    expect(idA).not.toBeNull();
    const soir = new Date(2026, 6, 9, 22, 0, 0).getTime();
    expect(snapshotQuotidienSiNecessaire(d, soir)).toBeNull(); // déjà couvert aujourd'hui
    expect(listerMetaSnapshots(d)).toHaveLength(1);
  });

  test("nouveau jour : crée un second snapshot", () => {
    const d = baseTest();
    snapshotQuotidienSiNecessaire(d, new Date(2026, 6, 9, 12, 0, 0).getTime());
    const idDemain = snapshotQuotidienSiNecessaire(d, new Date(2026, 6, 10, 1, 0, 0).getTime());
    expect(idDemain).not.toBeNull();
    expect(listerMetaSnapshots(d)).toHaveLength(2);
  });

  test("purge au-delà de la rétention pendant la vérification", () => {
    const d = baseTest();
    creerSnapshot(d, new Date(2026, 4, 1, 12, 0, 0).getTime()); // ~2 mois avant
    snapshotQuotidienSiNecessaire(d, new Date(2026, 6, 9, 12, 0, 0).getTime());
    // Le vieux snapshot a été purgé, seul celui du jour reste.
    expect(listerMetaSnapshots(d)).toHaveLength(1);
  });
});

describe("restaurerSnapshot", () => {
  test("pré-snapshot auto + remplacement du KV, majA figé à l'instant de restauration", () => {
    const d = baseTest();
    // État initial → snapshot cible.
    semerKv(d, "persist", "a", "ancien", 10);
    const cible = creerSnapshot(d, 1_000);

    // On modifie le KV APRÈS le snapshot cible (l'utilisateur travaille).
    semerKv(d, "persist", "a", "nouveau", 20);
    semerKv(d, "persist", "b", "ajoutee", 21);

    const restaurees = restaurerSnapshot(d, cible.id, 2_000);
    // Les entrées restaurées sont RENVOYÉES et ré-horodatées à l'instant de restauration
    // (2_000), NON à leur majA d'origine (10) — anti-péremption de la réconciliation front.
    expect(restaurees).toEqual([{ namespace: "persist", cle: "a", valeur: "ancien", majA: 2_000 }]);

    // Le KV est revenu à l'état de la cible (b a disparu, a est « ancien »), majA = 2_000.
    expect(lireEntreesKv(d)).toEqual([{ namespace: "persist", cle: "a", valeur: "ancien", majA: 2_000 }]);

    // Un snapshot pré-restauration a été pris (il contenait l'état « nouveau », majA d'origine).
    const metas = listerMetaSnapshots(d);
    expect(metas.length).toBe(2); // cible + pré-restauration
    const preRestore = metas.find((m) => m.ts === 2_000);
    expect(preRestore).toBeDefined();
    const preId = preRestore?.id ?? -1;
    expect(lireSnapshot(d, preId)).toEqual([
      { namespace: "persist", cle: "a", valeur: "nouveau", majA: 20 },
      { namespace: "persist", cle: "b", valeur: "ajoutee", majA: 21 },
    ]);
  });

  test("id inconnu → null, aucune modification", () => {
    const d = baseTest();
    semerKv(d, "persist", "a", "1", 10);
    expect(restaurerSnapshot(d, 999, 2_000)).toBeNull();
    expect(listerMetaSnapshots(d)).toHaveLength(0); // aucun pré-snapshot créé
    expect(lireEntreesKv(d)).toHaveLength(1); // KV intact
  });
});

// ─────────────────────────── Gardes de route (hors disque) ───────────────────────────

describe("traiterSnapshots — gardes", () => {
  test("chemin invalide → 400 (sans accès base)", async () => {
    const url = new URL("http://127.0.0.1:8787/kv/snapshots/42/purge");
    const res = await traiterSnapshots(new Request(url, { method: "POST" }), url);
    expect(res.status).toBe(400);
  });

  test("méthode non permise sur restore → 405 (sans accès base)", async () => {
    const url = new URL("http://127.0.0.1:8787/kv/snapshots/42/restore");
    const res = await traiterSnapshots(new Request(url, { method: "GET" }), url);
    expect(res.status).toBe(405);
  });

  test("méthode non permise sur la liste → 405 (sans accès base)", async () => {
    const url = new URL("http://127.0.0.1:8787/kv/snapshots");
    const res = await traiterSnapshots(new Request(url, { method: "DELETE" }), url);
    expect(res.status).toBe(405);
  });
});

// ─────────────────────────── restore : payload front + garde base ───────────────────────────

describe("traiterSnapshots — restore (base injectée)", () => {
  test("renvoie les entrées restaurées, valeur JSON-parsée (mapping localStorage « persist »)", async () => {
    const d = baseTest();
    // Le KV « persist » stocke la CHAÎNE localStorage encodée en JSON (double encodage, cf.
    // kvPut + store/persist.ts) : la valeur de colonne est JSON.stringify(chaîneLocalStorage).
    const chaineLs = '{"symbol":"BTCUSDT"}';
    semerKv(d, "persist", "axiom:chartState:v1", JSON.stringify(chaineLs), 10);
    const cible = creerSnapshot(d, 1_000);
    // L'utilisateur modifie ensuite l'état (ce que la restauration doit annuler).
    semerKv(d, "persist", "axiom:chartState:v1", JSON.stringify('{"symbol":"ETHUSDT"}'), 20);

    const url = new URL(`http://127.0.0.1:8787/kv/snapshots/${cible.id}/restore`);
    const res = await traiterSnapshots(new Request(url, { method: "POST" }), url, d);
    expect(res.status).toBe(200);
    const corps = (await res.json()) as { ok: boolean; id: number; entrees: unknown };
    expect(corps.ok).toBe(true);
    expect(corps.id).toBe(cible.id);
    // valeur = chaîne localStorage prête à réécrire (JSON.parse de la colonne double-encodée) :
    // le front fera setItem("axiom:chartState:v1", chaineLs).
    expect(corps.entrees).toEqual([
      { namespace: "persist", cle: "axiom:chartState:v1", valeur: chaineLs },
    ]);
  });

  test("id inconnu → 404 conventionnel (base injectée)", async () => {
    const d = baseTest();
    const url = new URL("http://127.0.0.1:8787/kv/snapshots/999/restore");
    const res = await traiterSnapshots(new Request(url, { method: "POST" }), url, d);
    expect(res.status).toBe(404);
  });

  test("table kv absente → 500 CONVENTIONNEL (JSON + CORS), pas de 500 brut sans en-têtes", async () => {
    // Daemon fraîchement démarré : `kv_snapshots` existe (migration db.ts) mais `kv` pas
    // encore (créée paresseusement par kv.ts au 1er /kv). Un snapshot existe pourtant.
    const d = new Database(":memory:");
    d.run(
      "CREATE TABLE kv_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, donnees TEXT NOT NULL)",
    );
    d.query("INSERT INTO kv_snapshots (ts, donnees) VALUES (?, ?)").run(1_000, "[]");

    const url = new URL("http://127.0.0.1:8787/kv/snapshots/1/restore");
    // Origin de dev → CORS attendu ; le défaut d'origine renvoyait un 500 SANS ces en-têtes.
    const req = new Request(url, { method: "POST", headers: { origin: "http://localhost:5173" } });
    const res = await traiterSnapshots(req, url, d);
    expect(res.status).toBe(500);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});

// ─────────────────────────── Branchement de la boucle d'entretien ───────────────────────────

/**
 * Le défaut d'origine était une purge MORTE : `purgerExpires()` existait, était testée,
 * mais n'était appelée par personne. Tester la fonction seule ne protège pas d'une
 * débranche — c'est le CYCLE d'entretien qu'il faut exercer.
 *
 * `demarrerBoucleSnapshots` n'est pas injectable (elle appelle `getDb()`) : on substitue
 * le module `./db` par une base `:memory:` (`mock.module`), ce qui évite d'ouvrir le
 * fichier `axiom.db` réel. La substitution est globale au process → ce bloc reste EN
 * DERNIER, après tous les tests qui passent leur propre Database explicitement.
 */
describe("demarrerBoucleSnapshots — purge du cache effectivement branchée", () => {
  test("le cycle d'entretien supprime les entrées de cache expirées, garde les valides", async () => {
    const dbReel = await import("./db");
    const memDb = new Database(":memory:");
    // Mêmes DDL que db.ts (les seules tables touchées par le cycle ; `alertes_journal`
    // et `kv` sont créées/tolérées par leurs propres fonctions).
    memDb.run(
      "CREATE TABLE cache (cle TEXT PRIMARY KEY, corps BLOB NOT NULL, contentType TEXT NOT NULL, expireA INTEGER NOT NULL)",
    );
    memDb.run(
      "CREATE TABLE kv_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, donnees TEXT NOT NULL)",
    );
    mock.module("./db", () => ({ ...dbReel, getDb: () => memDb }));

    const maintenant = Date.now();
    const inserer = memDb.query(
      "INSERT INTO cache (cle, corps, contentType, expireA) VALUES (?, ?, ?, ?)",
    );
    inserer.run("expiree", Buffer.from("x"), "application/json", maintenant - 1_000);
    inserer.run("valide", Buffer.from("y"), "application/json", maintenant + 600_000);
    const clesAvant = (memDb.query("SELECT cle FROM cache ORDER BY cle").all() as { cle: string }[]).map(
      (r) => r.cle,
    );
    expect(clesAvant).toEqual(["expiree", "valide"]); // témoin : rien n'a encore purgé

    // La première vérification est SYNCHRONE dans demarrerBoucleSnapshots ; on arrête
    // aussitôt le minuteur horaire.
    const arreter = demarrerBoucleSnapshots();
    arreter();

    const clesApres = (memDb.query("SELECT cle FROM cache ORDER BY cle").all() as { cle: string }[]).map(
      (r) => r.cle,
    );
    expect(clesApres).toEqual(["valide"]);
  });
});
