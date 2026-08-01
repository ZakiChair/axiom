/**
 * Couleur PAR INSTANCE (revue du 2026-08-01 § 3.1).
 *
 * Avant : `chart/indicators.ts` colorait chaque figure par le rang de sa SORTIE dans
 * la définition — donc tout indicateur mono-sortie recevait --serie-1, et deux EMA de
 * périodes différentes étaient deux traits identiques. La couleur suivait le rang, pas
 * l'entité. Ici on vérifie l'allocation : chaque instance reçoit un index de couleur
 * stable, distinct de celui de ses voisines, et libéré à la suppression.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  indicatorsStore,
  jetonsConsommes,
  prochainIndexCouleur,
  NB_COULEURS_SERIE,
} from "./indicators";

const etat = () => indicatorsStore.getState();
const couleurs = () => etat().indicators.map((i) => i.couleurIdx);

beforeEach(() => {
  indicatorsStore.setState({ indicators: [] });
});

describe("prochainIndexCouleur", () => {
  it("part de 0 quand rien n'est actif", () => {
    expect(prochainIndexCouleur([])).toBe(0);
  });

  it("prend le plus petit index LIBRE, pas le suivant", () => {
    expect(prochainIndexCouleur([0, 2])).toBe(1);
    expect(prochainIndexCouleur([1, 2, 3])).toBe(0);
  });

  it("recycle par le MOINS utilisé une fois les six pris", () => {
    // Au-delà de six instances la répétition est inévitable ; ce qui compte est que les
    // suivantes restent distinctes ENTRE ELLES — d'où le comptage, et non un retour à 0.
    expect(prochainIndexCouleur([0, 1, 2, 3, 4, 5])).toBe(0);
    expect(prochainIndexCouleur([0, 1, 2, 3, 4, 5, 0])).toBe(1);
    expect(prochainIndexCouleur([0, 1, 2, 3, 4, 5, 0, 1])).toBe(2);
  });

  it("à égalité de compte, prend le plus petit index (déterminisme)", () => {
    expect(prochainIndexCouleur([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5])).toBe(0);
  });

  it("ignore les index hors bande (état persisté douteux)", () => {
    expect(prochainIndexCouleur([-1, 99, 0])).toBe(1);
  });
});

describe("attribution à l'ajout", () => {
  it("donne des index DISTINCTS à trois instances du même def", () => {
    etat().add("ema");
    etat().add("ema");
    etat().add("ema");
    expect(couleurs()).toEqual([0, 1, 2]);
  });

  it("réutilise l'index libéré par une suppression", () => {
    etat().add("ema");
    etat().add("ema");
    etat().add("ema");
    const milieu = etat().indicators[1];
    if (!milieu) throw new Error("instance absente");
    etat().remove(milieu.instanceId);
    etat().add("rsi");
    expect(couleurs()).toEqual([0, 2, 1]);
  });

  it("duplicate donne une couleur PROPRE à la copie (sinon deux traits identiques)", () => {
    etat().add("ema");
    const src = etat().indicators[0];
    if (!src) throw new Error("instance absente");
    etat().duplicate(src.instanceId);
    const [a, b] = etat().indicators;
    expect(a?.couleurIdx).not.toBe(b?.couleurIdx);
  });

  it("updateParams NE CHANGE PAS la couleur (l'entité reste la même)", () => {
    etat().add("ema");
    const inst = etat().indicators[0];
    if (!inst) throw new Error("instance absente");
    const avant = inst.couleurIdx;
    etat().updateParams(inst.instanceId, { ...inst.params, period: 99 });
    expect(etat().indicators[0]?.couleurIdx).toBe(avant);
  });

  it("reorder NE CHANGE PAS les couleurs (la couleur suit l'entité, pas le rang)", () => {
    etat().add("ema");
    etat().add("rsi");
    const paires = etat().indicators.map((i) => [i.instanceId, i.couleurIdx] as const);
    etat().reorder(etat().indicators.map((i) => i.instanceId).reverse());
    for (const [id, idx] of paires) {
      expect(etat().indicators.find((i) => i.instanceId === id)?.couleurIdx).toBe(idx);
    }
  });

  it("setAll attribue une couleur à un état persisté qui n'en a pas", () => {
    etat().setAll([
      { defId: "ema", params: { period: 20, source: "close" } },
      { defId: "ema", params: { period: 50, source: "close" } },
    ]);
    expect(couleurs()).toEqual([0, 1]);
  });

  it("setAll PRÉSERVE une couleur déjà persistée", () => {
    etat().setAll([
      { defId: "ema", params: { period: 20, source: "close" }, couleurIdx: 3 },
      { defId: "rsi", params: { period: 14, source: "close" } },
    ]);
    expect(couleurs()).toEqual([3, 0]);
  });

  it("setAll RÉPARE un état persisté où tout partage la même couleur", () => {
    // Sessions enregistrées avant l'allocation par instance : toutes à 0, donc trois
    // courbes identiques que rien dans l'UI ne permettrait de départager.
    etat().setAll([
      { defId: "ema", params: { period: 20, source: "close" }, couleurIdx: 0 },
      { defId: "ema", params: { period: 50, source: "close" }, couleurIdx: 0 },
      { defId: "ema", params: { period: 200, source: "close" }, couleurIdx: 0 },
    ]);
    expect(new Set(couleurs()).size).toBe(3);
  });

  it("setAll ne réattribue PAS quand les six tokens sont déjà consommés", () => {
    // Au-delà de six, un doublon n'est plus « évitable » : on garde alors ce qui a été
    // enregistré plutôt que de repeindre l'agencement à chaque ouverture.
    const liste = Array.from({ length: 7 }, (_, i) => ({
      defId: "ema",
      params: { period: 10 + i, source: "close" },
      couleurIdx: i % 6,
    }));
    etat().setAll(liste);
    expect(couleurs()).toEqual([0, 1, 2, 3, 4, 5, 0]);
  });

  it("setAll est IDEMPOTENT après une duplication : recharger ne repeint personne", () => {
    // Le cas qui cassait la promesse « la couleur suit l'entité » : six instances bien
    // réparties, on en duplique une (la copie prend un index déjà pris, c'est normal à
    // six), puis on recharge — toutes les couleurs doivent être exactement les mêmes.
    for (let i = 0; i < 6; i++) etat().add("ema");
    const premier = etat().indicators[0];
    if (!premier) throw new Error("instance absente");
    etat().duplicate(premier.instanceId);
    const avant = couleurs();

    etat().setAll(etat().indicators);
    expect(couleurs()).toEqual(avant);
    // Et une seconde fois, pour verrouiller le point fixe.
    etat().setAll(etat().indicators);
    expect(couleurs()).toEqual(avant);
  });

  it("un multi-sorties RÉSERVE une couleur par sortie : l'overlay suivant ne la reprend pas", () => {
    // Bollinger trace trois lignes en --serie-(idx+1..3) ; sans tenir compte de cette
    // arité, l'EMA suivante recevait l'index 1, c'est-à-dire exactement la couleur de la
    // bande haute, sur le même pane.
    etat().add("bollinger");
    etat().add("ema");
    const [boll, ema] = etat().indicators;
    if (!boll || !ema) throw new Error("instances absentes");
    const sortiesBoll = jetonsConsommes(boll.defId);
    expect(sortiesBoll).toBeGreaterThan(1);
    const occupeesParBoll = Array.from(
      { length: sortiesBoll },
      (_, k) => (boll.couleurIdx + k) % NB_COULEURS_SERIE
    );
    expect(occupeesParBoll).not.toContain(ema.couleurIdx);
  });

  it("toutes les couleurs attribuées restent dans la bande des tokens", () => {
    for (let i = 0; i < NB_COULEURS_SERIE + 3; i++) etat().add("ema");
    for (const c of couleurs()) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(NB_COULEURS_SERIE);
    }
  });

  it("au-delà de six instances, les trois suivantes restent distinctes entre elles", () => {
    // Cas observé dans le navigateur : six panes séparés déjà posés, puis trois EMA
    // ajoutées sur le prix — elles ressortaient toutes en --serie-1.
    for (let i = 0; i < NB_COULEURS_SERIE; i++) etat().add("rsi");
    etat().add("ema");
    etat().add("ema");
    etat().add("ema");
    const troisDernieres = couleurs().slice(-3);
    expect(new Set(troisDernieres).size).toBe(3);
  });
});
