/**
 * EQS ouvert — conditions de l'étage indicateurs (logique PURE, testable hors navigateur).
 *
 * Deux sortes de conditions (types dans data/screener.ts) :
 *  - les CHAMPS (`kind: "indicator"`) : catalogue historique (RSI, EMA, MACD, ADX, BBW)
 *    complété ici par le flux (RVOL, taker net, pente du CVD) et la force relative
 *    (RS Mansfield 52 semaines, z du spread log contre la référence) ;
 *  - les RÈGLES (`kind: "regle"`) : le modèle de conditions du backtest
 *    (@axiom/backtest, comparaison ou croisement de deux opérandes), même sémantique que
 *    `evaluerCondition` du moteur (packages/backtest/src/engine.ts).
 *
 * Toutes se lisent sur des bougies CLÔTURÉES : l'appelant (data/screenerEtage.ts) écarte
 * la bougie en formation, sans quoi un croisement « dans les K dernières bougies »
 * apparaîtrait puis disparaîtrait pendant la bougie. Une valeur absente reste absente
 * (« indisponible ») : jamais de 0 de remplacement.
 *
 * Module chargé À LA DEMANDE (worker, fenêtre et store du screener) : data/screener.ts,
 * différé lui aussi, n'en connaît que les types.
 */
import type { Candle, IndicatorInstance, IndicatorResult, Timeframe } from "@axiom/types";
import {
  alignAux,
  computeIndicator,
  getIndicator,
  resolveParams,
  supportsIndicatorTimeframe,
  TIMEFRAME_REQUIS,
} from "@axiom/indicators";
import {
  raisonOperandeNonCausale,
  raisonTimeframeBacktest,
  type Condition,
  type Operande,
} from "@axiom/backtest";
import {
  compareOp,
  INDICATOR_FIELDS,
  SCREENER_TIMEFRAMES,
  type ConditionChamp,
  type ConditionRegle,
  type IndicatorCondition,
  type IndicatorFieldSpec,
  type ScreenerPreset,
} from "./screener";

// ─────────────────────────── Bornes ───────────────────────────

/** Fenêtre K maximale (« vraie sur au moins une des K dernières bougies closes »). */
export const FENETRE_MAX = 50;
/** Plafond de bougies d'une requête `/api/v3/klines` (une requête par symbole et par unité). */
export const LIMITE_KLINES_BINANCE = 1000;
/** Fenêtre maximale de la pente du CVD (bougies). */
const PENTE_MAX = 200;

/**
 * Defs à fenêtre FINIE (aucune récursion) : la sortie ne dépend que des `length`
 * dernières bougies, l'amorce vaut donc la fenêtre. Les autres (EMA, lissages de Wilder,
 * MACD, Supertrend…) demandent ~4 fois leur longueur pour converger vers la valeur du
 * graphe, qui dispose d'un long historique.
 */
const DEFS_FENETRE_FINIE = new Set([
  "sma",
  "bollinger",
  "bbBandwidth",
  "disparity",
  "spreadZScore",
  "relativeVolume",
  "takerNetPct",
  "cvd",
  "narrowRange",
  "cci",
  "downsideVariance",
]);

// ─────────────────────────── Champs : flux et force relative ───────────────────────────

/**
 * Champs ajoutés au catalogue historique (INDICATOR_FIELDS). Lus sur la dernière bougie
 * CLOSE (ou dans la fenêtre K). Aucun indicateur nouveau : définitions existantes du
 * registre, seule la dérivation (pente, ratio) est faite ici.
 */
