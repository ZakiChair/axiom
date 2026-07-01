/**
 * alerts.ts — évaluation des alertes « onglet fermé » côté daemon.
 *
 * Réutilise le moteur PUR `@axiom/alerts` (le MÊME que le runtime du front) :
 *  1. Les défs viennent du front via le KV (namespace « alerts », clé « defs ») :
 *     le store front les y pousse à chaque mutation (dual-write, cf. store/alerts.ts).
 *     Le daemon POLL cette table locale toutes les 5 s (pas de WS interne).
 *  2. L'état de RÉ-ARMEMENT est PROPRE au daemon (table `alertes_etat`) : le daemon
 *     évalue indépendamment du front, donc il garde son propre `arme` (fusionné dans
 *     les défs avant chaque évaluation) — un redémarrage ne re-déclenche pas une
 *     condition déjà vraie.
 *  3. Les déclenchements sont journalisés dans `alertes_journal` (exposé GET
 *     /alerts/journal) DANS TOUS LES CAS, et NOTIFIÉS (macOS/Telegram) seulement si
 *     le dernier heartbeat du front date de plus de 90 s (sinon l'app ouverte a déjà
 *     notifié via la Notification API — anti-doublon).
 *
 * Sources : seul `source === "binance"` est couvert (cf. marketFeed.ts). Le feed ne
 * surveille que les symboles ayant une alerte binance active.
 *
 * INVARIANT (BUILD-CONTRACT) : le feed du daemon est une connexion INDÉPENDANTE ;
 * il ne partage rien avec le chemin chaud du renderer (WS du front restent directs).
 */
import type { Database } from "bun:sqlite";
import { evaluerAlertes, type AlertDef, type ContexteAlerte, type Declenchement } from "@axiom/alerts";
import { entetesCors } from "./cors";
import { getDb } from "./db";
import { creerFeed, type Feed } from "./marketFeed";
import { notifierDeclenchement } from "./notify";
import type { Routeur } from "./router";

/** Types de condition évalués sur un TICK de prix (miniTicker). */
export const TYPES_PRIX: ReadonlySet<string> = new Set(["prix-croise"]);
/** Types de condition évalués sur une CLÔTURE de bougie 1 min. */
export const TYPES_BOUGIE: ReadonlySet<string> = new Set([
  "variation-pct",
  "indicateur-seuil",
  "indicateur-croisement",
]);

/** Seuil d'anti-doublon : on ne notifie que si le dernier heartbeat > 90 s. */
export const SEUIL_HEARTBEAT_MS = 90_000;
/** Période de poll du KV « alerts » (rafraîchit les défs + le jeu de symboles). */
const PERIODE_POLL_MS = 5_000;
/** Borne du journal renvoyé par GET /alerts/journal. */
const LIMITE_JOURNAL = 200;

// ─────────────────────────── Fonctions PURES (testées) ───────────────────────────

/**
 * Fusionne l'état de ré-armement PROPRE au daemon dans les défs venues du KV :
 * le `arme` du daemon (table `alertes_etat`) ÉCRASE celui du front (qui évalue de
 * son côté). Une def sans entrée d'état reste `arme: undefined` → la 1re évaluation
 * daemon la calibre. Fonction PURE.
 */
export function fusionnerEtatArme(
  defs: readonly AlertDef[],
  etats: Readonly<Record<string, boolean>>,
): AlertDef[] {
  return defs.map((d) =>
    Object.prototype.hasOwnProperty.call(etats, d.id) ? { ...d, arme: etats[d.id] } : { ...d, arme: undefined },
  );
}

/** Symboles (majuscules) ayant AU MOINS une alerte binance active. Fonction PURE. */
export function symbolesBinanceActifs(defs: readonly AlertDef[]): string[] {
  return [
    ...new Set(defs.filter((d) => d.actif && d.source === "binance").map((d) => d.symbol.toUpperCase())),
  ].sort();
}

/**
 * Évalue le sous-lot d'alertes concerné par un événement (symbole + types de
 * condition) contre un contexte. Filtre `binance` + `actif` + `symbol` + `types`,
 * puis délègue au moteur pur. Fonction PURE (le moteur ne fait aucune I/O).
 */
export function evaluerTick(
  defs: readonly AlertDef[],
  symbol: string,
  types: ReadonlySet<string>,
  ctx: ContexteAlerte,
): ReturnType<typeof evaluerAlertes> {
  const lot = defs.filter(
    (d) => d.actif && d.source === "binance" && d.symbol.toUpperCase() === symbol.toUpperCase() && types.has(d.condition.type),
  );
  return evaluerAlertes(lot, ctx);
}

