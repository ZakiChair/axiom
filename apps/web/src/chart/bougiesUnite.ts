/**
 * Calcul d'une instance sur une unité SUPÉRIEURE et projection sur le graphe (SUG-1,
 * phase 1 : graphe seul). Chargé par `import()` depuis chart/indicators.ts à la première
 * instance qui porte `params.unite` : hors du chemin de chargement initial.
 *
 * Chaîne, sans aucune donnée inventée :
 *  1. éligibilité (`raisonUniteRefusee`) : refus motivé sinon ;
 *  2. bougies de l'unité supérieure par l'adaptateur de la place du graphe, autant que le
 *     backfill du graphe natif (500) ou l'amorce déclarée si elle est plus longue : le
 *     calcul porte ainsi sur le même jeu de bougies qu'un graphe ouvert dans cette unité ;
 *  3. seules les bougies CLOSES depuis `MARGE_CLOTURE_MS` sont gardées (les adaptateurs
 *     renvoient la bougie en cours, qui repeindrait, et déduisent `closed` de l'horloge du
 *     client), et toutes doivent être alignées UTC (1w : lundi 00:00), sinon refus durable
 *     pour la session : une semaine Kraken ou Hyperliquid décalée ne serait pas « la » semaine ;
 *  4. `computeIndicator` sur ces bougies, avec `ctx.timeframe` = l'unité supérieure ;
 *  5. projection `projeterSurUnite` (@axiom/indicators) : valeur datée à la CLÔTURE de la
 *     bougie supérieure, lue par chaque bougie du graphe à sa propre clôture.
 *
 * Réseau : une requête par (place, symbole, unité, profondeur), partagée entre instances
 * et graphes, relancée UNE fois par clôture supérieure, au premier recalcul de l'instance
 * qui suit cette clôture et sa marge `MARGE_CLOTURE_MS` (aucune minuterie : le recalcul
 * vient d'un tick ou d'une clôture du graphe ; sur une paire muette, la bougie close du
 * graphe peut donc rester sans valeur plus longtemps que la marge). Une
 * bougie du graphe déjà close dont la clôture atteint une bougie supérieure pas encore
 * reçue reste SANS valeur (jamais l'ancienne valeur prolongée, qui changerait ensuite) ;
 * seule la bougie en formation du graphe montre provisoirement la dernière valeur connue,
 * comme tout indicateur natif.
 *
 * Fenêtre FIXE : le premier chargement fixe la première bougie supérieure ; un rechargement
 * n'AJOUTE que les bougies closes postérieures à la dernière détenue, comme le graphe natif
 * prolonge sa série. Les définitions cumulatives (OBV, NVI, A/D, PVT, VWAP ancré…), qui
 * dépendent du début de la fenêtre, ne repeignent donc pas leur passé à chaque clôture. La
 * fenêtre ne repart de zéro que si la place ne sert plus la suite de la dernière bougie
 * détenue (veille de plus de 500 bougies supérieures) ; un rechargement en échec la garde.
 */
import type { Candle, ExchangeId, IndicatorDef, IndicatorResult, Timeframe } from "@axiom/types";
import { computeIndicator, projeterSurUnite } from "@axiom/indicators";
import { getAdapter } from "../data/adapters";
import { CLE_UNITE } from "./uniteParam";
import { DUREE_UNITE, noterRefusAlignement, oublierRefusAlignement, raisonUniteRefusee } from "./uniteSuperieure";

/** Profondeur demandée : celle du backfill du graphe natif (ChartInstance, `limit: 500`). */
export const LIMITE_BOUGIES_UNITE = 500;
/**
 * Marge après la clôture d'une bougie supérieure avant de la tenir pour close et de la
 * demander : une horloge client en avance de quelques secondes ne doit pas faire prendre
 * pour close une bougie encore ouverte côté serveur (données incomplètes, gardées ensuite
 * toute la période). Pendant la marge, la bougie close du graphe reste sans valeur.
 */
