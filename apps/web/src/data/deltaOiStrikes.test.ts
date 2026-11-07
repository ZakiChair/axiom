import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OptionPoint } from "./deribit";
import {
  _viderCapturesOi,
  calculerDeltaOi,
  capturerInstantaneOi,
  cleLocaleOi,
  construireInstantaneOi,
  joursLocauxOi,
  lireReferencesOi,
  topStrikesDeltaOi,
  validerInstantane,
  type InstantaneOi,
} from "./deltaOiStrikes";

const JOUR = 86_400_000;
const NOW = Date.parse("2026-11-07T10:00:00Z");
const E1 = Date.parse("2026-11-14T08:00:00Z");
const E2 = Date.parse("2026-11-27T08:00:00Z");
const SPOT = 100_000;

function opt(expiryMs: number, strike: number, type: "call" | "put", openInterest: number): OptionPoint {
  return {
    instrument: `BTC-${expiryMs}-${strike}-${type === "call" ? "C" : "P"}`,
    expiryMs, strike, type, markIv: 50, openInterest, underlying: SPOT, indexPrice: SPOT,
    interestRate: 0, volume24h: 0, markPrice: 0.01,
  };
}

const T_REF = Date.parse("2026-11-06T08:30:00Z");

/** Référence J-1 : deux échéances futures + une échéance expirée depuis (07/11 08:00). */
const CHAINE_REF = [
  opt(Date.parse("2026-11-07T08:00:00Z"), 100_000, "call", 999),
  opt(E1, 95_000, "put", 120),
  opt(E1, 100_000, "call", 300),
  opt(E1, 100_000, "put", 200),
  opt(E1, 110_000, "call", 80),
  opt(E2, 120_000, "call", 40),
];

describe("construireInstantaneOi", () => {
  it("agrège par échéance et strike, exclut les échéances passées et les OI non mesurés", () => {
    const inst = construireInstantaneOi([...CHAINE_REF, opt(E1, 105_000, "call", NaN)], T_REF);
    expect(inst.j).toBe("2026-11-06");
    expect(inst.ech.map((e) => e.e)).toEqual([Date.parse("2026-11-07T08:00:00Z"), E1, E2]);
    const e1 = inst.ech[1]!;
    expect(e1.k).toEqual([95_000, 100_000, 110_000]);
    expect(e1.c).toEqual([null, 300, 80]);
    expect(e1.p).toEqual([120, 200, null]);
    expect(construireInstantaneOi(CHAINE_REF, NOW).ech.map((e) => e.e)).toEqual([E1, E2]);
    expect(validerInstantane(JSON.parse(JSON.stringify(inst)))).toEqual(inst);
  });

  it("valide la forme lue du stockage", () => {
    const inst = construireInstantaneOi(CHAINE_REF, T_REF);
    expect(validerInstantane({ ...inst, j: "2026-11-05" })).toBeNull();
    expect(validerInstantane({ ...inst, ech: [{ e: E1, k: [1, 2], c: [1], p: [1, 2] }] })).toBeNull();
    expect(validerInstantane({ ...inst, ech: [{ e: E1, k: [1], c: [-1], p: [null] }] })).toBeNull();
    expect(validerInstantane("x")).toBeNull();
  });

  it("taille réaliste : ≈ 1 000 instruments BTC tiennent sous 12 Ko", () => {
    const chain: OptionPoint[] = [];
    for (let e = 0; e < 12; e++) {
      for (let k = 40_000; k <= 200_000; k += 4_000) {
        // OI déterministes à une décimale, jusqu'à 4 chiffres significatifs (pire cas de taille).
        chain.push(opt(NOW + (e + 1) * 7 * JOUR, k, "call", ((k / 1_000) * 37 + e * 101) % 2_000 + 0.1 * (e % 9)));
        chain.push(opt(NOW + (e + 1) * 7 * JOUR, k, "put", ((k / 1_000) * 53 + e * 89) % 2_000 + 0.1 * (k % 7)));
      }
    }
    expect(chain.length).toBeGreaterThan(900);
    // Mesuré : 984 instruments → 9 801 octets ; 16 instantanés (2 devises × J-0…J-7) ≈ 160 Ko.
    expect(JSON.stringify(construireInstantaneOi(chain, NOW)).length).toBeLessThan(12_000);
  });
});

