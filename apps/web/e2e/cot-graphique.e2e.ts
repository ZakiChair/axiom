import { expect, test, type Page, type Route } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

/**
 * Graphique COT : exposition de chaque catégorie de traders, rapport après rapport.
 * Données FICTIVES et cohérentes (Σ longs = Σ shorts à chaque rapport) : le test vérifie le
 * parcours, la découverte des colonnes, le cache hebdomadaire et la mise en page, pas des chiffres
 * CFTC réels. Horloge figée un samedi : le dernier rapport (mardi 27 octobre 2026) est à jour.
 */

const SP = "E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE";
const OR = "GOLD - COMMODITY EXCHANGE INC.";
const MAINTENANT = new Date("2026-10-31T12:00:00Z");
const NB = 160;

const date = (k: number) => new Date(Date.UTC(2026, 9, 27) - (NB - 1 - k) * 7 * 86_400_000).toISOString().slice(0, 10);
const r = Math.round;

const tff = Array.from({ length: NB }, (_, k) => {
  const amL = r(1_000_000 + 250_000 * Math.sin(k / 9));
  const levS = r(500_000 + 200_000 * Math.cos(k / 14));
  const longs = amL + 300_000 + 150_000 + 120_000 + 160_000;
  const dealerS = longs - (250_000 + levS + 90_000 + 140_000);
  return {
    market_and_exchange_names: SP,
    report_date_as_yyyy_mm_dd: `${date(k)}T00:00:00.000`,
    open_interest_all: String(longs + 200_000),
    dealer_positions_long_all: "150000",
    dealer_positions_short_all: String(dealerS),
    asset_mgr_positions_long: String(amL),
    asset_mgr_positions_short: "250000",
    lev_money_positions_long: "300000",
    lev_money_positions_short: String(levS),
    other_rept_positions_long: "120000",
    other_rept_positions_short: "90000",
    nonrept_positions_long_all: "160000",
    nonrept_positions_short_all: "140000",
  };
});

const disagg = Array.from({ length: NB }, (_, k) => {
  const mmL = r(180_000 + 60_000 * Math.sin(k / 11));
  const longs = 60_000 + 40_000 + mmL + 30_000 + 25_000;
  const pmS = longs - (150_000 + 30_000 + 20_000 + 28_000);
  return {
    market_and_exchange_names: OR,
    report_date_as_yyyy_mm_dd: `${date(k)}T00:00:00.000`,
    open_interest_all: String(longs + 80_000),
    prod_merc_positions_long: "60000",
    prod_merc_positions_short: String(pmS),
    swap_positions_long_all: "40000",
    swap__positions_short_all: "150000",
    m_money_positions_long_all: String(mmL),
    m_money_positions_short_all: "30000",
    other_rept_positions_long: "30000",
    other_rept_positions_short: "20000",
    nonrept_positions_long_all: "25000",
    nonrept_positions_short_all: "28000",
  };
});

/** Synthèse legacy minimale (cache) : la fenêtre s'ouvre sans réseau sur l'onglet Synthèse. */
const legacy = [OR, SP].flatMap((nom) =>
  ["2026-10-20", "2026-10-27"].map((d, i) => ({
    market_and_exchange_names: nom,
    report_date_as_yyyy_mm_dd: `${d}T00:00:00.000`,
    noncomm_positions_long_all: i ? "217028" : "211127",
    noncomm_positions_short_all: i ? "35689" : "30907",
    open_interest_all: "352167",
  })),
);

async function servirCftc(page: Page, appels: string[]) {
  await page.route("**/publicreporting.cftc.gov/**", async (route: Route) => {
    const url = new URL(route.request().url());
    appels.push(url.pathname + url.search);
    const where = url.searchParams.get("$where") ?? "";
    const lignes = url.pathname.includes("gpe5-46if") && where.includes(SP) ? tff
      : url.pathname.includes("72hh-3qpy") && where.includes(OR) ? disagg : [];
    // Découverte : dernières lignes complètes ; historique : colonnes sélectionnées seulement.
    const select = url.searchParams.get("$select");
    const corps = select === null
      ? [...lignes].reverse().slice(0, 4)
      : lignes.map((l) => Object.fromEntries(select.split(",").filter((c) => c in l).map((c) => [c, l[c as keyof typeof l]])));
    await route.fulfill({ json: corps });
  });
}

async function ouvrirCot(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("combobox", { name: "Rechercher une paire" })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder(/^Commande/).fill("COT");
  await page.keyboard.press("Enter");
  const fenetre = page.locator('[data-window-id="cot"]');
  await expect(fenetre).toBeVisible();
  return fenetre;
}

/** Nombre de pixels peints du canvas (le graphe n'est pas vide). */
async function pixelsPeints(page: Page) {
  return page.locator('[data-window-id="cot"] canvas').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) n++;
    return n;
  });
}

