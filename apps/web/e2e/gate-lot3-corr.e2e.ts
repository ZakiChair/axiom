import { test, expect, type Page } from "@playwright/test";

/**
 * Gate e2e du Lot 3 — CORR v2 (critère de succès no 1 de la spec
 * 2026-07-29-uniformisation-ui-corr-sect-themes-design.md).
 *
 * POURQUOI ICI : `apps/web` tourne en env vitest NODE (pas de jsdom) — le montage du
 * canvas de la matrice, les segments univers/tri, l'onglet Paires et l'hydratation
 * localStorage ne sont vérifiables que dans un vrai navigateur.
 *
 * DÉTERMINISTE ET HORS LIGNE : klines Binance, /tdapi (Twelve Data) et CoinGecko sont
 * bouchonnés par `page.route` — aucun appel réel, aucun quota consommé. Vérifie :
 *   1. « Top 20 » construit une matrice 20×20 SANS saisie manuelle (top 250 CoinGecko,
 *      stablecoins exclus, paires Binance USDT) — canvas à 538 px (54 + 20×24 + 4) ;
 *   2. univers + fenêtre 7 j + tri + onglet sont RETROUVÉS après fermeture, rechargement
 *      de la page (hydratation localStorage `axiom:corr:v1`) et réouverture.
 */

const JOUR = 86_400_000;
/** Minuit UTC du jour courant — CORR exclut la bougie (partielle) de ce jour. */
const T0 = Math.floor(Date.now() / JOUR) * JOUR;

/**
 * Catalogue top 25 en ordre de capitalisation décroissante, stablecoins INTERCALÉS
 * (USDT 3ᵉ, USDC 7ᵉ, DAI 15ᵉ) : le top 20 éligible doit les enjamber et s'arrêter à APT.
 */
const CATALOGUE = [
  "BTC", "ETH", "USDT", "XRP", "BNB", "SOL", "USDC", "DOGE", "TRX", "ADA",
  "LINK", "AVAX", "XLM", "SUI", "DAI", "LTC", "TON", "SHIB", "DOT", "UNI",
  "AAVE", "PEPE", "APT", "NEAR", "ICP",
];

const MARCHES = CATALOGUE.map((t, i) => ({
  id: t.toLowerCase(),
  symbol: t.toLowerCase(),
  name: t,
  current_price: 1,
  market_cap: 1e12 - i * 1e9,
  price_change_percentage_24h: 0,
}));

const GLOBAL = {
  data: {
    total_market_cap: { usd: 3e12 },
    total_volume: { usd: 1e11 },
    market_cap_percentage: { btc: 50, eth: 10 },
    market_cap_change_percentage_24h_usd: 0.5,
  },
};

/** Bouchonne Binance (klines + repli), Twelve Data (/tdapi) et CoinGecko. */
async function bouchonnerReseau(page: Page): Promise<void> {
  // Repli générique Binance (exchangeInfo…) AVANT la route klines : Playwright teste
  // les routes de la plus récente à la plus ancienne, la plus spécifique gagne.
  await page.route("**/api.binance.com/**", (route) => route.fulfill({ json: [] }));
  // Catalogue des paires réelles (fetchPairs — filtre de l'univers top-N depuis la
  // revue Lot 3) : toutes les paires du CATALOGUE bouchonné sont « listées ».
  await page.route("**/api.binance.com/api/v3/exchangeInfo*", (route) =>
    route.fulfill({
      json: { symbols: CATALOGUE.map((t) => ({ symbol: `${t}USDT`, status: "TRADING" })) },
    }),
  );
  await page.route("**/api.binance.com/api/v3/klines*", (route) => {
    const url = new URL(route.request().url());
    const symbol = url.searchParams.get("symbol") ?? "X";
    // Marche pseudo-aléatoire DÉTERMINISTE par symbole : corrélations variées mais stables.
    let graine = 0;
    for (const ch of symbol) graine = (graine * 31 + ch.charCodeAt(0)) % 997;
    const lignes = Array.from({ length: 60 }, (_, i) => {
      const t = T0 - (59 - i) * JOUR;
      const close = 100 + 10 * Math.sin(i * 0.35 + graine) + (graine % 7) * i * 0.01;
      return [
        t, String(close), String(close + 1), String(close - 1), String(close),
        "1000", t + JOUR - 1, "100000", 100, "500", "50000", "0",
      ];
    });
    return route.fulfill({ json: lignes });
  });
  await page.route("**/tdapi/**", (route) => route.fulfill({ json: { status: "ok", values: [] } }));
  await page.route("**/api.coingecko.com/**", (route) => route.fulfill({ json: {} }));
  await page.route("**/api.coingecko.com/api/v3/global*", (route) => route.fulfill({ json: GLOBAL }));
  await page.route("**/api.coingecko.com/api/v3/coins/markets*", (route) => route.fulfill({ json: MARCHES }));
  await page.route("**/api.coingecko.com/api/v3/coins/categories*", (route) => route.fulfill({ json: [] }));
}

