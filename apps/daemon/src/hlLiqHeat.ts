/**
 * hlLiqHeat.ts — collecteur À FROID des niveaux de liquidation RÉELS Hyperliquid
 * (instantanés périodiques du pool d'adresses de hyperliquid.ts), OPT-IN.
 *
 * POURQUOI : les niveaux HL (/hl/liqlevels) n'existent qu'à l'instant présent —
 * la heatmap a besoin d'un HISTORIQUE. Ce collecteur fige un instantané toutes
 * les PERIODE_INSTANTANE_MS (5 min) dans la table `hl_liq_instantanes`,
 * UNE FOIS le drapeau KV `hl/heat` = { actif: true } posé par le front à
 * l'activation de la couche LIQHL (jamais remis à false par sa désactivation ;
 * la fenêtre LIQ porte le bouton « Collecte daemon »). Sans drapeau, le daemon
 * ne télécharge JAMAIS le leaderboard (34 Mo) ni n'interroge les ~500 comptes.
 *
 * Chaque cycle : instantané FORCÉ des positions (hyperliquid.obtenirInstantane
 * { forcer: true } — le cache 5 min doit être ignoré pour produire un point
 * neuf), puis une requête `metaAndAssetCtxs` (OI par coin = openInterest ×
 * markPx), puis une ligne PAR coin surveillé (mêmes symboles que liqFeed :
 * KV `liq/symboles` ∪ alertes liq-cascade, mappés par `coinHl`, dédoublonnés).
 * Un coin surveillé SANS position donne une ligne `niveaux = "[]"` à compteurs
 * 0 : un instantané vide EST une information (la couverture temporelle de la
 * collecte est déduite des lignes, pas des niveaux non nuls).
 *
 * Stockage compact : `niveaux` = JSON `[[px, side01, usd]…]` trié px croissant
 * (side01 : 0 = long, 1 = short). Rétention 14 jours, purge quotidienne.
 * Drapeau ET symboles relus toutes les 60 s (PERIODE_POLL_DRAPEAU_MS).
 *
 * INVARIANT (BUILD-CONTRACT) : collecte à froid, jamais sur le chemin chaud du
 * renderer ; le front reste fonctionnel sans daemon (couche étiquetée absente).
 *
 * Route : `GET /hl/liqheat/:coin?depuis&jusqua&pas` — `pas` (ms, ≥ PAS_MIN_MS)
 * ne garde que le DERNIER instantané de chaque seau `floor(ts / pas)` ; plafond
 * MAX_INSTANTANES_REPONSE. Chaque instantané porte `couverture` =
 * (longUsd + shortUsd) / (2 × oiUsd) bornée [0,1] (l'OI HL est un côté : les
 * niveaux couvrent les DEUX côtés) ; null sans OI.
 */
import { Database } from "bun:sqlite";
import { entetesCors } from "./cors";
import { getDb } from "./db";
import { coinHl } from "./hlLiqFeed";
import {
  assurerTableKv,
  obtenirInstantane,
  URL_INFO,
  type InstantaneHL,
  type NiveauLiqHL,
} from "./hyperliquid";
import { symbolesSurveillesLiq } from "./liqFeed";
import type { HorlogeWs } from "./wsLoop";

/** Cadence d'un instantané collecté (5 min). */
export const PERIODE_INSTANTANE_MS = 5 * 60_000;
/** Rétention des instantanés (14 jours). */
export const RETENTION_HL_HEAT_MS = 14 * 24 * 3_600_000;
/** Cadence de relecture du drapeau KV `hl/heat` et des symboles surveillés. */
export const PERIODE_POLL_DRAPEAU_MS = 60_000;
/** Pas minimum demandable à /hl/liqheat (en deçà, rien à sous-échantillonner). */
export const PAS_MIN_MS = PERIODE_INSTANTANE_MS;
/** Plafond d'instantanés renvoyés par une réponse. */
export const MAX_INSTANTANES_REPONSE = 2000;
/** Cadence de la purge de rétention (au plus une fois par 24 h). */
const PERIODE_PURGE_MS = 24 * 3_600_000;

/**
 * Table des instantanés : une ligne PAR coin PAR cycle (PK (coin, ts)) —
 * l'absence de positions est une ligne à niveaux "[]", pas une absence de ligne.
 */
