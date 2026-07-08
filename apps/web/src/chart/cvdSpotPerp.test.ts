import { describe, expect, it } from "vitest";
import { detectCvdDivergences, type CvdBucket } from "./cvdSpotPerp";

/**
 * Fixture principale (lookback=14, 40 buckets) : spot = 10×i (pente constante,
 * toujours croissant). perp = 10×i pour i=0..24 (parallèle au spot) PUIS
 * décroissant de 20/bucket pour i=25..39 (perp = 240 − 20×(i−24)).
 *
 * dSpot[i] = spot[i] − spot[i−14] = 10×14 = 140 CONSTANT pour tout i ≥ 14
 * (pente uniforme) → médiane(|dSpot|) = 140 partout → le filtre spot passe
 * toujours (140 ≥ 140).
 *
 * dPerp[i] = perp[i] − perp[i−14] (calcul exact, voir report) :
 *   i=14..24 : 140 (parallèle, même signe que dSpot → pas de divergence)
 *   i=25:110  26:80  27:50  28:20  29:-10  30:-40  31:-70  32:-100
 *   33:-130  34:-160 35:-190 36:-220 37:-250 38:-280 39:-280
 *
 * Le signe de dPerp bascule négatif dès i=29 (mismatch avec dSpot>0 → zone
 * candidate à la divergence), MAIS la médiane glissante de |dPerp| sur les
 * indices 16..29 (14 valeurs : 140×10, 110, 80, 50, 20, 10 triées =
 * 10,20,50,80,110,140×10 → médiane = moyenne des 7e/8e = 140) reste 140
 * jusqu'à ce que les grandes valeurs anciennes (140) sortent de la fenêtre.
 * Résultat (vérifié à la main, voir report) : i=29..32 ont |dPerp| encore
 * SOUS leur médiane glissante (10<140, 40<140, 70<125, 100<105) → FILTRÉS.
 * i=33..39 ont |dPerp| ≥ leur médiane glissante (130≥105, 160≥105, 190≥105,
 * 220≥105, 250≥105, 280≥105, 280≥115) → divergences retenues.
 */
function buildMainFixture(): CvdBucket[] {
  const buckets: CvdBucket[] = [];
  for (let i = 0; i < 40; i++) {
    const spot = 10 * i;
    const perp = i <= 24 ? 10 * i : 240 - 20 * (i - 24);
    buckets.push({ time: i, spot, perp });
  }
  return buckets;
}

describe("detectCvdDivergences — zone divergente filtrée par médiane", () => {
  it("détecte spotUp_perpDown uniquement à partir de i=33 (jamais dans la zone parallèle i<25, jamais i=29..32 sous le seuil médian)", () => {
    const buckets = buildMainFixture();
    const divergences = detectCvdDivergences(buckets, 14);

    // Zone parallèle (i=14..28, malgré la bascule de pente perp à i=25, les
    // dPerp sur 14 buckets restent positifs jusqu'à i=28) : aucune divergence.
    expect(divergences.some((d) => d.time <= 28)).toBe(false);

    // Zone divergente mais amplitude encore sous la médiane (i=29..32) : filtrée.
    expect(divergences.some((d) => d.time >= 29 && d.time <= 32)).toBe(false);

    // Divergences retenues : i=33..39 (7 buckets), toutes spotUp_perpDown.
    expect(divergences.map((d) => d.time)).toEqual([33, 34, 35, 36, 37, 38, 39]);
    expect(divergences.every((d) => d.kind === "spotUp_perpDown")).toBe(true);
  });
});

describe("detectCvdDivergences — séries parallèles (même signe)", () => {
  it("ne détecte aucune divergence quand spot et perp montent ensemble tout du long", () => {
    // spot = 10×i, perp = 15×i : dSpot=140 et dPerp=210 constants et positifs
    // pour tout i≥14 → sign(dSpot)===sign(dPerp) partout → jamais de mismatch.
    const buckets: CvdBucket[] = [];
    for (let i = 0; i < 40; i++) {
      buckets.push({ time: i, spot: 10 * i, perp: 15 * i });
    }
    expect(detectCvdDivergences(buckets, 14)).toEqual([]);
  });
});

describe("detectCvdDivergences — amplitude minuscule sous la médiane", () => {
  it("ignore un mismatch de signe dont l'amplitude perp est bien en dessous de la médiane glissante", () => {
    // lookback=4. spot[i] = 10×i (pente constante) → dSpot[i] = 40 pour tout
    // i≥4 (positif, filtre spot toujours passé car médiane(40)=40).
    // perp = 0,10,20,30,40,50,60,65,38,80,100,110 (indices 0..11) : dip
    // volontaire à i=8 (38 au lieu de ~40) pour créer un dPerp NÉGATIF minuscule
    // alors que les dPerp voisins sont des tendances positives ~35-40.
    const perp = [0, 10, 20, 30, 40, 50, 60, 65, 38, 80, 100, 110];
    const buckets: CvdBucket[] = perp.map((p, i) => ({ time: i, spot: 10 * i, perp: p }));

    // dPerp[i] = perp[i] − perp[i−4] :
    //  i=4:40−0=40   i=5:50−10=40   i=6:60−20=40   i=7:65−30=35
    //  i=8:38−40=−2  i=9:80−50=30   i=10:100−60=40 i=11:110−65=45
    // Seul i=8 a un mismatch de signe (dSpot=40>0, dPerp=−2<0).
    // Fenêtre glissante à i=8 (lookback=4) : j=5..8 → |dPerp| = 40,40,35,2.
    // Triés : 2,35,40,40 → médiane = (35+40)/2 = 37.5.
    // |dPerp[8]| = 2 < 37.5 → FILTRÉ malgré le mismatch de signe.
    expect(detectCvdDivergences(buckets, 4)).toEqual([]);
  });
});
