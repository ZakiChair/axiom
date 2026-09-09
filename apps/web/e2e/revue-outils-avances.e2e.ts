import { expect, test, type Page } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

const INSTANT_FIXE = Date.parse("2026-09-10T00:00:00Z");
const HEURE = 3_600_000;

async function commande(page: Page, texte: string): Promise<void> {
  await expect(page.getByRole("banner").getByRole("button", { name: /^Indicateurs/ })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder(/^Commande/).fill(texte);
  await page.keyboard.press("Enter");
}

test.beforeEach(async ({ page }) => {
  await bouchonnerReseau(page);
  await page.addInitScript(() => {
    localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
    localStorage.removeItem("axiom.defillama.proApiKey");
  });
});

test("DefiLlama Pro sans clé conserve l'accès honnête et importe un calendrier sourcé", async ({ page }) => {
  let appelsPro = 0;
  page.on("request", (requete) => {
    if (requete.url().includes("/defillamapro/")) appelsPro += 1;
  });

  await page.goto("/");
  await commande(page, "CAP");
  const fenetre = page.getByRole("complementary", { name: "Capitalisation & dominance" });
  await fenetre.getByRole("button", { name: "Unlocks / bridges" }).click();
  const panneau = fenetre
    .getByRole("button", { name: "Unlocks", exact: true })
    .locator("xpath=ancestor::section[1]");

  await expect(panneau.getByRole("button", { name: "Charger" })).toBeDisabled();
  await expect(panneau.getByText("indisponible", { exact: true })).toBeVisible();
  await expect(panneau).toContainText("clé personnelle DefiLlama Pro requise, ou importez un calendrier sourcé");

  const dateUnlock = Date.parse("2026-10-15T08:00:00Z");
  const observation = Date.parse("2026-09-09T12:00:00Z");
  const calendrier = {
    version: 1,
    source: "Calendrier sourcé E2E",
    sourcesValidees: true,
    exporteLe: INSTANT_FIXE,
    tokens: [{
      id: "fixture-token",
      nom: "Fixture Token",
      offreCirculante: 1_000_000,
      flottantAjuste: 800_000,
      sources: ["https://example.test/tokenomics"],
      events: [{
        date: dateUnlock,
        quantite: 50_000,
        type: "lineaire",
        categorie: "équipe",
        description: "Vesting documenté",
      }],
      prochaineDate: dateUnlock,
      prochaineQuantite: 50_000,
      capitalisationUsd: null,
      denominateurs: {
        prixUsd: {
          valeur: 2,
          source: "CoinGecko /coins/markets (contexte actuel)",
          observeLe: observation,
        },
        volume24hUsd: {
          valeur: 1_000_000,
          source: "CoinGecko /coins/markets (contexte actuel)",
          observeLe: observation,
        },
        flottantAjuste: {
          valeur: 800_000,
          source: "https://example.test/float-methodology",
          observeLe: observation,
        },
      },
    }],
  };
  await panneau.locator('input[type="file"]').setInputFiles({
    name: "unlocks-sources-e2e.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(calendrier)),
  });

  const table = panneau.getByRole("table", { name: "Calendrier des prochains unlocks" });
  const ligne = table.getByRole("row").filter({ hasText: "Fixture Token" });
  await expect(ligne).toContainText("15/10/2026 UTC");
  await expect(ligne).toContainText("50000 tokens");
  await expect(ligne).toContainText("6.25 %");
  await expect(ligne).toContainText("10.00 %");
  await expect(ligne.getByText("linéaire", { exact: true })).toBeVisible();
  await expect(ligne.getByRole("link", { name: "source", exact: true })).toHaveAttribute(
    "href",
    "https://example.test/tokenomics",
  );
  await expect(ligne.getByRole("link", { name: "source flottant" })).toHaveAttribute(
    "href",
    "https://example.test/float-methodology",
  );
  await expect(panneau.getByText("partiel", { exact: true })).toBeVisible();
  await expect(panneau).toContainText("Import calendrier (schéma validé) + sources incluses");
  await expect(panneau).toContainText("observé —");
  expect(appelsPro).toBe(0);
});

test("OMON rend les trois hypothèses gamma sur la même chaîne Deribit", async ({ page }) => {
  const resumeOptions = [
    ["BTC-26DEC27-80000-C", 56, 8],
    ["BTC-26DEC27-100000-C", 54, 12],
    ["BTC-26DEC27-100000-P", 55, 9],
    ["BTC-26DEC27-120000-P", 58, 14],
  ].map(([instrument_name, mark_iv, open_interest]) => ({
    instrument_name,
    mark_iv,
    open_interest,
    underlying_price: 100_000,
    interest_rate: 0,
    volume: 2,
    mark_price: 0.05,
  }));
  await page.route("https://www.deribit.com/api/v2/public/**", async (route) => {
    const url = new URL(route.request().url());
    const methode = url.pathname.split("/").at(-1);
    if (methode === "get_book_summary_by_currency" && url.searchParams.get("kind") === "option") {
      await route.fulfill({ json: { jsonrpc: "2.0", result: resumeOptions } });
      return;
    }
    if (methode === "get_volatility_index_data") {
      await route.fulfill({ json: { jsonrpc: "2.0", result: { data: [[INSTANT_FIXE, 50, 55, 48, 52]] } } });
      return;
    }
    await route.fulfill({ status: 503, json: { error: "fixture Deribit non prévue" } });
  });

  await page.goto("/");
  await commande(page, "OMON");
  const fenetre = page.getByRole("complementary", { name: "Options (smile IV, max pain)" });
  await fenetre.getByRole("button", { name: "GEX/DEX", exact: true }).click();

  await expect(fenetre.getByText("Sensibilité au signe gamma", { exact: true })).toBeVisible();
  const sensibilite = fenetre.locator("div").filter({ hasText: /^Sensibilité au signe gamma/ }).last();
  for (const libelle of ["Calls + / puts −", "Tous long gamma", "Tous short gamma"]) {
    const scenario = fenetre.locator("div.rounded").filter({ hasText: libelle }).first();
    await expect(scenario.getByText(libelle, { exact: true })).toBeVisible();
    await expect(scenario).toContainText(/GEX (?:−)?\$/);
    await expect(scenario).toContainText("verdict ");
  }
  await expect(sensibilite).toContainText("mêmes contrats · spot · horloge");
  await expect(fenetre).toContainText("Scénarios de convention, pas des positions dealer observées");
  await expect(fenetre).toContainText("les variantes tous-long/tous-short sont des hypothèses");
});

test("WHALES expose provenance datée, couverture inconnue et direction interne", async ({ page }) => {
  await page.route("http://127.0.0.1:8787/health", (route) => route.fulfill({
    json: {
      ok: true,
      service: "axiomd",
      apiVersion: 1,
      version: "e2e",
      capabilities: ["kv", "candles", "liquidations", "alerts", "replay", "globe", "hl", "snapshots", "proxy", "whales"],
    },
  }));
  await page.route("http://127.0.0.1:8787/whales/recent**", (route) => route.fulfill({
    json: {
      mouvements: [{
        id: "interne-coinbase",
        t: Date.parse("2026-09-09T23:45:00Z"),
        chain: "btc",
        asset: "BTC",
        qty: 25,
        usd: 2_500_000,
        de: "bc1qcoinbasecustody0000",
        vers: "bc1qcoinbaseprime000000",
        deLabel: "Coinbase Custody",
        versLabel: "Coinbase Prime",
        deAttribution: {
          entite: "Coinbase",
          source: "Dossier attribution Coinbase 2026",
          verifieLe: "2026-09-01",
          confiance: "forte",
        },
        versAttribution: {
          entite: "Coinbase",
          source: "Dossier attribution Coinbase 2026",
          verifieLe: "2026-09-01",
          confiance: "forte",
        },
        direction: "interne",
      }, {
        id: "inconnu-btc",
        t: Date.parse("2026-09-09T23:40:00Z"),
        chain: "btc",
        asset: "BTC",
        qty: 15,
        usd: 1_500_000,
        de: "bc1qunknownsource000000",
        vers: "bc1qunknowndestination00",
        deLabel: null,
        versLabel: null,
        deAttribution: null,
        versAttribution: null,
        direction: "inconnu",
      }],
      sante: {
        dernierPollBtcTs: Date.parse("2026-09-09T23:50:00Z"),
        dernierBlocBtc: 912345,
        erreurBtc: null,
        prixBtc: 100_000,
        prixBtcTs: Date.parse("2026-09-09T23:50:00Z"),
        dernierPollEthTs: 0,
        dernierBlocEth: null,
        erreurEth: null,
        clePresente: false,
      },
      continuite: {
        btc: {
          curseur: 912345,
          dernierSucces: Date.parse("2026-09-09T23:50:00Z"),
          trous: [{ de: 912300, a: 912301, raison: "fixture trou borné" }],
          finalite: "6 confirmations ; reorg profond non rattrapé automatiquement",
        },
        eth: {
          curseur: null,
          dernierSucces: null,
          trous: [],
          finalite: "finalité Etherscan",
        },
      },
    },
  }));

  await page.goto("/");
  await commande(page, "WHALES");
  const fenetre = page.getByRole("complementary", { name: "Mouvements de baleines" });
  const interne = fenetre.getByRole("listitem").filter({ hasText: "Coinbase Custody" });
  await expect(interne).toContainText("Coinbase Custody → Coinbase Prime");
  await expect(interne.getByText("interne", { exact: true })).toBeVisible();
  await expect(interne.locator('[title*="Dossier attribution Coinbase 2026"]')).toHaveAttribute(
    "title",
    /vérifié le 2026-09-01/,
  );

  const inconnu = fenetre.getByRole("listitem").filter({ hasText: "bc1qu" });
  await expect(inconnu.getByText("—", { exact: true })).toBeVisible();
  await expect(inconnu.locator('[title*="attribution inconnue"]')).toHaveAttribute(
    "title",
    /vérifié le inconnu/,
  );
  await expect(fenetre.getByText("attribués 1", { exact: true })).toBeVisible();
  await expect(fenetre.getByText("inconnus 1", { exact: true })).toBeVisible();
  await expect(fenetre).toContainText("Couverture exhaustive inconnue");
  await expect(fenetre).toContainText("trous 1");
  await expect(fenetre).toContainText("reorg profond non rattrapé automatiquement");
  await expect(fenetre).toContainText("Interne seulement si les deux extrémités ont la même entité connue");
});

function bougiesBinance(url: URL, nombre = 240): unknown[][] {
  const intervalle = url.searchParams.get("interval") === "4h" ? 4 * HEURE : HEURE;
  const finDemandee = Number(url.searchParams.get("endTime"));
  const fin = Number.isFinite(finDemandee) ? finDemandee : INSTANT_FIXE - 1;
  const dernierOpen = Math.floor((fin - intervalle) / intervalle) * intervalle;
  return Array.from({ length: nombre }, (_, i) => {
    const temps = dernierOpen - (nombre - 1 - i) * intervalle;
    const close = 100 + 24 * Math.sin((i * Math.PI) / 4);
    const open = 100 + 24 * Math.sin(((i - 1) * Math.PI) / 4);
    const high = Math.max(open, close) + 2;
    const low = Math.min(open, close) - 2;
    return [
      temps,
      open.toFixed(4),
      high.toFixed(4),
      low.toFixed(4),
      close.toFixed(4),
      "100",
      temps + intervalle - 1,
      "10000",
      50,
      "55",
      "5500",
      "0",
    ];
  });
}

test("Backtest distingue bootstrap, spot sans funding et absence du funding réel", async ({ page }) => {
  await page.clock.install({ time: INSTANT_FIXE });
  await page.route("**/api.binance.com/api/v3/klines*", (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: bougiesBinance(url) });
  });
  await page.route("**/extapi/fapi.binance.com/fapi/v1/klines*", (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: bougiesBinance(url, 80) });
  });
  await page.route("**/extapi/fapi.binance.com/fapi/v1/fundingRate*", (route) => route.fulfill({
    status: 503,
    json: { error: "funding absent de la fixture" },
  }));

  await page.goto("/");
  await commande(page, "BT");
  const fenetre = page.getByRole("complementary", { name: "Backtest" });
  const funding = fenetre.getByLabel("Modèle de funding");
  await expect(funding).toHaveValue("aucun");
  await expect(fenetre.getByRole("button", { name: "MACD + direction Supertrend (non validé)" })).toBeVisible();
  await fenetre.getByRole("button", { name: "Croisement EMA 9/21" }).click();

  await fenetre.getByRole("button", { name: "Lancer le backtest" }).click();
  await expect(fenetre.getByText("Terminé", { exact: true })).toBeVisible();
  await expect(fenetre).not.toContainText("Funding signé séparé des commissions");

  const modeMonteCarlo = fenetre.getByLabel("Mode Monte-Carlo");
  await expect(modeMonteCarlo).toHaveValue("blocs");
  await expect(fenetre.getByLabel("Longueur des blocs Monte-Carlo")).toBeVisible();
  const lancerMonteCarlo = fenetre.getByRole("button", { name: "Monte-Carlo (500)" });
  await expect(lancerMonteCarlo).toBeEnabled();
  await lancerMonteCarlo.click();
  await expect(fenetre.getByRole("img", { name: "Cône Monte-Carlo des percentiles d'équité par numéro de trade" })).toBeVisible();
  await expect(fenetre.getByText("P(chemin ≤ 0)", { exact: true })).toBeVisible();
  await expect(fenetre.getByText("P(final < 0)", { exact: true })).toBeVisible();
  await modeMonteCarlo.selectOption("iid");
  await expect(fenetre.getByLabel("Longueur des blocs Monte-Carlo")).toHaveCount(0);

  await funding.selectOption("binance-reel");
  await expect(fenetre).toContainText("Le calcul s'arrête au dernier mois clos");
  await fenetre.getByRole("button", { name: "Lancer le backtest" }).click();
  await expect(fenetre).toContainText("Funding historique indisponible : Funding Binance indisponible (503).");
  await expect(fenetre).not.toContainText("Couverture vérifiée sur");
});
