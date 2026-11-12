/**
 * Tests de la fonction PURE `lectureBougie` : variation % (clôture vs ouverture),
 * amplitude (haut−bas) et sens. Le rendu DOM de l'encart est vérifié en navigateur
 * (`e2e/mobile-axis-sr.e2e.ts`).
 */
import { describe, expect, it } from "vitest";
import type { AnnotationsIndicateur, Candle, Timeframe } from "@axiom/types";
import { computeIndicator, getIndicator } from "@axiom/indicators";
import fixtureBtc from "../../../../packages/indicators/src/strategy/fixtures/btcusdt-4h-3000.json";
import { enPoints, lectureBougie, texteEncart } from "./candleReadout";

describe("lectureBougie", () => {
  it("bougie haussière", () => {
    const r = lectureBougie({ open: 100, high: 112, low: 98, close: 108 });
    expect(r.variationPct).toBeCloseTo(8, 6);
    expect(r.amplitude).toBeCloseTo(14, 6);
    expect(r.hausse).toBe(true);
  });

  it("bougie baissière", () => {
    const r = lectureBougie({ open: 200, high: 205, low: 180, close: 190 });
    expect(r.variationPct).toBeCloseTo(-5, 6);
    expect(r.amplitude).toBeCloseTo(25, 6);
    expect(r.hausse).toBe(false);
  });

  it("doji (clôture = ouverture) → variation 0, hausse", () => {
    const r = lectureBougie({ open: 100, high: 101, low: 99, close: 100 });
    expect(r.variationPct).toBe(0);
    expect(r.amplitude).toBeCloseTo(2, 6);
    expect(r.hausse).toBe(true);
  });

  it("ouverture 0 ou non finie → variation NaN (pas de division par zéro)", () => {
    const r = lectureBougie({ open: 0, high: 5, low: 0, close: 3 });
    expect(Number.isNaN(r.variationPct)).toBe(true);
    expect(r.amplitude).toBeCloseTo(5, 6);
  });
});

describe("enPoints — écarts d'une série en % (dominance) en points de pourcentage", () => {
  it("Δ signé (C − O) et amplitude non signée, à 2 décimales", () => {
    expect(enPoints(9.52 - 9.4, true)).toBe("+0.12 pt");
    expect(enPoints(9.4 - 9.52, true)).toBe("-0.12 pt");
    expect(enPoints(0, true)).toBe("+0.00 pt");
    expect(enPoints(9.61 - 9.38)).toBe("0.23 pt");
  });

  it("valeur non finie : tiret cadratin", () => {
    expect(enPoints(Number.NaN, true)).toBe("—");
  });
});

// ── Phase 2 d'AXIS (12 novembre 2026) : texte complet de l'annotation sous le doigt ──────────────
//
// `texteEncart` décide ce que le bloc de l'encart du téléphone écrit. Doctrine : aucune promesse de
// performance. Un texte coupé ne garde donc jamais « test réussi » ni un chiffre de campagne
// (Sharpe, drawdown, expectancy, suite moyenne d'un fort achat) sans la réserve qui le suit dans le
// texte complet. Les textes
// sont ceux que le graphe calcule sur le cas de référence BTCUSDT 4h, rangés par la STRUCTURE de
// leur annotation, jamais par leur libellé.

/** Une ligne du JSON, colonnes `time`, `open`, `high`, `low`, `close`, `volume`, `buyVolume`. */
type LigneFixture = [time: number, open: number, high: number, low: number, close: number, volume: number, buyVolume: number];
const BTC: Candle[] = (fixtureBtc.bougies as LigneFixture[]).map(([time, open, high, low, close, volume, buyVolume]) => ({
  time,
  open,
  high,
  low,
  close,
  volume,
  buyVolume,
  sellVolume: volume - buyVolume,
  closed: true,
}));
/** Les mêmes bougies sans volumes acheteur et vendeur : le delta taker devient « n.d. ». */
const SANS_DELTA: Candle[] = BTC.map(({ time, open, high, low, close, volume }) => ({ time, open, high, low, close, volume, closed: true }));

type Reglages = Record<string, number | boolean | string>;

/**
 * Annotations telles que le graphe les calcule. `oi` : open interest fourni (série plausible ; seule sa
 * présence compte ici, elle allonge le détail de « OI n.d. » à « OI +1.2 % sur 6 b. »). La fixture n'en
 * a pas, le graphe réel en reçoit pour un symbole USDT.
 */
