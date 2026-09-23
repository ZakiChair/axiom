import { expect, test } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

const INSTANT = Date.parse("2026-09-23T12:00:00Z");
const HEURE = 3_600_000;

test.beforeEach(async ({ page }) => {
  await bouchonnerReseau(page);
  await page.clock.install({ time: INSTANT });
  await page.addInitScript(() => localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 })));
});

test("création datée, expiration sans tick, recharge et prolongation explicite", async ({ page }) => {
  await page.goto("/");
  const aside = page.locator("aside");
  await aside.getByRole("button", { name: /^Alertes/ }).click();
  await aside.getByLabel("Durée de l'alerte").selectOption(String(HEURE));
  await aside.getByPlaceholder("Niveau").fill("100");
  await aside.getByRole("button", { name: /^Ajouter sur/ }).click();

  const initiale = await page.evaluate(() => JSON.parse(localStorage.getItem("axiom:alerts:v1") ?? "{}").defs?.[0]);
  expect(initiale.expireTs).toBeGreaterThan(INSTANT + HEURE);
  expect(initiale.expireTs).toBeLessThan(INSTANT + HEURE + 30_000);
  await expect(aside).toContainText("Échéance");
  await expect(page.locator('[title="Nombre d\'alertes actives"]')).toContainText("1");

  await page.clock.fastForward(HEURE + 1_000);
  await expect(aside).toContainText("expirée");
  await expect(page.locator('[title="Nombre d\'alertes actives"]')).toContainText("0");

  await page.reload();
  const recharge = page.locator("aside");
  const boutonAlertes = recharge.getByRole("button", { name: /^Alertes/ });
  await expect(boutonAlertes).toBeVisible();
  if (await boutonAlertes.getAttribute("aria-expanded") === "false") await boutonAlertes.click();
  await expect(boutonAlertes).toHaveAttribute("aria-expanded", "true");
  await expect(recharge).toContainText("expirée");
  await recharge.getByRole("button", { name: "Prolonger l'alerte BTCUSDT de 24 h" }).click();
  await expect(recharge).not.toContainText("expirée");
  await expect(page.locator('[title="Nombre d\'alertes actives"]')).toContainText("1");
  const apres = await page.evaluate(() => JSON.parse(localStorage.getItem("axiom:alerts:v1") ?? "{}").defs?.[0]);
  expect(apres.expireTs).toBeGreaterThan(initiale.expireTs + 24 * HEURE);
  expect(apres.expireTs).toBeLessThan(initiale.expireTs + 24 * HEURE + 30_000);
});

test("une alerte en pause devient visuellement expirée sans tick", async ({ page }) => {
  await page.goto("/");
  const aside = page.locator("aside");
  await aside.getByRole("button", { name: /^Alertes/ }).click();
  await aside.getByLabel("Durée de l'alerte").selectOption(String(HEURE));
  await aside.getByPlaceholder("Niveau").fill("100");
  await aside.getByRole("button", { name: /^Ajouter sur/ }).click();
  await aside.locator('button[title="Désactiver"]').click();
  await expect(aside).toContainText("en pause");
  await page.clock.fastForward(HEURE + 1_000);
  await expect(aside).toContainText("expirée");
});

test("l'horloge rattrape une échéance franchie entre lecture et armement", async ({ page }) => {
  await page.route("**/__hook-expiration__", (route) => route.fulfill({
    contentType: "text/html", body: "<!doctype html><html><body></body></html>",
  }));
  await page.goto("/__hook-expiration__");
  const resultat = await page.evaluate(async () => {
    const reactPath: string = "/node_modules/.vite/deps/react.js";
    const clientPath: string = "/node_modules/.vite/deps/react-dom_client.js";
    const hookPath: string = "/src/alerts/useExpirationClock.ts";
    const ReactMod = await import(reactPath);
    const React = ReactMod.default ?? ReactMod;
    const clientMod = await import(clientPath);
    const { createRoot } = clientMod.default ?? clientMod;
    const { useExpirationClock } = await import(hookPath);
    const originalNow = Date.now;
    const expireTs = originalNow() + 1_000;
    const defs = [{ actif: false, expireTs }];
    const lectures: number[] = [];
    Date.now = () => {
      if (new Error().stack?.includes("useExpirationClock.ts")) {
        const value = lectures.length < 2 ? expireTs - 1 : expireTs + 1;
        lectures.push(value);
        return value;
      }
      return originalNow();
    };
    const div = document.createElement("div");
    document.body.append(div);
    function Probe() {
      const maintenant = useExpirationClock(defs);
      return React.createElement("span", null, JSON.stringify({ maintenant, expireTs, expiree: maintenant >= expireTs }));
    }
    const root = createRoot(div);
    try {
      root.render(React.createElement(Probe));
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { lectures, rendu: JSON.parse(div.textContent ?? "null") as { expiree: boolean } | null };
    } finally {
      root.unmount();
      div.remove();
      Date.now = originalNow;
    }
  });
  expect(resultat.lectures.slice(0, 3)).toEqual([
    resultat.lectures[0], resultat.lectures[0], resultat.lectures[0] + 2,
  ]);
  expect(resultat.rendu?.expiree).toBe(true);
  expect(resultat.lectures.length).toBeLessThan(8);
});
