import { expect, test, type Page } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

const NOW = Date.parse("2026-09-25T07:59:55Z");
function chaine(devise: string, oi = 10, date = "02OCT26") {
  const spot = devise === "ETH" ? 4_000 : 100_000;
  return ["C", "P"].map((type) => ({
    instrument_name: `${devise}-${date}-${spot}-${type}`, mark_iv: 50,
    mark_price: 0.04, underlying_price: spot, open_interest: type === "C" ? oi : oi / 2,
    interest_rate: 0, volume: 1, creation_timestamp: NOW, underlying_index: `${devise.toLowerCase()}_usd`,
  }));
}
async function ouvrir(page: Page, tableau = true) {
  await page.goto("/");
  await expect(page.getByRole("banner").getByRole("button", { name: /^Indicateurs/ })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder(/^Commande/).fill("OMON");
  await page.keyboard.press("Enter");
  const fenetre = page.getByRole("complementary", { name: "Options (smile IV, max pain)" });
  await fenetre.getByRole("button", { name: "GEX/DEX", exact: true }).click();
  if (tableau) {
    await fenetre.getByText("Contexte de chaîne", { exact: true }).click();
    await fenetre.getByText(/^Expositions par échéance \(/).click();
  }
  return fenetre;
}
test.beforeEach(async ({ page }) => {
  await bouchonnerReseau(page);
  await page.clock.install({ time: NOW });
  await page.addInitScript(() => localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 })));
});

test("BTC → ETH lent : aucun chiffre BTC sous ETH, la chaîne n'attend pas DVOL", async ({ page }) => {
  let libererEth: (() => void) | undefined;
  const attenteEth = new Promise<void>((resolve) => { libererEth = resolve; });
  await page.route("https://www.deribit.com/api/v2/public/**", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith("get_index_price")) return route.fulfill({ json: { result: { index_price: u.searchParams.get("index_name") === "eth_usd" ? 4_000 : 100_000 } } });
    if (u.pathname.endsWith("get_book_summary_by_currency")) {
      const d = u.searchParams.get("currency") ?? "BTC";
      if (d === "ETH") await attenteEth;
      return route.fulfill({ json: { result: chaine(d) } });
    }
    // L'historique reste en vol : il ne doit pas retarder les expositions.
    await attenteEth;
    return route.fulfill({ json: { result: { data: [[NOW, 50, 50, 50, 50]] } } });
  });
  const f = await ouvrir(page);
  await expect(f.getByRole("table", { name: "Expositions par échéance" })).toContainText("$1.50M");
  await f.getByRole("button", { name: "ETH", exact: true }).click();
  await expect(f.getByRole("region", { name: "Marché options ETH" })).not.toContainText("$1.50M");
  await expect(f.getByRole("region", { name: "Marché options ETH" })).toContainText("Chargement");
  await expect(f.getByRole("group", { name: "GEX net", exact: true })).toContainText("—");
  libererEth?.();
  await page.clock.runFor(500);
  await f.getByText("Contexte de chaîne", { exact: true }).click();
  await f.getByText(/^Expositions par échéance \(/).click();
  await expect(f.getByRole("table", { name: "Expositions par échéance" })).toContainText("$60.00K");
});

test("succès, échec, actualisation manuelle : date réelle conservée puis nouveaux chiffres", async ({ page }) => {
  let mode: "ok" | "erreur" | "nouveau" = "ok";
  await page.route("**/www.deribit.com/api/v2/public/**", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith("get_index_price")) return route.fulfill({ json: { result: { index_price: 100_000 } } });
    if (u.pathname.endsWith("get_book_summary_by_currency")) {
      if (mode === "erreur") return route.fulfill({ status: 503, json: { error: "panne" } });
      return route.fulfill({ json: { result: chaine("BTC", mode === "nouveau" ? 20 : 10) } });
    }
    return route.fulfill({ json: { result: { data: [[NOW, 50, 50, 50, 50]] } } });
  });
  const f = await ouvrir(page);
  const r = f.getByRole("region", { name: "Marché options BTC" });
  await expect(r.getByRole("table")).toContainText("$1.50M");
  const reception = r.locator("time[data-reception]");
  const date = await reception.getAttribute("datetime");
  mode = "erreur";
  await page.clock.fastForward(70_000);
  await expect(r).toContainText("Actualisation indisponible");
  await expect(reception).toHaveAttribute("datetime", date!);
  mode = "nouveau";
  await f.getByRole("button", { name: "Actualiser les options", exact: true }).click();
  await page.clock.runFor(500);
  await expect(r.getByRole("table")).toContainText("$3.00M");
  await expect(reception).not.toHaveAttribute("datetime", date!);
});

