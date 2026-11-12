/**
 * Historique que le graphe principal charge pour les alertes de son marché (phase 2, lot 4,
 * « alertes A2 », 12 novembre 2026).
 *
 * Avant : une alerte AXIS (amorce 1 500 bougies) ou AXIS S/R (3 000) dont l'indicateur n'était pas
 * affiché restait en « historique insuffisant » — le graphe n'étendait son historique que pour les
 * indicateurs affichés. Désormais la vue PRINCIPALE l'étend aussi pour les indicateurs des alertes
 * ACTIVES de son marché (`indicateursExtension`), et publie l'état de son extension pour la clé de ce
 * marché (`extensionGrapheStore`) : en cours, ou terminée avec le nombre de bougies obtenu.
 *
 * Règle d'évaluation, lue par le runtime ET par la liste des alertes (`profondeurAlerte`, dans
 * `components/alertsPanel.util.ts`, chargé à la demande) : une def d'amorce A est évaluée si le
 * tampon compte A bougies (règle du lot A1, même décompte que `doitEtendreHistorique` du graphe) ;
 * sinon, si l'extension de ce marché est TERMINÉE et visait au moins A, la place n'a pas plus
 * d'historique (ex. 2 988 bougies servies) : la def est évaluée sur ce qu'il y a, et le message de
 * son déclenchement le dit (« · amorce courte (N bougies) »). Pendant l'extension, ou quand elle
 * visait moins que A (une alerte créée pendant une extension plus courte : correction 2 de la
 * critique), rien n'est évalué.
 *
 * Sur le chemin de chargement initial (importé par `chart/ChartInstance.tsx`) : le strict
 * nécessaire au graphe, aucun import du runtime des alertes, aucun `?.`.
 */
import { createStore } from "zustand/vanilla";
import { alerteActiveAuTemps, type AlertDef } from "@axiom/alerts";
import type { ExchangeId, Timeframe } from "@axiom/types";
import { alertsStore } from "../store/alerts";

/** Marché affiché par un graphe : source, symbole, unité. */
export interface MarcheGraphe {
  exchange: ExchangeId;
  symbol: string;
  timeframe: Timeframe;
}

/** Clé d'un marché de graphe, celle sous laquelle l'état de l'extension est publié. */
export function cleMarcheGraphe(marche: MarcheGraphe): string {
  return `${marche.exchange}|${marche.symbol}|${marche.timeframe}`;
}

/**
 * Indicateurs (triés, sans doublon) des alertes ACTIVES d'un marché : même source et même symbole,
 * unité de la def égale à celle du graphe ou def sans unité (évaluée sur l'unité affichée) ;
 * sous-conditions des composites comprises. Une alerte en pause ou échue n'en demande aucun.
 */
export function indicateursAlertesMarche(defs: readonly AlertDef[], marche: MarcheGraphe, maintenant: number): string[] {
  const ids = new Set<string>();
  for (const d of defs) {
    if (d.source !== marche.exchange || d.symbol !== marche.symbol) continue;
    if (d.timeframe !== undefined && d.timeframe !== marche.timeframe) continue;
    if (!alerteActiveAuTemps(d, maintenant)) continue;
    for (const c of d.condition.type === "composite" ? d.condition.conditions : [d.condition]) {
      if (c.type === "indicateur-seuil" || c.type === "indicateur-croisement") ids.add(c.indicateurId);
    }
  }
  return [...ids].sort();
}

/**
 * Indicateurs pour lesquels un graphe étend son historique : ceux qu'il affiche, et pour la vue
 * PRINCIPALE seulement (`maitre`), ceux des alertes actives de son marché. Une vue secondaire ne
 * sert aucune alerte : le runtime ne lit que la vue principale.
 */
export function indicateursExtension(
  affiches: readonly string[],
  defs: readonly AlertDef[],
  marche: MarcheGraphe,
  maintenant: number,
  maitre: boolean,
): string[] {
  return maitre ? [...affiches, ...indicateursAlertesMarche(defs, marche, maintenant)] : [...affiches];
}

/** État de l'extension d'historique de la vue principale, pour la clé de son marché. */
export interface ExtensionGraphe {
  /** `cleMarcheGraphe` du marché étendu. */
  cle: string;
  /**
   * Faux pendant la remontée des pages. Vrai quand la passe est finie, quelle qu'en soit l'issue :
   * rien à charger, amorce atteinte, place à sec (page vide), plafond de pages, échec réseau.
   */
  terminee: boolean;
  /** Amorce que la passe visait (plus grande amorce des indicateurs étendus ; 0 sans amorce). */
  amorceVisee: number;
  /** Bougies du tampon, bougie en formation comprise : au départ pendant la remontée, obtenues une fois terminée. */
  bougies: number;
}

/** État publié par la vue principale (`chart/ChartInstance.tsx`) ; `null` tant que rien n'est connu pour son marché. */
export const extensionGrapheStore = createStore<{ extension: ExtensionGraphe | null }>(() => ({ extension: null }));

/** Publie l'état de l'extension ; n'écrit le store (et ne réveille ses abonnés) que s'il change. */
export function publierExtension(extension: ExtensionGraphe | null): void {
  const avant = extensionGrapheStore.getState().extension;
  if (
    avant === extension ||
    (avant !== null && extension !== null && avant.cle === extension.cle && avant.terminee === extension.terminee &&
      avant.amorceVisee === extension.amorceVisee && avant.bougies === extension.bougies)
  ) return;
  extensionGrapheStore.setState({ extension });
}

/**
 * Appelle `relancer` quand la LISTE TRIÉE des indicateurs d'alerte du marché change — création,
 * suppression, pause, reprise d'une alerte qui en porte —, et seulement alors : un armement ou un
 * déclenchement réécrit les définitions sans rien y changer (correction 3 de la critique ; sur une
 * place à sec, chaque tir relançait sinon une page réseau). Rend le désabonnement.
 */
export function surIndicateursAlertes(marche: MarcheGraphe, relancer: () => void): () => void {
  let liste = indicateursAlertesMarche(alertsStore.getState().defs, marche, Date.now()).join(",");
  return alertsStore.subscribe((etat, precedent) => {
    if (etat.defs === precedent.defs) return;
    const suivante = indicateursAlertesMarche(etat.defs, marche, Date.now()).join(",");
    if (suivante === liste) return;
    liste = suivante;
    relancer();
  });
}