export const CHAMPS_SUPPLEMENTAIRES: IndicatorFieldSpec[] = [
  {
    id: "rvol",
    label: "RVOL",
    indicatorId: "relativeVolume",
    output: "rvol",
    paramKey: "length",
    defaultParam: 20,
    derive: "last",
    unit: "×",
    famille: "flux",
    aide:
      "Volume de la bougie close ÷ moyenne simple des N dernières bougies (elle comprise). " +
      "En 15m et 1h, l'ouverture des sessions gonfle le RVOL simple.",
  },
  {
    id: "takerNet",
    label: "Taker net",
    indicatorId: "takerNetPct",
    output: "net",
    derive: "last",
    unit: "%",
    besoin: "taker",
    famille: "flux",
    aide:
      "(achats − ventes au marché) ÷ volume de la bougie close, en %. Volume taker Binance " +
      "spot seulement ; indisponible sans ce champ.",
  },
  {
    id: "cvdPente",
    label: "Pente CVD / volume",
    indicatorId: "cvd",
    output: "cvd",
    paramKey: "bougies",
    defaultParam: 3,
    paramDerivation: true,
    derive: "penteNorm",
    unit: "%",
    besoin: "taker",
    famille: "flux",
    aide:
      "Variation du CVD sur les N dernières bougies closes ÷ volume de ces N bougies, en %. " +
      "Indisponible si l'une d'elles n'a pas de volume taker.",
  },
  {
    id: "rsMansfield",
    label: "RS Mansfield",
    indicatorId: "disparity",
    output: "disparity",
    paramKey: "length",
    defaultParam: 364,
    derive: "rsMansfield",
    unit: "%",
    besoin: "ref",
    tfImpose: "1d",
    famille: "force-relative",
    aide:
      "100 × (ratio ÷ moyenne simple du ratio − 1), ratio = close ÷ close de la référence, " +
      "en 1d sur 364 jours (52 semaines) : disparity posé sur le ratio. Descriptif, aucun " +
      "avantage mesuré.",
  },
  {
    id: "rsZ",
    label: "RS z",
    indicatorId: "spreadZScore",
    output: "z",
    paramKey: "length",
    defaultParam: 100,
    derive: "last",
    unit: "σ",
    besoin: "ref",
    famille: "force-relative",
    aide:
      "Z-score du log-ratio close ÷ référence sur N bougies (spreadZScore). Descriptif, " +
      "aucun avantage mesuré.",
  },
];

/** Catalogue complet des champs (historiques + flux + force relative). */
export const TOUS_LES_CHAMPS: IndicatorFieldSpec[] = [...INDICATOR_FIELDS, ...CHAMPS_SUPPLEMENTAIRES];

/** Résout un champ (historique ou ajouté) par son id. */
export function champParId(id: string): IndicatorFieldSpec | undefined {
  return TOUS_LES_CHAMPS.find((f) => f.id === id);
}

// ─────────────────────────── Unité, fenêtre, validation ───────────────────────────

/** Unité effective d'une condition : imposée par le champ, sinon la sienne, sinon celle du run. */
export function uniteCondition(cond: IndicatorCondition, tfRun: Timeframe): Timeframe {
  if (cond.kind === "indicator") {
    const impose = champParId(cond.fieldId)?.tfImpose;
    if (impose !== undefined) return impose;
  }
  return cond.tf ?? tfRun;
}

/** Fenêtre K effective (1 par défaut). */
export function fenetreCondition(cond: IndicatorCondition): number {
  return cond.fenetre ?? 1;
}

/** Opérandes d'une condition du modèle backtest. */
export function operandesCondition(c: Condition): Operande[] {
  return c.type === "comparaison" ? [c.gauche, c.droite] : [c.a, c.b];
}

/** Paramètres passés au def d'un champ (le paramètre de dérivation n'y va jamais). */
export function paramsChamp(
  spec: IndicatorFieldSpec,
  cond: ConditionChamp,
): Record<string, number> {
  const params: Record<string, number> = {};
  if (spec.paramKey !== undefined && spec.paramDerivation !== true) {
    const p = cond.param ?? spec.defaultParam;
    if (p !== undefined) params[spec.paramKey] = p;
  }
  return params;
}

/** Fenêtre de dérivation d'un champ à pente (entier ≥ 1). */
function fenetrePente(spec: IndicatorFieldSpec, cond: ConditionChamp): number {
  return Math.round(cond.param ?? spec.defaultParam ?? 1);
}

/**
 * Raison de refus d'une condition (null = évaluable). Refuse : unité hors des intervalles
 * natifs, fenêtre hors bornes, def inconnu ou incompatible avec l'unité (contrat
 * `supportsIndicatorTimeframe`), sorties non causales (garde du backtest), defs à série
 * auxiliaire (non fournie au screener, hors force relative) et amorces hors de portée
 * d'une requête Binance.
 */
