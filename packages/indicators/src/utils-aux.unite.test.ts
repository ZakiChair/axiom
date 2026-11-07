/**
 * @axiom/indicators — projection d'une série d'unité supérieure (`projeterSurUnite`).
 *
 * Trois propriétés exigées par la reformulation de SUG-1 :
 *  - exactitude : la valeur projetée est EXACTEMENT celle du calcul natif sur la dernière
 *    bougie supérieure close à la clôture de la bougie du graphe ;
 *  - causalité par préfixe : ajouter des bougies (graphe et unité supérieure) ne change
 *    aucune valeur déjà projetée ;
 *  - absence : une valeur supérieure manquante reste manquante, jamais reportée.
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { projeterSurUnite } from "./utils-aux";
import { computeIndicator } from "./engine";
import { getIndicator } from "./registry";

const H = 3_600_000;
const J = 24 * H;
/** Lundi 6 janvier 2025, 00:00 UTC (semaines alignées sur le lundi). */
const LUNDI = Date.UTC(2025, 0, 6);

/** Bougies pseudo-aléatoires déterministes (marche multiplicative). */
function bougies(n: number, debut: number, pas: number, graine = 11): Candle[] {
  let s = graine;
  const alea = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const out: Candle[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p;
    const c = o * (1 + (alea() - 0.5) * 0.04);
    out.push({ time: debut + i * pas, open: o, high: Math.max(o, c) * 1.01, low: Math.min(o, c) * 0.99, close: c, volume: 10 + alea() });
    p = c;
  }
  return out;
}

/** Indice de la dernière bougie supérieure close à la clôture `fin` (recherche naïve, oracle). */
function indiceOracle(ouverturesSup: number[], dureeSup: number, fin: number): number | undefined {
  let k: number | undefined;
  for (let j = 0; j < ouverturesSup.length; j++) if (ouverturesSup[j]! + dureeSup <= fin) k = j;
  return k;
}

