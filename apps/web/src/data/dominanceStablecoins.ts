/**
 * Dominance des stablecoins — série chartable STABLE.D = 100 × (USDT + USDC + DAI) / TOTAL.
 *
 * ─── POURQUOI UN MODULE PARESSEUX ─────────────────────────────────────────────────────────
 * (Ses deux points d'entrée, `bougiesDominance` et `abonnerDominance`, ont des noms courts :
 * l'accès par l'espace de noms du chunk les garde en clair dans l'entrée.)
 * Le budget de chargement initial est bloquant (BUILD-CONTRACT) : ce module est chargé par
 * un `import()` mémorisé depuis data/mcapCandles.ts et inscrit dans MODULES_DIFFERES
 * (chargementInitial.test.ts). La tuile CAP « BTC.D hors USDT/USDC/DAI » le charge aussi par
 * `import()` au montage de la fenêtre (`chargerBtcHorsStables`, SUG-41). Seuls l'identifiant, les prédicats, le libellé et les alias
 * restent statiques (data/mcap.ts). Un seul import de VALEUR de ce fichier depuis un module
 * du chemin initial le ramènerait dans le chunk d'entrée sans aucune erreur de build.
 *
 * ─── MESURES RÉELLES (29/10/2026, requêtes sans clé) ──────────────────────────────────────
 *   detail/chart?id=<id>&interval=1d|1h  → points alignés sur 00:00Z (1d) ou HH:00 (1h) ;
 *                                          interval=4h renvoie du JOURNALIER : en 4h, les
 *                                          pièces se lisent en 1h ;
 *   id=825,3408,4943                     → refusé (error_code 500 en HTTP 200) : 3 appels ;
 *   premiers points                      → USDT 2015-02-25, USDC 2018-10-08, DAI 2019-11-22 ;
 *   point 1d d'une pièce daté D          → prix(D 00:00) × offre(D 23:00) (USDT et USDC 584
 *                                          jours sur 584, DAI 801 sur 849, le reste étant de
 *                                          l'arrondi du prix) ; publié après D 23:00 ;
 *   global 1d daté D                     → instantané de D 00:00 (= global 1h et 4h de 00:00) ;
 *   point 1h d'une pièce                 → instantané de HH:00 ; le global publie le bucket
 *                                          courant AVANT la pièce (global à 09:00, USDT à 08:00) ;
 *   28/10/2026                           → 9,5326 % (vérité horaire de 00:00 : 9,5331 %).
 * Même fournisseur que TOTAL : méthode cohérente au numérateur et au dénominateur.
 *
 * ─── CALCUL (fonctions pures) ─────────────────────────────────────────────────────────────
 * Journalier : la ligne 1d de D−1 donne l'instantané de D 00:00 (`alignerJournalier`), offre
 * de D−1 23:00 × prix de D 00:00 = cap(D−1) × prix(D) / prix(D−1) (« V2 ») ; tant que la ligne
 * de D n'est pas publiée (barre du jour) ou si un prix est invalide, cap(D−1) telle quelle
 * (« V1 »). Résidu contre la vérité horaire (594 jours réels) : médiane ≈ 0,0007 pt, max ≈
 * 0,10 pt — l'appariement brut des lignes de D avec le TOTAL de D (23 h d'avance sur l'offre)
 * donnait 0,0066 et 0,86 pt (31/03/2020 : 3,90 % au lieu de 3,04 %).
 * Contribution d'une pièce à l'instant t : 0 avant son lancement (valeur EXACTE, même
 * doctrine que `alignerSurGrille`), le jour même en journalier (son premier point horaire tombe
 * après 00:00) ; sinon son dernier point ≤ t s'il a au plus 2 pas de SA série (2 j en 1d, 2 h
 * en 1h) ; sinon inconnue → aucun point à t. Jamais de 0 inventé sur une barre en retard
 * (fausse chute de dominance), jamais de report illimité.
 *
 * ⚠️ LIMITES ASSUMÉES :
 *   - périmètre littéral USDT + USDC + DAI (4943) : ni USDe, FDUSD, PYUSD, ni USDS (successeur
 *     de DAI chez Sky), ni SAI (le DAI d'avant novembre 2019) ;
 *   - AUCUN repli : CCData et l'échantillonnage CoinGecko local n'ont pas ces capitalisations,
 *     et mélanger les fournisseurs fausserait le niveau → erreur explicite ;
 *   - barre du jour en V1 : ni la variation d'offre de D−1 23:00 à D 00:00 ni le prix de D n'y
 *     entrent (29/10/2026 : 9,4677 % contre 9,4421 % à 00:00) ; la ligne de D la corrige ;
 *   - `data-api` non documentée ;
 *   - profondeur 1h (sondée le 29/10/2026, 11:30–11:41 UTC, 9 requêtes sans clé) : chaque pièce
 *     remonte jusqu'à son lancement, mais son premier point horaire tombe après le minuit du
 *     point journalier : USDT 2015-02-25 13:00, USDC 2018-10-08 18:00, DAI 2019-11-22 01:00
 *     (entre les deux, `error_code 0` et `points: []` : seule exemption à la règle « pièce vide
 *     = erreur », bornée au jour du lancement, cf. `chargerPiece`). En 1h/4h, aucune bougie sur
 *     ces heures-là (USDC : 18 bougies 1h et 5 bougies 4h le 2018-10-08 ; DAI : celles de 00:00
 *     le 2019-11-22). Trous 1h d'USDT en 2015, au-delà du report de 2 h → aucune bougie : 92 h
 *     (26/02 04:00 → 02/03 00:00) et 85 h (03/03 00:00 → 06/03 13:00) ; le trou de 5 h du
 *     27/11/2015 en laisse 2 sans valeur. Les trous de 2 à 3 h (USDT 2015, USDC 2018, DAI 2020)
 *     sont couverts par le report. Global 1h complet sur les fenêtres sondées (20/02–01/03/2015,
 *     01–05/10/2018).
 */
