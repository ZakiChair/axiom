/**
 * CAP — reconstruction de la capitalisation totale du marché crypto et des dominances.
 *
 * ─── POURQUOI RECONSTRUIRE (mesures faites le 2026-07-29, sans clé) ────────────────
 * CoinGecko réserve l'AGRÉGAT historique au tier Pro, mais laisse l'historique PAR
 * PIÈCE ouvert. Constaté par requête directe :
 *
 *   GET /global/market_cap_chart?days=90        → 401  error_code 10005 (« PRO API »)
 *   GET /coins/bitcoin/market_chart?days=365
 *       &vs_currency=usd&interval=daily         → 200  366 points de market_caps
 *   même requête avec days=max                  → 401  error_code 10012
 *                                                 (« limited to … the past 365 days »)
 *   15 appels enchaînés sans délai              → 429 dès le 6ᵉ
 *   GET /coins/markets?per_page=250             → 200  250 capitalisations courantes
 *
 * D'où la stratégie : TOTAL = SOMME du top 100, RECALIBRÉE sur `/global`. Couverture
 * mesurée le même jour : top 10 = 88,9 %, top 25 = 93,3 %, **top 100 = 97,8 %**,
 * top 250 = 99,1 %. Le reliquat de la longue traîne est absorbé par le facteur
 * `k = total_global / somme_top100` (1,0228 ce jour-là).
 *
 * ⚠️ LIMITES ASSUMÉES :
 *   - 365 jours maximum en gratuit — aucun contournement sans plan Pro.
 *   - `k` est un facteur CONSTANT : il corrige le niveau, pas la dérive de la part de
 *     la longue traîne au fil de l'année. L'erreur croît en remontant le temps.
 *   - Les fournisseurs divergent : CoinPaprika annonçait 56,15 % de dominance BTC
 *     quand CoinGecko annonçait 56,62 % au même instant. Un demi-point d'écart
 *     méthodologique est le plancher de précision, reconstruction ou pas.
 * ──────────────────────────────────────────────────────────────────────────────────
 *
 * Ce module est SANS ÉTAT : fonctions pures + deux fetchers. Le cadencement des
 * appels (AIMD, repli sur 429) et la persistance vivent dans `store/mcap.ts` ; ici,
 * un 429 est simplement remonté typé (`ErreurCoinGecko`) pour que l'appelant décide.
 */
import {
  CG_BASE,
  parseGlobal,
  parseMarkets,
  withDemoKey,
  type CoinTile,
  type MarketGlobal,
} from "./marketOverview";

/** Une journée en millisecondes. */
export const JOUR_MS = 86_400_000;

/** Un point journalier : capitalisation en USD au minuit UTC `t`. */
export interface PointJour {
  /** Minuit UTC (ms epoch) du jour mesuré. */
  t: number;
  /** Capitalisation en USD absolus. */
  v: number;
}

export type SerieJour = PointJour[];

/** Erreur HTTP CoinGecko typée : l'appelant a besoin du statut (429) et du délai. */
export class ErreurCoinGecko extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfter: number | null
  ) {
    super(message);
    this.name = "ErreurCoinGecko";
  }
}

// ─────────────────────────── Fonctions pures ───────────────────────────

/** Minuit UTC du jour contenant `ms`. */
export function minuitUtc(ms: number): number {
  return Math.floor(ms / JOUR_MS) * JOUR_MS;
}

/**
 * Normalise `[[tMs, mcap], …]` en série journalière : chaque timestamp est ramené au
 * minuit UTC de son jour, les doublons de jour sont réduits au DERNIER point, l'ordre
 * est croissant et les valeurs non finies sont écartées.
 *
 * Indispensable : `days=365&interval=daily` renvoie 365 minuits PLUS un point à
 * l'heure courante. Sans ce dédoublonnage, le jour courant compterait deux fois et
 * les pièces ne s'aligneraient pas entre elles.
 */
export function grilleJournaliere(brut: ReadonlyArray<readonly [number, number]>): SerieJour {
  const parJour = new Map<number, number>();
  for (const point of brut) {
    const t = point[0];
    const v = point[1];
    if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
    parJour.set(minuitUtc(t), v); // le dernier point du jour écrase les précédents
  }
  return [...parJour.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, v]) => ({ t, v }));
}

