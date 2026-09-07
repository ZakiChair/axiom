/**
 * Runtime des alertes — pont entre le moteur PUR (`@axiom/alerts`) et les flux live.
 *
 * Sources d'évaluation, sans chevauchement de types de condition (donc aucun
 * double déclenchement) :
 *  - FLUX TICKER (`subscribeTickers`) sur les symboles des alertes prix : évalue les
 *    conditions `prix-croise` à chaque mise à jour de prix (tous symboles). Le prix
 *    précédent est mémorisé par symbole (nécessaire au sens `les-deux`).
 *  - CLÔTURE DE BOUGIE (abonnement `marketStore`) sur le symbole affiché : évalue les
 *    conditions `variation-pct` et `indicateur-*` à chaque nouvelle bougie CLÔTURÉE
 *    (ces conditions requièrent les bougies, présentes uniquement pour le symbole affiché).
 *    Une def n'est évaluée que si son `timeframe` est celui du chart ; `timeframe`
 *    absent (def HÉRITÉE) = évaluée sur le TF affiché, quel qu'il soit.
 *  - POLL FUNDING (~60 s) pour les symboles ayant une alerte `funding-extreme` :
 *    injecte `fundingRate` (+ `fundingZScore` si historique dispo) dans le contexte.
 *  - STORE CVD S/P (`cvdDivergenceStore`) : le contrôleur orderflow publie le kind
 *    de divergence ; on évalue `cvd-spot-perp-div` (app ouverte uniquement — pas de
 *    pipeline orderflow côté daemon).
 *  - STORE RÉGIME (`regimeStore`) : le score composite −2..+2 (maj ~15 min) est injecté
 *    dans le contexte ; on évalue `regime-seuil` (GLOBAL, def sur BTCUSDT/binance). Sous
 *    le seuil de composants disponibles (libellé « indéterminé ») le score est du bruit :
 *    on n'injecte rien (non évaluable → armement figé). Front-only (le daemon ne calcule
 *    pas le score en v1).
 *  - POLL LIQ-CASCADE (~5 s) : injecte `liqUsdParMin` (notionnel liquidé sur la dernière
 *    minute glissante, pure `usdParMinute` sur le buffer `liqEventsStore`). Côté FRONT :
 *    évaluée uniquement pour le SYMBOLE COURANT du chart et seulement quand le flux liq
 *    est retenu (heatmap ON ou fenêtre LIQ ouverte — cf. fluxLiqRetenu) ; flux non retenu
 *    ou autre symbole → non évaluable ici (armement figé, pas de faux 0) — le daemon
 *    couvre TOUS les symboles d'alerte onglet fermé (cf. ci-dessous).
 *
 *  - ALERTES DE PRESET (`presetAlertsStore`) : un timer par alerte active (période 15 ou
 *    60 min) relance `executerScreener` (snapshot des filtres) ; les symboles ENTRANT dans
 *    l'ensemble scanné (diff, hors cooldown 6 h) sont journalisés + notifiés. AUCUNE garde
 *    de visibilité : c'est la seule source SANS relais daemon, la couper onglet caché
 *    laisserait l'opérateur non couvert (une période de 15–60 min survit à la limitation
 *    des timers d'arrière-plan). Chaque tick publie son issue (`dernierScanTs`,
 *    `derniereErreur`, champs de session du store) — le panneau les affiche.
 *
 * ONGLET FERMÉ : le daemon évalue aussi `funding-extreme` (poll premiumIndex ~60 s,
 * lot D3) ET `liq-cascade` (tick 10 s sur sa table `liquidations` ingérée Bybit+OKX,
 * tous les symboles d'alerte — ingestion d'un nouveau symbole ≤60 s). Restent FRONT-ONLY
 * (dormants côté daemon) : CVD spot/perp-div (pas de pipeline orderflow), `regime-seuil`
 * (score non calculé en v1) et les alertes de preset.
 *
 * Un déclenchement → journal du store + notification système (Notification API) + bip
 * discret (WebAudio, aucun fichier binaire). AUCUNE donnée haute fréquence ne transite
 * par React : le store n'est écrit que sur transition d'état (cf. BUILD-CONTRACT).
 *
 * Aucune modification de Chart.tsx : on lit `marketStore` en aval, sans le piloter.
 */
