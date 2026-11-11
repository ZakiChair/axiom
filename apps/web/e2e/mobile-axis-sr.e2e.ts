import { expect, test, type Locator, type Page } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";
import { changerTheme, lireAxisSr, preparerAxisSr, type CibleAxisSr, type LectureAxisSr } from "./helpers/axis-sr-telephone";

/**
 * AXIS S/R au téléphone, réseau fermé : les 3 000 bougies BTCUSDT 4h du cas de référence, horloge
 * figée après la dernière clôture. Rubans, étiquettes, triangles et infobulle sont dessinés sur
 * canvas : le parcours lit l'état du VRAI graphe (styles, annotations calculées, réticule, lignes
 * rendues par la source de l'infobulle). Il prouve une géométrie et des données, pas une
 * lisibilité : les captures jointes au rapport de test restent à regarder.
 *  - L'infobulle d'indicateur du pane des prix commence sous le bas réel de l'en-tête (bandeau du
 *    symbole ou en-tête d'une vue secondaire), quelle que soit la hauteur du pane (paysage, pane
 *    d'indicateur). « Détails » ouvert, elle suit le panneau tant qu'il tient dans le tiers haut
 *    du pane ; au-delà elle s'arrête à ce tiers, jamais au-dessus de la part repliée du bandeau.
 *    Au bureau : 36 px.
 *  - Le doigt dans la bande d'une zone, près de trois marqueurs : la zone garde sa ligne.
 *  - Le doigt sur un triangle creux : sa ligne est rendue, « non mesuré » en ouverture.
 * Les attentes lisent la STRUCTURE des annotations (ruban porteur d'un texte, opacité de la bande,
 * étiquette au bord droit, triangle creux), jamais le libellé d'une infobulle de zone.
 */
const ETIQUETTE_FORTE = /^(S fort|R forte) · \d+$/;
const ETIQUETTE_FAIBLE = "faible";
/** La réserve d'un signal non mesuré ouvre sa ligne : avant le premier tiret, donc jamais coupée au bord du pane. */
const RESERVE_EN_OUVERTURE = /^[^—]*non mesuré/;

// Les attentes les plus longues d'un parcours : 30 s pour l'affichage, 60 s pour la remontée aux
// 3 000 bougies. Le délai du test les couvre, avec de la marge pour le reste.
test.describe.configure({ timeout: 120_000 });

const menuMobile = (page: Page) => page.locator(".axiom-mobile-menu-root").last();
const details = (page: Page) => page.getByRole("button", { name: "Détails du marché et ratios" });
const panneauDetails = (page: Page) => page.locator("#chart-banner-details");

async function lire(page: Page): Promise<LectureAxisSr> {
  const lecture = await lireAxisSr(page);
  if (lecture === null) throw new Error("graphe actif absent");
  return lecture;
}

/** Ordonnées en px depuis le haut du pane des prix : un bord d'un élément, l'infobulle, le tiers du pane. */
interface Mesure {
  bord: number;
  infobulle: number;
  tiers: number;
}

async function mesurer(page: Page, element: Locator, bord: "bas" | "haut"): Promise<Mesure | null> {
  const boite = await element.boundingBox();
  const lecture = await lireAxisSr(page);
  if (boite === null || lecture === null) return null;
  return {
    bord: boite.y + (bord === "bas" ? boite.height : 0) - lecture.pane.y,
    infobulle: lecture.offsetTop,
    tiers: Math.floor(lecture.pane.height / 3),
  };
}

/**
 * L'infobulle commence juste après un bord de l'élément (son bas par défaut) : jamais cachée par
 * lui, 3 px plus bas au plus. Rend la mesure une fois la position atteinte.
 */
async function attendreInfobulleSous(page: Page, element: Locator, bord: "bas" | "haut" = "bas"): Promise<Mesure> {
  await expect.poll(async () => {
    const mesure = await mesurer(page, element, bord);
    if (mesure === null) return "graphe ou élément absent";
    const ecart = mesure.infobulle - mesure.bord;
    return ecart >= 0 && ecart <= 3 ? "sous le bord" : `infobulle à ${ecart} px du bord`;
  }).toBe("sous le bord");
  const mesure = await mesurer(page, element, bord);
  if (mesure === null) throw new Error("graphe ou élément absent");
  return mesure;
}