export const MARGE_CLOTURE_MS = 10_000;
/** Un échec est mémorisé 30 s avant un nouvel essai (anti-tempête, comme `auxProvider`). */
const ERREUR_TTL_MS = 30_000;
/** Place en retard sur une clôture (bougie close pas encore servie) : un essai toutes les 30 s. */
const RELANCE_RETARD_MS = 30_000;
/**
 * Bougies servies au plus par requête, pour les places qui plafonnent sous la profondeur
 * demandée (adaptateur Coinbase : 350 ; OKX : 300 par requête). Une réponse pleine à ce
 * plafond ne dit rien de l'historique de la place : le motif « historique trop court » n'est
 * retenu que si elle a servi MOINS que min(profondeur demandée, plafond).
 */
const PLAFOND_REQUETE: Partial<Record<ExchangeId, number>> = { coinbase: 350, okx: 300 };
/** Borne mémoire du cache (entrées les moins récemment lues évincées). */
const MAX_ENTREES = 16;
/** Le 1er janvier 1970 était un jeudi : les semaines du lundi sont décalées de 4 jours. */
const DECALAGE_LUNDI_MS = 4 * 86_400_000;

type Params = Record<string, number | boolean | string>;

/** Demande de calcul d'une instance sur une unité supérieure. */
export interface DemandeUnite {
  def: IndicatorDef;
  params: Params;
  unite: string;
  exchange: ExchangeId;
  symbol: string;
  /** Unité du graphe. */
  timeframe: Timeframe;
  /** Bougies du graphe (la dernière peut être en formation). */
  candles: Candle[];
}

/**
 * État du calcul : refus motivé, attente, échec du chargement, ou séries projetées. Les
 * raisons sont rédigées ici, prêtes pour la légende (le chemin initial n'en porte aucune).
 */
export type EtatUnite =
  | { status: "refus"; raison: string }
  | { status: "pending" }
  | { status: "error"; raison: string }
  | {
      status: "ready";
      result: IndicatorResult;
      /** Bougies supérieures closes utilisées par le calcul. */
      nbBougies: number;
      /**
       * Raison si une partie du graphe reste sans valeur alors que d'autres en ont (début
       * non couvert par l'historique ou l'amorce, rechargement en échec), sinon `null`.
       */
      partiel: string | null;
    };

interface Entree {
  /** Fenêtre détenue : début fixé au premier chargement, prolongée à chaque clôture. */
  bougies: Candle[] | null;
  /** Au premier chargement, la place a rendu moins de bougies que demandé : historique épuisé. */
  historiqueCourt: boolean;
  /** Dernier échec (premier chargement, ou rechargement : la fenêtre détenue reste alors servie). */
  erreur: string | null;
  enVol: boolean;
  demandeLe: number;
  /** Clôture de la bougie supérieure qui suit la dernière reçue (données complètes avant). */
  prochaineCloture: number;
  rappels: Set<() => void>;
  /** Calculs par définition et paramètres, valables pour `bougies` (vidés à chaque réception). */
  calculs: Map<string, IndicatorResult>;
}

const cache = new Map<string, Entree>();

/** Vide le cache et les refus d'alignement de la session (tests). */
export function viderCacheUnite(): void {
  cache.clear();
  oublierRefusAlignement();
}

/** Ouverture non alignée sur l'unité : la place sert toujours ainsi, refus durable. */
class ErreurAlignement extends Error {}

/** Ouverture alignée sur l'unité : multiple exact de sa durée depuis l'époque (1w : lundi). */
export function ouvertureAlignee(time: number, unite: Timeframe): boolean {
  const duree = DUREE_UNITE[unite];
  if (duree === undefined) return false;
  const decalage = unite === "1w" ? DECALAGE_LUNDI_MS : 0;
  return (((time - decalage) % duree) + duree) % duree === 0;
}

