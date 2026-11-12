/**
 * @axiom/indicators — strategy/stratAxisSr.preAchat.test.ts
 *
 * Neuvième sortie d'AXIS S/R, `preAchat` (alertes A2, 12 novembre 2026), pour l'alerte « pré-signal
 * d'achat » : 1 si le pré-signal (`preSignalAxisSr`) est défini à la bougie close i, 0 sinon,
 * indéfinie sur la bougie en formation. Ajoutée EN FIN de liste : les huit séries existantes restent
 * identiques octet pour octet (empreintes FNV-1a 64 bits de leur JSON, relevées sur une copie du
 * `stratAxisSr.ts` de `main`, e98e707, calculée côte à côte avec celui du lot). Elle ne
 * dépend ni de `signauxPrecoces` ni de `maxZonesSr`. Causale : la valeur à i ne lit aucune bougie
 * plus récente (préfixes). Non mesurée.
 *
 * Cas de référence BTCUSDT 4h (3 000 bougies closes), réglages par défaut. Les décomptes sont des
 * fréquences sur des données déjà vues, sans valeur probante.
 */
import { describe, expect, it } from "vitest";
import type { Candle, IndicatorResult } from "@axiom/types";
import { buildCalcContext, computeIndicator, resolveParams } from "../engine";
import { preSignalAxisSr, stratAxisSr } from "./stratAxisSr";
import { bougiesBtcusdt4h } from "./fixtures/btcusdt4h";

const btc = bougiesBtcusdt4h();
type Reglages = Record<string, number | boolean | string>;
const refClose = (bougies: Candle[]) => ({ refClose: bougies.map((c) => c.close) });

/** Calcul complet, comme le graphe et le moteur des alertes ; `avecReference` : `refClose` = les closes de la série. */
const calculer = (bougies: Candle[], params: Reglages = {}, avecReference = true): IndicatorResult =>
  computeIndicator(stratAxisSr, bougies, params, avecReference ? refClose(bougies) : undefined, "4h");
/** Le pré-signal tel que le graphe le lit, réglages résolus comme le fait `computeIndicator`. */
const preSignal = (bougies: Candle[], params: Reglages = {}, avecReference = true): Array<number | undefined> =>
  preSignalAxisSr(bougies, resolveParams(stratAxisSr, params), {
    ...buildCalcContext(bougies),
    ...(avecReference ? { aux: refClose(bougies) } : {}),
    timeframe: "4h",
  });
