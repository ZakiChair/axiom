/**
 * Synchronisation MULTI-FENÊTRES navigateur (Phase 4) — via `BroadcastChannel`.
 *
 * Objectif : ouvrir AXIOM dans plusieurs fenêtres/onglets (ou plusieurs fenêtres
 * Chrome `--app`) et garder le SYMBOLE actif et le THÈME cohérents entre elles, SANS
 * mutualiser les WebSocket (anti-objectif BUILD-CONTRACT : PAS de SharedWorker — chaque
 * fenêtre garde ses propres connexions de marché). Léger (~100 lignes), best-effort :
 * si `BroadcastChannel` est indisponible, tout est un no-op (aucune régression).
 *
 * Anti-boucle : chaque message porte l'ID de la fenêtre émettrice (`WINDOW_ID`) — on
 * ignore les siens. En plus, pendant qu'on APPLIQUE un changement distant, un drapeau
 * `applying` empêche l'abonnement local de le re-diffuser (sinon ping-pong entre fenêtres).
 *
 * Le crosshair inter-fenêtres est volontairement HORS périmètre ici (le crosshair
 * synchronisé entre SLOTS d'une même fenêtre est géré dans ChartInstance) : diffuser un
 * flux crosshair haute fréquence entre fenêtres n'apporte pas assez pour son coût.
 */
import type { ExchangeId } from "@axiom/types";
import { marketStore } from "./market";
import { themeStore, THEMES, type ThemeId } from "./theme";

/** Nom du canal partagé entre toutes les fenêtres de l'app. */
const CHANNEL_NAME = "axiom:sync";

/** Identité de CETTE fenêtre (anti-écho). Stable pour la session. */
export const WINDOW_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Sources reconnues (garde de validation d'un message distant). */
const ALLOWED_EXCHANGES: readonly ExchangeId[] = [
  "binance",
  "kraken",
  "coinbase",
  "twelvedata",
  "mexc",
];

/** Messages diffusés entre fenêtres. */
export type SyncMessage =
  | { kind: "symbol"; sender: string; exchange: ExchangeId; symbol: string }
  | { kind: "theme"; sender: string; theme: ThemeId };

/**
 * Interprète un message entrant (fonction PURE, testée). Renvoie le message typé s'il
 * doit être APPLIQUÉ, ou `null` s'il faut l'ignorer : émetteur = nous (`myId`), forme
 * invalide, ou valeur hors référentiel. Ne touche à aucun store.
 */
export function interpretMessage(raw: unknown, myId: string): SyncMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.sender !== "string" || m.sender === myId) return null; // notre propre écho

  if (m.kind === "symbol") {
    if (typeof m.symbol !== "string" || m.symbol.length === 0) return null;
    if (typeof m.exchange !== "string" || !(ALLOWED_EXCHANGES as string[]).includes(m.exchange)) return null;
    return { kind: "symbol", sender: m.sender, exchange: m.exchange as ExchangeId, symbol: m.symbol };
  }
  if (m.kind === "theme") {
    if (typeof m.theme !== "string" || !(THEMES as readonly string[]).includes(m.theme)) return null;
    return { kind: "theme", sender: m.sender, theme: m.theme as ThemeId };
  }
  return null;
}

/**
 * Démarre la synchro multi-fenêtres. Renvoie une fonction d'arrêt (ferme le canal +
 * désabonne). No-op silencieux si `BroadcastChannel` est indisponible.
 */
export function demarrerSyncFenetres(): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};

  const channel = new BroadcastChannel(CHANNEL_NAME);
  // Vrai pendant l'application d'un changement DISTANT → empêche l'abonnement local de
  // le re-diffuser (anti-boucle, en plus du filtrage par `sender`).
  let applying = false;

  const post = (msg: SyncMessage): void => {
    try {
      channel.postMessage(msg);
    } catch {
      /* best-effort : la diffusion n'est jamais bloquante */
    }
  };

  // Diffuse le SYMBOLE/SOURCE du store global (slot maître) quand ils changent (pas sur tick).
  const unsubMarket = marketStore.subscribe((state, prev) => {
    if (applying) return;
    if (state.symbol !== prev.symbol || state.exchange !== prev.exchange) {
      post({ kind: "symbol", sender: WINDOW_ID, exchange: state.exchange, symbol: state.symbol });
    }
  });

  // Diffuse le THÈME quand il change.
  const unsubTheme = themeStore.subscribe((state, prev) => {
    if (applying) return;
    if (state.theme !== prev.theme) {
      post({ kind: "theme", sender: WINDOW_ID, theme: state.theme });
    }
  });

  channel.onmessage = (event: MessageEvent): void => {
    const msg = interpretMessage(event.data, WINDOW_ID);
    if (!msg) return;
    applying = true;
    try {
      if (msg.kind === "symbol") {
        marketStore.getState().setExchange(msg.exchange);
        marketStore.getState().setSymbol(msg.symbol);
      } else {
        themeStore.getState().setTheme(msg.theme);
      }
    } finally {
      applying = false;
    }
  };

  return () => {
    unsubMarket();
    unsubTheme();
    try {
      channel.close();
    } catch {
      /* best-effort */
    }
  };
}