export function assurerTableHlHeat(d: Database): void {
  d.run(`CREATE TABLE IF NOT EXISTS hl_liq_instantanes (
      ts INTEGER NOT NULL,
      coin TEXT NOT NULL,
      niveaux TEXT NOT NULL,
      long_usd REAL NOT NULL,
      short_usd REAL NOT NULL,
      n_long INTEGER NOT NULL,
      n_short INTEGER NOT NULL,
      oi_usd REAL,
      adresses INTEGER NOT NULL,
      PRIMARY KEY (coin, ts)
    )`);
  d.run("CREATE INDEX IF NOT EXISTS idx_hl_liq_instantanes_ts ON hl_liq_instantanes(ts)");
}

// ─────────────────────────── Fonctions PURES (testées) ───────────────────────────

/**
 * Lit le drapeau de collecte : KV namespace `hl`, clé `heat`, JSON
 * `{ actif: boolean }`. Absent, table absente ou JSON corrompu → `false`
 * (opt-in strict : l'inconnu vaut inactif). PURE (lecture seule, tolérante).
 */
export function lireDrapeauCollecte(d: Database): boolean {
  try {
    const ligne = d
      .query("SELECT valeur FROM kv WHERE namespace = ? AND cle = ?")
      .get("hl", "heat") as { valeur: string } | null;
    if (!ligne) return false;
    const v = JSON.parse(ligne.valeur) as { actif?: unknown };
    return v.actif === true;
  } catch {
    return false;
  }
}

/**
 * Extrait l'open interest en USD par coin d'une réponse `metaAndAssetCtxs`
 * (tuple `[meta, ctxs]` : `meta.universe[i].name` ↔ `ctxs[i]`) :
 * `oiUsd = openInterest × markPx`. Valeurs non finies écartées ; entrée
 * inattendue → Map vide. PURE.
 */
export function parserOiParCoin(json: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (!Array.isArray(json) || json.length < 2) return out;
  const meta = json[0] as { universe?: unknown } | null;
  const ctxs = json[1];
  if (!meta || !Array.isArray(meta.universe) || !Array.isArray(ctxs)) return out;
  for (let i = 0; i < meta.universe.length; i++) {
    const nom = (meta.universe[i] as { name?: unknown } | null)?.name;
    if (typeof nom !== "string" || nom === "") continue;
    const ctx = ctxs[i] as { openInterest?: unknown; markPx?: unknown } | null;
    const oi = Number(ctx?.openInterest);
    const px = Number(ctx?.markPx);
    if (!Number.isFinite(oi) || !Number.isFinite(px)) continue;
    out.set(nom, oi * px);
  }
  return out;
}

/**
 * Sérialise les niveaux d'un coin pour la colonne `niveaux` :
 * JSON `[[px, side01, usd]…]` trié par px CROISSANT (side01 : 0 long, 1 short).
 * PURE.
 */
export function serialiserNiveaux(niveaux: readonly NiveauLiqHL[]): string {
  const compacts = niveaux
    .map((n) => [n.px, n.side === "short" ? 1 : 0, n.valueUsd] as [number, number, number])
    .sort((a, b) => a[0] - b[0]);
  return JSON.stringify(compacts);
}

/** Un niveau désérialisé de la colonne `niveaux` (forme compacte). */
export interface NiveauCompact {
  px: number;
  /** 0 = long liquidé à ce prix, 1 = short. */
  side01: 0 | 1;
  usd: number;
}

/**
 * Désérialise une colonne `niveaux` en niveaux compacts. TOLÉRANTE : entrée
 * non-JSON, non-tableau ou éléments malformés → seuls les triplets
 * `[nombre, 0|1, nombre]` finis sont conservés (jamais d'exception). PURE.
 */
export function deserialiserNiveaux(texte: string): NiveauCompact[] {
  let brut: unknown;
  try {
    brut = JSON.parse(texte);
  } catch {
    return [];
  }
  if (!Array.isArray(brut)) return [];
  const out: NiveauCompact[] = [];
  for (const e of brut) {
    if (!Array.isArray(e) || e.length < 3) continue;
    const px = Number(e[0]);
    const side = Number(e[1]);
    const usd = Number(e[2]);
    if (!Number.isFinite(px) || !Number.isFinite(usd)) continue;
    if (side !== 0 && side !== 1) continue;
    out.push({ px, side01: side as 0 | 1, usd });
  }
  return out;
}

/** Agrégats long/short d'un instantané (sommes USD + compteurs). PURE. */
export function agregerNiveaux(niveaux: readonly NiveauLiqHL[]): {
  longUsd: number;
  shortUsd: number;
  nLong: number;
  nShort: number;
} {
  const out = { longUsd: 0, shortUsd: 0, nLong: 0, nShort: 0 };
  for (const n of niveaux) {
    if (n.side === "long") {
      out.longUsd += n.valueUsd;
      out.nLong += 1;
    } else {
      out.shortUsd += n.valueUsd;
      out.nShort += 1;
    }
  }
  return out;
}

