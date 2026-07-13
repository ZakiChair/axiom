import { geoDistance } from "d3-geo";
import { describe, expect, it } from "vitest";
import {
  RAYON_CHOKEPOINT_MAX,
  RAYON_CHOKEPOINT_MIN,
  TERRES,
  VUE_INITIALE,
  ZOOM_MAX,
  ZOOM_MIN,
  appliquerDrag,
  appliquerMolette,
  clampPhi,
  clampZoom,
  creerProjection,
  creerTestVisibilite,
  estVisible,
  positionSoleil,
  projeterVisible,
  rayonBase,
  rayonChokepoint,
  type VueGlobe,
} from "./globeRender";

// Vue neutre : centre de projection sur (0°, 0°) — golfe de Guinée.
const VUE_NEUTRE: VueGlobe = { lambda: 0, phi: 0, zoom: 1 };

describe("fond de carte land-110m", () => {
  it("l'import statique world-atlas est exploitable (Topology → GeoJSON)", () => {
    // Vérifie l'assertion de type locale : si world-atlas changeait de forme, ce test
    // casse AVANT le rendu (TERRES nul = globe sans terres, dégradation silencieuse).
    expect(TERRES).not.toBeNull();
    const type = (TERRES as { type?: unknown }).type;
    expect(type === "FeatureCollection" || type === "Feature").toBe(true);
  });
});

describe("creerProjection / projeterVisible", () => {
  it("projette le centre de la vue au centre du canvas", () => {
    const projection = creerProjection(400, 400, VUE_NEUTRE);
    const point = projeterVisible(projection, 0, 0);
    expect(point).not.toBeNull();
    expect(point?.x).toBeCloseTo(200, 6);
    expect(point?.y).toBeCloseTo(200, 6);
  });

  it("masque l'hémisphère caché (antipode et au-delà de 90°)", () => {
    const projection = creerProjection(400, 400, VUE_NEUTRE);
    expect(projeterVisible(projection, 180, 0)).toBeNull(); // antipode exact
    expect(projeterVisible(projection, 100, 0)).toBeNull(); // 100° > 90°
    expect(projeterVisible(projection, 89, 0)).not.toBeNull(); // encore visible
  });

  it("suit la rotation de la vue (Suez visible sur la vue initiale, pas l'antipode)", () => {
    const projection = creerProjection(400, 400, VUE_INITIALE);
    expect(projeterVisible(projection, 32.4, 30.6)).not.toBeNull(); // Canal de Suez
    expect(projeterVisible(projection, -140, -25)).toBeNull(); // Pacifique sud (dos du globe)
  });
});

describe("estVisible", () => {
  it("délimite l'hémisphère face à l'observateur", () => {
    expect(estVisible(0, 0, VUE_NEUTRE)).toBe(true);
    expect(estVisible(89, 0, VUE_NEUTRE)).toBe(true);
    expect(estVisible(91, 0, VUE_NEUTRE)).toBe(false);
    expect(estVisible(180, 0, VUE_NEUTRE)).toBe(false);
  });
});

describe("creerTestVisibilite", () => {
  it("est équivalent à estVisible (grille lon/lat × rotations, hors frontière exacte)", () => {
    const vues: VueGlobe[] = [
      VUE_NEUTRE,
      VUE_INITIALE,
      { lambda: 123, phi: 60, zoom: 2 },
      { lambda: -179, phi: -84, zoom: 0.8 },
    ];
    let compares = 0;
    for (const vue of vues) {
      const rapide = creerTestVisibilite(vue);
      for (let lon = -180; lon <= 180; lon += 15) {
        for (let lat = -85; lat <= 85; lat += 17) {
          // Sur la frontière EXACTE (distance = 90°, ex. Δλ=90 à l'équateur avec des
          // rotations entières), geoDistance et le produit scalaire divergent d'un
          // epsilon flottant : on ne compare que les points franchement dedans/dehors.
          const dist = geoDistance([lon, lat], [-vue.lambda, -vue.phi]);
          if (Math.abs(dist - Math.PI / 2) < 1e-9) continue;
          expect(rapide(lon, lat)).toBe(estVisible(lon, lat, vue));
          compares += 1;
        }
      }
    }
    expect(compares).toBeGreaterThan(1000); // la garde d'exclusion ne vide pas le test
  });
});

describe("rayonBase", () => {
  it("suit la plus petite dimension, avec marge, sans jamais devenir dégénéré", () => {
    expect(rayonBase(400, 400)).toBe(192); // 400/2 - 8
    expect(rayonBase(800, 400)).toBe(192); // borné par la hauteur
    expect(rayonBase(0, 0)).toBe(10); // plancher défensif
  });
});

