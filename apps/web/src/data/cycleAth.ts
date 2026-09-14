/**
 * Distance à l'ATH du Bitcoin, ALIGNÉE SUR LE PIC — calculs PURS, séparés de l'I/O.
 *
 * Le graphe CYCLE aligne les cycles sur le halving ; ici on aligne sur le PIC : jours écoulés
 * depuis le plus haut historique, repli courant et repli maximal depuis ce plus haut, puis le
 * repli observé au MÊME nombre de jours après le pic de chacun des trois cycles passés.
 *
 * Source : PriceUSD Coin Metrics (taux de référence quotidien daté à 00:00 UTC, valeur de fin
 * de journée — pas un plus haut intrajournalier ni la clôture d'un exchange : dates ±1-2 j vs
 * TradingView). ⚠️ Trois cycles seulement : un repère de lecture, sans valeur prédictive.
 * Fonctions NaN-safe : les prix non finis ou ≤ 0 sont ignorés ; une absence donne `null`
 * (l'UI affiche « — »), jamais 0.
 */
import type { PointMetrique } from "./onchain/coinmetrics";

/** Un jour en millisecondes (points Coin Metrics datés à 00:00 UTC). */
const JOUR_MS = 86_400_000;

/** Rang de halving d'un cycle passé : 1 = 2012, 2 = 2016, 3 = 2020. */
export type RangPic = 1 | 2 | 3;

/**
 * Pics des marchés haussiers passés, par rang de halving : maxima quotidiens de PriceUSD
 * Coin Metrics, vérifiés sur l'historique complet (5 902 points, 2010-07-18 → 2026-09-13) :
 * 2013-12-04 (1 134,93 $), 2017-12-16 (19 640,51 $ ; 19 250,47 $ le 17), 2021-11-08
 * (67 541,76 $). Le point daté J vaut la fin de la journée J (recoupé avec les bougies 1d
 * Binance). Coïncident avec le sommet des cycles clos de `statsCycle(…, true)`.
 */
export const PICS_CYCLES: Readonly<Record<RangPic, number>> = {
  1: Date.UTC(2013, 11, 4),
  2: Date.UTC(2017, 11, 16),
  3: Date.UTC(2021, 10, 8),
};

/** Repli au même délai après un pic passé. */
export interface RepliPostPic {
  /** Prix au jour du pic (lu dans la série, pas codé en dur). */
  prixPic: number;
  /** Écart du prix à pic + N jours au prix du pic, en %. */
  repliPct: number;
  /** Écart du plus bas sur [pic, pic + N] au prix du pic, en %. */
  repliMaxPct: number;
}

/** État courant vis-à-vis de l'ATH, et comparaison au même délai après les pics passés. */
export interface DistanceAth {
  /** Plus haut historique (prix quotidien PriceUSD) et sa date (ms, 00:00 UTC). */
  athPrix: number;
  athMs: number;
  /** Date du dernier point observé (J-1 en pratique). */
  dernierMs: number;
  /** Jours entre l'ATH et le dernier point (N). */
  joursDepuisAth: number;
  /** Écart du dernier prix à l'ATH, en % (≤ 0). */
  repliCourantPct: number;
  /** Écart du plus bas sur [ATH, dernier point] à l'ATH, en % (≤ 0), et sa date. */
  repliMaxPct: number;
  repliMaxMs: number;
  /** Repli à pic + N jours pour chaque cycle passé ; null si la série ne couvre pas le délai. */
  cyclesPasses: Readonly<Record<RangPic, RepliPostPic | null>>;
}

const exploitable = (p: PointMetrique): boolean =>
  Number.isFinite(p.time) && Number.isFinite(p.value) && p.value > 0;

/**
 * Repli à `jours` jours après le pic daté `picMs`. PURE. Exige un prix exploitable au jour
 * exact du pic ET à pic + N (points à 00:00 UTC) ; le plus bas porte sur [pic, pic + N], prix
 * non exploitables ignorés. `null` si l'un des deux prix manque ou si N n'est pas un entier ≥ 0.
 */
export function repliPostPic(
  points: readonly PointMetrique[],
  picMs: number,
  jours: number,
): RepliPostPic | null {
  if (!Number.isInteger(jours) || jours < 0) return null;
  const finMs = picMs + jours * JOUR_MS;
  let prixPic: number | null = null;
  let prixFin: number | null = null;
  let plusBas = Infinity;
  for (const p of points) {
    if (!exploitable(p) || p.time < picMs || p.time > finMs) continue;
    if (p.time === picMs) prixPic = p.value;
    if (p.time === finMs) prixFin = p.value;
    if (p.value < plusBas) plusBas = p.value;
  }
  if (prixPic === null || prixFin === null) return null;
  return {
    prixPic,
    repliPct: (prixFin / prixPic - 1) * 100,
    repliMaxPct: (plusBas / prixPic - 1) * 100,
  };
}

/**
 * Distance à l'ATH sur un historique de prix quotidiens. PURE.
 * ATH = maximum (première occurrence) ; N = jours entre l'ATH et le dernier point ; repli max =
 * plus bas (première occurrence) sur [ATH, dernier point] ; chaque cycle passé est lu à
 * `PICS_CYCLES[k]` + N jours. `null` si aucun prix exploitable.
 */
export function distanceAth(points: readonly PointMetrique[]): DistanceAth | null {
  const tries = points.filter(exploitable).sort((a, b) => a.time - b.time);
  if (tries.length === 0) return null;

  let iAth = 0;
  for (let i = 1; i < tries.length; i += 1) if (tries[i]!.value > tries[iAth]!.value) iAth = i;
  let iBas = iAth;
  for (let i = iAth + 1; i < tries.length; i += 1) if (tries[i]!.value < tries[iBas]!.value) iBas = i;

  const ath = tries[iAth]!;
  const dernier = tries[tries.length - 1]!;
  const joursDepuisAth = Math.round((dernier.time - ath.time) / JOUR_MS);

  return {
    athPrix: ath.value,
    athMs: ath.time,
    dernierMs: dernier.time,
    joursDepuisAth,
    repliCourantPct: (dernier.value / ath.value - 1) * 100,
    repliMaxPct: (tries[iBas]!.value / ath.value - 1) * 100,
    repliMaxMs: tries[iBas]!.time,
    cyclesPasses: {
      1: repliPostPic(tries, PICS_CYCLES[1], joursDepuisAth),
      2: repliPostPic(tries, PICS_CYCLES[2], joursDepuisAth),
      3: repliPostPic(tries, PICS_CYCLES[3], joursDepuisAth),
    },
  };
}