describe("calculerDeltaOi", () => {
  const ref = construireInstantaneOi(CHAINE_REF, T_REF);
  const courante = [
    opt(E1, 95_000, "put", 150), // +30
    opt(E1, 100_000, "call", 250), // −50
    opt(E1, 100_000, "put", 200), // 0
    opt(E1, 110_000, "call", 80), // 0
    opt(E1, 115_000, "call", 25), // nouveau : +25
    opt(E2, 120_000, "call", 60), // +20
  ];

  it("Δ par côté et par cellule, en contrats et en USD au spot courant", () => {
    const r = calculerDeltaOi(courante, ref, SPOT, NOW)!;
    expect(r.refT).toBe(T_REF);
    expect(r.refJour).toBe("2026-11-06");
    const c100 = r.cellules.find((c) => c.expiryMs === E1 && c.strike === 100_000)!;
    expect(c100).toMatchObject({ deltaCall: -50, deltaPut: 0, delta: -50, deltaUsd: -5_000_000, oiAvant: 500, oiApres: 450, nouveau: false, absent: false });
    expect(r.cellules.find((c) => c.strike === 95_000)).toMatchObject({ deltaCall: null, deltaPut: 30, delta: 30 });
    expect(r.deltaAbsMax).toBe(50);
  });

  it("identité : Σ ΔOI d'une échéance = variation de son OI total (1e-9)", () => {
    const r = calculerDeltaOi(courante, ref, SPOT, NOW)!;
    for (const e of [E1, E2]) {
      const somme = r.cellules.filter((c) => c.expiryMs === e).reduce((s, c) => s + (c.delta ?? 0), 0);
      const oiApres = courante.filter((p) => p.expiryMs === e).reduce((s, p) => s + p.openInterest, 0);
      const oiAvant = CHAINE_REF.filter((p) => p.expiryMs === e).reduce((s, p) => s + p.openInterest, 0);
      expect(Math.abs(somme - (oiApres - oiAvant))).toBeLessThan(1e-9);
    }
  });

  it("instrument listé depuis la référence : Δ = OI entier, marqué nouveau", () => {
    const r = calculerDeltaOi(courante, ref, SPOT, NOW)!;
    expect(r.cellules.find((c) => c.strike === 115_000)).toMatchObject({ delta: 25, nouveau: true, oiAvant: 0, oiApres: 25 });
  });

  it("instrument de la référence absent de la chaîne courante : non mesuré, jamais 0", () => {
    const sansPut = courante.filter((p) => !(p.strike === 95_000));
    const c95 = calculerDeltaOi(sansPut, ref, SPOT, NOW)!.cellules.find((c) => c.strike === 95_000)!;
    expect(c95).toMatchObject({ deltaPut: null, delta: null, deltaUsd: null, absent: true });
  });

  it("échéance expirée depuis la référence exclue des deux côtés (pas de faux mur vidé)", () => {
    const r = calculerDeltaOi(courante, ref, SPOT, NOW)!;
    expect(r.echeancesExpirees).toBe(1);
    expect(r.cellules.some((c) => c.expiryMs <= NOW)).toBe(false);
    // Même si la chaîne courante contient encore l'échéance échue, elle est ignorée.
    const avecEchue = [...courante, opt(Date.parse("2026-11-07T08:00:00Z"), 100_000, "call", 1)];
    expect(calculerDeltaOi(avecEchue, ref, SPOT, NOW)!.cellules).toEqual(r.cellules);
  });

  it("causalité : une référence non antérieure à nowMs est refusée", () => {
    const futur: InstantaneOi = { ...ref, t: NOW, j: "2026-11-07" };
    expect(calculerDeltaOi(courante, futur, SPOT, NOW)).toBeNull();
    expect(calculerDeltaOi(courante, ref, SPOT, NOW)).not.toBeNull();
  });

  it("causalité : référence postérieure à la chaîne courante (figée après une panne) mais antérieure à nowMs, refusée", () => {
    const recueA = ref.t - 3_600_000; // chaîne reçue une heure avant la référence
    expect(ref.t).toBeLessThan(NOW);
    expect(calculerDeltaOi(courante, ref, SPOT, NOW, recueA)).toBeNull();
    expect(calculerDeltaOi(courante, ref, SPOT, NOW, ref.t + 1)).not.toBeNull();
  });

  it("spot absent : Δ en contrats conservé, USD non mesuré", () => {
    const r = calculerDeltaOi(courante, ref, NaN, NOW)!;
    expect(r.cellules.every((c) => c.deltaUsd === null)).toBe(true);
    expect(r.cellules.find((c) => c.strike === 95_000)!.delta).toBe(30);
  });

  it("top 5 construits et vidés de l'échéance sélectionnée, sans les Δ non mesurés", () => {
    const chain = [...courante, ...[1, 2, 3, 4, 5, 6].map((i) => opt(E1, 130_000 + i * 1_000, "call", i))];
    const sansPut = chain.filter((p) => !(p.strike === 95_000));
    const top = topStrikesDeltaOi(calculerDeltaOi(sansPut, ref, SPOT, NOW)!, E1);
    expect(top.construits.map((c) => c.strike)).toEqual([115_000, 136_000, 135_000, 134_000, 133_000]);
    expect(top.vides.map((c) => c.strike)).toEqual([100_000]);
    expect(topStrikesDeltaOi(calculerDeltaOi(courante, ref, SPOT, NOW)!, E2).construits.map((c) => c.delta)).toEqual([20]);
  });
});

