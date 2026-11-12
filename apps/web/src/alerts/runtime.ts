/**
 * Runtime des alertes — pont entre le moteur PUR (`@axiom/alerts`) et les flux live.
 *
 * Sources d'évaluation, sans chevauchement de types de condition (donc aucun
 * double déclenchement) :
 *  - FLUX TICKER (`subscribeTickers`) sur les symboles des alertes prix : évalue les
 *    conditions `prix-croise` à chaque mise à jour de prix (tous symboles). Le prix
 *    précédent est mémorisé par symbole (nécessaire au sens `les-deux`).
 *  - CLÔTURE DE BOUGIE (abonnement `marketStore`) sur le symbole affiché : évalue les
 *    conditions `variation-pct` et `indicateur-*` à chaque nouvelle bougie CLÔTURÉE
 *    (ces conditions requièrent les bougies, présentes uniquement pour le symbole affiché).
 *    Une def n'est évaluée que si son `timeframe` est celui du chart ; `timeframe`
 *    absent (def HÉRITÉE) = évaluée sur le TF affiché, quel qu'il soit. Règles (12 novembre
 *    2026) : chaque def est évaluée UNE fois par bougie close (suivi par def) ; jamais sous
 *    l'amorce de son indicateur (AXIS 1 500 bougies, AXIS S/R 3 000) pendant que le graphe
 *    principal la remonte — il le fait aussi pour les alertes actives de son marché (lot A2) — ;
 *    remontée finie sur une place qui ne l'a pas, évaluée sur ce qu'il y a, et le message le dit
 *    (« · amorce courte (N bougies) ») ; une def créée ou réactivée en cours de bougie est
 *    évaluée tout de suite sur la dernière bougie close (une def neuve s'y calibre, la clôture
 *    suivante peut donc tirer). Au retour sur un état qui dure (AXIS acheté depuis trois
 *    clôtures), le message date la bougie du signal et « Voir » la marque.
 *  - POLL FUNDING (~60 s) pour les symboles ayant une alerte `funding-extreme` :
 *    injecte `fundingRate` (+ `fundingZScore` si historique dispo) dans le contexte.
 *  - STORE CVD S/P (`cvdDivergenceStore`) : le contrôleur orderflow publie le kind
 *    de divergence ; on évalue `cvd-spot-perp-div` (app ouverte uniquement — pas de
 *    pipeline orderflow côté daemon).
 *  - STORE RÉGIME (`regimeStore`) : le score composite −2..+2 (maj ~15 min) est injecté
 *    dans le contexte ; on évalue `regime-seuil` (GLOBAL, def sur BTCUSDT/binance). Sous
 *    le seuil de composants disponibles (libellé « indéterminé ») le score est du bruit :
 *    on n'injecte rien (non évaluable → armement figé). Front-only (le daemon ne calcule
 *    pas le score en v1).
 *  - POLL LIQ-CASCADE (~5 s) : injecte `liqUsdParMin` (notionnel liquidé sur la dernière
 *    minute glissante, pure `usdParMinute` sur le buffer `liqEventsStore`). Côté FRONT :
 *    évaluée uniquement pour le SYMBOLE COURANT du chart et seulement quand le flux liq
 *    est retenu (heatmap ON ou fenêtre LIQ ouverte — cf. fluxLiqRetenu) ; flux non retenu
 *    ou autre symbole → non évaluable ici (armement figé, pas de faux 0) — le daemon
 *    couvre TOUS les symboles d'alerte onglet fermé (cf. ci-dessous).
 *
 *  - ALERTES DE PRESET (`presetAlertsStore`) : un timer par alerte active (période 15 ou
 *    60 min) relance `executerScreener` (snapshot des filtres) ; les symboles ENTRANT dans
 *    l'ensemble scanné (diff, hors cooldown 6 h) sont journalisés + notifiés. AUCUNE garde
 *    de visibilité : c'est la seule source SANS relais daemon, la couper onglet caché
 *    laisserait l'opérateur non couvert (une période de 15–60 min survit à la limitation
 *    des timers d'arrière-plan). Chaque tick publie son issue (`dernierScanTs`,
 *    `derniereErreur`, champs de session du store) — le panneau les affiche.
 *
 * ONGLET FERMÉ : le daemon évalue aussi `funding-extreme` (poll premiumIndex ~60 s,
 * lot D3) ET `liq-cascade` (tick 10 s sur sa table `liquidations` ingérée Bybit+OKX,
 * tous les symboles d'alerte — ingestion d'un nouveau symbole ≤60 s). Restent FRONT-ONLY
 * (dormants côté daemon) : CVD spot/perp-div (pas de pipeline orderflow), `regime-seuil`
 * (score non calculé en v1), `flux-capitaux-seuil` (loader commun local) et les alertes de preset.
 *
 * Un déclenchement → journal du store + avis à l'écran qui reste jusqu'au toucher
 * (« SYMBOLE UNITÉ — libellé », bouton « Voir ») + notification système (Notification API,
 * onglet visible) + bip discret (WebAudio, aucun fichier binaire). Au téléphone, l'avis est
 * le seul signal sûr : un onglet Safari n'a pas de notification système. AUCUNE donnée haute
 * fréquence ne transite par React : le store n'est écrit que sur transition d'état
 * (cf. BUILD-CONTRACT).
 *
 * Aucune modification de Chart.tsx : on lit `marketStore` en aval, sans le piloter.
 */
import { alerteActiveAuTemps, comparer, evaluerAlertes, prochaineEcheanceAlerte, typesDeDef, type AlertDef, type Condition, type ContexteAlerte, type Declenchement, type MetriqueOnchainAlerte } from "@axiom/alerts";
import type { Timeframe, Unsubscribe } from "@axiom/types";
import { marketStore, sansMarchePerpCible } from "../store/market";
import { chartLayoutStore } from "../store/chart-layout";
import { pousserToast } from "../store/toasts";
import { dureeTimeframeMs } from "../data/backtestData";
import { formatDateCourte, formatHeureMinute } from "../lib/format";
import { amorceAlerte, mentionAmorceCourte, profondeurAlerte, sansMarche, type ProfondeurAlerte } from "../components/alertsPanel.util";
import { cleMarcheGraphe, extensionGrapheStore, type ExtensionGraphe } from "./amorceGraphe";
import { computeIndicator, getIndicator } from "@axiom/indicators";
import { auxProvider } from "../chart/auxProvider";
import { refSymbolStore } from "../store/refSymbol";
import { fluxLiqRetenu, liqEventsStore } from "../chart/liquidationMarkers";
import { usdParMinute } from "../components/liquidationsWindow.util";
import { alertsStore, pousserDefsDaemon } from "../store/alerts";
import { cvdDivergenceStore } from "../store/cvd-divergence";
import { regimeStore } from "../store/regime";
import { orderflowStore } from "../store/orderflow";
import { presetAlertsStore, diffEntrants, filtrerCooldown } from "../store/presetAlerts";
import { isTickerSource, subscribeTickers, type TickerUpdate } from "../data/ticker";
import type { WatchlistSource } from "../store/watchlist";
import { daemonSupporte, detectDaemon, urlDaemon } from "../data/daemon";
import { coinalyzeProvider, filtrerFrontieres8h } from "../data/coinalyze";
import { histFunding } from "../data/referentiels";
import { extUrl } from "../data/extapi";
import { AGE_MAX_FLUX_MS } from "../data/onchain/fluxCapitaux.contract";
import { fluxCapitauxStore, garderFluxCapitauxPourAlertes } from "../store/fluxCapitaux";
import { enrichirDeclenchement } from "../data/decisionDossier";
import { capturerLectures } from "../store/analyseMultidomaine";
import { motifUniteHorsGraphe, uniteImbriquee } from "../chart/uniteParam";

/** Types de condition évalués sur la clôture de bougie (nécessitent les bougies). */
const TYPES_BOUGIE = new Set(["variation-pct", "indicateur-seuil", "indicateur-croisement"]);
/** Throttle d'évaluation des composites (ms) — `computeIndicator` n'a pas à courir à chaque tick. */
const COMPOSITE_THROTTLE_MS = 1_000;

function defPorte(def: AlertDef, type: string): boolean {
  return typesDeDef(def).has(type);
}

/** Def funding à sonder : active, et sur un marché perp — une série (STABLE.D, SPY…) reste inerte. */
function fundingSondable(def: AlertDef): boolean {
  return alerteActiveAuTemps(def, Date.now()) && defPorte(def, "funding-extreme") && !sansMarchePerpCible(def.source, def.symbol);
}

/**
 * Vrai si une def du lot vise un indicateur déclarant `refClose` facultative
 * (garde-fou de régime d'AXIS, défaut 100 depuis le 10 octobre 2026) : la série
 * de référence est alors demandée à `auxProvider` avant l'évaluation, alignée
 * par ouverture sur les bougies clôturées — même clé de cache et même fetch que
 * le chart (`refClose:{refSymbol}:{tf}`). Référence indisponible → évaluation
 * sans aux (condition de la v2). Les sous-conditions d'un composite comptent : sans la
 * référence, il lisait les signaux de la v2 et tirait sur une bougie où le garde-fou
 * avait bloqué l'achat, que ni le graphe ni l'alerte simple ne signalaient.
 */
function lotVeutRefClose(lot: AlertDef[]): boolean {
  return lot.some((d) =>
    (d.condition.type === "composite" ? d.condition.conditions : [d.condition]).some(
      (c) =>
        (c.type === "indicateur-seuil" || c.type === "indicateur-croisement") &&
        getIndicator(c.indicateurId)?.auxFacultatives?.includes("refClose") === true,
    ),
  );
}

