/**
 * Route /hl/liqlevels/:coin — niveaux de liquidation RÉELS Hyperliquid.
 *
 * Contrairement aux « heatmaps de liquidation » du marché (estimations dérivées
 * de l'open interest), Hyperliquid expose le `liquidationPx` EFFECTIF de chaque
 * position via son API publique. On échantillonne les plus gros comptes du
 * leaderboard et on en déduit, coin par coin, les niveaux où de vraies positions
 * seront liquidées.
 *
 * Deux amonts, deux cadences :
 *  - Pool d'adresses : GET stats-data.hyperliquid.xyz/Mainnet/leaderboard (≈ 39 Mo,
 *    ≈ 31 s mesurées le 2026-09-25 sur la liaison du poste). Téléchargé AU PLUS 1×/6 h,
 *    PARESSEUSEMENT (au premier besoin, jamais au boot du daemon). Pool cible de
 *    TAILLE_POOL (~1 500) adresses : top N_VALEUR_POOL (500) par accountValue, complété
 *    par le classement volume hebdomadaire (cf. extrairePool), persisté dans la table
 *    `kv` (namespace « hl », clé « pool ») AVEC ses paramètres : un pool construit avec
 *    d'autres paramètres n'est pas frais (retéléchargé). Amont KO → on réutilise le pool
 *    persisté même périmé ou d'anciens paramètres ; rien de persisté → 503 propre.
 *  - Instantané des positions : POST api.hyperliquid.xyz/info
 *    { type: "clearinghouseState", user } par adresse, CONCURRENCE (4) en vol, lots
 *    cadencés par un DÉBIT DE POIDS plafonné (cf. DEBIT_POIDS_MIN). UN SEUL
 *    instantané couvre TOUS les coins → cache mémoire 5 min : /hl/liqlevels/ETH
 *    juste après /BTC ne déclenche aucun appel amont.
 *
 * QUOTA (doc officielle lue le 2026-09-25, hyperliquid.gitbook.io → For developers →
 * API → « Rate limits and user limits ») : « REST requests share an aggregated
 * weight limit of 1200 per minute » PAR IP ; poids 2 pour « l2Book, allMids,
 * clearinghouseState, orderStatus, spotClearinghouseState, exchangeStatus », 20 pour
 * les autres requêtes info (dont metaAndAssetCtxs du collecteur), 60 pour userRole.
 * Les séries `fundingHistory`, `recentTrades`… coûtent en plus 1 poids « per 20 items
 * returned ». Budget : 1 500 adresses × 2 = 3 000 poids par scan ; à 750 poids/min
 * alloués au scan → ≈ 240 s (calculé, non mesuré) ; en moyenne sur le cycle de 5 min du
 * collecteur ≈ 600 poids/min ; 450 poids/min restent au navigateur, qui appelle
 * api.hyperliquid.xyz depuis la MÊME IP — marge qui dépend des indicateurs HL actifs
 * (cf. DEBIT_POIDS_MIN) ; un 429 tronque l'instantané.
 *
 * LECTURES : une lecture (/hl/liqlevels, /hl/positions) n'attend JAMAIS un scan
 * quand un cache existe, même périmé (servi tel quel, reconstruction en arrière-plan) ;
 * sans aucun cache elle attend au plus ATTENTE_FROID_MAX_MS puis répond 503
 * `{ enConstruction: true }` + Retry-After (le scan continue et remplit le cache).
 * Premier scan après un démarrage : ≈ 4 min (≈ 4,5 si le leaderboard est à retélécharger).
 * PANNE AMONT : un scan dont les premiers lots échouent tous est abandonné (quelques
 * secondes) ; sans cache, l'échec est retenu et les lectures répondent le 503 « pool
 * indisponible » (jamais « en construction » sans fin), avec un repli de
 * REPLI_ECHEC_TOTAL_MS avant qu'une lecture relance un essai.
 *
 * PIÈGE amont (vérifié) : en marge croisée, `liquidationPx` peut être `null`
 * (compte bien collatéralisé) ou ABERRANT (short BNB de 12 $ « liquidable » à
 * 53 899 700 $). On renvoie les niveaux BRUTS mais on filtre l'évident :
 * liquidationPx non-null, fini, > 0, et positionValue ≥ 1000 $.
 *
 * INVARIANT (BUILD-CONTRACT) : stockage/service à froid — jamais sur le chemin
 * chaud du renderer. Aucune boucle sauf le collecteur opt-in de hlLiqHeat.ts
 * (drapeau KV `hl/heat`) ; tout le reste est déclenché par la requête.
 */
import { Database } from "bun:sqlite";
import { entetesCors } from "./cors";
import { getDb } from "./db";
import { traiterHlHeat } from "./hlLiqHeat";
import type { Routeur } from "./router";
import type { HorlogeWs } from "./wsLoop";

export const URL_LEADERBOARD = "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard";
export const URL_INFO = "https://api.hyperliquid.xyz/info";

