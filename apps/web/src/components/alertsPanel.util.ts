/**
 * Helpers PURS du panneau Alertes (AlertsPanel.tsx), lus aussi par le runtime des alertes :
 *  - catalogue et construction des conditions d'indicateur du formulaire (seuil, croisement) ;
 *  - sorties proposées à l'alerte de seuil, nommées, avec leur comparateur et leur valeur quand
 *    une seule lecture a un sens (signal d'achat, réaction sur zone forte) ;
 *  - profondeur d'historique qu'une def demande (`amorceAlerte`) et ce qu'il en manque : le
 *    runtime n'évalue pas en deçà, la liste le dit ;
 *  - état d'évaluation d'une def (ici, hors graphe, historique insuffisant) et note du formulaire ;
 *  - cible de navigation d'un déclenchement du journal, et les defs qui n'ont pas de marché à montrer.
 * Extraits ici pour être testables sans DOM.
 */
import { decrireAlerte, estFrontOnly, typesDeDef, type AlertDef, type Comparateur, type Condition, type SensCroisement } from "@axiom/alerts";
import { INDICATORS, getIndicator } from "@axiom/indicators";
import type { ExchangeId, IndicatorDef, Timeframe } from "@axiom/types";

/**
 * Indicateurs éligibles au croisement : calculables sur bougies seules (pas de série
 * aux, comme `indicateur-seuil`) ET exposant au moins DEUX sorties à croiser
 * (ex. MACD : macd × signal). Sauf le volume piégé, dont les sorties sont de signes
 * opposés par construction (longs ≥ 0 ≥ shorts) : jamais de croisement réel, seulement
 * de faux « hausse » à la sortie d'un état 0/0.
 */
export const INDICATEURS_CROISEMENT: IndicatorDef[] = INDICATORS.filter(
  (d) => (!d.aux || d.aux.length === 0) && d.outputs.length >= 2 && d.id !== "trappedVolume",
);

/**
 * Construit la condition `indicateur-croisement` depuis l'état du formulaire, ou
 * `null` si la saisie est invalide (indicateur inconnu, sortie absente, ou deux fois
 * la même sortie — le moteur comparerait une série à elle-même et ne déclencherait jamais).
 * Params vides → défauts du registry côté moteur (comme `indicateur-seuil`).
 */
export function construireConditionCroisement(
  indicateurId: string,
  outputA: string,
  outputB: string,
  sens: SensCroisement,
): Condition | null {
  if (outputA === outputB) return null;
  const idef = getIndicator(indicateurId);
  if (!idef) return null;
  const cles = new Set(idef.outputs.map((o) => o.key));
  if (!cles.has(outputA) || !cles.has(outputB)) return null;
  return { type: "indicateur-croisement", indicateurId, params: {}, outputA, outputB, sens };
}

// ─────────────────────────── Sorties de l'alerte de seuil ───────────────────────────

/** Une entrée du sélecteur de sortie d'une alerte de seuil. */
export interface SortieAlerte {
  /** Valeur de l'option, unique dans l'indicateur. */
  cle: string;
  /** Texte de l'option. */
  libelle: string;
  /** Sortie de l'indicateur que lit la condition. */
  output: string;
  /** Comparateur et valeur posés d'office ; absents : l'opérateur les saisit. */
  prereglage?: { comparateur: Comparateur; valeur: number };
  /** Sortie d'AXIS ou d'AXIS S/R hors des campagnes : `precoce` pour une réaction sur zone forte. */
  nonMesuree?: "precoce" | "brute";
}

/**
 * Sorties de prix d'une stratégie : définies seulement en position, leur dernière valeur reste
 * lue une fois à plat. Un seuil dessus ne suit donc pas les signaux (constat IND-2 : sur le cas de
 * référence, `prixSignal > 0` ne sonne jamais, pour 4 achats). Ensemble explicite : six stratégies
 * de divergence exposent, elles, un oscillateur qui se lit au seuil.
 */
