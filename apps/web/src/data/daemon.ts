/**
 * Client du daemon `axiomd` (OPTIONNEL) — feature-detect + accès /kv et /candles.
 *
 * Le daemon localhost (Bun + SQLite, port 8787) apporte proxy/cache et PERSISTANCE
 * DURABLE (survit au vidage du cache navigateur). Les appels échouent en silence si
 * le daemon est absent ; les fonctions qui en dépendent signalent alors leur indisponibilité
 * et la persistance générale conserve son repli localStorage (cf. store/persist.ts).
 *
 * INVARIANT (BUILD-CONTRACT) : le daemon n'est JAMAIS sur le chemin chaud du
 * renderer. Ici, uniquement du stockage à froid (kv/candles) et la sonde /health.
 *
 * Origine :
 *  - DEV  : `VITE_AXIOMD_URL`, injectée par `axiom-up.sh` depuis AXIOMD_PORT
 *           (repli sûr : http://127.0.0.1:8787).
 *  - PROD local : le front est SERVI PAR le daemon → même origine.
 *  - Vercel : détection désactivée au build, aucune sonde `/health`.
 */
import type { Candle } from "@axiom/types";
import { healthStore } from "../store/health";
import { IS_VERCEL } from "../lib/deployment";
import { DAEMON_CAPABILITIES, type DaemonCapability } from "../../../../shared/daemon-capabilities";

/** Source santé du lien daemon (affichée dans le panneau « santé des sources »). */
const SOURCE_SANTE = "axiomd";
/** Délai max d'une sonde /health (ms). */
const TIMEOUT_SONDE_MS = 800;
/** Fraîcheur du résultat mémoïsé de detectDaemon (ms). */
const TTL_SONDE_MS = 60_000;
const AXIOMD_API_VERSION = 1;
export const URL_DAEMON_DEV_DEFAUT = "http://127.0.0.1:8787";

// Capabilities : SOURCE UNIQUE partagée avec le daemon (shared/daemon-capabilities.ts).
// Ré-exportées sous les noms historiques pour les appelants de ce module.
export const AXIOMD_CAPABILITIES = DAEMON_CAPABILITIES;
export type AxiomCapability = DaemonCapability;

export interface AxiomHealth {
  ok: true;
  service: "axiomd";
  apiVersion: number;
  capabilities: string[];
  version: string;
}

/** Valide l'identité du service avant de lui confier l'état local de l'utilisateur. */
export function isAxiomHealth(
  payload: unknown,
  capabilitiesRequises: readonly AxiomCapability[] = [],
): payload is AxiomHealth {
  if (!payload || typeof payload !== "object") return false;
  const value = payload as Record<string, unknown>;
  const capabilities = value.capabilities;
  return (
    value.ok === true &&
    value.service === "axiomd" &&
    value.apiVersion === AXIOMD_API_VERSION &&
    typeof value.version === "string" &&
    Array.isArray(capabilities) &&
    capabilities.every((capability) => typeof capability === "string") &&
    capabilitiesRequises.every((capability) => capabilities.includes(capability))
  );
}

/**
 * Accepte seulement le daemon HTTP loopback attendu. Une variable Vite erronée ou
 * hostile ne doit jamais transformer les dual-writes locaux en envoi réseau externe.
 */
export function normaliserUrlDaemonDev(candidate: unknown): string {
  if (typeof candidate !== "string" || candidate.trim().length === 0) return URL_DAEMON_DEV_DEFAUT;
  try {
    const url = new URL(candidate.trim());
    const hoteLocal = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    const port = url.port === "" ? 80 : Number(url.port);
    if (
      url.protocol !== "http:" ||
      !hoteLocal ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== "" ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65_535
    ) {
      return URL_DAEMON_DEV_DEFAUT;
    }
    return url.origin;
  } catch {
    return URL_DAEMON_DEV_DEFAUT;
  }
}

const URL_DAEMON_DEV = normaliserUrlDaemonDev(import.meta.env.VITE_AXIOMD_URL);

/** Base d'URL du daemon selon l'environnement (calcul paresseux, robuste hors navigateur). */
function baseDaemon(): string {
  if (import.meta.env.DEV) return URL_DAEMON_DEV;
  if (typeof window !== "undefined") return window.location.origin;
  return URL_DAEMON_DEV_DEFAUT;
}

/** URL absolue d'un chemin daemon (DEV : URL loopback configurée ; PROD : same-origin). */
export function urlDaemon(chemin: string): string {
  return `${baseDaemon()}${chemin}`;
}

// ─────────────────────────── Détection (feature-detect) ───────────────────────────

/** Dernier résultat de sonde ; `null` = jamais sondé (→ health silencieux). */
let etatDaemon: boolean | null = null;
let dernierSondageTs = 0;
let capabilitiesDaemon: ReadonlySet<string> = new Set();
/** Devient vrai à la 1re détection réussie : conditionne l'émission de « closed ». */
let dejaDetecte = false;
let intervalDemarre = false;

