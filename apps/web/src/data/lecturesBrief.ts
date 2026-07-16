/**
 * Lecture générée du BRIEF : 1 à 3 phrases FACTUELLES à seuils, à partir des
 * mêmes entrées que le régime (+ ΔOI). Jamais prescriptif — on décrit
 * l'environnement, on ne recommande rien (BUILD-CONTRACT).
 */
import { formatPct } from "../lib/format";

export interface EntreesLecture {
  nuitBtcPct: number | null;
  /** Percentile 0..100 du funding BTC vs ~90 j. */
  fundingPercentile: number | null;
  /** Percentile 0..100 du DVOL BTC vs 90 j. */
  dvolPercentile: number | null;
  deltaOi24hPct: number | null;
  fearGreed: number | null;
}

const MAX_PHRASES = 3;

function clauseNuit(pct: number): string {
  const dir = pct >= 1 ? "haussière" : pct <= -1 ? "baissière" : "calme";
  return `Nuit ${dir} (BTC ${formatPct(pct, 1)})`;
}

function clauseFunding(p: number): string {
  const etat = p >= 90 ? "tendu" : p <= 10 ? "déprimé" : "neutre";
  return `funding ${etat} (p${Math.round(p)})`;
}

function clauseVol(p: number): string {
  const etat = p >= 75 ? "élevée" : p <= 25 ? "basse" : "moyenne";
  return `vol ${etat} (p${Math.round(p)})`;
}

export function lectures(entrees: EntreesLecture): string[] {
  const out: string[] = [];

  // 1. Contexte : nuit (+ funding + vol si disponibles), ancrée sur la nuit.
  if (entrees.nuitBtcPct !== null && Number.isFinite(entrees.nuitBtcPct)) {
    const clauses = [clauseNuit(entrees.nuitBtcPct)];
    if (entrees.fundingPercentile !== null) clauses.push(clauseFunding(entrees.fundingPercentile));
    if (entrees.dvolPercentile !== null) clauses.push(clauseVol(entrees.dvolPercentile));
    out.push(`${clauses.join(", ")}.`);
  }

  // 2. Positionnement : funding extrême haut + OI en expansion.
  if (
    entrees.fundingPercentile !== null &&
    entrees.fundingPercentile >= 90 &&
    entrees.deltaOi24hPct !== null &&
    entrees.deltaOi24hPct >= 3
  ) {
    out.push(
      `Funding p${Math.round(entrees.fundingPercentile)} avec ΔOI ${formatPct(entrees.deltaOi24hPct, 1)} sur 24 h : positionnement long tendu.`,
    );
  }

  // 3. Sentiment : extrêmes Fear & Greed seulement.
  if (entrees.fearGreed !== null && Number.isFinite(entrees.fearGreed)) {
    if (entrees.fearGreed >= 75) out.push(`Sentiment en zone avidité (F&G ${Math.round(entrees.fearGreed)}).`);
    else if (entrees.fearGreed <= 25) out.push(`Sentiment en zone peur (F&G ${Math.round(entrees.fearGreed)}).`);
  }

  return out.slice(0, MAX_PHRASES);
}