export function raisonCondition(cond: IndicatorCondition, tfRun: Timeframe): string | null {
  const tf = uniteCondition(cond, tfRun);
  if (!SCREENER_TIMEFRAMES.includes(tf)) return `unité ${tf} non proposée`;
  const k = fenetreCondition(cond);
  if (!Number.isInteger(k) || k < 1 || k > FENETRE_MAX) {
    return `fenêtre K entre 1 et ${FENETRE_MAX} bougies closes`;
  }

  if (cond.kind === "indicator") {
    const spec = champParId(cond.fieldId);
    if (spec === undefined) return `champ inconnu (${cond.fieldId})`;
    if (getIndicator(spec.indicatorId) === undefined) return `indicateur absent du registre (${spec.indicatorId})`;
    if (!supportsIndicatorTimeframe(spec.indicatorId, tf)) {
      return `${spec.label} : intervalle ${TIMEFRAME_REQUIS[spec.indicatorId] ?? "?"} requis`;
    }
    if (!Number.isFinite(cond.value)) return "seuil non numérique";
    if (cond.param !== undefined && (!Number.isFinite(cond.param) || cond.param <= 0)) {
      return `${spec.label} : paramètre invalide`;
    }
    if (spec.paramDerivation === true) {
      const n = fenetrePente(spec, cond);
      if (n < 1 || n > PENTE_MAX) return `${spec.label} : fenêtre de pente entre 1 et ${PENTE_MAX}`;
    }
    return null;
  }

  const c = cond.condition;
  if (raisonOperandeNonCausale([c]) !== null) return "sortie non causale (réécrit le passé)";
  const tfKo = raisonTimeframeBacktest([c], tf);
  if (tfKo !== null) return tfKo;
  for (const op of operandesCondition(c)) {
    if (op.type === "constante" && !Number.isFinite(op.valeur)) return "valeur non numérique";
    if (op.type !== "indicateur") continue;
    const def = getIndicator(op.indicateurId);
    if (def === undefined) return `indicateur absent du registre (${op.indicateurId})`;
    if (!def.outputs.some((o) => o.key === op.output)) return `sortie inconnue (${op.indicateurId}.${op.output})`;
    if ((def.aux?.length ?? 0) > 0 || (def.auxFacultatives?.length ?? 0) > 0) {
      return `${def.name} : série auxiliaire non fournie au screener`;
    }
    if ((def.amorceBougies ?? 0) > LIMITE_KLINES_BINANCE) {
      return `${def.name} : amorce de ${def.amorceBougies} bougies, hors d'une requête de ${LIMITE_KLINES_BINANCE}`;
    }
  }
  return null;
}

/**
 * Raison de refus d'une liste de conditions : première condition refusée, ou plus d'UNE
 * unité en plus de celle du run (au plus deux requêtes klines par symbole).
 */
export function raisonConditions(conds: readonly IndicatorCondition[], tfRun: Timeframe): string | null {
  for (let i = 0; i < conds.length; i++) {
    const c = conds[i];
    if (c === undefined) continue;
    const r = raisonCondition(c, tfRun);
    if (r !== null) return `Condition ${i + 1} : ${r}`;
  }
  const unites = new Set<Timeframe>([tfRun, ...conds.map((c) => uniteCondition(c, tfRun))]);
  if (unites.size > 2) {
    return `Au plus une unité en plus de celle du run (${tfRun}) : ${[...unites].join(", ")}`;
  }
  return null;
}

// ─────────────────────────── Amorce ───────────────────────────

/** Bougies par jour des unités du screener (amorces exprimées en jours calendaires). */
const BOUGIES_PAR_JOUR: Record<string, number> = { "15m": 96, "1h": 24, "4h": 6, "1d": 1 };

/**
 * Bougies par jour d'une unité. Une unité hors du screener (refusée par raisonCondition)
 * prend la plus fine, pour ne jamais sous-estimer une amorce en jours.
 */
export function bougiesParJour(tf: Timeframe): number {
  return BOUGIES_PAR_JOUR[tf] ?? 96;
}

/**
 * Paramètres exprimés en JOURS calendaires, et non en bougies : l'amorce vaut alors
 * jours × bougies par jour de l'unité (RVOL saisonnier, 84 jours : 2016 bougies 1h). Les
 * prendre pour des bougies réduirait l'historique en silence (84 bougies 1h = 3,5 jours).
 */
