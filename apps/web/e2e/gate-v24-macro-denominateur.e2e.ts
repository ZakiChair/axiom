import { test, expect } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

/**
 * Gate e2e du lot v2.4 — onglet « Macro » du menu Indicateurs + bouton de dénominateur.
 *
 * POURQUOI ICI et pas en unitaire : `apps/web` tourne en env vitest NODE (pas de jsdom,
 * et aucune dépendance de rendu ne peut être ajoutée — BUILD-CONTRACT). Le comportement
 * d'onglet et de bouton n'est donc vérifiable QUE dans un vrai navigateur.
 *
 * STRUCTUREL, sans donnée de marché live : les libellés testés (bandeau de ratio,
 * onglets, cases macro) sont dérivés du SYMBOLE et des stores, pas des WS/REST exchange
 * — la suite passe hors ligne.
 *
 * Étendu au lot D (ratios cross-source) : le test tradfi bouchonne /tdapi (patron du
 * gate v2.5 : page.route + fixtures minimales) pour que la jambe GLD ne consomme ni
 * quota Twelve Data ni réseau réel.
 */
test.beforeEach(async ({ page }) => {
  await bouchonnerReseau(page);
  await page.route("**/api.binance.com/api/v3/exchangeInfo*", (route) => route.fulfill({
    json: { symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT"].map((symbol) => ({ symbol, status: "TRADING" })) },
  }));
  // Les deux jambes d'un ratio couvrent exactement les mêmes jours : ce parcours
  // doit charger un véritable historique SYN avant de tester le détoggle.
  await page.route("**/api.binance.com/api/v3/klines*", (route) => route.fulfill({
    json: [28, 29, 30].map((day) => {
      const t = Date.UTC(2026, 6, day);
      return [t, "60000", "60100", "59900", "60050", "100", t + 86_400_000 - 1, "1000", 4, "50", "500", "0"];
    }),
  }));
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "axiom:onboarding:v1",
      JSON.stringify({ completed: true, step: 0 }),
    );
  });
});

test("les mesures macro ont quitté la sidebar pour l'onglet Macro du menu Indicateurs", async ({
  page,
}) => {
  await page.goto("/");

  // La sidebar n'expose plus la section « Masse monétaire ». Assertion SCOPÉE à <aside> :
  // le libellé subsiste ailleurs (aide de la clé FRED dans les Réglages, commande MACRO).
  await expect(page.locator("aside").getByText("Masse monétaire")).toHaveCount(0);

  await page.getByRole("button", { name: /^Indicateurs/ }).click();
  // Onglet « Techniques » actif par défaut : le catalogue est là, pas les mesures macro.
  await expect(page.getByPlaceholder(/CVD, RVOL/)).toBeVisible();
  await expect(page.getByText("Cap. totale crypto")).toHaveCount(0);

  await page.getByRole("button", { name: /^Macro/ }).click();
  await expect(page.getByText("Cap. totale crypto")).toBeVisible();
  await expect(page.getByText("Stablecoins (supply)")).toBeVisible();
  await expect(page.getByText("M2 (US · FRED)")).toBeVisible();
  // Onglet inactif DÉMONTÉ (pas seulement masqué) : le champ de recherche a disparu.
  await expect(page.getByPlaceholder(/CVD, RVOL/)).toHaveCount(0);
});

test("cocher une mesure macro met à jour le compteur de l'onglet", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^Indicateurs/ }).click();
  await page.getByRole("button", { name: /^Macro/ }).click();

  // Le <label> enveloppe sa case : cliquer le libellé bascule la case.
  await page.getByText("Cap. totale crypto").click();
  await expect(page.getByRole("button", { name: "Macro 1" })).toBeVisible();
});

test("la commande MONEY du Launchpad ouvre l'onglet Macro (palette refermée)", async ({ page }) => {
  await page.goto("/");
  // Attendre le montage AVANT la frappe : l'écouteur ⌘K est posé par un effet React,
  // une pression trop précoce se perd (constaté — le test échouait à ce point).
  await expect(page.getByRole("button", { name: /^Indicateurs/ })).toBeVisible();
  // ⌘K : le registre prouve en unitaire que l'action mute le store ; SEUL le navigateur
  // prouve que la palette se referme et ne recouvre pas le panneau ouvert.
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder(/^Commande/).fill("MONEY");
  await page.keyboard.press("Enter");

  await expect(page.getByPlaceholder(/^Commande/)).toHaveCount(0);
  await expect(page.getByText("Cap. totale crypto")).toBeVisible();
});

