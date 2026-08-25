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
 *  - Pool d'adresses : GET stats-data.hyperliquid.xyz/Mainnet/leaderboard (34 Mo,
 *    ~2 s). Téléchargé AU PLUS 1×/6 h, PARESSEUSEMENT (au premier besoin, jamais
 *    au boot du daemon), top 150 par accountValue persisté dans la table `kv`
 *    (namespace « hl », clé « pool »). Amont KO → on réutilise le pool persisté
 *    même périmé ; rien de persisté → 503 propre.
 *  - Instantané des positions : POST api.hyperliquid.xyz/info
 *    { type: "clearinghouseState", user } par adresse, concurrence ≤ 8 + micro-pause
 *    entre lots (quota HL ~1200 weight/min/IP, clearinghouseState ≈ 2). UN SEUL
 *    instantané couvre TOUS les coins → cache mémoire 5 min : /hl/liqlevels/ETH
 *    juste après /BTC ne déclenche aucun appel amont.
 *
 * PIÈGE amont (vérifié) : en marge croisée, `liquidationPx` peut être `null`
 * (compte bien collatéralisé) ou ABERRANT (short BNB de 12 $ « liquidable » à
 * 53 899 700 $). On renvoie les niveaux BRUTS mais on filtre l'évident :
 * liquidationPx non-null, fini, > 0, et positionValue ≥ 1000 $.
 *
 * INVARIANT (BUILD-CONTRACT) : stockage/service à froid — jamais sur le chemin
 * chaud du renderer. Aucune boucle de fond : tout est déclenché par la requête.
 */
import { Database } from "bun:sqlite";
import { entetesCors } from "./cors";
import { getDb } from "./db";
import type { Routeur } from "./router";

export const URL_LEADERBOARD = "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard";
export const URL_INFO = "https://api.hyperliquid.xyz/info";

/** Taille du pool d'adresses échantillonné (top N par accountValue). */
export const TAILLE_POOL = 150;
/** Fraîcheur du pool d'adresses : au plus un téléchargement des 34 Mo / 6 h. */
export const TTL_POOL_MS = 6 * 3_600_000;
/** Fraîcheur de l'instantané des positions (tous coins confondus). */
export const TTL_INSTANTANE_MS = 5 * 60_000;
/** Plancher de valeur notionnelle : sous ce seuil, un liquidationPx est du bruit. */
export const SEUIL_VALEUR_USD = 1000;

/** Requêtes `clearinghouseState` en vol simultanément (quota HL ~1200 weight/min). */
const CONCURRENCE = 8;
/** Micro-pause entre deux lots (lissage du quota). */
const PAUSE_LOT_MS = 50;
/** Le leaderboard pèse 34 Mo : bornage large, seulement contre une réponse aberrante. */
const TAILLE_MAX_LEADERBOARD = 80 * 1024 * 1024;
const TIMEOUT_LEADERBOARD_MS = 60_000;
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
 * Top N adresses du leaderboard par `accountValue` DÉCROISSANT. Fonction PURE.
 *
 * PIÈGE : `accountValue` est une CHAÎNE — un tri lexicographique classerait "9"
 * devant "10000000". Le tri est donc numérique. Les lignes sans adresse valide ou
 * sans accountValue exploitable sont écartées ; un JSON inattendu renvoie [].
 */
