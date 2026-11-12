/**
 * Alerte de prix au bord d'une zone forte d'AXIS S/R (phase 2 d'AXIS, lot 2, 12 novembre 2026).
 *
 * Le seul avertissement plus tôt que la clôture : une alerte de prix EXISTANTE (`prix-croise`,
 * évaluée à chaque tick), posée d'un geste sur le bord d'une zone forte, à NIVEAU FIXE. Ce n'est
 * ni un signal ni une mesure : aucun texte ne promet rien ; ceux qui offrent l'alerte, la
 * confirment ou la portent (bouton, avis de pose, message) disent « niveau fixe ».
 *
 *  - Les zones sont LUES dans les rubans que l'instance montée a tracés, jamais recalculées. Zone
 *    forte active = ruban porteur d'un texte et bande pleine (alpha > 0) ; faible = alpha 0 ;
 *    cassée = sans texte (`stratAxisSr.ts`). Le texte lui-même n'est jamais lu : il peut changer.
 *  - Bord proposé : celui tourné vers le cours — haut d'un support, bas d'une résistance —, le même
 *    que l'écart affiché au bord droit (`ecartBordZone`). C'est la dernière borne DÉCIDÉE : les
 *    rubans s'arrêtent à la dernière bougie décidée, la bougie en formation n'est pas lue.
 *  - Causalité : seul l'état « franchi » lit le dernier prix du graphe, bougie en formation
 *    comprise. Il ne décide aucun signal : il prédit le calibrage du moteur, qui lit ce même prix
 *    et resterait muet (`@axiom/alerts`, le premier prix calibre sans tirer).
 *  - Ni doublée (« posee »), ni muette (« franchi »), ni éternelle (échéance de 7 jours).
 *
 *  - Sources à flux de prix au tick seulement (`isTickerSource`, arbitrage A3 de l'orchestrateur) :
 *    sur une série synthétique (source « synthetic » : ratio, spread, capitalisation), aucune offre,
 *    ni bouton ni entrée de menu. Le moteur n'ouvre aucun flux de prix pour elle et ne l'évalue qu'à
 *    chaque nouvelle clôture du graphe principal, s'il affiche ce marché (`alerts/runtime.ts`) : le
 *    cours pourrait traverser le bord et revenir dans la bougie sans que rien ne sonne. Ce ne serait
 *    plus un avertissement en cours de bougie.
 *
 * LIMITES : le niveau ne suit pas la zone, qui peut bouger ou casser ; chaque bord déplacé propose
 * une alerte de plus ; une zone hors de la fenêtre de prix ne se touche pas ; au téléphone, pas
 * d'offre là où l'encart, bouton compris, ne tient pas dans la zone libre du pane (paysage, écran
 * de 320 px avec « Détails » ou un pane d'indicateur : `candleReadout.ts`).
 *
 * BUDGET : ce module est dans le chargement initial, compté à l'octet (`scripts/
 * verifier-budget-build.mjs`). La cible du build réécrit en long chaque `?.` : il est évité ici
 * (`a && a.b`), comme dans les lignes que ce lot ajoute à `candleReadout.ts`.
 */
import type { Chart, Crosshair } from "klinecharts";
import type { AlertDef, SensCroisement } from "@axiom/alerts";
import type { AnnotationsIndicateur, IndicatorResult } from "@axiom/types";
import { alertePrixAuNiveau, alertsStore, arrondirNiveauAlerte, SECTION_ALERTES, type NouvelleAlerte } from "../store/alerts";
import { indicatorsStore } from "../store/indicators";
import { pousserToast } from "../store/toasts";
import { uiSectionsStore } from "../store/ui-sections";
import { daemonSupporte } from "../data/daemon";
import { isTickerSource } from "../data/ticker";
import { formatDateCourte } from "../lib/format";
import type { OffreEncart } from "./candleReadout";
import { axiomName } from "./indicators";
import type { PriceAlertMarket } from "./priceAlertMenu";
import { uniteDemandee } from "./uniteParam";

const CANDLE_PANE_ID = "candle_pane";
/** Échéance d'une alerte de zone : une des durées du panneau, prolongeable par son « +24 h ». */
export const DUREE_ALERTE_ZONE_MS = 7 * 24 * 3_600_000;

/** Zone forte active telle que le graphe la trace : rôle, et bornes par bougie depuis `deIdx`. */
export interface ZoneForteTracee {
  role: "support" | "resistance";
  deIdx: number;
  hauts: number[];
  bas: number[];
}

/** Zones fortes actives d'un jeu d'annotations d'AXIS S/R (voir l'en-tête) : le ruban, et son rôle. PURE. */
export function zonesFortesTracees(annotations: AnnotationsIndicateur | undefined): ZoneForteTracee[] {
  return ((annotations && annotations.rubans) || [])
    .filter((r) => r.info !== undefined && r.alpha > 0 && r.hauts.length > 0)
    .map((r) => ({ ...r, role: r.couleur === "--up" ? "support" : "resistance" }));
}

