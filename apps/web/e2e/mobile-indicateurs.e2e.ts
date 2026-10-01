import { expect, test, type Locator, type Page } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";
import { preparerPrereglages, lirePaneAnalyse, lireInstances } from "./helpers/prereglages-indicateurs";

async function dansEcran(page: Page, controle: Locator): Promise<void> {
  await controle.scrollIntoViewIfNeeded();
  const box = await controle.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
}

for (const width of [320, 390]) {
  test(`${width}px : préréglage tactile, aide, vraie pane et annulation préservant les actifs`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await bouchonnerReseau(page);
    await preparerPrereglages(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Options", exact: true }).tap();
    // Le bouton des légendes du chart porte « Indicateurs (1) » ; ici ouvrir le catalogue des Options.
    await page.getByRole("button", { name: /^Indicateurs \d+$/ }).tap();
    await page.getByText("Préréglages d’analyse · 3", { exact: true }).tap();
    const avant = await lireInstances(page);
    for (const nom of ["Polyvalent", "Intraday", "Swing"]) {
      await dansEcran(page, page.getByRole("button", { name: `Ajouter le préréglage ${nom}`, exact: true }));
    }
    await page.getByLabel("Comprendre le préréglage Intraday", { exact: true }).tap();
    await expect(page.getByText(/NR7 vaut 1/)).toBeVisible();
    const ajouter = page.getByRole("button", { name: "Ajouter le préréglage Intraday", exact: true });
    await ajouter.tap();
    await expect(ajouter).toBeDisabled();
    await expect.poll(async () => {
      const pane = await lirePaneAnalyse(page, "narrowRange");
      return Boolean(pane?.canvas && pane.hauteur > 0 && Number.isFinite(pane.dernier?.nr));
    }).toBe(true);
    await page.getByText(/NR7 vaut 1/).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`prereglages-mobile-${width}.png`) });
    // L’aide reste dépliée : le catalogue doit rester utilisable sur 320 px.
    const recherche = page.getByPlaceholder(/Rechercher… \(CVD/);
    await dansEcran(page, recherche);
    await recherche.fill("RSI");
    await page.getByRole("button", { name: "Ajouter RSI", exact: true }).tap();
    const rsi = (await lireInstances(page)).find((i) => i.defId === "rsi")!;
    const annuler = page.getByRole("button", { name: "Annuler l’ajout Intraday", exact: true });
    await dansEcran(page, annuler);
    await annuler.tap();
    await expect.poll(() => lireInstances(page)).toEqual([...avant, rsi]);
    await expect.poll(() => lirePaneAnalyse(page, "narrowRange")).toBeNull();
  });
}