const PARAMS_EN_JOURS: Record<string, string> = { rvolSeasonal: "jours" };

/**
 * Plus grand paramètre numérique résolu d'un def (0 si aucun), pris comme une longueur en
 * bougies. Les paramètres en jours sont traités à part (PARAMS_EN_JOURS).
 */
function plusGrandParam(defId: string, params: Record<string, number | boolean | string>): number {
  const def = getIndicator(defId);
  if (def === undefined) return 0;
  const resolus = resolveParams(def, params);
  let max = 0;
  for (const v of Object.values(resolus)) if (typeof v === "number" && Number.isFinite(v)) max = Math.max(max, v);
  return max;
}

/**
 * Amorce d'un def en bougies de l'unité `tf` : déclarée par le def, sinon historique en
 * jours converti en bougies, sinon fenêtre finie ou ~4 × la plus grande longueur.
 */
function amorceDef(defId: string, params: Record<string, number | boolean | string>, tf: Timeframe): number {
  const def = getIndicator(defId);
  if (def === undefined) return 0;
  if (def.amorceBougies !== undefined) return def.amorceBougies;
  const cleJours = PARAMS_EN_JOURS[defId];
  if (cleJours !== undefined) {
    const jours = Number(resolveParams(def, params)[cleJours]);
    return Number.isFinite(jours) && jours > 0 ? Math.ceil(jours * bougiesParJour(tf)) : 0;
  }
  const len = Math.ceil(plusGrandParam(defId, params));
  return DEFS_FENETRE_FINIE.has(defId) ? len : 4 * len;
}

/**
 * Bougies CLÔTURÉES nécessaires à une condition lue en `tf` (son unité) : amorce de ses
 * defs, plus la fenêtre K, plus une bougie (croisement et pente lisent la bougie
 * précédente).
 */
export function amorceCondition(cond: IndicatorCondition, tf: Timeframe): number {
  const k = fenetreCondition(cond);
  if (cond.kind === "indicator") {
    const spec = champParId(cond.fieldId);
    if (spec === undefined) return k + 1;
    const base = amorceDef(spec.indicatorId, paramsChamp(spec, cond), tf);
    const pente = spec.derive === "penteNorm" ? fenetrePente(spec, cond) : 0;
    return base + pente + k + 1;
  }
  let max = 0;
  for (const op of operandesCondition(cond.condition)) {
    if (op.type === "indicateur") max = Math.max(max, amorceDef(op.indicateurId, op.params, tf));
  }
  return max + k + 1;
}

// ─────────────────────────── Évaluation sur bougies closes ───────────────────────────

type Serie = Array<number | undefined>;

/** État par bougie (true / false / undefined = indisponible) et valeur affichée. */
export interface SerieCondition {
  etat: Array<boolean | undefined>;
  valeur: Serie;
}

/** Contexte d'évaluation d'une condition sur une unité. */
export interface ContexteCondition {
  /** Unité des bougies, passée à computeIndicator (`ctx.timeframe`, comme le graphe). */
  tf: Timeframe;
  /** Bougies CLOSES de la référence à la même unité ; null = référence indisponible. */
  ref?: Candle[] | null;
  /** Mémo des calculs (id + params + référence) partagé entre conditions d'un symbole. */
  cache?: Map<string, IndicatorResult>;
}

/** Valeur finie ou undefined. */
function fini(v: number | undefined): number | undefined {
  return v !== undefined && Number.isFinite(v) ? v : undefined;
}

/** Série entièrement indisponible. */
function vide(n: number): Serie {
  return new Array<number | undefined>(n).fill(undefined);
}

/** Calcul mémoïsé d'un def (undefined si le def est absent du registre). */
function calculer(
  defId: string,
  params: Record<string, number | boolean | string>,
  candles: Candle[],
  ctx: ContexteCondition,
  refClose?: Serie,
): IndicatorResult | undefined {
  const def = getIndicator(defId);
  if (def === undefined) return undefined;
  const cle = `${defId}::${JSON.stringify(params)}::${refClose === undefined ? "" : "ref"}`;
  const enCache = ctx.cache?.get(cle);
  if (enCache !== undefined) return enCache;
  const res = computeIndicator(
    def,
    candles,
    params,
    refClose === undefined ? undefined : { refClose },
    ctx.tf,
  );
  ctx.cache?.set(cle, res);
  return res;
}

