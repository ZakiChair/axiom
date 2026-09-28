import { expect, test } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

const JOUR = 86_400_000;
const MAINTENANT = Date.parse("2026-09-10T00:00:00Z");

test("économie des chaînes : horizons, parts à date commune et série absente", async ({ page }) => {
  await bouchonnerReseau(page);
  await page.clock.install({ time: MAINTENANT });
  await page.addInitScript(() => {
    localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
  });

  // Historiques synthétiques contrastés : la dernière séance Ethereum est plus
  // récente que celle de Solana. Les parts doivent donc revenir au 8 septembre.
  const ethereum = [
    [MAINTENANT - 366 * JOUR, 300],
    [MAINTENANT - 91 * JOUR, 50],
    [MAINTENANT - 31 * JOUR, 100],
    [MAINTENANT - 2 * JOUR, 100],
    [MAINTENANT - JOUR, 150],
  ];
  const solana = [
    [MAINTENANT - 367 * JOUR, 25],
    [MAINTENANT - 92 * JOUR, 200],
    [MAINTENANT - 32 * JOUR, 100],
    [MAINTENANT - 2 * JOUR, 50],
  ];
  await page.route(/^https:\/\/(?:api|stablecoins)\.llama\.fi\//, async (route) => {
    const url = new URL(route.request().url());
    const chaine = url.pathname.split("/").at(-1);
    const points = chaine === "Ethereum" ? ethereum : chaine === "Solana" ? solana : null;
    if (!points || (chaine === "Solana" && url.pathname.includes("/stablecoincharts/"))) {
      await route.fulfill({ status: 503, json: { error: "série absente de la fixture" } });
    } else if (url.pathname.includes("/historicalChainTvl/")) {
      await route.fulfill({ json: points.map(([time, tvl]) => ({ date: time! / 1000, tvl })) });
    } else if (url.pathname.includes("/stablecoincharts/")) {
      await route.fulfill({ json: points.map(([time, value]) => ({
        date: time! / 1000,
        totalCirculatingUSD: { peggedUSD: value },
        totalCirculating: { peggedUSD: 999_999_999 },
      })) });
    } else {
      await route.fulfill({ json: { totalDataChart: points.map(([time, value]) => [time! / 1000, value]) } });
    }
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Fonctions" }).click();
  await page.getByRole("menuitem", { name: /On-chain/ }).click();
  const fenetre = page.getByRole("complementary", { name: "On-chain", exact: true });
  const table = fenetre.getByRole("table", { name: "Économie comparée des chaînes" });
  await expect(table).toBeVisible();
  const section = table.locator("xpath=ancestor::section[1]");
  const eth = table.getByRole("row").filter({ has: page.getByText("Ethereum", { exact: true }) });
  const sol = table.getByRole("row").filter({ has: page.getByText("Solana", { exact: true }) });
  const tvlEth = eth.getByRole("cell").nth(1);
  const tvlSol = sol.getByRole("cell").nth(1);

  await expect(tvlEth).toContainText("$150.00");
  await expect(tvlEth).toContainText("+50.00%");
  await expect(tvlEth).toContainText("09/09/2026 00:00 UTC");
  await expect(tvlEth).toContainText("DefiLlama TVL");
  await expect(tvlSol).toContainText("$50.00");
  await expect(tvlSol).toContainText("-50.00%");
  await expect(tvlSol).toContainText("08/09/2026 00:00 UTC");
  for (const label of ["TVL · stock", "Volume DEX/j", "Frais/j", "Revenus/j"]) {
    const parts = section.locator("div.rounded").filter({ has: page.getByText(label, { exact: true }) });
    await expect(parts).toContainText("Parts au 2026-09-08 · couverture 2/4 · ethereum 66.7 % · solana 33.3 %");
  }
  const stablecoinsSol = sol.getByRole("cell").nth(3);
  await expect(stablecoinsSol).toContainText("indisponible");
  await expect(stablecoinsSol).not.toContainText("$0.00");
  await expect(eth.getByRole("cell").nth(3)).toContainText("$150.00");
  const partsStables = section.locator("div.rounded").filter({ has: page.getByText("Stablecoins · stock", { exact: true }) });
  await expect(partsStables).toContainText("couverture 1/4 · ethereum 100.0 %");

  await section.getByRole("button", { name: "90 j", exact: true }).click();
  await expect(tvlEth).toContainText("+200.00%");
  await expect(tvlSol).toContainText("-75.00%");
  await section.getByRole("button", { name: "365 j", exact: true }).click();
  await expect(tvlEth).toContainText("-50.00%");
  await expect(tvlSol).toContainText("+100.00%");
  await section.getByText("Séries temporelles datées", { exact: true }).click();
  const courbe = section.getByRole("img", { name: "Ethereum · TVL · stock", exact: true });
  await expect(courbe).toBeVisible();
  await expect(courbe.locator(":scope > title")).toContainText("USD · 2025-09-09 au 2026-09-09");
  await expect(section).toContainText("Les quantités natives sous-jacentes ne sont pas fournies ici");
});
