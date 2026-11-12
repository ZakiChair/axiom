/**
 * Helpers PURS du panneau Alertes (AlertsPanel.tsx), lus aussi par le runtime des alertes :
 *  - catalogue et construction des conditions d'indicateur du formulaire (seuil, croisement) ;
 *  - sorties proposées à l'alerte de seuil, nommées, avec leur comparateur et leur valeur quand
 *    une seule lecture a un sens (signal d'achat, réaction sur zone forte) ;
 *  - profondeur d'historique qu'une def demande (`amorceAlerte`) et règle d'évaluation commune au
 *    runtime et à la liste (`profondeurAlerte`) : le graphe principal charge l'amorce de lui-même
 *    (`alerts/amorceGraphe.ts`), rien n'est évalué pendant la remontée, et une place qui n'en a pas
 *    assez est dite (« amorce courte ») ;
 *  - état d'évaluation d'une def (ici, hors graphe, historique en chargement ou insuffisant, amorce
 *    courte), état d'armement (armée, déclenchée, condition déjà vraie à la pose) et note du formulaire ;
 *  - réglages qu'une alerte d'AXIS ou d'AXIS S/R copie de l'instance du graphe à sa création
 *    (`paramsInstancePourAlerte`) et écart à cette instance ensuite (`differeDuGraphe`, « ≠ graphe ») ;
 *  - cible de navigation d'un déclenchement du journal, et les defs qui n'ont pas de marché à montrer.
 * Extraits ici pour être testables sans DOM.
 */
import { decrireAlerte, estFrontOnly, typesDeDef, type AlertDef, type Comparateur, type Condition, type SensCroisement } from "@axiom/alerts";
import { INDICATORS, getIndicator, resolveParams } from "@axiom/indicators";
import type { ExchangeId, IndicatorDef, IndicatorInstance, Timeframe } from "@axiom/types";
import { cleMarcheGraphe, type ExtensionGraphe } from "../alerts/amorceGraphe";
import { motifUniteHorsGraphe, uniteImbriquee } from "../chart/uniteParam";

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
  /**
   * Sortie d'AXIS ou d'AXIS S/R hors des campagnes : `precoce` pour une réaction sur zone forte,
   * `presignal` pour le pré-signal d'achat (alertes A2), `brute` pour les autres.
   */
  nonMesuree?: "precoce" | "presignal" | "brute";
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
  // Alertes A2 (12 novembre 2026) : neuvième sortie d'AXIS S/R, 1 à la clôture où le pré-signal est là.
  { cle: "preAchat", libelle: `${PREFIXE_NON_MESURE}pré-signal d'achat`, output: "preAchat", prereglage: { comparateur: ">=", valeur: 1 }, nonMesuree: "presignal" },
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
 * inconnue ; sans préréglage, valeur vide ou non numérique). `params` : réglages de la condition
 * (`paramsInstancePourAlerte`) ; vides → défauts du registre.
 */
export function construireConditionSeuil(
  indicateurId: string,
  cleSortie: string,
  comparateur: Comparateur,
  valeurSaisie: string,
  params: Record<string, number | boolean | string> = {},
): Condition | null {
  const idef = getIndicator(indicateurId);
  const sortie = idef ? sortiesAlerte(idef).find((s) => s.cle === cleSortie) : undefined;
  if (!sortie) return null;
  if (sortie.prereglage) return { type: "indicateur-seuil", indicateurId, params: { ...params }, output: sortie.output, ...sortie.prereglage };
  const valeur = Number(valeurSaisie);
  if (valeurSaisie.trim() === "" || !Number.isFinite(valeur)) return null;
  return { type: "indicateur-seuil", indicateurId, params: { ...params }, output: sortie.output, comparateur, valeur };
}

// ─────────────────────────── Réglages de l'instance du graphe (lot A2) ───────────────────────────

/**
 * D'où viennent les réglages d'une alerte de seuil posée depuis le formulaire :
 *  - `instance` : AXIS ou AXIS S/R, réglages de la première instance de l'indicateur sur la vue
 *    principale (seulement ceux qui diffèrent du défaut ; `params` vide s'il n'y en a pas) ;
 *  - `defaut` : AXIS ou AXIS S/R absent de la vue principale, réglages par défaut ;
 *  - `registre` : tout autre indicateur, réglages par défaut comme avant le lot A2 ;
 *  - `refus` : l'alerte ne peut pas suivre cette instance, et le texte dit pourquoi.
 */