test("bandeau : ÷BTC absent sur BTCUSDT, ÷ETH pose le ratio et le menu bascule sur ÷SOL", async ({
  page,
}) => {
  await page.goto("/");

  // Marché par défaut BTCUSDT : ÷BTC n'a pas de sens (base déjà BTC) → bouton absent.
  await expect(page.getByRole("button", { name: "÷BTC" })).toHaveCount(0);

  // Le bouton scindé propose ETH (préférence par défaut) et pose le ratio SYN.
  await page.getByRole("button", { name: "÷ETH" }).click();
  await expect(page.getByText("BTCUSDT / ETHUSDT")).toBeVisible({ timeout: 15_000 });

  // Depuis un ratio ACTIF, le menu recompose depuis la jambe A (pas depuis le SYN).
  await page.getByRole("button", { name: "Choisir l'actif de comparaison" }).click();
  await page.getByRole("menuitem", { name: "÷SOL" }).click();
  await expect(page.getByText("BTCUSDT / SOLUSDT")).toBeVisible({ timeout: 15_000 });

  // ÷SOL est maintenant le ratio actif : un clic dessus détoggle vers la jambe A.
  await page.getByRole("button", { name: "÷SOL" }).click();
  await expect(page.getByText("BTCUSDT / SOLUSDT")).toHaveCount(0);
});

// ───────── Lot D — ratio cross-source tradfi ÷ crypto (réf canonique Binance) ─────────

/** Bougies journalières minimales de la jambe GLD (forme time_series Twelve Data). */
const SERIE_TD = {
  status: "ok",
  values: [
    { datetime: "2026-07-28", open: "180", high: "182", low: "179", close: "181", volume: "1000" },
    { datetime: "2026-07-29", open: "181", high: "184", low: "180", close: "183", volume: "1100" },
    { datetime: "2026-07-30", open: "183", high: "186", low: "182", close: "185", volume: "1200" },
  ],
};

/** Forme À PLAT d'un /quote mono-symbole (cf. parseQuotes, data/twelvedata.ts). */
const QUOTE_TD = { symbol: "GLD", close: "185.0", percent_change: "0.42" };

/** Intercepte les deux endpoints /tdapi utilisés (graphe + ticker) — zéro quota. */
async function bouchonnerTwelveData(page: import("@playwright/test").Page): Promise<void> {
  await page.route("**/tdapi/time_series*", (route) => route.fulfill({ json: SERIE_TD }));
  await page.route("**/tdapi/quote*", (route) => route.fulfill({ json: QUOTE_TD }));
}

test("bandeau tradfi : ÷BTC apparaît sur GLD, pose le SYN cross-source, détoggle → retour GLD", async ({
  page,
}) => {
  await bouchonnerTwelveData(page);
  await page.goto("/");

  // L’actif GLD suffit : le fournisseur est choisi automatiquement.
  await page.getByRole("button", { name: "GLD", exact: true }).click();

  // Lot D : le bouton ÷BTC apparaît sur un symbole tradfi (composition cross-source).
  const boutonBtc = page.getByRole("button", { name: "÷BTC" });
  await expect(boutonBtc).toBeVisible();
  await boutonBtc.click();

  // Le bandeau affiche le label du SYN cross-source : GLD ÷ réf canonique Binance.
  await expect(page.getByText("GLD / BTCUSDT")).toBeVisible({ timeout: 15_000 });

  await expect(page.locator("[data-chart-status]")).toHaveCount(0);

  // Détoggle : retour à la jambe A (GLD sur TradFi), le bouton reste proposé.
  await boutonBtc.click();
  await expect(page.getByText("GLD / BTCUSDT")).toHaveCount(0);
  await expect(page.getByLabel("Source automatique", { exact: true })).toContainText("Twelve Data");
  await expect(boutonBtc).toBeVisible();
});

// ───────── Demande du 26/09/2026 — dénominateurs marchés et devises (jambe Twelve Data) ─────────

