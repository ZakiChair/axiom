import { expect, test } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("OMON tactile : lecture du contact conservée après le relâchement", async ({ page, browserName }) => {
  const maintenant = Date.parse("2026-09-28T12:00:00Z");
  await bouchonnerReseau(page);
  await page.clock.setFixedTime(maintenant);
  await page.addInitScript(() => localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 })));
  // Même chaîne déterministe que options-carte : deux échéances, spot fixé à 100 000.
  await page.route("https://www.deribit.com/api/v2/public/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("get_index_price")) return route.fulfill({ json: { result: { index_price: 100_000 } } });
    if (url.pathname.endsWith("get_volatility_index_data")) return route.fulfill({ json: { result: { data: [[maintenant, 50, 50, 50, 50]] } } });
    const result = ["02OCT26", "30OCT26"].flatMap((echeance) => [90_000, 100_000, 110_000].flatMap((strike) => ["C", "P"].map((sens) => ({
      instrument_name: `BTC-${echeance}-${strike}-${sens}`, underlying_price: 100_000,
      mark_iv: 50, open_interest: 10, interest_rate: 0, volume: 1, mark_price: 0.03, creation_timestamp: maintenant,
    }))));
    return route.fulfill({ json: { result } });
  });
  await page.goto("/");
  await page.getByRole("navigation", { name: "Navigation du terminal" }).getByRole("button", { name: "Fonctions", exact: true }).tap();
  await page.getByRole("menuitem", { name: /^OMON/ }).tap();
  const fenetre = page.getByRole("complementary", { name: "Options (smile IV, max pain)" });
  await fenetre.getByRole("button", { name: "Term IV", exact: true }).tap();
  await expect(fenetre.getByRole("table", { name: "Mouvement attendu par échéance" })).toContainText("50.0 %");
  const canvas = fenetre.locator("canvas:visible");
  await expect(canvas).toHaveCount(1);
  await canvas.scrollIntoViewIfNeeded();
  const rect = await canvas.boundingBox();
  expect(rect).not.toBeNull();
  const lecture = fenetre.getByText("IV ATM : 50.0 %", { exact: true });
  if (browserName === "chromium") {
    const session = await page.context().newCDPSession(page);
    // Appui réel, avant les événements souris de compatibilité générés au relâchement.
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: rect!.x + rect!.width / 2, y: rect!.y + rect!.height / 2 }] });
    await expect(lecture).toBeVisible();
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await session.detach();
  } else {
    await canvas.tap({ position: { x: rect!.width / 2, y: rect!.height / 2 } });
  }
  await expect(lecture).toBeVisible();
});