export type ReglagesAlerte =
  | { origine: "instance" | "defaut" | "registre"; params: Record<string, number | boolean | string> }
  | { origine: "refus"; refus: string };

/** Sorties qu'un filtre flux change, et que l'alerte, qui ne lit pas l'OI, ne suivrait pas. */
const SORTIES_FILTRE_FLUX: ReadonlySet<string> = new Set(["etat", "preAchat"]);

/** Motif du refus d'une instance au filtre flux, pour une sortie qu'il change. */
export const MOTIF_FILTRE_FLUX =
  "Filtre flux réglé sur l'instance du graphe : l'alerte ne lit pas l'open interest, elle ne suivrait pas ses signaux. Retirez ce réglage de l'instance pour poser l'alerte.";

/**
 * Réglages qu'une alerte d'AXIS ou d'AXIS S/R copie à sa création (lot A2) : ceux de la PREMIÈRE
 * instance de l'indicateur sur la vue principale, lus comme le calcul les lit (`resolveParams`),
 * limités aux clés de `def.inputs` qui diffèrent du défaut. Sans instance : aucun (défauts). Copie
 * figée : la def ne suit pas l'instance ensuite, la liste le dit (`differeDuGraphe`). Refus motivé
 * quand l'instance porte le réglage « unité » (`motifUniteHorsGraphe`), ou un filtre flux pour la
 * sortie `etat` ou `preAchat` (l'alerte ne lit pas l'OI). Autres indicateurs : défauts, comme avant.
 */
export function paramsInstancePourAlerte(def: IndicatorDef, instances: readonly IndicatorInstance[], output: string): ReglagesAlerte {
  if (!(IDS_AXIS as readonly string[]).includes(def.id)) return { origine: "registre", params: {} };
  const instance = instances.find((i) => i.defId === def.id);
  if (instance === undefined) return { origine: "defaut", params: {} };
  const unite = uniteImbriquee(instance);
  if (unite !== null) return { origine: "refus", refus: motifUniteHorsGraphe(unite, "alerte") };
  const lus = resolveParams(def, instance.params);
  const params: Record<string, number | boolean | string> = {};
  for (const input of def.inputs) {
    const valeur = lus[input.key];
    if (valeur !== undefined && valeur !== input.default) params[input.key] = valeur;
  }
  if (params.filtreFlux === true && SORTIES_FILTRE_FLUX.has(output)) return { origine: "refus", refus: MOTIF_FILTRE_FLUX };
  return { origine: "instance", params };
}

/** Explication de la pastille « ≠ graphe », écrite sous la ligne de l'alerte (lisible au doigt) et en titre. */
export const EXPLICATION_ECART_GRAPHE =
  "Réglages différents de l'instance du graphe : l'alerte garde ceux de sa création, ses signaux peuvent différer de ceux affichés.";

/**
 * Vrai quand une alerte d'AXIS ou d'AXIS S/R (sous-conditions comprises) ne lit pas les mêmes
 * réglages que la première instance de son indicateur sur la vue principale : une clé de
 * `def.inputs` diffère une fois lue comme le calcul la lit, ou l'instance calcule sur une unité
 * supérieure. Faux sans instance de l'indicateur (rien d'affiché à quoi la comparer).
 */
