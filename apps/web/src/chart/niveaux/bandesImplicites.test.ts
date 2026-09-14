/**
 * Tests des bandes de mouvement attendu implicite (chart/niveaux/bandesImplicites.ts).
 *
 * GOLDEN RÉEL (recherche du 14/09/2026, confirmé par le vérificateur) : ouverture BTCUSDT du
 * lundi 14/09 = 76 842,01 (= ouverture du jour), DVOL de clôture du dimanche 13/09 = 38,89 →
 * ±1σ jour [75 278 ; 78 406], ±1σ semaine [72 704 ; 80 980].
 * Sémantique de l'IV : observée à l'ancre = clôture de la bougie DVOL quotidienne qui précède
 * (la bougie stampée J 00:00 couvre J ; celle du jour porte la valeur courante, jamais utilisée).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Candle } from "@axiom/types";
import { BTCUSDT_1D } from "./btcusdt1d.fixture";
import {
  bandesImplicites,
  calculerBandesImplicites,
  creerSourceBandesImplicites,
  dvolCloture,
  lignesBandesImplicites,
} from "./bandesImplicites";
import type { PointDvol } from "./dvolJour";

const JOUR = 86_400_000;
const NOW = Date.UTC(2026, 8, 14, 18);
const FIXTURE: Candle[] = BTCUSDT_1D.map(([time, open, high, low, close]) => ({ time, open, high, low, close, volume: 0 }));
/** DVOL BTC quotidien sondé : 13/09 clôturé à 38,89 ; 14/09 en cours (37,92 à 18:30 UTC). */
const DVOL: PointDvol[] = [
  { time: Date.UTC(2026, 8, 12), value: 39.4 },
  { time: Date.UTC(2026, 8, 13), value: 38.89 },
  { time: Date.UTC(2026, 8, 14), value: 37.92 },
];

const arrondies = (b: { plus1: number; moins1: number; plus2: number; moins2: number } | null) =>
  b === null ? null : { moins2: Math.round(b.moins2), moins1: Math.round(b.moins1), plus1: Math.round(b.plus1), plus2: Math.round(b.plus2) };

describe("bandesImplicites — σ = IV/100 × √(jours/365), bande = ancre × (1 ± kσ)", () => {
  it("golden jour : ouverture 76 842,01, DVOL 38,89", () => {
    expect(arrondies(bandesImplicites(76842.01, 38.89, 1))).toEqual({ moins2: 73714, moins1: 75278, plus1: 78406, plus2: 79970 });
  });

  it("golden semaine : même ancre (lundi), horizon 7 j", () => {
    expect(arrondies(bandesImplicites(76842.01, 38.89, 7))).toEqual({ moins2: 68565, moins1: 72704, plus1: 80980, plus2: 85119 });
  });

  it("ancre, IV ou horizon non finis ou ≤ 0 → null (jamais une bande nulle)", () => {
    expect(bandesImplicites(0, 38.89, 1)).toBeNull();
    expect(bandesImplicites(76842.01, 0, 1)).toBeNull();
    expect(bandesImplicites(76842.01, Number.NaN, 1)).toBeNull();
    expect(bandesImplicites(Number.POSITIVE_INFINITY, 38.89, 1)).toBeNull();
    expect(bandesImplicites(76842.01, 38.89, 0)).toBeNull();
  });
});

describe("dvolCloture — clôture de la bougie quotidienne stampée à ce jour", () => {
  it("bougie exacte seulement, jamais la plus proche", () => {
    expect(dvolCloture(DVOL, Date.UTC(2026, 8, 13))).toBe(38.89);
    expect(dvolCloture(DVOL, Date.UTC(2026, 8, 11))).toBeNull();
    expect(dvolCloture(DVOL, Date.UTC(2026, 8, 13, 12))).toBeNull();
  });

  it("série absente ou valeur non exploitable → null", () => {
    expect(dvolCloture(null, Date.UTC(2026, 8, 13))).toBeNull();
    expect(dvolCloture([{ time: Date.UTC(2026, 8, 13), value: Number.NaN }], Date.UTC(2026, 8, 13))).toBeNull();
    expect(dvolCloture([{ time: Date.UTC(2026, 8, 13), value: 0 }], Date.UTC(2026, 8, 13))).toBeNull();
  });
});