function calculer(defId: string, reglages: Reglages = {}, unite: Timeframe = "4h", bougies: Candle[] = BTC, oi = false): AnnotationsIndicateur {
  const aux = {
    refClose: bougies.map((c) => c.close),
    ...(oi ? { oi: bougies.map((_c, i) => 80_000 * (1 + 0.05 * Math.sin(i / 7))) } : {}),
  };
  return computeIndicator(getIndicator(defId)!, bougies, reglages, aux, unite).annotations ?? {};
}

/** Textes d'infobulle par famille d'annotation. */
function familles(a: AnnotationsIndicateur) {
  const marqueurs = (a.marqueurs ?? []).filter((m) => m.info !== undefined);
  const infos = (liste: Array<{ info?: string }>) => liste.map((x) => x.info!);
  return {
    zones: infos((a.rubans ?? []).filter((r) => r.info !== undefined)),
    creux: infos(marqueurs.filter((m) => m.creux === true)),
    retournements: infos(marqueurs.filter((m) => m.couleur === "--text-dim")),
    forts: infos(marqueurs.filter((m) => m.couleur === "--accent")),
    confirmes: infos(marqueurs.filter((m) => m.creux !== true && (m.couleur === "--up" || m.couleur === "--down"))),
    preSignal: infos((a.segments ?? []).filter((s) => s.info !== undefined)),
  };
}
const tous = (f: ReturnType<typeof familles>): string[] => Object.values(f).flat();

const SEPARATEUR = " — ";
/** Réserve pré-enregistrée du test réussi : même partie du texte que « test réussi » (stratAxis.ts, `RESERVE`). */
const RESERVE_TEST_REUSSI = "pas mieux qu'une EMA 200 seule sur 3/4 actifs";
/**
 * Chiffres de campagne : ils ne valent qu'avec la réserve écrite après le séparateur qui les suit.
 * « en moyenne » est la suite mesurée d'un fort achat (« +1.61 % en moyenne sur les 12 bougies
 * suivantes », stratAxis.ts, `MESURE_FORT_ACHAT` et `UNITES`).
 */
const CHIFFRE_DE_CAMPAGNE = /Sharpe|drawdown|expectancy|en moyenne/g;
const MOTS_DE_CAMPAGNE = /test réussi|pas mieux|Sharpe|drawdown|expectancy|en moyenne|mesure passée/;

/**
 * Doctrine sur un texte rendu, contre son texte complet : « test réussi » jamais sans sa réserve
 * pré-enregistrée ; un chiffre de campagne jamais sans la réserve qui suit, dans le texte complet,
 * le séparateur d'après (jusqu'à son premier « ; »). Rend les manquements.
 */
function manquements(rendu: string, complet: string): string[] {
  const corps = rendu === complet ? complet : rendu.slice(0, -2);
  const trouves: string[] = [];
  if (corps.includes("test réussi") && !corps.includes(RESERVE_TEST_REUSSI)) trouves.push("« test réussi » sans sa réserve");
  for (const m of corps.matchAll(CHIFFRE_DE_CAMPAGNE)) {
    const suite = complet.indexOf(SEPARATEUR, m.index);
    const reserve = suite < 0 ? undefined : complet.slice(suite + SEPARATEUR.length).split(/ ; | — /)[0]!;
    if (reserve === undefined || !corps.startsWith(reserve, suite + SEPARATEUR.length)) trouves.push(`« ${m[0]} » sans sa réserve`);
  }
  return trouves;
}

