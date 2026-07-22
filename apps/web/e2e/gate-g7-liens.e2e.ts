import { test, expect, type Page } from "@playwright/test";

/**
 * Gate G100 — G7 : « Lien panneau → chart (symbole + marqueur/TF) en 1 clic ».
 *
 * ⚠ RÉSEAU REQUIS : univers Binance (EQS), liste de paires Binance (MAP) —
 * daemon toléré absent (proxy Vite /extapi en dev). La treemap MAP est servie
 * par une FIXTURE de cache local (le tier keyless CoinGecko 429 en runs
 * répétés — voir le test MAP) ; le lien clic → chart reste réel.
 *
 * Couverture automatisée : EQS (clic ligne de résultat) et MAP (clic tuile
 * treemap) — les deux passent par le MÊME bus `navigateTo` (lib/navigation).
 * Reste au protocole MANUEL : ECO / NEWS / BRIEF — leurs listes dépendent de
 * flux externes lents/aléatoires (RSS, calendrier éco, snapshot composite) dont
 * la présence d'items cliquables n'est pas garantie à un instant t ; un test qui
 * en dépend serait flaky. Leur câblage utilise le même bus navigateTo vérifié ici.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "axiom:onboarding:v1",
      JSON.stringify({ completed: true, step: 0 }),
    );
  });
});

/** Zone du chart maître (exclut sidebar/fenêtres) — porte le SymbolBanner. */
function zoneChart(page: Page) {
  return page.locator("main .isolate");
}

/**
 * Positionne le chart sur ETHBTC (paire Binance réelle, jamais présente dans les
 * résultats EQS/MAP qui sont cotés USDT/USDC) : tout retour à un symbole
 * USDT/USDC prouve donc la navigation panneau → chart.
 */
async function poserSymboleTemoin(page: Page) {
  const recherche = page.getByLabel("Rechercher une paire");
  await recherche.fill("ETHBTC");
  await recherche.press("Enter");
  await expect(zoneChart(page).getByText("ETHBTC", { exact: true })).toBeVisible({
    timeout: 10_000,
  });
}

test("EQS : cliquer un résultat ouvre le symbole dans le chart", async ({ page }) => {
  await page.goto("/");
  await poserSymboleTemoin(page);

  await page.getByRole("button", { name: "Fonctions" }).click();
  await page.getByRole("menuitem", { name: /Screener/ }).click();
  const fenetre = page.getByRole("complementary", { name: "Screener d'actifs" });
  await expect(fenetre).toBeVisible({ timeout: 15_000 });

  // Preset non vide par construction (volume 24 h > 100 M$ : BTC/ETH toujours dedans).
  await fenetre.getByRole("button", { name: "Volume anormal" }).click();
  await fenetre.getByRole("button", { name: "Lancer le screen" }).click();
  const lignes = fenetre.locator('button[title^="Ouvrir "]');
  await expect(lignes.first()).toBeVisible({ timeout: 15_000 });

  // Symbole de la 1re ligne, lu depuis son infobulle « Ouvrir X dans le chart ».
  const titre = (await lignes.first().getAttribute("title")) ?? "";
  const symbole = /^Ouvrir (\S+) dans le chart$/.exec(titre)?.[1];
  expect(symbole).toBeTruthy();
  await lignes.first().click();

  // Le chart maître bascule sur le symbole cliqué (le témoin ETHBTC disparaît).
  await expect(zoneChart(page).getByText(symbole!, { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await expect(zoneChart(page).getByText("ETHBTC", { exact: true })).toHaveCount(0);
});

test("MAP : cliquer une tuile de la treemap ouvre le symbole dans le chart", async ({ page }) => {
  // FIXTURE : cache local CoinGecko posé AVANT le boot (clé + forme de
  // data/marketOverview.ts, TTL 5 min). Constat en run réel : le tier keyless
  // CoinGecko répond 429 dès que la suite tourne deux fois de suite (l'app tire
  // déjà /global au boot) → « Carte indisponible. » = flake pur quota, hors
  // critère. G7 mesure le LIEN clic tuile → chart : la navigation (navigateTo +
  // garde-fou catalogue Binance, chargé en RÉSEAU réel) reste intégralement
  // exercée ; seule la source de la treemap est fixée.
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "axiom.marketmap.overview.v1",
      JSON.stringify({
        global: {
          totalMcapUsd: 3.2e12,
          totalVolumeUsd: 1.1e11,
          btcDominance: 55,
          ethDominance: 12,
          mcapChangePct24h: 1.2,
        },
        coins: [
          { id: "bitcoin", symbol: "BTC", name: "Bitcoin", mcapUsd: 1.8e12, price: 100_000, changePct24h: 1.5 },
          { id: "ethereum", symbol: "ETH", name: "Ethereum", mcapUsd: 4.0e11, price: 3_500, changePct24h: -0.8 },
          { id: "solana", symbol: "SOL", name: "Solana", mcapUsd: 9.0e10, price: 180, changePct24h: 2.1 },
        ],
        sectors: [],
        fetchedAt: Date.now(),
        stale: false,
      }),
    );
  });
  await page.goto("/");
  await poserSymboleTemoin(page);

  await page.getByRole("button", { name: "Fonctions" }).click();
  await page.getByRole("menuitem", { name: /Vue marché/ }).click();
  const fenetre = page.getByRole("complementary", { name: "Vue marché (treemap)" });
  await expect(fenetre).toBeVisible({ timeout: 15_000 });

  // Le canvas n'est rendu qu'une fois l'aperçu (ici : cache) disponible.
  const canvas = fenetre.locator("canvas");
  await expect(canvas).toBeVisible({ timeout: 15_000 });

  // Coin haut-gauche = plus grosse capitalisation (squarify trie par aire
  // décroissante) = BTC. Boucle tolérante : la liste des paires Binance
  // (garde-fou du clic) se charge en parallèle — on re-clique jusqu'à bascule.
  await expect(async () => {
    await canvas.click({ position: { x: 30, y: 30 } });
    await expect(zoneChart(page).getByText("ETHBTC", { exact: true })).toHaveCount(0, {
      timeout: 1_500,
    });
  }).toPass({ timeout: 15_000 });

  // Le chart maître a basculé sur la tuile cliquée (BTC → BTCUSDT).
  await expect(zoneChart(page).getByText("BTCUSDT", { exact: true })).toBeVisible();
});