/**
 * Projette une série de pièce sur `grille` : forward-fill de la dernière valeur connue
 * à l'intérieur de la plage cotée, **0 avant son premier point**.
 *
 * Le 0 n'est pas un repli mais la valeur EXACTE : une pièce listée en cours d'année
 * n'avait aucune capitalisation avant sa cotation, et c'est ce qu'une somme doit voir.
 * Un trou ponctuel, lui, est comblé par la dernière valeur connue (jamais par 0, qui
 * creuserait un faux effondrement dans le TOTAL).
 */
export function alignerSurGrille(serie: SerieJour, grille: readonly number[]): number[] {
  const sortie: number[] = [];
  let i = 0;
  let courant = 0; // avant le premier point coté
  for (const jour of grille) {
    while (i < serie.length) {
      const p = serie[i];
      if (p === undefined || p.t > jour) break;
      courant = p.v;
      i += 1;
    }
    sortie.push(courant);
  }
  return sortie;
}

/** Résultat de la reconstruction : série recalibrée + facteur appliqué. */
export interface TotalReconstruit {
  /** TOTAL en USD, aligné sur la grille, APRÈS recalibrage. */
  total: number[];
  /** Facteur appliqué (1 si le recalibrage n'a pas pu être calculé). */
  k: number;
  /** false = le total affiché est la somme brute du panier (couverture partielle assumée). */
  recalibre: boolean;
}

/**
 * Somme le panier colonne par colonne puis applique
 * `k = totalGlobalCourant / somme[dernier]` à TOUTE la série.
 *
 * `k` n'est calculé que si la somme finale ET le total global sont strictement
 * positifs ; sinon `k = 1` et `recalibre = false` — mieux vaut une série brute
 * honnêtement étiquetée qu'un facteur inventé.
 */
export function reconstruireTotal(
  alignees: ReadonlyArray<readonly number[]>,
  totalGlobalCourant: number
): TotalReconstruit {
  const longueur = alignees.reduce((max, s) => Math.max(max, s.length), 0);
  if (longueur === 0) return { total: [], k: 1, recalibre: false };

  const somme: number[] = new Array<number>(longueur).fill(0);
  for (const serie of alignees) {
    for (let i = 0; i < longueur; i += 1) {
      somme[i] = (somme[i] ?? 0) + (serie[i] ?? 0);
    }
  }

  const derniere = somme[longueur - 1] ?? 0;
  const calibrable = derniere > 0 && Number.isFinite(totalGlobalCourant) && totalGlobalCourant > 0;
  const k = calibrable ? totalGlobalCourant / derniere : 1;
  return { total: somme.map((v) => v * k), k, recalibre: calibrable };
}

/**
 * Part de `piece` dans `total`, en POURCENT (0–100). `null` si le total est nul,
 * négatif, non fini, ou si la pièce manque à cet index.
 *
 * ⚠️ Le `total` attendu est le total RECALIBRÉ. Diviser par la somme brute du panier
 * gonflerait la dominance d'environ 1,3 point (le dénominateur ignorerait la longue
 * traîne). La dominance étant invariante d'échelle, c'est la seule erreur possible ici
 * — et elle est silencieuse.
 */
export function dominance(
  piece: ReadonlyArray<number>,
  total: ReadonlyArray<number>
): (number | null)[] {
  return total.map((t, i) => {
    const p = piece[i];
    if (p === undefined || !Number.isFinite(t) || t <= 0) return null;
    return (p / t) * 100;
  });
}

/**
 * `base` moins chaque série de `retraits`, clampé à 0 (TOTAL2 = TOTAL − BTC,
 * TOTAL3 = TOTAL − BTC − ETH). Une jambe plus courte est traitée comme absente (0).
 */
export function serieDifference(
  base: ReadonlyArray<number>,
  ...retraits: ReadonlyArray<ReadonlyArray<number>>
): number[] {
  return base.map((v, i) => {
    const retrait = retraits.reduce((acc, s) => acc + (s[i] ?? 0), 0);
    return Math.max(0, v - retrait);
  });
}

/** Dominance agrégée des alts : `100 − BTC.D − ETH.D`, `null` dès qu'une jambe manque. */
export function dominanceAlts(
  btcD: ReadonlyArray<number | null>,
  ethD: ReadonlyArray<number | null>
): (number | null)[] {
  return btcD.map((b, i) => {
    const e = ethD[i];
    if (b === null || e === undefined || e === null) return null;
    return 100 - b - e;
  });
}

/** Plafond du repli exponentiel (ms). */
const ATTENTE_MAX_MS = 60_000;

