/**
 * @axiom/indicators — strategy/stratChampion.test.ts
 *
 * `stratChampion` est une recopie PARAMÉTRÉE de `positionDonchianTrailing`
 * (candidat `candDonchianTrailing`, `candidatsChampion.ts`) : mêmes cœurs,
 * même boucle, mêmes défauts (canal 20, atrLength 14, multAtr 3) — seules les
 * constantes figées deviennent des inputs. La garantie la plus forte pour ce
 * genre de def n'est donc PAS une dérivation à la main (Donchian+ATR trailing
 * stateful n'est pas traçable de tête sur un jeu réaliste) mais la PARITÉ
 * stricte avec la référence figée : on réutilise la fixture 400 bougies en
 * cinq régimes de `candidatsChampion.test.ts` (déjà PROUVÉE là-bas par
 * recomposition contre les cœurs, transitions figées 120/210/320) et on
 * vérifie que `stratChampion` avec les défauts de la campagne produit EXACTEMENT
 * la même série d'états, bougie par bougie, que `candDonchianTrailing`. Cette
 * égalité stricte détecte les dérives de traduction (ratchet retiré, formule
 * ATR différente, bornes de comparaison assouplies, etc. — vérifié
 * empiriquement : retirer le ratchet de `extreme` fait échouer cette égalité).
 *
 * En complément :
 *  - recomposition indépendante (cœurs importés directement) aux trois points
 *    de transition, exercée via `computeIndicator` pour couvrir aussi le
 *    câblage annotations/libelles (pas seulement les états bruts) ;
 *  - mutation-kill « les constantes sont bien devenues des inputs » : faire
 *    varier `canal`/`atrLength`/`multAtr` doit changer le comportement (une
 *    régression qui réintroduirait des littéraux 20/14/3 en dur passerait
 *    inaperçue sans ce test) ;
 *  - mutation-kill de l'ORDRE d'évaluation lui-même (trailing avant cassure) :
 *    une bougie d'ENTRÉE dont la mèche dépasse `multAtr` × ATR (balayage de
 *    mèche) pin le fait que le bloc trailing ne s'applique QU'À un `etat` déjà
 *    ±1 EN ENTRANT dans l'itération — sur cette même bougie, le bloc trailing
 *    est encore inerte (etat=0), donc la cassure ouvre et TIENT ; un mutant
 *    qui inverserait l'ordre (cassure puis trailing) ouvrirait la position
 *    PUIS la retesterait avec l'extrême et l'ATR fraîchement gonflés par la
 *    même bougie, et l'auto-tuerait aussitôt (vérifié empiriquement : réel →
 *    `etat=1` qui tient, mutant → `etat=0` sur la même bougie) ;
 *  - fixture dédiée, PETITE et intégralement recomposée contre les cœurs, qui
 *    PIN le quirk documenté en Task 6 : sortie trailing puis cassure directe
 *    du canal opposé sur la MÊME bougie → un seul événement « Sortie long +
 *    Entrée short » sans flat intermédiaire.
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { etatsStrategie } from "../utils-fabrique-strategie";
import { closeOf, highOf, lowOf, rma, rollingHighest, rollingLowest, trueRange } from "../utils";
import { CANDIDATS_CHAMPION } from "./candidatsChampion";
import { stratChampion } from "./stratChampion";

const DEFAUTS = { canal: 20, atrLength: 14, multAtr: 3 };

/**
 * Fixture IDENTIQUE à `candidatsChampion.test.ts` (cinq régimes enchaînés :
 * dents de scie → compression → tendance haussière → tendance baissière →
 * compression → reprise baissière). Reprise volontaire : c'est la fixture
 * déjà PROUVÉE dans ce fichier (transitions 120/210/320 dérivées contre les
 * cœurs), pas une nouvelle donnée à re-prouver ici.
 */