/**
 * Couverture de l'OI par l'échantillon : `(longUsd + shortUsd) / (2 × oiUsd)`,
 * bornée [0, 1]. L'OI est comptée UN côté alors que les niveaux agrègent les
 * deux côtés des positions — d'où le facteur 2. `null` si `oiUsd` absent ou
 * ≤ 0 (couverture indéfinie, affichée comme telle). PURE.
 */
export function couvertureOi(longUsd: number, shortUsd: number, oiUsd: number | null): number | null {
  if (oiUsd === null || !Number.isFinite(oiUsd) || oiUsd <= 0) return null;
  const c = (longUsd + shortUsd) / (2 * oiUsd);
  if (!Number.isFinite(c)) return null;
  return Math.min(1, Math.max(0, c));
}

/**
 * Sous-échantillonnage par seaux : ne garde que le DERNIER `ts` de chaque seau
 * `floor(ts / pas)`, ordre croissant conservé. `pas` null → lignes inchangées.
 * PURE.
 */
export function sousEchantillonner<T extends { ts: number }>(lignes: readonly T[], pas: number | null): T[] {
  if (pas === null || !Number.isFinite(pas) || pas <= 0) return [...lignes];
  const parSeau = new Map<number, T>();
  for (const l of lignes) {
    parSeau.set(Math.floor(l.ts / pas), l); // le dernier du seau écrase
  }
  return [...parSeau.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l);
}

/** Paramètres normalisés de GET /hl/liqheat/:coin. */
export interface RequeteHeat {
  depuis: number;
  jusqua: number;
  /** Pas de sous-échantillonnage (ms), null = toutes les lignes. */
  pas: number | null;
}

/**
 * Parse `depuis`/`jusqua`/`pas` de la requête. `depuis` défaut = now − rétention ;
 * `jusqua` défaut = now ; `pas` : absent ou non numérique → null ; < PAS_MIN_MS
 * → ramené à PAS_MIN_MS. PURE.
 */
export function parseRequeteHeat(params: URLSearchParams, now: number): RequeteHeat {
  const nombreParam = (nom: string): number | null => {
    const brut = params.get(nom);
    if (brut === null) return null;
    const v = Number(brut);
    return Number.isFinite(v) ? v : null;
  };
  const depuis = nombreParam("depuis") ?? now - RETENTION_HL_HEAT_MS;
  const jusqua = nombreParam("jusqua") ?? now;
  const pasBrut = nombreParam("pas");
  const pas = pasBrut === null ? null : Math.max(PAS_MIN_MS, pasBrut);
  return { depuis, jusqua, pas };
}

// ─────────────────────────── Santé du collecteur ───────────────────────────

/** Santé du collecteur heatmap HL — exposée par /health → collecteurs.hlHeat. */
export interface SanteHlHeat {
  /** Drapeau KV `hl/heat` lu au dernier poll (ou dernier cycle). */
  actif: boolean;
  /** ts du dernier instantané inséré (0 = jamais depuis le démarrage). */
  dernierInstantaneTs: number;
  derniereErreur: string | null;
  /** Coins écrits au dernier cycle. */
  coins: string[];
  /** Adresses effectivement scannées au dernier cycle. */
  adresses: number;
}

const sante: SanteHlHeat = {
  actif: false,
  dernierInstantaneTs: 0,
  derniereErreur: null,
  coins: [],
  adresses: 0,
};

/** Horodatage de la dernière purge de rétention (mémoire process). */
let dernierePurgeTs = 0;

/** Santé courante du collecteur (copie superficielle — cf. santeWhales). */
export function santeHlHeat(): SanteHlHeat {
  return { ...sante, coins: [...sante.coins] };
}

/** Réinitialise l'état du collecteur (tests). */
export function reinitialiserHlHeat(): void {
  sante.actif = false;
  sante.dernierInstantaneTs = 0;
  sante.derniereErreur = null;
  sante.coins = [];
  sante.adresses = 0;
  dernierePurgeTs = 0;
}

// ─────────────────────────── Cycle d'instantané ───────────────────────────

/** Dépendances injectables d'un cycle (tests : fetch factice + horloge fixe). */
export interface DepsCycle {
  fetchImpl: typeof fetch;
  now: number;
  /** Symboles surveillés (fusion KV ∪ alertes — mêmes symboles que liqFeed). */
  symboles: readonly string[];
  /** Instantané déjà construit (tests) ; sinon `obtenirInstantane` forcé. */
  instantane?: InstantaneHL;
}

