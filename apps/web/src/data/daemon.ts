/**
 * Client du daemon `axiomd` (OPTIONNEL) — feature-detect + accès /kv et /candles.
 *
 * Le daemon localhost (Bun + SQLite, port 8787) apporte proxy/cache et PERSISTANCE
 * DURABLE (survit au vidage du cache navigateur). Il est FACULTATIF : toutes les
 * fonctions ici échouent en silence si le daemon est absent — le front reste 100 %
 * fonctionnel sans lui (repli localStorage, cf. store/persist.ts).
 *
 * INVARIANT (BUILD-CONTRACT) : le daemon n'est JAMAIS sur le chemin chaud du
 * renderer. Ici, uniquement du stockage à froid (kv/candles) et la sonde /health.
 *
 * Origine :
 *  - DEV  : le front tourne sous Vite (5173), le daemon sur un autre port → 127.0.0.1:8787.
 *  - PROD : le front est SERVI PAR le daemon → même origine (window.location.origin).
 */
import type { Candle } from "@axiom/types";
import { healthStore } from "../store/health";

/** Source santé du lien daemon (affichée dans le panneau « santé des sources »). */
const SOURCE_SANTE = "axiomd";
/** Délai max d'une sonde /health (ms). */
const TIMEOUT_SONDE_MS = 800;
/** Fraîcheur du résultat mémoïsé de detectDaemon (ms). */
const TTL_SONDE_MS = 60_000;

/** Base d'URL du daemon selon l'environnement (calcul paresseux, robuste hors navigateur). */
function baseDaemon(): string {
  if (import.meta.env.DEV) return "http://127.0.0.1:8787";
  if (typeof window !== "undefined") return window.location.origin;
  return "http://127.0.0.1:8787";
}

/** URL absolue d'un chemin daemon (DEV : cross-origin 127.0.0.1:8787 ; PROD : same-origin). */
export function urlDaemon(chemin: string): string {
  return `${baseDaemon()}${chemin}`;
}

// ─────────────────────────── Détection (feature-detect) ───────────────────────────

/** Dernier résultat de sonde ; `null` = jamais sondé (→ health silencieux). */
let etatDaemon: boolean | null = null;
let dernierSondageTs = 0;
/** Devient vrai à la 1re détection réussie : conditionne l'émission de « closed ». */
let dejaDetecte = false;
let intervalDemarre = false;

/** Effectue une sonde /health (timeout 800 ms) et met à jour l'état + la santé. */
async function sonder(): Promise<boolean> {
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), TIMEOUT_SONDE_MS);
  let ok = false;
  try {
    const res = await fetch(baseDaemon() + "/health", { signal: ctrl.signal });
    ok = res.ok;
  } catch {
    ok = false;
  } finally {
    clearTimeout(minuteur);
  }
  etatDaemon = ok;
  dernierSondageTs = Date.now();
  if (ok) {
    dejaDetecte = true;
    healthStore.getState().setEtat(SOURCE_SANTE, "connected", { dernierMessageTs: Date.now() });
  } else if (dejaDetecte) {
    // Silencieux tant que le daemon n'a jamais été détecté ; sinon on signale la perte.
    healthStore.getState().setEtat(SOURCE_SANTE, "closed");
  }
  return ok;
}

/**
 * Le daemon est-il joignable ? Résultat MÉMOÏSÉ (fraîcheur 60 s) ; re-sonde au-delà.
 * Au premier appel, démarre aussi une re-sonde périodique (60 s) pour garder l'état
 * frais côté écritures (dual-write) même sans appel explicite.
 */
export async function detectDaemon(): Promise<boolean> {
  if (etatDaemon !== null && Date.now() - dernierSondageTs < TTL_SONDE_MS) return etatDaemon;
  if (!intervalDemarre && typeof setInterval !== "undefined") {
    intervalDemarre = true;
    const id: ReturnType<typeof setInterval> = setInterval(() => void sonder(), TTL_SONDE_MS);
    // Ne pas retenir la boucle d'évènements (Node) — no-op côté navigateur.
    (id as unknown as { unref?: () => void }).unref?.();
  }
  return sonder();
}

/**
 * État connu SANS déclencher de sonde réseau (synchrone). Utilisé par le dual-write
 * pour décider d'un `kvPut` sans jamais initier de requête (crucial : garde les tests
 * unitaires 100 % hors-réseau tant que `detectDaemon` n'a pas été appelé).
 */
