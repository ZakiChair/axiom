import { expect, test, type Page } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

test.beforeEach(async ({ page }) => {
  await bouchonnerReseau(page);
  await page.addInitScript(() => localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 })));
});

test("les deux catalogues chargent au premier clic et Échap rend le focus au déclencheur", async ({ page }) => {
  const modules: string[] = [];
  page.on("request", (request) => {
    if (/\/(IndicatorMenu|StrategyMenu)\.tsx/.test(request.url())) modules.push(request.url());
  });
  await page.goto("/");
  const indicateurs = page.getByRole("button", { name: /^Indicateurs/ });
  const strategies = page.getByRole("button", { name: /^Stratégies/ });
  await expect(indicateurs).toBeVisible();
  await expect(strategies).toBeVisible();
  expect(modules).toEqual([]);

  await strategies.click();
  await expect(page.getByPlaceholder(/Rechercher… \(croisement/)).toBeVisible();
  expect(modules.some((url) => url.includes("StrategyMenu.tsx"))).toBe(true);
  expect(modules.some((url) => url.includes("IndicatorMenu.tsx"))).toBe(false);
  await page.keyboard.press("Escape");
  await expect(strategies).toBeFocused();

  await indicateurs.click();
  await expect(page.getByPlaceholder(/Rechercher… \(CVD/)).toBeVisible();
  expect(modules.some((url) => url.includes("IndicatorMenu.tsx"))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(indicateurs).toBeFocused();
});

test("les réglages Footprint restent chargés seulement à l'ouverture au clavier", async ({ page }) => {
  const modules: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("FootprintSettingsPanel.tsx")) modules.push(request.url());
  });
  await page.goto("/");
  const orderflow = page.getByRole("button", { name: "Orderflow" });
  await expect(orderflow).toBeVisible();
  expect(modules).toEqual([]);
  await orderflow.focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("dialog", { name: "Paramètres Footprint" })).toBeVisible();
  expect(modules).toHaveLength(1);
});

test("favoris, récents et recherche se cumulent ; un récent suit un ajout effectif", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^Indicateurs/ }).click();
  const recherche = page.getByPlaceholder(/Rechercher… \(CVD/);
  await recherche.fill("EMA");
  await page.getByRole("button", { name: "Ajouter EMA aux favoris" }).focus();
  await page.keyboard.press("Enter");
  await recherche.fill("");
  await page.getByRole("button", { name: "Favoris", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Ajouter EMA", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ajouter RSI", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Récents", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ajouter EMA", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Récents", exact: true }).click();
  await page.getByRole("button", { name: "Ajouter EMA", exact: true }).click();
  await page.getByRole("button", { name: "Récents", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ajouter EMA", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Utilisables ici" }).click();
  await expect(page.getByRole("button", { name: "Ajouter EMA", exact: true })).toBeVisible();
  await recherche.locator("..").locator("..").screenshot({ path: process.env.AXIOM_VISUAL_DIR
    ? `${process.env.AXIOM_VISUAL_DIR}/filtres-indicateurs.png`
    : testInfo.outputPath("filtres-indicateurs.png") });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("axiom:indicatorPreferences:v1") ?? "{}").recents)).toEqual(["ema"]);
});

test("quota des préférences : favori gardé en mémoire puis réessayé sans nouveau clic", async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    let bloquer = true;
    (window as unknown as { autoriserPreferences: () => void }).autoriserPreferences = () => { bloquer = false; };
    Storage.prototype.setItem = function (key, value) {
      if (bloquer && key === "axiom:indicatorPreferences:v1") throw new DOMException("quota", "QuotaExceededError");
      original.call(this, key, value);
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: /^Indicateurs/ }).click();
  await page.getByPlaceholder(/Rechercher… \(CVD/).fill("EMA");
  await page.getByRole("button", { name: "Ajouter EMA aux favoris" }).click();
  const erreur = page.getByRole("alert").filter({ hasText: "Préférences non enregistrées" });
  await expect(erreur).toBeVisible();
  await expect(page.getByRole("button", { name: "Retirer EMA des favoris" })).toBeVisible();
  await page.evaluate(() => (window as unknown as { autoriserPreferences: () => void }).autoriserPreferences());
  await page.getByRole("button", { name: "Réessayer la sauvegarde" }).click();
  await expect(erreur).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("axiom:indicatorPreferences:v1") ?? "{}").favoris)).toEqual(["ema"]);
  await page.reload();
  await page.getByRole("button", { name: /^Indicateurs/ }).click();
  await page.getByPlaceholder(/Rechercher… \(CVD/).fill("EMA");
  await expect(page.getByRole("button", { name: "Retirer EMA des favoris" })).toBeVisible();
});

test("utilisables ici cache l'indicateur indisponible sans effacer sa raison ni son favori", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { marketStore } = await import("/src/store/market.ts");
    marketStore.getState().setMarket({ exchange: "synthetic", symbol: "BTCUSDT", timeframe: "1h" });
  });
  await page.getByRole("button", { name: /^Indicateurs/ }).click();
  await page.getByPlaceholder(/Rechercher… \(CVD/).fill("Volume");
  const volume = page.getByRole("button", { name: "Ajouter Volume", exact: true });
  await expect(volume).toBeDisabled();
  await expect(volume).toHaveAttribute("title", "Volume non défini sur une série synthétique");
  await page.getByRole("button", { name: "Ajouter Volume aux favoris" }).click();
  await page.getByRole("button", { name: "Favoris", exact: true }).click();
  await page.getByRole("button", { name: "Utilisables ici" }).click();
  await expect(volume).toHaveCount(0);
  await page.getByRole("button", { name: "Utilisables ici" }).click();
  await expect(volume).toBeDisabled();
  await expect(page.getByRole("button", { name: "Retirer Volume des favoris" })).toBeVisible();
});

async function ouvrirModule(page: Page, module: "IndicatorMenu" | "StrategyMenu" | "FootprintSettingsPanel") {
  if (module === "IndicatorMenu") await page.getByRole("button", { name: /^Indicateurs/ }).click();
  else if (module === "StrategyMenu") await page.getByRole("button", { name: /^Stratégies/ }).click();
  else {
    await page.getByRole("button", { name: "Orderflow" }).focus();
    await page.keyboard.press("Shift+F10");
  }
}

for (const module of ["IndicatorMenu", "StrategyMenu", "FootprintSettingsPanel"] as const) {
  test(`${module} : un import échoué propose un rechargement qui permet l'ouverture`, async ({ page }) => {
    let appels = 0;
    await page.route(`**/src/components/${module}.tsx*`, (route) => {
      appels++;
      return appels === 1 ? route.fulfill({ status: 503, body: "indisponible" }) : route.continue();
    });
    await page.goto("/");
    await ouvrirModule(page, module);
    const erreur = page.getByRole("alert").filter({ hasText: module === "FootprintSettingsPanel" ? "Réglages Footprint indisponibles" : "Chargement impossible" });
    await expect(erreur).toBeVisible();
    expect(appels).toBe(1);
    await erreur.getByRole("button", { name: "Recharger l'application" }).click();
    await ouvrirModule(page, module);
    if (module === "IndicatorMenu") await expect(page.getByPlaceholder(/Rechercher… \(CVD/)).toBeVisible();
    else if (module === "StrategyMenu") await expect(page.getByPlaceholder(/Rechercher… \(croisement/)).toBeVisible();
    else await expect(page.getByRole("dialog", { name: "Paramètres Footprint" })).toBeVisible();
    expect(appels).toBe(2);
  });
}