describe("texteEncart — règle", () => {
  const parties = (n: number, longueur: number): string => Array.from({ length: n }, (_x, i) => `partie ${i + 1} ${"x".repeat(longueur)}`).join(SEPARATEUR);

  it("un texte de 360 caractères au plus est rendu tel quel, quel que soit son nombre de parties", () => {
    const court = parties(6, 40);
    expect(court.length).toBeLessThanOrEqual(360);
    expect(texteEncart(court)).toBe(court);
    const juste = `${"a".repeat(170)}${SEPARATEUR}${"b".repeat(60)}${SEPARATEUR}${"c".repeat(60)}${SEPARATEUR}${"d".repeat(61)}`;
    expect(juste).toHaveLength(360);
    expect(texteEncart(juste)).toBe(juste);
  });

  it("au-delà, cinq parties ou plus : ses trois premières parties, entières, puis « … »", () => {
    const long = parties(6, 80);
    expect(long.length).toBeGreaterThan(360);
    expect(texteEncart(long)).toBe(`${long.split(SEPARATEUR).slice(0, 3).join(SEPARATEUR)} …`);
    // Un caractère de trop suffit.
    const debut = `${"a".repeat(170)}${SEPARATEUR}${"b".repeat(60)}${SEPARATEUR}${"c".repeat(60)}`;
    const juste = `${debut}${SEPARATEUR}${"d".repeat(30)}${SEPARATEUR}${"e".repeat(28)}`;
    expect(juste).toHaveLength(360);
    expect(texteEncart(juste)).toBe(juste);
    expect(texteEncart(`${juste}e`)).toBe(`${debut} …`);
    // Les trois parties sont rendues même si elles dépassent 360 caractères à elles seules.
    const detailLong = parties(5, 130);
    expect(texteEncart(detailLong)).toBe(`${detailLong.split(SEPARATEUR).slice(0, 3).join(SEPARATEUR)} …`);
    expect(texteEncart(detailLong).length).toBeGreaterThan(360);
  });

  it("la limite se règle : `max` décide seulement si le texte est rendu entier", () => {
    const texte = parties(5, 20);
    expect(texteEncart(texte, texte.length)).toBe(texte);
    expect(texteEncart(texte, texte.length - 1)).toBe(`${texte.split(SEPARATEUR).slice(0, 3).join(SEPARATEUR)} …`);
  });

  // Revue du 12 novembre 2026. La réserve d'un texte est sa dernière partie. S'arrêter à la
  // troisième partie d'un texte de quatre rendait le chiffre d'un fort achat (« +1.61 % en moyenne
  // … », troisième partie) sans sa réserve (quatrième), dès que ce texte dépassait la limite.
  it("quatre parties : le texte entier, même au-delà de la limite — on ne s'arrête jamais juste avant la dernière partie", () => {
    const quatre = parties(4, 110);
    expect(quatre.length).toBeGreaterThan(360);
    expect(texteEncart(quatre)).toBe(quatre);
    // Une partie de plus, et la coupe aux trois premières revient.
    const cinq = parties(5, 110);
    expect(texteEncart(cinq)).toBe(`${cinq.split(SEPARATEUR).slice(0, 3).join(SEPARATEUR)} …`);
  });

  it("trois parties au plus et rien à retirer : pas de « … » ; garde-fou au double de la limite, coupe nette", () => {
    const troisParties = parties(3, 150);
    expect(troisParties.length).toBeGreaterThan(360);
    expect(texteEncart(troisParties)).toBe(troisParties);
    // Le garde-fou vaut aussi pour quatre parties.
    expect(texteEncart(parties(4, 300))).toBe(`${parties(4, 300).slice(0, 720)} …`);
    const sansSeparateur = "mot ".repeat(400);
    expect(texteEncart(sansSeparateur)).toBe(`${sansSeparateur.slice(0, 720)} …`);
    expect(texteEncart("z".repeat(2000), 100)).toBe(`${"z".repeat(200)} …`);
    expect(texteEncart("")).toBe("");
  });
});

