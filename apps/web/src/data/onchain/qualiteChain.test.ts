import { describe, expect, it } from "vitest";
import { motifPeremptionBg, qualiteBgeometrics, qualiteReseauEthCm, qualitesCoinMetrics, qualitePublicationEtf, qualiteTresoreriesBtc, traiterPublicationEtfChain, type ValeurPublicationEtf } from "./qualiteChain";
import type { ReseauEthCm } from "./reseauEthCm";
import type { TresoreriesBtc } from "./tresoreriesBtc";
import { BG_MVRV, BG_NUPL, BG_PUELL, BG_RESERVE_RISK, BG_SOPR } from "./bgeometrics";
import { actualiserQualite, type QualiteMetrique } from "../qualiteMetrique";

const JOUR = 86_400_000;
const NOW = Date.UTC(2026, 8, 9, 12);

describe("publication qualité Coin Metrics", () => {
  it("déclare chaque métrique vide indisponible au lieu de marquer le bloc frais", () => {
    const entrees = qualitesCoinMetrics({ series: { AdrActCnt: { points: [] }, TxCnt: { points: [] } }, ts: NOW, perime: false }, NOW);
    expect(entrees.map((e) => e.qualite.statut)).toEqual(["indisponible", "indisponible"]);
    expect(entrees.every((e) => e.qualite.observeLe === null)).toBe(true);
  });

  it("isole une métrique ancienne d'une métrique récente et ignore un point futur", () => {
    const entrees = qualitesCoinMetrics({ series: {
      AdrActCnt: { points: [{ time: NOW - 10 * JOUR, value: 1 }], dernier: { time: NOW - 10 * JOUR, value: 1 } },
      TxCnt: { points: [{ time: NOW - JOUR, value: 2 }, { time: NOW + JOUR, value: 3 }], dernier: { time: NOW + JOUR, value: 3 } },
    }, ts: NOW - 1000, perime: false }, NOW);
    expect(entrees.find((e) => e.id === "AdrActCnt")?.qualite.statut).toBe("perime");
    expect(entrees.find((e) => e.id === "TxCnt")?.qualite.observeLe).toBe(NOW - JOUR);
    expect(entrees.find((e) => e.id === "TxCnt")?.qualite.raison).toContain("future");
  });
});

describe("publication qualité BGeometrics (Valorisation)", () => {
  const serie = (time: number, n = 25) => {
    const points = Array.from({ length: n }, (_, i) => ({ time: time - (n - 1 - i) * JOUR, value: i }));
    return { points, dernier: points.at(-1) };
  };

  it("source en retard : donnée récupérée maintenant, ni cache ni repli, raison datée en UTC", () => {
    // 23 h 30 UTC : le 07/09 en UTC, déjà le 08/09 à Paris.
    const q = qualiteBgeometrics({ serie: serie(Date.UTC(2026, 8, 7, 23, 30)), ts: NOW, perime: true, repli: false }, undefined, true, NOW, BG_MVRV);
    expect(q.sourceEffective).toBe("BGeometrics");
    expect(q.statut).toBe("perime");
    expect(q.raison).toBe("Dernière observation publiée par BGeometrics : 07/09/2026 (source en retard).");
    expect(q.acces).toBe("cle");
  });

  it("embargo de l'offre gratuite : raison dédiée datée en UTC, source et statut inchangés", () => {
    // 23 h 30 UTC : le 01/09 en UTC, déjà le 02/09 à Paris ; âge 7,5 j.
    const q = qualiteBgeometrics({ serie: serie(Date.UTC(2026, 8, 1, 23, 30)), ts: NOW, perime: true, repli: false }, undefined, true, NOW, BG_MVRV);
    expect(q.sourceEffective).toBe("BGeometrics");
    expect(q.statut).toBe("perime");
    expect(q.raison).toBe("Offre gratuite BGeometrics : les 7 derniers jours sont réservés aux abonnés (dernière observation accessible : 01/09/2026).");
  });

  it("valeur resservie après échec : cache BGeometrics, sans raison « source en retard »", () => {
    const q = qualiteBgeometrics({ serie: serie(NOW - JOUR), ts: NOW - 30 * 3600_000, perime: true, repli: true }, undefined, true, NOW, BG_MVRV);
    expect(q.sourceEffective).toBe("cache BGeometrics");
    expect(q.statut).toBe("perime");
    expect(q.raison ?? "").not.toContain("source en retard");
  });

  it("frais sans raison ; absent indisponible avec motif", () => {
    const frais = qualiteBgeometrics({ serie: serie(NOW - JOUR), ts: NOW, perime: false, repli: false }, undefined, false, NOW, BG_MVRV);
    expect(frais).toMatchObject({ sourceEffective: "BGeometrics", statut: "frais", acces: "public" });
    expect(frais.raison).toBeUndefined();
    const absent = qualiteBgeometrics(null, undefined, true, NOW, BG_MVRV);
    expect(absent).toMatchObject({ statut: "indisponible", acces: "indisponible", recupereLe: NOW });
    expect(absent.raison).toContain("indisponible");
  });
});