for (const largeur of [1280, 390]) {
  test(`COT graphique : exposition par catégorie, cache hebdomadaire, largeur ${largeur}`, async ({ page }) => {
    await page.setViewportSize({ width: largeur, height: 900 });
    await page.clock.setFixedTime(MAINTENANT);
    await bouchonnerReseau(page);
    const appels: string[] = [];
    await servirCftc(page, appels);
    await page.addInitScript((records) => {
      localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
      localStorage.setItem("axiom:cot:cache:v2:legacy", JSON.stringify({ ts: Date.now(), records }));
    }, legacy);

    const fenetre = await ouvrirCot(page);
    await fenetre.getByRole("button", { name: "Graphique", exact: true }).click();
    const region = fenetre.getByRole("region", { name: "Graphique COT", exact: true });
    await expect(region.getByLabel("Marché")).toHaveValue(SP);

    const tableau = region.getByRole("table", { name: "Exposition par catégorie au dernier rapport" });
    await expect(tableau).toContainText("Exposition au 27 oct. 2026");
    for (const cat of ["Dealers / intermédiaires", "Gérants d'actifs / institutionnels", "Fonds à effet de levier", "Autres déclarants", "Non déclarants"]) {
      await expect(tableau.getByRole("rowheader", { name: cat })).toBeVisible();
    }
    await expect(region).toContainText("la somme des nets de toutes les catégories vaut 0 sur les 160 rapports");
    await expect(region).toContainText(/prochain rapport ven\. 6 nov\. vers 15 h 30 \(New York\)/);
    // Une découverte sans $select puis l'historique avec les seules colonnes vues.
    expect(appels).toHaveLength(2);
    expect(appels[0]).not.toContain("%24select");
    expect(decodeURIComponent(appels[1]!)).toContain("$select=market_and_exchange_names,report_date_as_yyyy_mm_dd,open_interest_all,dealer_positions_long_all");

    const canvas = region.locator("canvas");
    await expect(canvas).toBeVisible();
    await expect.poll(() => pixelsPeints(page)).toBeGreaterThan(2000);

    // Survol : infobulle datée avec chaque catégorie.
    const boite = (await canvas.boundingBox())!;
    await page.mouse.move(boite.x + boite.width * 0.6, boite.y + boite.height * 0.3);
    await expect(region).toContainText(/Positions du \d+ \S+ 202\d/);
    await fenetre.screenshot({ path: test.info().outputPath(`cot-graphique-survol-${largeur}.png`) });

    // Légende cliquable : masquer une catégorie.
    const levier = tableau.getByRole("button", { name: "Fonds à effet de levier" });
    await levier.click();
    await expect(levier).toHaveAttribute("aria-pressed", "false");
    await levier.click();
    await expect(levier).toHaveAttribute("aria-pressed", "true");

    // Unité et période.
    await region.getByRole("group", { name: "Unité" }).getByRole("button", { name: "% OI" }).click();
    await expect(region.getByRole("group", { name: "Unité" }).getByRole("button", { name: "% OI" })).toHaveAttribute("aria-pressed", "true");
    await region.getByRole("group", { name: "Période" }).getByRole("button", { name: "Tout" }).click();
    await expect(region.getByRole("group", { name: "Période" }).getByRole("button", { name: "Tout" })).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => pixelsPeints(page)).toBeGreaterThan(2000);

    // Rien ne déborde horizontalement de la fenêtre (le tableau défile dans son propre cadre).
    expect(await region.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await fenetre.screenshot({ path: test.info().outputPath(`cot-graphique-${largeur}.png`) });

    // Matières premières : rapport Disaggregated, graphie réelle des colonnes swap résolue.
    await region.getByLabel("Marché").selectOption(OR);
    await expect(tableau).toContainText("Managed Money");
    await expect(tableau.getByRole("rowheader", { name: "Swap dealers" })).toBeVisible();
    await expect(region).toContainText("Disaggregated");
    await expect(region).toContainText("vaut 0 sur les 160 rapports");
    expect(appels).toHaveLength(4);

    // Retour à la synthèse, puis accès direct au graphique depuis la ligne d'un marché.
    await fenetre.getByRole("button", { name: "Synthèse", exact: true }).click();
    await fenetre.getByRole("article", { name: "S&P 500 (E-mini)", exact: true }).getByRole("button", { name: "Graphique ›" }).click();
    await expect(region.getByLabel("Marché")).toHaveValue(SP);
    expect(appels).toHaveLength(4); // déjà en mémoire

    // Rechargement : le cache local sert la semaine en cours, aucun nouvel appel CFTC.
    await page.reload();
    const fenetre2 = page.locator('[data-window-id="cot"]');
    const deja = await fenetre2.isVisible();
    const f = deja ? fenetre2 : await ouvrirCot(page);
    await f.getByRole("button", { name: "Graphique", exact: true }).click();
    await expect(f.getByRole("table", { name: "Exposition par catégorie au dernier rapport" })).toContainText("Exposition au 27 oct. 2026");
    expect(appels).toHaveLength(4);
  });
}