describe("texteEncart — cas de référence BTCUSDT 4h (3 000 bougies closes)", () => {
  const axisSr = familles(calculer("stratAxisSr", { detecterRetournements: true }));
  const axis = familles(calculer("stratAxis"));
  const preSignal = [470, 1043, 2289].flatMap((n) => familles(calculer("stratAxisSr", {}, "4h", BTC.slice(0, n))).preSignal);

  it("zones, triangles creux, retournements, forts mouvements et pré-signal : le texte entier", () => {
    expect([axisSr.zones.length, axisSr.creux.length, axisSr.retournements.length, axisSr.forts.length, preSignal.length]).toEqual([12, 120, 40, 57, 3]);
    for (const info of [...axisSr.zones, ...axisSr.creux, ...axisSr.retournements, ...axisSr.forts, ...axis.forts, ...preSignal]) {
      expect(info.length).toBeLessThanOrEqual(360);
      expect(texteEncart(info)).toBe(info);
    }
    // Marge sous la limite : le plus long de ces textes (un retournement).
    expect(Math.max(...[...axisSr.zones, ...axisSr.creux, ...axisSr.retournements, ...axisSr.forts].map((info) => info.length))).toBe(334);
  });

  it("un triangle creux et un retournement s'ouvrent par leur réserve, rendue en entier", () => {
    for (const info of [...axisSr.creux, ...axisSr.retournements]) {
      expect(texteEncart(info)).toMatch(/^AXIS (S\/R|↺) signal précoce non mesuré — lecture indicative, jamais une promesse — /);
    }
  });

  it("un signal confirmé : tête, statut, votes et flux, puis « … » ; aucune phrase de campagne", () => {
    expect(axisSr.confirmes).toHaveLength(34);
    expect(axis.confirmes).toHaveLength(34);
    for (const info of [...axisSr.confirmes, ...axis.confirmes]) {
      expect(info.length).toBeGreaterThan(800);
      const rendu = texteEncart(info);
      const [tete, statut, detail, ...reste] = rendu.slice(0, -2).split(SEPARATEUR);
      expect(rendu.endsWith(" …")).toBe(true);
      expect(reste).toEqual([]);
      expect(info.startsWith(`${rendu.slice(0, -2)}${SEPARATEUR}`)).toBe(true);
      expect(tete).toMatch(/^AXIS (achat|vente)( forte?)?$/);
      expect(statut).toMatch(/^score [+-]?\d\/6 · test 4h ≈ EMA 200 seule$/);
      // Le détail va jusqu'au bout de la couche flux, qualification comprise.
      expect(detail).toMatch(/^EMA 20\/50 .* ; flux .*qualification descriptive, sans avantage mesuré pour les signaux « forts » \(données jamais vues, 8 octobre 2026\)\)$/);
      expect(rendu).not.toMatch(MOTS_DE_CAMPAGNE);
      // Sur la fixture (OI absent), le rendu tient en 360 caractères ; avec l'OI il les dépasse (test suivant).
      expect(rendu.length).toBeLessThanOrEqual(360);
    }
  });

  it("OI présent, filtre ADX, stop ou marge S/R : le détail s'allonge, il est rendu quand même, jamais la tête seule", () => {
    let plusLong = 0;
    let auDela = 0;
    const REGLAGES: Reglages[] = [{}, { adxEntree: 25 }, { stopAtr: 3 }, { margeResistanceAtr: 1 }];
    for (const defId of ["stratAxis", "stratAxisSr"]) {
      for (const reglages of REGLAGES) {
        const confirmes = familles(calculer(defId, reglages, "4h", BTC, true)).confirmes;
        expect(confirmes.length).toBeGreaterThan(20);
        for (const info of confirmes) {
          const rendu = texteEncart(info);
          expect(rendu.slice(0, -2).split(SEPARATEUR)).toHaveLength(3);
          expect(rendu).toMatch(/ ; flux .*OI [+-]\d.* ; qualification descriptive/);
          expect(rendu).not.toMatch(MOTS_DE_CAMPAGNE);
          plusLong = Math.max(plusLong, rendu.length);
          if (rendu.length > 360) auDela++;
        }
      }
    }
    // Une limite de 360 caractères seule aurait rendu ces signaux sans leur détail.
    expect(auDela).toBeGreaterThan(50);
    expect(plusLong).toBeLessThanOrEqual(420);
  });
});