import type { Candle, Timeframe } from "@axiom/types";
import type { PointSerie } from "../lib/referentiel";
import type { McapSnapshot } from "../store/macroHistory";
import {
  alignerTemps,
  chargerGlobauxCmc,
  chargerHistoriqueCmc,
  // Chemin detail/chart de cmcMcap.ts, nommé d'après ETH (1027) mais valable pour tout id CMC.
  ETH_PATH as DETAIL_CHART_PATH,
  fetchJson,
  normaliserEthCmc,
  pasIntervalle,
  plages,
  type IntervalleCmc,
} from "./cmcMcap";
import {
  construireBougiesSerie,
  debutBucketCapitalisation,
  REPOLL_MCAP_INTRADAY_MS,
  REPOLL_MCAP_LENT_MS,
} from "./mcapCandles";

/** Ids CMC : un seul id par requête detail/chart (le multi-id est refusé). */
export const IDS_STABLECOINS_CMC = { USDT: 825, USDC: 3408, DAI: 4943 } as const;
type PieceStable = keyof typeof IDS_STABLECOINS_CMC;
const PIECES: readonly PieceStable[] = ["USDT", "USDC", "DAI"];

/** Premier point CMC de chaque pièce (mesuré) : avant, sa capitalisation vaut exactement 0. */
export const LANCEMENTS_STABLECOINS_CMC: Readonly<Record<PieceStable, number>> = {
  USDT: Date.UTC(2015, 1, 25),
  USDC: Date.UTC(2018, 9, 8),
  DAI: Date.UTC(2019, 10, 22),
};

// Chaque liaison importée de l'entrée y coûte un export : les aides déjà importées servent ici.
const JOUR_MS = pasIntervalle("1d");
const HEURE_MS = pasIntervalle("1h");

/** Âge maximal d'un point reporté, en pas de la série de la pièce. */
const TOLERANCE_PAS = 2;
/** Points par requête detail/chart : 12 000 mesurés en un bloc, lots de 10 000 comme ETH. */
const TAILLE_LOT_PIECE = 10_000;
export const CLE_CACHE_STABLES = "axiom:mcap:cmc-stables:v2";
const TTL_CACHE_MS = 12 * HEURE_MS;
/** Cache servi en secours d'un rafraîchissement en échec : 24 h au plus, sinon erreur explicite. */
const AGE_MAX_SECOURS_MS = 24 * HEURE_MS;
/** Fenêtre minimale du rafraîchissement incrémental (révisions CMC récentes). */
const FENETRE_INCREMENTALE_MS = 45 * JOUR_MS;
/** Pages de dominance en vol (4 requêtes CMC chacune) : EVTS en 1h en lancerait 12 d'un coup. */
const PAGES_EN_VOL_MAX = 2;

const MESSAGE_INDISPONIBLE =
  "Dominance stablecoins indisponible : CoinMarketCap public ne répond pas — aucun repli, ni CCData ni CoinGecko ne publient ces capitalisations";

/** Échec de chargement de STABLE.D : message explicite, cause d'origine conservée. */
export class ErreurDominanceStablecoins extends Error {
  constructor(cause: unknown) {
    super(MESSAGE_INDISPONIBLE, { cause });
    this.name = "ErreurDominanceStablecoins";
  }
}

/** Ligne detail/chart d'une pièce : capitalisation et prix (`null` : invalide, ou non lu en 1h). */
export interface PointBrut {
  t: number;
  cap: number;
  prix: number | null;
}

/** Série d'une pièce : date de lancement + points triés par instant croissant. */
export interface SeriePiece {
  lancement: number;
  points: readonly PointSerie[];
}

