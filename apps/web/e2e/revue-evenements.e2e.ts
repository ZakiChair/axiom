import { test, expect, type Page } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

const MINUTE = 60_000;
const ANNONCE_A = Date.parse("2026-09-04T12:30:00Z");
const ANNONCE_B = Date.parse("2026-08-12T12:30:00Z");

function bougiesM1(fin: number): unknown[] {
  const dernier = Math.floor(fin / MINUTE) * MINUTE;
  return Array.from({ length: 1000 }, (_, i) => {
    const time = dernier - (999 - i) * MINUTE;
    return [time, "100", "101", "99", "100", "10", time + MINUTE - 1, "1000", 1, "5", "500", "0"];
  });
}

async function ouvrirSelection(page: Page, selection: Record<string, unknown>): Promise<void> {
  await page.evaluate(async (valeur) => {
    const importer = new Function("return import('/src/store/evts.ts')") as () => Promise<{
      evtsUiStore: { getState: () => { ouvrirEvenement: (selection: Record<string, unknown>) => void } };
    }>;
    (await importer()).evtsUiStore.getState().ouvrirEvenement(valeur);
  }, selection);
}

test.beforeEach(async ({ page }) => {
  await bouchonnerReseau(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
  });
  await page.route("**/api.binance.com/api/v3/klines*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("interval") !== "1m") {
      await route.fulfill({ json: [] });
      return;
    }
    const fin = Number(url.searchParams.get("endTime"));
    // La première cible reste volontairement lente : le changement de sélection doit
    // vider son état et empêcher sa réponse tardive de remplacer la seconde cible.
    if (fin >= ANNONCE_A && fin < ANNONCE_A + 2 * 24 * 60 * MINUTE) {
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    await route.fulfill({ json: bougiesM1(fin) });
  });
});

test("EVTS réhydrate l'import et ignore une réaction lente d'une sélection remplacée", async ({ page }) => {
  let navigations = 0;
  page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations += 1; });
  await page.goto("/");
  const apresBoot = navigations;

  await ouvrirSelection(page, {
    type: "nfp", mesure: "nfp-payems-change", country: "USD", id: "nfp-a",
    title: "Sélection lente A", time: ANNONCE_A, timeApprox: false, source: "Fixture A",
  });
  await expect(page.getByText(/Occurrence ECO\s*:\s.*Sélection lente A/)).toBeVisible();

  await ouvrirSelection(page, {
    type: "cpi", mesure: "cpi-global-mm-sa", country: "USD", id: "cpi-b",
    title: "Sélection rapide B", time: ANNONCE_B, timeApprox: false, source: "Fixture B",
  });
  await expect(page.getByText(/Occurrence ECO\s*:\s.*Sélection rapide B/)).toBeVisible();
  await expect(page.getByText(/Cible\s*:\s.*Sélection rapide B/)).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(900);
  await expect(page.getByText(/Cible\s*:\s.*Sélection lente A/)).toHaveCount(0);

  const guide = page.getByRole("link", { name: "Schéma archive" });
  const hrefGuide = await guide.getAttribute("href");
  expect(hrefGuide).not.toBeNull();
  const reponseGuide = await page.request.get(new URL(hrefGuide!, page.url()).href);
  expect(reponseGuide.ok()).toBe(true);
  expect(await reponseGuide.text()).toContain("# Archives de publications économiques");

  const publishedAt = Date.parse("2026-09-09T12:30:00Z");
  const document = {
    version: 2,
    archives: [{
      id: "cpi-e2e-import", type: "cpi", mesure: "cpi-global-mm-sa", country: "USD",
      period: "2026-08", publishedAt, timeApprox: false,
      source: { nom: "Import E2E", url: "https://example.test/cpi-release" },
      actual: { label: "CPI importé", value: 0.1, unit: "%", transformation: "m/m SA" },
      consensusAvantAnnonce: null,
    }],
    capturesConsensus: [{
      id: "capture-e2e", type: "cpi", mesure: "cpi-global-mm-sa", country: "USD",
      title: "CPI importé", publishedAt, timeApprox: false, consensus: { value: "0.2%" },
      source: { nom: "Calendrier E2E", url: "https://example.test/calendar" }, collectedAt: publishedAt - MINUTE,
    }, {
      id: "capture-sans-communique", type: "cpi", mesure: "cpi-global-mm-sa", country: "USD",
      title: "CPI futur capturé", publishedAt: publishedAt + 31 * 24 * 60 * MINUTE, timeApprox: false, consensus: { value: "0.3%" },
      source: { nom: "Calendrier E2E", url: "https://example.test/calendar-future" }, collectedAt: publishedAt,
    }],
  };
  await page.locator('input[type="file"]').setInputFiles({
    name: "archives-e2e.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)),
  });
  await expect(page.getByText(/1 archive\(s\) et 2 consensus importés/)).toBeVisible();
  await expect(page.getByText(/Import E2E/)).toBeVisible();
  await expect(page.getByText(/Prévisions capturées avant annonce/)).toBeVisible();
  await expect(page.getByText(/CPI futur capturé/)).toBeVisible();
  await expect(page.getByText(/09\/09\/2026 12:30 UTC/).first()).toBeVisible();
  await expect(page.getByText("collectée 09/09/2026 12:29 UTC", { exact: true })).toBeVisible();
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("axiom:eco:publications:v2") ?? "{}").archives?.length ?? 0)).toBe(1);
  expect(navigations).toBe(apresBoot);
});
