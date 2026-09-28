import { expect, type Page } from "@playwright/test";

/** Parcours réels du chrome : les panneaux avancés sont chargés à la demande. */
export async function ouvrirOptionsGraphique(page: Page): Promise<void> {
  const panneau = page.getByRole("dialog", { name: "Options du graphique", exact: true });
  if (!await panneau.isVisible()) await page.getByRole("button", { name: "Options du graphique", exact: true }).click();
  await expect(panneau).toBeVisible();
}

export async function ouvrirFavoris(page: Page): Promise<void> {
  const panneau = page.getByRole("dialog", { name: "Panneaux du terminal", exact: true });
  if (!await panneau.isVisible()) await page.getByRole("banner").getByRole("button", { name: "Favoris", exact: true }).click();
  await expect(panneau).toBeVisible();
}

export async function ouvrirDetailsMarche(page: Page): Promise<void> {
  const bouton = page.locator("[data-chart-banner]").first().getByRole("button", { name: "Détails du marché et ratios", exact: true });
  if (await bouton.getAttribute("aria-expanded") !== "true") await bouton.click();
  await expect(bouton).toHaveAttribute("aria-expanded", "true");
}

/** Choisir un outil dans le catalogue commun, sans dépendre du mode pages/fenêtres. */
export async function ouvrirOutil(page: Page, id: string): Promise<void> {
  await page.getByRole("banner").getByRole("button", { name: "Rubriques", exact: true }).click();
  await page.getByRole("dialog", { name: "Rubriques et outils", exact: true }).locator(`[data-tool-id="${id}"]`).click();
  await expect(page.locator(`[data-window-id="${id}"]`)).toBeVisible();
}
