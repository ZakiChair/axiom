import { test, expect } from "@playwright/test";

/**
 * Gate G100 — G2 : « Toute métrique DES/liq/on-chain a un badge 🟢🟡🔴 ».
 *
 * ⚠ RÉSEAU REQUIS : contrairement au smoke structurel, les specs de gate tournent
 * contre les APIs publiques (Binance, Coinalyze via proxy Vite /extapi, Coin
 * Metrics…). Le daemon est TOLÉRÉ ABSENT (l'app fonctionne sans en dev).
 *
 * Couverture automatisée : PRÉSENCE DOM des pastilles `BadgeFiabilite`
 * (labels du catalogue lib/fiabilite.ts) dans DES et CHAIN — les pastilles sont
 * rendues statiquement (indépendamment de l'arrivée des données), donc stable.
 * Reste au protocole MANUEL : le jugement VISUEL 🟢🟡🔴 (couleurs des tons
 * up/warn/down par thème) et l'audit d'exhaustivité métrique par métrique.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "axiom:onboarding:v1",
      JSON.stringify({ completed: true, step: 0 }),
    );
  });
});

test("DES : les métriques OI / funding portent un badge de fiabilité Coinalyze", async ({ page }) => {
  await page.goto("/");
  // Bouton dédié de la Toolbar (DES est `menuHidden` dans le registre).
  await page.getByRole("button", { name: "Produits dérivés" }).click();
  const fenetre = page.getByRole("complementary", { name: "Produits dérivés" });
  await expect(fenetre).toBeVisible({ timeout: 15_000 });
  // Badges catalogue coinalyze:* (label « ≤1 min · Coinalyze ») : au moins OI + funding.
  const badges = fenetre.getByText("≤1 min · Coinalyze");
  await expect(badges.first()).toBeVisible({ timeout: 15_000 });
  await expect(badges.nth(1)).toBeVisible();
});

test("CHAIN : les widgets on-chain portent un badge de fiabilité (Coin Metrics / BGeometrics)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Fonctions" }).click();
  await page.getByRole("menuitem", { name: /On-chain/ }).click();
  const fenetre = page.getByRole("complementary", { name: "On-chain" });
  await expect(fenetre).toBeVisible({ timeout: 15_000 });
  // Widgets Valorisation (MVRV ratio, cap. marché BTC) — badge « daily · Coin Metrics ».
  const badgesCm = fenetre.getByText("daily · Coin Metrics");
  await expect(badgesCm.first()).toBeVisible({ timeout: 15_000 });
  await expect(badgesCm.nth(1)).toBeVisible();
  // Widgets BGeometrics (MVRV-Z, SOPR, NUPL) — badge « daily · BGeometrics ».
  await expect(fenetre.getByText("daily · BGeometrics").first()).toBeVisible();
});
