/**
 * Sauvegarde VERSIONNÉE du store KV du daemon (SQLite via db.ts).
 *
 * POURQUOI : tout le capital de travail du terminal (portefeuille, notes, alertes,
 * workspaces, dessins…) est miroité dans le KV en « DERNIER état » uniquement (cf.
 * kv.ts + store/persist.ts du front). Une mauvaise manip (suppression, import raté,
 * réconciliation malheureuse) est donc IRRÉVERSIBLE. Ce module fige un SNAPSHOT
 * quotidien horodaté de TOUTES les entrées KV (tous namespaces confondus) dans la
 * table `kv_snapshots` (rétention 30 jours), et permet une restauration
 * POINT-DANS-LE-TEMPS depuis les Réglages.
 *
 * INVARIANT (BUILD-CONTRACT) : purement du stockage à froid — JAMAIS sur le chemin
 * chaud du renderer. La seule activité autonome est une vérification périodique
 * (~1 h) : aucune WS, aucune collecte.
 *
 * La restauration est DESTRUCTIVE : elle prend d'abord un snapshot PRÉ-RESTAURATION
 * (filet de sécurité) PUIS remplace intégralement le contenu KV par celui du snapshot
 * choisi. La confirmation utilisateur est gérée côté front (SettingsPanel).
 *
 * Schéma : kv_snapshots(id INTEGER PK, ts INTEGER epoch ms, donnees TEXT = JSON de
 * toutes les entrées KV au moment T). La table est créée dans db.ts (migration).
 *
 * Routes (enregistrées AVANT /kv pour primer sur son handler générique) :
 *   GET  /kv/snapshots              → liste { snapshots: [{id, ts, taille}] }
 *   POST /kv/snapshots              → snapshot immédiat { id, ts, taille }
 *   POST /kv/snapshots/:id/restore  → pré-snapshot auto + remplacement du KV ; 404 si id inconnu
 */
import type { Database } from "bun:sqlite";
import { purgerJournalAlertes, RETENTION_JOURNAL_MS } from "./alerts";
import { entetesCors } from "./cors";
import { compacterSiNecessaire, getDb } from "./db";
import type { Routeur } from "./router";

/** Millisecondes dans un jour calendaire (24 h) — base des calculs de rétention. */
export const MS_JOUR = 86_400_000;
/** Rétention par défaut des snapshots (jours). */
export const RETENTION_JOURS_DEFAUT = 30;
/** Période de vérification du snapshot quotidien (~1 h). */
export const PERIODE_SNAPSHOT_MS = 3_600_000;

/** Une entrée KV telle que figée dans un snapshot (`valeur` = corps JSON opaque). */
export interface EntreeSnapshot {
  namespace: string;
  cle: string;
  valeur: string;
  majA: number;
}

/** Métadonnée d'un snapshot (liste des Réglages). */
export interface MetaSnapshot {
  id: number;
  ts: number;
}

// ─────────────────────────── Fonctions PURES (testées) ───────────────────────────

/**
 * Clé de JOUR CALENDAIRE LOCAL (« AAAA-M-J ») servant à comparer deux instants au
 * même jour dans le fuseau LOCAL du daemon. Fonction PURE.
 */
