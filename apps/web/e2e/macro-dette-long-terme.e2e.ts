import { expect, test, type Page } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

// Historique trimestriel synthétique réservé au test : 264 observations de 1960 à 2025.
const TRIMESTRES = Array.from({ length: 264 }, (_, i) => ({
  date: new Date(Date.UTC(1960, i * 3, 1)).toISOString().slice(0, 10),
  value: String(i === 263 ? 300 : i === 262 ? 302.4 : 100 + i / 2),
}));
const IDS = ["QUSCAM770A", "QXMCAM770A", "QGBCAM770A", "QJPCAM770A", "QCNCAM770A", "QINCAM770A", "QCACAM770A", "QCHCAM770A"];

async function commande(page: Page, texte: string): Promise<void> {
  await expect(page.getByRole("banner").getByRole("button", { name: /^Indicateurs/ })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder(/^Commande/).fill(texte);
  await page.keyboard.press("Enter");
}

async function preparer(page: Page, avecCle = true): Promise<URL[]> {
  await bouchonnerReseau(page);
  await page.clock.setFixedTime(new Date("2026-09-11T12:00:00Z"));
  await page.addInitScript((cle) => {
    localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
    if (cle) localStorage.setItem("axiom.fred.apiKey", "fixture-fred-key");
    else localStorage.removeItem("axiom.fred.apiKey");
  }, avecCle);
  const requetes: URL[] = [];
  await page.route("**/fredapi/fred/series/observations?*", async (route) => {
    const url = new URL(route.request().url());
    if (!IDS.includes(url.searchParams.get("series_id") ?? "")) {
      await route.fulfill({ json: { observations: [] } });
      return;
    }
    requetes.push(url);
    if (!avecCle) {
      await route.fulfill({ status: 401, json: { error_code: 401, error_message: "Clé FRED absente." } });
      return;
    }
    const connuLe = url.searchParams.get("realtime_start");
    const observations = connuLe ? [
      { date: "1960-01-01", value: "90", realtime_start: "1960-05-01", realtime_end: "9999-12-31" },
      { date: "1965-01-01", value: "122.4", realtime_start: "1965-05-01", realtime_end: "9999-12-31" },
      { date: "1965-04-01", value: "120", realtime_start: "1965-07-01", realtime_end: "9999-12-31" },
      // Révision ultérieure exclue par la vue au 1er août 1965.
      { date: "1965-04-01", value: "999", realtime_start: "1965-08-02", realtime_end: "9999-12-31" },
    ] : url.searchParams.get("series_id") === "QUSCAM770A" ? TRIMESTRES : TRIMESTRES.filter((p) => p.date >= "1999-01-01");
    await route.fulfill({ json: { observations } });
  });
  await page.goto("/");
  await commande(page, "MACRO");
  await page.getByLabel("Indicateur macro").selectOption("dette-pib");
  return requetes;
}

test("dette : Max charge les décennies disponibles, les ratios et les huit sources BIS", async ({ page }) => {
  const requetes = await preparer(page);
  const macro = page.getByTestId("macro-series-tab");
  const table = macro.getByRole("table", { name: "Observations macro par zone" });
  const us = table.getByRole("row").filter({ hasText: "États-Unis" });
  const ez = table.getByRole("row").filter({ hasText: "Zone euro" });
  await expect(macro.getByRole("button", { name: "Max", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(us).toContainText("300,00 % du PIB");
  await expect(us).toContainText("302,40 % du PIB");
  await expect(us).toContainText("−2,40 pt de PIB");
  await expect(us).toContainText("T1 1960 – T4 2025");
  await expect(ez).toContainText("T1 1999 – T4 2025");
  await expect(table.getByRole("row")).toHaveCount(9);
  await expect.poll(() => new Set(requetes.map((url) => url.searchParams.get("series_id"))).size).toBe(8);
  expect(requetes.every((url) => url.searchParams.get("observation_start") === "1900-01-01")).toBe(true);
  for (const id of IDS) {
    const source = table.getByRole("link", { name: `BIS · FRED · ${id}`, exact: true });
    await expect(source).toHaveAttribute("href", `https://fred.stlouisfed.org/series/${id}`);
    await expect(source).toHaveAttribute("target", "_blank");
    await expect(source).toHaveAttribute("rel", "noopener noreferrer");
  }

  // Une seule zone pour vérifier la profondeur réelle du tracé, indépendamment du tableau.
  for (const region of ["EZ", "UK", "JP", "CN", "IN", "CA", "CH"]) await macro.getByRole("group", { name: "Zones macro" }).getByRole("button", { name: new RegExp(`${region}$`) }).click();
  const graphe = macro.getByRole("img", { name: "Évolution · Cycle de la dette à long terme" });
  const nombrePoints = async () => ((await graphe.locator("polyline").getAttribute("points")) ?? "").split(" ").length;
  await expect.poll(nombrePoints).toBe(264);
  await expect(graphe.locator("text").filter({ hasText: /^1960$/ })).toHaveCount(1);
  await macro.getByRole("button", { name: "30 ans", exact: true }).click();
  await expect.poll(nombrePoints).toBe(117);
  await expect(graphe.locator("text").filter({ hasText: /^1996$/ })).toHaveCount(1);
  await macro.getByRole("button", { name: "60 ans", exact: true }).click();
  await expect.poll(nombrePoints).toBe(237);
  await expect(graphe.locator("text").filter({ hasText: /^1966$/ })).toHaveCount(1);
  await macro.getByRole("button", { name: "Max", exact: true }).click();
  await expect.poll(nombrePoints).toBe(264);
  await macro.getByLabel("Indicateur macro").selectOption("chomage");
  await expect(macro.getByRole("button", { name: "Max", exact: true })).toHaveCount(0);
  await expect(macro.getByRole("button", { name: "5 ans", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("dette : ALFRED conserve les observations et millésimes antérieurs à 1970", async ({ page }) => {
  const requetes = await preparer(page);
  const macro = page.getByTestId("macro-series-tab");
  for (const region of ["EZ", "UK", "JP", "CN", "IN", "CA", "CH"]) await macro.getByRole("group", { name: "Zones macro" }).getByRole("button", { name: new RegExp(`${region}$`) }).click();
  await macro.getByLabel("Connu au ALFRED").fill("1965-08-01");
  const table = macro.getByRole("table", { name: "Observations macro par zone" });
  await expect(table).toContainText("120,00 % du PIB");
  await expect(table).toContainText("−2,40 pt de PIB");
  await expect(table).toContainText("T1 1960 – T2 1965");
  await expect(table).not.toContainText("999,00 % du PIB");
  await expect(macro).toContainText("vue ALFRED au 1965-08-01");
  await expect.poll(() => requetes.some((url) => url.searchParams.get("realtime_start") === "1965-08-01" && url.searchParams.get("realtime_end") === "1965-08-01" && url.searchParams.get("observation_start") === "1900-01-01")).toBe(true);
});

test("dette sans clé : l’absence reste explicite et aucune observation n’est inventée", async ({ page }) => {
  const requetes = await preparer(page, false);
  const macro = page.getByTestId("macro-series-tab");
  const table = macro.getByRole("table", { name: "Observations macro par zone" });
  await expect(table).toContainText(/clé FRED/i);
  await expect(table.getByRole("row")).toHaveCount(9);
  await expect(macro.getByRole("img")).toHaveCount(0);
  await expect(table).not.toContainText(/\d+[,.]\d+ % du PIB/);
  await expect.poll(() => requetes.length).toBe(8);
  expect(requetes.every((url) => !url.searchParams.has("api_key"))).toBe(true);
});
