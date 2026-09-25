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
 * alloués au scan → ≈ 240 s (mesuré le 2026-09-25 : 1 500 adresses en 240,9 s, aucun
 * 429) ; en moyenne sur le cycle de 5 min du collecteur ≈ 600 poids/min ; 450 poids/min
 * restent au navigateur, qui appelle api.hyperliquid.xyz depuis la MÊME IP — marge qui
 * dépend des indicateurs HL actifs (cf. DEBIT_POIDS_MIN) ; un 429 tronque l'instantané.
 *
 * LECTURES : une lecture (/hl/liqlevels, /hl/positions) n'attend JAMAIS un scan
 * quand un cache existe, même périmé (servi tel quel, reconstruction en arrière-plan) ;
 * sans aucun cache elle attend au plus ATTENTE_FROID_MAX_MS puis répond 503
 * `{ enConstruction: true }` + Retry-After (le scan continue et remplit le cache).
 * Premier scan après un démarrage : ≈ 4 min (≈ 4,5 si le leaderboard est à retélécharger).
 * PANNE AMONT : un scan dont les premiers lots échouent tous — premier lot rejoué UNE fois
 * compris (coupure brève au lancement) — est abandonné (quelques secondes) ; sans cache,
 * l'échec est retenu et les lectures répondent le 503 « pool indisponible » (jamais « en
 * construction » sans fin), avec un repli de REPLI_ECHEC_TOTAL_MS, compté depuis la FIN
 * de l'essai raté, avant qu'une lecture relance un essai.
 *
 * PIÈGE amont (vérifié) : en marge croisée, `liquidationPx` peut être `null`
 * (compte bien collatéralisé) ou ABERRANT (short BNB de 12 $ « liquidable » à
 * 53 899 700 $). On renvoie les niveaux BRUTS mais on filtre l'évident :
 * liquidationPx non-null, fini, > 0, et positionValue ≥ 1000 $.
 *
 * INVARIANT (BUILD-CONTRACT) : stockage/service à froid — jamais sur le chemin
 * chaud du renderer. Aucune boucle sauf le collecteur opt-in de hlLiqHeat.ts
 * (drapeau KV `hl/heat`) ; tout le reste est déclenché par la requête.
 *
 * CODE PARTAGÉ (extension du 25 septembre, mode navigateur sur Vercel) : types, constantes
 * de pool/cadence, extraction du pool, téléchargement borné du leaderboard, parsing des
 * comptes et scan cadencé vivent dans shared/hyperliquidScan.ts — mêmes règles pour le
 * daemon, la fonction Vercel `api/hlpool.ts` et le scanner du navigateur. Ce module garde
 * ce qui dépend de Bun/SQLite (pool persisté `hl/pool`, cache mémoire, routes) et injecte
 * au scan son user-agent et son journal « [axiomd] ».
 */
import { Database } from "bun:sqlite";
import { entetesCors } from "./cors";
import { getDb } from "./db";
import { traiterHlHeat } from "./hlLiqHeat";
import type { Routeur } from "./router";
import {
  construireInstantane as construireInstantanePartage,
  HORLOGE_REELLE,
  N_VALEUR_POOL,
  poolEstFrais,
  TAILLE_POOL,
  telechargerPool,
  TIMEOUT_LEADERBOARD_MS,
  type HorlogeScan,
  type InstantaneHL,
  type NiveauLiqHL,
  type OptionsScan,
} from "../../../shared/hyperliquidScan";

// Scan PARTAGÉ avec la fonction Vercel (api/hlpool.ts) et le scanner navigateur
// (apps/web/src/data/hyperliquidLiqNavigateur.ts) : RÉEXPORTÉ ici pour que les importeurs
// du daemon (hlLiqHeat, whales, tests) gardent leur chemin « ./hyperliquid ».
export {
  agregerParCoin,
  CONCURRENCE,
  DEBIT_POIDS_MIN,
  extrairePool,
  extraireTopAdresses,
  INTERVALLE_LOT_MS,
  LOTS_ECHEC_ABANDON,
  N_VALEUR_POOL,
  parserEtatCompte,
  POIDS_CLEARINGHOUSE,
  SEUIL_VALEUR_USD,
  TAILLE_POOL,
  TIMEOUT_LEADERBOARD_MS,
  TTL_POOL_MS,
  URL_INFO,
  URL_LEADERBOARD,
  type HorlogeScan,
  type InstantaneHL,
  type NiveauLiqHL,
  type OptionsScan,
  type PositionLiq,
} from "../../../shared/hyperliquidScan";

/** Fraîcheur de l'instantané des positions (tous coins confondus). */
export const TTL_INSTANTANE_MS = 5 * 60_000;
/**
 * Attente maximale d'une lecture SANS AUCUN cache (premier scan après le boot) : au-delà,
 * 503 « en construction ». Bien sous l'idleTimeout de Bun.serve (index.ts).
 */
export const ATTENTE_FROID_MAX_MS = 15_000;
/** Relance suggérée au client pendant la construction (en-tête Retry-After, secondes). */
export const RELANCE_CONSTRUCTION_S = 30;
/**
 * Après un échec TOTAL (aucun pool, ou 0 adresse scannée) sans aucun cache, une lecture
 * non forcée répond le 503 « pool indisponible » SANS relancer d'essai pendant ce délai,
 * compté depuis la FIN de l'essai raté (cf. echecTotalTs : un essai de 120 s ne consomme
 * pas le repli). 2 min < 4 min du rafraîchissement du front en « erreur » : chaque
 * rafraîchissement suivant relance un essai, sans rafale (bouton Réessayer, plusieurs
 * vues). Le collecteur forcé n'est pas concerné.
 */
