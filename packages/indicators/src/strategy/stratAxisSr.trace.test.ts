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
import {
  ALPHA_ZONE_CASSEE,
  alphaZoneForte,
  ecartBordZone,
  fortesProchesAxis,
  stratAxisSr,
  zonesSrAxis,
  zonesTraceesAxis,
  type PisteZoneSrAxis,
} from "./stratAxisSr";
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
/** Signaux confirmés (▲/▼ pleins) : ni creux, ni forts mouvements (`--accent`), ni retournements ↺ (`--text-dim`). */
const signauxConfirmes = (res: IndicatorResult): MarqueurAnnotation[] =>
  (res.annotations?.marqueurs ?? []).filter((m) => m.creux !== true && m.couleur !== "--accent" && m.couleur !== "--text-dim");
const somme = (serie: Array<number | undefined> | undefined): number => (serie ?? []).reduce<number>((a, v) => a + (v ?? 0), 0);

const defaut = calculer(btc);

// Infobulle d'une zone (demande du 11 novembre 2026) : l'essentiel d'abord (rôle, forte ou faible, touches, écart du
// cours au bord de la zone), puis le détail d'avant, puis l'âge du dernier pivot confirmé et de la dernière réaction.
const TEXTE_ZONE_SUPPORT =
  "AXIS support fort · 5 touches · bord à -1.3 % — [75626.55 – 76601.83] (niveau 76114.19, -1.89 % du cours) — 2 rejets sur volume fort — touches comptées sur 3000 bougies — dernier pivot confirmé il y a 2 bougies ; dernière réaction il y a 11 bougies";
const TEXTE_ZONE_RESISTANCE =
  "AXIS résistance forte · 12 touches · bord à +10.0 % — [85314.76 – 86430.38] (niveau 85872.57, +10.69 % du cours) — 7 rejets sur volume fort, polarité inversée — touches comptées sur 3000 bougies — dernier pivot confirmé ou inversion il y a 183 bougies ; dernière réaction il y a 149 bougies";
