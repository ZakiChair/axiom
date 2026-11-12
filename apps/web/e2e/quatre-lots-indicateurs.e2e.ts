import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";
import { preparerPrereglages, lirePaneAnalyse, lireInstances } from "./helpers/prereglages-indicateurs";
import { HORLOGE_AXIS_SR, lireAxisSr, lireZonesAxisSr, preparerAxisSr } from "./helpers/axis-sr-telephone";

test.beforeEach(async ({ page }) => {
  await bouchonnerReseau(page);
  await page.addInitScript(() => localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 })));
});

test("les trois préréglages créent une vraie pane calculée et leur annulation préserve les indicateurs personnels", async ({ page }, testInfo) => {
  await preparerPrereglages(page);
  await page.goto("/");
  await page.getByRole("button", { name: /^Indicateurs/ }).click();
  await page.getByText("Préréglages d’analyse · 3", { exact: true }).click();
  const avant = await lireInstances(page);
  for (const [nom, id, sorties] of [
    ["Polyvalent", "returnAutocorrelation", ["acf"]],
    ["Intraday", "narrowRange", ["nr", "inside"]],
    ["Swing", "rollingDrawdown", ["drawdown", "recovery"]],
  ] as const) {
    const ajouter = page.getByRole("button", { name: `Ajouter le préréglage ${nom}`, exact: true });
    await ajouter.click();
    await expect(ajouter).toBeDisabled();
    await expect.poll(async () => {
      const pane = await lirePaneAnalyse(page, id);
      return Boolean(pane?.canvas && pane.hauteur > 0 && sorties.every((s) => Number.isFinite(pane.dernier?.[s])));
    }).toBe(true);
    await page.getByLabel(`Comprendre le préréglage ${nom}`, { exact: true }).click();
    if (nom === "Swing") {
      await expect(page.getByText(/−20 % nécessite \+25 %/)).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("prereglages-bureau.png") });
    }
    await page.getByRole("button", { name: `Annuler l’ajout ${nom}`, exact: true }).click();
    await expect.poll(() => lireInstances(page)).toEqual(avant);
    await expect.poll(() => lirePaneAnalyse(page, id)).toBeNull();
  }
  await page.getByPlaceholder(/Rechercher… \(CVD/).fill("RSI");
  await page.getByRole("button", { name: "Ajouter RSI", exact: true }).click();
  await expect.poll(async () => (await lireInstances(page)).map((i) => i.defId)).toEqual(["ema", "rsi"]);
});

test("un préréglage persiste sans modifier les jeux personnels ni dupliquer une configuration au rechargement", async ({ page }) => {
  await preparerPrereglages(page);
  await page.goto("/");
  await page.getByRole("button", { name: /^Indicateurs/ }).click();
  await page.getByText("Préréglages d’analyse · 3", { exact: true }).click();
  const jeux = await page.evaluate(() => localStorage.getItem("axiom:indicatorSets:v1"));
  await page.getByRole("button", { name: "Ajouter le préréglage Intraday", exact: true }).click();
  const avant = await lireInstances(page);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("axiom:chartState:v1") ?? "{}").indicators)).toEqual(avant);
  await page.reload();
  await page.getByRole("button", { name: /^Indicateurs/ }).click();
  await page.getByText("Préréglages d’analyse · 3", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Ajouter le préréglage Intraday", exact: true })).toBeDisabled();
  expect(await lireInstances(page)).toEqual(avant);
  expect(await page.evaluate(() => localStorage.getItem("axiom:indicatorSets:v1"))).toBe(jeux);
});

