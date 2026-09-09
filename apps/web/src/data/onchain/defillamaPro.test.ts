import { describe, expect, it } from "vitest";
import { calculerRatiosUnlock, enrichirDenominateurs, exporterCalendrier, importerCalendrier, mapperBridgeVolumes, mapperDetailEmission, mapperEmissions, cheminDefillamaPro, typeProchainUnlock } from "./defillamaPro";

describe("DefiLlama Pro — contrats", () => {
  it("mappe les unlocks sourcés sans appeler circSupply un flottant ajusté", () => {
    const rows = mapperEmissions([{ token: "coingecko:test", name: "Test", gecko_id: "test", circSupply: 100,
      sources: ["https://example.org/tokenomics"], events: [{ timestamp: 2_000_000_000, noOfTokens: [5], unlockType: "cliff", category: "team", description: "Cliff" }] }]);
    expect(rows?.[0]?.offreCirculante).toBe(100);
    expect(rows?.[0]?.flottantAjuste).toBeNull();
    expect(rows?.[0]?.events[0]?.type).toBe("cliff");
  });

  it("ratios null si les dénominateurs réels sont absents ou nuls", () => {
    expect(calculerRatiosUnlock(10, null, 0)).toEqual({ pctFlottant: null, pctVolume24h: null });
    expect(calculerRatiosUnlock(10, 100, 50)).toEqual({ pctFlottant: 10, pctVolume24h: null });
    expect(calculerRatiosUnlock(10, 100, 50, 1)).toEqual({ pctFlottant: 10, pctVolume24h: 20 });
  });

  it("conserve les observations bridge manquantes et calcule seulement un net réel", () => {
    expect(mapperBridgeVolumes([{ date: "1665964800", depositUSD: 12, withdrawUSD: 5, depositTxs: 2, withdrawTxs: 1 },
      { date: "1666051200", depositUSD: null, withdrawUSD: 4 }])).toEqual([
      { date: 1_665_964_800_000, entrantsUsd: 12, sortantsUsd: 5, netUsd: 7, txEntrantes: 2, txSortantes: 1 },
      { date: 1_666_051_200_000, entrantsUsd: null, sortantsUsd: 4, netUsd: null, txEntrantes: null, txSortantes: null },
    ]);
    expect(mapperBridgeVolumes([
      { date: String(Math.floor(Date.now() / 1000) + 3_600), depositUSD: 1, withdrawUSD: 1 },
      { date: "1665964800", depositUSD: -1, withdrawUSD: 1 },
    ])).toEqual([]);
  });

  it("relie le type à la prochaine date exacte, sans reprendre un cliff historique", () => {
    const token = mapperEmissions([{ name: "Test", gecko_id: "test", sources: ["https://example.org/source"], nextEvent: { date: 2_000_000_000, toUnlock: 4 }, events: [
      { timestamp: 1_900_000_000, noOfTokens: [2], unlockType: "cliff" },
      { timestamp: 2_000_000_000, noOfTokens: [4], unlockType: "linear" },
    ] }])![0]!;
    expect(typeProchainUnlock(token)).toBe("lineaire");
    expect(typeProchainUnlock({ ...token, prochaineDate: token.prochaineDate! + 1 })).toBeNull();
  });

  it("importe et exporte uniquement un calendrier versionné avec sources https", () => {
    const calendrier = mapperEmissions([{ token: "coingecko:test", name: "Test", gecko_id: "test", circSupply: 100,
      sources: ["https://example.org/tokenomics"], events: [{ timestamp: 2_000_000_000, noOfTokens: [5], unlockType: "linear", category: "team" }] }])!;
    expect(importerCalendrier(exporterCalendrier(calendrier))).toEqual(calendrier);
    expect(importerCalendrier('{"version":1,"tokens":[],"sourcesValidees":false}')).toBeNull();
    expect(importerCalendrier(exporterCalendrier(calendrier).replace('"nom":"Test"', '"nom":"Test","secret":"fuite"'))).toBeNull();
    expect(importerCalendrier(exporterCalendrier(calendrier).replace('"quantite":5', '"quantite":-5'))).toBeNull();
    const avecIdentifiants = JSON.parse(exporterCalendrier(calendrier));
    avecIdentifiants.tokens[0].sources = ["https://user:password@example.org/tokenomics"];
    expect(importerCalendrier(JSON.stringify(avecIdentifiants))).toBeNull();
    const avecCleQuery = JSON.parse(exporterCalendrier(calendrier));
    avecCleQuery.tokens[0].sources = ["https://example.org/tokenomics?api_key=secret"];
    expect(importerCalendrier(JSON.stringify(avecCleQuery))).toBeNull();
    const flottantAvecJeton = JSON.parse(exporterCalendrier(calendrier));
    flottantAvecJeton.tokens[0].flottantAjuste = 80;
    flottantAvecJeton.tokens[0].denominateurs.flottantAjuste = { valeur: 80, source: "https://example.org/float?access_token=secret", observeLe: Date.now() };
    expect(importerCalendrier(JSON.stringify(flottantAvecJeton))).toBeNull();
  });

  it("raccorde prix et volume du même token avec source et date", () => {
    const tokens = mapperEmissions([{ token: "coingecko:test", name: "Test", gecko_id: "test", circSupply: 100, sources: ["https://example.org/source"], events: [] }])!;
    const observeLe = Date.parse("2026-09-09T12:00:00Z");
    const enriched = enrichirDenominateurs(tokens, [{ id: "test", price: 2, volume24hUsd: 50, observeLe }]);
    expect(enriched[0]?.denominateurs).toEqual({ prixUsd: { valeur: 2, source: "CoinGecko /coins/markets (contexte actuel)", observeLe }, volume24hUsd: { valeur: 50, source: "CoinGecko /coins/markets (contexte actuel)", observeLe }, flottantAjuste: null });
    expect(enrichirDenominateurs(tokens, [{ id: "test", price: 2, volume24hUsd: 50, observeLe: Date.now() + 60 * 60_000 }])[0]?.denominateurs.prixUsd).toBeNull();
  });

  it("borne strictement les chemins locaux autorisés", () => {
    expect(cheminDefillamaPro("emissions")).toBe("/api/emissions");
    expect(cheminDefillamaPro("emission/hyperliquid")).toBe("/api/emission/hyperliquid");
    expect(cheminDefillamaPro("bridgevolume/Ethereum?id=2")).toBe("/bridges/bridgevolume/Ethereum?id=2");
    expect(cheminDefillamaPro("emission/a/b")).toBeNull();
    expect(cheminDefillamaPro("bridgevolume/Ethereum?id=x")).toBeNull();
  });

  it("conserve notes et niveaux cumulés sans les transformer en événements", () => {
    expect(mapperDetailEmission({ body: { documentedData: { data: [{ label: "Team", data: [{ timestamp: 10, unlocked: 50, rawEmission: 50, burned: 0 }] }] }, metadata: { notes: ["Schedule extrapolated"], sources: ["https://example.org/source"] } }, lastModified: "2025-07-18T13:30:56.000Z" })).toEqual({
      notes: ["Schedule extrapolated"], sources: ["https://example.org/source"], lastModified: Date.parse("2025-07-18T13:30:56.000Z"),
      seriesCumulees: [{ label: "Team", points: [{ date: 10_000, unlockedCumule: 50, emissionBruteCumulee: 50, burnedCumule: 0 }] }],
    });
  });
});