describe("motif de péremption BGeometrics (badge et raison)", () => {
  const resultat = (ageJours: number, perime: boolean, repli = false) => {
    const dernier = { time: NOW - ageJours * JOUR, value: 1 };
    return { serie: { points: [dernier], dernier }, ts: NOW, perime, repli };
  };

  it("embargo posé uniquement sur MVRV Z-Score, SOPR, NUPL et Puell", () => {
    expect([BG_MVRV, BG_SOPR, BG_NUPL, BG_PUELL].every((def) => def.embargo === true)).toBe(true);
    expect(BG_RESERVE_RISK.embargo).toBeUndefined();
  });

  it("cache resservi : « cache », même pour une métrique sous embargo à 7 j", () => {
    expect(motifPeremptionBg(resultat(7, true, true), BG_MVRV)).toBe("cache");
  });

  it.each([7, 8.2, 6, 9])("métrique sous embargo observée il y a %s j : « embargo »", (age) => {
    expect(motifPeremptionBg(resultat(age, true), BG_MVRV)).toBe("embargo");
  });

  it.each([4, 12])("métrique sous embargo observée il y a %s j : « retard »", (age) => {
    expect(motifPeremptionBg(resultat(age, true), BG_MVRV)).toBe("retard");
  });

  it("cache frais écrit avant la mise à jour de 05 h UTC, consulté 20 h 30 plus tard : toujours « embargo »", () => {
    // Appel abouti le 15/09 à 04:30 UTC : dernier point accessible le 07/09 00:00 (8,19 j) ; consulté le 16/09 à 01:00 (9,04 j).
    const dernier = { time: Date.UTC(2026, 8, 7), value: 1 };
    const cacheFrais = { serie: { points: [dernier], dernier }, ts: Date.UTC(2026, 8, 15, 4, 30), perime: true, repli: false };
    const consultation = Date.UTC(2026, 8, 16, 1, 0);
    expect(motifPeremptionBg(cacheFrais, BG_MVRV)).toBe("embargo");
    expect(qualiteBgeometrics(cacheFrais, undefined, true, consultation, BG_MVRV).raison).toBe(
      "Offre gratuite BGeometrics : les 7 derniers jours sont réservés aux abonnés (dernière observation accessible : 07/09/2026).",
    );
  });

  it("métrique sans embargo (Reserve Risk) observée il y a 7 j : « retard »", () => {
    expect(motifPeremptionBg(resultat(7, true), BG_RESERVE_RISK)).toBe("retard");
  });

  it("donnée fraîche ou absente : aucun motif", () => {
    expect(motifPeremptionBg(resultat(1, false), BG_MVRV)).toBeNull();
    expect(motifPeremptionBg(null, BG_MVRV)).toBeNull();
  });
});

