/**
 * Validation historique des signaux par EVENT STUDY (logique PURE, spec 2026-07-23).
 *
 * On mesure l'edge d'un SIGNAL, pas d'une stratégie : rendements forward à horizon
 * fixe après chaque déclenchement historique, SIGNÉS par la direction du signal,
 * comparés à la référence inconditionnelle (drift du sous-jacent signé par le même
 * mix de directions). Volontairement PAS le moteur @axiom/backtest : ses règles de
 * sortie / stop / sizing mesureraient la stratégie d'exécution, pas le signal —
 * et les détecteurs (pivots, z-score sur série auxiliaire) ne s'expriment pas dans
 * son modèle comparaison/croisement.
 *
 * Anti-biais :
 *  - funding : hystérésis — un épisode au-dessus du seuil = UN événement (entrée au
 *    franchissement, réarmé quand |z| repasse sous le seuil) ;
 *  - divergence : détection incrémentale barre par barre, dédoublonnée par
 *    (direction, pivot final) — la même divergence vue 10 barres de suite compte 1 ;
 *  - pas de look-ahead : un événement est daté de l'instant où il est CONNU (clôture
 *    de la barre de détection ; règlement du funding), l'entrée est la dernière
 *    clôture ≤ cet instant.
 */
import type { PointSerie } from "../lib/referentiel";
import {
  detecterDivergenceRsi,
  zScoreFunding,
  FENETRE_Z_FUNDING,
  PIVOT_K,
  SEUIL_Z_FUNDING,
  type DirectionSignal,
} from "./signaux";

// ─────────────────────────── Types ───────────────────────────

/** Un déclenchement historique : l'instant où le signal est connu + sa direction. */
export interface EvenementSignal {
  t: number;
  direction: DirectionSignal;
}

/** Horizons mesurés (en bougies 4 h — le TF de la divergence et de l'entrée). */
export const HORIZONS_VALIDATION = [
  { id: "24h", libelle: "24 h", bougies: 6 },
  { id: "72h", libelle: "72 h", bougies: 18 },
] as const;
export type HorizonId = (typeof HORIZONS_VALIDATION)[number]["id"];

/** Sommes poolables d'une étude (fusionnables entre symboles avant finalisation). */
export interface SommesEtude {
  n: number;
  reussites: number;
  sommePct: number;
  sommeBaselinePct: number;
}

/** Statistiques finales d'une cellule (type de signal × horizon). */
export interface StatsEtude {
  n: number;
  /** % d'événements dont le rendement signé est > 0. */
  tauxReussitePct: number;
  /** Rendement signé moyen par événement (%). */
  moyennePct: number;
  /** Référence : drift inconditionnel signé par le même mix de directions (%). */
  baselineMoyennePct: number;
}

// ─────────────────────────── Univers de validation ───────────────────────────

/**
 * Univers sur lequel porte la validation. Le top-volume du jour est dominé par des
 * listings frais au funding structurellement extrême (biais de sélection observé au
 * premier run) — pouvoir valider sur les majors ou sa watchlist isole ce biais.
 */
export type UniversValidation = "echantillon" | "majors" | "watchlist";

/** Libellés UI des univers (ordre = ordre du Segmente). */
export const UNIVERS_VALIDATION: { id: UniversValidation; label: string }[] = [
  { id: "echantillon", label: "Échantillon scanné" },
  { id: "majors", label: "Majors" },
  { id: "watchlist", label: "Watchlist" },
];

/** Majors : grosses capitalisations à perp Binance ancien (funding profond, pas de listing frais). */
export const MAJORS_VALIDATION: readonly string[] = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
  "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "LTCUSDT",
];

/**
 * Résout la liste de symboles d'un univers. Dédoublonne en préservant l'ordre.
 * Une liste vide signale un prérequis manquant (scan non lancé / watchlist vide) —
 * le message est du ressort de l'appelant. PURE.
 */
export function symbolesUnivers(
  univers: UniversValidation,
  echantillon: readonly string[],
  watchlist: readonly string[],
): string[] {
  const source =
    univers === "majors" ? MAJORS_VALIDATION : univers === "watchlist" ? watchlist : echantillon;
  return [...new Set(source)];
}

// ─────────────────────────── Génération des événements ───────────────────────────

/**
 * Événements « funding extrême » sur l'historique complet, avec HYSTÉRÉSIS :
 * l'événement est émis au franchissement de |z| ≥ seuil, puis le détecteur est
 * désarmé jusqu'à ce que |z| repasse SOUS le seuil (un épisode = un événement).
 * Direction contrarian (z > 0 = crowded long = baissier). PURE.
 */
