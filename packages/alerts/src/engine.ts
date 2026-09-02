/**
 * @axiom/alerts — engine.ts
 *
 * Moteur d'évaluation des alertes : PUR et SANS I/O (aucune notification, aucun
 * store, aucun accès temps). Il prend un lot de `defs` (filtrées en amont pour un
 * même symbole) + un `ContexteAlerte`, et retourne les déclenchements + les defs
 * mises à jour. Ce même moteur alimentera le daemon de Phase 2 (roadmap 03 §1.7).
 *
 * Modèle de ré-armement (anti-spam) — cf. `AlertDef.arme` :
 *  - Chaque condition « à seuil » (prix hausse/baisse, variation, seuil d'indicateur)
 *    est ramenée à un booléen `satisfaite`, et le moteur déclenche sur le FRONT
 *    montant de ce booléen : armée + satisfaite → déclenche puis désarme ; le
 *    ré-armement n'intervient qu'après retour à `!satisfaite` (re-franchissement
 *    inverse). La toute PREMIÈRE évaluation calibre le côté sans déclencher.
 *  - Les conditions BIDIRECTIONNELLES (prix `les-deux`, croisement d'indicateur)
 *    détectent le front directement (prix précédent / deux dernières valeurs de
 *    série), la première évaluation servant de calibrage.
 */

import type { Candle } from "@axiom/types";
import { computeIndicator, getIndicator } from "@axiom/indicators";
import { decrireCondition } from "./describe";
import type {
  AlertDef,
  Comparateur,
  Condition,
  ContexteAlerte,
  Declenchement,
  ResultatEvaluation,
} from "./types";

/** Nombre max d'horodatages conservés par def (fenêtre glissante). */
const MAX_DECLENCHEMENTS = 20;

/** Résultat interne d'évaluation d'une condition : null = non évaluable dans ce contexte. */
interface EvalCondition {
  fire: boolean;
  /** Nouvel état d'armement (peut être identique à l'ancien). */
  arme: boolean | undefined;
  /** Valeur ayant servi à la décision (rapportée dans le déclenchement). */
  valeur: number;
}

/**
 * Évalue un LOT de defs (supposées du même symbole) contre `ctx`.
 * Les defs inactives ou non évaluables sont retournées telles quelles (référence conservée).
 */
export function evaluerAlertes(defs: AlertDef[], ctx: ContexteAlerte): ResultatEvaluation {
  const declenchements: Declenchement[] = [];
  let modifie = false;

  const out = defs.map((def) => {
    if (!def.actif) return def;
    const ev = evaluerUne(def, ctx);
    if (ev === null) return def; // condition non évaluable (données manquantes)
    if (!ev.fire && ev.arme === def.arme) return def; // aucun changement

    modifie = true;
    if (ev.fire) {
      declenchements.push({
        alertId: def.id,
        ts: ctx.maintenant,
        valeur: ev.valeur,
        message: def.message ?? decrireCondition(def.condition),
      });
    }
    const declenchementsMaj = ev.fire
      ? [...def.declenchements, ctx.maintenant].slice(-MAX_DECLENCHEMENTS)
      : def.declenchements;
    return { ...def, arme: ev.arme, declenchements: declenchementsMaj };
  });

  return { declenchements, defs: out, modifie };
}

/** Aiguille vers l'évaluateur de la condition. */
function evaluerUne(def: AlertDef, ctx: ContexteAlerte): EvalCondition | null {
  const c: Condition = def.condition;
  switch (c.type) {
    case "prix-croise":
      return evalPrixCroise(def, c, ctx);
    case "variation-pct":
      return evalVariation(def, c, ctx);
    case "indicateur-seuil":
      return evalIndicateurSeuil(def, c, ctx);
    case "indicateur-croisement":
      return evalIndicateurCroisement(def, c, ctx);
    case "funding-extreme":
      return evalFundingExtreme(def, c, ctx);
    case "cvd-spot-perp-div":
      return evalCvdSpotPerpDiv(def, c, ctx);
    case "liq-cascade":
      return evalLiqCascade(def, c, ctx);
    case "regime-seuil":
      return evalRegimeSeuil(def, c, ctx);
    case "whale-flux":
      return evalWhaleFlux(def, c, ctx);
  }
}

