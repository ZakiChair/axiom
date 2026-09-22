/**
 * Tests des fonctions PURES du client « heatmap HL » (historique des niveaux de
 * liquidation RÉELS Hyperliquid collectés par le daemon, `GET /hl/liqheat/:coin`) :
 * mapping tolérant de la réponse, couverture mesurée, fusion d'instantanés et état.
 *
 * ⚠️ Couverture ÉCHANTILLONNÉE (top leaderboard), jamais exhaustive.
 */
import { describe, it, expect, vi } from "vitest";

// Les imports de fetch/daemon sont stubbés : les fonctions pures ne font aucun réseau.
// `hlGetSpy` pilote les réponses pour tester la garde anti-tempête d'`assurerHeat`.
const { hlGetSpy } = vi.hoisted(() => ({
  hlGetSpy: vi.fn(async (_coin: string, _opts?: { depuis?: number }): Promise<unknown> => null),
}));
vi.mock("./daemon", () => ({
  hlLiqHeatGet: hlGetSpy,
  daemonSupporteHl: () => false,
  kvPut: async () => null,
}));

import {
  assurerHeat,
  arreterHeat,
  couvertureOi,
  mapperReponseHeat,
  fusionnerInstantanes,
  deciderEtatHeat,
  type ReponseHeat,
  type InstantaneHlHeat,
} from "./hyperliquidHeat";

/** Instantané daemon minimal valide (niveaux en tuples compacts [px, side01, usd]). */
function instantane(partial: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ts: 1_700_000_000_000,
    niveaux: [
      [58_000, 0, 4_200_000],
      [62_000, 1, 1_000_000],
    ],
    longUsd: 4_200_000,
    shortUsd: 1_000_000,
    nLong: 3,
    nShort: 1,
    oiUsd: 40_000_000,
    adresses: 474,
    couverture: 0.065,
    ...partial,
  };
}

function reponse(partial: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    coin: "BTC",
    pas: 300_000,
    collecte: {
      actif: true,
      dernierInstantaneTs: 1_700_000_000_000,
      periodeMs: 300_000,
      retentionMs: 14 * 24 * 3_600_000,
      premierTs: 1_699_000_000_000,
    },
    instantanes: [instantane()],
    ...partial,
  };
}

describe("couvertureOi — fraction de l'OI couverte par l'échantillon", () => {
  it("applique (long + short) / (2 × oi)", () => {
    expect(couvertureOi(400, 100, 1000)).toBeCloseTo(0.25);
  });

  it("renvoie null si l'OI est absente ou non positive", () => {
    expect(couvertureOi(10, 10, null)).toBeNull();
    expect(couvertureOi(10, 10, 0)).toBeNull();
    expect(couvertureOi(10, 10, -5)).toBeNull();
    expect(couvertureOi(10, 10, Number.NaN)).toBeNull();
  });

  it("borne le résultat à [0, 1]", () => {
    expect(couvertureOi(2000, 2000, 100)).toBe(1);
    expect(couvertureOi(-100, 0, 1000)).toBe(0);
  });
});

describe("mapperReponseHeat — réponse daemon → instantanés typés", () => {
  it("mappe une réponse conforme au contrat (tuples → niveaux typés)", () => {
    const out = mapperReponseHeat(reponse());
    expect(out).not.toBeNull();
    expect(out?.coin).toBe("BTC");
    expect(out?.pas).toBe(300_000);
    expect(out?.collecte.actif).toBe(true);
    expect(out?.instantanes).toHaveLength(1);
    expect(out?.instantanes[0]?.niveaux).toEqual([
      { px: 58_000, side: "long", usd: 4_200_000 },
      { px: 62_000, side: "short", usd: 1_000_000 },
    ]);
    expect(out?.instantanes[0]?.couverture).toBe(0.065);
  });

  it("renvoie null sur une enveloppe non conforme", () => {
    expect(mapperReponseHeat(null)).toBeNull();
    expect(mapperReponseHeat("BTC")).toBeNull();
    expect(mapperReponseHeat({})).toBeNull();
    expect(mapperReponseHeat({ ...reponse(), instantanes: "nope" })).toBeNull();
    expect(mapperReponseHeat({ ...reponse(), collecte: { actif: "oui" } })).toBeNull();
    expect(mapperReponseHeat({ ...reponse(), coin: 42 })).toBeNull();
  });

  it("écarte les niveaux mal formés UN À UN sans jeter l'instantané", () => {
    const out = mapperReponseHeat(
      reponse({
        instantanes: [
          instantane({
            niveaux: [
              [58_000, 0, 4_200_000],
              [Number.NaN, 0, 10],
              [100, 2, 10], // side hors 0-1
              [100, 1], // tuple tronqué
              [100, 1, "beaucoup"],
            ],
          }),
        ],
      }),
    );
    expect(out?.instantanes[0]?.niveaux).toEqual([{ px: 58_000, side: "long", usd: 4_200_000 }]);
  });

  it("écarte les instantanés à l'enveloppe bancale, garde les sains", () => {
    const out = mapperReponseHeat(
      reponse({ instantanes: [instantane(), { ts: "hier" }, { ts: 5, niveaux: "nope" }, null] }),
    );
    expect(out?.instantanes).toHaveLength(1);
  });

  it("recalcule `couverture` localement quand le daemon ne la fournit pas", () => {
    const out = mapperReponseHeat(reponse({ instantanes: [instantane({ couverture: undefined })] }));
    // (4,2 M + 1 M) / (2 × 40 M) = 0,065
    expect(out?.instantanes[0]?.couverture).toBeCloseTo(0.065);
  });

  it("accepte une collecte inactive et une liste vide", () => {
    const out = mapperReponseHeat(
      reponse({ collecte: { ...reponse().collecte as object, actif: false }, instantanes: [] }),
    );
    expect(out?.collecte.actif).toBe(false);
    expect(out?.instantanes).toEqual([]);
  });
});