type PiecesBrutes = Record<PieceStable, PointBrut[]>;

export interface DepsDominance {
  fetcher?: typeof fetch;
  maintenant?: () => number;
  /** Dénominateur journalier ; défaut : `chargerHistoriqueCmc` (cache 12 h partagé avec TOTAL). */
  chargerHistorique?: () => Promise<readonly McapSnapshot[] | null>;
  /** Points par requête detail/chart d'une pièce ; défaut `TAILLE_LOT_PIECE` (tests du découpage). */
  tailleLotPiecePoints?: number;
}

// ─────────────────────────── Fonctions pures ───────────────────────────

/**
 * Instantanés de 00:00 d'une pièce depuis ses lignes 1d triées. La ligne de D−1 (prix de
 * D−1 00:00 × offre de D−1 23:00) donne le point de D : offre de D−1 23:00 × prix de D 00:00
 * quand la ligne de D existe et que les deux prix sont valides (V2), sinon cap(D−1) telle
 * quelle (V1 : barre du jour pas encore publiée, prix invalide). Une capitalisation nulle
 * reste nulle.
 */
export function alignerJournalier(bruts: readonly PointBrut[]): PointSerie[] {
  return bruts.map((veille, i) => {
    const jour = bruts[i + 1];
    const t = veille.t + JOUR_MS;
    return jour?.t === t && jour.prix !== null && veille.prix !== null
      ? { t, v: (veille.cap * jour.prix) / veille.prix }
      : { t, v: veille.cap };
  });
}

/**
 * Contribution d'une pièce à l'instant `t` : 0 avant son lancement, son dernier point ≤ t s'il
 * date d'au plus `toleranceMs`, sinon `null` (inconnue). Une capitalisation publiée à 0 après
 * le lancement (USDC sa première semaine, DAI jusqu'au 2020-01-21) est une donnée CMC.
 */
export function contributionPiece(piece: SeriePiece, t: number, toleranceMs: number): number | null {
  if (t < piece.lancement) return 0;
  let bas = 0;
  let haut = piece.points.length - 1;
  let dernier: PointSerie | undefined;
  while (bas <= haut) {
    const milieu = (bas + haut) >> 1;
    const point = piece.points[milieu];
    if (point === undefined) break;
    if (point.t <= t) {
      dernier = point;
      bas = milieu + 1;
    } else {
      haut = milieu - 1;
    }
  }
  return dernier === undefined || t - dernier.t > toleranceMs ? null : dernier.v;
}

/**
 * Dominance en % pour chaque point global : `100 × Σ contributions / total`. Aucun point si le
 * total n'est pas fini ou ≤ 0, si une contribution est inconnue, ou si la somme est nulle
 * (avant USDT : rien n'est tracé).
 */
export function dominanceSurTotal(
  globaux: readonly { t: number; total: number }[],
  pieces: readonly SeriePiece[],
  toleranceMs: number,
): PointSerie[] {
  const sortie: PointSerie[] = [];
  for (const { t, total } of globaux) {
    if (!Number.isFinite(total) || total <= 0) continue;
    const somme = sommeStables(pieces, t, toleranceMs);
    if (somme !== null && somme > 0) sortie.push({ t, v: (100 * somme) / total });
  }
  return sortie;
}

/** Σ des contributions des pièces à l'instant `t` (USD) ; null si l'une est inconnue. */
function sommeStables(pieces: readonly SeriePiece[], t: number, toleranceMs: number): number | null {
  let somme = 0;
  for (const piece of pieces) {
    const contribution = contributionPiece(piece, t, toleranceMs);
    if (contribution === null) return null;
    somme += contribution;
  }
  return Number.isFinite(somme) ? somme : null;
}

/** Point de la tuile CAP « BTC.D hors USDT/USDC/DAI » (toutes valeurs en %, jambes CMC). */
export interface PointBtcHorsStables {
  /** Minuit UTC (instantané global de 00:00). */
  t: number;
  /** BTC.D brute CMC : 100 × (TOTAL − TOTAL2) / TOTAL. */
  btcD: number;
  /** STABLE.D : 100 × (USDT + USDC + DAI) / TOTAL. */
  stableD: number;
  /** BTC.D hors stables : 100 × BTC / (TOTAL − USDT − USDC − DAI). */
  btcDHorsStables: number;
}

/**
 * BTC.D hors USDT/USDC/DAI pour chaque point global CMC : BTC = TOTAL − TOTAL2 (capitalisation
 * « altcoins » CMC), stables = Σ des trois pièces au même instant (mêmes règles que STABLE.D :
 * 0 avant le lancement, report borné, sinon inconnue). Aucun point si TOTAL n'est pas fini ou
 * ≤ 0, si BTC n'est pas strictement positif, si une pièce est inconnue ou si les stables
 * égalent ou dépassent TOTAL. Les AUTRES stables (USDe, FDUSD, PYUSD, USDS…) restent au
 * dénominateur : la correction est un minorant. PURE.
 */
