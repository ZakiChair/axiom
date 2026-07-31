/**
 * Régime de marché : score composite −2..+2 sur 8 composants publics.
 * PUR — l'assemblage des entrées vit dans store/regime.ts. Seules dépendances :
 * les formateurs purs de lib/format (montants signés du détail) et le type
 * RegimeGamma de data/gexDex (verdict OMON v2.6). Ton factuel, jamais
 * prescriptif : le score DÉCRIT l'environnement, il ne conseille pas.
 */
import { formatUsdSigne } from "../lib/format";
import type { RegimeGamma } from "./gexDex";

export interface EntreesRegime {
  /** Variation BTC 24 h en % (ticker Binance), ou null. */
  directionBtc24hPct: number | null;
  /** Fear & Greed 0..100, ou null. */
  fearGreed: number | null;
  /** Percentile 0..100 du funding BTC courant vs ~90 j, ou null. */
  fundingBtcPercentile: number | null;
  /** Percentile 0..100 du DVOL BTC courant vs 90 j, ou null. */
  dvolBtcPercentile: number | null;
  /** Percentile 0..100 de la vol RÉALISÉE BTC courante vs ~100 j, ou null. */
  volRealiseeBtcPercentile: number | null;
  /** Flux ETF spot BTC+ETH+SOL de la veille, en USD, ou null. */
  fluxEtfJourUsd: number | null;
  /** Δ supply stablecoins 7 j en % de la supply, ou null. */
  impressionStablecoins7jPct: number | null;
  /**
   * Régime gamma des dealers BTC (verdict OMON, toutes échéances) + GEX net USD,
   * ou null. Hypothèse retail standard : dealers long les calls, short les puts.
   */
  regimeGammaBtc: { regime: RegimeGamma; gexNetUsd: number } | null;
}

export interface ComposantRegime {
  id: string;
  libelle: string;
  /** Note −2..+2, null = indisponible. */
  note: number | null;
  /** « F&G 72 (+1) » — affiché dans le title de la pastille et le détail BRIEF. */
  detail: string;
}

export type LibelleRegime =
  | "risk-on tendu"
  | "risk-on"
  | "neutre"
  | "risk-off"
  | "risk-off marqué"
  | "indéterminé";

export interface Regime {
  /** Moyenne des notes disponibles (0 si aucune). */
  score: number;
  libelle: LibelleRegime;
  composants: ComposantRegime[];
}

/** Sous ce nombre de composants disponibles, le score serait du bruit. */
const MIN_COMPOSANTS = 3;

function fmtNote(note: number): string {
  return note >= 0 ? `+${note}` : `${note}`;
}

