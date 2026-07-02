/**
 * Panneau « Produits dérivés » — dockable à droite, NON MODAL (pas d'overlay).
 *
 * Contrairement à un slide-over modal, ce panneau ne capture PAS les clics : le graphe
 * reste interactif pendant qu'on surveille OI/funding. Ouverture via le bouton de la
 * Toolbar ou le mnémonique DES (toggle). Le polling reste conditionné à l'ouverture.
 *
 * Affiche, pour le symbole courant (mappé sur le perpétuel Binance Coinalyze) :
 * Open Interest, Funding rate, Long/Short ratio et les liquidations récentes.
 * Source : provider Coinalyze (tier gratuit). Rafraîchissement périodique
 * uniquement quand la fenêtre est ouverte (~1 min, conforme au débit 40 req/min).
 *
 * Sans clé API : aucun appel, aucune erreur bloquante — la fenêtre invite à
 * saisir une clé dans les Réglages (stockée localement, jamais loggée).
 */
import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import type { FundingRate, Liquidation, LongShortRatio, OpenInterest } from "@axiom/types";
import { marketStore } from "../store/market";
import { coinalyzeKeyStore } from "../store/coinalyze";
import { settingsUiStore } from "../store/settings-ui";
import { derivativesUiStore } from "../store/derivatives-ui";
import {
  CoinalyzeError,
  coinalyzeProvider,
  fetchLongShortRatioHistory,
  fetchPredictedFundingRate,
  groupLiquidationBuckets,
  toCoinalyzeSymbol,
  type LiquidationBucket,
} from "../data/coinalyze";
import {
  fetchGlobalLongShortAccountRatio,
  fetchOpenInterestHist,
  fetchTakerLongShortRatio,
  fetchTopLongShortPositionRatio,
  type BinanceOiHistPoint,
  type BinanceRatioPoint,
  type BinanceTakerPoint,
} from "../data/binanceFutures";

/** Période d'agrégation du long/short ratio et fenêtre des liquidations affichées. */
const LS_PERIOD = "5min";
const LIQ_WINDOW_MS = 60 * 60 * 1000; // 1 h de liquidations récentes.
const REFRESH_MS = 60_000; // ~1 min (respecte le rate-limit).
const MAX_LIQ_ROWS = 8;
/** Fenêtre des sparklines OI/funding (tendance récente, pas l'historique complet du chart). */
const SPARK_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 h à 5 min ≈ 24 points.
/** Libellé humain de l'intervalle d'agrégation des liquidations (affiché dans l'étiquette). */
const LIQ_INTERVAL_LABEL = "5 min";
/** Sentiment perp Binance (fapi, SANS clé) : période d'agrégation et profondeur des sparklines. */
const BIN_PERIOD = "5m" as const;
const BIN_LIMIT = 30;
/** Nombre de buckets de liquidations affichés dans le mini-histogramme bicolore. */
const LIQ_BARS = 24;

