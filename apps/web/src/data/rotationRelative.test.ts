/**
 * Tests du nuage de rotation contre BTC (data/rotationRelative.ts) : construction
 * (X = BTC × c au centre), quadrants sur des log-ratios synthétiques dont le signe est
 * démontrable à la main, données manquantes explicites, causalité par préfixe et
 * exclusion de la bougie du jour courant.
 */
import { describe, expect, it } from "vitest";
import type { SerieCloture } from "./corr";
import {
  calculerRotation,
  calculerSeriesRotation,
  classerPaireTransversale,
  classerUniversTransversal,
  compterQuadrants,
  decouperPaireCrypto,
  FENETRE_Z_ROTATION,
  LONGUEUR_TRAINE,
  OBS_MIN_POINT,
  OBS_TRAINE_COMPLETE,
  PAS_MOMENTUM_ROTATION,
  quadrantRotation,
  serieRatio,
  zGlissant,
} from "./rotationRelative";

const JOUR = 86_400_000;
/** Premier jour UTC des fixtures (numéro de jour ≈ 2024-10). */
const J0 = 20_000;
/** Nombre de jours clos des fixtures (≥ OBS_TRAINE_COMPLETE). */
const N = 400;
/** « Maintenant » : midi UTC du jour qui SUIT la dernière clôture de fixture. */
const NOW = (J0 + N) * JOUR + 12 * 3_600_000;

/** BTC synthétique : marche déterministe (variance non nulle), toujours > 0. */
function btc(n = N): SerieCloture[] {
  return Array.from({ length: n }, (_, t) => ({
    time: (J0 + t) * JOUR,
    close: 30_000 * Math.exp(0.02 * Math.sin(t / 3) + 0.0005 * t),
  }));
}

/** Actif X = BTC × exp(l[t]) : son log-ratio contre BTC vaut exactement l[t]. */
function actifDepuisLogRatio(ref: SerieCloture[], l: (t: number) => number): SerieCloture[] {
  return ref.map((p, t) => ({ time: p.time, close: p.close * Math.exp(l(t)) }));
}

/** Petit bruit déterministe pour éviter les fenêtres constantes. */
const bruit = (t: number): number => 0.002 * Math.sin(t * 1.7) + 0.001 * Math.cos(t * 0.37);

describe("quadrantRotation", () => {
  it("classe par le signe des deux coordonnées, neutre sur un axe", () => {
    expect(quadrantRotation(1, 1)).toBe("meneur");
    expect(quadrantRotation(1, -1)).toBe("affaiblissement");
    expect(quadrantRotation(-1, -1)).toBe("retard");
    expect(quadrantRotation(-1, 1)).toBe("amelioration");
    expect(quadrantRotation(0, 0)).toBe("neutre");
    expect(quadrantRotation(0.5, 0)).toBe("neutre");
  });
});

describe("zGlissant", () => {
  it("z-score population sur la fenêtre (valeur calculée à la main)", () => {
    // [1, 2, 3] : moyenne 2, écart-type population √(2/3) ⇒ z(3) = 1/√(2/3) = 1,2247…
    const z = zGlissant([1, 2, 3], 3);
    expect(z[0]).toBeNull();
    expect(z[1]).toBeNull();
    expect(z[2]).toBeCloseTo(1 / Math.sqrt(2 / 3), 12);
  });

  it("fenêtre constante ⇒ 0 ; valeur non finie dans la fenêtre ⇒ null", () => {
    expect(zGlissant([5, 5, 5, 5], 3)).toEqual([null, null, 0, 0]);
    const z = zGlissant([1, NaN, 3, 4, 5], 2);
    expect(z[1]).toBeNull();
    expect(z[2]).toBeNull(); // fenêtre [NaN, 3]
    expect(z[3]).toBeCloseTo(1, 12); // [3, 4] : écart 0,5 ⇒ z = 0,5/0,5
  });
});

