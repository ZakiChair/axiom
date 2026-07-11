/**
 * Moteur de rendu de la fenêtre GLOBE — projection orthographique d3-geo sur Canvas 2D.
 *
 * Pattern du repo (cf. docs/research/08-globe-crises-geopolitiques-chokepoints-rendu.md §1) :
 * canvas + refs + rAF, ZÉRO re-render React par frame — d3-geo dessine directement dans le
 * contexte via `geoPath(projection, ctx)`, sans DOM/SVG. Ce module est le plus PUR possible :
 * toutes les briques testables (projection, visibilité d'hémisphère, échelle de rayon,
 * hit-test, deltas de rotation, position du soleil) sont exportées séparément et couvertes
 * par globeRender.test.ts (vitest node — d3-geo fonctionne sans navigateur).
 *
 * Couleurs : AUCUN hex en dur — l'appelant lit les tokens du thème (lib/canvasTokens) et
 * les passe via `TokensGlobe` (--bg, --border, --text-dim, --serie-2, --serie-3).
 *
 * Couches dessinées (ordre) : sphère (océan) → graticule discret → terres (land-110m) →
 * terminateur jour/nuit → contour → avions (1 px, hémisphère visible) → chokepoints
 * (rayon ∝ √nNavires, sous-cercle pétroliers) → libellé du chokepoint survolé.
 */
import {
  geoCircle,
  geoDistance,
  geoGraticule,
  geoOrthographic,
  geoPath,
  type GeoPermissibleObjects,
  type GeoProjection,
} from "d3-geo";
import { feature } from "topojson-client";
import landTopo from "world-atlas/land-110m.json";
import type { Avion, Chokepoint } from "../data/globe/types";

// ─────────────────────────── Fond de carte (land-110m) ───────────────────────────

/**
 * world-atlas ne publie AUCUN type pour ses JSON → assertion locale DOCUMENTÉE : la forme
 * (Topology TopoJSON portant l'objet « land ») est stable depuis des années et VÉRIFIÉE par
 * le test « fond de carte ». `Parameters<typeof feature>` réutilise le type Topology de
 * @types/topojson-client sans dépendre directement de topojson-specification (non déclaré
 * dans package.json — pnpm strict n'autoriserait pas l'import).
 */
type TopologieTopoJson = Parameters<typeof feature>[0];
const topologie = landTopo as unknown as TopologieTopoJson;
const objetLand = topologie.objects["land"];

/** Terres émergées (résolution 110m) en GeoJSON, prêtes pour geoPath ; null si la forme
 * du JSON était inattendue (dégradation gracieuse : globe sans fond de carte). */
export const TERRES: GeoPermissibleObjects | null =
  objetLand !== undefined ? feature(topologie, objetLand) : null;

/** Graticule discret (pas de 30° — le 10° par défaut serait trop dense à cette taille). */
const GRATICULE = geoGraticule().step([30, 30])();

// ─────────────────────────── Vue (rotation + zoom) ───────────────────────────

/** État de la vue du globe : angles d'Euler d3 (rotate([λ, φ])) + facteur de zoom. */
export interface VueGlobe {
  /** Rotation est-ouest (deg) — le centre affiché est à la longitude -λ. */
  lambda: number;
  /** Rotation nord-sud (deg), clampée — le centre affiché est à la latitude -φ. */
  phi: number;
  /** Facteur multiplicatif du rayon de base, clampé [ZOOM_MIN, ZOOM_MAX]. */
  zoom: number;
}

/** Vue initiale : centrée Europe/Moyen-Orient (Suez, Ormuz et Bab-el-Mandeb visibles). */
export const VUE_INITIALE: VueGlobe = { lambda: -40, phi: -25, zoom: 1 };

/** Bornes du zoom (0.7 = globe entier avec marge, 8 = détail régional). */
export const ZOOM_MIN = 0.7;
export const ZOOM_MAX = 8;
/** |φ| maximal : évite le gimbal désorientant au-delà des pôles. */
const PHI_MAX = 85;
/** Marge entre la sphère (zoom 1) et le bord du canvas (px). */
const MARGE_PX = 8;

/** Clamp du facteur de zoom. */
export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/** Clamp de la rotation nord-sud. */
export function clampPhi(phi: number): number {
  return Math.min(PHI_MAX, Math.max(-PHI_MAX, phi));
}

/** Rayon de base de la sphère (px) pour un canvas donné, avant zoom. */
export function rayonBase(largeur: number, hauteur: number): number {
  return Math.max(10, Math.min(largeur, hauteur) / 2 - MARGE_PX);
}

