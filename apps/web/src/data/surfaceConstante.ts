/**
 * Surface d'options à MATURITÉ CONSTANTE (OMON › Term IV) : IV ATM, RR25 et BF25 à 7, 30 et 90 j,
 * et leur historique quotidien (SUG-20, chantier autorisé le 7 novembre 2026).
 *
 * POURQUOI : le RR25 de `skew.ts` et l'ATM de `termIv.ts` prennent le strike le plus proche,
 * échéance par échéance. Le chiffre saute quand l'échéance roule ou que la grille de strikes
 * change, et deux jours ne se comparent pas. Ici, chaque échéance est lue à delta constant, puis
 * les échéances encadrantes sont interpolées à horizon constant : « le put 25Δ à 30 j coûte-t-il
 * plus cher qu'hier ? » devient une question bien posée.
 *
 * MÉTHODE (deux interpolations linéaires, aucune extrapolation) :
 *   1. Par échéance : forward F = `underlying` Deribit de l'échéance ; options HORS de la monnaie
 *      seulement (puts K < F, calls K ≥ F). Delta FORWARD non ajusté de la prime, N(d1), calculé
 *      avec l'IV mark propre au point (`greeksOptionCrypto`, même modèle que skew.ts et gexDex.ts).
 *      Un put de delta −0,25 a un delta call équivalent de 0,75. Les ailes 25Δ et 10Δ sont
 *      interpolées linéairement en delta entre les deux options qui encadrent la cible ; l'ATM est
 *      l'ATM FORWARD (K = F), interpolé en log-moneyness ln(K/F) entre les deux strikes encadrant F.
 *   2. Entre échéances : variance totale w = σ²T interpolée linéairement en T entre l'échéance
 *      la plus proche avant la cible et la plus proche après, pilier par pilier (ATM, 25Δ call,
 *      25Δ put, 10Δ call, 10Δ put), puis σ(τ) = √(w(τ)/τ). Variance interpolée ≤ 0 → null.
 *   RR = IV(call) − IV(put), en points d'IV (négatif = puts plus chers, convention de skew.ts).
 *   BF = (IV(call) + IV(put))/2 − IV ATM (butterfly « smile », pas le strangle courtier).
 *
 * GARDE-FOUS : une échéance n'entre que si elle a au moins 2 strikes hors de la monnaie de chaque
 * côté du forward et plus de 24 h de vie (règlement 08:00 UTC, smile du jour instable). Une
 * maturité non encadrée par deux échéances exploitables reste « non mesurée » (jamais
 * extrapolée). Le 10Δ n'est affiché que si les options d'ancrage de CHAQUE aile, dans les deux
 * échéances encadrantes, portent chacune au moins 1 M$ d'OI au spot : sinon l'IV mark de l'aile
 * est surtout le modèle de Deribit (piège 1 de l'étude).
 *
 * LIMITES (affichées) : IV mark = surface modélisée par Deribit ; convention de delta forward non
 * ajustée de la prime (un tiers en delta ajusté placerait le 25Δ ailleurs) ; mesure risque-neutre.
 *
 * HISTORIQUE : un instantané par devise et par jour UTC, pris au premier chargement réussi de la
 * chaîne après 08:05 UTC (après le règlement), ≈ 130 octets : localStorage du navigateur, doublé
 * dans le KV du daemon s'il est présent (patron des instantanés de TERM), union des deux, jamais
 * destructive. Aucun collecteur ni rattrapage : sparkline et percentile n'apparaissent qu'à partir
 * de 90 points, couverture toujours affichée.
 *
 * `nowMs` est injecté (fonctions PURES testées). Module PARESSEUX : importé seulement par OptionsWindow.
 */
import type { OptionPoint } from "./deribit";
import { greeksOptionCrypto } from "./greeksDeribit";
import { ivRank } from "./ivRank";
import { daemonPret, detectDaemon, kvGet, kvPut } from "./daemon";

const MS_JOUR = 86_400_000;

/** Horizons constants affichés (jours calendaires). */
export const MATURITES_CONSTANTES = [7, 30, 90] as const;
export type MaturiteConstante = (typeof MATURITES_CONSTANTES)[number];

/** Garde-fou : strikes hors de la monnaie exigés de chaque côté du forward. */
export const MIN_STRIKES_PAR_COTE = 2;
/** Échéances de moins de 24 h écartées (règlement 08:00 UTC, smile instable). */
export const T_MIN_JOURS = 1;
/** OI minimal (USD au spot) de CHAQUE option d'ancrage d'une aile 10Δ. */
export const SEUIL_OI_AILE_10D_USD = 1_000_000;

