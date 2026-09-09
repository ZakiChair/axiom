import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ARCHIVES_INITIALES_PUBLIEES,
  archiverConsensusAvantAnnonce,
  conserverConsensusAvantAnnonce,
  chargerVersionsAlfredPublication,
  chargerHistoriqueVersionsAlfred,
  importerDocumentArchives,
  lireArchivesPublications,
  lireCapturesConsensus,
  typePublicationDepuisEvenement,
  exporterArchivesPublications,
  importerArchivesPublications,
  calculerSurprisePublication,
  type ArchivePublication,
} from "./publicationArchive";

afterEach(() => vi.unstubAllGlobals());

const annonce = Date.parse("2026-09-04T12:30:00Z");

describe("archive des publications économiques", () => {
  it("contient les deux communiqués BLS réellement sourcés, sans consensus inventé", () => {
    expect(ARCHIVES_INITIALES_PUBLIEES).toHaveLength(2);
    expect(ARCHIVES_INITIALES_PUBLIEES.map((x) => x.publishedAt)).toEqual([
      Date.parse("2026-08-12T12:30:00Z"),
      annonce,
    ]);
    expect(ARCHIVES_INITIALES_PUBLIEES.every((x) => x.timeApprox === false && x.consensusAvantAnnonce === null)).toBe(true);
    expect(ARCHIVES_INITIALES_PUBLIEES.every((x) => x.source.url.startsWith("https://www.bls.gov/news.release/archives/"))).toBe(true);
  });

  it("refuse d'archiver une prévision collectée après l'annonce", () => {
    expect(
      archiverConsensusAvantAnnonce({
      id: "nfp-2026-08",
        type: "nfp",
        mesure: "nfp-payems-change",
        country: "USD",
        title: "NFP",
        publishedAt: annonce,
        timeApprox: false,
        consensus: { value: "+75 k" },
        source: { nom: "ForexFactory", url: "https://www.forexfactory.com/calendar" },
        collectedAt: annonce + 1,
      }),
    ).toBeNull();
  });

  it("importe seulement une archive sourcée, datée avant annonce, puis l'exporte sans secret", () => {
    const archive: ArchivePublication = {
      id: "pce-2026-07",
      type: "pce",
      mesure: "pce-core-mm-sa",
      country: "USD",
      period: "2026-07",
      publishedAt: Date.parse("2026-08-28T12:30:00Z"),
      timeApprox: false,
      source: { nom: "Calendrier officiel", url: "https://example.test/pce" },
      actual: { label: "PCE m/m SA", value: 0.2, unit: "%" },
      consensusAvantAnnonce: { value: 0.2, unit: "%", collectedAt: Date.parse("2026-08-28T12:00:00Z"), source: { nom: "Calendrier officiel", url: "https://example.test/calendar" } },
    };
    const imported = importerArchivesPublications(JSON.stringify({ version: 2, archives: [archive], capturesConsensus: [] }));

    expect(imported).toEqual([archive]);
    expect(exporterArchivesPublications(imported)).toContain('"version":2');
    expect(() => importerArchivesPublications(JSON.stringify({ version: 2, archives: [{ ...archive, consensusAvantAnnonce: { ...archive.consensusAvantAnnonce!, collectedAt: archive.publishedAt } }], capturesConsensus: [] }))).toThrow(/avant l'annonce/i);
  });

  it("conserve, relit et exporte un consensus capturé avant l'annonce", () => {
    const memoire = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => memoire.get(key) ?? null,
      setItem: (key: string, value: string) => { memoire.set(key, value); },
      removeItem: (key: string) => { memoire.delete(key); },
    });
    const cpi = ARCHIVES_INITIALES_PUBLIEES[0]!;
    expect(conserverConsensusAvantAnnonce({
      id: "ff-cpi-2026-07", type: "cpi", mesure: "cpi-global-mm-sa", country: "USD", title: "CPI m/m",
      publishedAt: cpi.publishedAt, timeApprox: false, consensus: { value: "0.2%" },
      source: { nom: "ForexFactory", url: "https://www.forexfactory.com/calendar" }, collectedAt: cpi.publishedAt - 60_000,
    })).toBe(true);
    expect(lireCapturesConsensus()).toHaveLength(1);
    expect(lireArchivesPublications().find((archive) => archive.id === cpi.id)?.consensusAvantAnnonce).toMatchObject({ value: "0.2%" });
    expect(JSON.parse(exporterArchivesPublications(lireArchivesPublications())).capturesConsensus).toHaveLength(1);
  });

  it("distingue niveau de première publication et vue ALFRED révisée", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ observations: [{ date: "2026-08-01", value: "159075", realtime_start: "2026-09-04", realtime_end: "9999-12-31" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ observations: [{ date: "2026-08-01", value: "159080", realtime_start: "2026-09-04", realtime_end: "9999-12-31" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const nfp = ARCHIVES_INITIALES_PUBLIEES.find((archive) => archive.type === "nfp")!;

    const version = await chargerVersionsAlfredPublication(nfp, "2026-09-09");

    expect(version.valeurInitiale).toMatchObject({ value: 159075, unit: "milliers" });
    expect(version.valeurRevisée).toMatchObject({ value: 159080, unit: "milliers" });
    expect(fetch.mock.calls[0]?.[0]).toContain("output_type=4");
  });

  it("expose l'historique ALFRED pour une famille sans inventer d'heure", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ observations: [{ date: "2026-07-01", value: "0.2", realtime_start: "2026-08-28", realtime_end: "9999-12-31" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ observations: [{ date: "2026-07-01", value: "0.3", realtime_start: "2026-08-28", realtime_end: "9999-12-31" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await expect(chargerHistoriqueVersionsAlfred("pce", "2026-09-09", 12)).resolves.toEqual([
      expect.objectContaining({ period: "2026-07", valeurInitiale: expect.objectContaining({ value: 0.2, unit: "%" }), valeurRevisée: expect.objectContaining({ value: 0.3, unit: "%" }), timeApprox: true }),
    ]);
  });

  it("exclut une première publication ALFRED connue après le cutoff demandé", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ observations: [{ date: "2026-08-01", value: "159075", realtime_start: "2026-09-04", realtime_end: "9999-12-31" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ observations: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await expect(chargerHistoriqueVersionsAlfred("nfp", "2026-08-31", 12)).resolves.toEqual([]);
  });

  it("garde l'identité US et la mesure compatible, sans assimiler core ou CPI étranger", () => {
    expect(typePublicationDepuisEvenement("USD", "CPI m/m")).toMatchObject({ type: "cpi", mesure: "cpi-global-mm-sa" });
    expect(typePublicationDepuisEvenement("USD", "NFP")).toMatchObject({ type: "nfp", mesure: "nfp-payems-change" });
    expect(typePublicationDepuisEvenement("GBP", "CPI m/m")).toBeNull();
    expect(typePublicationDepuisEvenement("USD", "Core CPI y/y")).toBeNull();
    expect(typePublicationDepuisEvenement("USD", "Core PCE Price Index m/m")).toMatchObject({ type: "pce", mesure: "pce-core-mm-sa" });
    expect(typePublicationDepuisEvenement("USD", "Retail Sales m/m")).toMatchObject({ type: "retail", mesure: "retail-nominal-mm" });
    expect(typePublicationDepuisEvenement("USD", "Retail Sales y/y")).toBeNull();
  });

  it("refuse les secrets, dates impossibles et champs inconnus à l'import", () => {
    const valide = {
      id: "cpi-2026-07",
      type: "cpi",
      mesure: "cpi-global-mm-sa",
      country: "USD",
      period: "2026-07",
      publishedAt: Date.parse("2026-08-12T12:30:00Z"),
      timeApprox: false,
      source: { nom: "Source", url: "https://example.test/release" },
      actual: { label: "CPI global m/m SA", value: 0.1, unit: "%" },
      consensusAvantAnnonce: null,
    };
    expect(() => importerDocumentArchives(JSON.stringify({ version: 2, archives: [{ ...valide, period: "2026-99" }], capturesConsensus: [] }))).toThrow(/période/i);
    expect(() => importerDocumentArchives(JSON.stringify({ version: 2, archives: [{ ...valide, source: { nom: "x", url: "https://user:pass@example.test/?api_key=x" } }], capturesConsensus: [] }))).toThrow(/source/i);
    expect(() => importerDocumentArchives(JSON.stringify({ version: 2, archives: [{ ...valide, apiKey: "secret" }], capturesConsensus: [] }))).toThrow(/inconnu/i);
    expect(() => importerDocumentArchives(JSON.stringify({ version: 2, archives: [{ ...valide, valeurInitiale: { label: "x", value: "broken", unit: "%" } }], capturesConsensus: [] }))).toThrow(/valeur/i);
    expect(() => importerDocumentArchives(JSON.stringify({ version: 2, archives: [{ ...valide, type: "cpi", mesure: "nfp-payems-change" }], capturesConsensus: [] }))).toThrow(/mesure/i);
    expect(() => importerDocumentArchives(JSON.stringify({ version: 2, archives: [], capturesConsensus: [{ id: "x", type: "cpi", mesure: "nfp-payems-change", country: "USD", title: "CPI m/m", publishedAt: valide.publishedAt, timeApprox: false, consensus: { value: "0.2%" }, source: valide.source, collectedAt: valide.publishedAt - 1 }] }))).toThrow(/identité/i);
  });

  it("calcule la surprise seulement avec des unités exactement comparables", () => {
    const nfp = { ...ARCHIVES_INITIALES_PUBLIEES.find((archive) => archive.type === "nfp")!, consensusAvantAnnonce: { value: "150K", collectedAt: annonce - 60_000, source: { nom: "Calendrier", url: "https://example.test/calendar" } } };
    const cpi = { ...ARCHIVES_INITIALES_PUBLIEES.find((archive) => archive.type === "cpi")!, consensusAvantAnnonce: { value: "0.2%", collectedAt: Date.parse("2026-08-12T12:00:00Z"), source: { nom: "Calendrier", url: "https://example.test/calendar" } } };

    expect(calculerSurprisePublication(nfp)).toEqual({ disponible: true, valeur: 12, unit: "milliers" });
    expect(calculerSurprisePublication(cpi)).toEqual({ disponible: true, valeur: -0.1, unit: "point de pourcentage" });
    expect(calculerSurprisePublication({ ...nfp, consensusAvantAnnonce: { ...nfp.consensusAvantAnnonce!, value: "0.2%" } })).toMatchObject({ disponible: false });
  });

  it("borne l'historique ALFRED avant de calculer ses dates", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ observations: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await expect(chargerHistoriqueVersionsAlfred("cpi", "2026-09-09", Number.MAX_SAFE_INTEGER)).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalled();
  });
});
