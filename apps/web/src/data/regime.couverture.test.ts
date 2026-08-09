/**
 * Couverture et fiabilité du régime composite (D1) + fraîcheur à seuils (D2) — trois
 * fonctions pures introduites par le lot D qui n'avaient aucun test (revue BCD).
 */
import { describe, expect, it } from "vitest";
import { calculerRegime, fiabiliteRegime, MIN_COMPOSANTS, type EntreesRegime } from "./regime";
import { etatFraicheur } from "../components/ui";

const TOUT_NULL: EntreesRegime = {
  directionBtc24hPct: null,
  fearGreed: null,
  fundingBtcPercentile: null,
  dvolBtcPercentile: null,
  volRealiseeBtcPercentile: null,
  fluxEtfJourUsd: null,
  impressionStablecoins7jPct: null,
  regimeGammaBtc: null,
};

describe("Regime.couverture", () => {
  it("compte 0 disponible quand toutes les sources sont en panne", () => {
    const r = calculerRegime(TOUT_NULL);
    expect(r.couverture).toEqual({ disponibles: 0, total: 8 });
    expect(r.libelle).toBe("indéterminé");
  });

  it("compte exactement les composants ayant répondu", () => {
    const r = calculerRegime({ ...TOUT_NULL, directionBtc24hPct: 1.5, fearGreed: 70 });
    expect(r.couverture).toEqual({ disponibles: 2, total: 8 });
  });

  it("le total reste 8 même à couverture pleine", () => {
    const r = calculerRegime({
      directionBtc24hPct: 1,
      fearGreed: 60,
      fundingBtcPercentile: 40,
      dvolBtcPercentile: 30,
      volRealiseeBtcPercentile: 20,
      fluxEtfJourUsd: 100_000_000,
      impressionStablecoins7jPct: 0.6,
      regimeGammaBtc: { regime: "long-gamma", gexNetUsd: 10_000_000 },
    });
    expect(r.couverture).toEqual({ disponibles: 8, total: 8 });
  });
});

describe("fiabiliteRegime", () => {
  it("complet quand tout a répondu", () => {
    expect(fiabiliteRegime({ disponibles: 8, total: 8 })).toBe("complet");
  });

  it("partiel dès qu'une source manque — le cas NOMINAL (allSettled)", () => {
    expect(fiabiliteRegime({ disponibles: 7, total: 8 })).toBe("partiel");
    expect(fiabiliteRegime({ disponibles: MIN_COMPOSANTS, total: 8 })).toBe("partiel");
  });

  it("insuffisant sous MIN_COMPOSANTS — le score serait du bruit", () => {
    expect(fiabiliteRegime({ disponibles: MIN_COMPOSANTS - 1, total: 8 })).toBe("insuffisant");
    expect(fiabiliteRegime({ disponibles: 0, total: 8 })).toBe("insuffisant");
  });
});

describe("etatFraicheur", () => {
  const CADENCE = 15 * 60_000; // 15 min
  const NOW = 1_700_000_000_000;

  it("inconnu sans horodatage", () => {
    expect(etatFraicheur(null, NOW, CADENCE)).toBe("inconnu");
    expect(etatFraicheur(Number.NaN, NOW, CADENCE)).toBe("inconnu");
  });

  it("frais dans la fenêtre de cadence (et jusqu'à ×1,5)", () => {
    expect(etatFraicheur(NOW - 3_000, NOW, CADENCE)).toBe("frais");
    expect(etatFraicheur(NOW - CADENCE, NOW, CADENCE)).toBe("frais");
    expect(etatFraicheur(NOW - CADENCE * 1.5, NOW, CADENCE)).toBe("frais");
  });

  it("attardé puis périmé quand le rafraîchissement ne suit plus", () => {
    expect(etatFraicheur(NOW - CADENCE * 2, NOW, CADENCE)).toBe("attardé");
    expect(etatFraicheur(NOW - CADENCE * 5, NOW, CADENCE)).toBe("périmé");
  });

  it("le seuil est RELATIF à la cadence : 5 min de retard n'alarme pas une source 15 min", () => {
    expect(etatFraicheur(NOW - 5 * 60_000, NOW, CADENCE)).toBe("frais");
    // …mais alarme une source temps réel (cadence 1 min par défaut).
    expect(etatFraicheur(NOW - 5 * 60_000, NOW, undefined)).toBe("périmé");
  });

  it("une horloge locale en avance ne déclenche pas d'alerte", () => {
    expect(etatFraicheur(NOW + 60_000, NOW, CADENCE)).toBe("frais");
  });
});