describe("calculerRotation — construction et quadrants", () => {
  const ref = btc();

  it("actif = BTC × c : ratio constant ⇒ point au centre exact (0, 0), quadrant neutre", () => {
    const x3 = ref.map((p) => ({ time: p.time, close: 3 * p.close }));
    const r = calculerRotation(new Map([["X3USDT", x3]]), ["X3USDT"], ref, NOW);
    expect(r.points).toHaveLength(1);
    const p = r.points[0]!;
    expect(p.x).toBe(0);
    expect(p.y).toBe(0);
    expect(p.quadrant).toBe("neutre");
    expect(p.jour).toBe(J0 + N - 1);
  });

  it("ratio qui accélère en fin d'historique ⇒ meneur ; qui chute ⇒ en retard", () => {
    // 20 derniers jours : +2 %/j de log-ratio (resp. −2 %/j), après un an quasi plat.
    const hausse = actifDepuisLogRatio(ref, (t) => bruit(t) + (t >= N - 20 ? 0.02 * (t - (N - 21)) : 0));
    const baisse = actifDepuisLogRatio(ref, (t) => bruit(t) - (t >= N - 20 ? 0.02 * (t - (N - 21)) : 0));
    const r = calculerRotation(
      new Map([
        ["HAUSSEUSDT", hausse],
        ["BAISSEUSDT", baisse],
      ]),
      ["HAUSSEUSDT", "BAISSEUSDT"],
      ref,
      NOW,
    );
    const [h, b] = r.points;
    expect(h?.quadrant).toBe("meneur");
    expect(h!.x).toBeGreaterThan(0);
    expect(h!.y).toBeGreaterThan(0);
    expect(b?.quadrant).toBe("retard");
  });

  it("ratio haut sur l'année qui se retourne ⇒ en affaiblissement ; l'inverse ⇒ en amélioration", () => {
    // l monte linéairement (≈ 1 sur l'année) puis perd 0,02/j sur les 10 derniers jours :
    // encore au-dessus de sa moyenne 52 semaines (x > 0), variation 14 j négative (y < 0).
    const pic = (t: number): number => (t < N - 10 ? t / 380 : (N - 11) / 380 - 0.02 * (t - (N - 11)));
    const haut = actifDepuisLogRatio(ref, (t) => bruit(t) + pic(t));
    const bas = actifDepuisLogRatio(ref, (t) => bruit(t) - pic(t));
    const r = calculerRotation(
      new Map([
        ["HAUTUSDT", haut],
        ["BASUSDT", bas],
      ]),
      ["HAUTUSDT", "BASUSDT"],
      ref,
      NOW,
    );
    expect(r.points.map((p) => p.quadrant)).toEqual(["affaiblissement", "amelioration"]);
    expect(compterQuadrants(r.points)).toEqual({
      meneur: 0,
      affaiblissement: 1,
      retard: 0,
      amelioration: 1,
      neutre: 0,
    });
  });

  it("traîne : 8 points chronologiques, le dernier est le point courant", () => {
    const x = actifDepuisLogRatio(ref, (t) => bruit(t) + 0.001 * t);
    const r = calculerRotation(new Map([["XUSDT", x]]), ["XUSDT"], ref, NOW);
    const p = r.points[0]!;
    expect(p.traine).toHaveLength(LONGUEUR_TRAINE);
    expect(p.traine.map((q) => q.jour)).toEqual(
      Array.from({ length: LONGUEUR_TRAINE }, (_, k) => J0 + N - LONGUEUR_TRAINE + k),
    );
    expect(p.traine[LONGUEUR_TRAINE - 1]).toEqual({ jour: p.jour, x: p.x, y: p.y });
  });
});

