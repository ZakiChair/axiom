import { expect, test, type Page } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

async function outil(page: Page, mnemonic: string) {
  await page.getByRole("button", { name: "Rubriques", exact: true }).click();
  await page.getByRole("menuitem", { name: new RegExp(`^${mnemonic}\\b`) }).click();
}
async function manager(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("axiom:windowManager:v1") ?? "{}").notes);
}

test.beforeEach(async ({ page }) => {
  await bouchonnerReseau(page);
  await page.addInitScript(() => localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 })));
  await page.goto("/");
});

test("les 39 outils sont découvrables et les pages gardent le brouillon avec historique réel", async ({ page }) => {
  await page.getByRole("button", { name: "Rubriques", exact: true }).click();
  await expect(page.locator("[data-tool-id]")).toHaveCount(39);
  await page.getByRole("menuitem", { name: /^NOTE\b/ }).click();
  const notes = page.locator('[data-window-id="notes"]');
  const saisie = notes.getByPlaceholder(/^Note \(markdown/);
  await saisie.fill("Navigation avec brouillon préservé");
  await outil(page, "ECO");
  await expect(notes).toBeHidden();
  await expect(notes).toHaveAttribute("inert", "");
  await expect(page).toHaveURL(/#\/macro\/eco$/);
  await page.goBack();
  await expect(saisie).toHaveValue("Navigation avec brouillon préservé");
  await expect(page).toHaveURL(/#\/portefeuille\/notes$/);
  await page.goForward();
  await expect(page.locator('[data-window-id="eco"]')).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-window-id="eco"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Macro", exact: true }).first()).toHaveAttribute("aria-current", "true");
});

test("le catalogue contraint le focus et rend le clavier au déclencheur", async ({ page }) => {
  const ouvrir = page.getByRole("button", { name: "Rubriques", exact: true });
  await ouvrir.click();
  const dialogue = page.getByRole("dialog", { name: "Rubriques et outils" });
  await expect(dialogue.getByRole("searchbox")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialogue.getByRole("button", { name: "Fermer les rubriques" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect.poll(() => dialogue.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialogue).toHaveCount(0);
  await expect(ouvrir).toBeFocused();
});

test("Échap ferme d'abord le menu enfant des favoris et garde son déclencheur accessible", async ({ page }) => {
  await page.getByRole("button", { name: "Favoris", exact: true }).click();
  const favoris = page.getByRole("dialog", { name: "Panneaux du terminal" });
  const colonnes = favoris.getByRole("button", { name: /Colonnes/ });
  await colonnes.click();
  await expect(favoris.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(favoris.getByRole("menu")).toHaveCount(0);
  await expect(favoris).toBeVisible();
  await expect(colonnes).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(favoris).toBeHidden();
});

test("pages, commandes externes et rotation ne réécrivent pas une géométrie bureau", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("axiom:windowManager:v1", JSON.stringify({ notes: {
    id: "notes", open: false, minimized: false, z: 10, x: 900, y: 550, width: 740, height: 650, groupColor: null, preSnapGeometry: null,
  } })));
  await page.reload();
  await outil(page, "NOTE");
  const initial = await manager(page);
  await page.getByRole("toolbar", { name: "Fenêtres ouvertes" }).getByRole("button", { name: "Graphique", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Recherche", exact: true }).click();
  await page.getByRole("textbox", { name: "Saisie de commande" }).fill("NOTE");
  await page.getByRole("option", { name: /NOTE/ }).first().click();
  await expect(page.locator('[data-window-id="notes"]')).toBeVisible();
  const apres = await manager(page);
  for (const key of ["x", "y", "width", "height", "preSnapGeometry"]) expect(apres[key]).toEqual(initial[key]);
  await page.reload();
  const recharge = await manager(page);
  for (const key of ["x", "y", "width", "height", "preSnapGeometry"]) expect(recharge[key]).toEqual(initial[key]);
});

test("le mode fenêtres reste explicite et revenir en pages garde Notes monté", async ({ page }) => {
  await outil(page, "NOTE");
  const saisie = page.locator('[data-window-id="notes"]').getByPlaceholder(/^Note \(markdown/);
  await saisie.fill("Brouillon entre deux présentations");
  await page.getByRole("button", { name: "Mode fenêtres", exact: true }).click();
  await expect(page.locator('[data-window-id="notes"]').getByTitle("Maximiser / Restaurer")).toBeVisible();
  await page.getByRole("button", { name: "Mode pages", exact: true }).click();
  await expect(saisie).toHaveValue("Brouillon entre deux présentations");
  await expect(page.locator('[data-window-id="notes"]').getByTitle("Maximiser / Restaurer")).toHaveCount(0);
});


test("TICKER et le bouton Options commandent le même bandeau en pages et après reload", async ({ page }) => {
  const bandeau = page.locator(".axiom-ticker");
  await expect(bandeau).toHaveCount(0);
  await page.getByRole("button", { name: "Recherche", exact: true }).click();
  await page.getByRole("textbox", { name: "Saisie de commande" }).fill("TICKER");
  await page.getByRole("option", { name: /TICKER/ }).first().click();
  await expect(bandeau).toBeVisible();
  await page.reload();
  await expect(bandeau).toBeVisible();
  await page.getByRole("button", { name: "Options du graphique", exact: true }).click();
  await page.getByRole("button", { name: "Bandeau actualités", exact: true }).click();
  await expect(bandeau).toHaveCount(0);
  await page.reload();
  await expect(bandeau).toHaveCount(0);
});