export const SORTIES_PRIX_STRATEGIE: ReadonlySet<string> = new Set(["prixEntree", "prixSignal", "stop"]);

/** AXIS S/R puis AXIS : en tête du sélecteur, sorties nommées. */
const IDS_AXIS = ["stratAxisSr", "stratAxis"] as const;
const PREFIXE_NON_MESURE = "Non mesuré · ";
/** Sorties d'AXIS et d'AXIS S/R proposées sous un nom, avec leur lecture. L'ordre est celui du sélecteur. */
const SORTIES_NOMMEES: ReadonlyArray<Omit<SortieAlerte, "cle"> & { cle: string }> = [
  { cle: "achat", libelle: "Signal d'achat", output: "etat", prereglage: { comparateur: ">=", valeur: 1 } },
  { cle: "vente", libelle: "Signal de vente", output: "etat", prereglage: { comparateur: "<=", valeur: 0 } },
  { cle: "reactionSupport", libelle: `${PREFIXE_NON_MESURE}réaction sur support fort`, output: "reactionSupport", prereglage: { comparateur: ">=", valeur: 1 }, nonMesuree: "precoce" },
  { cle: "reactionResistance", libelle: `${PREFIXE_NON_MESURE}réaction sur résistance forte`, output: "reactionResistance", prereglage: { comparateur: ">=", valeur: 1 }, nonMesuree: "precoce" },
];

/**
 * Entrées du sélecteur de sortie pour un indicateur. AXIS et AXIS S/R : les sorties nommées que
 * l'indicateur porte, puis ses autres sorties, brutes, préfixées « Non mesuré · ». Autres
 * indicateurs : le nom de chaque sortie, sans préréglage. Toute stratégie : sans ses sorties de
 * prix (`SORTIES_PRIX_STRATEGIE`) ; liste vide = l'indicateur n'a rien à proposer.
 */
export function sortiesAlerte(def: IndicatorDef): SortieAlerte[] {
  const sorties = def.outputs.filter((o) => def.category !== "strategy" || !SORTIES_PRIX_STRATEGIE.has(o.key));
  if (!(IDS_AXIS as readonly string[]).includes(def.id)) return sorties.map((o) => ({ cle: o.key, libelle: o.name, output: o.key }));
  const cles = new Set(sorties.map((o) => o.key));
  const nommees = SORTIES_NOMMEES.filter((s) => cles.has(s.output));
  const dejaNommees = new Set(nommees.map((s) => s.output));
  return [
    ...nommees,
    ...sorties
      .filter((o) => !dejaNommees.has(o.key))
      .map((o): SortieAlerte => ({ cle: o.key, libelle: `${PREFIXE_NON_MESURE}${o.name}`, output: o.key, nonMesuree: "brute" })),
  ];
}

/**
 * Indicateurs proposés à l'alerte de seuil : calculables sur bougies seules (le runtime n'injecte
 * aucune série auxiliaire obligatoire) et ayant au moins une sortie à proposer. AXIS S/R et AXIS
 * d'abord, puis l'ordre du registre.
 */
export const INDICATEURS_SEUIL: IndicatorDef[] = (() => {
  const eligibles = INDICATORS.filter((d) => (!d.aux || d.aux.length === 0) && sortiesAlerte(d).length > 0);
  const tete = IDS_AXIS.flatMap((id) => eligibles.filter((d) => d.id === id));
  return [...tete, ...eligibles.filter((d) => !tete.includes(d))];
})();

/**
 * Condition `indicateur-seuil` du formulaire, ou `null` si la saisie est incomplète (entrée
 * inconnue ; sans préréglage, valeur vide ou non numérique). Params vides → défauts du registre.
 */