/** Effectue une sonde /health (timeout 800 ms) et met à jour l'état + la santé. */
async function sonder(): Promise<boolean> {
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), TIMEOUT_SONDE_MS);
  let ok = false;
  let health: AxiomHealth | null = null;
  try {
    const res = await fetch(baseDaemon() + "/health", { signal: ctrl.signal });
    if (res.ok) {
      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.toLowerCase().includes("application/json")) {
        const payload = (await res.json()) as unknown;
        if (isAxiomHealth(payload)) {
          health = payload;
          ok = true;
        }
      }
    }
  } catch {
    ok = false;
  } finally {
    clearTimeout(minuteur);
  }
  etatDaemon = ok;
  capabilitiesDaemon = health ? new Set(health.capabilities) : new Set();
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
export async function detectDaemon(
  exigence?: AxiomCapability | readonly AxiomCapability[],
): Promise<boolean> {
  if (IS_VERCEL) return false;
  let present: boolean;
  if (etatDaemon !== null && Date.now() - dernierSondageTs < TTL_SONDE_MS) {
    present = etatDaemon;
  } else {
    if (!intervalDemarre && typeof setInterval !== "undefined") {
      intervalDemarre = true;
      const id: ReturnType<typeof setInterval> = setInterval(() => void sonder(), TTL_SONDE_MS);
      // Ne pas retenir la boucle d'évènements (Node) — no-op côté navigateur.
      (id as unknown as { unref?: () => void }).unref?.();
    }
    present = await sonder();
  }
  if (!present || exigence === undefined) return present;
  const requises = typeof exigence === "string" ? [exigence] : exigence;
  return requises.every((capability) => capabilitiesDaemon.has(capability));
}

/** État synchrone d'une fonctionnalité, sans déclencher de nouvelle sonde. */
export function daemonSupporte(capability: AxiomCapability): boolean {
  return !IS_VERCEL && etatDaemon === true && capabilitiesDaemon.has(capability);
}

