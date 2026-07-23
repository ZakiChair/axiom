/**
 * Radar de squeeze (SQZ) — logique PURE, testable hors navigateur.
 *
 * POURQUOI : synthèse visuelle du positionnement perp de l'univers Signaux dans un
 * plan funding × ΔOI. La sémantique reprend `signalQuadrantOiPrix` (data/signaux.ts,
 * axes Δprix × ΔOI) mais l'adapte aux axes funding × ΔOI :
 *   - funding<0 & OI↑ = les shorts paient ET s'accumulent → carburant à short squeeze ;
 *   - funding>0 & OI↑ = les longs paient ET s'accumulent → longs crowded ;
 *   - funding>0 & OI↓ = les longs se dénouent → dé-leveraging ;
 *   - funding<0 & OI↓ = rachat / couverture de shorts → shorts crowded ;
 *   - sous LES DEUX seuils = neutre (bruit).
 * Aucun fetch ici : les effets réseau vivent dans store/squeeze.ts.
 */

// ─────────────────────────── Types & seuils ───────────────────────────

export type QuadrantSqueeze =
  | "carburant-squeeze"
  | "longs-crowded"
  | "shorts-crowded"
  | "deleveraging"
  | "neutre";

/**
 * |funding| ≤ ce seuil (%/8 h) = axe funding neutre. Comparaison STRICTE (>) : 0.01 %/8 h
 * est le funding PAR DÉFAUT de Binance (perp parfaitement équilibré, très fréquent) — un
 * symbole calme doit rester neutre sur cet axe, pas basculer en « significatif ».
 */
export const SEUIL_FUNDING_PCT = 0.01;
/** |ΔOI| sous ce seuil (%) = axe OI neutre — même seuil que signaux.ts SEUIL_OI_PCT. */
export const SEUIL_DOI_PCT = 3;

/** Rayon (px) des bulles de volume : bornes de lisibilité du scatter. */
export const RAYON_MIN = 3;
export const RAYON_MAX = 16;

/**
 * Classe le couple (funding %/8 h, ΔOI ~24 h %) en quadrant. « neutre » UNIQUEMENT
 * quand les DEUX axes sont sous leur seuil (ET) ; sinon on classe par le signe des
 * deux axes (l'axe négligeable reste porté par son signe). PURE.
 */
export function quadrantFundingOi(fundingPct: number, dOiPct: number): QuadrantSqueeze {
  if (!Number.isFinite(fundingPct) || !Number.isFinite(dOiPct)) return "neutre";
  const fundingSignif = Math.abs(fundingPct) > SEUIL_FUNDING_PCT;
  const oiSignif = Math.abs(dOiPct) >= SEUIL_DOI_PCT;
  if (!fundingSignif && !oiSignif) return "neutre";

  const oiHausse = dOiPct > 0;
  const fundingPositif = fundingPct > 0;
  if (oiHausse) return fundingPositif ? "longs-crowded" : "carburant-squeeze";
  return fundingPositif ? "deleveraging" : "shorts-crowded";
}

// ─────────────────────────── Points du radar ───────────────────────────

export interface PointRadar {
  symbol: string;
  fundingPct: number;
  dOiPct: number;
  volumeUsd24h: number;
  quadrant: QuadrantSqueeze;
}

/** Entrée brute d'un symbole avant projection : funding et ΔOI peuvent manquer. */
export interface EntreeRadar {
  symbol: string;
  fundingPct?: number;
  dOiPct?: number;
  volumeUsd24h: number;
}

/**
 * Construit les points du radar : exclut toute ligne sans funding OU sans ΔOI (ou non
 * finis) — un point n'existe que si ses deux coordonnées existent — et calcule son
 * quadrant. PURE.
 */
export function construirePoints(rows: readonly EntreeRadar[]): PointRadar[] {
  const out: PointRadar[] = [];
  for (const r of rows) {
    if (r.fundingPct === undefined || r.dOiPct === undefined) continue;
    if (!Number.isFinite(r.fundingPct) || !Number.isFinite(r.dOiPct)) continue;
    out.push({
      symbol: r.symbol,
      fundingPct: r.fundingPct,
      dOiPct: r.dOiPct,
      volumeUsd24h: r.volumeUsd24h,
      quadrant: quadrantFundingOi(r.fundingPct, r.dOiPct),
    });
  }
  return out;
}

/**
 * Rayon d'une bulle ∝ √(volume / volumeMax), borné [RAYON_MIN, RAYON_MAX]. La racine
 * mappe l'AIRE au volume (perception visuelle correcte). Volume nul/absent ou base nulle
 * → RAYON_MIN. PURE.
 */
export function rayonPoint(volumeUsd24h: number, volumeMax: number): number {
  if (!(volumeMax > 0) || !Number.isFinite(volumeUsd24h) || volumeUsd24h <= 0) return RAYON_MIN;
  const r = RAYON_MAX * Math.sqrt(volumeUsd24h / volumeMax);
  return Math.min(RAYON_MAX, Math.max(RAYON_MIN, r));
}

/**
 * Index du point le plus proche de (px, py) dans le rayon de `capture` (distance
 * euclidienne, ≤ capture). -1 si aucun point dans le rayon ou liste vide. PURE.
 */
export function plusProchePoint(
  points: readonly { x: number; y: number }[],
  px: number,
  py: number,
  capture: number,
): number {
  let best = -1;
  let bestD2 = capture * capture;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p === undefined) continue;
    const dx = p.x - px;
    const dy = p.y - py;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  return best;
}

// ─────────────────────────── Fusion des sources (run) ───────────────────────────

/**
 * Fusionne l'échantillon (volumes du ticker 24 h) avec le funding par symbole et le
 * ΔOI par symbole en entrées de `construirePoints`. Un symbole absent d'une source
 * porte un champ `undefined` — `construirePoints` l'exclura. PURE (le fetch vit dans
 * store/squeeze.ts). Placée ici plutôt que dans le store pour rester testable sans
 * tirer le graphe de dépendances chart (cf. mapPool → navigation).
 */
export function fusionnerSources(
  tickers: readonly { symbol: string; volumeUsd24h: number }[],
  fundingParSymbole: ReadonlyMap<string, number>,
  oiParSymbole: ReadonlyMap<string, number>,
): EntreeRadar[] {
  return tickers.map((t) => ({
    symbol: t.symbol,
    fundingPct: fundingParSymbole.get(t.symbol),
    dOiPct: oiParSymbole.get(t.symbol),
    volumeUsd24h: t.volumeUsd24h,
  }));
}
