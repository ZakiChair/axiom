import { expect, test, type Locator, type Page } from "@playwright/test";

async function expectTouchTarget(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box, "la cible tactile doit avoir une boîte visible").not.toBeNull();
  expect(box!.height, "la cible tactile doit mesurer au moins 48 px de haut").toBeGreaterThanOrEqual(48);
}

async function restaurerDemonstration(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /^Données$/ }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Restaurer la démonstration" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Le jeu de démonstration a été restauré.",
  );
}

async function ouvrirDossier(page: Page, titre: RegExp) {
  await page.getByRole("button", { name: /^(Anomalies|Alertes)/ }).click();
  const fiche = page.getByRole("article", { name: titre });
  await expect(fiche).toBeVisible();
  await fiche.getByRole("button", { name: "Ouvrir un dossier" }).click();
}

test.beforeEach(async ({ page }) => {
  await restaurerDemonstration(page);
});

test("transforme l’anomalie Helvetia du tableau de bord en dossier avec lettre", async ({ page }) => {
  await page.getByRole("button", { name: /^(Vue d’ensemble|Accueil)$/ }).click();

  const toutesLesAnomalies = page.getByRole("button", { name: "Tout voir", exact: true });
  await expect(toutesLesAnomalies).toHaveText("Tout voir");

  await page
    .getByRole("button", { name: /Double débit possible — Helvetia Protect/ })
    .click();
  const ficheCible = page.getByRole("article", {
    name: /Double débit possible — Helvetia Protect/,
  });
  await expect(ficheCible).toBeFocused();
  await ficheCible.getByRole("button", { name: "Ouvrir un dossier" }).click();

  await expect(page.getByRole("heading", { name: "Dossiers", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Helvetia Protect", level: 2 })).toBeVisible();
  await expect(page.getByLabel("Lettre de réclamation")).toContainText(
    "Double débit possible",
  );
  await expect(page.getByLabel("Lettre de réclamation")).toContainText("89,90 CHF");
});

test("garde le dialogue au clavier et rend le focus au bouton d’ouverture", async ({ page }) => {
  await page.getByRole("button", { name: /^Contrats$/ }).click();
  const ouverture = page.getByRole("button", { name: "Nouveau contrat" });
  await ouverture.click();

  const dialogue = page.getByRole("dialog", { name: "Nouveau contrat" });
  const fermeture = dialogue.getByRole("button", { name: "Fermer la fenêtre" });
  await expect(fermeture).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialogue.getByRole("button", { name: "Confirmer le contrat" })).toBeFocused();
  await page.keyboard.press("Escape");

  await expect(dialogue).toHaveCount(0);
  await expect(ouverture).toBeFocused();
});

test("préserve deux brouillons de lettre lors du parcours A → B → A", async ({ page }) => {
  await ouvrirDossier(page, /Double débit possible — Helvetia Protect/);
  await ouvrirDossier(page, /Hausse de prix — Alpine Mobile/);

  const dossierHelvetia = page.getByRole("button", { name: /Helvetia Protect/ });
  const dossierAlpine = page.getByRole("button", { name: /Alpine Mobile/ });
  await dossierHelvetia.click();
  await page.getByLabel("Lettre de réclamation").fill("Brouillon confidentiel A");
  await dossierAlpine.click();
  await page.getByLabel("Lettre de réclamation").fill("Brouillon confidentiel B");
  await dossierHelvetia.click();

  await expect(page.getByLabel("Lettre de réclamation")).toHaveValue(
    "Brouillon confidentiel A",
  );
});

test("refuse un JSON invalide sans remplacer le coffre", async ({ page }) => {
  await page.getByLabel("Importer une sauvegarde").setInputFiles({
    name: "invalide.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"schemaVersion":2}'),
  });

  await expect(page.getByRole("alert")).toHaveText(
    "Cette sauvegarde ne correspond pas au format PACTE V1.",
  );
  await expect(page.getByText("Contrats3", { exact: true })).toBeVisible();
  await expect(page.getByText("Mouvements4", { exact: true })).toBeVisible();
  await expect(page.getByText("Dossiers0", { exact: true })).toBeVisible();
});

test("sert le favicon PACTE local avec son type SVG", async ({ page }) => {
  const favicon = page.locator('link[rel~="icon"]');
  await expect(favicon).toHaveAttribute("href", "/favicon.svg");

  const response = await page.request.get(new URL("/favicon.svg", page.url()).toString());
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("image/svg+xml");
});

test("offre des cibles tactiles d’au moins 48 px dans les vues auditées", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-mobile", "Contrôle réservé au viewport mobile");

  await page.getByRole("button", { name: /^Accueil$/ }).click();
  const toutesLesAnomalies = page.locator("button", { hasText: "Tout voir" });
  await expectTouchTarget(toutesLesAnomalies);
  await toutesLesAnomalies.click();

  for (const name of ["Toutes", "Critiques", "Importantes", "Vigilances"]) {
    await expectTouchTarget(page.getByRole("button", { name, exact: true }));
  }

  await page.getByRole("button", { name: /^Données$/ }).click();
  for (const name of [
    "Exporter la sauvegarde",
    "Restaurer la démonstration",
    "Créer un coffre vide",
  ]) {
    await expectTouchTarget(page.getByRole("button", { name, exact: true }));
  }
  await expectTouchTarget(page.getByLabel("Importer une sauvegarde"));
});