describe("calculerRotation — données manquantes explicites (jamais au centre)", () => {
  const ref = btc();

  it("série vide, historique court, référence dans l'univers : listés non placés avec raison", () => {
    const court = actifDepuisLogRatio(ref, bruit).slice(-100);
    const r = calculerRotation(
      new Map([
        ["VIDEUSDT", []],
        ["COURTUSDT", court],
        ["BTCUSDT", ref],
      ]),
      ["VIDEUSDT", "COURTUSDT", "BTCUSDT", "ABSENTUSDT"],
      ref,
      NOW,
    );
    expect(r.points).toEqual([]);
    expect(r.nonPlaces.map((n) => n.symbole)).toEqual(["VIDEUSDT", "COURTUSDT", "BTCUSDT", "ABSENTUSDT"]);
    expect(r.nonPlaces[0]!.raison).toMatch(/indisponible/);
    expect(r.nonPlaces[1]!.raison).toBe(`historique insuffisant : 100 jours communs avec BTC (${OBS_MIN_POINT} requis)`);
    expect(r.nonPlaces[2]!.raison).toMatch(/référence/);
    expect(r.nonPlaces[3]!.raison).toMatch(/indisponible/);
  });

  it("seuil exact : OBS_MIN_POINT jours communs ⇒ placé, traîne réduite à 1 point", () => {
    expect(OBS_MIN_POINT).toBe(PAS_MOMENTUM_ROTATION + FENETRE_Z_ROTATION);
    expect(OBS_TRAINE_COMPLETE).toBeLessThan(N);
    const x = actifDepuisLogRatio(ref, (t) => bruit(t) + 0.001 * t).slice(-OBS_MIN_POINT);
    const r = calculerRotation(new Map([["XUSDT", x]]), ["XUSDT"], ref, NOW);
    expect(r.points).toHaveLength(1);
    expect(r.points[0]!.traine).toHaveLength(1);
    const moinsUn = calculerRotation(new Map([["XUSDT", x.slice(1)]]), ["XUSDT"], ref, NOW);
    expect(moinsUn.points).toHaveLength(0);
  });

  it("actif en retard sur BTC (dernier jour absent) ⇒ non placé", () => {
    const x = actifDepuisLogRatio(ref, bruit).slice(0, -1);
    const r = calculerRotation(new Map([["XUSDT", x]]), ["XUSDT"], ref, NOW);
    expect(r.points).toEqual([]);
    expect(r.nonPlaces[0]!.raison).toMatch(/retard/);
  });

  it("référence vide ⇒ aucun point, refDisponible faux", () => {
    const r = calculerRotation(new Map([["XUSDT", ref]]), ["XUSDT"], [], NOW);
    expect(r.refDisponible).toBe(false);
    expect(r.dernierJour).toBeNull();
    expect(r.nonPlaces).toEqual([{ symbole: "XUSDT", raison: "référence BTC indisponible" }]);
  });
});

describe("calculerRotation — causalité", () => {
  const ref = btc();
  const x = actifDepuisLogRatio(ref, (t) => bruit(t) + 0.3 * Math.sin(t / 40));

  it("préfixe : les séries sur les N premiers jours ne changent pas quand on en ajoute", () => {
    const complet = calculerSeriesRotation(x, ref);
    const k = N - 6;
    const prefixe = calculerSeriesRotation(x.slice(0, k), ref.slice(0, k));
    expect(prefixe.rsMomentum.some((v) => v !== null)).toBe(true);
    for (let t = 0; t < k; t++) {
      expect(prefixe.rsRatio[t]).toBe(complet.rsRatio[t]);
      expect(prefixe.rsMomentum[t]).toBe(complet.rsMomentum[t]);
    }
  });

  it("la bougie du jour UTC courant (partielle) est écartée : un prix extrême ne bouge rien", () => {
    const base = calculerRotation(new Map([["XUSDT", x]]), ["XUSDT"], ref, NOW);
    const jourCourant = { time: (J0 + N) * JOUR, close: 1e9 };
    const avecPartielle = calculerRotation(
      new Map([["XUSDT", [...x, jourCourant]]]),
      ["XUSDT"],
      [...ref, { time: (J0 + N) * JOUR, close: 1 }],
      NOW,
    );
    expect(avecPartielle).toEqual(base);
  });
});