/**
 * Zone dont la bande, à la bougie `idx`, est à `tolerancePx` ou moins de l'ordonnée `y` (0 dans la
 * bande) : la plus proche, la première à égalité ; `null` sinon. `yDe` convertit un prix en
 * ordonnée, dans le repère de `y`. Avant la première bougie de la zone : jamais. Au-delà de la
 * dernière bougie tracée (marge droite) : les dernières bornes. Même distance que l'infobulle
 * (`distanceVerticale`, indicators.ts). PURE.
 */
export function zoneSousPoint(
  zones: readonly ZoneForteTracee[],
  idx: number,
  y: number,
  yDe: (prix: number) => number,
  tolerancePx = 0,
): ZoneForteTracee | null {
  let meilleure: ZoneForteTracee | null = null;
  let ecartMin = Infinity;
  for (const zone of zones) {
    // Avant la première bougie de la zone, l'indice est négatif : aucune borne.
    const k = Math.min(idx - zone.deIdx, zone.hauts.length - 1);
    const yA = yDe(zone.hauts[k]!);
    const yB = yDe(zone.bas[k]!);
    const dessus = Math.min(yA, yB);
    const dessous = Math.max(yA, yB);
    // Borne absente, ordonnée ou conversion non finie : jamais « dans la bande ».
    if (!Number.isFinite(y + dessus + dessous)) continue;
    const ecart = y < dessus ? dessus - y : y > dessous ? y - dessous : 0;
    if (ecart <= tolerancePx && ecart < ecartMin) {
      meilleure = zone;
      ecartMin = ecart;
    }
  }
  return meilleure;
}

/** Bord tourné vers le cours, à sa DERNIÈRE valeur tracée, et sens du croisement qui l'atteint. PURE. */
export function bordZone(zone: ZoneForteTracee): { niveau: number; sens: Exclude<SensCroisement, "les-deux"> } {
  const support = zone.role === "support";
  return { niveau: arrondirNiveauAlerte((support ? zone.hauts : zone.bas).at(-1) ?? NaN), sens: support ? "baisse" : "hausse" };
}

/** Ce que le geste propose pour une zone : état, texte du bouton, et l'alerte à créer s'il y en a une. */
export interface OffreBordZone {
  /** « offre » : l'alerte peut être posée ; « posee » : elle existe déjà ; « franchi » : elle resterait muette. */
  etat: "offre" | "posee" | "franchi";
  /** Texte du bouton (encart du téléphone) ou de l'entrée (menu du bureau). */
  libelle: string;
  /** Avis écrit à la pose, sans la mention de portée (`poserAlerteZone`). */
  avis: string;
  /** Alerte à créer : état « offre » seulement. */
  alerte?: NouvelleAlerte;
}

/**
 * Offre d'alerte au bord de `zone`. PURE.
 *  - « posee » : une def de prix de même symbole, source, niveau et sens existe, active ou en
 *    pause, non expirée. Elle passe avant « franchi » : l'alerte existe, même le bord franchi.
 *  - « franchi » : le dernier prix connu a déjà atteint ou passé le bord (dans la zone, ou
 *    au-delà). Le moteur se calibrerait désarmé : l'alerte ne sonnerait qu'après une sortie puis
 *    un retour. Prix inconnu : l'offre vaut.
 *  - « offre » : alerte `prix-croise` au bord, qui expire 7 jours après `maintenant`.
 * Le message suit la convention de `@axiom/alerts` (ni symbole ni unité de l'ALERTE : l'hôte les
 * ajoute) ; l'unité qu'il cite est celle de l'instance d'AXIS S/R, donc du graphe. Comparateur et
 * niveau d'abord, pour rester lus là où un texte est coupé ; il finit par « · niveau fixe ». Sa
 * longueur est de 68 caractères plus celle du niveau écrit, au plus : 78 sur le cas de référence
 * (résistance à 106,340.68, unité à trois caractères), 80 pour tout niveau sous dix millions.
 */