/** Période de poll funding (ms) — lent, hors chemin chaud. */
const FUNDING_POLL_MS = 60_000;
/** Période d'évaluation des alertes on-chain (ms) — métriques quotidiennes, caches CHAIN. */
const ONCHAIN_POLL_MS = 15 * 60_000;
/** Période d'évaluation de `liq-cascade` (ms) — le poll fait aussi RETOMBER la fenêtre
 *  glissante sous le seuil (ré-armement) quand le flux se calme. */
const LIQ_CASCADE_POLL_MS = 5_000;
/** Fenêtre min. d'historique funding pour un z-score (points). Horizon variable selon la
 *  source : ~10 j (perp 8h) ou ~5 j (perp 4h) en primaire (`histFunding`, cadence réelle
 *  du perp) vs toujours ~10 j en repli Coinalyze (filtré aux frontières 8h UTC). */
const FUNDING_Z_WINDOW = 30;

/** Cooldown par (alerte, symbole) d'une alerte de preset (ms) : anti-spam sur un aller-retour. */
const PRESET_COOLDOWN_MS = 6 * 3_600_000;
/** Cap indicateurs réduit pour un scan d'alerte (échantillon plus léger que le run UI). */
const PRESET_CAP_INDICATEURS = 30;

/**
 * Pipeline du screener, chargé UNE fois au premier scan d'une alerte de preset : ≈ 11,8 Ko
 * minifiés (2 630 o gzip) hors du chargement initial (garde-fou : chargementInitial.test.ts). Promesse partagée par
 * les scans simultanés ; un échec de chargement (réseau) se retente au scan suivant.
 */
let pipelineScreener: Promise<[typeof import("../data/screenerRun"), typeof import("../data/screener")]> | null = null;
function chargerPipelineScreener(): NonNullable<typeof pipelineScreener> {
  pipelineScreener ??= Promise.all([import("../data/screenerRun"), import("../data/screener")]).catch((e: unknown) => {
    pipelineScreener = null;
    throw e;
  });
  return pipelineScreener;
}

/** Alertes déjà signalées pour un paramètre « unité » (un avertissement par alerte). */
const unitesSignalees = new Set<string>();

/**
 * Écarte d'un lot les alertes dont un indicateur porte le paramètre réservé « unité »
 * (SUG-1, phase 1 : graphe seul). Importée telle quelle, l'alerte calculerait sur les
 * bougies de son propre intervalle en ignorant l'unité : elle n'est pas évaluée, et le
 * motif est journalisé une fois. Passage obligé de toute évaluation (`appliquerResultat`).
 */
function sansUniteSuperieure(lot: AlertDef[]): AlertDef[] {
  return lot.filter((def) => {
    const unite = uniteImbriquee(def.condition);
    if (unite === null) return true;
    if (!unitesSignalees.has(def.id)) {
      unitesSignalees.add(def.id);
      console.warn(`[AXIOM] alerte ${def.id} non évaluée : ${motifUniteHorsGraphe(unite, "alerte")}`);
    }
    return false;
  });
}

/** Bougie close sur laquelle porte une évaluation de clôture, dans l'unité du graphe qui la sert. */
interface BougieEvaluee {
  /** Ouverture de la bougie (ms epoch). */
  time: number;
  timeframe: Timeframe;
}

/**
 * Defs d'un lot évaluées sous l'amorce de leur indicateur, la place n'ayant pas plus d'historique
 * (`profondeurAlerte` « courte ») ; `bougies` : bougies closes lues par le moteur. Leur message
 * reçoit « · amorce courte (N bougies) » : jamais une évaluation à la mauvaise profondeur sans le dire.
 */
interface AmorceCourte {
  ids: ReadonlySet<string>;
  bougies: number;
  /** La remontée a échoué (réseau) : la mention le dit (« chargement échoué »). */
  echec: boolean;
}

/**
 * Clôture (ms epoch) de la bougie ouverte à `ouverture` : ouverture + durée pour une unité à pas
 * fixe (`dureeTimeframeMs` ; les secondes et les minutes qu'elle ne couvre pas — 1s, 5s, 15s,
 * 3m — se lisent dans le nom de l'unité), début du mois calendaire UTC suivant pour 1M, 3M, 6M
 * et 12M. `null` seulement pour une unité inconnue : jamais une heure inventée.
 */
export function clotureBougie(ouverture: number, timeframe: Timeframe): number | null {
  const duree = dureeTimeframeMs(timeframe);
  if (duree !== null) return ouverture + duree;
  const pas = /^(\d+)([sm])$/.exec(timeframe);
  if (pas !== null) return ouverture + Number(pas[1]) * (pas[2] === "s" ? 1_000 : 60_000);
  const mois = /^(\d+)M$/.exec(timeframe);
  if (mois === null) return null;
  const debut = new Date(ouverture);
  return Date.UTC(debut.getUTCFullYear(), debut.getUTCMonth() + Number(mois[1]), 1);
}

/**
 * Mention ajoutée au message d'un déclenchement quand l'évaluation est un RATTRAPAGE : à l'instant
 * de l'évaluation, la bougie du signal a clôturé depuis STRICTEMENT plus d'une durée de bougie
 * (`maintenant − clôture > clôture − ouverture`). La bougie du signal est la bougie évaluée, ou
 * celle où un seuil d'indicateur est devenu vrai quand elle est plus ancienne (`ouvertureSignal`).
 * Cas : retour de Safari au premier plan sur un tampon resté en arrière, marché fermé depuis la
 * dernière bougie, AXIS acheté depuis plusieurs clôtures à la réouverture. Le message dit alors
 * quand cette bougie a clôturé, en heure locale. Chaîne vide sinon : clôture en direct, ouverture
 * de l'application dans la bougie qui suit (une durée de bougie de retard au plus), ou unité
 * inconnue.
 */
export function mentionRattrapage(ouverture: number, timeframe: Timeframe, maintenant: number): string {
  const cloture = clotureBougie(ouverture, timeframe);
  if (cloture === null || maintenant - cloture <= cloture - ouverture) return "";
  return ` · bougie close le ${formatDateCourte(cloture)} à ${formatHeureMinute(cloture)}`;
}

/**
 * Ouverture de la bougie du SIGNAL d'un seuil d'indicateur vrai sur la dernière bougie de
 * `ctx.candles` : la première de la suite de bougies, finissant à celle-ci, où la condition est
 * vraie. En direct c'est la bougie évaluée. Au retour dans l'application, la condition peut être
 * vraie depuis plusieurs clôtures (AXIS acheté trois bougies plus tôt) : le déclenchement porte
 * alors sur un signal plus ancien que la bougie évaluée, et c'est lui que le message date et que
 * « Voir » marque. Même calcul que le moteur (réglages de la condition, référence du garde-fou).
 * `undefined` : autre type de condition, sortie incalculable, condition fausse, ou vraie depuis
 * le début de la série lue — le début du signal n'est pas connu, jamais une bougie inventée.
 */
export function ouvertureSignal(condition: Condition, ctx: Pick<ContexteAlerte, "candles" | "aux">): number | undefined {
  const { candles } = ctx;
  if (condition.type !== "indicateur-seuil" || !candles) return undefined;
  const def = getIndicator(condition.indicateurId);
  const serie = def && computeIndicator(def, candles, condition.params, ctx.aux).series[condition.output];
  if (!serie) return undefined;
  /** La condition à la bougie `i` ; `undefined` sans valeur. */
  const vraie = (i: number): boolean | undefined => {
    const v = serie[i];
    return v === undefined ? undefined : comparer(v, condition.comparateur, condition.valeur);
  };
  let i = candles.length - 1;
  if (vraie(i) !== true) return undefined;
  while (i > 0 && vraie(i - 1) === true) i -= 1;
  return i > 0 && vraie(i - 1) === false ? candles[i]?.time : undefined;
}

/**
 * Applique une passe d'évaluation : persiste les defs modifiées, journalise + notifie. `bougie` :
 * la bougie close évaluée, pour une passe de clôture. « Voir » marque la bougie du signal — la
 * bougie évaluée, ou celle où un seuil d'indicateur est devenu vrai quand elle est plus ancienne
 * (`ouvertureSignal`) — et un rattrapage dit dans le message quand elle a clôturé (journal, avis
 * et notification portent le même texte). `courte` : defs évaluées sur une amorce courte, dont le
 * message le dit avant le rattrapage.
 */
function appliquerResultat(lotBrut: AlertDef[], ctx: ContexteAlerte, bougie?: BougieEvaluee, courte?: AmorceCourte): void {
  const lot = sansUniteSuperieure(lotBrut);
  if (lot.length === 0) return;
  const res = evaluerAlertes(lot, ctx);
  if (!res.modifie) return;
  // Les abonnés de l'écriture suivante sont synchrones et peuvent modifier le registre.
  const captures = res.declenchements.map((d) => capturerLectures(d.ts));
  const store = alertsStore.getState();
  store.appliquerMisesAJour(res.defs); // fusion par id (n'écrase pas les defs hors lot)
  for (const [index, brut] of res.declenchements.entries()) {
    // Une autre subscription synchrone peut supprimer ou désactiver la définition
    // pendant l'application des états. Ne pas notifier un ancien snapshot de defs.
    const def = lot.find((candidate) => candidate.id === brut.alertId);
    if (!def) continue;
    const signal = bougie === undefined ? undefined : (ouvertureSignal(def.condition, ctx) ?? bougie.time);
    const rattrapage = bougie === undefined || signal === undefined ? "" : mentionRattrapage(signal, bougie.timeframe, ctx.maintenant);
    const amorce = courte !== undefined && courte.ids.has(def.id) ? mentionAmorceCourte(courte.bougies, courte.echec) : "";
    const d = rattrapage === "" && amorce === "" ? brut : { ...brut, message: brut.message + amorce + rattrapage };
    const encoreNotifiable = (): boolean => alertsStore.getState().defs.some((courante) =>
      courante.id === d.alertId && courante.expireTs === def.expireTs && alerteActiveAuTemps(courante, Date.now()));
    if (!encoreNotifiable()) continue;
    store.ajouterJournal(enrichirDeclenchement(d, def, ctx, captures[index]));
    // Le journal déclenche des abonnés synchrones ; l'échéance ou la génération
    // peut changer entre l'archivage du signal et l'envoi externe.
    if (!encoreNotifiable()) continue;
    notifier(d, def, signal);
  }
}

