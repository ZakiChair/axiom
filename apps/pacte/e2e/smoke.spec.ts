import { expect, test, type Page } from "@playwright/test";

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
