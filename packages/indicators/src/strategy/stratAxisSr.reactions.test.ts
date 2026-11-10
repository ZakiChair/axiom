/**
 * @axiom/indicators — strategy/stratAxisSr.reactions.test.ts
 *
 * Pistes de zones et réactions sur zone forte d'AXIS S/R (conception du 2026-11-09, §4.5 et
 * §6.1 à §6.4). Le moteur en une passe (`zonesSrAxis`) est comparé à une référence lente qui
 * relance le moteur à chaque bougie, puis épinglé sur le cas de référence BTCUSDT 4h ; les
 * pistes (bandes des zones) sont vérifiées pour leur forme, leur causalité et leurs identifiants.
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { rma, trueRange } from "../utils";
import fixtureRaw from "../golden/fixture-ohlcv.json";
import { fluxAxis } from "./stratAxis";
import {
  FORCE_ZONE_FORTE_DEFAUT,
  MAX_ZONES_CASSEES_AXIS,
  REARMEMENT_REACTION_AXIS,
  zonesSrAxis,
  type ReactionZoneSrAxis,
  type ResultatSrAxis,
} from "./stratAxisSr";
import { bougiesBtcusdt4h } from "./fixtures/btcusdt4h";

/** Réarmement refusé : la condition de réaction remplie par une zone forte à moins de 4 bougies de son évènement précédent. */
interface RefusReaction {
  idx: number;
  id: number;
  /** Bougie de l'évènement précédent de la zone. */
  precedent: number;
}

/**
 * Référence lente : zones connues après i − 1 (moteur relancé à chaque bougie), règle appliquée telle quelle.
 * `refus`, s'il est fourni, reçoit chaque réarmement refusé.
 */
function reactionsNaives(candles: Candle[], g: number, forceMin: number, fin: number, refus?: RefusReaction[]): string[] {
  const flux = fluxAxis(candles, undefined, 20, 6);
  const atr = rma(trueRange(candles), 14);
  const dernier = new Map<number, number>();
  const out: string[] = [];
  for (let i = 1; i <= fin; i++) {
    const c = candles[i]!;
    const amplitude = c.high - c.low;
    if (!(amplitude > 0)) continue;
    const position = (c.close - c.low) / amplitude;
    for (const z of zonesSrAxis(candles, flux, atr, g, 0.5, 1.5, 48, i - 1).zones) {
      if (z.force < forceMin) continue;
      const support = z.niveau <= candles[i - 1]!.close;
      const reagit = support
        ? c.low <= z.haut && c.close > z.haut && position >= 0.5
        : c.high >= z.bas && c.close < z.bas && position <= 0.5;
      if (!reagit) continue;
      const precedent = dernier.get(z.id) ?? -99;
      if (i - precedent < 4) {
        refus?.push({ idx: i, id: z.id, precedent });
        continue;
      }
      dernier.set(z.id, i);
      out.push(`${i}:${support ? 1 : -1}:${z.id}`);
    }
  }
  return out.sort();
}

/** Moteur en une passe, mêmes entrées, même format trié. */
const reactionsMoteur = (candles: Candle[], g: number, forceMin: number, fin: number) => {
  const r = zonesSrAxis(candles, fluxAxis(candles, undefined, 20, 6), rma(trueRange(candles), 14), g, 0.5, 1.5, 4, fin, forceMin);
  return { r, texte: r.reactions.map((e) => `${e.idx}:${e.sens}:${e.zone.id}`).sort() };
};
const court = (r: ReactionZoneSrAxis[]) => r.map((e) => `${e.idx}${e.sens > 0 ? "S" : "R"}`).join(" ");