import { evaluerAlertes, typesDeDef, type AlertDef, type ContexteAlerte, type Declenchement } from "@axiom/alerts";
import type { Unsubscribe } from "@axiom/types";
import { marketStore } from "../store/market";
import { fluxLiqRetenu, liqEventsStore } from "../chart/liquidationMarkers";
import { usdParMinute } from "../components/liquidationsWindow.util";
import { alertsStore, pousserDefsDaemon } from "../store/alerts";
import { cvdDivergenceStore } from "../store/cvd-divergence";
import { regimeStore } from "../store/regime";
import { orderflowStore } from "../store/orderflow";
import { presetAlertsStore, diffEntrants, filtrerCooldown } from "../store/presetAlerts";
import { isTickerSource, subscribeTickers, type TickerUpdate } from "../data/ticker";
import type { WatchlistSource } from "../store/watchlist";
import { daemonSupporte, detectDaemon, urlDaemon } from "../data/daemon";
import { coinalyzeProvider, filtrerFrontieres8h } from "../data/coinalyze";
import { histFunding } from "../data/referentiels";
import { executerScreener } from "../data/screenerRun";
import { SCREENER_POSITION_CAP } from "../data/screener";
import { extUrl } from "../data/extapi";

/** Types de condition évalués sur la clôture de bougie (nécessitent les bougies). */
const TYPES_BOUGIE = new Set(["variation-pct", "indicateur-seuil", "indicateur-croisement"]);
/** Throttle d'évaluation des composites (ms) — `computeIndicator` n'a pas à courir à chaque tick. */
const COMPOSITE_THROTTLE_MS = 1_000;

function defPorte(def: AlertDef, type: string): boolean {
  return typesDeDef(def).has(type);
}

/** Période de poll funding (ms) — lent, hors chemin chaud. */
const FUNDING_POLL_MS = 60_000;
/** Période d'évaluation de `liq-cascade` (ms) — le poll fait aussi RETOMBER la fenêtre
 *  glissante sous le seuil (ré-armement) quand le flux se calme. */
const LIQ_CASCADE_POLL_MS = 5_000;
/** Fenêtre min. d'historique funding pour un z-score (points). Horizon variable selon la
 *  source : ~10 j (perp 8h) ou ~5 j (perp 4h) en primaire (`histFunding`, cadence réelle
 *  du perp) vs toujours ~10 j en repli Coinalyze (filtré aux frontières 8h UTC). */
const FUNDING_Z_WINDOW = 30;

/** Cooldown par (alerte, symbole) d'une alerte de preset (ms) : anti-spam sur un aller-retour. */
const PRESET_COOLDOWN_MS = 6 * 3_600_000;
/** Cap indicateurs réduit pour un scan d'alerte (échantillon plus léger que le run UI). */
const PRESET_CAP_INDICATEURS = 30;

/** Applique une passe d'évaluation : persiste les defs modifiées, journalise + notifie. */
function appliquerResultat(lot: AlertDef[], ctx: ContexteAlerte): void {
  if (lot.length === 0) return;
  const res = evaluerAlertes(lot, ctx);
  if (!res.modifie) return;
  const store = alertsStore.getState();
  store.appliquerMisesAJour(res.defs); // fusion par id (n'écrase pas les defs hors lot)
  for (const d of res.declenchements) {
    store.ajouterJournal(d);
    notifier(d);
  }
}

