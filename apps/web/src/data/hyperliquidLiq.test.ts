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
  estEnConstructionHl,
  executerCommandeLiqHl,
  presentationCommandeLiqHl,
  RELANCE_CONSTRUCTION_MS,
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

describe("estEnConstructionHl — 503 « instantané en construction » du daemon", () => {
  it("reconnaît le corps 503 { enConstruction: true } relayé brut par data/daemon.ts", () => {
    expect(estEnConstructionHl({ erreur: "instantané Hyperliquid en construction", enConstruction: true })).toBe(true);
  });

  it("ne confond ni une réponse normale, ni un échec, ni un drapeau non strictement vrai", () => {
    expect(estEnConstructionHl(reponse())).toBe(false);
    expect(estEnConstructionHl(null)).toBe(false);
    expect(estEnConstructionHl("en-construction")).toBe(false);
    expect(estEnConstructionHl({ enConstruction: "true" })).toBe(false);
    expect(estEnConstructionHl({ erreur: "pool d'adresses Hyperliquid indisponible" })).toBe(false);
  });

  it("le corps « en construction » n'est PAS une réponse de niveaux (mapper → null)", () => {
    // D'où l'ordre dans rafraichir : tester la construction AVANT de mapper, sinon « erreur ».
    expect(mapperReponseHl({ erreur: "instantané Hyperliquid en construction", enConstruction: true })).toBeNull();
  });

  it("relance courte : 30 s (Retry-After du daemon), bien sous le rafraîchissement de 4 min", () => {
    expect(RELANCE_CONSTRUCTION_MS).toBe(30_000);
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

// ───────── États transitoires du singleton (fetch en vol → « chargement ») ─────────

// Le fetch daemon est bloqué en vol : l'activation (ou le changement de coin) doit poser
// « chargement » — jamais « vide », qui mentirait (« aucun niveau ») pendant la lecture (au
// plus 15 s à froid, puis 503 « en construction »).
vi.mock("./daemon", () => ({
  hlLiqLevelsGet: vi.fn(() => new Promise(() => {})),
  daemonSupporteHl: () => true,
  kvPut: async () => 1,
}));

import { hlLiqStore, demarrerHyperliquidLiq } from "./hyperliquidLiq";
import { hlLiqLevelsGet } from "./daemon";

describe("sync — l'état transitoire dit la vérité", () => {
  it("activation avec fetch en vol → etat « chargement », pas « vide »", () => {
    demarrerHyperliquidLiq();
    hlLiqStore.getState().setActif(true);
    expect(hlLiqStore.getState().etat).toBe("chargement");
    hlLiqStore.getState().setActif(false);
  });
});

describe("sync — daemon « instantané en construction » (premier scan du pool)", () => {
  const EN_CONSTRUCTION = { erreur: "instantané Hyperliquid en construction", enConstruction: true };

  it("→ etat « chargement » (pas « erreur ») puis relance après ~30 s, au lieu des 4 min", async () => {
    vi.useFakeTimers();
    const lire = vi.mocked(hlLiqLevelsGet);
    try {
      lire.mockClear();
      lire.mockResolvedValueOnce(EN_CONSTRUCTION).mockResolvedValueOnce(reponse());
      demarrerHyperliquidLiq();
      hlLiqStore.getState().setActif(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(lire).toHaveBeenCalledTimes(1);
      expect(hlLiqStore.getState().etat).toBe("chargement");
      expect(hlLiqStore.getState().niveaux).toEqual([]);

      await vi.advanceTimersByTimeAsync(RELANCE_CONSTRUCTION_MS - 1);
      expect(lire).toHaveBeenCalledTimes(1); // pas avant le délai
      await vi.advanceTimersByTimeAsync(1);
      expect(lire).toHaveBeenCalledTimes(2);
      expect(hlLiqStore.getState().etat).toBe("ok");
      expect(hlLiqStore.getState().niveaux).toHaveLength(1);
      expect(hlLiqStore.getState().adressesScannees).toBe(250);
    } finally {
      hlLiqStore.getState().setActif(false);
      vi.useRealTimers();
    }
  });

  it("tant que le daemon construit : une relance toutes les ~30 s, arrêtée au OFF", async () => {
    vi.useFakeTimers();
    const lire = vi.mocked(hlLiqLevelsGet);
    try {
      lire.mockClear();
      lire.mockResolvedValue(EN_CONSTRUCTION);
      demarrerHyperliquidLiq();
      hlLiqStore.getState().setActif(true);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2 * RELANCE_CONSTRUCTION_MS);
      expect(lire).toHaveBeenCalledTimes(3);
      expect(hlLiqStore.getState().etat).toBe("chargement");

      hlLiqStore.getState().setActif(false);
      await vi.advanceTimersByTimeAsync(10 * RELANCE_CONSTRUCTION_MS);
      expect(lire).toHaveBeenCalledTimes(3); // relance annulée avec la couche
      expect(hlLiqStore.getState().etat).toBe("vide");
    } finally {
      lire.mockReset();
      lire.mockImplementation(() => new Promise(() => {}));
      hlLiqStore.getState().setActif(false);
      vi.useRealTimers();
    }
  });
});
