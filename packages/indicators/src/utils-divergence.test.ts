/**
 * @axiom/indicators — utils-divergence.test.ts
 *
 * Fixtures construites À LA MAIN (points de contrôle commentés, interpolation
 * linéaire déterministe — AUCUN oracle pandas-ta). Chaque « coin » d'une série
 * linéaire par morceaux tombe exactement sur un index de contrôle : c'est là, et
 * seulement là, qu'un pivot fractal strict apparaît (les segments monotones ne
 * produisent jamais de pivot parasite). Les indices attendus sont donc calculables
 * de tête et vérifiés en dur.
 */

import { describe, it, expect } from "vitest";
import {
  detecterPivots,
  detecterDivergences,
  type Pivot,
  type Divergence,
} from "./utils-divergence";

/**
 * Série linéaire par morceaux sur [0, n) à partir de points de contrôle
 * `[idx, valeur]` triés par idx croissant (le premier à idx 0, le dernier à
 * idx n-1). Interpolation linéaire entre points consécutifs. Comme chaque
 * segment est strictement monotone, un point de contrôle où la pente change de
 * SIGNE est un extremum strict (pivot) ; un point interne à un segment ne l'est
 * jamais. → pivots aux indices voulus, zéro pivot parasite.
 */
function rampe(n: number, points: ReadonlyArray<readonly [number, number]>): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let seg = 0;
    while (seg < points.length - 1 && points[seg + 1]![0] <= i) seg++;
    const a = points[seg]!;
    const b = points[seg + 1] ?? a;
    const t = b[0] === a[0] ? 0 : (i - a[0]) / (b[0] - a[0]);
    out.push(a[1] + t * (b[1] - a[1]));
  }
  return out;
}

const N = 40;
// Fenêtre fractale des fixtures de divergence : 2 barres de chaque côté.
const OPTS = { gauche: 2, droite: 2, maxEcart: 40 };

describe("detecterPivots", () => {
  it("dents de scie : un pivot à chaque sommet/creux, indices exacts", () => {
    // Alternance stricte 1/3 : sommets aux index impairs, creux aux pairs.
    // gauche=droite=1 → index 0 (bord gauche) et index 6 (bord droit) exclus.
    const valeurs = [1, 3, 1, 3, 1, 3, 1];
    expect(detecterPivots(valeurs, 1, 1)).toEqual<Pivot[]>([
      { idx: 1, kind: "high" },
      { idx: 2, kind: "low" },
      { idx: 3, kind: "high" },
      { idx: 4, kind: "low" },
      { idx: 5, kind: "high" },
    ]);
  });

  it("plateau (égalité) : pas de pivot — extremum STRICT des deux côtés", () => {
    // Le sommet est un plateau de 3 barres égales : aucune n'est strictement
    // supérieure à ses voisines → aucun pivot, malgré le maximum global.
    const valeurs = [1, 2, 2, 2, 1];
    expect(detecterPivots(valeurs, 1, 1)).toEqual<Pivot[]>([]);
  });

  it("les `droite` dernières barres n'ont jamais de pivot (pas de repaint)", () => {
    // idx 4 = 8 EST un maximum local (idx3=3 < 8) mais c'est la dernière barre :
    // avec droite=1 elle est hors du domaine → jamais pivot. Idem bord gauche.
    const valeurs = [1, 5, 2, 3, 8];
    const pivots = detecterPivots(valeurs, 1, 1);
    expect(pivots).toEqual<Pivot[]>([
      { idx: 1, kind: "high" },
      { idx: 2, kind: "low" },
    ]);
    expect(pivots.some((p) => p.idx === 4)).toBe(false);
  });

  it("valeurs indéfinies : centre ou voisin undefined ⇒ pas de pivot", () => {
    // idx3=5 serait un high, mais son voisin gauche idx2 est undefined → écarté.
    // idx5=9 serait un high mais idx6 (voisin droit) est undefined → écarté.
    const valeurs: Array<number | undefined> = [1, 2, undefined, 5, 4, 9, undefined, 3];
    expect(detecterPivots(valeurs, 1, 1)).toEqual<Pivot[]>([
      { idx: 4, kind: "low" }, // voisins 5 et 9, tous deux définis et > 4
    ]);
  });
});