export function differeDuGraphe(condition: Condition, instances: readonly IndicatorInstance[]): boolean {
  const conditions: readonly Condition[] = condition.type === "composite" ? condition.conditions : [condition];
  return conditions.some((c) => {
    if (c.type !== "indicateur-seuil" && c.type !== "indicateur-croisement") return false;
    if (!(IDS_AXIS as readonly string[]).includes(c.indicateurId)) return false;
    const idef = getIndicator(c.indicateurId);
    const instance = instances.find((i) => i.defId === c.indicateurId);
    if (idef === undefined || instance === undefined) return false;
    if (uniteImbriquee(instance) !== null) return true;
    const alerte = resolveParams(idef, c.params);
    const graphe = resolveParams(idef, instance.params);
    return idef.inputs.some((input) => alerte[input.key] !== graphe[input.key]);
  });
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

/**
 * Profondeur à laquelle une def d'amorce `amorce` peut être évaluée sur un tampon de `bougies`
 * bougies (bougie en formation comprise) du marché de graphe de clé `cle` (lot A2) :
 *  - « atteinte » : le tampon compte l'amorce (règle du lot A1, `amorceAtteinte`, inchangée) ;
 *  - « courte » : il ne la compte pas, mais l'extension de ce marché est terminée et la visait —
 *    la place n'a pas plus d'historique ; évaluée, et son message le dit (`mentionAmorceCourte`) ;
 *  - « attente » : extension en cours, inconnue, d'un autre marché, ou qui visait moins (alerte
 *    posée pendant une remontée plus courte) : aucune évaluation.
 * Lue par le runtime (R2) et par la liste (`evaluationAlerte`) : les deux disent la même chose.
 */
export type ProfondeurAlerte = "atteinte" | "courte" | "attente";
export function profondeurAlerte(amorce: number, bougies: number, extension: ExtensionGraphe | null, cle: string): ProfondeurAlerte {
  if (bougies >= amorce) return "atteinte";
  return extension !== null && extension.cle === cle && extension.terminee && extension.amorceVisee >= amorce ? "courte" : "attente";
}

/** Mention ajoutée au message d'un déclenchement évalué sur une amorce courte (`bougies` closes lues). */
export function mentionAmorceCourte(bougies: number): string {
  return ` · amorce courte (${bougies} bougies)`;
}

/** Graphe principal, tel que le runtime des alertes le lit. */
export interface GraphePrincipal {
  exchange: ExchangeId;
  symbol: string;
  timeframe: Timeframe;
  /** Bougies du tampon, bougie en formation comprise. */
  bougies: number;
  /**
   * État de l'extension d'historique que la vue principale publie pour son marché
   * (`extensionGrapheStore`) : elle l'étend aux indicateurs affichés ET à ceux des alertes actives
   * de ce marché.
   */
  extension: ExtensionGraphe | null;
}

/** Où en est l'évaluation d'une def de bougie. */
export type EvaluationAlerte =
  | { etat: "ici" }
  | { etat: "hors-graphe" }
  /** Tampon sous l'amorce, rien n'est évalué ; `chargement` : le graphe remonte l'historique. */
  | { etat: "historique"; bougies: number; amorce: number; chargement: boolean }
  /** La place n'a pas l'amorce : évaluée sur les `bougies` qu'elle a, son message le dit. */
  | { etat: "amorce-courte"; bougies: number; amorce: number };

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
 * tampon n'a pas l'amorce de son indicateur et le graphe n'a pas fini de la remonter : aucune
 * évaluation), « amorce-courte » (la remontée est finie, la place n'a pas l'amorce : évaluée sur ce
 * qu'il y a). Même règle que le runtime (`profondeurAlerte`). Une def sans condition de bougie
 * n'attend pas le graphe : « ici ». Exception : sur Binance, une def de bougie en 1m ou sans unité
 * est aussi évaluée par le daemon local quand il est là (`daemonAlertes`), sauf si elle porte une
 * condition réservée au front (CVD, régime… : `estFrontOnly`, que le daemon écarte).
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
  const cle = cleMarcheGraphe(graphe);
  const profondeur = profondeurAlerte(amorce, graphe.bougies, graphe.extension, cle);
  if (profondeur === "atteinte") return { etat: "ici" };
  if (profondeur === "courte") return { etat: "amorce-courte", bougies: graphe.bougies, amorce };
  // Plus de remède à conseiller (« affichez l'indicateur », lot A1) : le graphe charge lui-même
  // l'historique des alertes actives de son marché, que leur indicateur soit affiché ou non.
  const chargement = graphe.extension !== null && graphe.extension.cle === cle && !graphe.extension.terminee;
  return { etat: "historique", bougies: graphe.bougies, amorce, chargement };
}

/**
 * État d'armement d'une alerte dans la liste : texte, couleur, et `long` quand le texte demande sa
 * propre ligne. Désarmée sans avoir jamais sonné, la condition était déjà vraie quand l'alerte a
 * été posée (« Signal de vente » posé à plat, « Signal d'achat » posé en position) : le calibrage
 * la désarme sans tirer, et elle sonnera quand la condition, redevenue fausse, sera de nouveau
 * vraie. « déclenchée » y était faux : rien n'avait sonné.
 */
