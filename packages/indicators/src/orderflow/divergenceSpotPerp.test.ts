/**
 * Dérivation à la main, lookback=2 :
 *  - spot = [0,1,2,3,4,5,6,7] → dSpot(i)=2 pour i≥2 ; perp opposé → dPerp=−2.
 *    Mismatch de signe partout, médianes |d|=2, 2≥2 → divergence à CHAQUE i∈[2,7],
 *    sens spotHaussier (dSpot>0).
 *  - perp plat [1,1,…] → dPerp=0 → garde symétrique zéro-delta → [].
 *  - perp = spot → même signe → [].
 *  - trou : spot[3]=undefined → i=3 (spot[i] indéfini) et i=5 (spot[i−2] indéfini)
 *    sont sautés (et exclus des fenêtres de médiane) → divergences à i=2,4,6,7.
 */
import { describe, expect, it } from "vitest";
import { detecterDivergencesSpotPerp } from "./divergenceSpotPerp";

const montant = [0, 1, 2, 3, 4, 5, 6, 7];
const tombant = montant.map((v) => -v);

describe("detecterDivergencesSpotPerp", () => {
  it("sens opposés soutenus : une divergence par indice, deltas exposés", () => {
    expect(detecterDivergencesSpotPerp(montant, tombant, 2)).toEqual(
      [2, 3, 4, 5, 6, 7].map((idx) => ({ idx, sens: "spotHaussier", dSpot: 2, dPerp: -2 }))
    );
  });

  it("un côté plat : jamais de divergence (garde symétrique zéro-delta)", () => {
    expect(detecterDivergencesSpotPerp(montant, new Array(8).fill(1), 2)).toEqual([]);
  });

  it("même direction : aucune divergence", () => {
    expect(detecterDivergencesSpotPerp(montant, montant, 2)).toEqual([]);
  });

  it("trous : les indices dont une borne est indéfinie sont sautés", () => {
    const troue: Array<number | undefined> = [0, 1, 2, undefined, 4, 5, 6, 7];
    expect(detecterDivergencesSpotPerp(troue, tombant, 2).map((d) => d.idx)).toEqual([2, 4, 6, 7]);
  });

  it("sens inverse : spot qui baisse face à un perp qui monte → spotBaissier", () => {
    expect(detecterDivergencesSpotPerp(tombant, montant, 2)[0]).toEqual({
      idx: 2,
      sens: "spotBaissier",
      dSpot: -2,
      dPerp: 2,
    });
  });
});
