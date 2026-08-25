/**
 * Tests des fonctions PURES du client WHALES : mapping des réponses daemon (mouvements +
 * positions HL) et agrégats d'affichage. Valeurs attendues justifiées en commentaire.
 */
import { describe, expect, it } from "vitest";
import {
  libelleBout,
  mapperReponsePositions,
  mapperReponseWhales,
  raccourcirAdresse,
  statsWhales,
  type MouvementWhale,
} from "./whales";

/** Mouvement valide minimal, surchargé par cas. */
function mouvement(over: Partial<MouvementWhale> = {}): MouvementWhale {
  return {
    id: "tx1",
    t: 1_755_000_000_000,
    chain: "btc",
    asset: "BTC",
    qty: 20,
    usd: 2_000_000,
    de: "1Emetteur",
    vers: "1Destinataire",
    deLabel: null,
    versLabel: null,
    direction: "inconnu",
    ...over,
  };
}

const sante = {
  btcWsConnecte: true,
  dernierTxBtcTs: 1,
  prixBtc: 100_000,
  dernierPollEthTs: 2,
  dernierBlocEth: 3,
  erreurEth: null,
  clePresente: false,
};

describe("mapperReponseWhales", () => {
  it("valide l'enveloppe et écarte les mouvements bancals UN À UN", () => {
    const brut = {
      mouvements: [mouvement(), { id: 42 }, mouvement({ direction: "ailleurs" as never }), null],
      sante,
    };
    const res = mapperReponseWhales(brut);
    expect(res?.mouvements).toEqual([mouvement()]);
    expect(res?.sante.prixBtc).toBe(100_000);
  });

  it("enveloppe non conforme → null (mouvements absents ou santé absente)", () => {
    expect(mapperReponseWhales(null)).toBeNull();
    expect(mapperReponseWhales({ mouvements: "x", sante })).toBeNull();
    expect(mapperReponseWhales({ mouvements: [] })).toBeNull();
  });

  it("santé partielle → valeurs de repli sûres (jamais de NaN/undefined)", () => {
    const res = mapperReponseWhales({ mouvements: [], sante: {} });
    expect(res?.sante).toEqual({
      btcWsConnecte: false,
      dernierTxBtcTs: 0,
      prixBtc: null,
      dernierPollEthTs: 0,
      dernierBlocEth: null,
      erreurEth: null,
      clePresente: false,
    });
  });
});

describe("mapperReponsePositions", () => {
  const position = { px: 31_000, side: "long", valueUsd: 400_000, entryPx: 65_000, lev: 3, addr: "0xa" };

  it("valide l'enveloppe, écarte les positions bancales, replis d'agrégats sûrs", () => {
    const res = mapperReponsePositions({
      ts: 5,
      coin: "BTC",
      adressesScannees: 150,
      agregats: { longUsd: 400_000, shortUsd: 0, nbLong: 1, nbShort: 0 },
      positions: [position, { px: "x" }, null],
    });
    expect(res?.positions).toEqual([position]);
    expect(res?.agregats.longUsd).toBe(400_000);
    // Agrégats absents → zéros (pas de NaN dans l'UI).
    const sansAgregats = mapperReponsePositions({ ts: 5, coin: "BTC", positions: [] });
    expect(sansAgregats?.agregats).toEqual({ longUsd: 0, shortUsd: 0, nbLong: 0, nbShort: 0 });
  });

  it("enveloppe non conforme → null", () => {
    expect(mapperReponsePositions(null)).toBeNull();
    expect(mapperReponsePositions({ ts: 5, coin: 42, positions: [] })).toBeNull();
    expect(mapperReponsePositions({ ts: 5, coin: "BTC", positions: "x" })).toBeNull();
  });
});

describe("statsWhales", () => {
  it("agrège dépôts/retraits, flux net vers exchanges, total et max", () => {
    const stats = statsWhales([
      mouvement({ usd: 5_000_000, direction: "depot" }),
      mouvement({ usd: 2_000_000, direction: "retrait" }),
      mouvement({ usd: 1_000_000, direction: "inconnu" }),
    ]);
    expect(stats).toEqual({
      depotUsd: 5_000_000,
      retraitUsd: 2_000_000,
      netExchangeUsd: 3_000_000, // 5 M déposés − 2 M retirés : offre potentielle
      totalUsd: 8_000_000,
      nb: 3,
      maxUsd: 5_000_000,
    });
  });

  it("lot vide → zéros (aucune division, aucun NaN)", () => {
    expect(statsWhales([])).toEqual({
      depotUsd: 0,
      retraitUsd: 0,
      netExchangeUsd: 0,
      totalUsd: 0,
      nb: 0,
      maxUsd: 0,
    });
  });
});

describe("raccourcirAdresse / libelleBout", () => {
  it("raccourcit tête…queue et laisse intactes les adresses courtes", () => {
    expect(raccourcirAdresse("0x28c6c06298d514db089934071355e5743bf21d60")).toBe("0x28c…1d60");
    expect(raccourcirAdresse("1Court")).toBe("1Court");
  });

  it("libelleBout privilégie l'étiquette exchange, sinon l'adresse courte", () => {
    expect(libelleBout("0x28c6c06298d514db089934071355e5743bf21d60", "Binance")).toBe("Binance");
    expect(libelleBout("0x28c6c06298d514db089934071355e5743bf21d60", null)).toBe("0x28c…1d60");
  });
});
