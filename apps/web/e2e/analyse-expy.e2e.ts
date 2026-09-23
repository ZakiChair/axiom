import { expect, test } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

const INSTANT = Date.parse("2026-09-23T12:00:00Z");

test.beforeEach(async ({ page }) => {
  await bouchonnerReseau(page);
  await page.clock.install({ time: INSTANT });
  await page.clock.setFixedTime(INSTANT);
  await page.addInitScript(() => localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 })));
});

test("analyse figée au signal → dossier → PAPER → EXPY après rechargement", async ({ page }) => {
  await page.goto("/");
  const aside = page.locator("aside");
  await aside.getByRole("button", { name: /^Alertes/ }).click();
  await aside.getByPlaceholder("Niveau").fill("100");
  await aside.getByRole("button", { name: /^Ajouter sur/ }).click();

  const alerte = await page.evaluate(async (ts) => {
    const [{ alertsStore }, { enrichirDeclenchement }, { remplacerLectures, capturerLectures }] = await Promise.all([
      (new Function("return import('/src/store/alerts.ts')") as () => Promise<typeof import("../src/store/alerts")>)(),
      (new Function("return import('/src/data/decisionDossier.ts')") as () => Promise<typeof import("../src/data/decisionDossier")>)(),
      (new Function("return import('/src/store/analyseMultidomaine.ts')") as () => Promise<typeof import("../src/store/analyseMultidomaine")>)(),
    ]);
    remplacerLectures("quadrant", [{ id: "macro:US", domaine: "quadrant", nature: "observation", conclusion: "US : expansion",
      tags: [{ cle: "quadrant", valeur: "expansion" }], instrument: null, horizon: { depuis: ts - 86_400_000, jusqua: ts - 1000 },
      unite: null, valeur: null, source: "FRED", observeLe: ts - 1000, recupereLe: ts - 1000,
      validiteJusqua: ts + 86_400_000, statut: "frais", couverture: null, limites: [],
      preuve: { fenetre: "RATE", reference: "US" } }]);
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
    }, capturerLectures(ts)));
    remplacerLectures("quadrant", []);
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
  expect(dossier.analyse.captureLe).toBe(INSTANT);
  expect(dossier.analyse.lectures[0].tags[0].valeur).toBe("expansion");
  await expect(expy.getByRole("region", { name: "Résultats par contexte archivé" })).toContainText("quadrant:US");
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
  await expect(expy.getByRole("region", { name: "Résultats par contexte archivé" })).toContainText("expansion");
  await page.evaluate(async (ts) => {
    const { expyStore } = await (new Function("return import('/src/store/expy.ts')") as () => Promise<typeof import("../src/store/expy")>)();
    expyStore.getState().ajouter({ symbol: "BTCUSDT", direction: "long", entree: 100, stopInitial: 90,
      taille: 1, sortie: 110, ouvertTs: ts - 1000, fermeTs: ts, tags: [], decisionIds: ["dossier-absent"] });
  }, INSTANT);
  await expect(expy.getByRole("region", { name: "Résultats par contexte archivé" })).toContainText("1 sans source");
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
  expect(recharge.dossier?.analyse?.lectures[0]?.conclusion).toBe("US : expansion");
  expect(recharge.trade?.decisionIds).toEqual([dossier.id]);
});
