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

test("récupère un coffre corrompu après export brut et confirmation", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("pacte:v1", "{coffre-corrompu"));
  await page.reload();

  await expect(page.getByRole("heading", { name: "Coffre local à récupérer" })).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exporter la valeur brute" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(
    /^pacte-recuperation-brute-\d{4}-\d{2}-\d{2}\.txt$/,
  );
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString("utf8")).toBe("{coffre-corrompu");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Restaurer la démonstration" }).click();
  await expect(page.getByRole("heading", { name: /Bonjour, Foyer Démo/ })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: /Bonjour, Foyer Démo/ })).toBeVisible();
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

test("enregistre les faits conditionnels et la provenance d’un contrat EML", async ({ page }) => {
  await page.getByRole("button", { name: /^Contrats$/ }).click();
  await page.getByRole("button", { name: "Nouveau contrat" }).click();
  const dialogue = page.getByRole("dialog", { name: "Nouveau contrat" });

  await dialogue.getByLabel("Choisir un document").setInputFiles({
    name: "confirmation.eml",
    mimeType: "message/rfc822",
    buffer: Buffer.from("Subject: Résiliation\nRemboursement CHF 24.50"),
  });
  await dialogue.getByLabel("Fournisseur *").fill("Service EML");
  await dialogue.getByLabel("Montant *").fill("49.90");
  await dialogue.getByLabel("Début *").fill("2026-01-01");
  await dialogue.getByLabel("Statut").selectOption("terminated");
  await dialogue.getByLabel("Date de résiliation *").fill("2026-07-20");
  await dialogue.getByLabel("Remboursement attendu").check();
  await dialogue.getByLabel("Montant du remboursement *").fill("24.50");
  await dialogue.getByLabel("Date attendue *").fill("2026-08-01");
  await dialogue.getByRole("button", { name: "Confirmer le contrat" }).click();

  await expect(page.getByRole("heading", { name: "Service EML" })).toBeVisible();
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("pacte:v1")!));
  const saved = persisted.contracts.find((contract: { provider: string }) => contract.provider === "Service EML");
  expect(saved).toMatchObject({
    terminatedAt: "2026-07-20",
    expectedRefund: { amount: 24.5, dueDate: "2026-08-01" },
    sourceFile: { name: "confirmation.eml", type: "message/rfc822" },
  });
  expect(saved).not.toHaveProperty("sourceBinary");
});

test("sélectionne puis corrige durablement le contrat d’un mouvement", async ({ page }) => {
  await page.getByRole("button", { name: /^(Transactions|Mouvements)$/ }).click();
  await page.getByRole("button", { name: "Ajouter un mouvement" }).click();
  const dialogue = page.getByRole("dialog", { name: "Ajouter un mouvement" });
  await dialogue.getByLabel("Date *").fill("2026-07-24");
  await dialogue.getByLabel("Libellé du mouvement *").fill("OPÉRATION À RATTACHER");
  await dialogue.getByLabel("Montant *").fill("12.50");
  await dialogue.getByLabel("Contrat associé").selectOption({ label: "Alpine Mobile" });
  await dialogue.getByRole("button", { name: "Confirmer le mouvement" }).click();

  const selector = page.getByLabel("Rattachement de OPÉRATION À RATTACHER");
  await expect(selector).toHaveValue("contract-demo-alpine-mobile");
  await selector.selectOption("contract-demo-helvetia-protect");
  await expect(page.getByRole("status")).toHaveText("Le rattachement a été enregistré.");
  await page.reload();
  await page.getByRole("button", { name: /^(Transactions|Mouvements)$/ }).click();
  await expect(page.getByLabel("Rattachement de OPÉRATION À RATTACHER")).toHaveValue(
    "contract-demo-helvetia-protect",
  );
});

test("garde ouverte la saisie manuelle d’un mouvement déjà présent", async ({ page }) => {
  await page.getByRole("button", { name: /^(Transactions|Mouvements)$/ }).click();
  await expect(page.locator(".transaction-register tbody tr")).toHaveCount(4);
  await page.getByRole("button", { name: "Ajouter un mouvement" }).click();
  const dialogue = page.getByRole("dialog", { name: "Ajouter un mouvement" });

  await dialogue.getByLabel("Date *").fill("2026-07-05");
  await dialogue.getByLabel("Libellé du mouvement *").fill("PRLV ALPINE MOBILE");
  await dialogue.getByLabel("Montant *").fill("64,90");
  await dialogue.getByRole("button", { name: "Confirmer le mouvement" }).click();

  await expect(dialogue).toBeVisible();
  await expect(dialogue.getByRole("status")).toHaveText(
    "Un mouvement identique existe déjà dans le journal. Aucun ajout n’a été effectué. Modifiez les faits ou annulez.",
  );
  await expect(page.locator(".transaction-register tbody tr")).toHaveCount(4);
});

test("déduit puis laisse corriger le rattachement dans l’aperçu CSV", async ({ page }) => {
  await page.getByRole("button", { name: /^(Transactions|Mouvements)$/ }).click();
  await page.getByRole("button", { name: "Importer un CSV" }).click();
  const dialogue = page.getByRole("dialog", { name: "Importer un relevé CSV" });
  await dialogue.getByLabel("Choisir un fichier CSV").setInputFiles({
    name: "rattachement.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Date;Libellé;Montant;Devise\n2026-07-23;PRLV ALPINE MOBILE;12,34;CHF"),
  });

  const selector = dialogue.getByLabel("Contrat pour PRLV ALPINE MOBILE");
  await expect(selector).toHaveValue("contract-demo-alpine-mobile");
  await selector.selectOption("contract-demo-studio-forme");
  await dialogue.getByRole("button", { name: "Confirmer l’import" }).click();

  await expect(page.getByLabel("Rattachement de PRLV ALPINE MOBILE").last()).toHaveValue(
    "contract-demo-studio-forme",
  );
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