/**
 * Bougies CLOSES à `maintenant` depuis au moins `MARGE_CLOTURE_MS`, dédoublonnées et
 * triées. Lève si une ouverture n'est pas alignée UTC : le calcul ne porterait pas sur les
 * périodes que l'unité désigne.
 */
export function bougiesCloses(brutes: readonly Candle[], unite: Timeframe, maintenant: number): Candle[] {
  const duree = DUREE_UNITE[unite];
  if (duree === undefined) throw new Error(`unité ${unite} non gérée`);
  const parTemps = new Map<number, Candle>();
  for (const c of brutes) parTemps.set(c.time, c);
  const triees = [...parTemps.values()].sort((a, b) => a.time - b.time);
  const decalee = triees.find((c) => !ouvertureAlignee(c.time, unite));
  if (decalee !== undefined) {
    const attendu = unite === "1w" ? "lundi 00:00 UTC" : "UTC";
    throw new ErreurAlignement(`Bougie ${unite} ouverte le ${new Date(decalee.time).toISOString()}, non alignée (${attendu})`);
  }
  return triees.filter((c) => c.closed !== false && c.time + duree + MARGE_CLOTURE_MS <= maintenant);
}

/**
 * Bougies reçues à AJOUTER à la fenêtre détenue (celles postérieures à sa dernière bougie),
 * ou `null` si un trou les en sépare : la place ne sert plus la suite (longue veille), la
 * fenêtre doit repartir. Les bougies déjà détenues ne sont jamais remplacées. PURE.
 */
export function suiteFenetre(derniere: Candle, recues: readonly Candle[], duree: number): Candle[] | null {
  const premiere = recues[0];
  if (premiere !== undefined && premiere.time > derniere.time + duree) return null;
  return recues.filter((c) => c.time > derniere.time);
}

function lancer(e: Entree, exchange: ExchangeId, symbol: string, unite: Timeframe, limite: number): void {
  e.enVol = true;
  e.demandeLe = Date.now();
  const duree = DUREE_UNITE[unite] ?? 0;
  let requete: Promise<Candle[]>;
  try {
    requete = getAdapter(exchange).fetchKlines(symbol, unite, { limit: limite });
  } catch (err) {
    requete = Promise.reject(err); // place non câblée : même chemin qu'un échec réseau
  }
  void requete
    .then((brutes) => {
      const closes = bougiesCloses(brutes, unite, Date.now());
      const detenues = e.bougies;
      const derniereDetenue = detenues?.[detenues.length - 1];
      const suite = derniereDetenue === undefined ? null : suiteFenetre(derniereDetenue, closes, duree);
      let bougies: Candle[];
      if (detenues === null || suite === null) {
        // Premier chargement, ou longue veille : seul cas où le début de la fenêtre change.
        if (closes.length === 0) throw new Error(`aucune bougie ${unite} close reçue`);
        bougies = closes;
        e.historiqueCourt = brutes.length < Math.min(limite, PLAFOND_REQUETE[exchange] ?? limite);
      } else {
        bougies = suite.length > 0 ? [...detenues, ...suite] : detenues;
      }
      if (bougies !== detenues) {
        e.bougies = bougies;
        e.calculs = new Map();
      }
      e.erreur = null;
      const derniere = bougies[bougies.length - 1];
      if (derniere !== undefined) e.prochaineCloture = derniere.time + 2 * duree;
    })
    .catch((err: unknown) => {
      // La fenêtre détenue reste servie : la repartir de zéro repeindrait les cumulatives.
      e.erreur = err instanceof Error ? err.message : "échec du chargement";
      if (err instanceof ErreurAlignement) noterRefusAlignement(exchange, symbol, unite, `${e.erreur} : unité refusée pour la session`);
    })
    .finally(() => {
      e.enVol = false;
      const rappels = [...e.rappels];
      e.rappels.clear();
      for (const rappel of rappels) {
        try {
          rappel(); // un graphe démonté ne doit pas priver les autres de la réponse
        } catch (err) {
          console.error("[AXIOM] unité supérieure : recalcul après réception échoué", err);
        }
      }
    });
}