export function dominanceBtcHorsStables(
  globaux: readonly { t: number; total: number; total2: number }[],
  pieces: readonly SeriePiece[],
  toleranceMs: number,
): PointBtcHorsStables[] {
  const sortie: PointBtcHorsStables[] = [];
  for (const { t, total, total2 } of globaux) {
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(total2)) continue;
    const btc = total - total2;
    const stables = sommeStables(pieces, t, toleranceMs);
    if (!(btc > 0) || stables === null || stables >= total) continue;
    sortie.push({
      t,
      btcD: (100 * btc) / total,
      stableD: (100 * stables) / total,
      btcDHorsStables: (100 * btc) / (total - stables),
    });
  }
  return sortie;
}

/**
 * Variation en points sur `jours` jours de BTC.D hors stables et de BTC.D brute : dernier point
 * contre le point daté EXACTEMENT `jours` jours avant ; null si l'un manque (pas d'interpolation).
 * Une BTC.D brute qui baisse pendant que la version hors stables tient = fuite vers les stables,
 * pas vers les alts. PURE.
 */
export function variationBtcHorsStables(
  points: readonly PointBtcHorsStables[],
  jours: number,
): { horsStables: number; brute: number } | null {
  const dernier = points[points.length - 1];
  if (dernier === undefined) return null;
  const depart = points.find((p) => p.t === dernier.t - jours * JOUR_MS);
  if (depart === undefined) return null;
  return { horsStables: dernier.btcDHorsStables - depart.btcDHorsStables, brute: dernier.btcD - depart.btcD };
}

/**
 * Séries des pièces (lignes brutes dans l'ordre de PIECES). En 1d, instantanés de 00:00
 * reconstitués et lancement décalé d'un jour : à 00:00 du jour de son lancement, la pièce
 * n'existait pas encore. En 1h, chaque point est déjà l'instantané de HH:00.
 */
function seriesPieces(bruts: ReadonlyArray<readonly PointBrut[]>, intervallePiece: IntervalleCmc): SeriePiece[] {
  return PIECES.map((nom, i) => {
    const points = bruts[i] ?? [];
    return intervallePiece === "1d"
      ? { lancement: LANCEMENTS_STABLECOINS_CMC[nom] + JOUR_MS, points: alignerJournalier(points) }
      : { lancement: LANCEMENTS_STABLECOINS_CMC[nom], points: points.map(({ t, cap }) => ({ t, v: cap })) };
  });
}

function tolerancePiece(intervallePiece: IntervalleCmc): number {
  return TOLERANCE_PAS * pasIntervalle(intervallePiece);
}

/**
 * Lignes 1d d'une réponse detail/chart : prix `v[0]` ET capitalisation `v[2]`, instant ramené
 * au jour. Même tolérance que `normaliserEthCmc` (entrée invalide ignorée, capitalisation finie
 * ≥ 0) ; un prix non fini ou ≤ 0 devient `null` (repli V1).
 */
function lireLignesJournalieres(json: unknown): PointBrut[] {
  const data = json !== null && typeof json === "object" ? (json as { data?: unknown }).data : null;
  const points = data !== null && typeof data === "object" ? (data as { points?: unknown }).points : null;
  const lignes: PointBrut[] = [];
  for (const item of Array.isArray(points) ? points : []) {
    if (item === null || typeof item !== "object") continue;
    const { s, v } = item as { s?: unknown; v?: unknown };
    const t = typeof s === "string" && !/^\d+$/.test(s) ? Date.parse(s) : Number(s) * 1000;
    const valeurs: unknown[] = Array.isArray(v) ? v : [];
    const cap = valeurs[2] === null || valeurs[2] === undefined ? Number.NaN : Number(valeurs[2]);
    const prix = Number(valeurs[0]);
    if (Number.isFinite(t) && t > 0 && Number.isFinite(cap) && cap >= 0) {
      lignes.push({ t: alignerTemps(t, "1d"), cap, prix: Number.isFinite(prix) && prix > 0 ? prix : null });
    }
  }
  return lignes;
}

// ─────────────────────────── Requêtes ───────────────────────────

