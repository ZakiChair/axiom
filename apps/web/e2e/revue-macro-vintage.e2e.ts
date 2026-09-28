import { expect, test, type Page, type Route } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

const MOIS_PCE_COURANT = Array.from({ length: 13 }, (_, index) => {
  const date = new Date(Date.UTC(2025, 6 + index, 1));
  return {
    date: date.toISOString().slice(0, 10),
    value: String(100 + (2.5 * index) / 12),
  };
});

// Séries mensuelles explicites : les transformations n'acceptent aucune lacune civile.
const MOIS_PCE_VINTAGE = MOIS_PCE_COURANT.map((point, index) => ({
  ...point,
  value: String(100 + (3 * index) / 12),
  realtime_start: "2026-01-01",
  realtime_end: "9999-12-31",
}));
const MOIS_PAYEMS = [
  ["2026-04-01", "100000"],
  ["2026-05-01", "100100"],
  ["2026-06-01", "100250"],
  ["2026-07-01", "100400"],
].map(([date, value]) => ({ date, value }));
const MOIS_RSAFS = Array.from({ length: 13 }, (_, index) => {
  const date = new Date(Date.UTC(2025, 6 + index, 1));
  const value = index === 11 ? 1089 : index === 12 ? 1100 : 1000 + index * 8;
  return { date: date.toISOString().slice(0, 10), value: String(value) };
});
const formatPourcent = (valeur: number): string =>
  `${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(valeur)} %`;
const formatMilliers = (valeur: number): string =>
  `${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(valeur)} milliers`;