/** Ouvre la fenêtre CORR via la palette ⌘K et renvoie son locator. */
async function ouvrirCorr(page: Page) {
  // Attendre le montage AVANT la frappe : l'écouteur ⌘K est posé par un effet React,
  // une pression trop précoce se perd (leçon du gate v2.4).
  await expect(page.getByRole("button", { name: /^Indicateurs/ })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder(/^Commande/).fill("CORR");
  await page.keyboard.press("Enter");
  await expect(page.getByPlaceholder(/^Commande/)).toHaveCount(0);
  return page.locator('[role="complementary"][aria-label="Corrélations"]');
}

test.beforeEach(async ({ page }) => {
  await bouchonnerReseau(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
  });
});

test("Top 20 → matrice 20×20 sans saisie ; univers, 7 j, tri et onglet retrouvés après fermeture/rechargement/réouverture", async ({ page }) => {
  await page.goto("/");
  const fenetre = await ouvrirCorr(page);
  await expect(fenetre).toBeVisible();

  // 1. Univers « Top 20 » : 20 paires dérivées du catalogue bouchonné, stablecoins
  //    exclus, AUCUNE saisie manuelle. n = 20 → cellule 24 px → canvas 538 px de large.
  await fenetre
    .getByRole("group", { name: "Univers de la matrice" })
    .getByRole("button", { name: "Top 20" })
    .click();
  const canvas = fenetre.locator("canvas.cursor-pointer");
  await expect(canvas).toHaveCSS("width", "538px", { timeout: 15_000 });
  // Toutes les séries bouchonnées répondent : aucune chip d'échec de chargement.
  await expect(fenetre.getByText(/échec de chargement/)).toHaveCount(0);

  // 2. Fenêtre 7 j (ajoutée par CORR v2), tri Similarité, onglet Paires.
  await fenetre.getByRole("button", { name: "7j", exact: true }).click();
  await fenetre
    .getByRole("group", { name: "Tri de la matrice" })
    .getByRole("button", { name: "Similarité" })
    .click();
  await fenetre.getByRole("button", { name: "Paires", exact: true }).click();
  await expect(fenetre.getByRole("button", { name: "10 plus corrélées" })).toBeVisible();
  await expect(fenetre.getByRole("button", { name: "10 moins corrélées" })).toBeVisible();

  // 3. Fermer puis RECHARGER la page : le vrai critère est l'hydratation localStorage
  //    (sans rechargement, le store module survivrait et le test ne prouverait rien).
  await fenetre.getByTitle("Fermer").click();
  await expect(fenetre).toHaveCount(0);
  await page.reload();
  const fenetre2 = await ouvrirCorr(page);
  await expect(fenetre2).toBeVisible();

  // 4. Réglages retrouvés : univers, fenêtre, tri (segments aria-pressed) et onglet.
  await expect(
    fenetre2.getByRole("group", { name: "Univers de la matrice" }).getByRole("button", { name: "Top 20" })
  ).toHaveAttribute("aria-pressed", "true");
  await expect(fenetre2.getByRole("button", { name: "7j", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(
    fenetre2.getByRole("group", { name: "Tri de la matrice" }).getByRole("button", { name: "Similarité" })
  ).toHaveAttribute("aria-pressed", "true");
  // Onglet « Paires » retrouvé : la table et ses raccourcis sont montés, pas la matrice.
  await expect(fenetre2.getByRole("button", { name: "10 plus corrélées" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(fenetre2.locator("canvas.cursor-pointer")).toHaveCount(0);
});