describe("appliquerDrag", () => {
  it("convertit les px écran en degrés (∝ 1/rayon), φ clampé", () => {
    const rayon = 180 / Math.PI; // → exactement 1°/px
    const vue = appliquerDrag(VUE_NEUTRE, 10, -5, rayon);
    expect(vue.lambda).toBeCloseTo(10, 6);
    expect(vue.phi).toBeCloseTo(5, 6); // dy négatif (vers le haut) → φ augmente
    expect(vue.zoom).toBe(1);
  });

  it("clampe φ aux pôles et ignore un rayon dégénéré", () => {
    const rayon = 180 / Math.PI;
    expect(appliquerDrag(VUE_NEUTRE, 0, -10_000, rayon).phi).toBe(85);
    expect(appliquerDrag(VUE_NEUTRE, 0, 10_000, rayon).phi).toBe(-85);
    expect(appliquerDrag(VUE_NEUTRE, 50, 50, 0)).toEqual(VUE_NEUTRE);
    expect(clampPhi(1000)).toBe(85);
  });
});

describe("appliquerMolette / clampZoom", () => {
  it("zoome exponentiellement, borné [ZOOM_MIN, ZOOM_MAX]", () => {
    const avant: VueGlobe = { lambda: 3, phi: 4, zoom: 1 };
    const zoomAvant = appliquerMolette(avant, -100); // molette vers le haut → zoom avant
    expect(zoomAvant.zoom).toBeGreaterThan(1);
    expect(zoomAvant.lambda).toBe(3); // la rotation ne bouge pas
    expect(appliquerMolette(avant, 100_000).zoom).toBe(ZOOM_MIN);
    expect(appliquerMolette(avant, -100_000).zoom).toBe(ZOOM_MAX);
    expect(clampZoom(0)).toBe(ZOOM_MIN);
    expect(clampZoom(99)).toBe(ZOOM_MAX);
  });
});

describe("rayonChokepoint", () => {
  it("échelle en √n, clampée, tolérante aux données absentes", () => {
    expect(rayonChokepoint(null)).toBe(RAYON_CHOKEPOINT_MIN);
    expect(rayonChokepoint(0)).toBe(RAYON_CHOKEPOINT_MIN);
    expect(rayonChokepoint(Number.NaN)).toBe(RAYON_CHOKEPOINT_MIN);
    expect(rayonChokepoint(34)).toBeCloseTo(2 + Math.sqrt(34), 6); // Ormuz ≈ 7,8 px
    expect(rayonChokepoint(10_000)).toBe(RAYON_CHOKEPOINT_MAX);
    // Monotone : plus de trafic → rayon ≥.
    expect(rayonChokepoint(80)).toBeGreaterThan(rayonChokepoint(30));
  });
});

describe("hitTestCibles (chokepoints)", () => {
  const cibles: CibleGlobe[] = [
    { couche: "chokepoint", index: 0, x: 100, y: 100, r: 6 },
    { couche: "chokepoint", index: 3, x: 110, y: 100, r: 10 },
  ];

  it("renvoie la cible la plus PROCHE dont le disque (+marge) contient le curseur", () => {
    expect(hitTestCibles(cibles, 101, 100)?.index).toBe(0); // dans les deux, plus près de 0
    expect(hitTestCibles(cibles, 109, 100)?.index).toBe(3);
    expect(hitTestCibles(cibles, 100, 109, 4)?.index).toBe(0); // marge de tolérance
  });

  it("renvoie null hors de toute cible ou sans cible", () => {
    expect(hitTestCibles(cibles, 300, 300)).toBeNull();
    expect(hitTestCibles([], 100, 100)).toBeNull();
  });
});

describe("positionSoleil", () => {
  it("solstice de juin à midi UTC : soleil ≈ (0°E, +23,4°N)", () => {
    const [lon, lat] = positionSoleil(new Date("2026-06-21T12:00:00Z"));
    expect(lon).toBeCloseTo(0, 6); // 12 h UTC → méridien de Greenwich (EoT ignorée)
    expect(Math.abs(lat - 23.44)).toBeLessThan(1);
  });

  it("solstice de décembre à minuit UTC : soleil ≈ (180°, -23,4°S)", () => {
    const [lon, lat] = positionSoleil(new Date("2026-12-21T00:00:00Z"));
    expect(lon).toBeCloseTo(180, 6);
    expect(Math.abs(lat + 23.44)).toBeLessThan(1);
  });
});

import { contenuLibelle, couleurCategorie, estRecent, hitTestCibles, rayonConflit, rayonEvenement, rayonHalo, type CibleGlobe, type ParamsDessinGlobe, type TokensGlobe } from "./globeRender";

const TOKENS: TokensGlobe = { bg: "#000", border: "#333", textDim: "#999", serie2: "#a78bfa", serie3: "#f59e0b", down: "#f92855", serie4: "#f472b6" };

