/**
 * Tests des fonctions PURES de la fenêtre DATA : tri « erreurs d'abord » et formatage
 * de la fraîcheur relative. Le rendu React n'est pas testé (pas d'environnement DOM).
 */
import { describe, it, expect } from "vitest";
import { trierSources, formatFraicheur, libelleSource } from "./dataCockpit";
import type { SanteSource } from "../store/health";

/** Fabrique une SanteSource minimale pour les tests de tri. */
function src(source: string, etat: SanteSource["etat"], dernierMessageTs: number): SanteSource {
  return { source, etat, dernierMessageTs };
}

describe("formatFraicheur", () => {
  it("secondes sous la minute", () => {
    expect(formatFraicheur(0)).toBe("il y a 0 s");
    expect(formatFraicheur(12_000)).toBe("il y a 12 s");
    expect(formatFraicheur(59_000)).toBe("il y a 59 s");
  });

  it("minutes sous l'heure", () => {
    expect(formatFraicheur(60_000)).toBe("il y a 1 min");
    expect(formatFraicheur(3 * 60_000)).toBe("il y a 3 min");
    expect(formatFraicheur(59 * 60_000)).toBe("il y a 59 min");
  });

  it("heures sous le jour", () => {
    expect(formatFraicheur(60 * 60_000)).toBe("il y a 1 h");
    expect(formatFraicheur(2 * 60 * 60_000)).toBe("il y a 2 h");
    expect(formatFraicheur(23 * 60 * 60_000)).toBe("il y a 23 h");
  });

  it("jours au-delà", () => {
    expect(formatFraicheur(24 * 60 * 60_000)).toBe("il y a 1 j");
    expect(formatFraicheur(4 * 24 * 60 * 60_000)).toBe("il y a 4 j");
  });

  it("delta négatif ou non fini → « — » (source jamais vue)", () => {
    expect(formatFraicheur(-1)).toBe("—");
    expect(formatFraicheur(NaN)).toBe("—");
    expect(formatFraicheur(Infinity)).toBe("—");
  });
});

describe("trierSources", () => {
  const now = 1_000_000;

  it("remonte les erreurs en tête, plus récentes d'abord", () => {
    const sources: Record<string, SanteSource> = {
      ok: src("binance", "connected", now - 1_000),
      errAncienne: src("deribit", "error", now - 50_000),
      errRecente: src("eco:fred", "error", now - 5_000),
    };
    const rows = trierSources(sources, now);
    expect(rows.map((r) => r.id)).toEqual(["eco:fred", "deribit", "binance"]);
    expect(rows[0]?.etat).toBe("error");
    expect(rows[1]?.etat).toBe("error");
  });

  it("hors erreurs, trie par dernierMessageTs décroissant", () => {
    const sources: Record<string, SanteSource> = {
      vieille: src("kraken", "polling", now - 90_000),
      neuve: src("binance", "connected", now - 2_000),
      moyenne: src("cboe", "polling", now - 30_000),
    };
    const rows = trierSources(sources, now);
    expect(rows.map((r) => r.id)).toEqual(["binance", "cboe", "kraken"]);
  });

  it("calcule la fraîcheur en delta ; source jamais vue (ts=0) → NaN", () => {
    const sources: Record<string, SanteSource> = {
      vue: src("binance", "connected", now - 12_000),
      jamais: src("sosovalue", "error", 0),
    };
    const rows = trierSources(sources, now);
    const parId = new Map(rows.map((r) => [r.id, r]));
    expect(parId.get("binance")?.fraicheurMs).toBe(12_000);
    expect(Number.isNaN(parId.get("sosovalue")?.fraicheurMs ?? 0)).toBe(true);
    // Bout-en-bout : la source jamais vue s'affiche « — ».
    expect(formatFraicheur(parId.get("sosovalue")?.fraicheurMs ?? NaN)).toBe("—");
  });

  it("projette libellé, quota et erreur", () => {
    const sources: Record<string, SanteSource> = {
      s: {
        source: "bgeometrics",
        etat: "error",
        dernierMessageTs: now - 1_000,
        derniereErreur: "401 Unauthorized",
        quota: { utilise: 8, limite: 10, fenetre: "1hour" },
      },
    };
    const [row] = trierSources(sources, now);
    expect(row?.libelle).toBe("BGeometrics");
    expect(row?.erreur).toBe("401 Unauthorized");
    expect(row?.quota).toEqual({ utilise: 8, limite: 10, fenetre: "1hour" });
  });
});

describe("libelleSource", () => {
  it("nomme les fournisseurs à clé composée que sourceLabel ignorerait", () => {
    expect(libelleSource("eco:fred")).toBe("FRED");
    expect(libelleSource("cot:cftc")).toBe("CFTC (COT)");
    expect(libelleSource("deribit")).toBe("Deribit");
    expect(libelleSource("sosovalue")).toBe("SoSoValue");
  });

  it("retombe sur sourceLabel pour les exchanges WS connus", () => {
    expect(libelleSource("binance")).toBe("Binance");
    expect(libelleSource("binance:trades")).toBe("Binance · trades");
  });
});
