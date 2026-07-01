/**
 * Fenêtre « Produits dérivés » — slide-over dédié, hors sidebar.
 *
 * Affiche, pour le symbole courant (mappé sur le perpétuel Binance Coinalyze) :
 * Open Interest, Funding rate, Long/Short ratio et les liquidations récentes.
 * Source : provider Coinalyze (tier gratuit). Rafraîchissement périodique
 * uniquement quand la fenêtre est ouverte (~1 min, conforme au débit 40 req/min).
 *
 * Sans clé API : aucun appel, aucune erreur bloquante — la fenêtre invite à
 * saisir une clé dans les Réglages (stockée localement, jamais loggée).
 */
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { FundingRate, Liquidation, LongShortRatio, OpenInterest } from "@axiom/types";
import { marketStore } from "../store/market";
import { coinalyzeKeyStore } from "../store/coinalyze";
import { settingsUiStore } from "../store/settings-ui";
import { derivativesUiStore } from "../store/derivatives-ui";
import { CoinalyzeError, coinalyzeProvider, toCoinalyzeSymbol } from "../data/coinalyze";

/** Période d'agrégation du long/short ratio et fenêtre des liquidations affichées. */
const LS_PERIOD = "5min";
const LIQ_WINDOW_MS = 60 * 60 * 1000; // 1 h de liquidations récentes.
const REFRESH_MS = 60_000; // ~1 min (respecte le rate-limit).
const MAX_LIQ_ROWS = 8;
/** Fenêtre des sparklines OI/funding (tendance récente, pas l'historique complet du chart). */
const SPARK_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 h à 5 min ≈ 24 points.
/** Libellé humain de l'intervalle d'agrégation des liquidations (affiché dans l'étiquette). */
const LIQ_INTERVAL_LABEL = "5 min";

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

export function DerivativesWindow() {
  const open = useStore(derivativesUiStore, (s) => s.open);
  const closeDerivatives = useStore(derivativesUiStore, (s) => s.closeDerivatives);
  const exchange = useStore(marketStore, (s) => s.exchange);
  const symbol = useStore(marketStore, (s) => s.symbol);
  const hasKey = useStore(coinalyzeKeyStore, (s) => s.hasKey);
  const openSettings = useStore(settingsUiStore, (s) => s.openSettings);

  const panelRef = useRef<HTMLDivElement | null>(null);

  const [oi, setOi] = useState<OpenInterest | undefined>();
  const [funding, setFunding] = useState<FundingRate | undefined>();
  const [ls, setLs] = useState<LongShortRatio | undefined>();
  const [liqs, setLiqs] = useState<Liquidation[]>([]);
  const [oiSpark, setOiSpark] = useState<number[]>([]);
  const [fundingSpark, setFundingSpark] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Coinalyze mappe le symbole sur un perpétuel : pertinent uniquement pour Binance (M6).
  const isBinance = exchange === "binance";
  const coinalyzeSymbol = isBinance ? toCoinalyzeSymbol(symbol) : "—";

  // Échap ferme — écouteur actif UNIQUEMENT quand la fenêtre est ouverte.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDerivatives();
    };
    window.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeDerivatives]);

  useEffect(() => {
    // Fenêtre fermée, hors Binance ou sans clé : aucun appel Coinalyze.
    if (!open || !hasKey || !isBinance) {
      setOi(undefined);
      setFunding(undefined);
      setLs(undefined);
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
      ]);
      if (ignore) return;

      const [oiR, fR, lsR, liqR, oiHistR, fundingHistR] = results;
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

  const recentLiqs = liqs.slice(-MAX_LIQ_ROWS).reverse();

  const openSettingsFromWindow = () => {
    closeDerivatives();
    openSettings();
  };

  return (
    <div
      className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`}
      aria-hidden={!open}
    >
      {/* Overlay (clic = fermeture) — frère du panneau, pas de propagation à gérer. */}
      <div
        onClick={closeDerivatives}
        className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-200 ${
          open ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Fenêtre glissante depuis la droite. */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Produits dérivés"
        tabIndex={-1}
        className={`absolute right-0 top-0 flex h-full w-[min(520px,94vw)] flex-col border-l border-border bg-surface shadow-2xl outline-none transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
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
                <Metric
                  label="Long / Short"
                  value={
                    ls && Number.isFinite(ls.ratio)
                      ? `${ls.ratio.toFixed(2)} · L ${ls.longAccount.toFixed(1)}% / S ${ls.shortAccount.toFixed(1)}%`
                      : "—"
                  }
                />
              </div>

              <section className="rounded-md border border-border bg-bg">
                <div className="border-b border-border px-3 py-2 text-[11px] font-medium text-text-dim">
                  Liquidations récentes
                </div>
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
        </div>
      </div>
    </div>
  );
}