export function construireConditionSeuil(
  indicateurId: string,
  cleSortie: string,
  comparateur: Comparateur,
  valeurSaisie: string,
): Condition | null {
  const idef = getIndicator(indicateurId);
  const sortie = idef ? sortiesAlerte(idef).find((s) => s.cle === cleSortie) : undefined;
  if (!sortie) return null;
  if (sortie.prereglage) return { type: "indicateur-seuil", indicateurId, params: {}, output: sortie.output, ...sortie.prereglage };
  const valeur = Number(valeurSaisie);
  if (valeurSaisie.trim() === "" || !Number.isFinite(valeur)) return null;
  return { type: "indicateur-seuil", indicateurId, params: {}, output: sortie.output, comparateur, valeur };
}

/**
 * Explication d'une alerte existante posée sur une sortie de prix d'une stratégie (créée avant
 * que le formulaire cesse de les proposer), ou `null`. L'alerte reste dans la liste, jamais
 * supprimée : la pastille « muette » et ce texte disent pourquoi elle ne sonne pas.
 */
export function explicationMuette(condition: Condition): string | null {
  if (condition.type !== "indicateur-seuil" || !SORTIES_PRIX_STRATEGIE.has(condition.output)) return null;
  const idef = getIndicator(condition.indicateurId);
  if (idef?.category !== "strategy") return null;
  const nom = idef.outputs.find((o) => o.key === condition.output)?.name ?? condition.output;
  const remede = (IDS_AXIS as readonly string[]).includes(idef.id) ? " Recréez l'alerte sur « Signal d'achat »." : "";
  return `Muette : « ${nom} » est un prix, gardé après la sortie de position ; un seuil dessus ne suit pas les signaux.${remede}`;
}

// ─────────────────────────── Profondeur d'historique et état d'évaluation ───────────────────────────

/** Types de condition évalués à la clôture d'une bougie du graphe principal. */
const TYPES_BOUGIE: ReadonlySet<string> = new Set(["variation-pct", "indicateur-seuil", "indicateur-croisement"]);

/**
 * Plus grande amorce (`IndicatorDef.amorceBougies`) déclarée par les indicateurs d'une def,
 * sous-conditions d'un composite comprises ; 0 si aucun n'en déclare (AXIS : 1 500, AXIS S/R :
 * 3 000). En deçà, l'indicateur ne rend pas les signaux d'une série longue.
 */
export function amorceAlerte(def: Pick<AlertDef, "condition">): number {
  const conditions: readonly Condition[] = def.condition.type === "composite" ? def.condition.conditions : [def.condition];
  let amorce = 0;
  for (const c of conditions) {
    if (c.type !== "indicateur-seuil" && c.type !== "indicateur-croisement") continue;
    amorce = Math.max(amorce, getIndicator(c.indicateurId)?.amorceBougies ?? 0);
  }
  return amorce;
}

/**
 * Vrai si un tampon de `bougies` bougies suffit à évaluer la def. MÊME DÉCOMPTE que
 * `doitEtendreHistorique` du graphe (chart/ChartInstance.tsx) : le tampon entier, bougie en
 * formation comprise. Le graphe cesse d'étendre l'historique à A bougies ; le tampon clos peut
 * alors n'en compter que A − 1, et l'alerte doit être évaluée quand même (frontière épinglée par
 * alertsPanel.amorce.test.ts).
 */
export function amorceAtteinte(def: Pick<AlertDef, "condition">, bougies: number): boolean {
  return bougies >= amorceAlerte(def);
}

/** Graphe principal, tel que le runtime des alertes le lit. */
export interface GraphePrincipal {
  exchange: ExchangeId;
  symbol: string;
  timeframe: Timeframe;
  /** Bougies du tampon, bougie en formation comprise. */
  bougies: number;
  /** Indicateurs affichés sur la vue principale (`defId`) : le graphe étend son historique à leur amorce. */
  indicateurs: readonly string[];
}