/** Crée le runtime et démarre les abonnements. Renvoie une fonction d'arrêt. */
function creerRuntime(): Unsubscribe {
  const cleMarche = (source: AlertDef["source"], symbol: string): string => `${source}|${symbol}`;

  /** Dernier prix vu par marché (pour le `prixPrecedent` du sens `les-deux`). */
  const dernierPrix = new Map<string, number>();

  /** Contexte fusionné par marché (hors React) — les flux y écrivent leur contribution. */
  type ContextePartiel = Partial<ContexteAlerte> & { timeframeBougies?: string };
  const contextes = new Map<string, ContextePartiel>();
  const dernierEvalComposite = new Map<string, number>();

  const fusionner = (
    source: AlertDef["source"],
    symbol: string,
    patch: ContextePartiel,
  ): void => {
    const cle = cleMarche(source, symbol);
    const prev = contextes.get(cle) ?? {};
    if (patch.timeframeBougies !== undefined && patch.timeframeBougies !== prev.timeframeBougies) {
      dernierEvalComposite.delete(cle);
    }
    const { dernierPrix: prixPatch, ...reste } = patch;
    const next: ContextePartiel = { ...prev, ...reste };
    // 0 n'est pas une mesure : on n'écrase un prix ticker que par une valeur réelle.
    if (prixPatch !== undefined && Number.isFinite(prixPatch)) next.dernierPrix = prixPatch;
    contextes.set(cle, next);
  };

  const evaluerComposites = (source: AlertDef["source"], symbol: string): void => {
    const cle = cleMarche(source, symbol);
    const now = Date.now();
    const last = dernierEvalComposite.get(cle) ?? 0;
    if (now - last < COMPOSITE_THROTTLE_MS) return;
    const partiel = contextes.get(cle);
    if (!partiel || partiel.dernierPrix === undefined || !Number.isFinite(partiel.dernierPrix)) return;
    const lot = alertsStore
      .getState()
      .defs.filter((d) => {
        if (!d.actif || d.source !== source || d.symbol !== symbol || d.condition.type !== "composite") {
          return false;
        }
        const porteBougie = [...TYPES_BOUGIE].some((type) => defPorte(d, type));
        return !porteBougie || d.timeframe === undefined || d.timeframe === partiel.timeframeBougies;
      });
    if (lot.length === 0) return;
    dernierEvalComposite.set(cle, now);
    const regime = regimeStore.getState().regime;
    const regimeScore =
      regime !== null && regime.libelle !== "indéterminé" ? regime.score : undefined;
    appliquerResultat(lot, {
      maintenant: now,
      dernierPrix: partiel.dernierPrix,
      prixPrecedent: partiel.prixPrecedent,
      candles: partiel.candles,
      fundingRate: partiel.fundingRate,
      fundingZScore: partiel.fundingZScore,
      cvdDivergenceKind: partiel.cvdDivergenceKind,
      liqUsdParMin: partiel.liqUsdParMin,
      regimeScore,
    });
  };

  // ── Flux ticker : conditions prix-croise ──────────────────────────────────
  const onTicker = (source: AlertDef["source"], { symbol, price }: TickerUpdate): void => {
    if (!Number.isFinite(price)) return;
    const cle = cleMarche(source, symbol);
    const precedent = dernierPrix.get(cle);
    fusionner(source, symbol, { dernierPrix: price, prixPrecedent: precedent });
    const lot = alertsStore
      .getState()
      .defs.filter(
        (d) =>
          d.actif &&
          d.source === source &&
          d.symbol === symbol &&
          d.condition.type === "prix-croise",
      );
    if (lot.length > 0) {
      appliquerResultat(lot, {
        maintenant: Date.now(),
        dernierPrix: price,
        prixPrecedent: precedent,
      });
    }
    dernierPrix.set(cle, price);
    evaluerComposites(source, symbol);
  };

  // (Re)souscription du flux ticker quand les marchés à alertes prix changent. Les
  // sources sans route ticker restent évaluées sur les clôtures du chart maître.
  let unsubTicker: Unsubscribe = () => {};
  let cleTicker = "";
  let generationTicker = 0;
  const resyncTicker = (): void => {
    const groupes = new Map<WatchlistSource, Set<string>>();
    for (const d of alertsStore.getState().defs) {
      if (!d.actif || !defPorte(d, "prix-croise") || !isTickerSource(d.source)) continue;
      const symbols = groupes.get(d.source) ?? new Set<string>();
      symbols.add(d.symbol);
      groupes.set(d.source, symbols);
    }
    const groupesTries = [...groupes.entries()]
      .map(([source, symbols]) => [source, [...symbols].sort()] as const)
      .sort(([sourceA], [sourceB]) => sourceA.localeCompare(sourceB));
    const cle = groupesTries.map(([source, symbols]) => `${source}:${symbols.join(",")}`).join(";");
    if (cle === cleTicker) return; // ensemble inchangé → on garde la souscription en place
    cleTicker = cle;
    unsubTicker();
    generationTicker += 1;
    const generation = generationTicker;
    const unsubs = groupesTries.map(([source, symbols]) =>
      subscribeTickers(
        symbols,
        (update) => {
          if (generation !== generationTicker) return;
          onTicker(source, update);
        },
        { source },
      ),
    );
    unsubTicker = () => {
      generationTicker += 1;
      for (const unsub of unsubs) unsub();
    };
  };

  // ── Clôture de bougie : conditions variation-pct + indicateur-* ────────────
  let derniereSource = "";
  let dernierSymbole = "";
  let dernierTf = "";
  let dernierTempsCloture = 0;
  const onMarket = (): void => {
    const { exchange, symbol, timeframe, candles } = marketStore.getState();
    // Changement de source, symbole OU TF (backfill) : on réinitialise le suivi de clôture.
    // Le TF compte depuis que les defs y sont filtrées : les clôtures d'un TF plus long
    // sont ANTÉRIEURES à la dernière vue sur un TF court, et resteraient ignorées.
    if (exchange !== derniereSource || symbol !== dernierSymbole || timeframe !== dernierTf) {
      derniereSource = exchange;
      dernierSymbole = symbol;
      dernierTf = timeframe;
      dernierTempsCloture = 0;
    }
    if (candles.length < 2) return;
    const last = candles[candles.length - 1];
    if (!last) return;
    // Bougie de référence = dernière CLÔTURÉE (la live est écartée).
    const idxClose = last.closed === true ? candles.length - 1 : candles.length - 2;
    const barreClose = candles[idxClose];
    if (!barreClose || barreClose.time <= dernierTempsCloture) return; // déjà évaluée
    dernierTempsCloture = barreClose.time;

    // Une def PORTE son TF d'évaluation ; `undefined` = def héritée (évaluée sur le TF
    // affiché, comportement d'origine).
    const lot = alertsStore
      .getState()
      .defs.filter(
        (d) =>
          d.actif &&
          d.source === exchange &&
          d.symbol === symbol &&
          (TYPES_BOUGIE.has(d.condition.type) ||
            (!isTickerSource(exchange) && d.condition.type === "prix-croise")) &&
          (d.timeframe === undefined || d.timeframe === timeframe)
      );
    const avant = candles[idxClose - 1];
    const candlesCloturees = candles.slice(0, idxClose + 1);
    fusionner(exchange, symbol, {
      dernierPrix: barreClose.close,
      prixPrecedent: avant?.close,
      candles: candlesCloturees,
      timeframeBougies: timeframe,
    });
    if (lot.length > 0) {
      appliquerResultat(lot, {
        maintenant: Date.now(),
        dernierPrix: barreClose.close,
        prixPrecedent: avant?.close,
        candles: candlesCloturees,
      });
    }
    evaluerComposites(exchange, symbol);
  };

  // ── Poll funding : conditions funding-extreme ─────────────────────────────
  // Cache par symbole : rate courant + z-score optionnel (historique Coinalyze).
  const cacheFunding = new Map<string, { rate: number; z?: number; ts: number }>();

  const evaluerFundingSymbol = (source: AlertDef["source"], symbol: string): void => {
    const snap = cacheFunding.get(cleMarche(source, symbol));
    if (!snap) return;
    const lot = alertsStore
      .getState()
      .defs.filter(
        (d) =>
          d.actif &&
          d.source === source &&
          d.symbol === symbol &&
          d.condition.type === "funding-extreme",
      );
    const mkt = marketStore.getState();
    const lastCandle =
      mkt.exchange === source && mkt.symbol === symbol
        ? mkt.candles[mkt.candles.length - 1]
        : undefined;
    const prixReel = lastCandle !== undefined && Number.isFinite(lastCandle.close) ? lastCandle.close : undefined;
    fusionner(source, symbol, {
      ...(prixReel !== undefined ? { dernierPrix: prixReel } : {}),
      fundingRate: snap.rate,
      fundingZScore: snap.z,
    });
    if (lot.length > 0) {
      appliquerResultat(lot, {
        maintenant: Date.now(),
        dernierPrix: prixReel ?? 0,
        fundingRate: snap.rate,
        fundingZScore: snap.z,
      });
    }
    evaluerComposites(source, symbol);
  };

  const pollFunding = async (): Promise<void> => {
    const sourcesParSymbole = new Map<string, Set<AlertDef["source"]>>();
    for (const d of alertsStore.getState().defs) {
      if (!d.actif || !defPorte(d, "funding-extreme")) continue;
      const sources = sourcesParSymbole.get(d.symbol) ?? new Set<AlertDef["source"]>();
      sources.add(d.source);
      sourcesParSymbole.set(d.symbol, sources);
    }
    for (const [symbol, sources] of sourcesParSymbole) {
      const snap = await chargerFunding(symbol);
      if (!snap) continue;
      for (const source of sources) {
        cacheFunding.set(cleMarche(source, symbol), { ...snap, ts: Date.now() });
        evaluerFundingSymbol(source, symbol);
      }
    }
  };

  let fundingTimer: ReturnType<typeof setInterval> | undefined;
  const resyncFunding = (): void => {
    const aDesFunding = alertsStore
      .getState()
      .defs.some((d) => d.actif && defPorte(d, "funding-extreme"));
    if (aDesFunding && fundingTimer === undefined) {
      void pollFunding();
      fundingTimer = setInterval(() => {
        void pollFunding();
      }, FUNDING_POLL_MS);
    } else if (!aDesFunding && fundingTimer !== undefined) {
      clearInterval(fundingTimer);
      fundingTimer = undefined;
    }
  };

  // ── Poll liq-cascade : buffer liq du chart → moteur ───────────────────────
  // Côté FRONT (cf. en-tête) : le buffer `liqEventsStore` ne couvre que le symbole
  // COURANT du chart et n'est alimenté que si le flux est retenu (heatmap ON ou fenêtre
  // LIQ ouverte). Flux non retenu → on n'évalue PAS (non évaluable : l'armement reste
  // figé, on n'injecte pas un 0 trompeur). Le daemon évalue AUSSI ce type onglet fermé
  // (tick 10 s, tous les symboles d'alerte) — l'anti-doublon heartbeat (>90 s) évite la
  // double notification quand l'app est ouverte.
  const evaluerLiqCascade = (): void => {
    if (!fluxLiqRetenu()) return; // flux inactif → non évaluable
    const { exchange, symbol } = marketStore.getState();
    const lot = alertsStore
      .getState()
      .defs.filter(
        (d) =>
          d.actif &&
          d.source === exchange &&
          d.symbol === symbol &&
          d.condition.type === "liq-cascade",
      );
    // Événements RÉELS uniquement : le seed Coinalyze (`approx`) est agrégé par bougie
    // et gonflerait artificiellement la minute glissante.
    const reels = liqEventsStore.getState().events.filter((ev) => ev.approx !== true);
    const nowMs = Date.now();
    const mkt = marketStore.getState();
    const lastCandle = mkt.candles[mkt.candles.length - 1];
    const liqUsdParMin = usdParMinute(reels, nowMs);
    const prixReel = lastCandle !== undefined && Number.isFinite(lastCandle.close) ? lastCandle.close : undefined;
    fusionner(exchange, symbol, {
      ...(prixReel !== undefined ? { dernierPrix: prixReel } : {}),
      liqUsdParMin,
    });
    if (lot.length > 0) {
      appliquerResultat(lot, {
        maintenant: nowMs,
        dernierPrix: prixReel ?? 0,
        liqUsdParMin,
      });
    }
    evaluerComposites(exchange, symbol);
  };

  let liqCascadeTimer: ReturnType<typeof setInterval> | undefined;
  const resyncLiqCascade = (): void => {
    const aDesCascade = alertsStore
      .getState()
      .defs.some((d) => d.actif && defPorte(d, "liq-cascade"));
    if (aDesCascade && liqCascadeTimer === undefined) {
      evaluerLiqCascade();
      liqCascadeTimer = setInterval(evaluerLiqCascade, LIQ_CASCADE_POLL_MS);
    } else if (!aDesCascade && liqCascadeTimer !== undefined) {
      clearInterval(liqCascadeTimer);
      liqCascadeTimer = undefined;
    }
  };

  // ── CVD spot/perp-div : pont orderflow → moteur ─────────────────────────
  const evaluerCvdSymbol = (source: AlertDef["source"], symbol: string): void => {
    const kind = cvdDivergenceStore.getState().bySymbol[symbol.toUpperCase()];
    // Clé absente → undefined : non évaluable (pipeline off).
    if (kind === undefined) return;
    const lot = alertsStore
      .getState()
      .defs.filter(
        (d) =>
          d.actif &&
          d.source === source &&
          d.symbol === symbol &&
          d.condition.type === "cvd-spot-perp-div",
      );
    const mkt = marketStore.getState();
    const lastCandle =
      mkt.exchange === source && mkt.symbol === symbol
        ? mkt.candles[mkt.candles.length - 1]
        : undefined;
    const prixReel = lastCandle !== undefined && Number.isFinite(lastCandle.close) ? lastCandle.close : undefined;
    fusionner(source, symbol, {
      ...(prixReel !== undefined ? { dernierPrix: prixReel } : {}),
      cvdDivergenceKind: kind,
    });
    if (lot.length > 0) {
      appliquerResultat(lot, {
        maintenant: Date.now(),
        dernierPrix: prixReel ?? 0,
        cvdDivergenceKind: kind,
      });
    }
    evaluerComposites(source, symbol);
  };

  /** Active orderflow + CVD S/P si au moins une alerte CVD active (Binance). */
  const assurerPipelineCvd = (): void => {
    const aDesCvd = alertsStore
      .getState()
      .defs.some((d) => d.actif && defPorte(d, "cvd-spot-perp-div"));
    if (!aDesCvd) return;
    const of = orderflowStore.getState();
    if (!of.enabled) of.setEnabled(true);
    if (!of.cvdSpotPerp) of.setCvdSpotPerp(true);
  };

  // Rallumage du pipeline UNIQUEMENT quand l'ENSEMBLE des alertes CVD actives change
  // (patron `resyncTicker`). Le store émet aussi sur le journal et sur chaque transition
  // d'armement (`appliquerMisesAJour` réalloue `defs`) : sans cette clé, un déclenchement
  // SANS RAPPORT ressusciterait l'orderflow que l'opérateur venait de couper.
  let cleCvd = "";
  const resyncCvd = (): void => {
    const cle = alertsStore
      .getState()
      .defs.filter((d) => d.actif && defPorte(d, "cvd-spot-perp-div"))
      .map((d) => d.id)
      .sort()
      .join(",");
    if (cle === cleCvd) return; // ensemble inchangé → on ne touche pas à l'orderflow
    cleCvd = cle;
    assurerPipelineCvd();
  };

  const unsubCvd = cvdDivergenceStore.subscribe((s, prev) => {
    const source = marketStore.getState().exchange;
    // Évalue seulement les symboles dont le kind a changé.
    for (const [sym, kind] of Object.entries(s.bySymbol)) {
      if (prev.bySymbol[sym] !== kind) evaluerCvdSymbol(source, sym);
    }
  });

  // ── Store régime : score composite −2..+2 → moteur ────────────────────────
  // Condition GLOBALE (lot filtré par TYPE seul). « indéterminé » (< 3 composants) :
  // score = bruit → non injecté (armement figé, pas de faux déclenchement).
  const evaluerRegime = (): void => {
    const regime = regimeStore.getState().regime;
    if (regime === null || regime.libelle === "indéterminé") return; // non évaluable
    const lot = alertsStore
      .getState()
      .defs.filter((d) => d.actif && d.condition.type === "regime-seuil");
    if (lot.length === 0) return;
    appliquerResultat(lot, {
      maintenant: Date.now(),
      dernierPrix: 0, // inutilisé par la condition (score global, sans symbole)
      regimeScore: regime.score,
    });
    for (const d of alertsStore.getState().defs) {
      if (d.actif && d.condition.type === "composite") evaluerComposites(d.source, d.symbol);
    }
  };

  const unsubRegime = regimeStore.subscribe(evaluerRegime);

  // ── Alertes de PRESET : scan périodique + diff d'entrée dans l'ensemble ────
  // Chaque alerte active relance `executerScreener` (snapshot de ses filtres) à sa
  // période propre ; les symboles ENTRANTS (absents du scan précédent) hors cooldown
  // sont journalisés + notifiés. État par alerte (baseline + cooldown) en Maps de
  // closure, nettoyé au retrait/désactivation ; jamais deux ticks concurrents d'une
  // même alerte (garde `enCours`). Aucune écriture du screenerStore (run isolé).
  const timersPreset = new Map<string, ReturnType<typeof setInterval>>();
  /** Dernier ensemble de symboles scannés par alerte (absent = amorce → pas de déclenchement). */
  const dernierEnsemble = new Map<string, Set<string>>();
  /** Cooldown par alerte : symbole → ms epoch du dernier déclenchement. */
  const cooldownsPreset = new Map<string, Map<string, number>>();
  /** Alertes dont un tick est en cours (anti-chevauchement). */
  const ticksEnCours = new Set<string>();

  const tickPreset = async (id: string): Promise<void> => {
    // AUCUNE garde de visibilité : c'est la seule source d'alerte sans relais daemon —
    // la couper onglet caché laissait l'opérateur non couvert sans le savoir.
    if (ticksEnCours.has(id)) return; // tick précédent encore en vol
    const alerte = presetAlertsStore.getState().alertes.find((a) => a.id === id);
    if (!alerte || !alerte.actif) return; // retirée/désactivée entre-temps
    ticksEnCours.add(id);
    try {
      const res = await executerScreener(alerte.baseConditions, alerte.indicatorConditions, alerte.tf, {
        capIndicateurs: PRESET_CAP_INDICATEURS,
        capPosition: SCREENER_POSITION_CAP,
      });
      // Ré-validation POST-await : l'alerte a pu être retirée/désactivée pendant le scan en
      // vol — `resyncPreset` a alors déjà purgé son état. Sans ce contrôle, la ligne
      // `dernierEnsemble.set` ci-dessous RESSUSCITERAIT sa baseline (et pourrait déclencher
      // pour une alerte disparue).
      const encoreActive = presetAlertsStore.getState().alertes.find((a) => a.id === id);
      if (!encoreActive || !encoreActive.actif) return;
      presetAlertsStore.getState().marquerScan(id, Date.now()); // succès : erreur effacée
      const courant = res.rows.map((r) => r.symbol);
      const precedent = dernierEnsemble.get(id) ?? null;
      const entrants = diffEntrants(precedent, courant);
      dernierEnsemble.set(id, new Set(courant));
      if (precedent === null) return; // amorce : baseline mémorisée, aucun déclenchement
      const cd = cooldownsPreset.get(id) ?? new Map<string, number>();
      const nowMs = Date.now();
      const retenus = filtrerCooldown(entrants, cd, nowMs, PRESET_COOLDOWN_MS);
      for (const sym of retenus) {
        cd.set(sym, nowMs);
        const d: Declenchement = {
          alertId: id,
          ts: nowMs,
          valeur: 0, // pas de valeur numérique : c'est une entrée dans un ensemble
          message: `EQS ${alerte.nom} : ${sym} entre dans le scan`,
        };
        alertsStore.getState().ajouterJournal(d);
        notifier(d);
      }
      cooldownsPreset.set(id, cd);
    } catch (e) {
      // Scan best-effort : un échec réseau ne casse ni la baseline ni le timer, mais il
      // est PUBLIÉ (le panneau affichait une pastille verte après des heures d'échecs).
      presetAlertsStore
        .getState()
        .marquerScan(id, Date.now(), e instanceof Error ? e.message : String(e));
    } finally {
      ticksEnCours.delete(id);
    }
  };

  const resyncPreset = (): void => {
    const actives = presetAlertsStore.getState().alertes.filter((a) => a.actif);
    const idsActifs = new Set(actives.map((a) => a.id));
    // Alertes disparues/désactivées : on stoppe le timer et on purge leur état.
    for (const [id, timer] of timersPreset) {
      if (idsActifs.has(id)) continue;
      clearInterval(timer);
      timersPreset.delete(id);
      dernierEnsemble.delete(id);
      cooldownsPreset.delete(id);
      ticksEnCours.delete(id);
    }
    // Nouvelles alertes actives : tick d'amorce immédiat (baseline) puis timer périodique.
    for (const a of actives) {
      if (timersPreset.has(a.id)) continue;
      void tickPreset(a.id);
      const periodeMs = a.periodeMin * 60_000;
      timersPreset.set(a.id, setInterval(() => void tickPreset(a.id), periodeMs));
    }
  };

  // Démarrage : souscriptions + calibrage immédiat contre l'état courant.
  resyncTicker();
  resyncFunding();
  resyncLiqCascade();
  resyncPreset();
  resyncCvd();
  // Calibrage CVD sur l'état déjà publié (si orderflow déjà actif).
  for (const sym of Object.keys(cvdDivergenceStore.getState().bySymbol)) {
    evaluerCvdSymbol(marketStore.getState().exchange, sym);
  }
  evaluerRegime(); // calibrage régime sur le score déjà publié
  const unsubAlerts = alertsStore.subscribe(() => {
    resyncTicker(); // re-route si la liste des symboles change
    resyncFunding();
    resyncLiqCascade();
    resyncCvd();
    evaluerRegime(); // calibre une def régime nouvellement ajoutée
  });
  const unsubMarket = marketStore.subscribe(onMarket);
  onMarket(); // calibrage initial des conditions bougie sur le backfill présent

  // Ajout/retrait/bascule d'une alerte de preset → re-cadre les timers de scan.
  const unsubPreset = presetAlertsStore.subscribe(resyncPreset);

  const stopHeartbeat = demarrerHeartbeat();

  return () => {
    unsubAlerts();
    unsubMarket();
    unsubTicker();
    unsubCvd();
    unsubRegime();
    unsubPreset();
    stopHeartbeat();
    if (fundingTimer !== undefined) clearInterval(fundingTimer);
    if (liqCascadeTimer !== undefined) clearInterval(liqCascadeTimer);
    for (const timer of timersPreset.values()) clearInterval(timer);
    timersPreset.clear();
    dernierEnsemble.clear();
    cooldownsPreset.clear();
    ticksEnCours.clear();
  };
}