export function daemonPret(): boolean {
  return etatDaemon === true;
}

// ─────────────────────────── KV ───────────────────────────

/** Entrée d'un snapshot KV : valeur (JSON parsé) + horodatage de dernière écriture. */
export interface EntreeKv {
  valeur: unknown;
  majA: number;
}

/** Snapshot complet d'un namespace KV : `{ [cle]: { valeur, majA } }`. */
export type SnapshotKv = Record<string, EntreeKv>;

/** URL d'une clé KV (namespace + clé, tous deux URL-encodés). */
function urlCle(ns: string, cle: string): string {
  return `${baseDaemon()}/kv/${encodeURIComponent(ns)}/${encodeURIComponent(cle)}`;
}

/**
 * Lit une valeur KV (JSON parsé) ou `null` (absente / daemon injoignable).
 * Ne déclenche pas de sonde : échoue simplement en silence si le daemon est absent.
 */
export async function kvGet(ns: string, cle: string): Promise<unknown | null> {
  try {
    const res = await fetch(urlCle(ns, cle));
    if (!res.ok) return null;
    const corps = (await res.json()) as { valeur?: unknown };
    return corps.valeur ?? null;
  } catch {
    return null;
  }
}

/**
 * Écrit une valeur KV (sérialisée en JSON). Renvoie l'horodatage `majA` attribué par
 * le daemon (utile pour la réconciliation), ou `null` en cas d'échec silencieux.
 */
export async function kvPut(ns: string, cle: string, valeur: unknown): Promise<number | null> {
  try {
    const res = await fetch(urlCle(ns, cle), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(valeur),
    });
    if (!res.ok) return null;
    const corps = (await res.json()) as { majA?: number };
    return typeof corps.majA === "number" ? corps.majA : null;
  } catch {
    return null;
  }
}

/** Snapshot complet d'un namespace, ou `null` si daemon injoignable. */
export async function kvSnapshot(ns: string): Promise<SnapshotKv | null> {
  try {
    const res = await fetch(`${baseDaemon()}/kv/${encodeURIComponent(ns)}`);
    if (!res.ok) return null;
    const corps = (await res.json()) as { entrees?: unknown };
    if (!corps.entrees || typeof corps.entrees !== "object") return null;
    return corps.entrees as SnapshotKv;
  } catch {
    return null;
  }
}

// ─────────────────────────── Snapshots KV (sauvegarde versionnée) ───────────────────────────

/** Métadonnée d'un snapshot KV (liste des Réglages) : id, horodatage, taille du payload. */
export interface MetaSnapshot {
  id: number;
  ts: number;
  taille: number;
}

/** URL de base des snapshots KV du daemon. */
function urlSnapshots(): string {
  return `${baseDaemon()}/kv/snapshots`;
}

/**
 * Liste les snapshots KV (plus récent en tête), ou `null` si le daemon est injoignable
 * (la section Réglages affiche alors l'état indisponible). Échec silencieux.
 */
export async function listerSnapshots(): Promise<MetaSnapshot[] | null> {
  try {
    const res = await fetch(urlSnapshots());
    if (!res.ok) return null;
    const corps = (await res.json()) as { snapshots?: unknown };
    if (!Array.isArray(corps.snapshots)) return null;
    return corps.snapshots as MetaSnapshot[];
  } catch {
    return null;
  }
}

/** Fige un snapshot immédiat ; renvoie sa méta, ou `null` en cas d'échec / daemon absent. */
export async function creerSnapshot(): Promise<MetaSnapshot | null> {
  try {
    const res = await fetch(urlSnapshots(), { method: "POST" });
    if (!res.ok) return null;
    const corps = (await res.json()) as { id?: unknown; ts?: unknown; taille?: unknown };
    if (typeof corps.id !== "number" || typeof corps.ts !== "number" || typeof corps.taille !== "number") {
      return null;
    }
    return { id: corps.id, ts: corps.ts, taille: corps.taille };
  } catch {
    return null;
  }
}

/**
 * Namespace KV dont les entrées mappent 1:1 sur des clés localStorage (`cle` EST la clé
 * localStorage, `valeur` la chaîne localStorage) — cf. store/persist.ts. Les autres
 * namespaces (alerts/notes/portfolio) sont miroités en écriture seule et ne sont pas
 * ré-appliqués par la restauration.
 */
