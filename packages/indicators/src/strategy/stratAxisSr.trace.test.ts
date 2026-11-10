/**
 * @axiom/indicators — strategy/stratAxisSr.trace.test.ts
 *
 * Tracé d'AXIS S/R sur le cas de référence BTCUSDT 4h (conception du 2026-11-09, §3, §4.3 à §4.7,
 * §6.4) : sorties de réaction pour les alertes, rubans des zones classées par force, bords,
 * étiquettes au bord droit, triangles creux des signaux précoces ; puis les entrées limites
 * (bougie en formation, prix minuscules, séries courtes) et le coût d'un calcul complet.
 * Réglages par défaut, `refClose` = les closes de la série, unité 4h.
 */
import { describe, expect, it } from "vitest";
import type { Candle, IndicatorResult, MarqueurAnnotation } from "@axiom/types";
import { buildCalcContext, computeIndicator, resolveParams } from "../engine";
import { rma, trueRange } from "../utils";
import { MAX_SIGNAUX_AXIS, fluxAxis } from "./stratAxis";
import { ALPHA_ZONE_CASSEE, alphaZoneForte, stratAxisSr, zonesSrAxis, zonesTraceesAxis } from "./stratAxisSr";
import { bougiesBtcusdt4h } from "./fixtures/btcusdt4h";

const btc = bougiesBtcusdt4h();
const auxBtc = { refClose: btc.map((c) => c.close) };
const fluxBtc = fluxAxis(btc, undefined, 20, 6);
const atrBtc = rma(trueRange(btc), 14);
/** Moteur seul sur les 3 000 bougies : pivots, largeur de zone (× ATR) et seuil de force donnés. */
const zonesBtc = (pivotSr: number, zoneSrAtr: number, forceZoneForte: number) =>
  zonesSrAxis(btc, fluxBtc, atrBtc, pivotSr, zoneSrAtr, 1.5, 4, 2999, forceZoneForte);

/** Calcul complet tel que le graphe le fait : `refClose` = les closes de la série, unité 4h. */
const calculer = (bougies: Candle[], params: Record<string, number | boolean | string> = {}): IndicatorResult =>
  computeIndicator(stratAxisSr, bougies, params, { refClose: bougies.map((c) => c.close) }, "4h");
const creux = (res: IndicatorResult): MarqueurAnnotation[] => (res.annotations?.marqueurs ?? []).filter((m) => m.creux === true);
/** Signaux confirmés (▲/▼ pleins) : ni creux, ni forts mouvements (`--accent`). */
const signauxConfirmes = (res: IndicatorResult): MarqueurAnnotation[] =>
  (res.annotations?.marqueurs ?? []).filter((m) => m.creux !== true && m.couleur !== "--accent");
const somme = (serie: Array<number | undefined> | undefined): number => (serie ?? []).reduce<number>((a, v) => a + (v ?? 0), 0);

const defaut = calculer(btc);

const TEXTE_ZONE_SUPPORT =
  "AXIS zone forte de support [75626.55 – 76601.83] (niveau 76114.19, -1.89 % du cours) — 5 touches, 2 rejets sur volume fort — touches comptées sur 3000 bougies";
const TEXTE_ZONE_RESISTANCE =
  "AXIS zone forte de résistance [85314.76 – 86430.38] (niveau 85872.57, +10.69 % du cours) — 12 touches, 7 rejets sur volume fort, polarité inversée — touches comptées sur 3000 bougies";
const TEXTE_REACTION_2733 =
  "AXIS S/R réaction sur support fort [75592.65 – 76529.83] — 4 touches, 2 rejets sur volume fort ; la bougie est entrée dans la zone et a clôturé au-dessus ; signal précoce non mesuré — lecture indicative, jamais une promesse";

describe("stratAxisSr — sorties reactionSupport et reactionResistance (BTCUSDT 4h, 3 000 bougies closes)", () => {
  it("1 sur chaque bougie de réaction, 0 ailleurs : 62 sur support, 60 sur résistance, renseignées aussi sur une bougie de signal confirmé (2 850)", () => {
    const support = defaut.series.reactionSupport;
    const resistance = defaut.series.reactionResistance;
    expect(support).toHaveLength(3000);
    expect(resistance).toHaveLength(3000);
    expect(new Set(support)).toEqual(new Set([0, 1]));
    expect(new Set(resistance)).toEqual(new Set([0, 1]));
    expect(somme(support)).toBe(62);
    expect(somme(resistance)).toBe(60);
    expect(support?.[2733]).toBe(1);
    expect(resistance?.[2761]).toBe(1);
    expect(resistance?.[2850]).toBe(1);
    expect(signauxConfirmes(defaut).map((m) => m.idx)).toContain(2850);
  });
});

