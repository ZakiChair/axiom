/**
 * Éligibilité d'une instance au calcul sur une unité SUPÉRIEURE (SUG-1, phase 1 : graphe seul).
 *
 * Règles de la reformulation vérifiée (docs/outils-analyse-sources-2026-11-06.md, SUG-1) :
 *  - définitions de PRIX seulement : ni série auxiliaire (requise ou facultative), ni unité
 *    requise (`TIMEFRAME_REQUIS`), ni stratégie, ni annotations indexées, ni lecture différée
 *    (`DEFS_EXCLUES_UNITE`, vérifiée sur tout le registre par uniteSuperieure.test.ts) ;
 *  - places 24/7 aux bougies alignées UTC (Twelve Data : bougies de séance ; synthétique :
 *    jambes composées) ; l'unité doit être servie par la place (Coinbase : pas de 1w) ;
 *  - couples alignés UTC seulement : 1h → 4h/1d, 4h → 1d/1w, 1d → 1w.
 *
 * Chargé à la demande (sélecteur de l'éditeur, `bougiesUnite.ts`) : hors du chemin initial.
 */
import type { ExchangeId, IndicatorDef, Timeframe } from "@axiom/types";
import { TIMEFRAME_REQUIS } from "@axiom/indicators";
import { SUPPORTED_TIMEFRAMES } from "../data/adapters";
import { raisonUnusableIndicateur, type ContexteIndicateur } from "../lib/indicatorUsability";

const HEURE_MS = 3_600_000;
const JOUR_MS = 24 * HEURE_MS;

/** Durée exacte (ms) des unités concernées par la projection. */
export const DUREE_UNITE: Readonly<Partial<Record<Timeframe, number>>> = {
  "1h": HEURE_MS,
  "4h": 4 * HEURE_MS,
  "1d": JOUR_MS,
  "1w": 7 * JOUR_MS,
};

/** Couples alignés UTC : unité du graphe → unités supérieures proposées. */
export const UNITES_SUPERIEURES: Readonly<Partial<Record<Timeframe, readonly Timeframe[]>>> = {
  "1h": ["4h", "1d"],
  "4h": ["1d", "1w"],
  "1d": ["1w"],
};

/** Places 24/7 dont les bougies sont alignées UTC (Twelve Data et synthétique exclus). */
export const PLACES_UNITE: ReadonlySet<ExchangeId> = new Set<ExchangeId>([
  "binance",
  "bybit",
  "okx",
  "hyperliquid",
  "mexc",
  "kraken",
  "coinbase",
]);

/**
 * Définitions écartées malgré le filtre déclaratif (relevé du registre, 2026-11-07) :
 *  - lecture DIFFÉRÉE : la valeur à la bougie k dépend de bougies postérieures (chikou
 *    d'Ichimoku, fractales et pivots confirmés après coup, zigzag). Datée à la clôture
 *    de k, elle anticiperait sur le graphe ;
 *  - ANNOTATIONS indexées sur les bougies du calcul (étiquette de session partielle des
 *    VWAP, rubans et marqueurs des mesures de rendement) : leurs indices ne désignent pas
 *    les bougies du graphe.
 * uniteSuperieure.test.ts recalcule tout le registre : un def admis qui anticipe ou annote
 * fait échouer le test, qui demande de l'ajouter ici.
 */
export const DEFS_EXCLUES_UNITE: ReadonlySet<string> = new Set([
  "ichimoku",
  "fractals",
  "pivotHighLow",
  "zigzag",
  "vwap",
  "vwapBands",
  "narrowRange",
  "rollingDrawdown",
  "downsideVariance",
  "returnAutocorrelation",
]);

/**
 * Refus d'alignement constatés pendant la session, par place, symbole et unité. Une place
 * qui sert des semaines calées sur un autre jour que le lundi (époque : jeudi) les servira
 * toujours ainsi : ce refus est DURABLE, sans nouvel essai, et retire l'unité du sélecteur.
 */
const refusAlignement = new Map<string, string>();

function cleAlignement(exchange: ExchangeId, symbol: string, unite: string): string {
  return `${exchange}|${symbol}|${unite}`;
}

/** Mémorise pour la session qu'une place sert cette unité non alignée (bougiesUnite.ts). */
export function noterRefusAlignement(exchange: ExchangeId, symbol: string, unite: string, motif: string): void {
  refusAlignement.set(cleAlignement(exchange, symbol, unite), motif);
}

/** Oublie les refus d'alignement de la session (tests). */
export function oublierRefusAlignement(): void {
  refusAlignement.clear();
}

/** Motif du refus propre à la définition (indépendant du graphe), ou `null`. */
function raisonDef(def: IndicatorDef): string | null {
  if (def.category === "strategy") return "Stratégie : calcul sur l'unité du graphe uniquement";
  if ((def.aux?.length ?? 0) > 0 || (def.auxFacultatives?.length ?? 0) > 0) {
    return "Séries auxiliaires : calcul sur l'unité du graphe uniquement";
  }
  const requis = TIMEFRAME_REQUIS[def.id];
  if (requis !== undefined) return `Réservé à l'intervalle ${requis}`;
  if (DEFS_EXCLUES_UNITE.has(def.id)) return "Calcul non projetable (lecture différée ou annotations)";
  return null;
}

/** Vrai si la définition peut, en principe, être calculée sur une unité supérieure. */
export function defAdmiseUnite(def: IndicatorDef): boolean {
  return raisonDef(def) === null;
}

/**
 * Motif du refus de `unite` pour cette définition sur ce graphe, ou `null` si le calcul
 * est admis. Le contexte de l'unité supérieure passe aussi par `raisonUnusableIndicateur`
 * (volumes, intervalle minimal) : mêmes règles que le graphe natif de cette unité.
 */
export function raisonUniteRefusee(def: IndicatorDef, ctx: ContexteIndicateur, unite: string): string | null {
  const parDef = raisonDef(def);
  if (parDef !== null) return parDef;
  if (!PLACES_UNITE.has(ctx.exchange)) return "Unité supérieure réservée aux places crypto 24/7";
  const proposees = UNITES_SUPERIEURES[ctx.timeframe] ?? [];
  const tf = proposees.find((u) => u === unite);
  if (tf === undefined) {
    return proposees.length > 0
      ? `Unité ${unite} non proposée sur un graphe ${ctx.timeframe} (${proposees.join(", ")})`
      : `Unité supérieure non proposée sur un graphe ${ctx.timeframe}`;
  }
  if (!(SUPPORTED_TIMEFRAMES[ctx.exchange] ?? []).includes(tf)) return `Intervalle ${tf} non servi par cette place`;
  const nonAlignee = refusAlignement.get(cleAlignement(ctx.exchange, ctx.symbol, tf));
  if (nonAlignee !== undefined) return nonAlignee;
  return raisonUnusableIndicateur(def, { ...ctx, timeframe: tf });
}

/** Unités supérieures admises pour cette définition sur ce graphe (menu de l'éditeur). */
export function unitesProposees(def: IndicatorDef, ctx: ContexteIndicateur): Timeframe[] {
  return (UNITES_SUPERIEURES[ctx.timeframe] ?? []).filter((u) => raisonUniteRefusee(def, ctx, u) === null);
}