/** Crée le runtime et démarre les abonnements. Renvoie une fonction d'arrêt. */
function creerRuntime(): Unsubscribe {
  const cleMarche = (source: AlertDef["source"], symbol: string): string => `${source}|${symbol}`;

  /** Dernier prix vu par marché (pour le `prixPrecedent` du sens `les-deux`). */
  const dernierPrix = new Map<string, number>();

  /**
   * Contexte fusionné par marché (hors React) — les flux y écrivent leur contribution.
   * `bougiesTampon` : taille du tampon du graphe (bougie en formation comprise) d'où viennent
   * `candles` ; un composite n'est pas évalué sous l'amorce de ses indicateurs.
   */
  type ContextePartiel = Partial<ContexteAlerte> & { timeframeBougies?: string; bougiesTampon?: number };
  const contextes = new Map<string, ContextePartiel>();
  const dernierEvalComposite = new Map<string, number>();

  const fusionner = (
    source: AlertDef["source"],
    symbol: string,
    patch: ContextePartiel,
  ): void => {
    const cle = cleMarche(source, symbol);
    const prev = contextes.get(cle) ?? {};
    if (patch.timeframeBougies !== undefined && patch.timeframeBougies !== prev.timeframeBougies) {
      dernierEvalComposite.delete(cle);
    }
    const { dernierPrix: prixPatch, ...reste } = patch;
    const next: ContextePartiel = { ...prev, ...reste };
    // 0 n'est pas une mesure : on n'écrase un prix ticker que par une valeur réelle.
    if (prixPatch !== undefined && Number.isFinite(prixPatch)) next.dernierPrix = prixPatch;
    contextes.set(cle, next);
  };

  /** Par marché : composites dont l'évaluation attend la référence du garde-fou de régime. */
  const attenteReference = new Map<string, Set<string>>();

  /**
   * Profondeur à laquelle une def peut être évaluée sur un tampon de `bougies` bougies (bougie en
   * formation comprise) du marché de graphe `cle` (R2) : même règle que la liste des alertes
   * (`profondeurAlerte`), lue sur l'état de l'extension publié par la vue principale.
   */
  const profondeur = (d: AlertDef, cle: string, bougies: number, extension: ExtensionGraphe | null): ProfondeurAlerte =>
    profondeurAlerte(amorceAlerte(d), bougies, extension, cle);
  /** Les defs d'un lot évaluées sur une amorce courte, et les bougies closes lues ; `undefined` si aucune. */
  const amorceCourte = (lot: readonly AlertDef[], estCourte: (d: AlertDef) => boolean, bougies: number, extension: ExtensionGraphe | null): AmorceCourte | undefined => {
    const ids = new Set(lot.filter(estCourte).map((d) => d.id));
    return ids.size === 0 ? undefined : { ids, bougies, echec: extension !== null && extension.echec };
  };

  /**
   * `seuls` : passe ciblée, hors cadence. Seuls les composites qu'il retient sont évalués, une
   * fois et sans le frein (qui n'est pas consommé) : ceux qu'un historique étendu sous la même
   * clôture vient de sortir de sous leur amorce (R5), ceux qui n'ont jamais été calibrés (R3),
   * ceux qui attendaient la référence du garde-fou de régime. Les autres l'ont déjà été.
   */
  const evaluerComposites = (source: AlertDef["source"], symbol: string, seuls?: (def: AlertDef) => boolean): void => {
    const cle = cleMarche(source, symbol);
    const now = Date.now();
    const last = dernierEvalComposite.get(cle) ?? 0;
    if (seuls === undefined && now - last < COMPOSITE_THROTTLE_MS) return;
    const partiel = contextes.get(cle);
    if (!partiel || partiel.dernierPrix === undefined || !Number.isFinite(partiel.dernierPrix)) return;
    const extension = extensionGrapheStore.getState().extension;
    const cleGraphe = partiel.timeframeBougies === undefined ? "" : cleMarcheGraphe({ exchange: source, symbol, timeframe: partiel.timeframeBougies as Timeframe });
    const profondeurComposite = (d: AlertDef): ProfondeurAlerte => profondeur(d, cleGraphe, partiel.bougiesTampon ?? 0, extension);
    const lot = alertsStore
      .getState()
      .defs.filter((d) => {
        if (!alerteActiveAuTemps(d, Date.now()) || d.source !== source || d.symbol !== symbol || d.condition.type !== "composite") {
          return false;
        }
        const porteBougie = [...TYPES_BOUGIE].some((type) => defPorte(d, type));
        if (porteBougie && d.timeframe !== undefined && d.timeframe !== partiel.timeframeBougies) return false;
        // Sous l'amorce d'un de ses indicateurs (AXIS, AXIS S/R), le composite n'est pas évalué tant
        // que le graphe remonte l'historique : armement figé, jamais un ET calculé à la mauvaise
        // profondeur. Remontée finie sur une place à sec : évalué, et son message le dit (R2).
        return profondeurComposite(d) !== "attente" && (seuls === undefined || seuls(d));
      });
    if (lot.length === 0) return;
    const courte = amorceCourte(lot, (d) => profondeurComposite(d) === "courte", (partiel.candles ?? []).length, extension);
    if (seuls === undefined) dernierEvalComposite.set(cle, now);
    const regime = regimeStore.getState().regime;
    const regimeScore =
      regime !== null && regime.libelle !== "indéterminé" ? regime.score : undefined;
    const ctx: ContexteAlerte = {
      maintenant: now,
      dernierPrix: partiel.dernierPrix,
      prixPrecedent: partiel.prixPrecedent,
      candles: partiel.candles,
      fundingRate: partiel.fundingRate,
      fundingZScore: partiel.fundingZScore,
      cvdDivergenceKind: partiel.cvdDivergenceKind,
      liqUsdParMin: partiel.liqUsdParMin,
      regimeScore,
    };
    // Référence du garde-fou de régime, comme pour une def simple : un composite lisant AXIS la
    // reçoit alignée sur les bougies de son contexte. En vol, ceux qui la lisent attendent son
    // arrivée (les autres sont évalués) ; en échec, évaluation sans elle (condition de la v2).
    const avecReference = partiel.candles === undefined || partiel.timeframeBougies === undefined ? [] : lot.filter((d) => lotVeutRefClose([d]));
    if (avecReference.length === 0) {
      appliquerResultat(lot, ctx, undefined, courte);
      return;
    }
    const statut = auxProvider.getAligned(
      {
        exchange: source,
        symbol,
        timeframe: partiel.timeframeBougies as Timeframe,
        ids: ["refClose"],
        candleTimes: (partiel.candles ?? []).map((c) => c.time),
      },
      () => {
        const attendus = attenteReference.get(cle);
        if (arrete || attendus === undefined) return;
        attenteReference.delete(cle);
        evaluerComposites(source, symbol, (d) => attendus.has(d.id));
      },
    );
    if (statut.status === "pending") {
      const attendus = attenteReference.get(cle) ?? new Set<string>();
      for (const d of avecReference) attendus.add(d.id);
      attenteReference.set(cle, attendus);
      const sansReference = lot.filter((d) => !avecReference.includes(d));
      if (sansReference.length > 0) appliquerResultat(sansReference, ctx, undefined, courte);
      return;
    }
    appliquerResultat(lot, statut.status === "ready" ? { ...ctx, aux: { refClose: statut.aux.refClose } } : ctx, undefined, courte);
  };

  // ── Flux ticker : conditions prix-croise ──────────────────────────────────
  const onTicker = (source: AlertDef["source"], { symbol, price }: TickerUpdate): void => {
    if (!Number.isFinite(price)) return;
    const cle = cleMarche(source, symbol);
    const precedent = dernierPrix.get(cle);
    fusionner(source, symbol, { dernierPrix: price, prixPrecedent: precedent });
    const lot = alertsStore
      .getState()
      .defs.filter(
        (d) =>
          alerteActiveAuTemps(d, Date.now()) &&
          d.source === source &&
          d.symbol === symbol &&
          d.condition.type === "prix-croise",
      );
    if (lot.length > 0) {
      appliquerResultat(lot, {
        maintenant: Date.now(),
        dernierPrix: price,
        prixPrecedent: precedent,
      });
    }
    dernierPrix.set(cle, price);
    evaluerComposites(source, symbol);
  };

  // (Re)souscription du flux ticker quand les marchés à alertes prix changent. Les
  // sources sans route ticker restent évaluées sur les clôtures du chart maître.
  let unsubTicker: Unsubscribe = () => {};
  let cleTicker = "";
  let generationTicker = 0;
  const resyncTicker = (): void => {
    const groupes = new Map<WatchlistSource, Set<string>>();
    for (const d of alertsStore.getState().defs) {
      if (!alerteActiveAuTemps(d, Date.now()) || !defPorte(d, "prix-croise") || !isTickerSource(d.source)) continue;
      const symbols = groupes.get(d.source) ?? new Set<string>();
      symbols.add(d.symbol);
      groupes.set(d.source, symbols);
    }
    const groupesTries = [...groupes.entries()]
      .map(([source, symbols]) => [source, [...symbols].sort()] as const)
      .sort(([sourceA], [sourceB]) => sourceA.localeCompare(sourceB));
    const cle = groupesTries.map(([source, symbols]) => `${source}:${symbols.join(",")}`).join(";");
    if (cle === cleTicker) return; // ensemble inchangé → on garde la souscription en place
    cleTicker = cle;
    unsubTicker();
    generationTicker += 1;
    const generation = generationTicker;
    const unsubs = groupesTries.map(([source, symbols]) =>
      subscribeTickers(
        symbols,
        (update) => {
          if (generation !== generationTicker) return;
          onTicker(source, update);
        },
        { source },
      ),
    );
    unsubTicker = () => {
      generationTicker += 1;
      for (const unsub of unsubs) unsub();
    };
  };

  // ── Clôture de bougie : conditions variation-pct + indicateur-* ────────────
  //
  // Règles d'évaluation (12 novembre 2026). T = dernière bougie close du graphe principal.
  //  R1. Chaque def de bougie active de ce marché est évaluée UNE fois pour T : à l'arrivée de
  //      T, au démarrage ou au retour sur ce marché si elle est évaluable ; sinon dès qu'elle le
  //      devient, tant que T reste la dernière close (`evalueePour`, suivi par def).
  //  R2. Une def dont un indicateur déclare une amorce A est évaluable si le tampon du graphe
  //      compte au moins A bougies (même décompte que l'extension d'historique du graphe), OU si
  //      l'extension de ce marché est TERMINÉE et visait au moins A (`profondeurAlerte`) : la
  //      place n'a pas plus d'historique, la def est évaluée sur ce qu'il y a et le message de son
  //      déclenchement reçoit « · amorce courte (N bougies) » (« N bougies, chargement échoué »
  //      quand une page a échoué : le graphe retente la remontée). Pendant l'extension (que la vue
  //      principale fait aussi pour les indicateurs des alertes actives de son marché, depuis le
  //      lot A2) : aucune évaluation, ni calibrage ni tir ; la liste écrit « historique… ».
  //      Quand l'état de l'extension change, `onMarket` est rappelé (R1 : évaluée dès qu'elle le
  //      devient).
  //  R3. Conséquence de R1 : une def créée, réactivée ou prolongée en cours de bougie est
  //      évaluée aussitôt sur T. Une def neuve (`arme` indéfini) s'y calibre sans tirer ; la
  //      clôture suivante peut donc la déclencher. (Avant : la première clôture servait de
  //      calibrage, et son signal était perdu.) Un composite jamais calibré, sur le marché
  //      affiché, l'est de même à chaque changement de définitions (revue globale).
  //  R4. La def est marquée évaluée pour T AVANT l'appel au moteur : l'écriture du résultat
  //      rappelle `onMarket` de façon synchrone (abonnement aux définitions).
  //  R5. Un prix sans route ticker garde sa cadence (à l'arrivée d'une clôture seulement : son
  //      sens « les deux » tire sans calibrage) ; un composite garde la sienne, mais reste figé
  //      sous l'amorce de ses indicateurs (`evaluerComposites`, même règle R2). Quand l'historique
  //      atteint cette amorce sous la même clôture (ou que l'extension finit sur une place à sec),
  //      il est évalué une fois pour T, comme une def simple (R1) :
  //      fait de conditions de bougie seules, rien d'autre ne l'évaluerait avant la clôture
  //      suivante. Un composite lisant AXIS reçoit la référence du garde-fou de régime, comme
  //      une def simple ; tant qu'elle est en vol, il attend (revue globale).
  //  R6. Le graphe quitte un marché ou une unité : ses bougies ne sont plus tenues à jour, elles
  //      sont retirées du contexte des composites. Un composite évalué au tick (prix, funding,
  //      liquidations) ne lit donc jamais des bougies périmées : il reste figé hors graphe, ce
  //      que la liste des alertes écrit.
  let derniereSource = "";
  let dernierSymbole = "";
  let dernierTf = "";
  let dernierTempsCloture = 0;
  /** Taille du tampon à la dernière publication du contexte des composites. */
  let dernierNombre = 0;
  /** État de l'extension du graphe principal au dernier passage (R2, R5). */
  let derniereExtension: ExtensionGraphe | null = null;
  /** Par def : ouverture de la dernière bougie close pour laquelle elle a été évaluée. */
  const evalueePour = new Map<string, number>();
  const onMarket = (): void => {
    const { exchange, symbol, timeframe, candles } = marketStore.getState();
    const extension = extensionGrapheStore.getState().extension;
    const cleGraphe = cleMarcheGraphe({ exchange, symbol, timeframe });
    // Changement de source, symbole OU TF (backfill) : on réinitialise le suivi de clôture.
    // Le TF compte depuis que les defs y sont filtrées : les clôtures d'un TF plus long
    // sont ANTÉRIEURES à la dernière vue sur un TF court, et resteraient ignorées.
    if (exchange !== derniereSource || symbol !== dernierSymbole || timeframe !== dernierTf) {
      // R6 : les bougies du marché quitté sortent du contexte des composites.
      if (derniereSource !== "") {
        fusionner(derniereSource as AlertDef["source"], dernierSymbole, { candles: undefined, timeframeBougies: undefined, bougiesTampon: undefined });
      }
      derniereSource = exchange;
      dernierSymbole = symbol;
      dernierTf = timeframe;
      dernierTempsCloture = 0;
      dernierNombre = 0;
      derniereExtension = null;
      evalueePour.clear();
    }
    if (candles.length < 2) return;
    const last = candles[candles.length - 1];
    if (!last) return;
    // Bougie de référence = dernière CLÔTURÉE (la live est écartée).
    const idxClose = last.closed === true ? candles.length - 1 : candles.length - 2;
    const barreClose = candles[idxClose];
    if (!barreClose || barreClose.time < dernierTempsCloture) return;
    const nouvelleCloture = barreClose.time > dernierTempsCloture;

    // Une def PORTE son TF d'évaluation ; `undefined` = def héritée (évaluée sur le TF
    // affiché, comportement d'origine). R1 : pas encore évaluée pour T ; R2 : amorce atteinte,
    // ou courte une fois l'extension du graphe terminée.
    const lot = alertsStore
      .getState()
      .defs.filter(
        (d) =>
          evalueePour.get(d.id) !== barreClose.time &&
          alerteActiveAuTemps(d, Date.now()) &&
          d.source === exchange &&
          d.symbol === symbol &&
          (TYPES_BOUGIE.has(d.condition.type) ||
            (nouvelleCloture && !isTickerSource(exchange) && d.condition.type === "prix-croise")) &&
          (d.timeframe === undefined || d.timeframe === timeframe) &&
          profondeur(d, cleGraphe, candles.length, extension) !== "attente"
      );
    // Chemin chaud (chaque tick de la bougie en formation) : rien de neuf, rien à faire.
    if (!nouvelleCloture && lot.length === 0 && candles.length === dernierNombre && extension === derniereExtension) return;
    const tamponAvant = dernierNombre;
    const extensionAvant = derniereExtension;
    derniereExtension = extension;
    dernierTempsCloture = barreClose.time;
    for (const d of lot) evalueePour.set(d.id, barreClose.time); // R4

    const avant = candles[idxClose - 1];
    const candlesCloturees = candles.slice(0, idxClose + 1);
    if (nouvelleCloture) {
      fusionner(exchange, symbol, {
        dernierPrix: barreClose.close,
        prixPrecedent: avant?.close,
        candles: candlesCloturees,
        timeframeBougies: timeframe,
        bougiesTampon: candles.length,
      });
    } else if (candles.length !== dernierNombre) {
      // L'historique s'est étendu sous la même clôture : les composites lisent la nouvelle
      // profondeur. Le prix n'est pas republié : un ticker plus récent a pu l'écrire.
      fusionner(exchange, symbol, { candles: candlesCloturees, bougiesTampon: candles.length });
    }
    dernierNombre = candles.length;
    if (lot.length > 0) {
      const bougie: BougieEvaluee = { time: barreClose.time, timeframe };
      // R2 : defs évaluées sous leur amorce, la place n'ayant pas plus d'historique.
      const courte = amorceCourte(lot, (d) => profondeur(d, cleGraphe, candles.length, extension) === "courte", candlesCloturees.length, extension);
      const ctxBase: ContexteAlerte = {
        maintenant: Date.now(),
        dernierPrix: barreClose.close,
        prixPrecedent: avant?.close,
        candles: candlesCloturees,
      };
      if (!lotVeutRefClose(lot)) {
        appliquerResultat(lot, ctxBase, bougie, courte);
      } else {
        // Référence du garde-fou de régime : une seule évaluation par clôture,
        // après l'arrivée de la série (échec → évaluation sans aux).
        const req = {
          exchange, symbol,
          timeframe,
          ids: ["refClose" as const],
          candleTimes: candlesCloturees.map((c) => c.time),
        };
        const ids = new Set(lot.map((d) => d.id));
        const reeval = (): void => {
          const a = auxProvider.getAligned(req, () => {});
          // Les defs sont RELUES par id : appliquer le lot capturé avant l'attente réécrivait
          // l'état d'alors, et annulait une pause ou une prolongation faite entre-temps.
          const courant = alertsStore.getState().defs.filter((d) => ids.has(d.id));
          const ctx: ContexteAlerte = { ...ctxBase, maintenant: Date.now() };
          // Une def mise en pause pendant l'attente n'est pas évaluée ici : sa marque est levée,
          // pour qu'une réactivation dans la même bougie l'évalue (R1).
          for (const d of courant) {
            if (!alerteActiveAuTemps(d, ctx.maintenant) && evalueePour.get(d.id) === bougie.time) evalueePour.delete(d.id);
          }
          appliquerResultat(courant, a.status === "ready" ? { ...ctx, aux: { refClose: a.aux.refClose } } : ctx, bougie, courte);
        };
        const statut = auxProvider.getAligned(req, reeval);
        if (statut.status === "ready") {
          appliquerResultat(lot, { ...ctxBase, aux: { refClose: statut.aux.refClose } }, bougie, courte);
        } else if (statut.status === "error") {
          appliquerResultat(lot, ctxBase, bougie, courte);
        }
        // pending : `reeval` évaluera la clôture à l'arrivée de la référence.
      }
    }
    if (nouvelleCloture) evaluerComposites(exchange, symbol);
    else if (candles.length !== tamponAvant || extension !== extensionAvant) {
      // R5 : les composites qui attendaient (historique sous la même clôture, ou fin de l'extension).
      evaluerComposites(exchange, symbol, (d) => profondeur(d, cleGraphe, tamponAvant, extensionAvant) === "attente");
    }
  };

  // ── Poll funding : conditions funding-extreme ─────────────────────────────
  // Cache par symbole : rate courant + z-score optionnel (historique Coinalyze).
  const cacheFunding = new Map<string, { rate: number; z?: number; ts: number }>();

  const evaluerFundingSymbol = (source: AlertDef["source"], symbol: string): void => {
    const snap = cacheFunding.get(cleMarche(source, symbol));
    if (!snap) return;
    const lot = alertsStore
      .getState()
      .defs.filter(
        (d) =>
          alerteActiveAuTemps(d, Date.now()) &&
          d.source === source &&
          d.symbol === symbol &&
          d.condition.type === "funding-extreme",
      );
    const mkt = marketStore.getState();
    const lastCandle =
      mkt.exchange === source && mkt.symbol === symbol
        ? mkt.candles[mkt.candles.length - 1]
        : undefined;
    const prixReel = lastCandle !== undefined && Number.isFinite(lastCandle.close) ? lastCandle.close : undefined;
    fusionner(source, symbol, {
      ...(prixReel !== undefined ? { dernierPrix: prixReel } : {}),
      fundingRate: snap.rate,
      fundingZScore: snap.z,
    });
    if (lot.length > 0) {
      appliquerResultat(lot, {
        maintenant: Date.now(),
        dernierPrix: prixReel ?? 0,
        fundingRate: snap.rate,
        fundingZScore: snap.z,
      });
    }
    evaluerComposites(source, symbol);
  };

  const pollFunding = async (): Promise<void> => {
    const sourcesParSymbole = new Map<string, Set<AlertDef["source"]>>();
    const signatureFunding = (source: AlertDef["source"], symbol: string): string =>
      alertsStore.getState().defs
        .filter((d) => alerteActiveAuTemps(d, Date.now()) && d.source === source && d.symbol === symbol && defPorte(d, "funding-extreme"))
        .map((d) => `${d.id}:${d.expireTs ?? "permanent"}`)
        .sort().join("|");
    const depart = new Map<string, string>();
    for (const d of alertsStore.getState().defs) {
      if (!fundingSondable(d)) continue;
      const sources = sourcesParSymbole.get(d.symbol) ?? new Set<AlertDef["source"]>();
      sources.add(d.source);
      sourcesParSymbole.set(d.symbol, sources);
      depart.set(cleMarche(d.source, d.symbol), signatureFunding(d.source, d.symbol));
    }
    for (const [symbol, sources] of sourcesParSymbole) {
      const encoreDemande = (): boolean => !arrete && [...sources].some((source) => {
        const cle = cleMarche(source, symbol);
        const signature = depart.get(cle);
        return signature !== undefined && signature !== "" && signature === signatureFunding(source, symbol);
      });
      if (!encoreDemande()) continue;
      const snap = await chargerFunding(symbol, encoreDemande);
      if (!snap) continue;
      for (const source of sources) {
        const cle = cleMarche(source, symbol);
        if (arrete || !depart.get(cle) || depart.get(cle) !== signatureFunding(source, symbol)) continue;
        cacheFunding.set(cle, { ...snap, ts: Date.now() });
        evaluerFundingSymbol(source, symbol);
      }
    }
  };

  let fundingTimer: ReturnType<typeof setInterval> | undefined;
  const resyncFunding = (): void => {
    const aDesFunding = alertsStore.getState().defs.some(fundingSondable);
    if (aDesFunding && fundingTimer === undefined) {
      void pollFunding();
      fundingTimer = setInterval(() => {
        void pollFunding();
      }, FUNDING_POLL_MS);
    } else if (!aDesFunding && fundingTimer !== undefined) {
      clearInterval(fundingTimer);
      fundingTimer = undefined;
    }
  };

  // ── Poll liq-cascade : buffer liq du chart → moteur ───────────────────────
  // Côté FRONT (cf. en-tête) : le buffer `liqEventsStore` ne couvre que le symbole
  // COURANT du chart et n'est alimenté que si le flux est retenu (heatmap ON ou fenêtre
  // LIQ ouverte). Flux non retenu → on n'évalue PAS (non évaluable : l'armement reste
  // figé, on n'injecte pas un 0 trompeur). Le daemon évalue AUSSI ce type onglet fermé
  // (tick 10 s, tous les symboles d'alerte) — l'anti-doublon heartbeat (>90 s) évite la
  // double notification quand l'app est ouverte.
  const evaluerLiqCascade = (): void => {
    if (!fluxLiqRetenu()) return; // flux inactif → non évaluable
    const { exchange, symbol } = marketStore.getState();
    const lot = alertsStore
      .getState()
      .defs.filter(
        (d) =>
          alerteActiveAuTemps(d, Date.now()) &&
          d.source === exchange &&
          d.symbol === symbol &&
          d.condition.type === "liq-cascade",
      );
    // Événements RÉELS uniquement : le seed Coinalyze (`approx`) est agrégé par bougie
    // et gonflerait artificiellement la minute glissante.
    const reels = liqEventsStore.getState().events.filter((ev) => ev.approx !== true);
    const nowMs = Date.now();
    const mkt = marketStore.getState();
    const lastCandle = mkt.candles[mkt.candles.length - 1];
    const liqUsdParMin = usdParMinute(reels, nowMs);
    const prixReel = lastCandle !== undefined && Number.isFinite(lastCandle.close) ? lastCandle.close : undefined;
    fusionner(exchange, symbol, {
      ...(prixReel !== undefined ? { dernierPrix: prixReel } : {}),
      liqUsdParMin,
    });
    if (lot.length > 0) {
      appliquerResultat(lot, {
        maintenant: nowMs,
        dernierPrix: prixReel ?? 0,
        liqUsdParMin,
      });
    }
    evaluerComposites(exchange, symbol);
  };

  let liqCascadeTimer: ReturnType<typeof setInterval> | undefined;
  const resyncLiqCascade = (): void => {
    const aDesCascade = alertsStore
      .getState()
      .defs.some((d) => alerteActiveAuTemps(d, Date.now()) && defPorte(d, "liq-cascade"));
    if (aDesCascade && liqCascadeTimer === undefined) {
      evaluerLiqCascade();
      liqCascadeTimer = setInterval(evaluerLiqCascade, LIQ_CASCADE_POLL_MS);
    } else if (!aDesCascade && liqCascadeTimer !== undefined) {
      clearInterval(liqCascadeTimer);
      liqCascadeTimer = undefined;
    }
  };

  // ── CVD spot/perp-div : pont orderflow → moteur ─────────────────────────
  const evaluerCvdSymbol = (source: AlertDef["source"], symbol: string): void => {
    const kind = cvdDivergenceStore.getState().bySymbol[symbol.toUpperCase()];
    // Clé absente → undefined : non évaluable (pipeline off).
    if (kind === undefined) return;
    const lot = alertsStore
      .getState()
      .defs.filter(
        (d) =>
          alerteActiveAuTemps(d, Date.now()) &&
          d.source === source &&
          d.symbol === symbol &&
          d.condition.type === "cvd-spot-perp-div",
      );
    const mkt = marketStore.getState();
    const lastCandle =
      mkt.exchange === source && mkt.symbol === symbol
        ? mkt.candles[mkt.candles.length - 1]
        : undefined;
    const prixReel = lastCandle !== undefined && Number.isFinite(lastCandle.close) ? lastCandle.close : undefined;
    fusionner(source, symbol, {
      ...(prixReel !== undefined ? { dernierPrix: prixReel } : {}),
      cvdDivergenceKind: kind,
    });
    if (lot.length > 0) {
      appliquerResultat(lot, {
        maintenant: Date.now(),
        dernierPrix: prixReel ?? 0,
        cvdDivergenceKind: kind,
      });
    }
    evaluerComposites(source, symbol);
  };

  // Demande éphémère distincte des deux toggles utilisateur persistés.
  const resyncCvd = (): void => {
    const demandee = alertsStore
      .getState()
      .defs.some((d) => alerteActiveAuTemps(d, Date.now()) && defPorte(d, "cvd-spot-perp-div"));
    const of = orderflowStore.getState();
    if (of.alerteCvdDemandee !== demandee) of.setAlerteCvdDemandee(demandee);
  };

  const unsubCvd = cvdDivergenceStore.subscribe((s, prev) => {
    const source = marketStore.getState().exchange;
    // Évalue seulement les symboles dont le kind a changé.
    for (const [sym, kind] of Object.entries(s.bySymbol)) {
      if (prev.bySymbol[sym] !== kind) evaluerCvdSymbol(source, sym);
    }
  });

  // ── Store régime : score composite −2..+2 → moteur ────────────────────────
  // Condition GLOBALE (lot filtré par TYPE seul). « indéterminé » (< 3 composants) :
  // score = bruit → non injecté (armement figé, pas de faux déclenchement).
  const evaluerRegime = (): void => {
    const regime = regimeStore.getState().regime;
    if (regime === null || regime.libelle === "indéterminé") return; // non évaluable
    const lot = alertsStore
      .getState()
      .defs.filter((d) => alerteActiveAuTemps(d, Date.now()) && d.condition.type === "regime-seuil");
    if (lot.length === 0) return;
    appliquerResultat(lot, {
      maintenant: Date.now(),
      dernierPrix: 0, // inutilisé par la condition (score global, sans symbole)
      regimeScore: regime.score,
    });
    for (const d of alertsStore.getState().defs) {
      if (alerteActiveAuTemps(d, Date.now()) && d.condition.type === "composite") evaluerComposites(d.source, d.symbol);
    }
  };

  const unsubRegime = regimeStore.subscribe(evaluerRegime);

  // ── Flux de capitaux lents : store commun CHAIN/BRIEF/STBL ────────────────
  // Le gestionnaire conserve son poll horaire même si tous les panneaux sont fermés,
  // tant qu'une définition active en dépend. Le moteur revalide âge et qualité.
  let evaluationFluxEnCours = false;
  let relancerEvaluationFlux = false;
  const evaluerFluxCapitaux = (): void => {
    if (evaluationFluxEnCours) {
      relancerEvaluationFlux = true;
      return;
    }
    evaluationFluxEnCours = true;
    try {
      do {
        relancerEvaluationFlux = false;
        const donnees = fluxCapitauxStore.getState().donnees;
        if (!donnees) break;
        const defsAvantPasse = alertsStore.getState().defs;
        for (const metrique of donnees.metriques) {
          if (metrique.valeur === null || !Number.isFinite(metrique.valeur) || !metrique.qualite ||
            metrique.observeLe === null || metrique.qualite.recupereLe === null ||
            metrique.qualite.cadenceMs === null) continue;
          // Relire à chaque métrique : une subscription synchrone peut supprimer,
          // désactiver ou ajouter une définition pendant l'application précédente.
          const lot = alertsStore.getState().defs.filter((d) => alerteActiveAuTemps(d, Date.now()) && d.condition.type === "flux-capitaux-seuil" && d.condition.metrique === metrique.id);
          if (lot.length === 0) continue;
          const condition = lot[0]!.condition;
          if (condition.type !== "flux-capitaux-seuil") continue;
          appliquerResultat(lot, {
            maintenant: Date.now(),
            dernierPrix: 0,
            fluxCapitaux: {
              metrique: condition.metrique,
              valeur: metrique.valeur,
              unite: metrique.unite,
              observeLe: metrique.observeLe,
              recupereLe: metrique.qualite.recupereLe,
              source: metrique.qualite.sourceEffective,
              cadenceMs: metrique.qualite.cadenceMs,
              ageMaxMs: AGE_MAX_FLUX_MS,
              statut: metrique.qualite.statut,
            },
          });
        }
        if (alertsStore.getState().defs !== defsAvantPasse) relancerEvaluationFlux = true;
      } while (relancerEvaluationFlux);
    } finally {
      evaluationFluxEnCours = false;
    }
  };
  const resyncFluxCapitaux = (): void => {
    const active = alertsStore.getState().defs.some((d) => alerteActiveAuTemps(d, Date.now()) && d.condition.type === "flux-capitaux-seuil");
    garderFluxCapitauxPourAlertes(active);
    if (active) evaluerFluxCapitaux();
  };
  const unsubFluxCapitaux = fluxCapitauxStore.subscribe((state, precedent) => {
    if (state.donnees !== precedent.donnees) evaluerFluxCapitaux();
  });

  // ── Alertes de PRESET : scan périodique + diff d'entrée dans l'ensemble ────
  // Chaque alerte active relance `executerScreener` (snapshot de ses filtres) à sa
  // période propre ; les symboles ENTRANTS (absents du scan précédent) hors cooldown
  // sont journalisés + notifiés. État par alerte (baseline + cooldown) en Maps de
  // closure, nettoyé au retrait/désactivation ; jamais deux ticks concurrents d'une
  // même alerte (garde `enCours`). Aucune écriture du screenerStore (run isolé).
  const timersPreset = new Map<string, ReturnType<typeof setInterval>>();
  /** Dernier ensemble de symboles scannés par alerte (absent = amorce → pas de déclenchement). */
  const dernierEnsemble = new Map<string, Set<string>>();
  /** Cooldown par alerte : symbole → ms epoch du dernier déclenchement. */
  const cooldownsPreset = new Map<string, Map<string, number>>();
  /** Génération par ID : une échéance puis prolongation ne valide pas un ancien scan. */
  const generationsPreset = new Map<string, number>();
  const echeancesPreset = new Map<string, number | undefined>();
  /** Un seul tick en cours PAR génération, sans verrou hérité d'une génération retirée. */
  const ticksEnCours = new Map<string, number>();
  let arrete = false;

  const tickPreset = async (id: string): Promise<void> => {
    // AUCUNE garde de visibilité : c'est la seule source d'alerte sans relais daemon —
    // la couper onglet caché laissait l'opérateur non couvert sans le savoir.
    const generation = generationsPreset.get(id);
    if (generation === undefined || ticksEnCours.get(id) === generation) return;
    const alerte = presetAlertsStore.getState().alertes.find((a) => a.id === id);
    if (!alerte || !alerteActiveAuTemps(alerte, Date.now())) return;
    const encoreValide = (): boolean => {
      if (arrete || generationsPreset.get(id) !== generation) return false;
      const courante = presetAlertsStore.getState().alertes.find((a) => a.id === id);
      return courante !== undefined && alerteActiveAuTemps(courante, Date.now()) && courante.expireTs === alerte.expireTs;
    };
    ticksEnCours.set(id, generation);
    try {
      // Un échec de chargement du pipeline est publié comme un échec de scan.
      const [{ executerScreener }, { notesNonMesures, notesReferenceNonEvaluee, SCREENER_POSITION_CAP }] =
        await chargerPipelineScreener();
      // Alerte retirée, désactivée ou prolongée pendant le chargement : aucun scan inutile.
      if (!encoreValide()) return;
      const res = await executerScreener(alerte.baseConditions, alerte.indicatorConditions, alerte.tf, {
        capIndicateurs: PRESET_CAP_INDICATEURS,
        capPosition: SCREENER_POSITION_CAP,
        ...(alerte.refSymbol !== undefined ? { refSymbol: alerte.refSymbol } : {}),
      });
      // Ré-validation POST-await : l'alerte a pu être retirée/désactivée pendant le scan en
      // vol — `resyncPreset` a alors déjà purgé son état. Sans ce contrôle, la ligne
      // `dernierEnsemble.set` ci-dessous RESSUSCITERAIT sa baseline (et pourrait déclencher
      // pour une alerte disparue).
      if (!encoreValide()) return;
      // Référence de force relative non lue : aucun symbole n'a pu passer les conditions
      // qui la lisent. Ce passage n'est pas un scan vide : échec publié, baseline gardée
      // (sinon le retour de la référence ferait « entrer » tout l'ensemble d'un coup).
      const referenceNonEvaluee = notesReferenceNonEvaluee(res.notes);
      if (referenceNonEvaluee.length > 0) {
        presetAlertsStore.getState().marquerScan(id, Date.now(), referenceNonEvaluee.join(" · "));
        return;
      }
      // Succès : erreur effacée ; les symboles non mesurés restent visibles.
      const nonMesures = notesNonMesures(res.notes);
      presetAlertsStore.getState().marquerScan(id, Date.now(), undefined, nonMesures.length > 0 ? nonMesures.join(" · ") : undefined);
      const courant = res.rows.map((r) => r.symbol);
      const precedent = dernierEnsemble.get(id) ?? null;
      const entrants = diffEntrants(precedent, courant);
      dernierEnsemble.set(id, new Set(courant));
      if (precedent === null) return; // amorce : baseline mémorisée, aucun déclenchement
      const cd = cooldownsPreset.get(id) ?? new Map<string, number>();
      const nowMs = Date.now();
      const retenus = filtrerCooldown(entrants, cd, nowMs, PRESET_COOLDOWN_MS);
      for (const sym of retenus) {
        if (!encoreValide()) return;
        cd.set(sym, nowMs);
        const d: Declenchement = {
          alertId: id,
          ts: nowMs,
          valeur: 0, // pas de valeur numérique : c'est une entrée dans un ensemble
          message: `EQS ${alerte.nom} : ${sym} entre dans le scan`,
        };
        alertsStore.getState().ajouterJournal(d);
        if (!encoreValide()) return;
        notifier(d);
      }
      cooldownsPreset.set(id, cd);
    } catch (e) {
      // Scan best-effort : un échec réseau ne casse ni la baseline ni le timer, mais il
      // est PUBLIÉ (le panneau affichait une pastille verte après des heures d'échecs).
      if (encoreValide()) presetAlertsStore
        .getState()
        .marquerScan(id, Date.now(), e instanceof Error ? e.message : String(e));
    } finally {
      if (ticksEnCours.get(id) === generation) ticksEnCours.delete(id);
    }
  };

  const resyncPreset = (): void => {
    const actives = presetAlertsStore.getState().alertes.filter((a) => alerteActiveAuTemps(a, Date.now()));
    const idsActifs = new Set(actives.map((a) => a.id));
    // Alertes disparues/désactivées : on stoppe le timer et on purge leur état.
    for (const [id, timer] of timersPreset) {
      const courante = actives.find((a) => a.id === id);
      if (idsActifs.has(id) && echeancesPreset.get(id) === courante?.expireTs) continue;
      clearInterval(timer);
      timersPreset.delete(id);
      dernierEnsemble.delete(id);
      cooldownsPreset.delete(id);
      ticksEnCours.delete(id);
      echeancesPreset.delete(id);
      generationsPreset.set(id, (generationsPreset.get(id) ?? 0) + 1);
    }
    // Nouvelles alertes actives : tick d'amorce immédiat (baseline) puis timer périodique.
    for (const a of actives) {
      if (timersPreset.has(a.id)) continue;
      generationsPreset.set(a.id, (generationsPreset.get(a.id) ?? 0) + 1);
      echeancesPreset.set(a.id, a.expireTs);
      void tickPreset(a.id);
      const periodeMs = a.periodeMin * 60_000;
      timersPreset.set(a.id, setInterval(() => void tickPreset(a.id), periodeMs));
    }
  };

  // ── Métriques on-chain lentes : alertes `onchain-seuil` ───────────────────
  // Poll 15 min sur les caches de CHAIN ; chargeur importé À LA DEMANDE (rien dans le
  // bundle d'entrée sans alerte on-chain). Une métrique absente laisse sa condition non
  // évaluable (armement figé, aucun faux déclenchement). Condition GLOBALE : lot par TYPE.
  let onchainTimer: ReturnType<typeof setInterval> | undefined;
  let onchainGeneration = 0;
  let onchainEnCoursGeneration: number | null = null;
  let onchainAbort: AbortController | null = null;
  let onchainCleRequises = "";
  let onchainDerniereEval = 0;
  const metriquesOnchainRequises = (): Set<MetriqueOnchainAlerte> => {
    const requises = new Set<MetriqueOnchainAlerte>();
    for (const d of alertsStore.getState().defs) {
      if (alerteActiveAuTemps(d, Date.now()) && d.condition.type === "onchain-seuil") requises.add(d.condition.metrique);
    }
    return requises;
  };
  const evaluerOnchain = async (): Promise<void> => {
    if (arrete || onchainEnCoursGeneration !== null) return;
    const requises = metriquesOnchainRequises();
    if (requises.size === 0) return;
    const generation = onchainGeneration;
    const controller = new AbortController();
    onchainAbort = controller;
    onchainEnCoursGeneration = generation;
    try {
      const { chargerMetriquesOnchain } = await import("./onchainMetriques");
      if (arrete || generation !== onchainGeneration) return;
      const onchainMetriques = await chargerMetriquesOnchain(requises, controller.signal);
      if (arrete || generation !== onchainGeneration) return;
      onchainDerniereEval = Date.now();
      // Relire le lot : une def a pu être retirée ou désactivée pendant le chargement.
      const lot = alertsStore.getState().defs.filter((d) => alerteActiveAuTemps(d, Date.now()) && d.condition.type === "onchain-seuil");
      appliquerResultat(lot, { maintenant: Date.now(), dernierPrix: 0, onchainMetriques });
    } catch (err) {
      if (!arrete && generation === onchainGeneration && !controller.signal.aborted) {
        console.error("[AXIOM] alertes on-chain : chargement des métriques échoué", err);
      }
    } finally {
      if (generation === onchainGeneration) {
        onchainEnCoursGeneration = null;
        onchainAbort = null;
      }
    }
  };
  const resyncOnchain = (): void => {
    const requises = metriquesOnchainRequises();
    const cle = alertsStore.getState().defs
      .filter((d) => alerteActiveAuTemps(d, Date.now()) && d.condition.type === "onchain-seuil")
      .map((d) => `${d.id}:${d.expireTs ?? "permanent"}`)
      .sort().join("|");
    const definitionsChangees = cle !== onchainCleRequises;
    if (definitionsChangees) {
      onchainGeneration += 1;
      onchainAbort?.abort();
      onchainAbort = null;
      onchainEnCoursGeneration = null;
      onchainCleRequises = cle;
    }
    if (requises.size === 0) {
      if (onchainTimer !== undefined) clearInterval(onchainTimer);
      onchainTimer = undefined;
      return;
    }
    if (onchainTimer === undefined) onchainTimer = setInterval(() => void evaluerOnchain(), ONCHAIN_POLL_MS);
    // Évaluation immédiate seulement si l'ensemble des métriques change (nouvelle alerte)
    // ou si le dernier passage date : un déclenchement quelconque ne relance rien.
    if (onchainEnCoursGeneration === null && (definitionsChangees || Date.now() - onchainDerniereEval >= ONCHAIN_POLL_MS)) {
      void evaluerOnchain();
    }
  };

  // Une échéance doit libérer les flux même en l'absence de tick ou de mutation.
  let echeanceTimer: ReturnType<typeof setTimeout> | undefined;
  const reconcilier = (): void => {
    resyncTicker();
    resyncFunding();
    resyncLiqCascade();
    resyncPreset();
    resyncCvd();
    resyncFluxCapitaux();
    resyncOnchain();
    evaluerRegime();
  };
  const planifierEcheance = (): void => {
    if (echeanceTimer !== undefined) clearTimeout(echeanceTimer);
    echeanceTimer = undefined;
    const now = Date.now();
    const prochaine = prochaineEcheanceAlerte(
      [...alertsStore.getState().defs, ...presetAlertsStore.getState().alertes], now,
    );
    if (prochaine === null) return;
    echeanceTimer = setTimeout(() => {
      echeanceTimer = undefined;
      reconcilier();
      planifierEcheance();
    }, Math.min(2_147_483_647, Math.max(1, prochaine - now)));
  };
  const auRetourOnglet = (): void => { reconcilier(); planifierEcheance(); };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", auRetourOnglet);

  // Démarrage : souscriptions + calibrage immédiat contre l'état courant.
  reconcilier();
  planifierEcheance();
  // Calibrage CVD sur l'état déjà publié (si orderflow déjà actif).
  for (const sym of Object.keys(cvdDivergenceStore.getState().bySymbol)) {
    evaluerCvdSymbol(marketStore.getState().exchange, sym);
  }
  evaluerRegime(); // calibrage régime sur le score déjà publié
  const unsubAlerts = alertsStore.subscribe((state, precedent) => {
    if (state.defs === precedent.defs) return;
    reconcilier(); // re-route et libère les besoins au changement de définitions
    planifierEcheance();
    // R3 : une def créée ou réactivée en cours de bougie est évaluée sur la dernière bougie
    // close sans attendre la suivante (les defs déjà évaluées pour elle ne le sont pas deux fois).
    onMarket();
    // De même un composite jamais calibré, sur le marché affiché, quand il est fait de conditions
    // de bougie SEULES : il se calibre sur la dernière bougie close sans tirer, la clôture
    // suivante peut donc le déclencher (il attendait cette clôture pour se calibrer, et son
    // signal était perdu). Un composite qui porte une autre condition (prix, funding…) garde son
    // calibrage au premier évènement de cette condition : ici le « dernier prix » du contexte
    // peut n'être que la dernière clôture, et un niveau placé entre elle et le prix en direct
    // serait armé, puis sonnerait au premier tick alors que la condition était déjà vraie.
    const { exchange, symbol } = marketStore.getState();
    evaluerComposites(exchange, symbol, (d) => d.arme === undefined && [...typesDeDef(d)].every((type) => TYPES_BOUGIE.has(type)));
  });
  const unsubMarket = marketStore.subscribe(onMarket);
  // R2 : la fin de l'extension d'historique du graphe principal rend évaluables, sous la même
  // clôture, les defs d'une place qui n'a pas l'amorce de leur indicateur.
  const unsubExtension = extensionGrapheStore.subscribe(onMarket);
  onMarket(); // calibrage initial des conditions bougie sur le backfill présent

  // Ajout/retrait/bascule d'une alerte de preset → re-cadre les timers de scan.
  const unsubPreset = presetAlertsStore.subscribe(() => { resyncPreset(); planifierEcheance(); });

  const stopHeartbeat = demarrerHeartbeat();

  return () => {
    arrete = true;
    onchainGeneration += 1;
    onchainAbort?.abort();
    onchainAbort = null;
    unsubAlerts();
    unsubMarket();
    unsubExtension();
    unsubTicker();
    unsubCvd();
    unsubRegime();
    unsubFluxCapitaux();
    garderFluxCapitauxPourAlertes(false);
    unsubPreset();
    orderflowStore.getState().setAlerteCvdDemandee(false);
    if (echeanceTimer !== undefined) clearTimeout(echeanceTimer);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", auRetourOnglet);
    stopHeartbeat();
    if (fundingTimer !== undefined) clearInterval(fundingTimer);
    if (liqCascadeTimer !== undefined) clearInterval(liqCascadeTimer);
    if (onchainTimer !== undefined) clearInterval(onchainTimer);
    for (const timer of timersPreset.values()) clearInterval(timer);
    timersPreset.clear();
    dernierEnsemble.clear();
    cooldownsPreset.clear();
    ticksEnCours.clear();
    generationsPreset.clear();
    echeancesPreset.clear();
  };
}