/**
 * Décide s'il faut NOTIFIER (macOS/Telegram) : uniquement si le dernier heartbeat du
 * front date de plus de `SEUIL_HEARTBEAT_MS`. `dernierHeartbeat === 0` (jamais reçu)
 * → on notifie (app jamais ouverte). Fonction PURE (testée).
 */
export function doitNotifier(dernierHeartbeat: number, maintenant: number, seuil = SEUIL_HEARTBEAT_MS): boolean {
  return maintenant - dernierHeartbeat > seuil;
}

// ─────────────────────────── Accès SQLite ───────────────────────────

/**
 * Crée les tables d'état de ré-armement et de journal des alertes (idempotent).
 * `CREATE ... IF NOT EXISTS` étant quasi gratuit, on l'appelle à chaque accès plutôt
 * que de gérer un cache (la base peut être injectée en test).
 */
export function assurerTablesAlertes(d: Database): void {
  d.run(`CREATE TABLE IF NOT EXISTS alertes_etat (
    alertId TEXT PRIMARY KEY,
    arme INTEGER NOT NULL,
    majA INTEGER NOT NULL
  )`);
  d.run(`CREATE TABLE IF NOT EXISTS alertes_journal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alertId TEXT NOT NULL,
    symbol TEXT NOT NULL,
    ts INTEGER NOT NULL,
    valeur REAL NOT NULL,
    message TEXT NOT NULL,
    notifie INTEGER NOT NULL
  )`);
}

/** Garde d'AlertDef minimale (validation défensive des défs venues du KV). */
function estAlertDef(v: unknown): v is AlertDef {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.symbol === "string" &&
    typeof o.source === "string" &&
    typeof o.actif === "boolean" &&
    !!o.condition &&
    typeof o.condition === "object"
  );
}

/**
 * Lit les défs brutes du KV (namespace « alerts », clé « defs »). Tolérant : table
 * absente (front n'a jamais écrit) ou JSON corrompu → `[]`.
 */
export function lireDefsKv(d: Database): AlertDef[] {
  try {
    const ligne = d.query("SELECT valeur FROM kv WHERE namespace = ? AND cle = ?").get("alerts", "defs") as
      | { valeur: string }
      | null;
    if (!ligne) return [];
    const arr = JSON.parse(ligne.valeur) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter(estAlertDef);
  } catch {
    return [];
  }
}

/** Lit l'état de ré-armement daemon (alertId → arme booléen). */
export function lireEtat(d: Database): Record<string, boolean> {
  assurerTablesAlertes(d);
  const lignes = d.query("SELECT alertId, arme FROM alertes_etat").all() as Array<{
    alertId: string;
    arme: number;
  }>;
  const out: Record<string, boolean> = {};
  for (const l of lignes) out[l.alertId] = l.arme !== 0;
  return out;
}

/** Charge les défs prêtes à évaluer : KV fusionné avec l'état de ré-armement daemon. */
export function chargerDefs(d: Database): AlertDef[] {
  return fusionnerEtatArme(lireDefsKv(d), lireEtat(d));
}

// ─────────────────────────── Évaluation + persistance ───────────────────────────

/** Heartbeat courant du front (ms epoch ; 0 = jamais reçu). Mis à jour par POST /heartbeat. */
let dernierHeartbeat = 0;

/** Enregistre un heartbeat du front (app ouverte). */
export function enregistrerHeartbeat(ts: number = Date.now()): void {
  dernierHeartbeat = ts;
}

/** Options d'évaluation (injections pour les tests). */
export interface OptionsEval {
  /** Base SQLite (défaut : la base globale du daemon). */
  db?: Database;
  /** Fonction de notification (défaut : notifierDeclenchement — macOS/Telegram). */
  notifier?: (symbol: string, decl: Declenchement) => void;
  /** Heartbeat à considérer (défaut : la valeur module courante). */
  dernierHeartbeat?: number;
}

/**
 * Évalue les alertes d'un symbole pour un événement donné, persiste l'état de
 * ré-armement + journalise les déclenchements, et notifie (selon l'anti-doublon
 * heartbeat). Renvoie les déclenchements produits. Testable via `opts` (db :memory:,
 * notifier espion, heartbeat forcé).
 */