describe("fusionnerInstantanes — dédoublonnage par ts, le nouveau écrase", () => {
  const snap = (ts: number, adresses = 1): InstantaneHlHeat => ({
    ts,
    niveaux: [],
    longUsd: 0,
    shortUsd: 0,
    nLong: 0,
    nShort: 0,
    oiUsd: null,
    adresses,
    couverture: null,
  });

  it("fusionne, trie croissant et dédoublonne par ts", () => {
    const anciens = [snap(3), snap(1)];
    const nouveaux = [snap(2), snap(3, 99)];
    const out = fusionnerInstantanes(anciens, nouveaux);
    expect(out.map((s) => s.ts)).toEqual([1, 2, 3]);
    // Le nouvel instantané remplace l'ancien à ts égal (donnée plus fraîche).
    expect(out[2]?.adresses).toBe(99);
  });
});

describe("deciderEtatHeat — état affiché de la couche", () => {
  const rep: ReponseHeat = mapperReponseHeat(reponse()) as ReponseHeat;
  const repInactif: ReponseHeat = {
    ...rep,
    collecte: { ...rep.collecte, actif: false },
  };

  it("capability absente → « sans-daemon », même avec une réponse", () => {
    expect(deciderEtatHeat(false, rep, 3)).toBe("sans-daemon");
    expect(deciderEtatHeat(false, null, 0)).toBe("sans-daemon");
  });

  it("daemon présent mais réponse illisible → « erreur »", () => {
    expect(deciderEtatHeat(true, null, 0)).toBe("erreur");
  });

  it("collecte inactive ET aucun instantané → « inactif »", () => {
    expect(deciderEtatHeat(true, repInactif, 0)).toBe("inactif");
  });

  it("collecte active mais aucun instantané → « vide »", () => {
    expect(deciderEtatHeat(true, rep, 0)).toBe("vide");
  });

  it("des instantanés → « ok »", () => {
    expect(deciderEtatHeat(true, rep, 2)).toBe("ok");
    // Collecte arrêtée MAIS historique présent : on affiche les instantanés existants.
    expect(deciderEtatHeat(true, repInactif, 2)).toBe("ok");
  });
});

// ───────── assurerHeat — garde anti-tempête (une requête en vol, backoff 30 s) ─────────

import { beforeEach } from "vitest";

describe("assurerHeat — verrou et backoff", () => {
  beforeEach(() => {
    arreterHeat();
    hlGetSpy.mockReset();
  });

  it("demande plus ancienne pendant le vol : UN fetch, puis le complément à la résolution", async () => {
    const enVol: Array<(v: unknown) => void> = [];
    hlGetSpy.mockImplementation(
      () => new Promise<unknown>((res) => { enVol.push(res); }),
    );

    assurerHeat({ coin: "BTC", pasMs: 300_000, depuisMs: 1_000_000 });
    // Deux reculs pendant le vol : mémorisés (borne min), AUCUN fetch supplémentaire.
    assurerHeat({ coin: "BTC", pasMs: 300_000, depuisMs: 800_000 });
    assurerHeat({ coin: "BTC", pasMs: 300_000, depuisMs: 500_000 });
    expect(hlGetSpy).toHaveBeenCalledTimes(1);

    enVol[0]?.(reponse()); // premier fetch résout : chargeDepuis = 1 000 000
    await vi.waitFor(() => expect(hlGetSpy).toHaveBeenCalledTimes(2));
    // Le complément couvre la borne la plus ANCIENNE mémorisée (500 000).
    const opts = hlGetSpy.mock.calls[1]?.[1];
    expect(opts?.depuis).toBe(500_000);
    enVol[1]?.(reponse()); // purge le vol (sinon `chargementEnCours` fuit au test suivant)
    await vi.waitFor(() => expect(enVol.length).toBe(2));
    arreterHeat();
  });

  it("réponse null (daemon KO) → backoff 30 s avant tout réessai", async () => {
    vi.useFakeTimers();
    try {
      hlGetSpy.mockResolvedValue(null);
      assurerHeat({ coin: "BTC", pasMs: 300_000, depuisMs: 1_000_000 });
      await vi.advanceTimersByTimeAsync(0);
      expect(hlGetSpy).toHaveBeenCalledTimes(1);

      // Nouvelle cible dans la fenêtre de backoff → aucun fetch.
      assurerHeat({ coin: "ETH", pasMs: 300_000, depuisMs: 1_000_000 });
      await vi.advanceTimersByTimeAsync(0);
      expect(hlGetSpy).toHaveBeenCalledTimes(1);

      // Après 30 s → réessai autorisé.
      vi.advanceTimersByTime(31_000);
      assurerHeat({ coin: "SOL", pasMs: 300_000, depuisMs: 1_000_000 });
      await vi.advanceTimersByTimeAsync(0);
      expect(hlGetSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
      arreterHeat();
    }
  });
});
