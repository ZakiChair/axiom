import { afterEach, describe, expect, it, vi } from "vitest";
import { rechercherSociete, parseTickers, parseProfilSec, chargerTickers, type EntreeTicker } from "./secEdgar";
import { estFrais, lireCache } from "../onchain/cache";

const TICKERS: EntreeTicker[] = [
  { cik: "0000320193", ticker: "AAPL", nom: "Apple Inc." },
  { cik: "0000789019", ticker: "MSFT", nom: "Microsoft Corp" },
  { cik: "0001652044", ticker: "GOOGL", nom: "Alphabet Inc." },
];

describe("rechercherSociete", () => {
  it("trouve par ticker exact", () => {
    expect(rechercherSociete("AAPL", TICKERS)).toEqual([TICKERS[0]]);
  });
  it("trouve par sous-chaîne du nom, insensible à la casse", () => {
    expect(rechercherSociete("apple", TICKERS)).toEqual([TICKERS[0]]);
  });
  it("aucun résultat renvoie un tableau vide", () => {
    expect(rechercherSociete("zzz", TICKERS)).toEqual([]);
  });
  it("plafonne à 15 résultats", () => {
    const beaucoup: EntreeTicker[] = Array.from({ length: 30 }, (_, i) => ({
      cik: String(i),
      ticker: `T${i}`,
      nom: `Test Corp ${i}`,
    }));
    expect(rechercherSociete("test", beaucoup)).toHaveLength(15);
  });
});

describe("parseTickers", () => {
  it("parse la forme réelle SEC (objet indexé 0..N)", () => {
    const json = {
      "0": { cik_str: 1045810, ticker: "NVDA", title: "NVIDIA CORP" },
      "1": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." },
    };
    expect(parseTickers(json)).toEqual([
      { cik: "0001045810", ticker: "NVDA", nom: "NVIDIA CORP" },
      { cik: "0000320193", ticker: "AAPL", nom: "Apple Inc." },
    ]);
  });
  it("ignore les entrées malformées", () => {
    expect(parseTickers({ "0": { cik_str: 1, ticker: "X" } })).toEqual([]);
  });
  it("forme inconnue renvoie un tableau vide", () => {
    expect(parseTickers(null)).toEqual([]);
    expect(parseTickers("nope")).toEqual([]);
  });
});

describe("parseProfilSec", () => {
  it("parse la forme réelle SEC submissions", () => {
    const json = {
      cik: "0000320193",
      name: "Apple Inc.",
      sicDescription: "Electronic Computers",
    };
    expect(parseProfilSec(json, "0000320193")).toEqual({
      nom: "Apple Inc.",
      cik: "0000320193",
      secteur: "Electronic Computers",
      insiders: [],
    });
  });
  it("renvoie null si `name` absent (CIK inconnu/forme inattendue)", () => {
    expect(parseProfilSec({ sicDescription: "x" }, "0000000000")).toBeNull();
    expect(parseProfilSec(null, "0000000000")).toBeNull();
  });
});

// ─────────────────────────── chargerTickers : échec ≠ annuaire vide ───────────────────────────

/**
 * Un annuaire VIDE et un annuaire INJOIGNABLE ne doivent pas être confondus : sur
 * échec sans cache, la fenêtre FUND passait « prête » avec zéro ticker et la
 * recherche restait muette (violation du « jamais de pane muet » du contrat).
 */
vi.mock("../onchain/cache", () => ({
  lireCache: vi.fn(async () => null),
  ecrireCache: vi.fn(async () => undefined),
  estFrais: vi.fn(() => false),
}));

describe("chargerTickers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(lireCache).mockResolvedValue(null);
    vi.mocked(estFrais).mockReturnValue(false);
  });

  it("échec réseau SANS cache → null (annuaire indisponible), pas un tableau vide", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("network down"))));
    await expect(chargerTickers()).resolves.toBeNull();
  });

  it("HTTP non-2xx SANS cache → null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("forbidden", { status: 403 })));
    await expect(chargerTickers()).resolves.toBeNull();
  });

  it("échec AVEC cache périmé → le cache est servi (dégradation, pas panne)", async () => {
    vi.mocked(lireCache).mockResolvedValue({ ts: 0, donnee: TICKERS } as never);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("network down"))));
    await expect(chargerTickers()).resolves.toEqual(TICKERS);
  });

  it("succès → l'annuaire parsé", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." } }))),
    );
    await expect(chargerTickers()).resolves.toEqual([TICKERS[0]]);
  });
});