describe("publication qualité ETF CHAIN", () => {
  it("conserve la règle des cinq jours entiers jusqu'au changement de jour UTC", () => {
    const observation = Date.UTC(2026, 8, 4);
    const q = qualitePublicationEtf("btc", { actif: "btc", principal: {
      disponible: true, total: 100, jour: "2026-09-04", recupereLe: NOW,
    }, repli: null }, undefined, undefined, NOW);
    expect(q.statut).toBe("frais");
    expect(actualiserQualite(q, observation + 6 * JOUR - 1).statut).toBe("frais");
    expect(actualiserQualite(q, observation + 6 * JOUR).statut).toBe("perime");
  });
  const precedente: QualiteMetrique = {
    sourceId: "sosovalue", sourceEffective: "cache SoSoValue", observeLe: NOW - 10 * JOUR,
    recupereLe: NOW - 9 * JOUR, cadenceMs: JOUR, couverture: null, estime: false, acces: "cle", statut: "perime",
  };

  it("un timeout marque la source en panne tout en conservant les dates de l'ancienne lecture", () => {
    const q = qualitePublicationEtf("btc", null, "Délai réseau dépassé", precedente, NOW);
    expect(q.statut).toBe("indisponible");
    expect(q.observeLe).toBe(precedente.observeLe);
    expect(q.recupereLe).toBe(precedente.recupereLe);
    expect(q.raison).toContain("Délai réseau dépassé");
  });

  it("la branche intégrée conserve la valeur affichée et remplace toujours sa qualité après timeout", () => {
    const valeursAffichees: ValeurPublicationEtf[] = [];
    let qualite: QualiteMetrique | undefined;
    const succes = { actif: "btc" as const, principal: { disponible: true, total: 100, jour: "2026-09-08", recupereLe: NOW - 1000 }, repli: null };
    traiterPublicationEtfChain({ actif: "btc", valeur: succes, erreur: undefined, precedente: undefined, now: NOW,
      appliquerValeur: (v) => { valeursAffichees.push(v); }, appliquerQualite: (q) => { qualite = q; } });
    traiterPublicationEtfChain({ actif: "btc", valeur: null, erreur: "Délai réseau dépassé", precedente: qualite, now: NOW + 60_000,
      appliquerValeur: (v) => { valeursAffichees.push(v); }, appliquerQualite: (q) => { qualite = q; } });
    expect(valeursAffichees).toHaveLength(1);
    expect(valeursAffichees[0]?.principal.total).toBe(100);
    expect(qualite?.statut).toBe("indisponible");
    expect(qualite?.observeLe).toBe(Date.UTC(2026, 8, 8));
    expect(qualite?.recupereLe).toBe(NOW - 1000);
  });

  it.each([
    [false, "BGeometrics (repli)"],
    [true, "cache BGeometrics (repli)"],
  ] as const)("repli BTC resservi=%s : source effective %s, statut périmé inchangé", (estRepli, source) => {
    const dernier = { time: NOW - 10 * JOUR, value: 5 };
    const q = qualitePublicationEtf("btc", { actif: "btc", principal: { disponible: false, raison: "SoSoValue HS" },
      repli: { serie: { points: [dernier], dernier }, ts: NOW - 1000, perime: true, repli: estRepli } }, undefined, undefined, NOW);
    expect(q.sourceEffective).toBe(source);
    expect(q.statut).toBe("perime");
  });

  it.each([
    [false, "partiel"],
    [true, "perime"],
  ] as const)("repli BTC observé il y a 4 j (lendemain de week-end), resservi=%s : statut %s selon la règle ETF de 5 jours", (estRepli, statut) => {
    const dernier = { time: NOW - 4 * JOUR, value: 5 };
    // `perime` vaut true dès 3 jours côté BGeometrics ; seule la séance ETF (5 j) ou un cache resservi compte ici.
    const q = qualitePublicationEtf("btc", { actif: "btc", principal: { disponible: false, raison: "SoSoValue HS" },
      repli: { serie: { points: [dernier], dernier }, ts: NOW - 1000, perime: true, repli: estRepli } }, undefined, undefined, NOW);
    expect(q.statut).toBe(statut);
  });

  it.each([
    [undefined, "partiel"],
    ["date-invalide", "partiel"],
    ["2026-09-10", "partiel"],
    ["2026-09-01", "perime"],
  ] as const)("date %s produit le statut %s", (jour, statut) => {
    const q = qualitePublicationEtf("btc", { actif: "btc", principal: {
      disponible: true, total: 10, ...(jour === undefined ? {} : { jour }), recupereLe: NOW - 1000,
    }, repli: null }, undefined, undefined, NOW);
    expect(q.statut).toBe(statut);
    expect(q.recupereLe).toBe(NOW - 1000);
  });
});