/** Marché en range à graine fixe : rappel vers 100, pointes de volume. */
function serieSynthetique(n: number, graine: number): Candle[] {
  let s = graine;
  const alea = (): number => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  const out: Candle[] = [];
  let prix = 100;
  for (let i = 0; i < n; i++) {
    const open = prix;
    const close = Math.max(1, open + (100 - open) * 0.05 + (alea() - 0.5) * 4);
    const high = Math.max(open, close) + alea() * 2;
    const low = Math.min(open, close) - alea() * 2;
    const volume = 10 + (alea() < 0.15 ? 40 : 0) + alea() * 5;
    out.push({ time: i * 3_600_000, open, high, low, close, volume, closed: true });
    prix = close;
  }
  return out;
}

/** Bornes de toutes les zones rendues (pistes, évolutions, réactions) : aucune ne doit valoir NaN. */
const bornesRendues = (r: ResultatSrAxis): number[] => [
  ...r.pistes.flatMap((p) => [p.zone.bas, p.zone.haut, ...p.evolution.flatMap((e) => [e.bas, e.haut])]),
  ...r.reactions.flatMap((e) => [e.zone.bas, e.zone.haut]),
];

const fixtureDoree = fixtureRaw as Candle[];
const btc = bougiesBtcusdt4h();
const tranche = btc.slice(-1200);

