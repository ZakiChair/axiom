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
 *
 * Émetteur de symbole de groupe (v1, seule fenêtre à écrire) : le champ symbole de
 * l'en-tête diffuse via `windowManagerStore.setGroupSymbol(groupColor, valeur)` quand
 * la fenêtre est assignée à un groupe de couleur — les autres fenêtres du même groupe
 * (dont cette fenêtre elle-même, via `symbolGroupe`) lisent `groupSymbols[groupColor]`.
 * Désactivé (avec info-bulle) tant qu'aucun groupe n'est assigné.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import type { FundingRate, Liquidation, LongShortRatio, OpenInterest } from "@axiom/types";
import { marketStore } from "../store/market";
import { windowManagerStore } from "../store/windowManager";
import { coinalyzeKeyStore } from "../store/coinalyze";
import { settingsUiStore } from "../store/settings-ui";
import { derivativesUiStore } from "../store/derivatives-ui";
import { derivativesChartStore } from "../store/derivatives-chart";
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
import {
  formatDec,
  formatDelai,
  formatFunding,
  formatHeure,
  formatPct,
  formatUsd,
  VALEUR_ABSENTE,
} from "../lib/format";
import { metaSource } from "../lib/fiabilite";
import { annualiserFunding } from "../data/fundingCrossExchange";
import { histFunding } from "../data/referentiels";
import { referentiel, type Referentiel } from "../lib/referentiel";
import { BadgeFiabilite, EnTeteFenetre, ErreurBloc, Fraicheur, Metric, RefBadge, SansCle, Vide } from "./ui";

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