/** Cibles en delta call équivalent : 10Δ call, 25Δ call, 25Δ put (= 0,75), 10Δ put (= 0,90). */
const DELTA_C10 = 0.1;
const DELTA_C25 = 0.25;
const DELTA_P25 = 0.75;
const DELTA_P10 = 0.9;

// ─────────────────────────── 1. Smile d'une échéance en delta ───────────────────────────

/** Smile d'une échéance lu à delta constant (IV en %). */
export interface SmileDelta {
  expiryMs: number;
  joursRestants: number;
  forward: number;
  atm: number | null;
  c25: number | null;
  p25: number | null;
  c10: number | null;
  p10: number | null;
  /** Vrai si chaque aile 10Δ est interpolée entre des options portant ≥ SEUIL_OI_AILE_10D_USD. */
  aile10Adossee: boolean;
}

/** Option hors de la monnaie retenue : delta call équivalent, IV, OI. */
interface PointOtm {
  strike: number;
  delta: number;
  iv: number;
  oi: number;
}

/** IV interpolée en delta et ses deux ancres, ou null si la cible n'est pas encadrée. */
function interpolerDelta(pts: PointOtm[], cible: number): { iv: number; ancres: [PointOtm, PointOtm] } | null {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (a.delta <= cible && cible <= b.delta) {
      const iv = b.delta === a.delta ? (a.iv + b.iv) / 2 : a.iv + ((b.iv - a.iv) * (cible - a.delta)) / (b.delta - a.delta);
      return { iv, ancres: [a, b] };
    }
  }
  return null;
}

/**
 * Smile d'UNE échéance (points déjà filtrés par échéance) à delta constant, ou null si le
 * garde-fou échoue (forward absent, échéance à moins de 24 h, moins de 2 strikes hors de la
 * monnaie d'un côté). PURE.
 */
export function smileEnDelta(points: readonly OptionPoint[], spot: number, nowMs: number): SmileDelta | null {
  const premier = points[0];
  if (premier === undefined || !Number.isFinite(spot) || spot <= 0) return null;
  const expiryMs = premier.expiryMs;
  const joursRestants = (expiryMs - nowMs) / MS_JOUR;
  if (!(joursRestants >= T_MIN_JOURS)) return null;
  const forward = points.map((p) => p.underlying).find((u) => Number.isFinite(u) && u > 0);
  if (forward === undefined) return null;

  const otm: PointOtm[] = [];
  for (const p of points) {
    if (p.expiryMs !== expiryMs || !Number.isFinite(p.markIv) || p.markIv <= 0) continue;
    const horsMonnaie = p.type === "put" ? p.strike < forward : p.strike >= forward;
    if (!horsMonnaie) continue;
    const g = greeksOptionCrypto(p, spot, nowMs);
    if (g === null || !Number.isFinite(g.deltaCall)) continue;
    otm.push({ strike: p.strike, delta: g.deltaCall, iv: p.markIv, oi: Number.isFinite(p.openInterest) ? p.openInterest : NaN });
  }
  const sous = otm.filter((p) => p.strike < forward);
  const sur = otm.filter((p) => p.strike >= forward);
  if (new Set(sous.map((p) => p.strike)).size < MIN_STRIKES_PAR_COTE) return null;
  if (new Set(sur.map((p) => p.strike)).size < MIN_STRIKES_PAR_COTE) return null;

  // ATM forward : interpolation en ln(K/F) entre le strike le plus haut sous F et le plus bas ≥ F.
  const bas = sous.reduce((m, p) => (p.strike > m.strike ? p : m));
  const haut = sur.reduce((m, p) => (p.strike < m.strike ? p : m));
  const xb = Math.log(bas.strike / forward);
  const xh = Math.log(haut.strike / forward);
  const atm = xh === 0 ? haut.iv : bas.iv + ((haut.iv - bas.iv) * (0 - xb)) / (xh - xb);

  const parDelta = [...otm].sort((a, b) => a.delta - b.delta);
  const c25 = interpolerDelta(parDelta, DELTA_C25);
  const p25 = interpolerDelta(parDelta, DELTA_P25);
  const c10 = interpolerDelta(parDelta, DELTA_C10);
  const p10 = interpolerDelta(parDelta, DELTA_P10);
  const adossee = (r: { ancres: [PointOtm, PointOtm] } | null) =>
    r !== null && r.ancres.every((a) => Number.isFinite(a.oi) && a.oi * spot >= SEUIL_OI_AILE_10D_USD);

  return {
    expiryMs,
    joursRestants,
    forward,
    atm,
    c25: c25?.iv ?? null,
    p25: p25?.iv ?? null,
    c10: c10?.iv ?? null,
    p10: p10?.iv ?? null,
    aile10Adossee: adossee(c10) && adossee(p10),
  };
}

