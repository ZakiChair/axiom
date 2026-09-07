/**
 * Règles PURES de lisibilité de la watchlist (env vitest node, pas de jsdom).
 * Le rendu (troncature réelle à 1440×240) est vérifié par e2e/corrections-revue.e2e.ts.
 */
import { describe, expect, it } from "vitest";
import { colonnesWatchlistPourLargeur } from "./Watchlist";

describe("lisibilité watchlist", () => {
  it("à 240 px (sidebar w-60) masque la sparkline et garde le Δ% 24h", () => {
    const cols = colonnesWatchlistPourLargeur(240);
    expect(cols.change24h).toBe(true);
    expect(cols.spark).toBe(false);
  });

  it("à largeur confortable garde sparkline et Δ% 24h", () => {
    const cols = colonnesWatchlistPourLargeur(360);
    expect(cols.change24h).toBe(true);
    expect(cols.spark).toBe(true);
  });
});
