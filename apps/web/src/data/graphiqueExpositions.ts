/** Série par strike et cadrage en prix pour le graphique options.
 * Aucun recalcul financier : les contributions viennent de la carte déjà validée.
 */
import type { CarteExpositions, ColonneExpositions } from "./carteExpositions";
import type { GexDexPoint } from "./gexDex";

export type CadrageExpositions = "proche" | "tous";

export interface NetExpositions {
  gex: number | null;
  dex: number | null;
}

export interface GraphiqueExpositions {
  /** Strikes uniques consolidés entre échéances, puis cadrés et triés croissant. */
  points: GexDexPoint[];
  /** Vraies coordonnées de prix ; null si le domaine n’est pas représentable. */
  domainePrix: { min: number; max: number } | null;
  nbStrikesTotal: number;
  nbStrikesAffiches: number;
  netVisible: NetExpositions;
  /** Totaux de toute la portée sélectionnée dans la carte, indépendants du cadrage. */
  netTotal: NetExpositions;
  /** Les barres par échéance gardent toute la portée, y compris les données absentes. */
  echeances: ColonneExpositions[];
}

function domaineValide(min: number, max: number): boolean {
  return Number.isFinite(min) && Number.isFinite(max) && min > 0 && max > min;
}

/**
 * Proche : [0,7 × spot, 1,3 × spot], bornes inclusives.
 * Tous : min/max des strikes et du spot s’il est valide, sans marge ajoutée.
 * Un domaine à prix unique est élargi de ±1 % pour rester traçable ; à la limite
 * numérique supérieure, seul le côté inférieur est élargi. Aucun strike n’est ajouté.
 */
export function construireGraphiqueExpositions(
  carte: CarteExpositions,
  spot: number,
  cadrage: CadrageExpositions,
): GraphiqueExpositions {
  const parStrike = new Map<number, GexDexPoint>();
  for (const cellule of carte.cellules) {
    for (const p of cellule.strikes) {
      if (!Number.isFinite(p.strike) || p.strike <= 0 || !Number.isFinite(p.gex) || !Number.isFinite(p.dex)) continue;
      const precedent = parStrike.get(p.strike);
      if (precedent) {
        precedent.gex += p.gex;
        precedent.dex += p.dex;
      } else parStrike.set(p.strike, { ...p });
    }
  }
  const tous = [...parStrike.values()].sort((a, b) => a.strike - b.strike);
  let domainePrix: GraphiqueExpositions["domainePrix"] = null;
  const spotValide = Number.isFinite(spot) && spot > 0;
  if (tous.length > 0) {
    if (cadrage === "proche") {
      const min = spot * .7;
      const max = spot * 1.3;
      if (spotValide && domaineValide(min, max)) domainePrix = { min, max };
    } else {
      let min = tous[0]!.strike;
      let max = tous[tous.length - 1]!.strike;
      if (spotValide) {
        min = Math.min(min, spot);
        max = Math.max(max, spot);
      }
      if (min === max) {
        min *= .99;
        const haut = max * 1.01;
        if (Number.isFinite(haut)) max = haut;
      }
      if (domaineValide(min, max)) domainePrix = { min, max };
    }
  }
  const domaine = domainePrix;
  const points = domaine === null ? [] : tous.filter((p) => p.strike >= domaine.min && p.strike <= domaine.max);
  return {
    points,
    domainePrix,
    nbStrikesTotal: tous.length,
    nbStrikesAffiches: points.length,
    netVisible: points.length === 0 ? { gex: null, dex: null } : {
      gex: points.reduce((s, p) => s + p.gex, 0),
      dex: points.reduce((s, p) => s + p.dex, 0),
    },
    netTotal: { gex: carte.total.gex, dex: carte.total.dex },
    echeances: carte.colonnes.map((c) => ({ ...c })),
  };
}
