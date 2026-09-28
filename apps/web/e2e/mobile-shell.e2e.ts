import { expect, test, type Locator, type Page } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

const navigation = (page: Page) => page.getByRole("navigation", { name: "Navigation du terminal" });

async function ouvrirNotes(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Rubriques", exact: true }).tap();
  await page.getByRole("menuitem", { name: /^NOTE\b/ }).tap();
}

/** La visibilité CSS seule n'exclut pas un tiroir opaque au-dessus de la fenêtre. */
async function atteignable(controle: Locator): Promise<void> {
  await expect(controle).toBeVisible();
  await expect.poll(() => controle.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  })).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await bouchonnerReseau(page);
  await page.addInitScript(() => localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 })));
  await page.goto("/");
  await expect(navigation(page)).toBeVisible();
});

for (const feuille of ["Panneaux", "Dessins"] as const) {
  test(`${feuille} → Rubriques : Notes est directement atteignable`, async ({ page }) => {
    const declencheur = navigation(page).getByRole("button", { name: feuille, exact: true });
    await declencheur.tap();
    await expect(declencheur).toHaveAttribute("aria-expanded", "true");
    await ouvrirNotes(page);
    await expect(declencheur).toHaveAttribute("aria-expanded", "false");
    await atteignable(page.getByRole("complementary", { name: "Notes / journal", exact: true }).getByTitle("Fermer", { exact: true }));
  });

  if (feuille === "Panneaux") test(`${feuille} → barre des fenêtres : Notes revient sans être réduite`, async ({ page }) => {
    await ouvrirNotes(page);
    const declencheur = navigation(page).getByRole("button", { name: feuille, exact: true });
    await declencheur.tap();
    await expect(declencheur).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("toolbar", { name: "Fenêtres ouvertes" }).getByRole("button", { name: /^NOTE / }).tap();
    await expect(declencheur).toHaveAttribute("aria-expanded", "false");
    await atteignable(page.getByRole("complementary", { name: "Notes / journal", exact: true }).getByTitle("Fermer", { exact: true }));
  });
}

test("fermer les panneaux conserve le brouillon d'alerte et permet de les replier au second toucher", async ({ page }) => {
  const ouvrir = navigation(page).getByRole("button", { name: "Panneaux", exact: true });
  await ouvrir.tap();
  const panneau = page.getByRole("dialog", { name: "Panneaux du terminal", exact: true });
  await panneau.getByRole("button", { name: /^Alertes/ }).first().tap();
  const niveau = panneau.getByPlaceholder("Niveau", { exact: true });
  await niveau.fill("123456");
  await panneau.getByRole("button", { name: "Fermer les panneaux" }).tap();
  await expect(panneau).toBeHidden();
  await ouvrir.tap();
  await expect(niveau).toHaveValue("123456");
  await ouvrir.tap();
  await expect(ouvrir).toHaveAttribute("aria-expanded", "false");
  await expect(panneau).toBeHidden();
  await ouvrir.tap();
  await expect(niveau).toHaveValue("123456");
});

test("Notes → Graphique → Notes conserve le brouillon, mais Fermer termine la saisie", async ({ page }) => {
  await ouvrirNotes(page);
  const fenetre = page.locator('[data-window-id="notes"]');
  const note = fenetre.getByPlaceholder(/^Note \(markdown/);
  await note.fill("Brouillon conservé pendant la lecture du graphique");
  await page.getByRole("toolbar", { name: "Fenêtres ouvertes" }).getByRole("button", { name: "Graphique", exact: true }).tap();
  await expect(fenetre).toBeHidden();
  await expect(fenetre).toHaveAttribute("inert", "");
  await ouvrirNotes(page);
  await expect(note).toHaveValue("Brouillon conservé pendant la lecture du graphique");
  await atteignable(fenetre.getByTitle("Fermer", { exact: true }));
  await fenetre.getByTitle("Fermer", { exact: true }).tap();
  await expect(fenetre).toHaveCount(0);
  await ouvrirNotes(page);
  await expect(note).toHaveValue("");
});

test("le paysage laisse la place au graphique et garde les actualités accessibles", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(async () => (await page.locator("main").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(280);
  await page.getByRole("button", { name: "Rubriques", exact: true }).tap();
  await page.getByRole("menuitem", { name: /^NEWS\b/ }).tap();
  await atteignable(page.locator('[data-window-id="news"]').getByTitle("Fermer", { exact: true }));
});