describe("zonesSrAxis — réactions sur zone forte : le moteur en une passe rend les évènements de la référence lente", () => {
  it("constantes : zone forte dès la force 6, réarmement après 4 bougies, 12 zones fortes désactivées gardées", () => {
    expect(FORCE_ZONE_FORTE_DEFAUT).toBe(6);
    expect(REARMEMENT_REACTION_AXIS).toBe(4);
    expect(MAX_ZONES_CASSEES_AXIS).toBe(12);
  });

  it("série synthétique (graine 7, g = 3, seuil 3) : supports et résistances forts, zones inversées, réarmement par zone refusé puis accepté, désactivations", () => {
    const syn = serieSynthetique(600, 7);
    expect(syn[0]!.close).toBeCloseTo(98.95512335933745, 12);
    const { r, texte } = reactionsMoteur(syn, 3, 3, 599);
    const refus: RefusReaction[] = [];
    expect(texte).toEqual(reactionsNaives(syn, 3, 3, 599, refus));
    expect(r.reactions).toHaveLength(112);
    expect(r.reactions.filter((e) => e.sens === 1)).toHaveLength(58);
    expect(r.reactions.filter((e) => e.sens === -1)).toHaveLength(54);
    expect(court(r.reactions.slice(0, 8))).toBe("32S 39S 46R 48S 56S 60R 62S 64R");
    expect(court(r.reactions.slice(-4))).toBe("555R 576S 585R 599S");
    expect(r.reactions.filter((e) => e.zone.inversions > 0)).toHaveLength(21);

    // Réarmement par zone : deux évènements d'une même zone sont toujours à ≥ 4 bougies l'un de
    // l'autre, et des zones réagissent de nouveau une fois réarmées.
    const parZone = new Map<number, number[]>();
    for (const e of r.reactions) parZone.set(e.zone.id, [...(parZone.get(e.zone.id) ?? []), e.idx]);
    const ecarts = [...parZone.values()].flatMap((idx) => idx.slice(1).map((v, k) => v - idx[k]!));
    expect(ecarts.length).toBeGreaterThan(0);
    expect(Math.min(...ecarts)).toBeGreaterThanOrEqual(REARMEMENT_REACTION_AXIS);

    // Réarmement refusé puis accepté (§6.1) : 68 fois, une zone forte remplit la condition de réaction à moins de
    // 4 bougies de son évènement précédent, et le moteur ne rend rien. Ainsi la zone 0, qui réagit à 64, est refusée
    // à 67 (3 bougies) et réagit de nouveau à 68 (4 bougies).
    expect(refus).toHaveLength(68);
    for (const { idx, id } of refus) {
      expect(r.reactions.some((e) => e.idx === idx && e.zone.id === id), `zone ${id} à ${idx}`).toBe(false);
    }
    expect(refus).toContainEqual({ idx: 67, id: 0, precedent: 64 });
    const zone0 = r.reactions.filter((e) => e.zone.id === 0).map((e) => e.idx);
    expect(zone0.filter((idx) => idx >= 64 && idx <= 68)).toEqual([64, 68]);

    expect(r.pistes.filter((p) => p.active)).toHaveLength(3);
    expect(r.pistes.filter((p) => !p.active).map((p) => p.finIdx)).toEqual([555, 496, 407, 236, 184]);
  });

  it("fixture dorée (300 bougies, g = 5) : aucun évènement au seuil 6 ; au seuil 2, les évènements de la référence lente", () => {
    expect(reactionsMoteur(fixtureDoree, 5, 6, 298).r.reactions).toEqual([]);
    expect(reactionsNaives(fixtureDoree, 5, 6, 298)).toEqual([]);
    const { r, texte } = reactionsMoteur(fixtureDoree, 5, 2, 298);
    expect(texte).toEqual(reactionsNaives(fixtureDoree, 5, 2, 298));
    expect(court(r.reactions)).toBe("73S 86S 92S 98S 102S 125R 130R 139R 147S 153S 161R 173S 188S 192R");
  });

  it(
    "BTCUSDT 4h, 1 200 dernières bougies (g = 5, seuil 6) : les 50 évènements de la référence lente",
    () => {
      const { r, texte } = reactionsMoteur(tranche, 5, 6, 1199);
      expect(texte).toEqual(reactionsNaives(tranche, 5, 6, 1199));
      expect(r.reactions).toHaveLength(50);
      expect(r.reactions.filter((e) => e.sens === 1)).toHaveLength(32);
      expect(r.reactions.filter((e) => e.sens === -1)).toHaveLength(18);
    },
    30_000
  );

  it(
    "série sans volume (tranche BTC, volume 0, sans volume acheteur ni vendeur) : réactions calculées, aucun rejet sur volume, aucun NaN",
    () => {
      const sansVolume: Candle[] = tranche.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: 0, closed: true }));
      const { r, texte } = reactionsMoteur(sansVolume, 5, 6, 1199);
      expect(texte).toEqual(reactionsNaives(sansVolume, 5, 6, 1199));
      expect(r.reactions).toHaveLength(21);
      expect(r.pistes.length).toBeGreaterThan(0);
      for (const p of r.pistes) expect(p.zone.rejetsVolume).toBe(0);
      expect(bornesRendues(r).filter((v) => Number.isNaN(v))).toEqual([]);
    },
    30_000
  );

  it("bougies plates (high = low) : jamais de réaction ni de division par zéro, les autres évènements inchangés", () => {
    const plates = serieSynthetique(600, 7).map((c, i) => (i % 50 === 25 ? { ...c, open: c.close, high: c.close, low: c.close } : c));
    const { r, texte } = reactionsMoteur(plates, 3, 3, 599);
    expect(texte).toEqual(reactionsNaives(plates, 3, 3, 599));
    expect(r.reactions).toHaveLength(112);
    expect(r.reactions.filter((e) => e.idx % 50 === 25)).toEqual([]);
    expect(bornesRendues(r).filter((v) => Number.isNaN(v))).toEqual([]);
  });
});