/**
 * Applique un delta de drag (px écran) à la vue — rotation par deltas d'Euler λ/φ,
 * φ clampé. Sensibilité ∝ 1/rayon affiché : traverser un rayon de sphère à l'écran
 * tourne d'environ un radian, quel que soit le zoom. Fonction PURE.
 */
export function appliquerDrag(vue: VueGlobe, dxPx: number, dyPx: number, rayonPx: number): VueGlobe {
  if (!(rayonPx > 0)) return vue;
  const degParPx = (180 / Math.PI) / rayonPx;
  return {
    lambda: vue.lambda + dxPx * degParPx,
    phi: clampPhi(vue.phi - dyPx * degParPx),
    zoom: vue.zoom,
  };
}

/** Applique un cran de molette (deltaY px) au zoom, clampé. Fonction PURE. */
export function appliquerMolette(vue: VueGlobe, deltaY: number): VueGlobe {
  return { ...vue, zoom: clampZoom(vue.zoom * Math.exp(-deltaY * 0.0015)) };
}

// ─────────────────────────── Projection & visibilité ───────────────────────────

/** Projection orthographique configurée pour un canvas `largeur`×`hauteur` et une vue. */
export function creerProjection(largeur: number, hauteur: number, vue: VueGlobe): GeoProjection {
  return geoOrthographic()
    .translate([largeur / 2, hauteur / 2])
    .scale(rayonBase(largeur, hauteur) * vue.zoom)
    .rotate([vue.lambda, vue.phi])
    .clipAngle(90);
}

/**
 * true si un point (lon, lat) est sur l'hémisphère FACE à l'observateur : distance
 * angulaire au centre de projection (-λ, -φ) < 90° (d3.geoDistance). Nécessaire pour
 * les points dessinés à la main (arc/fillRect) : `projection([lon, lat])` renvoie des
 * coordonnées même pour l'hémisphère caché (le clipAngle ne s'applique qu'aux streams
 * de geoPath). Fonction PURE.
 */
export function estVisible(lon: number, lat: number, vue: VueGlobe): boolean {
  return geoDistance([lon, lat], [-vue.lambda, -vue.phi]) < Math.PI / 2;
}

/**
 * Projette (lon, lat) en coordonnées écran, ou null si le point est sur l'hémisphère
 * caché (la rotation est relue depuis la projection — une seule source de vérité).
 */
export function projeterVisible(
  projection: GeoProjection,
  lon: number,
  lat: number,
): { x: number; y: number } | null {
  const rotation = projection.rotate();
  if (geoDistance([lon, lat], [-rotation[0], -rotation[1]]) >= Math.PI / 2) return null;
  const point = projection([lon, lat]);
  if (point === null) return null;
  return { x: point[0], y: point[1] };
}

/** Facteur degrés → radians. */
const RAD = Math.PI / 180;

/**
 * Fabrique un prédicat de visibilité hémisphérique RAPIDE pour la rotation courante :
 * les sin/cos du centre de vue sont pré-calculés UNE fois, puis chaque point est testé
 * par produit scalaire sphérique (zéro allocation). Même prédicat que projeterVisible
 * (équivalence testée), mais ~3-4× moins cher — indispensable dans la boucle chaude
 * des avions (~11 000 tests/frame : geoDistance allouait un LineString + déroulait un
 * stream par point).
 */
export function creerTestVisibilite(vue: VueGlobe): (lon: number, lat: number) => boolean {
  const lambdaC = -vue.lambda * RAD;
  const phiC = -vue.phi * RAD;
  const sinPhiC = Math.sin(phiC);
  const cosPhiC = Math.cos(phiC);
  return (lon, lat) => {
    const phi = lat * RAD;
    return (
      Math.sin(phi) * sinPhiC + Math.cos(phi) * cosPhiC * Math.cos(lon * RAD - lambdaC) > 0
    );
  };
}

// ─────────────────────────── Échelle de rayon & hit-test ───────────────────────────

/** Bornes du rayon d'un point chokepoint (px écran, indépendant du zoom). */
export const RAYON_CHOKEPOINT_MIN = 3;
export const RAYON_CHOKEPOINT_MAX = 14;

/**
 * Rayon (px) d'un chokepoint selon son trafic : échelle en √n (aire ∝ navires/jour),
 * CLAMPÉE — un chokepoint sans donnée reste visible au rayon minimal. Fonction PURE.
 */
export function rayonChokepoint(nNavires: number | null): number {
  if (nNavires === null || !Number.isFinite(nNavires) || nNavires <= 0) return RAYON_CHOKEPOINT_MIN;
  return Math.min(RAYON_CHOKEPOINT_MAX, Math.max(RAYON_CHOKEPOINT_MIN, 2 + Math.sqrt(nNavires)));
}