export function evenementsFundingExtreme(hist: readonly PointSerie[]): EvenementSignal[] {
  const valeurs = hist.map((p) => p.v);
  const out: EvenementSignal[] = [];
  let arme = true;
  for (let i = FENETRE_Z_FUNDING; i < hist.length; i++) {
    const z = zScoreFunding(valeurs, i);
    if (z === null) continue;
    if (Math.abs(z) >= SEUIL_Z_FUNDING) {
      if (arme) {
        const point = hist[i];
        if (point !== undefined) {
          out.push({ t: point.t, direction: z > 0 ? "baissier" : "haussier" });
        }
        arme = false;
      }
    } else {
      arme = true;
    }
  }
  return out;
}

/**
 * Événements « divergence RSI » : rejoue la détection barre par barre (préfixes
 * croissants — exactement ce que verrait le scanner en live) et dédoublonne par
 * (direction, pivot final). L'événement est daté de la CLÔTURE de la barre de
 * détection (`times[i-1] + dureeMs`) : le pivot final exige PIVOT_K bougies de
 * confirmation, la détection est donc structurellement sans look-ahead. PURE.
 */
export function evenementsDivergenceRsi(
  closes: readonly number[],
  rsi: ReadonlyArray<number | undefined>,
  times: readonly number[],
  dureeMs: number,
): EvenementSignal[] {
  const vus = new Set<string>();
  const out: EvenementSignal[] = [];
  for (let i = PIVOT_K * 2 + 2; i <= closes.length; i++) {
    const d = detecterDivergenceRsi(closes.slice(0, i), rsi.slice(0, i));
    if (d === null) continue;
    const cle = `${d.direction}:${d.indexPivotFinal}`;
    if (vus.has(cle)) continue;
    vus.add(cle);
    const tOuverture = times[i - 1];
    if (tOuverture !== undefined) out.push({ t: tOuverture + dureeMs, direction: d.direction });
  }
  return out;
}

// ─────────────────────────── Étude d'événements ───────────────────────────

/** Dernier index dont la barre est CLÔTURÉE à l'instant t (times = ouvertures triées). */
export function indexEntree(times: readonly number[], t: number, dureeMs: number): number {
  // Recherche dichotomique du dernier times[i] ≤ t − durée (barre close à t).
  let lo = 0;
  let hi = times.length - 1;
  let res = -1;
  const cible = t - dureeMs;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = times[mid];
    if (v !== undefined && v <= cible) {
      res = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return res;
}

/**
 * Étude d'événements sur UN symbole et UN horizon : rendements forward signés par
 * la direction, référence = drift inconditionnel (moyenne des rendements forward de
 * TOUTES les barres) signé par la direction de chaque événement. Renvoie des SOMMES
 * poolables (fusion multi-symboles avant finalisation). PURE.
 */
export function etudeEvenements(
  evenements: readonly EvenementSignal[],
  times: readonly number[],
  closes: readonly number[],
  horizonBougies: number,
  dureeMs: number,
): SommesEtude {
  // Drift inconditionnel à cet horizon (référence « long toutes barres »).
  let sommeBase = 0;
  let nBase = 0;
  for (let i = 0; i + horizonBougies < closes.length; i++) {
    const c0 = closes[i];
    const c1 = closes[i + horizonBougies];
    if (c0 === undefined || c1 === undefined || c0 <= 0) continue;
    sommeBase += (c1 / c0 - 1) * 100;
    nBase++;
  }
  const driftPct = nBase > 0 ? sommeBase / nBase : 0;

  const sommes: SommesEtude = { n: 0, reussites: 0, sommePct: 0, sommeBaselinePct: 0 };
  for (const ev of evenements) {
    const idx = indexEntree(times, ev.t, dureeMs);
    if (idx < 0 || idx + horizonBougies >= closes.length) continue;
    const c0 = closes[idx];
    const c1 = closes[idx + horizonBougies];
    if (c0 === undefined || c1 === undefined || c0 <= 0) continue;
    const brutPct = (c1 / c0 - 1) * 100;
    const signe = ev.direction === "haussier" ? 1 : -1;
    sommes.n++;
    if (brutPct * signe > 0) sommes.reussites++;
    sommes.sommePct += brutPct * signe;
    sommes.sommeBaselinePct += driftPct * signe;
  }
  return sommes;
}

/** Fusionne des sommes d'études (multi-symboles). PURE. */
export function fusionnerEtudes(etudes: readonly SommesEtude[]): SommesEtude {
  const out: SommesEtude = { n: 0, reussites: 0, sommePct: 0, sommeBaselinePct: 0 };
  for (const e of etudes) {
    out.n += e.n;
    out.reussites += e.reussites;
    out.sommePct += e.sommePct;
    out.sommeBaselinePct += e.sommeBaselinePct;
  }
  return out;
}

/** Statistiques finales d'une cellule ; null si aucun événement mesurable. PURE. */
export function finaliserEtude(s: SommesEtude): StatsEtude | null {
  if (s.n === 0) return null;
  return {
    n: s.n,
    tauxReussitePct: (100 * s.reussites) / s.n,
    moyennePct: s.sommePct / s.n,
    baselineMoyennePct: s.sommeBaselinePct / s.n,
  };
}