/**
 * Taille CIBLE totale du pool d'adresses échantillonné (demande du propriétaire du
 * 2026-09-25 : « ~1 500 »). Échantillon du leaderboard, JAMAIS « toutes » les positions.
 */
export const TAILLE_POOL = 1500;
/** Part du pool prise au classement `accountValue` (les plus gros comptes). */
export const N_VALEUR_POOL = 500;
/** Fraîcheur du pool d'adresses : au plus un téléchargement des ≈ 39 Mo / 6 h. */
export const TTL_POOL_MS = 6 * 3_600_000;
/** Fraîcheur de l'instantané des positions (tous coins confondus). */
export const TTL_INSTANTANE_MS = 5 * 60_000;
/** Plancher de valeur notionnelle : sous ce seuil, un liquidationPx est du bruit. */
export const SEUIL_VALEUR_USD = 1000;

/** Requêtes `clearinghouseState` en vol simultanément (un lot). */
export const CONCURRENCE = 4;
/** Poids d'une requête `clearinghouseState` (doc officielle, cf. en-tête). */
export const POIDS_CLEARINGHOUSE = 2;
/**
 * Poids/min alloués au scan, SOUS le quota IP de 1 200 : la marge (450/min) reste au
 * navigateur, qui interroge api.hyperliquid.xyz depuis la même IP. Elle dépend des
 * indicateurs HL actifs : chaque série `fundingHistory` 90 j (hlFunding, fundingHistHl ;
 * TTL aux 60 s, pages de 500 à 20 + 25 poids) coûte ≈ 208 poids/min, le ticker HL
 * 2 × (20 + 20 par symbole -PERP) par minute. Au-delà, un 429 tronque l'instantané.
 */
export const DEBIT_POIDS_MIN = 750;
/**
 * Écart minimal entre les DÉMARRAGES de deux lots : CONCURRENCE × POIDS × 60 000 / DÉBIT
 * = 640 ms (arrondi au-dessus si la division ne tombe pas juste, pour ne jamais dépasser
 * le débit alloué). 1 500 adresses = 375 lots → ≈ 240 s par scan (< 5 min du collecteur).
 */
export const INTERVALLE_LOT_MS = Math.ceil((CONCURRENCE * POIDS_CLEARINGHOUSE * 60_000) / DEBIT_POIDS_MIN);
/**
 * Abandon précoce : si les LOTS_ECHEC_ABANDON PREMIERS lots échouent TOUS (aucune adresse
 * n'a répondu, hors 429 qui a son propre arrêt), l'amont est en panne — inutile de cadencer
 * 375 lots d'échecs (≈ 240 s, voire ≈ 62 min si chaque requête pend jusqu'à
 * TIMEOUT_ETAT_MS). En DÉBUT de scan seulement : un incident passager au milieu d'un scan
 * sain ne le tronque pas. `clearinghouseState` répond pour toute adresse valide (même
 * vide) : 12 échecs d'affilée signent une panne, pas des comptes particuliers.
 */
export const LOTS_ECHEC_ABANDON = 3;
/**
 * Attente maximale d'une lecture SANS AUCUN cache (premier scan après le boot) : au-delà,
 * 503 « en construction ». Bien sous l'idleTimeout de Bun.serve (index.ts).
 */
export const ATTENTE_FROID_MAX_MS = 15_000;
/** Relance suggérée au client pendant la construction (en-tête Retry-After, secondes). */
export const RELANCE_CONSTRUCTION_S = 30;
/**
 * Après un échec TOTAL (aucun pool, ou 0 adresse scannée) sans aucun cache, une lecture
 * non forcée répond le 503 « pool indisponible » SANS relancer d'essai pendant ce délai
 * (compté depuis le lancement de l'essai raté). 2 min < 4 min du rafraîchissement du
 * front en « erreur » : chaque rafraîchissement suivant relance un essai, sans rafale
 * (bouton Réessayer, plusieurs vues). Le collecteur forcé n'est pas concerné.
 */
export const REPLI_ECHEC_TOTAL_MS = 2 * 60_000;
/** Le leaderboard pèse ≈ 39 Mo : bornage large, seulement contre une réponse aberrante. */
const TAILLE_MAX_LEADERBOARD = 80 * 1024 * 1024;
/** ≈ 31 s mesurées le 2026-09-25 sur la liaison du poste (1,5 Mo/s) : marge ×4. */
const TIMEOUT_LEADERBOARD_MS = 120_000;
const TIMEOUT_ETAT_MS = 10_000;

/** Un niveau de liquidation réel (les champs sont tous scalaires : contrat front). */
export interface NiveauLiqHL {
  /** Prix de liquidation (`liquidationPx`). */
  px: number;
  /** Sens de la position (`szi` > 0 → long). */
  side: "long" | "short";
  /** Valeur notionnelle en $ (`positionValue`). */
  valueUsd: number;
  entryPx: number;
  /** Levier NUMÉRIQUE (`leverage.value`, pas l'objet {type,value}). */
  lev: number;
  addr: string;
}