describe("zonesSrAxis — cas de référence : 3 000 bougies BTCUSDT 4h, réglages par défaut", () => {
  it("122 évènements (62 sur support, 60 sur résistance), le premier à l'index 250, aucune bougie dans les deux sens", () => {
    const { r } = reactionsMoteur(btc, 5, 6, 2999);
    expect(r.reactions).toHaveLength(122);
    expect(r.reactions.filter((e) => e.sens === 1)).toHaveLength(62);
    expect(r.reactions.filter((e) => e.sens === -1)).toHaveLength(60);
    expect(r.reactions.slice(0, 3).map((e) => e.idx)).toEqual([250, 262, 280]);
    const depuis400 = r.reactions.filter((e) => e.idx >= 400);
    expect([depuis400.length, depuis400.filter((e) => e.sens === 1).length]).toEqual([115, 59]);
    expect(r.reactions.filter((e) => e.idx >= 2728)).toHaveLength(31);
    const idxDepuis2700 = (sens: 1 | -1) => r.reactions.filter((e) => e.idx >= 2700 && e.sens === sens).map((e) => e.idx).join(" ");
    expect(idxDepuis2700(1)).toBe("2733 2750 2766 2798 2803 2809 2853 2860 2896 2901 2904 2916 2928 2946 2957 2961 2974 2980 2985 2988");
    expect(idxDepuis2700(-1)).toBe("2754 2761 2767 2811 2821 2824 2835 2838 2850 2859 2954");
    const sensParBougie = new Map<number, Set<number>>();
    for (const e of r.reactions) sensParBougie.set(e.idx, (sensParBougie.get(e.idx) ?? new Set<number>()).add(e.sens));
    expect([...sensParBougie.values()].filter((s) => s.size > 1)).toEqual([]);

    // Sans 9e paramètre, le seuil de force vaut FORCE_ZONE_FORTE_DEFAUT.
    const parDefaut = zonesSrAxis(btc, fluxAxis(btc, undefined, 20, 6), rma(trueRange(btc), 14), 5, 0.5, 1.5, 4, 2999);
    expect(parDefaut.reactions).toEqual(r.reactions);
  });

  it("chaque évènement cite l'état de sa zone après la bougie précédente", () => {
    const { r } = reactionsMoteur(btc, 5, 6, 2999);
    const e2733 = r.reactions.find((e) => e.idx === 2733);
    expect(e2733?.sens).toBe(1);
    expect(e2733?.zone).toMatchObject({ nature: "support", touches: 4, rejetsVolume: 2, inversions: 0, force: 6, deIdx: 2581, confirmationIdx: 2586 });
    expect(e2733?.zone.bas).toBeCloseTo(75592.65, 2);
    expect(e2733?.zone.haut).toBeCloseTo(76529.83, 2);
    const e2761 = r.reactions.find((e) => e.idx === 2761);
    expect(e2761?.sens).toBe(-1);
    expect(e2761?.zone).toMatchObject({ nature: "resistance", touches: 9, rejetsVolume: 6, inversions: 1, force: 15.5, deIdx: 951 });
  });

  it("pistes : 20 zones actives dont 8 fortes, puis les 12 zones fortes désactivées les plus récentes", () => {
    const { r } = reactionsMoteur(btc, 5, 6, 2999);
    const actives = r.pistes.filter((p) => p.active);
    expect(actives).toHaveLength(20);
    expect(r.pistes.slice(0, 20).every((p) => p.active)).toBe(true);
    expect(r.pistes.filter((p) => !p.active).map((p) => p.finIdx)).toEqual([2986, 2954, 2858, 2692, 2591, 2568, 2558, 2275, 2168, 2084, 1997, 1922]);

    const close = btc[2999]!.close;
    expect(close).toBe(77582.02);
    const fortes = actives.map((p) => p.zone).filter((z) => z.force >= 6);
    expect(fortes).toHaveLength(8);
    const supports = fortes.filter((z) => z.nature === "support").sort((a, b) => b.niveau - a.niveau);
    const resistances = fortes.filter((z) => z.nature === "resistance").sort((a, b) => a.niveau - b.niveau);
    expect(supports[0]).toMatchObject({ touches: 5, rejetsVolume: 2, confirmationIdx: 2586 });
    expect(supports[0]?.bas).toBeCloseTo(75626.55, 2);
    expect(supports[0]?.haut).toBeCloseTo(76601.83, 2);
    expect(resistances[0]).toMatchObject({ touches: 12, rejetsVolume: 7, inversions: 1, confirmationIdx: 956 });
    expect(resistances[0]?.bas).toBeCloseTo(85314.76, 2);
    expect(resistances[0]?.haut).toBeCloseTo(86430.38, 2);
    expect(resistances[1]).toMatchObject({ touches: 8, rejetsVolume: 4, inversions: 1 });
    expect(resistances[1]?.bas).toBeCloseTo(86702.87, 2);
    expect(resistances[1]?.haut).toBeCloseTo(87649.68, 2);
  });
});

