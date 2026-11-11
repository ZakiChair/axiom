import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OptionPoint } from "./deribit";
import { normCdf } from "./blackScholes";
import {
  ARCHIVE_VIDE,
  MAX_POINTS_ARCHIVE,
  MIN_POINTS_HISTORIQUE,
  SEUIL_OI_AILE_10D_USD,
  _viderCapturesSurface,
  apresHeureInstantane,
  capturerSurfaceDuJour,
  cleLocaleSurface,
  couvertureArchive,
  fusionnerArchives,
  lireArchiveSurface,
  lireHistorique,
  lireSurfaceHistorique,
  pointHistorique,
  smileEnDelta,
  surfaceMaturiteConstante,
  validerArchive,
  type ArchiveSurface,
  type PointHistoriqueSurface,
} from "./surfaceConstante";

const JOUR = 86_400_000;
const AN = 365 * JOUR;
const NOW = Date.parse("2026-11-07T10:00:00Z");
const SPOT = 100_000;

/** Inverse de N par dichotomie (fixture de test, pas de dépendance). */
function normInv(p: number): number {
  let lo = -10;
  let hi = 10;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (normCdf(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Strike dont le delta forward N(d1) vaut `delta` avec l'IV `ivPct` (Black-76, sans prime). */
function strikePourDelta(forward: number, delta: number, ivPct: number, t: number): number {
  const s = ivPct / 100;
  return forward * Math.exp(-s * Math.sqrt(t) * normInv(delta) + (s * s * t) / 2);
}

function option(expiryMs: number, strike: number, type: "call" | "put", markIv: number, forward: number, oi = 500): OptionPoint {
  return {
    instrument: `BTC-${expiryMs}-${strike}-${type === "call" ? "C" : "P"}`,
    expiryMs, strike, type, markIv, openInterest: oi, underlying: forward, indexPrice: SPOT,
    interestRate: 0, volume24h: 0, markPrice: 0.01,
  };
}

/** Smile LINÉAIRE en delta call équivalent : IV(δ) = 50 + 20 (δ − 0,5). */
const smileLineaire = (delta: number) => 50 + 20 * (delta - 0.5);

/**
 * Échéance construite à delta exact : calls OTM aux deltas 0,05…0,45, puts OTM aux deltas call
 * équivalents 0,60…0,95, et un call au strike K = F (IV point fixe du smile).
 */
function echeanceLineaire(jours: number, forward: number, oi = 500): OptionPoint[] {
  const expiryMs = NOW + jours * JOUR;
  const t = (expiryMs - NOW) / AN;
  const out: OptionPoint[] = [];
  for (let d = 0.05; d < 0.46; d += 0.05) {
    const iv = smileLineaire(d);
    out.push(option(expiryMs, strikePourDelta(forward, d, iv, t), "call", iv, forward, oi));
  }
  for (let d = 0.6; d < 0.96; d += 0.05) {
    const iv = smileLineaire(d);
    out.push(option(expiryMs, strikePourDelta(forward, d, iv, t), "put", iv, forward, oi));
  }
  out.push(option(expiryMs, forward, "call", ivAtmLineaire(t), forward, oi));
  return out;
}

/** IV au strike K = F du smile linéaire : point fixe σ = smile(N(σ√T/2)). */
function ivAtmLineaire(t: number): number {
  let s = 50;
  for (let i = 0; i < 100; i++) s = smileLineaire(normCdf(((s / 100) * Math.sqrt(t)) / 2));
  return s;
}

/** Échéance à smile PLAT (même IV partout), strikes 70 %…130 % du forward. */
function echeancePlate(jours: number, iv: number, forward = SPOT, oi = 500): OptionPoint[] {
  const expiryMs = NOW + jours * JOUR;
  const out: OptionPoint[] = [];
  for (let m = 0.5; m <= 1.6001; m += 0.025) {
    const k = Math.round(forward * m);
    out.push(option(expiryMs, k, k < forward ? "put" : "call", iv, forward, oi));
  }
  return out;
}

describe("smileEnDelta — lecture d'une échéance à delta constant", () => {
  it("interpole exactement un smile linéaire en delta (25Δ, 10Δ) et lit l'ATM forward", () => {
    const pts = echeanceLineaire(30, 101_000);
    const s = smileEnDelta(pts, SPOT, NOW)!;
    expect(s).not.toBeNull();
    expect(s.forward).toBe(101_000);
    expect(s.c25).toBeCloseTo(45, 9);
    expect(s.p25).toBeCloseTo(55, 9);
    expect(s.c10).toBeCloseTo(42, 9);
    expect(s.p10).toBeCloseTo(58, 9);
    expect(s.atm).toBeCloseTo(ivAtmLineaire(30 / 365), 9);
  });

  it("utilise le forward de l'échéance, pas l'index, pour la moneyness et le delta", () => {
    // Même smile construit autour d'un forward 10 % au-dessus de l'index : lecture inchangée.
    const s = smileEnDelta(echeanceLineaire(30, 110_000), SPOT, NOW)!;
    expect(s.c25).toBeCloseTo(45, 9);
    expect(s.p25).toBeCloseTo(55, 9);
  });

  it("garde-fou : moins de 2 strikes hors de la monnaie d'un côté → null", () => {
    const exp = NOW + 30 * JOUR;
    const unSeulPut = [
      option(exp, 90_000, "put", 55, SPOT),
      option(exp, 100_000, "call", 50, SPOT),
      option(exp, 110_000, "call", 48, SPOT),
      option(exp, 120_000, "call", 47, SPOT),
    ];
    expect(smileEnDelta(unSeulPut, SPOT, NOW)).toBeNull();
    // Les puts au-dessus du forward (dans la monnaie) ne comptent pas comme côté bas.
    expect(smileEnDelta([...unSeulPut, option(exp, 105_000, "put", 51, SPOT)], SPOT, NOW)).toBeNull();
    expect(smileEnDelta([...unSeulPut, option(exp, 85_000, "put", 57, SPOT)], SPOT, NOW)).not.toBeNull();
  });

  it("écarte les IV absentes ou nulles, le forward absent et les échéances de moins de 24 h", () => {
    const pts = echeanceLineaire(30, SPOT).map((p) => ({ ...p, markIv: p.type === "put" ? NaN : p.markIv }));
    expect(smileEnDelta(pts, SPOT, NOW)).toBeNull();
    expect(smileEnDelta(echeanceLineaire(30, SPOT).map((p) => ({ ...p, underlying: NaN })), SPOT, NOW)).toBeNull();
    const court = echeancePlate(0.9, 50);
    expect(smileEnDelta(court, SPOT, NOW)).toBeNull();
    expect(smileEnDelta(echeanceLineaire(30, SPOT), NaN, NOW)).toBeNull();
    expect(smileEnDelta([], SPOT, NOW)).toBeNull();
  });

  it("10Δ adossé seulement si chaque option d'ancrage porte ≥ 1 M$ d'OI au spot", () => {
    const oiSeuil = SEUIL_OI_AILE_10D_USD / SPOT; // 10 BTC
    expect(smileEnDelta(echeanceLineaire(30, SPOT, oiSeuil), SPOT, NOW)!.aile10Adossee).toBe(true);
    expect(smileEnDelta(echeanceLineaire(30, SPOT, oiSeuil * 0.99), SPOT, NOW)!.aile10Adossee).toBe(false);
    // Un 25Δ reste calculé sans condition d'OI.
    expect(smileEnDelta(echeanceLineaire(30, SPOT, 0), SPOT, NOW)!.c25).toBeCloseTo(45, 9);
  });
});

describe("surfaceMaturiteConstante — interpolation en variance totale", () => {
  it("smile plat : ATM = IV, RR et BF nuls, à 7, 30 et 90 j", () => {
    const chain = [5, 10, 25, 35, 80, 100].flatMap((j) => echeancePlate(j, 50));
    const surf = surfaceMaturiteConstante(chain, SPOT, NOW);
    for (const p of surf.points) {
      expect(p.etat).toBe("mesuree");
      expect(p.atm).toBeCloseTo(50, 9);
      expect(p.rr25).toBeCloseTo(0, 9);
      expect(p.bf25).toBeCloseTo(0, 9);
    }
    expect(surf.points.map((p) => p.jours)).toEqual([7, 30, 90]);
  });

  it("interpole σ²T linéairement entre les échéances encadrantes (σ(30 j) entre 20 et 40 j)", () => {
    const chain = [...echeancePlate(20, 40), ...echeancePlate(40, 60)];
    const p30 = surfaceMaturiteConstante(chain, SPOT, NOW).points.find((p) => p.jours === 30)!;
    // w = (40²·20 + 60²·40) / 2 = 88 000 → σ = √(88 000 / 30).
    expect(p30.atm).toBeCloseTo(Math.sqrt(88_000 / 30), 9);
    expect(p30.avantMs).toBe(NOW + 20 * JOUR);
    expect(p30.apresMs).toBe(NOW + 40 * JOUR);
  });

  it("une échéance pile sur l'horizon est lue telle quelle", () => {
    const chain = [...echeanceLineaire(30, SPOT), ...echeancePlate(60, 70)];
    const p30 = surfaceMaturiteConstante(chain, SPOT, NOW).points.find((p) => p.jours === 30)!;
    expect(p30.rr25).toBeCloseTo(-10, 9);
    expect(p30.bf25).toBeCloseTo(50 - ivAtmLineaire(30 / 365), 9);
    expect(p30.avantMs).toBe(p30.apresMs);
  });

  it("sans échéance au-delà de l'horizon : non mesuré, jamais extrapolé", () => {
    const chain = [10, 20, 40, 60].flatMap((j) => echeancePlate(j, 50));
    const surf = surfaceMaturiteConstante(chain, SPOT, NOW);
    const p90 = surf.points.find((p) => p.jours === 90)!;
    expect(p90).toMatchObject({ etat: "non-encadree", atm: null, rr25: null, bf25: null, aile10: "non-mesuree" });
    // 7 j : la plus courte échéance exploitable est à 10 j → non encadré non plus.
    expect(surf.points.find((p) => p.jours === 7)!.etat).toBe("non-encadree");
  });

  it("une échéance rejetée par le garde-fou est remplacée par la suivante exploitable", () => {
    const exp25 = NOW + 25 * JOUR;
    const degeneree = [option(exp25, 90_000, "put", 99, SPOT), option(exp25, 110_000, "call", 99, SPOT)];
    const chain = [...echeancePlate(20, 40), ...degeneree, ...echeancePlate(40, 60)];
    const surf = surfaceMaturiteConstante(chain, SPOT, NOW);
    expect(surf.nbEcheancesEcartees).toBe(1);
    expect(surf.nbEcheancesRetenues).toBe(2);
    expect(surf.points.find((p) => p.jours === 30)!.atm).toBeCloseTo(Math.sqrt(88_000 / 30), 9);
  });

  it("10Δ masqué quand l'OI des ailes est insuffisant, affiché sinon", () => {
    const faible = surfaceMaturiteConstante([...echeanceLineaire(20, SPOT, 1), ...echeanceLineaire(40, SPOT, 1)], SPOT, NOW);
    const p30f = faible.points.find((p) => p.jours === 30)!;
    expect(p30f.aile10).toBe("oi-insuffisante");
    expect(p30f.rr10).toBeNull();
    expect(p30f.bf10).toBeNull();
    expect(p30f.rr25).toBeCloseTo(-10, 1);
    const fort = surfaceMaturiteConstante([...echeanceLineaire(20, SPOT, 50), ...echeanceLineaire(40, SPOT, 50)], SPOT, NOW);
    const p30 = fort.points.find((p) => p.jours === 30)!;
    expect(p30.aile10).toBe("affichee");
    expect(p30.rr10).toBeCloseTo(-16, 1);
  });

  it("ignore les échéances expirées à nowMs", () => {
    const chain = [...echeancePlate(-1, 99), ...echeancePlate(20, 40), ...echeancePlate(40, 60)];
    const surf = surfaceMaturiteConstante(chain, SPOT, NOW);
    expect(surf.nbEcheancesRetenues + surf.nbEcheancesEcartees).toBe(2);
  });
});

// ─────────────────────────── Historique ───────────────────────────

/** Point d'archive synthétique : RR25 30 j = `rr`, le reste nul. */
function pointRr(jour: string, rr: number, heure = "09:00"): PointHistoriqueSurface {
  const v: (number | null)[] = Array.from({ length: 15 }, () => null);
  v[5 + 1] = rr; // maturité 30 j (index 1) × 5 champs, champ rr25 (index 1)
  return { j: jour, t: Date.parse(`${jour}T${heure}:00Z`), v };
}

function joursAvant(n: number, depuis = NOW): string {
  return new Date(depuis - n * JOUR).toISOString().slice(0, 10);
}

describe("historique quotidien — instantané, archive, lecture causale", () => {
  it("heure d'instantané : 08:05 UTC inclus", () => {
    expect(apresHeureInstantane(Date.parse("2026-11-07T08:04:59Z"))).toBe(false);
    expect(apresHeureInstantane(Date.parse("2026-11-07T08:05:00Z"))).toBe(true);
    expect(apresHeureInstantane(Date.parse("2026-11-07T23:59:59Z"))).toBe(true);
    expect(apresHeureInstantane(NaN)).toBe(false);
  });

  it("pointHistorique : 15 valeurs arrondies au centième, null si rien n'est mesuré (≈ 130 o)", () => {
    const chain = [5, 10, 25, 35, 80, 100].flatMap((j) => echeancePlate(j, 50.123456));
    const p = pointHistorique(surfaceMaturiteConstante(chain, SPOT, NOW), NOW)!;
    expect(p.j).toBe("2026-11-07");
    expect(p.v).toHaveLength(15);
    expect(p.v[0]).toBe(50.12);
    expect(JSON.stringify(p).length).toBeLessThan(300);
    expect(pointHistorique(surfaceMaturiteConstante([], SPOT, NOW), NOW)).toBeNull();
  });

  it("validerArchive écarte les points mal formés ou mal datés", () => {
    const bon = pointRr("2026-11-06", -3);
    const archive = validerArchive({ v: 1, points: [bon, { ...bon, j: "2026-11-05" }, { j: "x" }, { ...bon, v: [1] }] });
    expect(archive?.points).toEqual([bon]);
    expect(validerArchive({ v: 2, points: [] })).toBeNull();
    expect(validerArchive(null)).toBeNull();
  });

  it("fusion : union par jour, premier instantané du jour gardé, plafond de taille", () => {
    const tot = pointRr("2026-11-06", -3, "08:10");
    const tard = pointRr("2026-11-06", -9, "15:00");
    const autre = pointRr("2026-11-05", -1);
    const f = fusionnerArchives({ v: 1, points: [tard] }, { v: 1, points: [tot, autre] }, null);
    expect(f.points).toEqual([autre, tot]);
    const beaucoup: ArchiveSurface = { v: 1, points: Array.from({ length: MAX_POINTS_ARCHIVE + 20 }, (_, i) => pointRr(joursAvant(i + 1), i)) };
    const plafonnee = fusionnerArchives(beaucoup);
    expect(plafonnee.points).toHaveLength(MAX_POINTS_ARCHIVE);
    expect(plafonnee.points[plafonnee.points.length - 1]!.j).toBe(joursAvant(1));
  });

  it("sparkline et percentile seulement à partir de 90 points ; couverture affichée", () => {
    const peu: ArchiveSurface = { v: 1, points: Array.from({ length: 89 }, (_, i) => pointRr(joursAvant(i + 1), i)) };
    const l89 = lireHistorique(peu, 30, "rr25", 50, NOW);
    expect(l89.sparkline).toBe(false);
    expect(l89.percentile).toBeNull();
    expect(l89.couverture).toEqual({ jours: 89, joursPossibles: 90, debutMs: Date.parse(`${joursAvant(89)}T09:00:00Z`) });

    const assez: ArchiveSurface = { v: 1, points: [...peu.points, pointRr(joursAvant(95), 0)] };
    const l90 = lireHistorique(assez, 30, "rr25", 44.5, NOW);
    expect(l90.sparkline).toBe(true);
    // Valeurs 0…88 et 0 : 46 strictement sous 44,5 (0, 0, 1…44) sur 90.
    expect(l90.percentile).toBe(Math.round((100 * 46) / 90));
    expect(l90.couverture?.joursPossibles).toBe(96);
    expect(l90.precedent).toEqual({ t: Date.parse(`${joursAvant(1)}T09:00:00Z`), v: 0 });
  });

  it("causalité par préfixe : des points postérieurs à nowMs ne changent pas la lecture", () => {
    const base: ArchiveSurface = { v: 1, points: Array.from({ length: 120 }, (_, i) => pointRr(joursAvant(i + 1), Math.sin(i) * 5)) };
    const avecFutur = fusionnerArchives(base, { v: 1, points: [pointRr("2026-11-08", 99), pointRr("2026-11-07", 98, "11:00")] });
    expect(lireHistorique(avecFutur, 30, "rr25", 1, NOW)).toEqual(lireHistorique(base, 30, "rr25", 1, NOW));
  });

  it("fenêtre d'un an : les points de plus de 365 j sortent du percentile", () => {
    const vieux = Array.from({ length: 100 }, (_, i) => pointRr(joursAvant(400 + i), -50));
    const recents = Array.from({ length: 95 }, (_, i) => pointRr(joursAvant(i + 1), 10));
    const l = lireHistorique({ v: 1, points: [...vieux, ...recents] }, 30, "rr25", 0, NOW);
    expect(l.serie).toHaveLength(95);
    expect(l.percentile).toBe(0);
  });

  it("archive vide : aucune couverture, aucune valeur inventée", () => {
    expect(lireHistorique(ARCHIVE_VIDE, 7, "atm", 50, NOW)).toEqual({ serie: [], percentile: null, sparkline: false, couverture: null, precedent: null });
    expect(couvertureArchive(ARCHIVE_VIDE, NOW)).toBeNull();
  });

  it("couverture globale : jours capturés sur jours calendaires, instantanés futurs ignorés", () => {
    const points = [pointRr(joursAvant(10), 1), pointRr(joursAvant(3), 2), pointRr(joursAvant(0), 3, "08:30"), pointRr("2026-11-09", 4)];
    expect(couvertureArchive({ v: 1, points }, NOW)).toEqual({ jours: 3, joursPossibles: 11, debutMs: points[0]!.t });
  });

  it("lireSurfaceHistorique : une lecture par maturité, valeur courante comparée à l'archive", () => {
    const chain = [5, 10, 25, 35, 80, 100].flatMap((j) => echeancePlate(j, 50));
    const surface = surfaceMaturiteConstante(chain, SPOT, NOW);
    const archive: ArchiveSurface = { v: 1, points: [pointRr(joursAvant(1), -2)] };
    const lectures = lireSurfaceHistorique(surface, archive, NOW);
    expect(lectures.map((l) => l.point.jours)).toEqual([7, 30, 90]);
    expect(lectures[1]!.rr25.precedent?.v).toBe(-2);
    expect(lectures[0]!.rr25.precedent).toBeNull();
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

describe("capturerSurfaceDuJour — un instantané par jour UTC après 08:05", () => {
  const chain = [5, 10, 25, 35, 80, 100].flatMap((j) => echeancePlate(j, 50));
  beforeEach(() => {
    vi.stubGlobal("localStorage", stockage());
    // Aucun appel réseau : la sonde du daemon échoue comme hors ligne.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("hors réseau"); }));
    _viderCapturesSurface();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("n'écrit rien avant 08:05 UTC, écrit au premier chargement suivant, jamais deux fois le même jour", async () => {
    const avant = Date.parse("2026-11-07T08:00:00Z");
    expect(await capturerSurfaceDuJour("BTC", chain, SPOT, avant)).toBeNull();
    expect(localStorage.getItem(cleLocaleSurface("BTC"))).toBeNull();

    const t1 = Date.parse("2026-11-07T08:30:00Z");
    const archive = await capturerSurfaceDuJour("BTC", chain, SPOT, t1);
    expect(archive?.points).toHaveLength(1);
    expect(archive?.points[0]!.t).toBe(t1);

    // Deuxième chargement du jour (autre session) : le premier instantané reste.
    _viderCapturesSurface();
    expect(await capturerSurfaceDuJour("BTC", chain.map((p) => ({ ...p, markIv: 80 })), SPOT, t1 + 3_600_000)).toBeNull();
    const relue = await lireArchiveSurface("BTC");
    expect(relue.daemon).toBe(false);
    expect(relue.archive.points).toHaveLength(1);
    expect(relue.archive.points[0]!.v[0]).toBe(50);

    // Lendemain : nouveau point, ETH indépendant.
    const t2 = Date.parse("2026-11-08T09:00:00Z");
    expect((await capturerSurfaceDuJour("BTC", chain, SPOT, t2))?.points).toHaveLength(2);
    expect((await lireArchiveSurface("ETH")).archive.points).toHaveLength(0);
  });

  it("surface vide (chaîne inexploitable) : rien n'est écrit", async () => {
    expect(await capturerSurfaceDuJour("BTC", [], SPOT, Date.parse("2026-11-07T09:00:00Z"))).toBeNull();
    expect(localStorage.getItem(cleLocaleSurface("BTC"))).toBeNull();
  });

  it("archive locale corrompue : relue comme vide, sans exception", async () => {
    localStorage.setItem(cleLocaleSurface("BTC"), "{pas du json");
    expect((await lireArchiveSurface("BTC")).archive.points).toEqual([]);
  });

  it("garde la constante de seuil d'affichage à 90 points", () => {
    expect(MIN_POINTS_HISTORIQUE).toBe(90);
  });
});