/** Ouvre « Options », ajoute AXIS S/R (et un RSI en pane séparé si demandé) au toucher, referme. */
async function ajouterAxisSr(page: Page, avecRsi = false): Promise<void> {
  await page.getByRole("button", { name: "Options", exact: true }).tap();
  // Boutons cherchés dans le panneau : la légende du graphe a aussi un bouton « Indicateurs ».
  const options = page.getByRole("dialog", { name: "Options du graphique" });
  await options.getByRole("button", { name: /^Stratégies/ }).tap();
  await menuMobile(page).getByPlaceholder(/^Rechercher/).fill("AXIS S/R");
  await menuMobile(page).locator("[data-item-strategie]").filter({ hasText: "AXIS S/R" }).tap();
  await menuMobile(page).getByRole("button", { name: "Fermer Stratégies" }).tap();
  if (avecRsi) {
    await options.getByRole("button", { name: /^Indicateurs/ }).tap();
    await menuMobile(page).getByPlaceholder(/^Rechercher/).fill("RSI");
    await menuMobile(page).getByRole("button", { name: "Ajouter RSI", exact: true }).tap();
    await menuMobile(page).getByRole("button", { name: "Fermer Indicateurs" }).tap();
  }
  await page.getByRole("button", { name: "Fermer les options" }).tap();
}

/**
 * Pose le réticule sur la cible, au doigt. Le moteur du graphe efface d'abord un réticule posé
 * ailleurs, et ne compte pas un appui qui en suit un autre à moins de 500 ms : jusqu'à trois
 * appuis, espacés de plus que ce délai.
 */
async function poserReticule(page: Page, cible: CibleAxisSr): Promise<LectureAxisSr> {
  for (let appui = 0; appui < 3; appui++) {
    await page.touchscreen.tap(cible.x, cible.y);
    if ((await lire(page)).reticule.paneId !== null) break;
    await page.waitForTimeout(600);
  }
  const lecture = await lire(page);
  expect(lecture.reticule).toEqual({ paneId: "candle_pane", dataIndex: cible.idx });
  return lecture;
}