// ─────────────────────────── 2. Interpolation à maturité constante ───────────────────────────

/** Une maturité constante : piliers interpolés (IV et écarts en points d'IV). */
export interface PointMaturiteConstante {
  jours: MaturiteConstante;
  atm: number | null;
  rr25: number | null;
  bf25: number | null;
  /** null si l'aile 10Δ n'est pas encadrée ou pas adossée à l'OI (cf. `aile10`). */
  rr10: number | null;
  bf10: number | null;
  /** « non-encadree » : aucune paire d'échéances exploitables autour de l'horizon. */
  etat: "mesuree" | "non-encadree";
  /** « oi-insuffisante » : ailes 10Δ calculables mais peu adossées à l'OI, donc masquées. */
  aile10: "affichee" | "oi-insuffisante" | "non-mesuree";
  /** Échéances encadrantes retenues (égales si une échéance tombe pile sur l'horizon). */
  avantMs: number | null;
  apresMs: number | null;
}

export interface SurfaceConstante {
  points: PointMaturiteConstante[];
  /** Échéances futures exploitables / écartées par le garde-fou (affichées en note). */
  nbEcheancesRetenues: number;
  nbEcheancesEcartees: number;
}

/** σ(τ) par interpolation linéaire de la variance totale σ²T entre deux échéances. */
function interpolerVariance(s1: number | null, t1: number, s2: number | null, t2: number, tau: number): number | null {
  if (s1 === null || s2 === null) return null;
  if (t1 === t2) return s1;
  const w1 = s1 * s1 * t1;
  const w2 = s2 * s2 * t2;
  const w = w1 + ((w2 - w1) * (tau - t1)) / (t2 - t1);
  return w > 0 ? Math.sqrt(w / tau) : null;
}

function difference(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a - b;
}

function papillon(c: number | null, p: number | null, atm: number | null): number | null {
  return c === null || p === null || atm === null ? null : (c + p) / 2 - atm;
}

/**
 * Surface à maturité constante (7, 30, 90 j) depuis la chaîne complète. `spot` = index commun
 * (`spotDeChaine`) ; `nowMs` = instant des données. PURE, sans extrapolation.
 */
export function surfaceMaturiteConstante(chain: readonly OptionPoint[], spot: number, nowMs: number): SurfaceConstante {
  const parEcheance = new Map<number, OptionPoint[]>();
  for (const p of chain) {
    if (!(p.expiryMs > nowMs)) continue;
    const arr = parEcheance.get(p.expiryMs);
    if (arr) arr.push(p);
    else parEcheance.set(p.expiryMs, [p]);
  }
  const smiles: SmileDelta[] = [];
  for (const exp of [...parEcheance.keys()].sort((a, b) => a - b)) {
    const s = smileEnDelta(parEcheance.get(exp) ?? [], spot, nowMs);
    if (s !== null) smiles.push(s);
  }

  const points = MATURITES_CONSTANTES.map((tau): PointMaturiteConstante => {
    let avant: SmileDelta | undefined;
    let apres: SmileDelta | undefined;
    for (const s of smiles) {
      if (s.joursRestants <= tau) avant = s;
      if (s.joursRestants >= tau && apres === undefined) apres = s;
    }
    if (avant === undefined || apres === undefined) {
      return { jours: tau, atm: null, rr25: null, bf25: null, rr10: null, bf10: null, etat: "non-encadree", aile10: "non-mesuree", avantMs: null, apresMs: null };
    }
    const a = avant;
    const b = avant.joursRestants === tau ? avant : apres;
    const pilier = (cle: "atm" | "c25" | "p25" | "c10" | "p10") =>
      interpolerVariance(a[cle], a.joursRestants, b[cle], b.joursRestants, tau);
    const atm = pilier("atm");
    const c25 = pilier("c25");
    const p25 = pilier("p25");
    const c10 = pilier("c10");
    const p10 = pilier("p10");
    const aile10Mesuree = c10 !== null && p10 !== null;
    const aile10Adossee = aile10Mesuree && a.aile10Adossee && b.aile10Adossee;
    return {
      jours: tau,
      atm,
      rr25: difference(c25, p25),
      bf25: papillon(c25, p25, atm),
      rr10: aile10Adossee ? difference(c10, p10) : null,
      bf10: aile10Adossee ? papillon(c10, p10, atm) : null,
      etat: "mesuree",
      aile10: aile10Adossee ? "affichee" : aile10Mesuree ? "oi-insuffisante" : "non-mesuree",
      avantMs: a.expiryMs,
      apresMs: b.expiryMs,
    };
  });

  return { points, nbEcheancesRetenues: smiles.length, nbEcheancesEcartees: parEcheance.size - smiles.length };
}