/**
 * Applique la logique de front armé → déclenché → ré-armé à un booléen `satisfaite`.
 * `arme === undefined` (jamais évaluée) : calibrage du côté courant, aucun déclenchement.
 */
function frontArme(arme: boolean | undefined, satisfaite: boolean): { fire: boolean; arme: boolean } {
  if (arme === undefined) return { fire: false, arme: !satisfaite };
  if (satisfaite && arme) return { fire: true, arme: false };
  if (!satisfaite && !arme) return { fire: false, arme: true }; // ré-armement
  return { fire: false, arme };
}

function evalPrixCroise(
  def: AlertDef,
  c: Extract<Condition, { type: "prix-croise" }>,
  ctx: ContexteAlerte
): EvalCondition | null {
  const p = ctx.dernierPrix;
  if (!Number.isFinite(p)) return null;

  if (c.sens === "les-deux") {
    // Bidirectionnel : front détecté via le prix précédent (calibrage tant qu'absent).
    const prev = ctx.prixPrecedent;
    if (prev === undefined) return { fire: false, arme: def.arme, valeur: p };
    const franchitHaut = prev < c.niveau && p >= c.niveau;
    const franchitBas = prev > c.niveau && p <= c.niveau;
    return { fire: franchitHaut || franchitBas, arme: def.arme, valeur: p };
  }

  const satisfaite = c.sens === "hausse" ? p >= c.niveau : p <= c.niveau;
  const r = frontArme(def.arme, satisfaite);
  return { fire: r.fire, arme: r.arme, valeur: p };
}

function evalVariation(
  def: AlertDef,
  c: Extract<Condition, { type: "variation-pct" }>,
  ctx: ContexteAlerte
): EvalCondition | null {
  const candles = ctx.candles;
  if (!candles || candles.length === 0) return null;
  const p = ctx.dernierPrix;
  if (!Number.isFinite(p)) return null;

  // Référence ancrée sur l'horloge des BOUGIES, jamais sur `ctx.maintenant` (horloge de
  // la MACHINE, qui peut retarder de quelques secondes sur celle de l'exchange et faire
  // glisser la référence d'une bougie entière). CONTRAT D'APPEL : la dernière bougie du
  // tableau est la dernière CLÔTURÉE (front et daemon la garantissent). Elle a clôturé à
  // `time + TF` ; la référence doit avoir clôturé `fenetreMs` plus tôt, c'est donc la
  // bougie OUVERTE en `time - fenetreMs`.
  const derniere = candles[candles.length - 1];
  if (!derniere) return null;
  const ref = clotureAOuverture(candles, derniere.time - c.fenetreMs);
  if (ref === undefined || ref === 0) return null; // fenêtre pas encore couverte

  const pct = ((p - ref) / ref) * 100;
  const satisfaite = c.seuilPct >= 0 ? pct >= c.seuilPct : pct <= c.seuilPct;
  const r = frontArme(def.arme, satisfaite);
  return { fire: r.fire, arme: r.arme, valeur: pct };
}

function evalIndicateurSeuil(
  def: AlertDef,
  c: Extract<Condition, { type: "indicateur-seuil" }>,
  ctx: ContexteAlerte
): EvalCondition | null {
  const serie = calculerSortie(c.indicateurId, c.params, c.output, ctx.candles);
  if (!serie) return null;
  const v = derniereValeurDefinie(serie);
  if (v === undefined) return null;

  const satisfaite = comparer(v, c.comparateur, c.valeur);
  const r = frontArme(def.arme, satisfaite);
  return { fire: r.fire, arme: r.arme, valeur: v };
}

function evalIndicateurCroisement(
  def: AlertDef,
  c: Extract<Condition, { type: "indicateur-croisement" }>,
  ctx: ContexteAlerte
): EvalCondition | null {
  const candles = ctx.candles;
  if (!candles || candles.length === 0) return null;
  const idef = getIndicator(c.indicateurId);
  if (!idef) return null;
  const res = computeIndicator(idef, candles, c.params);
  const a = res.series[c.outputA];
  const b = res.series[c.outputB];
  if (!a || !b) return null;

  const paire = deuxDernieresPaires(a, b);
  if (!paire) return null;
  const { a0, b0, a1, b1 } = paire;

  // Calibrage : on ignore le croisement éventuellement présent à la première évaluation.
  if (def.arme === undefined) return { fire: false, arme: true, valeur: a1 };

  const franchitHaut = a0 <= b0 && a1 > b1;
  const franchitBas = a0 >= b0 && a1 < b1;
  const fire =
    c.sens === "hausse" ? franchitHaut : c.sens === "baisse" ? franchitBas : franchitHaut || franchitBas;
  // Détection sur front (deux dernières valeurs) : l'armement reste true en permanence.
  return { fire, arme: true, valeur: a1 };
}

