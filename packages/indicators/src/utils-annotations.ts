/**
 * @axiom/indicators — utils-annotations.ts
 *
 * Traduction PURE des divergences détectées (utils-divergence.ts) en annotations
 * de rendu (@axiom/types AnnotationsIndicateur) : segment prix pivot→pivot,
 * segment miroir sur le pane de l'oscillateur (reliant les pivots OSC appariés),
 * label « Div ▲/▼ » au pivot d'arrivée (régulières seulement — les cachées se
 * lisent au pointillé et au tooltip, anti-encombrement), texte `info` FR partagé.
 *
 * Convention de lecture des familles : la HAUSSIÈRE se lit sur les creux (lows),
 * la BAISSIÈRE sur les sommets (highs) ; chaque appel à
 * detecterDivergences calcule aussi l'autre famille sur la même série — on la
 * filtre. Anti-repaint hérité de detecterPivots (droite barres de confirmation).
 * NB : le pivot OSC apparié pouvant suivre le pivot prix de ±3 barres
 * (ECART_APPARIEMENT), une annotation peut n'apparaître — rétrodatée — que
 * jusqu'à 3 barres après idxTo + droite. C'est un TRACÉ rétrodaté par nature
 * (segment pivot→pivot), pas un signal d'entrée : rien à retarder ici — le
 * signal exécutable, lui, est daté dans stratDivergenceRsi.
 */

import type {
  AnnotationsIndicateur,
  LabelAnnotation,
  SegmentAnnotation,
} from "@axiom/types";
import { detecterDivergences, type TypeDivergence } from "./utils-divergence";

export interface OptionsAnnotationsDivergence {
  gauche: number;
  droite: number;
  maxEcart: number;
  /** false = les divergences cachées ne produisent aucune annotation. */
  cachees: boolean;
  /** Nom de l'oscillateur dans le texte du tooltip (ex. "RSI"). */
  nomOsc: string;
  /** Formatage des valeurs dans `info` (défaut : toFixed(2)). */
  formateur?: (v: number) => string;
}

/** Token couleur par type (haussières --up, baissières --down). */
const COULEUR: Record<TypeDivergence, string> = {
  haussiere: "--up",
  "haussiere-cachee": "--up",
  baissiere: "--down",
  "baissiere-cachee": "--down",
};

/** Qualificatif du mouvement de prix entre les deux pivots, par type. */
const MOTS_PRIX: Record<TypeDivergence, string> = {
  haussiere: "creux plus bas",
  "haussiere-cachee": "creux plus haut",
  baissiere: "sommet plus haut",
  "baissiere-cachee": "sommet plus bas",
};

export function construireAnnotationsDivergence(
  highs: ReadonlyArray<number>,
  lows: ReadonlyArray<number>,
  osc: ReadonlyArray<number | undefined>,
  opts: OptionsAnnotationsDivergence,
): AnnotationsIndicateur {
  const fmt = opts.formateur ?? ((v: number) => v.toFixed(2));
  const detOpts = { gauche: opts.gauche, droite: opts.droite, maxEcart: opts.maxEcart };
  const segments: SegmentAnnotation[] = [];
  const labels: LabelAnnotation[] = [];

  const traiter = (prix: ReadonlyArray<number>, famille: "haussiere" | "baissiere") => {
    for (const d of detecterDivergences(prix, osc, detOpts)) {
      const estHauss = d.type === "haussiere" || d.type === "haussiere-cachee";
      if ((famille === "haussiere") !== estHauss) continue; // mauvaise série pour ce sens
      const cachee = d.type === "haussiere-cachee" || d.type === "baissiere-cachee";
      if (cachee && !opts.cachees) continue;
      const p1 = prix[d.idxFrom];
      const p2 = prix[d.idxTo];
      const o1 = osc[d.oscIdxFrom];
      const o2 = osc[d.oscIdxTo];
      // Pivots garantis définis par detecterPivots ; gardes noUncheckedIndexedAccess.
      if (p1 === undefined || p2 === undefined || o1 === undefined || o2 === undefined) continue;

      const couleur = COULEUR[d.type];
      const trait = cachee ? ("pointille" as const) : ("plein" as const);
      const info =
        `Divergence ${estHauss ? "haussière" : "baissière"} ${cachee ? "cachée" : "régulière"}` +
        ` — prix ${fmt(p1)} → ${fmt(p2)} (${MOTS_PRIX[d.type]})` +
        ` vs ${opts.nomOsc} ${fmt(o1)} → ${fmt(o2)} (${o2 > o1 ? "en hausse" : "en baisse"})`;

      segments.push({ deIdx: d.idxFrom, deValeur: p1, aIdx: d.idxTo, aValeur: p2, trait, couleur, cible: "prix", info });
      segments.push({ deIdx: d.oscIdxFrom, deValeur: o1, aIdx: d.oscIdxTo, aValeur: o2, trait, couleur, cible: "pane", info });
      if (!cachee) {
        labels.push({
          idx: d.idxTo,
          valeur: p2,
          texte: estHauss ? "Div ▲" : "Div ▼",
          couleur,
          cible: "prix",
          position: estHauss ? "dessous" : "dessus",
          info,
        });
      }
    }
  };

  traiter(lows, "haussiere");
  traiter(highs, "baissiere");

  const out: AnnotationsIndicateur = {};
  if (segments.length > 0) out.segments = segments;
  if (labels.length > 0) out.labels = labels;
  return out;
}
