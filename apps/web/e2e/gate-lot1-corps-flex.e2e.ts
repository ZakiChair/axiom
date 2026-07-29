import { expect, test } from "@playwright/test";

/**
 * Gate Lot 1 — le corps des fenêtres flottantes est un conteneur FLEX :
 * `flex-1` des enfants n'y est plus inerte (fini les doubles ascenseurs).
 *
 * POURQUOI ICI et pas en unitaire : `apps/web` tourne en env vitest NODE (pas de
 * jsdom, et aucune dépendance de rendu ne peut être ajoutée — BUILD-CONTRACT). Le
 * calcul CSS (`display`, `flex-direction`) n'est vérifiable que dans un vrai
 * navigateur.
 *
 * STRUCTUREL, sans donnée de marché live : la fenêtre Notes / journal (NOTE) est
 * locale, sans appel réseau — la suite passe hors ligne.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "axiom:onboarding:v1",
      JSON.stringify({ completed: true, step: 0 }),
    );
  });
});

test("le corps de FloatingWindow est un conteneur flex-col", async ({ page }) => {
  await page.goto("/");
  // Attendre le montage AVANT la frappe : l'écouteur ⌘K est posé par un effet React,
  // une pression trop précoce se perd (leçon du gate v2.4).
  await expect(page.getByRole("button", { name: /^Indicateurs/ })).toBeVisible();
  // NOTE : fenêtre locale sans réseau — Notes / journal.
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder(/^Commande/).fill("NOTE");
  await page.keyboard.press("Enter");

  const fenetre = page.locator('[data-window-id="notes"]');
  await expect(fenetre).toBeVisible();
  const corps = fenetre.locator(":scope > div.min-h-0.flex-1");
  await expect(corps).toHaveCSS("display", "flex");
  await expect(corps).toHaveCSS("flex-direction", "column");
});
