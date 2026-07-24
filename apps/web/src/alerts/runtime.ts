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
 *    l'ensemble scanné (diff, hors cooldown 6 h) sont journalisés + notifiés. Scan LOURD →
 *    garde de visibilité en tête de tick. Front-only (pas de couverture daemon).
 *
 * ONGLET FERMÉ : le daemon évalue aussi `funding-extreme` (poll premiumIndex ~60 s,
 * lot D3) ET `liq-cascade` (tick 10 s sur sa table `liquidations` ingérée Bybit+OKX,
 * tous les symboles d'alerte — ingestion d'un nouveau symbole ≤60 s). Seul CVD
 * spot/perp-div reste dormant côté daemon (pas de pipeline orderflow).
 *
 * Un déclenchement → journal du store + notification système (Notification API) + bip
 * discret (WebAudio, aucun fichier binaire). AUCUNE donnée haute fréquence ne transite
 * par React : le store n'est écrit que sur transition d'état (cf. BUILD-CONTRACT).
 *
 * Aucune modification de Chart.tsx : on lit `marketStore` en aval, sans le piloter.
 */
import { evaluerAlertes, type AlertDef, type ContexteAlerte, type Declenchement } from "@axiom/alerts";
import type { Unsubscribe } from "@axiom/types";
import { marketStore } from "../store/market";
import { fluxLiqRetenu, liqEventsStore } from "../chart/liquidationMarkers";
import { usdParMinute } from "../components/liquidationsWindow.util";
import { alertsStore, pousserDefsDaemon } from "../store/alerts";
import { cvdDivergenceStore } from "../store/cvd-divergence";
import { regimeStore } from "../store/regime";
import { orderflowStore } from "../store/orderflow";
import { presetAlertsStore, diffEntrants, filtrerCooldown } from "../store/presetAlerts";
import { subscribeTickers, type TickerUpdate } from "../data/ticker";
import { daemonSupporte, detectDaemon, urlDaemon } from "../data/daemon";
import { coinalyzeProvider } from "../data/coinalyze";
import { executerScreener } from "../data/screenerRun";
import { SCREENER_POSITION_CAP } from "../data/screener";
import { extUrl } from "../data/extapi";

/** Types de condition évalués sur la clôture de bougie (nécessitent les bougies). */
const TYPES_BOUGIE = new Set(["variation-pct", "indicateur-seuil", "indicateur-croisement"]);

/** Période de poll funding (ms) — lent, hors chemin chaud. */
const FUNDING_POLL_MS = 60_000;
/** Période d'évaluation de `liq-cascade` (ms) — le poll fait aussi RETOMBER la fenêtre
 *  glissante sous le seuil (ré-armement) quand le flux se calme. */