export function offreBordZone(
  zone: ZoneForteTracee,
  marche: Pick<PriceAlertMarket, "symbol" | "source" | "timeframe">,
  dernierPrix: number | undefined,
  defs: readonly AlertDef[],
  maintenant: number,
): OffreBordZone {
  const support = zone.role === "support";
  const { niveau, sens } = bordZone(zone);
  // Le niveau est écrit avec TOUTES les décimales de l'alerte (2 à 8, `arrondirNiveauAlerte`), pas
  // celles d'un prix affiché (`formatPrice` : 2 au-dessus de 1, 4 en dessous). Le message remplace
  // la condition partout où l'alerte se lit : arrondi, il écrivait « ≤ 2.35 » pour 2.3457 et
  // « ≤ 1.00 » pour 1.0049, et le vrai niveau ne se lisait nulle part.
  const n = niveau.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 });
  const cible = `${support ? "↓" : "↑"} ${n}`;
  const bord = `bord ${support ? "du support fort" : "de la résistance forte"}`;
  const symbole = marche.symbol.toUpperCase();
  const avis = `Alerte de prix posée : ${symbole} ${cible} · niveau fixe · expire dans 7 jours`;
  const posee = defs.some((d) =>
    d.symbol === symbole && d.source === marche.source && d.condition.type === "prix-croise" &&
    d.condition.niveau === niveau && d.condition.sens === sens && (d.expireTs === undefined || maintenant < d.expireTs));
  if (posee) return { etat: "posee", avis, libelle: `Alerte déjà posée ${cible} · ${bord}` };
  // Un prix non fini n'est ni sous ni sur le bord : la comparaison est fausse, l'offre vaut.
  if (dernierPrix !== undefined && (support ? dernierPrix <= niveau : dernierPrix >= niveau)) {
    return { etat: "franchi", avis, libelle: `Pas d'alerte : le cours a déjà franchi le ${bord} (${n})` };
  }
  const message = `${support ? "≤" : "≥"} ${n} · ${bord} AXIS S/R${marche.timeframe ? ` ${marche.timeframe}` : ""} du ${formatDateCourte(maintenant)} · niveau fixe`;
  return {
    etat: "offre",
    avis,
    // Espaces insécables : « niveau fixe, 7 jours » ne se coupe pas (à 390 px, « jours » restait
    // seul sur la seconde ligne du bouton, loin de son « 7 »).
    libelle: `Alerte de prix ${cible} · ${bord} · niveau\u00a0fixe,\u00a07\u00a0jours`,
    alerte: {
      ...alertePrixAuNiveau(symbole, marche.source, niveau, sens, message),
      expireTs: maintenant + DUREE_ALERTE_ZONE_MS,
    },
  };
}

/**
 * Zones fortes des instances d'AXIS S/R montées sur le pane des prix de `chart`. Aucune en rejeu,
 * ni sur une source sans flux de prix au tick (voir l'en-tête).
 * L'instance est choisie par sa DÉFINITION, jamais par la forme de ses annotations : la prime
 * spot/perp trace aussi des rubans porteurs d'un texte. Une instance au réglage « unite » est
 * écartée : ses zones seraient celles d'une autre unité que celle que le message écrit
 * (aujourd'hui le graphe refuse de la tracer, cf. `uniteSuperieure.ts` ; la garde tient si cela change).
 */
export function zonesDuGraphe(chart: Chart, marche: PriceAlertMarket): ZoneForteTracee[] {
  if (marche.rejeu || !isTickerSource(marche.source)) return [];
  return indicatorsStore.getState().indicators
    .filter((i) => i.defId === "stratAxisSr" && uniteDemandee(i.params) === null)
    .flatMap((i) => {
      const monte = chart.getIndicatorByPaneId(CANDLE_PANE_ID, axiomName(i.instanceId)) as { extendData?: IndicatorResult } | null;
      return zonesFortesTracees(monte && monte.extendData ? monte.extendData.annotations : undefined);
    });
}

/** Offre calculée à l'instant : dernier prix du graphe, alertes existantes, heure. */
function offreDuGraphe(chart: Chart, marche: PriceAlertMarket, zone: ZoneForteTracee): OffreBordZone {
  const derniere = chart.getDataList().at(-1);
  return offreBordZone(zone, marche, derniere && derniere.close, alertsStore.getState().defs, Date.now());
}

/**
 * Pose l'alerte au bord de `zone`, si l'offre vaut encore AU MOMENT DU GESTE. Ouvre la section
 * « Alertes » et pousse un avis de 6 s dont « Annuler » supprime l'alerte créée. L'avis dit la
 * portée : sans daemon local qui relaie (il n'évalue que Binance, et l'application déployée ne le
 * voit jamais), l'alerte ne sonne qu'application ouverte. Rend l'offre relue après le geste.
 *
 * GARDE COMMUNE (bureau et téléphone ; arbitrage A2 de l'orchestrateur, 12 novembre 2026). La
 * `zone` est celle lue à l'affichage du bouton ou de l'entrée du menu ; au geste, tout est relu —
 * zones tracées, prix, alertes, heure. Rien n'est créé si aucune zone forte de même rôle n'est
 * plus tracée À CE BORD (AXIS S/R fermé, zone cassée ou affaiblie, bord déplacé par une clôture),
 * ou si l'état n'est plus « offre » (bord franchi, alerte déjà posée). Un avis court le dit alors,
 * avec le libellé du nouvel état, « Pas d'alerte : la zone forte n'est plus tracée », ou « Pas
 * d'alerte : le bord de la zone forte a bougé » quand la même zone (même rôle, même bougie de
 * confirmation) est tracée à un autre bord. Cas du bureau : un menu resté ouvert pendant que l'état
 * change. Au téléphone, le bouton relit l'offre au toucher et n'appelle pas ce geste quand elle a
 * changé (`CandleReadout.offreChangee`) : il se réécrit, sans avis.
 */