/** Niveau + son coin (le coin ne figure pas dans NiveauLiqHL : il est la clé d'agrégation). */
export interface PositionLiq {
  coin: string;
  niveau: NiveauLiqHL;
}

/** Instantané des positions du pool, tous coins confondus. */
export interface InstantaneHL {
  /** Horodatage de CONSTRUCTION de l'instantané (pas de la requête). */
  ts: number;
  /** Nombre d'adresses ayant effectivement répondu (les échecs sont ignorés). */
  adressesScannees: number;
  parCoin: Map<string, NiveauLiqHL[]>;
}

/** Horloge du scan (sous-ensemble de HorlogeWs) : `now` mesure la cadence, les minuteurs portent les attentes. */
export type HorlogeScan = Pick<HorlogeWs, "now" | "setTimeout" | "clearTimeout">;

const HORLOGE_REELLE: HorlogeScan = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/** Injections du scan (tests : horloge factice → aucun sommeil réel). */
export interface OptionsScan {
  horloge?: HorlogeScan;
  /** Écart minimal entre démarrages de lots (défaut INTERVALLE_LOT_MS). */
  intervalleLotMs?: number;
}

/** Attente de `ms` sur l'horloge fournie. */
function attendre(horloge: HorlogeScan, ms: number): Promise<void> {
  return new Promise((r) => {
    horloge.setTimeout(r, ms);
  });
}

/**
 * Table `kv` : créée PARESSEUSEMENT par kv.ts (au 1er /kv reçu). Sans daemon
 * jamais sollicité côté KV, un SELECT ici jetterait — on assure donc la table
 * avec le schéma IDENTIQUE (le CREATE de kv.ts reste alors un no-op, et
 * snapshots.ts continue de round-tripper nos lignes).
 */
export function assurerTableKv(d: Database): void {
  d.run(`CREATE TABLE IF NOT EXISTS kv (
      namespace TEXT NOT NULL,
      cle TEXT NOT NULL,
      valeur TEXT NOT NULL,
      majA INTEGER NOT NULL,
      PRIMARY KEY (namespace, cle)
    )`);
}