// ─────────────────────────── 3. Historique quotidien (pur) ───────────────────────────

/** Heure UTC de l'instantané quotidien : 08:05, après le règlement Deribit de 08:00. */
export const HEURE_INSTANTANE_UTC_MS = (8 * 60 + 5) * 60_000;
/** Seuil d'affichage de la sparkline et du percentile. */
export const MIN_POINTS_HISTORIQUE = 90;
/** Fenêtre du percentile (1 an). */
export const FENETRE_PERCENTILE_JOURS = 365;
/** Plafond de l'archive par devise (≈ 13 mois, ≈ 55 Ko). */
export const MAX_POINTS_ARCHIVE = 400;

/** Champs stockés par maturité, dans cet ordre. */
const CHAMPS = ["atm", "rr25", "bf25", "rr10", "bf10"] as const;
export type ChampSurface = (typeof CHAMPS)[number];

/** Point d'archive compact : jour UTC, horodatage des données, 15 valeurs (3 maturités × 5 champs). */
export interface PointHistoriqueSurface {
  j: string;
  t: number;
  v: (number | null)[];
}

export interface ArchiveSurface {
  v: 1;
  points: PointHistoriqueSurface[];
}

export const ARCHIVE_VIDE: ArchiveSurface = { v: 1, points: [] };

/** Jour UTC « AAAA-MM-JJ » d'un instant. */
export function jourUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Vrai si `ms` est après l'heure d'instantané (08:05 UTC) de son propre jour UTC. */
export function apresHeureInstantane(ms: number): boolean {
  return Number.isFinite(ms) && ms - Date.parse(`${jourUtc(ms)}T00:00:00Z`) >= HEURE_INSTANTANE_UTC_MS;
}

const arrondi = (v: number | null): number | null => (v === null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

/** Point d'archive d'une surface calculée à l'instant `t` ; null si aucune valeur mesurée. */
export function pointHistorique(surface: SurfaceConstante, t: number): PointHistoriqueSurface | null {
  const v: (number | null)[] = [];
  for (const tau of MATURITES_CONSTANTES) {
    const p = surface.points.find((x) => x.jours === tau);
    for (const champ of CHAMPS) v.push(arrondi(p?.[champ] ?? null));
  }
  return v.some((x) => x !== null) ? { j: jourUtc(t), t, v } : null;
}

/** Valide une archive lue (localStorage ou KV) ; les points mal formés sont écartés. */
export function validerArchive(brut: unknown): ArchiveSurface | null {
  if (typeof brut !== "object" || brut === null || (brut as { v?: unknown }).v !== 1) return null;
  const points = (brut as { points?: unknown }).points;
  if (!Array.isArray(points)) return null;
  const valides = points.filter(
    (p): p is PointHistoriqueSurface =>
      typeof p === "object" && p !== null &&
      typeof p.j === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.j) &&
      typeof p.t === "number" && Number.isFinite(p.t) && jourUtc(p.t) === p.j &&
      Array.isArray(p.v) && p.v.length === MATURITES_CONSTANTES.length * CHAMPS.length &&
      p.v.every((x: unknown) => x === null || (typeof x === "number" && Number.isFinite(x))),
  );
  return { v: 1, points: valides };
}

/**
 * Union de deux archives par jour UTC : pour un même jour, le PREMIER instantané (t minimal) est
 * gardé, quelle que soit sa source — la règle « premier chargement après 08:05 » reste vraie
 * entre navigateurs et daemon. Triée par date, plafonnée aux MAX_POINTS_ARCHIVE plus récents. PURE.
 */