/**
 * Charge le funding courant (Binance premiumIndex, fraction) + z-score optionnel
 * depuis l'historique Coinalyze (best-effort : z omis si indisponible).
 */
async function chargerFunding(
  symbol: string,
  encoreDemande: () => boolean
): Promise<{ rate: number; z?: number } | undefined> {
  if (!encoreDemande()) return undefined;
  let rate: number | undefined;

  // 1) Snapshot Binance fapi (gratuit, fiable) — fraction lastFundingRate.
  try {
    const res = await fetch(
      extUrl("fapi.binance.com", `fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`)
    );
    if (!encoreDemande()) return undefined;
    if (res.ok) {
      const raw: unknown = await res.json();
      if (!encoreDemande()) return undefined;
      const last =
        raw !== null && typeof raw === "object"
          ? Number((raw as { lastFundingRate?: unknown }).lastFundingRate)
          : Number.NaN;
      if (Number.isFinite(last)) rate = last;
    }
  } catch {
    /* best-effort */
  }

  // 2) Repli Coinalyze si premiumIndex a échoué.
  if (!encoreDemande()) return undefined;
  if (rate === undefined) {
    try {
      const fr = await coinalyzeProvider.fetchFundingRate(symbol);
      if (!encoreDemande()) return undefined;
      if (Number.isFinite(fr.rate)) rate = fr.rate;
    } catch {
      /* best-effort */
    }
  }
  if (rate === undefined) return undefined;

  // 3) Z-score sur les RÈGLEMENTS RÉELS (Binance fapi/v1/fundingRate via histFunding —
  //    cadence 8 h OU 4 h selon le perp, memoïsé). Repli : Coinalyze « 4hour » filtré aux
  //    frontières de règlement 8 h UTC (00/08/16) — « 8hour » N'EXISTE PAS chez Coinalyze
  //    et repliait en silence sur du 5 min : les 30 « règlements » couvraient ~2 h 30,
  //    écart-type ≈ 0, z aberrant. Filtre sur le TEMPS (pas sur l'index) : un
  //    sous-échantillonnage par index ne garantit pas l'alignement sur les vraies
  //    frontières de règlement (cf. `filtrerFrontieres8h`).
  let z: number | undefined;
  try {
    let rates = ((await histFunding(symbol)) ?? []).map((p) => p.v);
    if (!encoreDemande()) return undefined;
    if (rates.length === 0) {
      const since = Date.now() - FUNDING_Z_WINDOW * 8 * 3_600_000;
      const hist = await coinalyzeProvider.fetchFundingRateHistory(symbol, "4hour", since);
      if (!encoreDemande()) return undefined;
      // Filtre les taux finis AVANT la sélection par frontière (sinon un point non-fini
      // sur une frontière retenue élargirait silencieusement un trou à ~16 h).
      const finis = hist.filter((h) => Number.isFinite(h.rate));
      rates = filtrerFrontieres8h(finis).map((h) => h.rate);
    }
    // Inclut le rate courant s'il n'est pas déjà le dernier point.
    const series =
      rates.length > 0 && rates[rates.length - 1] === rate ? rates : [...rates, rate];
    if (series.length >= Math.min(5, FUNDING_Z_WINDOW)) {
      const win = series.slice(-FUNDING_Z_WINDOW);
      const mean = win.reduce((a, b) => a + b, 0) / win.length;
      const variance = win.reduce((a, b) => a + (b - mean) ** 2, 0) / win.length;
      const sd = Math.sqrt(variance);
      z = sd === 0 ? 0 : (rate - mean) / sd;
    }
  } catch {
    /* z optionnel */
  }

  if (!encoreDemande()) return undefined;
  return { rate, z };
}