describe("calculerBandesImplicites", () => {
  it("golden réel du lundi 14/09 : ancres = ouverture du jour et du lundi, IV = clôture du dimanche", () => {
    const b = calculerBandesImplicites(FIXTURE, DVOL, NOW);
    expect(b.jour?.ancre).toBe(76842.01);
    expect(b.jour?.ivPct).toBe(38.89);
    expect(b.semaine?.ancre).toBe(76842.01);
    expect(b.semaine?.ivPct).toBe(38.89);
    expect(arrondies(b.jour?.bandes ?? null)).toMatchObject({ moins1: 75278, plus1: 78406 });
    expect(arrondies(b.semaine?.bandes ?? null)).toMatchObject({ moins1: 72704, plus1: 80980 });
    expect(b.ancreJourMs).toBe(Date.UTC(2026, 8, 14));
  });

  it("mercredi : jour = ouverture du mercredi × clôture du mardi ; semaine = ouverture du lundi × clôture du dimanche", () => {
    const bougies: Candle[] = [];
    for (let t = Date.UTC(2026, 8, 7); t <= Date.UTC(2026, 8, 16); t += JOUR) {
      const o = 1_000 + t / JOUR - Date.UTC(2026, 8, 7) / JOUR;
      bougies.push({ time: t, open: o, high: o + 5, low: o - 5, close: o + 1, volume: 0 });
    }
    const dvol: PointDvol[] = [
      { time: Date.UTC(2026, 8, 13), value: 40 },
      { time: Date.UTC(2026, 8, 14), value: 50 },
      { time: Date.UTC(2026, 8, 15), value: 60 },
      { time: Date.UTC(2026, 8, 16), value: 70 },
    ];
    const b = calculerBandesImplicites(bougies, dvol, Date.UTC(2026, 8, 16, 10));
    expect(b.jour).toMatchObject({ ancre: 1_009, ivPct: 60 });
    expect(b.semaine).toMatchObject({ ancre: 1_007, ivPct: 40 });
  });

  it("clôture DVOL de la veille absente ou ouverture du jour absente → cette bande seule manque", () => {
    const sansDimanche = DVOL.filter((p) => p.time !== Date.UTC(2026, 8, 13));
    const b = calculerBandesImplicites(FIXTURE, sansDimanche, NOW);
    expect(b.jour).toBeNull();
    expect(b.semaine).toBeNull();

    // Mardi 15/09 sans bougie du jour : pas d'ancre jour ; la semaine (lundi, dimanche) reste.
    const mardi = calculerBandesImplicites(FIXTURE, DVOL, Date.UTC(2026, 8, 15, 9));
    expect(mardi.jour).toBeNull();
    expect(mardi.semaine).toMatchObject({ ancre: 76842.01, ivPct: 38.89 });
  });
});

describe("lignesBandesImplicites", () => {
  it("±1σ en trait fort, ±2σ en faible, suffixes J et S, libellé commun (DVOL)", () => {
    const lignes = lignesBandesImplicites(calculerBandesImplicites(FIXTURE, DVOL, NOW));
    expect(lignes.map((l) => [l.label, Math.round(l.price), l.emphase])).toEqual([
      ["+1σ J (DVOL)", 78406, "forte"],
      ["−1σ J (DVOL)", 75278, "forte"],
      ["+2σ J (DVOL)", 79970, "faible"],
      ["−2σ J (DVOL)", 73714, "faible"],
      ["+1σ S (DVOL)", 80980, "forte"],
      ["−1σ S (DVOL)", 72704, "forte"],
      ["+2σ S (DVOL)", 85119, "faible"],
      ["−2σ S (DVOL)", 68565, "faible"],
    ]);
    expect(new Set(lignes.map((l) => l.couleur))).toEqual(new Set(["--accent"]));
  });

  it("bande absente → aucune ligne pour elle ; rien → []", () => {
    const mardi = calculerBandesImplicites(FIXTURE, DVOL, Date.UTC(2026, 8, 15, 9));
    expect(lignesBandesImplicites(mardi).map((l) => l.label)).toEqual(["+1σ S (DVOL)", "−1σ S (DVOL)", "+2σ S (DVOL)", "−2σ S (DVOL)"]);
    expect(lignesBandesImplicites(null)).toEqual([]);
  });
});

