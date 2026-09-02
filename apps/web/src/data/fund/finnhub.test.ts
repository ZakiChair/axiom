import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseProfilFinnhub,
  parseEarnings,
  chargerProfilFinnhub,
  chargerEarnings,
} from "./finnhub";
import { estFrais, lireCache } from "../onchain/cache";

describe("parseProfilFinnhub", () => {
  it("parse un profil valide", () => {
    const json = { name: "Apple Inc", finnhubIndustry: "Technology", marketCapitalization: 3_000_000, weburl: "" };
    expect(parseProfilFinnhub(json)).toEqual({
      nom: "Apple Inc",
      secteur: "Technology",
      capitalisation: 3_000_000,
      description: "",
    });
  });
  it("renvoie null sur objet vide", () => {
    expect(parseProfilFinnhub({})).toBeNull();
  });
  it("renvoie null sur forme inconnue", () => {
    expect(parseProfilFinnhub(null)).toBeNull();
  });
});

describe("parseEarnings", () => {
  it("parse une liste d'événements", () => {
    const json = {
      earningsCalendar: [
        { symbol: "AAPL", date: "2026-07-30", epsEstimate: 1.5, epsActual: null },
      ],
    };
    expect(parseEarnings(json, "AAPL")).toEqual([
      { ticker: "AAPL", date: "2026-07-30", epsEstime: 1.5, epsReel: null },
    ]);
  });
  it("liste vide sur forme inconnue", () => {
    expect(parseEarnings(null, "AAPL")).toEqual([]);
  });
});

// ─────────── chargerProfilFinnhub / chargerEarnings : échec ≠ absence de données ───────────

/**
 * Même défaut que l'annuaire SEC, sur le fournisseur d'à côté : un profil ABSENT et un
 * profil INJOIGNABLE (clé invalide, quota 429, réseau) rendaient tous deux `null`, et la
 * liste de résultats rendait `[]` dans les deux cas. La fenêtre affichait alors des
 * messages d'ABSENCE DE DONNÉES (« Profil Finnhub indisponible pour ce ticker », « Aucun
 * résultat trimestriel programmé trouvé ») pour une cause d'AUTHENTIFICATION ou de quota :
 * la source affichée mentait sur la cause réelle.
 */
vi.mock("../onchain/cache", () => ({
  lireCache: vi.fn(async () => null),
  ecrireCache: vi.fn(async () => undefined),
  estFrais: vi.fn(() => false),
}));

describe("chargerProfilFinnhub / chargerEarnings — échec distingué de l'absence", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(lireCache).mockResolvedValue(null);
    vi.mocked(estFrais).mockReturnValue(false);
  });

  it("profil : clé invalide (401) SANS cache → échec, pas « pas de données »", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad key", { status: 401 })));
    await expect(chargerProfilFinnhub("AAPL", "cle")).resolves.toEqual({ ok: false });
  });

  it("profil : quota atteint (429) SANS cache → échec", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })));
    await expect(chargerProfilFinnhub("AAPL", "cle")).resolves.toEqual({ ok: false });
  });

  it("profil : ticker sans profil (200, corps vide) → succès avec donnee null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}))));
    await expect(chargerProfilFinnhub("ZZZZ", "cle")).resolves.toEqual({ ok: true, donnee: null });
  });

  it("profil : échec AVEC cache périmé → le cache est servi (dégradation, pas panne)", async () => {
    const profil = { nom: "Apple Inc", secteur: "Technology", capitalisation: 3_000_000, description: "" };
    vi.mocked(lireCache).mockResolvedValue({ ts: 0, donnee: profil } as never);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("network down"))));
    await expect(chargerProfilFinnhub("AAPL", "cle")).resolves.toEqual({ ok: true, donnee: profil });
  });

  it("earnings : réseau coupé SANS cache → échec, pas une liste vide", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("network down"))));
    await expect(chargerEarnings("AAPL", "cle")).resolves.toEqual({ ok: false });
  });

  it("earnings : aucun résultat programmé (200, calendrier vide) → succès avec liste vide", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ earningsCalendar: [] }))));
    await expect(chargerEarnings("AAPL", "cle")).resolves.toEqual({ ok: true, donnee: [] });
  });
});
