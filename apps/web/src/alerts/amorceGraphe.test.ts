/**
 * Historique que le graphe principal charge pour les alertes de son marché (lot A2, 12 novembre
 * 2026) : indicateurs demandés par les alertes actives, amorce d'une def, règle de profondeur
 * commune au runtime et à la liste, publication de l'état de l'extension, et relance de
 * l'extension seulement quand la liste triée des indicateurs d'alerte change (correction 3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlertDef, Condition } from "@axiom/alerts";
import { alertsStore } from "../store/alerts";
import {
  cleMarcheGraphe,
  extensionGrapheStore,
  indicateursAlertesMarche,
  indicateursExtension,
  publierExtension,
  surIndicateursAlertes,
  type ExtensionGraphe,
} from "./amorceGraphe";
// Règle de profondeur et amorce d'une def : chargées à la demande avec le panneau et le runtime.
import { amorceAlerte, mentionAmorceCourte, profondeurAlerte } from "../components/alertsPanel.util";

const MARCHE = { exchange: "binance" as const, symbol: "BTCUSDT", timeframe: "4h" as const };
const CLE = cleMarcheGraphe(MARCHE);
const MAINTENANT = 1_800_000_000_000;

const seuil = (indicateurId: string, output = "etat"): Extract<Condition, { type: "indicateur-seuil" }> =>
  ({ type: "indicateur-seuil", indicateurId, params: {}, output, comparateur: ">=", valeur: 1 });

function def(id: string, condition: Condition, plus: Partial<AlertDef> = {}): AlertDef {
  return { id, symbol: "BTCUSDT", source: "binance", timeframe: "4h", actif: true, declenchements: [], condition, ...plus };
}

describe("indicateursAlertesMarche : les indicateurs des alertes ACTIVES du marché affiché", () => {
  it("filtre par source, symbole et unité ; une def sans unité compte ; trié, sans doublon", () => {
    const defs = [
      def("sr", seuil("stratAxisSr", "reactionSupport")),
      def("axis-sans-unite", seuil("stratAxis"), { timeframe: undefined }),
      def("axis-doublon", seuil("stratAxis")),
      def("autre-unite", seuil("macd", "macd"), { timeframe: "1h" }),
      def("autre-actif", seuil("ema", "ema"), { symbol: "ETHUSDT" }),
      def("autre-source", seuil("bbands", "upper"), { source: "bybit" }),
    ];
    expect(indicateursAlertesMarche(defs, MARCHE, MAINTENANT)).toEqual(["stratAxis", "stratAxisSr"]);
  });

  it("une alerte en pause ou échue n'en demande aucun", () => {
    const defs = [
      def("pause", seuil("stratAxisSr"), { actif: false }),
      def("echue", seuil("stratAxis"), { expireTs: MAINTENANT - 1 }),
      def("valide", seuil("rsi", "rsi"), { expireTs: MAINTENANT + 1 }),
    ];
    expect(indicateursAlertesMarche(defs, MARCHE, MAINTENANT)).toEqual(["rsi"]);
  });

  it("sous-conditions des composites et croisements compris ; prix, variation et funding n'en demandent pas", () => {
    const defs = [
      def("comp", { type: "composite", conditions: [{ type: "prix-croise", niveau: 1, sens: "hausse" }, seuil("stratAxisSr", "reactionSupport")] }),
      def("croise", { type: "indicateur-croisement", indicateurId: "macd", params: {}, outputA: "macd", outputB: "signal", sens: "hausse" }),
      def("prix", { type: "prix-croise", niveau: 1, sens: "hausse" }, { timeframe: undefined }),
      def("var", { type: "variation-pct", fenetreMs: 60_000, seuilPct: 5 }),
      def("funding", { type: "funding-extreme", sens: "les-deux", zSeuil: 2 }, { timeframe: undefined }),
    ];
    expect(indicateursAlertesMarche(defs, MARCHE, MAINTENANT)).toEqual(["macd", "stratAxisSr"]);
  });
});

describe("indicateursExtension : seule la vue principale sert les alertes", () => {
  const defs = [def("sr", seuil("stratAxisSr", "reactionSupport"))];
  it("vue principale : indicateurs affichés puis ceux des alertes de son marché", () => {
    expect(indicateursExtension(["rsi"], defs, MARCHE, MAINTENANT, true)).toEqual(["rsi", "stratAxisSr"]);
  });
  it("vue secondaire, même marché : les indicateurs affichés seulement (le runtime ne la lit pas)", () => {
    expect(indicateursExtension(["rsi"], defs, MARCHE, MAINTENANT, false)).toEqual(["rsi"]);
  });
  it("vue principale sur un autre marché : rien des alertes de BTCUSDT 4h", () => {
    expect(indicateursExtension([], defs, { ...MARCHE, timeframe: "1h" }, MAINTENANT, true)).toEqual([]);
  });
});

describe("amorceAlerte", () => {
  it("3 000 pour AXIS S/R, 1 500 pour AXIS, 0 pour RSI ; composite : la plus grande", () => {
    expect(amorceAlerte({ condition: seuil("stratAxisSr") })).toBe(3000);
    expect(amorceAlerte({ condition: seuil("stratAxis") })).toBe(1500);
    expect(amorceAlerte({ condition: seuil("rsi", "rsi") })).toBe(0);
    expect(amorceAlerte({ condition: { type: "composite", conditions: [seuil("stratAxis"), seuil("stratAxisSr")] } })).toBe(3000);
  });
});

describe("profondeurAlerte : la règle commune au runtime et à la liste", () => {
  const extension = (terminee: boolean, amorceVisee: number, cle = CLE, echec = false): ExtensionGraphe => ({ cle, terminee, echec, amorceVisee, bougies: 2988 });

  it("atteinte : le tampon compte l'amorce, quel que soit l'état de l'extension (règle A1 inchangée)", () => {
    for (const ext of [null, extension(false, 3000), extension(true, 1500, "autre")]) {
      expect(profondeurAlerte(3000, 3000, ext, CLE)).toBe("atteinte");
      expect(profondeurAlerte(0, 0, ext, CLE)).toBe("atteinte");
    }
  });

  it("courte : sous l'amorce, extension de CE marché terminée et visant au moins l'amorce", () => {
    expect(profondeurAlerte(3000, 2988, extension(true, 3000), CLE)).toBe("courte");
    expect(profondeurAlerte(1500, 1200, extension(true, 3000), CLE)).toBe("courte");
    // Remontée finie sur un échec réseau : évaluée aussi sur le tampon obtenu ; c'est la mention qui dit la cause.
    expect(profondeurAlerte(3000, 500, extension(true, 3000, CLE, true), CLE)).toBe("courte");
  });

  it("attente : rien de connu, remontée en cours, autre marché, ou extension qui visait moins", () => {
    expect(profondeurAlerte(3000, 2988, null, CLE)).toBe("attente");
    expect(profondeurAlerte(3000, 2988, extension(false, 3000), CLE)).toBe("attente");
    expect(profondeurAlerte(3000, 2988, extension(true, 3000, "binance|BTCUSDT|1h"), CLE)).toBe("attente");
    expect(profondeurAlerte(3000, 1500, extension(true, 1500), CLE)).toBe("attente");
  });

  it("la mention du message, au caractère près ; un échec réseau est dit comme tel (revue du lot A2)", () => {
    expect(mentionAmorceCourte(2989)).toBe(" · amorce courte (2989 bougies)");
    expect(mentionAmorceCourte(2989, false)).toBe(" · amorce courte (2989 bougies)");
    expect(mentionAmorceCourte(500, true)).toBe(" · amorce courte (500 bougies, chargement échoué)");
  });
});

describe("publierExtension : le store n'est écrit que si l'état change", () => {
  afterEach(() => extensionGrapheStore.setState({ extension: null }));

  it("même état republié : aucun abonné réveillé ; état différent : un réveil", () => {
    publierExtension({ cle: CLE, terminee: false, echec: false, amorceVisee: 3000, bougies: 500 });
    const abonne = vi.fn();
    const desabonner = extensionGrapheStore.subscribe(abonne);
    publierExtension({ cle: CLE, terminee: false, echec: false, amorceVisee: 3000, bougies: 500 });
    expect(abonne).not.toHaveBeenCalled();
    publierExtension({ cle: CLE, terminee: true, echec: false, amorceVisee: 3000, bougies: 2988 });
    publierExtension(null);
    publierExtension(null);
    expect(abonne).toHaveBeenCalledTimes(2);
    // Seul l'échec change (même tampon) : c'est un autre état, la liste et le message changent.
    publierExtension({ cle: CLE, terminee: true, echec: false, amorceVisee: 3000, bougies: 500 });
    publierExtension({ cle: CLE, terminee: true, echec: true, amorceVisee: 3000, bougies: 500 });
    expect(abonne).toHaveBeenCalledTimes(4);
    desabonner();
  });
});

describe("surIndicateursAlertes : relance seulement quand la liste triée change (correction 3 de la critique)", () => {
  beforeEach(() => {
    alertsStore.setState({ defs: [], journal: [] });
  });

  it("création, pause, reprise, suppression : une relance chacune ; armement et déclenchement : aucune", () => {
    const relancer = vi.fn();
    const desabonner = surIndicateursAlertes(MARCHE, relancer);
    const ajouter = (condition: Condition): void => {
      expect(alertsStore.getState().ajouter({ symbol: "BTCUSDT", source: "binance", timeframe: "4h", condition })).toBe(true);
    };
    ajouter(seuil("stratAxisSr", "reactionSupport"));
    expect(relancer).toHaveBeenCalledTimes(1);
    const id = alertsStore.getState().defs[0]!.id;
    // Calibrage puis déclenchement : les définitions sont réécrites, la liste ne change pas.
    alertsStore.getState().appliquerMisesAJour([{ ...alertsStore.getState().defs[0]!, arme: true }]);
    alertsStore.getState().appliquerMisesAJour([{ ...alertsStore.getState().defs[0]!, arme: false, declenchements: [MAINTENANT] }]);
    alertsStore.getState().ajouterJournal({ alertId: id, ts: MAINTENANT, valeur: 1, message: "x" });
    expect(relancer).toHaveBeenCalledTimes(1);
    // Une seconde alerte sur le même indicateur, ou une alerte de prix : la liste reste la même.
    ajouter(seuil("stratAxisSr", "reactionResistance"));
    ajouter({ type: "prix-croise", niveau: 80_000, sens: "baisse" });
    expect(relancer).toHaveBeenCalledTimes(1);
    // Une alerte d'un autre marché : rien.
    expect(alertsStore.getState().ajouter({ symbol: "ETHUSDT", source: "binance", timeframe: "4h", condition: seuil("stratAxis") })).toBe(true);
    expect(relancer).toHaveBeenCalledTimes(1);
    // Pause puis reprise des deux alertes AXIS S/R : la liste perd puis retrouve l'indicateur.
    const ids = alertsStore.getState().defs.filter((d) => d.condition.type === "indicateur-seuil" && d.symbol === "BTCUSDT").map((d) => d.id);
    for (const i of ids) alertsStore.getState().basculerActif(i);
    expect(relancer).toHaveBeenCalledTimes(2);
    for (const i of ids) alertsStore.getState().basculerActif(i);
    expect(relancer).toHaveBeenCalledTimes(3);
    // Suppression de l'une : l'autre demande encore AXIS S/R ; de la seconde : la liste se vide.
    alertsStore.getState().supprimer(ids[0]!);
    expect(relancer).toHaveBeenCalledTimes(3);
    alertsStore.getState().supprimer(ids[1]!);
    expect(relancer).toHaveBeenCalledTimes(4);
    desabonner();
    ajouter(seuil("stratAxis"));
    expect(relancer).toHaveBeenCalledTimes(4);
  });
});