describe("creerSourceBandesImplicites", () => {
  const CTX = { exchange: "binance" as const, symbol: "BTCUSDT" };
  let toasts: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    toasts = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function deps(
    chargerDvol: (devise: "BTC" | "ETH", nowMs: number) => Promise<PointDvol[] | null> = async () => DVOL,
    chargerBougies: (exchange: string, symbol: string, nowMs: number) => Promise<Candle[] | null> = async () => FIXTURE,
  ) {
    return {
      chargerBougies: vi.fn(chargerBougies),
      chargerDvol: vi.fn(chargerDvol),
      maintenant: () => Date.now(),
      disponible: () => true,
      toast: (t: string) => toasts.push(t),
    };
  }

  it("charge bougies 1d et DVOL de la devise au subscribe, notifie et expose les huit lignes", async () => {
    const d = deps();
    const source = creerSourceBandesImplicites(CTX, d);
    const onChange = vi.fn();
    const unsub = source.subscribe(onChange);
    await vi.advanceTimersByTimeAsync(0);
    expect(d.chargerBougies).toHaveBeenCalledWith("binance", "BTCUSDT", NOW);
    expect(d.chargerDvol).toHaveBeenCalledWith("BTC", NOW);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(source.getLignes()).toHaveLength(8);
    expect(toasts).toEqual([]);
    unsub();
  });

  it("ETH coté en dollar sur Coinbase → DVOL ETH", async () => {
    const d = deps();
    const unsub = creerSourceBandesImplicites({ exchange: "coinbase", symbol: "ETH-USD" }, d).subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(d.chargerDvol).toHaveBeenCalledWith("ETH", NOW);
    unsub();
  });

  it("marché hors BTC/ETH en dollar : toast explicite et aucun chargement", async () => {
    const d = deps();
    const unsub = creerSourceBandesImplicites({ exchange: "binance", symbol: "SOLUSDT" }, d).subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(d.chargerBougies).not.toHaveBeenCalled();
    expect(d.chargerDvol).not.toHaveBeenCalled();
    expect(toasts).toEqual(["Bandes implicites : BTC et ETH cotés en dollar seulement (DVOL Deribit), pas SOLUSDT"]);
    unsub();
  });

  it("source sans bougies 1d UTC : toast explicite et aucun chargement", async () => {
    const d = { ...deps(), disponible: () => false };
    const unsub = creerSourceBandesImplicites(CTX, d).subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(d.chargerBougies).not.toHaveBeenCalled();
    expect(d.chargerDvol).not.toHaveBeenCalled();
    expect(toasts).toEqual(["Bandes implicites indisponibles : pas de bougies 1d UTC pour BTCUSDT (binance)"]);
    unsub();
  });

  it("DVOL indisponible : un seul toast, nouvel essai toutes les 5 min ; désabonnement coupe tout", async () => {
    const d = deps(async () => null);
    const source = creerSourceBandesImplicites(CTX, d);
    const onChange = vi.fn();
    const unsub = source.subscribe(onChange);
    await vi.advanceTimersByTimeAsync(0);
    expect(source.getLignes()).toEqual([]);
    expect(toasts).toEqual(["Bandes implicites : DVOL Deribit BTC indisponible, nouvel essai dans 5 min"]);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(d.chargerDvol).toHaveBeenCalledTimes(3);
    expect(toasts).toHaveLength(1);
    unsub();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(d.chargerDvol).toHaveBeenCalledTimes(3);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("bougies 1d indisponibles : toast qui nomme le marché", async () => {
    const d = deps(undefined, async () => null);
    const unsub = creerSourceBandesImplicites(CTX, d).subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(toasts).toEqual(["Bandes implicites : bougies 1d de BTCUSDT (binance) indisponibles, nouvel essai dans 5 min"]);
    unsub();
  });

  it("clôture DVOL de la veille pas encore publiée : bandes absentes, toast, puis tracées au nouvel essai", async () => {
    const sansDimanche = DVOL.filter((p) => p.time !== Date.UTC(2026, 8, 13));
    const d = deps(async () => sansDimanche);
    const source = creerSourceBandesImplicites(CTX, d);
    const unsub = source.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(source.getLignes()).toEqual([]);
    expect(toasts).toEqual([
      "Bandes implicites : bandes jour et semaine incalculables (ouverture 1d ou clôture DVOL de la veille absente), nouvel essai dans 5 min",
    ]);
    d.chargerDvol.mockImplementation(async () => DVOL);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(source.getLignes()).toHaveLength(8);
    expect(toasts).toHaveLength(1);
    unsub();
  });

  it("au changement de jour UTC : bandes de la veille retirées puis rechargement à 00:00:05", async () => {
    const d = deps();
    const source = creerSourceBandesImplicites(CTX, d);
    const unsub = source.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(d.chargerDvol).toHaveBeenCalledTimes(1);

    let lignesAuBasculement: number | null = null;
    d.chargerDvol.mockImplementation(async () => {
      lignesAuBasculement = source.getLignes().length;
      return DVOL;
    });
    await vi.advanceTimersByTimeAsync(6 * 3_600_000 + 5_000);
    expect(d.chargerDvol).toHaveBeenCalledTimes(2);
    expect(d.chargerDvol.mock.calls[1]?.[1]).toBe(Date.UTC(2026, 8, 15, 0, 0, 5));
    expect(lignesAuBasculement).toBe(0);
    unsub();
  });

  it("désabonnement avant la résolution : aucune notification tardive", async () => {
    let resoudre: (p: PointDvol[]) => void = () => {};
    const d = deps(() => new Promise<PointDvol[]>((res) => (resoudre = res)));
    const source = creerSourceBandesImplicites(CTX, d);
    const onChange = vi.fn();
    const unsub = source.subscribe(onChange);
    unsub();
    resoudre(DVOL);
    await vi.advanceTimersByTimeAsync(0);
    expect(onChange).not.toHaveBeenCalled();
    expect(source.getLignes()).toEqual([]);
  });
});