/**
 * Charge le funding courant (Binance premiumIndex, fraction) + z-score optionnel
 * depuis l'historique Coinalyze (best-effort : z omis si indisponible).
 */
async function chargerFunding(
  symbol: string
): Promise<{ rate: number; z?: number } | undefined> {
  let rate: number | undefined;

  // 1) Snapshot Binance fapi (gratuit, fiable) — fraction lastFundingRate.
  try {
    const res = await fetch(
      extUrl("fapi.binance.com", `fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`)
    );
    if (res.ok) {
      const raw: unknown = await res.json();
      const last =
        raw !== null && typeof raw === "object"
          ? Number((raw as { lastFundingRate?: unknown }).lastFundingRate)
          : Number.NaN;
      if (Number.isFinite(last)) rate = last;
    }
  } catch {
    /* best-effort */
  }

  // 2) Repli Coinalyze si premiumIndex a échoué.
  if (rate === undefined) {
    try {
      const fr = await coinalyzeProvider.fetchFundingRate(symbol);
      if (Number.isFinite(fr.rate)) rate = fr.rate;
    } catch {
      /* best-effort */
    }
  }
  if (rate === undefined) return undefined;

  // 3) Z-score sur les RÈGLEMENTS RÉELS (Binance fapi/v1/fundingRate via histFunding —
  //    cadence 8 h OU 4 h selon le perp, memoïsé). Repli : Coinalyze « 4hour » filtré aux
  //    frontières de règlement 8 h UTC (00/08/16) — « 8hour » N'EXISTE PAS chez Coinalyze
  //    et repliait en silence sur du 5 min : les 30 « règlements » couvraient ~2 h 30,
  //    écart-type ≈ 0, z aberrant. Filtre sur le TEMPS (pas sur l'index) : un
  //    sous-échantillonnage par index ne garantit pas l'alignement sur les vraies
  //    frontières de règlement (cf. `filtrerFrontieres8h`).
  let z: number | undefined;
  try {
    let rates = ((await histFunding(symbol)) ?? []).map((p) => p.v);
    if (rates.length === 0) {
      const since = Date.now() - FUNDING_Z_WINDOW * 8 * 3_600_000;
      const hist = await coinalyzeProvider.fetchFundingRateHistory(symbol, "4hour", since);
      // Filtre les taux finis AVANT la sélection par frontière (sinon un point non-fini
      // sur une frontière retenue élargirait silencieusement un trou à ~16 h).
      const finis = hist.filter((h) => Number.isFinite(h.rate));
      rates = filtrerFrontieres8h(finis).map((h) => h.rate);
    }
    // Inclut le rate courant s'il n'est pas déjà le dernier point.
    const series =
      rates.length > 0 && rates[rates.length - 1] === rate ? rates : [...rates, rate];
    if (series.length >= Math.min(5, FUNDING_Z_WINDOW)) {
      const win = series.slice(-FUNDING_Z_WINDOW);
      const mean = win.reduce((a, b) => a + b, 0) / win.length;
      const variance = win.reduce((a, b) => a + (b - mean) ** 2, 0) / win.length;
      const sd = Math.sqrt(variance);
      z = sd === 0 ? 0 : (rate - mean) / sd;
    }
  } catch {
    /* z optionnel */
  }

  return { rate, z };
}