test("bandeau : BTCUSDT ÷Or puis en CHF, jambe Twelve Data demandée, détoggle vers BTCUSDT", async ({
  page,
}) => {
  const demandes: string[] = [];
  await page.route("**/tdapi/time_series*", (route) => {
    demandes.push(new URL(route.request().url()).searchParams.get("symbol") ?? "");
    return route.fulfill({ json: SERIE_TD });
  });
  await page.route("**/tdapi/quote*", (route) => route.fulfill({ json: QUOTE_TD }));
  await page.goto("/");

  // Menu groupé : les marchés et les devises s'ajoutent à ETH et SOL.
  await page.getByRole("button", { name: "Choisir l'actif de comparaison" }).click();
  await expect(page.getByRole("group", { name: "Crypto" }).getByRole("menuitem", { name: "÷SOL" })).toBeEnabled();
  await expect(page.getByRole("group", { name: "Marchés" }).getByRole("menuitem", { name: "÷S&P 500 (SPY)" })).toBeEnabled();
  await expect(page.getByRole("group", { name: "Devises" }).getByRole("menuitem", { name: "en JPY" })).toBeEnabled();
  await page.getByRole("group", { name: "Marchés" }).getByRole("menuitem", { name: "÷Or" }).click();
  await expect(page.getByText("BTCUSDT ÷Or", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => demandes).toContain("XAU/USD");

  // Depuis le ratio actif, la devise se recompose depuis la jambe A.
  await page.getByRole("button", { name: "Choisir l'actif de comparaison" }).click();
  await page.getByRole("group", { name: "Devises" }).getByRole("menuitem", { name: "en CHF" }).click();
  await expect(page.getByText("BTCUSDT en CHF", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => demandes).toContain("CHF/USD");
  await expect(page.locator("[data-chart-status]")).toHaveCount(0);

  // « en CHF » est le ratio actif : un clic le détoggle vers BTCUSDT.
  await page.getByRole("button", { name: "en CHF", exact: true }).click();
  await expect(page.getByText("BTCUSDT en CHF", { exact: true })).toHaveCount(0);
  await expect(page.getByText("BTCUSDT", { exact: true }).first()).toBeVisible();
});

test("bandeau : un actif non coté en dollar (BTCEUR) n'offre ni ÷Or ni devise", async ({ page }) => {
  await page.route("**/api.kraken.com/0/public/AssetPairs*", (route) => route.fulfill({
    json: { error: [], result: { XXBTZEUR: { altname: "XBTEUR", wsname: "XBT/EUR", base: "XXBT", quote: "ZEUR", status: "online" } } },
  }));
  await page.route("**/api.kraken.com/0/public/OHLC*", (route) => route.fulfill({
    json: { error: [], result: { XXBTZEUR: [28, 29, 30].map((day) => {
      const t = Date.UTC(2026, 6, day) / 1_000;
      return [t, "55000", "55100", "54900", "55050", "55000", "10", 5];
    }), last: 0 } },
  }));
  await page.addInitScript(() => {
    window.localStorage.setItem("axiom:chartState:v1", JSON.stringify({ exchange: "kraken", symbol: "BTCEUR", timeframe: "1d" }));
  });
  await page.goto("/");
  const menu = page.getByRole("button", { name: "Choisir l'actif de comparaison" });
  await expect(menu).toBeVisible({ timeout: 15_000 });
  await menu.click();
  await expect(page.getByRole("group", { name: "Marchés" }).getByRole("menuitem", { name: "÷Or" })).toBeDisabled();
  await expect(page.getByRole("group", { name: "Devises" }).getByRole("menuitem", { name: "en CHF" })).toBeDisabled();
});

test("menu des dénominateurs au clavier : ↓ parcourt le menu sans changer de paire, Échap le ferme", async ({ page }) => {
  await page.goto("/");
  const menu = page.getByRole("button", { name: "Choisir l'actif de comparaison" });
  await expect(menu).toHaveAttribute("aria-haspopup", "menu");
  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  // À l'ouverture, le focus entre dans le panneau, sur la première entrée active.
  await expect(page.getByRole("menuitem", { name: "÷ETH" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "÷SOL" })).toBeFocused();
  // La paire affichée n'a pas bougé : la flèche a servi au menu, pas à la watchlist.
  await expect(page.getByText("BTCUSDT", { exact: true }).first()).toBeVisible();
  const symbole = await page.evaluate(async () => {
    const importer = new Function("return import('/src/store/market.ts')") as () => Promise<{ marketStore: { getState: () => { symbol: string } } }>;
    return (await importer()).marketStore.getState().symbol;
  });
  expect(symbole).toBe("BTCUSDT");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeFocused();
});

test("menu ouvert à la souris, focus perdu (Safari/Firefox) : ↓ revient au menu sans changer de paire", async ({ page }) => {
  await page.goto("/");
  const symbole = () => page.evaluate(async () => {
    const importer = new Function("return import('/src/store/market.ts')") as () => Promise<{ marketStore: { getState: () => { symbol: string } } }>;
    return (await importer()).marketStore.getState().symbol;
  });
  await expect.poll(symbole).toBe("BTCUSDT");
  await page.getByRole("button", { name: "Choisir l'actif de comparaison" }).click();
  await page.keyboard.press("ArrowDown");
  expect(await symbole()).toBe("BTCUSDT");
  // Émule un clic qui ne donne pas le focus : la flèche part alors du document.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "÷ETH" })).toBeFocused();
  expect(await symbole()).toBe("BTCUSDT");
});

test("menu ouvert puis « / » : le champ de recherche garde le focus sur ↓, la paire ne change pas", async ({ page }) => {
  await page.goto("/");
  const symbole = () => page.evaluate(async () => {
    const importer = new Function("return import('/src/store/market.ts')") as () => Promise<{ marketStore: { getState: () => { symbol: string } } }>;
    return (await importer()).marketStore.getState().symbol;
  });
  await expect.poll(symbole).toBe("BTCUSDT");
  await page.getByRole("button", { name: "Choisir l'actif de comparaison" }).click();
  await expect(page.getByRole("menuitem", { name: "÷ETH" })).toBeFocused();
  await page.keyboard.press("/");
  const recherche = page.getByRole("combobox", { name: "Rechercher une paire", exact: true });
  await expect(recherche).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(recherche).toBeFocused();
  expect(await symbole()).toBe("BTCUSDT");
});