/**
 * Clôtures de la référence alignées sur les bougies (appariées à l'ouverture, LOCF :
 * convention `refClose` d'alignAux). undefined partout si la référence manque.
 */
export function refAlignee(candles: Candle[], ref: Candle[] | null | undefined): Serie {
  if (ref === undefined || ref === null || ref.length === 0) return vide(candles.length);
  const points = ref
    .filter((c) => Number.isFinite(c.time) && Number.isFinite(c.close))
    .map((c) => ({ time: c.time, value: c.close }));
  return alignAux(
    candles.map((c) => c.time),
    points,
  );
}

/** Bougies d'un symbole calées sur la référence, et nombre de bougies retirées en fin de série. */
export interface CalageReference {
  candles: Candle[];
  retirees: number;
}

/**
 * Tronque les bougies du symbole à la dernière heure d'ouverture que la référence possède
 * AUSSI. La référence est chargée une fois, au début du run ; un symbole chargé après une
 * clôture a une bougie close de plus, que l'alignement LOCF apparierait à la clôture de
 * référence PRÉCÉDENTE : ratio faux, justement à la bougie lue. Ici, la dernière bougie
 * lue a toujours sa bougie de référence. Aucune heure commune : aucune bougie (conditions
 * indisponibles), jamais une référence d'une autre heure.
 */
export function caleSurReference(candles: Candle[], ref: readonly Candle[]): CalageReference {
  const heures = new Set(ref.map((c) => c.time));
  let fin = candles.length;
  while (fin > 0 && !heures.has(candles[fin - 1]!.time)) fin--;
  return fin === candles.length
    ? { candles, retirees: 0 }
    : { candles: candles.slice(0, fin), retirees: candles.length - fin };
}

/**
 * Mansfield : `disparity(length)` posé sur le ratio close ÷ référence, soit
 * 100 × (rs ÷ SMA(rs) − 1). Calculé par tronçon CONTINU où le ratio existe : la moyenne
 * glissante ne traverse jamais un trou, et une valeur ne dépend que du passé (causalité
 * par préfixe).
 */
function serieMansfield(candles: Candle[], refClose: Serie, length: number, ctx: ContexteCondition): Serie {
  const n = candles.length;
  const out = vide(n);
  const def = getIndicator("disparity");
  if (def === undefined) return out;
  const ratioValide = (i: number): number | undefined => {
    const c = candles[i]?.close;
    const r = refClose[i];
    if (c === undefined || r === undefined || !(c > 0) || !(r > 0)) return undefined;
    return fini(c / r);
  };
  let i = 0;
  while (i < n) {
    if (ratioValide(i) === undefined) {
      i++;
      continue;
    }
    const debut = i;
    const ratios: Candle[] = [];
    for (let r = ratioValide(i); r !== undefined; r = ratioValide(++i)) {
      ratios.push({ time: candles[i]!.time, open: r, high: r, low: r, close: r, volume: 0, closed: true });
    }
    const serie = computeIndicator(def, ratios, { length }, undefined, ctx.tf).series.disparity ?? [];
    for (let j = 0; j < ratios.length; j++) out[debut + j] = fini(serie[j]);
  }
  return out;
}

/**
 * Pente du CVD normalisée : 100 × (cvd[i] − cvd[i−N]) ÷ Σ volume des N bougies, soit le
 * delta taker net de la fenêtre en % de son volume. Indisponible si une bougie de la
 * fenêtre n'a pas de volume taker (le CVD y compterait 0 : valeur inventée).
 */
function seriePente(candles: Candle[], cvdSerie: Serie, fenetre: number): Serie {
  const n = candles.length;
  const out = vide(n);
  for (let i = fenetre; i < n; i++) {
    let volume = 0;
    let complet = true;
    for (let j = i - fenetre + 1; j <= i; j++) {
      const c = candles[j];
      if (
        c === undefined ||
        c.buyVolume === undefined ||
        c.sellVolume === undefined ||
        !Number.isFinite(c.buyVolume) ||
        !Number.isFinite(c.sellVolume) ||
        !Number.isFinite(c.volume)
      ) {
        complet = false;
        break;
      }
      volume += c.volume;
    }
    const a = cvdSerie[i];
    const b = cvdSerie[i - fenetre];
    if (!complet || !(volume > 0) || a === undefined || b === undefined) continue;
    out[i] = fini((100 * (a - b)) / volume);
  }
  return out;
}

