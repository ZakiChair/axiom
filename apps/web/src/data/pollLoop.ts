/**
 * Boucle de polling REST partagée (MEXC, Twelve Data klines, Twelve Data quotes) —
 * sources sans flux temps réel gratuit qui simulent le live par rafraîchissement
 * périodique. Centralise le cycle de vie générique (cancelled + AbortController +
 * setInterval/clearInterval) ; `tick` fournit sa propre logique de fetch + callbacks
 * (nombre d'appels variable selon la source) et consulte `isCancelled()` après tout
 * `await` pour ne pas livrer un résultat obsolète après désabonnement.
 *
 * Robustesse (roadmap 0.2d) :
 *  - garde anti-chevauchement : aucun tick ne démarre si le précédent est encore en
 *    cours (un fetch lent ne se superpose pas au cycle suivant) ;
 *  - backoff léger sur erreurs consécutives : après une erreur, on saute des cycles
 *    (délai croissant plafonné) au lieu de marteler une source en panne/quota épuisé ;
 *  - `onError` optionnel : l'erreur est surfacée (au lieu d'être silencieusement avalée) ;
 *  - `source` optionnel : report d'état (polling/error/closed) dans le healthStore.
 *
 * Suspension onglet masqué (`suspendreSiMasque`, opt-in — cf. suggestion 20) :
 * un poller marqué suspendable ne tire plus tant que `document.visibilityState`
 * vaut "hidden", et reprend par UN SEUL rafraîchissement si la période est dépassée
 * (jamais un rattrapage des ticks manqués). L'option est **opt-in** : sans elle, le
 * poller reste actif en fond — c'est le défaut sûr.
 *
 * QUI RESTE ACTIF EN FOND, ET POURQUOI (le daemon n'évalue les alertes onglet fermé
 * que pour `source === "binance"`, cf. apps/daemon/src/marketFeed.ts) :
 *  - `ticker.ts` pollCryptoTickers (kraken/coinbase/mexc) et pollTradfiQuotes
 *    (Twelve Data /quote) : ils alimentent `subscribeTickers`, dont dépend
 *    l'évaluation des alertes `prix-croise` sur les sources NON binance. Aucun relais
 *    daemon → les suspendre casserait les notifications onglet masqué.
 *  - `mexc.ts` et `twelvedata.ts` subscribeKline : ils alimentent `marketStore`, dont
 *    dépend l'évaluation des conditions `variation-pct` / `indicateur-*` sur le symbole
 *    affiché. Même raison — non relayées par le daemon hors binance. Le quota Twelve
 *    Data continue donc d'être consommé en fond : c'est un coût assumé, moindre que la
 *    perte d'une alerte.
 *  - Le battement de cœur vers le daemon ne passe PAS par `pollLoop` (aucun appelant
 *    ici) : il n'est pas concerné par cette suspension.
 * Sont suspendables (affichage seul, aucun consommateur d'alerte) : la veille news
 * (`news.ts`) et les barres de watchlist (`ticker.ts` subscribeWatchlistBars).
 */
import type { Unsubscribe } from "@axiom/types";
import { healthStore } from "../store/health";

/** Plafond du backoff de polling (ms). */
const MAX_POLL_BACKOFF_MS = 60_000;

/**
 * Délai de backoff (ms) après `consecutiveErrors` erreurs consécutives : 0 si aucune
 * erreur, sinon `intervalMs * 2^(n-1)` plafonné. PURE & testée. Exemple pour
 * intervalMs=5000 : 1→5s, 2→10s, 3→20s, …, plafonné à 60s.
 */
export function pollBackoffMs(consecutiveErrors: number, intervalMs: number): number {
  if (consecutiveErrors <= 0) return 0;
  const exp = Math.min(consecutiveErrors - 1, 6); // borne l'exposant pour éviter l'overflow
  return Math.min(MAX_POLL_BACKOFF_MS, intervalMs * 2 ** exp);
}

export interface PollLoopOptions {
  /** Premier cycle immédiat (sans attendre le 1er intervalle). */
  immediate?: boolean;
  /** Rappelé sur erreur de `tick` (réseau/quota/parse) avec le nombre d'erreurs consécutives. */
  onError?: (err: unknown, consecutiveErrors: number) => void;
  /** Identifiant de source pour le registre santé (report polling/error/closed). */
  source?: string;
  /**
   * Suspend les cycles tant que l'onglet est masqué (opt-in). À réserver aux pollers
   * d'AFFICHAGE : un poller alimentant l'évaluation des alertes doit rester actif.
   */
  suspendreSiMasque?: boolean;
}

export function pollLoop(
  tick: (signal: AbortSignal, isCancelled: () => boolean) => Promise<void>,
  intervalMs: number,
  opts?: PollLoopOptions,
): Unsubscribe {
  let cancelled = false;
  let running = false; // garde anti-chevauchement
  let consecutiveErrors = 0;
  let nextAllowedTs = 0; // aucun tick avant cet instant (backoff)
  let dernierTickTs = 0; // début du dernier cycle lancé (0 = aucun)
  const controller = new AbortController();
  const source = opts?.source;
  const suspendable = opts?.suspendreSiMasque === true;

  const run = async () => {
    if (cancelled || running) return; // pas de tick chevauchant le précédent
    if (suspendable && estMasque()) return; // onglet masqué : cycle sauté
    if (Date.now() < nextAllowedTs) return; // backoff en cours après erreurs
    running = true;
    dernierTickTs = Date.now();
    try {
      await tick(controller.signal, () => cancelled);
      consecutiveErrors = 0;
      nextAllowedTs = 0;
      if (source && !cancelled) {
        healthStore.getState().setEtat(source, "polling", { dernierMessageTs: Date.now() });
      }
    } catch (err) {
      consecutiveErrors += 1;
      nextAllowedTs = Date.now() + pollBackoffMs(consecutiveErrors, intervalMs);
      if (source) healthStore.getState().marquerErreur(source, errorMessage(err));
      opts?.onError?.(err, consecutiveErrors);
    } finally {
      running = false;
    }
  };

  if (opts?.immediate) void run();
  let timer = setInterval(() => void run(), intervalMs);

  // Reprise de visibilité : UN seul rafraîchissement si la période est dépassée, et
  // l'intervalle repart de la reprise (sinon un tick déjà programmé doublerait l'appel).
  const onVisibilite = () => {
    if (cancelled || estMasque()) return;
    if (Date.now() - dernierTickTs < intervalMs) return; // période non dépassée : rien
    clearInterval(timer);
    timer = setInterval(() => void run(), intervalMs);
    void run();
  };
  const cible = suspendable ? cibleVisibilite() : null;
  cible?.addEventListener("visibilitychange", onVisibilite);

  return () => {
    cancelled = true;
    controller.abort();
    clearInterval(timer);
    cible?.removeEventListener("visibilitychange", onVisibilite);
    if (source) healthStore.getState().setEtat(source, "closed");
  };
}

/** `document` s'il expose les écouteurs (absent en environnement Node sans DOM). */
function cibleVisibilite(): Pick<Document, "addEventListener" | "removeEventListener"> | null {
  return typeof document !== "undefined" && typeof document.addEventListener === "function"
    ? document
    : null;
}

/** Onglet masqué ? `false` si `document` n'existe pas (environnement Node). */
function estMasque(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/** Message lisible d'une erreur inconnue. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