test("390 px : AXIS S/R ajouté au toucher, infobulle sous le bandeau, zones, bande, signal précoce et « Détails »", async ({ page }, testInfo) => {
  await bouchonnerReseau(page);
  await preparerAxisSr(page);
  await page.goto("/");
  await expect(page.locator("[data-chart-status]")).toHaveCount(0, { timeout: 30_000 });
  const bandeau = page.locator("[data-chart-banner]");

  // Dès le chargement, avant tout indicateur : l'ordonnée de l'infobulle est sous le bandeau.
  await attendreInfobulleSous(page, bandeau);

  await ajouterAxisSr(page);

  // AXIS S/R actif : le graphe remonte de lui-même aux 3 000 bougies, et le calcul les lit toutes.
  await expect.poll(async () => (await lireAxisSr(page))?.calculees, { timeout: 60_000 }).toBe(3000);
  await attendreInfobulleSous(page, bandeau);
  const repos = await lire(page);
  expect(repos.bougies).toBe(3000);

  // Zones classées par force. Une zone active est un ruban porteur d'un texte ; sa bande est
  // pleine quand elle est forte, vide quand elle est faible ; son étiquette au bord droit le dit.
  // Chaque texte dit la profondeur sur laquelle les touches sont comptées.
  const fortes = repos.zones.filter((zone) => zone.alpha > 0);
  expect(fortes.length).toBeGreaterThan(0);
  expect(repos.rubans).toBeGreaterThanOrEqual(repos.zones.length);
  expect(repos.etiquettes.filter((texte) => ETIQUETTE_FORTE.test(texte))).toHaveLength(fortes.length);
  expect(repos.etiquettes.filter((texte) => texte === ETIQUETTE_FAIBLE)).toHaveLength(repos.zones.length - fortes.length);
  for (const zone of repos.zones) expect(zone.info).toMatch(/sur 3000 bougies/);

  // Sans toucher : aucun pane sous le réticule, l'infobulle décrit la dernière bougie par les
  // textes que portent les annotations du graphe, trois lignes au plus.
  expect(repos.reticule).toEqual({ paneId: null, dataIndex: 2999 });
  expect(repos.lignes.length).toBeGreaterThan(0);
  expect(repos.lignes.length).toBeLessThanOrEqual(3);
  expect(repos.origines).not.toContain("inconnue");
  await page.screenshot({ path: testInfo.outputPath("axis-sr-telephone-repos.png") });

  // Le doigt dans une bande, là où trois marqueurs sont à 3 bougies ou moins : avant la ligne
  // réservée, ils prenaient les trois lignes et la zone sous le doigt n'en avait aucune.
  expect(repos.bandes.length).toBeGreaterThan(0);
  const bande = repos.bandes.reduce((a, b) => (b.marqueursProches >= a.marqueursProches ? b : a));
  expect(bande.marqueursProches).toBeGreaterThanOrEqual(3);
  const surBande = await poserReticule(page, bande);
  expect(surBande.lignes).toHaveLength(3);
  expect(surBande.lignes[2]).toBe(bande.info);
  expect(surBande.origines[2]).toBe("zone");
  await page.screenshot({ path: testInfo.outputPath("axis-sr-telephone-bande.png") });

  // Le doigt sur un triangle creux : sa ligne est rendue, et elle s'ouvre sur sa réserve.
  expect(repos.creux.length).toBeGreaterThan(0);
  const creux = repos.creux.reduce((a, b) => (b.marqueursProches <= a.marqueursProches ? b : a));
  expect(creux.info).toMatch(RESERVE_EN_OUVERTURE);
  const surCreux = await poserReticule(page, creux);
  expect(surCreux.lignes).toContain(creux.info);
  expect(surCreux.origines[surCreux.lignes.indexOf(creux.info)]).toBe("creux");
  await page.screenshot({ path: testInfo.outputPath("axis-sr-telephone-signal-precoce.png") });

  // « Détails » ouvert : le panneau tient dans le tiers haut du pane, l'infobulle le suit ;
  // refermé, elle revient sous le bandeau replié.
  await details(page).tap();
  await expect(details(page)).toHaveAttribute("aria-expanded", "true");
  const ouvert = await attendreInfobulleSous(page, bandeau);
  expect(ouvert.infobulle).toBeGreaterThan(repos.offsetTop);
  expect(ouvert.infobulle).toBeLessThanOrEqual(ouvert.tiers);
  await page.screenshot({ path: testInfo.outputPath("axis-sr-telephone-details.png") });
  await details(page).tap();
  await expect(details(page)).toHaveAttribute("aria-expanded", "false");
  await expect.poll(async () => (await lireAxisSr(page))?.offsetTop).toBe(repos.offsetTop);
});

test("l'infobulle suit l'en-tête à 320 px, en paysage et sur une vue secondaire ; au bureau elle reste à 36 px", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await bouchonnerReseau(page);
  await preparerAxisSr(page);
  await page.goto("/");
  await expect(page.locator("[data-chart-status]")).toHaveCount(0, { timeout: 30_000 });
  const bandeau = page.locator("[data-chart-banner]");
  await attendreInfobulleSous(page, bandeau);

  // Changement de thème : la palette du graphe est reposée, l'ordonnée de l'infobulle gardée
  // dans le même instant (la constante du bureau ne revient pas avec le thème).
  const avantTheme = (await lire(page)).offsetTop;
  const theme = await changerTheme(page, "bloomberg");
  expect(theme.grilleApres).not.toBe(theme.grilleAvant);
  expect(theme.offsetTop).toBe(avantTheme);
  await attendreInfobulleSous(page, bandeau);

  // Paysage, mise en page téléphone : le bandeau a la même hauteur, le pane est court.
  await page.setViewportSize({ width: 740, height: 360 });
  await attendreInfobulleSous(page, bandeau);
  // « Détails » ouvert sur ce pane court : le panneau dépasse le tiers haut, l'infobulle s'y
  // arrête au lieu de descendre au milieu des bougies (elle passe alors en partie sous le panneau).
  await details(page).tap();
  await expect(details(page)).toHaveAttribute("aria-expanded", "true");
  await expect.poll(async () => {
    const mesure = await mesurer(page, bandeau, "bas");
    return mesure === null ? Number.NaN : mesure.infobulle - mesure.tiers;
  }).toBe(0);
  // Témoins : ce tiers est bien sous la part repliée du bandeau, et au-dessus du bas du panneau.
  const auTiers = await mesurer(page, panneauDetails(page), "haut");
  expect(auTiers!.infobulle - auTiers!.bord).toBeGreaterThan(3);
  expect((await mesurer(page, bandeau, "bas"))!.bord).toBeGreaterThan(auTiers!.infobulle);
  await page.screenshot({ path: testInfo.outputPath("axis-sr-paysage-details.png") });
  await details(page).tap();
  await expect(details(page)).toHaveAttribute("aria-expanded", "false");
  await attendreInfobulleSous(page, bandeau);

  // Mise en page de bureau : valeur d'origine, rendu inchangé.
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect.poll(async () => (await lireAxisSr(page))?.offsetTop).toBe(36);

  // Vue secondaire d'une grille, au téléphone : son en-tête est plus haut que celui du bureau.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Vues ▾", exact: true }).tap();
  await page.locator("#chart-grid-controls").getByRole("button", { name: "Grille 2×2", exact: true }).tap();
  await page.getByRole("button", { name: /^Vue 2 :/ }).tap();
  await expect.poll(async () => (await lireAxisSr(page))?.slot).toBe("1");
  await expect(page.locator('[data-chart-slot="1"] [data-chart-status]')).toHaveCount(0, { timeout: 30_000 });
  await attendreInfobulleSous(page, page.locator('[data-chart-slot="1"]').getByLabel("Symbole du slot").locator("xpath=.."));
  await page.screenshot({ path: testInfo.outputPath("axis-sr-vue-secondaire.png") });
});

