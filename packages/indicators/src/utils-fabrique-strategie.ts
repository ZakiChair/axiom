/**
 * @axiom/indicators — utils-fabrique-strategie.ts
 *
 * Fabrique de defs « stratégie » (catégorie strategy, pane overlay) : à partir
 * d'une fonction d'état PURE `position` (1 long / 0 flat / −1 short, décidée à
 * la clôture de chaque bougie), produit les TRADES aux transitions et les rend
 * via le canal d'annotations v2.1 : ▲/▼ d'entrée (marqueur au low/high), label
 * de sortie « ±x.xx % » (couleur par signe du PnL), segment pointillé
 * entrée→sortie (désactivable par l'input commun `lignesTrades`), plus une
 * série `prixEntree` à l'échelle prix (breakeven visuel — JAMAIS de série
 * −1/0/+1 en overlay : l'auto-scale du pane prix inclut les figures).
 *
 * Honnêteté (conventions figées) :
 *  - prix d'entrée/sortie = CLOSE de la bougie de signal (le moteur de backtest
 *    de la fenêtre BT, lui, remplit à l'open de la bougie SUIVANTE — écart
 *    assumé : les marqueurs montrent le signal, le backtest mesure l'exécution) ;
 *  - PnL affiché HORS FRAIS (mention dans l'info des segments) ;
 *  - anti-repaint : transitions évaluées sur i ∈ [1, n−2] (jamais la dernière
 *    bougie, potentiellement en formation) ;
 *  - le PREMIER état défini après warm-up est matérialisé en silence : aucun
 *    événement ET aucun trade ouvert (pas de prix d'entrée connu) — le premier
 *    marqueur ne peut venir que d'une transition entre deux états définis ;
 *  - `undefined` au MILIEU de la série = maintien de l'état précédent.
 *  - cap MAX_TRADES_ANNOTES trades clos annotés (les plus récents) ; le trade
 *    en cours est toujours annoté.
 */

import type {
  AnnotationsIndicateur,
  CalcContext,
  Candle,
  IndicatorDef,
  IndicatorInput,
  LabelAnnotation,
  MarqueurAnnotation,
  SegmentAnnotation,
  Timeframe,
} from "@axiom/types";
import { buildCalcContext, resolveParams } from "./engine";

export type EtatStrategie = 1 | 0 | -1;

export interface SpecStrategie {
  id: string;
  name: string;
  /** Inputs propres à la stratégie, placés AVANT l'input commun `lignesTrades`. */
  inputsStrategie: IndicatorInput[];
  precision?: number;
  minTimeframe?: Timeframe;
  /** Statut de validation (campagne de rejeu) — porté par une donnée, pas par le nom. */
  validation?: IndicatorDef["validation"];
  /** État de position DÉSIRÉ par bougie (décidé à la clôture). PURE. */
  position: (
    candles: Candle[],
    params: Record<string, number | boolean | string>,
    ctx: CalcContext
  ) => Array<EtatStrategie | undefined>;
  /** Textes FR des tooltips, résolus avec les params effectifs. */
  libelles: (params: Record<string, number | boolean | string>) => {
    long: string;
    short: string;
    sortie: string;
  };
}

/** Cap de trades clos annotés (les plus récents) — borne le coût du rendu. */
export const MAX_TRADES_ANNOTES = 60;

/**
 * Nombre de sorties portant une ÉTIQUETTE de résultat (« ±x.xx % »). Les autres gardent
 * leur marqueur et leur segment : le détail reste accessible au survol via le tooltip
 * du crosshair.
 *
 * Une étiquette par sortie — jusqu'à 60 — c'était l'anti-patron « une valeur sur chaque
 * point » : les textes se chevauchaient entre eux, avec ceux des divergences et avec
 * les mèches, au point de rendre le prix illisible sur un pas de temps actif
 * (revue du 2026-08-01 § 6.3).
 */
export const MAX_LABELS_SORTIE = 10;

const INPUT_LIGNES_TRADES: IndicatorInput = {
  key: "lignesTrades",
  name: "Lignes de trades",
  type: "boolean",
  default: true,
};

function fmtSigne(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
}

function fmtPrix(v: number): string {
  return v.toFixed(2);
}

/** Trade reconstruit depuis les transitions d'état. */
export interface TradeStrategie {
  sens: 1 | -1;
  idxEntree: number;
  prixEntree: number;
  idxSortie?: number;
  prixSortie?: number;
  pnlPct?: number;
}