describe("texteEncart — doctrine : ni « test réussi » ni chiffre de campagne sans sa réserve", () => {
  it("le contrôle reconnaît un manquement (témoin)", () => {
    const complet = familles(calculer("stratAxis")).confirmes[0]!;
    expect(manquements(complet, complet)).toEqual([]);
    const apresReussi = complet.indexOf("test réussi") + "test réussi sur données".length;
    expect(manquements(`${complet.slice(0, apresReussi)} …`, complet)).toEqual(["« test réussi » sans sa réserve"]);
    const apresSharpe = complet.indexOf("Sharpe") + "Sharpe meilleur".length;
    expect(manquements(`${complet.slice(0, apresSharpe)} …`, complet)).toEqual(["« Sharpe » sans sa réserve"]);
    // Coupé juste avant la réserve qui suit les chiffres : manquement aussi.
    const avantReserve = complet.lastIndexOf(SEPARATEUR);
    expect(manquements(`${complet.slice(0, avantReserve)} …`, complet)).toEqual([
      "« Sharpe » sans sa réserve",
      "« drawdown » sans sa réserve",
      "« expectancy » sans sa réserve",
    ]);
  });

  // Revue du 12 novembre 2026 : dans un fort achat en 4h, le chiffre de campagne est dans la
  // TROISIÈME partie du texte et sa réserve dans la quatrième. Il n'était rendu avec elle que parce
  // que le texte tient en 360 caractères, et le contrôle ne connaissait pas ce chiffre.
  it("fort achat en 4h : le chiffre « en moyenne » et sa réserve sont rendus ensemble, avec ou sans OI, même allongé ; le contrôle verrait le contraire (témoin)", () => {
    const RESERVE_FORT_ACHAT = "mesure passée, pas une promesse";
    let avecChiffre = 0;
    let plusLong = 0;
    for (const defId of ["stratAxis", "stratAxisSr"]) {
      for (const oi of [false, true]) {
        for (const info of familles(calculer(defId, {}, "4h", BTC, oi)).forts) {
          if (!info.includes("en moyenne")) continue;
          avecChiffre++;
          plusLong = Math.max(plusLong, info.length);
          const rendu = texteEncart(info);
          expect(manquements(rendu, info)).toEqual([]);
          expect(rendu.indexOf(RESERVE_FORT_ACHAT)).toBeGreaterThan(rendu.indexOf("en moyenne"));
        }
      }
    }
    expect(avecChiffre).toBeGreaterThan(40);
    // Marge sous la limite à l'écriture du test : 283 caractères au plus, OI compris.
    expect(plusLong).toBeLessThanOrEqual(300);

    // Le même texte, allongé au-delà de la limite (un autre lot, un autre réglage) : quatre parties,
    // il est rendu entier, chiffre et réserve ensemble.
    const fortAchat = familles(calculer("stratAxis")).forts.find((info) => info.includes("en moyenne"))!;
    const parties = fortAchat.split(SEPARATEUR);
    expect(parties).toHaveLength(4);
    expect(parties[2]).toContain("en moyenne");
    expect(parties[3]).toBe(RESERVE_FORT_ACHAT);
    const allonge = [parties[0], `${parties[1]}${" et un réglage de plus".repeat(5)}`, parties[2], parties[3]].join(SEPARATEUR);
    expect(allonge.length).toBeGreaterThan(360);
    expect(texteEncart(allonge)).toBe(allonge);
    expect(manquements(texteEncart(allonge), allonge)).toEqual([]);
    // Témoin : arrêté à sa troisième partie, il aurait porté le chiffre SANS sa réserve, et le contrôle le signale.
    expect(manquements(`${parties.slice(0, 3).join(SEPARATEUR)} …`, fortAchat)).toEqual(["« en moyenne » sans sa réserve"]);
  });

  it("AXIS et AXIS S/R, toutes unités mesurées, réglages hors test, avec ou sans OI ni delta taker : aucun manquement", () => {
    const UNITES: Timeframe[] = ["1m", "1h", "2h", "4h", "12h", "1d", "1w", "1M"];
    const REGLAGES: Reglages[] = [
      {},
      { regimeBtc: 0 },
      { stopAtr: 3, adxEntree: 25 },
      { stopAtr: 2, adxEntree: 30, regimeBtc: 50, margeResistanceAtr: 1 },
      { filtreFlux: true },
      { emaRapide: 9, emaLente: 21, emaTendance: 50, regimeBtc: 0 },
    ];
    // Série raccourcie, plus vite calculée ; sous l'amorce des deux stratégies, chaque signal porte
    // donc aussi la mention « amorce courte », cas le plus long.
    const RECENTES = BTC.slice(-1200);
    const SANS_DELTA_RECENTES = SANS_DELTA.slice(-1200);
    let textes = 0;
    let coupes = 0;
    let avecMots = 0;
    let plusLong = 0;
    for (const defId of ["stratAxis", "stratAxisSr"]) {
      for (const unite of UNITES) {
        for (const reglages of REGLAGES) {
          for (const [bougies, oi] of [[RECENTES, false], [RECENTES, true], [SANS_DELTA_RECENTES, false]] as const) {
            for (const info of tous(familles(calculer(defId, reglages, unite, bougies, oi)))) {
              textes++;
              const rendu = texteEncart(info);
              expect(manquements(rendu, info)).toEqual([]);
              if (rendu === info) {
                if (MOTS_DE_CAMPAGNE.test(info)) avecMots++;
                continue;
              }
              coupes++;
              // Coupé : trois parties entières, jamais la tête seule, aucune phrase de campagne.
              expect(info.startsWith(`${rendu.slice(0, -2)}${SEPARATEUR}`)).toBe(true);
              expect(rendu.slice(0, -2).split(SEPARATEUR)).toHaveLength(3);
              expect(rendu).not.toMatch(MOTS_DE_CAMPAGNE);
              plusLong = Math.max(plusLong, rendu.length);
            }
          }
        }
      }
    }
    expect(textes).toBeGreaterThan(15_000);
    expect(coupes).toBeGreaterThan(4_000);
    // Des textes entiers portent bien des mots de campagne (forts achats en 4h) : le contrôle les a lus.
    expect(avecMots).toBeGreaterThan(100);
    // Le plus long texte coupé (530 caractères à l'écriture du test) : amorce courte (1 200 bougies
    // sur 1 500), stop, filtre ADX, régime hors test et marge S/R ensemble, OI présent. La mention
    // d'amorce fait partie du détail : elle est rendue. Loin du garde-fou de 720 caractères.
    expect(plusLong).toBeGreaterThan(360);
    expect(plusLong).toBeLessThanOrEqual(560);
  });
});