/** Où en est l'évaluation d'une def de bougie. */
export type EvaluationAlerte =
  | { etat: "ici" }
  | { etat: "hors-graphe" }
  /** `aAfficher` : un indicateur de la def, dont l'amorce manque, n'est pas sur la vue principale (et la def n'est pas « muette »). */
  | { etat: "historique"; bougies: number; amorce: number; aAfficher: boolean };

/**
 * Ce que le daemon local voit d'une clôture : Binance, en 1m ou sans unité (ses seules bougies
 * sont d'une minute). Miroir d'`evaluableSurBougie1m` (apps/daemon/src/alerts.ts).
 */
function clotureVueParDaemon(source: ExchangeId, timeframe: Timeframe | undefined): boolean {
  return source === "binance" && (timeframe === undefined || timeframe === "1m");
}

/**
 * État d'évaluation d'une def : « ici » (rien ne l'empêche), « hors-graphe » (def de bougie dont
 * le graphe principal n'affiche pas l'actif ou l'unité : rien ne l'évalue), « historique » (le
 * tampon n'a pas l'amorce de son indicateur : aucune évaluation). Une def sans condition de
 * bougie n'attend pas le graphe : « ici ». Exception : sur Binance, une def de bougie en 1m ou
 * sans unité est aussi évaluée par le daemon local quand il est là (`daemonAlertes`), sauf si
 * elle porte une condition réservée au front (CVD, régime… : `estFrontOnly`, que le daemon écarte).
 */
export function evaluationAlerte(
  def: Pick<AlertDef, "source" | "symbol" | "timeframe" | "condition">,
  graphe: GraphePrincipal,
  daemonAlertes: boolean,
): EvaluationAlerte {
  if (![...typesDeDef(def as AlertDef)].some((type) => TYPES_BOUGIE.has(type))) return { etat: "ici" };
  const surGraphe =
    def.source === graphe.exchange && def.symbol === graphe.symbol && (def.timeframe === undefined || def.timeframe === graphe.timeframe);
  if (!surGraphe) {
    const parDaemon = daemonAlertes && clotureVueParDaemon(def.source, def.timeframe) && !estFrontOnly(def as AlertDef);
    return { etat: parDaemon ? "ici" : "hors-graphe" };
  }
  const amorce = amorceAlerte(def);
  if (graphe.bougies >= amorce) return { etat: "ici" };
  // Afficher l'indicateur ne fait charger l'historique que s'il ne l'est pas déjà : sinon le
  // chargement est en cours, ou la source n'a pas plus de bougies, et il n'y a rien à conseiller.
  // Rien à conseiller non plus pour une alerte « muette » : l'historique chargé, elle le resterait,
  // et son explication donne déjà le seul remède (la recréer).
  const conditions: readonly Condition[] = def.condition.type === "composite" ? def.condition.conditions : [def.condition];
  const aAfficher = explicationMuette(def.condition) === null && conditions.some(
    (c) =>
      (c.type === "indicateur-seuil" || c.type === "indicateur-croisement") &&
      (getIndicator(c.indicateurId)?.amorceBougies ?? 0) > graphe.bougies &&
      !graphe.indicateurs.includes(c.indicateurId),
  );
  return { etat: "historique", bougies: graphe.bougies, amorce, aAfficher };
}

/**
 * Texte de l'état d'évaluation dans la liste ; `null` quand rien n'empêche l'évaluation. Le
 * remède « affichez l'indicateur » n'est écrit que s'il peut marcher (`aAfficher`).
 */
export function texteEvaluation(evaluation: EvaluationAlerte): string | null {
  if (evaluation.etat === "hors-graphe") return "hors graphe";
  if (evaluation.etat === "historique") {
    const manque = `historique insuffisant : ${evaluation.bougies} sur ${evaluation.amorce}`;
    return evaluation.aAfficher ? `${manque}, affichez l'indicateur` : manque;
  }
  return null;
}

