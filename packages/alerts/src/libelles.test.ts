/**
 * @axiom/alerts — libelles.test.ts
 *
 * Libellés des alertes, au caractère près : ce texte part dans la liste, l'avis à l'écran, le
 * journal, la notification du bureau et les relais du daemon. Pour AXIS et AXIS S/R il porte la
 * mention de mesure, placée juste après le nom. Aucune sortie de ces deux indicateurs ne doit
 * échapper au classement : la table ci-dessous est relue contre le registre.
 */
import { describe, expect, it } from "vitest";
import { getIndicator, statutAxis } from "@axiom/indicators";
import type { Timeframe } from "@axiom/types";
import { decrireCondition } from "./describe";
import { decrireAlerte } from "./libelles";
import type { AlertDef, Comparateur, Condition } from "./types";

type Params = Record<string, number | boolean | string>;

const seuil = (
  indicateurId: string,
  output: string,
  comparateur: Comparateur,
  valeur: number,
  params: Params = {},
): Condition => ({ type: "indicateur-seuil", indicateurId, params, output, comparateur, valeur });

const libelle = (condition: Condition, timeframe?: Timeframe, message?: string): string =>
  decrireAlerte({ condition, ...(timeframe !== undefined ? { timeframe } : {}), ...(message !== undefined ? { message } : {}) });