// Singleton : évite les doubles souscriptions (ex. double montage en React StrictMode).
let arreter: Unsubscribe | null = null;

/**
 * Démarre le runtime des alertes (idempotent : un second appel arrête d'abord le
 * précédent). À câbler UNE fois par un agent ultérieur (ex. dans App). Renvoie l'arrêt.
 */
export function demarrerAlertes(): Unsubscribe {
  if (arreter) arreter();
  const stop = creerRuntime();
  arreter = () => {
    stop();
    arreter = null;
  };
  return arreter;
}

// ───────── Heartbeat vers le daemon (anti-doublon onglet fermé) ─────────
//
// Tant que l'app est OUVERTE, elle POST /heartbeat toutes les 30 s avec
// `{visible, canNotify}`. Le daemon relaie macOS sauf si le heartbeat est récent
// ET `canNotify: true` (onglet visible + permission). Champ absent (legacy) ⇒ relais.
// Telegram reste propriétaire du daemon. Sans daemon : aucun POST.

/** Intervalle d'émission du heartbeat (ms). */
const HEARTBEAT_MS = 30_000;

function ongletVisible(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "visible";
}

function permissionNotificationAccordee(): boolean {
  return typeof Notification !== "undefined" && Notification.permission === "granted";
}

/** Corps heartbeat v2 : le front ne notifie que si visible ET permission. */
function payloadHeartbeat(): { visible: boolean; canNotify: boolean } {
  const visible = ongletVisible();
  return { visible, canNotify: visible && permissionNotificationAccordee() };
}