function cleJourLocal(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Faut-il déclencher le snapshot QUOTIDIEN ? Vrai si aucun snapshot n'existe encore
 * (`dernierTs` null ou ≤ 0) OU si le dernier snapshot ne date PAS du jour calendaire
 * courant (fuseau local) : au plus un snapshot automatique par jour. Fonction PURE.
 */
export function doitDeclencherSnapshot(dernierTs: number | null, now: number): boolean {
  if (dernierTs === null || dernierTs <= 0) return true;
  return cleJourLocal(dernierTs) !== cleJourLocal(now);
}

/**
 * Ids des snapshots à PURGER : ceux dont l'âge dépasse STRICTEMENT `retentionJours`.
 * Fonction PURE (le « maintenant » est injecté).
 */
export function idsAPurger(
  snapshots: readonly MetaSnapshot[],
  now: number,
  retentionJours = RETENTION_JOURS_DEFAUT,
): number[] {
  const limite = retentionJours * MS_JOUR;
  return snapshots.filter((s) => now - s.ts > limite).map((s) => s.id);
}

/** Sérialise le payload d'un snapshot (toutes les entrées KV) en JSON. Fonction PURE. */
export function serialiserSnapshot(entrees: readonly EntreeSnapshot[]): string {
  return JSON.stringify(entrees);
}

/**
 * Désérialise le payload d'un snapshot. TOLÉRANT : JSON invalide ou entrée mal formée
 * → écartée (une ligne pourrie ne doit jamais faire échouer une restauration).
 * Fonction PURE.
 */
export function deserialiserSnapshot(donnees: string): EntreeSnapshot[] {
  let brut: unknown;
  try {
    brut = JSON.parse(donnees);
  } catch {
    return [];
  }
  if (!Array.isArray(brut)) return [];
  const out: EntreeSnapshot[] = [];
  for (const e of brut) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    if (
      typeof o.namespace === "string" &&
      typeof o.cle === "string" &&
      typeof o.valeur === "string" &&
      typeof o.majA === "number" &&
      Number.isFinite(o.majA)
    ) {
      out.push({ namespace: o.namespace, cle: o.cle, valeur: o.valeur, majA: o.majA });
    }
  }
  return out;
}

/** Segments décodés d'un chemin `/kv/snapshots(...)`. Fonction PURE (testée). */
export type CheminSnapshots = { kind: "liste" } | { kind: "restore"; id: number } | null;

/**
 * Découpe un pathname `/kv/snapshots` ou `/kv/snapshots/:id/restore`.
 * Renvoie `null` si la forme n'est pas reconnue. Fonction PURE.
 */
export function parseCheminSnapshots(pathname: string): CheminSnapshots {
  const segments = pathname.split("/").filter((s) => s.length > 0);
  // segments[0] === "kv", segments[1] === "snapshots" (garanti par le préfixe de route).
  if (segments.length === 2) return { kind: "liste" };
  if (segments.length === 4 && segments[3] === "restore") {
    const id = Number(segments[2]);
    if (Number.isInteger(id) && id > 0) return { kind: "restore", id };
  }
  return null;
}

// ─────────────────────────── Accès SQLite (base injectable pour les tests) ───────────────────────────

/**
 * Lit TOUTES les entrées KV (tous namespaces). TOLÉRANT : si la table `kv` n'existe
 * pas encore (daemon fraîchement démarré, aucun /kv reçu — la table est créée
 * paresseusement par kv.ts), renvoie `[]` au lieu d'échouer.
 */
export function lireEntreesKv(d: Database): EntreeSnapshot[] {
  try {
    return d
      .query("SELECT namespace, cle, valeur, majA FROM kv ORDER BY namespace, cle")
      .all() as EntreeSnapshot[];
  } catch {
    return [];
  }
}

/** Métadonnées de tous les snapshots (plus récent en tête). */
export function listerMetaSnapshots(d: Database): MetaSnapshot[] {
  return d.query("SELECT id, ts FROM kv_snapshots ORDER BY ts DESC, id DESC").all() as MetaSnapshot[];
}

/**
 * Fige un snapshot IMMÉDIAT de tout le KV. Renvoie l'id attribué + le ts + la taille
 * (nb de caractères) du payload. `now` injecté (défaut Date.now) pour la testabilité.
 */
export function creerSnapshot(d: Database, now: number = Date.now()): { id: number; ts: number; taille: number } {
  const donnees = serialiserSnapshot(lireEntreesKv(d));
  const info = d.query("INSERT INTO kv_snapshots (ts, donnees) VALUES (?, ?)").run(now, donnees);
  return { id: Number(info.lastInsertRowid), ts: now, taille: donnees.length };
}

/** Supprime les snapshots au-delà de la rétention ; renvoie le nombre supprimé. */
export function purgerSnapshots(
  d: Database,
  now: number = Date.now(),
  retentionJours = RETENTION_JOURS_DEFAUT,
): number {
  const ids = idsAPurger(listerMetaSnapshots(d), now, retentionJours);
  if (ids.length === 0) return 0;
  const stmt = d.query("DELETE FROM kv_snapshots WHERE id = ?");
  const tx = d.transaction((liste: number[]) => {
    for (const id of liste) stmt.run(id);
  });
  tx(ids);
  return ids.length;
}

