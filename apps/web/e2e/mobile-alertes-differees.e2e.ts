import { expect, test, type Page } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

/**
 * Runtime des alertes chargé à la demande (alerts/demarrageDiffere, constat WEB-3). Les tests
 * unitaires tiennent la logique du chargeur ; ce parcours tient le câblage réel d'App :
 *  - double montage React StrictMode du serveur de développement : un seul runtime démarré ;
 *  - module introuvable : avis visible, terminal en place, nouvelle tentative au retour de
 *    l'onglet jamais muette (un seul avis à la fois), et « Recharger » rétablit les alertes ;
 *  - le toast expiré, l'état reste affiché : « inactives » à la place du compteur du bandeau
 *    (écran principal), ligne « alertes » en erreur dans Santé sources (absente en nominal) et
 *    section Alertes indisponible ;
 *  - mise en page bureau : seule la section Alertes tombe (son chunk dépend du runtime).
 *
 * La pastille « Santé » du bandeau n'est pas vérifiée ici : le réseau bouchonné (503) met
 * déjà d'autres sources en erreur, l'assertion passerait sans la ligne « alertes ». Le niveau
 * global est tenu par le test unitaire du chargeur.
 *
 * Trace du démarrage : le poll funding immédiat de l'alerte persistée (une requête par
 * runtime démarré ; le réseau bouchonné y répond 503). Les deux moteurs téléphone passent par
 * ce fichier : après un échec, l'un peut mémoriser l'import raté, l'autre relancer la requête —
 * les assertions valent dans les deux cas tant que le module reste bloqué.
 */
const AVIS = "Alertes inactives : module non chargé";
const MODULE_RUNTIME = "**/src/alerts/runtime.ts*";

/** Ouvre le tiroir Panneaux puis la section Santé sources (repliée par défaut), lignes affichées. */
async function ouvrirSanteSources(page: Page) {
  await page.getByRole("navigation", { name: "Navigation du terminal" }).getByRole("button", { name: "Panneaux", exact: true }).tap();
  const panneaux = page.getByRole("dialog", { name: "Panneaux du terminal", exact: true });
  await panneaux.getByRole("button", { name: /^Santé sources/ }).tap();
  await expect(panneaux.getByRole("button", { name: /^Binance/ }).first()).toBeVisible();
  return panneaux;
}

/** Requêtes du poll funding de l'alerte persistée, au fil de l'eau. */
function sondesFunding(page: Page): string[] {
  const sondes: string[] = [];
  page.on("request", (requete) => {
    if (requete.url().includes("premiumIndex?symbol=DOGEUSDT")) sondes.push(requete.url());
  });
  return sondes;
}

/** Erreurs journalisées par le chargeur (une par échec signalé). */
function echecsJournalises(page: Page): string[] {
  const echecs: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes(`[AXIOM] ${AVIS}`)) echecs.push(message.text());
  });
  return echecs;
}

test.beforeEach(async ({ page }) => {
  await bouchonnerReseau(page);
  await page.addInitScript(() => {
    localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
    localStorage.setItem("axiom:alerts:v1", JSON.stringify({
      defs: [{
        id: "e2e-funding", symbol: "DOGEUSDT", source: "binance",
        condition: { type: "funding-extreme", seuilAbs: 0.5, sens: "les-deux" },
        actif: true, declenchements: [],
      }],
      journal: [],
    }));
  });
});

test("démarrage nominal : un seul runtime malgré le double montage, sans avis", async ({ page }) => {
  const sondes = sondesFunding(page);
  const echecs = echecsJournalises(page);
  await page.goto("/");
  await expect.poll(() => sondes.length).toBe(1);
  // Un second runtime aurait lancé son propre poll immédiat.
  await page.waitForTimeout(1_000);
  expect(sondes).toHaveLength(1);
  expect(echecs).toEqual([]);
  await expect(page.getByText(AVIS)).toHaveCount(0);
  // Aucune ligne « alertes » au registre santé : elle n'existe qu'après un échec ou dix secondes de chargement.
  const panneaux = await ouvrirSanteSources(page);
  await expect(panneaux.getByRole("button", { name: /^alertes/ })).toHaveCount(0);
});

test("module introuvable : avis visible, terminal en place, puis « Recharger » rétablit les alertes", async ({ page }) => {
  let bloque = true;
  await page.route(MODULE_RUNTIME, (route) => (bloque ? route.abort() : route.continue()));
  const sondes = sondesFunding(page);
  const echecs = echecsJournalises(page);
  await page.goto("/");

  const avis = page.getByText(AVIS);
  await expect(avis.first()).toBeVisible();
  await expect(avis.first()).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("navigation", { name: "Navigation du terminal" })).toBeVisible();
  await expect.poll(() => echecs.length).toBe(1);
  expect(sondes).toEqual([]); // aucun runtime : aucune alerte évaluée

  // Retour de l'onglet au premier plan, module toujours introuvable : l'échec est signalé de nouveau.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(() => echecs.length).toBe(2);
  // Le nouvel avis remplace le précédent : jamais deux avis identiques empilés.
  await expect(avis).toHaveCount(1);
  const recharger = page.getByRole("button", { name: "Recharger", exact: true });
  await expect(recharger).toBeVisible();

  bloque = false;
  await recharger.tap();
  await expect.poll(() => sondes.length).toBe(1);
  await expect(avis).toHaveCount(0);
  expect(echecs).toHaveLength(2);
});

test("module introuvable : le toast expiré, l'état « alertes inactives » reste affiché", async ({ page }) => {
  await page.route(MODULE_RUNTIME, (route) => route.abort());
  await page.goto("/");
  const avis = page.getByText(AVIS);
  await expect(avis.first()).toBeVisible();
  // Toast actionnable : 6 s. Ensuite, plus aucun avis, mais la panne ne redevient pas muette.
  await expect(avis).toHaveCount(0, { timeout: 10_000 });
  // Écran principal, tiroir fermé : le bandeau écrit « inactives » à la place du compteur.
  const bandeau = page.getByRole("status", { name: "Session : P&L jour, alertes, santé" });
  await expect(bandeau.getByText("inactives", { exact: true })).toBeVisible();
  await expect(bandeau.getByTitle(AVIS)).toBeVisible();

  const panneaux = await ouvrirSanteSources(page);
  const ligne = panneaux.getByRole("button", { name: /^alertes/ });
  await expect(ligne).toHaveAttribute("title", AVIS);
  await ligne.tap();
  const detail = panneaux.getByRole("region", { name: "Détail alertes" });
  await expect(detail).toContainText("erreur");
  await expect(detail).toContainText(AVIS);
  // La section Alertes du tiroir dit la même chose et propose de recharger.
  await expect(panneaux.getByText("Alertes indisponible")).toBeVisible();
});

test.describe("mise en page bureau", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("module introuvable : seule la section Alertes tombe et propose de recharger", async ({ page }) => {
    await page.route(MODULE_RUNTIME, (route) => route.abort());
    await page.goto("/");
    await expect(page.getByText(AVIS).first()).toBeVisible();
    const panneaux = page.getByRole("complementary", { name: "Panneaux du terminal", exact: true });
    await expect(panneaux.getByText("Alertes indisponible")).toBeVisible();
    await expect(panneaux.getByRole("button", { name: "Recharger l’application" })).toBeVisible();
    // Le reste du terminal reste monté : ni écran d'erreur global, ni watchlist perdue.
    await expect(page.getByText("AXIOM indisponible")).toHaveCount(0);
    await expect(panneaux.getByRole("button", { name: /^Watchlist/ })).toBeVisible();
  });
});
