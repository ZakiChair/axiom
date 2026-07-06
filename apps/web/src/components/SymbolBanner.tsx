/**
 * SymbolBanner — bandeau d'en-tête du graphe (monté DANS le conteneur du chart,
 * en surimpression haut-gauche). Affiche : dernier prix, variation 24 h, haut/bas
 * 24 h, volume 24 h et le COMPTE À REBOURS de clôture de la bougie courante.
 *
 * Contrat de perf (comme Watchlist) : AUCUN re-render React sur tick. Le symbole et
 * le timeframe (basse fréquence) viennent d'un sélecteur Zustand (re-render admis à
 * leur changement) ; TOUT le reste (haute fréquence) est écrit IMPÉRATIVEMENT dans le
 * DOM via des refs. Deux sources :
 *  - variation 24 h : abonnement `subscribeTickers` existant (data/ticker.ts) ;
 *  - prix / H-L / volume : dérivés du buffer de bougies (marketStore), fenêtre 24 h.
 */
import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import type { Candle, Timeframe } from "@axiom/types";
import { marketStore } from "../store/market";
import { classifyTradfi, isMarketOpen, subscribeTickers } from "../data/ticker";
import { formatSyntheticLabel, parseSyntheticSymbol } from "../data/synthetic";

/** Durée (ms) d'une bougie pour les timeframes à pas FIXE. */
export const TF_DURATION_MS: Partial<Record<Timeframe, number>> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
  "1w": 604_800_000,
};

/**
 * Horodatage (ms) de clôture de la bougie ouverte à `openTime` pour le timeframe `tf`.
 * Pas fixe : `openTime + durée`. TF calendaires (1M/3M/6M/12M) : début du bucket
 * calendaire suivant en UTC (gère le passage d'année). PURE & testée.
 */
export function nextCloseTs(openTime: number, tf: Timeframe): number {
  const ms = TF_DURATION_MS[tf];
  if (ms !== undefined) return openTime + ms;
  const months = tf === "1M" ? 1 : tf === "3M" ? 3 : tf === "6M" ? 6 : tf === "12M" ? 12 : 0;
  if (months > 0) {
    const d = new Date(openTime);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1);
  }
  return openTime; // timeframe inconnu : pas de rebours (rebours nul).
}

