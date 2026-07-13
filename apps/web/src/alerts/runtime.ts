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
 *
 * CVD spot/perp-div : support moteur OK, injection runtime reportée v1.1 (données
 * dans le contrôleur chart orderflow, hors store — cf. lot B1).
 *
 * DÉGRADATION ONGLET FERMÉ (B1.6) : le daemon n'a PAS encore de poll funding (lot D3).
 * Avec l'app fermée, seules prix / var% / indicateur-seuil|croisement s'évaluent.
 * Les alertes `funding-extreme` (et CVD) restent dormantes côté daemon jusqu'à D3.
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
import { alertsStore, pousserDefsDaemon } from "../store/alerts";
import { subscribeTickers, type TickerUpdate } from "../data/ticker";
import { daemonPret, detectDaemon } from "../data/daemon";
import { coinalyzeProvider } from "../data/coinalyze";
import { extUrl } from "../data/extapi";

/** Types de condition évalués sur la clôture de bougie (nécessitent les bougies). */
const TYPES_BOUGIE = new Set(["variation-pct", "indicateur-seuil", "indicateur-croisement"]);

/** Période de poll funding (ms) — lent, hors chemin chaud. */
const FUNDING_POLL_MS = 60_000;
/** Fenêtre min. d'historique funding pour un z-score (points). */
const FUNDING_Z_WINDOW = 30;

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

  // Démarrage : souscriptions + calibrage immédiat contre l'état courant.
  resyncTicker();
  resyncFunding();
  const unsubAlerts = alertsStore.subscribe(() => {
    resyncTicker(); // re-route si la liste des symboles change
    resyncFunding();
  });
  const unsubMarket = marketStore.subscribe(onMarket);
  onMarket(); // calibrage initial des conditions bougie sur le backfill présent

  const stopHeartbeat = demarrerHeartbeat();

  return () => {
    unsubAlerts();
    unsubMarket();
    unsubTicker();
    stopHeartbeat();
    if (fundingTimer !== undefined) clearInterval(fundingTimer);
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

/**
 * Base d'URL du daemon (miroir de data/daemon.ts, non exporté là-bas) :
 *  - DEV  : front sous Vite (5173), daemon sur 8787 → 127.0.0.1:8787 ;
 *  - PROD : front servi par le daemon → même origine.
 */
function baseDaemon(): string {
  if (import.meta.env.DEV) return "http://127.0.0.1:8787";
  if (typeof window !== "undefined") return window.location.origin;
  return "http://127.0.0.1:8787";
}

/** Envoie un heartbeat (best-effort, silencieux) si le daemon est détecté présent. */
function envoyerHeartbeat(): void {
  if (!daemonPret()) return;
  try {
    void fetch(baseDaemon() + "/heartbeat", { method: "POST" }).catch(() => {});
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
  void detectDaemon().then((present) => {
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
function notifier(d: Declenchement): void {
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