/** Conversion tolérante des champs numériques HL (chaînes « 6.18756 ») ; null si inexploitable. */
function nombre(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Top N adresses du leaderboard par `accountValue` DÉCROISSANT (la part « valeur » du
 * pool, d'où le défaut N_VALEUR_POOL). Fonction PURE.
 *
 * PIÈGE : `accountValue` est une CHAÎNE — un tri lexicographique classerait "9"
 * devant "10000000". Le tri est donc numérique. Les lignes sans adresse valide ou
 * sans accountValue exploitable sont écartées ; un JSON inattendu renvoie [].
 */
export function extraireTopAdresses(donnees: unknown, n: number = N_VALEUR_POOL): string[] {
  const lignes = (donnees as { leaderboardRows?: unknown } | null)?.leaderboardRows;
  if (!Array.isArray(lignes)) return [];
  const valides: Array<{ addr: string; valeur: number }> = [];
  for (const ligne of lignes) {
    const addr = (ligne as { ethAddress?: unknown } | null)?.ethAddress;
    if (typeof addr !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(addr)) continue;
    const valeur = nombre((ligne as { accountValue?: unknown }).accountValue);
    if (valeur === null) continue;
    valides.push({ addr, valeur });
  }
  valides.sort((a, b) => b.valeur - a.valeur);
  return valides.slice(0, n).map((v) => v.addr);
}

/** Fenêtre `windowPerformances` dont le `vlm` classe le pool complémentaire. */
const FENETRE_VOLUME_POOL = "week";

/**
 * Pool d'adresses à scanner, de taille `tailleCible` au plus : le top `nValeur` par
 * `accountValue` décroissant (les plus gros comptes), puis COMPLÉTÉ par le classement
 * volume hebdomadaire (`windowPerformances` fenêtre « week » → `vlm` décroissant),
 * sans doublon, jusqu'à `tailleCible`. `nValeur > tailleCible` → tronqué à la cible.
 * Leaderboard trop maigre → pool plus petit (jamais de remplissage artificiel).
 * Fonction PURE.
 *
 * POURQUOI le volume : le top accountValue est peu leviérisé (liquidationPx
 * lointain ou null) ; les gros TRADEURS du leaderboard portent des positions
 * liquidables plus près du prix. Mesure du 2026-09-22 : intersection top-150
 * valeur ∩ top-150 volume jour = 19 adresses — le complément est substantiel.
 *
 * `windowPerformances` est un tableau de paires `[nom, {pnl, roi, vlm}]`.
 * Les lignes sans adresse `0x…40 hex` ou sans valeur numérique sont écartées ;
 * un JSON inattendu renvoie [].
 */
export function extrairePool(
  donnees: unknown,
  nValeur: number = N_VALEUR_POOL,
  tailleCible: number = TAILLE_POOL,
): string[] {
  const lignes = (donnees as { leaderboardRows?: unknown } | null)?.leaderboardRows;
  if (!Array.isArray(lignes)) return [];
  const parValeur: Array<{ addr: string; score: number }> = [];
  const parVolume: Array<{ addr: string; score: number }> = [];
  for (const ligne of lignes) {
    const addr = (ligne as { ethAddress?: unknown } | null)?.ethAddress;
    if (typeof addr !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(addr)) continue;
    const valeur = nombre((ligne as { accountValue?: unknown }).accountValue);
    if (valeur !== null) parValeur.push({ addr, score: valeur });
    // fenêtre « week » → vlm (volume), sous-forme de paires [nom, stats].
    const fenetres = (ligne as { windowPerformances?: unknown }).windowPerformances;
    if (Array.isArray(fenetres)) {
      const entree = fenetres.find(
        (f): f is [unknown, unknown] => Array.isArray(f) && f[0] === FENETRE_VOLUME_POOL,
      );
      const vlm = nombre((entree?.[1] as { vlm?: unknown } | null | undefined)?.vlm);
      if (vlm !== null) parVolume.push({ addr, score: vlm });
    }
  }
  parValeur.sort((a, b) => b.score - a.score);
  parVolume.sort((a, b) => b.score - a.score);
  const cible = Math.max(0, tailleCible);
  const retenues = new Set<string>();
  const pool: string[] = [];
  for (const { addr } of parValeur.slice(0, Math.max(0, Math.min(nValeur, cible)))) {
    if (retenues.has(addr)) continue;
    retenues.add(addr);
    pool.push(addr);
  }
  for (const { addr } of parVolume) {
    if (pool.length >= cible) break;
    if (retenues.has(addr)) continue;
    retenues.add(addr);
    pool.push(addr);
  }
  return pool;
}

/**
 * Extrait d'un `clearinghouseState` les positions exploitables. Fonction PURE.
 * Filtre (cf. piège amont documenté en tête de fichier) : liquidationPx non-null,
 * fini et > 0 ; positionValue ≥ SEUIL_VALEUR_USD ; szi non nul.
 */
export function parserEtatCompte(etat: unknown, addr: string): PositionLiq[] {
  const positions = (etat as { assetPositions?: unknown } | null)?.assetPositions;
  if (!Array.isArray(positions)) return [];
  const resultat: PositionLiq[] = [];
  for (const entree of positions) {
    const p = (entree as { position?: Record<string, unknown> } | null)?.position;
    if (p === null || typeof p !== "object") continue;
    const coin = p.coin;
    if (typeof coin !== "string" || coin === "") continue;
    const px = nombre(p.liquidationPx);
    if (px === null || px <= 0) continue;
    const valueUsd = nombre(p.positionValue);
    if (valueUsd === null || valueUsd < SEUIL_VALEUR_USD) continue;
    const szi = nombre(p.szi);
    if (szi === null || szi === 0) continue;
    const lev = nombre((p.leverage as { value?: unknown } | null | undefined)?.value);
    resultat.push({
      coin,
      niveau: {
        px,
        side: szi > 0 ? "long" : "short",
        valueUsd,
        entryPx: nombre(p.entryPx) ?? 0,
        lev: lev ?? 0,
        addr,
      },
    });
  }
  return resultat;
}

/** Regroupe les positions par coin (casse EXACTE : HL a des « kPEPE »). Fonction PURE. */
export function agregerParCoin(positions: readonly PositionLiq[]): Map<string, NiveauLiqHL[]> {
  const parCoin = new Map<string, NiveauLiqHL[]>();
  for (const { coin, niveau } of positions) {
    const liste = parCoin.get(coin);
    if (liste === undefined) parCoin.set(coin, [niveau]);
    else liste.push(niveau);
  }
  return parCoin;
}

/** Agrégats long/short d'un coin (fenêtre WHALES : « que font les gros comptes ? »). */
export interface AgregatsPositions {
  longUsd: number;
  shortUsd: number;
  nbLong: number;
  nbShort: number;
}

/** Somme notionnels et compte les positions par côté. Fonction PURE (testée). */
export function agregatsPositions(niveaux: readonly NiveauLiqHL[]): AgregatsPositions {
  const out: AgregatsPositions = { longUsd: 0, shortUsd: 0, nbLong: 0, nbShort: 0 };
  for (const n of niveaux) {
    if (n.side === "long") {
      out.longUsd += n.valueUsd;
      out.nbLong += 1;
    } else {
      out.shortUsd += n.valueUsd;
      out.nbShort += 1;
    }
  }
  return out;
}

/** Les `n` plus grosses positions par notionnel décroissant (l'entrée n'est pas mutée). PURE. */
export function topPositions(niveaux: readonly NiveauLiqHL[], n: number): NiveauLiqHL[] {
  if (!(n >= 1)) return [];
  return [...niveaux].sort((a, b) => b.valueUsd - a.valueUsd).slice(0, n);
}

function entetesAmont(): Record<string, string> {
  return { "user-agent": "axiom-daemon/1.0 (terminal perso)", accept: "application/json" };
}

/**
 * Pool persisté (KV hl/pool). `nValeur`/`tailleCible` = PARAMÈTRES de construction
 * (pas la longueur réelle : un leaderboard maigre ne doit pas forcer un retéléchargement
 * à chaque lecture) ; absents dans l'ancien format `{ adresses, ts }` (pool 150/350).
 */
interface PoolPersiste {
  adresses: string[];
  ts: number;
  nValeur: number | null;
  tailleCible: number | null;
}

function lirePool(d: Database): PoolPersiste | null {
  const ligne = d
    .query("SELECT valeur FROM kv WHERE namespace = ? AND cle = ?")
    .get("hl", "pool") as { valeur: string } | null;
  if (ligne === null) return null;
  try {
    const v = JSON.parse(ligne.valeur) as Partial<Record<keyof PoolPersiste, unknown>>;
    if (!Array.isArray(v.adresses) || v.adresses.length === 0 || typeof v.ts !== "number") return null;
    return {
      adresses: v.adresses as string[],
      ts: v.ts,
      nValeur: typeof v.nValeur === "number" ? v.nValeur : null,
      tailleCible: typeof v.tailleCible === "number" ? v.tailleCible : null,
    };
  } catch {
    return null; // ligne corrompue : traitée comme absente
  }
}

function ecrirePool(d: Database, adresses: readonly string[], ts: number): void {
  d.query("INSERT OR REPLACE INTO kv (namespace, cle, valeur, majA) VALUES (?, ?, ?, ?)").run(
    "hl",
    "pool",
    JSON.stringify({ adresses, ts, nValeur: N_VALEUR_POOL, tailleCible: TAILLE_POOL }),
    ts,
  );
}

/** Pool persisté utilisable SANS retéléchargement : mêmes paramètres ET moins de 6 h. PURE. */
function poolFrais(p: PoolPersiste, now: number): boolean {
  return p.nValeur === N_VALEUR_POOL && p.tailleCible === TAILLE_POOL && now - p.ts < TTL_POOL_MS;
}

/**
 * Pool d'adresses à scanner. Sert le pool persisté tant qu'il est frais (mêmes
 * paramètres, moins de 6 h) ; sinon retélécharge le leaderboard. Amont KO → repli
 * sur le pool persisté MÊME PÉRIMÉ ou construit avec d'autres paramètres (ancien
 * format compris) ; aucun pool disponible → tableau vide (l'appelant répond 503).
 */
export async function chargerPool(
  d: Database,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<string[]> {
  assurerTableKv(d);
  const persiste = lirePool(d);
  if (persiste !== null && poolFrais(persiste, now)) return persiste.adresses;
  try {
    const res = await fetchImpl(URL_LEADERBOARD, {
      headers: entetesAmont(),
      signal: AbortSignal.timeout(TIMEOUT_LEADERBOARD_MS),
    });
    if (!res.ok) throw new Error(`leaderboard HTTP ${res.status}`);
    // Pré-bornage sur l'en-tête avant lecture du corps (le corps NORMAL fait ≈ 39 Mo).
    const cl = res.headers.get("content-length");
    if (cl !== null && Number(cl) > TAILLE_MAX_LEADERBOARD) throw new Error("leaderboard trop volumineux");
    const texte = await res.text();
    if (texte.length > TAILLE_MAX_LEADERBOARD) throw new Error("leaderboard trop volumineux");
    const adresses = extrairePool(JSON.parse(texte));
    // Réponse vide/inattendue : ne JAMAIS écraser un bon pool persisté.
    if (adresses.length === 0) throw new Error("leaderboard sans ligne exploitable");
    ecrirePool(d, adresses, now);
    return adresses;
  } catch {
    return persiste?.adresses ?? [];
  }
}

/** Résultat d'un `clearinghouseState` : positions, échec isolé, ou limite de quota. */
interface ResultatEtat {
  /** Positions extraites ; null si l'appel a échoué (adresse ignorée). */
  positions: PositionLiq[] | null;
  /** true si l'amont a répondu HTTP 429 (quota) — l'instantané doit s'arrêter là. */
  limite: boolean;
}

/**
 * Interroge `clearinghouseState` pour une adresse. Un HTTP 429 est distingué des
 * autres échecs (`limite`) : il signale que le quota est atteint et que continuer
 * les lots suivants ne produirait que des erreurs.
 */
async function etatCompte(addr: string, fetchImpl: typeof fetch): Promise<ResultatEtat> {
  try {
    const res = await fetchImpl(URL_INFO, {
      method: "POST",
      headers: { ...entetesAmont(), "content-type": "application/json" },
      body: JSON.stringify({ type: "clearinghouseState", user: addr }),
      signal: AbortSignal.timeout(TIMEOUT_ETAT_MS),
    });
    if (res.status === 429) return { positions: null, limite: true };
    if (!res.ok) return { positions: null, limite: false };
    return { positions: parserEtatCompte(await res.json(), addr), limite: false };
  } catch {
    return { positions: null, limite: false }; // échec d'UNE adresse : ignorée, jamais d'échec global
  }
}

/**
 * Construit l'instantané des positions du pool : lots de CONCURRENCE requêtes en
 * vol ; chaque lot démarre au plus tôt `intervalleLotMs` (INTERVALLE_LOT_MS) après
 * le DÉMARRAGE du précédent — la durée du lot est déduite de l'attente, aucune
 * attente après le dernier lot. Débit résultant ≤ DEBIT_POIDS_MIN poids/min.
 * Une adresse en échec est simplement ignorée et ne compte pas dans
 * `adressesScannees`. Un 429 amont interrompt le reste de l'instantané : les lots
 * non envoyés ne sont PAS lancés (les adresses restantes ne comptent pas). Idem si
 * les LOTS_ECHEC_ABANDON premiers lots échouent tous (amont en panne).
 */
export async function construireInstantane(
  adresses: readonly string[],
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
  options: OptionsScan = {},
): Promise<InstantaneHL> {
  const horloge = options.horloge ?? HORLOGE_REELLE;
  const intervalle = options.intervalleLotMs ?? INTERVALLE_LOT_MS;
  const debut = horloge.now(); // horloge réelle (≠ `now`, horodatage logique de l'instantané)
  const positions: PositionLiq[] = [];
  let adressesScannees = 0;
  let limite429 = false;
  let abandon = false;
  for (let i = 0; i < adresses.length; i += CONCURRENCE) {
    const debutLot = horloge.now();
    const lot = adresses.slice(i, i + CONCURRENCE);
    const resultats = await Promise.all(lot.map((a) => etatCompte(a, fetchImpl)));
    for (const r of resultats) {
      if (r.limite) {
        limite429 = true;
        continue;
      }
      if (r.positions === null) continue;
      adressesScannees += 1;
      positions.push(...r.positions);
    }
    if (limite429) break; // quota atteint : on n'envoie plus les lots restants
    const resteDesLots = i + CONCURRENCE < adresses.length;
    // Amont en panne dès le début (réseau, 5xx, délais) : on n'envoie plus rien.
    if (resteDesLots && adressesScannees === 0 && i / CONCURRENCE + 1 >= LOTS_ECHEC_ABANDON) {
      abandon = true;
      break;
    }
    const reste = debutLot + intervalle - horloge.now();
    if (resteDesLots && reste > 0) await attendre(horloge, reste);
  }
  // Durée réelle du scan (≈ 240 s attendues pour 1 500 adresses) : une ligne de log
  // par instantané construit, pour vérifier la cadence en service.
  const dureeS = Math.max(0, (horloge.now() - debut) / 1000);
  console.log(
    `[axiomd] instantané HL : ${adressesScannees} adresses en ${dureeS.toFixed(1)} s` +
      (limite429 ? " (interrompu sur 429)" : "") +
      (abandon ? " (abandonné : amont en échec)" : ""),
  );
  return { ts: now, adressesScannees, parCoin: agregerParCoin(positions) };
}

// ————— Cache mémoire de l'instantané (partagé par TOUS les coins) —————

let cacheInstantane: InstantaneHL | null = null;
/** Acquisition neuve mutualisée ; JAMAIS un repli vers le cache destiné à l'UI. */
let instantaneEnVol: Promise<InstantaneHL | null> | null = null;
/**
 * Génération du cache : une construction lancée AVANT reinitialiserHl (tests) n'écrit
 * pas le cache à sa fin — une lecture servie « en arrière-plan » ne pollue pas la suite.
 */
let generationCache = 0;
/**
 * Horodatage (logique : `now` de son lancement) de la dernière construction TERMINÉE en
 * échec total (aucun pool, ou 0 adresse scannée), effacé au premier succès. Sans aucun
 * cache, c'est la dernière issue connue : les lectures répondent « pool indisponible »,
 * plus jamais « en construction » (le front passerait sinon d'un essai raté au suivant
 * sans voir l'échec — scan en panne, ou leaderboard qui pend au-delà de 15 s).
 */
let echecTotalTs: number | null = null;

/** Aucun cache ET le dernier scan terminé a échoué totalement. */
function echecTotalSansCache(): boolean {
  return cacheInstantane === null && echecTotalTs !== null;
}

/** Réinitialise le cache mémoire (utilisé par les tests ; cf. reinitialiserTelegram de notify.ts). */
export function reinitialiserHl(): void {
  cacheInstantane = null;
  instantaneEnVol = null;
  echecTotalTs = null;
  generationCache += 1;
}

/**
 * Instantané frais (< 5 min) ou reconstruit ; en panne, le cache antérieur reste
 * disponible pour l'UI avec son horodatage d'origine. `options.forcer` exige une
 * acquisition neuve (null en panne), mais rejoint une construction déjà en vol
 * — utilisé par le collecteur hlLiqHeat, qui ne doit JAMAIS archiver le repli UI.
 *
 * Lecture NON forcée : dès qu'un cache existe (même PÉRIMÉ), il est servi TOUT DE
 * SUITE — un scan de ~1 500 adresses dure ≈ 240 s, au-delà de l'idleTimeout de
 * Bun.serve ; la construction (lancée si aucune n'est en vol) le remplace en
 * arrière-plan. Sans AUCUN cache, la promesse rendue est celle de la construction :
 * c'est traiterHl qui borne cette attente (ATTENTE_FROID_MAX_MS → 503 « en
 * construction »). `options.horloge`/`intervalleLotMs` ne servent qu'aux tests.
 *
 * Sans cache après un échec TOTAL (cf. echecTotalTs) : null tout de suite (503 « pool
 * indisponible ») tant qu'une relance est en vol ou que REPLI_ECHEC_TOTAL_MS n'est pas
 * écoulé — pas de scan relancé à chaque lecture contre un amont en panne ; ensuite, la
 * lecture relance un essai (dont l'éventuel délai expiré répond encore « pool »).
 */
export function obtenirInstantane(
  d: Database,
  fetchImpl: typeof fetch,
  now: number,
  options?: { forcer?: boolean } & OptionsScan,
): Promise<InstantaneHL | null> {
  const forcer = options?.forcer === true;
  if (!forcer && cacheInstantane !== null && now - cacheInstantane.ts < TTL_INSTANTANE_MS) {
    return Promise.resolve(cacheInstantane);
  }
  if (
    !forcer &&
    cacheInstantane === null &&
    echecTotalTs !== null &&
    (instantaneEnVol !== null || now - echecTotalTs < REPLI_ECHEC_TOTAL_MS)
  ) {
    return Promise.resolve(null);
  }
  // Une construction est déjà en vol : on s'y raccroche (deux fenêtres ouvrant BTC
  // et ETH en même temps ne doivent pas lancer 2 scans complets du pool). Sauf si un
  // cache (même PÉRIMÉ) existe : une lecture le sert immédiatement (la construction
  // en vol le remplacera). `forcer` (collecteur heatmap) ignore ce repli : il VEUT
  // un point neuf.
  if (instantaneEnVol !== null) {
    if (!forcer && cacheInstantane !== null) {
      return Promise.resolve(cacheInstantane);
    }
    return instantaneEnVol;
  }
  const generation = generationCache;
  const p: Promise<InstantaneHL | null> = (async (): Promise<InstantaneHL | null> => {
    const adresses = await chargerPool(d, fetchImpl, now);
    const inst = adresses.length === 0 ? null : await construireInstantane(adresses, fetchImpl, now, options);
    // Échec amont TOTAL (aucun pool, ou 0 adresse scannée) : aucune observation neuve.
    // Le repli UI est appliqué APRÈS cette promesse partagée, sinon un collecteur qui la
    // rejoint recevrait l'ancien cache comme s'il venait d'être acquis. L'échec est
    // RETENU (cf. echecTotalTs) ; le premier succès l'efface.
    const reussi = inst !== null && inst.adressesScannees > 0;
    if (generation === generationCache) {
      if (reussi) cacheInstantane = inst;
      echecTotalTs = reussi ? null : now;
    }
    return reussi ? inst : null;
  })().finally(() => {
    // Libérer AVANT de rendre le résultat : un appel forcé suivant ne doit pas
    // rejoindre une promesse déjà terminée qui n'a pas encore été nettoyée.
    if (instantaneEnVol === p) instantaneEnVol = null;
  });
  // Une construction peut finir sans personne pour l'attendre (lecture servie par le
  // cache périmé, ou partie en 503) : son éventuel rejet ne doit pas rester non géré.
  p.catch(() => undefined);
  instantaneEnVol = p;
  if (forcer) return p;
  if (cacheInstantane !== null) return Promise.resolve(cacheInstantane); // périmé servi, scan en fond
  return p.then((inst) => inst ?? cacheInstantane);
}

/** Issue d'une attente bornée : le délai a expiré avant la promesse. */
const DELAI_EXPIRE: unique symbol = Symbol("délai expiré");

/**
 * Attend `p` au plus `ms` : au-delà, résout DELAI_EXPIRE — `p` CONTINUE en
 * arrière-plan. Le minuteur est annulé dès que l'une des deux issues est acquise.
 */
function auPlus<T>(p: Promise<T>, ms: number, horloge: HorlogeScan): Promise<T | typeof DELAI_EXPIRE> {
  let minuteur: unknown;
  const delai = new Promise<typeof DELAI_EXPIRE>((r) => {
    minuteur = horloge.setTimeout(() => r(DELAI_EXPIRE), ms);
  });
  return Promise.race([p, delai]).finally(() => horloge.clearTimeout(minuteur));
}

/** Réponse JSON avec en-têtes CORS (même pattern que kv.ts/globe.ts). */
function json(corps: unknown, req: Request, status = 200, entetes: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...entetesCors(req), ...entetes },
  });
}