/** Formate un reste en ms → « H:MM:SS » (≥ 1 h) ou « MM:SS ». Négatif borné à 0. PURE & testée. */
export function formatCountdown(remainingMs: number): string {
  const s = Math.max(0, Math.floor(remainingMs / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** Statistiques haut/bas/volume sur les 24 dernières heures. */
export interface Rolling24h {
  high: number;
  low: number;
  volume: number;
}

/**
 * Haut/bas/volume sur les bougies dont l'ouverture est ≥ `referenceMs − 24 h`. Le buffer
 * étant trié par temps croissant, on parcourt depuis la fin et on s'arrête au franchissement
 * de la borne. Renvoie null si aucune bougie dans la fenêtre. PURE & testée.
 *
 * APPROXIMATION (documentée) : si le buffer couvre MOINS de 24 h (ex. 500 bougies 1 m ≈ 8 h
 * avant pagination), la fenêtre se réduit aux bougies disponibles — les valeurs sont alors
 * « sur l'historique chargé », pas strictement 24 h.
 */
export function rolling24h(candles: Candle[], referenceMs: number): Rolling24h | null {
  const cutoff = referenceMs - 86_400_000;
  let high = -Infinity;
  let low = Infinity;
  let volume = 0;
  let count = 0;
  for (let i = candles.length - 1; i >= 0; i--) {
    const c = candles[i];
    if (c === undefined) continue;
    if (c.time < cutoff) break; // buffer trié croissant : tout ce qui précède est hors fenêtre.
    if (c.high > high) high = c.high;
    if (c.low < low) low = c.low;
    volume += c.volume;
    count++;
  }
  return count === 0 ? null : { high, low, volume };
}

/** Formate un prix avec un nombre de décimales adapté à sa magnitude. PURE & testée. */
export function formatPrice(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return "—";
  const decimals = p >= 1 ? 2 : p >= 0.01 ? 4 : 6;
  return p.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Formate un volume en notation compacte (K/M/B). PURE & testée. */
export function formatCompact(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return v.toFixed(2);
}

/** Formate une variation en pourcentage signé. PURE & testée. */
export function formatPercent(p: number): string {
  if (!Number.isFinite(p)) return "—";
  return `${p >= 0 ? "+" : ""}${p.toFixed(2)}%`;
}

export function SymbolBanner() {
  const exchange = useStore(marketStore, (s) => s.exchange);
  const symbol = useStore(marketStore, (s) => s.symbol);
  const timeframe = useStore(marketStore, (s) => s.timeframe);
  const syntheticSpec = exchange === "synthetic" ? parseSyntheticSymbol(symbol) : null;
  const bannerSymbol = syntheticSpec ? formatSyntheticLabel(syntheticSpec) : symbol;
  const hasClosedTradfiLeg = syntheticSpec !== null && (
    (syntheticSpec.exA === "twelvedata" && !isMarketOpen(classifyTradfi(syntheticSpec.legA), new Date())) ||
    (syntheticSpec.exB === "twelvedata" && !isMarketOpen(classifyTradfi(syntheticSpec.legB), new Date()))
  );

  const priceRef = useRef<HTMLSpanElement>(null);
  const changeRef = useRef<HTMLSpanElement>(null);
  const highRef = useRef<HTMLSpanElement>(null);
  const lowRef = useRef<HTMLSpanElement>(null);
  const volRef = useRef<HTMLSpanElement>(null);
  const countdownRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    // Dernière variation 24 h connue (source ticker) : sert au texte ET à la couleur du prix.
    let changePct = Number.NaN;

    /** Applique la teinte up/down (token de thème) au prix et à la variation. */
    const applyColor = (): void => {
      const color = !Number.isFinite(changePct)
        ? "var(--text)"
        : changePct >= 0
          ? "var(--up)"
          : "var(--down)";
      if (priceRef.current) priceRef.current.style.color = color;
      if (changeRef.current) changeRef.current.style.color = color;
    };

    /** Recalcule prix + H/L/volume 24 h depuis le buffer de bougies (écritures DOM directes). */
    const updateFromCandles = (): void => {
      const candles = marketStore.getState().candles;
      const last = candles.at(-1);
      if (last === undefined) {
        if (priceRef.current) priceRef.current.textContent = "—";
        if (highRef.current) highRef.current.textContent = "—";
        if (lowRef.current) lowRef.current.textContent = "—";
        if (volRef.current) volRef.current.textContent = "—";
        return;
      }
      if (priceRef.current) priceRef.current.textContent = formatPrice(last.close);
      const stats = rolling24h(candles, Date.now());
      if (highRef.current) highRef.current.textContent = stats ? formatPrice(stats.high) : "—";
      if (lowRef.current) lowRef.current.textContent = stats ? formatPrice(stats.low) : "—";
      if (volRef.current) volRef.current.textContent = stats ? formatCompact(stats.volume) : "—";
      applyColor();
    };

    /** Recalcule le compte à rebours de clôture de la bougie courante. */
    const updateCountdown = (): void => {
      const last = marketStore.getState().candles.at(-1);
      if (countdownRef.current) {
        countdownRef.current.textContent = last
          ? formatCountdown(nextCloseTs(last.time, timeframe) - Date.now())
          : "—";
      }
    };

    // État initial (le backfill a pu déjà remplir le buffer avant ce montage).
    updateFromCandles();
    updateCountdown();

    // Variation 24 h : ticker existant (routé par source dans data/ticker.ts).
    // Une série synthétique n'a pas de ticker natif ; sa variation viendra d'une
    // dérivation dédiée plus tard, pas du flux d'une jambe arbitraire.
    const unsubTicker = exchange === "synthetic"
      ? () => {}
      : subscribeTickers([symbol], (u) => {
          changePct = u.changePercent;
          if (changeRef.current) changeRef.current.textContent = formatPercent(u.changePercent);
          applyColor();
        });

    // Prix / H-L / volume : chaque tick du buffer marché (haute fréquence, DOM impératif).
    const unsubMarket = marketStore.subscribe(updateFromCandles);

    // Compte à rebours : 1 Hz.
    const timer = window.setInterval(updateCountdown, 1000);

    return () => {
      unsubTicker();
      unsubMarket();
      window.clearInterval(timer);
    };
  }, [symbol, timeframe]);

  return (
    <div className="pointer-events-none absolute left-2 top-2 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-border bg-surface/80 px-2.5 py-1 font-mono text-xs text-text-dim backdrop-blur-sm">
      <span className="font-semibold text-text">{bannerSymbol}</span>
      {hasClosedTradfiLeg && (
        <span className="text-text-dim">jambe tradfi : dernier close (marché fermé)</span>
      )}
      <span className="text-text-dim">{timeframe}</span>
      <span ref={priceRef} className="font-semibold text-text">
        —
      </span>
      <span ref={changeRef}>—</span>
      <span>
        H <span ref={highRef} className="text-text">—</span>
      </span>
      <span>
        L <span ref={lowRef} className="text-text">—</span>
      </span>
      <span>
        Vol <span ref={volRef} className="text-text">—</span>
      </span>
      <span>
        ⏱ <span ref={countdownRef} className="text-text">—</span>
      </span>
    </div>
  );
}