/**
 * Reconstruction PURE des trades depuis une série d'états (logique EXACTE de
 * la fabrique, extraite) : fill-forward (un trou `undefined` au milieu
 * maintient l'état précédent) puis trades aux transitions (bougies clôturées :
 * i ∈ [1, n−2] — anti-repaint, jamais la dernière bougie potentiellement en
 * formation). Le premier état défini a un `prev` undefined → jamais
 * d'événement (matérialisation silencieuse, pas de prix d'entrée connu).
 */
export function construireTradesStrategie(
  candles: Candle[],
  etats: Array<EtatStrategie | undefined>
): { trades: TradeStrategie[]; ouvert: TradeStrategie | null } {
  const n = candles.length;

  // État EFFECTIF : un trou (undefined) au milieu maintient l'état précédent.
  const effectif: Array<EtatStrategie | undefined> = new Array(n).fill(undefined);
  let courant: EtatStrategie | undefined = undefined;
  for (let i = 0; i < n; i++) {
    const e = etats[i];
    if (e !== undefined) courant = e;
    effectif[i] = courant;
  }

  // Trades aux transitions (bougies clôturées : i ∈ [1, n−2]). Le premier
  // état défini a un `prev` undefined → jamais d'événement (silencieux).
  const trades: TradeStrategie[] = [];
  let ouvert: TradeStrategie | null = null;
  for (let i = 1; i <= n - 2; i++) {
    const prev = effectif[i - 1];
    const cur = effectif[i];
    if (prev === undefined || cur === undefined || prev === cur) continue;
    const close = candles[i]?.close;
    if (close === undefined || !Number.isFinite(close)) continue;
    if (prev !== 0 && ouvert !== null) {
      ouvert.idxSortie = i;
      ouvert.prixSortie = close;
      ouvert.pnlPct = ((close - ouvert.prixEntree) / ouvert.prixEntree) * 100 * ouvert.sens;
      trades.push(ouvert);
      ouvert = null;
    }
    if (cur !== 0) ouvert = { sens: cur, idxEntree: i, prixEntree: close };
  }

  return { trades, ouvert };
}

/**
 * Specs enregistrées par defStrategie (rejeu scripté : campagne de backtest).
 * Remplie par EFFET DE BORD à l'évaluation des modules de stratégie : un
 * consommateur doit avoir importé le module de la stratégie (ou `./registry`,
 * qui les importe toutes) avant que `etatsStrategie(id)`/`specStrategie(id)`
 * résolvent — c'est le prix de l'anti-cycle (voir `etatsStrategie` ci-dessous).
 * Un id ré-enregistré ÉCRASE l'entrée précédente (dernier appel gagne) : sans
 * incidence en usage normal (chaque id de stratégie n'est défini qu'une fois),
 * mais les tests réutilisent l'id `stratTest` sans isolation — assumé.
 */
const SPECS_STRATEGIES = new Map<string, SpecStrategie>();

export function specStrategie(id: string): SpecStrategie | undefined {
  return SPECS_STRATEGIES.get(id);
}

/**
 * États d'une stratégie du registre : résout les params (défauts + overrides)
 * et appelle `spec.position`. `undefined` si `defId` inconnu ou non-stratégie.
 * ANTI-CYCLE : ne dépend JAMAIS de `./registry` (qui importe les stratégies,
 * qui importent cette fabrique) — passe par `SPECS_STRATEGIES` et reconstruit
 * le def minimal nécessaire à `resolveParams`/`buildCalcContext`.
 */
export function etatsStrategie(
  defId: string,
  candles: Candle[],
  params?: Record<string, number | boolean | string>
): Array<EtatStrategie | undefined> | undefined {
  const spec = SPECS_STRATEGIES.get(defId);
  if (spec === undefined) return undefined;
  const defMin: IndicatorDef = {
    id: spec.id,
    name: spec.name,
    category: "strategy",
    pane: "overlay",
    inputs: [...spec.inputsStrategie, INPUT_LIGNES_TRADES],
    outputs: [{ key: "prixEntree", name: "Prix d'entrée", style: "line" }],
    calc: () => ({ series: {} }), // factice : resolveParams ne lit que def.inputs
  };
  const resolved = resolveParams(defMin, params);
  const sourceKey = typeof resolved.source === "string" ? resolved.source : "close";
  const ctx = buildCalcContext(candles, sourceKey);
  return spec.position(candles, resolved, ctx);
}