describe("projeterSurUnite", () => {
  it("1h ← 4h : chaque bloc 4h apparaît sur la bougie 1h qui clôt avec lui (escalier, sans anticipation)", () => {
    const tempsGraphe = Array.from({ length: 12 }, (_, i) => LUNDI + i * H); // 00:00 … 11:00
    const ouverturesSup = [LUNDI, LUNDI + 4 * H, LUNDI + 8 * H];
    const projete = projeterSurUnite(tempsGraphe, H, ouverturesSup, 4 * H, [10, 20, 30]);
    expect(projete).toEqual([
      undefined, undefined, undefined, // 00:00-02:00 : le bloc 00:00-04:00 n'est pas clos
      10, 10, 10, 10, // 03:00 (clôt à 04:00) … 06:00
      20, 20, 20, 20, // 07:00 … 10:00
      30, // 11:00 (clôt à 12:00)
    ]);
  });

  it("une valeur supérieure absente reste absente (aucun report de la précédente)", () => {
    const tempsGraphe = Array.from({ length: 12 }, (_, i) => LUNDI + i * H);
    const projete = projeterSurUnite(tempsGraphe, H, [LUNDI, LUNDI + 4 * H, LUNDI + 8 * H], 4 * H, [10, undefined, 30]);
    expect(projete.slice(7, 11)).toEqual([undefined, undefined, undefined, undefined]);
    expect(projete[11]).toBe(30);
  });

  it("un trou du graphe n'élargit pas la borne : la bougie avant le trou ne lit rien au-delà de sa clôture", () => {
    // 00:00, 01:00 puis trou jusqu'à 06:00 : la bougie 01:00 clôt à 02:00, le bloc 4h à 04:00.
    const projete = projeterSurUnite([LUNDI, LUNDI + H, LUNDI + 6 * H], H, [LUNDI], 4 * H, [10]);
    expect(projete).toEqual([undefined, undefined, 10]);
  });

  it("aucune bougie supérieure ou aucun temps de graphe : séries vides cohérentes", () => {
    expect(projeterSurUnite([LUNDI, LUNDI + H], H, [], 4 * H, [])).toEqual([undefined, undefined]);
    expect(projeterSurUnite([], H, [LUNDI], 4 * H, [1])).toEqual([]);
  });

  it("1d ← 1w : la semaine du lundi apparaît sur le dimanche qui la clôt", () => {
    const tempsGraphe = Array.from({ length: 15 }, (_, i) => LUNDI + i * J);
    const projete = projeterSurUnite(tempsGraphe, J, [LUNDI, LUNDI + 7 * J], 7 * J, [1, 2]);
    expect(projete.slice(0, 6).every((v) => v === undefined)).toBe(true);
    expect(projete[6]).toBe(1); // dimanche 12 janvier, clôt lundi 13 à 00:00
    expect(projete.slice(7, 13).every((v) => v === 1)).toBe(true);
    expect(projete[13]).toBe(2);
    expect(projete[14]).toBe(2);
  });

  for (const [defId, params] of [["ema", { length: 20 }], ["rsi", { length: 14 }], ["macd", {}]] as const) {
    it(`égalité exacte avec le calcul natif sur les mêmes bougies 4h (${defId})`, () => {
      const def = getIndicator(defId)!;
      const sup = bougies(300, LUNDI, 4 * H);
      const natif = computeIndicator(def, sup, params, undefined, "4h");
      const ouvertures = sup.map((c) => c.time);
      // Graphe 1h couvrant les 100 derniers blocs, plus 3 heures du bloc en cours.
      const tempsGraphe = Array.from({ length: 403 }, (_, i) => LUNDI + 200 * 4 * H + i * H);
      for (const output of def.outputs) {
        const serie = natif.series[output.key]!;
        const projete = projeterSurUnite(tempsGraphe, H, ouvertures, 4 * H, serie);
        tempsGraphe.forEach((t, i) => {
          const k = indiceOracle(ouvertures, 4 * H, t + H);
          expect(projete[i]).toBe(k === undefined ? undefined : serie[k]);
        });
        // Des valeurs ont bien été comparées (pas un test vide).
        expect(projete.filter((v) => typeof v === "number").length).toBeGreaterThan(350);
      }
    });
  }

  it("causalité par préfixe : ajouter des bougies ne change aucune valeur déjà projetée", () => {
    const def = getIndicator("rsi")!;
    const sup = bougies(240, LUNDI, J, 5);
    const tempsGraphe = Array.from({ length: 200 * 6 }, (_, i) => LUNDI + 30 * J + i * 4 * H);
    const projeter = (fin: number) => {
      // Ce que l'on sait à l'instant `fin` : bougies 1d CLOSES à `fin`, bougies 4h ouvertes avant `fin`.
      const closes = sup.filter((c) => c.time + J <= fin);
      const serie = computeIndicator(def, closes, { length: 14 }, undefined, "1d").series.rsi!;
      const temps = tempsGraphe.filter((t) => t < fin);
      return projeterSurUnite(temps, 4 * H, closes.map((c) => c.time), J, serie);
    };
    const complet = projeter(LUNDI + 240 * J);
    // 79 j 22 h : la bougie 4h en cours (20:00-00:00) clôt en même temps que la bougie 1d.
    for (const jours of [45, 46.5, 79 + 22 / 24, 80, 150.25]) {
      const fin = LUNDI + jours * J;
      const prefixe = projeter(fin);
      // Seules les bougies du graphe CLOSES à `fin` sont figées ; celle en cours peut encore
      // recevoir la bougie 1d qui clôt avec elle (c'est sa propre clôture, pas une repeinture).
      const closes = tempsGraphe.filter((t) => t + 4 * H <= fin).length;
      expect(closes).toBeGreaterThan(0);
      expect(prefixe.slice(0, closes)).toEqual(complet.slice(0, closes));
    }
  });
});