export function calculerRegime(entrees: EntreesRegime): Regime {
  const composants: ComposantRegime[] = [];

  {
    const v = entrees.directionBtc24hPct;
    let note: number | null = null;
    if (v !== null && Number.isFinite(v)) {
      note = v >= 3 ? 2 : v >= 1 ? 1 : v > -1 ? 0 : v > -3 ? -1 : -2;
    }
    composants.push({
      id: "btc24h",
      libelle: "BTC 24 h",
      note,
      detail: note === null ? "BTC 24 h —" : `BTC 24 h ${v !== null && v >= 0 ? "+" : ""}${v?.toFixed(1)}% (${fmtNote(note)})`,
    });
  }
  {
    const v = entrees.fearGreed;
    let note: number | null = null;
    if (v !== null && Number.isFinite(v)) {
      note = v >= 75 ? 2 : v >= 60 ? 1 : v >= 40 ? 0 : v >= 25 ? -1 : -2;
    }
    composants.push({
      id: "fearGreed",
      libelle: "Fear & Greed",
      note,
      detail: note === null ? "F&G —" : `F&G ${Math.round(v ?? 0)} (${fmtNote(note)})`,
    });
  }
  {
    const p = entrees.fundingBtcPercentile;
    let note: number | null = null;
    if (p !== null && Number.isFinite(p)) {
      // Contrarien léger : funding tendu = positionnement long chargé (risque de purge).
      note = p >= 90 ? -1 : p <= 10 ? 1 : 0;
    }
    composants.push({
      id: "funding",
      libelle: "Funding BTC",
      note,
      detail: note === null ? "funding —" : `funding p${Math.round(p ?? 0)} (${fmtNote(note)})`,
    });
  }
  {
    const p = entrees.dvolBtcPercentile;
    let note: number | null = null;
    if (p !== null && Number.isFinite(p)) {
      note = p < 50 ? 1 : p <= 85 ? 0 : -2;
    }
    composants.push({
      id: "dvol",
      libelle: "DVOL BTC",
      note,
      detail: note === null ? "vol —" : `vol p${Math.round(p ?? 0)} (${fmtNote(note)})`,
    });
  }
  {
    // Vol RÉALISÉE : pendant constaté du DVOL (implicite). Mêmes paliers que
    // `dvol` À DESSEIN — deux notes de volatilité doivent rester commensurables ;
    // des seuils asymétriques seraient un arbitrage caché dans le score.
    //
    // Conséquence de pondération ASSUMÉE : la volatilité pèse 2 notes
    // sur 8 (25 % du score), et les deux sont corrélées —
    // en régime de stress elles chargent le score dans le même sens. C'est le
    // comportement voulu (vol implicite ET réalisée élevées = environnement
    // réellement hostile), mais toute relecture historique de la pastille doit
    // en tenir compte.
    const p = entrees.volRealiseeBtcPercentile;
    let note: number | null = null;
    if (p !== null && Number.isFinite(p)) {
      note = p < 50 ? 1 : p <= 85 ? 0 : -2;
    }
    composants.push({
      id: "volRealisee",
      libelle: "Vol réalisée BTC",
      note,
      detail: note === null ? "vol réal. —" : `vol réal. p${Math.round(p ?? 0)} (${fmtNote(note)})`,
    });
  }
  {
    const v = entrees.fluxEtfJourUsd;
    let note: number | null = null;
    if (v !== null && Number.isFinite(v)) {
      note = v > 50_000_000 ? 1 : v < -50_000_000 ? -1 : 0;
    }
    composants.push({
      id: "etf",
      libelle: "Flux ETF veille",
      note,
      detail: note === null ? "ETF —" : `ETF ${formatUsdSigne(v)} (${fmtNote(note)})`,
    });
  }
  {
    const v = entrees.impressionStablecoins7jPct;
    let note: number | null = null;
    if (v !== null && Number.isFinite(v)) {
      note = v > 0.5 ? 1 : v < -0.5 ? -1 : 0;
    }
    composants.push({
      id: "stables",
      libelle: "Impression stablecoins 7 j",
      note,
      detail: note === null ? "stables —" : `stables ${v !== null && v >= 0 ? "+" : ""}${v?.toFixed(2)}% 7j (${fmtNote(note)})`,
    });
  }
  {
    // Gamma dealers BTC (verdict OMON v2.6, toutes échéances) : la note DÉCRIT
    // l'environnement de MOUVEMENT induit par la couverture des dealers, sous
    // l'hypothèse retail standard (dealers long les calls, short les puts).
    // Long gamma → couverture contra-tendance → mouvements amortis : +1 (même
    // philosophie que dvol/vol réalisée : environnement calme = note positive).
    // Short gamma → couverture pro-tendance → mouvements amplifiés : −1.
    // Indéterminé (net trop faible) → 0. Pas de ±2 : sans référentiel historique
    // du GEX net, aucune gradation d'intensité n'est défendable.
    // NOTE (revue Lot 3) : « indéterminé » est une note 0 DISPONIBLE — elle
    // compte donc pour MIN_COMPOSANTS, comme les autres équilibres mesurés
    // (funding p50 → 0, ETF plat → 0) : un équilibre observé n'est pas une
    // absence de donnée. Interaction testée (regime.test.ts, cas frontière).
    const g = entrees.regimeGammaBtc;
    let note: number | null = null;
    if (g !== null) {
      note = g.regime === "long-gamma" ? 1 : g.regime === "short-gamma" ? -1 : 0;
    }
    const nomRegime =
      g === null
        ? ""
        : g.regime === "long-gamma"
          ? "long"
          : g.regime === "short-gamma"
            ? "short"
            : "indéterminé";
    composants.push({
      id: "gammaDealer",
      libelle: "Gamma dealers BTC",
      note,
      detail:
        note === null || g === null
          ? "γ dealers —"
          : `γ dealers ${nomRegime} (net ${formatUsdSigne(g.gexNetUsd)}) (${fmtNote(note)})`,
    });
  }

  const notes = composants.map((c) => c.note).filter((n): n is number => n !== null);
  const score = notes.length > 0 ? notes.reduce((s, n) => s + n, 0) / notes.length : 0;
  let libelle: LibelleRegime;
  if (notes.length < MIN_COMPOSANTS) libelle = "indéterminé";
  else if (score >= 1.2) libelle = "risk-on tendu";
  else if (score >= 0.4) libelle = "risk-on";
  else if (score > -0.4) libelle = "neutre";
  else if (score > -1.2) libelle = "risk-off";
  else libelle = "risk-off marqué";

  return { score, libelle, composants };
}

/** Ton d'affichage de la pastille (le composant funding en warn vit dans le détail). */
export function tonRegime(libelle: LibelleRegime): "up" | "down" | "neutre" {
  if (libelle === "risk-on" || libelle === "risk-on tendu") return "up";
  if (libelle === "risk-off" || libelle === "risk-off marqué") return "down";
  return "neutre";
}