test("paysage avec un pane d'indicateur : l'infobulle ne repasse pas sous le bandeau, « Détails » fermé ou ouvert, après rotation ou rechargement", async ({ page }, testInfo) => {
  await bouchonnerReseau(page);
  await preparerAxisSr(page);
  await page.goto("/");
  await expect(page.locator("[data-chart-status]")).toHaveCount(0, { timeout: 30_000 });
  const bandeau = page.locator("[data-chart-banner]");
  const sansPane = (await attendreInfobulleSous(page, bandeau)).tiers;

  // AXIS S/R et un RSI ajoutés au toucher : le pane du RSI raccourcit celui des prix.
  await ajouterAxisSr(page, true);
  await expect.poll(async () => (await mesurer(page, bandeau, "bas"))?.tiers ?? sansPane).toBeLessThan(sansPane);
  await attendreInfobulleSous(page, bandeau);

  // Rotation en paysage, « Détails » fermé. Le tiers haut du pane des prix est au-dessus du bas
  // du bandeau : un plafond au tiers y cachait la première ligne de l'infobulle.
  await page.setViewportSize({ width: 844, height: 390 });
  const paysage = await attendreInfobulleSous(page, bandeau);
  expect(paysage.tiers).toBeLessThan(paysage.bord);
  await page.screenshot({ path: testInfo.outputPath("axis-sr-paysage-pane-indicateur.png") });

  // « Détails » ouvert sur ce pane : le tiers est au-dessus de la part repliée du bandeau,
  // l'infobulle s'arrête juste sous elle, au haut du panneau.
  await details(page).tap();
  await expect(details(page)).toHaveAttribute("aria-expanded", "true");
  const sousReplie = await attendreInfobulleSous(page, panneauDetails(page), "haut");
  expect(sousReplie.tiers).toBeLessThan(sousReplie.bord);

  // Rotations « Détails » ouvert. Le plafond lit la hauteur du pane, que le graphe ne recalcule
  // qu'après la première passe de redimensionnement : sans la seconde, l'ordonnée garde le tiers
  // de l'ancienne orientation. En portrait le panneau tient dans le tiers : l'infobulle le suit.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(details(page)).toHaveAttribute("aria-expanded", "true");
  const portrait = await attendreInfobulleSous(page, bandeau);
  expect(portrait.bord).toBeLessThan(portrait.tiers);
  await page.setViewportSize({ width: 844, height: 390 });
  await attendreInfobulleSous(page, panneauDetails(page), "haut");

  await details(page).tap();
  await expect(details(page)).toHaveAttribute("aria-expanded", "false");
  await attendreInfobulleSous(page, bandeau);

  // Rechargement dans cet état : même ordonnée, quel que soit l'ordre d'arrivée des panes.
  await page.reload();
  await expect(page.locator("[data-chart-status]")).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(async () => (await mesurer(page, bandeau, "bas"))?.tiers ?? sansPane).toBeLessThan(paysage.bord);
  await attendreInfobulleSous(page, bandeau);
});
