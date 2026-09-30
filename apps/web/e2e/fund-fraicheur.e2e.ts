import { expect, test, type Page } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

const OLD = Date.parse("2026-09-01T12:00:00Z");
async function preparer(page: Page) {
  await bouchonnerReseau(page);
  await page.route("**/src/lib/deployment.ts", route => route.fulfill({ contentType: "text/javascript", body: 'export const IS_VERCEL = true; export const isVercelDeployment = v => v === "vercel";' }));
  await page.route("**/api/config", route => route.fulfill({ json: { providers: { finnhub: true } } }));
  await page.route("**/files/company_tickers.json", route => route.fulfill({ json: { "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc" } } }));
  await page.route("**/submissions/CIK*.json", route => route.fulfill({ json: { name: "Apple Inc", sicDescription: "Technology" } }));
  await page.addInitScript(() => localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 })));
}
async function ouvrir(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Fonctions", exact: true }).click();
  await page.getByRole("menuitem", { name: /Fiche société/ }).click();
  const fund = page.getByRole("complementary", { name: "Fiche société (FUND)", exact: true });
  await fund.getByRole("textbox", { name: "Rechercher une société" }).fill("Apple");
  await fund.getByRole("button", { name: "AAPL Apple Inc", exact: true }).click();
  return fund;
}

test("FUND conserve le cache daté pendant les refus puis remplace données et fraîcheur à la reprise", async ({ page }) => {
  await preparer(page);
  await page.addInitScript(old => {
    localStorage.setItem("axiom:onchain:finnhub:profil:AAPL", JSON.stringify({ ts: old, donnee: { nom: "Apple ancienne", secteur: "Technology", capitalisation: 3_000_000, description: "" } }));
    localStorage.setItem("axiom:onchain:finnhub:earnings:AAPL", JSON.stringify({ ts: old, donnee: [{ ticker: "AAPL", date: "2026-10-30", epsEstime: 1.5, epsReel: null }] }));
  }, OLD);
  let reprise = false;
  await page.route("**/finnhubapi/**", route => {
    const profil = route.request().url().includes("profile2");
    return route.fulfill(reprise
      ? { json: profil ? { name: "Apple actualisée", marketCapitalization: 4_000_000 } : { earningsCalendar: [{ date: "2026-10-30", epsEstimate: 2.5, epsActual: null }] } }
      : { status: profil ? 401 : 429, json: {} });
  });
  const fund = await ouvrir(page);
  await expect(fund).toContainText("Apple ancienne");
  await expect(fund.getByRole("status")).toContainText("Données en cache périmées");
  await expect(fund.getByRole("status")).toContainText("accès refusé");
  await expect(fund.locator("time")).toHaveAttribute("datetime", "2026-09-01T12:00:00.000Z");
  await fund.getByRole("button", { name: "Résultats", exact: true }).click();
  await expect(fund.getByRole("table")).toContainText("1.50");
  await expect(fund.getByRole("status")).toContainText("quota atteint");
  await expect(fund.locator("time")).toHaveAttribute("datetime", "2026-09-01T12:00:00.000Z");
  reprise = true;
  await page.evaluate(async () => { const path = "/src/store/finnhub.ts"; (await import(path)).finnhubKeyStore.getState().setKey("fixture-personnelle"); });
  await expect(fund.getByRole("table")).toContainText("2.50");
  await expect(fund.getByRole("status")).not.toContainText("périmées");
  await expect(fund.locator("time")).not.toHaveAttribute("datetime", "2026-09-01T12:00:00.000Z");
  await fund.getByRole("button", { name: "Profil", exact: true }).click();
  await expect(fund).toContainText("Apple actualisée");
  await expect(fund.getByRole("status")).not.toContainText("périmées");
});

test("FUND sans cache distingue le refus de clé et le quota d'une absence de données", async ({ page }) => {
  await preparer(page);
  await page.route("**/finnhubapi/**", route => route.fulfill({ status: route.request().url().includes("profile2") ? 401 : 429, json: {} }));
  const fund = await ouvrir(page);
  await expect(fund).toContainText("accès refusé");
  await expect(fund).not.toContainText("Profil Finnhub indisponible pour ce ticker");
  await fund.getByRole("button", { name: "Résultats", exact: true }).click();
  await expect(fund).toContainText("quota atteint");
  await expect(fund).not.toContainText("Aucun résultat trimestriel programmé");
  await expect(fund.locator("time")).toHaveCount(0);
});