describe("calculerRotation — durées calendaires exactes (revue du 2026-11-07)", () => {
  const ref = btc();
  const x = actifDepuisLogRatio(ref, (t) => bruit(t) + 0.001 * t);
  /** Retire le jour d'index `k` de la série (clôture manquante). */
  const sansJour = (serie: SerieCloture[], k: number) => serie.filter((_, t) => t !== k);
  const iso = (jour: number) => new Date(jour * JOUR).toISOString().slice(0, 10);

  it("calendrier contigu : un jour manquant n'est pas enjambé, il invalide les fenêtres qui le contiennent", () => {
    const g = 5;
    const s = calculerSeriesRotation(sansJour(x, g), ref);
    expect(s.jours).toEqual(Array.from({ length: N }, (_, k) => J0 + k));
    expect(s.nCommuns).toBe(N - 1);
    expect(Number.isNaN(s.logRatio[g])).toBe(true);
    // RS-Ratio : fenêtres [t−363 .. t] contenant g ⇒ null jusqu'à t = g + 363.
    expect(s.rsRatio[g + FENETRE_Z_ROTATION - 1]).toBeNull();
    expect(s.rsRatio[g + FENETRE_Z_ROTATION]).not.toBeNull();
    // RS-Momentum : m[g + 14] (borne passée = le trou) est NaN ⇒ null tant que la fenêtre le contient.
    const m = g + PAS_MOMENTUM_ROTATION;
    expect(s.rsMomentum[m + FENETRE_Z_ROTATION - 1]).toBeNull();
    expect(s.rsMomentum[m + FENETRE_Z_ROTATION]).not.toBeNull();
  });

  it("trou dans les 378 derniers jours ⇒ non placé, raison datée (l'ancienne branche morte est atteinte)", () => {
    const g = N - 50;
    const r = calculerRotation(new Map([["XUSDT", sansJour(x, g)]]), ["XUSDT"], ref, NOW);
    expect(r.points).toEqual([]);
    expect(r.nonPlaces).toHaveLength(1);
    expect(r.nonPlaces[0]!.raison).toContain(`clôture manquante le ${iso(J0 + g)}`);
    expect(r.nonPlaces[0]!.raison).toContain(`${OBS_MIN_POINT} derniers jours`);
  });

  it("trou plus ancien que la fenêtre ⇒ placé, nObs = jours communs réels", () => {
    const r = calculerRotation(new Map([["XUSDT", sansJour(x, 5)]]), ["XUSDT"], ref, NOW);
    expect(r.points).toHaveLength(1);
    expect(r.points[0]!.nObs).toBe(N - 1);
    // Mêmes coordonnées que sans trou : la fenêtre du dernier jour ne le voit pas.
    const intact = calculerRotation(new Map([["XUSDT", x]]), ["XUSDT"], ref, NOW).points[0]!;
    expect(r.points[0]!.x).toBeCloseTo(intact.x, 12);
    expect(r.points[0]!.y).toBeCloseTo(intact.y, 12);
  });

  it("trou côté BTC : même règle (clôture commune manquante)", () => {
    const g = N - 3;
    const r = calculerRotation(new Map([["XUSDT", x]]), ["XUSDT"], sansJour(ref, g), NOW);
    expect(r.points).toEqual([]);
    expect(r.nonPlaces[0]!.raison).toContain(iso(J0 + g));
  });
});

