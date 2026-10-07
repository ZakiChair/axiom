import { test, expect, type Page } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

/**
 * Commandes de palette dont le contrôleur est chargé au premier usage (WHALE, MARKS :
 * `import()` depuis commands/windowPanels.ts, cf. chargementInitial.test.ts). Le garde-fou
 * unitaire prouve que ces modules sont hors du chemin initial ; ce test prouve l'autre
 * moitié : la commande les charge réellement et bascule sans erreur, deux fois de suite.
 * Sans données de marché (réseau bouchonné) : les contrôleurs restent inertes, seul le
 * chargement et la bascule sont observés.
 */
async function commande(page: Page, texte: string): Promise<void> {
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder(/^Commande/).fill(texte);
  await page.keyboard.press("Enter");
}

test.beforeEach(async ({ page }) => {
  await bouchonnerReseau(page);
  await page.addInitScript(() => {
    localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
  });
});

for (const { mnemonique, module } of [
  { mnemonique: "WHALE", module: "chart/whaleBubbles" },
  { mnemonique: "MARKS", module: "chart/tradeMarkers" },
]) {
  test(`${mnemonique} charge ${module} au premier usage, sans erreur, et rebascule`, async ({ page }) => {
    // Exceptions non rattrapées et avertissement d'échec de la commande ; les 503 du réseau
    // bouchonné (backfill, flux) sont attendus et ne comptent pas.
    const erreurs: string[] = [];
    page.on("pageerror", (erreur) => erreurs.push(erreur.message));
    page.on("console", (message) => {
      if (message.text().includes(`[AXIOM] ${mnemonique}`)) erreurs.push(message.text());
    });
    const modulesCharges: string[] = [];
    page.on("request", (requete) => {
      if (requete.url().includes(module)) modulesCharges.push(requete.url());
    });

    await page.goto("/");
    await expect(page.getByRole("banner").getByRole("button", { name: /^Indicateurs/ })).toBeVisible();
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
    // Chemin initial : le module n'a pas été demandé.
    expect(modulesCharges).toEqual([]);

    await commande(page, mnemonique);
    await expect.poll(() => modulesCharges.length, { timeout: 15_000 }).toBeGreaterThan(0);
    // Second passage : module déjà évalué, simple bascule.
    await commande(page, mnemonique);
    await page.waitForTimeout(500);
    expect(erreurs).toEqual([]);
  });
}
