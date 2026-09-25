/**
 * Tests des niveaux d'options du chart maître (chart/niveaux/niveauxOptions.ts).
 *
 * Le calcul doit être la COMPOSITION des fonctions d'OMON (gexParStrikeToutesEcheances,
 * mursGamma, gammaFlip, profilGexSpot sur 41 spots à ±15 %, computeMaxPain) : on le compare
 * à l'appel direct de ces fonctions sur la même chaîne, puis on vérifie ce qui est propre au
 * chart — échéance dominante (Σ OI maximal, échéances expirées exclues, égalité → la plus
 * proche), max pain de CETTE échéance seulement (cas discriminant : l'autre échéance a un
 * max pain différent), libellés distincts des deux flips, et la source (marchés non éligibles
 * sans appel, rafraîchissement, échec signalé avec dernières lignes conservées).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { computeMaxPain, parseOptionInstrument, type OptionPoint } from "../../data/deribit";
import { gammaFlip, gexParStrikeToutesEcheances, mursGamma, profilGexSpot } from "../../data/gexDex";
import { TTL_CHAINE_MS, type ChaineOptionsChargee } from "../../data/chaineOptionsCache";
import { formatDateHeure } from "../../lib/format";
import {
  calculerNiveauxOptions,
  creerSourceNiveauxOptions,
  echeanceDominante,
  lignesNiveauxOptions,
  oiParStrike,
  type NiveauxOptions,
} from "./niveauxOptions";

const NOW = Date.UTC(2026, 8, 14, 18);

afterEach(() => vi.useRealTimers());

/** Option synthétique Deribit (nom → échéance 08:00 UTC, strike, type), IV 50 %, spot 79 000. */
function opt(instrument: string, openInterest: number, partiel: Partial<OptionPoint> = {}): OptionPoint {
  const p = parseOptionInstrument(instrument);
  if (p === null) throw new Error(`instrument invalide ${instrument}`);
  return {
    instrument,
    expiryMs: p.expiryMs,
    strike: p.strike,
    type: p.type,
    markIv: 50,
    openInterest,
    underlying: 79_000,
    interestRate: 0,
    volume24h: 1,
    markPrice: 0.01,
    ...partiel,
  };
}

/**
 * 25SEP26 (Σ OI 220) : max pain 80 000 (douleurs 1,2 M à 70 000 ; 1,05 M à 75 000 ; 950 k à 80 000).
 * 18SEP26 (Σ OI 100) : max pain 76 000. 14SEP26 08:00 est expirée à NOW (OI 1 000 ignoré).
 */
const CHAINE: OptionPoint[] = [
  opt("BTC-14SEP26-60000-C", 1_000),
  opt("BTC-18SEP26-76000-P", 60),
  opt("BTC-18SEP26-78000-C", 40),
  opt("BTC-25SEP26-70000-C", 90),
  opt("BTC-25SEP26-75000-C", 10),
  opt("BTC-25SEP26-80000-P", 120),
];
const SEP25 = Date.UTC(2026, 8, 25, 8);

describe("echeanceDominante", () => {
  it("Σ OI maximal parmi les échéances futures (l'expirée à OI 1 000 est ignorée)", () => {
    expect(echeanceDominante(CHAINE, NOW)).toBe(SEP25);
  });

  it("égalité de Σ OI → l'échéance la plus proche ; aucune OI → null", () => {
    const egalite = [opt("BTC-25SEP26-80000-C", 50), opt("BTC-18SEP26-80000-C", 30), opt("BTC-18SEP26-70000-P", 20)];
    expect(echeanceDominante(egalite, NOW)).toBe(Date.UTC(2026, 8, 18, 8));
    expect(echeanceDominante([opt("BTC-25SEP26-80000-C", 0), opt("BTC-25SEP26-80000-P", NaN)], NOW)).toBeNull();
    expect(echeanceDominante([], NOW)).toBeNull();
  });
});

describe("oiParStrike — même agrégation qu'OMON (agregerParStrike)", () => {
  it("somme calls et puts par strike, OI non fini compté 0, strikes croissants", () => {
    expect(
      oiParStrike([opt("BTC-25SEP26-80000-P", 5), opt("BTC-25SEP26-70000-C", 3), opt("BTC-25SEP26-80000-C", 2), opt("BTC-25SEP26-80000-C", NaN)]),
    ).toEqual([
      { strike: 70_000, callOi: 3, putOi: 0 },
      { strike: 80_000, callOi: 2, putOi: 5 },
    ]);
  });
});

