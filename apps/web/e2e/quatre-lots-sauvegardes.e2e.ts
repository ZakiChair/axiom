import { expect, test, type Page } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

type FenetreTest = Window & { axiomFailSave?: boolean };

async function ouvrirCommande(page: Page, commande: string, id: string) {
  await expect(page.getByRole("button", { name: /^Indicateurs/ })).toBeVisible();
  const fenetre = page.locator(`[data-window-id="${id}"]`);
  if (await fenetre.isVisible()) return fenetre;
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder(/^Commande/).fill(commande);
  await page.keyboard.press("Enter");
  await expect(fenetre).toBeVisible();
  return fenetre;
}

test.beforeEach(async ({ page }) => {
  await bouchonnerReseau(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string): void {
      if ((window as FenetreTest).axiomFailSave && (key === "axiom:notes:v1" || key === "axiom:expy:v1")) {
        throw new DOMException("quota simulé", "QuotaExceededError");
      }
      original.call(this, key, value);
    };
    (window as FenetreTest).axiomFailSave = true;
  });
});

test("NOTE : saisie corrigée après quota, réessai et rechargement sans doublon", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Indicateurs/ })).toBeVisible();
  await page.evaluate(async () => {
    const mod = await (new Function("return import('/src/store/market.ts')") as () => Promise<typeof import("../src/store/market")>)();
    mod.marketStore.getState().setCandles([]);
  });
  const note = await ouvrirCommande(page, "NOTE", "notes");
  const saisie = note.getByPlaceholder(/Note \(markdown court\)/);
  await saisie.fill("première version");
  await note.getByRole("button", { name: "Enregistrer", exact: true }).first().click();
  await expect(note.getByRole("alert")).toContainText("Non enregistré sur cet appareil");
  await expect(saisie).toHaveValue("première version");

  await saisie.fill("version corrigée");
  await page.evaluate(async () => {
    const mod = await (new Function("return import('/src/store/market.ts')") as () => Promise<typeof import("../src/store/market")>)();
    mod.marketStore.getState().setCandles([{ time: 1_800_000_000_000, open: 123, high: 124, low: 122, close: 123, volume: 1 }]);
  });
  await note.getByTitle("Fermer").click();
  const noteReouverte = await ouvrirCommande(page, "NOTE", "notes");
  await expect(noteReouverte.getByPlaceholder(/Note \(markdown court\)/)).toHaveValue("version corrigée");
  await page.evaluate(() => { (window as FenetreTest).axiomFailSave = false; });
  await noteReouverte.getByRole("button", { name: "Réessayer", exact: true }).click();
  await expect(noteReouverte.getByRole("alert")).toHaveCount(0);
  await expect(noteReouverte.getByPlaceholder(/Note \(markdown court\)/)).toHaveValue("");
  const stock = await page.evaluate(() => JSON.parse(localStorage.getItem("axiom:notes:v1") ?? "{}").notes);
  expect(stock).toHaveLength(1);
  expect(stock[0].texte).toBe("version corrigée");
  expect(stock[0].prix).toBeUndefined();

  await page.reload();
  const apresReload = await ouvrirCommande(page, "NOTE", "notes");
  await expect(apresReload.getByText("version corrigée")).toHaveCount(1);
});

test("EXPY : création corrigée après quota, réessai et rechargement sans doublon", async ({ page }) => {
  await page.goto("/");
  const expy = await ouvrirCommande(page, "EXPY", "expy");
  await expy.getByRole("button", { name: "+ Trade" }).click();
  await expy.getByPlaceholder("Symbole").fill("BTCUSDT");
  await expy.getByPlaceholder("Entrée").fill("100");
  await expy.getByPlaceholder("Stop").fill("90");
  await expy.getByPlaceholder("Taille").fill("1");
  await expy.getByPlaceholder("Note (optionnel)").fill("brouillon");
  await expy.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(expy.getByRole("alert")).toContainText("Non enregistré sur cet appareil");
  await expect(expy.getByPlaceholder("Note (optionnel)")).toHaveValue("brouillon");

  await expy.getByPlaceholder("Note (optionnel)").fill("version corrigée");
  await expy.getByTitle("Fermer").click();
  const expyReouvert = await ouvrirCommande(page, "EXPY", "expy");
  await expect(expyReouvert.getByPlaceholder("Note (optionnel)")).toHaveValue("version corrigée");
  await expyReouvert.getByRole("button", { name: "+ Trade" }).click();
  await expect(expyReouvert.getByPlaceholder("Note (optionnel)")).toHaveCount(0);
  await page.evaluate(() => { (window as FenetreTest).axiomFailSave = false; });
  await expyReouvert.getByRole("button", { name: "Réessayer", exact: true }).click();
  await expect(expyReouvert.getByRole("alert")).toHaveCount(0);
  const stock = await page.evaluate(() => JSON.parse(localStorage.getItem("axiom:expy:v1") ?? "[]"));
  expect(stock).toHaveLength(1);
  expect(stock[0].note).toBe("version corrigée");
  await expyReouvert.getByRole("button", { name: "+ Trade" }).click();
  await expect(expyReouvert.getByPlaceholder("Note (optionnel)")).toHaveValue("");

  await page.reload();
  const apresReload = await ouvrirCommande(page, "EXPY", "expy");
  await expect(apresReload.getByText("BTCUSDT")).toHaveCount(1);

  await page.evaluate(() => { (window as FenetreTest).axiomFailSave = true; Date.now = () => 1_800_000_000_000; });
  await apresReload.getByRole("button", { name: "Clôturer" }).click();
  await apresReload.locator('input[inputmode="decimal"]').fill("110");
  await apresReload.getByRole("button", { name: "OK", exact: true }).click();
  await expect(apresReload.getByRole("alert")).toBeVisible();
  await page.evaluate(() => { (window as FenetreTest).axiomFailSave = false; Date.now = () => 1_800_003_600_000; });
  await apresReload.getByRole("button", { name: "Réessayer", exact: true }).click();
  const apresCloture = await page.evaluate(() => JSON.parse(localStorage.getItem("axiom:expy:v1") ?? "[]"));
  expect(apresCloture[0].fermeTs).toBe(1_800_000_000_000);
});

test("EXPY : réessayer la création déjà fermée conserve fermeTs", async ({ page }) => {
  await page.goto("/");
  const expy = await ouvrirCommande(page, "EXPY", "expy");
  await expy.getByRole("button", { name: "+ Trade" }).click();
  await expy.getByPlaceholder("Symbole").fill("ETHUSDT");
  await expy.getByPlaceholder("Entrée").fill("100");
  await expy.getByPlaceholder("Stop").fill("90");
  await expy.getByPlaceholder("Taille").fill("1");
  await expy.getByPlaceholder("Sortie (opt.)").fill("110");
  await page.evaluate(() => { Date.now = () => 1_800_000_000_000; });
  await expy.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(expy.getByRole("alert")).toBeVisible();
  await page.evaluate(() => { (window as FenetreTest).axiomFailSave = false; Date.now = () => 1_800_003_600_000; });
  await expy.getByRole("button", { name: "Réessayer", exact: true }).click();
  const stock = await page.evaluate(() => JSON.parse(localStorage.getItem("axiom:expy:v1") ?? "[]"));
  expect(stock).toHaveLength(1);
  expect(stock[0].fermeTs).toBe(1_800_000_000_000);
});