/** Tête d'une infobulle de zone : ce qui précède les bornes. Au téléphone, la ligne est coupée vers le 55e caractère. */
const teteZone = (info: string | undefined): string => (info ?? "").split(" — [")[0] ?? "";
// Écart : une décimale, deux sous 0,1 % (jamais « +0.0 % » hors de la zone).
const TETE_ZONE = /^AXIS (support (fort|faible)|résistance (forte|faible)) · \d+ touches? · (bord à [+-]\d+\.\d{1,2} %|dans la zone)$/;
/** Réserve des signaux précoces, en tête du texte : l'infobulle coupe la ligne au bord du graphe, jamais son début. */
const TETE_PRECOCE = "AXIS S/R signal précoce non mesuré — lecture indicative, jamais une promesse — ";
const TEXTE_REACTION_2733 =
  "AXIS S/R signal précoce non mesuré — lecture indicative, jamais une promesse — réaction sur support fort [75592.65 – 76529.83] — 4 touches, 2 rejets sur volume fort ; la bougie est entrée dans la zone et a clôturé au-dessus";

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
    expect(rubans[8]!.info?.startsWith("AXIS résistance faible · 2 touches · bord à +1.7 % — [78917.30 – 79672.11]")).toBe(true);
    expect(rubans[9]!.info?.startsWith("AXIS support faible · 2 touches · bord à -2.7 % — [74552.38 – 75480.41]")).toBe(true);
    for (const r of rubans.slice(8, 12)) expect(r.alpha).toBe(0);
    for (const r of rubans.slice(12)) {
      expect(r.alpha).toBe(ALPHA_ZONE_CASSEE);
      expect(r.info).toBeUndefined();
      expect(r.bas).toHaveLength(r.hauts.length);
    }
    expect(ALPHA_ZONE_CASSEE).toBe(0.09);
    expect(rubans[12]!.deIdx + rubans[12]!.hauts.length - 1).toBe(2986);
  });

  it("infobulle d'une zone : rôle, forte ou faible, touches et écart du cours au bord dans les 55 premiers caractères, pour les 12 zones actives", () => {
    const sr = zonesBtc(5, 0.5, 6);
    const close = btc[2999]!.close;
    const { fortes, faibles } = zonesTraceesAxis(sr.pistes, close, 4, 6);
    const zones = [...fortes, ...faibles].map((p) => p.zone);
    const infos = (defaut.annotations?.rubans ?? []).slice(0, 12).map((r) => r.info);
    expect(zones).toHaveLength(12);
    zones.forEach((z, k) => {
      const tete = teteZone(infos[k]);
      const support = z.nature === "support";
      expect(tete, tete).toMatch(TETE_ZONE);
      expect(tete.length, tete).toBeLessThanOrEqual(55);
      // Redérivé ici : le bord tourné vers le cours est la borne haute d'un support, la borne basse d'une résistance.
      const bord = ((support ? z.haut : z.bas) / close - 1) * 100;
      const accord = k < 8 ? (support ? "fort" : "forte") : "faible";
      expect(tete).toBe(
        `AXIS ${support ? "support" : "résistance"} ${accord} · ${z.touches} touches · bord à ${bord > 0 ? "+" : ""}${bord.toFixed(1)} %`
      );
      // Le détail d'avant suit la tête, sans répéter les touches.
      expect(infos[k]).toContain(` — [${z.bas.toFixed(2)} – ${z.haut.toFixed(2)}] (niveau ${z.niveau.toFixed(2)}, `);
      expect(infos[k]).toContain(" — touches comptées sur 3000 bougies — dernier pivot confirmé");
    });
    expect(teteZone(TEXTE_ZONE_SUPPORT)).toHaveLength(45);
    expect(teteZone(TEXTE_ZONE_RESISTANCE)).toHaveLength(51);
  });

  it("infobulle d'une zone : âge du dernier pivot confirmé (ou de l'inversion) et de la dernière réaction, en bougies ; jamais « dernière touche », aucun pourcentage de réussite", () => {
    const sr = zonesBtc(5, 0.5, 6);
    const { fortes, faibles } = zonesTraceesAxis(sr.pistes, btc[2999]!.close, 4, 6);
    const infos = (defaut.annotations?.rubans ?? []).slice(0, 12).map((r) => r.info ?? "");
    // Dernière réaction de chaque zone, redérivée des réactions du moteur (par idx croissant).
    const reaction = new Map<number, number>();
    for (const r of sr.reactions) reaction.set(r.zone.id, r.idx);
    fortes.forEach(({ zone: z }, k) => {
      const pivot = `dernier pivot confirmé${z.inversions > 0 ? " ou inversion" : ""} il y a ${2999 - z.dernierIdx} bougies`;
      const r = reaction.get(z.id);
      const fin = r === undefined ? "aucune réaction" : `dernière réaction il y a ${2999 - r} bougies`;
      expect(infos[k]!.endsWith(` — ${pivot} ; ${fin}`), infos[k]).toBe(true);
    });
    // Les deux résistances fortes « oubliées » du cas de référence : confirmées il y a 1 711 et 2 124 bougies, sans réaction.
    expect(infos[6]!.endsWith(" — dernier pivot confirmé il y a 1711 bougies ; aucune réaction")).toBe(true);
    expect(infos[7]!.endsWith(" — dernier pivot confirmé ou inversion il y a 2124 bougies ; aucune réaction")).toBe(true);
    // « R forte · 12 » : le pivot date de 2 816, la réaction de 2 850 ; `dernierIdx` n'est pas une touche.
    expect([fortes[1]!.zone.dernierIdx, reaction.get(fortes[1]!.zone.id)]).toEqual([2816, 2850]);
    // Une zone faible n'a jamais été forte : le moteur ne lui connaît aucune réaction, l'infobulle n'en parle pas.
    faibles.forEach(({ zone: z }, k) => {
      expect(reaction.has(z.id)).toBe(false);
      expect(infos[8 + k]!.endsWith(`dernier pivot confirmé${z.inversions > 0 ? " ou inversion" : ""} il y a ${2999 - z.dernierIdx} bougies`), infos[8 + k]).toBe(true);
      expect(infos[8 + k]).not.toContain("réaction");
    });
    for (const info of infos) {
      expect(info).not.toContain("dernière touche");
      // Deux pourcentages seulement, deux écarts de prix : celui du bord et celui du niveau.
      expect(info.match(/%/g)).toHaveLength(2);
    }
  });

  it("infobulle d'une zone : le cours dans la bande d'une zone forte se lit « dans la zone », support (2 984) comme résistance (2 983)", () => {
    // Préfixes clos du cas de référence : à 2 984, le close (80 170,02) est dans la bande [79 616,59 – 80 465,81]
    // d'une zone forte, au-dessus de son niveau (support) ; à 2 983 (79 861,89), au-dessous (résistance).
    for (const [k, role] of [[2984, "support fort"], [2983, "résistance forte"]] as const) {
      const infos = (calculer(btc.slice(0, k + 1)).annotations?.rubans ?? []).map((r) => r.info ?? "");
      const dedans = infos.filter((info) => teteZone(info).endsWith(" · dans la zone"));
      expect(dedans, String(k)).toHaveLength(1);
      expect(teteZone(dedans[0]), String(k)).toMatch(new RegExp(`^AXIS ${role} · \\d+ touches · dans la zone$`));
      expect(dedans[0]).toContain(" — [79616.59 – 80465.81] (niveau 80041.20, ");
    }
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

  // Repris le 11 novembre 2026 : 14 étiquettes au lieu de 12. Le support fort et la résistance forte les plus proches
  // portent une seconde ligne, l'écart du cours à leur bord ; les 12 étiquettes d'avant gardent texte, ordre et valeur.
  it("étiquettes de zone : 12 au bord droit (dernière bougie), fortes puis faibles, après les étiquettes des signaux ; une seconde ligne sous les deux zones fortes les plus proches", () => {
    const labels = defaut.annotations?.labels ?? [];
    const droite = labels.filter((l) => l.ancrageX === "droite");
    expect(droite).toHaveLength(14);
    expect(droite.every((l) => l.idx === 2999 && l.cible === "prix")).toBe(true);
    expect(droite.map((l) => l.texte)).toEqual([
      "S fort · 5",
      "-1.3 %",
      "R forte · 12",
      "+10.0 %",
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
    expect(droite[2]).toMatchObject({ couleur: "--down" });
    expect(labels.slice(-14)).toEqual(droite);
    // La seconde ligne suit son étiquette dans le tableau, à la même valeur et de la même couleur : le rendu, qui
    // trie par ordonnée sans changer l'ordre des égaux, la pose 11 px dessous (annotationsPane.ts).
    expect(droite[1]).toEqual({ ...droite[0], texte: "-1.3 %" });
    expect(droite[3]).toEqual({ ...droite[2], texte: "+10.0 %" });
    // Écart redérivé : du close de la dernière bougie décidée à la borne haute du support, basse de la résistance.
    const close = btc[2999]!.close;
    expect(((76601.83 / close - 1) * 100).toFixed(1)).toBe("-1.3");
    expect(((85314.76 / close - 1) * 100).toFixed(1)).toBe("10.0");
    // La marge droite du graphe fait 80 px : 12 caractères au plus par ligne.
    for (const l of droite) expect(l.texte.length, l.texte).toBeLessThanOrEqual(12);
  });

  it("fortesProchesAxis : au plus un support fort et une résistance forte, les plus proches par le BORD ; à égalité, le premier reçu", () => {
    const piste = (id: number, nature: "support" | "resistance", bas: number, haut: number): PisteZoneSrAxis => ({
      zone: { id, nature, niveau: (bas + haut) / 2, bas, haut, demiLargeur: (haut - bas) / 2, deIdx: 0, confirmationIdx: 5, dernierIdx: 5, touches: 6, rejetsVolume: 0, inversions: 0, force: 6 },
      active: true,
      finIdx: 9,
      evolution: [{ idx: 5, bas, haut }],
    });
    // Cours 100. Support large [80 – 98] : niveau 89, bord à −2 %. Support étroit [93 – 95] : niveau 94, plus proche
    // par le niveau, mais bord à −5 %. C'est le large que le cours touchera d'abord.
    const large = piste(0, "support", 80, 98);
    const etroit = piste(1, "support", 93, 95);
    const dessus = piste(2, "resistance", 110, 112);
    const loin = piste(3, "resistance", 120, 121);
    expect(ecartBordZone(large.zone, 100)).toBeCloseTo(-2, 9);
    expect(ecartBordZone(etroit.zone, 100)).toBeCloseTo(-5, 9);
    expect(ecartBordZone(dessus.zone, 100)).toBeCloseTo(10, 9);
    // Rangées comme `zonesTraceesAxis` les rend, par proximité du niveau : l'étroit d'abord.
    expect(fortesProchesAxis([etroit, large, dessus, loin], 100)).toEqual([large, dessus]);
    // Cours dans la bande : écart indéfini, distance nulle, la zone est la plus proche de son rôle.
    const autour = piste(4, "support", 97, 101);
    expect(ecartBordZone(autour.zone, 100)).toBeUndefined();
    expect(fortesProchesAxis([etroit, large, autour], 100)).toEqual([autour]);
    // Égalité : deux supports dont la bande contient le cours ; le premier reçu est gardé.
    const autour2 = piste(5, "support", 96, 100.5);
    expect(fortesProchesAxis([autour2, autour], 100)).toEqual([autour2]);
    expect(fortesProchesAxis([], 100)).toEqual([]);
  });

  it("seconde ligne : « dans la zone » quand le cours est dans la bande de la zone forte la plus proche ; aucune sans zone forte", () => {
    // Préfixes clos 2 984 (support fort) et 2 983 (résistance forte) : le close est dans la bande [79 616,59 – 80 465,81].
    for (const [k, etiquette] of [[2984, "S fort"], [2983, "R forte"]] as const) {
      const droite = (calculer(btc.slice(0, k + 1)).annotations?.labels ?? []).filter((l) => l.ancrageX === "droite");
      const rang = droite.findIndex((l) => l.texte === "dans la zone");
      expect(rang, String(k)).toBeGreaterThan(0);
      expect(droite[rang - 1]!.texte.startsWith(`${etiquette} · `), String(k)).toBe(true);
      expect(droite[rang]).toEqual({ ...droite[rang - 1]!, texte: "dans la zone" });
      expect(droite[rang]!.valeur).toBeCloseTo(80041.2, 2);
      expect(droite.filter((l) => l.texte === "dans la zone")).toHaveLength(1);
      expect(droite.filter((l) => /^(dans la zone|[+-]\d+\.\d %)$/.test(l.texte)), String(k)).toHaveLength(2);
    }
    // Seuil 50 : aucune zone forte, donc aucune seconde ligne ; quatre étiquettes « faible ».
    const droite50 = (calculer(btc, { forceZoneForte: 50 }).annotations?.labels ?? []).filter((l) => l.ancrageX === "droite");
    expect(droite50.map((l) => l.texte)).toEqual(["faible", "faible", "faible", "faible"]);
  });

  it("seconde ligne : la bougie en formation n'est pas lue, l'écart reste celui de la dernière clôture décidée", () => {
    // Bougie en formation ajoutée, dont le prix s'effondre dans le support fort : l'étiquette est posée sur elle
    // (bord droit), mais l'écart est toujours lu au close de 2 999, dernière bougie décidée.
    const derniere = btc[2999]!;
    const enFormation: Candle = { ...derniere, time: derniere.time + 14_400_000, open: derniere.close, high: derniere.close, low: 76000, close: 76100, closed: false };
    const droite = (calculer([...btc, enFormation]).annotations?.labels ?? []).filter((l) => l.ancrageX === "droite");
    expect(droite.every((l) => l.idx === 3000)).toBe(true);
    expect(droite.slice(0, 4).map((l) => l.texte)).toEqual(["S fort · 5", "-1.3 %", "R forte · 12", "+10.0 %"]);
  });

  it("bougie en formation loin au-dessus (90 000) : tête, écart, âges des 12 infobulles et paire de zones à seconde ligne restent ceux du cas clos", () => {
    // À 90 000, au-dessus de deux résistances fortes, une lecture de la bougie en formation recalculerait chaque
    // écart en tête, et des âges comptés depuis la dernière bougie (au lieu de la dernière décidée) gagneraient
    // une bougie : ce test échoue dans les deux cas (contre-épreuves faites). La PAIRE de zones à seconde ligne,
    // elle, ne dépend pas du prix lu tant que les zones fortes ne se chevauchent pas (le support fort le plus haut
    // et la résistance forte la plus basse gagnent à tout prix) : sur ce cas, aucun préfixe ni aucun prix ne la
    // fait changer. Elle est vérifiée ici, mais lire le prix en formation dans son choix ne se verrait pas.
    const derniere = btc[2999]!;
    const enFormation: Candle = { ...derniere, time: derniere.time + 14_400_000, open: derniere.close, high: 90000, low: derniere.close, close: 90000, closed: false };
    const res = calculer([...btc, enFormation]);
    const infos = (r: IndicatorResult): string[] => (r.annotations?.rubans ?? []).flatMap((x) => (x.info === undefined ? [] : [x.info]));
    expect(infos(res)).toHaveLength(12);
    // Seule la profondeur change : la série compte une bougie de plus.
    expect(infos(res)).toEqual(infos(defaut).map((t) => t.replace("sur 3000 bougies", "sur 3001 bougies")));
    expect(infos(res)[0]).toBe(TEXTE_ZONE_SUPPORT.replace("sur 3000 bougies", "sur 3001 bougies"));
    const textes = (r: IndicatorResult): string[] => (r.annotations?.labels ?? []).filter((l) => l.ancrageX === "droite").map((l) => l.texte);
    expect(textes(res)).toEqual(textes(defaut));
    expect(textes(res).slice(0, 4)).toEqual(["S fort · 5", "-1.3 %", "R forte · 12", "+10.0 %"]);
  });

  it("cours à moins de 0,1 % du bord sans être dans la zone : l'écart s'écrit avec deux décimales, jamais « +0.0 % »", () => {
    // Préfixe clos 403 : close 111 511,55, borne basse de la résistance forte à 111 558,70, soit +0,04 %.
    const res = calculer(btc.slice(0, 404));
    const droite = (res.annotations?.labels ?? []).filter((l) => l.ancrageX === "droite");
    expect(droite.slice(0, 2).map((l) => l.texte)).toEqual(["R forte · 5", "+0.04 %"]);
    expect(((111558.7 / btc[403]!.close - 1) * 100).toFixed(2)).toBe("0.04");
    const tete = teteZone(res.annotations?.rubans?.[0]?.info);
    expect(tete).toBe("AXIS résistance forte · 5 touches · bord à +0.04 %");
    expect(tete.length).toBeLessThanOrEqual(55);
    // Aucun écart nul hors de la zone, ni au bord droit ni en tête d'infobulle, sur les trois préfixes relevés.
    for (const k of [403, 499, 618]) {
      const r = calculer(btc.slice(0, k + 1));
      const lus = [...(r.annotations?.labels ?? []).map((l) => l.texte), ...(r.annotations?.rubans ?? []).map((x) => teteZone(x.info))];
      expect(lus.filter((t) => /[+-]0\.0 %/.test(t)), String(k)).toEqual([]);
    }
    // À partir de 0,1 %, une décimale, comme avant.
    expect(droite.every((l) => l.texte.length <= 12)).toBe(true);
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
    expect(triangles.filter((m) => m.info?.startsWith(TETE_PRECOCE) !== true)).toEqual([]);

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
      /^AXIS S\/R signal précoce non mesuré — lecture indicative, jamais une promesse — réaction sur résistance forte \[\d+\.\d{2} – \d+\.\d{2}\] — 9 touches, 6 rejets sur volume fort, polarité inversée ; la bougie est entrée dans la zone et a clôturé au-dessous$/
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
      TETE_PRECOCE +
        "réaction sur résistance forte [78290.18 – 79077.88] — 4 touches, 0 rejet sur volume fort, polarité inversée ; " +
        "la bougie est entrée dans la zone et a clôturé au-dessous",
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

  it("signaux confirmés : le statut de mesure tient dans les 55 premiers caractères (4h : réserve de l'EMA 200 ; 1h : test échoué), la réserve entière reste à la fin", () => {
    const confirmes = signauxConfirmes(defaut);
    expect(confirmes.length).toBeGreaterThan(10);
    for (const m of confirmes) {
      expect(m.info?.slice(0, 55), m.info).toMatch(/^AXIS (achat|vente)( forte?)? — score [+-]\d\/6 · test 4h ≈ EMA 200 seule/);
      expect(m.info).toContain(" — test réussi sur données jamais vues (crypto 4h, 2017-2024), pas mieux qu'une EMA 200 seule sur 3/4 actifs — mesure passée, pas une promesse ; ");
    }
    const en1h = signauxConfirmes(computeIndicator(stratAxisSr, btc, {}, auxBtc, "1h"));
    expect(en1h.map((m) => m.idx)).toEqual(confirmes.map((m) => m.idx));
    for (const m of en1h) {
      expect(m.info?.slice(0, 55), m.info).toMatch(/^AXIS (achat|vente)( forte?)? — score [+-]\d\/6 · 1h : test échoué — /);
      expect(m.info).toContain(" — en 1h : test échoué sur données jamais vues (42 alts, oct. 2023-oct. 2026)");
    }
  });

  it("retournements ↺ cochés (IND-1) : 40 marqueurs gris de plus, après tous les autres ; signaux confirmés, triangles creux, forts mouvements et séries inchangés", () => {
    const avec = calculer(btc, { detecterRetournements: true });
    const gris = (avec.annotations?.marqueurs ?? []).filter((m) => m.couleur === "--text-dim");
    expect(gris).toHaveLength(40);
    expect(gris.every((m) => m.creux === undefined && m.info?.startsWith("AXIS ↺ signal précoce non mesuré — lecture indicative, jamais une promesse — "))).toBe(true);
    expect((avec.annotations?.marqueurs ?? []).filter((m) => m.couleur !== "--text-dim")).toEqual(defaut.annotations?.marqueurs);
    expect((avec.annotations?.marqueurs ?? []).slice(-40)).toEqual(gris);
    expect(signauxConfirmes(avec)).toEqual(signauxConfirmes(defaut));
    expect(creux(avec)).toEqual(creux(defaut));
    expect(avec.series).toEqual(defaut.series);
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
    // Écarts et âges ne dépendent pas de l'échelle des prix : même tête, même fin.
    expect(teteZone(res.annotations?.rubans?.[0]?.info)).toBe(teteZone(TEXTE_ZONE_SUPPORT));
    expect(res.annotations?.rubans?.[0]?.info?.endsWith(" — dernier pivot confirmé il y a 2 bougies ; dernière réaction il y a 11 bougies")).toBe(true);
  });

  it("forceZoneForte qui n'est pas un nombre fini (NaN, ±Infinity, texte, chaîne vide ou d'espaces, booléen) reçu sans résolution des réglages : repli sur 6, même résultat", () => {
    // `computeIndicator` remplace déjà un réglage qui n'est pas un nombre fini par son défaut (`resolveParams`) ; ici
    // `calc` est appelée directement, comme par un appelant qui ne résout pas les réglages. `Number("")`, `Number(" ")`
    // et `Number(false)` valent 0, `Number(true)` 1 : sans repli, toutes les zones seraient fortes.
    const ctx = { ...buildCalcContext(btc), aux: auxBtc, timeframe: "4h" as const };
    const avec = (forceZoneForte: number | string | boolean): IndicatorResult =>
      stratAxisSr.calc(btc, { ...resolveParams(stratAxisSr, {}), forceZoneForte }, ctx);
    const seuil6 = avec(6);
    expect(seuil6).toEqual(defaut);
    for (const v of [NaN, Infinity, -Infinity, "abc", "", " ", true, false]) expect(avec(v), JSON.stringify(v)).toEqual(seuil6);
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