/** Lit (et relance au besoin) les bougies supérieures d'une clé de cache. */
function lireBougies(
  exchange: ExchangeId,
  symbol: string,
  unite: Timeframe,
  limite: number,
  rappel: () => void,
): { status: "pending" } | { status: "error"; raison: string } | { status: "ready"; entree: Entree } {
  const cle = `${exchange}|${symbol}|${unite}|${limite}`;
  let e = cache.get(cle);
  if (e === undefined) {
    e = {
      bougies: null,
      historiqueCourt: false,
      erreur: null,
      enVol: false,
      demandeLe: 0,
      prochaineCloture: 0,
      rappels: new Set(),
      calculs: new Map(),
    };
    for (const ancienne of cache.keys()) {
      if (cache.size < MAX_ENTREES) break;
      cache.delete(ancienne);
    }
  } else {
    cache.delete(cle); // ordre d'insertion = ordre de lecture (éviction LRU)
  }
  cache.set(cle, e);

  const maintenant = Date.now();
  if (e.enVol) {
    e.rappels.add(rappel);
  } else if (e.erreur !== null) {
    if (maintenant - e.demandeLe >= ERREUR_TTL_MS) {
      e.rappels.add(rappel);
      lancer(e, exchange, symbol, unite, limite);
    } else if (e.bougies === null) {
      return { status: "error", raison: `Bougies ${unite} indisponibles : ${e.erreur}` };
    }
  } else if (e.bougies === null) {
    e.rappels.add(rappel);
    lancer(e, exchange, symbol, unite, limite);
  } else if (maintenant >= e.prochaineCloture + MARGE_CLOTURE_MS) {
    // Une bougie supérieure a clos (marge comprise) depuis la dernière réception : UNE
    // requête. Si la précédente partait déjà après cette clôture et sa marge, la place ne
    // la servait pas encore : on espace les essais.
    const enRetard = e.demandeLe >= e.prochaineCloture + MARGE_CLOTURE_MS;
    if (!enRetard || maintenant - e.demandeLe >= RELANCE_RETARD_MS) {
      e.rappels.add(rappel);
      lancer(e, exchange, symbol, unite, limite);
    }
  }
  if (e.bougies === null) return { status: "pending" };
  return { status: "ready", entree: e };
}

/** Paramètres transmis au calcul : tout sauf la clé réservée. */
function sansUnite(params: Params): Params {
  const reste: Params = {};
  for (const [cle, valeur] of Object.entries(params)) if (cle !== CLE_UNITE) reste[cle] = valeur;
  return reste;
}

function estFini(v: number | undefined): boolean {
  return typeof v === "number" && Number.isFinite(v);
}

/** Premier indice où l'une des sorties `cles` a une valeur finie, ou `undefined`. */
function premiereValeur(result: IndicatorResult, cles: readonly string[]): number | undefined {
  let premier: number | undefined;
  for (const cle of cles) {
    const k = (result.series[cle] ?? []).findIndex((v) => estFini(v));
    if (k >= 0 && (premier === undefined || k < premier)) premier = k;
  }
  return premier;
}

/** Indice de la dernière bougie supérieure close à l'instant `t`, ou `undefined`. */
function derniereClose(bougies: readonly Candle[], dureeSup: number, t: number): number | undefined {
  let k: number | undefined;
  for (let j = 0; j < bougies.length && (bougies[j]?.time ?? Infinity) + dureeSup <= t; j++) k = j;
  return k;
}

/**
 * Calcule l'instance sur son unité supérieure et projette le résultat sur les bougies du
 * graphe. `rappel` est appelé quand des bougies supérieures arrivent (ou échouent) : le
 * graphe recalcule alors cette seule instance.
 */
