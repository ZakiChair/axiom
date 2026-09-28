import { expect, test } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

const JOUR = 86_400_000;
const FIN = Date.UTC(2026, 8, 23);
const CHAINES = ["Ethereum", "Solana", "Base", "Arbitrum"];

test("CHAIN garde les quatre chaînes et montre une variation de part distincte du prix", async ({ page }) => {
  await bouchonnerReseau(page);
  await page.clock.setFixedTime(new Date("2026-09-24T12:00:00Z"));
  await page.addInitScript(() => localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 })));
  await page.route("**/api.llama.fi/v2/historicalChainTvl/*", async (route) => {
    const chaine = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1) ?? "");
    const values = Array.from({ length: 31 }, (_, i) => ({ date: Math.floor((FIN - (30 - i) * JOUR) / 1000), tvl: chaine === "Ethereum" && i === 30 ? 200 : 100 }));
    await route.fulfill({ json: CHAINES.includes(chaine) ? values : [] });
  });
  await page.route("**/api.llama.fi/overview/**", (route) => route.fulfill({ json: { totalDataChart: [] } }));
  await page.route("**/stablecoins.llama.fi/stablecoincharts/**", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder(/^Commande/).fill("CHAIN");
  await page.keyboard.press("Enter");
  const chain = page.getByRole("complementary", { name: "On-chain", exact: true });
  await chain.getByRole("button", { name: /Rotation historique · cohorte fixe/ }).click();
  const rotation = chain.getByRole("region", { name: "Rotation historique des chaînes" });
  await expect(rotation).toContainText("Ethereum / Solana / Base / Arbitrum");
  await expect(rotation).toContainText("25,00 → 40,00 %");
  await expect(rotation).toContainText("+15,00 pp");
  await expect(rotation).toContainText("Base : aucun token natif");
  await chain.getByRole("button", { name: /Rotation historique · cohorte fixe/ }).click();
  const acquises = await page.evaluate(async () => (await import("/src/store/analyseMultidomaine.ts")).lireLectures(Date.now()).filter((l) => l.domaine === "rotation"));
  expect(acquises).toHaveLength(4);
});

test("CHAIN ne renormalise jamais une cohorte 3/4", async ({ page }) => {
  await bouchonnerReseau(page);
  await page.clock.setFixedTime(new Date("2026-09-24T12:00:00Z"));
  await page.addInitScript(() => localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 })));
  await page.route("**/api.llama.fi/v2/historicalChainTvl/*", (route) => {
    const chaine = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1) ?? "");
    const values = Array.from({ length: 31 }, (_, i) => ({ date: Math.floor((FIN - (30 - i) * JOUR) / 1000), tvl: 100 }));
    return route.fulfill({ json: chaine === "Base" ? [] : values });
  });
  await page.route("**/api.llama.fi/overview/**", (route) => route.fulfill({ json: { totalDataChart: [] } }));
  await page.route("**/stablecoins.llama.fi/stablecoincharts/**", (route) => route.fulfill({ json: [] }));
  let appelsPrix = 0;
  await page.route("**/api.binance.com/api/v3/klines*", (route) => {
    const symbol = new URL(route.request().url()).searchParams.get("symbol");
    if (["ETHUSDT", "SOLUSDT", "ARBUSDT"].includes(symbol ?? "")) appelsPrix += 1;
    return route.fulfill({ json: [] });
  });
  await page.goto("/");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder(/^Commande/).fill("CHAIN");
  await page.keyboard.press("Enter");
  const chain = page.getByRole("complementary", { name: "On-chain", exact: true });
  await chain.getByRole("button", { name: /Rotation historique · cohorte fixe/ }).click();
  const rotation = chain.getByRole("region", { name: "Rotation historique des chaînes" });
  await expect(rotation).toContainText("couverture 3/4");
  await expect(rotation).toContainText("Part non calculable");
  await expect(rotation).not.toContainText("33,33 →");
  await expect(rotation).not.toContainText("chargement…");
  expect(appelsPrix).toBe(0);
});

test("GLOBE qualifie un événement sourcé et laisse les expositions inconnues", async ({ page }) => {
  await bouchonnerReseau(page);
  await page.addInitScript(() => localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 })));
  await page.goto("/");
  await page.evaluate(async (fin) => {
    const React = await import("/node_modules/.vite/deps/react.js");
    const ReactDOM = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { GlobeDetailPanel } = await import("/src/components/GlobeDetailPanel.tsx");
    const { watchlistStore } = await import("/src/store/watchlist.ts");
    watchlistStore.getState().setAll(["USO", "SPY"], { USO: "twelvedata", SPY: "twelvedata" });
    const cellule = { lat: 30, lon: 50, categorie: "materiel" as const, n: 1, intensite: 9, mentions: 5, dernierMs: fin };
    const evenement = { dateMs: fin, categorie: "materiel" as const, codeCameo: "190", goldstein: -9, mentions: 5, acteur1: "A", acteur2: "B", url: "https://example.org/article" };
    const conteneur = document.createElement("div");
    conteneur.style.cssText = "position:fixed;inset:0;z-index:9999;background:#111";
    document.body.appendChild(conteneur);
    ReactDOM.default.createRoot(conteneur).render(React.default.createElement(GlobeDetailPanel, { selection: { type: "evenement", lat: 30, lon: 50, cellule }, evenements: [evenement], ingereLe: fin + 86_400_000, onFermer: () => {} }));
  }, FIN);
  await page.getByRole("button", { name: "Analyser transmission" }).click();
  const panel = page.getByRole("region", { name: "Transmission géopolitique" });
  await expect(panel).toContainText("occurrence et première publication non connues");
  await expect(panel.getByRole("link", { name: "Fondement documentaire" })).toHaveAttribute("href", "https://www.eia.gov/international/content/analysis/special_topics/World_Oil_Transit_Chokepoints/");
  await panel.getByRole("textbox", { name: "Hypothèse conditionnelle" }).fill("Si le transit pétrolier est interrompu ; invalidé si le trafic reprend.");
  await expect(panel).toContainText("USO · twelvedata");
  await expect(panel).toContainText("Exposition non établie : SPY");
  await panel.getByRole("button", { name: "Publier au brief" }).click();
  await expect(panel).toContainText("Scénario conditionnel acquis");
  const lectures = await page.evaluate(async () => (await import("/src/store/analyseMultidomaine.ts")).lireLectures(Date.now()).filter((l) => l.domaine === "geo"));
  expect(lectures).toHaveLength(1);
  expect(lectures[0]).toMatchObject({ nature: "scenario-conditionnel", valeur: null, statut: "partiel" });
  await panel.getByRole("button", { name: "Voir au graphique" }).click();
  const market = await page.evaluate(async () => (await import("/src/store/market.ts")).marketStore.getState());
  expect(market).toMatchObject({ exchange: "twelvedata", symbol: "USO" });
});