/**
 * Lignes d'une pièce sur `[debut, fin]`, bornées à son lancement, en lots séquentiels.
 * Fenêtre entièrement antérieure au lancement : aucun appel (contribution 0). Fenêtre postérieure
 * au lancement mais sans aucun point : ÉCHEC, c'est une panne CMC servie en `error_code 0` (en
 * journalier, le cache périmé repartirait sinon pour 12 h ; en 1h/4h, l'overlay dirait « historique
 * vide » et la pagination s'arrêterait pour la session, alors qu'une erreur est réessayée).
 * Seule exemption, pour une pièce lue en 1h (pages 1h et 4h) : une fenêtre qui finit avant le
 * minuit suivant son lancement. CMC y répond `points: []` jusqu'au premier point horaire (sondé :
 * 13:00, 18:00 et 01:00) ; la contribution reste inconnue (aucun point, jamais 0) et la dernière
 * page de la pagination rend ce qu'elle sait. Les trous horaires internes (92 h au plus, USDT
 * 2015) sont plus courts qu'une page (500 bougies au chargement, 1 000 en pagination ; seule
 * l'extension de session demande des pages courtes, et sur des dates récentes) : ils ne vident
 * jamais une fenêtre.
 */
async function chargerPiece(
  nom: PieceStable,
  debut: number,
  fin: number,
  intervalle: IntervalleCmc,
  deps: DepsDominance,
): Promise<PointBrut[]> {
  const depart = Math.max(debut, LANCEMENTS_STABLECOINS_CMC[nom]);
  if (depart > fin) return [];
  const parInstant = new Map<number, PointBrut>();
  for (const plage of plages(depart, fin, deps.tailleLotPiecePoints ?? TAILLE_LOT_PIECE, intervalle)) {
    const json = await fetchJson(
      `${DETAIL_CHART_PATH}?${new URLSearchParams({
        id: String(IDS_STABLECOINS_CMC[nom]),
        timeStart: String(Math.floor(plage.debut / 1000)),
        timeEnd: String(Math.floor(plage.fin / 1000)),
        interval: intervalle,
      })}`,
      deps.fetcher ?? fetch,
    );
    // 1d : prix ET capitalisation, pour reconstituer l'instantané de 00:00 ; 1h : le point est
    // déjà l'instantané de HH:00, sa capitalisation suffit.
    const lignes = intervalle === "1d"
      ? lireLignesJournalieres(json)
      : Array.from(normaliserEthCmc(json), ([t, cap]) => ({ t, cap, prix: null }));
    for (const ligne of lignes) parInstant.set(ligne.t, ligne);
  }
  if (parInstant.size === 0 && (intervalle === "1d" || fin >= LANCEMENTS_STABLECOINS_CMC[nom] + JOUR_MS)) {
    throw new Error(`CoinMarketCap public ne renvoie aucune capitalisation pour l'id ${IDS_STABLECOINS_CMC[nom]}`);
  }
  return [...parInstant.values()].sort((a, b) => a.t - b.t);
}

const pagesEnCours = new Map<string, Promise<PointSerie[]>>();
let pagesEnVol = 0;
const fileAttente: Array<() => void> = [];

/**
 * Au plus PAGES_EN_VOL_MAX pages en vol, les suivantes en file d'attente (dans l'ordre) : une
 * page finie, en succès comme en échec, passe sa place à la suivante.
 */
async function avecPlace<T>(charger: () => Promise<T>): Promise<T> {
  if (pagesEnVol < PAGES_EN_VOL_MAX) pagesEnVol += 1;
  else await new Promise<void>((entrer) => fileAttente.push(entrer));
  try {
    return await charger();
  } finally {
    const suivante = fileAttente.shift();
    if (suivante === undefined) pagesEnVol -= 1;
    else suivante();
  }
}

/**
 * Page de dominance (`endTime`, `limit`) : global à l'intervalle du graphe, trois pièces en
 * parallèle depuis le début moins l'amorce du report (2 pas de la pièce ; en 1d, un jour de
 * plus, la ligne de D−1 donnant le point de D), en 1h pour les pages 1h/4h. Pas de cache
 * persistant (comme TOTAL intraday) ; deux pages en vol au plus ; pages en vol dédoublonnées
 * par une clé propre à la dominance, AVANT la file (sauf dépendances injectées : tests isolés).
 */
function chargerPageDominance(
  intervalle: IntervalleCmc,
  options: { endTime?: number; limit?: number },
  deps: DepsDominance,
): Promise<PointSerie[]> {
  const fin = alignerTemps(options.endTime ?? (deps.maintenant ?? Date.now)(), intervalle);
  const limit = Math.max(1, Math.floor(options.limit ?? 500));
  // La série commence au premier point d'USDT : avant, la somme des stablecoins est nulle.
  const debut = Math.max(LANCEMENTS_STABLECOINS_CMC.USDT, fin - (limit - 1) * pasIntervalle(intervalle));
  const intervallePiece: IntervalleCmc = intervalle === "1d" ? "1d" : "1h";
  const charger = () => avecPlace(async (): Promise<PointSerie[]> => {
    const amorce = debut - tolerancePiece(intervallePiece) - (intervallePiece === "1d" ? JOUR_MS : 0);
    const [globaux, bruts] = await Promise.all([
      chargerGlobauxCmc(debut, fin, intervalle, { fetcher: deps.fetcher }),
      Promise.all(PIECES.map((nom) => chargerPiece(nom, amorce, fin, intervallePiece, deps))),
    ]);
    return dominanceSurTotal(globaux, seriesPieces(bruts, intervallePiece), tolerancePiece(intervallePiece));
  });
  if (Object.keys(deps).length > 0) return charger();
  const cle = `stables:${intervalle}:${debut}:${fin}`;
  const existante = pagesEnCours.get(cle);
  if (existante !== undefined) return existante;
  const promesse = charger().finally(() => {
    if (pagesEnCours.get(cle) === promesse) pagesEnCours.delete(cle);
  });
  pagesEnCours.set(cle, promesse);
  return promesse;
}

