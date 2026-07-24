/**
 * @axiom/indicators — utils-divergence.ts
 *
 * Détection PURE de pivots fractals et de divergences prix/oscillateur.
 * Aucun fetch, aucune dépendance app — briques réutilisées par les IndicatorDef
 * `rsiDivergence` / `cvdDivergence` (Task 3).
 *
 * Esprit repris de `apps/web/src/data/signaux.ts` (`detecterDivergenceRsi`) :
 * pivots fractals STRICTS (extremum strict des deux côtés, jamais d'égalité) et
 * les `droite` dernières barres n'ont pas de pivot → pas de repaint rétroactif.
 *
 * NB : `noUncheckedIndexedAccess` est actif — tout accès indexé est gardé.
 */

export interface Pivot {
  idx: number;
  kind: "high" | "low";
}

/**
 * Pivot fractal : extremum STRICT sur `gauche` barres avant et `droite` après
 * (les `droite` dernières barres n'ont pas de pivot — pas de repaint rétroactif
 * silencieux). Une valeur `undefined`/non finie au centre ou chez un voisin
 * disqualifie l'index. Résultat trié par `idx` croissant. PURE.
 */
export function detecterPivots(
  valeurs: ReadonlyArray<number | undefined>,
  gauche: number,
  droite: number,
): Pivot[] {
  const out: Pivot[] = [];
  const n = valeurs.length;
  for (let i = gauche; i < n - droite; i++) {
    const v = valeurs[i];
    if (v === undefined || !Number.isFinite(v)) continue;
    let estHaut = true;
    let estBas = true;
    for (let j = i - gauche; j <= i + droite; j++) {
      if (j === i) continue;
      const w = valeurs[j];
      if (w === undefined || !Number.isFinite(w)) {
        estHaut = false;
        estBas = false;
        break;
      }
      if (w >= v) estHaut = false; // strict : une égalité tue le sommet
      if (w <= v) estBas = false; // strict : une égalité tue le creux
      if (!estHaut && !estBas) break;
    }
    if (estHaut) out.push({ idx: i, kind: "high" });
    else if (estBas) out.push({ idx: i, kind: "low" });
  }
  return out;
}

export type TypeDivergence = "haussiere" | "baissiere" | "haussiere-cachee" | "baissiere-cachee";

export interface Divergence {
  idxFrom: number;
  idxTo: number;
  type: TypeDivergence;
}

/** Fenêtre d'appariement prix↔osc par proximité d'index (± barres). */
const ECART_APPARIEMENT = 3;

/**
 * Compare les paires de pivots PRIX consécutifs de même genre (lows pour la
 * famille haussière, highs pour la baissière) sur TOUTE la série — l'historique
 * complet, pas seulement la dernière paire :
 *   régulière = prix LL & osc HL (hauss.) / prix HH & osc LH (baiss.) ;
 *   cachée   = prix HL & osc LL (hauss.) / prix LH & osc HH (baiss.).
 * Chaque pivot prix est apparié à l'osc pivot de MÊME genre le plus proche en
 * index (±`ECART_APPARIEMENT` barres) ; sans correspondant des deux côtés, la
 * paire est ignorée. Écart max `maxEcart` barres entre les 2 pivots prix.
 * Inégalités STRICTES. Résultat trié par `idxTo` puis `idxFrom` croissants. PURE.
 */
export function detecterDivergences(
  prix: ReadonlyArray<number>,
  osc: ReadonlyArray<number | undefined>,
  opts: { gauche: number; droite: number; maxEcart: number },
): Divergence[] {
  const { gauche, droite, maxEcart } = opts;
  const pivotsPrix = detecterPivots(prix, gauche, droite);
  const pivotsOsc = detecterPivots(osc, gauche, droite);
  const out: Divergence[] = [];

  // Index de l'osc pivot de même genre le plus proche (±ECART), sinon undefined.
  const oscApparie = (idxPrix: number, kind: "high" | "low"): number | undefined => {
    let meilleur: number | undefined;
    let meilleureDist = Infinity;
    for (const po of pivotsOsc) {
      if (po.kind !== kind) continue;
      const dist = Math.abs(po.idx - idxPrix);
      if (dist <= ECART_APPARIEMENT && dist < meilleureDist) {
        meilleureDist = dist;
        meilleur = po.idx;
      }
    }
    return meilleur;
  };

  const evaluer = (kind: "high" | "low") => {
    const pivots = pivotsPrix.filter((p) => p.kind === kind);
    for (let k = 0; k + 1 < pivots.length; k++) {
      const p1 = pivots[k]!; // pivot ancien
      const p2 = pivots[k + 1]!; // pivot récent
      if (p2.idx - p1.idx > maxEcart) continue;

      const o1 = oscApparie(p1.idx, kind);
      const o2 = oscApparie(p2.idx, kind);
      if (o1 === undefined || o2 === undefined) continue;
      const osc1 = osc[o1];
      const osc2 = osc[o2];
      if (osc1 === undefined || osc2 === undefined) continue;
      const prix1 = prix[p1.idx]!;
      const prix2 = prix[p2.idx]!;

      let type: TypeDivergence | undefined;
      if (kind === "low") {
        if (prix2 < prix1 && osc2 > osc1) type = "haussiere"; // prix LL & osc HL
        else if (prix2 > prix1 && osc2 < osc1) type = "haussiere-cachee"; // prix HL & osc LL
      } else {
        if (prix2 > prix1 && osc2 < osc1) type = "baissiere"; // prix HH & osc LH
        else if (prix2 < prix1 && osc2 > osc1) type = "baissiere-cachee"; // prix LH & osc HH
      }
      if (type !== undefined) out.push({ idxFrom: p1.idx, idxTo: p2.idx, type });
    }
  };

  evaluer("low");
  evaluer("high");
  out.sort((a, b) => a.idxTo - b.idxTo || a.idxFrom - b.idxFrom);
  return out;
}
