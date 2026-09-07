import { test, expect, type Page } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

async function commande(page: Page, texte: string) {
  await expect(page.getByRole("banner").getByRole("button", { name: /^Indicateurs/ })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder(/^Commande/).fill(texte);
  await page.keyboard.press("Enter");
}
test.beforeEach(async ({ page }) => {
  await bouchonnerReseau(page);
  await page.addInitScript(() => {
    localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
    localStorage.setItem("axiom:fred:key", "fixture-fred-key");
  });
  await page.route("**/fredapi/fred/series/observations?*", route => {
    const id = new URL(route.request().url()).searchParams.get("series_id");
    const observations = id === "GDPC1" ? [{ date: "2026-01-01", value: "2.0" }, { date: "2026-04-01", value: "2.4" }]
      : id === "UNRATE" ? [{ date: "2026-06-01", value: "4.1" }, { date: "2026-07-01", value: "4.3" }]
      : id === "NFCI" ? [{ date: "2026-08-21", value: "-0.6" }, { date: "2026-08-28", value: "-0.5" }]
      : [{ date: "2026-06-01", value: "2.5" }, { date: "2026-07-01", value: "2.7" }];
    return route.fulfill({ json: { observations } });
  });
});

test("MACRO : huit zones, PIB trimestriel, chômage et unité NFCI", async ({ page }) => {
  await page.goto("/"); await commande(page, "MACRO");
  const macro = page.getByTestId("macro-series-tab");
  await expect(macro).toBeVisible();
  const table = macro.getByRole("table", { name: "Observations macro par zone" });
  await expect(table.getByRole("row")).toHaveCount(9);
  await expect(table.getByRole("row").filter({ hasText: "États-Unis" })).toContainText("2,70 %");
  await expect(table).toContainText("Canada"); await expect(table).toContainText("Suisse");
  await macro.getByLabel("Indicateur macro").selectOption("pib-aa");
  await expect(table.getByRole("row").filter({ hasText: "États-Unis" })).toContainText("T2 2026");
  await macro.getByRole("button", { name: "10 ans", exact: true }).click();
  await expect(macro.getByRole("img", { name: "Évolution · PIB réel (a/a)" })).toBeVisible();
  await macro.getByLabel("Indicateur macro").selectOption("chomage");
  await expect(table.getByRole("row").filter({ hasText: "États-Unis" })).toContainText("4,30 %");
  await macro.getByLabel("Indicateur macro").selectOption("nfci");
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table).toContainText("−0,50");
  await expect(table.getByRole("cell", { name: "−0,50", exact: true })).toBeVisible();
  await expect(table).not.toContainText("%");
});

test("ECO ouvre la bonne famille et isole le pays ; BRIEF reprend cette sélection", async ({ page }) => {
  await page.route("**/ff_calendar_thisweek.json*", route => route.fulfill({ json: [{ title: "Unemployment Rate", country: "USD", impact: "High", date: new Date(Date.now() + 3_600_000).toISOString(), forecast: "4.2%", previous: "4.1%" }] }));
  await page.goto("/"); await commande(page, "ECO");
  await page.getByRole("button", { name: "série", exact: true }).click();
  const macro = page.getByTestId("macro-series-tab");
  await expect(macro.getByLabel("Indicateur macro")).toHaveValue("chomage");
  await expect(macro.getByRole("table").getByRole("row")).toHaveCount(2);
  await expect(macro.getByRole("table")).toContainText("4,30 %");
  await commande(page, "BRIEF");
  const brief = page.getByRole("complementary", { name: "Point marché", exact: true });
  await expect(brief.getByText("Chômage", { exact: true })).toBeVisible();
  await expect(brief).toContainText("juil. 2026");
  await expect(brief).toContainText("4.30 %");
});