/** Série de valeurs d'un champ, alignée sur les bougies. */
export function valeursChamp(cond: ConditionChamp, candles: Candle[], ctx: ContexteCondition): Serie {
  const n = candles.length;
  const spec = champParId(cond.fieldId);
  if (spec === undefined) return vide(n);
  const params = paramsChamp(spec, cond);

  if (spec.derive === "rsMansfield") {
    const length = Math.round(cond.param ?? spec.defaultParam ?? 364);
    return serieMansfield(candles, refAlignee(candles, ctx.ref), length, ctx);
  }
  const refClose = spec.besoin === "ref" ? refAlignee(candles, ctx.ref) : undefined;
  const res = calculer(spec.indicatorId, params, candles, ctx, refClose);
  const serie = res?.series[spec.output];
  if (serie === undefined) return vide(n);
  if (spec.derive === "penteNorm") return seriePente(candles, serie, fenetrePente(spec, cond));

  const out = vide(n);
  for (let i = 0; i < n; i++) {
    const v = fini(serie[i]);
    if (v === undefined) continue;
    if (spec.derive === "lastPct") out[i] = v * 100;
    else if (spec.derive === "distPct") {
      const close = fini(candles[i]?.close);
      out[i] = close === undefined || v === 0 ? undefined : (100 * (close - v)) / v;
    } else out[i] = v;
  }
  return out;
}

/** État par bougie d'un champ (`valeur op seuil`). */
export function serieChamp(cond: ConditionChamp, candles: Candle[], ctx: ContexteCondition): SerieCondition {
  const valeur = valeursChamp(cond, candles, ctx);
  return {
    valeur,
    etat: valeur.map((v) => (v === undefined ? undefined : compareOp(v, cond.op, cond.value))),
  };
}

/** Série d'un opérande du modèle backtest (prix, constante, sortie d'indicateur). */
function serieOperande(op: Operande, candles: Candle[], ctx: ContexteCondition): Serie {
  const n = candles.length;
  if (op.type === "constante") return new Array<number | undefined>(n).fill(fini(op.valeur));
  if (op.type === "prix") return candles.map((c) => fini(c[op.champ]));
  const serie = calculer(op.indicateurId, op.params, candles, ctx)?.series[op.output];
  return serie === undefined ? vide(n) : serie.map(fini);
}

/**
 * État par bougie d'une règle. Même sémantique que `evaluerCondition` du moteur de
 * backtest : comparaison à la clôture ; croisement sur les DEUX dernières bougies closes
 * (hausse : a0 ≤ b0 et a1 > b1). Valeur affichée : opérande gauche (ou A).
 */
export function serieRegle(cond: ConditionRegle, candles: Candle[], ctx: ContexteCondition): SerieCondition {
  const c = cond.condition;
  const n = candles.length;
  const etat = new Array<boolean | undefined>(n).fill(undefined);
  if (c.type === "comparaison") {
    const g = serieOperande(c.gauche, candles, ctx);
    const d = serieOperande(c.droite, candles, ctx);
    for (let i = 0; i < n; i++) {
      const gi = g[i];
      const di = d[i];
      if (gi !== undefined && di !== undefined) etat[i] = compareOp(gi, c.comparateur, di);
    }
    return { etat, valeur: g };
  }
  const a = serieOperande(c.a, candles, ctx);
  const b = serieOperande(c.b, candles, ctx);
  for (let i = 1; i < n; i++) {
    const a0 = a[i - 1];
    const b0 = b[i - 1];
    const a1 = a[i];
    const b1 = b[i];
    if (a0 === undefined || b0 === undefined || a1 === undefined || b1 === undefined) continue;
    etat[i] = c.sens === "hausse" ? a0 <= b0 && a1 > b1 : a0 >= b0 && a1 < b1;
  }
  return { etat, valeur: a };
}