describe("decrireAlerte — AXIS et AXIS S/R, au caractère près", () => {
  it("réactions sur zone forte : « non mesuré » juste après le nom, avant l'évènement", () => {
    expect(libelle(seuil("stratAxisSr", "reactionSupport", ">=", 1), "4h")).toBe("AXIS S/R non mesuré · réaction sur support fort");
    expect(libelle(seuil("stratAxisSr", "reactionResistance", ">=", 1), "4h")).toBe("AXIS S/R non mesuré · réaction sur résistance forte");
    // Toute comparaison vraie pour 1 et fausse pour 0 est le même évènement.
    expect(libelle(seuil("stratAxisSr", "reactionSupport", ">", 0), "1h")).toBe("AXIS S/R non mesuré · réaction sur support fort");
    expect(libelle(seuil("stratAxisSr", "reactionSupport", ">", 0.5))).toBe("AXIS S/R non mesuré · réaction sur support fort");
  });

  it("pré-signal d'achat (sortie preAchat, alertes A2) : « non mesuré » juste après le nom, le niveau est sur le graphe", () => {
    expect(libelle(seuil("stratAxisSr", "preAchat", ">=", 1), "4h")).toBe("AXIS S/R non mesuré · pré-signal d'achat (niveau sur le graphe)");
    expect(libelle(seuil("stratAxisSr", "preAchat", ">", 0))).toBe("AXIS S/R non mesuré · pré-signal d'achat (niveau sur le graphe)");
    // Lu autrement que par son évènement : la comparaison est écrite, toujours « non mesuré ».
    expect(libelle(seuil("stratAxisSr", "preAchat", "<=", 0), "4h")).toBe("AXIS S/R non mesuré · Pré-signal d'achat (non mesuré) <= 0");
  });

  it("signal confirmé (sortie etat) : le statut du graphe, puis achat ou vente", () => {
    expect(libelle(seuil("stratAxis", "etat", ">=", 1), "4h")).toBe("AXIS test 4h ≈ EMA 200 seule · signal d'achat");
    expect(libelle(seuil("stratAxisSr", "etat", ">=", 1), "1h")).toBe("AXIS S/R 1h : test échoué · signal d'achat");
    expect(libelle(seuil("stratAxisSr", "etat", "<=", 0), "1w")).toBe("AXIS S/R 1w : non mesuré · signal de vente");
    expect(libelle(seuil("stratAxisSr", "etat", ">=", 1, { stopAtr: 2 }), "4h")).toBe("AXIS S/R réglage non validé · signal d'achat");
    expect(libelle(seuil("stratAxis", "etat", ">=", 1, { filtreFlux: true }), "4h")).toBe("AXIS filtre flux, non mesuré · signal d'achat");
    expect(libelle(seuil("stratAxis", "etat", ">=", 1))).toBe("AXIS non mesuré hors 4h · signal d'achat");
    expect(libelle(seuil("stratAxis", "etat", "<", 1), "4h")).toBe("AXIS test 4h ≈ EMA 200 seule · signal de vente");
  });

  it("« hors test » suit la règle du graphe : stop, filtre ADX, régime hors de 0 et de la valeur testée, marge S/R", () => {
    const statut = (id: string, params: Params): string => libelle(seuil(id, "etat", ">=", 1, params), "4h").split(" · ")[0]!;
    expect(statut("stratAxis", {})).toBe("AXIS test 4h ≈ EMA 200 seule");
    expect(statut("stratAxis", { regimeBtc: 0 })).toBe("AXIS test 4h ≈ EMA 200 seule");
    expect(statut("stratAxis", { regimeBtc: 100 })).toBe("AXIS test 4h ≈ EMA 200 seule");
    expect(statut("stratAxis", { regimeBtc: 50 })).toBe("AXIS réglage non validé");
    expect(statut("stratAxis", { adxEntree: 25 })).toBe("AXIS réglage non validé");
    expect(statut("stratAxis", { stopAtr: 3 })).toBe("AXIS réglage non validé");
    expect(statut("stratAxisSr", { margeResistanceAtr: 1 })).toBe("AXIS S/R réglage non validé");
    // AXIS n'a pas ce réglage : son calcul ne le lit pas, son libellé non plus.
    expect(statut("stratAxis", { margeResistanceAtr: 1 })).toBe("AXIS test 4h ≈ EMA 200 seule");
    // Réglages du cœur : ni l'infobulle du graphe ni le libellé ne les lisent (limite consignée au contrat).
    expect(statut("stratAxis", { emaTendance: 50 })).toBe("AXIS test 4h ≈ EMA 200 seule");
  });

  it("toute autre sortie ou comparaison : « non mesuré », puis le nom de la sortie, le comparateur et la valeur", () => {
    expect(libelle(seuil("stratAxisSr", "score", ">=", 5), "4h")).toBe("AXIS S/R non mesuré · Score (−6 à +6) >= 5");
    expect(libelle(seuil("stratAxis", "prixSignal", ">", 0), "4h")).toBe("AXIS non mesuré · Prix d'achat > 0");
    expect(libelle(seuil("stratAxisSr", "support", "<", 90000), "4h")).toBe("AXIS S/R non mesuré · Support actif proche < 90000");
    // Une réaction lue autrement que par son évènement n'est pas nommée « réaction sur … ».
    expect(libelle(seuil("stratAxisSr", "reactionSupport", ">", 1), "4h")).toBe("AXIS S/R non mesuré · Réaction sur support fort > 1");
    expect(libelle(seuil("stratAxisSr", "reactionResistance", "<=", 0), "4h")).toBe("AXIS S/R non mesuré · Réaction sur résistance forte <= 0");
    // Sortie etat hors évènement : le statut reste celui du graphe, la comparaison est écrite.
    expect(libelle(seuil("stratAxis", "etat", ">", 1), "4h")).toBe("AXIS test 4h ≈ EMA 200 seule · État (1 acheté, 0 à plat) > 1");
    // Sortie inconnue du registre (def importée) : sa clé, toujours « non mesuré ».
    expect(libelle(seuil("stratAxisSr", "fantome", ">=", 1), "4h")).toBe("AXIS S/R non mesuré · fantome >= 1");
  });

  it("croisement de deux sorties : « non mesuré », avec le sens", () => {
    const croisement = (sens: "hausse" | "baisse" | "les-deux"): Condition => ({
      type: "indicateur-croisement", indicateurId: "stratAxisSr", params: {}, outputA: "support", outputB: "resistance", sens,
    });
    expect(libelle(croisement("hausse"), "4h")).toBe("AXIS S/R non mesuré · Support actif proche croise à la hausse Résistance active proche");
    expect(libelle(croisement("baisse"), "4h")).toBe("AXIS S/R non mesuré · Support actif proche croise à la baisse Résistance active proche");
    expect(libelle(croisement("les-deux"), "4h")).toBe("AXIS S/R non mesuré · Support actif proche croise Résistance active proche");
  });
});