/**
 * Attente après un 429 : `Retry-After` (en secondes) s'il est exploitable, sinon repli
 * exponentiel `2^essai × 1 s` plafonné à 60 s. `essai` est le numéro de la tentative
 * qui vient d'échouer (1 = première).
 */
export function attenteApres429(essai: number, retryAfterSec: number | null): number {
  if (retryAfterSec !== null && Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
    return Math.min(retryAfterSec * 1000, ATTENTE_MAX_MS);
  }
  return Math.min(2 ** Math.max(1, essai) * 1000, ATTENTE_MAX_MS);
}

// ─────────────────────────── IO ───────────────────────────

/** Lit `Retry-After` (secondes) sur une réponse, `null` si absent ou illisible. */
function lireRetryAfter(res: Response): number | null {
  const brut = res.headers?.get?.("retry-after");
  if (brut === null || brut === undefined) return null;
  const n = Number(brut);
  return Number.isFinite(n) ? n : null;
}

/**
 * Statut conventionnel d'un échec RÉSEAU (fetch rejeté) : le navigateur n'a pas laissé
 * voir la réponse. **Cas dominant en pratique : un 429 CoinGecko.**
 *
 * ⚠️ LEÇON DE RUN RÉEL (2026-07-29) : quand CoinGecko limite le débit, sa réponse
 * d'erreur ne porte PAS d'en-tête `Access-Control-Allow-Origin`. Le navigateur bloque
 * donc la réponse et `fetch` REJETTE avec un `TypeError` — la console affiche « blocked
 * by CORS policy », et `res.status` n'est jamais lisible. Tout repli qui ne s'appuie que
 * sur `status === 429` est donc mort dans un navigateur : il faut traiter le rejet
 * réseau comme retentable. (En curl, la même requête renvoie un 429 bien visible — d'où
 * le piège : le diagnostic en ligne de commande ne reproduit pas le symptôme.)
 */
export const STATUT_RESEAU = 0;

/** GET JSON CoinGecko : lève une `ErreurCoinGecko` typée sur statut non OK OU sur rejet réseau. */
async function getJsonCg(url: string, signal?: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(withDemoKey(url), { signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e; // annulation explicite
    throw new ErreurCoinGecko(
      `CoinGecko injoignable (réseau ou CORS — quota probablement dépassé)`,
      STATUT_RESEAU,
      null
    );
  }
  if (!res.ok) {
    throw new ErreurCoinGecko(
      `CoinGecko ${res.status} ${res.statusText ?? ""}`.trim(),
      res.status,
      lireRetryAfter(res)
    );
  }
  return (await res.json()) as unknown;
}

/** Forme brute (partielle) de /coins/{id}/market_chart. */
interface MarketChartRaw {
  market_caps?: unknown;
}

/**
 * Historique de capitalisation d'une pièce sur 365 jours (le maximum gratuit ;
 * `days=max` renvoie 401 error_code 10012), normalisé en série journalière.
 */
export async function fetchHistoriquePiece(id: string, signal?: AbortSignal): Promise<SerieJour> {
  const url = `${CG_BASE}/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=365&interval=daily`;
  const json = (await getJsonCg(url, signal)) as MarketChartRaw | null;
  const brut = Array.isArray(json?.market_caps) ? json.market_caps : [];
  const paires = brut.filter(
    (p): p is [number, number] => Array.isArray(p) && p.length >= 2
  );
  return grilleJournaliere(paires);
}

/** Nombre de pièces ramenées par l'appel marchés (sert aussi de catalogue au sélecteur). */
const MARCHES_PER_PAGE = 250;

/**
 * Capitalisations courantes du top 250 ET instantané `/global`, en DEUX appels
 * séquentiels (pas en parallèle : le seuil de 429 est bas, cf. docblock d'en-tête).
 * C'est ce couple qui prolonge l'historique jour après jour, sans re-télécharger les
 * 100 séries du backfill.
 */
export async function fetchMarchesEtGlobal(
  signal?: AbortSignal
): Promise<{ marches: CoinTile[]; global: MarketGlobal }> {
  const marchesJson = await getJsonCg(
    `${CG_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${MARCHES_PER_PAGE}&page=1`,
    signal
  );
  const globalJson = await getJsonCg(`${CG_BASE}/global`, signal);
  return { marches: parseMarkets(marchesJson), global: parseGlobal(globalJson) };
}