function fixture(): Candle[] {
  const out: Candle[] = [];
  let prix = 100;
  for (let i = 0; i < 400; i++) {
    let pas: number;
    let amp: number;
    if (i < 80) {
      pas = (i % 4 < 2 ? 1 : -1) * 1.5;
      amp = 0.8;
    } else if (i < 120) {
      pas = i % 2 === 0 ? 0.06 : -0.05;
      amp = 0.12;
    } else if (i < 200) {
      pas = 1.8 + (i % 3) * 0.3;
      amp = 2.0;
    } else if (i < 280) {
      pas = -(1.0 + (i % 3) * 0.2);
      amp = 1.4;
    } else if (i < 320) {
      pas = i % 2 === 0 ? 0.06 : -0.05;
      amp = 0.12;
    } else {
      pas = -(1.0 + (i % 3) * 0.2);
      amp = 1.4;
    }
    const open = prix;
    const close = prix + pas;
    out.push({
      time: 1_700_000_000_000 + i * 3_600_000,
      open,
      high: Math.max(open, close) + amp,
      low: Math.min(open, close) - amp,
      close,
      volume: 10 + (i % 7),
    });
    prix = close;
  }
  return out;
}

const CANDLES = fixture();

describe("stratChampion", () => {
  it("contrat : strategy/overlay, inputs propres (défauts de la campagne) + lignesTrades en dernier", () => {
    expect(stratChampion.category).toBe("strategy");
    expect(stratChampion.pane).toBe("overlay");
    expect(stratChampion.inputs.map((i) => i.key)).toEqual(["canal", "atrLength", "multAtr", "lignesTrades"]);
    const parDefaut = Object.fromEntries(stratChampion.inputs.map((i) => [i.key, i.default]));
    expect(parDefaut.canal).toBe(20);
    expect(parDefaut.atrLength).toBe(14);
    expect(parDefaut.multAtr).toBe(3);
  });

  it("avec les défauts de la campagne, reproduit EXACTEMENT candDonchianTrailing bougie par bougie", () => {
    const candidat = CANDIDATS_CHAMPION.find((c) => c.id === "candDonchianTrailing");
    expect(candidat).toBeDefined();
    const etatsCandidat = candidat!.position(CANDLES);
    const etatsDef = etatsStrategie("stratChampion", CANDLES, DEFAUTS);
    expect(etatsDef).toEqual(etatsCandidat);
    // Les trois transitions figées en Task 6 (candidatsChampion.test.ts), retrouvées ici :
    const transitions: string[] = [];
    for (let i = 1; i < etatsDef!.length; i++) {
      const prev = etatsDef![i - 1];
      const cur = etatsDef![i];
      if (prev !== undefined && cur !== undefined && prev !== cur) transitions.push(`${i}:${prev}->${cur}`);
    }
    expect(transitions).toEqual(["120:0->1", "210:1->0", "320:0->-1"]);
  });

  it("recomposition vs les cœurs : entrée long à 120 sur une VRAIE cassure du canal 20 précédent", () => {
    const r = computeIndicator(stratChampion, CANDLES, DEFAUTS);
    const hh = rollingHighest(highOf(CANDLES), 20);
    expect(closeOf(CANDLES)[120]!).toBeGreaterThan(hh[119]!);
    expect(closeOf(CANDLES)[119]!).toBeLessThanOrEqual(hh[118]!);

    const entree = r.annotations?.marqueurs?.find((m) => m.idx === 120);
    expect(entree).toEqual({
      idx: 120,
      valeur: expect.closeTo(98.2, 1),
      forme: "triangleHaut",
      couleur: "--up",
      cible: "prix",
      info: "Entrée long 102.00 — cassure du plus-haut Donchian 20 (canal des bougies précédentes)",
    });
  });

  it("recomposition vs les cœurs : sortie à 210 par le trailing (extrême − 3×ATR14), pas par le canal opposé", () => {
    const highs = highOf(CANDLES);
    const closes = closeOf(CANDLES);
    const ll = rollingLowest(lowOf(CANDLES), 20);
    const atr = rma(trueRange(CANDLES), 14);
    const extreme = (fin: number) => Math.max(...highs.slice(120, fin + 1));

    const trail210 = extreme(210) - 3 * atr[210]!;
    const trail209 = extreme(209) - 3 * atr[209]!;
    expect(closes[210]!).toBeLessThan(trail210); // déclenche le trailing
    expect(closes[209]!).toBeGreaterThanOrEqual(trail209); // pas encore à 209
    // Cette sortie n'est PAS une cassure du canal bas (elle en est loin) :
    expect(closes[210]!).toBeGreaterThan(ll[209]!);

    const r = computeIndicator(stratChampion, CANDLES, DEFAUTS);
    const sortie = r.annotations?.labels?.find((l) => l.idx === 210);
    expect(sortie?.texte).toBe("+149.71 %");
    expect(sortie?.info).toBe(
      "Sortie long 254.70 (+149.71 %) — stop trailing 3 × ATR(14) depuis l'extrême, ou cassure directe du canal opposé"
    );
  });

  it("recomposition vs les cœurs : retournement à 320 sur une VRAIE cassure du canal bas", () => {
    const ll = rollingLowest(lowOf(CANDLES), 20);
    expect(closeOf(CANDLES)[320]!).toBeLessThan(ll[319]!);
    expect(closeOf(CANDLES)[319]!).toBeGreaterThanOrEqual(ll[318]!);

    const r = computeIndicator(stratChampion, CANDLES, DEFAUTS);
    const entree = r.annotations?.marqueurs?.find((m) => m.idx === 320);
    expect(entree?.info).toBe(
      "Entrée short 170.70 — cassure du plus-bas Donchian 20 (canal des bougies précédentes)"
    );
  });

  it("mutation-kill : `canal` est bien un input (pas 20 en dur) — avance le warm-up", () => {
    const defaut = etatsStrategie("stratChampion", CANDLES, DEFAUTS);
    const canal10 = etatsStrategie("stratChampion", CANDLES, { ...DEFAUTS, canal: 10 });
    expect(defaut!.findIndex((e) => e !== undefined)).toBe(20);
    expect(canal10!.findIndex((e) => e !== undefined)).toBe(13);
    expect(canal10).not.toEqual(defaut);
  });

  it("mutation-kill : `atrLength` est bien un input (pas 14 en dur) — déplace la sortie trailing", () => {
    const atr5 = etatsStrategie("stratChampion", CANDLES, { ...DEFAUTS, atrLength: 5 });
    const transitions: string[] = [];
    for (let i = 1; i < atr5!.length; i++) {
      const prev = atr5![i - 1];
      const cur = atr5![i];
      if (prev !== undefined && cur !== undefined && prev !== cur) transitions.push(`${i}:${prev}->${cur}`);
    }
    // Même entrée/retournement (le canal ne dépend pas d'atrLength), sortie
    // trailing décalée de 210 à 209 (ATR(5) plus réactif qu'ATR(14)).
    expect(transitions).toEqual(["120:0->1", "209:1->0", "320:0->-1"]);
  });

  it("mutation-kill : `multAtr` est bien un input (pas 3 en dur) — resserre le trailing", () => {
    const mult1 = etatsStrategie("stratChampion", CANDLES, { ...DEFAUTS, multAtr: 1 });
    const transitions: string[] = [];
    for (let i = 1; i < mult1!.length; i++) {
      const prev = mult1![i - 1];
      const cur = mult1![i];
      if (prev !== undefined && cur !== undefined && prev !== cur) transitions.push(`${i}:${prev}->${cur}`);
    }
    // Trailing à 1×ATR coupe et re-coupe plusieurs fois là où 3×ATR (défaut)
    // ne bouge qu'une fois — preuve que multAtr change réellement le calcul.
    expect(transitions).toEqual(["120:0->1", "123:1->0", "124:0->1", "203:1->0", "320:0->-1", "321:-1->0"]);
  });

  it("mutation-kill de l'ORDRE d'évaluation : une entrée en mèche (balayage > multAtr×ATR) OUVRE et TIENT", () => {
    // canal=3, atrLength=3, multAtr=1. 6 bougies plates de warm-up (chop,
    // etat=0 silencieux), PUIS une bougie de spike (mèche haute jusqu'à 200,
    // close 150, loin au-dessus du canal haut ~100.5) : cassure du canal →
    // ENTRÉE long, extreme = high de CETTE MÊME bougie = 200. L'ATR de CETTE
    // bougie (RMA(3), true range ≈101) saute lui aussi sur cette même bougie
    // à ≈34.33, si bien que `extreme − multAtr×ATR = 200 − 34.33 ≈ 165.67`
    // est DÉJÀ SUPÉRIEUR au close (150) — un stop trailing qui s'appliquerait
    // à la position tout juste ouverte l'auto-tuerait immédiatement.
    //
    // Le code réel ne le fait PAS : le bloc trailing est gardé par `etat===1`
    // (ou −1), lu AVANT la mise à jour de cette itération — sur la bougie
    // d'entrée, `etat` vaut encore 0 en entrant dans le bloc, le trailing est
    // donc inerte, et c'est SEULEMENT le bloc de cassure, exécuté ensuite,
    // qui pose `etat=1`. Un mutant qui inverserait l'ordre (cassure d'abord,
    // trailing ensuite) évaluerait le trailing avec le `etat=1` et
    // l'`extreme=200` FRAÎCHEMENT posés par cette même itération, et
    // produirait `etat[6]=0` au lieu de `1` — vérifié empiriquement en
    // inversant les deux blocs dans une copie du fichier (non commitée).
    const flat: Candle[] = Array.from({ length: 6 }, (_v, i) => ({
      time: 1_700_000_000_000 + i * 3_600_000, open: 100, high: 100.5, low: 99.5, close: 100, volume: 1,
    }));
    const spike: Candle = {
      time: 1_700_000_000_000 + 6 * 3_600_000, open: 100, high: 200, low: 99, close: 150, volume: 1,
    };
    const consolidation: Candle[] = Array.from({ length: 2 }, (_v, i) => ({
      time: 1_700_000_000_000 + (7 + i) * 3_600_000, open: 150, high: 150.5, low: 149.5, close: 150, volume: 1,
    }));
    const followUp: Candle = {
      time: 1_700_000_000_000 + 9 * 3_600_000, open: 150, high: 150.5, low: 149.5, close: 150, volume: 1,
    };
    const candles = [...flat, spike, ...consolidation, followUp];
    const PARAMS = { canal: 3, atrLength: 3, multAtr: 1 };

    // Recomposition indépendante des seuils cités ci-dessus (cœurs importés) :
    const hh = rollingHighest(highOf(candles), 3);
    const atr = rma(trueRange(candles), 3);
    expect(hh[5]).toBeCloseTo(100.5, 6); // canal haut AVANT le spike
    expect(closeOf(candles)[6]!).toBeGreaterThan(hh[5]!); // cassure réelle
    expect(atr[6]).toBeCloseTo(34.3333, 3); // ATR déjà gonflé par le spike lui-même
    const seuilQuiTueraitLaPosition = highOf(candles)[6]! - PARAMS.multAtr * atr[6]!; // ≈165.67
    expect(closeOf(candles)[6]!).toBeLessThan(seuilQuiTueraitLaPosition); // sous ce seuil → un mutant s'auto-tuerait ici

    const etats = etatsStrategie("stratChampion", candles, PARAMS);
    expect(etats?.[6]).toBe(1); // le code réel OUVRE et TIENT (pas 0)
  });
});