describe("stratAxisSr — zones tracées par force (BTCUSDT 4h, réglages par défaut)", () => {
  it("zonesTraceesAxis : 8 fortes actives et les 4 faibles les plus proches, par proximité au prix, puis les 12 fortes désactivées dans l'ordre reçu ; maxZonesSr ≤ 0 : rien", () => {
    const sr = zonesBtc(5, 0.5, 6);
    const close = btc[2999]!.close;
    const { fortes, faibles, cassees } = zonesTraceesAxis(sr.pistes, close, 4, 6);
    expect([fortes.length, faibles.length, cassees.length]).toEqual([8, 4, 12]);
    const ecarts = (liste: typeof fortes) => liste.map((p) => Math.abs(p.zone.niveau - close));
    expect(ecarts(fortes)).toEqual([...ecarts(fortes)].sort((a, b) => a - b));
    expect(ecarts(faibles)).toEqual([...ecarts(faibles)].sort((a, b) => a - b));
    expect(fortes.every((p) => p.active && p.zone.force >= 6)).toBe(true);
    expect(faibles.every((p) => p.active && p.zone.force < 6)).toBe(true);
    expect(faibles.filter((p) => p.zone.nature === "support")).toHaveLength(2);
    expect(cassees).toEqual(sr.pistes.filter((p) => !p.active));
    expect(zonesTraceesAxis(sr.pistes, close, 12, 6).faibles).toHaveLength(12);
    expect(zonesTraceesAxis(sr.pistes, close, 0, 6)).toEqual({ fortes: [], faibles: [], cassees: [] });
    expect(zonesTraceesAxis(sr.pistes, close, -1, 6)).toEqual({ fortes: [], faibles: [], cassees: [] });
  });

  it("rubans : fortes (opacité selon la force), faibles (sans remplissage), puis les 12 fortes désactivées estompées et sans info", () => {
    const rubans = defaut.annotations?.rubans ?? [];
    expect(rubans).toHaveLength(24);

    const r0 = rubans[0]!;
    expect(r0.couleur).toBe("--up");
    expect(r0.alpha).toBeCloseTo(0.224, 9);
    expect(r0.alpha).toBe(alphaZoneForte(7));
    expect(r0.deIdx).toBe(2586);
    expect(r0.hauts).toHaveLength(414);
    expect(r0.bas).toHaveLength(414);
    expect(r0.hauts.at(-1)).toBeCloseTo(76601.83, 2);
    // Bornes connues à chaque clôture : avant la touche qui l'a déplacée, la bande a les bornes
    // que citait la réaction de 2 733 (état après 2 732).
    expect(r0.hauts[2732 - 2586]).toBeCloseTo(76529.83, 2);
    expect(r0.bas[2732 - 2586]).toBeCloseTo(75592.65, 2);
    expect(r0.info).toBe(TEXTE_ZONE_SUPPORT);

    const r1 = rubans[1]!;
    expect(r1.couleur).toBe("--down");
    expect(r1.alpha).toBeCloseTo(0.332, 9);
    expect(r1.deIdx).toBe(956);
    expect(r1.info).toBe(TEXTE_ZONE_RESISTANCE);

    for (const r of rubans.slice(0, 12)) expect(r.deIdx + r.hauts.length - 1).toBe(2999);
    expect(rubans[8]!.info?.startsWith("AXIS zone faible de résistance [78917.30 – 79672.11]")).toBe(true);
    expect(rubans[9]!.info?.startsWith("AXIS zone faible de support [74552.38 – 75480.41]")).toBe(true);
    for (const r of rubans.slice(8, 12)) expect(r.alpha).toBe(0);
    for (const r of rubans.slice(12)) {
      expect(r.alpha).toBe(ALPHA_ZONE_CASSEE);
      expect(r.info).toBeUndefined();
      expect(r.bas).toHaveLength(r.hauts.length);
    }
    expect(ALPHA_ZONE_CASSEE).toBe(0.09);
    expect(rubans[12]!.deIdx + rubans[12]!.hauts.length - 1).toBe(2986);
  });

  it("bords : horizontaux, sans info, en trait plein pour une forte et en pointillé pour une faible, chacun posé sur une borne de sa bande active", () => {
    const segments = defaut.annotations?.segments ?? [];
    const actifs = (defaut.annotations?.rubans ?? []).slice(0, 12);
    for (const s of segments) {
      expect(s.info).toBeUndefined();
      expect(s.cible).toBe("prix");
      expect(s.aValeur).toBe(s.deValeur);
      expect(s.aIdx).toBeGreaterThanOrEqual(s.deIdx);
      const surSaBande = actifs.some(
        (r) =>
          r.couleur === s.couleur &&
          [r.hauts, r.bas].some((bornes) => {
            for (let k = s.deIdx; k <= s.aIdx; k++) if (bornes[k - r.deIdx] !== s.deValeur) return false;
            return true;
          })
      );
      expect(surSaBande, `bord ${s.deIdx}→${s.aIdx} à ${s.deValeur}`).toBe(true);
    }
    expect(segments.filter((s) => s.trait === "plein").length).toBeGreaterThanOrEqual(16);
    expect(segments.filter((s) => s.trait === "pointille").length).toBeGreaterThanOrEqual(8);
  });

  it("étiquettes de zone : 12 au bord droit (dernière bougie), fortes puis faibles, après les étiquettes des signaux", () => {
    const labels = defaut.annotations?.labels ?? [];
    const droite = labels.filter((l) => l.ancrageX === "droite");
    expect(droite).toHaveLength(12);
    expect(droite.every((l) => l.idx === 2999 && l.cible === "prix")).toBe(true);
    expect(droite.map((l) => l.texte)).toEqual([
      "S fort · 5",
      "R forte · 12",
      "R forte · 8",
      "S fort · 8",
      "S fort · 7",
      "S fort · 8",
      "R forte · 4",
      "R forte · 4",
      "faible",
      "faible",
      "faible",
      "faible",
    ]);
    expect(droite[0]).toMatchObject({ couleur: "--up", ancrageX: "droite" });
    expect(droite[0]!.valeur).toBeCloseTo(76114.19, 2);
    expect(droite[1]).toMatchObject({ couleur: "--down" });
    expect(labels.slice(-12)).toEqual(droite);
  });
});

