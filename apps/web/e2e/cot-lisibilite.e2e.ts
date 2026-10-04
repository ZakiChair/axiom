import { expect, test, type Locator } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

const OR = "GOLD - COMMODITY EXCHANGE INC.";
const EUR = "EURO FX - CHICAGO MERCANTILE EXCHANGE";
const legacy = [
  { market_and_exchange_names: OR, report_date_as_yyyy_mm_dd: "2026-06-09",
    noncomm_positions_long_all: "211127", noncomm_positions_short_all: "30907", open_interest_all: "339330" },
  { market_and_exchange_names: OR, report_date_as_yyyy_mm_dd: "2026-06-23",
    noncomm_positions_long_all: "217028", noncomm_positions_short_all: "35689", open_interest_all: "352167" },
  { market_and_exchange_names: EUR, report_date_as_yyyy_mm_dd: "2026-06-30",
    noncomm_positions_long_all: "120", noncomm_positions_short_all: "70", open_interest_all: "" },
];
const disaggregated = ["2026-06-09", "2026-06-23"].map((date, i) => ({
  market_and_exchange_names: OR, report_date_as_yyyy_mm_dd: date,
  m_money_positions_long_all: i ? "180000" : "170000",
  m_money_positions_short_all: i ? "40000" : "50000",
  prod_merc_positions_long: i ? "90000" : "100000",
  prod_merc_positions_short: i ? "150000" : "140000",
  open_interest_all: "500000",
}));
const tff = ["2026-06-16", "2026-06-23"].map((date, i) => ({
  market_and_exchange_names: EUR, report_date_as_yyyy_mm_dd: date,
  lev_money_positions_long: i ? "120000" : "100000",
  lev_money_positions_short: i ? "90000" : "100000",
  asset_mgr_positions_long: i ? "200000" : "190000",
  asset_mgr_positions_short: i ? "50000" : "40000",
  open_interest_all: "700000",
}));

async function verifierLargeur(fenetre: Locator) {
  const debordements = await fenetre.evaluate((racine) => {
    const cadre = racine.getBoundingClientRect();
    return Array.from(racine.querySelectorAll<HTMLElement>("article, article *, aside, header, header *"))
      .filter((el) => el.getClientRects().length > 0)
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left < cadre.left - 1 || r.right > cadre.right + 1 ||
          el.scrollWidth > el.clientWidth + 1;
      }).map((el) => `${el.tagName}: ${el.textContent}`);
  });
  expect(debordements).toEqual([]);
}

for (const largeur of [1280, 390]) {
  test(`COT : stocks et mouvements distincts, cache réutilisé, largeur ${largeur}`, async ({ page }) => {
    await page.setViewportSize({ width: largeur, height: 900 });
    await bouchonnerReseau(page);
    let appelsCftc = 0;
    page.on("request", (req) => { if (req.url().includes("publicreporting.cftc.gov")) appelsCftc++; });
    await page.addInitScript(({ legacy, disaggregated, tff }) => {
      localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
      for (const [dataset, records] of Object.entries({ legacy, disaggregated, tff })) {
        localStorage.setItem(`axiom:cot:cache:v2:${dataset}`, JSON.stringify({ ts: Date.now(), records }));
      }
    }, { legacy, disaggregated, tff });
    await page.goto("/");
    await expect(page.getByRole("combobox", { name: "Rechercher une paire" })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByPlaceholder(/^Commande/).fill("COT");
    await page.keyboard.press("Enter");
    const fenetre = page.locator('[data-window-id="cot"]');
    await expect(fenetre).toBeVisible();
    const or = fenetre.getByRole("article", { name: "Or", exact: true });
    await expect(or).toContainText("217 028");
    await expect(or).toContainText("35 689");
    await expect(or).toContainText("Ajouts nets : +5 901 contrats");
    await expect(or).toContainText("Ajouts nets : +4 782 contrats");
    await expect(or).toContainText("vs 9 juin 2026 (14 jours)");
    await expect(fenetre).toContainText("flux bruts peuvent se compenser et restent inconnus");
    await expect(fenetre).toContainText("Δ net = Δ longs − Δ shorts");
    const colonnes = or.locator("[data-cot-positions] > div");
    expect(await colonnes.count()).toBe(2);
    const long = await colonnes.nth(0).boundingBox();
    const short = await colonnes.nth(1).boundingBox();
    expect(long).not.toBeNull();
    expect(short).not.toBeNull();
    expect(Math.abs(long!.y - short!.y)).toBeLessThan(1);
    expect(long!.x + long!.width).toBeLessThan(short!.x);
    // Le guide reste court : au moins les deux stocks du premier instrument sont à l'écran.
    const premierStock = await fenetre.locator("[data-cot-positions]").first().boundingBox();
    const cadre = await fenetre.boundingBox();
    expect(premierStock!.y + premierStock!.height).toBeLessThan(Math.min(900, cadre!.y + cadre!.height));
    const euro = fenetre.getByRole("article", { name: "Euro (EUR)", exact: true });
    await expect(euro).toContainText("Rapport du 30 juin 2026");
    await expect(euro).toContainText("comparaison indisponible");
    await expect(euro.getByText("Variation indisponible", { exact: true })).toHaveCount(2);
    await expect(euro).toContainText("Net/OI indisponible");
    await verifierLargeur(fenetre);

    await fenetre.getByRole("button", { name: "Fonds", exact: true }).click();
    await expect(or).toContainText("180 000");
    await expect(or).toContainText("40 000");
    await expect(or).toContainText("Réductions nettes : −10 000 contrats");
    await expect(euro).toContainText("120 000");
    await expect(euro).toContainText("90 000");
    await verifierLargeur(fenetre);
    await fenetre.getByRole("button", { name: "Commerciaux", exact: true }).click();
    await expect(or).toContainText("90 000");
    await expect(or).toContainText("150 000");
    await expect(or).toContainText("Net vendeur");
    await expect(euro).toContainText("200 000");
    await expect(euro).toContainText("50 000");
    await expect(fenetre).not.toContainText("Net spéculatif");
    await expect(fenetre).not.toContainText("cette semaine");
    await expect(fenetre).not.toContainText(/\d+ longs (ouverts|fermés)/);
    await verifierLargeur(fenetre);
    const rapports = fenetre.getByRole("region", { name: "Rapports COT", exact: true });
    // Depuis le dernier contrôle d'en-tête, Tab doit atteindre le conteneur lui-même.
    await fenetre.getByRole("button", { name: /Rafraîchir/ }).focus();
    await page.keyboard.press("Tab");
    await expect(rapports).toBeFocused();
    expect(await rapports.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe("none");
    const avant = await rapports.evaluate((el) => el.scrollTop);
    await page.keyboard.press("PageDown");
    await expect.poll(() => rapports.evaluate((el) => el.scrollTop)).toBeGreaterThan(avant);
    await page.keyboard.press("ControlOrMeta+Home");
    expect(appelsCftc).toBe(0);
    // Preuve visuelle locale optionnelle, produite uniquement dans les artefacts Playwright.
    await fenetre.screenshot({ path: test.info().outputPath(`cot-${largeur}.png`) });
  });
}