/** Ratio L/S + part longue (« 1.87 · L 65% ») d'un point Binance (longAccount = fraction). */
function formatRatioBreakdown(p: BinanceRatioPoint | undefined): string {
  if (!p || !Number.isFinite(p.ratio)) return VALEUR_ABSENTE;
  return `${p.ratio.toFixed(2)} · L ${(p.longAccount * 100).toFixed(0)}%`;
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
            {longH > 0 && <rect x={x} y={mid - longH} width={barW} height={longH} fill="var(--down)" />}
            {shortH > 0 && <rect x={x} y={mid} width={barW} height={shortH} fill="var(--up)" />}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Bascule « Afficher sur le chart » d'un sous-pane dérivé (OI / funding). Actif, le
 * bouton prend la COULEUR de la courbe correspondante tracée par chart/derivatives.ts
 * (cyan OI / ambre funding) pour le lien visuel avec le sous-pane.
 */
function ChartToggle({
  label,
  active,
  color,
  onClick,
}: {
  label: string;
  active: boolean;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded border px-2 py-1 text-[11px] font-medium transition ${
        active ? "bg-bg" : "border-border bg-bg text-text-dim hover:text-text"
      }`}
      style={active ? { color, borderColor: color } : undefined}
    >
      {label}
    </button>
  );
}

export function DerivativesWindow() {
  const open = useStore(derivativesUiStore, (s) => s.open);
  const closeDerivatives = useStore(derivativesUiStore, (s) => s.closeDerivatives);
  const exchange = useStore(marketStore, (s) => s.exchange);
  const symbolGlobal = useStore(marketStore, (s) => s.symbol);
  const groupColor = useStore(windowManagerStore, (s) => s.windows["derivatives"]?.groupColor ?? null);
  const symbolGroupe = useStore(windowManagerStore, (s) => (groupColor ? s.groupSymbols[groupColor] : undefined));
  const symbol = symbolGroupe ?? symbolGlobal;
  const hasKey = useStore(coinalyzeKeyStore, (s) => s.hasKey);
  const openSettings = useStore(settingsUiStore, (s) => s.openSettings);

  // Champ symbole de l'en-tête : émet vers `groupSymbols[groupColor]` quand un groupe
  // est assigné (seule fenêtre à écrire en v1, cf. doc de tête). État local pour ne
  // committer qu'au blur/Entrée ; resynchronisé sur `symbol` tant que le champ n'a pas
  // le focus (évite d'écraser une saisie en cours si le symbole change ailleurs).
  const [symbolDraft, setSymbolDraft] = useState(symbol);
  const symbolInputFocused = useRef(false);
  useEffect(() => {
    if (!symbolInputFocused.current) setSymbolDraft(symbol);
  }, [symbol]);

  /** Committe la saisie (normalisée comme PairSearch : trim + majuscules) vers le
   * groupe — no-op si aucun groupe n'est assigné (le champ est alors désactivé). */
  const commitSymbolGroupe = () => {
    symbolInputFocused.current = false;
    if (!groupColor) return;
    const next = symbolDraft.trim().toUpperCase();
    if (next.length === 0) {
      setSymbolDraft(symbol);
      return;
    }
    if (next !== symbol) windowManagerStore.getState().setGroupSymbol(groupColor, next);
  };

  // Sous-panes dérivés sur le graphe (toggles basse fréquence → abonnement React OK,
  // cf. BUILD-CONTRACT : seule la donnée HAUTE fréquence est proscrite du render React).
  const showOiPane = useStore(derivativesChartStore, (s) => s.oi);
  const showFundingPane = useStore(derivativesChartStore, (s) => s.funding);
  const toggleOiPane = useStore(derivativesChartStore, (s) => s.toggleOi);
  const toggleFundingPane = useStore(derivativesChartStore, (s) => s.toggleFunding);

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
  // Référentiel du funding : historique ~90 j (cache 1 h), situe le taux courant.
  const [refFunding, setRefFunding] = useState<Referentiel | null>(null);
  useEffect(() => {
    let vivant = true;
    setRefFunding(null);
    const rate = funding?.rate;
    if (rate === undefined || !Number.isFinite(rate)) return undefined;
    void histFunding(symbol).then((serie) => {
      if (!vivant || serie === null) return;
      setRefFunding(referentiel(serie, rate, Date.now()));
    });
    return () => {
      vivant = false;
    };
  }, [symbol, funding?.rate]);
  // Horodatage du dernier cycle de rafraîchissement Coinalyze : « — » tant qu'aucune
  // donnée n'est arrivée (cohérent avec Options/TermStructure), « maj ~1 min » ensuite.
  const [majTs, setMajTs] = useState<number | null>(null);

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
      setMajTs(null);
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

      setMajTs(Date.now());
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
  const takerColor = lastTaker && lastTaker.buySellRatio >= 1 ? "var(--up)" : "var(--down)";
  const fundingColor =
    funding && Number.isFinite(funding.rate) ? (funding.rate >= 0 ? "var(--up)" : "var(--down)") : undefined;
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
    <>
      <EnTeteFenetre
        mnemo="DES"
        titre="Produits dérivés"
        sousTitre={isBinance ? `${coinalyzeSymbol} · Coinalyze` : "Coinalyze · Binance uniquement"}
        actions={
          <div className="flex flex-col items-end gap-1">
            <label htmlFor="derivatives-symbol-groupe" className="text-[10px] text-text-dim">
              Symbole groupe
            </label>
            <input
              id="derivatives-symbol-groupe"
              type="text"
              value={symbolDraft}
              disabled={!groupColor}
              spellCheck={false}
              autoComplete="off"
              onFocus={() => {
                symbolInputFocused.current = true;
              }}
              onChange={(e) => setSymbolDraft(e.target.value.toUpperCase())}
              onBlur={commitSymbolGroupe}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                else if (e.key === "Escape") {
                  setSymbolDraft(symbol);
                  e.currentTarget.blur();
                }
              }}
              title={
                groupColor
                  ? "Diffuse le symbole aux autres fenêtres du même groupe"
                  : "Assigner un groupe pour lier le symbole"
              }
              aria-label="Symbole du groupe lié"
              className="w-28 rounded border border-border bg-bg px-2 py-1 text-right text-[11px] text-text outline-none placeholder:text-text-dim focus:border-text-dim disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
        }
      />

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {!isBinance ? (
            <Vide>
              Binance uniquement — Open Interest, funding, long/short et liquidations ne sont disponibles que
              pour la source Binance.
            </Vide>
          ) : !hasKey ? (
            <SansCle
              message="Ajoutez une clé Coinalyze pour afficher Open Interest, funding, long/short et liquidations."
              onOuvrirReglages={openSettingsFromWindow}
            />
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-md border border-border bg-bg px-3 py-2 text-[11px] text-text-dim">
                <span>{coinalyzeSymbol}</span>
                <Fraicheur loading={loading} majTs={majTs} cadence="1 min" />
              </div>

              {error && <ErreurBloc>{error}</ErreurBloc>}

              <div className="space-y-2">
                <Metric
                  label="Open Interest"
                  value={formatUsd(oi?.oiUsd)}
                  couleur="var(--serie-1)"
                  extra={oiSpark.length >= 2 && <Sparkline values={oiSpark} color="var(--serie-1)" />}
                  labelExtra={<BadgeFiabilite meta={metaSource("coinalyze:oi")} />}
                />
                <Metric
                  label="Funding"
                  value={formatFunding(funding?.rate)}
                  couleur={fundingColor}
                  extra={
                    fundingSpark.length >= 2 && (
                      <Sparkline values={fundingSpark} color={fundingColor ?? "var(--text-dim)"} />
                    )
                  }
                  labelExtra={<BadgeFiabilite meta={metaSource("coinalyze:funding")} />}
                />
                {funding !== undefined && Number.isFinite(funding.rate) && (
                  <div className="flex items-center gap-2 px-3 text-[11px] tabular-nums text-text-dim">
                    <span>APR {formatPct(annualiserFunding(funding.rate, 8), 2)}</span>
                    <RefBadge referentiel={refFunding} sens="hausse-chaud" />
                  </div>
                )}
                {predicted && Number.isFinite(predicted.rate) && (
                  <div className="rounded-md border border-border bg-bg px-3 py-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="text-[11px] text-text-dim">Funding prédit</span>
                        <BadgeFiabilite meta={metaSource("coinalyze:funding")} />
                      </span>
                      <span
                        className={`tabular-nums text-sm font-medium ${
                          predicted.rate >= 0 ? "text-up" : "text-down"
                        }`}
                      >
                        {formatFunding(predicted.rate)}
                      </span>
                    </div>
                    <div className="mt-0.5 text-right text-[10px] text-text-dim">
                      prochain règlement (~8 h) {formatDelai(predicted.nextFundingTime, Date.now())} ·{" "}
                      {formatHeure(predicted.nextFundingTime)}
                    </div>
                  </div>
                )}
                <Metric
                  label="Long / Short agrégé"
                  value={
                    ls && Number.isFinite(ls.ratio)
                      ? `${ls.ratio.toFixed(2)} · L ${ls.longAccount.toFixed(1)}% / S ${ls.shortAccount.toFixed(1)}%`
                      : VALEUR_ABSENTE
                  }
                  couleur="var(--serie-2)"
                  extra={lsSpark.length >= 2 && <Sparkline values={lsSpark} color="var(--serie-2)" />}
                  labelExtra={<BadgeFiabilite meta={metaSource("coinalyze:ls")} />}
                />
              </div>

              {/* Bascules d'affichage des sous-panes OI / funding SUR le graphe (données
                  Coinalyze déjà payées ci-dessus → les superposer au chart est le gain).
                  Pilote derivativesChartStore, lu hors React par chart/derivatives.ts. */}
              <div className="flex items-center gap-2 rounded-md border border-border bg-bg px-3 py-2">
                <span className="mr-auto text-[11px] text-text-dim">Afficher sur le chart</span>
                <ChartToggle label="OI" active={showOiPane} color="var(--serie-5)" onClick={toggleOiPane} />
                <ChartToggle
                  label="Funding"
                  active={showFundingPane}
                  color="var(--serie-3)"
                  onClick={toggleFundingPane}
                />
              </div>

              {/* Liq Coinalyze = partiel ≤1 min (🟡). Si un jour forceOrder Binance
                  était branché ici : metaSource("binance:forceOrder") = estimation
                  « flux throttlé (sous-estimé) » — jamais présenter un cumul forceOrder
                  comme un fait complet (doctrine doc 02). */}
              <section className="rounded-md border border-border bg-bg">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
                  <span className="text-[10px] uppercase tracking-wide text-text-dim">
                    Liquidations récentes
                  </span>
                  <BadgeFiabilite meta={metaSource("coinalyze:liq")} />
                </div>
                {liqBuckets.length > 0 && (
                  <div className="border-b border-border px-3 py-2">
                    <div className="mb-1 flex items-baseline justify-between text-[11px]">
                      <span className="tabular-nums text-down">Longs {formatUsd(totalLongLiq)}</span>
                      <span className="tabular-nums text-up">Shorts {formatUsd(totalShortLiq)}</span>
                    </div>
                    <LiquidationBars buckets={liqBuckets} />
                  </div>
                )}
                <div className="max-h-60 overflow-y-auto">
                  {recentLiqs.length === 0 ? (
                    <div className="px-3 py-2">
                      <Vide>Aucune sur la dernière heure.</Vide>
                    </div>
                  ) : (
                    recentLiqs.map((l, i) => (
                      <div
                        key={`${l.time}-${l.side}-${i}`}
                        className="grid grid-cols-[1fr_auto_1fr] items-baseline gap-3 px-3 py-1.5 text-[11px]"
                      >
                        <span className="tabular-nums text-text-dim">{formatHeure(l.time)}</span>
                        <span
                          className={`font-medium uppercase ${l.side === "long" ? "text-down" : "text-up"}`}
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
              <div className="flex items-center justify-between px-1 text-text-dim">
                <span className="text-[10px] uppercase tracking-wide">Sentiment perp · Binance</span>
                <span className="text-[10px]">sans clé · {BIN_PERIOD}</span>
              </div>
              <Metric
                label="Comptes globaux L/S"
                value={formatRatioBreakdown(globalLs.at(-1))}
                couleur="var(--serie-6)"
                extra={globalLsSpark.length >= 2 && <Sparkline values={globalLsSpark} color="var(--serie-6)" />}
              />
              <Metric
                label="Top traders L/S"
                value={formatRatioBreakdown(topLs.at(-1))}
                couleur="var(--serie-4)"
                extra={topLsSpark.length >= 2 && <Sparkline values={topLsSpark} color="var(--serie-4)" />}
              />
              <Metric
                label="Taker achat / vente"
                value={formatDec(lastTaker?.buySellRatio, 2)}
                couleur={takerColor}
                extra={takerSpark.length >= 2 && <Sparkline values={takerSpark} color={takerColor} />}
              />
              <Metric
                label="Open Interest"
                value={formatUsd(binOi.at(-1)?.oiUsd)}
                couleur="var(--serie-1)"
                extra={binOiSpark.length >= 2 && <Sparkline values={binOiSpark} color="var(--serie-1)" />}
              />
            </section>
          )}
        </div>
    </>
  );
}
