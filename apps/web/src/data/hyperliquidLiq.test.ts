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
  deciderModeHl,
  estEnConstructionHl,
  executerCommandeLiqHl,
  presentationCommandeLiqHl,
  REFRESH_MS,
  RELANCE_CONSTRUCTION_MS,
  SONDE_RETOUR_DAEMON_MS,
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

describe("deciderModeHl — daemon ou scan navigateur", () => {
  it("Vercel → navigateur, même si une capability était annoncée", () => {
    expect(deciderModeHl(true, false)).toBe("navigateur");
    expect(deciderModeHl(true, true)).toBe("navigateur");
  });
  it("local : daemon s'il annonce `hl`, sinon repli navigateur", () => {
    expect(deciderModeHl(false, true)).toBe("daemon");
    expect(deciderModeHl(false, false)).toBe("navigateur");
  });
});

describe("commande LIQHL (plus UNUSABLE sur Vercel : scan direct depuis le navigateur)", () => {
  it("libellé identique partout, sans UNUSABLE ; l'aperçu Vercel annonce l'échantillon et la limite", () => {
    const vercel = presentationCommandeLiqHl(true);
    const local = presentationCommandeLiqHl(false);
    expect(vercel.libelle).toBe(local.libelle);
    expect(`${vercel.libelle} ${vercel.apercu}`).not.toContain("UNUSABLE");
    expect(vercel.apercu).toContain("navigateur");
    expect(vercel.apercu).toContain("~1 500 adresses");
    expect(vercel.apercu).toContain("historique réservé au daemon");
    expect(vercel.apercu).not.toMatch(/toutes les liquidations/i); // honnêteté : un échantillon
    expect(local.apercu).toContain("daemon axiomd");
  });

  it("Vercel : active la couche et annonce le scan navigateur à l'activation seulement", () => {
    let actif = false;
    const basculer = vi.fn(() => {
      actif = !actif;
    });
    const notifier = vi.fn();
    executerCommandeLiqHl(true, basculer, notifier, () => actif);
    expect(basculer).toHaveBeenCalledOnce();
    expect(notifier).toHaveBeenCalledOnce();
    expect(notifier.mock.calls[0]?.[0]).toContain("navigateur");
    expect(notifier.mock.calls[0]?.[0]).toContain("≈ 4 min");
    executerCommandeLiqHl(true, basculer, notifier, () => actif); // désactivation : silencieuse
    expect(basculer).toHaveBeenCalledTimes(2);
    expect(notifier).toHaveBeenCalledOnce();
  });

  it("local : bascule sans toast", () => {
    const basculer = vi.fn();
    const notifier = vi.fn();
    executerCommandeLiqHl(false, basculer, notifier, () => true);
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
  daemonSupporteHl: vi.fn(() => true),
  detectDaemon: vi.fn(async () => false),
  kvPut: async () => 1,
}));

// Scanner navigateur factice (chunk paresseux) : capte la fonction de publication.
const nav = vi.hoisted(() => ({
  scanner: { demarrer: vi.fn(), definirCoin: vi.fn(), arreter: vi.fn(), attendreCycle: vi.fn(async () => {}) },
  publier: null as null | ((p: unknown) => void),
}));
vi.mock("./hyperliquidLiqNavigateur", () => ({
  scannerNavigateurHl: (publier: (p: unknown) => void) => {
    nav.publier = publier;
    return nav.scanner;
  },
}));

import { hlLiqStore, demarrerHyperliquidLiq } from "./hyperliquidLiq";
import { daemonSupporteHl, detectDaemon, hlLiqLevelsGet } from "./daemon";
import { marketStore } from "../store/market";

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

describe("sync — local SANS daemon : repli sur le scan navigateur", () => {
  it("daemon absent (null + capability `hl` absente) → scanner navigateur démarré, source « navigateur »", async () => {
    const lire = vi.mocked(hlLiqLevelsGet);
    const capa = vi.mocked(daemonSupporteHl);
    try {
      lire.mockReset();
      lire.mockResolvedValue(null);
      capa.mockReturnValue(false);
      nav.scanner.demarrer.mockClear();
      nav.scanner.definirCoin.mockClear();
      nav.scanner.arreter.mockClear();
      demarrerHyperliquidLiq();
      hlLiqStore.getState().setActif(true);
      await vi.waitFor(() => expect(nav.scanner.demarrer).toHaveBeenCalledOnce());
      expect(lire).toHaveBeenCalledOnce(); // le daemon est tenté d'abord (mode daemon inchangé)
      expect(hlLiqStore.getState().source).toBe("navigateur");
      expect(hlLiqStore.getState().etat).toBe("chargement"); // jamais « nécessite le daemon »

      // Publication du scanner → store (même forme que le mode daemon + progression).
      nav.publier?.({ etat: "ok", niveaux: reponse().niveaux, ts: 42, adressesScannees: 40, progression: { faites: 40, total: 1500 } });
      expect(hlLiqStore.getState()).toMatchObject({
        etat: "ok",
        ts: 42,
        adressesScannees: 40,
        source: "navigateur",
        progression: { faites: 40, total: 1500 },
      });

      // Changement de symbole : republié par le scanner, AUCUN appel daemon ni nouveau scan.
      marketStore.getState().setSymbol("ETHUSDT");
      expect(nav.scanner.definirCoin).toHaveBeenLastCalledWith("ETH");
      expect(nav.scanner.demarrer).toHaveBeenCalledOnce();
      expect(lire).toHaveBeenCalledOnce();

      // OFF : scanner arrêté, store remis à zéro (source daemon par défaut, sans progression).
      hlLiqStore.getState().setActif(false);
      expect(nav.scanner.arreter).toHaveBeenCalledOnce();
      expect(hlLiqStore.getState()).toMatchObject({ etat: "vide", source: "daemon", progression: null, niveaux: [] });
      nav.publier?.({ etat: "ok", niveaux: reponse().niveaux, ts: 43, adressesScannees: 1, progression: null });
      expect(hlLiqStore.getState().etat).toBe("vide"); // publication tardive ignorée après OFF
    } finally {
      capa.mockReturnValue(true);
      lire.mockReset();
      lire.mockImplementation(() => new Promise(() => {}));
      hlLiqStore.getState().setActif(false);
    }
  });

  it("daemon absent puis REVENU (`hl` annoncée) → la couche lui revient en moins de REFRESH_MS, scanner arrêté", async () => {
    // Relecture du 25/09 : une seule sonde ratée (redémarrage d'axiomd) laissait la couche au
    // navigateur jusqu'au OFF — scan de la page + collecteur du daemon sur la même IP.
    vi.useFakeTimers();
    const lire = vi.mocked(hlLiqLevelsGet);
    const capa = vi.mocked(daemonSupporteHl);
    const detecter = vi.mocked(detectDaemon);
    try {
      expect(SONDE_RETOUR_DAEMON_MS).toBeLessThan(REFRESH_MS);
      lire.mockReset();
      lire.mockResolvedValue(null);
      capa.mockReturnValue(false);
      detecter.mockReset();
      detecter.mockResolvedValue(false);
      nav.scanner.demarrer.mockClear();
      nav.scanner.arreter.mockClear();
      demarrerHyperliquidLiq();
      hlLiqStore.getState().setActif(true);
      await vi.waitFor(() => expect(nav.scanner.demarrer).toHaveBeenCalledOnce());
      expect(hlLiqStore.getState().source).toBe("navigateur");

      // Daemon toujours absent : la sonde tourne, la couche reste au navigateur.
      await vi.advanceTimersByTimeAsync(3 * SONDE_RETOUR_DAEMON_MS);
      expect(detecter).toHaveBeenCalledTimes(3);
      expect(detecter).toHaveBeenLastCalledWith("hl");
      expect(nav.scanner.arreter).not.toHaveBeenCalled();
      expect(lire).toHaveBeenCalledOnce();

      // Le daemon revient et annonce `hl` : prochaine sonde → voie daemon, scanner arrêté.
      detecter.mockResolvedValue(true);
      capa.mockReturnValue(true);
      lire.mockResolvedValue(reponse());
      await vi.advanceTimersByTimeAsync(SONDE_RETOUR_DAEMON_MS);
      expect(nav.scanner.arreter).toHaveBeenCalledOnce();
      expect(lire).toHaveBeenCalledTimes(2);
      expect(hlLiqStore.getState()).toMatchObject({ etat: "ok", source: "daemon", progression: null, adressesScannees: 250 });
      nav.publier?.({ etat: "ok", niveaux: [], ts: 1, adressesScannees: 7, progression: { faites: 7, total: 1500 } });
      expect(hlLiqStore.getState().adressesScannees).toBe(250); // publication tardive du scanner ignorée

      // Mode daemon rétabli tel quel : plus de sonde de retour, rafraîchissement 4 min.
      detecter.mockClear();
      await vi.advanceTimersByTimeAsync(REFRESH_MS);
      expect(detecter).not.toHaveBeenCalled();
      expect(lire).toHaveBeenCalledTimes(3);
    } finally {
      detecter.mockReset();
      detecter.mockResolvedValue(false);
      capa.mockReturnValue(true);
      lire.mockReset();
      lire.mockImplementation(() => new Promise(() => {}));
      hlLiqStore.getState().setActif(false);
      vi.useRealTimers();
    }
  });

  it("repli local puis OFF (même pendant une sonde en vol) → sonde arrêtée, aucun retour au daemon", async () => {
    vi.useFakeTimers();
    const lire = vi.mocked(hlLiqLevelsGet);
    const capa = vi.mocked(daemonSupporteHl);
    const detecter = vi.mocked(detectDaemon);
    try {
      lire.mockReset();
      lire.mockResolvedValue(null);
      capa.mockReturnValue(false);
      let repondre: (present: boolean) => void = () => {};
      detecter.mockReset();
      detecter.mockImplementation(() => new Promise<boolean>((r) => (repondre = r)));
      nav.scanner.demarrer.mockClear();
      nav.scanner.arreter.mockClear();
      demarrerHyperliquidLiq();
      hlLiqStore.getState().setActif(true);
      await vi.waitFor(() => expect(nav.scanner.demarrer).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(SONDE_RETOUR_DAEMON_MS);
      expect(detecter).toHaveBeenCalledOnce(); // sonde en vol…
      hlLiqStore.getState().setActif(false); // … la couche passe à OFF…
      capa.mockReturnValue(true);
      repondre(true); // … puis le daemon répond présent : rien ne doit repartir.
      await vi.advanceTimersByTimeAsync(10 * SONDE_RETOUR_DAEMON_MS);
      expect(detecter).toHaveBeenCalledOnce();
      expect(lire).toHaveBeenCalledOnce();
      expect(nav.scanner.arreter).toHaveBeenCalledOnce(); // par le OFF seul : la sonde tardive ne fait rien
      expect(hlLiqStore.getState()).toMatchObject({ actif: false, etat: "vide", source: "daemon" });
    } finally {
      detecter.mockReset();
      detecter.mockResolvedValue(false);
      capa.mockReturnValue(true);
      lire.mockReset();
      lire.mockImplementation(() => new Promise(() => {}));
      hlLiqStore.getState().setActif(false);
      vi.useRealTimers();
    }
  });

  it("daemon présent mais réponse en échec (capability `hl` annoncée) → « erreur », PAS de repli", async () => {
    const lire = vi.mocked(hlLiqLevelsGet);
    try {
      lire.mockReset();
      lire.mockResolvedValue(null);
      nav.scanner.demarrer.mockClear();
      demarrerHyperliquidLiq();
      hlLiqStore.getState().setActif(true);
      await vi.waitFor(() => expect(hlLiqStore.getState().etat).toBe("erreur"));
      expect(hlLiqStore.getState().source).toBe("daemon");
      expect(nav.scanner.demarrer).not.toHaveBeenCalled();
    } finally {
      lire.mockReset();
      lire.mockImplementation(() => new Promise(() => {}));
      hlLiqStore.getState().setActif(false);
    }
  });
});
