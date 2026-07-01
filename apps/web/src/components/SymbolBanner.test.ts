/**
 * Tests des fonctions PURES du bandeau symbole (SymbolBanner). Le rendu React n'est pas
 * testé (pas d'environnement DOM ici) : on couvre le calcul du compte à rebours de bougie,
 * la fenêtre 24 h et le formatage — seuls porteurs de régressions silencieuses.
 *
 * `../data/ticker` est stubé : les helpers testés n'en dépendent pas, et le stub évite de
 * charger toute la chaîne réseau (WS/poll) à l'import du module component en environnement Node.
 */
import { describe, it, expect, vi } from "vitest";
import type { Candle } from "@axiom/types";
import {
  nextCloseTs,
  formatCountdown,
  rolling24h,
  formatPrice,
  formatCompact,
  formatPercent,
} from "./SymbolBanner";

vi.mock("../data/ticker", () => ({ subscribeTickers: () => () => {} }));

/** Fabrique une bougie minimale (seuls time/high/low/volume comptent pour rolling24h). */
function candle(time: number, high: number, low: number, volume: number): Candle {
  return { time, open: low, high, low, close: high, volume };
}

const HOUR = 3_600_000;

describe("nextCloseTs", () => {
  it("timeframes à pas fixe : openTime + durée", () => {
    expect(nextCloseTs(0, "1m")).toBe(60_000);
    expect(nextCloseTs(1_000, "5m")).toBe(1_000 + 300_000);
    expect(nextCloseTs(0, "1h")).toBe(HOUR);
    expect(nextCloseTs(0, "1d")).toBe(86_400_000);
    expect(nextCloseTs(0, "1w")).toBe(604_800_000);
  });

  it("timeframes calendaires : début du bucket suivant en UTC", () => {
    // 1M : janvier → février 2026.
    expect(nextCloseTs(Date.UTC(2026, 0, 1), "1M")).toBe(Date.UTC(2026, 1, 1));
    // 3M : Q1 (jan) → Q2 (avril).
    expect(nextCloseTs(Date.UTC(2026, 0, 1), "3M")).toBe(Date.UTC(2026, 3, 1));
    // 3M avec passage d'année : Q4 (oct) → Q1 de l'année suivante (janvier 2027).
    expect(nextCloseTs(Date.UTC(2026, 9, 1), "3M")).toBe(Date.UTC(2027, 0, 1));
    // 12M : année → année suivante.
    expect(nextCloseTs(Date.UTC(2026, 0, 1), "12M")).toBe(Date.UTC(2027, 0, 1));
  });
});

describe("formatCountdown", () => {
  it("MM:SS sous une heure, H:MM:SS au-delà", () => {
    expect(formatCountdown(65_000)).toBe("01:05"); // 1 min 5 s
    expect(formatCountdown(3_665_000)).toBe("1:01:05"); // 1 h 1 min 5 s
  });
  it("borne un reste négatif à 00:00 (bougie déjà censée close)", () => {
    expect(formatCountdown(-5_000)).toBe("00:00");
  });
});

describe("rolling24h", () => {
  it("agrège haut/bas/volume sur la fenêtre des 24 h et s'arrête au-delà", () => {
    const ref = 100 * HOUR; // référence arbitraire
    const candles = [
      candle(ref - 30 * HOUR, 10, 1, 5), // hors fenêtre (> 24 h) → ignorée
      candle(ref - 10 * HOUR, 20, 8, 7), // dans la fenêtre
      candle(ref - 1 * HOUR, 15, 9, 3), // dans la fenêtre
    ];
    expect(rolling24h(candles, ref)).toEqual({ high: 20, low: 8, volume: 10 });
  });

  it("renvoie null quand aucune bougie n'est dans la fenêtre", () => {
    const ref = 100 * HOUR;
    expect(rolling24h([], ref)).toBeNull();
    expect(rolling24h([candle(ref - 30 * HOUR, 10, 1, 5)], ref)).toBeNull();
  });
});

describe("formatage", () => {
  it("formatPrice : décimales adaptées à la magnitude", () => {
    expect(formatPrice(1234.5)).toBe("1,234.50");
    expect(formatPrice(0.0013)).toBe("0.001300");
    expect(formatPrice(0)).toBe("—"); // prix invalide/absent
  });
  it("formatCompact : notation K/M/B", () => {
    expect(formatCompact(50)).toBe("50.00");
    expect(formatCompact(1_500)).toBe("1.50K");
    expect(formatCompact(2_500_000)).toBe("2.50M");
    expect(formatCompact(3_200_000_000)).toBe("3.20B");
  });
  it("formatPercent : signe explicite, tiret si non fini", () => {
    expect(formatPercent(2.345)).toBe("+2.35%");
    expect(formatPercent(-1.2)).toBe("-1.20%");
    expect(formatPercent(Number.NaN)).toBe("—");
  });
});