/** État par bougie d'une condition quelconque. */
export function serieCondition(
  cond: IndicatorCondition,
  candles: Candle[],
  ctx: ContexteCondition,
): SerieCondition {
  return cond.kind === "indicator" ? serieChamp(cond, candles, ctx) : serieRegle(cond, candles, ctx);
}

/** Lecture d'une condition dans sa fenêtre K. */
export interface LectureFenetre {
  vraie: boolean;
  /**
   * true si l'état est connu (vrai ou faux) sur au moins une bougie de la fenêtre. false =
   * condition NON MESURÉE (historique, volume taker ou référence insuffisants), à ne pas
   * confondre avec une condition fausse. On ne s'appuie pas sur `valeur` : pour
   * « close > EMA », la valeur gauche (close) existe même quand l'EMA manque.
   */
  mesuree: boolean;
  /** Valeur à la bougie déclenchante, sinon à la dernière bougie close (undefined = indisponible). */
  valeur: number | undefined;
  /** Bougies closes depuis la bougie déclenchante (absent si fausse). */
  barresDepuis?: number;
}

/**
 * Vraie si l'état l'est sur au moins une des K dernières bougies (closes) ; retient la
 * plus récente. Fausse si elle ne l'est nulle part ; `mesuree` distingue alors « fausse »
 * (état connu quelque part dans la fenêtre) de « indisponible » (état inconnu partout).
 */
export function lireFenetre(serie: SerieCondition, fenetre: number): LectureFenetre {
  const n = serie.etat.length;
  const debut = Math.max(0, n - Math.max(1, fenetre));
  let mesuree = false;
  for (let i = n - 1; i >= debut; i--) {
    const etat = serie.etat[i];
    if (etat === true) return { vraie: true, mesuree: true, valeur: serie.valeur[i], barresDepuis: n - 1 - i };
    if (etat === false) mesuree = true;
  }
  return { vraie: false, mesuree, valeur: n > 0 ? serie.valeur[n - 1] : undefined };
}

/** Évalue une condition sur les bougies CLOSES de son unité. */
export function evaluerCondition(
  cond: IndicatorCondition,
  candles: Candle[],
  ctx: ContexteCondition,
): LectureFenetre {
  return lireFenetre(serieCondition(cond, candles, ctx), fenetreCondition(cond));
}

// ─────────────────────────── Libellés ───────────────────────────

/** Libellé compact d'un opérande : « close », « 0.5 », « ema(200) », « supertrend.direction(10, 3) ». */
export function libelleOperande(op: Operande): string {
  if (op.type === "prix") return op.champ;
  if (op.type === "constante") return String(op.valeur);
  const def = getIndicator(op.indicateurId);
  const nom = def !== undefined && def.outputs.length > 1 ? `${op.indicateurId}.${op.output}` : op.indicateurId;
  const valeurs = Object.values(op.params).map(String);
  return valeurs.length > 0 ? `${nom}(${valeurs.join(", ")})` : nom;
}

/** Libellé de la condition seule (sans unité ni fenêtre). */
function libelleCoeur(cond: IndicatorCondition): string {
  if (cond.kind === "indicator") {
    const spec = champParId(cond.fieldId);
    if (spec === undefined) return cond.fieldId;
    const p = cond.param ?? spec.defaultParam;
    return spec.paramKey !== undefined && p !== undefined ? `${spec.label}(${p})` : spec.label;
  }
  const c = cond.condition;
  if (c.type === "comparaison") {
    return `${libelleOperande(c.gauche)} ${c.comparateur} ${libelleOperande(c.droite)}`;
  }
  return `${libelleOperande(c.a)} croise ${c.sens === "hausse" ? "↑" : "↓"} ${libelleOperande(c.b)}`;
}

/** Libellé affiché d'une condition : unité si elle diffère du run, fenêtre si K > 1. */
export function libelleCondition(cond: IndicatorCondition, tfRun: Timeframe): string {
  const tf = uniteCondition(cond, tfRun);
  const k = fenetreCondition(cond);
  return `${libelleCoeur(cond)}${tf !== tfRun ? ` [${tf}]` : ""}${k > 1 ? ` · ${k} b.` : ""}`;
}

/** true si au moins une condition lit la série de référence (force relative). */
export function besoinReference(conds: readonly IndicatorCondition[]): boolean {
  return conds.some((c) => c.kind === "indicator" && champParId(c.fieldId)?.besoin === "ref");
}

