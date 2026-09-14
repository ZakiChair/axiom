import { expect, test, type Page } from "@playwright/test";
import type { Chart } from "klinecharts";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";
import { BTCUSDT_1D } from "../src/chart/niveaux/btcusdt1d.fixture";

/**
 * Niveaux clés sur le chart maître, réseau fermé : bougies 1d RÉELLES (sonde BTCUSDT du
 * 14/09/2026) et bougies 1m synthétiques oscillant entre 76 000 et 81 000 pour que les
 * niveaux du jour et de la semaine tombent dans l'échelle. Activation par la palette, lignes
 * lues par l'accroche du clic droit (seules les lignes réellement peintes sont accrochables),
 * alerte au niveau exact, persistance après rechargement.
 */
const MAINTENANT = Date.parse("2026-09-14T18:00:00Z");
const MINUTE = 60_000;

async function bouchonnerBougies(page: Page): Promise<void> {
  await page.route("**/api.binance.com/api/v3/klines*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const limite = Number(params.get("limit") ?? 500);
    if (params.get("interval") === "1d") {
      // Seul BTCUSDT a un historique 1d : un autre symbole ne doit jamais hériter de ses lignes.
      if (params.get("symbol") !== "BTCUSDT") {
        await route.fulfill({ status: 503, json: { error: "fixture absente" } });
        return;
      }
      const lignes = BTCUSDT_1D.map(([t, o, h, l, c]) => [t, String(o), String(h), String(l), String(c), "1", t + 86_399_999, "1", 1, "0", "0", "0"]);
      await route.fulfill({ json: lignes.slice(-limite) });
      return;
    }
    // 1m : onde triangulaire de période 40 bougies entre 76 000 et 81 000.
    const fin = Math.floor(MAINTENANT / MINUTE) * MINUTE;
    const lignes = Array.from({ length: 500 }, (_, i) => {
      const phase = (i % 40) / 20;
      const prix = 76_000 + 5_000 * (phase <= 1 ? phase : 2 - phase);
      const t = fin - (499 - i) * MINUTE;
      return [t, String(prix), String(prix + 40), String(prix - 40), String(prix + 10), "1", t + MINUTE - 1, "1", 1, "0", "0", "0"];
    });
    await route.fulfill({ json: lignes.slice(-limite) });
  });
}

async function commande(page: Page, texte: string): Promise<void> {
  await expect(page.getByRole("banner").getByRole("button", { name: /^Indicateurs/ })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder(/^Commande/).fill(texte);
  // La liste filtrée doit présenter la commande avant validation (sinon Enter part à vide).
  await expect(page.getByText(texte, { exact: true }).first()).toBeVisible();
  await page.keyboard.press("Enter");
}

async function attendreChart(page: Page): Promise<void> {
  await expect(page.locator("[data-chart-status]")).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => {
    const importer = new Function("return import('/src/chart/drawing.ts')") as () => Promise<{ getActiveChart: () => Chart | null }>;
    return (await importer()).getActiveChart()?.getDataList().length ?? 0;
  })).toBe(500);
}

/** Coordonnées client du prix `prix` sur le pane bougies du chart maître (milieu du pane). */
async function pointDuPrix(page: Page, prix: number): Promise<{ x: number; y: number }> {
  return page.evaluate(async (valeur) => {
    const importer = new Function("return import('/src/chart/drawing.ts')") as () => Promise<{
      setFocusChart: (slot: number) => void;
      getActiveChart: () => Chart | null;
    }>;
    const dessin = await importer();
    dessin.setFocusChart(0);
    const chart = dessin.getActiveChart();
    if (!chart) throw new Error("chart maître absent");
    const racine = chart.getDom()!.getBoundingClientRect();
    const pane = chart.getSize("candle_pane")!;
    const px = chart.convertToPixel({ value: valeur }, { paneId: "candle_pane", absolute: true }) as { y?: number };
    if (px.y === undefined || px.y < pane.top || px.y > pane.top + pane.height) throw new Error(`prix ${valeur} hors échelle`);
    return { x: racine.x + pane.left + pane.width / 2, y: racine.y + px.y + 2 };
  }, prix);
}

/** Clic droit au prix donné et lecture de l'en-tête du menu d'alerte (menu précédent fermé). */
async function enteteAuPrix(page: Page, prix: number): Promise<string> {
  const menu = page.locator("#axiom-price-alert-menu");
  // Le menu n'écoute Escape qu'après sa première frame : répéter jusqu'à fermeture.
  await expect(async () => {
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0, { timeout: 250 });
  }).toPass();
  const { x, y } = await pointDuPrix(page, prix);
  await page.mouse.click(x, y, { button: "right" });
  await expect(menu).toBeVisible();
  return (await menu.locator("div").first().textContent()) ?? "";
}

