/**
 * @axiom/indicators — strategy/stratAxis.test.ts
 *
 * AXIS (confluence, demande du 7 octobre 2026, v2 long/plat) n'a pas de
 * référence externe : la garantie passe par la fixture dorée (300 bougies
 * BTCUSDT-1h à seed fixe, golden/fixture-ohlcv.json, empreinte figée par
 * golden.test.ts) dérivée AU LITTÉRAL, la recomposition des votes contre les
 * cœurs importés directement, et des scores synthétiques pour les positions.
 *
 * Faits dérivés sur la fixture (votes aux défauts : EMA 20/50, Supertrend
 * 10×3, ADX ≥ 20, MACD 12/26/9, RSI 14, CMF 20) :
 *   i=49 : premier score défini (l'EMA 50 est le dernier cœur amorcé), +4 ;
 *   défauts (achat ≥ +5, vente ≤ −4, EMA 200) : la fixture baisse, le close
 *     reste sous l'EMA 200 de i=199 à 298 → aucun achat ; il ne la franchit
 *     qu'à i=299, la dernière bougie, exclue par l'anti-repaint ;
 *   EMA de tendance 50 : achats 60 et 107 (+6/6), ventes 88 et 139 (−4/6),
 *     achat 280 encore ouvert ; la position traverse des scores 0 et −1 ;
 *   seuil 4 + EMA 50 : à i=49 l'achat est déjà vrai (+4, close 60322,86 >
 *     EMA 59570,63) → silence, premier achat à 53 après les scores 0 de 50..52 ;
 *   i=255 : +4 mais close 53057,24 < EMA 50 53098,32 → achat retardé à 256
 *     (avec l'EMA 20, au-dessous du close, il a lieu dès 255).
 *
 * Couche flux sur la fixture (OHLCV sans volumes taker, sans OI) : volume
 * relatif défini à partir de i=19 (SMA 20), maximum ×2,21 à i=109 — aucune
 * bougie n'atteint ×3, donc aucun « gros mouvement » aux défauts ; aux signaux
 * 60/88/107/139/280 : ×1,39, ×1,07, ×0,61, ×1,28, ×0,91. Delta taker et OI
 * s'injectent (champs `buyVolume`/`sellVolume`, série aux `oi`) sans toucher
 * aux cœurs, qui ne lisent que l'OHLCV : les signaux restent AU LITTÉRAL.
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { getIndicator } from "../registry";
import { supportsIndicatorTimeframe, TIMEFRAME_REQUIS } from "../timeframes";
import { closeOf, ema, rma, trueRange } from "../utils";
import { MAX_LABELS_SORTIE, specStrategie } from "../utils-fabrique-strategie";
import { rsiOf } from "../momentum/rsi";
import { adxOf } from "../trend/adx";
import { macdOf } from "../trend/macd";
import { supertrendOf } from "../trend/supertrend";
import { cmfOf } from "../volume/cmf";
import fixtureRaw from "../golden/fixture-ohlcv.json";
import {
  ATR_STOP_PERIODE,
  MAX_GROS_AXIS,
  MAX_LABELS_GROS,
  MAX_SIGNAUX_AXIS,
  SEUIL_DELTA_AXIS,
  episodesAxis,
  fluxAxis,
  forceFlux,
  grosMouvementsAxis,
  positionsAxis,
  positionsStopAxis,
  sensGros,
  stratAxis,
  textesAxis,
  votesAxis,
} from "./stratAxis";

const candles = fixtureRaw as Candle[];
const DEFAUTS = { emaRapide: 20, emaLente: 50, stPeriode: 10, stMult: 3, seuilAdx: 20 };
const EMA50 = { emaTendance: 50 };
const RESERVE =
  "test réussi sur données jamais vues (crypto 4h, 2017-2024), pas mieux qu'une EMA 200 seule sur 3/4 actifs — mesure passée, pas une promesse";
const RESERVE_FILTRE = "filtre flux actif : signaux hors du test du 7 octobre 2026, non mesurés — jamais une promesse";
const NON_MESURE = "couche flux non mesurée";
const QUALIFICATION = "qualification descriptive, sans avantage mesuré pour les signaux « forts » (données jamais vues, 8 octobre 2026)";
const MESURE_FORT_ACHAT =
  "fort achat : sur données jamais vues (BNB/ADA/LINK/DOGE 4h, 2017-2026), +1.61 % en moyenne sur les 12 bougies suivantes (51 % de hausses, p ≤ 0.0005) — mesure passée, pas une promesse";
const MESURE_FORTE_VENTE = "forte vente : repérée ; aucune suite mesurable à 12 bougies sur données jamais vues (BNB/ADA/LINK/DOGE 4h, 2017-2026)";
/** Lectures de flux d'une bougie sans volumes taker ni OI : seul le volume relatif parle. */
const fluxVolume = (qualite: string, rvol: string) =>
  `flux ${qualite} (volume ×${rvol}, delta taker n.d., OI n.d. ; ${QUALIFICATION})`;

/** Signaux (▲/▼ du cœur, hors marqueurs « fort achat / forte vente ») sous la forme « 60▲ 88▼ … ». */
function resume(candlesEntree: Candle[], params: Record<string, number | boolean> = {}): string {
  const res = computeIndicator(stratAxis, candlesEntree, params);
  return (res.annotations?.marqueurs ?? [])
    .filter((m) => m.couleur !== "--accent")
    .map((m) => `${m.idx}${m.forme === "triangleHaut" ? "▲" : "▼"}`)
    .join(" ");
}

/** Marqueurs « fort achat / forte vente » (couleur --accent) d'un résultat. */
const grosDe = (res: ReturnType<typeof computeIndicator>) =>
  (res.annotations?.marqueurs ?? []).filter((m) => m.couleur === "--accent");

/** Sens strict a vs b, sans −0 (toEqual distingue 0 et −0). */
const sens = (a: number, b: number): number => Math.sign(a - b) + 0;

describe("stratAxis — contrat", () => {
  it("strategy/overlay enregistrée, quinze inputs bornés, deux sorties prix, toute unité de temps, sans spec de fabrique", () => {
    expect(getIndicator("stratAxis")).toBe(stratAxis);
    expect(stratAxis.name).toBe("AXIS");
    expect(stratAxis.category).toBe("strategy");
    expect(stratAxis.pane).toBe("overlay");
    expect(stratAxis.inputs.map((i) => [i.key, i.default, i.min, i.max])).toEqual([
      ["seuil", 5, 1, 6],
      ["seuilVente", 4, 1, 6],
      ["emaTendance", 200, 2, undefined],
      ["emaRapide", 20, 1, undefined],
      ["emaLente", 50, 2, undefined],
      ["stPeriode", 10, 1, undefined],
      ["stMult", 3, 0.5, undefined],
      ["seuilAdx", 20, 5, 60],
      ["rvolPeriode", 20, 2, 500],
      ["seuilRvol", 1.5, 1, 20],
      ["seuilGros", 3, 1, 50],
      ["oiBougies", 6, 1, 200],
      ["seuilOi", 2, 0.1, 100],
      ["filtreFlux", false, undefined, undefined],
      ["stopAtr", 0, 0, 20],
    ]);
    expect(stratAxis.inputs.find((i) => i.key === "filtreFlux")?.type).toBe("boolean");
    // Stop suiveur (v3) : dernier réglage, défaut 0 au figeage (v2 exacte) tant que le test
    // sur données jamais vues n'a pas rendu son verdict (scripts/axis/manifeste-v3-2026-10-08.json).
    expect(stratAxis.inputs.at(-1)).toEqual({ key: "stopAtr", name: "Stop suiveur (× ATR 14, 0 = sans)", type: "number", default: 0, min: 0, max: 20 });
    expect(stratAxis.outputs).toEqual([
      { key: "prixSignal", name: "Prix d'achat", style: "line" },
      { key: "stop", name: "Stop suiveur", style: "line" },
    ]);
    expect(ATR_STOP_PERIODE).toBe(14);
    // L'OI enrichit la couche flux sans jamais conditionner AXIS : facultative, jamais requise
    // (une série `aux` rendrait AXIS inutilisable hors perp USDT et l'écarterait des alertes).
    expect(stratAxis.auxFacultatives).toEqual(["oi"]);
    expect(stratAxis.aux).toBeUndefined();
    // Aucune unité requise : le propriétaire demande (7 octobre 2026) qu'AXIS
    // fonctionne sur toute unité de temps. Test réussi en 4h ; échoué ou non
    // mesuré ailleurs (8 octobre 2026) : l'infobulle dit le statut de l'unité.
    expect(stratAxis.minTimeframe).toBeUndefined();
    expect(TIMEFRAME_REQUIS.stratAxis).toBeUndefined();
    expect(supportsIndicatorTimeframe("stratAxis", "4h")).toBe(true);
    expect(supportsIndicatorTimeframe("stratAxis", "1m")).toBe(true);
    expect(supportsIndicatorTimeframe("stratAxis", "1d")).toBe(true);
    expect(supportsIndicatorTimeframe("stratAxis", "1w")).toBe(true);
    expect(supportsIndicatorTimeframe("stratAxis", "1M")).toBe(true);
    // Verdict FAVORABLE du test sur données jamais vues (scripts/axis/rapport-v2-2026-10-07.md).
    expect(stratAxis.validation).toBeUndefined();
    // Hors fabrique defStrategie : ni trades ni PnL, et scripts/valider-strategies l'ignore.
    expect(specStrategie("stratAxis")).toBeUndefined();
  });
});

