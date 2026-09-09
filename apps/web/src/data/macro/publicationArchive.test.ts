import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ARCHIVES_INITIALES_PUBLIEES,
  archiverConsensusAvantAnnonce,
  chargerVersionsAlfredPublication,
  chargerHistoriqueVersionsAlfred,
  exporterArchivesPublications,
  importerArchivesPublications,
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
        publishedAt: annonce,
        consensus: "+75 k",
        source: { nom: "ForexFactory", url: "https://www.forexfactory.com/calendar" },
        collectedAt: annonce + 1,
      }),
    ).toBeNull();
  });

  it("importe seulement une archive sourcée, datée avant annonce, puis l'exporte sans secret", () => {
    const archive: ArchivePublication = {
      id: "pce-2026-07",
      type: "pce",
      period: "2026-07",
      publishedAt: Date.parse("2026-08-28T12:30:00Z"),
      timeApprox: false,
      source: { nom: "Calendrier officiel", url: "https://example.test/pce" },
      actual: { label: "PCE m/m SA", value: 0.2, unit: "%" },
      consensusAvantAnnonce: { value: 0.2, unit: "%", collectedAt: Date.parse("2026-08-28T12:00:00Z"), source: "Calendrier officiel" },
    };
    const imported = importerArchivesPublications(JSON.stringify({ version: 1, archives: [archive] }));

    expect(imported).toEqual([archive]);
    expect(exporterArchivesPublications(imported)).toContain('"version":1');
    expect(() => importerArchivesPublications(JSON.stringify({ version: 1, archives: [{ ...archive, consensusAvantAnnonce: { ...archive.consensusAvantAnnonce!, collectedAt: archive.publishedAt } }] }))).toThrow(/avant l'annonce/i);
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
      expect.objectContaining({ period: "2026-07", valeurInitiale: 0.2, valeurRevisée: 0.3, timeApprox: true }),
    ]);
  });
});