test("08:00 UTC : retire la grosse échéance même quand le réseau ne répond plus", async ({ page }) => {
  let bloquer = false;
  let liberer: (() => void) | undefined;
  const attente = new Promise<void>((resolve) => { liberer = resolve; });
  await page.route("https://www.deribit.com/api/v2/public/**", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith("get_index_price")) return route.fulfill({ json: { result: { index_price: 100_000 } } });
    if (u.pathname.endsWith("get_book_summary_by_currency")) {
      if (bloquer) await attente;
      return route.fulfill({ json: { result: [...chaine("BTC", 90, "25SEP26"), ...chaine("BTC", 10)] } });
    }
    return route.fulfill({ json: { result: { data: [[NOW, 50, 50, 50, 50]] } } });
  });
  const f = await ouvrir(page);
  const table = f.getByRole("table", { name: "Expositions par échéance" });
  await expect(table).toContainText("$13.50M");
  bloquer = true;
  await page.clock.fastForward(6_000);
  await expect(table).not.toContainText("$13.50M");
  await expect(table).toContainText("$1.50M");
  await expect(f.getByLabel("Échéance").locator("option")).toHaveCount(1);
  liberer?.();
});

test("portée unique : net et carte passent de toutes échéances à la sélection", async ({ page }) => {
  await page.route("https://www.deribit.com/api/v2/public/**", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith("get_index_price")) return route.fulfill({ json: { result: { index_price: 100_000 } } });
    if (u.pathname.endsWith("get_book_summary_by_currency")) {
      const courte = chaine("BTC", 10);
      courte[1]!.open_interest = 100;
      return route.fulfill({ json: { result: [...courte, ...chaine("BTC", 10_000, "25DEC26")] } });
    }
    return route.fulfill({ json: { result: { data: [[NOW, 50, 50, 50, 50]] } } });
  });
  const f = await ouvrir(page);
  const net = f.getByRole("group", { name: "GEX net", exact: true });
  await expect(f.getByRole("region", { name: "Analyse des expositions" })).toContainText("toutes échéances actives");
  await expect(net).toContainText(/\$/);
  await expect(net).not.toContainText("−$");
  await f.getByRole("button", { name: "Échéance sélectionnée", exact: true }).click();
  await expect(net).toContainText("−$");
  await expect(f.getByRole("region", { name: "Analyse des expositions" })).toContainText("échéance sélectionnée");
  await expect(f.getByRole("region", { name: "Carte des expositions nettes" })).toBeVisible();
  await f.getByRole("button", { name: "Sensibilité au prix", exact: true }).click();
  await expect(f.getByText("GEX net · échéance sélectionnée", { exact: true })).toBeVisible();
});

test("premier chargement en échec : expositions indisponibles, aucun faux zéro", async ({ page }) => {
  const f = await ouvrir(page, false);
  const resume = f.getByRole("region", { name: "Marché options BTC" });
  await expect(resume).toContainText("Actualisation indisponible");
  await expect(resume.getByRole("table")).toHaveCount(0);
  const net = f.getByRole("group", { name: "GEX net", exact: true });
  const dex = f.getByRole("group", { name: "DEX net", exact: true });
  await expect(net).toContainText("—");
  await expect(dex).toContainText("—");
  await expect(net).not.toContainText("$0");
});

test("IV inconnue : OI conservé, greeks absents sans scénarios à zéro", async ({ page }) => {
  await page.route("https://www.deribit.com/api/v2/public/**", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith("get_index_price")) return route.fulfill({ json: { result: { index_price: 100_000 } } });
    if (u.pathname.endsWith("get_book_summary_by_currency")) return route.fulfill({ json: { result: chaine("BTC").map((p) => ({ ...p, mark_iv: null })) } });
    return route.fulfill({ json: { result: { data: [[NOW, 50, 50, 50, 50]] } } });
  });
  const f = await ouvrir(page);
  const r = f.getByRole("region", { name: "Marché options BTC" });
  await expect(r).toContainText("$1.50M");
  await expect(r).toContainText("0.0 %");
  await expect(f.getByText("Sensibilité au signe gamma", { exact: true })).toHaveCount(0);
});