/**
 * Prend le snapshot du jour SI aucun n'existe pour le jour calendaire courant, puis
 * PURGE au-delà de la rétention. Renvoie l'id du snapshot créé (ou `null` si non
 * nécessaire). `now` injecté. C'est l'unité de travail de la boucle périodique.
 */
export function snapshotQuotidienSiNecessaire(d: Database, now: number = Date.now()): number | null {
  const dernierTs = listerMetaSnapshots(d)[0]?.ts ?? null;
  const idCree = doitDeclencherSnapshot(dernierTs, now) ? creerSnapshot(d, now).id : null;
  purgerSnapshots(d, now);
  return idCree;
}

/** Lit le payload d'un snapshot par id (`null` si id inconnu). */
export function lireSnapshot(d: Database, id: number): EntreeSnapshot[] | null {
  const ligne = d.query("SELECT donnees FROM kv_snapshots WHERE id = ?").get(id) as { donnees: string } | null;
  return ligne ? deserialiserSnapshot(ligne.donnees) : null;
}

/**
 * Restaure un snapshot : prend d'abord un snapshot PRÉ-RESTAURATION (filet, car
 * l'opération est destructive), PUIS remplace atomiquement tout le contenu KV par
 * celui du snapshot `id`. Renvoie les entrées restaurées (pour que la route les
 * transmette au front) ou `null` si `id` est inconnu (aucune modification). `now` injecté.
 *
 * ANTI-PÉREMPTION : les entrées restaurées reçoivent `majA = now` (l'instant de restauration)
 * et NON leur horodatage d'origine. Sans cela, la réconciliation last-write-wins du front
 * (store/persist.ts) verrait la copie daemon comme PÉRIMÉE face à un `meta` local plus récent
 * et ré-écraserait la restauration au rechargement. Des entrées « fraîches » garantissent
 * qu'elle est adoptée (ou, au pire, ré-poussée à l'identique).
 */
export function restaurerSnapshot(d: Database, id: number, now: number = Date.now()): EntreeSnapshot[] | null {
  const entrees = lireSnapshot(d, id);
  if (entrees === null) return null;
  // Filet : on fige l'état ACTUEL (avec ses majA courants) avant de l'écraser.
  creerSnapshot(d, now);
  // majA = now sur chaque entrée restaurée (cf. docstring : anti-péremption réconciliation).
  const restaurees = entrees.map((e) => ({ ...e, majA: now }));
  // Remplacement atomique du KV : purge complète puis réécriture des entrées figées.
  const purge = d.query("DELETE FROM kv");
  const inserer = d.query("INSERT OR REPLACE INTO kv (namespace, cle, valeur, majA) VALUES (?, ?, ?, ?)");
  const tx = d.transaction((liste: EntreeSnapshot[]) => {
    purge.run();
    for (const e of liste) inserer.run(e.namespace, e.cle, e.valeur, e.majA);
  });
  tx(restaurees);
  return restaurees;
}

// ─────────────────────────── Boucle de vie ───────────────────────────

/**
 * Démarre la boucle de sauvegarde quotidienne : vérifie ~toutes les heures s'il faut
 * figer le snapshot du jour + purge au-delà de la rétention. Une vérification est
 * faite IMMÉDIATEMENT au démarrage (couvre un daemon relancé chaque jour ; sans effet
 * si le snapshot du jour existe déjà). Renvoie une fonction d'arrêt. À appeler UNE
 * fois depuis index.ts.
 *
 * C'est aussi le POINT D'ENTRETIEN de la base (seule boucle à froid horaire touchant
 * tout le fichier) : on y purge le journal des alertes (rétention 30 j, sinon la table
 * croît sans borne) et on y compacte le fichier quand les purges ont laissé trop de
 * pages libres. Chaque étape est isolée : un échec ne doit pas priver les autres.
 */
