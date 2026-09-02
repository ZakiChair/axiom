/**
 * Coût d'exécution et déséquilibre du carnet L2 — calculs PURS (aucun I/O).
 *
 * Le DOM reçoit déjà le carnet (`OrderBook`, snapshot 1000 niveaux + diffs). Ce module
 * en tire le coût d'un marché de `notionnelUsd` USD, la profondeur à ±pct du mid, et
 * le déséquilibre I sur N niveaux. Étiquette d'honnêteté : hors frais taker ; un
 * notionnel qui dépasse le carnet reçu n'est JAMAIS extrapolé (`couvert = false`).
 */
import { meilleursNiveaux, type OrderBook } from "./depth";

/** Résultat d'une marche du carnet jusqu'à `notionnelUsd` (ou épuisement). */
export interface ResultatCout {
  prixMoyen: number;
  /** Écart au mid en bps, POSITIF quand défavorable (achat au-dessus / vente en-dessous). */
  slippageBps: number;
  /** Nombre de niveaux touchés (le dernier peut n'être que partiel). */
  niveaux: number;
  quantiteBase: number;
  /** false si le carnet reçu ne couvre pas le notionnel demandé. */
  couvert: boolean;
  notionnelCouvert: number;
  pirePrix: number;
}

/**
 * Marche le carnet (asks pour un achat, bids pour une vente) jusqu'à consommer
 * `notionnelUsd`. `null` si mid indéfini, notionnel non positif, ou côté vide.
 * Fonction PURE.
 */
export function coutExecution(
  livre: OrderBook,
  cote: "achat" | "vente",
  notionnelUsd: number,
): ResultatCout | null {
  if (!(notionnelUsd > 0) || !Number.isFinite(notionnelUsd)) return null;
  const best = meilleursNiveaux(livre);
  if (!best || !(best.mid > 0)) return null;
  const map = cote === "achat" ? livre.asks : livre.bids;
  const niveaux = [...map.entries()]
    .filter(([, qte]) => qte > 0 && Number.isFinite(qte))
    .sort((a, b) => (cote === "achat" ? a[0] - b[0] : b[0] - a[0]));
  if (niveaux.length === 0) return null;

  let restant = notionnelUsd;
  let qty = 0;
  let notional = 0;
  let nLevels = 0;
  let pire = niveaux[0]![0];
  for (const [prix, qte] of niveaux) {
    if (!(prix > 0) || !Number.isFinite(prix)) continue;
    const maxNotional = qte * prix;
    const takeNotional = Math.min(restant, maxNotional);
    qty += takeNotional / prix;
    notional += takeNotional;
    restant -= takeNotional;
    nLevels += 1;
    pire = prix;
    if (restant <= 1e-12) break;
  }
  if (qty <= 0 || nLevels === 0) return null;
  const prixMoyen = notional / qty;
  const defavorable = cote === "achat" ? prixMoyen - best.mid : best.mid - prixMoyen;
  const slippageBps = (defavorable / best.mid) * 10_000;
  return {
    prixMoyen,
    slippageBps,
    niveaux: nLevels,
    quantiteBase: qty,
    couvert: restant <= 1e-12,
    notionnelCouvert: notional,
    pirePrix: pire,
  };
}

/**
 * Notionnel cumulé (USD) disponible à ±`pct` du mid, par côté (bornes inclusives).
 * `null` si mid indéfini. Fonction PURE.
 */
export function profondeurAPct(
  livre: OrderBook,
  pct: number,
): { bidUsd: number; askUsd: number } | null {
  if (!(pct > 0) || !Number.isFinite(pct)) return null;
  const best = meilleursNiveaux(livre);
  if (!best || !(best.mid > 0)) return null;
  const lo = best.mid * (1 - pct);
  const hi = best.mid * (1 + pct);
  let bidUsd = 0;
  for (const [prix, qte] of livre.bids) {
    if (qte > 0 && prix >= lo && prix <= hi) bidUsd += prix * qte;
  }
  let askUsd = 0;
  for (const [prix, qte] of livre.asks) {
    if (qte > 0 && prix >= lo && prix <= hi) askUsd += prix * qte;
  }
  return { bidUsd, askUsd };
}

/**
 * Déséquilibre I = (Σbid − Σask) / (Σbid + Σask) en QUANTITÉ base sur les `n`
 * meilleurs niveaux de chaque côté, ∈ [−1, 1]. `null` si les deux côtés sont vides
 * sur ces n niveaux. Un côté vide → ±1. Quantités ≤ 0 ignorées. Fonction PURE.
 */
export function desequilibre(livre: OrderBook, n: number): number | null {
  if (!(n > 0) || !Number.isFinite(n)) return null;
  const nb = Math.floor(n);
  const bids = [...livre.bids.entries()]
    .filter(([, q]) => q > 0)
    .sort((a, b) => b[0] - a[0])
    .slice(0, nb);
  const asks = [...livre.asks.entries()]
    .filter(([, q]) => q > 0)
    .sort((a, b) => a[0] - b[0])
    .slice(0, nb);
  let sumB = 0;
  for (const [, q] of bids) sumB += q;
  let sumA = 0;
  for (const [, q] of asks) sumA += q;
  const denom = sumB + sumA;
  if (!(denom > 0)) return null;
  return (sumB - sumA) / denom;
}