// ─────────────────────────── BTC.D hors stables (tuile CAP) ───────────────────────────

/** Profondeur de la tuile CAP (sparkline et variation sur 30 j). */
const JOURS_BTC_HORS_STABLES = 90;
/** Mémoire de session : une réouverture de CAP dans les 15 min ne relance pas les 4 requêtes. */
const TTL_BTC_HORS_STABLES_MS = 15 * 60_000;

const MESSAGE_BTC_HORS_STABLES_INDISPONIBLE =
  "BTC.D hors USDT/USDC/DAI indisponible : CoinMarketCap public ne répond pas — aucun repli (jambes CMC uniquement, jamais mélangées à CoinGecko ou BGeometrics)";

let memoBtcHorsStables: { ts: number; promesse: Promise<PointBtcHorsStables[]> } | null = null;

/**
 * Série journalière BTC.D hors USDT/USDC/DAI des 90 derniers jours : page global CMC 1d (TOTAL
 * et TOTAL2 du même instantané de 00:00) + trois pièces en 1d, alignées sur 00:00 comme STABLE.D
 * (même amorce : 2 jours de report + la ligne de D−1). 4 requêtes, AUCUN cache persistant (le
 * localStorage n'est pas alourdi par les pièces depuis 2015) ; mémoire de session de 15 min.
 * Panne CMC → erreur explicite, aucun repli sur une autre source.
 */
export function chargerBtcHorsStables(deps: DepsDominance = {}): Promise<PointBtcHorsStables[]> {
  const charger = async (): Promise<PointBtcHorsStables[]> => {
    const fin = alignerTemps((deps.maintenant ?? Date.now)(), "1d");
    const debut = fin - (JOURS_BTC_HORS_STABLES - 1) * JOUR_MS;
    const amorce = debut - tolerancePiece("1d") - JOUR_MS;
    try {
      const [globaux, bruts] = await Promise.all([
        chargerGlobauxCmc(debut, fin, "1d", { fetcher: deps.fetcher }),
        Promise.all(PIECES.map((nom) => chargerPiece(nom, amorce, fin, "1d", deps))),
      ]);
      return dominanceBtcHorsStables(globaux, seriesPieces(bruts, "1d"), tolerancePiece("1d"));
    } catch (cause) {
      throw new Error(MESSAGE_BTC_HORS_STABLES_INDISPONIBLE, { cause });
    }
  };
  if (Object.keys(deps).length > 0) return charger();
  const maintenant = Date.now();
  if (memoBtcHorsStables !== null && maintenant - memoBtcHorsStables.ts < TTL_BTC_HORS_STABLES_MS) {
    return memoBtcHorsStables.promesse;
  }
  const promesse = charger();
  const memo = { ts: maintenant, promesse };
  memoBtcHorsStables = memo;
  // Un échec n'est pas mémorisé : la prochaine ouverture réessaie.
  promesse.catch(() => {
    if (memoBtcHorsStables === memo) memoBtcHorsStables = null;
  });
  return promesse;
}

// ─────────────────────────── Cache journalier ───────────────────────────

/**
 * Forme persistée, compacte : par pièce, premier jour + capitalisations au dollar et prix à
 * 6 décimales (`null` : jour absent, prix invalide).
 */
interface PieceCompacte {
  debut: number;
  caps: Array<number | null>;
  prix: Array<number | null>;
}

function compacter(points: readonly PointBrut[]): PieceCompacte {
  const debut = points[0]?.t ?? 0;
  const caps: Array<number | null> = [];
  const prix: Array<number | null> = [];
  for (const point of points) {
    const i = Math.round((point.t - debut) / JOUR_MS);
    caps[i] = Math.round(point.cap);
    prix[i] = point.prix === null ? null : Math.round(point.prix * 1e6) / 1e6;
  }
  return { debut, caps: Array.from(caps, (cap) => cap ?? null), prix: Array.from(prix, (p) => p ?? null) };
}

