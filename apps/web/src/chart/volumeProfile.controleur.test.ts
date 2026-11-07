/**
 * Câblage intrabar du VPVR (VolumeProfileController) : le module data/intrabar arrive par
 * import() à l'activation, le profil passe des bougies du graphe aux sous-bougies Binance
 * une fois le chargement anti-rebondi terminé, et le libellé dit ce qui est affiché
 * (« ≈ réparti sur la bougie » puis « réparti par 5 min (5m) · 49/50 »), la bougie en
 * cours restant à l'ancien calcul même en replay (drapeau du store). Aucune requête hors
 * Binance. `fetch` est une doublure : aucun appel réseau.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Candle } from "@axiom/types";
import type { Chart } from "klinecharts";

vi.mock("klinecharts", () => ({
  ActionType: { OnScroll: "onScroll", OnZoom: "onZoom", OnVisibleRangeChange: "onVisibleRangeChange" },
  DomPosition: { Main: "main" },
}));
vi.mock("../lib/canvasTokens", () => ({ lireTokenCanvas: (_nom: string, repli: string) => repli }));

import { VolumeProfileController } from "./volumeProfile";
import { marketStore } from "../store/market";
import { ANTI_REBOND_MS, PLAFOND_REQUETES } from "../data/intrabar";

const MIN = 60_000;
const H4 = 4 * 60 * MIN;
const MAINTENANT = Date.UTC(2026, 10, 7, 12, 7, 0);

/** Minute déterministe ; les unités plus longues en sont agrégées (cohérence exacte). */
function minute(t: number): Candle {
  const k = t / MIN;
  const base = 100 + 5 * Math.sin(k / 300);
  const open = base + Math.sin(k) * 0.3;
  const close = base + Math.cos(k) * 0.3;
  const volume = 2 + Math.abs(Math.sin(k * 1.3));
  return { time: t, open, high: Math.max(open, close) + 0.1, low: Math.min(open, close) - 0.1, close, volume, buyVolume: volume * 0.6, sellVolume: volume * 0.4 };
}

/** Bougie agrégée ; `closed` relatif à `reference` (horloge réelle, ou instant rejoué). */
function agreger(t0: number, duree: number, reference = MAINTENANT): Candle {
  const ms = Array.from({ length: duree / MIN }, (_, i) => minute(t0 + i * MIN));
  const volume = ms.reduce((s, m) => s + m.volume, 0);
  const buyVolume = ms.reduce((s, m) => s + (m.buyVolume ?? 0), 0);
  return {
    time: t0,
    open: ms[0]?.open ?? 0,
    close: ms.at(-1)?.close ?? 0,
    high: Math.max(...ms.map((m) => m.high)),
    low: Math.min(...ms.map((m) => m.low)),
    volume,
    buyVolume,
    sellVolume: volume - buyVolume,
    closed: t0 + duree <= reference,
  };
}

function installerServeur() {
  const urls: string[] = [];
  const fetchFn = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    const q = new URL(url).searchParams;
    const duree = { "1m": MIN, "5m": 5 * MIN, "15m": 15 * MIN, "1h": 60 * MIN }[q.get("interval") ?? ""] ?? MIN;
    const lignes: unknown[] = [];
    for (let t = Number(q.get("startTime")); t <= Number(q.get("endTime")) && t <= MAINTENANT; t += duree) {
      const c = agreger(t, duree);
      lignes.push([t, `${c.open}`, `${c.high}`, `${c.low}`, `${c.close}`, `${c.volume}`, t + duree - 1, "0", 1, `${c.buyVolume}`, "0", "0"]);
    }
    return new Response(JSON.stringify(lignes), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchFn);
  return { fetchFn, urls };
}