describe("votesAxis", () => {
  it("recomposition contre les cœurs : sens stricts, DMI conditionné à l'ADX, CMF indéfini neutre", () => {
    const cl = closeOf(candles);
    const rapide = ema(cl, 20);
    const lente = ema(cl, 50);
    const st = supertrendOf(candles, 10, 3);
    const dmi = adxOf(candles, 14);
    const m = macdOf(cl, 12, 26, 9);
    const rsi = rsiOf(cl, 14);
    const cmf = cmfOf(candles, 20);
    const votes = votesAxis(candles, DEFAUTS);
    // L'EMA 50 est le dernier cœur amorcé : aucun vote avant i=49.
    expect(lente.findIndex((v) => v !== undefined)).toBe(49);
    expect(votes.findIndex((v) => v !== undefined)).toBe(49);
    for (let i = 49; i < candles.length; i++) {
      const adx = dmi.adx[i]!;
      const attendu = [
        sens(rapide[i]!, lente[i]!),
        st.direction[i],
        adx >= 20 ? sens(dmi.plusDI[i]!, dmi.minusDI[i]!) : 0,
        sens(m.macd[i]!, m.signal[i]!),
        sens(rsi[i]!, 50),
        cmf[i] === undefined ? 0 : sens(cmf[i]!, 0),
      ];
      expect(votes[i], `i=${i}`).toEqual(attendu);
    }
  });

  it("i=70 : ADX sous le seuil → DMI neutre ; seuil ADX abaissé → le +DI dominant vote", () => {
    const dmi = adxOf(candles, 14);
    expect(dmi.adx[70]).toBeCloseTo(19.2765, 4);
    expect(dmi.plusDI[70]).toBeCloseTo(28.0211, 4);
    expect(dmi.minusDI[70]).toBeCloseTo(13.3561, 4);
    expect(votesAxis(candles, DEFAUTS)[70]).toEqual([1, 1, 0, 1, 1, 1]);
    expect(votesAxis(candles, { ...DEFAUTS, seuilAdx: 5 })[70]).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it("volume nul (forex, série synthétique) : CMF indéfini, vote neutre, score toujours défini", () => {
    const sansVolume = candles.map((c) => ({ ...c, volume: 0 }));
    expect(cmfOf(sansVolume, 20).every((v) => v === undefined)).toBe(true);
    const votes = votesAxis(sansVolume, DEFAUTS);
    expect(votes.findIndex((v) => v !== undefined)).toBe(49);
    expect(votes.slice(49).every((v) => v !== undefined && v[5] === 0)).toBe(true);
    // Cinq votes restent : achat à +5 et vente à −4 encore atteignables.
    expect(resume(sansVolume, EMA50)).toBe("60▲ 96▼ 107▲ 142▼ 274▲");
  });
});

describe("episodesAxis (lecture v1, campagne figée)", () => {
  it("naît au seuil, dure tant que le score garde son signe, se réarme en repassant par 0", () => {
    const score = [undefined, 2, 4, 3, 1, 3, 4, 0, 4, -1, -4, -2, 0, -3, -4];
    expect(episodesAxis(score, 4, score.length - 1)).toEqual([
      undefined, 0, 1, 1, 1, 1, 1, 0, 1, 0, -1, -1, 0, 0, -1,
    ]);
  });

  it("score indéfini ou situé après `fin` : l'état précédent est reporté", () => {
    expect(episodesAxis([4, undefined, 2, 0, -5], 4, 3)).toEqual([1, 1, 1, 0, 0]);
    expect(episodesAxis([undefined, undefined], 4, 1)).toEqual([undefined, undefined]);
  });
});

describe("positionsAxis", () => {
  const haut = (n: number): boolean[] => new Array(n).fill(true);

  it("achat à +seuil une fois armé ; tenue à travers 0 et −3 ; vente à −seuilVente ; réarmé aussitôt", () => {
    const score = [undefined, 2, 5, 4, 0, -3, -4, 0, 5, 6, -5, 6];
    expect(positionsAxis(score, haut(12), 5, 4, 11)).toEqual([undefined, 0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 1]);
  });

  it("achat déjà vrai à la première bougie évaluable : silence jusqu'à un achat faux", () => {
    expect(positionsAxis([5, 6, 5, 4, 5], haut(5), 5, 4, 4)).toEqual([0, 0, 0, 0, 1]);
  });

  it("tendance indéfinie : ni achat ni armement ; sous l'EMA, pas d'achat même à +6", () => {
    const tendance = [undefined, undefined, true, false, false, true, true];
    expect(positionsAxis([4, 6, 6, 6, 4, 5, 5], tendance, 5, 4, 6)).toEqual([0, 0, 0, 0, 0, 1, 1]);
  });

  it("la vente ne dépend pas de la tendance : sous l'EMA, la position tient jusqu'à −seuilVente", () => {
    expect(positionsAxis([3, 5, 2, -2, -4], [true, true, false, false, false], 5, 4, 4)).toEqual([0, 1, 1, 1, 0]);
  });

  it("score indéfini ou situé après `fin` : position reportée", () => {
    expect(positionsAxis([undefined, 3, 5, undefined, -6, -6], haut(6), 5, 4, 3)).toEqual([undefined, 0, 1, 1, 1, 1]);
  });
});

describe("stratAxis — calc sur la fixture dorée", () => {
  const res = computeIndicator(stratAxis, candles, EMA50);

  it("défauts : close sous l'EMA 200 de 199 à 298 → aucun achat ; le franchissement de 299 (dernière bougie) est exclu", () => {
    const e200 = ema(closeOf(candles), 200);
    expect(e200.findIndex((v) => v !== undefined)).toBe(199);
    const auDessus = e200.map((t, i) => t !== undefined && candles[i]!.close > t);
    expect(auDessus.slice(199, 299).some(Boolean)).toBe(false);
    expect(auDessus[299]).toBe(true);
    const defaut = computeIndicator(stratAxis, candles, {});
    expect(defaut.annotations).toBeUndefined();
    expect(defaut.series.prixSignal?.every((v) => v === undefined)).toBe(true);
  });

  it("EMA de tendance 50 : cinq signaux AU LITTÉRAL (▲ au plus bas, ▼ au plus haut, résultat hors frais)", () => {
    const votes = "EMA 20/50 ▲, Supertrend ▲, DMI ▲, MACD ▲, RSI ▲, CMF ▲";
    const baisse = "EMA 20/50 ▲, Supertrend ▼, DMI ▼, MACD ▼, RSI ▼, CMF ▼";
    // Fixture sans volumes taker ni OI : la couche flux ne lit que le volume relatif,
    // toujours sous ×1,5 aux bougies de signal → « ordinaire », aucun « gros mouvement ».
    expect(res.annotations?.marqueurs).toEqual([
      { idx: 60, valeur: 60296.88, forme: "triangleHaut", couleur: "--up", cible: "prix",
        info: `AXIS achat — score +6/6 : ${votes} ; close au-dessus de l'EMA 50 ; ${fluxVolume("ordinaire", "1.4")} — ${RESERVE}` },
      { idx: 88, valeur: 61283.85, forme: "triangleBas", couleur: "--down", cible: "prix",
        info: `AXIS vente — score -4/6 : ${baisse} ; -0.50 % depuis l'achat (hors frais) ; ${fluxVolume("ordinaire", "1.1")} — ${RESERVE}` },
      { idx: 107, valeur: 61068.78, forme: "triangleHaut", couleur: "--up", cible: "prix",
        info: `AXIS achat — score +6/6 : ${votes} ; close au-dessus de l'EMA 50 ; ${fluxVolume("ordinaire", "0.6")} — ${RESERVE}` },
      { idx: 139, valeur: 61009.07, forme: "triangleBas", couleur: "--down", cible: "prix",
        info: `AXIS vente — score -4/6 : ${baisse} ; -1.86 % depuis l'achat (hors frais) ; ${fluxVolume("ordinaire", "1.3")} — ${RESERVE}` },
      { idx: 280, valeur: 53948.6, forme: "triangleHaut", couleur: "--up", cible: "prix",
        info: `AXIS achat — score +6/6 : ${votes} ; close au-dessus de l'EMA 50 ; ${fluxVolume("ordinaire", "0.9")} — ${RESERVE}` },
    ]);
    for (const m of res.annotations?.marqueurs ?? []) {
      const b = candles[m.idx]!;
      expect(m.valeur).toBe(m.forme === "triangleHaut" ? b.low : b.high);
    }
    // Résultat = close de vente / close d'achat − 1.
    expect((candles[88]!.close / candles[60]!.close - 1) * 100).toBeCloseTo(-0.5, 2);
    expect((candles[139]!.close / candles[107]!.close - 1) * 100).toBeCloseTo(-1.86, 2);
  });

  it("étiquettes « Achat » sous / « Vente ±x % » au-dessus de chaque signal (≤ 10)", () => {
    const achat = (idx: number, valeur: number) =>
      ({ idx, valeur, texte: "Achat", couleur: "--up", cible: "prix", position: "dessous" });
    const vente = (idx: number, valeur: number, texte: string) =>
      ({ idx, valeur, texte, couleur: "--down", cible: "prix", position: "dessus" });
    expect(res.annotations?.labels).toEqual([
      achat(60, 60296.88), vente(88, 61283.85, "Vente -0.50 %"), achat(107, 61068.78),
      vente(139, 61009.07, "Vente -1.86 %"), achat(280, 53948.6),
    ]);
  });

  it("prixSignal : close de la bougie d'achat, tenu pendant la position, trou à plat et à la vente", () => {
    const positions: Array<[de: number, a: number]> = [[60, 87], [107, 138], [280, 299]];
    const attendu: Array<number | undefined> = new Array(candles.length).fill(undefined);
    for (const [de, a] of positions) for (let i = de; i <= a; i++) attendu[i] = candles[de]!.close;
    expect(res.series.prixSignal).toEqual(attendu);
    expect([candles[60]!.close, candles[107]!.close, candles[280]!.close]).toEqual([60785.17, 61454.2, 54338.01]);
  });

  it("une confluence retombée à 0 ou −1 ne vend pas : seule −4 vend", () => {
    const score = votesAxis(candles, DEFAUTS).map((v) => v?.reduce((a, b) => a + b, 0));
    expect(score.slice(60, 68)).toEqual([6, 4, 2, 2, -1, 1, 1, -1]);
    expect(score.slice(131, 140)).toEqual([4, 2, 0, 0, 0, -2, -2, -2, -4]);
  });

  it("armement : à i=49 l'achat (+4, au-dessus de l'EMA 50) est déjà vrai → premier achat à 53", () => {
    const score = votesAxis(candles, DEFAUTS).map((v) => v?.reduce((a, b) => a + b, 0));
    expect(score.slice(48, 54)).toEqual([undefined, 4, 0, 0, 0, 4]);
    expect(candles[49]!.close).toBeGreaterThan(ema(closeOf(candles), 50)[49]!);
    expect(resume(candles, { ...EMA50, seuil: 4 })).toBe("53▲ 88▼ 107▲ 139▼ 256▲ 263▼ 270▲");
  });

  it("filtre de tendance : à i=255 le close est sous l'EMA 50 (achat à 256), au-dessus de l'EMA 20 (achat à 255)", () => {
    expect(resume(candles, { emaTendance: 20, seuil: 4 })).toBe("53▲ 88▼ 107▲ 139▼ 255▲ 263▼ 270▲");
  });

  it("seuil de vente réglable : vente à −2 → sortie avancée de 139 à 136", () => {
    expect(resume(candles, { ...EMA50, seuilVente: 2 })).toBe("60▲ 88▼ 107▲ 136▼ 280▲");
  });

  it("anti-repaint : la dernière bougie ne crée jamais de signal, la suivante le confirme", () => {
    const enFormation = computeIndicator(stratAxis, candles.slice(0, 61), EMA50);
    expect(enFormation.annotations).toBeUndefined();
    expect(enFormation.series.prixSignal?.[60]).toBeUndefined();
    const confirme = computeIndicator(stratAxis, candles.slice(0, 62), EMA50);
    expect(confirme.annotations?.marqueurs?.map((m) => m.idx)).toEqual([60]);
    expect(confirme.series.prixSignal?.slice(60)).toEqual([60785.17, 60785.17]);
  });

  it("causalité : un préfixe ou un futur altéré ne change jamais le passé", () => {
    const complet = res.series.prixSignal ?? [];
    const marqueurs = res.annotations?.marqueurs ?? [];
    for (const k of [60, 88, 139, 253, 280]) {
      // Préfixe : la bougie k est la dernière (en formation), exclue de la comparaison.
      const prefixe = computeIndicator(stratAxis, candles.slice(0, k + 1), EMA50);
      expect(prefixe.series.prixSignal?.slice(0, k), `préfixe ${k}`).toEqual(complet.slice(0, k));
      expect(prefixe.annotations?.marqueurs ?? []).toEqual(marqueurs.filter((m) => m.idx < k));
      // Futur altéré : la bougie k n'est plus la dernière, elle est comparée aussi.
      const alterees = candles.map((c, i) => (i <= k ? c : { ...c, high: 1e12 + i, low: 1, close: 1e12 - i, volume: 1e12 }));
      const futur = computeIndicator(stratAxis, alterees, EMA50);
      expect(futur.series.prixSignal?.slice(0, k + 1), `futur ${k}`).toEqual(complet.slice(0, k + 1));
      expect((futur.annotations?.marqueurs ?? []).filter((m) => m.idx <= k)).toEqual(marqueurs.filter((m) => m.idx <= k));
    }
  });

  it("moins de 50 bougies : aucun score, aucune annotation", () => {
    const court = computeIndicator(stratAxis, candles.slice(0, 49), EMA50);
    expect(court.annotations).toBeUndefined();
    expect(court.series.prixSignal?.every((v) => v === undefined)).toBe(true);
  });
});

describe("stratAxis — plafonds d'annotation", () => {
  it(`garde les ${MAX_SIGNAUX_AXIS} signaux les plus récents, étiquette les ${MAX_LABELS_SORTIE} derniers`, () => {
    // Sinusoïde de période 60 sur 6 000 bougies : ≈ un achat et une vente par période.
    const n = 6000;
    const sinus: Candle[] = Array.from({ length: n }, (_v, i) => {
      const c = 100 + 10 * Math.sin((2 * Math.PI * i) / 60) + (i % 7) * 0.05;
      return { time: i * 3_600_000, open: c - 0.2, high: c + 1, low: c - 1, close: c, volume: 10 + (i % 5) };
    });
    const score = votesAxis(sinus, DEFAUTS).map((v) => v?.reduce((a, b) => a + b, 0));
    const tendance = ema(closeOf(sinus), 200).map((t, i) => (t === undefined ? undefined : sinus[i]!.close > t));
    const pos = positionsAxis(score, tendance, 5, 4, n - 2);
    const tous: number[] = [];
    for (let i = 1; i < n; i++) if (pos[i - 1] !== undefined && pos[i] !== pos[i - 1]) tous.push(i);
    expect(tous.length).toBe(192);
    const res = computeIndicator(stratAxis, sinus, {});
    // Volume 10..14 : ×1,17 au plus, aucun « gros mouvement » parmi les marqueurs.
    expect(res.annotations?.marqueurs?.map((m) => m.idx)).toEqual(tous.slice(-MAX_SIGNAUX_AXIS));
    expect(res.annotations?.labels?.map((l) => l.idx)).toEqual(tous.slice(-MAX_LABELS_SORTIE));
  });
});

describe("fluxAxis", () => {
  const plate: Candle[] = Array.from({ length: 25 }, (_v, i) => ({
    time: i * 3_600_000, open: 10, high: 11, low: 9, close: 10.5, volume: 10,
  }));

  it("volume relatif = volume / SMA(volume) à partir de la fenêtre ; delta et OI absents sans donnée", () => {
    const flux = fluxAxis(plate, undefined, 20, 6);
    expect(flux.slice(0, 19).every((f) => f.rvol === undefined)).toBe(true);
    expect(flux[19]).toEqual({ rvol: 1 });
    expect(flux[24]).toEqual({ rvol: 1 });
    const pic = plate.map((c, i) => (i === 22 ? { ...c, volume: 30 } : c));
    expect(fluxAxis(pic, undefined, 20, 6)[22]?.rvol).toBeCloseTo(30 / 11, 12); // SMA 20 = (19×10 + 30)/20
  });

  it("delta taker = (acheteur − vendeur) / volume, absent sans champs taker ou à volume nul", () => {
    const taker = plate.map((c, i) =>
      i === 22 ? { ...c, volume: 30, buyVolume: 20, sellVolume: 10 } : i === 23 ? { ...c, volume: 0, buyVolume: 0, sellVolume: 0 } : c
    );
    const flux = fluxAxis(taker, undefined, 20, 6);
    expect(flux[22]?.delta).toBeCloseTo(1 / 3, 12);
    expect(flux[21]?.delta).toBeUndefined();
    expect(flux[23]).toEqual({ rvol: 0 });
  });

  it("ΔOI = variation % sur `oiBougies` bougies ; absent sans point de départ, à OI nul ou sans série", () => {
    const oi: Array<number | undefined> = new Array(25).fill(100);
    oi[22] = 110;
    oi[3] = 0;
    const flux = fluxAxis(plate, oi, 20, 6);
    expect(flux[22]?.dOi).toBeCloseTo(10, 12); // 110 / oi[16] = 100
    expect(flux[5]?.dOi).toBeUndefined(); // oi[-1]
    expect(flux[6]?.dOi).toBe(0);
    expect(flux[9]?.dOi).toBeUndefined(); // oi[3] = 0
    oi[20] = undefined;
    expect(fluxAxis(plate, oi, 20, 6)[20]?.dOi).toBeUndefined();
    expect(fluxAxis(plate, undefined, 20, 6).every((f) => f.dOi === undefined)).toBe(true);
    // Recul arrondi, jamais nul : oiBougies 0,4 → 1 bougie.
    expect(fluxAxis(plate, oi, 20, 0.4)[22]?.dOi).toBeCloseTo(10, 12);
  });

  it("volume nul partout (forex) : aucune lecture", () => {
    expect(fluxAxis(plate.map((c) => ({ ...c, volume: 0 })), undefined, 20, 6).every((f) => f.rvol === undefined)).toBe(true);
  });
});

describe("forceFlux et sensGros", () => {
  const force = (f: Parameters<typeof forceFlux>[0], sens: number) => forceFlux(f, sens, 1.5, 2);

  it("sans lecture : indisponible, jamais fort", () => {
    expect(force({}, 1)).toEqual({ dispo: 0, confirme: 0, contre: false, fort: false });
  });

  it("une lecture (volume seul) : forte dès ×seuilRvol", () => {
    expect(force({ rvol: 1.5 }, 1)).toEqual({ dispo: 1, confirme: 1, contre: false, fort: true });
    expect(force({ rvol: 1.4 }, -1).fort).toBe(false);
  });

  it("deux lectures : les deux doivent confirmer ; trois : deux suffisent", () => {
    expect(force({ rvol: 2, delta: 0.05 }, 1)).toEqual({ dispo: 2, confirme: 1, contre: false, fort: false });
    expect(force({ rvol: 2, delta: SEUIL_DELTA_AXIS }, 1).fort).toBe(true);
    expect(force({ rvol: 2, dOi: -2.5 }, -1).fort).toBe(true); // |ΔOI| : shorts ouverts ou longs fermés
    expect(force({ rvol: 1, delta: 0.3, dOi: 2 }, 1)).toEqual({ dispo: 3, confirme: 2, contre: false, fort: true });
    expect(force({ rvol: 1, delta: 0.3, dOi: 1.9 }, 1).fort).toBe(false);
  });

  it("un delta taker à contre-sens interdit « fort », même avec deux confirmations", () => {
    expect(force({ rvol: 2, delta: -0.3, dOi: 5 }, 1)).toEqual({ dispo: 3, confirme: 2, contre: true, fort: false });
    expect(force({ rvol: 2, delta: 0.1 }, -1)).toEqual({ dispo: 2, confirme: 1, contre: true, fort: false });
    expect(force({ rvol: 2, delta: -0.05 }, 1).contre).toBe(false); // sous 10 % du volume : sans sens
  });

  it("sens d'un gros mouvement : delta taker marqué, sinon corps de la bougie, doji indécis", () => {
    const baissiere: Candle = { time: 0, open: 11, high: 12, low: 9, close: 10, volume: 1 };
    const haussiere: Candle = { ...baissiere, open: 10, close: 11 };
    expect(sensGros({ delta: 0.2 }, baissiere)).toBe(1);
    expect(sensGros({ delta: -0.1 }, haussiere)).toBe(-1);
    expect(sensGros({ delta: 0.05 }, baissiere)).toBe(-1);
    expect(sensGros({}, haussiere)).toBe(1);
    expect(sensGros({}, { ...baissiere, close: 11 })).toBe(0);
  });
});

describe("stratAxis — couche flux dans calc", () => {
  const votes = "EMA 20/50 ▲, Supertrend ▲, DMI ▲, MACD ▲, RSI ▲, CMF ▲";
  const baisse = "EMA 20/50 ▲, Supertrend ▼, DMI ▼, MACD ▼, RSI ▼, CMF ▼";
  const taker = (c: Candle, partAchat: number): Candle =>
    ({ ...c, buyVolume: c.volume * partAchat, sellVolume: c.volume * (1 - partAchat) });
  // Volumes taker sur quatre bougies de signal (139 reste sans), OI 100 partout sauf aux
  // signaux (139 : absent) : les cœurs ne lisent que l'OHLCV, les signaux ne bougent pas.
  const enrichies = candles.map((c, i) =>
    i === 60 ? taker(c, 0.75) : i === 88 ? taker(c, 0.35) : i === 107 ? taker(c, 0.4) : i === 280 ? taker(c, 0.525) : c
  );
  const oi: Array<number | undefined> = new Array(candles.length).fill(100);
  oi[60] = 103;
  oi[88] = 97.5;
  oi[107] = 110;
  oi[139] = undefined;
  oi[280] = 101;
  const res = computeIndicator(stratAxis, enrichies, EMA50, { oi });

  it("les signaux du cœur sont identiques avec ou sans volumes taker et OI", () => {
    const nu = computeIndicator(stratAxis, candles, EMA50);
    expect(res.annotations?.marqueurs?.map((m) => [m.idx, m.forme, m.valeur])).toEqual(
      nu.annotations?.marqueurs?.map((m) => [m.idx, m.forme, m.valeur])
    );
    expect(res.series.prixSignal).toEqual(nu.series.prixSignal);
  });

  it("qualification : fort (2 lectures sur 3), à contre-sens (delta opposé), ordinaire, lectures absentes dites", () => {
    expect(res.annotations?.marqueurs?.map((m) => m.info)).toEqual([
      `AXIS achat fort — score +6/6 : ${votes} ; close au-dessus de l'EMA 50 ; ` +
        `flux fort (volume ×1.4, delta taker +50 %, OI +3.0 % sur 6 b. ; ${QUALIFICATION}) — ${RESERVE}`,
      `AXIS vente forte — score -4/6 : ${baisse} ; -0.50 % depuis l'achat (hors frais) ; ` +
        `flux fort (volume ×1.1, delta taker -30 %, OI -2.5 % sur 6 b. ; ${QUALIFICATION}) — ${RESERVE}`,
      `AXIS achat — score +6/6 : ${votes} ; close au-dessus de l'EMA 50 ; ` +
        `flux à contre-sens (volume ×0.6, delta taker -20 %, OI +10.0 % sur 6 b. ; ${QUALIFICATION}) — ${RESERVE}`,
      `AXIS vente — score -4/6 : ${baisse} ; -1.86 % depuis l'achat (hors frais) ; ${fluxVolume("ordinaire", "1.3")} — ${RESERVE}`,
      `AXIS achat — score +6/6 : ${votes} ; close au-dessus de l'EMA 50 ; ` +
        `flux ordinaire (volume ×0.9, delta taker +5 %, OI +1.0 % sur 6 b. ; ${QUALIFICATION}) — ${RESERVE}`,
    ]);
    expect(res.annotations?.labels?.map((l) => l.texte)).toEqual([
      "Achat fort", "Vente forte -0.50 %", "Achat", "Vente -1.86 %", "Achat",
    ]);
  });

  it("volume nul (forex) : flux indisponible, signaux et étiquettes inchangés", () => {
    const sansVolume = candles.map((c) => ({ ...c, volume: 0 }));
    const r = computeIndicator(stratAxis, sansVolume, EMA50);
    expect(r.annotations?.marqueurs?.[0]?.info).toBe(
      `AXIS achat — score +5/6 : EMA 20/50 ▲, Supertrend ▲, DMI ▲, MACD ▲, RSI ▲, CMF – ; close au-dessus de l'EMA 50 ; ` +
        `flux indisponible (volume n.d., delta taker n.d., OI n.d. ; ${QUALIFICATION}) — ${RESERVE}`
    );
    expect(r.annotations?.labels?.map((l) => l.texte)).toEqual(["Achat", "Vente -1.98 %", "Achat", "Vente -1.87 %", "Achat"]);
    expect(grosDe(r)).toEqual([]);
  });

  it("période du volume moyen et seuil réglables : à 60, ×1,39 (SMA 20) ou ×1,49 (SMA 5) devient fort sous le seuil", () => {
    const r = computeIndicator(stratAxis, candles, { ...EMA50, seuilRvol: 1.3 });
    expect(r.annotations?.labels?.map((l) => l.texte)).toEqual(["Achat fort", "Vente -0.50 %", "Achat", "Vente -1.86 %", "Achat"]);
    expect(fluxAxis(candles, undefined, 5, 6)[60]?.rvol).toBeCloseTo(1.4892, 3);
    const premier = (params: Record<string, number>) =>
      computeIndicator(stratAxis, candles, { ...EMA50, ...params }).annotations?.labels?.[0]?.texte;
    expect(premier({ rvolPeriode: 5, seuilRvol: 1.45 })).toBe("Achat fort");
    expect(premier({ seuilRvol: 1.45 })).toBe("Achat");
  });

  it("filtre flux : n'achète que sur flux fort, la vente ne change pas, l'infobulle le dit", () => {
    // Fixture : à 60 ×1,39 < 1,5 → l'achat attend 73 (première confluence forte armée) ;
    // 107 ×0,61 → 109 ; 280 ×0,91 → 283. Les ventes 88 et 139 tiennent (−4 inchangé).
    expect(resume(candles, { ...EMA50, filtreFlux: true })).toBe("73▲ 88▼ 109▲ 139▼ 283▲");
    expect(resume(candles, { ...EMA50, filtreFlux: true, seuilRvol: 1.2 })).toBe("60▲ 88▼ 108▲ 139▼ 283▲");
    const r = computeIndicator(stratAxis, candles, { ...EMA50, filtreFlux: true });
    expect(r.annotations?.marqueurs?.[0]?.info).toBe(
      `AXIS achat fort — score +6/6 : ${votes} ; close au-dessus de l'EMA 50 ; ${fluxVolume("fort", "1.5")} — ${RESERVE_FILTRE}`
    );
    expect(r.annotations?.labels?.[0]?.texte).toBe("Achat fort");
    // Filtre sans donnée de flux (forex) : aucun achat possible, et rien d'inventé.
    const sansVolume = candles.map((c) => ({ ...c, volume: 0 }));
    expect(computeIndicator(stratAxis, sansVolume, { ...EMA50, filtreFlux: true }).annotations).toBeUndefined();
    // Désactivé (défaut) : lecture v2 au littéral.
    expect(resume(candles, { ...EMA50, filtreFlux: false })).toBe("60▲ 88▼ 107▲ 139▼ 280▲");
  });
});

describe("stratAxis — forts achats et fortes ventes", () => {
  // Série déclinante (close toujours sous l'EMA 200 : aucun achat, donc aucun signal) ;
  // un pic de volume ×50 toutes les 5 bougies, corps baissier (open > close).
  const n = 500;
  const declin: Candle[] = Array.from({ length: n }, (_v, i) => {
    const c = 1000 - i * 0.5 + (i % 3) * 0.1;
    return { time: i * 3_600_000, open: c + 0.2, high: c + 1, low: c - 1, close: c, volume: i % 5 === 0 ? 50 : 1 };
  });

  it("marque les pics ≥ seuilGros × volume moyen, au plus MAX_GROS_AXIS récents, jamais la dernière bougie ; sans delta taker : « non mesurée »", () => {
    const res = computeIndicator(stratAxis, declin, {});
    const gros = grosDe(res);
    expect(res.annotations?.marqueurs?.length).toBe(gros.length);
    expect(fluxAxis(declin, undefined, 20, 6)[300]?.rvol).toBeCloseTo(50 / 10.8, 12); // SMA 20 = (4×50 + 16)/20
    // Pics de 20 à 495 (le volume relatif n'existe qu'à partir de 19) : 96, les 60 derniers gardés.
    expect(gros.map((m) => m.idx)).toEqual(Array.from({ length: MAX_GROS_AXIS }, (_v, k) => 200 + 5 * k));
    expect(gros[0]).toEqual({
      idx: 200, valeur: declin[200]!.high, forme: "triangleBas", couleur: "--accent", cible: "prix",
      info: `AXIS forte vente — volume ×4.6, delta taker n.d., OI n.d. ; sens du corps de la bougie — ${NON_MESURE}`,
    });
    // Étiquettes : les trois plus récents seulement, au-dessus du plus haut pour une vente.
    expect(res.annotations?.labels).toEqual(
      [485, 490, 495].map((idx) => ({
        idx, valeur: declin[idx]!.high, texte: "Forte vente ×4.6", couleur: "--accent", cible: "prix", position: "dessus",
      }))
    );
    expect(MAX_LABELS_GROS).toBe(3);
  });

  it("grosMouvementsAxis : même liste que les marqueurs, sans cap, hors exclues et dernière bougie", () => {
    const flux = fluxAxis(declin, undefined, 20, 6);
    const tous = grosMouvementsAxis(declin, flux, 3, new Set());
    expect(tous.map((g) => g.idx)).toEqual(Array.from({ length: 96 }, (_v, k) => 20 + 5 * k));
    expect(tous.every((g) => g.sens === -1)).toBe(true);
    expect(grosMouvementsAxis(declin, flux, 3, new Set([300, 305])).map((g) => g.idx)).not.toContain(300);
    const finPic = declin.map((c, i) => (i === n - 1 ? { ...c, volume: 50 } : c));
    expect(grosMouvementsAxis(finPic, fluxAxis(finPic, undefined, 20, 6), 3, new Set()).some((g) => g.idx === n - 1)).toBe(false);
    expect(grosMouvementsAxis(declin, flux, 5, new Set())).toEqual([]);
  });

  it("delta taker marqué : sens et point d'ancrage suivent le delta, pas le corps ; infobulle au statut mesuré", () => {
    const avecTaker = declin.map((c, i) => (i === 300 ? { ...c, buyVolume: 40, sellVolume: 10 } : c));
    const gros = grosDe(computeIndicator(stratAxis, avecTaker, {}));
    expect(gros.find((m) => m.idx === 300)).toEqual({
      idx: 300, valeur: declin[300]!.low, forme: "triangleHaut", couleur: "--accent", cible: "prix",
      info: `AXIS fort achat — volume ×4.6, delta taker +60 %, OI n.d. ; sens du delta taker — ${MESURE_FORT_ACHAT}`,
    });
    const recent = declin.map((c, i) => (i === 495 ? { ...c, buyVolume: 40, sellVolume: 10 } : c));
    expect(computeIndicator(stratAxis, recent, {}).annotations?.labels?.at(-1)).toEqual({
      idx: 495, valeur: declin[495]!.low, texte: "Fort achat ×4.6", couleur: "--accent", cible: "prix", position: "dessous",
    });
  });

  it("forte vente à delta taker : formulation mesurée ; delta sous 10 % : sens du corps, mais population mesurée", () => {
    const vendeur = declin.map((c, i) => (i === 300 ? { ...c, buyVolume: 10, sellVolume: 40 } : i === 305 ? { ...c, buyVolume: 26, sellVolume: 24 } : c));
    const gros = grosDe(computeIndicator(stratAxis, vendeur, {}));
    expect(gros.find((m) => m.idx === 300)?.info).toBe(
      `AXIS forte vente — volume ×4.6, delta taker -60 %, OI n.d. ; sens du delta taker — ${MESURE_FORTE_VENTE}`
    );
    expect(gros.find((m) => m.idx === 305)?.info).toBe(
      `AXIS forte vente — volume ×4.6, delta taker +4 %, OI n.d. ; sens du corps de la bougie — ${MESURE_FORTE_VENTE}`
    );
    // Les autres pics, sans delta taker, restent « non mesurés ».
    expect(gros.find((m) => m.idx === 310)?.info?.endsWith(NON_MESURE)).toBe(true);
  });

  it("doji sans delta : indécis, pas de marqueur ; dernière bougie : exclue ; seuil réglable", () => {
    const doji = declin.map((c, i) => (i === 300 ? { ...c, open: c.close } : c));
    expect(grosDe(computeIndicator(stratAxis, doji, {})).some((m) => m.idx === 300)).toBe(false);
    const finPic = declin.map((c, i) => (i === n - 1 ? { ...c, volume: 50 } : c));
    expect(grosDe(computeIndicator(stratAxis, finPic, {})).some((m) => m.idx === n - 1)).toBe(false);
    expect(grosDe(computeIndicator(stratAxis, declin, { seuilGros: 5 }))).toEqual([]);
  });

  it("fixture dorée : aucun pic ≥ ×3 ; à ×2 seul i=109 (×2,21) ; une bougie de signal n'est jamais doublée", () => {
    expect(grosDe(computeIndicator(stratAxis, candles, EMA50))).toEqual([]);
    expect(grosDe(computeIndicator(stratAxis, candles, { ...EMA50, seuilGros: 2 })).map((m) => m.idx)).toEqual([109]);
    // seuilGros 1,5 : 60 (×1,39) reste sous le seuil ; 73 et 283 sont des pics, aussi signaux avec le filtre flux.
    const avecFiltre = computeIndicator(stratAxis, candles, { ...EMA50, seuilGros: 1.5, filtreFlux: true });
    const idxGros = grosDe(avecFiltre).map((m) => m.idx);
    expect(idxGros).not.toContain(73);
    expect(idxGros).not.toContain(283);
    expect(grosDe(computeIndicator(stratAxis, candles, { ...EMA50, seuilGros: 1.5 })).map((m) => m.idx)).toContain(73);
  });
});

describe("stratAxis — infobulles par unité de temps (test du 8 octobre 2026)", () => {
  // Textes AU LITTÉRAL du résultat (scripts/axis/resultat-ut-2026-10-08.json) pour quelques
  // unités ; apps/web/src/chart/indicators.axisUnites.test.ts recoupe toutes les unités.
  const votes = "EMA 20/50 ▲, Supertrend ▲, DMI ▲, MACD ▲, RSI ▲, CMF ▲";
  // Pics de volume ×50 toutes les 5 bougies sur une série déclinante ; delta taker en 300 (achat)
  // et 305 (vente) seulement.
  const pics: Candle[] = Array.from({ length: 500 }, (_v, i) => {
    const c = 1000 - i * 0.5 + (i % 3) * 0.1;
    const taker = i === 300 ? { buyVolume: 40, sellVolume: 10 } : i === 305 ? { buyVolume: 10, sellVolume: 40 } : {};
    return { time: i * 3_600_000, open: c + 0.2, high: c + 1, low: c - 1, close: c, volume: i % 5 === 0 ? 50 : 1, ...taker };
  });
  const infoGros = (tf: Parameters<typeof textesAxis>[0], idx: number) =>
    grosDe(computeIndicator(stratAxis, pics, {}, undefined, tf)).find((m) => m.idx === idx)?.info;
  const ECHEC_1H =
    "fort achat / forte vente : test échoué à 12 bougies en 1h sur données jamais vues (42 alts, oct. 2023-oct. 2026) — forts achats suivis de -0.19 % en moyenne (45 % de hausses, p bilatérale = 0.0012), sans dépasser le coût aller-retour de 0.14 %, suite positive sur 17/42 actifs seulement — pas un signal validé";

  it("4h ou unité absente : formulations des tests 4h, inchangées", () => {
    expect(textesAxis(undefined)).toEqual({
      signaux: RESERVE, fortAchat: MESURE_FORT_ACHAT, forteVente: MESURE_FORTE_VENTE, qualification: QUALIFICATION,
    });
    expect(textesAxis("4h")).toEqual(textesAxis(undefined));
    expect(computeIndicator(stratAxis, candles, EMA50, undefined, "4h")).toEqual(computeIndicator(stratAxis, candles, EMA50));
    expect(infoGros("4h", 300)).toBe(`AXIS fort achat — volume ×4.6, delta taker +60 %, OI n.d. ; sens du delta taker — ${MESURE_FORT_ACHAT}`);
  });

  it("1h : signaux et forts mouvements au statut « test échoué » de l'unité ; sans delta taker, garde inchangée", () => {
    expect(computeIndicator(stratAxis, candles, EMA50, undefined, "1h").annotations?.marqueurs?.[0]?.info).toBe(
      `AXIS achat — score +6/6 : ${votes} ; close au-dessus de l'EMA 50 ; ` +
        "flux ordinaire (volume ×1.4, delta taker n.d., OI n.d. ; qualification descriptive, non mesurée en 1h) — " +
        "en 1h : test échoué sur données jamais vues (42 alts, oct. 2023-oct. 2026) — expectancy nette ≤ 0 aux coûts x1 ou x3, " +
        "timing non significatif, PnL positif sur 21/42 actifs seulement, expectancy négative sur une moitié de la période ; " +
        "expectancy nette +0.06 % par trade (coûts x1), timing p = 0.4804 — lecture indicative, pas un signal validé"
    );
    expect(infoGros("1h", 300)).toBe(`AXIS fort achat — volume ×4.6, delta taker +60 %, OI n.d. ; sens du delta taker — ${ECHEC_1H}`);
    expect(infoGros("1h", 305)).toBe(`AXIS forte vente — volume ×4.6, delta taker -60 %, OI n.d. ; sens du delta taker — ${ECHEC_1H}`);
    expect(infoGros("1h", 310)).toBe(`AXIS forte vente — volume ×4.6, delta taker n.d., OI n.d. ; sens du corps de la bougie — ${NON_MESURE}`);
  });

  it("1d : seul le timing échoue ; 1w : signaux non mesurés, forts achats échoués", () => {
    expect(textesAxis("1d").signaux).toBe(
      "en 1d : test échoué sur données jamais vues (40 alts, 2020-2026) — timing non significatif ; expectancy nette +35.76 % par trade (coûts x1), timing p = 0.1208 — lecture indicative, pas un signal validé"
    );
    expect(textesAxis("1w")).toEqual({
      signaux: "en 1w : non mesuré (trop peu de signaux sur données jamais vues : 2 trades clos) — lecture indicative, jamais une promesse",
      fortAchat: "fort achat / forte vente : test échoué à 12 bougies en 1w sur données jamais vues (40 alts, 2020-2026) — suite positive sur 16/40 actifs seulement — pas un signal validé",
      forteVente: "fort achat / forte vente : test échoué à 12 bougies en 1w sur données jamais vues (40 alts, 2020-2026) — suite positive sur 16/40 actifs seulement — pas un signal validé",
      qualification: "qualification descriptive, non mesurée en 1w",
    });
  });

  it("1M à 12M : historique trop court ; 5s et 15s (sans source) : générique", () => {
    expect(textesAxis("3M")).toEqual({
      signaux: "en 3M : non mesuré (historique trop court pour l'EMA 200 et l'amorce) — lecture indicative, jamais une promesse",
      fortAchat: "couche flux non mesurée en 3M (historique trop court)",
      forteVente: "couche flux non mesurée en 3M (historique trop court)",
      qualification: "qualification descriptive, non mesurée en 3M",
    });
    expect(textesAxis("15s")).toEqual({
      signaux: "en 15s : non mesuré — lecture indicative, jamais une promesse",
      fortAchat: "couche flux non mesurée en 15s",
      forteVente: "couche flux non mesurée en 15s",
      qualification: "qualification descriptive, non mesurée en 15s",
    });
  });

  it("filtre flux : sa réserve dans toutes les unités ; le calcul ne dépend jamais de l'unité", () => {
    const filtre = computeIndicator(stratAxis, candles, { ...EMA50, filtreFlux: true }, undefined, "1d");
    expect(filtre.annotations?.marqueurs?.[0]?.info?.endsWith(`non mesurée en 1d) — ${RESERVE_FILTRE}`)).toBe(true);
    const sansTextes = (tf: Parameters<typeof textesAxis>[0]) => {
      const r = computeIndicator(stratAxis, candles, EMA50, undefined, tf);
      return [r.series, r.annotations?.labels, r.annotations?.marqueurs?.map(({ info: _info, ...m }) => m)];
    };
    for (const tf of ["1s", "1h", "1w", "1M", "5s"] as const) expect(sansTextes(tf)).toEqual(sansTextes(undefined));
  });
});

describe("stop suiveur (v3)", () => {
  const haut = (n: number): boolean[] => new Array(n).fill(true);
  const SUFFIXE_3 = " ; stop suiveur 3 × ATR 14 : non mesuré (test du 8 octobre 2026 en cours)";
  const u: undefined = undefined;

  describe("stopAtr 0 : la v2 exacte", () => {
    it("fixture dorée : positions identiques à positionsAxis, stop entièrement indéfini", () => {
      const score = votesAxis(candles, DEFAUTS).map((v) => v?.reduce((a, b) => a + b, 0));
      const closes = closeOf(candles);
      const atr = rma(trueRange(candles), ATR_STOP_PERIODE);
      for (const periode of [50, 200]) {
        const auDessus = ema(closes, periode).map((t, i) => (t === undefined ? undefined : closes[i]! > t));
        const v3 = positionsStopAxis(score, auDessus, closes, atr, 5, 4, candles.length - 2, 0);
        expect(v3.pos).toEqual(positionsAxis(score, auDessus, 5, 4, candles.length - 2));
        expect(v3.stop.every((s) => s === undefined)).toBe(true);
        expect(v3.raisons.size).toBe(periode === 50 ? 2 : 0);
        expect([...v3.raisons.values()].every((r) => r === "score")).toBe(true);
      }
    });

    it("20 séries aléatoires à graine (scores indéfinis, tendance indéfinie, fin < n−1) : positions identiques", () => {
      // mulberry32 : générateur déterministe, le même que les campagnes.
      const alea = (graine: number) => () => {
        graine = (graine + 0x6d2b79f5) | 0;
        let t = Math.imul(graine ^ (graine >>> 15), 1 | graine);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      for (let g = 1; g <= 20; g++) {
        const r = alea(20261008 + g);
        const n = 200 + Math.floor(r() * 300);
        const score = Array.from({ length: n }, () => (r() < 0.1 ? undefined : Math.round(r() * 12) - 6));
        const auDessus = Array.from({ length: n }, () => (r() < 0.1 ? undefined : r() < 0.6));
        const closes = Array.from({ length: n }, () => 50 + r() * 100);
        const atr = Array.from({ length: n }, (_v, i) => (i < 14 ? undefined : 1 + r() * 5));
        const fin = n - 2 - Math.floor(r() * 5);
        const v3 = positionsStopAxis(score, auDessus, closes, atr, 5, 4, fin, 0);
        expect(v3.pos, `graine ${g}`).toEqual(positionsAxis(score, auDessus, 5, 4, fin));
        expect(v3.stop.every((s) => s === undefined), `graine ${g}`).toBe(true);
        // Toute sortie est un passage 1 → 0, par score.
        for (const [i, raison] of v3.raisons) {
          expect(raison).toBe("score");
          expect([v3.pos[i - 1], v3.pos[i]]).toEqual([1, 0]);
        }
      }
    });

    it("scores indéfinis au milieu, fin : mêmes reports que positionsAxis", () => {
      const score = [undefined, 3, 5, undefined, undefined, -6, -6, 2, 5, undefined, 0];
      const closes = score.map((_s, i) => 100 + i);
      const atr = score.map(() => 2);
      const v3 = positionsStopAxis(score, haut(11), closes, atr, 5, 4, 8, 0);
      expect(v3.pos).toEqual(positionsAxis(score, haut(11), 5, 4, 8));
      expect(v3.pos).toEqual([undefined, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1]);
      expect(v3.stop.every((s) => s === undefined)).toBe(true);
    });

    it("chart : le paramètre explicite 0 et son absence donnent le même résultat, série stop vide", () => {
      for (const params of [EMA50, {}, { ...EMA50, seuil: 4 }, { ...EMA50, filtreFlux: true }]) {
        const implicite = computeIndicator(stratAxis, candles, params);
        expect(computeIndicator(stratAxis, candles, { ...params, stopAtr: 0 })).toEqual(implicite);
        expect(implicite.series.stop).toHaveLength(candles.length);
        expect(implicite.series.stop?.every((s) => s === undefined)).toBe(true);
      }
      // Les textes 4h ne mentionnent pas le stop.
      const res = computeIndicator(stratAxis, candles, EMA50);
      expect(res.annotations?.marqueurs?.every((m) => !m.info?.includes("stop"))).toBe(true);
      expect(res.annotations?.labels?.map((l) => l.texte)).toEqual(["Achat", "Vente -0.50 %", "Achat", "Vente -1.86 %", "Achat"]);
    });
  });

  describe("mécanique sur une série construite", () => {
    // seuil 5, vente ≤ −4, stop 2 × ATR. Entrée à 1 (close 100, ATR 5 → niveau 90) ; le plus
    // haut close 104 (i=2) porte le niveau à 94 ; il n'y redescend ni quand le close recule
    // (i=3) ni quand l'ATR grandit (i=4) ; i=5 : close = niveau, pas de sortie ; i=6 : close
    // 93,9 < 94 → stop. 7-8 : achat vrai mais désarmé ; 9 : achat faux → armé ; 10 : entrée
    // (niveau 92) ; 11 : score −4 ET close 80 < 92 → raison « score », réarmé aussitôt ;
    // 12 : réentrée (niveau 81) ; 13 : score indéfini → reporté ; 14 : niveau 88.
    const score = [3, 5, 4, 2, 1, 2, 2, 6, 6, 3, 5, -4, 5, undefined, 1, -6];
    const closes = [99, 100, 104, 102, 103, 94, 93.9, 95, 96, 95, 96, 80, 85, 86, 90, 10];
    const atr = [5, 5, 5, 5, 8, 8, 8, 2, 2, 2, 2, 2, 2, 2, 1, 1];
    const v3 = positionsStopAxis(score, haut(16), closes, atr, 5, 4, 14, 2);

    it("niveau initial = close − k × ATR, cliquet, sortie à la première clôture strictement sous le niveau précédent", () => {
      expect(v3.pos).toEqual([0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1]);
      expect(v3.stop).toEqual([undefined, 90, 94, 94, 94, 94, undefined, undefined, undefined, undefined, 92, undefined, 81, 81, 88, 88]);
      expect([...v3.raisons]).toEqual([[6, "stop"], [11, "score"]]);
    });

    it("réarmement après un stop : pas de réachat tant que la condition d'achat n'est pas redevenue fausse", () => {
      expect(v3.pos.slice(7, 11)).toEqual([0, 0, 0, 1]);
      // Sans la bougie 9 (achat faux), l'achat n'aurait jamais lieu.
      const sansRepit = positionsStopAxis(score.map((s, i) => (i === 9 ? 6 : s)), haut(16), closes, atr, 5, 4, 14, 2);
      expect(sansRepit.pos.slice(6, 11)).toEqual([0, 0, 0, 0, 0]);
    });

    it("coexistence : score ≤ −seuilVente et close < stop à la même bougie → raison « score », réentrée dès la bougie suivante", () => {
      expect(closes[11]).toBeLessThan(v3.stop[10]!);
      expect(v3.raisons.get(11)).toBe("score");
      expect(v3.pos[12]).toBe(1);
      // Le même close sans retournement du score sort par stop et exige le réarmement.
      const parStop = positionsStopAxis(score.map((s, i) => (i === 11 ? 0 : s)), haut(16), closes, atr, 5, 4, 14, 2);
      expect(parStop.raisons.get(11)).toBe("stop");
      expect(parStop.pos[12]).toBe(0);
    });

    it("après `fin`, la position et le niveau en vigueur sont reportés, jamais décidés", () => {
      expect(score[15]).toBe(-6);
      expect(v3.pos[15]).toBe(1);
      expect(v3.stop[15]).toBe(88);
    });

    it("ATR indéfini à l'entrée : aucun niveau tant qu'il manque, le stop prend quand il apparaît", () => {
      const tardif = positionsStopAxis([3, 5, 2, 2, 2], haut(5), [100, 100, 60, 100, 97], [undefined, undefined, undefined, 1, 1], 5, 4, 4, 2);
      expect(tardif.pos).toEqual([0, 1, 1, 1, 0]);
      expect(tardif.stop).toEqual([undefined, undefined, undefined, 98, undefined]);
      expect(tardif.raisons.get(4)).toBe("stop");
    });

    it("exemple du manifeste à 3 × ATR : niveau à l'entrée, relevé par le plus haut close, franchi", () => {
      const v = positionsStopAxis([3, 5, 2, 2], haut(4), [100, 100, 105, 90.9], [1, 1, 1, 1], 5, 4, 3, 3);
      expect(v.stop).toEqual([undefined, 97, 102, undefined]);
      expect(v.pos).toEqual([0, 1, 1, 0]);
    });
  });

  describe("fixture dorée avec stopAtr 3 (EMA de tendance 50)", () => {
    const res = computeIndicator(stratAxis, candles, { ...EMA50, stopAtr: 3 });
    const stop = res.series.stop ?? [];
    const prixSignal = res.series.prixSignal ?? [];

    it("signaux : la vente 139 devient un stop à 137 ; les ▲ ne changent pas ; alternance", () => {
      expect(resume(candles, { ...EMA50, stopAtr: 3 })).toBe("60▲ 88▼ 107▲ 137▼ 280▲");
      expect(res.annotations?.labels?.map((l) => l.texte)).toEqual(["Achat", "Vente -0.50 %", "Achat", "Stop fort -0.78 %", "Achat"]);
      expect((candles[137]!.close / candles[107]!.close - 1) * 100).toBeCloseTo(-0.78, 2);
      const formes = res.annotations?.marqueurs?.map((m) => m.forme) ?? [];
      formes.forEach((f, k) => expect(f).toBe(k % 2 === 0 ? "triangleHaut" : "triangleBas"));
    });

    it("▼ par stop : étiquette « Stop », infobulle nommant le niveau franchi (stop de la bougie précédente)", () => {
      const m = res.annotations?.marqueurs?.find((x) => x.idx === 137);
      expect(stop[136]).toBeCloseTo(61016.78, 2);
      expect(candles[137]!.close).toBeLessThan(stop[136]!);
      expect(candles[136]!.close).toBeGreaterThanOrEqual(stop[135]!);
      expect(m).toEqual({
        idx: 137, valeur: candles[137]!.high, forme: "triangleBas", couleur: "--down", cible: "prix",
        info:
          "AXIS stop fort — score -2/6 : EMA 20/50 ▲, Supertrend ▲, DMI ▼, MACD ▼, RSI ▼, CMF ▼ ; " +
          "close sous le stop suiveur (61016.78) ; -0.78 % depuis l'achat (hors frais) ; " +
          `${fluxVolume("fort", "1.6")} — ${RESERVE}${SUFFIXE_3}`,
      });
      expect(res.annotations?.labels?.[3]).toEqual({
        idx: 137, valeur: candles[137]!.high, texte: "Stop fort -0.78 %", couleur: "--down", cible: "prix", position: "dessus",
      });
      // La vente par score garde ses textes, le suffixe du stop en plus.
      const vente = res.annotations?.marqueurs?.find((x) => x.idx === 88);
      expect(vente?.info).toBe(
        "AXIS vente — score -4/6 : EMA 20/50 ▲, Supertrend ▼, DMI ▼, MACD ▼, RSI ▼, CMF ▼ ; -0.50 % depuis l'achat (hors frais) ; " +
          `${fluxVolume("ordinaire", "1.1")} — ${RESERVE}${SUFFIXE_3}`
      );
      expect(res.annotations?.marqueurs?.[0]?.info?.endsWith(`close au-dessus de l'EMA 50 ; ${fluxVolume("ordinaire", "1.4")} — ${RESERVE}${SUFFIXE_3}`)).toBe(true);
    });

    it("série stop : définie exactement pendant les positions (sauf la bougie de sortie), ≤ close à l'entrée, jamais décroissante", () => {
      const atr = rma(trueRange(candles), ATR_STOP_PERIODE);
      const positions: Array<[de: number, a: number]> = [[60, 87], [107, 136], [280, 299]];
      const attendu = new Array(candles.length).fill(false);
      for (const [de, a] of positions) for (let i = de; i <= a; i++) attendu[i] = true;
      expect(stop.map((s) => s !== undefined)).toEqual(attendu);
      expect(prixSignal.map((p) => p !== undefined)).toEqual(attendu);
      for (const [de, a] of positions) {
        expect(stop[de]).toBeCloseTo(candles[de]!.close - 3 * atr[de]!, 8);
        expect(stop[de]!).toBeLessThanOrEqual(candles[de]!.close);
        let plusHaut = candles[de]!.close;
        for (let i = de + 1; i <= a; i++) {
          expect(stop[i]!, `i=${i}`).toBeGreaterThanOrEqual(stop[i - 1]!);
          plusHaut = Math.max(plusHaut, candles[i]!.close);
          // La dernière bougie (en formation, > fin) reporte le niveau sans le recalculer.
          expect(stop[i]!, `i=${i}`).toBeCloseTo(i === candles.length - 1 ? stop[i - 1]! : Math.max(stop[i - 1]!, plusHaut - 3 * atr[i]!), 8);
        }
      }
      expect(stop[60]).toBeCloseTo(59203.7047, 3);
    });

    it("stopAtr 1 : dix signaux, toutes les sorties par stop, réentrée après réarmement", () => {
      expect(resume(candles, { ...EMA50, stopAtr: 1 })).toBe("60▲ 62▼ 70▲ 78▼ 107▲ 113▼ 123▲ 132▼ 280▲ 291▼");
      const r = computeIndicator(stratAxis, candles, { ...EMA50, stopAtr: 1 });
      const ventes = (r.annotations?.marqueurs ?? []).filter((m) => m.forme === "triangleBas");
      expect(ventes.every((m) => m.info?.startsWith("AXIS stop") && m.info.includes("close sous le stop suiveur ("))).toBe(true);
      expect(r.annotations?.labels?.filter((l) => l.position === "dessus").map((l) => l.texte.split(" ")[0])).toEqual(new Array(5).fill("Stop"));
      // Score positif à la sortie : signe affiché, comme pour les achats.
      expect(ventes[0]?.info?.startsWith("AXIS stop — score +2/6")).toBe(true);
      expect(ventes[0]?.info).toContain(" ; stop suiveur 1 × ATR 14 : non mesuré (test du 8 octobre 2026 en cours)");
      // Le niveau nommé est celui de la bougie précédente, même quand le cliquet vient de monter (113).
      const stop = r.series.stop ?? [];
      expect(stop[111]).toBeCloseTo(61377.68, 2);
      expect(stop[112]).toBeCloseTo(61596.04, 2);
      for (const m of ventes) expect(m.info, `idx ${m.idx}`).toContain(`close sous le stop suiveur (${stop[m.idx - 1]!.toFixed(2)})`);
    });

    it("filtre flux et stop : la réserve du filtre garde la priorité, le texte du stop s'y ajoute", () => {
      const r = computeIndicator(stratAxis, candles, { ...EMA50, filtreFlux: true, stopAtr: 3 });
      expect(r.annotations?.marqueurs?.[0]?.info?.endsWith(` — ${RESERVE_FILTRE}${SUFFIXE_3}`)).toBe(true);
      expect(r.annotations?.marqueurs?.[0]?.info).not.toContain(RESERVE);
    });

    it("recoupement : la série stop du chart est celle de positionsStopAxis sur les séries exportées", () => {
      const score = votesAxis(candles, DEFAUTS).map((v) => v?.reduce((a, b) => a + b, 0));
      const closes = closeOf(candles);
      const auDessus = ema(closes, 50).map((t, i) => (t === undefined ? undefined : closes[i]! > t));
      const direct = positionsStopAxis(score, auDessus, closes, rma(trueRange(candles), 14), 5, 4, candles.length - 2, 3);
      expect(stop).toEqual(direct.stop);
      expect(prixSignal.map((p) => (p === undefined ? 0 : 1))).toEqual(direct.pos.map((p) => (p === 1 ? 1 : 0)));
      expect([...direct.raisons]).toEqual([[88, "score"], [137, "stop"]]);
    });
  });

  describe("anti-repaint et causalité avec stopAtr 3", () => {
    const params = { ...EMA50, stopAtr: 3 };
    const res = computeIndicator(stratAxis, candles, params);

    it("la dernière bougie ne décide jamais : ni le stop de 137 ni l'achat de 107", () => {
      const enFormation = computeIndicator(stratAxis, candles.slice(0, 138), params);
      expect(enFormation.annotations?.marqueurs?.map((m) => m.idx)).toEqual([60, 88, 107]);
      expect(enFormation.series.prixSignal?.[137]).toBe(candles[107]!.close);
      // Le niveau en vigueur est reporté sur la bougie en formation (ligne continue).
      expect(enFormation.series.stop?.[137]).toBe(enFormation.series.stop?.[136]);
      const confirme = computeIndicator(stratAxis, candles.slice(0, 139), params);
      expect(confirme.annotations?.marqueurs?.map((m) => m.idx)).toEqual([60, 88, 107, 137]);
      expect(confirme.series.stop?.slice(136)).toEqual([res.series.stop?.[136], undefined, undefined]);
    });

    it("un préfixe ou un futur altéré ne change jamais le passé (positions, stop, marqueurs)", () => {
      const complet = res.series;
      const marqueurs = res.annotations?.marqueurs ?? [];
      for (const k of [60, 88, 120, 137, 253, 280]) {
        const prefixe = computeIndicator(stratAxis, candles.slice(0, k + 1), params);
        expect(prefixe.series.prixSignal?.slice(0, k), `préfixe ${k}`).toEqual(complet.prixSignal?.slice(0, k));
        expect(prefixe.series.stop?.slice(0, k), `préfixe ${k}`).toEqual(complet.stop?.slice(0, k));
        expect(prefixe.annotations?.marqueurs ?? []).toEqual(marqueurs.filter((m) => m.idx < k));
        const alterees = candles.map((c, i) => (i <= k ? c : { ...c, high: 1e12 + i, low: 1, close: 1e12 - i, volume: 1e12 }));
        const futur = computeIndicator(stratAxis, alterees, params);
        expect(futur.series.prixSignal?.slice(0, k + 1), `futur ${k}`).toEqual(complet.prixSignal?.slice(0, k + 1));
        expect(futur.series.stop?.slice(0, k + 1), `futur ${k}`).toEqual(complet.stop?.slice(0, k + 1));
        expect((futur.annotations?.marqueurs ?? []).filter((m) => m.idx <= k)).toEqual(marqueurs.filter((m) => m.idx <= k));
      }
    });
  });

  describe("textesAxis(u, stopAtr)", () => {
    it("stopAtr 0 : identique à l'appel à un argument, dans toutes les unités", () => {
      for (const tf of [u, "4h", "1h", "1d", "1w", "3M", "15s"] as const) expect(textesAxis(tf, 0)).toEqual(textesAxis(tf));
    });

    it("stopAtr 3 : texte de base de l'unité + suffixe d'attente ; fortAchat, forteVente, qualification inchangés", () => {
      expect(textesAxis(u, 3)).toEqual({
        signaux: `${RESERVE}${SUFFIXE_3}`, fortAchat: MESURE_FORT_ACHAT, forteVente: MESURE_FORTE_VENTE, qualification: QUALIFICATION,
      });
      expect(textesAxis("4h", 3)).toEqual(textesAxis(u, 3));
      expect(textesAxis("1h", 3)).toEqual({
        ...textesAxis("1h"),
        signaux:
          "en 1h : test échoué sur données jamais vues (42 alts, oct. 2023-oct. 2026) — expectancy nette ≤ 0 aux coûts x1 ou x3, " +
          "timing non significatif, PnL positif sur 21/42 actifs seulement, expectancy négative sur une moitié de la période ; " +
          "expectancy nette +0.06 % par trade (coûts x1), timing p = 0.4804 — lecture indicative, pas un signal validé" +
          SUFFIXE_3,
      });
      expect(textesAxis("3M", 3).signaux).toBe(
        "en 3M : non mesuré (historique trop court pour l'EMA 200 et l'amorce) — lecture indicative, jamais une promesse" + SUFFIXE_3
      );
      // Multiplicateur sans zéro inutile.
      expect(textesAxis(u, 2.5).signaux).toBe(`${RESERVE} ; stop suiveur 2.5 × ATR 14 : non mesuré (test du 8 octobre 2026 en cours)`);
      expect(textesAxis(u, 4).signaux.endsWith("stop suiveur 4 × ATR 14 : non mesuré (test du 8 octobre 2026 en cours)")).toBe(true);
    });

    it("le chart transmet le réglage : infobulle 1h avec stop 3", () => {
      const r = computeIndicator(stratAxis, candles, { ...EMA50, stopAtr: 3 }, undefined, "1h");
      expect(r.annotations?.marqueurs?.[0]?.info?.endsWith(`non mesurée en 1h) — ${textesAxis("1h", 3).signaux}`)).toBe(true);
    });
  });
});