export function demarrerBoucleSnapshots(): () => void {
  const verifier = (): void => {
    try {
      snapshotQuotidienSiNecessaire(getDb());
    } catch (err) {
      console.error("[axiomd] snapshot quotidien échoué :", err);
    }
    try {
      purgerJournalAlertes(getDb(), Date.now() - RETENTION_JOURNAL_MS);
    } catch (err) {
      console.error("[axiomd] purge du journal d'alertes échouée :", err);
    }
    try {
      // Après les purges seulement : c'est là que la freelist vient de grossir.
      compacterSiNecessaire(getDb());
    } catch (err) {
      console.error("[axiomd] compactage de la base échoué :", err);
    }
  };
  verifier();
  const minuteur = setInterval(verifier, PERIODE_SNAPSHOT_MS);
  return () => clearInterval(minuteur);
}

// ─────────────────────────── Routes ───────────────────────────

/** Réponse JSON avec en-têtes CORS (même pattern que kv.ts/candles.ts/alerts.ts). */
function json(corps: unknown, req: Request, status = 200): Response {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...entetesCors(req) },
  });
}

/** Parse tolérant du corps JSON opaque d'une entrée (`null` si illisible). Fonction PURE. */
function parseValeurEntree(valeur: string): unknown {
  try {
    return JSON.parse(valeur);
  } catch {
    return null;
  }
}

/**
 * Traite une requête `/kv/snapshots...`. `dInjecte` permet aux tests d'injecter une base
 * en mémoire ; par défaut on ouvre la base réelle SEULEMENT après les gardes (hors disque).
 */
export async function traiterSnapshots(req: Request, url: URL, dInjecte?: Database): Promise<Response> {
  const chemin = parseCheminSnapshots(url.pathname);
  if (!chemin) return json({ erreur: "chemin snapshots invalide" }, req, 400);

  // Validation de la méthode AVANT tout accès base (garde-fou testable hors disque).
  if (chemin.kind === "liste" && req.method !== "GET" && req.method !== "POST") {
    return json({ erreur: "méthode non permise" }, req, 405);
  }
  if (chemin.kind === "restore" && req.method !== "POST") {
    return json({ erreur: "méthode non permise" }, req, 405);
  }

  // Garde base : toute erreur SQLite (ex. table `kv` pas encore créée — elle l'est
  // paresseusement par kv.ts au 1er /kv reçu) doit produire une réponse CONVENTIONNELLE
  // (JSON + CORS via `json`), et non un 500 brut sans en-têtes via Bun.serve.error
  // (illisible en cross-origin dev, non conforme au reste du routeur).
  try {
    const d = dInjecte ?? getDb();

    if (chemin.kind === "liste") {
      if (req.method === "GET") {
        // `taille` = longueur du payload JSON (calculée en base pour éviter de le relire).
        const snapshots = d
          .query("SELECT id, ts, LENGTH(donnees) AS taille FROM kv_snapshots ORDER BY ts DESC, id DESC")
          .all() as Array<{ id: number; ts: number; taille: number }>;
        return json({ snapshots }, req);
      }
      // POST : snapshot immédiat (utilisé par le bouton des Réglages).
      return json(creerSnapshot(d), req);
    }

    // restore : pré-snapshot auto (dans restaurerSnapshot) puis remplacement. On RENVOIE les
    // entrées restaurées : le front les réécrit directement dans localStorage (mêmes clés,
    // namespace « persist ») avant de recharger — sinon la réconciliation au boot annulerait
    // la restauration (cf. apps/web/src/store/persist.ts + data/daemon.ts).
    const restaurees = restaurerSnapshot(d, chemin.id);
    if (restaurees === null) return json({ erreur: "snapshot inconnu", id: chemin.id }, req, 404);
    const entrees = restaurees.map((e) => ({
      namespace: e.namespace,
      cle: e.cle,
      valeur: parseValeurEntree(e.valeur),
    }));
    return json({ ok: true, id: chemin.id, entrees }, req);
  } catch (err) {
    console.error("[axiomd] snapshots — erreur base :", err);
    return json({ erreur: "erreur interne snapshots" }, req, 500);
  }
}

/**
 * Enregistre la route `/kv/snapshots` dans le routeur. IMPORTANT : à enregistrer
 * AVANT `enregistrerKv` (préfixe `/kv`), sinon le handler /kv générique capterait
 * `/kv/snapshots` en premier (première route qui matche gagne).
 */
export function enregistrerSnapshots(routeur: Routeur): void {
  routeur.enregistrerPrefixe("/kv/snapshots", (req, url) => traiterSnapshots(req, url));
}
