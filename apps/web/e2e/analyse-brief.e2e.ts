import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

const JOUR = 86_400_000;
const FIN = Date.UTC(2026, 8, 23);
const tuple = (time: number, prix: number) => [time, String(prix), String(prix), String(prix), String(prix), "1", time + JOUR - 1, "1", 1, "1", "1", "0"];

test("BRIEF actualise, conserve une référence, compare et réhydrate sans inventer DOM/GLOBE", async ({ page }) => {
  await bouchonnerReseau(page);
  await page.clock.setFixedTime(new Date("2026-09-24T12:00:00Z"));
  await page.addInitScript(() => localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 })));
  await page.route("**/api.llama.fi/v2/historicalChainTvl/*", (route) => {
    const chaine = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1) ?? "");
    const values = Array.from({ length: 31 }, (_, i) => ({ date: Math.floor((FIN - (30 - i) * JOUR) / 1000), tvl: chaine === "Ethereum" && i === 30 ? 200 : 100 }));
    return route.fulfill({ json: values });
  });
  await page.route("**/api.llama.fi/overview/**", (route) => route.fulfill({ json: { totalDataChart: [] } }));
  await page.route("**/stablecoins.llama.fi/stablecoincharts/**", (route) => route.fulfill({ json: [] }));
  let prixFinalEth = 90;
  await page.route("**/api.binance.com/api/v3/klines*", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("interval") !== "1d") return route.fulfill({ json: [] });
    const symbol = url.searchParams.get("symbol");
    const fin = symbol === "ETHUSDT" ? prixFinalEth : 110;
    return route.fulfill({ json: [tuple(FIN - 30 * JOUR, 100), tuple(FIN, fin)] });
  });
  await page.goto("/");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder(/^Commande/).fill("BRIEF");
  await page.keyboard.press("Enter");
  const section = page.getByRole("region", { name: "Analyse multidomaine" });
  await expect(section).toContainText("ethereum : divergence descriptive", { timeout: 20_000 });
  await expect(section).toContainText("Micro · coût L2");
  await expect(section).toContainText("Géopolitique · scénarios choisis");
  await expect(section).toContainText("Aucune lecture acquise dans ce domaine.");
  await section.getByRole("button", { name: "Enregistrer la référence" }).click();
  await expect(section).toContainText("Référence enregistrée");

  prixFinalEth = 110;
  await page.clock.setFixedTime(new Date("2026-09-24T12:01:00Z"));
  const brief = page.getByRole("complementary", { name: "Point marché" });
  await expect(brief.getByRole("button", { name: "Rafraîchir" })).toBeEnabled();
  await brief.getByRole("button", { name: "Rafraîchir" }).click();
  await expect(section).toContainText("ethereum : concordance descriptive", { timeout: 20_000 });
  await expect(section).toContainText("Depuis la référence");

  const [jsonDownload] = await Promise.all([page.waitForEvent("download"), section.getByRole("button", { name: "Exporter JSON" }).click()]);
  const jsonPath = await jsonDownload.path();
  expect(jsonPath).not.toBeNull();
  const exported = JSON.parse(await readFile(jsonPath!, "utf8")) as { lectures: Array<{ conclusion: string }> };
  expect(exported.lectures.some((l) => l.conclusion.includes("ethereum : concordance descriptive"))).toBe(true);
  const [mdDownload] = await Promise.all([page.waitForEvent("download"), section.getByRole("button", { name: "Exporter Markdown" }).click()]);
  expect(await readFile((await mdDownload.path())!, "utf8")).toContain("ethereum : concordance descriptive");

  await page.reload();
  await expect(page.getByRole("button", { name: /^Indicateurs/ })).toBeVisible();
  const fenetre = page.locator('[data-window-id="brief"]');
  if (!(await fenetre.isVisible())) {
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByPlaceholder(/^Commande/).fill("BRIEF");
    await page.keyboard.press("Enter");
  }
  await expect(fenetre).toBeVisible();
  const sectionRechargee = page.getByRole("region", { name: "Analyse multidomaine" });
  await expect(sectionRechargee).toContainText("Référence enregistrée");
  await expect(sectionRechargee.getByRole("button", { name: "Voir CHAIN" }).first()).toBeVisible();
  await sectionRechargee.getByRole("button", { name: "Voir CHAIN" }).first().click();
  await expect(page.locator('[data-window-id="onchain"]')).toBeVisible();
});

test("une archive brute vide reste récupérable avant remplacement explicite", async ({ page }) => {
  await bouchonnerReseau(page);
  await page.addInitScript(() => {
    localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
    localStorage.setItem("axiom:analyseBrief:v1", "");
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Indicateurs/ })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder(/^Commande/).fill("BRIEF");
  await page.keyboard.press("Enter");
  const section = page.getByRole("region", { name: "Analyse multidomaine" });
  await expect(section).toContainText("Archive invalide conservée");
  await expect(section.getByRole("button", { name: "Exporter l'archive brute" })).toBeVisible();
  await section.getByRole("button", { name: "Autoriser son remplacement au prochain enregistrement" }).click();
  expect(await page.evaluate(() => localStorage.getItem("axiom:analyseBrief:v1"))).toBe("");
  await expect(section.getByRole("button", { name: "Enregistrer la référence" })).toBeEnabled();
  await section.getByRole("button", { name: "Enregistrer la référence" }).click();
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem("axiom:analyseBrief:v1"))) ?? "null")).toMatchObject({ schemaVersion: 1 });
});
