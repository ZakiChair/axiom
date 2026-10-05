/**
 * Panneau « Produits dérivés » — dockable à droite, NON MODAL (pas d'overlay).
 *
 * Contrairement à un slide-over modal, ce panneau ne capture PAS les clics : le graphe
 * reste interactif pendant qu'on surveille OI/funding. Ouverture via le bouton de la
 * Toolbar ou le mnémonique DES (toggle). Le polling reste conditionné à l'ouverture.
 *
 * Affiche, pour l'ACTIF du symbole courant, le perpétuel découvert dans le
 * catalogue Coinalyze `future-markets` parmi les quatre places couvertes
 * (Binance, Bybit, OKX, Hyperliquid — demande du 5 octobre 2026) : Open Interest,
 * Funding rate, Long/Short ratio et les liquidations récentes. La place spot du
 * graphe ne conditionne plus la donnée ; un sélecteur permet de changer de place
 * quand l'actif en a plusieurs. Sans clé ou catalogue injoignable : repli sur le
 * perpétuel Binance supposé (`<ACTIF>USDT_PERP.A`). Source : provider Coinalyze
 * (tier gratuit). Rafraîchissement périodique uniquement quand la fenêtre est
 * ouverte (~1 min, conforme au débit 40 req/min).
 *
 * Sans clé API : aucun appel Coinalyze hors catalogue (le repli suppose le perp
 * Binance), aucune erreur bloquante — la fenêtre invite à saisir une clé dans les
 * Réglages (stockée localement, jamais loggée).
 * Hors clé et hors exchange : OI BTC par exchange (BGeometrics) et OI perps DEX quotidien
 * tous actifs (DefiLlama), deux sections repliables chargées au premier dépliage ; flux
 * takers toutes places (CryptoQuant, clé personnelle), section repliable chargée au MONTAGE
 * de la fenêtre (archive côté client, aucun appel quand J-1 est déjà archivé).
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
  type LiquidationBucket,
} from "../data/coinalyze";
import {
  actifPerpDe,
  LIBELLE_PLACE_PERP,
  marchePerpRetenu,
  resoudreMarchesPerp,
  type PlacePerp,
  type ResolutionPerp,
} from "../data/marchesPerp";
import { fetchIntervalleFundingH } from "../data/fundingCrossExchange";
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
  formatPourcentage,
  formatUsd,
  formatUsdSigne,
  VALEUR_ABSENTE,
} from "../lib/format";
import { metaSource } from "../lib/fiabilite";
import { histFunding, histOiUsd } from "../data/referentiels";
import { referentiel, type Referentiel } from "../lib/referentiel";
import { getBgeometricsKey } from "../store/onchain";
import { fetchOiFuturesParExchange, type JourOiFutures } from "../data/onchain/bgeometrics";
import {
  construireModeleOiExchange,
  joindreSpreadParTimestamp,
  libelleMarchePerp,
  texteAprFunding,
  texteProchainReglement,
} from "./derivativesWindow.util";
import { SectionOiPerpsDex } from "./OiPerpsDexSection";
import { SectionFluxTakers } from "./FluxTakersSection";
import { BadgeFiabilite, BarreProgression, EnTeteFenetre, ErreurBloc, Fraicheur, TuileStat, RefBadge, SansCle, Select, Vide } from "./ui";

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

/** Ratio L/S + Net Long/Short % (« 1.87 · Net +30% ») d'un point Binance (longAccount = fraction). */
function formatRatioBreakdown(p: BinanceRatioPoint | undefined): string {
  if (!p || !Number.isFinite(p.ratio)) return VALEUR_ABSENTE;
  const net = (p.longAccount - p.shortAccount) * 100;
  const signe = net > 0 ? "+" : "";
  return `${p.ratio.toFixed(2)} · Net ${signe}${net.toFixed(0)}% (L ${(p.longAccount * 100).toFixed(0)}%)`;
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

  // Choix de place perp par actif (session-only, cf. store/derivatives-ui).
  const placesPerp = useStore(derivativesUiStore, (s) => s.placesPerp);
  const choisirPlacePerp = useStore(derivativesUiStore, (s) => s.choisirPlacePerp);

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
  // Reset UNIQUEMENT au changement de symbole : le cache 1 h rend la valeur quasi
  // immédiate à chaque re-render sur funding?.rate, donc on garde l'ancien
  // référentiel affiché pendant le recalcul plutôt que de flicker vers null.
  // Référentiel de l'OI : un OI nu ne dit pas si le positionnement est tendu —
  // 12 Md$ est un plancher sur un marché, un sommet sur un autre. Même cache 1 h.
  const [refOi, setRefOi] = useState<Referentiel | null>(null);

  // ── Résolution du perp par ACTIF (demande du 5 octobre 2026) ──────────────────
  // L'actif dérive du symbole affiché (null pour TradFi/synthétique). La place
  // prioritaire est Hyperliquid uniquement quand l'instrument CHARTÉ est lui-même
  // un perp Hyperliquid (pas quand le symbole vient d'un groupe lié).
  const actif = useMemo(() => actifPerpDe(symbol), [symbol]);
  const prioritaire: PlacePerp | null =
    symbolGroupe === undefined && exchange === "hyperliquid" ? "hyperliquid" : null;

  // Résolution (catalogue Coinalyze `future-markets`, cache 12 h côté data) :
  // re-déclenchée à l'ouverture, au changement de symbole et à l'arrivée d'une clé.
  // En repli « catalogue-indisponible », nouvelle tentative toutes les 60 s (la mémo
  // d'échec de la couche data borne déjà la cadence réelle des appels).
  const [resolution, setResolution] = useState<ResolutionPerp | null>(null);
  useEffect(() => {
    if (!open) {
      setResolution(null);
      return;
    }
    let ignore = false;
    setResolution(null);
    let timer: ReturnType<typeof setInterval> | null = null;
    const lancer = () => {
      void resoudreMarchesPerp(symbol).then((r) => {
        if (ignore) return;
        setResolution(r);
        const indispo = r.etat === "repli" && r.cause === "catalogue-indisponible";
        if (indispo && timer === null) {
          timer = setInterval(lancer, 60_000);
        } else if (!indispo && timer !== null) {
          clearInterval(timer);
          timer = null;
        }
      });
    };
    lancer();
    return () => {
      ignore = true;
      if (timer !== null) clearInterval(timer);
    };
  }, [open, symbol, hasKey]);

  const marches =
    resolution !== null && resolution.etat !== "inexploitable" ? resolution.marches : [];
  const marche = marchePerpRetenu(
    marches,
    actif !== null ? placesPerp[actif] : undefined,
    prioritaire,
  );

  // Cadence réelle de règlement du funding (par place, mémo 1 h côté data) :
  // `undefined` = lecture en cours, `null` = inconnue. Sert à l'APR et à
  // l'estimation du prochain règlement.
  const [intervalleH, setIntervalleH] = useState<number | null | undefined>(undefined);
  const marchePlace = marche?.place;
  const marcheSymboleSurPlace = marche?.symboleSurPlace;
  useEffect(() => {
    setIntervalleH(undefined);
    if (!open || !hasKey || marchePlace === undefined || marcheSymboleSurPlace === undefined) {
      return;
    }
    let ignore = false;
    void fetchIntervalleFundingH(marchePlace, marcheSymboleSurPlace).then((h) => {
      if (!ignore) setIntervalleH(h);
    });
    return () => {
      ignore = true;
    };
  }, [open, hasKey, marchePlace, marcheSymboleSurPlace]);

  // Référentiels OI/funding : séries Binance USDⓈ-M, donc affichés UNIQUEMENT pour
  // un marché Binance (son `symboleSurPlace` est le symbole fapi). Jamais pour les
  // autres places. Reset au changement de marché (id Coinalyze), pas à chaque tick.
  const symboleReferentiel = marche?.place === "binance" ? marche.symboleSurPlace : null;
  const marcheSymbole = marche?.symbole;
  useEffect(() => {
    setRefFunding(null);
    setRefOi(null);
  }, [marcheSymbole]);
  useEffect(() => {
    let vivant = true;
    const oiUsd = oi?.oiUsd;
    if (symboleReferentiel === null || oiUsd === undefined || !Number.isFinite(oiUsd)) {
      return undefined;
    }
    void histOiUsd(symboleReferentiel).then((serie) => {
      if (!vivant || serie === null) return;
      setRefOi(referentiel(serie, oiUsd, Date.now()));
    });
    return () => {
      vivant = false;
    };
  }, [symboleReferentiel, oi?.oiUsd]);
  useEffect(() => {
    let vivant = true;
    const rate = funding?.rate;
    if (symboleReferentiel === null || rate === undefined || !Number.isFinite(rate)) {
      return undefined;
    }
    void histFunding(symboleReferentiel).then((serie) => {
      if (!vivant || serie === null) return;
      setRefFunding(referentiel(serie, rate, Date.now()));
    });
    return () => {
      vivant = false;
    };
  }, [symboleReferentiel, funding?.rate]);
  // Horodatage du dernier cycle de rafraîchissement Coinalyze : « — » tant qu'aucune
  // donnée n'est arrivée (cohérent avec Options/TermStructure), « maj ~1 min » ensuite.
  const [majTs, setMajTs] = useState<number | null>(null);

  // Sentiment perpétuel Binance (fapi /futures/data) — SANS clé Coinalyze : visible
  // même sans clé. Chaque tableau reste vide si la source est indisponible (dégradation).
  const [globalLs, setGlobalLs] = useState<BinanceRatioPoint[]>([]);
  const [topLs, setTopLs] = useState<BinanceRatioPoint[]>([]);
  const [taker, setTaker] = useState<BinanceTakerPoint[]>([]);
  const [binOi, setBinOi] = useState<BinanceOiHistPoint[]>([]);

  // Section repliable « OI BTC par exchange (quotidien) » — données BGeometrics BTC,
  // INDÉPENDANTES de la clé/symbole Coinalyze. Fetch LAZY au premier dépliage (jamais au
  // montage) : l'effet ci-dessous ne se déclenche que quand `oiExOuvert` passe à true.
  const [oiExOuvert, setOiExOuvert] = useState(false);
  const [oiExData, setOiExData] = useState<{ ts: number; jours: JourOiFutures[] } | null>(null);
  const [oiExCharge, setOiExCharge] = useState(false);
  const [oiExLoading, setOiExLoading] = useState(false);

  // Panneau NON MODAL : pas de capture de focus ni d'Échap global (le graphe reste
  // pilotable au clavier). Fermeture via ✕, le bouton de la Toolbar ou le mnémonique DES.

  useEffect(() => {
    // Reset complet à CHAQUE exécution : un changement de place ne doit jamais
    // afficher d'anciennes valeurs sous le nouveau libellé.
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

    // Fenêtre fermée, sans clé ou sans marché résolu : aucun appel Coinalyze.
    if (!open || !hasKey || marche === null) {
      return;
    }

    const symbole = marche.symbole; // id Coinalyze, casse conservée
    const aLongShort = marche.aLongShort;
    // Garde LOCALE à cet effet : empêche un setState après fermeture/changement de marché/clé.
    let ignore = false;

    const load = async () => {
      setLoading(true);
      // Mêmes 8 appels qu'avant, sur l'id Coinalyze du marché retenu — sauf les
      // deux appels long/short, sautés quand Coinalyze n'en publie pas (OKX, HL).
      const taches: Array<Promise<unknown>> = [
        coinalyzeProvider.fetchOpenInterest(symbole),
        coinalyzeProvider.fetchFundingRate(symbole),
        coinalyzeProvider.fetchLiquidations(symbole, Date.now() - LIQ_WINDOW_MS),
        coinalyzeProvider.fetchOpenInterestHistory(symbole, LS_PERIOD, Date.now() - SPARK_WINDOW_MS),
        coinalyzeProvider.fetchFundingRateHistory(symbole, LS_PERIOD, Date.now() - SPARK_WINDOW_MS),
        fetchPredictedFundingRate(symbole),
      ];
      if (aLongShort) {
        taches.push(
          coinalyzeProvider.fetchLongShortRatio(symbole, LS_PERIOD),
          fetchLongShortRatioHistory(symbole, LS_PERIOD, Date.now() - SPARK_WINDOW_MS),
        );
      }
      const results = await Promise.allSettled(taches);
      if (ignore) return;

      const [oiR, fR, liqR, oiHistR, fundingHistR, predR, lsR, lsHistR] = results;
      let authError = false;
      const noteError = (r: PromiseSettledResult<unknown> | undefined) => {
        if (r?.status === "rejected" && r.reason instanceof CoinalyzeError && r.reason.status === 401) {
          authError = true;
        }
      };
      results.forEach(noteError);

      setOi(oiR?.status === "fulfilled" ? (oiR.value as OpenInterest) : undefined);
      setFunding(fR?.status === "fulfilled" ? (fR.value as FundingRate) : undefined);
      setLs(lsR?.status === "fulfilled" ? (lsR.value as LongShortRatio) : undefined);
      setLiqs(liqR?.status === "fulfilled" ? (liqR.value as Liquidation[]) : []);
      setOiSpark(
        oiHistR?.status === "fulfilled"
          ? (oiHistR.value as OpenInterest[]).map((p) => p.oiUsd).filter(Number.isFinite)
          : []
      );
      setFundingSpark(
        fundingHistR?.status === "fulfilled"
          ? (fundingHistR.value as FundingRate[]).map((p) => p.rate).filter(Number.isFinite)
          : []
      );
      setPredicted(predR?.status === "fulfilled" ? (predR.value as FundingRate) : undefined);
      setLsSpark(
        lsHistR?.status === "fulfilled"
          ? (lsHistR.value as LongShortRatio[]).map((p) => p.ratio).filter(Number.isFinite)
          : []
      );

      // « Indisponibles » et le contrôle 401 ne portent que sur les appels émis.
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
    // marche?.symbole / marche?.aLongShort : la référence `marche` est re-dérivée à
    // chaque render ; les dépendances expriment le marché RÉELLEMENT chargé.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hasKey, marcheSymbole, marche?.aLongShort]);

  // Sentiment perpétuel Binance (fapi /futures/data) — effet SÉPARÉ, SANS clé
  // Coinalyze : affiché dès qu'un perp Binance EXISTE pour l'actif (catalogue ou
  // repli), même si la place affichée est ailleurs (demande du 5 octobre 2026).
  const symboleSentiment =
    marches.find((m) => m.place === "binance")?.symboleSurPlace ?? null;
  useEffect(() => {
    if (!open || symboleSentiment === null) {
      setGlobalLs([]);
      setTopLs([]);
      setTaker([]);
      setBinOi([]);
      return;
    }
    let ignore = false;
    const load = async () => {
      const [gR, tR, tkR, oiR] = await Promise.allSettled([
        fetchGlobalLongShortAccountRatio(symboleSentiment, BIN_PERIOD, BIN_LIMIT),
        fetchTopLongShortPositionRatio(symboleSentiment, BIN_PERIOD, BIN_LIMIT),
        fetchTakerLongShortRatio(symboleSentiment, BIN_PERIOD, BIN_LIMIT),
        fetchOpenInterestHist(symboleSentiment, BIN_PERIOD, BIN_LIMIT),
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
  }, [open, symboleSentiment]);

  // Chargement LAZY de l'OI par exchange : au tout premier dépliage seulement (cache 24 h
  // côté data → dépliages suivants gratuits). `oiExCharge` verrouille contre tout re-fetch.
  useEffect(() => {
    if (!oiExOuvert || oiExCharge) return;
    const ctrl = new AbortController();
    let ignore = false;
    setOiExLoading(true);
    void fetchOiFuturesParExchange(getBgeometricsKey(), ctrl.signal).then((r) => {
      if (ignore) return;
      setOiExData(r);
      setOiExCharge(true);
      setOiExLoading(false);
    });
    return () => {
      ignore = true;
      ctrl.abort();
    };
  }, [oiExOuvert, oiExCharge]);
  const modeleOiEx = useMemo(
    () => (oiExData ? construireModeleOiExchange(oiExData.jours) : null),
    [oiExData],
  );

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

  // Spread Smart vs Retail : jointure par timestamp (bucket manquant ≠ décalage d'index).
  const spreadSpark = useMemo(
    () => joindreSpreadParTimestamp(globalLs, topLs).map((p) => p.spread),
    [globalLs, topLs],
  );
  const lastSpread = spreadSpark.at(-1);
  const spreadColor =
    lastSpread !== undefined ? (lastSpread >= 0 ? "var(--up)" : "var(--down)") : undefined;

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

  // Sous-titre : premier cas qui matche (actif inexploitable → état de la recherche
  // → place retenue).
  const sousTitre =
    actif === null
      ? "Aucun actif crypto"
      : !hasKey
        ? `${actif} · clé Coinalyze requise`
        : resolution === null
          ? "Recherche des perpétuels…"
          : marche === null
            ? "Aucun perpétuel trouvé"
            : `${LIBELLE_PLACE_PERP[marche.place]} · ${marche.symboleSurPlace} · Coinalyze`;

  return (
    // Panneau dockable à droite, NON MODAL : aucun overlay plein écran ne capture les
    // clics. Fermé, il est translaté hors écran et rendu inerte (pointer-events-none)
    // pour laisser toute la surface du graphe cliquable. z-40 : sous la palette (z-60)
    // et le slide-over Réglages (z-50), au-dessus du graphe.
    <>
      <EnTeteFenetre
        mnemo="DES"
        titre="Produits dérivés"
        sousTitre={sousTitre}
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

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {actif === null ? (
            <Vide>
              Pas de produit dérivé crypto pour cet instrument (aucun actif sous-jacent exploitable).
            </Vide>
          ) : !hasKey ? (
            <SansCle
              message="Ajoutez une clé Coinalyze pour afficher Open Interest, funding, long/short et liquidations."
              onOuvrirReglages={openSettingsFromWindow}
            />
          ) : resolution === null ? (
            <Vide>Recherche des perpétuels {actif} sur Binance, Bybit, OKX et Hyperliquid…</Vide>
          ) : marche === null ? (
            <Vide>
              Aucun perpétuel {actif} sur Binance, Bybit, OKX ni Hyperliquid (catalogue Coinalyze).
            </Vide>
          ) : (
            <div className="space-y-3">
              {/* Rang de place : sélecteur quand l'actif a plusieurs perp, sinon
                  libellé statique. Le choix est par ACTIF (session-only). */}
              <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-bg px-3 py-2 text-[11px] text-text-dim">
                {marches.length >= 2 ? (
                  <Select
                    aria-label="Place du perpétuel"
                    value={marche.place}
                    onChange={(e) => choisirPlacePerp(actif, e.target.value as PlacePerp)}
                  >
                    {marches.map((m) => (
                      <option key={m.place} value={m.place}>
                        {libelleMarchePerp(m)}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <span>{libelleMarchePerp(marche)}</span>
                )}
                <span>
                  Actif {actif} · {marches.length} place{marches.length > 1 ? "s" : ""} trouvée
                  {marches.length > 1 ? "s" : ""}
                </span>
              </div>
              {resolution.etat === "repli" && resolution.cause === "catalogue-indisponible" && (
                <p className="px-1 text-[10px] text-text-dim">
                  Catalogue Coinalyze indisponible : perp Binance {marche.symboleSurPlace} supposé.
                </p>
              )}

              <div className="flex items-center justify-between rounded-md border border-border bg-bg px-3 py-2 text-[11px] text-text-dim">
                <span>{marche.symbole}</span>
                <Fraicheur loading={loading} majTs={majTs} cadence="1 min" />
              </div>

              {error && <ErreurBloc>{error}</ErreurBloc>}

              <div className="space-y-2">
                <TuileStat
                  disposition="inline"
                  label="Open Interest"
                  valeur={formatUsd(oi?.oiUsd)}
                  couleur="var(--serie-5)"
                  extra={oiSpark.length >= 2 && <Sparkline values={oiSpark} color="var(--serie-5)" />}
                  badge={<BadgeFiabilite meta={metaSource("coinalyze:oi")} />}
                />
                {/* Référentiels OI/funding : séries Binance USDⓈ-M — affichés
                    UNIQUEMENT pour un marché Binance (jamais « en construction »
                    sur les autres places, cf. revue du 5 octobre 2026). */}
                {marche.place === "binance" &&
                  oi !== undefined &&
                  Number.isFinite(oi.oiUsd) && (
                    <div className="flex items-center gap-2 px-3 text-[11px] tabular-nums text-text-dim">
                      <span>vs historique</span>
                      <RefBadge referentiel={refOi} sens="hausse-chaud" />
                    </div>
                  )}
                <TuileStat
                  disposition="inline"
                  label="Funding"
                  valeur={formatFunding(funding?.rate)}
                  couleur={fundingColor}
                  extra={
                    fundingSpark.length >= 2 && (
                      <Sparkline values={fundingSpark} color={fundingColor ?? "var(--text-dim)"} />
                    )
                  }
                  badge={<BadgeFiabilite meta={metaSource("coinalyze:funding")} />}
                />
                {funding !== undefined && Number.isFinite(funding.rate) && (
                  <div className="flex items-center gap-2 px-3 text-[11px] tabular-nums text-text-dim">
                    <span>{texteAprFunding(funding.rate, intervalleH)}</span>
                    {marche.place === "binance" && (
                      <RefBadge referentiel={refFunding} sens="hausse-chaud" />
                    )}
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
                      {texteProchainReglement(Date.now(), intervalleH)}
                    </div>
                  </div>
                )}
                <TuileStat
                  disposition="inline"
                  label="Long / Short agrégé"
                  valeur={
                    ls && Number.isFinite(ls.ratio)
                      ? `${ls.ratio.toFixed(2)} · L ${ls.longAccount.toFixed(1)}% / S ${ls.shortAccount.toFixed(1)}%`
                      : VALEUR_ABSENTE
                  }
                  couleur="var(--serie-2)"
                  extra={lsSpark.length >= 2 && <Sparkline values={lsSpark} color="var(--serie-2)" />}
                  badge={<BadgeFiabilite meta={metaSource("coinalyze:ls")} />}
                />
                {/* OKX et Hyperliquid n'ont pas de ratio long/short chez Coinalyze :
                    absence explicite plutôt qu'un « — » muet. */}
                {!marche.aLongShort && (
                  <div className="px-3 text-[11px] text-text-dim">
                    Ratio long/short non publié par Coinalyze pour {LIBELLE_PLACE_PERP[marche.place]}.
                  </div>
                )}
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
                      <Vide>
                        Aucune liquidation remontée par Coinalyze sur la dernière heure.
                      </Vide>
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
              Affiché dès qu'un perp Binance EXISTE pour l'actif (le repli suppose
              `<ACTIF>USDT`) ET qu'au moins un flux répond. */}
          {symboleSentiment !== null && hasBinanceSentiment && (
            <section className="mt-3 space-y-2">
              <div className="flex items-center justify-between px-1 text-text-dim">
                <span className="text-[10px] uppercase tracking-wide">
                  Sentiment perp · Binance · {symboleSentiment}
                </span>
                <span className="text-[10px]">sans clé · {BIN_PERIOD}</span>
              </div>
              <TuileStat
                disposition="inline"
                label="Comptes globaux L/S"
                valeur={formatRatioBreakdown(globalLs.at(-1))}
                couleur="var(--serie-6)"
                extra={globalLsSpark.length >= 2 && <Sparkline values={globalLsSpark} color="var(--serie-6)" />}
              />
              <TuileStat
                disposition="inline"
                label="Top traders L/S"
                valeur={formatRatioBreakdown(topLs.at(-1))}
                couleur="var(--serie-4)"
                extra={topLsSpark.length >= 2 && <Sparkline values={topLsSpark} color="var(--serie-4)" />}
              />
              {lastSpread !== undefined && (
                <TuileStat
                  disposition="inline"
                  label="Spread Smart vs Retail"
                  valeur={`${lastSpread > 0 ? "+" : ""}${lastSpread.toFixed(1)} %`}
                  couleur={spreadColor}
                  extra={spreadSpark.length >= 2 && <Sparkline values={spreadSpark} color={spreadColor ?? "var(--serie-3)"} />}
                />
              )}
              <TuileStat
                disposition="inline"
                label="Taker achat / vente"
                valeur={formatDec(lastTaker?.buySellRatio, 2)}
                couleur={takerColor}
                extra={takerSpark.length >= 2 && <Sparkline values={takerSpark} color={takerColor} />}
              />
              <TuileStat
                disposition="inline"
                label="Open Interest"
                valeur={formatUsd(binOi.at(-1)?.oiUsd)}
                couleur="var(--serie-5)"
                extra={binOiSpark.length >= 2 && <Sparkline values={binOiSpark} color="var(--serie-5)" />}
              />
            </section>
          )}

          {/* OI BTC par exchange (quotidien) — données BGeometrics BTC, INDÉPENDANTES de la
              clé/symbole Coinalyze : placée HORS des branches ci-dessus pour rester
              accessible sans clé Coinalyze. Repliable, fermée par défaut, fetch lazy. */}
          <section className="mt-3 rounded-md border border-border bg-bg">
            <button
              type="button"
              onClick={() => setOiExOuvert((v) => !v)}
              aria-expanded={oiExOuvert}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
            >
              <span className="text-[10px] uppercase tracking-wide text-text-dim">
                OI BTC par exchange (quotidien)
              </span>
              <span className="text-[11px] text-text-dim">{oiExOuvert ? "▾" : "▸"}</span>
            </button>
            {oiExOuvert && (
              <div className="border-t border-border px-3 py-2">
                {oiExLoading ? (
                  <p className="py-2 text-center text-[10px] text-text-dim">chargement…</p>
                ) : modeleOiEx === null ? (
                  <p className="py-2 text-center text-[10px] text-text-dim">indisponible</p>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[10px] text-text-dim">
                      <span>{modeleOiEx.date}</span>
                      <span className="tabular-nums">total {formatUsd(modeleOiEx.total)}</span>
                    </div>
                    {modeleOiEx.rangs.map((r) => (
                      <div key={r.exchange} className="space-y-0.5">
                        <div className="flex items-baseline justify-between gap-2 text-[11px]">
                          <span className="capitalize text-text">{r.exchange}</span>
                          <span className="flex items-baseline gap-2 tabular-nums">
                            <span className="text-text">{formatUsd(r.usd)}</span>
                            <span className="w-10 text-right text-text-dim">
                              {formatPourcentage(r.part * 100, 1)}
                            </span>
                            <span
                              className={`w-16 text-right ${
                                r.deltaJ7 === null
                                  ? "text-text-dim"
                                  : r.deltaJ7 >= 0
                                    ? "text-up"
                                    : "text-down"
                              }`}
                            >
                              {r.deltaJ7 === null ? "—" : formatUsdSigne(r.deltaJ7)}
                            </span>
                          </span>
                        </div>
                        <BarreProgression fraction={r.part} ariaLabel={`Part de ${r.exchange}`} />
                      </div>
                    ))}
                    <p className="pt-1 text-[9px] leading-snug text-text-dim">
                      Part calculée hors total de synthèse · Δ vs 7 séances plus tôt ·
                      bitcoin-data.com (cache 24 h)
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* OI perps DEX (quotidien, tous actifs) — DefiLlama, INDÉPENDANT de la clé
              Coinalyze et de l'exchange : hors des branches ci-dessus. Repliable, fetch lazy. */}
          <SectionOiPerpsDex />

          {/* Flux takers toutes places (quotidien, CryptoQuant, clé personnelle) — INDÉPENDANT
              de Coinalyze et de l'exchange : hors des branches ci-dessus. Repliée par défaut,
              mais chargée au MONTAGE de la fenêtre (archive côté client ; aucun appel quand
              J-1 est déjà archivé). */}
          <SectionFluxTakers onOuvrirReglages={openSettingsFromWindow} />
        </div>
    </>
  );
}