/** Cible de hit-test d'un chokepoint dessiné (coordonnées écran du dernier rendu). */
export interface CibleChokepoint {
  /** Index dans le tableau `chokepoints` passé au dessin. */
  index: number;
  x: number;
  y: number;
  /** Rayon dessiné (px). */
  r: number;
}

/**
 * Hit-test par distance écran : index (dans `chokepoints`) de la cible la plus proche
 * dont le disque (+ marge de tolérance) contient (mx, my), sinon -1. Fonction PURE.
 */
export function hitTestChokepoints(
  cibles: readonly CibleChokepoint[],
  mx: number,
  my: number,
  margePx = 4,
): number {
  let meilleur = -1;
  let meilleureDistance = Number.POSITIVE_INFINITY;
  for (const cible of cibles) {
    const distance = Math.hypot(mx - cible.x, my - cible.y);
    if (distance <= cible.r + margePx && distance < meilleureDistance) {
      meilleureDistance = distance;
      meilleur = cible.index;
    }
  }
  return meilleur;
}

// ─────────────────────────── Terminateur jour/nuit ───────────────────────────

/**
 * Position subsolaire approchée (précision ~2°, largement suffisante pour un
 * terminateur décoratif) : déclinaison sinusoïdale annuelle + longitude déduite de
 * l'heure UTC (midi UTC ≈ soleil au méridien de Greenwich — équation du temps ignorée).
 * Fonction PURE (la date est injectée).
 */
export function positionSoleil(date: Date): [number, number] {
  const debutAnnee = Date.UTC(date.getUTCFullYear(), 0, 1);
  const jour = (date.getTime() - debutAnnee) / 86_400_000;
  const declinaison = -23.44 * Math.cos(((2 * Math.PI) / 365.24) * (jour + 10));
  const heuresUtc = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const longitude = 180 - heuresUtc * 15;
  return [longitude, declinaison];
}

// ─────────────────────────── Dessin ───────────────────────────

/** Tokens de thème résolus par l'appelant (lib/canvasTokens) — jamais de hex en dur ici. */
export interface TokensGlobe {
  /** --bg : fond de la sphère (océan) + voile de nuit + fond des libellés. */
  bg: string;
  /** --border : graticule, terres, contours. */
  border: string;
  /** --text-dim : avions (1 px) + texte des libellés. */
  textDim: string;
  /** --serie-2 : sous-cercle pétroliers. */
  serie2: string;
  /** --serie-3 : points chokepoints + nom dans le libellé. */
  serie3: string;
}

/** Paramètres d'une frame de dessin (l'appelant tient tout dans des refs). */
export interface ParamsDessinGlobe {
  largeur: number;
  hauteur: number;
  vue: VueGlobe;
  tokens: TokensGlobe;
  /** Chokepoints à dessiner ([] si couche désactivée). */
  chokepoints: readonly Chokepoint[];
  /** Avions à dessiner ([] si couche désactivée). */
  avions: readonly Avion[];
  /** Index (dans `chokepoints`) du point survolé, -1 sinon. */
  indexSurvol: number;
  /** Horloge du terminateur (injectable — défaut : maintenant). */
  date?: Date;
}

/** Libellé du chokepoint survolé : nom + trafic + date, boxé et borné au canvas. */
function dessinerLibelle(
  ctx: CanvasRenderingContext2D,
  cible: CibleChokepoint,
  chokepoint: Chokepoint,
  tokens: TokensGlobe,
  largeur: number,
  hauteur: number,
): void {
  const lignes: string[] = [chokepoint.nom];
  if (chokepoint.nNavires !== null) {
    const tankers = chokepoint.nTankers !== null ? ` · ${Math.round(chokepoint.nTankers)} pétroliers` : "";
    lignes.push(`${Math.round(chokepoint.nNavires)} navires/j${tankers}`);
  }
  if (chokepoint.date !== null) lignes.push(`au ${chokepoint.date}`);

  ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
  const largeurBoite = Math.max(...lignes.map((l) => ctx.measureText(l).width)) + 16;
  const hauteurBoite = lignes.length * 15 + 10;
  let bx = cible.x + cible.r + 8;
  let by = cible.y - hauteurBoite / 2;
  if (bx + largeurBoite > largeur) bx = cible.x - cible.r - 8 - largeurBoite;
  by = Math.min(Math.max(by, 2), Math.max(2, hauteur - hauteurBoite - 2));

  ctx.globalAlpha = 0.92;
  ctx.fillStyle = tokens.bg;
  ctx.fillRect(bx, by, largeurBoite, hauteurBoite);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = tokens.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(bx + 0.5, by + 0.5, largeurBoite, hauteurBoite);
  ctx.textBaseline = "top";
  lignes.forEach((ligne, i) => {
    ctx.fillStyle = i === 0 ? tokens.serie3 : tokens.textDim;
    ctx.fillText(ligne, bx + 8, by + 6 + i * 15);
  });
}

