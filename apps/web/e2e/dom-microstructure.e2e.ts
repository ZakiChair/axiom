import { expect, test } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

test("DOM peint les calculs L2 puis les invalide au trou de séquence", async ({ page }, testInfo) => {
  await bouchonnerReseau(page);
  let bid = "10"; let ask = "10"; let jump = false;
  const timers = new Set<ReturnType<typeof setInterval>>();
  let sockets = 0; let snapshots = 0;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.routeWebSocket("**/*@depth@100ms", (socket) => {
    sockets++;
    // Chaque connexion possède sa séquence, y compris le montage StrictMode annulé.
    let sequence = 100;
    const timer = setInterval(() => {
      if (jump) { sequence += 20; jump = false; }
      sequence++;
      socket.send(JSON.stringify({ e: "depthUpdate", U: sequence, u: sequence, b: [["99.99", bid]], a: [["100.01", ask]] }));
    }, 100);
    timers.add(timer);
    socket.onClose(() => { clearInterval(timer); timers.delete(timer); });
  });
  await page.route("**/api/v3/depth?*", (route) => { snapshots++; return route.fulfill({ json: {
    lastUpdateId: 100, bids: [["99.99", "10"], ["99.8", "1"]], asks: [["100.01", "10"], ["100.2", "1"]],
  } }); });
  await page.addInitScript(() => {
    localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
    const ctx = CanvasRenderingContext2D.prototype;
    const fillText = ctx.fillText; const clearRect = ctx.clearRect;
    const log = () => window as unknown as { domPaint: string[] };
    const isDom = (canvas: HTMLCanvasElement) => canvas.closest('[aria-label="Carnet d\'ordres (DOM / depth)"]');
    ctx.clearRect = function (...args) {
      if (isDom(this.canvas)) log().domPaint = [];
      return clearRect.apply(this, args);
    };
    ctx.fillText = function (...args) {
      if (isDom(this.canvas)) (log().domPaint ??= []).push(args[0]);
      return fillText.apply(this, args);
    };
  });
  const painted = () => page.evaluate(() => (window as unknown as { domPaint?: string[] }).domPaint?.join("\n") ?? "");
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Fonctions" }).click();
    await page.getByRole("menuitem", { name: /Carnet d'ordres/ }).click();
    const dom = page.getByRole("complementary", { name: "Carnet d'ordres (DOM / depth)" });
    await expect(dom).toBeVisible();
    await expect.poll(() => sockets > 0 && snapshots > 0).toBe(true);
    await expect.poll(painted, { timeout: 20_000 }).toContain("OFI 30 s : 0.0000 base / 0.00 × L1");
    bid = "15"; ask = "5";
    await expect.poll(painted).toContain("OFI 30 s : 10.00 base / 1.00 × L1");
    await expect.poll(painted).toContain("Microprix / mid : +0.5 bps");
    await expect.poll(painted).toContain("Résilience L2 · heuristique · ±10 bps");
    await dom.screenshot({ path: testInfo.outputPath("dom-microstructure.png") });
    jump = true; // trou : resnapshot obligatoire, ancienne OFI interdite
    await expect.poll(painted).toContain("OFI 30 s : —");
    await expect.poll(painted).toContain("OFI n=0");
    expect(errors).toEqual([]);
  } finally {
    for (const timer of timers) clearInterval(timer);
  }
});