// Singleton : évite les doubles souscriptions (ex. double montage en React StrictMode).
let arreter: Unsubscribe | null = null;

/**
 * Démarre le runtime des alertes (idempotent : un second appel arrête d'abord le
 * précédent). À câbler UNE fois par un agent ultérieur (ex. dans App). Renvoie l'arrêt.
 */
export function demarrerAlertes(): Unsubscribe {
  if (arreter) arreter();
  const stop = creerRuntime();
  arreter = () => {
    stop();
    arreter = null;
  };
  return arreter;
}

// ───────── Heartbeat vers le daemon (anti-doublon onglet fermé) ─────────
//
// Tant que l'app est OUVERTE, elle POST /heartbeat toutes les 30 s avec
// `{visible, canNotify}`. Le daemon relaie macOS sauf si le heartbeat est récent
// ET `canNotify: true` (onglet visible + permission). Champ absent (legacy) ⇒ relais.
// Telegram reste propriétaire du daemon. Sans daemon : aucun POST.

/** Intervalle d'émission du heartbeat (ms). */
const HEARTBEAT_MS = 30_000;

function ongletVisible(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "visible";
}

function permissionNotificationAccordee(): boolean {
  return typeof Notification !== "undefined" && Notification.permission === "granted";
}

/** Corps heartbeat v2 : le front ne notifie que si visible ET permission. */
function payloadHeartbeat(): { visible: boolean; canNotify: boolean } {
  const visible = ongletVisible();
  return { visible, canNotify: visible && permissionNotificationAccordee() };
}