export function fusionnerArchives(...archives: (ArchiveSurface | null)[]): ArchiveSurface {
  const parJour = new Map<string, PointHistoriqueSurface>();
  for (const a of archives) {
    for (const p of a?.points ?? []) {
      const deja = parJour.get(p.j);
      if (deja === undefined || p.t < deja.t) parJour.set(p.j, p);
    }
  }
  const points = [...parJour.values()].sort((a, b) => a.t - b.t).slice(-MAX_POINTS_ARCHIVE);
  return { v: 1, points };
}

/** Valeur d'un champ d'une maturité dans un point d'archive. */
function valeurPoint(p: PointHistoriqueSurface, jours: MaturiteConstante, champ: ChampSurface): number | null {
  const i = MATURITES_CONSTANTES.indexOf(jours) * CHAMPS.length + CHAMPS.indexOf(champ);
  return p.v[i] ?? null;
}

/** Lecture d'une série de l'historique pour l'affichage. */
export interface LectureHistorique {
  /** Points mesurés de la fenêtre d'un an, connus à `nowMs` (t ≤ nowMs), en ordre chronologique. */
  serie: { t: number; v: number }[];
  /** Percentile-rang 1 an de `courant` (ivRank), null sous MIN_POINTS_HISTORIQUE points. */
  percentile: number | null;
  /** Sparkline autorisée (≥ MIN_POINTS_HISTORIQUE points). */
  sparkline: boolean;
  /** Couverture : jours mesurés sur jours calendaires depuis le premier point de la fenêtre. */
  couverture: { jours: number; joursPossibles: number; debutMs: number } | null;
  /** Dernier instantané d'un jour UTC antérieur à celui de `nowMs` (comparaison « veille »). */
  precedent: { t: number; v: number } | null;
}

/**
 * Lecture CAUSALE d'une série (maturité × champ) : seuls les points connus à `nowMs` (t ≤ nowMs)
 * et datés de moins d'un an comptent ; ajouter des points postérieurs ne change rien. PURE.
 */
export function lireHistorique(
  archive: ArchiveSurface,
  jours: MaturiteConstante,
  champ: ChampSurface,
  courant: number | null,
  nowMs: number,
): LectureHistorique {
  const debutFenetre = nowMs - FENETRE_PERCENTILE_JOURS * MS_JOUR;
  const serie: { t: number; v: number }[] = [];
  for (const p of archive.points) {
    if (p.t > nowMs || p.t < debutFenetre) continue;
    const v = valeurPoint(p, jours, champ);
    if (v !== null) serie.push({ t: p.t, v });
  }
  serie.sort((a, b) => a.t - b.t);
  const assez = serie.length >= MIN_POINTS_HISTORIQUE;
  const premier = serie[0];
  const aujourdhui = jourUtc(nowMs);
  const anterieurs = serie.filter((p) => jourUtc(p.t) < aujourdhui);
  return {
    serie,
    percentile: assez && courant !== null ? ivRank(serie.map((p) => p.v), courant) : null,
    sparkline: assez,
    couverture: premier === undefined ? null : { jours: serie.length, joursPossibles: joursCalendaires(premier.t, nowMs), debutMs: premier.t },
    precedent: anterieurs[anterieurs.length - 1] ?? null,
  };
}

/** Nombre de jours UTC calendaires de `debutMs` à `nowMs` inclus. */
function joursCalendaires(debutMs: number, nowMs: number): number {
  return Math.round((Date.parse(`${jourUtc(nowMs)}T00:00:00Z`) - Date.parse(`${jourUtc(debutMs)}T00:00:00Z`)) / MS_JOUR) + 1;
}

/**
 * Couverture globale de l'archive sur la fenêtre d'un an (instantanés connus à `nowMs`) :
 * jours capturés sur jours calendaires depuis le premier. null si aucun. PURE.
 */
export function couvertureArchive(archive: ArchiveSurface, nowMs: number): LectureHistorique["couverture"] {
  const debutFenetre = nowMs - FENETRE_PERCENTILE_JOURS * MS_JOUR;
  const connus = archive.points.filter((p) => p.t <= nowMs && p.t >= debutFenetre);
  const premier = connus.reduce<PointHistoriqueSurface | null>((m, p) => (m === null || p.t < m.t ? p : m), null);
  return premier === null ? null : { jours: connus.length, joursPossibles: joursCalendaires(premier.t, nowMs), debutMs: premier.t };
}

/** Lecture d'une maturité constante : valeurs courantes et historique de ses trois séries. */
export interface LectureMaturite {
  point: PointMaturiteConstante;
  atm: LectureHistorique;
  rr25: LectureHistorique;
  bf25: LectureHistorique;
}