describe("stratAxisSr — triangles creux des réactions sur zone forte", () => {
  it("les 120 plus récents, un par bougie et par sens, jamais sur une bougie de signal confirmé, rangés entre les signaux confirmés et les forts mouvements", () => {
    const marqueurs = defaut.annotations?.marqueurs ?? [];
    const triangles = creux(defaut);
    expect(triangles).toHaveLength(MAX_SIGNAUX_AXIS);
    expect(triangles[0]!.idx).toBe(262);
    expect(triangles.at(-1)!.idx).toBe(2988);
    expect(new Set(triangles.map((m) => `${m.idx}${m.forme}`)).size).toBe(triangles.length);

    const signaux = signauxConfirmes(defaut);
    const idxSignaux = new Set(signaux.map((m) => m.idx));
    expect(idxSignaux.has(2850)).toBe(true);
    expect(triangles.filter((m) => idxSignaux.has(m.idx))).toEqual([]);
    expect(triangles.some((m) => m.idx === 2850)).toBe(false);

    expect(triangles.find((m) => m.idx === 2733)).toEqual({
      idx: 2733,
      valeur: btc[2733]!.low,
      forme: "triangleHaut",
      couleur: "--up",
      cible: "prix",
      info: TEXTE_REACTION_2733,
      creux: true,
    });
    const t2761 = triangles.find((m) => m.idx === 2761);
    expect(t2761).toMatchObject({ valeur: btc[2761]!.high, forme: "triangleBas", couleur: "--down", creux: true });
    expect(t2761?.info).toMatch(
      /^AXIS S\/R réaction sur résistance forte \[\d+\.\d{2} – \d+\.\d{2}\] — 9 touches, 6 rejets sur volume fort, polarité inversée ; la bougie est entrée dans la zone et a clôturé au-dessous ; signal précoce non mesuré — lecture indicative, jamais une promesse$/
    );

    const rang = (m: MarqueurAnnotation): number => marqueurs.indexOf(m);
    const premierAccent = marqueurs.findIndex((m) => m.couleur === "--accent");
    expect(premierAccent).toBeGreaterThan(0);
    expect(Math.min(...triangles.map(rang))).toBeGreaterThan(Math.max(...signaux.map(rang)));
    expect(Math.max(...triangles.map(rang))).toBeLessThan(premierAccent);
  });

  it("plusieurs zones fortes réagissent dans le même sens : un seul triangle, qui cite la plus forte, puis à force égale la plus proche du close", () => {
    const forces = (pivotSr: number, zoneSrAtr: number, seuil: number, idx: number): string[] =>
      zonesBtc(pivotSr, zoneSrAtr, seuil)
        .reactions.filter((e) => e.idx === idx)
        .map((e) => `${e.sens}:${e.zone.force}`);
    const infos = (res: IndicatorResult, idx: number) => creux(res).filter((m) => m.idx === idx).map((m) => m.info);

    // Seuil 3, bougie 2 570 : deux résistances fortes, de force 4,5 et 3 ; la plus forte est la plus loin du close.
    expect(forces(5, 0.5, 3, 2570)).toEqual(["-1:4.5", "-1:3"]);
    expect(infos(calculer(btc, { forceZoneForte: 3 }), 2570)).toEqual([
      "AXIS S/R réaction sur résistance forte [78290.18 – 79077.88] — 4 touches, 0 rejet sur volume fort, polarité inversée ; " +
        "la bougie est entrée dans la zone et a clôturé au-dessous ; signal précoce non mesuré — lecture indicative, jamais une promesse",
    ]);

    // Pivots 3, zones de ± 0,3 × ATR, seuil 3 : à 2 570 et à 2 811, deux résistances de même force ; la plus proche
    // du close est la seconde du vivier.
    expect(forces(3, 0.3, 3, 2570)).toEqual(["-1:6.5", "-1:6.5"]);
    expect(forces(3, 0.3, 3, 2811)).toEqual(["-1:3", "-1:3"]);
    const egalites = calculer(btc, { pivotSr: 3, zoneSrAtr: 0.3, forceZoneForte: 3 });
    const sur2570 = infos(egalites, 2570);
    const sur2811 = infos(egalites, 2811);
    expect(sur2570).toHaveLength(1);
    expect(sur2811).toHaveLength(1);
    expect(sur2570[0]).toContain("[77491.52 – 77952.42] — 5 touches, 1 rejet sur volume fort, polarité inversée ;");
    expect(sur2811[0]).toContain("[84214.86 – 84730.43] — 2 touches, 1 rejet sur volume fort ;");
  });

  it("signauxPrecoces faux : aucun triangle creux, mêmes séries, mêmes rubans, mêmes autres marqueurs", () => {
    const sans = calculer(btc, { signauxPrecoces: false });
    expect(creux(sans)).toEqual([]);
    expect(sans.series).toEqual(defaut.series);
    expect(sans.annotations?.rubans).toEqual(defaut.annotations?.rubans);
    expect(sans.annotations?.marqueurs).toEqual((defaut.annotations?.marqueurs ?? []).filter((m) => m.creux !== true));
  });

  it("signauxPrecoces : seul le booléen faux masque les triangles creux ; la chaîne « false », 0 ou une chaîne vide les gardent", () => {
    for (const v of ["false", 0, ""]) expect(creux(calculer(btc, { signauxPrecoces: v })), JSON.stringify(v)).toEqual(creux(defaut));
  });

  it("maxZonesSr = 0 : ni ruban, ni bord, ni étiquette de zone ; les 120 triangles creux et les sorties restent", () => {
    const zero = calculer(btc, { maxZonesSr: 0 });
    expect(zero.annotations?.rubans).toBeUndefined();
    expect(zero.annotations?.segments).toBeUndefined();
    expect((zero.annotations?.labels ?? []).filter((l) => l.ancrageX === "droite")).toEqual([]);
    expect(creux(zero)).toHaveLength(MAX_SIGNAUX_AXIS);
    expect(zero.series).toEqual(defaut.series);
  });

  it("forceZoneForte = 50 : aucune réaction ni triangle creux ; quatre zones faibles tracées, sans remplissage", () => {
    const f50 = calculer(btc, { forceZoneForte: 50 });
    expect(somme(f50.series.reactionSupport)).toBe(0);
    expect(somme(f50.series.reactionResistance)).toBe(0);
    expect(creux(f50)).toEqual([]);
    const rubans = f50.annotations?.rubans ?? [];
    expect(rubans).toHaveLength(4);
    expect(rubans.every((r) => r.alpha === 0)).toBe(true);
  });
});