export function calculerSurUnite(d: DemandeUnite, rappel: () => void): EtatUnite {
  const raison = raisonUniteRefusee(d.def, { exchange: d.exchange, symbol: d.symbol, timeframe: d.timeframe }, d.unite);
  if (raison !== null) return { status: "refus", raison };
  const unite = d.unite as Timeframe; // validée ci-dessus parmi les couples admis
  const dureeSup = DUREE_UNITE[unite];
  const dureeGraphe = DUREE_UNITE[d.timeframe];
  if (dureeSup === undefined || dureeGraphe === undefined) return { status: "refus", raison: `Unité ${d.unite} non gérée` };

  const limite = Math.max(LIMITE_BOUGIES_UNITE, d.def.amorceBougies ?? 0);
  const lu = lireBougies(d.exchange, d.symbol, unite, limite, rappel);
  if (lu.status !== "ready") return lu;
  const e = lu.entree;
  const bougies = e.bougies ?? [];

  const params = sansUnite(d.params);
  const cleCalcul = `${d.def.id}|${JSON.stringify(Object.entries(params).sort(([a], [b]) => (a < b ? -1 : 1)))}`;
  let sup = e.calculs.get(cleCalcul);
  if (sup === undefined) {
    sup = computeIndicator(d.def, bougies, params, undefined, unite);
    e.calculs.set(cleCalcul, sup);
  }
  // Filet : un def non relevé dans DEFS_EXCLUES_UNITE qui produirait des annotations.
  if (sup.annotations !== undefined) return { status: "refus", raison: "Annotations non projetables sur une autre unité" };

  const maintenant = Date.now();
  const tempsGraphe = d.candles.map((c) => c.time);
  const ouvertures = bougies.map((c) => c.time);
  const series: IndicatorResult["series"] = {};
  for (const output of d.def.outputs) {
    const projete = projeterSurUnite(tempsGraphe, dureeGraphe, ouvertures, dureeSup, sup.series[output.key] ?? []);
    for (let i = 0; i < projete.length; i++) {
      const cloture = (tempsGraphe[i] ?? 0) + dureeGraphe;
      // Bougie close qui attend une bougie supérieure pas encore reçue : absente, pas périmée.
      if (cloture >= e.prochaineCloture && cloture <= maintenant) projete[i] = undefined;
    }
    series[output.key] = projete;
  }

  return { status: "ready", result: { series }, nbBougies: bougies.length, partiel: raisonPartiel(d, e, sup, unite, dureeSup, dureeGraphe) };
}

/**
 * « Partiel » : rechargement en échec (valeurs récentes en attente), ou début du graphe
 * sans valeur alors que la série supérieure en a plus loin, parce que la première bougie
 * du graphe lit une bougie supérieure encore dans l'amorce, ou antérieure à la fenêtre.
 * Une sortie creuse (valeur absente par nature) n'est pas signalée si une valeur la précède.
 */
function raisonPartiel(
  d: DemandeUnite,
  e: Entree,
  sup: IndicatorResult,
  unite: Timeframe,
  dureeSup: number,
  dureeGraphe: number,
): string | null {
  if (e.erreur !== null) return `Bougies ${unite} : rechargement en échec (${e.erreur}), valeurs récentes en attente`;
  const debut = d.candles[0];
  const bougies = e.bougies ?? [];
  const tracees = d.def.outputs.filter((o) => o.masquee !== true).map((o) => o.key);
  const premiere = premiereValeur(sup, tracees);
  if (debut === undefined || premiere === undefined) return null;
  const lue = derniereClose(bougies, dureeSup, debut.time + dureeGraphe);
  if (lue !== undefined && premiere <= lue) return null;
  return e.historiqueCourt
    ? `${bougies.length} bougies ${unite} : historique trop court pour le début du graphe`
    : `${bougies.length} bougies ${unite} chargées : profondeur insuffisante pour le début du graphe`;
}