describe("calculerNiveauxOptions", () => {
  it("murs et flips = composition directe des fonctions OMON sur la même chaîne", () => {
    const n = calculerNiveauxOptions(CHAINE, NOW);
    const gex = gexParStrikeToutesEcheances(CHAINE, 79_000, NOW);
    const spots = Array.from({ length: 41 }, (_, i) => 79_000 * (0.85 + (0.3 * i) / 40));
    expect(n).not.toBeNull();
    expect(n?.spot).toBe(79_000);
    expect({ callWall: n?.callWall, putWall: n?.putWall }).toEqual(mursGamma(gex));
    expect(n?.flipCumul).toBe(gammaFlip(gex));
    expect(n?.flipProfil).toBe(profilGexSpot(CHAINE, spots, NOW).flipReel);
    // Chaîne discriminante : murs des deux côtés, le call wall vient de l'AUTRE échéance
    // (call 18SEP26 à 78 000, proche du spot : GEX +244 k $ contre +114 k $ à 70 000).
    expect(n?.callWall).toBe(78_000);
    expect(n?.putWall).toBe(80_000);
  });

  it("max pain de l'échéance dominante seulement (≠ celui de 18SEP26 et de la chaîne entière)", () => {
    const n = calculerNiveauxOptions(CHAINE, NOW);
    expect(n?.echeanceDominante).toBe(SEP25);
    expect(n?.libelleEcheance).toBe("25SEP26");
    expect(n?.maxPain).toBe(80_000);
    expect(computeMaxPain(oiParStrike(CHAINE.filter((p) => p.instrument.includes("18SEP26"))))).toBe(76_000);
    expect(computeMaxPain(oiParStrike(CHAINE))).not.toBe(80_000);
  });

  it("chaîne vide ou sans spot fini → null → aucune ligne", () => {
    expect(calculerNiveauxOptions([], NOW)).toBeNull();
    const sansSpot = CHAINE.map((p) => ({ ...p, underlying: NaN }));
    expect(calculerNiveauxOptions(sansSpot, NOW)).toBeNull();
    expect(lignesNiveauxOptions(null)).toEqual([]);
  });
});

describe("lignesNiveauxOptions", () => {
  const N: NiveauxOptions = {
    spot: 79_145.62,
    callWall: 80_000,
    putWall: 77_000,
    flipProfil: 70_129.4,
    flipCumul: 79_021.2,
    echeanceDominante: SEP25,
    libelleEcheance: "25SEP26",
    maxPain: 72_000,
  };

  it("cinq lignes aux libellés distincts : murs forts, flip du profil fort, flip cumulé et max pain faibles", () => {
    expect(lignesNiveauxOptions(N)).toEqual([
      { price: 80_000, label: "Call wall γ", couleur: "--up", emphase: "forte" },
      { price: 77_000, label: "Put wall γ", couleur: "--down", emphase: "forte" },
      { price: 70_129.4, label: "Flip GEX(S)", couleur: "--accent", emphase: "forte" },
      { price: 79_021.2, label: "Flip cumulé", couleur: "--accent", emphase: "faible" },
      { price: 72_000, label: "Max pain 25SEP26", couleur: "--text-dim", emphase: "faible" },
    ]);
  });

  it("niveau absent → pas de ligne (jamais de zéro)", () => {
    const lignes = lignesNiveauxOptions({ ...N, putWall: null, flipProfil: null, maxPain: null });
    expect(lignes.map((l) => l.label)).toEqual(["Call wall γ", "Flip cumulé"]);
  });
});