describe("publication qualité Réseau ETH · Coin Metrics", () => {
  const reseau = (surcharge: Partial<ReseauEthCm> = {}): ReseauEthCm => ({
    reserve: { stockEth: 15_451_535, partOffrePct: 12.66, observeLe: NOW - JOUR, variations: [] },
    fluxNet: [{ time: NOW - JOUR, value: -11_744 }],
    emission: { pctAn7: 0.874, pctAn30: 0.867, pctAn365: 0.813, fraisTotaux30Eth: 5_174.6, observeLe: NOW - JOUR },
    prixRealise: { prixRealiseUsd: 2_263.72, spotCmUsd: 2_475.49, ecartSpotPct: 9.35, mvrv: 1.0935, observeLe: NOW - JOUR },
    flash: true,
    derniereObservation: NOW - JOUR,
    ...surcharge,
  });

  it("frais avec statut flash : quatre blocs, raison de révision, source Coin Metrics", () => {
    const q = qualiteReseauEthCm({ donnee: reseau(), ts: NOW - 1000, perime: false }, undefined, NOW);
    expect(q).toMatchObject({
      sourceId: "coinmetrics", sourceEffective: "Coin Metrics Community", observeLe: NOW - JOUR, recupereLe: NOW - 1000,
      cadenceMs: JOUR, ageMaxMs: 3 * JOUR, couverture: { disponibles: 4, attendus: 4 }, estime: false, acces: "public", statut: "frais",
    });
    expect(q.raison).toContain("Statut flash Coin Metrics");
    expect(q.raison).toContain("périmètre d'adresses révisable");
    expect(q.raison).not.toContain("brûl");
  });

  it("cache périmé ou observation de plus de 3 jours : périmé", () => {
    const cache = qualiteReseauEthCm({ donnee: reseau({ flash: false }), ts: NOW - 8 * 3_600_000, perime: true }, undefined, NOW);
    expect(cache).toMatchObject({ sourceEffective: "cache Coin Metrics", statut: "perime" });
    const vieux = qualiteReseauEthCm({ donnee: reseau({ derniereObservation: NOW - 4 * JOUR }), ts: NOW, perime: false }, undefined, NOW);
    expect(vieux.statut).toBe("perime");
  });

  it("blocs manquants : partiel avec la couverture réelle", () => {
    const q = qualiteReseauEthCm({ donnee: reseau({
      reserve: null, fluxNet: [], prixRealise: { prixRealiseUsd: null, spotCmUsd: null, ecartSpotPct: null, mvrv: null, observeLe: null },
    }), ts: NOW, perime: false }, undefined, NOW);
    expect(q).toMatchObject({ statut: "partiel", couverture: { disponibles: 1, attendus: 4 } });
  });

  it("aucun résultat : indisponible avec motif, erreur du chargeur prioritaire", () => {
    const q = qualiteReseauEthCm(null, undefined, NOW);
    expect(q).toMatchObject({ statut: "indisponible", acces: "indisponible", observeLe: null, recupereLe: null, couverture: null });
    expect(q.raison).toContain("Coin Metrics ETH indisponible");
    expect(qualiteReseauEthCm(null, "Délai réseau dépassé", NOW).raison).toBe("Délai réseau dépassé");
  });
});

describe("publication qualité Trésoreries BTC · CoinGecko", () => {
  const donnee: TresoreriesBtc = {
    totalBtc: 1_000,
    valeurUsd: 80_000_000,
    societes: [
      { nom: "Strategy", symbole: "MSTR.US", avoirsBtc: 800, coutTotalUsd: 60_000_000 },
      { nom: "Sans coût", symbole: "S.US", avoirsBtc: 150, coutTotalUsd: null },
      { nom: "Autre", symbole: "A.US", avoirsBtc: 50, coutTotalUsd: 4_000_000 },
    ],
  };

  it("jamais « frais » : avoirs non horodatés, observation inconnue, couverture des coûts connus", () => {
    const q = qualiteTresoreriesBtc({ donnee, ts: NOW, perime: false }, "public");
    expect(q).toMatchObject({
      sourceId: "coingecko", sourceEffective: "CoinGecko", observeLe: null, recupereLe: NOW, cadenceMs: 6 * 3_600_000,
      ageMaxMs: null, couverture: { disponibles: 2, attendus: 3 }, estime: false, acces: "public", statut: "partiel",
    });
    expect(q.raison).toContain("non horodatés");
    expect(q.raison).toContain("J-14");
    // La projection de lecture ne peut pas le rendre frais ni périmé faute d'observation datée.
    expect(actualiserQualite(q, NOW + 30 * JOUR).statut).toBe("partiel");
    expect(qualiteTresoreriesBtc({ donnee, ts: NOW, perime: false }, "cle").acces).toBe("cle");
  });

  it("cache resservi : périmé ; absent : indisponible avec motif", () => {
    const perime = qualiteTresoreriesBtc({ donnee, ts: NOW - 7 * 3_600_000, perime: true }, "public");
    expect(perime).toMatchObject({ sourceEffective: "cache CoinGecko", statut: "perime", recupereLe: NOW - 7 * 3_600_000 });
    expect(perime.raison).toContain("non horodatés");
    const absent = qualiteTresoreriesBtc(null, "cle");
    expect(absent).toMatchObject({ statut: "indisponible", acces: "indisponible", recupereLe: null, couverture: null });
    expect(absent.raison).toContain("CoinGecko");
  });

  it("motif d'échec propagé : 429 sur cache resservi, 401 sans cache", () => {
    const perime = qualiteTresoreriesBtc({ donnee, ts: NOW - 7 * 3_600_000, perime: true }, "cle", "CoinGecko trésoreries 429");
    expect(perime.raison).toContain("Cache resservi · CoinGecko trésoreries 429.");
    expect(perime.raison).toContain("non horodatés");
    const absent = qualiteTresoreriesBtc(null, "cle", "CoinGecko trésoreries 401");
    expect(absent.raison).toBe("Trésoreries CoinGecko indisponibles (CoinGecko trésoreries 401) et aucun cache exploitable.");
  });
});