// ─────────────────────────── Persistance (localStorage, sans daemon) ───────────────────────────

function stockage(): Storage {
  const valeurs = new Map<string, string>();
  return {
    getItem: (k) => valeurs.get(k) ?? null, setItem: (k, v) => void valeurs.set(k, v),
    removeItem: (k) => void valeurs.delete(k), clear: () => valeurs.clear(), key: (i) => [...valeurs.keys()][i] ?? null,
    get length() { return valeurs.size; },
  };
}

describe("capturerInstantaneOi / lireReferencesOi", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", stockage());
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("hors réseau"); }));
    _viderCapturesOi();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("avant 08:05 UTC : aucun instantané ; après : un seul par jour, jamais réécrit", async () => {
    expect(await capturerInstantaneOi("BTC", CHAINE_REF, Date.parse("2026-11-06T07:59:00Z"))).toBe(false);
    expect(joursLocauxOi("BTC")).toEqual([]);
    expect(await capturerInstantaneOi("BTC", CHAINE_REF, T_REF)).toBe(true);
    _viderCapturesOi();
    expect(await capturerInstantaneOi("BTC", CHAINE_REF.map((p) => ({ ...p, openInterest: 1 })), T_REF + 3_600_000)).toBe(false);
    const relu = JSON.parse(localStorage.getItem(cleLocaleOi("BTC", "2026-11-06"))!) as InstantaneOi;
    expect(relu.t).toBe(T_REF);
    expect(await capturerInstantaneOi("BTC", [], Date.parse("2026-11-07T09:00:00Z"))).toBe(false);
  });

  it("rétention glissante J-0…J-7 : les instantanés plus anciens sont élagués", async () => {
    for (let i = 10; i >= 0; i--) {
      const t = Date.parse("2026-11-07T09:00:00Z") - i * JOUR;
      await capturerInstantaneOi("BTC", [opt(t + 30 * JOUR, 100_000, "call", 10 + i)], t);
    }
    await capturerInstantaneOi("ETH", [opt(NOW + 30 * JOUR, 3_000, "call", 1)], Date.parse("2026-10-20T09:00:00Z"));
    expect(joursLocauxOi("BTC")).toEqual(["2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]);
    // L'élagage BTC ne touche pas ETH.
    expect(joursLocauxOi("ETH")).toEqual(["2026-10-20"]);
  });

  it("références J-1 et J-7 lues par jour exact, absentes = null (jour attendu fourni)", async () => {
    await capturerInstantaneOi("BTC", CHAINE_REF, T_REF);
    const refs = await lireReferencesOi("BTC", NOW);
    expect(refs.daemon).toBe(false);
    expect(refs.jourJ1).toBe("2026-11-06");
    expect(refs.jourJ7).toBe("2026-10-31");
    expect(refs.j1?.t).toBe(T_REF);
    expect(refs.j7).toBeNull();
    expect(refs.joursLocaux).toEqual(["2026-11-06"]);
  });
});
