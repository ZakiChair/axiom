/**
 * Calculs PURS du graphique COT : périodes, graduations, axe du temps, domaine vertical,
 * recherche du rapport sous le curseur. Aucun DOM — testé dans graphiqueCot.util.test.ts.
 */
import { netSurOi } from "../../data/cot";
import { netCategorie, type PointHistoriqueCot } from "../../data/cotHistorique";
import type { Domaine } from "../../lib/domaineAxe";

/** Unité de l'exposition tracée : contrats nets, ou net en % de l'open interest du marché. */
export type UniteCot = "contrats" | "pctOi";

/** Plages proposées (rapports hebdomadaires : pas de 30/90 jours). */
export const PERIODES_COT: ReadonlyArray<{ id: string; jours: number | null; label: string }> = [
  { id: "1a", jours: 365, label: "1 a" },
  { id: "3a", jours: 3 * 365, label: "3 a" },
  { id: "5a", jours: 5 * 365, label: "5 a" },
  { id: "10a", jours: 10 * 365, label: "10 a" },
  { id: "tout", jours: null, label: "Tout" },
];

/** Plage par défaut : 3 ans, l'horizon du COT Index de la synthèse. */
export const PERIODE_DEFAUT = "3a";

/** Deux rapports espacés de plus de 3 semaines ne sont pas reliés (publication manquante). */
export const ECART_MAX_MS = 21 * 86_400_000;

/** Valeur tracée d'une catégorie à un rapport, null si indisponible. */
export function valeurCot(p: PointHistoriqueCot, i: number, unite: UniteCot): number | null {
  const net = netCategorie(p, i);
  if (net === null) return null;
  return unite === "contrats" ? net : netSurOi(net, p.oi);
}

/**
 * Graduations « rondes » (1, 2, 2,5, 5 × 10^k) couvrant [min, max], environ `n` lignes.
 * `[]` si bornes invalides. Le zéro est exact (pas de −0 ni de 1e-17).
 */
export function ticksRonds(min: number, max: number, n: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min || n <= 0) return [];
  const brut = (max - min) / n;
  const puissance = 10 ** Math.floor(Math.log10(brut));
  const pas = [1, 2, 2.5, 5, 10].map((m) => m * puissance).find((p) => p >= brut) ?? 10 * puissance;
  const ticks: number[] = [];
  for (let k = Math.ceil(min / pas); k * pas <= max + pas * 1e-9; k++) {
    const v = k * pas;
    ticks.push(Math.abs(v) < pas * 1e-9 ? 0 : Number(v.toPrecision(12)));
  }
  return ticks;
}

/** Libellé d'axe compact : « −250K », « 1,2M », « 35 % ». */
export function formatAxeCot(v: number, unite: UniteCot): string {
  const signe = v < 0 ? "−" : "";
  const abs = Math.abs(v);
  if (unite === "pctOi") return `${signe}${abs.toFixed(abs < 10 && abs % 1 !== 0 ? 1 : 0).replace(".", ",")} %`;
  if (abs >= 1e6) return `${signe}${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1).replace(".", ",")}M`;
  if (abs >= 1e3) return `${signe}${(abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1).replace(".", ",")}K`;
  return `${signe}${abs.toFixed(0)}`;
}

/** Valeur d'infobulle/tableau : contrats signés exacts, ou % signé à une décimale. */
export function formatValeurCot(v: number | null, unite: UniteCot): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const signe = v > 0 ? "+" : v < 0 ? "−" : "";
  const abs = Math.abs(v);
  return unite === "pctOi"
    ? `${signe}${abs.toFixed(1).replace(".", ",")} %`
    : `${signe}${Math.round(abs).toLocaleString("fr-FR")}`;
}

const MOIS_PAR_PAS = [1, 2, 3, 6, 12, 24, 60, 120] as const;

/**
 * Graduations du temps au premier jour d'un mois aligné sur le pas (mois, trimestres, années…),
 * au plus `cible` étiquettes. Étiquette « 2024 » dès un pas d'un an, sinon « janv. 24 ».
 */
export function ticksTemps(min: number, max: number, cible: number): { t: number; label: string }[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min || cible <= 0) return [];
  const moisTotal = (max - min) / (30.44 * 86_400_000);
  const pas: number = MOIS_PAR_PAS.find((p) => moisTotal / p <= cible) ?? 120;
  const debut = new Date(min);
  // Premier mois aligné sur le pas à partir du mois de `min` ; les instants avant `min` sont sautés.
  let k = Math.ceil((debut.getFullYear() * 12 + debut.getMonth()) / pas) * pas;
  const ticks: { t: number; label: string }[] = [];
  for (;;) {
    const annee = Math.floor(k / 12);
    const t = new Date(annee, k % 12, 1).getTime();
    if (t > max) break;
    if (t >= min) {
      ticks.push({
        t,
        label: pas >= 12
          ? String(annee)
          : new Date(t).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }),
      });
    }
    k += pas;
  }
  return ticks;
}

/**
 * Domaine vertical des catégories VISIBLES sur la plage affichée ; contient toujours zéro
 * (le signe de l'exposition reste lisible) ; marge de 8 %. Null si aucune valeur.
 */
export function domaineVertical(
  points: readonly PointHistoriqueCot[],
  categories: readonly number[],
  unite: UniteCot,
  plage: Domaine,
): Domaine | null {
  let min = 0;
  let max = 0;
  let trouve = false;
  for (const p of points) {
    if (p.t < plage.min || p.t > plage.max) continue;
    for (const i of categories) {
      const v = valeurCot(p, i, unite);
      if (v === null) continue;
      trouve = true;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!trouve) return null;
  const marge = (max - min) * 0.08 || 1;
  return { min: min - marge, max: max + marge };
}

/** Indice du rapport le plus proche de `t` (série triée), -1 si vide. Recherche dichotomique. */
export function indexPlusProche(points: readonly PointHistoriqueCot[], t: number): number {
  if (points.length === 0) return -1;
  let bas = 0;
  let haut = points.length - 1;
  while (haut - bas > 1) {
    const milieu = (bas + haut) >> 1;
    if (points[milieu]!.t <= t) bas = milieu;
    else haut = milieu;
  }
  return Math.abs(points[haut]!.t - t) < Math.abs(points[bas]!.t - t) ? haut : bas;
}