/** Envoie un heartbeat (best-effort, silencieux) si le daemon est détecté présent. */
function envoyerHeartbeat(): void {
  if (!daemonSupporte("alerts")) return;
  try {
    void fetch(urlDaemon("/heartbeat"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payloadHeartbeat()),
    }).catch(() => {});
  } catch {
    /* best-effort */
  }
}

/**
 * Démarre le heartbeat périodique + un push initial des défs au daemon une fois
 * celui-ci confirmé présent. Renvoie une fonction d'arrêt.
 */
function demarrerHeartbeat(): Unsubscribe {
  let arrete = false;
  // Détection (mémoïsée) : au succès, on sème les défs courantes et on bat le cœur.
  void detectDaemon(["alerts", "kv"]).then((present) => {
    if (!present || arrete) return;
    pousserDefsDaemon();
    envoyerHeartbeat();
  });
  // Le relais change dès que l'onglet est masqué, sans fenêtre muette de 30 secondes.
  const documentHeartbeat = typeof document !== "undefined" ? document : undefined;
  documentHeartbeat?.addEventListener("visibilitychange", envoyerHeartbeat);
  const timer = setInterval(envoyerHeartbeat, HEARTBEAT_MS);
  return () => {
    arrete = true;
    clearInterval(timer);
    documentHeartbeat?.removeEventListener("visibilitychange", envoyerHeartbeat);
  };
}

