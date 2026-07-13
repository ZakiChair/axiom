/**
 * Catalogue central de fiabilité des sources de données (doctrine doc 02).
 *
 * Toute métrique 🟡/🔴 doit afficher un badge honnête : jamais présenter un
 * flux dégradé, throttlé ou un modèle comme un fait. Ce module est la source
 * unique des labels ; les fenêtres consomment `metaSource(id)` + `BadgeFiabilite`.
 *
 * Niveaux (alignés sur la légende doc 02) :
 *  - fiable      🟢 donnée publique complète et exacte en gratuit
 *  - partiel     🟡 gratuit mais dégradé (latence, rate-limit, daily…)
 *  - estimation  🔴 modèle / flux structurellement incomplet (sous-estimé)
 *  - indisponible  source inconnue ou non câblée
 */

/** Niveau de fiabilité affiché à côté d'une métrique. */
export type NiveauFiabilite = "fiable" | "partiel" | "estimation" | "indisponible";

/** Métadonnées UI d'une source (badge court + tooltip long). */
export interface MetaFiabilite {
  niveau: NiveauFiabilite;
  /** Court label UI, ex. « ≤1 min · Coinalyze ». */
  label: string;
  /** Tooltip long (détail honnête de la dégradation). */
  detail?: string;
}

/**
 * Catalogue des sources connues (DES, liq, funding, on-chain…).
 * Clés stables consommées par les fenêtres ; étendre ici plutôt que de
 * recréer des tags locaux.
 */
const CATALOGUE: Record<string, MetaFiabilite> = {
  // ─── Dérivés Coinalyze (latence ≤ 1 min, gratuit 40 req/min) ─────────────
  "coinalyze:oi": {
    niveau: "partiel",
    label: "≤1 min · Coinalyze",
    detail: "Open Interest pollé via Coinalyze (latence fournisseur ≤ 1 min, 40 req/min).",
  },
  "coinalyze:liq": {
    niveau: "partiel",
    label: "≤1 min · Coinalyze",
    detail:
      "Liquidations agrégées Coinalyze (latence ≤ 1 min). Préférer ce flux aux cumuls forceOrder.",
  },
  "coinalyze:funding": {
    niveau: "partiel",
    label: "≤1 min · Coinalyze",
    detail: "Funding history Coinalyze (latence ≤ 1 min).",
  },
  "coinalyze:ls": {
    niveau: "partiel",
    label: "≤1 min · Coinalyze",
    detail: "Long/Short ratio Coinalyze (latence ≤ 1 min).",
  },

  // ─── Liquidations Binance forceOrder (throttlé → sous-estimé) ────────────
  "binance:forceOrder": {
    niveau: "estimation",
    label: "flux throttlé (sous-estimé)",
    detail:
      "WS @forceOrder Binance : 1 ordre max / 1000 ms (le plus gros). Tout cumul/heatmap est sous-compté — animation de bulles seulement.",
  },

  // ─── Funding live (cas FIABLE en gratuit) ────────────────────────────────
  "funding:ws": {
    niveau: "fiable",
    label: "WS live · Binance",
    detail: "Funding via WS !markPrice@arr (tous symboles, ~1 push/s) — dérivé le plus propre en gratuit.",
  },
  "binance:funding": {
    niveau: "fiable",
    label: "WS live · Binance",
    detail: "Funding Binance mark price stream — live et complet.",
  },
  "binance:mark": {
    niveau: "fiable",
    label: "fapi mark 1h · Binance",
    detail:
      "Mark price perp via markPriceKlines (1 h, public). Sert le basis spot-perp % (mark vs close chart).",
  },

  // ─── On-chain community / daily ──────────────────────────────────────────
  "coinmetrics:nvt": {
    niveau: "partiel",
    label: "daily · Coin Metrics",
    detail: "NVT via Coin Metrics Community API (séries daily, sans clé).",
  },
  "coinmetrics": {
    niveau: "partiel",
    label: "daily · Coin Metrics",
    detail: "Métriques asset community Coin Metrics (daily).",
  },
  "bgeometrics:mvrv": {
    niveau: "partiel",
    label: "daily · BGeometrics",
    detail: "MVRV Z-Score via bitcoin-data.com / BGeometrics (daily, clé optionnelle).",
  },
  "bgeometrics": {
    niveau: "partiel",
    label: "daily · BGeometrics",
    detail: "Métriques BGeometrics / bitcoin-data.com (daily).",
  },

  // ─── Flux marché directs (référence) ─────────────────────────────────────
  "binance:trades": {
    niveau: "fiable",
    label: "WS live · aggTrade",
    detail: "Flux @aggTrade Binance — tick-level, fiable pour CVD/footprint.",
  },
  "binance:kline": {
    niveau: "fiable",
    label: "WS live · kline",
    detail: "Flux kline Binance + backfill REST.",
  },

  // ─── Screener positionnement (OI Δ% / L-S, échantillon top N) ─────────────
  "binance:futures:position": {
    niveau: "partiel",
    label: "échantillon top N · Binance",
    detail:
      "Δ OI et L/S via /futures/data (1 symbole/req, sans clé). Screener EQS : top N liquides seulement — pas d'univers complet en gratuit.",
  },
};

/** Fallback pour toute source non catalogue. */
const INCONNU: MetaFiabilite = {
  niveau: "indisponible",
  label: "source inconnue",
  detail: "Identifiant non présent dans le catalogue de fiabilité.",
};

/**
 * Résout les métadonnées de fiabilité d'une source par id stable.
 * PURE : lookup catalogue, jamais d'I/O.
 */
export function metaSource(id: string): MetaFiabilite {
  return CATALOGUE[id] ?? INCONNU;
}

/** Libellés FR courts du niveau (affichage badge). */
export const LABEL_NIVEAU: Record<NiveauFiabilite, string> = {
  fiable: "fiable",
  partiel: "partiel",
  estimation: "estimation",
  indisponible: "indisponible",
};