/** FNV-1a 64 bits du JSON d'une série, en hexadécimal (16 caractères). */
function empreinte(serie: unknown): string {
  const texte = JSON.stringify(serie);
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < texte.length; i++) {
    h ^= BigInt(texte.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}
const enFormation = (bougies: Candle[]): Candle[] => [...bougies.slice(0, -1), { ...bougies[bougies.length - 1]!, closed: false }];

describe("stratAxisSr.preAchat — sortie du pré-signal pour l'alerte", () => {
  it("neuvième sortie, en fin de liste, masquée ; les huit premières inchangées", () => {
    expect(stratAxisSr.outputs.map((o) => o.key)).toEqual([
      "prixSignal", "stop", "etat", "score", "support", "resistance", "reactionSupport", "reactionResistance", "preAchat",
    ]);
    expect(stratAxisSr.outputs.at(-1)).toEqual({ key: "preAchat", name: "Pré-signal d'achat (non mesuré)", style: "line", masquee: true });
    expect(stratAxisSr.outputs.filter((o) => o.masquee === true)).toHaveLength(7);
  });

  it("les huit séries existantes sont identiques octet pour octet à celles de main (empreintes relevées avant l'ajout)", () => {
    // Relevées sur le code de e98e707 (sonde hors dépôt, mêmes calculs, unité 4h).
    const COEUR = {
      prixSignal: "26c629f114878cea",
      stop: "d48aa0876e72e625",
      etat: "19406b5620468c23",
      score: "78bf16fcdc55cb3b",
      support: "13d388a2ce4cf511",
      resistance: "d0fcfff5c748c31b",
    };
    const cas: Array<[string, IndicatorResult, Record<string, string>]> = [
      ["défaut, sans référence", calculer(btc, {}, false), { ...COEUR, reactionSupport: "682ab8cb53be0c7d", reactionResistance: "862e75df091c309d" }],
      ["défaut, référence = closes", calculer(btc), { ...COEUR, reactionSupport: "682ab8cb53be0c7d", reactionResistance: "862e75df091c309d" }],
      [
        "force 8, sans signaux précoces ni zones faibles, dernière bougie en formation",
        computeIndicator(stratAxisSr, enFormation(btc), { forceZoneForte: 8, signauxPrecoces: false, maxZonesSr: 0 }, refClose(btc), "4h"),
        { ...COEUR, reactionSupport: "1fde5a71d58985ce", reactionResistance: "64f8f2b60b2ea645" },
      ],
    ];
    for (const [nom, res, attendues] of cas) {
      const lues = Object.fromEntries(Object.keys(attendues).map((cle) => [cle, empreinte(res.series[cle])]));
      expect(lues, nom).toEqual(attendues);
    }
  });

  it("vaut 1 exactement là où preSignalAxisSr est défini, 0 ailleurs sur bougie close, avec et sans référence", () => {
    for (const avecReference of [true, false]) {
      const pre = preSignal(btc, {}, avecReference);
      const serie = calculer(btc, {}, avecReference).series.preAchat!;
      expect(serie).toHaveLength(3000);
      expect(serie).toEqual(pre.map((v) => (v === undefined ? 0 : 1)));
    }
    // Décomptes (données déjà vues) : 63 bougies avec la référence, 78 sans (régime non appliqué).
    expect(calculer(btc).series.preAchat!.filter((v) => v === 1)).toHaveLength(63);
    expect(calculer(btc, {}, false).series.preAchat!.filter((v) => v === 1)).toHaveLength(78);
  });

  it("indéfinie sur la bougie en formation, et seulement sur elle", () => {
    const res = computeIndicator(stratAxisSr, enFormation(btc), {}, refClose(btc), "4h");
    const serie = res.series.preAchat!;
    expect(serie[2999]).toBeUndefined();
    expect(serie.slice(0, 2999).every((v) => v === 0 || v === 1)).toBe(true);
    expect(serie.slice(0, 2999)).toEqual(calculer(btc.slice(0, 2999)).series.preAchat);
  });

  it("ne dépend ni de signauxPrecoces ni de maxZonesSr (le segment du graphe, lui, suit signauxPrecoces)", () => {
    const reference = calculer(btc).series.preAchat;
    const variantes: Reglages[] = [{ signauxPrecoces: false }, { maxZonesSr: 0 }, { signauxPrecoces: false, maxZonesSr: 0 }, { maxZonesSr: 12 }];
    for (const params of variantes) {
      expect(calculer(btc, params).series.preAchat, JSON.stringify(params)).toEqual(reference);
    }
  });

  it("causale par préfixe (indices 2 400 à 2 999) : la valeur à i ne lit aucune bougie plus récente", () => {
    const complete = calculer(btc).series.preAchat!;
    for (let i = 2400; i < 3000; i++) {
      const prefixe = btc.slice(0, i + 1);
      expect(calculer(prefixe).series.preAchat!.at(-1), `bougie ${i}`).toBe(complete[i]);
    }
  }, 300_000);

  it("causale par préfixe aussi sur des épisodes de pré-signal (indices 2 160 à 2 300)", () => {
    const complete = calculer(btc).series.preAchat!;
    // Les épisodes 2 165-2 168 et 2 277-2 288 sont dans la plage : elle n'est pas faite que de 0.
    expect(complete.slice(2160, 2301).filter((v) => v === 1).length).toBeGreaterThan(0);
    for (let i = 2160; i <= 2300; i++) {
      expect(calculer(btc.slice(0, i + 1)).series.preAchat!.at(-1), `bougie ${i}`).toBe(complete[i]);
    }
  }, 300_000);
});