export function extraireTopAdresses(donnees: unknown, n: number = TAILLE_POOL): string[] {
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

interface PoolPersiste {
  adresses: string[];
  ts: number;
}

function lirePool(d: Database): PoolPersiste | null {
  const ligne = d
    .query("SELECT valeur FROM kv WHERE namespace = ? AND cle = ?")
    .get("hl", "pool") as { valeur: string } | null;
  if (ligne === null) return null;
  try {
    const v = JSON.parse(ligne.valeur) as Partial<PoolPersiste>;
    if (!Array.isArray(v.adresses) || v.adresses.length === 0 || typeof v.ts !== "number") return null;
    return { adresses: v.adresses, ts: v.ts };
  } catch {
    return null; // ligne corrompue : traitée comme absente
  }
}

function ecrirePool(d: Database, adresses: readonly string[], ts: number): void {
  d.query("INSERT OR REPLACE INTO kv (namespace, cle, valeur, majA) VALUES (?, ?, ?, ?)").run(
    "hl",
    "pool",
    JSON.stringify({ adresses, ts }),
    ts,
  );
}

/**
 * Pool d'adresses à scanner. Sert le pool persisté tant qu'il a moins de 6 h ;
 * sinon retélécharge le leaderboard. Amont KO → repli sur le pool persisté MÊME
 * PÉRIMÉ ; aucun pool disponible → tableau vide (l'appelant répond 503).
 */
export async function chargerPool(
  d: Database,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<string[]> {
  assurerTableKv(d);
  const persiste = lirePool(d);
  if (persiste !== null && now - persiste.ts < TTL_POOL_MS) return persiste.adresses;
  try {
    const res = await fetchImpl(URL_LEADERBOARD, {
      headers: entetesAmont(),
      signal: AbortSignal.timeout(TIMEOUT_LEADERBOARD_MS),
    });
    if (!res.ok) throw new Error(`leaderboard HTTP ${res.status}`);
    // Pré-bornage sur l'en-tête avant lecture du corps (le corps NORMAL fait 34 Mo).
    const cl = res.headers.get("content-length");
    if (cl !== null && Number(cl) > TAILLE_MAX_LEADERBOARD) throw new Error("leaderboard trop volumineux");
    const texte = await res.text();
    if (texte.length > TAILLE_MAX_LEADERBOARD) throw new Error("leaderboard trop volumineux");
    const adresses = extraireTopAdresses(JSON.parse(texte));
    // Réponse vide/inattendue : ne JAMAIS écraser un bon pool persisté.
    if (adresses.length === 0) throw new Error("leaderboard sans ligne exploitable");
    ecrirePool(d, adresses, now);
    return adresses;
  } catch {
    return persiste?.adresses ?? [];
  }
}

/** Interroge `clearinghouseState` pour une adresse ; null si l'appel échoue. */
async function etatCompte(addr: string, fetchImpl: typeof fetch): Promise<PositionLiq[] | null> {
  try {
    const res = await fetchImpl(URL_INFO, {
      method: "POST",
      headers: { ...entetesAmont(), "content-type": "application/json" },
      body: JSON.stringify({ type: "clearinghouseState", user: addr }),
      signal: AbortSignal.timeout(TIMEOUT_ETAT_MS),
    });
    if (!res.ok) return null;
    return parserEtatCompte(await res.json(), addr);
  } catch {
    return null; // échec d'UNE adresse : ignorée, jamais d'échec global
  }
}

/**
 * Construit l'instantané des positions du pool : lots de CONCURRENCE requêtes en
 * vol, micro-pause entre lots. Une adresse en échec est simplement ignorée et ne
 * compte pas dans `adressesScannees`.
 */
export async function construireInstantane(
  adresses: readonly string[],
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<InstantaneHL> {
  const positions: PositionLiq[] = [];
  let adressesScannees = 0;
  for (let i = 0; i < adresses.length; i += CONCURRENCE) {
    if (i > 0) await new Promise((r) => setTimeout(r, PAUSE_LOT_MS));
    const lot = adresses.slice(i, i + CONCURRENCE);
    const resultats = await Promise.all(lot.map((a) => etatCompte(a, fetchImpl)));
    for (const r of resultats) {
      if (r === null) continue;
      adressesScannees += 1;
      positions.push(...r);
    }
  }
  return { ts: now, adressesScannees, parCoin: agregerParCoin(positions) };
}

// ————— Cache mémoire de l'instantané (partagé par TOUS les coins) —————

let cacheInstantane: InstantaneHL | null = null;
/** Instantané en cours de construction : mutualisé pour éviter la rafale au démarrage à froid. */
let instantaneEnVol: Promise<InstantaneHL | null> | null = null;

/** Réinitialise le cache mémoire (utilisé par les tests ; cf. reinitialiserTelegram de notify.ts). */
export function reinitialiserHl(): void {
  cacheInstantane = null;
  instantaneEnVol = null;
}

/** Instantané frais (< 5 min) ou reconstruit ; `null` si aucun pool n'est disponible. */
function obtenirInstantane(d: Database, fetchImpl: typeof fetch, now: number): Promise<InstantaneHL | null> {
  if (cacheInstantane !== null && now - cacheInstantane.ts < TTL_INSTANTANE_MS) {
    return Promise.resolve(cacheInstantane);
  }
  // Une construction est déjà en vol : on s'y raccroche (deux fenêtres ouvrant BTC
  // et ETH en même temps ne doivent pas lancer 2 × 150 requêtes amont).
  if (instantaneEnVol !== null) return instantaneEnVol;
  const p = (async (): Promise<InstantaneHL | null> => {
    const adresses = await chargerPool(d, fetchImpl, now);
    if (adresses.length === 0) return null;
    const inst = await construireInstantane(adresses, fetchImpl, now);
    cacheInstantane = inst;
    return inst;
  })();
  instantaneEnVol = p;
  void p.then(
    () => {},
    () => {},
  ).finally(() => {
    if (instantaneEnVol === p) instantaneEnVol = null;
  });
  return p;
}

/** Réponse JSON avec en-têtes CORS (même pattern que kv.ts/globe.ts). */
function json(corps: unknown, req: Request, status = 200): Response {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...entetesCors(req) },
  });
}

/** Cap de positions renvoyées par /hl/positions/:coin (les plus grosses d'abord). */
export const MAX_POSITIONS = 100;

/**
 * Gestionnaire de `GET /hl/liqlevels/:coin` et `GET /hl/positions/:coin` (MÊME
 * instantané amont, cache 5 min partagé — la 2e route ne coûte AUCUN appel HL de
 * plus). Gardes AVANT tout accès base/réseau. `dInjecte`/`now`/`fetchImpl`
 * permettent aux tests d'injecter (convention globe.ts).
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
): Promise<Response> {
  if (req.method !== "GET") return json({ erreur: "méthode non autorisée" }, req, 405);
  const segments = url.pathname.split("/").filter((s) => s.length > 0);
  // segments[0] === "hl" (garanti par le préfixe de route)
  const vue = segments[1];
  if (vue !== "liqlevels" && vue !== "positions") return json({ erreur: "chemin inconnu" }, req, 404);
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
    const inst = await obtenirInstantane(d, fetchImpl, maintenant);
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