export function etatArmement(def: Pick<AlertDef, "arme" | "declenchements">): { texte: string; classe: string; long?: true } {
  if (def.arme === undefined) return { texte: "calibrage", classe: "text-text-dim" };
  if (def.arme) return { texte: "armée", classe: "text-up" };
  if (def.declenchements.length === 0) {
    return { texte: "condition déjà vraie : sonnera quand elle le redeviendra", classe: "text-text-dim", long: true };
  }
  return { texte: "déclenchée", classe: "text-serie-3" };
}

/**
 * Texte de l'état d'évaluation dans la liste, à la place de « armée » ; `null` quand la def est
 * évaluée (« ici », amorce courte). Pendant la remontée : « historique en chargement : N sur A » ;
 * sans état connu du graphe pour ce marché (bougies en chargement, échec du chargement) :
 * « historique insuffisant : N sur A ». Le remède « affichez l'indicateur » du lot A1 n'a plus
 * d'objet : le graphe charge l'historique des alertes de son marché.
 */
export function texteEvaluation(evaluation: EvaluationAlerte): string | null {
  if (evaluation.etat === "hors-graphe") return "hors graphe";
  if (evaluation.etat === "historique") {
    return `historique ${evaluation.chargement ? "en chargement" : "insuffisant"} : ${evaluation.bougies} sur ${evaluation.amorce}`;
  }
  return null;
}

/**
 * Ligne de la liste sous une def évaluée sur une amorce courte : « amorce courte : N sur A ». Son
 * état d'armement reste écrit à sa place ; ses déclenchements portent « · amorce courte (N bougies) ».
 */
export function texteAmorceCourte(evaluation: EvaluationAlerte): string | null {
  return evaluation.etat === "amorce-courte" ? `amorce courte : ${evaluation.bougies} sur ${evaluation.amorce}` : null;
}

/** Ce que la note du formulaire lit de l'application : le daemon local. */
export interface HoteAlerte {
  /** Le daemon local évalue les alertes (bureau seulement). */
  daemonAlertes: boolean;
}

/**
 * Note sous le formulaire d'une alerte de seuil, une phrase par ligne : la portée de l'évaluation,
 * le libellé exact que portera l'alerte, la réserve d'une sortie non mesurée, l'historique que le
 * graphe charge pour elle (et ce qui se passe quand la place en a moins), l'origine des réglages
 * (`reglages`, lot A2 : instance du graphe, défauts, ou le refus motivé) et ce qui ne sonne pas
 * application fermée — le daemon local n'est nommé comme sonnant que pour l'alerte qu'il évalue
 * (1m sur Binance). `condition` nulle : saisie incomplète, ou réglages refusés.
 */
export function noteAlerteSeuil(
  condition: Condition | null,
  sortie: SortieAlerte | undefined,
  marche: { symbol: string; source: ExchangeId; timeframe: Timeframe },
  hote: HoteAlerte,
  reglages: ReglagesAlerte = { origine: "registre", params: {} },
): string[] {
  const lignes = [`Évaluée à chaque clôture ${marche.timeframe}, application ouverte sur ${marche.symbol} ${marche.timeframe}.`];
  if (condition !== null) {
    lignes.push(`Libellé : ${decrireAlerte({ condition, timeframe: marche.timeframe })}`);
    if (sortie?.nonMesuree === "precoce") {
      lignes.push("Signal précoce non mesuré — lecture indicative, jamais une promesse. Sonne aux bougies de réaction ; un signal confirmé sur la même bougie n'a pas de triangle creux.");
    } else if (sortie?.nonMesuree === "presignal") {
      lignes.push("Signal précoce non mesuré — lecture indicative, jamais une promesse.");
    } else if (sortie?.nonMesuree === "brute") {
      lignes.push("Sortie non mesurée — lecture indicative, jamais une promesse.");
    }
    const amorce = amorceAlerte({ condition });
    if (amorce > 0 && condition.type === "indicateur-seuil") {
      lignes.push(`Le graphe charge ${amorce} bougies pour elle ; si la place en a moins, elle est évaluée sur celles-là, avec la mention « amorce courte ».`);
    }
  }
  lignes.push(
    reglages.origine === "refus"
      ? `Pas d'alerte : ${reglages.refus}`
      : reglages.origine === "instance"
        ? "Réglages de l'instance du graphe, copiés à la création : l'alerte ne suit pas leurs changements."
        : reglages.origine === "defaut"
          ? "Réglages par défaut de l'indicateur, absent du graphe."
          : "Réglages par défaut de l'indicateur, pas ceux de l'instance du graphe.",
  );
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
