/**
 * Tests des fonctions PURES du client « niveaux de liquidation RÉELS Hyperliquid » :
 * mapping de la réponse daemon (`GET /hl/liqlevels/:coin`) et décision d'état.
 *
 * ⚠️ Ces niveaux viennent du TOP du leaderboard Hyperliquid, PAS de tout le carnet :
 * ils sont RÉELS (positions ouvertes observées) mais NON EXHAUSTIFS.
 */
import { describe, it, expect, vi } from "vitest";

import {
  mapperReponseHl,
  deciderEtatHl,
  executerCommandeLiqHl,
  presentationCommandeLiqHl,
  type ReponseHlLiq,
} from "./hyperliquidLiq";

/** Réponse daemon minimale valide (contrat apps/daemon). */
function reponse(partial: Partial<ReponseHlLiq> = {}): ReponseHlLiq {
  return {
    ts: 1_700_000_000_000,
    coin: "BTC",
    adressesScannees: 250,
    niveaux: [
      { px: 58_000, side: "long", valueUsd: 4_200_000, entryPx: 61_000, lev: 20, addr: "0xabc" },
    ],
    ...partial,
  };
}

describe("mapperReponseHl — réponse daemon → niveaux typés", () => {
  it("mappe une réponse conforme au contrat", () => {
    expect(mapperReponseHl(reponse())).toEqual(reponse());
  });

  it("écarte les niveaux inexploitables sans jeter la réponse entière", () => {
    // Le daemon relaie l'API Hyperliquid telle quelle : un champ manquant ou non fini ne
    // doit pas rendre muette toute la couche (les autres niveaux restent affichables).
    const brut = {
      ...reponse(),
      niveaux: [
        { px: 58_000, side: "long", valueUsd: 4_200_000, entryPx: 61_000, lev: 20, addr: "0xabc" },
        { px: Number.NaN, side: "long", valueUsd: 10, entryPx: 1, lev: 2, addr: "0xdef" },
        { px: 100, side: "flat", valueUsd: 10, entryPx: 1, lev: 2, addr: "0xghi" }, // side inconnu
        { px: 100, valueUsd: 10, entryPx: 1, lev: 2, addr: "0xjkl" }, // side absent
        { px: 100, side: "short", valueUsd: "beaucoup", entryPx: 1, lev: 2, addr: "0xmno" },
      ],
    };
    const out = mapperReponseHl(brut);
    expect(out?.niveaux).toHaveLength(1);
    expect(out?.niveaux[0]?.addr).toBe("0xabc");
  });

  it("accepte une réponse SANS niveau (coin non couvert par le leaderboard)", () => {
    expect(mapperReponseHl(reponse({ niveaux: [] }))?.niveaux).toEqual([]);
  });

  it("renvoie null sur une charge utile non conforme", () => {
    expect(mapperReponseHl(null)).toBeNull();
    expect(mapperReponseHl("BTC")).toBeNull();
    expect(mapperReponseHl({})).toBeNull(); // pas de tableau `niveaux`
    expect(mapperReponseHl({ ...reponse(), niveaux: "nope" })).toBeNull();
    expect(mapperReponseHl({ ...reponse(), coin: 42 })).toBeNull();
    expect(mapperReponseHl({ ...reponse(), ts: "hier" })).toBeNull();
  });

  it("remplace un compteur d'adresses non numérique par 0 (méta d'affichage, pas de rejet)", () => {
    expect(mapperReponseHl({ ...reponse(), adressesScannees: undefined })?.adressesScannees).toBe(0);
  });
});

describe("deciderEtatHl — état affiché de la couche", () => {
  it("capability absente → « sans-daemon » (précédent REPLAY), même avec une réponse", () => {
    expect(deciderEtatHl(false, reponse())).toBe("sans-daemon");
    expect(deciderEtatHl(false, null)).toBe("sans-daemon");
  });

  it("daemon présent mais réponse illisible / réseau KO → « erreur » (douce)", () => {
    expect(deciderEtatHl(true, null)).toBe("erreur");
  });

  it("réponse conforme sans aucun niveau → « vide »", () => {
    expect(deciderEtatHl(true, reponse({ niveaux: [] }))).toBe("vide");
  });

  it("réponse conforme avec des niveaux → « ok »", () => {
    expect(deciderEtatHl(true, reponse())).toBe("ok");
  });
});

describe("commande LIQHL sur Vercel", () => {
  it("inclut UNUSABLE dans le libellé et l'aperçu", () => {
    const presentation = presentationCommandeLiqHl(true);
    expect(presentation.libelle).toContain("UNUSABLE");
    expect(presentation.apercu).toContain("UNUSABLE");
    expect(presentationCommandeLiqHl(false).libelle).not.toContain("UNUSABLE");
  });

  it("n'active pas la couche et explique la raison par toast", () => {
    const basculer = vi.fn();
    const notifier = vi.fn();
    executerCommandeLiqHl(true, basculer, notifier);

    expect(basculer).not.toHaveBeenCalled();
    expect(notifier).toHaveBeenCalledOnce();
    expect(notifier.mock.calls[0]?.[0]).toContain("daemon local axiomd");
    expect(notifier.mock.calls[0]?.[0]).toContain("Vercel");
  });

  it("conserve la bascule locale sans toast", () => {
    const basculer = vi.fn();
    const notifier = vi.fn();
    executerCommandeLiqHl(false, basculer, notifier);

    expect(basculer).toHaveBeenCalledOnce();
    expect(notifier).not.toHaveBeenCalled();
  });
});