/** Lectures des trois maturités (valeur courante comparée à l'archive connue à `nowMs`). PURE. */
export function lireSurfaceHistorique(surface: SurfaceConstante, archive: ArchiveSurface, nowMs: number): LectureMaturite[] {
  return surface.points.map((point) => ({
    point,
    atm: lireHistorique(archive, point.jours, "atm", point.atm, nowMs),
    rr25: lireHistorique(archive, point.jours, "rr25", point.rr25, nowMs),
    bf25: lireHistorique(archive, point.jours, "bf25", point.bf25, nowMs),
  }));
}

// ─────────────────────────── 4. Persistance (localStorage ∪ KV daemon) ───────────────────────────

/** Namespace KV du daemon (une clé par devise, archive complète). */
export const NS_KV_SURFACE = "surface-options";
/** Préfixe localStorage (déclaré dans store/persist.ts : archive restée sur le poste). */
export const PREFIXE_LOCAL_SURFACE = "axiom:surfaceOptions:";

export type DeviseSurface = "BTC" | "ETH";

export function cleLocaleSurface(devise: DeviseSurface): string {
  return `${PREFIXE_LOCAL_SURFACE}${devise}:v1`;
}

function cleKvSurface(devise: DeviseSurface): string {
  return `${devise}:v1`;
}

function lireLocal(devise: DeviseSurface): ArchiveSurface | null {
  try {
    const brut = localStorage.getItem(cleLocaleSurface(devise));
    return brut ? validerArchive(JSON.parse(brut)) : null;
  } catch {
    return null;
  }
}

function ecrireLocal(devise: DeviseSurface, archive: ArchiveSurface): void {
  try {
    localStorage.setItem(cleLocaleSurface(devise), JSON.stringify(archive));
  } catch {
    /* quota / mode privé : l'historique reste celui du daemon s'il existe */
  }
}

/** Archive lue : union localStorage ∪ KV, et sources effectivement lues. */
export interface LectureArchive {
  archive: ArchiveSurface;
  daemon: boolean;
}

/**
 * Lit l'archive d'une devise : localStorage, puis KV du daemon s'il est présent (sonde
 * mémoïsée 60 s, comme TERM), union des deux. Ne jette jamais.
 */
export async function lireArchiveSurface(devise: DeviseSurface): Promise<LectureArchive> {
  const locale = lireLocal(devise);
  const avecDaemon = await detectDaemon("kv").catch(() => false);
  const distante = avecDaemon && daemonPret() ? validerArchive(await kvGet(NS_KV_SURFACE, cleKvSurface(devise))) : null;
  return { archive: fusionnerArchives(locale, distante), daemon: avecDaemon && daemonPret() };
}

/** Jours déjà capturés dans cette session (évite de relire le stockage à chaque cycle de 60 s). */
const capturesSession = new Set<string>();

/**
 * Instantané quotidien : au premier chargement réussi de la chaîne après 08:05 UTC, calcule la
 * surface à l'instant de RÉCEPTION des données et l'ajoute à l'archive si le jour UTC n'y est pas
 * déjà (premier instantané conservé). Renvoie l'archive mise à jour, ou null si rien n'a été
 * écrit (trop tôt, déjà capturé, surface vide). Ne jette jamais.
 */
export async function capturerSurfaceDuJour(
  devise: DeviseSurface,
  chain: readonly OptionPoint[],
  spot: number,
  recuLe: number,
): Promise<ArchiveSurface | null> {
  if (!apresHeureInstantane(recuLe)) return null;
  const jour = jourUtc(recuLe);
  const cleSession = `${devise}:${jour}`;
  if (capturesSession.has(cleSession)) return null;
  const locale = lireLocal(devise);
  if (locale?.points.some((p) => p.j === jour)) {
    capturesSession.add(cleSession);
    return null;
  }
  const point = pointHistorique(surfaceMaturiteConstante(chain, spot, recuLe), recuLe);
  if (point === null) return null;
  capturesSession.add(cleSession);
  const distante = daemonPret() ? validerArchive(await kvGet(NS_KV_SURFACE, cleKvSurface(devise))) : null;
  const archive = fusionnerArchives(locale, distante, { v: 1, points: [point] });
  ecrireLocal(devise, archive);
  if (daemonPret()) void kvPut(NS_KV_SURFACE, cleKvSurface(devise), archive);
  return archive;
}

/** Réservé aux tests : oublie les captures de la session. */
export function _viderCapturesSurface(): void {
  capturesSession.clear();
}