describe("decrireAlerte — propriétés", () => {
  /**
   * Classement de chaque sortie des deux indicateurs. Une sortie ajoutée au registre fait
   * échouer le premier test : il faut décider ici de son libellé avant de la proposer en alerte.
   */
  const CLASSEMENT: Readonly<Record<string, "etat" | "reaction" | "presignal" | "brute">> = {
    prixSignal: "brute",
    stop: "brute",
    etat: "etat",
    score: "brute",
    support: "brute",
    resistance: "brute",
    reactionSupport: "reaction",
    reactionResistance: "reaction",
    // Alertes A2 (12 novembre 2026) : neuvième sortie d'AXIS S/R, non mesurée.
    preAchat: "presignal",
  };
  const IDS = ["stratAxis", "stratAxisSr"] as const;
  const sorties = (id: string) => getIndicator(id)!.outputs;
  const UNITES: Array<Timeframe | undefined> = [
    undefined, "1s", "5s", "15s", "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d", "3d", "1w", "1M", "3M", "6M", "12M",
  ];
  const REGLAGES: Params[] = [{}, { filtreFlux: true }, { stopAtr: 3 }, { adxEntree: 25 }, { regimeBtc: 50 }, { margeResistanceAtr: 2 }];
  const COMPARAISONS: Array<[Comparateur, number]> = [[">=", 1], ["<=", 0], [">", 0], ["<", 1], [">", 1], [">=", 5], ["<", -4]];

  it("aucune sortie d'AXIS ni d'AXIS S/R n'échappe au classement (lu au registre)", () => {
    for (const id of IDS) {
      expect(sorties(id).length).toBeGreaterThan(0);
      for (const sortie of sorties(id)) expect(CLASSEMENT[sortie.key], `${id}.${sortie.key} à classer`).toBeDefined();
    }
    // Le registre porte bien les sorties que la table nomme (aucune entrée périmée).
    const connues = new Set(IDS.flatMap((id) => sorties(id).map((o) => o.key)));
    expect(Object.keys(CLASSEMENT).filter((cle) => !connues.has(cle))).toEqual([]);
  });

  it("chaque sortie, unité, réglage et comparaison : la mention suit le nom et finit au 34e caractère au plus", () => {
    let plusLongue = 0;
    for (const id of IDS) {
      const nom = getIndicator(id)!.name;
      for (const sortie of sorties(id)) {
        for (const unite of UNITES) {
          for (const params of REGLAGES) {
            for (const [comparateur, valeur] of COMPARAISONS) {
              const texte = libelle(seuil(id, sortie.key, comparateur, valeur, params), unite);
              const fin = texte.indexOf(" · ");
              expect(fin, texte).toBeGreaterThan(0);
              const mention = texte.slice(nom.length + 1, fin);
              expect(texte.startsWith(`${nom} `), texte).toBe(true);
              expect(fin, texte).toBeLessThanOrEqual(34);
              plusLongue = Math.max(plusLongue, fin);
              if (CLASSEMENT[sortie.key] === "etat") {
                // Le statut du graphe, ou « non mesuré hors 4h » sans unité : jamais mieux que l'infobulle.
                const horsTest = "stopAtr" in params || "adxEntree" in params || "regimeBtc" in params || (id === "stratAxisSr" && "margeResistanceAtr" in params);
                expect(mention, texte).toBe(unite === undefined ? "non mesuré hors 4h" : statutAxis(unite, params.filtreFlux === true, horsTest));
              } else {
                expect(mention, texte).toBe("non mesuré");
              }
            }
          }
        }
      }
    }
    // La plus longue mention connue : « AXIS S/R test 4h ≈ EMA 200 seule », 32 caractères.
    expect(plusLongue).toBe(32);
  });

  it("aucun libellé ne dit « réussi », « confirmé » ni « validé » ; seul le 4h sans réglage hors test échappe à « non mesuré », « échoué » ou « non validé »", () => {
    for (const id of IDS) {
      for (const sortie of sorties(id)) {
        for (const unite of UNITES) {
          for (const params of REGLAGES) {
            const texte = libelle(seuil(id, sortie.key, ">=", 1, params), unite);
            expect(texte).not.toMatch(/réussi|confirmé|gagnant|(?<!non )validé/);
            const reserve = /non mesuré|test échoué|réglage non validé/.test(texte);
            if (!reserve) expect(texte.split(" · ")[0]).toBe(`${getIndicator(id)!.name} test 4h ≈ EMA 200 seule`);
          }
        }
      }
    }
  });

  it("def.message prime sur le libellé", () => {
    expect(libelle(seuil("stratAxisSr", "reactionSupport", ">=", 1), "4h", "Mon message")).toBe("Mon message");
    expect(libelle({ type: "prix-croise", niveau: 100, sens: "hausse" }, undefined, "Setup EQS")).toBe("Setup EQS");
  });

  it("un composite contenant une sortie non mesurée porte « non mesuré », sous-libellés joints par « ET »", () => {
    const composite: Condition = {
      type: "composite",
      conditions: [
        { type: "prix-croise", niveau: 100000, sens: "hausse" },
        { type: "indicateur-seuil", indicateurId: "stratAxisSr", params: {}, output: "reactionResistance", comparateur: ">=", valeur: 1 },
        { type: "indicateur-seuil", indicateurId: "stratAxis", params: {}, output: "etat", comparateur: ">=", valeur: 1 },
      ],
    };
    expect(libelle(composite, "4h")).toBe(
      "Prix franchit 100000 à la hausse ET AXIS S/R non mesuré · réaction sur résistance forte ET AXIS test 4h ≈ EMA 200 seule · signal d'achat",
    );
  });

  it("hors AXIS et AXIS S/R : exactement decrireCondition", () => {
    const conditions: Condition[] = [
      { type: "prix-croise", niveau: 105, sens: "les-deux" },
      { type: "variation-pct", fenetreMs: 3_600_000, seuilPct: -3 },
      seuil("rsi", "rsi", ">", 70, { length: 14 }),
      seuil("rsiDivergence", "rsi", "<", 30),
      { type: "indicateur-croisement", indicateurId: "macd", params: {}, outputA: "macd", outputB: "signal", sens: "hausse" },
      { type: "funding-extreme", sens: "les-deux", zSeuil: 2 },
      { type: "cvd-spot-perp-div", kind: "les-deux" },
      { type: "liq-cascade", seuilUsdParMin: 5_000_000 },
      { type: "regime-seuil", comparateur: "<=", valeur: -1.2 },
      { type: "onchain-seuil", metrique: "mvrv-z", comparateur: ">=", valeur: 7 },
      { type: "whale-flux", seuilUsd: 10_000_000, direction: "tous" },
      { type: "flux-capitaux-seuil", metrique: "exchange-netflow", comparateur: "<", valeur: -1000 },
      { type: "composite", conditions: [{ type: "prix-croise", niveau: 1, sens: "hausse" }, { type: "funding-extreme", sens: "long-crowded", seuilAbs: 0.001 }] },
    ];
    for (const condition of conditions) {
      for (const timeframe of [undefined, "1m", "4h"] as const) {
        expect(libelle(condition, timeframe)).toBe(decrireCondition(condition));
      }
    }
  });

  it("le libellé ne nomme ni le symbole ni l'unité de l'alerte : c'est l'hôte qui les ajoute", () => {
    const base: Omit<AlertDef, "symbol" | "source"> = {
      id: "a", condition: seuil("stratAxisSr", "reactionSupport", ">=", 1), timeframe: "4h", actif: true, declenchements: [],
    };
    const defBtc: AlertDef = { ...base, symbol: "BTCUSDT", source: "binance" };
    const defEth: AlertDef = { ...base, symbol: "ETHUSDT", source: "bybit" };
    const btc = decrireAlerte(defBtc);
    const eth = decrireAlerte(defEth);
    expect(btc).toBe(eth);
    expect(btc).not.toMatch(/BTCUSDT|4h/);
    // Hors AXIS, l'unité de la def ne change rien au texte.
    expect(libelle(seuil("rsi", "rsi", ">", 70), "1h")).toBe(libelle(seuil("rsi", "rsi", ">", 70), "4h"));
  });
});