export function defStrategie(spec: SpecStrategie): IndicatorDef {
  const def: IndicatorDef = {
    id: spec.id,
    name: spec.name,
    ...(spec.validation !== undefined ? { validation: spec.validation } : {}),
    category: "strategy",
    pane: "overlay",
    inputs: [...spec.inputsStrategie, INPUT_LIGNES_TRADES],
    outputs: [{ key: "prixEntree", name: "Prix d'entrée", style: "line" }],
    calc(candles, params, ctx) {
      const n = candles.length;
      const etats = spec.position(candles, params, ctx);
      const lib = spec.libelles(params);
      const lignesTrades = params.lignesTrades !== false;

      const { trades, ouvert } = construireTradesStrategie(candles, etats);

      // Série prixEntree : le prix d'entrée répété tant que la position vit.
      const prixEntree: Array<number | undefined> = new Array(n).fill(undefined);
      const remplir = (t: TradeStrategie, fin: number) => {
        for (let j = t.idxEntree; j <= fin; j++) prixEntree[j] = t.prixEntree;
      };
      for (const t of trades) remplir(t, t.idxSortie ?? n - 1);
      if (ouvert !== null) remplir(ouvert, n - 1);

      // Annotations (cap : les MAX_TRADES_ANNOTES trades clos les plus récents
      // + le trade en cours, toujours annoté).
      const marqueurs: MarqueurAnnotation[] = [];
      const labels: LabelAnnotation[] = [];
      const segments: SegmentAnnotation[] = [];
      // Les `n` derniers trades clos portent une étiquette ; les plus anciens non.
      const clos = trades.slice(-MAX_TRADES_ANNOTES);
      const avecLabel = new Set(clos.slice(-MAX_LABELS_SORTIE));
      const annoter = (t: TradeStrategie, etiquette = true) => {
        const bEntree = candles[t.idxEntree];
        if (bEntree === undefined) return;
        const libEntree = t.sens === 1 ? lib.long : lib.short;
        const sens = t.sens === 1 ? "long" : "short";
        marqueurs.push({
          idx: t.idxEntree,
          valeur: t.sens === 1 ? bEntree.low : bEntree.high,
          forme: t.sens === 1 ? "triangleHaut" : "triangleBas",
          couleur: t.sens === 1 ? "--up" : "--down",
          cible: "prix",
          info: `Entrée ${sens} ${fmtPrix(t.prixEntree)} — ${libEntree}`,
        });
        if (t.idxSortie === undefined || t.prixSortie === undefined || t.pnlPct === undefined) return;
        const bSortie = candles[t.idxSortie];
        if (bSortie === undefined) return;
        const gagnant = t.pnlPct >= 0;
        if (etiquette) labels.push({
          idx: t.idxSortie,
          valeur: t.sens === 1 ? bSortie.high : bSortie.low,
          texte: `${fmtSigne(t.pnlPct)} %`,
          couleur: gagnant ? "--up" : "--down",
          cible: "prix",
          position: t.sens === 1 ? "dessus" : "dessous",
          info: `Sortie ${sens} ${fmtPrix(t.prixSortie)} (${fmtSigne(t.pnlPct)} %) — ${lib.sortie}`,
        });
        if (lignesTrades) {
          segments.push({
            deIdx: t.idxEntree,
            deValeur: t.prixEntree,
            aIdx: t.idxSortie,
            aValeur: t.prixSortie,
            trait: "pointille",
            couleur: gagnant ? "--up" : "--down",
            cible: "prix",
            info:
              `${t.sens === 1 ? "Long" : "Short"} ${fmtPrix(t.prixEntree)} → ${fmtPrix(t.prixSortie)}, ` +
              `${fmtSigne(t.pnlPct)} % en ${t.idxSortie - t.idxEntree} bougies (hors frais) — ${libEntree}`,
          });
        }
      };
      for (const t of clos) annoter(t, avecLabel.has(t));
      if (ouvert !== null) annoter(ouvert); // le trade EN COURS est toujours étiqueté

      const annotations: AnnotationsIndicateur = {};
      if (segments.length > 0) annotations.segments = segments;
      if (marqueurs.length > 0) annotations.marqueurs = marqueurs;
      if (labels.length > 0) annotations.labels = labels;
      return Object.keys(annotations).length > 0
        ? { series: { prixEntree }, annotations }
        : { series: { prixEntree } };
    },
  };
  if (spec.precision !== undefined) def.precision = spec.precision;
  if (spec.minTimeframe !== undefined) def.minTimeframe = spec.minTimeframe;
  SPECS_STRATEGIES.set(spec.id, spec);
  return def;
}