/**
 * Funding extrême : extrême = (|z| ≥ zSeuil si z fourni) OU (|rate| ≥ seuilAbs si fourni).
 * Au moins un critère doit être évaluable (sinon null). Sens filtre le signe du rate.
 */
function evalFundingExtreme(
  def: AlertDef,
  c: Extract<Condition, { type: "funding-extreme" }>,
  ctx: ContexteAlerte
): EvalCondition | null {
  const rate = ctx.fundingRate;
  if (rate === undefined || !Number.isFinite(rate)) return null;

  const z = ctx.fundingZScore;
  const hasAbs = c.seuilAbs !== undefined && Number.isFinite(c.seuilAbs);
  const hasZ = z !== undefined && Number.isFinite(z);
  if (!hasAbs && !hasZ) return null; // rien pour juger l'extrémité

  const extremeAbs = hasAbs && Math.abs(rate) >= (c.seuilAbs as number);
  const extremeZ = hasZ && Math.abs(z as number) >= (c.zSeuil ?? 2);
  const extreme = Boolean(extremeAbs || extremeZ);

  // Filtre de sens (signe du rate) : 0 n'est ni long ni short crowded.
  let coteOk = false;
  if (c.sens === "les-deux") coteOk = rate !== 0;
  else if (c.sens === "long-crowded") coteOk = rate > 0;
  else coteOk = rate < 0; // short-crowded

  const satisfaite = extreme && coteOk;
  const r = frontArme(def.arme, satisfaite);
  // Valeur rapportée : z si dispo (plus interprétable pour l'extrême), sinon rate.
  const valeur = hasZ ? (z as number) : rate;
  return { fire: r.fire, arme: r.arme, valeur };
}

/**
 * Divergence CVD spot/perp : satisfaite si le kind injecté matche la condition.
 * `undefined` → non évaluable ; `null` → pas de divergence (ré-arme) ; kind → match.
 */
function evalCvdSpotPerpDiv(
  def: AlertDef,
  c: Extract<Condition, { type: "cvd-spot-perp-div" }>,
  ctx: ContexteAlerte
): EvalCondition | null {
  if (ctx.cvdDivergenceKind === undefined) return null;
  const kind = ctx.cvdDivergenceKind;
  const satisfaite =
    kind !== null && (c.kind === "les-deux" || kind === c.kind);
  // Valeur codée pour le journal : +1 spot↑perp↓, -1 spot↓perp↑, 0 = aucune.
  const valeur = kind === "spotUp_perpDown" ? 1 : kind === "spotDown_perpUp" ? -1 : 0;
  const r = frontArme(def.arme, satisfaite);
  return { fire: r.fire, arme: r.arme, valeur };
}

/**
 * Cascade de liquidations : `liqUsdParMin` (notionnel liquidé sur la dernière minute
 * glissante, tous côtés — injecté par l'appelant) ≥ seuil. Ré-armement standard : le
 * débit doit repasser SOUS le seuil avant de pouvoir re-déclencher.
 */
function evalLiqCascade(
  def: AlertDef,
  c: Extract<Condition, { type: "liq-cascade" }>,
  ctx: ContexteAlerte
): EvalCondition | null {
  const v = ctx.liqUsdParMin;
  if (v === undefined || !Number.isFinite(v)) return null;
  const satisfaite = v >= c.seuilUsdParMin;
  const r = frontArme(def.arme, satisfaite);
  return { fire: r.fire, arme: r.arme, valeur: v };
}

/**
 * Score de régime : `regimeScore` (−2..+2, injecté par le runtime FRONT — le daemon ne
 * calcule pas le score en v1) comparé au seuil. Ré-armement standard : le score doit
 * repasser du côté opposé du seuil avant de pouvoir re-déclencher.
 */