describe("zonesSrAxis — zones fortes cassées : fortes à la clôture de leur dernière bougie active (finIdx)", () => {
  const fluxBtc = fluxAxis(btc, undefined, 20, 6);
  const atrBtc = rma(trueRange(btc), 14);
  /** BTC, pivots 2, zones de ± 0,2 × ATR, arrêté à `fin`. */
  const finesBtc = (fin: number, seuil: number) => zonesSrAxis(btc, fluxBtc, atrBtc, 2, 0.2, 1.5, 4, fin, seuil);

  it("une zone faible à finIdx, renforcée par une fusion de la bougie qui la casse, n'est pas cassée (BTC, pivots 2, ± 0,2 × ATR, seuil 8 : zone 354)", () => {
    // À la clôture de 2876, sa dernière bougie active : force 7,5, faible au seuil 8.
    expect(finesBtc(2876, 8).pistes.find((p) => p.zone.id === 354)).toMatchObject({ active: true, finIdx: 2876, zone: { touches: 6, force: 7.5 } });
    // La bougie 2877 lui fusionne un pivot (force 8,5) puis la casse. Au seuil 7, où elle était forte à 2876, sa piste
    // cassée garde l'état d'après cette fusion, dont l'entrée d'évolution à finIdx + 1.
    const auSeuil7 = finesBtc(2999, 7).pistes.find((p) => !p.active && p.zone.id === 354);
    expect(auSeuil7).toMatchObject({ finIdx: 2876, zone: { touches: 7, force: 8.5 } });
    expect(auSeuil7?.evolution.at(-1)?.idx).toBe(2877);
    // Au seuil 8, faible pendant toute sa vie visible : pas de piste cassée.
    const cassees = finesBtc(2999, 8).pistes.filter((p) => !p.active);
    expect(cassees).toHaveLength(MAX_ZONES_CASSEES_AXIS);
    expect(cassees.map((p) => p.zone.id)).not.toContain(354);
  });

  it("chaque piste cassée était forte à la clôture de son finIdx (moteur relancé à fin = finIdx)", () => {
    const cas: Array<[string, Candle[], number, number, number]> = [
      ["BTC, réglages par défaut", btc, 5, 0.5, 6],
      ["BTC, pivots 2, ± 0,2 × ATR, seuil 8", btc, 2, 0.2, 8],
      ["synthétique, graine 7", serieSynthetique(600, 7), 3, 0.5, 3],
    ];
    for (const [nom, bougies, g, kAtr, seuil] of cas) {
      const flux = fluxAxis(bougies, undefined, 20, 6);
      const atr = rma(trueRange(bougies), 14);
      const cassees = zonesSrAxis(bougies, flux, atr, g, kAtr, 1.5, 4, bougies.length - 1, seuil).pistes.filter((p) => !p.active);
      expect(cassees.length, nom).toBeGreaterThan(0);
      for (const p of cassees) {
        const aFinIdx = zonesSrAxis(bougies, flux, atr, g, kAtr, 1.5, 4, p.finIdx, seuil).pistes.find((q) => q.zone.id === p.zone.id);
        expect(aFinIdx?.active, `${nom}, zone ${p.zone.id}`).toBe(true);
        expect(aFinIdx?.zone.force, `${nom}, zone ${p.zone.id}`).toBeGreaterThanOrEqual(seuil);
      }
    }
  });
});