/** Ce que la note du formulaire lit de l'application : le daemon local, les indicateurs de la vue principale. */
export interface HoteAlerte {
  /** Le daemon local évalue les alertes (bureau seulement). */
  daemonAlertes: boolean;
  /** Indicateurs affichés sur la vue principale (`defId`). */
  indicateursAffiches: readonly string[];
}

/**
 * Note sous le formulaire d'une alerte de seuil, une phrase par ligne : la portée de l'évaluation,
 * le libellé exact que portera l'alerte, la réserve d'une sortie non mesurée, l'historique demandé
 * (avec « affichez l'indicateur » tant qu'il ne l'est pas), l'origine des réglages et ce qui ne
 * sonne pas application fermée — le daemon local n'est nommé comme sonnant que pour l'alerte
 * qu'il évalue (1m sur Binance). `condition` nulle : saisie incomplète.
 */
export function noteAlerteSeuil(
  condition: Condition | null,
  sortie: SortieAlerte | undefined,
  marche: { symbol: string; source: ExchangeId; timeframe: Timeframe },
  hote: HoteAlerte,
): string[] {
  const lignes = [`Évaluée à chaque clôture ${marche.timeframe}, application ouverte sur ${marche.symbol} ${marche.timeframe}.`];
  if (condition !== null) {
    lignes.push(`Libellé : ${decrireAlerte({ condition, timeframe: marche.timeframe })}`);
    if (sortie?.nonMesuree === "precoce") {
      lignes.push("Signal précoce non mesuré — lecture indicative, jamais une promesse. Sonne aux bougies de réaction ; un signal confirmé sur la même bougie n'a pas de triangle creux.");
    } else if (sortie?.nonMesuree === "brute") {
      lignes.push("Sortie non mesurée — lecture indicative, jamais une promesse.");
    }
    const amorce = amorceAlerte({ condition });
    if (amorce > 0 && condition.type === "indicateur-seuil") {
      const charge = `Évaluée seulement quand le graphe a chargé ${amorce} bougies`;
      lignes.push(
        hote.indicateursAffiches.includes(condition.indicateurId)
          ? `${charge}.`
          : `${charge} : affichez ${getIndicator(condition.indicateurId)?.name ?? "l'indicateur"}.`,
      );
    }
  }
  lignes.push("Réglages par défaut de l'indicateur, pas ceux de l'instance du graphe.");
  const rienNeSonne = "Rien ne sonne application fermée ou téléphone verrouillé";
  lignes.push(
    !hote.daemonAlertes
      ? `${rienNeSonne}.`
      : clotureVueParDaemon(marche.source, marche.timeframe)
        ? "Application fermée : seul le daemon local sonne, en 1m sur Binance."
        : `${rienNeSonne} : le daemon local n'évalue que le 1m sur Binance.`,
  );
  return lignes;
}

/**
 * Vrai si le symbole porteur d'une def de cette condition n'est pas un marché que le graphe peut
 * afficher : une alerte baleines porte l'actif surveillé (« BTC », « USDT », « USDC »). Ni « Voir »
 * ni navigation pour elle. Les alertes globales (régime, on-chain) portent BTCUSDT : elles les gardent.
 */
export function sansMarche(condition: Condition): boolean {
  return condition.type === "whale-flux";
}

/**
 * Cible de navigation d'un déclenchement du journal : le journal ne porte que
 * l'`alertId`, le symbole vit sur la def. `null` si la def a été supprimée depuis, ou si
 * son symbole n'est pas un marché (`sansMarche`).
 */
export function cibleAlerte(
  defs: readonly AlertDef[],
  alertId: string,
): { symbol: string; source: ExchangeId; timeframe?: Timeframe } | null {
  const def = defs.find((d) => d.id === alertId);
  if (!def || sansMarche(def.condition)) return null;
  return { symbol: def.symbol, source: def.source, ...(def.timeframe !== undefined ? { timeframe: def.timeframe } : {}) };
}