function evalRegimeSeuil(
  def: AlertDef,
  c: Extract<Condition, { type: "regime-seuil" }>,
  ctx: ContexteAlerte
): EvalCondition | null {
  const v = ctx.regimeScore;
  if (v === undefined || !Number.isFinite(v)) return null;
  const satisfaite = comparer(v, c.comparateur, c.valeur);
  const r = frontArme(def.arme, satisfaite);
  return { fire: r.fire, arme: r.arme, valeur: v };
}

/**
 * Mouvement baleine : plus gros transfert (USD) de la fenêtre récente injectée,
 * filtré par direction, comparé au seuil. Ré-armement standard : la fenêtre doit
 * ne plus contenir de transfert ≥ seuil (dans la direction filtrée) avant de pouvoir
 * re-déclencher — la fenêtre glissante (10 min côté daemon) borne donc le silence.
 */
function evalWhaleFlux(
  def: AlertDef,
  c: Extract<Condition, { type: "whale-flux" }>,
  ctx: ContexteAlerte
): EvalCondition | null {
  const mouvements = ctx.whaleMouvements;
  if (mouvements === undefined) return null;
  let max = 0;
  for (const m of mouvements) {
    if (c.direction !== "tous" && m.direction !== c.direction) continue;
    if (Number.isFinite(m.usd) && m.usd > max) max = m.usd;
  }
  const satisfaite = max >= c.seuilUsd;
  const r = frontArme(def.arme, satisfaite);
  return { fire: r.fire, arme: r.arme, valeur: max };
}

// ───────── Helpers purs ─────────

/**
 * Clôture de la dernière bougie OUVERTE en `cible` au plus tard (undefined si aucune).
 * `cible` est une OUVERTURE (dérivée de la grille des bougies, pas d'une horloge) : la
 * bougie retenue a donc clôturé exactement `fenetreMs` avant la dernière du tableau.
 * Cible non alignée sur la grille (fenêtre non multiple du TF) → on recule d'un cran,
 * la fenêtre effective est arrondie au TF supérieur plutôt que tronquée.
 */
function clotureAOuverture(candles: Candle[], cible: number): number | undefined {
  for (let i = candles.length - 1; i >= 0; i--) {
    const cd = candles[i];
    if (cd && cd.time <= cible) return cd.close;
  }
  return undefined;
}

/** Calcule l'indicateur et retourne sa série de sortie `output` (undefined si introuvable). */
function calculerSortie(
  indicateurId: string,
  params: Record<string, number | boolean | string>,
  output: string,
  candles: Candle[] | undefined
): Array<number | undefined> | undefined {
  if (!candles || candles.length === 0) return undefined;
  const idef = getIndicator(indicateurId);
  if (!idef) return undefined;
  const res = computeIndicator(idef, candles, params);
  return res.series[output];
}

/** Dernière valeur définie (non undefined) d'une série alignée sur les bougies. */
function derniereValeurDefinie(serie: Array<number | undefined>): number | undefined {
  for (let i = serie.length - 1; i >= 0; i--) {
    const v = serie[i];
    if (v !== undefined) return v;
  }
  return undefined;
}

/** Les deux dernières valeurs CONSÉCUTIVES où A et B sont toutes deux définies. */
function deuxDernieresPaires(
  a: Array<number | undefined>,
  b: Array<number | undefined>
): { a0: number; b0: number; a1: number; b1: number } | null {
  const n = Math.min(a.length, b.length);
  let i1 = -1;
  for (let i = n - 1; i >= 0; i--) {
    if (a[i] !== undefined && b[i] !== undefined) {
      i1 = i;
      break;
    }
  }
  if (i1 < 1) return null;
  const a1 = a[i1];
  const b1 = b[i1];
  const a0 = a[i1 - 1];
  const b0 = b[i1 - 1];
  if (a1 === undefined || b1 === undefined || a0 === undefined || b0 === undefined) return null;
  return { a0, b0, a1, b1 };
}

/** Comparaison d'une valeur à un seuil selon un comparateur. */
function comparer(v: number, op: Comparateur, seuil: number): boolean {
  switch (op) {
    case ">":
      return v > seuil;
    case ">=":
      return v >= seuil;
    case "<":
      return v < seuil;
    case "<=":
      return v <= seuil;
  }
}
