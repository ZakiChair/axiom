import { expect, test } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

/**
 * DES : section « OI perps DEX » (DefiLlama, catégorie Derivatives). Réseau bouchonné,
 * fixture synthétique de 31 jours. Vérifie : section présente dans les branches « avec clé »
 * et « hors Binance » de la fenêtre, aucun appel avant le dépliage, lectures calculées sur la
 * seule catégorie Derivatives, un seul appel malgré repli / dépliage et réouverture (cache
 * dérivé 1 h, jamais le JSON brut).
 */
const JOUR_S = 86_400;
const T0 = Date.UTC(2026, 7, 15) / 1000; // 2026-08-15 00:00 UTC ; dernier point 2026-09-14.

function total(i: number): number {
  if (i === 0) return 18.235e9; // J-30 → Δ30j +27.5 %
  if (i === 10) return 26.55e9; // record du 2026-08-25
  if (i === 23) return 23.87e9; // J-7 → Δ7j −2.6 %
  if (i === 30) return 23.25e9;
  return 20e9;
}

function fixture() {
  return {
    totalDataChart: [],
    protocols: [
      { name: "Hyperliquid Perps", category: "Derivatives" },
      { name: "Aster Perps", category: "Derivatives" },
      { name: "Kalshi", category: "Prediction Market" },
    ],
    totalDataChartBreakdown: Array.from({ length: 31 }, (_, i) => [
      T0 + i * JOUR_S,
      { "Hyperliquid Perps": total(i) * 0.594, "Aster Perps": total(i) * 0.406, Kalshi: 1.76e9 },
    ]),
  };
}

test("DES : OI perps DEX chargé au premier dépliage, indépendant de la branche Coinalyze, servi ensuite par le cache", async ({ page }) => {
  await bouchonnerReseau(page);
  await page.addInitScript(() => {
    localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
  });
  const urls: string[] = [];
  await page.route(
    (url) => url.hostname === "api.llama.fi" && url.pathname === "/overview/open-interest",
    (route) => {
      urls.push(route.request().url());
      return route.fulfill({ json: fixture() });
    },
  );

  await page.goto("/");
  await page.getByRole("button", { name: "Produits dérivés" }).click();
  const des = page.getByRole("complementary", { name: "Produits dérivés" });
  // En dev local, la clé Coinalyze est réputée disponible (repli `.env` du proxy) : branche
  // « avec clé », en échec réseau. La branche hors Binance est couverte plus bas.
  await expect(des).toContainText("Données dérivées indisponibles");
  const bouton = des.getByRole("button", { name: /OI perps DEX/i });
  await expect(bouton).toHaveAttribute("aria-expanded", "false");
  expect(urls).toHaveLength(0);

  await bouton.click();
  await expect(des).toContainText("$23.25B");
  await expect(des).toContainText("-2.6%");
  await expect(des).toContainText("+27.5%");
  await expect(des).toContainText("59.4 %");
  await expect(des).toContainText("$26.55B");
  await expect(des).toContainText("2026-08-25");
  await expect(des).toContainText("-12.4%");
  await expect(des).toContainText("tous actifs");
  await expect(des).toContainText("+29 %");
  await expect(des.getByRole("img", { name: "OI perps DEX quotidien" })).toBeVisible();
  expect(urls).toHaveLength(1);
  expect(urls[0]).toContain("excludeTotalDataChart=true");
  expect(urls[0]).not.toContain("excludeTotalDataChartBreakdown");

  const cache = await page.evaluate(() => localStorage.getItem("axiom:onchain:dex:oi-perps"));
  expect(cache).not.toBeNull();
  expect(cache).not.toContain("totalDataChartBreakdown");
  expect(cache).not.toContain("Kalshi");

  // Repli puis dépliage : aucun second appel (verrou « déjà chargé »).
  await bouton.click();
  await expect(bouton).toHaveAttribute("aria-expanded", "false");
  await bouton.click();
  await expect(des).toContainText("$23.25B");
  await page.waitForTimeout(300);
  expect(urls).toHaveLength(1);

  // Source hors Binance : la branche Coinalyze bascule, la section reste en place et dépliée.
  await page.getByRole("combobox", { name: "Source" }).selectOption("bybit");
  await expect(des).toContainText("Binance uniquement");
  await expect(des).toContainText("59.4 %");
  expect(urls).toHaveLength(1);

  // Fermeture puis réouverture de DES : la section repart repliée, le cache 1 h la sert.
  await des.getByTitle("Fermer").click();
  await expect(des).toHaveCount(0);
  await page.getByRole("button", { name: "Produits dérivés" }).click();
  await des.getByRole("button", { name: /OI perps DEX/i }).click();
  await expect(des).toContainText("59.4 %");
  await page.waitForTimeout(300);
  expect(urls).toHaveLength(1);
});