/**
 * Lecture TOLÉRANTE d'une pièce : capitalisation invalide → jour absent ; prix absent (forme
 * v1), tableau de prix plus court ou prix invalide → `null` (repli V1), sans rejeter le cache.
 */
function decompacter(brut: unknown): PointBrut[] | null {
  if (brut === null || typeof brut !== "object") return null;
  const { debut, caps, prix } = brut as { debut?: unknown; caps?: unknown; prix?: unknown };
  if (typeof debut !== "number" || !Number.isFinite(debut) || !Array.isArray(caps)) return null;
  const prixLus: unknown[] = Array.isArray(prix) ? prix : [];
  const points: PointBrut[] = [];
  caps.forEach((cap: unknown, i) => {
    const p = prixLus[i];
    if (typeof cap === "number" && Number.isFinite(cap) && cap >= 0) {
      points.push({ t: debut + i * JOUR_MS, cap, prix: typeof p === "number" && Number.isFinite(p) && p > 0 ? p : null });
    }
  });
  return points;
}

/** Lecture TOLÉRANTE : absent, corrompu, version inconnue ou pièce manquante → null (vide). */
function lireCache(): { majTs: number; pieces: PiecesBrutes } | null {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE_CACHE_STABLES) ?? "null") as {
      version?: unknown;
      majTs?: unknown;
      pieces?: Record<string, unknown>;
    } | null;
    if (brut?.version !== 2 || typeof brut.majTs !== "number" || !Number.isFinite(brut.majTs)) return null;
    const pieces = {} as PiecesBrutes;
    for (const nom of PIECES) {
      const points = decompacter(brut.pieces?.[nom]);
      if (points === null) return null;
      pieces[nom] = points;
    }
    return { majTs: brut.majTs, pieces };
  } catch {
    return null;
  }
}

/** Écriture best-effort (quota plein, mode privé : le cache est un confort, pas une donnée). */
function ecrireCache(majTs: number, pieces: PiecesBrutes): void {
  try {
    localStorage.setItem(
      CLE_CACHE_STABLES,
      JSON.stringify({
        version: 2,
        majTs,
        pieces: Object.fromEntries(PIECES.map((nom) => [nom, compacter(pieces[nom])])),
      }),
    );
  } catch {
    return;
  }
}

/** Fusion par jour : la nouvelle ligne (capitalisation ET prix) l'emporte. */
function fusionner(anciens: readonly PointBrut[], nouveaux: readonly PointBrut[]): PointBrut[] {
  const parJour = new Map<number, PointBrut>();
  for (const point of [...anciens, ...nouveaux]) parJour.set(point.t, point);
  return [...parJour.values()].sort((a, b) => a.t - b.t);
}

async function chargerStablesInterne(deps: DepsDominance): Promise<PiecesBrutes> {
  const cache = lireCache();
  const maintenant = (deps.maintenant ?? Date.now)();
  // Un majTs dans le futur (horloge avancée puis corrigée) vaut cache périmé : âge NaN.
  const age = cache !== null && cache.majTs <= maintenant ? maintenant - cache.majTs : Number.NaN;
  if (cache !== null && age < TTL_CACHE_MS) return cache.pieces;
  try {
    const recues = await Promise.all(PIECES.map((nom) => {
      const dernier = cache?.pieces[nom].at(-1)?.t;
      // Même règle anti-trou que cmcMcap.ts : la fenêtre rejoint TOUJOURS la fin du cache, sinon
      // un terminal rouvert après 45 jours garderait un trou définitif (majTs = maintenant).
      const debut = dernier === undefined
        ? LANCEMENTS_STABLECOINS_CMC[nom]
        : Math.min(maintenant - FENETRE_INCREMENTALE_MS, dernier - JOUR_MS);
      return chargerPiece(nom, debut, alignerTemps(maintenant, "1d"), "1d", deps);
    }));
    const pieces = {} as PiecesBrutes;
    PIECES.forEach((nom, i) => {
      pieces[nom] = fusionner(cache?.pieces[nom] ?? [], recues[i] ?? []);
    });
    ecrireCache(maintenant, pieces);
    return pieces;
  } catch (erreur) {
    // Une pièce en échec fait échouer tout le rafraîchissement. Le cache n'est servi en secours
    // que s'il a au plus 24 h, et signalé ; au-delà, l'erreur explicite plutôt qu'une série
    // tronquée affichée comme « CoinMarketCap · daily ».
    if (cache === null || !(age <= AGE_MAX_SECOURS_MS)) throw erreur;
    console.warn(`[AXIOM] STABLE.D : rafraîchissement CMC des pièces en échec — cache de ${Math.round(age / HEURE_MS)} h servi`, erreur);
    return cache.pieces;
  }
}

let stablesEnCours: Promise<PiecesBrutes> | null = null;

