import { test, expect, type Page } from "@playwright/test";

/**
 * Gate e2e du Lot 3 — fenêtre SECT (Secteurs crypto).
 *
 * POURQUOI ICI : `apps/web` tourne en env vitest NODE (pas de jsdom — BUILD-CONTRACT).
 * Le parcours menu Fonctions → table des groupes → drill-down → clic membre → chart
 * n'est vérifiable que dans un vrai navigateur.
 *
 * BOUCHON CoinGecko (page.route) : les 3 endpoints du pipeline overview sont servis
 * par des fixtures minimales AVEC les périodes 7 j/30 j — déterministe, zéro quota
 * consommé (le tier keyless 429 en runs répétés, leçon du gate G7).
 * ⚠ RÉSEAU Binance REQUIS (comme gate-g7) : catalogue exchangeInfo = garde-fou réel
 * du clic membre, et recherche de la paire témoin ETHBTC.
 */

const MARCHES = [
  {
    id: "bitcoin", symbol: "btc", name: "Bitcoin", current_price: 100_000, market_cap: 2e12,
    price_change_percentage_24h: 1.5, price_change_percentage_7d_in_currency: 4.2, price_change_percentage_30d_in_currency: 11,
  },
  {
    id: "ethereum", symbol: "eth", name: "Ethereum", current_price: 3_500, market_cap: 4e11,
    price_change_percentage_24h: -0.8, price_change_percentage_7d_in_currency: 2.1, price_change_percentage_30d_in_currency: -3,
  },
  {
    id: "solana", symbol: "sol", name: "Solana", current_price: 180, market_cap: 9e10,
    price_change_percentage_24h: 2.4, price_change_percentage_7d_in_currency: -1.3, price_change_percentage_30d_in_currency: 6,
  },
  {
    id: "chainlink", symbol: "link", name: "Chainlink", current_price: 18, market_cap: 1.2e10,
    price_change_percentage_24h: 0.9, price_change_percentage_7d_in_currency: 5.5, price_change_percentage_30d_in_currency: 9,
  },
];

const GLOBAL = {
  data: {
    total_market_cap: { usd: 3.2e12 },
    total_volume: { usd: 1.1e11 },
    market_cap_percentage: { btc: 55, eth: 12 },
    market_cap_change_percentage_24h_usd: 1.2,
  },
};

/** Intercepte les trois endpoints CoinGecko du pipeline overview partagé. */
async function bouchonnerCoinGecko(page: Page): Promise<void> {
  await page.route("**/api.coingecko.com/api/v3/coins/markets*", (route) =>
    route.fulfill({ json: MARCHES }),
  );
  await page.route("**/api.coingecko.com/api/v3/global*", (route) => route.fulfill({ json: GLOBAL }));
  await page.route("**/api.coingecko.com/api/v3/coins/categories*", (route) =>
    route.fulfill({ json: [] }),
  );
}

/** Zone du chart maître (exclut sidebar/fenêtres) — porte le SymbolBanner (cf. gate-g7). */
function zoneChart(page: Page) {
  return page.locator("main .isolate");
}

/**
 * Positionne le chart sur ETHBTC (paire réelle jamais servie par SECT, coté USDT) :
 * tout retour à un symbole USDT prouve la navigation panneau → chart (cf. gate-g7).
 */
async function poserSymboleTemoin(page: Page) {
  const recherche = page.getByLabel("Rechercher une paire");
  await recherche.fill("ETHBTC");
  await recherche.press("Enter");
  await expect(zoneChart(page).getByText("ETHBTC", { exact: true })).toBeVisible({
    timeout: 10_000,
  });
}

/** Ouvre SECT par le canal de découverte no 1 : le menu Fonctions de la Toolbar. */
async function ouvrirSectParLeMenu(page: Page) {
  await page.getByRole("button", { name: "Fonctions" }).click();
  await page.getByRole("menuitem", { name: /Secteurs crypto/ }).click();
  const fenetre = page.getByRole("complementary", { name: "Secteurs crypto" });
  await expect(fenetre).toBeVisible({ timeout: 15_000 });
  return fenetre;
}

test.beforeEach(async ({ page }) => {
  await bouchonnerCoinGecko(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
  });
});

test("le menu Fonctions ouvre SECT sur la table des groupes (perfs, cap, couverture)", async ({
  page,
}) => {
  await page.goto("/");
  // Attendre le montage AVANT toute interaction : l'écouteur global est posé par un
  // effet React (leçon du gate v2.4).
  await expect(page.getByRole("button", { name: /^Indicateurs/ })).toBeVisible();

  const fenetre = await ouvrirSectParLeMenu(page);

  // Table des groupes : en-têtes de colonnes + groupes curés visibles.
  await expect(fenetre.getByText("Secteur", { exact: true })).toBeVisible();
  await expect(fenetre.getByText("30 j", { exact: true })).toBeVisible();
  await expect(fenetre.getByText("L1 majors", { exact: true })).toBeVisible();
  await expect(fenetre.getByText("Éco Solana", { exact: true })).toBeVisible();
  // Couverture « n/m » : la fixture couvre BTC+ETH+SOL du groupe L1 majors (3/15).
  await expect(fenetre.getByText("3/15", { exact: true })).toBeVisible();
});

test("drill-down puis clic sur un membre coté Binance → le symbole du chart change", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Indicateurs/ })).toBeVisible();
  await poserSymboleTemoin(page);

  const fenetre = await ouvrirSectParLeMenu(page);

  // Drill-down : clic sur la ligne du groupe → table des membres + bouton retour.
  await fenetre.getByText("L1 majors", { exact: true }).click();
  await expect(fenetre.getByRole("button", { name: "← Groupes" })).toBeVisible();
  await expect(fenetre.getByText("Bitcoin", { exact: true })).toBeVisible();

  // Le membre devient cliquable quand le catalogue Binance RÉEL a confirmé la paire
  // (l'infobulle « Ouvrir … » n'apparaît qu'à ce moment-là — garde-fou « sinon rien »).
  const membre = fenetre.locator('[title="Ouvrir BTCUSDT dans le chart"]');
  await expect(membre).toBeVisible({ timeout: 15_000 });
  await membre.click();

  // Le chart maître bascule sur la paire du membre (le témoin ETHBTC disparaît).
  await expect(zoneChart(page).getByText("BTCUSDT", { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await expect(zoneChart(page).getByText("ETHBTC", { exact: true })).toHaveCount(0);

  // Bouton retour : on revient à la table des groupes.
  await fenetre.getByRole("button", { name: "← Groupes" }).click();
  await expect(fenetre.getByText("Éco Solana", { exact: true })).toBeVisible();
});