/** Envoie un heartbeat (best-effort, silencieux) si le daemon est détecté présent. */
function envoyerHeartbeat(): void {
  if (!daemonSupporte("alerts")) return;
  try {
    void fetch(urlDaemon("/heartbeat"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payloadHeartbeat()),
    }).catch(() => {});
  } catch {
    /* best-effort */
  }
}

/**
 * Démarre le heartbeat périodique + un push initial des défs au daemon une fois
 * celui-ci confirmé présent. Renvoie une fonction d'arrêt.
 */
function demarrerHeartbeat(): Unsubscribe {
  let arrete = false;
  // Détection (mémoïsée) : au succès, on sème les défs courantes et on bat le cœur.
  void detectDaemon(["alerts", "kv"]).then((present) => {
    if (!present || arrete) return;
    pousserDefsDaemon();
    envoyerHeartbeat();
  });
  // Le relais change dès que l'onglet est masqué, sans fenêtre muette de 30 secondes.
  const documentHeartbeat = typeof document !== "undefined" ? document : undefined;
  documentHeartbeat?.addEventListener("visibilitychange", envoyerHeartbeat);
  const timer = setInterval(envoyerHeartbeat, HEARTBEAT_MS);
  return () => {
    arrete = true;
    clearInterval(timer);
    documentHeartbeat?.removeEventListener("visibilitychange", envoyerHeartbeat);
  };
}