test.beforeEach(async ({ page }) => {
  await bouchonnerReseau(page);
  await page.clock.setFixedTime(new Date(MAINTENANT));
  await page.addInitScript(() => {
    localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
  });
});

test("niveaux clés : activation palette, lignes accrochables, alerte au niveau exact, persistance", async ({ page }) => {
  // Code des sources servi par Vite à la demande : il ne doit être demandé qu'à l'activation.
  const modulesSources: string[] = [];
  page.on("request", (requete) => {
    if (requete.url().includes("/src/chart/niveaux/")) modulesSources.push(requete.url());
  });
  await bouchonnerBougies(page);
  await page.goto("/");
  await attendreChart(page);

  // Défaut OFF : aucune ligne accrochable, code des sources jamais chargé.
  expect(await enteteAuPrix(page, 77_450)).not.toContain("PDH");
  expect(modulesSources).toEqual([]);

  await commande(page, "NIVCLE");
  await expect.poll(() => enteteAuPrix(page, 77_450), { timeout: 20_000 }).toBe("PDH · Prix 77,450.00");
  expect(modulesSources.some((url) => url.includes("/src/chart/niveaux/composite.ts"))).toBe(true);

  // Familles par défaut J + S : PDC, OJ et OS confondus en une seule ligne.
  expect(await enteteAuPrix(page, 76_842.01)).toBe("PDC·OJ·OS · Prix 76,842.01");
  expect(await enteteAuPrix(page, 80_443.99)).toContain("PWH");
  // Famille mois absente tant qu'elle n'est pas cochée, puis présente.
  expect(await enteteAuPrix(page, 78_581.3)).not.toContain("OM");
  await commande(page, "NIVCLE-M");
  await expect.poll(() => enteteAuPrix(page, 78_581.3)).toContain("OM · Prix 78,581.30");

  // Alerte créée depuis la ligne PDH : niveau exact de la ligne, libellé en message.
  expect(await enteteAuPrix(page, 77_450)).toContain("PDH");
  await page.locator("#axiom-price-alert-menu").getByRole("menuitem", { name: /Alerte croisement ↑/ }).click();
  const alerte = await page.evaluate(async () => {
    const importer = new Function("return import('/src/store/alerts.ts')") as () => Promise<{
      alertsStore: { getState: () => { defs: { message?: string; condition: { type: string; niveau?: number; sens?: string } }[] } };
    }>;
    return (await importer()).alertsStore.getState().defs.at(-1) ?? null;
  });
  expect(alerte?.condition).toEqual({ type: "prix-croise", niveau: 77_450, sens: "hausse" });
  expect(alerte?.message).toBe("PDH BTCUSDT");

  // Persistance : bascule et familles restaurées au rechargement, sans repasser par la palette.
  const session = await page.evaluate(() => JSON.parse(localStorage.getItem("axiom:sessionUi:v1") ?? "{}"));
  expect(session).toMatchObject({ niveauxCles: true, niveauxClesFamilles: ["J", "S", "M"] });
  await page.reload();
  await attendreChart(page);
  await expect.poll(() => enteteAuPrix(page, 77_450), { timeout: 20_000 }).toBe("PDH · Prix 77,450.00");
  expect(await enteteAuPrix(page, 78_581.3)).toContain("OM");

  // Overlay scellé au symbole : sur ETHUSDT (sans historique 1d), aucune ligne BTC ne subsiste
  // et l'absence est expliquée par un toast.
  await page.getByRole("banner").getByRole("button", { name: "ETHUSDT", exact: true }).click();
  await expect(page.getByText("Niveaux clés : bougies 1d de ETHUSDT (binance) indisponibles, nouvel essai dans 5 min")).toBeVisible();
  await attendreChart(page);
  expect(await enteteAuPrix(page, 77_450)).not.toContain("PDH");

  // Retour sur BTCUSDT puis désactivation : plus aucune ligne accrochable.
  await page.getByRole("banner").getByRole("button", { name: "BTCUSDT", exact: true }).click();
  await attendreChart(page);
  await expect.poll(() => enteteAuPrix(page, 77_450)).toContain("PDH");
  await commande(page, "NIVCLE");
  await expect.poll(() => enteteAuPrix(page, 77_450)).not.toContain("PDH");
});
