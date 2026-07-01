/**
 * Runtime des alertes — pont entre le moteur PUR (`@axiom/alerts`) et les flux live.
 *
 * Deux sources d'évaluation, sans chevauchement de types de condition (donc aucun
 * double déclenchement) :
 *  - FLUX TICKER (`subscribeTickers`) sur les symboles des alertes prix : évalue les
 *    conditions `prix-croise` à chaque mise à jour de prix (tous symboles). Le prix
 *    précédent est mémorisé par symbole (nécessaire au sens `les-deux`).
 *  - CLÔTURE DE BOUGIE (abonnement `marketStore`) sur le symbole affiché : évalue les
 *    conditions `variation-pct` et `indicateur-*` à chaque nouvelle bougie CLÔTURÉE
 *    (ces conditions requièrent les bougies, présentes uniquement pour le symbole affiché).
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

/** Types de condition évalués sur la clôture de bougie (nécessitent les bougies). */
const TYPES_BOUGIE = new Set(["variation-pct", "indicateur-seuil", "indicateur-croisement"]);

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

  // Démarrage : souscriptions + calibrage immédiat contre l'état courant.
  resyncTicker();
  const unsubAlerts = alertsStore.subscribe(resyncTicker); // re-route si la liste des symboles change
  const unsubMarket = marketStore.subscribe(onMarket);
  onMarket(); // calibrage initial des conditions bougie sur le backfill présent

  const stopHeartbeat = demarrerHeartbeat();

  return () => {
    unsubAlerts();
    unsubMarket();
    unsubTicker();
    stopHeartbeat();
  };
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