/** Cap de positions renvoyées par /hl/positions/:coin (les plus grosses d'abord). */
export const MAX_POSITIONS = 100;

/**
 * Gestionnaire de `GET /hl/liqlevels/:coin` et `GET /hl/positions/:coin` (MÊME
 * instantané amont, cache 5 min partagé — la 2e route ne coûte AUCUN appel HL de
 * plus). Gardes AVANT tout accès base/réseau. `dInjecte`/`now`/`fetchImpl`/`options`
 * permettent aux tests d'injecter (convention globe.ts).
 *
 * Deux 503 DISTINCTS : « pool d'adresses indisponible » (amont KO sans pool persisté,
 * ou échec total du scan — retenu tant qu'aucun scan n'a réussi, relance comprise) et,
 * sans aucun cache ni échec connu, scan non terminé après ATTENTE_FROID_MAX_MS →
 * `{ erreur, enConstruction: true }` + `Retry-After: RELANCE_CONSTRUCTION_S` (le scan
 * continue en arrière-plan et remplira le cache) — donc seulement pendant le PREMIER
 * scan depuis le démarrage.
 *
 * LIMITE ASSUMÉE de /positions : l'instantané ne retient que les positions à
 * `liquidationPx` exploitable (cf. parserEtatCompte) — les positions cross très
 * collatéralisées en sont absentes. Étiqueté « échantillon » côté UI.
 */