// ───────── Notification système + bip WebAudio (best-effort) ─────────

/**
 * Demande la permission de notification si elle n'a pas encore été décidée.
 * À appeler depuis un geste utilisateur (contrainte navigateur). Sans effet si refusée/accordée.
 */
export function demanderPermissionNotifications(): void {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  } catch {
    /* API absente / bloquée : best-effort */
  }
}

/**
 * Ce que « Voir » et la liste des alertes ont besoin de savoir d'une def. `condition` : absente
 * pour une cible du journal ; présente, elle dit si le symbole est un marché (`sansMarche`).
 */
type MarcheAlerte = Pick<AlertDef, "symbol" | "source" | "timeframe"> & Partial<Pick<AlertDef, "condition">>;

/**
 * Ramène la vue PRINCIPALE (slot 0) sur le marché d'une alerte, dans son unité quand elle en
 * porte une, et y marque `tempsMarque`. La vue principale, pas la vue focalisée : c'est la seule
 * que les alertes de bougie lisent ; changer une vue secondaire laisserait l'alerte « hors
 * graphe ». La navigation tire le graphe et ses dessins : elle est importée ici, à l'usage, pour
 * que le runtime reste chargeable sans eux.
 */
export async function voirAlerte(def: MarcheAlerte, tempsMarque?: number): Promise<void> {
  const { navigateTo } = await import("../lib/navigation");
  chartLayoutStore.getState().setFocus(0);
  navigateTo({
    symbol: def.symbol,
    exchange: def.source,
    ...(def.timeframe !== undefined ? { timeframe: def.timeframe } : {}),
    ...(tempsMarque !== undefined ? { markTime: tempsMarque } : {}),
    source: "alerte",
  });
}