/** Lignes 1d brutes des trois pièces (cache 12 h, rafraîchissement incrémental, chargement partagé). */
export function chargerStablesJournalieres(deps: DepsDominance = {}): Promise<PiecesBrutes> {
  if (Object.keys(deps).length > 0) return chargerStablesInterne(deps);
  stablesEnCours ??= chargerStablesInterne(deps).finally(() => {
    stablesEnCours = null;
  });
  return stablesEnCours;
}

// ─────────────────────────── Adaptateur (appelé par data/mcapCandles.ts) ───────────────────────────

/**
 * Bougies de STABLE.D. 1h/4h : page CMC ; au-delà : historique journalier complet (TOTAL CMC
 * en cache + lignes des pièces en cache, alignées sur 00:00). Toute panne de chargement devient
 * l'erreur explicite : aucune bascule CCData ni CoinGecko, dont les séries n'ont pas ces
 * capitalisations.
 */
export async function bougiesDominance(
  tf: Timeframe,
  opts: { endTime?: number; limit?: number } = {},
  deps: DepsDominance = {},
): Promise<Candle[]> {
  let points: PointSerie[];
  try {
    if (tf === "1h" || tf === "4h") {
      points = await chargerPageDominance(tf, opts, deps);
    } else {
      const [historique, pieces] = await Promise.all([
        (deps.chargerHistorique ?? chargerHistoriqueCmc)(),
        chargerStablesJournalieres(deps),
      ]);
      if (historique === null) throw new Error("historique global CoinMarketCap indisponible");
      points = dominanceSurTotal(historique, seriesPieces(PIECES.map((nom) => pieces[nom]), "1d"), tolerancePiece("1d"));
    }
  } catch (cause) {
    throw new ErreurDominanceStablecoins(cause);
  }
  const bougies = construireBougiesSerie(points, tf, (deps.maintenant ?? Date.now)());
  const endTime = opts.endTime;
  const bornees = endTime === undefined ? bougies : bougies.filter((bougie) => bougie.time <= endTime);
  return opts.limit === undefined ? bornees : bornees.slice(-Math.max(0, Math.floor(opts.limit)));
}

/**
 * Repoll de la bougie courante, cadence de TOTAL (5 min en 1h/4h, 15 min au-delà). La page
 * couvre le bucket courant + deux points avant : l'ouverture est la clôture précédente de cette
 * page FRAÎCHE. ⚠️ Elle peut différer de la clôture affichée : en 1h/4h, une bougie formée en
 * direct garde la valeur reportée de la pièce (publiée un pas après le global) jusqu'au
 * rechargement — écart médian 0,001 pt, max 0,07 pt sur 11 999 heures réelles ; en 1d, quand
 * la clôture affichée de la veille a été calculée avant la publication de sa ligne (bougie
 * formée en direct pendant la journée, ou cache antérieur à cette ligne) : V1 affiché, V2 émis,
 * écart de l'ordre du millième de point. N'émet que si la bougie du bucket courant existe et a
 * changé ; un échec laisse la bougie en l'état, signalé en console au premier échec d'une série.
 */
export function abonnerDominance(
  tf: Timeframe,
  cb: (bougie: Candle) => void,
  deps: DepsDominance = {},
): () => void {
  const intervalle: IntervalleCmc = tf === "1h" || tf === "4h" ? tf : "1d";
  let arrete = false;
  let derniereSignature = "";
  let enEchec = false;
  const rafraichir = async (): Promise<void> => {
    try {
      const maintenant = (deps.maintenant ?? Date.now)();
      const debutBucket = debutBucketCapitalisation(maintenant, tf);
      const limit = Math.ceil((maintenant - debutBucket) / pasIntervalle(intervalle)) + 2;
      const points = await chargerPageDominance(intervalle, { endTime: maintenant, limit }, deps);
      enEchec = false;
      if (arrete) return;
      const bougie = construireBougiesSerie(points, tf, maintenant).at(-1);
      // Bucket courant absent (retard amont) : ne rien réécrire plutôt qu'une bougie close.
      if (bougie === undefined || bougie.time !== debutBucket) return;
      const signature = `${bougie.time}:${bougie.open}:${bougie.high}:${bougie.low}:${bougie.close}`;
      if (signature === derniereSignature) return;
      derniereSignature = signature;
      cb(bougie);
    } catch (erreur) {
      // Repoll best-effort : la bougie reste en l'état ; un seul signal par série d'échecs.
      if (!enEchec && !arrete) console.warn("[AXIOM] STABLE.D : repoll CMC en échec — bougie courante non rafraîchie", erreur);
      enEchec = true;
    }
  };
  const minuteur = setInterval(() => void rafraichir(), intervalle === "1d" ? REPOLL_MCAP_LENT_MS : REPOLL_MCAP_INTRADAY_MS);
  return () => {
    arrete = true;
    clearInterval(minuteur);
  };
}