/**
 * Une ligne `metaAndAssetCtxs` (une SEULE requête POST /info par cycle) →
 * Map coin → oiUsd. Best-effort : échec → Map vide (oi_usd NULL partout).
 */
async function chargerOi(fetchImpl: typeof fetch): Promise<Map<string, number>> {
  try {
    const res = await fetchImpl(URL_INFO, {
      method: "POST",
      headers: { "user-agent": "axiom-daemon/1.0 (terminal perso)", "content-type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return new Map();
    return parserOiParCoin(await res.json());
  } catch {
    return new Map();
  }
}

/**
 * Un cycle de collecte : instantané forcé du pool + OI par coin + insertion
 * d'une ligne PAR coin surveillé (y compris `niveaux = "[]"` quand le coin n'a
 * aucune position échantillonnée) + purge de rétention au plus 1×/24 h.
 * Renvoie le nombre de lignes insérées (0 si l'instantané est indisponible).
 * La santé est mise à jour dans tous les cas.
 */
export async function cycleInstantane(d: Database, deps: DepsCycle): Promise<number> {
  assurerTableHlHeat(d);
  try {
    const inst = deps.instantane ?? (await obtenirInstantane(d, deps.fetchImpl, deps.now, { forcer: true }));
    if (inst === null) {
      sante.derniereErreur = "pool d'adresses Hyperliquid indisponible";
      return 0;
    }
    const oiParCoin = await chargerOi(deps.fetchImpl);
    const coins = [...new Set(
      deps.symboles.map((s) => coinHl(s)).filter((c): c is string => c !== null),
    )].sort();
    const ins = d.prepare(
      `INSERT OR REPLACE INTO hl_liq_instantanes
       (ts, coin, niveaux, long_usd, short_usd, n_long, n_short, oi_usd, adresses)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insLot = d.transaction((liste: readonly string[]) => {
      for (const coin of liste) {
        const niveaux = inst.parCoin.get(coin) ?? [];
        const agg = agregerNiveaux(niveaux);
        ins.run(
          deps.now,
          coin,
          serialiserNiveaux(niveaux),
          agg.longUsd,
          agg.shortUsd,
          agg.nLong,
          agg.nShort,
          oiParCoin.get(coin) ?? null,
          inst.adressesScannees,
        );
      }
    });
    insLot(coins);
    // Purge de rétention : au plus une fois par 24 h.
    if (deps.now - dernierePurgeTs >= PERIODE_PURGE_MS) {
      d.query("DELETE FROM hl_liq_instantanes WHERE ts < ?").run(deps.now - RETENTION_HL_HEAT_MS);
      dernierePurgeTs = deps.now;
    }
    sante.dernierInstantaneTs = deps.now;
    sante.derniereErreur = null;
    sante.coins = coins;
    sante.adresses = inst.adressesScannees;
    return coins.length;
  } catch (err) {
    sante.derniereErreur = err instanceof Error ? err.message : String(err);
    return 0;
  }
}

// ─────────────────────────── Boucle de vie ───────────────────────────

/** Dépendances injectables de la boucle (tests : horloge/fetch/db factices). */
export interface DepsBoucleHlHeat {
  d?: Database;
  fetchImpl?: typeof fetch;
  horloge?: HorlogeWs;
}

const HORLOGE_REELLE: HorlogeWs = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
};

/**
 * Démarre le collecteur opt-in de la heatmap HL : relit le drapeau KV `hl/heat`
 * ET le jeu de symboles surveillés toutes les PERIODE_POLL_DRAPEAU_MS ; quand le
 * drapeau passe actif, arme un minuteur PERIODE_INSTANTANE_MS (premier
 * instantané IMMÉDIAT au passage à actif) ; quand il repasse inactif, le
 * minuteur est désarmé. Renvoie une fonction d'arrêt. À appeler UNE fois depuis
 * index.ts. Jamais sur le chemin chaud du renderer.
 */
export function demarrerBoucleHlHeat(deps: DepsBoucleHlHeat = {}): () => void {
  const d = deps.d ?? getDb();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const horloge = deps.horloge ?? HORLOGE_REELLE;
  assurerTableHlHeat(d);

  let symboles: string[] = [];
  let minuteurInstantane: unknown = null;
  let enCours = false; // anti-chevauchement (un cycle peut dépasser la minute de poll)

  const cycle = async (): Promise<void> => {
    if (enCours) return;
    enCours = true;
    try {
      await cycleInstantane(d, { fetchImpl, now: horloge.now(), symboles });
    } finally {
      enCours = false;
    }
  };

  const poll = (): void => {
    try {
      const actif = lireDrapeauCollecte(d);
      sante.actif = actif;
      symboles = symbolesSurveillesLiq(d);
      if (actif && minuteurInstantane === null) {
        minuteurInstantane = horloge.setInterval(() => void cycle(), PERIODE_INSTANTANE_MS);
        void cycle(); // premier instantané immédiat au passage à actif
      } else if (!actif && minuteurInstantane !== null) {
        horloge.clearInterval(minuteurInstantane);
        minuteurInstantane = null;
      }
    } catch (err) {
      sante.derniereErreur = err instanceof Error ? err.message : String(err);
      console.error("[axiomd] poll du drapeau hl/heat échoué :", err);
    }
  };
  poll();
  const minuteurPoll = horloge.setInterval(poll, PERIODE_POLL_DRAPEAU_MS);

  return () => {
    horloge.clearInterval(minuteurPoll);
    if (minuteurInstantane !== null) horloge.clearInterval(minuteurInstantane);
    minuteurInstantane = null;
  };
}

// ─────────────────────────── Route ───────────────────────────

interface LigneInstantane {
  ts: number;
  niveaux: string;
  long_usd: number;
  short_usd: number;
  n_long: number;
  n_short: number;
  oi_usd: number | null;
  adresses: number;
}

/** Réponse JSON avec en-têtes CORS (même pattern que hyperliquid.ts). */
function json(corps: unknown, req: Request, status = 200): Response {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...entetesCors(req) },
  });
}

/**
 * Gestionnaire de `GET /hl/liqheat/:coin?depuis&jusqua&pas` : historique des
 * instantanés collectés pour un coin. LECTURE LOCALE uniquement — jamais
 * d'appel amont (la collecte dépend du drapeau, pas de la requête).
 * `dInjecte`/`now` permettent aux tests d'injecter (convention traiterHl).
 */
export function traiterHlHeat(req: Request, url: URL, dInjecte?: Database, now?: number): Response {
  if (req.method !== "GET") return json({ erreur: "méthode non autorisée" }, req, 405);
  const segments = url.pathname.split("/").filter((s) => s.length > 0);
  // segments = ["hl", "liqheat", ":coin"]
  if (segments[1] !== "liqheat") return json({ erreur: "chemin inconnu" }, req, 404);
  if (segments.length !== 3) return json({ erreur: "coin requis" }, req, 400);
  let coin: string;
  try {
    coin = decodeURIComponent(segments[2] as string);
  } catch {
    coin = segments[2] as string;
  }
  const maintenant = now ?? Date.now();
  try {
    const d = dInjecte ?? getDb();
    assurerTableHlHeat(d);
    const { depuis, jusqua, pas } = parseRequeteHeat(url.searchParams, maintenant);
    const lignes = d
      .query(
        `SELECT ts, niveaux, long_usd, short_usd, n_long, n_short, oi_usd, adresses
         FROM hl_liq_instantanes WHERE coin = ? AND ts >= ? AND ts <= ? ORDER BY ts ASC`,
      )
      .all(coin, depuis, jusqua) as LigneInstantane[];
    const echantillonnees = sousEchantillonner(lignes, pas).slice(-MAX_INSTANTANES_REPONSE);
    const premier = d
      .query("SELECT MIN(ts) AS t FROM hl_liq_instantanes WHERE coin = ?")
      .get(coin) as { t: number | null } | null;
    const santeCourante = santeHlHeat();
    return json(
      {
        coin,
        pas,
        collecte: {
          actif: santeCourante.actif,
          dernierInstantaneTs: santeCourante.dernierInstantaneTs,
          periodeMs: PERIODE_INSTANTANE_MS,
          retentionMs: RETENTION_HL_HEAT_MS,
          premierTs: premier?.t ?? null,
        },
        instantanes: echantillonnees.map((l) => ({
          ts: l.ts,
          niveaux: deserialiserNiveaux(l.niveaux).map((n) => [n.px, n.side01, n.usd]),
          longUsd: l.long_usd,
          shortUsd: l.short_usd,
          nLong: l.n_long,
          nShort: l.n_short,
          oiUsd: l.oi_usd,
          adresses: l.adresses,
          couverture: couvertureOi(l.long_usd, l.short_usd, l.oi_usd),
        })),
      },
      req,
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return json({ erreur: "erreur interne hl", detail }, req, 500);
  }
}