async function commande(page: Page, texte: string): Promise<void> {
  await expect(page.getByRole("banner").getByRole("button", { name: /^Indicateurs/ })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder(/^Commande/).fill(texte);
  await page.keyboard.press("Enter");
}

function observationsGeneriques() {
  return MOIS_PCE_COURANT.map(({ date, value }) => ({ date, value }));
}

async function installerFixturesMacro(page: Page, routes: { vintagePce: { count: number } }): Promise<void> {
  await bouchonnerReseau(page);
  await page.addInitScript(() => {
    localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
    localStorage.setItem("axiom:fred:key", "fixture-fred-key");
  });
  await page.route("**/fredapi/fred/series/observations?*", async (route: Route) => {
    const url = new URL(route.request().url());
    const serie = url.searchParams.get("series_id");
    const cutoff = url.searchParams.get("realtime_start");
    if (serie === "PCEPILFE" && cutoff === "2026-08-15") {
      routes.vintagePce.count++;
      await route.fulfill({
        json: {
          observations: [
            ...MOIS_PCE_VINTAGE,
            // Révision ultérieure : le chargeur ALFRED doit l'écarter au cutoff demandé.
            { date: "2026-07-01", value: "999", realtime_start: "2026-08-16", realtime_end: "9999-12-31" },
          ],
        },
      });
      return;
    }
    const observations = serie === "PCEPILFE"
      ? MOIS_PCE_COURANT
      : serie === "PAYEMS"
        ? MOIS_PAYEMS
        : serie === "RSAFS"
          ? MOIS_RSAFS
          : serie === "WALCL"
            ? [
                { date: "2026-08-26", value: "6900000" },
                { date: "2026-09-02", value: "7000000" },
                { date: "2026-09-09", value: "7100000" },
              ]
            : serie === "RRPONTSYD"
              ? [
                  { date: "2026-08-26", value: "120" },
                  { date: "2026-09-02", value: "110" },
                  { date: "2026-09-09", value: "100" },
                ]
              : observationsGeneriques();
    await route.fulfill({ json: { observations } });
  });
}

test("MACRO : PCE a/a sépare la vue courante du millésime ALFRED connu au", async ({ page }) => {
  const routes = { vintagePce: { count: 0 } };
  await installerFixturesMacro(page, routes);
  await page.goto("/");
  await commande(page, "MACRO");
  const macro = page.getByTestId("macro-series-tab");
  const table = macro.getByRole("table", { name: "Observations macro par zone" });

  await macro.getByLabel("Indicateur macro").selectOption("pce-aa");
  await expect(table).toContainText(formatPourcent(((102.5 - 100) * 100) / 100));
  await expect(table).toContainText("juil. 2026");

  const selecteur = macro.getByLabel("Indicateur macro");
  await selecteur.selectOption("pce-niveau");
  await expect(selecteur.locator("option:checked")).toHaveText("PCE sous-jacent");
  await expect(table).toContainText("102,500 (2017=100)");

  await selecteur.selectOption("pce-3m");
  await expect(selecteur.locator("option:checked")).toHaveText("PCE sous-jacent (3 m annualisé)");
  await expect(macro).toContainText("Variation sur trois mois civils");
  await expect(table).toContainText(formatPourcent(100 * ((102.5 / 101.875) ** 4 - 1)));

  await selecteur.selectOption("pce-6m");
  await expect(selecteur.locator("option:checked")).toHaveText("PCE sous-jacent (6 m annualisé)");
  await expect(macro).toContainText("Variation sur six mois civils");
  await expect(table).toContainText(formatPourcent(100 * ((102.5 / 101.25) ** 2 - 1)));

  await selecteur.selectOption("pce-aa");
  await macro.getByLabel("Connu au ALFRED").fill("2026-08-15");
  await expect(table).toContainText("3,00 %");
  await expect(table).toContainText("ALFRED · vue journalière au 2026-08-15");
  await expect(macro).toContainText("FRED : vue ALFRED au 2026-08-15, granularité quotidienne.");
  await expect.poll(() => routes.vintagePce.count).toBeGreaterThan(0);
  await expect(table).not.toContainText("999,00 %");
});

test("MACRO : PAYEMS et RSAFS rendent les transformations et unités natives", async ({ page }) => {
  await installerFixturesMacro(page, { vintagePce: { count: 0 } });
  await page.goto("/");
  await commande(page, "MACRO");
  const macro = page.getByTestId("macro-series-tab");
  const table = macro.getByRole("table", { name: "Observations macro par zone" });

  await macro.getByLabel("Indicateur macro").selectOption("emploi-moyenne3m");
  await expect(table).toContainText(formatMilliers(((100100 - 100000) + (100250 - 100100) + (100400 - 100250)) / 3));
  await expect(table).toContainText("juil. 2026");

  const selecteur = macro.getByLabel("Indicateur macro");
  await selecteur.selectOption("emploi-variation");
  await expect(selecteur.locator("option:checked")).toHaveText("Emploi non agricole (m/m)");
  await expect(macro).toContainText("Variation mensuelle PAYEMS");
  await expect(table).toContainText(formatMilliers(100400 - 100250));

  await selecteur.selectOption("retail-niveau");
  await expect(table).toContainText(/1.?100 M\$ nominaux/);
  await expect(table).toContainText("juil. 2026");

  await macro.getByLabel("Indicateur macro").selectOption("retail-mm");
  await expect(table).toContainText("1,01 %");
  await macro.getByLabel("Indicateur macro").selectOption("retail-aa");
  await expect(table).toContainText("10,00 %");
});

test("NETLIQ : TGA DTS, dates de jambes, contributions et vue hebdomadaire sont explicites", async ({ page }) => {
  await installerFixturesMacro(page, { vintagePce: { count: 0 } });
  await page.route("**/extapi/api.fiscaldata.treasury.gov/**", async (route) => {
    await route.fulfill({
      json: {
        data: [
          { record_date: "2026-08-25", account_type: "Treasury General Account (TGA) Closing Balance", open_today_bal: "550000" },
          { record_date: "2026-09-03", account_type: "Treasury General Account (TGA) Closing Balance", open_today_bal: "600000" },
        ],
        meta: { "total-pages": 1 },
      },
    });
  });
  await page.goto("/");
  await commande(page, "NETLIQ");
  const netliq = page.getByRole("complementary", { name: "Liquidité nette Fed", exact: true });
  await expect(netliq).toBeVisible();
  await expect(netliq).toContainText("TGA Treasury DTS");
  await expect(netliq).toContainText("vue ancrée WALCL");
  await expect(netliq).toContainText("Liquidité nette");
  await expect(netliq).toContainText(/6.?400 Md\$/);

  const canvas = netliq.locator("canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width - 58, box!.y + box!.height / 2);
  await expect(netliq).toContainText("W 09-09 · TGA 09-03 · RRP 09-09");
  await expect(netliq).toContainText("W +100 Md$ · TGA −50 Md$ · RRP +10 Md$");
  await expect(netliq).toContainText("Report");
});