describe("stratChampion — quirk Task 6 : retournement direct sans flat intermédiaire", () => {
  // canal=3, atrLength=3, multAtr=1 : fixture MINIMALE, choisie pour que
  // chaque valeur (hh/ll/atr) soit vérifiable via les cœurs importés
  // directement (pas de dérivation à la main sur l'ATR récursif).
  // Chop plat (0-3, warm-up + 1er état silencieux à 0) → montée régulière
  // (4-9, VRAIE entrée long à 4, ratchet de l'extrême jusqu'à 117) → krach
  // (10 : close 40, bien sous le trailing ET sous le canal bas) → 1 bougie
  // de queue (11) pour rester dans la fenêtre anti-repaint [1, n-2].
  const closes = [100, 100, 100, 100, 106, 108, 110, 112, 114, 116, 40, 38];
  const candles: Candle[] = closes.map((c, i) => {
    if (i === 10) {
      // Bougie de krach : range large (high 116 = plus-haut de la veille tenu
      // en mèche, low 35 très en dessous), close 40 loin sous les deux seuils.
      return { time: 1_700_000_000_000 + i * 3_600_000, open: 116, high: 116, low: 35, close: c, volume: 1 };
    }
    return { time: 1_700_000_000_000 + i * 3_600_000, open: c - 1, high: c + 1, low: c - 1.5, close: c, volume: 1 };
  });
  const PARAMS = { canal: 3, atrLength: 3, multAtr: 1 };

  it("le ratchet de l'extrême ne recule jamais (117 dès la bougie 9, malgré un high 116 en 10)", () => {
    const highs = highOf(candles);
    // Extrême recomposé indépendamment : max des highs depuis l'entrée (4)
    // jusqu'à la bougie précédant le krach (9).
    expect(Math.max(...highs.slice(4, 10))).toBe(117);
  });

  it("krach à 10 : le close casse À LA FOIS le trailing et le canal bas — recomposé contre les cœurs", () => {
    const highs = highOf(candles);
    const ll = rollingLowest(lowOf(candles), 3);
    const atr = rma(trueRange(candles), 3);
    const closes2 = closeOf(candles);
    const extreme = Math.max(...highs.slice(4, 10)); // 117, ratchet depuis l'entrée à 4
    const trail = extreme - PARAMS.multAtr * atr[10]!;
    expect(closes2[10]!).toBeLessThan(trail); // casse le trailing…
    expect(closes2[10]!).toBeLessThan(ll[9]!); // …ET casse le canal bas des 3 précédentes
  });

  it("un SEUL événement « sortie long + entrée short » à l'idx 10 — pas de flat intermédiaire enregistré", () => {
    const etats = etatsStrategie("stratChampion", candles, PARAMS);
    // Entrée réelle (transition 0→1, pas le 1er état silencieux) à 4, puis
    // maintien jusqu'à 9, puis retournement DIRECT 1→−1 à 10 : aucun 0
    // n'apparaît entre les deux, alors que trailing (→0) ET cassure (→−1)
    // sont tous deux vrais sur cette bougie.
    expect(etats).toEqual([
      undefined, undefined, undefined, 0, 1, 1, 1, 1, 1, 1, -1, -1,
    ]);

    const r = computeIndicator(stratChampion, candles, PARAMS);
    expect(r.annotations?.marqueurs).toEqual([
      { idx: 4, valeur: 104.5, forme: "triangleHaut", couleur: "--up", cible: "prix",
        info: "Entrée long 106.00 — cassure du plus-haut Donchian 3 (canal des bougies précédentes)" },
      { idx: 10, valeur: 116, forme: "triangleBas", couleur: "--down", cible: "prix",
        info: "Entrée short 40.00 — cassure du plus-bas Donchian 3 (canal des bougies précédentes)" },
    ]);
    // La sortie du long PARTAGE l'idx 10 avec l'entrée du short ci-dessus —
    // c'est exactement le quirk : un flat forcé aurait décalé sortie et
    // entrée sur deux bougies distinctes.
    expect(r.annotations?.labels).toEqual([
      { idx: 10, valeur: 116, texte: "-62.26 %", couleur: "--down", cible: "prix", position: "dessus",
        info: "Sortie long 40.00 (-62.26 %) — stop trailing 1 × ATR(3) depuis l'extrême, ou cassure directe du canal opposé" },
    ]);
  });
});