// ───────── Notification système + bip WebAudio (best-effort) ─────────

/**
 * Demande la permission de notification si elle n'a pas encore été décidée.
 * À appeler depuis un geste utilisateur (contrainte navigateur). Sans effet si refusée/accordée.
 */
export function demanderPermissionNotifications(): void {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  } catch {
    /* API absente / bloquée : best-effort */
  }
}

/** Notifie un déclenchement : Notification API seulement si onglet visible ET permission. */
export function notifier(d: Declenchement): void {
  try {
    if (ongletVisible() && permissionNotificationAccordee()) {
      new Notification("AXIOM — alerte", { body: d.message });
    }
  } catch {
    /* best-effort */
  }
  bip();
}

type AudioCtor = typeof AudioContext;
let audioCtx: AudioContext | null = null;

/** Récupère le constructeur AudioContext (préfixe webkit sur certains navigateurs). */
function ctorAudio(): AudioCtor | undefined {
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext;
}

/** Bip court et discret (oscillateur sinus ~120 ms, volume faible). */
function bip(): void {
  try {
    const Ctor = ctorAudio();
    if (!Ctor) return;
    if (!audioCtx) audioCtx = new Ctor();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.05; // discret
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const t = audioCtx.currentTime;
    osc.start(t);
    osc.stop(t + 0.12);
  } catch {
    /* audio best-effort (contexte non repris tant qu'aucun geste utilisateur) */
  }
}
