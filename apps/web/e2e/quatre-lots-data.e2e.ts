import { expect, test, type Page } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

async function ouvrirData(page: Page) {
  await bouchonnerReseau(page);
  await page.addInitScript(() => localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 })));
  await page.goto("/");
  await page.getByRole("button", { name: "Fonctions" }).click();
  await page.getByRole("menuitem", { name: /Sources de données/ }).click();
  return page.locator('[data-window-id="data"]');
}

async function publierSources(page: Page, sources: string[], erreur?: string) {
  await page.evaluate(async ({ ids, message }) => {
    const chemin = "/src/store/health.ts";
    const { healthStore } = await import(chemin);
    for (const id of ids) {
      healthStore.getState().setEtat(id, message ? "error" : "polling", {
        dernierMessageTs: Date.now() - 60_000, derniereErreur: message,
      });
    }
  }, { ids: sources, message: erreur });
}

test("DATA expose les seules capacités connues, ses erreurs et les vraies destinations au clavier", async ({ page }) => {
  const data = await ouvrirData(page);
  const erreur = "Clé indisponible : renseignez votre accès personnel dans les réglages avant de consulter cette métrique. La source reste visible pendant cette opération.";
  await publierSources(page, ["coinalyze", "bgeometrics", "source-inconnue"], erreur);
  const inconnue = data.locator('[data-source-id="source-inconnue"]');
  await expect(inconnue).toContainText("Aucune action disponible");
  await expect(inconnue.getByRole("button")).toHaveCount(0);
  await expect(inconnue.getByText(erreur, { exact: true })).toBeVisible();
  expect(await inconnue.getByText(erreur, { exact: true }).evaluate((element) => getComputedStyle(element).textOverflow)).not.toBe("ellipsis");

  const coinalyze = data.locator('[data-source-id="coinalyze"]');
  const lien = coinalyze.getByRole("link", { name: /Page publique/ });
  await expect(lien).toHaveAttribute("href", "https://api.coinalyze.net/v1/doc/");
  await expect(lien).toHaveAttribute("rel", "noopener noreferrer");
  await coinalyze.getByRole("button", { name: "Configurer", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Réglages", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Fermer les réglages", exact: true }).click();
  await expect(coinalyze.getByRole("status")).toContainText("Réglages ouverts");

  await data.locator('[data-source-id="bgeometrics"]').getByRole("button", { name: "Ouvrir CHAIN", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-window-id="onchain"]')).toBeVisible();
});

test("DATA actualise vraiment ECO au clic, attend le relevé et ne promet pas de collecte au quota", async ({ page }) => {
  const data = await ouvrirData(page);
  let appels = 0;
  let debloquer!: () => void;
  const attente = new Promise<void>((resolve) => { debloquer = resolve; });
  await page.route("**/ff_calendar_thisweek.json", async (route) => {
    appels += 1;
    await attente;
    await route.fulfill({ json: [{ title: "Fixture DATA", country: "USD", date: "2026-09-24T12:00:00Z", impact: "High" }] });
  });
  await page.route("**/fredapi/fred/releases/dates?*", (route) => route.fulfill({ json: { release_dates: [] } }));
  await publierSources(page, ["eco:forexfactory"]);
  const source = data.locator('[data-source-id="eco:forexfactory"]');
  const actualiser = source.getByRole("button", { name: "Actualiser ECO", exact: true });
  await expect(actualiser).toBeVisible();
  expect(appels).toBe(0);
  await actualiser.click();
  await expect.poll(() => appels).toBe(1);
  await expect(source.getByRole("status")).toContainText("en cours");
  await expect(actualiser).toBeDisabled();
  debloquer();
  await expect(source.getByRole("status")).toContainText("nouveau relevé confirmé");
  await expect(actualiser).toBeEnabled();

  await page.evaluate(() => localStorage.setItem("axiom:eco:fetchLog:v1", JSON.stringify([Date.now(), Date.now()])));
  await actualiser.click();
  await expect(source.getByRole("status")).toContainText("Quota du calendrier atteint");
  await expect(source.getByRole("status")).not.toContainText("nouveau relevé confirmé");
  expect(appels).toBe(1);
});

test("DATA garde un échec de source explicite malgré le repli ECO et permet une reprise", async ({ page }) => {
  const data = await ouvrirData(page);
  let echec = true;
  await page.route("**/ff_calendar_thisweek.json", (route) => route.fulfill(echec
    ? { status: 503, json: { error: "Fixture indisponible" } }
    : { json: [{ title: "Reprise DATA", country: "USD", date: "2026-09-24T12:00:00Z", impact: "High" }] }));
  await page.route("**/fredapi/fred/releases/dates?*", (route) => route.fulfill({ status: 503, json: {} }));
  await publierSources(page, ["eco:forexfactory", "coinalyze"]);
  const source = data.locator('[data-source-id="eco:forexfactory"]');
  const actualiser = source.getByRole("button", { name: "Actualiser ECO", exact: true });
  await actualiser.click();
  await expect(source.getByRole("status")).toContainText("Calendrier ForexFactory indisponible");
  await expect(actualiser).toBeEnabled();
  const autre = data.locator('[data-source-id="coinalyze"]');
  await autre.getByRole("button", { name: "Configurer", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Réglages", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Fermer les réglages", exact: true }).click();
  await expect(source.getByRole("status")).toContainText("Calendrier ForexFactory indisponible");
  echec = false;
  await actualiser.click();
  await expect(source.getByRole("status")).toContainText("nouveau relevé confirmé");
});

test("DATA conserve la fraîcheur sur son tick de dix secondes, hors messages du flux", async ({ page }) => {
  const debut = Date.UTC(2026, 8, 23, 12);
  await page.clock.install({ time: debut });
  await page.clock.pauseAt(debut);
  const data = await ouvrirData(page);
  await publierSources(page, ["source-horloge"]);
  const source = data.locator('[data-source-id="source-horloge"]');
  await expect(source).toContainText("il y a 1 min");
  await page.clock.runFor(2_000);
  await page.evaluate(async () => {
    const chemin = "/src/store/health.ts";
    const { healthStore } = await import(chemin);
    healthStore.getState().marquerMessage("source-horloge");
  });
  await expect(source).toContainText("il y a 1 min");
  await page.clock.runFor(8_000);
  await expect(source).toContainText("il y a 8 s");
});
