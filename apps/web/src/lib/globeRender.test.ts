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
  hitTestChokepoints,
  positionSoleil,
  projeterVisible,
  rayonBase,
  rayonChokepoint,
  type CibleChokepoint,
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

describe("hitTestChokepoints", () => {
  const cibles: CibleChokepoint[] = [
    { index: 0, x: 100, y: 100, r: 6 },
    { index: 3, x: 110, y: 100, r: 10 },
  ];

  it("renvoie la cible la plus PROCHE dont le disque (+marge) contient le curseur", () => {
    expect(hitTestChokepoints(cibles, 101, 100)).toBe(0); // dans les deux, plus près de 0
    expect(hitTestChokepoints(cibles, 109, 100)).toBe(3);
    expect(hitTestChokepoints(cibles, 100, 109, 4)).toBe(0); // marge de tolérance
  });

  it("renvoie -1 hors de toute cible ou sans cible", () => {
    expect(hitTestChokepoints(cibles, 300, 300)).toBe(-1);
    expect(hitTestChokepoints([], 100, 100)).toBe(-1);
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
