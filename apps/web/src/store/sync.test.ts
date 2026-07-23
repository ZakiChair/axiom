/**
 * Tests de la synchro multi-fenêtres : le cœur PUR `interpretMessage` (garde anti-écho
 * par id de fenêtre + validation de forme/valeurs). Le transport BroadcastChannel n'est
 * pas testé ici (effet de bord navigateur).
 */
import { describe, expect, it, vi } from "vitest";

// theme.ts pose [data-theme] sur <html> au chargement du module (touche `document`),
// indisponible en environnement Node. On stub l'API réellement utilisée par sync.ts :
// `THEMES` (référentiel de validation) + un `themeStore` factice. (vi.mock est hissé.)
vi.mock("./theme", () => ({
  THEMES: ["dark", "bloomberg", "matrix", "cute", "aurora"],
  themeStore: { getState: () => ({ setTheme: () => {} }), subscribe: () => () => {} },
}));

import { interpretMessage } from "./sync";

const ME = "win-me";
const OTHER = "win-other";

describe("interpretMessage", () => {
  it("ignore nos propres messages (anti-boucle)", () => {
    expect(interpretMessage({ kind: "symbol", sender: ME, exchange: "binance", symbol: "BTCUSDT" }, ME)).toBeNull();
  });

  it("accepte un changement de symbole d'une autre fenêtre", () => {
    expect(
      interpretMessage({ kind: "symbol", sender: OTHER, exchange: "binance", symbol: "ETHUSDT" }, ME),
    ).toEqual({ kind: "symbol", sender: OTHER, exchange: "binance", symbol: "ETHUSDT" });
  });

  // Source de vérité unique (EXCHANGE_IDS) : la synchro doit accepter TOUTE source câblée,
  // pas seulement les 5 historiques. Régression si la liste de sync diverge de l'autorité.
  it.each(["bybit", "okx", "hyperliquid", "synthetic"] as const)(
    "accepte la source %s (liste complète des exchanges câblés)",
    (exchange) => {
      expect(
        interpretMessage({ kind: "symbol", sender: OTHER, exchange, symbol: "BTCUSDT" }, ME),
      ).toEqual({ kind: "symbol", sender: OTHER, exchange, symbol: "BTCUSDT" });
    },
  );

  it("accepte un changement de thème d'une autre fenêtre", () => {
    expect(interpretMessage({ kind: "theme", sender: OTHER, theme: "matrix" }, ME)).toEqual({
      kind: "theme",
      sender: OTHER,
      theme: "matrix",
    });
  });

  it("rejette une source inconnue", () => {
    expect(interpretMessage({ kind: "symbol", sender: OTHER, exchange: "ftx", symbol: "BTCUSDT" }, ME)).toBeNull();
  });

  it("rejette un thème inconnu", () => {
    expect(interpretMessage({ kind: "theme", sender: OTHER, theme: "neon" }, ME)).toBeNull();
  });

  it("rejette les formes invalides", () => {
    expect(interpretMessage(null, ME)).toBeNull();
    expect(interpretMessage({ kind: "symbol", sender: OTHER, exchange: "binance" }, ME)).toBeNull(); // symbole manquant
    expect(interpretMessage({ kind: "autre", sender: OTHER }, ME)).toBeNull();
    expect(interpretMessage({ kind: "symbol", exchange: "binance", symbol: "BTCUSDT" }, ME)).toBeNull(); // sender manquant
  });
});
