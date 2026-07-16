/**
 * Calculs PURS de la fenêtre STBL (stablecoins) — dominance, impression (Δ supply),
 * écarts de peg, répartition par chaîne. Séparés du composant pour rester testables
 * sans DOM (même convention que macroRatesWindow.util.ts).
 *
 * Seuils de peg (écart ABSOLU vs 1,00 $, pegs USD uniquement — DefiLlama fournit les
 * prix en USD, un peg EUR nécessiterait le cours EUR/USD) :
 *   stable < 25 bps ≤ tension < 100 bps ≤ depeg.
 */
import type { DetailEmetteur, EmetteurStablecoin, PointSupply } from "../data/macro/stablecoinsDetail";

const JOUR_MS = 86_400_000;

// ─────────────────────────── Dominance ───────────────────────────

export interface PartDominance {
  id: string; // "" pour l'agrégat « Autres »
  symbole: string;
  mcapUsd: number;
  partPct: number;
}

/** Parts de marché des `topN` premiers émetteurs + agrégat « Autres » (id vide). */
export function calculerDominance(emetteurs: EmetteurStablecoin[], topN = 12): PartDominance[] {
  const total = emetteurs.reduce((s, e) => s + e.mcapUsd, 0);
  if (total <= 0) return [];
  const tries = [...emetteurs].sort((a, b) => b.mcapUsd - a.mcapUsd);
  const tete = tries.slice(0, topN).map((e) => ({
    id: e.id,
    symbole: e.symbole,
    mcapUsd: e.mcapUsd,
    partPct: (e.mcapUsd / total) * 100,
  }));
  const resteUsd = tries.slice(topN).reduce((s, e) => s + e.mcapUsd, 0);
  if (resteUsd > 0) {
    tete.push({ id: "", symbole: "Autres", mcapUsd: resteUsd, partPct: (resteUsd / total) * 100 });
  }
  return tete;
}

// ─────────────────────────── Variations ───────────────────────────

/** Variation relative en % ; null si le point de comparaison manque ou est ≤ 0. */
export function deltaPct(actuel: number, precedent: number | null): number | null {
  if (precedent === null || !Number.isFinite(precedent) || precedent <= 0) return null;
  return ((actuel - precedent) / precedent) * 100;
}

// ─────────────────────────── Pegs ───────────────────────────

/** Écart au peg en points de base vs 1,00 $ — pegs USD uniquement, sinon null. */
export function ecartPegBps(e: EmetteurStablecoin): number | null {
  if (e.pegType !== "peggedUSD" || e.prix === null) return null;
  return (e.prix - 1) * 10_000;
}

export type EtatPeg = "stable" | "tension" | "depeg";

/** Classement d'un écart de peg (valeur ABSOLUE) selon les seuils du spec. */
export function etatPeg(bps: number): EtatPeg {
  const abs = Math.abs(bps);
  if (abs < 25) return "stable";
  if (abs < 100) return "tension";
  return "depeg";
}

/** Seuil de matérialité : sous ~10 M$ de supply, les tokens morts noient la lecture des pegs. */
export const SUPPLY_MIN_USD = 10_000_000;

export interface ResumePegs {
  /** Nombre d'émetteurs USD matériels au peg stable (< 25 bps). */
  stables: number;
  /** Écarts significatifs (tension/depeg), triés par |bps| décroissant. */
  alertes: { symbole: string; bps: number; etat: EtatPeg }[];
}

/** État global des pegs USD matériels — alimente le bandeau de la Vue d'ensemble. */
export function resumePegs(emetteurs: readonly EmetteurStablecoin[]): ResumePegs {
  let stables = 0;
  const alertes: ResumePegs["alertes"] = [];
  for (const e of emetteurs) {
    if (e.mcapUsd < SUPPLY_MIN_USD) continue;
    const bps = ecartPegBps(e);
    if (bps === null) continue;
    const etat = etatPeg(bps);
    if (etat === "stable") stables += 1;
    else alertes.push({ symbole: e.symbole, bps, etat });
  }
  alertes.sort((a, b) => Math.abs(b.bps) - Math.abs(a.bps));
  return { stables, alertes };
}

// ─────────────────────────── Impression (Δ supply) ───────────────────────────

/**
 * Impression nette sur `jours` : dernier point − point le plus proche AVANT la borne
 * (dernier point dont time ≤ dernier.time − jours ; à défaut le premier point).
 */
export function impressionNette(serie: PointSupply[], jours: number): number | null {
  if (serie.length < 2) return null;
  const dernier = serie[serie.length - 1]!;
  const borne = dernier.time - jours * JOUR_MS;
  let reference = serie[0]!;
  for (const p of serie) {
    if (p.time <= borne) reference = p;
    else break;
  }
  return dernier.totalUsd - reference.totalUsd;
}

/** Δ point à point (mint net > 0, burn net < 0) — barres de l'onglet Impression. */
export function serieImpressionQuotidienne(serie: PointSupply[]): { time: number; delta: number }[] {
  const sortie: { time: number; delta: number }[] = [];
  for (let i = 1; i < serie.length; i++) {
    sortie.push({ time: serie[i]!.time, delta: serie[i]!.totalUsd - serie[i - 1]!.totalUsd });
  }
  return sortie;
}

/** Garde les `jours` derniers jours (relatifs au dernier point) ; null = tout. */
export function tronquerSerie(serie: PointSupply[], jours: number | null): PointSupply[] {
  if (jours === null || serie.length === 0) return serie;
  const borne = serie[serie.length - 1]!.time - jours * JOUR_MS;
  return serie.filter((p) => p.time >= borne);
}

// ─────────────────────────── Chaînes ───────────────────────────

export interface PartChaine {
  chaine: string;
  totalUsd: number;
  partPct: number;
}

/** Supply agrégée par chaîne sur TOUS les émetteurs (état courant), tri décroissant. */
export function repartitionChaines(emetteurs: EmetteurStablecoin[]): PartChaine[] {
  const totaux = new Map<string, number>();
  for (const e of emetteurs) {
    for (const [chaine, montant] of Object.entries(e.parChaineUsd)) {
      totaux.set(chaine, (totaux.get(chaine) ?? 0) + montant);
    }
  }
  const total = [...totaux.values()].reduce((s, v) => s + v, 0);
  if (total <= 0) return [];
  return [...totaux.entries()]
    .map(([chaine, totalUsd]) => ({ chaine, totalUsd, partPct: (totalUsd / total) * 100 }))
    .sort((a, b) => b.totalUsd - a.totalUsd);
}

// ─────────────────────────── Drill-down ───────────────────────────

/** Historique de supply TOTALE d'un émetteur = somme de ses chaînes par date. */
export function agregerHistoriqueEmetteur(detail: DetailEmetteur): PointSupply[] {
  const parDate = new Map<number, number>();
  for (const serie of Object.values(detail.historiqueParChaine)) {
    for (const p of serie) {
      parDate.set(p.time, (parDate.get(p.time) ?? 0) + p.totalUsd);
    }
  }
  return [...parDate.entries()]
    .map(([time, totalUsd]) => ({ time, totalUsd }))
    .sort((a, b) => a.time - b.time);
}

// ─────────────────────────── Échelles canvas ───────────────────────────

/** Min/max des valeurs finies — null si aucune (évite les échelles NaN au dessin). */
export function bornes(valeurs: number[]): { min: number; max: number } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const v of valeurs) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min <= max ? { min, max } : null;
}
