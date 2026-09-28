import { expect, test } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

test("DOM chauffe, distingue carnet insuffisant et réarme au changement de symbole", async ({ page }) => {
  await bouchonnerReseau(page);
  await page.addInitScript(() => localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 })));
  await page.route("**/api.binance.com/api/v3/klines*", (route) => route.fulfill({ json: Array.from({ length: 60 }, (_, i) => [Date.now() - (60 - i) * 60_000, "100", "101", "99", "100", "10", Date.now() - (59 - i) * 60_000 - 1, "1000", 5, "5", "500"]) }));
  await page.route("**/api/v3/depth?*", (route) => route.fulfill({ json: { lastUpdateId: 100, bids: [["99", "100"]], asks: [["101", "100"]] } }));
  const timers = new Set<ReturnType<typeof setInterval>>();
  await page.routeWebSocket("**/*@depth@100ms", (socket) => {
    let id = 100;
    const timer = setInterval(() => {
      id++;
      socket.send(JSON.stringify({ e: "depthUpdate", U: id, u: id, b: [["99", "100"]], a: [["101", "100"]] }));
    }, 100);
    timers.add(timer);
    socket.onClose(() => { clearInterval(timer); timers.delete(timer); });
  });
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Fonctions" }).click();
    await page.getByRole("menuitem", { name: /Carnet d'ordres/ }).click();
    const panneau = page.getByTestId("depth-stability");
    await expect(panneau).toBeVisible();
    await expect(panneau).toContainText("BTCUSDT");
    await expect(panneau).toContainText("médiane —");
    await expect(panneau).toContainText("de la durée");
    await expect(panneau).toContainText("de la fenêtre");

    const montant = panneau.getByRole("spinbutton", { name: "Montant cible de liquidité en USDT" });
    await montant.fill("1000000");
    await expect(panneau).toContainText("carnet insuffisant 1", { timeout: 10_000 });
    await montant.fill("1000");
    await expect(panneau).toContainText("courant 100.0 bps", { timeout: 10_000 });
    await expect(panneau).toContainText("médiane —");

    await page.evaluate(async () => {
      const importer = new Function("return import('/src/store/market.ts')") as () => Promise<{ marketStore: { getState: () => { setMarket: (m: { exchange: "binance"; symbol: string; timeframe: "1m" }) => void } } }>;
      (await importer()).marketStore.getState().setMarket({ exchange: "binance", symbol: "ETHUSDT", timeframe: "1m" });
    });
    await expect(panneau).toContainText("ETHUSDT");
    await expect(panneau).not.toContainText("BTCUSDT");
  } finally {
    for (const timer of timers) clearInterval(timer);
  }
});
