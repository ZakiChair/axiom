import { expect, test } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

test("MACRO affiche le quadrant daté à partir des familles existantes", async ({ page }) => {
  await bouchonnerReseau(page);
  await page.clock.setFixedTime(new Date("2026-09-23T12:00:00Z"));
  await page.addInitScript(() => {
    localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
    localStorage.setItem("axiom.fred.apiKey", "fixture-fred-key");
  });
  await page.route("**/fredapi/fred/series/observations?*", (route) => {
    const id = new URL(route.request().url()).searchParams.get("series_id");
    const valeurs = id === "INDPRO" ? [1, 1.2, 1.5, 2, 2.5] : id === "CPIAUCSL" ? [3, 2.8, 2.5, 2, 1.8] : [];
    const observations = id === "GDPC1" ? [{ date: "2026-04-01", value: "2.1" }]
      : valeurs.map((value, i) => ({ date: new Date(Date.UTC(2026, i + 3, 1)).toISOString().slice(0, 10), value: String(value) }));
    return route.fulfill({ json: { observations } });
  });
  await page.goto("/");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder(/^Commande/).fill("MACRO");
  await page.keyboard.press("Enter");
  const macro = page.getByTestId("macro-series-tab");
  await expect(macro).toBeVisible();
  for (const region of ["EZ", "UK", "JP", "CN", "IN", "CA", "CH"]) {
    await macro.getByRole("group", { name: "Zones macro" }).getByRole("button", { name: new RegExp(`${region}$`) }).click();
  }
  await macro.locator("summary").filter({ hasText: "Quadrants croissance et inflation" }).click();
  const quadrants = macro.getByRole("region", { name: "Quadrants croissance et inflation" });
  await expect(quadrants).toContainText("croissance accélère, inflation décélère");
  await expect(quadrants).toContainText("Production industrielle a/a");
  await expect(quadrants).toContainText("Contexte PIB réel a/a distinct");
  await expect(quadrants).toContainText("août");
  await expect(quadrants).toContainText("périodes observées");
});