test("un préréglage refuse l’ajout entier au plafond de panneaux et explique comment libérer la place", async ({ page }) => {
  await preparerPrereglages(page);
  await page.goto("/");
  await page.getByRole("button", { name: /^Indicateurs/ }).click();
  await expect.poll(() => page.evaluate(async () => {
    const { chartCapaciteStore } = await import("/src/store/chartCapacite.ts");
    return chartCapaciteStore.getState().paneMax;
  })).toBeGreaterThan(0);
  // Remplir la capacité réelle publiée par la géométrie, sans la simuler ni forcer le bouton.
  await page.evaluate(async () => {
    const [{ indicatorsStore }, { chartCapaciteStore }] = await Promise.all([import("/src/store/indicators.ts"), import("/src/store/chartCapacite.ts")]);
    indicatorsStore.getState().append(Array.from({ length: chartCapaciteStore.getState().paneMax }, (_, i) => ({ defId: "rsi", params: { length: 14 + i } })));
  });
  await expect.poll(async () => (await lirePaneAnalyse(page, "rsi"))?.canvas).toBe(true);
  // Le resize stabilise les hauteurs des panes montées et exerce une vraie capacité réduite.
  await page.setViewportSize({ width: 1280, height: 600 });
  const avant = await lireInstances(page);
  await page.getByText("Préréglages d’analyse · 3", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Ajouter le préréglage Swing", exact: true })).toBeDisabled();
  await expect(page.locator("#preset-swing-description")).toContainText("fermez un panneau");
  expect(await lireInstances(page)).toEqual(avant);
});

test("les deux catalogues chargent au premier clic et Échap rend le focus au déclencheur", async ({ page }) => {
  const modules: string[] = [];
  page.on("request", (request) => {
    if (/\/(IndicatorMenu|StrategyMenu)\.tsx/.test(request.url())) modules.push(request.url());
  });
  await page.goto("/");
  const indicateurs = page.getByRole("button", { name: /^Indicateurs/ });
  const strategies = page.getByRole("button", { name: /^Stratégies/ });
  await expect(indicateurs).toBeVisible();
  await expect(strategies).toBeVisible();
  expect(modules).toEqual([]);

  await strategies.click();
  await expect(page.getByPlaceholder(/Rechercher… \(croisement/)).toBeVisible();
  expect(modules.some((url) => url.includes("StrategyMenu.tsx"))).toBe(true);
  expect(modules.some((url) => url.includes("IndicatorMenu.tsx"))).toBe(false);
  await page.keyboard.press("Escape");
  await expect(strategies).toBeFocused();

  await indicateurs.click();
  await expect(page.getByPlaceholder(/Rechercher… \(CVD/)).toBeVisible();
  expect(modules.some((url) => url.includes("IndicatorMenu.tsx"))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(indicateurs).toBeFocused();
});

test("les réglages Footprint restent chargés seulement à l'ouverture au clavier", async ({ page }) => {
  const modules: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("FootprintSettingsPanel.tsx")) modules.push(request.url());
  });
  await page.goto("/");
  const orderflow = page.getByRole("button", { name: "Orderflow" });
  await expect(orderflow).toBeVisible();
  expect(modules).toEqual([]);
  await orderflow.focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("dialog", { name: "Paramètres Footprint" })).toBeVisible();
  expect(modules).toHaveLength(1);
});

test("favoris, récents et recherche se cumulent ; un récent suit un ajout effectif", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^Indicateurs/ }).click();
  const recherche = page.getByPlaceholder(/Rechercher… \(CVD/);
  await recherche.fill("EMA");
  await page.getByRole("button", { name: "Ajouter EMA aux favoris" }).focus();
  await page.keyboard.press("Enter");
  await recherche.fill("");
  await page.getByRole("button", { name: "Favoris", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Ajouter EMA", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ajouter RSI", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Récents", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ajouter EMA", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Récents", exact: true }).click();
  await page.getByRole("button", { name: "Ajouter EMA", exact: true }).click();
  await page.getByRole("button", { name: "Récents", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ajouter EMA", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Utilisables ici" }).click();
  await expect(page.getByRole("button", { name: "Ajouter EMA", exact: true })).toBeVisible();
  await recherche.locator("..").locator("..").screenshot({ path: process.env.AXIOM_VISUAL_DIR
    ? `${process.env.AXIOM_VISUAL_DIR}/filtres-indicateurs.png`
    : testInfo.outputPath("filtres-indicateurs.png") });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("axiom:indicatorPreferences:v1") ?? "{}").recents)).toEqual(["ema"]);
});