describe("briques géopolitiques", () => {
  it("rayonEvenement croît avec n et l'intensité, clampé [2, 13]", () => {
    expect(rayonEvenement(0, 0)).toBe(2);
    expect(rayonEvenement(10, 4)).toBe(8); // 2 + 2 + 4
    expect(rayonEvenement(10, 400)).toBe(13); // clampé
  });
  it("rayonConflit en racine des morts, clampé [4, 18]", () => {
    expect(rayonConflit(0)).toBe(4);
    expect(rayonConflit(100)).toBe(8); // 4 + 10×0,4
    expect(rayonConflit(6111)).toBe(18); // top réel UCDP → clampé
  });
  it("couleurCategorie mappe vers les tokens sémantiques", () => {
    expect(couleurCategorie("materiel", TOKENS)).toBe("#f92855");
    expect(couleurCategorie("coercition", TOKENS)).toBe("#f472b6");
    expect(couleurCategorie("protestation", TOKENS)).toBe("#a78bfa");
  });
  it("estRecent : strictement moins d'une heure", () => {
    expect(estRecent(1000, 1000 + 3_599_000)).toBe(true);
    expect(estRecent(1000, 1000 + 3_600_000)).toBe(false);
  });
  it("rayonHalo oscille autour de rayon + 2,5 (amplitude 1,5)", () => {
    expect(rayonHalo(5, 0)).toBe(7.5);
    expect(rayonHalo(5, Math.PI / 2 * 300)).toBeCloseTo(9, 5);
  });
});

describe("hitTestCibles (multi-couches)", () => {
  const cibles: CibleGlobe[] = [
    { couche: "chokepoint", index: 0, x: 100, y: 100, r: 5 },
    { couche: "evenement", index: 3, x: 104, y: 100, r: 6 },
  ];
  it("renvoie la cible la plus PROCHE en cas de chevauchement", () => {
    expect(hitTestCibles(cibles, 103, 100)).toEqual(cibles[1]);
    expect(hitTestCibles(cibles, 101, 100)).toEqual(cibles[0]);
  });
  it("respecte la marge (4 px défaut) et renvoie null au-delà", () => {
    expect(hitTestCibles(cibles, 100, 108)).toEqual(cibles[0]); // r5 + marge 4
    expect(hitTestCibles(cibles, 100, 130)).toBeNull();
  });
  it("à distance ÉGALE (même x/y, couches superposées), la DERNIÈRE poussée gagne (aligné z-order)", () => {
    // Grille UCDP/GDELT partagée → même centre projeté → même distance. Le point GDELT
    // est dessiné AU-DESSUS du conflit ; le hit-test doit renvoyer ce dernier (dernier du tableau).
    const superposees: CibleGlobe[] = [
      { couche: "conflit", index: 0, x: 100, y: 100, r: 5 },
      { couche: "evenement", index: 0, x: 100, y: 100, r: 5 },
    ];
    expect(hitTestCibles(superposees, 100, 100)).toEqual(superposees[1]);
  });
});

describe("contenuLibelle", () => {
  const base: ParamsDessinGlobe = {
    largeur: 400, hauteur: 300, vue: { lambda: 0, phi: 0, zoom: 1 }, tokens: TOKENS,
    chokepoints: [{ id: "c6", nom: "Détroit d'Ormuz", lat: 26.3, lon: 56.9, nNavires: 34, nTankers: 17, nCargos: 17, date: "2026-07-05" }],
    avions: [],
    cellules: [{ lat: 48.5, lon: 35, categorie: "materiel", n: 12, intensite: 10, mentions: 40, dernierMs: Date.UTC(2026, 6, 12, 10) }],
    zonesUcdp: [{ lat: 48.5, lon: 35, morts: 42, n: 2, sideA: "Armée A", sideB: "Milice C", dernierMs: Date.UTC(2026, 4, 20) }],
    frontUkraine: null,
    survol: null,
    date: new Date(Date.UTC(2026, 6, 12, 12)),
  };
  it("chokepoint : nom + navires", () => {
    const c = contenuLibelle({ couche: "chokepoint", index: 0 }, base);
    expect(c?.titre).toBe("Détroit d'Ormuz");
    expect(c?.lignes.join(" ")).toContain("34");
  });
  it("événement : catégorie, compte, intensité, fraîcheur", () => {
    const c = contenuLibelle({ couche: "evenement", index: 0 }, base);
    expect(c?.titre).toBe("Conflit armé");
    expect(c?.lignes.join(" ")).toContain("12 évt");
    expect(c?.lignes.join(" ")).toContain("10");
  });
  it("conflit UCDP : morts + acteurs", () => {
    const c = contenuLibelle({ couche: "conflit", index: 0 }, base);
    expect(c?.titre).toContain("UCDP");
    expect(c?.lignes.join(" ")).toContain("42 morts");
    expect(c?.lignes.join(" ")).toContain("Armée A");
  });
  it("index hors bornes → null", () => {
    expect(contenuLibelle({ couche: "evenement", index: 9 }, base)).toBeNull();
  });
});
