/**
 * @axiom/web — chart/rampesHeat.ts
 *
 * Fonctions PURES de couleur/alpha partagées par les deux heatmaps du chart maître
 * (liquidations et carnet) : parsing CSS concret, détection de fond clair, rampes de
 * couleur par thème et fondu des cellules fraîches.
 *
 * Extraites de `liquidationHeat.ts` pour que le CONTRÔLEUR de heatmap des liquidations
 * (gros module, ~25 ko) puisse vivre dans un chunk paresseux : `depthHeat.ts` — présent
 * dans le chemin d'entrée — n'a besoin que de ces helpers, et l'import statique du
 * contrôleur depuis `ChartInstance` n'existe plus (chargement à la première activation).
 * Comportement INCHANGÉ : le code est déplacé verbatim.
 */
import { couleurViridis, VIRIDIS } from "./liquidationMarkers";

/**
 * Parse une couleur CSS concrète (`#rgb`, `#rrggbb` ou `rgb()/rgba()`) en tuple RVB, ou
 * `null` si la chaîne n'est pas reconnue. Le canvas ne reçoit que des tokens déjà résolus
 * (jamais de `var()` ni d'`oklch()`), donc ces deux formes suffisent. Sert à `estFondClair`
 * et aux teintes up/down du mode « dominance » (parsées UNE fois par frame). PURE.
 */
export function parseCssColor(css: string): [number, number, number] | null {
  const s = css.trim();
  if (s.startsWith("#")) {
    const h = s.slice(1);
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    if (full.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(full)) return null;
    const int = Number.parseInt(full, 16);
    return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
  }
  const m = s.match(/rgba?\(([^)]+)\)/i);
  const inner = m?.[1];
  if (inner === undefined) return null;
  const parts = inner.split(",").map((p) => Number.parseFloat(p.trim()));
  const [r, g, b] = parts;
  if (r === undefined || g === undefined || b === undefined) return null;
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
  return [r, g, b];
}

/**
 * Vrai si `bgCss` (couleur de fond du thème, `#hex` ou `rgb()`) est un fond CLAIR :
 * luminance relative (coefficients Rec.709 0.2126/0.7152/0.0722, normalisée) > 0.5. Une
 * chaîne non reconnue renvoie `false` (fond sombre par défaut — le cas majoritaire des
 * thèmes). Sert à inverser la rampe de couleur sur thème clair (cf. `couleurRampe`). PURE.
 */
export function estFondClair(bgCss: string): boolean {
  const rgb = parseCssColor(bgCss);
  if (rgb === null) return false;
  const [r, g, b] = rgb;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5;
}

/**
 * Rampe de couleur theme-aware pour une intensité `t ∈ [0,1]`. Sur fond SOMBRE : viridis
 * direct (jaune = max, calibré fond noir). Sur fond CLAIR : viridis INVERSÉ `couleurViridis(1−t)`
 * → le violet foncé devient le maximum (contraste rétabli, le jaune pâle illisible sur fond
 * clair passe au minimum). La barre d'échelle et les cellules utilisent la MÊME rampe. PURE.
 */
export function couleurRampe(t: number, fondClair: boolean): [number, number, number] {
  return couleurViridis(fondClair ? 1 - t : t);
}

/** Rampe ambre du thème Bloomberg (brun sombre → ambre saturé — identité « terminal »). L'arrêt 0
 *  reste sombre mais DISTINCT du fond noir pur (à alpha 0.15, [12,10,6] disparaissait). */
const RAMPE_BLOOMBERG: ReadonlyArray<readonly [number, number, number]> = [
  [36, 28, 14],
  [80, 50, 10],
  [160, 110, 10],
  [230, 170, 0],
  [255, 196, 0],
];
/** Rampe vert néon du thème Matrix (vert sombre → vert phosphore). L'arrêt 0 reste sombre mais
 *  DISTINCT du fond noir pur (à alpha 0.15, [4,12,6] disparaissait). */
const RAMPE_MATRIX: ReadonlyArray<readonly [number, number, number]> = [
  [14, 36, 20],
  [16, 60, 32],
  [34, 120, 60],
  [60, 190, 100],
  [91, 255, 143],
];
/** Viridis INVERSÉ (arrêts renversés) : le violet foncé devient le maximum — thèmes à fond clair. */
const VIRIDIS_INVERSE: ReadonlyArray<readonly [number, number, number]> = [...VIRIDIS].reverse();