test("les réglages et le parcours d'accueil restent accessibles après chargement différé", async ({ page }) => {
  await page.goto("/"); await commande(page, "REGLAGES");
  await expect(page.getByRole("dialog", { name: "Réglages", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Réglages", exact: true })).toContainText("FRED");
  await page.getByRole("button", { name: "Fermer les réglages" }).click();
  await commande(page, "ONBOARD");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("Bienvenue");
});

test("GLOBE montre les historiques GPR/TPU/GSCPI avec unités et millésime", async ({ page }) => {
  const points = [{ time: Date.UTC(2026, 6, 1), value: 100 }, { time: Date.UTC(2026, 7, 1), value: 118 }];
  await page.route("**/extapi/www.matteoiacoviello.com/gpr.htm", route => route.fulfill({ json: [{ id: "gpr", nom: "GPR", points }] }));
  await page.route("**/extapi/www.matteoiacoviello.com/tpu.htm", route => route.fulfill({ json: [{ id: "tpu", nom: "TPU Monthly", points }] }));
  await page.route("**/gscpi_interactive_data.csv", route => route.fulfill({ contentType: "text/csv", body: "Date,Aug-26,Sep-26\n31-Jul-2026,0.79,0.94\n31-Aug-2026,#N/A,1.06" }));
  await page.goto("/"); await commande(page, "GLOBE");
  await page.getByRole("button", { name: "GPR · TPU · GSCPI", exact: true }).click();
  const panel = page.getByRole("region", { name: "Indices géopolitiques" });
  await expect(panel.getByRole("img", { name: "Évolution de GPR, en indice" })).toBeVisible();
  await panel.getByLabel("Indice géopolitique", { exact: true }).selectOption("tpu");
  await expect(panel.getByRole("img", { name: "Évolution de TPU Monthly, en indice" })).toBeVisible();
  await panel.getByLabel("Indice géopolitique", { exact: true }).selectOption("gscpi");
  await expect(panel.getByRole("img", { name: "Évolution de GSCPI, en écarts-types" })).toBeVisible();
  await expect(panel).toContainText("édition 2026-09");
  await expect(panel).toContainText("1,06 écarts-types");
  await panel.screenshot({ path: "/private/tmp/axiom-20260907-geo.png" });
});

test("NBS : chômage, PPI, inflation sous-jacente et production chinoise sans clé", async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem("axiom:fred:key"));
  await page.route("**/ff_calendar_thisweek.json*", route => route.fulfill({ json: [{ title: "Unemployment Rate", country: "CNY", impact: "High", date: new Date(Date.now() + 3_600_000).toISOString(), previous: "5.1%" }] }));
  let posts = 0;
  await page.route("**/extapi/data.stats.gov.cn/dg/website/publicrelease/web/external/stream/esData", route => {
    expect(route.request().method()).toBe("POST"); posts++;
    const body = route.request().postDataJSON();
    const id: string = body.indicatorIds[0];
    const value = id === "3888eac6062945a79c8a27e5f13d4953" ? "5.2" : id === "150633e52b9a470a9a9fd1b296dd6c5b" ? "103.5" : id === "ef1b1765960d45a29b4d7c4ca91be916" ? "4.5" : "100.9";
    const cellule = { _id: id, catalogid: body.cid, da: "000000000000", value };
    return route.fulfill({ json: { success: true, data: [
      { code: id === "c2050e97c49a4763a6d0f0f38bf0b4ed" ? "202512MM" : "202607MM", values: [cellule] },
    ] } });
  });
  await page.goto("/"); await commande(page, "ECO");
  await page.getByRole("button", { name: "série", exact: true }).click();
  const macro = page.getByTestId("macro-series-tab"), table = macro.getByRole("table");
  await expect(table.getByRole("row")).toHaveCount(2);
  for (const [famille, valeur] of [["chomage", "5,20 %"], ["ppi-aa", "3,50 %"], ["core-cpi-aa", "0,90 %"], ["production-aa", "4,50 %"]]) {
    await macro.getByLabel("Indicateur macro").selectOption(famille!);
    await expect(table).toContainText(valeur!);
    await expect(table).toContainText("NBS");
    await expect(table).toContainText("juil. 2026");
  }
  expect(posts).toBeGreaterThanOrEqual(4);
  await macro.screenshot({ path: "/private/tmp/axiom-20260907-macro.png" });
});

test("MACRO : chômage indien, PPI canadien calculé et PPI japonais natif", async ({ page }) => {
  await page.route("**/api/plfs/getData?*", route => route.fulfill({ json: { statusCode: true, meta_data: { page: 1, totalPages: 1 }, data: [{ frequency: "Monthly", indicator: "UR (Unemployment Rate, in per cent)", state: "All India", AgeGroup: "15 years and above", gender: "person", sector: "rural + urban", unit: "%", year: "2026", month: "July", value: "5.1" }] } }));
  await page.route("**/getDataFromVectorByReferencePeriodRange?*", route => route.fulfill({ json: [{ status: "SUCCESS", object: { responseStatusCode: 0, productId: 18100265, vectorId: 1230995983, vectorDataPoint: [["2025-07-01", 130.3], ["2026-07-01", 146.5]].map(([refPer, value]) => ({ refPer, value, scalarFactorCode: 0, symbolCode: 0, statusCode: 0, securityLevelCode: 0, frequencyCode: 6 })) } }] }));
  await page.route("**/api/v1/getDataCode?*", route => route.fulfill({ json: { STATUS: 200, NEXTPOSITION: null, RESULTSET: [{ SERIES_CODE: "PRCG20_2200000000%", UNIT: "%", FREQUENCY: "MONTHLY", VALUES: { SURVEY_DATES: [202606, 202607], VALUES: [7.3, 7.2] } }] } }));
  await page.goto("/"); await commande(page, "MACRO");
  const macro = page.getByTestId("macro-series-tab"), table = macro.getByRole("table");
  await macro.getByLabel("Indicateur macro").selectOption("chomage");
  const inde = table.getByRole("row").filter({ hasText: "MoSPI" });
  await expect(inde).toContainText("5,10 %"); await expect(inde).toContainText("juil. 2026");
  await macro.getByLabel("Indicateur macro").selectOption("ppi-aa");
  await expect(table.getByRole("row").filter({ hasText: "Statistique Canada" })).toContainText("12,43 %");
  await expect(table.getByRole("row").filter({ hasText: "Banque du Japon" })).toContainText("7,20 %");
});