describe("zonesSrAxis — pistes, causalité et identifiants (tranche BTC de 1 200 bougies)", () => {
  const flux = fluxAxis(tranche, undefined, 20, 6);
  const atr = rma(trueRange(tranche), 14);
  const zonesA = (fin: number) => zonesSrAxis(tranche, flux, atr, 5, 0.5, 1.5, 48, fin).zones;

  it("forme : évolution ouverte à la confirmation, idx strictement croissants, dernière entrée = bornes de la zone ; rôle et ordre des pistes", () => {
    const { r } = reactionsMoteur(tranche, 5, 6, 1199);
    const actives = r.pistes.filter((p) => p.active);
    const desactivees = r.pistes.filter((p) => !p.active);
    expect(actives.length).toBeGreaterThan(0);
    expect(desactivees.length).toBeGreaterThan(0);
    expect(desactivees.length).toBeLessThanOrEqual(MAX_ZONES_CASSEES_AXIS);
    expect(r.pistes.slice(0, actives.length).every((p) => p.active)).toBe(true);
    for (const p of r.pistes) {
      expect(p.evolution[0]?.idx).toBe(p.zone.confirmationIdx);
      for (let k = 1; k < p.evolution.length; k++) expect(p.evolution[k]!.idx).toBeGreaterThan(p.evolution[k - 1]!.idx);
      expect(p.evolution.at(-1)).toMatchObject({ bas: p.zone.bas, haut: p.zone.haut });
      if (p.active) expect(p.finIdx).toBe(1199);
      else {
        expect(p.zone.force).toBeGreaterThanOrEqual(6);
        expect(p.finIdx).toBeGreaterThanOrEqual(p.zone.confirmationIdx);
        expect(p.finIdx).toBeLessThan(1199);
      }
      expect(p.zone.nature).toBe(p.zone.niveau <= tranche[p.finIdx]!.close ? "support" : "resistance");
    }
    for (let k = 1; k < actives.length; k++) expect(actives[k]!.zone.confirmationIdx).toBeGreaterThanOrEqual(actives[k - 1]!.zone.confirmationIdx);
    for (let k = 1; k < desactivees.length; k++) expect(desactivees[k]!.finIdx).toBeLessThanOrEqual(desactivees[k - 1]!.finIdx);
  });

  it("causalité : les réactions d'un préfixe arrêté à k sont celles de la série entière jusqu'à k", () => {
    const complet = reactionsMoteur(tranche, 5, 6, 1199).r.reactions;
    for (const k of [300, 700, 1100]) {
      const attendues = complet.filter((e) => e.idx <= k);
      expect(attendues.length, `évènements jusqu'à ${k}`).toBeGreaterThan(0);
      expect(reactionsMoteur(tranche.slice(0, k + 1), 5, 6, k).r.reactions, `préfixe ${k}`).toEqual(attendues);
    }
  });

  it("causalité : un futur altéré ne change aucune réaction jusqu'à k", () => {
    const complet = reactionsMoteur(tranche, 5, 6, 1199).r.reactions;
    for (const k of [300, 700, 1100]) {
      const alterees = tranche.map((c, i) => (i <= k ? c : { ...c, high: 1e12 + i, low: 1, close: 1e12 - i, volume: 1e12 }));
      const futur = reactionsMoteur(alterees, 5, 6, 1199).r.reactions;
      expect(futur.filter((e) => e.idx <= k), `futur altéré ${k}`).toEqual(complet.filter((e) => e.idx <= k));
    }
  });

  it("causalité des bandes : chaque entrée d'évolution est la borne connue à la clôture de sa bougie, pas avant", () => {
    const { r } = reactionsMoteur(tranche, 5, 6, 1199);
    let verifiees = 0;
    for (const p of r.pistes.filter((q) => q.active)) {
      p.evolution.forEach((e, k) => {
        const z = zonesA(e.idx).find((y) => y.id === p.zone.id);
        expect(z, `zone ${p.zone.id} à ${e.idx}`).toBeDefined();
        expect({ bas: z?.bas, haut: z?.haut }, `zone ${p.zone.id} à ${e.idx}`).toEqual({ bas: e.bas, haut: e.haut });
        verifiees++;
        const precedente = p.evolution[k - 1];
        if (precedente === undefined) return;
        const veille = zonesA(e.idx - 1).find((y) => y.id === p.zone.id);
        expect({ bas: veille?.bas, haut: veille?.haut }, `zone ${p.zone.id} à ${e.idx - 1}`).toEqual({ bas: precedente.bas, haut: precedente.haut });
      });
    }
    expect(verifiees).toBe(53);
  });

  it("identifiants : uniques, stables quel que soit fin, croissants avec la confirmation", () => {
    const finales = zonesA(1199);
    let communes = 0;
    for (const k of [300, 700, 1100]) {
      const zones = zonesA(k);
      expect(zones.length).toBeGreaterThan(0);
      expect(new Set(zones.map((z) => z.id)).size).toBe(zones.length);
      const parId = [...zones].sort((a, b) => a.id - b.id);
      for (let j = 1; j < parId.length; j++) expect(parId[j]!.confirmationIdx).toBeGreaterThanOrEqual(parId[j - 1]!.confirmationIdx);
      for (const z of zones) {
        const meme = finales.find((y) => y.id === z.id);
        if (meme === undefined) continue;
        communes++;
        expect({ deIdx: meme.deIdx, confirmationIdx: meme.confirmationIdx }, `zone ${z.id}`).toEqual({ deIdx: z.deIdx, confirmationIdx: z.confirmationIdx });
      }
    }
    expect(communes).toBeGreaterThan(0);
  });
});