/**
 * Notifie un déclenchement. Toujours un avis à l'écran, qui reste jusqu'au toucher : au téléphone
 * c'est le seul signal sûr. Avec la def : « SYMBOLE UNITÉ — message » (le message ne porte ni l'un
 * ni l'autre, convention de @axiom/alerts) et le bouton « Voir », qui marque `tempsMarque` — la
 * bougie du signal pour une alerte de bougie, l'instant du déclenchement sinon. Sans def (alerte de
 * preset) : le message seul, sans « Voir ». Pas de « Voir » non plus quand le symbole de la def
 * n'est pas un marché (alerte baleines, portée par l'actif surveillé) : il enverrait la vue
 * principale sur un marché qui n'existe pas. Notification API seulement si onglet visible ET
 * permission, titrée du marché ; puis le bip.
 */
export function notifier(d: Declenchement, def?: MarcheAlerte, tempsMarque: number = d.ts): void {
  const marche = def === undefined ? null : def.timeframe === undefined ? def.symbol : `${def.symbol} ${def.timeframe}`;
  const rienAVoir = def === undefined || (def.condition !== undefined && sansMarche(def.condition));
  pousserToast(
    marche === null ? d.message : `${marche} — ${d.message}`,
    rienAVoir ? undefined : { libelle: "Voir", executer: () => void voirAlerte(def, tempsMarque) },
    0,
  );
  try {
    if (ongletVisible() && permissionNotificationAccordee()) {
      new Notification(marche === null ? "AXIOM — alerte" : `AXIOM — ${marche}`, { body: d.message });
    }
  } catch {
    /* best-effort */
  }
  bip();
}

type AudioCtor = typeof AudioContext;
let audioCtx: AudioContext | null = null;

/** Récupère le constructeur AudioContext (préfixe webkit sur certains navigateurs). */
function ctorAudio(): AudioCtor | undefined {
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext;
}

/** Bip court et discret (oscillateur sinus ~120 ms, volume faible). */
function bip(): void {
  try {
    const Ctor = ctorAudio();
    if (!Ctor) return;
    if (!audioCtx) audioCtx = new Ctor();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.05; // discret
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const t = audioCtx.currentTime;
    osc.start(t);
    osc.stop(t + 0.12);
  } catch {
    /* audio best-effort (contexte non repris tant qu'aucun geste utilisateur) */
  }
}