describe("univers de la coupe : cotation en dollar, BTC par sa base (revue du 2026-11-07)", () => {
  it("découpage : perps en USD, tiret Coinbase, alias Kraken XBT, FDUSD chez Binance", () => {
    expect(decouperPaireCrypto("BTC-PERP", "hyperliquid")).toEqual({ base: "BTC", quote: "USD" });
    expect(decouperPaireCrypto("eth-perp", "binance")).toEqual({ base: "ETH", quote: "USD" });
    expect(decouperPaireCrypto("ETHBTC", "binance")).toEqual({ base: "ETH", quote: "BTC" });
    expect(decouperPaireCrypto("XBTUSD", "kraken")).toEqual({ base: "BTC", quote: "USD" });
    expect(decouperPaireCrypto("ETH-USD", "coinbase")).toEqual({ base: "ETH", quote: "USD" });
    expect(decouperPaireCrypto("BTCFDUSD", "binance")).toEqual({ base: "BTC", quote: "FDUSD" });
    expect(decouperPaireCrypto("FOO", "binance")).toBeNull();
  });

  it("classement d'une paire : référence (base BTC, spot ou perp), alt, ou exclue avec raison", () => {
    expect(classerPaireTransversale("BTCUSDT", "binance")).toEqual({ type: "reference" });
    expect(classerPaireTransversale("BTC-PERP", "hyperliquid")).toEqual({ type: "reference" });
    expect(classerPaireTransversale("BTCUSD", "kraken")).toEqual({ type: "reference" });
    expect(classerPaireTransversale("WBTCUSDT", "binance")).toEqual({ type: "alt", base: "WBTC" });
    expect(classerPaireTransversale("ETHUSDC", "binance")).toEqual({ type: "alt", base: "ETH" });
    const ethbtc = classerPaireTransversale("ETHBTC", "binance");
    expect(ethbtc.type).toBe("exclu");
    expect(ethbtc.type === "exclu" && ethbtc.raison).toMatch(/cotation BTC \(non USD\).*X\/BTC²/);
    const soleth = classerPaireTransversale("SOLETH", "binance");
    expect(soleth.type === "exclu" && soleth.raison).toMatch(/cotation ETH \(non USD\)/);
    const btceur = classerPaireTransversale("BTCEUR", "kraken");
    expect(btceur.type === "exclu" && btceur.raison).toMatch(/cotation EUR \(non USD\)/);
  });

  it("univers watchlist : ETHBTC et la paire en EUR écartés et listés, BTC-PERP compté comme la référence, doublon d'actif compté une fois", () => {
    const sourceDe = (s: string) =>
      s.endsWith("-PERP") ? ("hyperliquid" as const) : s === "SPY" ? ("twelvedata" as const) : ("binance" as const);
    const c = classerUniversTransversal(
      ["ethusdt", "ETHBTC", "BTC-PERP", "SOLEUR", "BTCUSDT", "ETH-PERP", "SPY", "SOLUSDT", "ETHUSDT", " "],
      sourceDe,
    );
    expect(c.alts).toEqual(["ETHUSDT", "SOLUSDT"]);
    expect(c.references).toEqual(["BTC-PERP", "BTCUSDT"]);
    expect(c.horsCrypto).toEqual(["SPY"]);
    expect(c.exclus.map((e) => e.symbole)).toEqual(["ETHBTC", "SOLEUR", "ETH-PERP"]);
    expect(c.exclus[0]!.raison).toMatch(/non USD/);
    expect(c.exclus[1]!.raison).toMatch(/EUR/);
    expect(c.exclus[2]!.raison).toBe("même actif que ETHUSDT (base ETH) : compté une fois");
  });

  it("garde rejouée dans le calcul : ETHBTC, BTC-PERP et BTCEUR passés tels quels ne sont jamais placés", () => {
    const ref = btc();
    // ETHBTC réelle : ETH/BTC. Divisée par BTCUSDT, elle donnerait ETH/BTC² (le défaut relevé).
    const ethUsd = actifDepuisLogRatio(ref, (t) => bruit(t) + 0.3 * Math.sin(t / 40));
    const ethBtc = ethUsd.map((p, t) => ({ time: p.time, close: p.close / (ref[t] as SerieCloture).close }));
    const series = new Map<string, SerieCloture[]>([
      ["ETHUSDT", ethUsd],
      ["ETHBTC", ethBtc],
      ["BTC-PERP", ref],
      ["BTCEUR", ref.map((p) => ({ time: p.time, close: p.close * 0.92 }))],
    ]);
    const r = calculerRotation(series, ["ETHUSDT", "ETHBTC", "BTC-PERP", "BTCEUR"], ref, NOW);
    expect(r.points.map((p) => p.symbole)).toEqual(["ETHUSDT"]);
    expect(r.nonPlaces.map((n) => n.symbole)).toEqual(["ETHBTC", "BTC-PERP", "BTCEUR"]);
    expect(r.nonPlaces[0]!.raison).toMatch(/cotation BTC/);
    expect(r.nonPlaces[1]!.raison).toMatch(/référence/);
    expect(r.nonPlaces[2]!.raison).toMatch(/cotation EUR/);
  });
});

describe("serieRatio", () => {
  it("ratio X÷BTC daté sur les jours communs", () => {
    const ref: SerieCloture[] = [
      { time: J0 * JOUR, close: 100 },
      { time: (J0 + 1) * JOUR, close: 200 },
    ];
    const x: SerieCloture[] = [
      { time: (J0 + 1) * JOUR, close: 50 },
      { time: (J0 + 2) * JOUR, close: 60 },
    ];
    expect(serieRatio(x, ref)).toEqual({ jours: [J0 + 1], ratio: [0.25] });
  });
});
