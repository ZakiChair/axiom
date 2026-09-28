import { expect, test, type Page, type Route } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

const CLE_ANCIENNE_FIXTURE = "fixture-cle-bgeometrics-ancienne";
const CLE_NOUVELLE_FIXTURE = "fixture-cle-bgeometrics-nouvelle";
const JOUR_MS = 86_400_000;

const CHAMPS_BG: Record<string, string> = {
  "mvrv-zscore": "mvrvZscore",
  sopr: "sopr",
  nupl: "nupl",
  "puell-multiple": "puellMultiple",
  "reserve-risk": "reserveRisk",
  "realized-cap": "realizedCap",
  "realized-price-sth": "realizedPriceSth",
  "realized-price-lth": "realizedPriceLth",
  "exchange-netflow-btc": "exchangeNetflowBtc",
  "exchange-reserve-btc": "exchangeReserveBtc",
};
const CHEMINS_VALORISATION = ["mvrv-zscore", "sopr", "nupl", "puell-multiple", "reserve-risk"];

function pointsBgeometrics(chemin: string, valeurFinale: number): unknown[] {
  const champ = CHAMPS_BG[chemin];
  if (champ === undefined) throw new Error(`Chemin BGeometrics imprévu dans la fixture : ${chemin}`);
  return Array.from({ length: 25 }, (_, index) => ({
    unixTs: Math.floor((Date.now() - (24 - index) * JOUR_MS) / 1000),
    [champ]: valeurFinale - (24 - index) / 100,
  }));
}

function pointsCoinMetrics(): unknown[] {
  return Array.from({ length: 25 }, (_, index) => ({
    asset: "btc",
    time: new Date(Date.now() - (24 - index) * JOUR_MS).toISOString(),
    AdrActCnt: 424_242 + index,
    TxCnt: 512_000 + index,
    FeeTotNtv: 12 + index / 10,
    CapMrktCurUSD: 2_000_000_000_000 + index,
    CapMVRVCur: 1.5 + index / 100,
  }));
}

async function ouvrirChain(page: Page): Promise<ReturnType<Page["getByRole"]>> {
  await page.goto("/");
  await page.getByRole("button", { name: "Fonctions" }).click();
  await page.getByRole("menuitem", { name: /On-chain/ }).click();
  return page.getByRole("complementary", { name: "On-chain", exact: true });
}

test("CHAIN publie les sources rapides puis invalide une réponse BGeometrics après rotation", async ({ page }) => {
  await bouchonnerReseau(page);
  await page.addInitScript((cle) => {
    localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
    localStorage.setItem("axiom:bgeometrics:key", cle);
    localStorage.setItem("axiom:sosovalue:key", "fixture-cle-sosovalue");
  }, CLE_ANCIENNE_FIXTURE);

  await page.route("**/community-api.coinmetrics.io/**", (route) => route.fulfill({
    json: { data: pointsCoinMetrics(), next_page_url: null },
  }));
  await page.route("**/sosoapi/**", (route) => route.fulfill({
    json: {
      code: 0,
      data: {
        dailyNetInflow: { value: 10, status: "1", lastUpdateDate: new Date().toISOString().slice(0, 10) },
        list: [{ ticker: "FIX", dailyNetInflow: { value: 10, status: "1" } }],
      },
    },
  }));

  let libererAncienne!: () => void;
  const attenteAncienne = new Promise<void>((resolve) => { libererAncienne = resolve; });
  let marquerAncienneTraitee!: () => void;
  const ancienneTraitee = new Promise<void>((resolve) => { marquerAncienneTraitee = resolve; });
  let requeteMvrvAncienneLente = 0;
  const cheminsNouveaux = new Set<string>();

  await page.route("**/bgapi/v1/**", async (route: Route) => {
    const chemin = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
    const autorisation = route.request().headers().authorization;
    if (autorisation === `Bearer ${CLE_ANCIENNE_FIXTURE}`) {
      if (chemin !== "mvrv-zscore") {
        await route.fulfill({ json: pointsBgeometrics(chemin, 3.33) });
        return;
      }
      requeteMvrvAncienneLente += 1;
      await attenteAncienne;
      try {
        await route.fulfill({ json: pointsBgeometrics(chemin, 1.11) });
      } catch {
        // La rotation annule normalement la requête avant cette réponse tardive.
      } finally {
        marquerAncienneTraitee();
      }
      return;
    }
    expect(autorisation).toBe(`Bearer ${CLE_NOUVELLE_FIXTURE}`);
    cheminsNouveaux.add(chemin);
    await route.fulfill({ json: pointsBgeometrics(chemin, chemin === "mvrv-zscore" ? 9.99 : 2.22) });
  });

  const chain = await ouvrirChain(page);
  await expect.poll(() => requeteMvrvAncienneLente).toBe(1);

  // La barrière BGeometrics est encore volontairement bloquée, mais Coin Metrics a
  // déjà publié sa valeur et sa provenance dans le panneau monté.
  const qualiteCoinMetrics = chain
    .locator("details")
    .getByText("Adresses actives BTC", { exact: true })
    .locator("..");
  await expect(qualiteCoinMetrics).toContainText("Coin Metrics Community");
  await expect(chain.getByText("424.27K", { exact: true })).toBeVisible();
  expect(cheminsNouveaux.size).toBe(0);

  await page.getByRole("button", { name: "Ouvrir les réglages" }).click();
  const reglages = page.getByRole("dialog", { name: "Réglages", exact: true });
  const blocBgeometrics = reglages.locator("div.rounded-md").filter({ hasText: "BGeometrics (on-chain)" }).first();
  await blocBgeometrics.getByRole("button", { name: "Modifier" }).click();
  await blocBgeometrics.getByPlaceholder("Clé API BGeometrics (optionnelle)").fill(CLE_NOUVELLE_FIXTURE);
  await blocBgeometrics.getByRole("button", { name: "Enregistrer" }).click();
  await expect(blocBgeometrics).toContainText("clé ✓ configurée");
  await reglages.getByRole("button", { name: "Fermer les réglages" }).click();

  await expect.poll(() => CHEMINS_VALORISATION.every((chemin) => cheminsNouveaux.has(chemin))).toBe(true);
  await expect(chain.getByText("9.99", { exact: true })).toBeVisible();
  await expect(chain.getByText("1.11", { exact: true })).toHaveCount(0);

  const qualiteMvrv = chain
    .locator("details")
    .getByText("MVRV Z-Score", { exact: true })
    .locator("..");
  await expect(qualiteMvrv).toContainText("frais");
  await expect(qualiteMvrv).toContainText(/BGeometrics\s*· cle/);
  await expect(qualiteMvrv).toContainText("couverture 25/120");

  // Tente de livrer l'ancienne réponse après la publication de la nouvelle génération.
  // Le rendu et sa provenance doivent rester ceux de la clé de remplacement.
  libererAncienne();
  await ancienneTraitee;
  await expect(chain.getByText("9.99", { exact: true })).toBeVisible();
  await expect(chain.getByText("1.11", { exact: true })).toHaveCount(0);
  expect(CHEMINS_VALORISATION.every((chemin) => cheminsNouveaux.has(chemin))).toBe(true);
});