/**
 * Arrêts RVB (5 crans comme VIRIDIS) de la rampe de couleur ESTHÉTIQUE du thème actif — c'est
 * un choix par thème, PAS un réglage utilisateur : `bloomberg` → noir→ambre, `matrix` →
 * noir→vert néon, `dark`/`aurora` → viridis direct, `cute` (et tout thème à FOND CLAIR) →
 * viridis inversé (contraste rétabli). Thème inconnu → repli sur la logique fond : inversé si
 * `fondClair`, viridis direct sinon. Lue 1×/frame par le contrôleur ; interpolée par
 * `couleurRampeArrets`. PURE.
 */
export function rampePourTheme(
  theme: string,
  fondClair: boolean,
): ReadonlyArray<readonly [number, number, number]> {
  if (theme === "bloomberg") return RAMPE_BLOOMBERG;
  if (theme === "matrix") return RAMPE_MATRIX;
  if (theme === "dark" || theme === "aurora") return VIRIDIS;
  // cute et tout thème à fond clair : viridis inversé (comportement historique de couleurRampe).
  if (theme === "cute" || fondClair) return VIRIDIS_INVERSE;
  // Thème sombre inconnu : repli viridis direct.
  return VIRIDIS;
}

/**
 * Interpolation linéaire générique d'une rampe de couleur (mêmes maths que `couleurViridis`,
 * mais sur des arrêts quelconques) : `t ∈ [0,1]` clampé, `arrets.length ≥ 2`. Sert à peindre
 * cellules, canvas lissé ET barre d'échelle avec LA MÊME rampe du thème actif. PURE.
 */
export function couleurRampeArrets(
  t: number,
  arrets: ReadonlyArray<readonly [number, number, number]>,
): [number, number, number] {
  const c = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const seg = c * (arrets.length - 1);
  const i = Math.min(Math.floor(seg), arrets.length - 2);
  const f = seg - i;
  const a = arrets[i] as readonly [number, number, number];
  const b = arrets[i + 1] as readonly [number, number, number];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

/** Durée (ms) du fade-in d'une cellule fraîche : flash plein puis retour à l'alpha nominal. */
const DUREE_FADE_MS = 400;
/** Fenêtre (ms) de tolérance latence WS + skew NTP : une cellule reste « fraîche » si l'horodatage
 *  EXCHANGE de son dernier événement tombe dans ces dernières secondes avant le bump local. */
const FENETRE_FRAICHEUR_MS = 5000;

/**
 * Boost d'alpha du FADE-IN d'une cellule fraîche (live). Deux horloges sont dissociées pour que la
 * latence WS / le skew NTP ne tronquent plus le flash :
 *  • SÉLECTION (horloge EXCHANGE, tolérante) : la cellule flashe si `dernierTime` (dernier événement
 *    de la cellule) est POSTÉRIEUR à `tsDemarrage` (démarrage du contrôleur — exclut le seed initial)
 *    ET tombe dans la fenêtre `FENETRE_FRAICHEUR_MS` avant `bumpTs` (l'événement peut être en retard
 *    de plusieurs secondes sans perdre son flash) ;
 *  • ANIMATION (horloge LOCALE) : le fondu suit `age = now − bumpTs` (instant local du dernier rev
 *    bump), donc insensible à la latence — `alpha = nominal + (1 − nominal) × (1 − age/DUREE_FADE_MS)`
 *    (pleine à age 0, retombe au nominal à DUREE_FADE_MS). Sinon renvoie l'alpha nominal. PURE.
 */
export function alphaFadeIn(
  alphaNominal: number,
  dernierTime: number | undefined,
  tsDemarrage: number,
  bumpTs: number,
  now: number,
): number {
  // Sélection tolérante à la latence (horloge exchange) : postérieur au démarrage (pas le seed) ET
  // dans la fenêtre de fraîcheur avant le bump local (tolère latence WS + skew NTP).
  if (dernierTime === undefined || dernierTime <= tsDemarrage) return alphaNominal;
  if (dernierTime <= bumpTs - FENETRE_FRAICHEUR_MS) return alphaNominal;
  // Animation indexée sur l'horloge LOCALE du bump : le fondu ignore l'âge exchange.
  const age = now - bumpTs;
  if (!(age >= 0) || age >= DUREE_FADE_MS) return alphaNominal;
  return alphaNominal + (1 - alphaNominal) * (1 - age / DUREE_FADE_MS);
}

/**
 * Sous footprint actif, la heatmap s'efface à moitié : les deux couches se superposent sur
 * les mêmes bougies, l'orderflow garde la priorité de lecture. Appliquée AVANT `alphaFadeIn`
 * (l'atténuation abaisse l'alpha au repos, mais une cellule fraîche flashe toujours à plein
 * pendant le fondu). PURE.
 */
export function attenuationFootprint(alpha: number, footprintActif: boolean): number {
  return footprintActif ? alpha * 0.5 : alpha;
}