test("quota des préférences : favori gardé en mémoire puis réessayé sans nouveau clic", async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    let bloquer = true;
    (window as unknown as { autoriserPreferences: () => void }).autoriserPreferences = () => { bloquer = false; };
    Storage.prototype.setItem = function (key, value) {
      if (bloquer && key === "axiom:indicatorPreferences:v1") throw new DOMException("quota", "QuotaExceededError");
      original.call(this, key, value);
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: /^Indicateurs/ }).click();
  await page.getByPlaceholder(/Rechercher… \(CVD/).fill("EMA");
  await page.getByRole("button", { name: "Ajouter EMA aux favoris" }).click();
  const erreur = page.getByRole("alert").filter({ hasText: "Préférences non enregistrées" });
  await expect(erreur).toBeVisible();
  await expect(page.getByRole("button", { name: "Retirer EMA des favoris" })).toBeVisible();
  await page.evaluate(() => (window as unknown as { autoriserPreferences: () => void }).autoriserPreferences());
  await page.getByRole("button", { name: "Réessayer la sauvegarde" }).click();
  await expect(erreur).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("axiom:indicatorPreferences:v1") ?? "{}").favoris)).toEqual(["ema"]);
  await page.reload();
  await page.getByRole("button", { name: /^Indicateurs/ }).click();
  await page.getByPlaceholder(/Rechercher… \(CVD/).fill("EMA");
  await expect(page.getByRole("button", { name: "Retirer EMA des favoris" })).toBeVisible();
});

test("utilisables ici cache l'indicateur indisponible sans effacer sa raison ni son favori", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { marketStore } = await import("/src/store/market.ts");
    marketStore.getState().setMarket({ exchange: "synthetic", symbol: "BTCUSDT", timeframe: "1h" });
  });
  await page.getByRole("button", { name: /^Indicateurs/ }).click();
  await page.getByPlaceholder(/Rechercher… \(CVD/).fill("Volume");
  const volume = page.getByRole("button", { name: "Ajouter Volume", exact: true });
  await expect(volume).toBeDisabled();
  await expect(volume).toHaveAttribute("title", "Volume non défini sur une série synthétique");
  await page.getByRole("button", { name: "Ajouter Volume aux favoris" }).click();
  await page.getByRole("button", { name: "Favoris", exact: true }).click();
  await page.getByRole("button", { name: "Utilisables ici" }).click();
  await expect(volume).toHaveCount(0);
  await page.getByRole("button", { name: "Utilisables ici" }).click();
  await expect(volume).toBeDisabled();
  await expect(page.getByRole("button", { name: "Retirer Volume des favoris" })).toBeVisible();
});

async function ouvrirModule(page: Page, module: "IndicatorMenu" | "StrategyMenu" | "FootprintSettingsPanel") {
  if (module === "IndicatorMenu") await page.getByRole("button", { name: /^Indicateurs/ }).click();
  else if (module === "StrategyMenu") await page.getByRole("button", { name: /^Stratégies/ }).click();
  else {
    await page.getByRole("button", { name: "Orderflow" }).focus();
    await page.keyboard.press("Shift+F10");
  }
}

