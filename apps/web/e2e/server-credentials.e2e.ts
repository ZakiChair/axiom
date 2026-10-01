import { expect, test, type Page } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

/** Même build Vite que la CI ; seul le module de déploiement simule Vercel. */
async function preparer(page: Page, configured = true, onboardingCompleted = true) {
  await bouchonnerReseau(page);
  await page.route("**/src/lib/deployment.ts", route => route.fulfill({ contentType: "text/javascript", body: 'export const IS_VERCEL = true; export const isVercelDeployment = value => value === "vercel";' }));
  await page.route("**/api/config", route => route.fulfill(configured ? {
    json: { providers: Object.fromEntries(["fred", "coinalyze", "twelvedata", "sosovalue", "etherscan", "bgeometrics", "cryptoquant", "ccdata", "defillama", "finnhub", "coingecko"].map(id => [id, true])) },
  } : { status: 503, json: {} }));
  await page.addInitScript((completed) => localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed, step: completed ? 0 : 1 })), onboardingCompleted);
}

for (const edition of ["aucune", "brouillon", "champ focalisé"] as const) {
  test(`onboarding et configuration tardive : ${edition}, état serveur réactif sans perdre la saisie`, async ({ page }) => {
    await preparer(page, true, false);
    let liberer!: () => void;
    const reponseAutorisee = new Promise<void>((resolve) => { liberer = resolve; });
    await page.route("**/api/config", async (route) => {
      await reponseAutorisee;
      await route.fulfill({ json: { providers: { coinalyze: true } } });
    });
    await page.goto("/");
    const dialogue = page.getByRole("dialog", { name: "Clé Coinalyze (optionnel)" });
    await expect(dialogue).toBeVisible(); // Le rendu doit être libéré avant la réponse /api/config.
    const champ = dialogue.getByPlaceholder("Clé API Coinalyze (optionnel)");
    await expect(champ).toBeVisible();
    if (edition === "brouillon") await champ.fill("fixture-personnelle");
    if (edition === "champ focalisé") await champ.focus();
    liberer();
    await expect(dialogue.getByText("Clé serveur configurée — vous pouvez passer.", { exact: true })).toBeVisible();
    if (edition === "aucune") {
      await expect(champ).toHaveCount(0);
    } else {
      await expect(champ).toBeFocused();
      await expect(champ).toHaveValue(edition === "brouillon" ? "fixture-personnelle" : "");
      if (edition === "champ focalisé") await champ.fill("fixture-personnelle");
      expect(await page.evaluate(() => localStorage.getItem("axiom:coinalyze:key"))).toBeNull();
      await dialogue.getByRole("button", { name: "Enregistrer", exact: true }).click();
      expect(await page.evaluate(() => localStorage.getItem("axiom:coinalyze:key"))).toBe("fixture-personnelle");
      await expect(dialogue.getByText("Clé déjà configurée — vous pouvez passer.", { exact: true })).toBeVisible();
    }
  });
}

test("première ouverture sans clé locale : accès serveur, proxy et remplacement personnel", async ({ page }) => {
  await preparer(page);
  const requetes: { path: string; authorization?: string; defillama?: string }[] = [];
  await page.route(/\/(finnhubapi|ccdataapi|defillamapro|cqapi)\//, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    requetes.push({ path, authorization: request.headers().authorization, defillama: request.headers()["x-defillama-pro-key"] });
    await route.fulfill({ json: path.startsWith("/ccdataapi") ? { Data: [] } : path.startsWith("/cqapi") ? { status: { code: 200 }, result: { data: [] } } : [] });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Ouvrir les réglages" }).click();
  const settings = page.getByRole("dialog", { name: "Réglages", exact: true });
  await expect(settings.getByText("clé serveur ✓", { exact: true })).toHaveCount(11);
  const acces = await page.evaluate(async () => {
    const charger = (chemin: string) => import(chemin);
    const [fred, coinalyze, soso, ccdata, defillama, finnhub, cq] = await Promise.all([
      charger("/src/store/macro.ts"), charger("/src/store/coinalyze.ts"), charger("/src/data/onchain/etf.ts"),
      charger("/src/data/ccdataMcap.ts"), charger("/src/data/onchain/defillamaPro.ts"), charger("/src/data/fund/finnhub.ts"), charger("/src/data/onchain/cryptoquant.ts"),
    ]);
    await Promise.all([ccdata.fetchHistoriqueCcData(null), defillama.chargerDefillamaPro("emissions"), finnhub.chargerProfilFinnhub("AAPL", null), cq.chargerSerieCq("taker:spot:btc")]);
    return { fred: fred.fredKeyStore.getState().hasKey, coinalyze: coinalyze.coinalyzeKeyStore.getState().hasKey, soso: !soso.sosoUnusableWithoutKey(true, null), keys: Object.keys(localStorage).filter(k => /(:key$|ApiKey$)/.test(k)) };
  });
  expect(acces).toEqual({ fred: true, coinalyze: true, soso: true, keys: [] });
  expect(requetes.some(r => r.path.startsWith("/cqapi/"))).toBe(true);
  expect(requetes.some(r => r.path.startsWith("/finnhubapi/"))).toBe(true);
  expect(requetes.some(r => r.path.startsWith("/ccdataapi/"))).toBe(true);
  expect(requetes.every(r => !r.authorization && !r.defillama)).toBe(true);
  const finn = settings.locator("div.rounded-md").filter({ hasText: "Fondamentaux, earnings" }).first();
  await finn.getByRole("button", { name: "Ajouter une clé personnelle" }).click();
  await finn.getByPlaceholder("Clé API Finnhub").fill("fixture-personnelle");
  await finn.getByRole("button", { name: "Enregistrer" }).click();
  await expect(finn).toContainText("clé personnelle ✓");
  await finn.getByRole("button", { name: "Supprimer" }).click();
  await expect(finn).toContainText("clé serveur ✓");
  expect(await page.evaluate(() => localStorage.getItem("axiom:finnhub:key"))).toBeNull();
});

test("configuration indisponible : le terminal démarre et conserve les clés personnelles", async ({ page }) => {
  await preparer(page, false);
  await page.addInitScript(() => localStorage.setItem("axiom:finnhub:key", "fixture-personnelle"));
  await page.goto("/");
  await page.getByRole("button", { name: "Ouvrir les réglages" }).click();
  const settings = page.getByRole("dialog", { name: "Réglages", exact: true });
  await expect(settings.getByText("clé serveur ✓", { exact: true })).toHaveCount(0);
  await expect(settings.getByText("clé personnelle ✓", { exact: true })).toHaveCount(1);
});