describe("zonesSrAxis — existant inchangé et entrées limites", () => {
  it("le seuil de force ne change ni les zones retenues ni les séries support / résistance existantes", () => {
    const flux = fluxAxis(fixtureDoree, undefined, 20, 6);
    const atr = rma(trueRange(fixtureDoree), 14);
    const seuil2 = zonesSrAxis(fixtureDoree, flux, atr, 5, 0.5, 1.5, 4, 298, 2);
    const seuil50 = zonesSrAxis(fixtureDoree, flux, atr, 5, 0.5, 1.5, 4, 298, 50);
    expect(seuil2.reactions.length).toBeGreaterThan(0);
    expect(seuil50.reactions).toEqual([]);
    for (const cle of ["zones", "support", "resistance", "supportHaut", "resistanceBas"] as const) {
      expect(seuil2[cle], cle).toEqual(seuil50[cle]);
    }
  });

  it("historique vide ou très court (0, 1, 8 bougies) : aucune exception, séries de la bonne longueur, ni réaction ni piste", () => {
    for (const n of [0, 1, 8]) {
      const bougies = btc.slice(0, n);
      const flux = fluxAxis(bougies, undefined, 20, 6);
      const atr = rma(trueRange(bougies), 14);
      for (const r of [zonesSrAxis(bougies, flux, atr), zonesSrAxis(bougies, flux, atr, 5, 0.5, 1.5, 4, n - 1)]) {
        expect(r.reactions, `${n} bougies`).toEqual([]);
        expect(r.pistes, `${n} bougies`).toEqual([]);
        expect(r.zones, `${n} bougies`).toEqual([]);
        for (const serie of [r.support, r.resistance, r.supportHaut, r.resistanceBas]) expect(serie).toHaveLength(n);
      }
    }
  });

  it("prix très petits (× 1e-9) : mêmes réactions qu'à l'échelle 1", () => {
    const minuscule = tranche.map((c) => ({ ...c, open: c.open * 1e-9, high: c.high * 1e-9, low: c.low * 1e-9, close: c.close * 1e-9 }));
    const idxSens = (r: ReactionZoneSrAxis[]) => r.map((e) => `${e.idx}:${e.sens}`).join(" ");
    const normal = reactionsMoteur(tranche, 5, 6, 1199).r.reactions;
    expect(normal.length).toBeGreaterThan(0);
    expect(idxSens(reactionsMoteur(minuscule, 5, 6, 1199).r.reactions)).toBe(idxSens(normal));
  });
});
