import { test, expect } from "@playwright/test";

/**
 * Gate G100 — G3 : « 5 playbooks 1-clic ouvrent layout + panneaux + toggles ».
 *
 * ⚠ RÉSEAU REQUIS (specs de gate) ; daemon toléré absent. Les fenêtres ouvertes
 * peuvent afficher leurs états d'erreur/vide internes : le critère automatisé est
 * l'OUVERTURE des fenêtres attendues (role complementary), pas leurs données.
 *
 * Attentes PINNÉES depuis `src/data/playbooks.ts` (ouvrirFenetres → ids) et
 * `src/store/windowManager.ts` (id → title). On ne re-parse pas la source à
 * l'exécution (un gate d'acceptation fige ses attentes — sinon une régression
 * silencieuse réécrirait l'attendu) ; le test « catalogue complet » ci-dessous
 * détecte tout playbook ajouté/retiré et force la mise à jour de cette table.
 * Reste au protocole MANUEL : la vérification des toggles (orderflow, VP,
 * overlays macro, heatmap liq) et du layout de grille appliqué.
 */
const PLAYBOOKS_ATTENDUS: { mnemonique: string; fenetres: string[] }[] = [
  { mnemonique: "PLAY-SCALP", fenetres: ["Produits dérivés", "Carnet d'ordres (DOM / depth)"] },
  { mnemonique: "PLAY-FADE", fenetres: ["Produits dérivés", "Screener d'actifs"] },
  { mnemonique: "PLAY-CVD", fenetres: ["Produits dérivés"] },
  {
    mnemonique: "PLAY-FOMC",
    fenetres: ["Calendrier économique", "Taux & Réserves souveraines", "Actualités crypto"],
  },
  {
    mnemonique: "PLAY-RISK",
    fenetres: ["Globe (chokepoints & trafic aérien)", "Vue marché (treemap)", "Corrélations"],
  },
  {
    mnemonique: "PLAY-OPT",
    fenetres: ["Options (smile IV, max pain)", "Structure par terme", "Volatilité (cône RV, VRP)"],
  },
  { mnemonique: "PLAY-LIQ", fenetres: ["Liquidations"] },
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "axiom:onboarding:v1",
      JSON.stringify({ completed: true, step: 0 }),
    );
  });
});

test("le menu Playbooks liste exactement les playbooks attendus", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Playbooks" }).click();
  // Un menuitem par playbook du catalogue — si ce compte casse, mettre à jour
  // PLAYBOOKS_ATTENDUS ci-dessus (source : data/playbooks.ts).
  await expect(page.getByRole("menuitem")).toHaveCount(PLAYBOOKS_ATTENDUS.length);
  for (const p of PLAYBOOKS_ATTENDUS) {
    await expect(page.getByRole("menuitem", { name: p.mnemonique })).toBeVisible();
  }
});

for (const p of PLAYBOOKS_ATTENDUS) {
  test(`playbook ${p.mnemonique} : 1 clic ouvre ${p.fenetres.join(" + ")}`, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Playbooks" }).click();
    await page.getByRole("menuitem", { name: p.mnemonique }).click();
    for (const titre of p.fenetres) {
      await expect(page.getByRole("complementary", { name: titre })).toBeVisible({
        timeout: 15_000,
      });
    }
  });
}
