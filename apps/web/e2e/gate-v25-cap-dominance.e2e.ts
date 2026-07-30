import { test, expect } from "@playwright/test";

/**
 * Gate e2e du lot v2.5 — fenêtre CAP (TOTAL, TOTAL3, dominances).
 *
 * POURQUOI ICI : `apps/web` tourne en env vitest NODE (pas de jsdom, et aucune
 * dépendance de rendu ne peut être ajoutée — BUILD-CONTRACT). Le montage des trois
 * canvas et le sélecteur de dominance ne sont vérifiables que dans un vrai navigateur.
 *
 * DÉTERMINISTE ET HORS LIGNE : les appels CoinGecko sont interceptés et servis par des
 * fixtures minimales ; l'historique est semé dans localStorage avant le boot (le store
 * le relit au montage). Aucun appel réseau réel, donc aucun quota consommé.
 */

const JOUR = 86_400_000;
const T0 = Date.UTC(2026, 6, 29); // 2026-07-29, minuit UTC

/** Historique synthétique de 40 jours : TOTAL 2 T$, BTC 1 T$, ETH 0,2 T$. */
const HIST = {
  version: 1,
  majTs: T0,
  k: 1.02,
  recalibre: true,
  grille: Array.from({ length: 40 }, (_, i) => T0 - (39 - i) * JOUR),
  total: Array.from({ length: 40 }, (_, i) => 2e12 + i * 1e9),
  pieces: {
    bitcoin: Array.from({ length: 40 }, () => 1e12),
    ethereum: Array.from({ length: 40 }, () => 2e11),
  },
};

const MARCHES = [
  { id: "bitcoin", symbol: "btc", name: "Bitcoin", current_price: 65_000, market_cap: 1e12, price_change_percentage_24h: 1 },
  { id: "ethereum", symbol: "eth", name: "Ethereum", current_price: 3_000, market_cap: 2e11, price_change_percentage_24h: 1 },
  { id: "solana", symbol: "sol", name: "Solana", current_price: 150, market_cap: 8e10, price_change_percentage_24h: 1 },
  { id: "ripple", symbol: "xrp", name: "XRP", current_price: 2, market_cap: 1.2e11, price_change_percentage_24h: 1 },
];

const GLOBAL = {
  data: {
    total_market_cap: { usd: 2.04e12 },
    total_volume: { usd: 1e11 },
    market_cap_percentage: { btc: 49, eth: 9.8 },
    market_cap_change_percentage_24h_usd: 0.5,
  },
};

/** Intercepte les trois endpoints CoinGecko utilisés par la fenêtre. */
async function bouchonnerCoinGecko(page: import("@playwright/test").Page): Promise<void> {
  await page.route("**/api.coingecko.com/api/v3/coins/markets*", (route) =>
    route.fulfill({ json: MARCHES })
  );
  await page.route("**/api.coingecko.com/api/v3/global*", (route) => route.fulfill({ json: GLOBAL }));
  await page.route("**/api.coingecko.com/api/v3/coins/*/market_chart*", (route) =>
    route.fulfill({
      json: {
        market_caps: Array.from({ length: 40 }, (_, i) => [T0 - (39 - i) * JOUR, 8e10]),
      },
    })
  );
}

test.beforeEach(async ({ page }) => {
  await bouchonnerCoinGecko(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
  });
});

test.describe("avec historique reconstruit", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(
      ([hist, dominances]) => {
        window.localStorage.setItem("axiom:mcap:v1", hist as string);
        window.localStorage.setItem("axiom:mcap:dominances", dominances as string);
      },
      [JSON.stringify(HIST), JSON.stringify(["bitcoin", "ethereum"])]
    );
  });

  test("la commande CAP ouvre la fenêtre et monte les trois graphiques", async ({ page }) => {
    await page.goto("/");
    // Attendre le montage AVANT la frappe : l'écouteur ⌘K est posé par un effet React,
    // une pression trop précoce se perd (leçon du gate v2.4).
    await expect(page.getByRole("button", { name: /^Indicateurs/ })).toBeVisible();

    await page.keyboard.press("ControlOrMeta+k");
    await page.getByPlaceholder(/^Commande/).fill("CAP");
    await page.keyboard.press("Enter");

    await expect(page.getByPlaceholder(/^Commande/)).toHaveCount(0);
    await expect(page.getByLabel("TOTAL — capitalisation crypto")).toBeVisible();
    await expect(page.getByLabel("TOTAL3 — hors BTC et ETH")).toBeVisible();
    await expect(page.getByLabel("Dominances")).toBeVisible();
    // La note de source dit d'où viennent les chiffres et ce qu'ils valent.
    await expect(page.getByText(/reconstruit par somme du top 100/)).toBeVisible();
  });

  test("ajouter une dominance ajoute sa pastille ; la retirer la fait disparaître", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /^Indicateurs/ })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByPlaceholder(/^Commande/).fill("CAP");
    await page.keyboard.press("Enter");

    // `exact` obligatoire : la watchlist expose « Retirer SOLUSDT », dont « Retirer SOL »
    // est une sous-chaîne — et getByRole matche en sous-chaîne par défaut.
    await expect(page.getByRole("button", { name: "Retirer SOL", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "+ dominance" }).click();
    await page.getByLabel("Rechercher une pièce").fill("sol");
    // role="menuitem" (primitive MenuDeroulant, T12) — même convention que les autres
    // menus de la Toolbar (cf. gate-g3-playbooks, gate-g2-badges…).
    await page.getByRole("menuitem", { name: /SOL\s+Solana/ }).click();

    await expect(page.getByRole("button", { name: "Retirer SOL", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Retirer SOL", exact: true }).click();
    await expect(page.getByRole("button", { name: "Retirer SOL", exact: true })).toHaveCount(0);
  });
});

test.describe("sans historique local", () => {
  test("propose de reconstruire les 365 jours en annonçant la durée", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /^Indicateurs/ })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByPlaceholder(/^Commande/).fill("CAP");
    await page.keyboard.press("Enter");

    await expect(page.getByRole("button", { name: /Construire l'historique/ })).toBeVisible();
    await expect(page.getByText(/100 appels cadencés/)).toBeVisible();
  });
});