/** Le dual-write KV est prêt seulement si le daemon annonce explicitement `kv`. */
export function daemonPret(): boolean {
  return daemonSupporte("kv");
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
  if (!(await detectDaemon("snapshots"))) return null;
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
  if (!(await detectDaemon("snapshots"))) return null;
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
/** Seules les clés réellement miroitée par store/persist peuvent être réappliquées. */
const RESTORABLE_PERSIST_KEYS: ReadonlySet<string> = new Set([
  "axiom:chartState:v1",
  "axiom:watchlist:v1",
  "axiom:sessionUi:v1",
  "axiom:windowManager:v1",
  "axiom:synthetic:recents:v1",
]);

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
  if (!(await detectDaemon("snapshots"))) return false;
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
        if (
          namespace === NS_PERSIST &&
          typeof cle === "string" &&
          RESTORABLE_PERSIST_KEYS.has(cle) &&
          typeof valeur === "string"
        ) {
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

// ─────────────────────────── Liquidations (historique persistant) ───────────────────────────

/**
 * Une liquidation au format de fil du daemon — IDENTIQUE au stockage SQLite (LiqFil).
 * Comme les champs coïncident, aucune traduction n'est nécessaire (contrairement aux
 * bougies) : les lots sont poussés et relus tels quels.
 */
export interface LiqDaemon {
  t: number;
  venue: string;
  side: "long" | "short";
  price: number;
  qty: number;
  usd: number;
}

/** URL du fil de liquidations d'un symbole (symbole URL-encodé). */
function urlLiquidations(symbole: string): string {
  return `${baseDaemon()}/liquidations/${encodeURIComponent(symbole)}`;
}

/** Bornes optionnelles d'une lecture de liquidations. */
export interface OptionsLiquidationsGet {
  depuis?: number;
  jusqua?: number;
  limite?: number;
}

/**
 * Lit le fil de liquidations persistées (triées par temps croissant). Sonde d'abord la
 * capability `liquidations` (comme `listerSnapshots`) ; renvoie `null` si le daemon est
 * absent / sans capability / en erreur — le front retombe alors sur le flux direct des
 * exchanges.
 */
export async function liquidationsGet(
  symbole: string,
  opts: OptionsLiquidationsGet = {},
): Promise<LiqDaemon[] | null> {
  if (!(await detectDaemon("liquidations"))) return null;
  try {
    const params = new URLSearchParams();
    if (opts.depuis !== undefined) params.set("depuis", String(opts.depuis));
    if (opts.jusqua !== undefined) params.set("jusqua", String(opts.jusqua));
    if (opts.limite !== undefined) params.set("limite", String(opts.limite));
    const query = params.toString();
    const res = await fetch(urlLiquidations(symbole) + (query ? `?${query}` : ""));
    if (!res.ok) return null;
    const corps = (await res.json()) as { liquidations?: LiqDaemon[] };
    if (!Array.isArray(corps.liquidations)) return null;
    return corps.liquidations;
  } catch {
    return null;
  }
}

// ─────────────────────────── Journal d'alertes (déclenchements onglet fermé) ───────────────────────────

/**
 * Un déclenchement journalisé par le daemon — forme de fil de `GET /alerts/journal`
 * (identique au stockage SQLite `alertes_journal`, aucune traduction nécessaire).
 */
export interface DeclenchementDaemon {
  alertId: string;
  /** Symbole porteur de l'alerte (le journal front, lui, ne le connaît pas). */
  symbol: string;
  ts: number;
  valeur: number;
  message: string;
  /** Vrai si le daemon a réellement notifié (app fermée au moment du déclenchement). */
  notifie: boolean;
}

/**
 * Lit le journal des déclenchements du daemon (200 derniers, plus récent en tête).
 * C'est la SEULE source de ce qui s'est déclenché onglet fermé. Sonde d'abord la
 * capability `alerts` (comme `liquidationsGet`) ; renvoie `null` si le daemon est
 * absent / sans capability / en erreur — l'appelant garde alors son journal local.
 */
export async function journalAlertesGet(): Promise<DeclenchementDaemon[] | null> {
  if (!(await detectDaemon("alerts"))) return null;
  try {
    const res = await fetch(`${baseDaemon()}/alerts/journal`);
    if (!res.ok) return null;
    const corps = (await res.json()) as { journal?: DeclenchementDaemon[] };
    if (!Array.isArray(corps.journal)) return null;
    return corps.journal;
  } catch {
    return null;
  }
}

// ─────────────────────────── Niveaux de liquidation RÉELS Hyperliquid ───────────────────────────

/**
 * Lit les niveaux de liquidation RÉELS d'un coin (top adresses Hyperliquid) — charge utile
 * BRUTE, dont la VALIDATION de forme vit dans `data/hyperliquidLiq.ts` (pure et testée).
 * Sonde d'abord la capability `hl` (comme `journalAlertesGet`) ; renvoie `null` si le daemon
 * est absent / sans capability / en erreur — la couche affiche alors « nécessite le daemon ».
 */
export async function hlLiqLevelsGet(coin: string): Promise<unknown | null> {
  if (!(await detectDaemon("hl"))) return null;
  try {
    const res = await fetch(`${baseDaemon()}/hl/liqlevels/${encodeURIComponent(coin)}`);
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

/** Le daemon annonce-t-il la capability `hl` ? (état synchrone, sans nouvelle sonde). */
export function daemonSupporteHl(): boolean {
  return daemonSupporte("hl");
}

/**
 * Pousse un lot de liquidations au daemon (insert idempotent). Best-effort SANS sonde
 * (comme `candlesPush`) : renvoie `false` en cas d'échec silencieux. Le format de fil du
 * daemon étant identique à `LiqDaemon`, le lot est envoyé tel quel.
 */
export async function liquidationsPush(symbole: string, lot: LiqDaemon[]): Promise<boolean> {
  if (lot.length === 0) return true;
  try {
    const res = await fetch(urlLiquidations(symbole), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(lot),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─────────────────────────── Mouvements baleines (fenêtre WHALES) ───────────────────────────

/** Filtres de lecture des mouvements baleines (traduits en query). */
export interface OptionsWhalesGet {
  limite?: number;
  minUsd?: number;
  asset?: string;
}

/**
 * Lit les mouvements baleines collectés par le daemon (`GET /whales/recent`) — charge utile
 * BRUTE, dont la VALIDATION de forme vit dans `data/whales.ts` (pure et testée, convention
 * `hlLiqLevelsGet`). Sonde d'abord la capability `whales` ; renvoie `null` si le daemon est
 * absent / sans capability / en erreur — la fenêtre affiche alors « nécessite le daemon ».
 */
export async function whalesRecentGet(opts: OptionsWhalesGet = {}): Promise<unknown | null> {
  if (!(await detectDaemon("whales"))) return null;
  try {
    const params = new URLSearchParams();
    if (opts.limite !== undefined) params.set("limite", String(opts.limite));
    if (opts.minUsd !== undefined) params.set("minUsd", String(opts.minUsd));
    if (opts.asset !== undefined) params.set("asset", opts.asset);
    const query = params.toString();
    const res = await fetch(`${baseDaemon()}/whales/recent${query ? `?${query}` : ""}`);
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

/**
 * Lit les positions des top comptes Hyperliquid d'un coin (`GET /hl/positions/:coin`,
 * MÊME instantané daemon que les niveaux de liquidation) — charge utile BRUTE, validée
 * dans `data/whales.ts`. Même régime de repli que `hlLiqLevelsGet`.
 */
export async function hlPositionsGet(coin: string): Promise<unknown | null> {
  if (!(await detectDaemon("hl"))) return null;
  try {
    const res = await fetch(`${baseDaemon()}/hl/positions/${encodeURIComponent(coin)}`);
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}