/** Formatte un notionnel USD de façon compacte ($1.23B / $4.5M / $678K). */
function formatUsd(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

/** Funding rate (fraction) -> pourcentage signé. */
function formatFunding(rate: number | undefined): string {
  if (rate === undefined || !Number.isFinite(rate)) return "—";
  const pct = rate * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(4)}%`;
}

/** HH:MM:SS local d'un horodatage ms. */
function formatTime(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleTimeString("fr-FR", { hour12: false });
}

/** Ratio long/short (ex. 1.87) sur 2 décimales. */
function formatRatio(r: number | undefined): string {
  return r !== undefined && Number.isFinite(r) ? r.toFixed(2) : "—";
}

/** Ratio L/S + part longue (« 1.87 · L 65% ») d'un point Binance (longAccount = fraction). */
function formatRatioBreakdown(p: BinanceRatioPoint | undefined): string {
  if (!p || !Number.isFinite(p.ratio)) return "—";
  return `${p.ratio.toFixed(2)} · L ${(p.longAccount * 100).toFixed(0)}%`;
}

/** Délai « dans 3 h 12 » jusqu'à un horodatage futur (heure du prochain règlement). */
function formatDelai(targetMs: number, nowMs: number): string {
  const diff = targetMs - nowMs;
  if (!Number.isFinite(diff) || diff <= 0) return "imminent";
  const totalMin = Math.round(diff / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `dans ${h} h ${String(m).padStart(2, "0")}` : `dans ${m} min`;
}

/** Une ligne « libellé / valeur », avec sparkline optionnelle de tendance récente. */
function Metric({
  label,
  value,
  color,
  sparkValues,
}: {
  label: string;
  value: string;
  color?: string;
  sparkValues?: number[];
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 rounded-md border border-border bg-bg px-3 py-2">
      <span className="text-[11px] text-text-dim">{label}</span>
      <span className="flex items-center gap-2">
        {sparkValues && sparkValues.length >= 2 && <Sparkline values={sparkValues} color={color ?? "#9ca3af"} />}
        <span className="tabular-nums text-sm font-medium text-text" style={color ? { color } : undefined}>
          {value}
        </span>
      </span>
    </div>
  );
}

/** Mini-courbe de tendance récente (SVG inline, sans dépendance). */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  const width = 64;
  const height = 20;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1; // plage plate (toutes valeurs égales) → ligne médiane
  const step = width / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / span) * height).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={width} height={height} className="shrink-0" aria-hidden="true">
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.2} strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Mini-histogramme BICOLORE divergent des liquidations par bucket : longs liquidés
 * vers le HAUT (rouge), shorts liquidés vers le BAS (vert), normalisés au plus gros
 * bucket affiché. Cohérent avec le code couleur de la table (long=rouge, short=vert).
 */
function LiquidationBars({ buckets }: { buckets: LiquidationBucket[] }) {
  const width = 372;
  const height = 48;
  const mid = height / 2;
  const shown = buckets.slice(-LIQ_BARS);
  const max = Math.max(1, ...shown.map((b) => Math.max(b.longUsd, b.shortUsd)));
  const step = width / Math.max(shown.length, 1);
  const barW = Math.max(1, step - 1.5);
  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className="block text-text-dim"
    >
      <line x1={0} y1={mid} x2={width} y2={mid} stroke="currentColor" strokeOpacity={0.2} />
      {shown.map((b, i) => {
        const x = i * step;
        const longH = (b.longUsd / max) * (mid - 1);
        const shortH = (b.shortUsd / max) * (mid - 1);
        return (
          <g key={b.time}>
            {longH > 0 && <rect x={x} y={mid - longH} width={barW} height={longH} fill="#f87171" />}
            {shortH > 0 && <rect x={x} y={mid} width={barW} height={shortH} fill="#34d399" />}
          </g>
        );
      })}
    </svg>
  );
}

export function DerivativesWindow() {
  const open = useStore(derivativesUiStore, (s) => s.open);
  const closeDerivatives = useStore(derivativesUiStore, (s) => s.closeDerivatives);
  const exchange = useStore(marketStore, (s) => s.exchange);
  const symbol = useStore(marketStore, (s) => s.symbol);
  const hasKey = useStore(coinalyzeKeyStore, (s) => s.hasKey);
  const openSettings = useStore(settingsUiStore, (s) => s.openSettings);

  const [oi, setOi] = useState<OpenInterest | undefined>();
  const [funding, setFunding] = useState<FundingRate | undefined>();
  const [predicted, setPredicted] = useState<FundingRate | undefined>();
  const [ls, setLs] = useState<LongShortRatio | undefined>();
  const [lsSpark, setLsSpark] = useState<number[]>([]);
  const [liqs, setLiqs] = useState<Liquidation[]>([]);
  const [oiSpark, setOiSpark] = useState<number[]>([]);
  const [fundingSpark, setFundingSpark] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Sentiment perpétuel Binance (fapi /futures/data) — SANS clé Coinalyze : visible
  // même sans clé. Chaque tableau reste vide si la source est indisponible (dégradation).
  const [globalLs, setGlobalLs] = useState<BinanceRatioPoint[]>([]);
  const [topLs, setTopLs] = useState<BinanceRatioPoint[]>([]);
  const [taker, setTaker] = useState<BinanceTakerPoint[]>([]);
  const [binOi, setBinOi] = useState<BinanceOiHistPoint[]>([]);

  // Coinalyze mappe le symbole sur un perpétuel : pertinent uniquement pour Binance (M6).
  const isBinance = exchange === "binance";
  const coinalyzeSymbol = isBinance ? toCoinalyzeSymbol(symbol) : "—";

  // Panneau NON MODAL : pas de capture de focus ni d'Échap global (le graphe reste
  // pilotable au clavier). Fermeture via ✕, le bouton de la Toolbar ou le mnémonique DES.

  useEffect(() => {
    // Fenêtre fermée, hors Binance ou sans clé : aucun appel Coinalyze.
    if (!open || !hasKey || !isBinance) {
      setOi(undefined);
      setFunding(undefined);
      setPredicted(undefined);
      setLs(undefined);
      setLsSpark([]);
      setLiqs([]);
      setOiSpark([]);
      setFundingSpark([]);
      setError(null);
      setLoading(false);
      return;
    }

    // Garde LOCALE à cet effet : empêche un setState après fermeture/changement de symbole/clé.
    let ignore = false;

    const load = async () => {
      setLoading(true);
      const results = await Promise.allSettled([
        coinalyzeProvider.fetchOpenInterest(symbol),
        coinalyzeProvider.fetchFundingRate(symbol),
        coinalyzeProvider.fetchLongShortRatio(symbol, LS_PERIOD),
        coinalyzeProvider.fetchLiquidations(symbol, Date.now() - LIQ_WINDOW_MS),
        coinalyzeProvider.fetchOpenInterestHistory(symbol, LS_PERIOD, Date.now() - SPARK_WINDOW_MS),
        coinalyzeProvider.fetchFundingRateHistory(symbol, LS_PERIOD, Date.now() - SPARK_WINDOW_MS),
        fetchPredictedFundingRate(symbol),
        fetchLongShortRatioHistory(symbol, LS_PERIOD, Date.now() - SPARK_WINDOW_MS),
      ]);
      if (ignore) return;

      const [oiR, fR, lsR, liqR, oiHistR, fundingHistR, predR, lsHistR] = results;
      let authError = false;
      const noteError = (r: PromiseSettledResult<unknown>) => {
        if (r.status === "rejected" && r.reason instanceof CoinalyzeError && r.reason.status === 401) {
          authError = true;
        }
      };
      results.forEach(noteError);

      setOi(oiR.status === "fulfilled" ? oiR.value : undefined);
      setFunding(fR.status === "fulfilled" ? fR.value : undefined);
      setLs(lsR.status === "fulfilled" ? lsR.value : undefined);
      setLiqs(liqR.status === "fulfilled" ? liqR.value : []);
      setOiSpark(
        oiHistR.status === "fulfilled" ? oiHistR.value.map((p) => p.oiUsd).filter(Number.isFinite) : []
      );
      setFundingSpark(
        fundingHistR.status === "fulfilled" ? fundingHistR.value.map((p) => p.rate).filter(Number.isFinite) : []
      );
      setPredicted(predR.status === "fulfilled" ? predR.value : undefined);
      setLsSpark(
        lsHistR.status === "fulfilled" ? lsHistR.value.map((p) => p.ratio).filter(Number.isFinite) : []
      );

      const allFailed = results.every((r) => r.status === "rejected");
      if (authError) setError("Clé Coinalyze refusée (401). Vérifiez la clé.");
      else if (allFailed) setError("Données dérivées indisponibles pour le moment.");
      else setError(null);

      setLoading(false);
    };

    void load();
    const timer = setInterval(load, REFRESH_MS);

    return () => {
      ignore = true;
      clearInterval(timer);
    };
  }, [open, symbol, hasKey, isBinance]);

  // Sentiment perpétuel Binance (fapi /futures/data) — effet SÉPARÉ, SANS clé Coinalyze :
  // reste alimenté même si l'utilisateur n'a pas de clé (dégradation indépendante).
  useEffect(() => {
    if (!open || !isBinance) {
      setGlobalLs([]);
      setTopLs([]);
      setTaker([]);
      setBinOi([]);
      return;
    }
    let ignore = false;
    const load = async () => {
      const [gR, tR, tkR, oiR] = await Promise.allSettled([
        fetchGlobalLongShortAccountRatio(symbol, BIN_PERIOD, BIN_LIMIT),
        fetchTopLongShortPositionRatio(symbol, BIN_PERIOD, BIN_LIMIT),
        fetchTakerLongShortRatio(symbol, BIN_PERIOD, BIN_LIMIT),
        fetchOpenInterestHist(symbol, BIN_PERIOD, BIN_LIMIT),
      ]);
      if (ignore) return;
      setGlobalLs(gR.status === "fulfilled" ? gR.value : []);
      setTopLs(tR.status === "fulfilled" ? tR.value : []);
      setTaker(tkR.status === "fulfilled" ? tkR.value : []);
      setBinOi(oiR.status === "fulfilled" ? oiR.value : []);
    };
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      ignore = true;
      clearInterval(timer);
    };
  }, [open, symbol, isBinance]);

  const recentLiqs = liqs.slice(-MAX_LIQ_ROWS).reverse();
  // Buckets long/short pour l'histogramme bicolore (dérivés des liquidations déjà chargées).
  const liqBuckets = useMemo(() => groupLiquidationBuckets(liqs), [liqs]);
  const totalLongLiq = liqBuckets.reduce((s, b) => s + b.longUsd, 0);
  const totalShortLiq = liqBuckets.reduce((s, b) => s + b.shortUsd, 0);

  // Sparklines du sentiment perp Binance (dérivées légères, ≤ 30 pts, sans mémo).
  const globalLsSpark = globalLs.map((p) => p.ratio);
  const topLsSpark = topLs.map((p) => p.ratio);
  const takerSpark = taker.map((p) => p.buySellRatio);
  const binOiSpark = binOi.map((p) => p.oiUsd);
  const lastTaker = taker.at(-1);
  const hasBinanceSentiment =
    globalLs.length > 0 || topLs.length > 0 || taker.length > 0 || binOi.length > 0;

  const openSettingsFromWindow = () => {
    closeDerivatives();
    openSettings();
  };

  return (
    // Panneau dockable à droite, NON MODAL : aucun overlay plein écran ne capture les
    // clics. Fermé, il est translaté hors écran et rendu inerte (pointer-events-none)
    // pour laisser toute la surface du graphe cliquable. z-40 : sous la palette (z-60)
    // et le slide-over Réglages (z-50), au-dessus du graphe.
    <aside
      role="complementary"
      aria-label="Produits dérivés"
      aria-hidden={!open}
      className={`fixed right-0 top-0 z-40 flex h-full w-[min(420px,92vw)] flex-col border-l border-border bg-surface shadow-2xl transition-transform duration-200 ${
        open ? "translate-x-0" : "pointer-events-none translate-x-full"
      }`}
    >
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-text">Produits dérivés</h2>
            <p className="mt-0.5 text-[11px] text-text-dim">
              {isBinance ? `${coinalyzeSymbol} · Coinalyze` : "Coinalyze · Binance uniquement"}
            </p>
          </div>
          <button
            type="button"
            onClick={closeDerivatives}
            aria-label="Fermer les produits dérivés"
            className="rounded p-1 text-lg leading-none text-text-dim transition hover:bg-bg hover:text-text"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {!isBinance ? (
            <div className="rounded-md border border-border bg-bg px-3 py-3 text-xs leading-snug text-text-dim">
              Binance uniquement — Open Interest, funding, long/short et liquidations ne sont disponibles que
              pour la source Binance.
            </div>
          ) : !hasKey ? (
            <div className="space-y-3 rounded-md border border-border bg-bg px-3 py-3 text-xs text-text-dim">
              <p className="leading-snug">
                Ajoutez une clé Coinalyze pour afficher Open Interest, funding, long/short et liquidations.
              </p>
              <button
                type="button"
                onClick={openSettingsFromWindow}
                className="rounded border border-border bg-surface px-2.5 py-1.5 text-[11px] text-text-dim transition hover:text-text"
              >
                Configurer dans Réglages ⚙
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-md border border-border bg-bg px-3 py-2 text-[11px] text-text-dim">
                <span>{coinalyzeSymbol}</span>
                <span>{loading ? "maj…" : "maj ~1 min"}</span>
              </div>

              {error && <div className="rounded-md border border-down/40 px-3 py-2 text-[11px] text-down">{error}</div>}

              <div className="space-y-2">
                <Metric label="Open Interest" value={formatUsd(oi?.oiUsd)} sparkValues={oiSpark} color="#38bdf8" />
                <Metric
                  label="Funding"
                  value={formatFunding(funding?.rate)}
                  sparkValues={fundingSpark}
                  color={
                    funding && Number.isFinite(funding.rate)
                      ? funding.rate >= 0
                        ? "#34d399"
                        : "#f87171"
                      : undefined
                  }
                />
                {predicted && Number.isFinite(predicted.rate) && (
                  <div className="rounded-md border border-border bg-bg px-3 py-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[11px] text-text-dim">Funding prédit</span>
                      <span
                        className="tabular-nums text-sm font-medium"
                        style={{ color: predicted.rate >= 0 ? "#34d399" : "#f87171" }}
                      >
                        {formatFunding(predicted.rate)}
                      </span>
                    </div>
                    <div className="mt-0.5 text-right text-[10px] text-text-dim">
                      prochain règlement (~8 h) {formatDelai(predicted.nextFundingTime, Date.now())} ·{" "}
                      {formatTime(predicted.nextFundingTime)}
                    </div>
                  </div>
                )}
                <Metric
                  label="Long / Short agrégé"
                  value={
                    ls && Number.isFinite(ls.ratio)
                      ? `${ls.ratio.toFixed(2)} · L ${ls.longAccount.toFixed(1)}% / S ${ls.shortAccount.toFixed(1)}%`
                      : "—"
                  }
                  sparkValues={lsSpark}
                  color="#a78bfa"
                />
              </div>

              <section className="rounded-md border border-border bg-bg">
                <div className="border-b border-border px-3 py-2 text-[11px] font-medium text-text-dim">
                  Liquidations récentes
                </div>
                {liqBuckets.length > 0 && (
                  <div className="border-b border-border px-3 py-2">
                    <div className="mb-1 flex items-baseline justify-between text-[11px]">
                      <span className="tabular-nums" style={{ color: "#f87171" }}>
                        Longs {formatUsd(totalLongLiq)}
                      </span>
                      <span className="tabular-nums" style={{ color: "#34d399" }}>
                        Shorts {formatUsd(totalShortLiq)}
                      </span>
                    </div>
                    <LiquidationBars buckets={liqBuckets} />
                  </div>
                )}
                <div className="max-h-60 overflow-y-auto">
                  {recentLiqs.length === 0 ? (
                    <div className="px-3 py-2 text-[11px] text-text-dim">Aucune sur la dernière heure.</div>
                  ) : (
                    recentLiqs.map((l, i) => (
                      <div
                        key={`${l.time}-${l.side}-${i}`}
                        className="grid grid-cols-[1fr_auto_1fr] items-baseline gap-3 px-3 py-1.5 text-[11px]"
                      >
                        <span className="tabular-nums text-text-dim">{formatTime(l.time)}</span>
                        <span
                          className="font-medium uppercase"
                          style={{ color: l.side === "long" ? "#f87171" : "#34d399" }}
                        >
                          {l.side}
                        </span>
                        <span className="text-right tabular-nums text-text">{formatUsd(l.qtyUsd)}</span>
                      </div>
                    ))
                  )}
                </div>
                <p className="border-t border-border px-3 py-2 text-[10px] leading-snug text-text-dim">
                  Liquidations échantillonnées / cumul approx. — Coinalyze agrège par intervalle
                  ({LIQ_INTERVAL_LABEL}) ; pas d'événements unitaires ni de prix.
                </p>
              </section>
            </div>
          )}

          {/* Sentiment perpétuel Binance — indépendant de la clé Coinalyze (fapi public).
              Affiché dès que la source est Binance ET qu'au moins un flux répond. */}
          {isBinance && hasBinanceSentiment && (
            <section className="mt-3 space-y-2">
              <div className="flex items-center justify-between px-1 text-[11px] font-medium text-text-dim">
                <span>Sentiment perp · Binance</span>
                <span className="text-[10px]">sans clé · {BIN_PERIOD}</span>
              </div>
              <Metric
                label="Comptes globaux L/S"
                value={formatRatioBreakdown(globalLs.at(-1))}
                sparkValues={globalLsSpark}
                color="#60a5fa"
              />
              <Metric
                label="Top traders L/S"
                value={formatRatioBreakdown(topLs.at(-1))}
                sparkValues={topLsSpark}
                color="#f472b6"
              />
              <Metric
                label="Taker achat / vente"
                value={formatRatio(lastTaker?.buySellRatio)}
                sparkValues={takerSpark}
                color={lastTaker && lastTaker.buySellRatio >= 1 ? "#34d399" : "#f87171"}
              />
              <Metric
                label="Open Interest"
                value={formatUsd(binOi.at(-1)?.oiUsd)}
                sparkValues={binOiSpark}
                color="#22d3ee"
              />
            </section>
          )}
        </div>
    </aside>
  );
}