/**
 * Dessine une frame complète du globe et renvoie les cibles écran des chokepoints
 * dessinés (pour le hit-test du survol par l'appelant). Le contexte est supposé déjà
 * transformé au DPR (setTransform côté appelant) ; largeur/hauteur en px CSS.
 */
export function dessinerGlobe(ctx: CanvasRenderingContext2D, params: ParamsDessinGlobe): CibleChokepoint[] {
  const { largeur, hauteur, vue, tokens } = params;
  const projection = creerProjection(largeur, hauteur, vue);
  const chemin = geoPath(projection, ctx);
  const sphere = { type: "Sphere" } as const;

  ctx.clearRect(0, 0, largeur, hauteur);

  // 1. Sphère : disque « océan » plein.
  ctx.beginPath();
  chemin(sphere);
  ctx.fillStyle = tokens.bg;
  ctx.fill();

  // 2. Graticule discret.
  ctx.beginPath();
  chemin(GRATICULE);
  ctx.strokeStyle = tokens.border;
  ctx.lineWidth = 0.5;
  ctx.globalAlpha = 0.5;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // 3. Terres émergées (fond neutre — les données restent la vedette).
  if (TERRES !== null) {
    ctx.beginPath();
    chemin(TERRES);
    ctx.fillStyle = tokens.border;
    ctx.globalAlpha = 0.55;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // 4. Terminateur jour/nuit : voile sombre sur le disque de 90° autour du point antisolaire.
  const [lonSoleil, latSoleil] = positionSoleil(params.date ?? new Date());
  const nuit = geoCircle()
    .center([lonSoleil + 180, -latSoleil])
    .radius(90)();
  ctx.beginPath();
  chemin(nuit);
  ctx.fillStyle = tokens.bg;
  ctx.globalAlpha = 0.4;
  ctx.fill();
  ctx.globalAlpha = 1;

  // 5. Contour de la sphère (limbe).
  ctx.beginPath();
  chemin(sphere);
  ctx.strokeStyle = tokens.border;
  ctx.lineWidth = 1;
  ctx.stroke();

  // 6. Avions : 1 px chacun. Boucle CHAUDE (~11 000 vecteurs) → prédicat de
  //    visibilité pré-calculé (creerTestVisibilite, zéro allocation par point) au lieu
  //    de projeterVisible/geoDistance. Les aéronefs AU SOL sont exclus (amas 1 px
  //    agglutinés sur les aéroports, ~15-20 % des vecteurs, sans intérêt « trafic »).
  ctx.fillStyle = tokens.textDim;
  const visible = creerTestVisibilite(vue);
  for (const avion of params.avions) {
    if (avion.auSol || !visible(avion.lon, avion.lat)) continue;
    const point = projection([avion.lon, avion.lat]);
    if (point !== null) ctx.fillRect(point[0] - 0.5, point[1] - 0.5, 1, 1);
  }

  // 7. Chokepoints : disque --serie-3 (rayon ∝ √navires/j), sous-cercle pétroliers
  //    --serie-2 quand il reste lisible.
  const cibles: CibleChokepoint[] = [];
  params.chokepoints.forEach((chokepoint, index) => {
    const point = projeterVisible(projection, chokepoint.lon, chokepoint.lat);
    if (point === null) return;
    const r = rayonChokepoint(chokepoint.nNavires);
    ctx.beginPath();
    ctx.arc(point.x, point.y, r, 0, Math.PI * 2);
    ctx.fillStyle = tokens.serie3;
    ctx.globalAlpha = index === params.indexSurvol ? 1 : 0.8;
    ctx.fill();
    ctx.globalAlpha = 1;
    if (
      chokepoint.nTankers !== null &&
      chokepoint.nNavires !== null &&
      chokepoint.nNavires > 0 &&
      r >= 5
    ) {
      const rTankers = r * Math.sqrt(Math.min(1, chokepoint.nTankers / chokepoint.nNavires));
      if (rTankers >= 1.5) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, rTankers, 0, Math.PI * 2);
        ctx.fillStyle = tokens.serie2;
        ctx.fill();
      }
    }
    cibles.push({ index, x: point.x, y: point.y, r });
  });

  // 8. Libellé du chokepoint survolé (au-dessus de tout).
  if (params.indexSurvol >= 0) {
    const cible = cibles.find((c) => c.index === params.indexSurvol);
    const chokepoint = params.chokepoints[params.indexSurvol];
    if (cible !== undefined && chokepoint !== undefined) {
      dessinerLibelle(ctx, cible, chokepoint, tokens, largeur, hauteur);
    }
  }

  return cibles;
}