// ─────────────────────────── Ouverture au graphe ───────────────────────────

/**
 * Instances d'indicateurs à poser sur le graphe ouvert depuis un résultat : celles des
 * conditions de l'unité du run (le graphe s'ouvre à cette unité ; une condition 1d posée
 * sur un graphe 4h y serait recalculée en 4h, donc fausse). Le RS Mansfield (ratio)
 * n'a pas d'instance sur le graphe de l'actif. Dédoublonné par def + paramètres.
 */
export function instancesPourGraphe(
  conds: readonly IndicatorCondition[],
  tfRun: Timeframe,
): IndicatorInstance[] {
  const out: IndicatorInstance[] = [];
  const vues = new Set<string>();
  const ajouter = (defId: string, params: Record<string, number | boolean | string>): void => {
    const cle = `${defId}::${JSON.stringify(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)))}`;
    if (vues.has(cle) || getIndicator(defId) === undefined) return;
    vues.add(cle);
    out.push({ defId, params: { ...params } });
  };
  for (const cond of conds) {
    if (uniteCondition(cond, tfRun) !== tfRun) continue;
    if (cond.kind === "indicator") {
      const spec = champParId(cond.fieldId);
      if (spec === undefined || spec.derive === "rsMansfield") continue;
      ajouter(spec.indicatorId, paramsChamp(spec, cond));
      continue;
    }
    for (const op of operandesCondition(cond.condition)) {
      if (op.type === "indicateur") ajouter(op.indicateurId, op.params);
    }
  }
  return out;
}

// ─────────────────────────── Préréglages descriptifs ───────────────────────────

const ttmOn: Operande = {
  type: "indicateur",
  indicateurId: "ttmSqueeze",
  params: { length: 20, multBB: 2, multKC: 1.5 },
  output: "on",
};
const supertrendDirection: Operande = {
  type: "indicateur",
  indicateurId: "supertrend",
  params: { period: 10, multiplier: 3 },
  output: "direction",
};

/**
 * Préréglages des conditions ouvertes : FILTRES DESCRIPTIFS, jamais des signaux. Aucun
 * n'est passé par l'étude d'évènements (validationSignaux.ts), et la concordance 4h + 1d
 * n'est validée nulle part dans le dépôt.
 */
export const PRESETS_DESCRIPTIFS: ScreenerPreset[] = [
  {
    id: "builtin:squeeze-4h-supertrend-1d",
    name: "Sortie de squeeze 4h, Supertrend 1d haussier",
    tf: "4h",
    baseConditions: [{ kind: "base", field: "volumeUsd24h", op: ">", value: 10_000_000 }],
    indicatorConditions: [
      {
        kind: "regle",
        fenetre: 3,
        condition: { type: "croisement", a: ttmOn, b: { type: "constante", valeur: 0.5 }, sens: "baisse" },
      },
      {
        kind: "regle",
        tf: "1d",
        condition: {
          type: "comparaison",
          gauche: supertrendDirection,
          comparateur: ">",
          droite: { type: "constante", valeur: 0 },
        },
      },
    ],
    builtin: true,
    description:
      "Filtre descriptif, non validé : le squeeze TTM (20, BB 2, KC 1,5) s'est relâché sur l'une des " +
      "3 dernières bougies 4h closes, et le Supertrend (10, 3) est haussier à la dernière clôture 1d.",
  },
  {
    id: "builtin:flux-anormal",
    name: "Flux anormal",
    tf: "4h",
    baseConditions: [{ kind: "base", field: "volumeUsd24h", op: ">", value: 10_000_000 }],
    indicatorConditions: [
      { kind: "indicator", fieldId: "rvol", param: 20, op: ">=", value: 3, fenetre: 3 },
      { kind: "indicator", fieldId: "cvdPente", param: 3, op: ">=", value: 10 },
    ],
    builtin: true,
    description:
      "Filtre descriptif, non validé : volume relatif ≥ 3 sur l'une des 3 dernières bougies 4h closes, " +
      "et achats agressifs nets ≥ 10 % du volume de ces 3 bougies (seuil du delta d'AXIS). " +
      "Le sens des forts achats mesuré varie selon l'unité.",
  },
];
