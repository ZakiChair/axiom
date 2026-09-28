import { expect, test } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
test.beforeEach(async ({ page }) => {
  await bouchonnerReseau(page);
  await page.addInitScript(() => localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 })));
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Navigation du terminal" })).toBeVisible();
});

test("recherche mobile : flèches, ARIA et sélection restent cohérentes après rotation", async ({ page }) => {
  await page.getByRole("banner").getByRole("combobox", { name: /rechercher/i }).tap();
  const menu = page.locator(".axiom-mobile-menu-root:visible");
  const champ = menu.locator("input").first();
  await champ.fill("A");
  const options = menu.getByRole("option");
  await expect.poll(() => options.count()).toBeGreaterThan(1);
  await champ.press("ArrowDown");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(champ).toHaveAttribute("role", "combobox");
  await expect(champ).toHaveAttribute("aria-controls", await menu.getByRole("listbox").getAttribute("id") ?? "");
  await expect(champ).toHaveAttribute("aria-activedescendant", await options.nth(1).getAttribute("id") ?? "");
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(champ).toHaveValue("A");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  await champ.press("ArrowUp");
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  await champ.press("ArrowDown");
  const symbole = await options.nth(1).locator("span span").first().innerText();
  await champ.press("Enter");
  await expect(page.locator("[data-chart-banner]")).toContainText(symbole);
  await expect(menu).toHaveCount(0);
  const source = page.getByRole("banner").getByRole("combobox", { name: "Rechercher une paire", exact: true });
  await expect(source).toBeFocused();
  await page.getByRole("navigation", { name: "Navigation du terminal" }).getByRole("button", { name: "Graphique", exact: true }).focus();
  await page.keyboard.press("/");
  await expect(menu.getByRole("combobox", { name: "Rechercher une paire", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(source).toBeFocused();
});

test("Réglages mobile : fermer et rouvrir conserve un faux brouillon sans le sauvegarder", async ({ page }) => {
  const ouvrir = page.getByRole("banner").getByRole("button", { name: "Réglages", exact: true });
  await ouvrir.tap();
  const panneau = page.getByRole("dialog", { name: "Réglages", exact: true });
  const champ = panneau.getByPlaceholder("Clé API Twelve Data", { exact: true });
  const brouillon = "brouillon-fictif-mobile-jamais-sauvegarde";
  await champ.fill(brouillon);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(champ).toHaveValue(brouillon);
  await panneau.getByRole("button", { name: "Fermer les réglages" }).tap();
  await expect(panneau).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await ouvrir.tap();
  await expect(champ).toHaveValue(brouillon);
  // Le passage au bureau change le mode de présentation, jamais l'état du formulaire.
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole("navigation", { name: "Navigation du terminal" })).toHaveCount(0);
  await expect(champ).toHaveValue(brouillon);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("navigation", { name: "Navigation du terminal" })).toBeVisible();
  await expect(champ).toHaveValue(brouillon);
  expect(await page.evaluate((valeur) => Object.values(localStorage).some((v) => v.includes(valeur)), brouillon)).toBe(false);
});

test("menu Colonnes mobile : Échap rend le focus et laisse le panneau parent ouvert", async ({ page }) => {
  await page.getByRole("navigation", { name: "Navigation du terminal" }).getByRole("button", { name: "Panneaux", exact: true }).tap();
  const panneau = page.getByRole("dialog", { name: "Panneaux du terminal", exact: true });
  const declencheur = panneau.getByRole("button", { name: "Colonnes de la watchlist", exact: true });
  await declencheur.tap();
  const menu = page.locator(".axiom-mobile-menu-root:visible").getByRole("menu");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(panneau).toBeVisible();
  await expect(declencheur).toBeFocused();
});
