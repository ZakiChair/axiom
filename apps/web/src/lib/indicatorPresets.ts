/** Préréglages visuels sans données externes, chargés avec le menu Indicateurs. */
import type { IndicatorInstance } from "@axiom/types";
import { getIndicator, resolveParams } from "@axiom/indicators";
import { indicatorsStore, type ActiveIndicator } from "../store/indicators";
import { chartCapaciteStore } from "../store/chartCapacite";

export interface PresetAnalyse {
  id: string;
  nom: string;
  resume: string;
  explication: string;
  instances: readonly IndicatorInstance[];
}

export const PRESETS_ANALYSE: readonly PresetAnalyse[] = [
  {
    id: "polyvalent", nom: "Polyvalent", resume: "EMA 20 · Autocorrélation 50",
    explication: "L’ACF lag 1 NIST décrit la liaison entre 50 rendements logarithmiques adjacents (51 clôtures). Une valeur négative décrit une alternance, sans prédire le prix. Sans unité ; indisponible si le pas temporel est irrégulier, notamment à une fermeture de marché.",
    instances: [{ defId: "ema", params: { length: 20 } }, { defId: "returnAutocorrelation", params: { length: 50 } }],
  },
  {
    id: "intraday", nom: "Intraday", resume: "EMA 20 · Compression NR7 / Inside",
    explication: "NR7 vaut 1 si l’amplitude est la plus petite des 7 bougies, égalités incluses. Inside vaut 1 si la bougie est strictement contenue dans la précédente. Sinon 0 : ces états ne donnent aucune direction ni prédiction de cassure.",
    instances: [{ defId: "ema", params: { length: 20 } }, { defId: "narrowRange", params: { length: 7 } }],
  },
  {
    id: "swing", nom: "Swing", resume: "EMA 50 · Repli sur 100 clôtures",
    explication: "Repli depuis le sommet des 100 clôtures et hausse requise pour le rejoindre : −20 % nécessite +25 %. Ce sommet glissant n’est pas l’ATH ; sa sortie de la fenêtre peut réduire le repli sans hausse du prix. La hausse requise est une distance, pas un objectif.",
    instances: [{ defId: "ema", params: { length: 50 } }, { defId: "rollingDrawdown", params: { length: 100 } }],
  },
];

/** Compare les entrées effectives, sans confondre omission d’un défaut et différence de réglage. */
function memeConfiguration(a: IndicatorInstance, b: IndicatorInstance): boolean {
  if (a.defId !== b.defId) return false;
  const def = getIndicator(a.defId);
  if (!def) return false;
  const pa = resolveParams(def, a.params);
  const pb = resolveParams(def, b.params);
  return def.inputs.every((input) => pa[input.key] === pb[input.key]);
}

export function planifierPreset(preset: PresetAnalyse, actives: readonly ActiveIndicator[], paneMax: number) {
  const ajouts = preset.instances.filter((instance) => !actives.some((active) => memeConfiguration(instance, active)));
  const panes = actives.filter((instance) => getIndicator(instance.defId)?.pane !== "overlay").length;
  const nouvellesPanes = ajouts.filter((instance) => getIndicator(instance.defId)?.pane !== "overlay").length;
  // Le 0 non mesuré conserve la convention du menu existant. Un overlay reste ajoutable au plafond.
  const raison = nouvellesPanes > 0 && paneMax > 0 && panes + nouvellesPanes > paneMax
    ? `${paneMax} panneau${paneMax > 1 ? "x" : ""} maximum à cette hauteur : fermez un panneau ou agrandissez le graphique.`
    : null;
  return { ajouts, raison };
}

export function ajouterPreset(preset: PresetAnalyse): { instances: ActiveIndicator[]; raison: string | null } {
  // Relire au clic : un autre ajout ou un redimensionnement peut avoir suivi le rendu du bouton.
  const plan = planifierPreset(preset, indicatorsStore.getState().indicators, chartCapaciteStore.getState().paneMax);
  const ids = plan.raison === null ? indicatorsStore.getState().append(plan.ajouts) : [];
  return { instances: indicatorsStore.getState().indicators.filter((instance) => ids.includes(instance.instanceId)), raison: plan.raison };
}

export function annulerAjoutPreset(instances: readonly ActiveIndicator[]): void {
  for (const instance of instances) {
    // Un ID peut être réutilisé après retrait ; une édition remplace aussi l’objet.
    // Seule l’instance ajoutée ET restée intacte appartient encore à cette annulation.
    if (indicatorsStore.getState().indicators.includes(instance)) indicatorsStore.getState().remove(instance.instanceId);
  }
}