const LIQ_CASCADE_POLL_MS = 5_000;
/** Fenêtre min. d'historique funding pour un z-score (points). */
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
  /** Dernier prix vu par symbole (pour le `prixPrecedent` du sens `les-deux`). */
  const dernierPrix = new Map<string, number>();

  // ── Flux ticker : conditions prix-croise ──────────────────────────────────
  const onTicker = ({ symbol, price }: TickerUpdate): void => {
    if (!Number.isFinite(price)) return;
    const lot = alertsStore
      .getState()
      .defs.filter((d) => d.actif && d.symbol === symbol && d.condition.type === "prix-croise");
    if (lot.length > 0) {
      appliquerResultat(lot, {
        maintenant: Date.now(),
        dernierPrix: price,
        prixPrecedent: dernierPrix.get(symbol),
      });
    }
    dernierPrix.set(symbol, price);
  };

  // (Re)souscription du flux ticker quand l'ENSEMBLE des symboles à alertes prix change.
  let unsubTicker: Unsubscribe = () => {};
  let cleTicker = "";
  const resyncTicker = (): void => {
    const symbols = [
      ...new Set(
        alertsStore
          .getState()
          .defs.filter((d) => d.actif && d.condition.type === "prix-croise")
          .map((d) => d.symbol)
      ),
    ].sort();
    const cle = symbols.join(",");
    if (cle === cleTicker) return; // ensemble inchangé → on garde la souscription en place
    cleTicker = cle;
    unsubTicker();
    unsubTicker = subscribeTickers(symbols, onTicker);
  };

  // ── Clôture de bougie : conditions variation-pct + indicateur-* ────────────
  let dernierSymbole = "";
  let dernierTempsCloture = 0;
  const onMarket = (): void => {
    const { symbol, candles } = marketStore.getState();
    // Changement de symbole (backfill) : on réinitialise le suivi de clôture.
    if (symbol !== dernierSymbole) {
      dernierSymbole = symbol;
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

    const lot = alertsStore
      .getState()
      .defs.filter((d) => d.actif && d.symbol === symbol && TYPES_BOUGIE.has(d.condition.type));
    if (lot.length === 0) return;
    const avant = candles[idxClose - 1];
    appliquerResultat(lot, {
      maintenant: Date.now(),
      dernierPrix: barreClose.close,
      prixPrecedent: avant?.close,
      candles: candles.slice(0, idxClose + 1), // bougies clôturées uniquement
    });
  };

  // ── Poll funding : conditions funding-extreme ─────────────────────────────
  // Cache par symbole : rate courant + z-score optionnel (historique Coinalyze).
  const cacheFunding = new Map<string, { rate: number; z?: number; ts: number }>();

  const evaluerFundingSymbol = (symbol: string): void => {
    const snap = cacheFunding.get(symbol);
    if (!snap) return;
    const lot = alertsStore
      .getState()
      .defs.filter((d) => d.actif && d.symbol === symbol && d.condition.type === "funding-extreme");
    if (lot.length === 0) return;
    const mkt = marketStore.getState();
    const lastCandle =
      mkt.symbol === symbol ? mkt.candles[mkt.candles.length - 1] : undefined;
    appliquerResultat(lot, {
      maintenant: Date.now(),
      dernierPrix: lastCandle?.close ?? 0,
      fundingRate: snap.rate,
      fundingZScore: snap.z,
    });
  };

  const pollFunding = async (): Promise<void> => {
    const symbols = [
      ...new Set(
        alertsStore
          .getState()
          .defs.filter((d) => d.actif && d.condition.type === "funding-extreme")
          .map((d) => d.symbol)
      ),
    ];
    for (const symbol of symbols) {
      const snap = await chargerFunding(symbol);
      if (!snap) continue;
      cacheFunding.set(symbol, { ...snap, ts: Date.now() });
      evaluerFundingSymbol(symbol);
    }
  };

  let fundingTimer: ReturnType<typeof setInterval> | undefined;
  const resyncFunding = (): void => {
    const aDesFunding = alertsStore
      .getState()
      .defs.some((d) => d.actif && d.condition.type === "funding-extreme");
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
    const symbol = marketStore.getState().symbol;
    const lot = alertsStore
      .getState()
      .defs.filter((d) => d.actif && d.symbol === symbol && d.condition.type === "liq-cascade");
    if (lot.length === 0) return;
    // Événements RÉELS uniquement : le seed Coinalyze (`approx`) est agrégé par bougie
    // et gonflerait artificiellement la minute glissante.
    const reels = liqEventsStore.getState().events.filter((ev) => ev.approx !== true);
    const nowMs = Date.now();
    const mkt = marketStore.getState();
    const lastCandle = mkt.candles[mkt.candles.length - 1];
    appliquerResultat(lot, {
      maintenant: nowMs,
      dernierPrix: lastCandle?.close ?? 0,
      liqUsdParMin: usdParMinute(reels, nowMs),
    });
  };

  let liqCascadeTimer: ReturnType<typeof setInterval> | undefined;
  const resyncLiqCascade = (): void => {
    const aDesCascade = alertsStore
      .getState()
      .defs.some((d) => d.actif && d.condition.type === "liq-cascade");
    if (aDesCascade && liqCascadeTimer === undefined) {
      evaluerLiqCascade();
      liqCascadeTimer = setInterval(evaluerLiqCascade, LIQ_CASCADE_POLL_MS);
    } else if (!aDesCascade && liqCascadeTimer !== undefined) {
      clearInterval(liqCascadeTimer);
      liqCascadeTimer = undefined;
    }
  };

  // ── CVD spot/perp-div : pont orderflow → moteur ─────────────────────────
  const evaluerCvdSymbol = (symbol: string): void => {
    const kind = cvdDivergenceStore.getState().bySymbol[symbol.toUpperCase()];
    // Clé absente → undefined : non évaluable (pipeline off).
    if (kind === undefined) return;
    const lot = alertsStore
      .getState()
      .defs.filter((d) => d.actif && d.symbol === symbol && d.condition.type === "cvd-spot-perp-div");
    if (lot.length === 0) return;
    const mkt = marketStore.getState();
    const lastCandle =
      mkt.symbol === symbol ? mkt.candles[mkt.candles.length - 1] : undefined;
    appliquerResultat(lot, {
      maintenant: Date.now(),
      dernierPrix: lastCandle?.close ?? 0,
      cvdDivergenceKind: kind,
    });
  };

  /** Active orderflow + CVD S/P si au moins une alerte CVD active (Binance). */
  const assurerPipelineCvd = (): void => {
    const aDesCvd = alertsStore
      .getState()
      .defs.some((d) => d.actif && d.condition.type === "cvd-spot-perp-div");
    if (!aDesCvd) return;
    const of = orderflowStore.getState();
    if (!of.enabled) of.setEnabled(true);
    if (!of.cvdSpotPerp) of.setCvdSpotPerp(true);
  };

  const unsubCvd = cvdDivergenceStore.subscribe((s, prev) => {
    // Évalue seulement les symboles dont le kind a changé.
    for (const [sym, kind] of Object.entries(s.bySymbol)) {
      if (prev.bySymbol[sym] !== kind) evaluerCvdSymbol(sym);
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
    // Garde visibilité en tête : un scan est LOURD (réseau + worker), inutile onglet caché.
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
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
    } catch {
      // Scan best-effort : un échec réseau ne casse ni la baseline ni le timer.
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
  assurerPipelineCvd();
  // Calibrage CVD sur l'état déjà publié (si orderflow déjà actif).
  for (const sym of Object.keys(cvdDivergenceStore.getState().bySymbol)) {
    evaluerCvdSymbol(sym);
  }
  evaluerRegime(); // calibrage régime sur le score déjà publié
  const unsubAlerts = alertsStore.subscribe(() => {
    resyncTicker(); // re-route si la liste des symboles change
    resyncFunding();
    resyncLiqCascade();
    assurerPipelineCvd();
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

  // 3) Z-score sur historique 8h Coinalyze (fenêtre FUNDING_Z_WINDOW).
  let z: number | undefined;
  try {
    const since = Date.now() - FUNDING_Z_WINDOW * 8 * 3_600_000;
    const hist = await coinalyzeProvider.fetchFundingRateHistory(symbol, "8hour", since);
    const rates = hist.map((h) => h.rate).filter((v) => Number.isFinite(v));
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
// Tant que l'app est OUVERTE, elle POST /heartbeat toutes les 30 s. Le daemon ne
// NOTIFIE (macOS/Telegram) un déclenchement que si le dernier heartbeat date de plus
// de 90 s : app ouverte → le daemon reste silencieux (l'app a déjà notifié via la
// Notification API), app fermée → le daemon prend le relais. Sans daemon détecté :
// aucun POST (silencieux, zéro régression).

/** Intervalle d'émission du heartbeat (ms). */
const HEARTBEAT_MS = 30_000;

/** Envoie un heartbeat (best-effort, silencieux) si le daemon est détecté présent. */
function envoyerHeartbeat(): void {
  if (!daemonSupporte("alerts")) return;
  try {
    void fetch(urlDaemon("/heartbeat"), { method: "POST" }).catch(() => {});
  } catch {
    /* best-effort */
  }
}

/**
 * Démarre le heartbeat périodique + un push initial des défs au daemon une fois
 * celui-ci confirmé présent. Renvoie une fonction d'arrêt.
 */
function demarrerHeartbeat(): Unsubscribe {
  // Détection (mémoïsée) : au succès, on sème les défs courantes et on bat le cœur.
  void detectDaemon(["alerts", "kv"]).then((present) => {
    if (!present) return;
    pousserDefsDaemon();
    envoyerHeartbeat();
  });
  const timer = setInterval(envoyerHeartbeat, HEARTBEAT_MS);
  return () => clearInterval(timer);
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

/** Notifie un déclenchement : notification système (si accordée) + bip discret. */
export function notifier(d: Declenchement): void {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
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