function monter(exchange: "binance" | "bybit", symbol: string, reference = MAINTENANT) {
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("ResizeObserver", class {
    observe(): void {}
    disconnect(): void {}
  });
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  const derniere = Math.floor(reference / H4) * H4;
  const candles = Array.from({ length: 50 }, (_, i) => agreger(derniere - (49 - i) * H4, H4, reference));
  marketStore.setState({ exchange, symbol, timeframe: "4h", candles });

  const textes: string[] = [];
  const ctx = new Proxy(
    { fillText: (t: string) => textes.push(t) } as Record<string, unknown>,
    { get: (cible, cle) => (cle in cible ? cible[cle as string] : () => {}), set: () => true },
  );
  const canvas = { style: {}, width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  const container = { clientWidth: 800, clientHeight: 600 } as unknown as HTMLElement;
  const chart = {
    subscribeAction: () => {},
    unsubscribeAction: () => {},
    getSize: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    getVisibleRange: () => ({ from: 0, to: candles.length }),
    convertToPixel: (p: { value?: number }) => ({ x: 0, y: 600 - (p.value ?? 0) }),
  } as unknown as Chart;
  const ctrl = new VolumeProfileController(chart, container, canvas);
  const rendre = (): void => (ctrl as unknown as { render: () => void }).render();
  const libelle = (): string | undefined => textes.at(-1);
  return { ctrl, rendre, libelle, textes, candles };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("VolumeProfileController — intrabar", () => {
  it("Binance : repli « ≈ » au premier rendu, puis profil réparti par sous-bougie après chargement", async () => {
    vi.useFakeTimers({ now: MAINTENANT, toFake: ["setTimeout", "clearTimeout", "Date"] });
    const srv = installerServeur();
    const { ctrl, rendre, libelle } = monter("binance", "ETHUSDT");
    ctrl.setEnabled(true); // premier rendu synchrone : module pas encore là
    expect(libelle()).toBe("≈ réparti sur la bougie");

    await vi.dynamicImportSettled();
    rendre();
    expect(libelle()).toBe("≈ réparti sur la bougie (intrabar 5m en chargement)");
    expect(srv.fetchFn).not.toHaveBeenCalled(); // anti-rebond

    await vi.advanceTimersByTimeAsync(ANTI_REBOND_MS);
    await vi.runAllTimersAsync();
    rendre();
    expect(libelle()).toBe("réparti par 5 min (5m) · 49/50");
    expect(srv.fetchFn.mock.calls.length).toBeLessThanOrEqual(PLAFOND_REQUETES);
    expect(srv.urls.every((u) => u.startsWith("https://api.binance.com/api/v3/klines?"))).toBe(true);
    ctrl.dispose();
  });

  it("façon replay : données de l'avant-veille, la bougie en cours (drapeau du store) n'est jamais remplacée", async () => {
    vi.useFakeTimers({ now: MAINTENANT, toFake: ["setTimeout", "clearTimeout", "Date"] });
    installerServeur();
    // Instant rejoué deux jours avant l'horloge réelle : seule la dernière bougie est `closed:false`.
    const { ctrl, rendre, libelle, candles } = monter("binance", "BNBUSDT", MAINTENANT - 2 * 24 * 60 * MIN);
    const enCours = candles.at(-1);
    expect(enCours?.closed).toBe(false);
    expect((enCours?.time ?? Infinity) + H4).toBeLessThan(MAINTENANT);
    ctrl.setEnabled(true);
    await vi.dynamicImportSettled();
    rendre();
    await vi.advanceTimersByTimeAsync(ANTI_REBOND_MS);
    await vi.runAllTimersAsync();
    rendre();
    expect(libelle()).toBe("réparti par 5 min (5m) · 49/50");
    ctrl.dispose();
  });

  it("autre place : ancien calcul, motif affiché, aucune requête", async () => {
    vi.useFakeTimers({ now: MAINTENANT, toFake: ["setTimeout", "clearTimeout", "Date"] });
    const srv = installerServeur();
    const { ctrl, rendre, libelle } = monter("bybit", "BTCUSDT");
    ctrl.setEnabled(true);
    await vi.dynamicImportSettled();
    rendre();
    expect(libelle()).toBe("≈ réparti sur la bougie (intrabar Binance seulement)");
    await vi.runAllTimersAsync();
    expect(srv.fetchFn).not.toHaveBeenCalled();
    ctrl.dispose();
  });
});