describe("stratAxisSr — entrées limites du tracé", () => {
  it("bougie en formation : une mèche dans la zone forte ne produit ni sortie ni triangle avant la clôture", () => {
    const meche = (closed: boolean): Candle[] => btc.map((c, i) => (i === 2999 ? { ...c, low: 75000, closed } : c));
    // Témoin : la même bougie, close, réagit sur le support fort.
    expect(calculer(meche(true)).series.reactionSupport?.[2999]).toBe(1);
    const res = calculer(meche(false));
    expect(res.series.reactionSupport?.[2999]).toBeUndefined();
    expect(res.series.reactionResistance?.[2999]).toBeUndefined();
    expect(creux(res).filter((m) => m.idx === 2999)).toEqual([]);
    expect(res.series.reactionSupport?.slice(0, 2999)).toEqual(defaut.series.reactionSupport?.slice(0, 2999));
    expect(res.series.reactionResistance?.slice(0, 2999)).toEqual(defaut.series.reactionResistance?.slice(0, 2999));
  });

  it("prix très petits (× 1e-9) : mêmes triangles creux, mêmes sorties de réaction, bornes lisibles dans l'infobulle des zones", () => {
    const minuscule = btc.map((c) => ({ ...c, open: c.open * 1e-9, high: c.high * 1e-9, low: c.low * 1e-9, close: c.close * 1e-9 }));
    const res = calculer(minuscule);
    expect(creux(res).map((m) => m.idx)).toEqual(creux(defaut).map((m) => m.idx));
    expect(res.series.reactionSupport).toEqual(defaut.series.reactionSupport);
    expect(res.series.reactionResistance).toEqual(defaut.series.reactionResistance);
    expect(res.annotations?.rubans?.[0]?.info).toContain("[0.00007563 – 0.00007660]");
  });

  it("forceZoneForte non fini (NaN, ±Infinity, texte non numérique) reçu sans résolution des réglages : repli sur 6, même résultat", () => {
    // `computeIndicator` remplace déjà un réglage non fini par son défaut (`resolveParams`) ; ici `calc` est appelée
    // directement, comme par un appelant qui ne résout pas les réglages.
    const ctx = { ...buildCalcContext(btc), aux: auxBtc, timeframe: "4h" as const };
    const avec = (forceZoneForte: number | string): IndicatorResult =>
      stratAxisSr.calc(btc, { ...resolveParams(stratAxisSr, {}), forceZoneForte }, ctx);
    const seuil6 = avec(6);
    expect(seuil6).toEqual(defaut);
    for (const v of [NaN, Infinity, -Infinity, "abc"]) expect(avec(v), String(v)).toEqual(seuil6);
  });

  it("historique vide ou très court (0, 1, 8 bougies) : aucune exception, séries de la bonne longueur, ni zone ni triangle creux", () => {
    for (const n of [0, 1, 8]) {
      const res = calculer(btc.slice(0, n));
      for (const cle of stratAxisSr.outputs.map((o) => o.key)) expect(res.series[cle], `${cle}, ${n} bougies`).toHaveLength(n);
      expect(res.annotations?.rubans, `${n} bougies`).toBeUndefined();
      expect(res.annotations?.segments, `${n} bougies`).toBeUndefined();
      expect((res.annotations?.labels ?? []).filter((l) => l.ancrageX === "droite"), `${n} bougies`).toEqual([]);
      expect(creux(res), `${n} bougies`).toEqual([]);
    }
  });

  it("coût : médiane de 30 calculs complets sur 3 000 bougies sous 25 ms (borne large pour la CI)", () => {
    computeIndicator(stratAxisSr, btc, {}, auxBtc, "4h");
    const durees: number[] = [];
    for (let k = 0; k < 30; k++) {
      const t0 = performance.now();
      computeIndicator(stratAxisSr, btc, {}, auxBtc, "4h");
      durees.push(performance.now() - t0);
    }
    durees.sort((a, b) => a - b);
    expect((durees[14]! + durees[15]!) / 2).toBeLessThan(25);
  });
});
