import { expect, test } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

const INSTANT = Date.parse("2026-09-23T12:00:00Z");

test.beforeEach(async ({ page }) => {
  await bouchonnerReseau(page);
  await page.clock.install({ time: INSTANT });
  await page.clock.setFixedTime(INSTANT);
  await page.addInitScript(() => localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 })));
});

test("alerte déclenchée → dossier daté → brouillon PAPER → validation → clôture EXPY", async ({ page }) => {
  await page.goto("/");
  const aside = page.locator("aside");
  await aside.getByRole("button", { name: /^Alertes/ }).click();
  await aside.getByPlaceholder("Niveau").fill("100");
  await aside.getByRole("button", { name: /^Ajouter sur/ }).click();

  const alerte = await page.evaluate(async (ts) => {
    const [{ alertsStore }, { enrichirDeclenchement }] = await Promise.all([
      (new Function("return import('/src/store/alerts.ts')") as () => Promise<typeof import("../src/store/alerts")>)(),
      (new Function("return import('/src/data/decisionDossier.ts')") as () => Promise<typeof import("../src/data/decisionDossier")>)(),
    ]);
    const def = alertsStore.getState().defs.at(-1)!;
    // Fixture du déclenchement : le runtime est couvert en unitaire, le parcours
    // navigateur exerce les actions réelles depuis le journal jusqu'au trade EXPY.
    alertsStore.getState().ajouterJournal(enrichirDeclenchement({ alertId: def.id, ts, valeur: 102,
      message: "Prix franchit 100 à la hausse" }, def, {
      maintenant: ts, dernierPrix: 102, prixPrecedent: 98,
      candles: [
        { time: ts - 3_600_000, open: 96, high: 99, low: 95, close: 98, volume: 8, closed: true },
        { time: ts + 3_600_000, open: 102, high: 150, low: 100, close: 140, volume: 9, closed: true },
      ],
    }));
    alertsStore.getState().supprimer(def.id);
    return { id: def.id, symbol: def.symbol, source: def.source };
  }, INSTANT);
  await aside.getByRole("button", { name: /^Journal \(1\)/ }).click();
  await aside.getByRole("button", { name: "Dossier" }).click();
  const expy = page.locator('[data-window-id="expy"]');
  await expect(expy.getByRole("region", { name: "Dossiers de décision" })).toContainText("preuve capturée");
  await expect(expy.getByRole("region", { name: "Dossiers de décision" })).toContainText("dernière bougie");
  await expect(expy.getByRole("region", { name: "Dossiers de décision" })).not.toContainText("150");
  const dossier = await page.evaluate(() => JSON.parse(localStorage.getItem("axiom:decisionDossiers:v1")!).dossiers[0]);
  expect(dossier.origine.alertId).toBe(alerte.id);
  expect(dossier.origine.ts).toBe(INSTANT);
  expect(dossier.origine.symbol).toBe(alerte.symbol);
  expect(dossier.origine.source).toBe(alerte.source);
  expect(dossier.contexte.derniereBougie.close).toBe(98);
  await expy.getByRole("button", { name: "Préparer dans PAPER" }).click();

  const paper = page.locator('[data-window-id="paper"]');
  await expect(paper).toContainText("Aucun ordre avant validation");
  await expect(paper.getByLabel("Source PAPER")).toHaveValue(alerte.source);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("axiom:paper:v1") ?? '{"ordres":[],"positions":[]}').ordres)).toHaveLength(0);
  await page.evaluate(async ({ symbol, source }) => {
    const { paperStore, clePrixPaper } = await (new Function("return import('/src/store/paper.ts')") as () => Promise<typeof import("../src/store/paper")>)();
    paperStore.setState({ derniersPrix: { [clePrixPaper(symbol, source)]: 102 } });
  }, alerte);
  await paper.getByPlaceholder("1000").fill("1020");
  await paper.getByRole("button", { name: "Placer", exact: true }).click();
  await expect(paper).not.toContainText("Aucun ordre avant validation");
  const position = await page.evaluate(() => JSON.parse(localStorage.getItem("axiom:paper:v1")!).positions[0]);
  expect(position.source).toBe(alerte.source);
  expect(position.decisionIds).toEqual([dossier.id]);
  await paper.getByRole("button", { name: "Clôturer", exact: true }).click();
  const trade = await page.evaluate(() => JSON.parse(localStorage.getItem("axiom:expy:v1")!)[0]);
  expect(trade.source).toBe(alerte.source);
  expect(trade.decisionIds).toEqual([dossier.id]);
  await expect(expy.getByRole("region", { name: "Dossiers de décision" })).toContainText("1 trade(s) EXPY");
  await page.reload();
  const recharge = await page.evaluate(async () => {
    const [{ decisionDossiersStore }, { expyStore }] = await Promise.all([
      (new Function("return import('/src/store/decisionDossiers.ts')") as () => Promise<typeof import("../src/store/decisionDossiers")>)(),
      (new Function("return import('/src/store/expy.ts')") as () => Promise<typeof import("../src/store/expy")>)(),
    ]);
    return { dossier: decisionDossiersStore.getState().dossiers[0], trade: expyStore.getState().trades[0] };
  });
  expect(recharge.dossier?.origine.ts).toBe(INSTANT);
  expect(recharge.trade?.decisionIds).toEqual([dossier.id]);
});