export function evaluerEtPersister(
  symbol: string,
  types: ReadonlySet<string>,
  ctx: ContexteAlerte,
  opts: OptionsEval = {},
): Declenchement[] {
  const d = opts.db ?? getDb();
  assurerTablesAlertes(d);

  const defs = chargerDefs(d);
  const res = evaluerTick(defs, symbol, types, ctx);
  if (!res.modifie) return [];

  const notifie = doitNotifier(opts.dernierHeartbeat ?? dernierHeartbeat, ctx.maintenant);

  // Persistance de l'état de ré-armement (uniquement les défs calibrées : arme défini).
  const upsertEtat = d.query("INSERT OR REPLACE INTO alertes_etat (alertId, arme, majA) VALUES (?, ?, ?)");
  for (const def of res.defs) {
    if (def.arme === undefined) continue;
    upsertEtat.run(def.id, def.arme ? 1 : 0, ctx.maintenant);
  }

  // Journalisation (TOUJOURS) + notification (conditionnelle au heartbeat).
  if (res.declenchements.length > 0) {
    const insererJournal = d.query(
      "INSERT INTO alertes_journal (alertId, symbol, ts, valeur, message, notifie) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const notifier = opts.notifier ?? notifierDeclenchement;
    for (const decl of res.declenchements) {
      insererJournal.run(decl.alertId, symbol, decl.ts, decl.valeur, decl.message, notifie ? 1 : 0);
      if (notifie) notifier(symbol, decl);
    }
  }

  return res.declenchements;
}

// ─────────────────────────── Boucle de vie ───────────────────────────

let feed: Feed | null = null;

/**
 * Démarre la boucle d'alertes du daemon : crée le feed Binance, poll le KV toutes
 * les 5 s pour rafraîchir le jeu de symboles surveillés, et évalue à chaque tick /
 * bougie. Renvoie une fonction d'arrêt. À appeler UNE fois depuis index.ts.
 */
export function demarrerBoucleAlertes(): () => void {
  assurerTablesAlertes(getDb());

  feed = creerFeed({
    onPrix: (symbol, prix, prixPrecedent) => {
      try {
        evaluerEtPersister(symbol, TYPES_PRIX, { maintenant: Date.now(), dernierPrix: prix, prixPrecedent });
      } catch (err) {
        console.error("[axiomd] évaluation tick échouée :", err);
      }
    },
    onBougieClose: (symbol, candles) => {
      const derniere = candles[candles.length - 1];
      if (!derniere) return;
      const avant = candles[candles.length - 2];
      try {
        evaluerEtPersister(symbol, TYPES_BOUGIE, {
          maintenant: Date.now(),
          dernierPrix: derniere.close,
          prixPrecedent: avant?.close,
          candles,
        });
      } catch (err) {
        console.error("[axiomd] évaluation bougie échouée :", err);
      }
    },
  });

  const rafraichir = (): void => {
    try {
      const symboles = symbolesBinanceActifs(lireDefsKv(getDb()));
      feed?.setSymboles(symboles);
    } catch (err) {
      console.error("[axiomd] rafraîchissement des symboles échoué :", err);
    }
  };
  rafraichir();
  const minuteur = setInterval(rafraichir, PERIODE_POLL_MS);

  return () => {
    clearInterval(minuteur);
    feed?.arreter();
    feed = null;
  };
}

// ─────────────────────────── Routes ───────────────────────────

/** Réponse JSON avec en-têtes CORS (même pattern que kv.ts/candles.ts). */
function json(corps: unknown, req: Request, status = 200): Response {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...entetesCors(req) },
  });
}

/** Enregistre les routes /alerts/journal (GET) et /heartbeat (POST). */
export function enregistrerAlertes(routeur: Routeur): void {
  // GET /alerts/journal → derniers déclenchements (plus récent en tête).
  routeur.enregistrerPrefixe("/alerts/journal", (req) => {
    if (req.method !== "GET") return json({ erreur: "méthode non permise" }, req, 405);
    const d = getDb();
    assurerTablesAlertes(d);
    const lignes = d
      .query(
        "SELECT alertId, symbol, ts, valeur, message, notifie FROM alertes_journal ORDER BY ts DESC, id DESC LIMIT ?",
      )
      .all(LIMITE_JOURNAL) as Array<Record<string, unknown>>;
    const journal = lignes.map((l) => ({
      alertId: l.alertId,
      symbol: l.symbol,
      ts: l.ts,
      valeur: l.valeur,
      message: l.message,
      notifie: l.notifie === 1,
    }));
    return json({ journal }, req);
  });

  // POST /heartbeat → l'app est ouverte (anti-doublon de notification).
  routeur.enregistrerPrefixe("/heartbeat", (req) => {
    if (req.method !== "POST") return json({ erreur: "méthode non permise" }, req, 405);
    enregistrerHeartbeat();
    return json({ ok: true }, req);
  });
}