export async function traiterHl(
  req: Request,
  url: URL,
  dInjecte?: Database,
  now?: number,
  fetchImpl: typeof fetch = fetch,
  options: OptionsScan = {},
): Promise<Response> {
  if (req.method !== "GET") return json({ erreur: "méthode non autorisée" }, req, 405);
  const segments = url.pathname.split("/").filter((s) => s.length > 0);
  // segments[0] === "hl" (garanti par le préfixe de route)
  const vue = segments[1];
  if (vue !== "liqlevels" && vue !== "positions" && vue !== "liqheat") {
    return json({ erreur: "chemin inconnu" }, req, 404);
  }
  if (vue === "liqheat") {
    // Historique des instantanés collectés (collecteur opt-in hlLiqHeat) —
    // lecture de table locale uniquement, AUCUN appel amont.
    try {
      const d = dInjecte ?? getDb();
      return traiterHlHeat(req, url, d, now);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return json({ erreur: "erreur interne hl", detail }, req, 500);
    }
  }
  if (segments.length !== 3) return json({ erreur: "coin requis" }, req, 400);
  let coin: string;
  try {
    coin = decodeURIComponent(segments[2] as string);
  } catch {
    coin = segments[2] as string;
  }
  const maintenant = now ?? Date.now();
  try {
    // getDb() DANS le try : un échec d'ouverture disque doit répondre 500, pas
    // remonter en throw nu vers Bun.serve.
    const d = dInjecte ?? getDb();
    const inst = await auPlus(
      obtenirInstantane(d, fetchImpl, maintenant, options),
      ATTENTE_FROID_MAX_MS,
      options.horloge ?? HORLOGE_REELLE,
    );
    if (inst === DELAI_EXPIRE) {
      // Relance après un échec total : la dernière issue connue reste l'échec — jamais
      // « en construction », qui laisserait le front en attente d'un scan raté au suivant.
      if (echecTotalSansCache()) return json({ erreur: "pool d'adresses Hyperliquid indisponible" }, req, 503);
      return json({ erreur: "instantané Hyperliquid en construction", enConstruction: true }, req, 503, {
        "retry-after": String(RELANCE_CONSTRUCTION_S),
      });
    }
    if (inst === null) {
      return json({ erreur: "pool d'adresses Hyperliquid indisponible" }, req, 503);
    }
    const niveaux = inst.parCoin.get(coin) ?? [];
    if (vue === "positions") {
      return json(
        {
          ts: inst.ts,
          coin,
          adressesScannees: inst.adressesScannees,
          agregats: agregatsPositions(niveaux),
          positions: topPositions(niveaux, MAX_POSITIONS),
        },
        req,
      );
    }
    return json({ ts: inst.ts, coin, adressesScannees: inst.adressesScannees, niveaux }, req);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return json({ erreur: "erreur interne hl", detail }, req, 500);
  }
}

/** Enregistre le préfixe /hl (modèle enregistrerGlobe). */
export function enregistrerHl(routeur: Routeur): void {
  routeur.enregistrerPrefixe("/hl", (req, url) => traiterHl(req, url));
}