for (const module of ["IndicatorMenu", "StrategyMenu", "FootprintSettingsPanel"] as const) {
  test(`${module} : un import échoué propose un rechargement qui permet l'ouverture`, async ({ page }) => {
    let appels = 0;
    await page.route(`**/src/components/${module}.tsx*`, (route) => {
      appels++;
      return appels === 1 ? route.fulfill({ status: 503, body: "indisponible" }) : route.continue();
    });
    await page.goto("/");
    await ouvrirModule(page, module);
    const erreur = page.getByRole("alert").filter({ hasText: module === "FootprintSettingsPanel" ? "Réglages Footprint indisponibles" : "Chargement impossible" });
    await expect(erreur).toBeVisible();
    expect(appels).toBe(1);
    await erreur.getByRole("button", { name: "Recharger l'application" }).click();
    await ouvrirModule(page, module);
    if (module === "IndicatorMenu") await expect(page.getByPlaceholder(/Rechercher… \(CVD/)).toBeVisible();
    else if (module === "StrategyMenu") await expect(page.getByPlaceholder(/Rechercher… \(croisement/)).toBeVisible();
    else await expect(page.getByRole("dialog", { name: "Paramètres Footprint" })).toBeVisible();
    expect(appels).toBe(2);
  });
}

// Phase 2 d'AXIS, lot 2 (12 novembre 2026) : au bureau, l'alerte de prix au bord d'une zone forte
// d'AXIS S/R se pose par le menu du clic droit. Cas de référence des parcours AXIS (BTCUSDT 4h,
// 3 000 bougies, date figée par `figerDate`), à 1 440 × 900. Le parcours téléphone du même lot
// est `mobile-alerte-zone.e2e.ts`.
test("AXIS S/R au bureau : le clic droit dans une bande forte propose l'alerte de prix à son bord, sous l'en-tête du menu", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await preparerAxisSr(page, [{ defId: "stratAxisSr", params: {} }]);
  await page.goto("/");
  await expect(page.locator("[data-chart-status]")).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(async () => (await lireAxisSr(page))?.calculees, { timeout: 60_000 }).toBe(3000);
  const lireDefs = () => page.evaluate(async () => {
    const { alertsStore } = await import("/src/store/alerts.ts");
    return alertsStore.getState().defs as Array<Record<string, unknown>>;
  });
  const menu = page.locator("#axiom-price-alert-menu");
  const clicDroit = async (point: { x: number; y: number }): Promise<void> => {
    await page.mouse.click(point.x, point.y, { button: "right" });
    await expect(menu).toBeVisible();
  };
  /** Textes des entrées du menu, dans l'ordre : l'en-tête puis les lignes. */
  const lignes = () => menu.locator(":scope > *").allTextContents();
  const habituelles = [/^Alerte croisement ↑ /, /^Alerte croisement ↓ /, /^Alerte croisement ↕ /];

  // Le support fort le plus proche du cours, dont la bande est à l'écran : son dernier bord haut
  // est relu sur les rubans du vrai graphe.
  const lecture = (await lireAxisSr(page))!;
  const zones = await lireZonesAxisSr(page);
  const forte = zones
    .filter((z) => z.forte && z.role === "support" && lecture.bandes.some((c) => c.info === z.info && !c.marqueurSousLeDoigt))
    .sort((a, b) => b.haut - a.haut)[0];
  expect(forte, "aucun support fort à l'écran").toBeDefined();
  expect(forte!.haut).toBeCloseTo(76601.83, 2);
  const cible = lecture.bandes.filter((c) => c.info === forte!.info && !c.marqueurSousLeDoigt).at(-1)!;
  const offre = "Alerte de prix ↓ 76,601.83 · bord du support fort · niveau\u00a0fixe,\u00a07\u00a0jours";

  // La souris dans la bande, au bureau : l'encart des prix n'offre rien, le clic droit suffit.
  await page.mouse.move(cible.x, cible.y);
  await expect(page.locator("[data-candle-readout]")).toBeVisible();
  await expect(page.locator("[data-candle-readout] [data-alerte-zone]")).toHaveCount(0);

  // Clic droit dans la bande : l'en-tête reste le premier div ; l'offre vient dessous, puis les
  // trois entrées au prix du clic.
  await clicDroit(cible);
  expect(await menu.locator("div").first().textContent()).toMatch(/^Prix [\d,.]+$/);
  const ouvert = await lignes();
  expect(ouvert).toHaveLength(5);
  expect(ouvert[0]).toMatch(/^Prix [\d,.]+$/);
  expect(ouvert[1]).toBe(offre);
  habituelles.forEach((motif, i) => expect(ouvert[2 + i]).toMatch(motif));
  const dossier = process.env.AXIOM_CAPTURES;
  if (dossier) mkdirSync(dossier, { recursive: true });
  await page.screenshot({ path: dossier ? join(dossier, "bureau-1440x900-menu-zone-forte.png") : testInfo.outputPath("menu-zone-forte.png"), animations: "disabled" });

  // Clic sur l'offre : une alerte de prix au bord, à niveau fixe, qui expire dans 7 jours ; le
  // menu se ferme, l'avis de pose paraît avec « Annuler ».
  await menu.getByRole("menuitem", { name: offre, exact: true }).click();
  await expect(menu).toHaveCount(0);
  const date = new Date(HORLOGE_AXIS_SR).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  expect(await lireDefs()).toMatchObject([{
    symbol: "BTCUSDT",
    source: "binance",
    condition: { type: "prix-croise", niveau: 76601.83, sens: "baisse" },
    message: `≤ 76,601.83 · bord du support fort AXIS S/R 4h du ${date} · niveau fixe`,
    expireTs: HORLOGE_AXIS_SR + 7 * 24 * 3_600_000,
  }]);
  const avisPose = page.locator('[aria-live="polite"] > [role="button"]').filter({ hasText: "Alerte de prix posée : BTCUSDT ↓ 76,601.83 · niveau fixe · expire dans 7 jours" });
  await expect(avisPose).toBeVisible();
  await expect(avisPose.getByRole("button", { name: "Annuler", exact: true })).toBeVisible();

  // Second clic droit au même endroit : « déjà posée », grisée, sans effet ; rien n'est doublé.
  await clicDroit(cible);
  const posee = menu.locator("[data-alerte-zone]");
  await expect(posee).toHaveText("Alerte déjà posée ↓ 76,601.83 · bord du support fort");
  await expect(posee).toHaveAttribute("aria-disabled", "true");
  expect(await lignes()).toHaveLength(5);
  await posee.click({ force: true });
  await expect(menu).toBeVisible();
  expect(await lireDefs()).toHaveLength(1);

  // Clic droit hors de toute bande, puis dans la bande d'une zone FAIBLE : le menu d'origine,
  // sans bloc de zone.
  const faibles = zones.filter((z) => !z.forte).map((z) => z.info);
  const surFaible = lecture.bandes.filter((c) => faibles.includes(c.info) && !c.marqueurSousLeDoigt).at(-1);
  expect(lecture.libres.at(-1), "aucun point libre à l'écran").toBeDefined();
  expect(surFaible, "aucune bande faible à l'écran").toBeDefined();
  for (const point of [lecture.libres.at(-1)!, surFaible!]) {
    await clicDroit(point);
    await expect(menu.locator("[data-alerte-zone]")).toHaveCount(0);
    const origine = await lignes();
    expect(origine).toHaveLength(4);
    expect(origine[0]).toMatch(/^Prix [\d,.]+$/);
    habituelles.forEach((motif, i) => expect(origine[1 + i]).toMatch(motif));
  }

  // Rejeu actif sur la vue (le drapeau du store que le graphe lit : un vrai rejeu demande le
  // daemon) : dans la bande forte, le menu d'origine, sans rien au bord de la zone. Le direct
  // revenu, l'entrée revient. Le point est relu : le bandeau du rejeu peut déplacer le pane.
  const basculerRejeu = (actif: boolean) => page.evaluate(async (a) => {
    const { replayStore } = await import("/src/store/replay.ts");
    replayStore.setState({ active: a, slot: 0 });
  }, actif);
  const dansLaBande = async () => (await lireAxisSr(page))!.bandes.filter((c) => c.info === forte!.info && !c.marqueurSousLeDoigt).at(-1)!;
  await basculerRejeu(true);
  await clicDroit(await dansLaBande());
  await expect(menu.locator("[data-alerte-zone]")).toHaveCount(0);
  expect(await lignes()).toHaveLength(4);
  await basculerRejeu(false);
  await clicDroit(await dansLaBande());
  await expect(menu.locator("[data-alerte-zone]")).toHaveText("Alerte déjà posée ↓ 76,601.83 · bord du support fort");
  expect(await lireDefs()).toHaveLength(1);
});