export function poserAlerteZone(chart: Chart, marche: PriceAlertMarket, zone: ZoneForteTracee): OffreBordZone | undefined {
  const { niveau } = bordZone(zone);
  const memeRole = zonesDuGraphe(chart, marche).filter((z) => z.role === zone.role);
  const tracee = memeRole.find((z) => bordZone(z).niveau === niveau);
  const offre = tracee && offreDuGraphe(chart, marche, tracee);
  if (!offre || !offre.alerte) {
    pousserToast(offre ? offre.libelle : `Pas d'alerte : ${memeRole.some((z) => z.deIdx === zone.deIdx) ? "le bord de la zone forte a bougé" : "la zone forte n'est plus tracée"}`);
    return offre;
  }
  const alertes = alertsStore.getState();
  if (!alertes.ajouter(offre.alerte)) return offre;
  // `ajouter` ne rend pas l'identifiant : c'est celui de la seule def absente avant l'appel.
  const { id } = alertsStore.getState().defs.find((d) => !alertes.defs.includes(d))!;
  uiSectionsStore.getState().setOpen(SECTION_ALERTES, true);
  const relayee = daemonSupporte("alerts") && marche.source === "binance";
  pousserToast(`${offre.avis}${relayee ? "" : " · sonne application ouverte seulement"}`, {
    libelle: "Annuler",
    executer: () => alertsStore.getState().supprimer(id),
  });
  return offreDuGraphe(chart, marche, tracee);
}

/**
 * Offre pour la bande forte au point (`idx`, `y`) du pane des prix, prête pour l'encart ou le
 * menu ; `undefined` sans bande forte. `absolu` (clic droit du bureau) : `y` est relatif à la
 * racine du graphe et non au pane, et la bande est retenue à 6 px près, comme l'accroche des
 * lignes de niveaux ; sinon (réticule du téléphone) sans tolérance, la règle du texte de l'encart.
 */
function offreAuPoint(chart: Chart, marche: PriceAlertMarket, idx: number | undefined, y: number | undefined, absolu: boolean): OffreEncart | undefined {
  if (idx === undefined || y === undefined) return undefined;
  // Conversion sans ordonnée (pane absent) : `zoneSousPoint` écarte toute valeur non finie.
  const yDe = (prix: number): number =>
    (chart.convertToPixel({ value: prix }, { paneId: CANDLE_PANE_ID, absolute: absolu }) as { y: number }).y;
  const zone = zoneSousPoint(zonesDuGraphe(chart, marche), idx, y, yDe, absolu ? 6 : 0);
  if (zone === null) return undefined;
  return { ...offreDuGraphe(chart, marche, zone), executer: () => void poserAlerteZone(chart, marche, zone) };
}

/**
 * Téléphone : offre pour la bande forte SOUS le réticule — le bouton paraît là où la zone se lit.
 * Rien hors du pane des prix.
 */
export function offreSousReticule(chart: Chart, marche: PriceAlertMarket, reticule: Pick<Crosshair, "paneId" | "dataIndex" | "y">): OffreEncart | undefined {
  return reticule.paneId === CANDLE_PANE_ID ? offreAuPoint(chart, marche, reticule.dataIndex, reticule.y, false) : undefined;
}

/** Bureau : offre pour la bande forte sous le clic droit, ou à 6 px. `x`, `y` : relatifs à la racine du graphe. */
export function offreAuClic(chart: Chart, marche: PriceAlertMarket, x: number, y: number): OffreEncart | undefined {
  // Une liste de points en entrée, une liste en sortie ; `flat` couvre aussi un point seul.
  const point = [chart.convertFromPixel([{ x, y }], { paneId: CANDLE_PANE_ID, absolute: true })].flat()[0];
  return offreAuPoint(chart, marche, point?.dataIndex, y, true);
}

/** Prévient à chaque changement des définitions d'alerte (pose, « Annuler », suppression, échéance prolongée). Rend le désabonnement. */
export function suivreAlertes(rappel: () => void): () => void {
  return alertsStore.subscribe((etat, avant) => {
    if (etat.defs !== avant.defs) rappel();
  });
}