describe("creerSourceNiveauxOptions", () => {
  function chargeurFactice(reponses: (ChaineOptionsChargee | null)[]) {
    const appels: { devise: string; now: number }[] = [];
    const charger = async (devise: "BTC" | "ETH", now: number) => {
      appels.push({ devise, now });
      return reponses.length > 1 ? reponses.shift()! : reponses[0]!;
    };
    return { appels, charger };
  }
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  it("marché non éligible : aucun appel, toast explicatif, aucune ligne", () => {
    const c = chargeurFactice([{ chaine: CHAINE, recupereLe: NOW }]);
    const toasts: string[] = [];
    const source = creerSourceNiveauxOptions({ exchange: "binance", symbol: "SOLUSDT" }, { charger: c.charger, toast: (t) => toasts.push(t) });
    const unsub = source.subscribe(() => {});
    unsub();
    expect(c.appels).toEqual([]);
    expect(source.getLignes()).toEqual([]);
    expect(toasts).toEqual(["Niveaux d'options : BTC et ETH cotés en dollar seulement (chaîne Deribit), pas SOLUSDT"]);
  });

  it("BTC : charge la chaîne, notifie, lignes calculées ; ETH-USD charge la chaîne ETH", async () => {
    const c = chargeurFactice([{ chaine: CHAINE, recupereLe: NOW }]);
    const source = creerSourceNiveauxOptions({ exchange: "binance", symbol: "BTCUSDT" }, { charger: c.charger, maintenant: () => NOW, toast: () => {} });
    let notifs = 0;
    const unsub = source.subscribe(() => (notifs += 1));
    await flush();
    unsub();
    expect(c.appels).toEqual([{ devise: "BTC", now: NOW }]);
    expect(notifs).toBe(1);
    expect(source.getLignes().map((l) => l.label)).toContain("Max pain 25SEP26");

    const eth = chargeurFactice([null]);
    const sourceEth = creerSourceNiveauxOptions({ exchange: "coinbase", symbol: "ETH-USD" }, { charger: eth.charger, toast: () => {} });
    sourceEth.subscribe(() => {})();
    expect(eth.appels.map((a) => a.devise)).toEqual(["ETH"]);
  });

  it("rafraîchit à chaque TTL ; échec : toast unique datant les lignes conservées ; désabonnement coupe tout", async () => {
    vi.useFakeTimers({ now: NOW });
    const c = chargeurFactice([{ chaine: CHAINE, recupereLe: NOW }, null, null, { chaine: CHAINE, recupereLe: NOW + 3 * TTL_CHAINE_MS }]);
    const toasts: string[] = [];
    const source = creerSourceNiveauxOptions({ exchange: "binance", symbol: "BTCUSDT" }, { charger: c.charger, toast: (t) => toasts.push(t) });
    const unsub = source.subscribe(() => {});
    await flush();
    const lignes = source.getLignes();
    expect(lignes.length).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(TTL_CHAINE_MS + 1_000);
    await vi.advanceTimersByTimeAsync(TTL_CHAINE_MS + 1_000);
    expect(c.appels).toHaveLength(3);
    expect(source.getLignes()).toEqual(lignes);
    expect(toasts).toEqual([
      `Niveaux d'options : chaîne Deribit BTC indisponible, lignes du ${formatDateHeure(NOW)} conservées, nouvel essai dans 10 min`,
    ]);

    unsub();
    await vi.advanceTimersByTimeAsync(5 * TTL_CHAINE_MS);
    expect(c.appels).toHaveLength(3);
  });

  it("désabonnement avant la réponse : aucune notification", async () => {
    let resoudre: (r: ChaineOptionsChargee | null) => void = () => {};
    const source = creerSourceNiveauxOptions(
      { exchange: "binance", symbol: "BTCUSDT" },
      { charger: () => new Promise((res) => (resoudre = res)), toast: () => {} },
    );
    let notifs = 0;
    const unsub = source.subscribe(() => (notifs += 1));
    unsub();
    resoudre({ chaine: CHAINE, recupereLe: NOW });
    await flush();
    expect(notifs).toBe(0);
  });

  it("premier échec sans lignes, puis chaîne sans spot : toasts explicites, aucune ligne", async () => {
    const sansSpot = CHAINE.map((p) => ({ ...p, underlying: NaN }));
    const c = chargeurFactice([null, { chaine: sansSpot, recupereLe: NOW }]);
    const toasts: string[] = [];
    vi.useFakeTimers({ now: NOW });
    const source = creerSourceNiveauxOptions({ exchange: "binance", symbol: "BTCUSDT" }, { charger: c.charger, toast: (t) => toasts.push(t) });
    const unsub = source.subscribe(() => {});
    await flush();
    await vi.advanceTimersByTimeAsync(TTL_CHAINE_MS + 1_000);
    unsub();
    expect(source.getLignes()).toEqual([]);
    expect(toasts).toEqual([
      "Niveaux d'options : chaîne Deribit BTC indisponible, nouvel essai dans 10 min",
      "Niveaux d'options : aucun niveau calculable sur la chaîne Deribit BTC",
    ]);
  });
});
