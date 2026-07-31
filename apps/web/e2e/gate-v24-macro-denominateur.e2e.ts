import { test, expect } from "@playwright/test";

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

test("la commande MACRO du Launchpad ouvre l'onglet Macro (palette refermée)", async ({ page }) => {
  await page.goto("/");
  // Attendre le montage AVANT la frappe : l'écouteur ⌘K est posé par un effet React,
  // une pression trop précoce se perd (constaté — le test échouait à ce point).
  await expect(page.getByRole("button", { name: /^Indicateurs/ })).toBeVisible();
  // ⌘K : le registre prouve en unitaire que l'action mute le store ; SEUL le navigateur
  // prouve que la palette se referme et ne recouvre pas le panneau ouvert.
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder(/^Commande/).fill("MACRO");
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
  await page.getByRole("button", { name: "÷SOL" }).click();
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

  // Basculer la source sur TradFi (le symbole retombe sur SPY), puis preset GLD.
  await page.getByLabel("Source").selectOption("twelvedata");
  await page.getByRole("button", { name: "GLD", exact: true }).click();

  // Lot D : le bouton ÷BTC apparaît sur un symbole tradfi (composition cross-source).
  const boutonBtc = page.getByRole("button", { name: "÷BTC" });
  await expect(boutonBtc).toBeVisible();
  await boutonBtc.click();

  // Le bandeau affiche le label du SYN cross-source : GLD ÷ réf canonique Binance.
  await expect(page.getByText("GLD / BTCUSDT")).toBeVisible({ timeout: 15_000 });

  // Détoggle : retour à la jambe A (GLD sur TradFi), le bouton reste proposé.
  await boutonBtc.click();
  await expect(page.getByText("GLD / BTCUSDT")).toHaveCount(0);
  await expect(page.getByLabel("Source")).toHaveValue("twelvedata");
  await expect(boutonBtc).toBeVisible();
});