export const REPLI_ECHEC_TOTAL_MS = 2 * 60_000;

/** User-agent des appels amont du daemon (en-tête interdit au navigateur : injecté). */
const ENTETES_DAEMON: Readonly<Record<string, string>> = { "user-agent": "axiom-daemon/1.0 (terminal perso)" };

/** Ligne de fin de scan dans le journal du daemon (préfixe historique « [axiomd] »). */
function journalDaemon(ligne: string): void {
  console.log(`[axiomd] ${ligne}`);
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

/**
 * Pool d'adresses à scanner. Sert le pool persisté tant qu'il est frais (mêmes
 * paramètres, moins de 6 h — `poolEstFrais`, règle partagée avec le navigateur) ; sinon
 * retélécharge le leaderboard (`telechargerPool`, partagé). Amont KO → repli
 * sur le pool persisté MÊME PÉRIMÉ ou construit avec d'autres paramètres (ancien
 * format compris) ; aucun pool disponible → tableau vide (l'appelant répond 503).
 * Échec de PERSISTANCE (SQLite : disque plein, verrou) → journalisé, et le pool
 * fraîchement téléchargé est quand même rendu (≈ 39 Mo / ≈ 31 s jamais jetés : sans
 * pool persisté, ce serait sinon un échec total retenu).
 */
export async function chargerPool(
  d: Database,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<string[]> {
  assurerTableKv(d);
  const persiste = lirePool(d);
  if (persiste !== null && poolEstFrais(persiste, now)) return persiste.adresses;
  let adresses: string[];
  try {
    // Réponse vide/inattendue → rejet : ne JAMAIS écraser un bon pool persisté.
    adresses = await telechargerPool(fetchImpl, {
      entetes: ENTETES_DAEMON,
      signal: AbortSignal.timeout(TIMEOUT_LEADERBOARD_MS),
    });
  } catch {
    return persiste?.adresses ?? [];
  }
  // Persistance ISOLÉE : son échec ne fait pas retomber sur le repli (voire sur rien).
  try {
    ecrirePool(d, adresses, now);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[axiomd] pool HL non persisté (servi quand même) : ${detail}`);
  }
  return adresses;
}

/**
 * Scan du pool (shared/hyperliquidScan.ts) avec les injections du daemon : user-agent
 * `axiom-daemon` et journal préfixé « [axiomd] » (ligne de durée lue en service). Les
 * options de l'appelant priment (tests : horloge factice, intervalle).
 */
export function construireInstantane(
  adresses: readonly string[],
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
  options: OptionsScan = {},
): Promise<InstantaneHL> {
  return construireInstantanePartage(adresses, fetchImpl, now, {
    journal: journalDaemon,
    entetes: ENTETES_DAEMON,
    ...options,
  });
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
 * Horodatage de FIN (logique : `now` du lancement + durée réelle de l'essai, mesurée sur
 * l'horloge injectable) de la dernière construction TERMINÉE en échec total (aucun pool,
 * ou 0 adresse scannée), effacé au premier succès. Horodaté au lancement, un essai long
 * (leaderboard qui pend jusqu'à TIMEOUT_LEADERBOARD_MS = 120 s, requêtes de compte qui
 * pendent) consommerait tout REPLI_ECHEC_TOTAL_MS et la lecture suivante relancerait
 * aussitôt ≈ 39 Mo de téléchargement. Sans aucun cache, c'est la dernière issue connue :
 * les lectures répondent « pool indisponible », plus jamais « en construction » (le front
 * passerait sinon d'un essai raté au suivant sans voir l'échec — scan en panne, ou
 * leaderboard qui pend au-delà de 15 s).
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
 * écoulé depuis la FIN de l'essai raté — pas de scan relancé à chaque lecture contre un
 * amont en panne ; ensuite, la lecture relance un essai (dont l'éventuel délai expiré
 * répond encore « pool »).
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
  const horloge = options?.horloge ?? HORLOGE_REELLE;
  const p: Promise<InstantaneHL | null> = (async (): Promise<InstantaneHL | null> => {
    const debutEssai = horloge.now(); // horloge (réelle en service) : durée de l'essai, cf. dureeS du scan
    const adresses = await chargerPool(d, fetchImpl, now);
    const inst = adresses.length === 0 ? null : await construireInstantane(adresses, fetchImpl, now, options);
    // Échec amont TOTAL (aucun pool, ou 0 adresse scannée) : aucune observation neuve.
    // Le repli UI est appliqué APRÈS cette promesse partagée, sinon un collecteur qui la
    // rejoint recevrait l'ancien cache comme s'il venait d'être acquis. L'échec est
    // RETENU (cf. echecTotalTs) à sa FIN, en temps logique : `now` + durée réelle de
    // l'essai ; le premier succès l'efface.
    const reussi = inst !== null && inst.adressesScannees > 0;
    if (generation === generationCache) {
      if (reussi) cacheInstantane = inst;
      echecTotalTs = reussi ? null : now + Math.max(0, horloge.now() - debutEssai);
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