const NS_PERSIST = "persist";

/** Entrée restaurée renvoyée par l'endpoint restore (valeur déjà JSON-parsée). */
interface EntreeRestauree {
  namespace: string;
  cle: string;
  valeur: unknown;
}

/**
 * Restaure un snapshot par id. Côté daemon : un snapshot PRÉ-RESTAURATION est pris
 * automatiquement AVANT le remplacement (destructif) et les entrées restaurées reçoivent
 * un horodatage frais.
 *
 * PILOTÉ PAR LE FRONT : réécrire le seul KV daemon serait SANS EFFET — au rechargement le
 * front hydrate depuis localStorage puis la réconciliation last-write-wins ré-écrase le KV
 * (cf. store/persist.ts). On réécrit donc ici DIRECTEMENT dans localStorage les entrées du
 * namespace « persist » (mêmes clés) : l'hydratation au reload repart de l'état restauré.
 *
 * Renvoie `true` si le remplacement a eu lieu, `false` sinon (id inconnu / daemon absent).
 * L'appelant doit ensuite inviter à recharger la page (les stores hydratent au démarrage).
 */
export async function restaurerSnapshot(id: number): Promise<boolean> {
  try {
    const res = await fetch(`${urlSnapshots()}/${encodeURIComponent(String(id))}/restore`, {
      method: "POST",
    });
    if (!res.ok) return false;
    const corps = (await res.json()) as { entrees?: unknown };
    if (Array.isArray(corps.entrees)) {
      for (const e of corps.entrees) {
        if (!e || typeof e !== "object") continue;
        const { namespace, cle, valeur } = e as EntreeRestauree;
        if (namespace === NS_PERSIST && typeof cle === "string" && typeof valeur === "string") {
          try {
            localStorage.setItem(cle, valeur);
          } catch {
            /* quota / mode privé : best-effort */
          }
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────── Candles (cache long terme) ───────────────────────────

/** Bougie au format de fil compact du daemon. */
interface BougieFil {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

function urlCandles(source: string, symbole: string, tf: string): string {
  return `${baseDaemon()}/candles/${encodeURIComponent(source)}/${encodeURIComponent(
    symbole,
  )}/${encodeURIComponent(tf)}`;
}

/**
 * Pousse un lot de bougies au daemon (upsert idempotent). Échec silencieux si absent.
 * Traduit `Candle` (@axiom/types) → format de fil compact `{t,o,h,l,c,v}`.
 */
export async function candlesPush(
  source: string,
  symbole: string,
  tf: string,
  bougies: Candle[],
): Promise<boolean> {
  if (bougies.length === 0) return true;
  try {
    const fil: BougieFil[] = bougies.map((b) => ({
      t: b.time,
      o: b.open,
      h: b.high,
      l: b.low,
      c: b.close,
      v: b.volume,
    }));
    const res = await fetch(urlCandles(source, symbole, tf), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fil),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Bornes optionnelles d'une lecture de bougies. */
export interface OptionsCandlesGet {
  depuis?: number;
  jusqua?: number;
  limite?: number;
}

/**
 * Lit les bougies mises en cache (triées par temps croissant), traduites en `Candle`.
 * Renvoie `null` si le daemon est absent (le front retombe sur le backfill REST direct).
 */
export async function candlesGet(
  source: string,
  symbole: string,
  tf: string,
  opts: OptionsCandlesGet = {},
): Promise<Candle[] | null> {
  try {
    const params = new URLSearchParams();
    if (opts.depuis !== undefined) params.set("depuis", String(opts.depuis));
    if (opts.jusqua !== undefined) params.set("jusqua", String(opts.jusqua));
    if (opts.limite !== undefined) params.set("limite", String(opts.limite));
    const query = params.toString();
    const res = await fetch(urlCandles(source, symbole, tf) + (query ? `?${query}` : ""));
    if (!res.ok) return null;
    const corps = (await res.json()) as { bougies?: BougieFil[] };
    if (!Array.isArray(corps.bougies)) return null;
    return corps.bougies.map((b) => ({
      time: b.t,
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
      volume: b.v,
    }));
  } catch {
    return null;
  }
}