describe("detecterDivergences", () => {
  it("haussière régulière : prix plus-bas plus bas, osc plus-bas plus haut", () => {
    // Prix : creux idx10 (50) puis creux idx28 (44) → LL. Sommet idx19 seul.
    const prix = rampe(N, [[0, 70], [10, 50], [19, 62], [28, 44], [39, 58]]);
    // Osc : creux idx10 (30) puis creux idx28 (34) → HL (appariés à ±0 barre).
    const osc = rampe(N, [[0, 45], [10, 30], [19, 42], [28, 34], [39, 40]]);
    expect(detecterDivergences(prix, osc, OPTS)).toEqual<Divergence[]>([
      { idxFrom: 10, idxTo: 28, type: "haussiere" },
    ]);
  });

  it("baissière régulière : prix plus-haut plus haut, osc plus-haut plus bas", () => {
    // Prix : sommet idx10 (60) puis sommet idx28 (66) → HH. Creux idx19 seul.
    const prix = rampe(N, [[0, 40], [10, 60], [19, 48], [28, 66], [39, 52]]);
    // Osc : sommet idx10 (55) puis sommet idx28 (50) → LH.
    const osc = rampe(N, [[0, 30], [10, 55], [19, 40], [28, 50], [39, 44]]);
    expect(detecterDivergences(prix, osc, OPTS)).toEqual<Divergence[]>([
      { idxFrom: 10, idxTo: 28, type: "baissiere" },
    ]);
  });

  it("haussière cachée : prix plus-bas plus haut, osc plus-bas plus bas", () => {
    // Prix : creux idx10 (45) puis creux idx28 (50) → HL (higher low).
    const prix = rampe(N, [[0, 60], [10, 45], [19, 58], [28, 50], [39, 62]]);
    // Osc : creux idx10 (40) puis creux idx28 (34) → LL (lower low).
    const osc = rampe(N, [[0, 50], [10, 40], [19, 52], [28, 34], [39, 46]]);
    expect(detecterDivergences(prix, osc, OPTS)).toEqual<Divergence[]>([
      { idxFrom: 10, idxTo: 28, type: "haussiere-cachee" },
    ]);
  });

  it("baissière cachée : prix plus-haut plus bas, osc plus-haut plus haut", () => {
    // Prix : sommet idx10 (66) puis sommet idx28 (60) → LH (lower high).
    const prix = rampe(N, [[0, 50], [10, 66], [19, 52], [28, 60], [39, 46]]);
    // Osc : sommet idx10 (50) puis sommet idx28 (56) → HH (higher high).
    const osc = rampe(N, [[0, 35], [10, 50], [19, 40], [28, 56], [39, 42]]);
    expect(detecterDivergences(prix, osc, OPTS)).toEqual<Divergence[]>([
      { idxFrom: 10, idxTo: 28, type: "baissiere-cachee" },
    ]);
  });

  it("prix et osc corrélés (osc = copie du prix) : aucune divergence", () => {
    // Deux creux (idx8, idx24 plus bas) et deux sommets (idx16, idx32 plus haut).
    const prix = rampe(N, [[0, 60], [8, 48], [16, 64], [24, 44], [32, 68], [39, 52]]);
    const osc = [...prix]; // osc suit le prix à l'identique → jamais en désaccord
    expect(detecterDivergences(prix, osc, OPTS)).toEqual<Divergence[]>([]);
  });

  it("pivots trop écartés (> maxEcart) : rejeté ; sous maxEcart : détecté", () => {
    // Haussière régulière valide, mais creux idx8 → idx30 = 22 barres d'écart.
    const prix = rampe(N, [[0, 70], [8, 52], [19, 64], [30, 46], [39, 58]]);
    const osc = rampe(N, [[0, 45], [8, 30], [19, 42], [30, 34], [39, 40]]);
    // maxEcart=10 < 22 → écarté.
    expect(detecterDivergences(prix, osc, { gauche: 2, droite: 2, maxEcart: 10 })).toEqual<
      Divergence[]
    >([]);
    // Même fixture, maxEcart=40 → la divergence est bien là (preuve que la
    // fixture est valide et que c'est le garde d'écart qui a joué au-dessus).
    expect(detecterDivergences(prix, osc, { gauche: 2, droite: 2, maxEcart: 40 })).toEqual<
      Divergence[]
    >([{ idxFrom: 8, idxTo: 30, type: "haussiere" }]);
  });

  it("pivots prix/osc décalés de 2 barres : appariés quand même (±3)", () => {
    // Prix : creux idx10/idx28 (LL). Osc : creux idx12/idx30 — décalés de 2
    // barres, dans la fenêtre ±3 → appariés. idxFrom/idxTo restent les indices PRIX.
    const prix = rampe(N, [[0, 70], [10, 50], [19, 62], [28, 44], [39, 58]]);
    const osc = rampe(N, [[0, 45], [12, 30], [21, 42], [30, 34], [39, 40]]);
    expect(detecterDivergences(prix, osc, OPTS)).toEqual<Divergence[]>([
      { idxFrom: 10, idxTo: 28, type: "haussiere" },
    ]);
  });

  it("borne ±3 pinnée (off-by-one) : osc à EXACTEMENT 3 apparié, à 4 rejeté", () => {
    // Même forme de haussière régulière (creux prix idx10/idx28, LL) dans les deux cas ;
    // SEUL le décalage prix↔osc change → c'est bien la borne ECART_APPARIEMENT (=3) qui
    // tranche, pas la forme. Verrouille `dist <= 3` contre un `< 3` ou une constante à 2/4.
    const prix = rampe(N, [[0, 70], [10, 50], [19, 62], [28, 44], [39, 58]]);
    // Osc creux idx13/idx31 = pile +3 barres des creux prix → dist 3, 3 <= 3 → apparié.
    const oscA3 = rampe(N, [[0, 45], [13, 30], [22, 42], [31, 34], [39, 40]]);
    expect(detecterDivergences(prix, oscA3, OPTS)).toEqual<Divergence[]>([
      { idxFrom: 10, idxTo: 28, type: "haussiere" },
    ]);
    // Osc creux idx14/idx32 = +4 barres → dist 4, 4 <= 3 faux → aucun appariement ⇒ [].
    const oscA4 = rampe(N, [[0, 45], [14, 30], [23, 42], [32, 34], [39, 40]]);
    expect(detecterDivergences(prix, oscA4, OPTS)).toEqual<Divergence[]>([]);
  });

  it("osc pivot hors fenêtre ±3 (décalé de 5 barres) : non apparié ⇒ []", () => {
    // Prix : creux idx10/idx28 (LL) — forme de haussière régulière valide.
    const prix = rampe(N, [[0, 70], [10, 50], [19, 62], [28, 44], [39, 58]]);
    // Osc : creux idx15/idx33 — à 5 barres des creux prix, HORS de ±3 → aucun
    // appariement, donc aucune divergence (verrouille la borne SUP d'ECART).
    const osc = rampe(N, [[0, 45], [15, 30], [24, 42], [33, 34], [39, 40]]);
    expect(detecterDivergences(prix, osc, OPTS)).toEqual<Divergence[]>([]);
  });

  it("historique complet : chaque paire de creux consécutifs est évaluée", () => {
    // Trois creux prix décroissants (54 → 50 → 46) et osc croissants (30 → 34 → 38) :
    // les DEUX paires consécutives (8,20) et (20,32) sont des haussières régulières.
    // Les sommets intercalés (idx14/idx26) sont LH côté prix ET osc → pas de baissière.
    const prix = rampe(N, [[0, 66], [8, 54], [14, 64], [20, 50], [26, 60], [32, 46], [39, 54]]);
    const osc = rampe(N, [[0, 40], [8, 30], [14, 44], [20, 34], [26, 42], [32, 38], [39, 44]]);
    expect(detecterDivergences(prix, osc, OPTS)).toEqual<Divergence[]>([
      { idxFrom: 8, idxTo: 20, type: "haussiere" },
      { idxFrom: 20, idxTo: 32, type: "haussiere" },
    ]);
  });
});
