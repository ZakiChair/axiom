import { expect, test, type Locator, type Page } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";
import {
  changerTheme,
  clotureFormatee,
  espionnerRangees,
  HORLOGE_AXIS_SR,
  horlogeDuNavigateur,
  lireAxisSr,
  lireEncart,
  lireRangees,
  mesurerTextes,
  preparerAxisSr,
  redimensionner,
  type CibleAxisSr,
  type LectureAxisSr,
  type LectureEncart,
} from "./helpers/axis-sr-telephone";

/**
 * AXIS S/R au téléphone, réseau fermé : les 3 000 bougies BTCUSDT 4h du cas de référence, date
 * figée après la dernière clôture (`figerDate` : minuteries et `requestAnimationFrame` restent ceux
 * du navigateur, le graphe peint comme en usage réel). Rubans, étiquettes, triangles et infobulle
 * sont dessinés sur canvas : le parcours lit l'état du VRAI graphe (styles, annotations calculées,
 * réticule, lignes rendues par la source de l'infobulle). Il prouve une géométrie et des données,
 * pas une lisibilité : les captures jointes au rapport de test restent à regarder.
 *  - L'infobulle d'indicateur du pane des prix commence sous le bas réel de l'en-tête (bandeau du
 *    symbole ou en-tête d'une vue secondaire), quelle que soit la hauteur du pane (paysage, pane
 *    d'indicateur). « Détails » ouvert, elle suit le panneau tant qu'il tient dans le tiers haut
 *    du pane ; au-delà elle s'arrête à ce tiers, jamais au-dessus de la part repliée du bandeau.
 *    Au bureau aussi, bandeau sur une rangée (1 280 px) ou sur deux (800 px).
 *  - Le doigt dans la bande d'une zone, près de trois marqueurs : la zone garde sa ligne.
 *  - Le doigt sur un triangle creux : sa ligne est rendue, « non mesuré » en ouverture.
 *  - Le doigt sur une zone ou un triangle : l'encart O/H/L/C en écrit le texte COMPLET, sur fond
 *    opaque, sans recouvrir bandeau, bouton « Indicateurs (n) » ni barre de navigation ; les
 *    rangées du canvas, relevées à la peinture (`espionnerRangees`), s'arrêtent à un mot entier
 *    suivi de « … ». À 390 et 320 px, thème par défaut et thèmes à chasse fixe.
 *  - LIMITE consignée : « Détails » ouvert à 320 × 568, le pane est trop court pour l'encart sous
 *    le panneau ; il en recouvre le bas, jamais la part repliée du bandeau ni le bouton.
 *  - AXIS monté AVANT AXIS S/R : le doigt dans une bande lit la zone, pas le signal d'AXIS voisin.
 *  - Le doigt levé, l'encart reste tant que le réticule reste, second appui sur la bougie voisine
 *    compris ; un toucher ailleurs l'efface avec le réticule ; quand le graphe glisse sous un
 *    réticule resté en place (rotation), l'encart est masqué plutôt que de décrire une autre bougie.
 *  - Panneau « Indicateurs (n) » déplié : l'encart s'arrête à son haut, ses boutons restent visibles.
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

/** Abscisse (px du pane) du premier texte d'une rangée de l'infobulle : le bord droit du pane la rogne. */
const DEBUT_RANGEE_PX = 12;
const SEPARATEUR_SEUL = /^[—·;:>]$/;

/**
 * Compare les rangées de la DERNIÈRE peinture de l'infobulle aux lignes entières que sa source rend
 * (`lecture.lignes`) : « conformes », ou le premier défaut. Une rangée par ligne, à pas constant ;
 * chaque rangée est sa ligne entière, ou un préfixe arrêté à un mot entier et suivi de « … », dont
 * le dernier mot tient dans le pane et dont le mot suivant n'y tiendrait pas (mesures du canvas) ;
 * dès qu'une rangée est coupée, chaque rangée sauf la dernière est complétée au-delà du pane, sans
 * quoi le moteur écrirait la suivante à sa suite.
 */
async function etatRangees(page: Page, lecture: LectureAxisSr): Promise<string> {
  const { lignes } = lecture;
  const largeur = lecture.pane.width - DEBUT_RANGEE_PX;
  const rangees = await lireRangees(page);
  if (rangees.length !== lignes.length) return `${rangees.length} rangées peintes pour ${lignes.length} lignes`;
  const coupees = rangees.some((rangee, i) => rangee.texte !== lignes[i]);
  const suivants: string[] = [];
  for (const [i, rangee] of rangees.entries()) {
    const ligne = lignes[i]!;
    if (i > 1 && rangee.y - rangees[i - 1]!.y !== rangees[1]!.y - rangees[0]!.y) return `rangée ${i} : pas irrégulier`;
    if (rangee.largeurCorps > largeur + 0.5) return `rangée ${i} : ${rangee.largeurCorps} px de texte pour ${largeur} px de rangée`;
    if (coupees && i < rangees.length - 1 && rangee.largeurPeinte <= largeur) return `rangée ${i} : non complétée, la suivante la suivrait`;
    if (rangee.texte === ligne) continue;
    const corps = rangee.texte.slice(0, -1);
    if (!rangee.texte.endsWith("…") || !ligne.startsWith(`${corps} `)) return `rangée ${i} : ni la ligne entière ni un préfixe à mot entier suivi de « … » (${rangee.texte})`;
    const mots = ligne.split(" ");
    let n = corps.split(" ").length;
    if (SEPARATEUR_SEUL.test(mots[n - 1]!)) return `rangée ${i} : finit par un séparateur seul (${rangee.texte})`;
    while (n < mots.length && SEPARATEUR_SEUL.test(mots[n]!)) n++;
    suivants.push(mots.slice(0, n + 1).join(" "));
  }
  if (suivants.length > 0) {
    const mesures = await mesurerTextes(page, rangees[0]!.police, suivants);
    const tient = mesures.findIndex((px) => px <= largeur);
    if (tient >= 0) return `un mot de plus tenait (${mesures[tient]} px pour ${largeur}) : ${suivants[tient]}`;
  }
  return "conformes";
}

type Boite = LectureEncart["boite"];
/** Deux boîtes se recouvrent, à un demi-pixel d'arrondi près. */
const seRecouvrent = (a: Boite, b: Boite): boolean =>
  a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

/**
 * Attend que l'encart porte `texte` (ou aucun bloc de texte pour `null`), puis vérifie, avec un
 * texte : toute la largeur sans sortir de l'écran, aucun débordement, fond opaque, haut sous
 * l'ordonnée de l'infobulle, ni bandeau, ni bouton « Indicateurs (n) », ni barre de navigation
 * dessous. `detailsOuvert` : le bandeau contient alors le panneau « Détails » ; l'obstacle est sa
 * part repliée, au-dessus du haut du panneau (le recouvrement du panneau se mesure à part).
 */
async function attendreEncart(page: Page, lecture: LectureAxisSr, texte: string | null, detailsOuvert = false): Promise<LectureEncart> {
  await expect.poll(async () => {
    const lu = await lireEncart(page);
    return lu === null || lu.affichage === "none" ? "encart masqué" : lu.texte;
  }).toBe(texte);
  const encart = (await lireEncart(page))!;
  if (texte === null) return encart;
  expect(encart.deborde).toBe(false);
  expect(encart.fondAlpha).toBe(1);
  expect(encart.boite.x).toBeGreaterThanOrEqual(0);
  expect(encart.boite.x + encart.boite.width).toBeLessThanOrEqual(encart.largeurEcran);
  expect(encart.boite.width).toBeGreaterThan(encart.largeurEcran - 16);
  expect(encart.boite.y).toBeGreaterThanOrEqual(lecture.pane.y + lecture.offsetTop - 0.5);
  const obstacles = {
    bandeau: page.locator("[data-chart-banner]"),
    "bouton Indicateurs": page.getByRole("button", { name: /^Indicateurs \(\d+\)/ }),
    "barre de navigation": page.getByRole("navigation", { name: "Navigation du terminal" }),
  };
  const hautPanneau = detailsOuvert ? (await panneauDetails(page).boundingBox())?.y : undefined;
  for (const [nom, obstacle] of Object.entries(obstacles)) {
    const boite = await obstacle.boundingBox();
    expect(boite, `${nom} absent`).not.toBeNull();
    const dessous = nom === "bandeau" && hautPanneau !== undefined ? { ...boite!, height: hautPanneau - boite!.y } : boite!;
    expect(seRecouvrent(encart.boite, dessous), `l'encart recouvre : ${nom}`).toBe(false);
  }
  return encart;
}

test("390 px : AXIS S/R ajouté au toucher, infobulle sous le bandeau, zones, bande, signal précoce et « Détails »", async ({ page }, testInfo) => {
  await bouchonnerReseau(page);
  await preparerAxisSr(page);
  await page.goto("/");
  await expect(page.locator("[data-chart-status]")).toHaveCount(0, { timeout: 30_000 });
  const bandeau = page.locator("[data-chart-banner]");

  // Garde du harnais : la date est figée, le graphe tourne sur le vrai `requestAnimationFrame`.
  expect(await horlogeDuNavigateur(page, HORLOGE_AXIS_SR)).toEqual({ rafNatif: true, dateFigee: true });

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

test("l'infobulle suit l'en-tête à 320 px, en paysage, au bureau et sur une vue secondaire", async ({ page }, testInfo) => {
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

  // Mise en page de bureau : sous le bandeau aussi (à 36 px, il entamait la première rangée),
  // sur une rangée puis, en vue étroite, sur deux.
  await page.setViewportSize({ width: 1280, height: 900 });
  const bureau = await attendreInfobulleSous(page, bandeau);
  expect(bureau.infobulle).toBeGreaterThan(36);
  await page.setViewportSize({ width: 800, height: 900 });
  const bureauEtroit = await attendreInfobulleSous(page, bandeau);
  expect(bureauEtroit.infobulle).toBeGreaterThan(bureau.infobulle);

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
  // du bandeau : un plafond au tiers y cachait la première ligne de l'infobulle. Le bandeau garde
  // sa hauteur, l'ordonnée attendue ne change donc pas : attendre le graphe, pas seulement elle.
  await redimensionner(page, 844, 390);
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

test("le doigt sur une zone ou un triangle : texte complet dans l'encart, rangées coupées aux mots entiers, à 390 et 320 px, thème par défaut et chasse fixe", async ({ page }, testInfo) => {
  await bouchonnerReseau(page);
  await espionnerRangees(page);
  // AXIS S/R déjà persisté : le premier parcours prouve l'ajout au toucher, celui-ci l'infobulle.
  await preparerAxisSr(page, [{ defId: "stratAxisSr", params: {} }]);
  await page.goto("/");
  await expect(page.locator("[data-chart-status]")).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(async () => (await lireAxisSr(page))?.calculees, { timeout: 60_000 }).toBe(3000);
  const bandeau = page.locator("[data-chart-banner]");
  expect(await horlogeDuNavigateur(page, HORLOGE_AXIS_SR)).toEqual({ rafNatif: true, dateFigee: true });

  // Sans toucher : les rangées décrivent la dernière bougie, chacune arrêtée à un mot entier.
  await attendreInfobulleSous(page, bandeau);
  const repos = await lire(page);
  expect(repos.reticule.paneId).toBeNull();
  expect(repos.lignes.length).toBeGreaterThan(0);
  await expect.poll(() => etatRangees(page, repos)).toBe("conformes");
  const rangeesAuRepos = (await lireRangees(page)).map((rangee) => rangee.texte);
  // Au téléphone aucune ligne d'AXIS S/R ne tient entière : toutes finissent par « … ».
  expect(rangeesAuRepos.every((texte) => texte.endsWith("…"))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("infobulle-390-defaut-repos.png") });

  const configurations = [
    { largeur: 390, hauteur: 844, theme: "dark" },
    { largeur: 390, hauteur: 844, theme: "matrix" },
    { largeur: 320, hauteur: 568, theme: "dark" },
    { largeur: 320, hauteur: 568, theme: "bloomberg" },
  ];
  for (const { largeur, hauteur, theme } of configurations) {
    await test.step(`${largeur} × ${hauteur}, thème ${theme}`, async () => {
      const capture = (nom: string) => page.screenshot({ path: testInfo.outputPath(`infobulle-${largeur}-${theme}-${nom}.png`) });
      await redimensionner(page, largeur, hauteur);
      await changerTheme(page, theme);
      await attendreInfobulleSous(page, bandeau);
      const cibles = await lire(page);

      // Le doigt dans une bande, sans marqueur dessous : le texte complet de la zone.
      const bande = cibles.bandes.filter((cible) => !cible.marqueurSousLeDoigt).at(-1);
      expect(bande, "aucune bande touchable sans marqueur sous le doigt").toBeDefined();
      const surBande = await poserReticule(page, bande!);
      // Une rangée est bien repeinte après l'appui : la peinture suit le réticule posé.
      await expect.poll(() => etatRangees(page, surBande)).toBe("conformes");
      expect(surBande.lignes).toContain(bande!.info);
      const encartZone = await attendreEncart(page, surBande, bande!.info);
      expect(encartZone.lignes).toBeGreaterThan(2);
      await capture("zone");

      // Le doigt sur un triangle creux : son texte, ouvert par sa réserve, lue aussi sur le canvas.
      const creux = cibles.creux.at(-1);
      expect(creux, "aucun triangle creux touchable").toBeDefined();
      expect(creux!.info).toMatch(RESERVE_EN_OUVERTURE);
      const surCreux = await poserReticule(page, creux!);
      await expect.poll(() => etatRangees(page, surCreux)).toBe("conformes");
      await attendreEncart(page, surCreux, creux!.info);
      const rangeeDuCreux = (await lireRangees(page))[surCreux.lignes.indexOf(creux!.info)];
      expect(rangeeDuCreux?.texte).toMatch(RESERVE_EN_OUVERTURE);
      await capture("creux");

      // Le doigt loin de toute annotation : les prix seuls, aucun bloc de texte.
      const libre = cibles.libres.at(-1);
      expect(libre, "aucun point libre touchable").toBeDefined();
      const surLibre = await poserReticule(page, libre!);
      const encartSeul = await attendreEncart(page, surLibre, null);
      expect(encartSeul.boite.width).toBeLessThan(largeur - 16);
      expect(encartSeul.fondAlpha).toBeLessThan(1);
    });
  }

  // LIMITE consignée (revue du 12 novembre 2026). « Détails » ouvert sur ce pane court (320 × 568,
  // chasse fixe) : le panneau descend sous le tiers haut du pane, où l'infobulle s'arrête ; la zone
  // libre sous le panneau est plus courte que l'encart. Il recouvre alors le BAS du panneau, de ce
  // qui sépare ce bas de l'ordonnée de l'infobulle au plus ; jamais la part repliée du bandeau, le
  // bouton « Indicateurs (n) » ni la barre de navigation.
  await test.step("320 × 568, « Détails » ouvert : l'encart recouvre le bas du panneau, rien d'autre", async () => {
    await details(page).tap();
    await expect(details(page)).toHaveAttribute("aria-expanded", "true");
    await expect.poll(async () => {
      const mesure = await mesurer(page, bandeau, "bas");
      return mesure === null ? Number.NaN : mesure.infobulle - mesure.tiers;
    }).toBe(0);
    const ouvert = await lire(page);
    const bande = ouvert.bandes.filter((cible) => !cible.marqueurSousLeDoigt).at(-1);
    expect(bande, "aucune bande touchable « Détails » ouvert").toBeDefined();
    const surBande = await poserReticule(page, bande!);
    const encart = await attendreEncart(page, surBande, bande!.info, true);
    const panneau = (await panneauDetails(page).boundingBox())!;
    const bouton = (await page.getByRole("button", { name: /^Indicateurs \(\d+\)/ }).boundingBox())!;
    const basPanneau = panneau.y + panneau.height;
    const infobulle = surBande.pane.y + surBande.offsetTop;
    // Témoins du cas limite : le bas du panneau est sous l'ordonnée de l'infobulle, et l'encart
    // est plus haut que la zone libre entre le panneau et le bouton.
    expect(basPanneau).toBeGreaterThan(infobulle);
    expect(encart.boite.height).toBeGreaterThan(bouton.y - basPanneau);
    const recouvert = basPanneau - encart.boite.y;
    expect(recouvert).toBeGreaterThan(0);
    expect(recouvert).toBeLessThanOrEqual(basPanneau - infobulle + 0.5);
    testInfo.annotations.push({
      type: "limite",
      description: `« Détails » ouvert à 320 × 568 : l'encart (${Math.round(encart.boite.height)} px) recouvre ${Math.round(recouvert)} px du bas du panneau, pour ${Math.round(bouton.y - basPanneau)} px libres entre le panneau et le bouton`,
    });
    await page.screenshot({ path: testInfo.outputPath("infobulle-320-bloomberg-details-ouvert.png") });
    await details(page).tap();
    await expect(details(page)).toHaveAttribute("aria-expanded", "false");
  });

  // Mise en page de bureau : les rangées sont coupées de la même façon, l'encart n'a pas de texte.
  await redimensionner(page, 1280, 900);
  await changerTheme(page, "dark");
  await attendreInfobulleSous(page, bandeau);
  const bureau = await lire(page);
  const bandeBureau = bureau.bandes.filter((cible) => !cible.marqueurSousLeDoigt).at(-1);
  expect(bandeBureau, "aucune bande touchable au bureau").toBeDefined();
  const surBandeBureau = await poserReticule(page, bandeBureau!);
  await expect.poll(() => etatRangees(page, surBandeBureau)).toBe("conformes");
  const encartBureau = await attendreEncart(page, surBandeBureau, null);
  expect(encartBureau.affichage).toBe("block");
  await page.screenshot({ path: testInfo.outputPath("infobulle-1280-bureau-zone.png") });
});

// Revue du 12 novembre 2026 (constat majeur). Chaque indicateur du pane des prix rendait son
// meilleur texte, et le premier monté gagnait : AXIS monté avant AXIS S/R, le doigt dans une bande
// lisait « AXIS forte vente … », le texte d'un marqueur d'AXIS à 3 bougies et des centaines de
// pixels plus haut. La règle (marqueur sous le doigt, sinon bande, sinon voisin) vaut pour l'ensemble.
test("AXIS monté avant AXIS S/R : le doigt dans une bande lit la zone, pas le signal d'AXIS à 3 bougies", async ({ page }, testInfo) => {
  await bouchonnerReseau(page);
  await preparerAxisSr(page, [{ defId: "stratAxis", params: {} }, { defId: "stratAxisSr", params: {} }]);
  await page.goto("/");
  await expect(page.locator("[data-chart-status]")).toHaveCount(0, { timeout: 30_000 });
  // Les deux indicateurs sont montés sur le pane des prix, AXIS d'abord, et calculés sur les 3 000 bougies.
  await expect.poll(async () => (await lireAxisSr(page))?.indicateurs, { timeout: 60_000 }).toEqual([
    { defId: "stratAxis", calculees: 3000 },
    { defId: "stratAxisSr", calculees: 3000 },
  ]);
  await attendreInfobulleSous(page, page.locator("[data-chart-banner]"));
  const repos = await lire(page);

  // Une bande sans marqueur sous le doigt, d'aucun des deux indicateurs, mais à 3 bougies ou moins
  // d'un texte d'AXIS : son « voisin », qui passait devant la zone.
  const bandes = repos.bandes.filter((cible) => !cible.marqueurSousLeDoigt && cible.textesAutres > 0);
  expect(bandes.length, "aucune bande touchable à 3 bougies ou moins d'un texte d'AXIS").toBeGreaterThan(0);
  // Deux appuis : la dernière de ces cibles, puis la première (une autre bougie, souvent une autre zone).
  for (const [nom, bande] of [["derniere", bandes.at(-1)!], ["premiere", bandes[0]!]] as const) {
    const surBande = await poserReticule(page, bande);
    await attendreEncart(page, surBande, bande.info);
    await page.screenshot({ path: testInfo.outputPath(`deux-indicateurs-zone-${nom}.png`) });
  }

  // Revue du 12 novembre 2026 (mineur). L'encart ne restait qu'après un appui simple : un second
  // appui près du réticule le déplaçait, puis le lever du doigt masquait l'encart alors que le
  // réticule et les rangées du canvas restaient. (Un glissement et un appui long faisaient de
  // même : ils demandent des gestes que ce harnais ne sait pas rejouer sur les deux moteurs.)
  await test.step("le doigt levé, l'encart reste tant que le réticule reste ; un toucher ailleurs l'efface", async () => {
    const libres = repos.bandes.filter((cible) => !cible.marqueurSousLeDoigt);
    // Deux bougies voisines de la même bande, à moins de 10 px l'une de l'autre : le moteur
    // déplace alors son réticule au lieu de l'effacer. Loin du bord droit, pour la rotation.
    const paire = libres
      .flatMap((a) => libres.filter((b) => b.idx === a.idx + 1 && b.info === a.info && Math.hypot(b.x - a.x, b.y - a.y) < 10).map((b) => [a, b] as const))
      .filter(([a]) => a.idx <= repos.bougies - 8)
      .at(-1);
    expect(paire, "aucune paire de bougies voisines touchables dans une même bande").toBeDefined();
    const [premiere, voisine] = paire!;
    const surPremiere = await poserReticule(page, premiere);
    const encartPremiere = await attendreEncart(page, surPremiere, premiere.info);
    expect(encartPremiere.cloture).toBe(await clotureFormatee(page, premiere.idx));

    // Second appui, sur la bougie voisine (au-delà du délai de double appui du moteur).
    await page.waitForTimeout(600);
    await page.touchscreen.tap(voisine.x, voisine.y);
    await expect.poll(async () => (await lire(page)).reticule).toEqual({ paneId: "candle_pane", dataIndex: voisine.idx });
    const encartVoisine = await attendreEncart(page, await lire(page), voisine.info);
    // L'encart décrit la bougie du réticule, pas celle du premier appui.
    expect(encartVoisine.cloture).toBe(await clotureFormatee(page, voisine.idx));
    expect(encartVoisine.cloture).not.toBe(encartPremiere.cloture);

    // Rotation : le réticule reste au même pixel, le graphe glisse dessous sans que le moteur le
    // notifie. L'encart décrirait une autre bougie que celle du réticule : il est masqué.
    await redimensionner(page, 375, 667);
    const tourne = await lire(page);
    expect(tourne.reticule.paneId).toBe("candle_pane");
    expect(tourne.reticule.dataIndex).not.toBe(voisine.idx);
    await expect.poll(async () => (await lireEncart(page))?.affichage).toBe("none");
    await redimensionner(page, 390, 844);

    // Un toucher ailleurs efface le réticule ; le moteur ne le notifie pas, l'encart part avec lui.
    const reposee = await poserReticule(page, premiere);
    await attendreEncart(page, reposee, premiere.info);
    const ailleurs = repos.libres.filter((cible) => Math.hypot(cible.x - premiere.x, cible.y - premiere.y) > 40).at(-1);
    expect(ailleurs, "aucun point libre loin du réticule").toBeDefined();
    await page.waitForTimeout(600);
    await page.touchscreen.tap(ailleurs!.x, ailleurs!.y);
    await expect.poll(async () => (await lire(page)).reticule.paneId).toBeNull();
    expect((await lireEncart(page))?.affichage).toBe("none");
  });

  // Revue du 12 novembre 2026 (mineur). Panneau « Indicateurs (n) » déplié, l'encart passait
  // par-dessus ses lignes sans capter les touchers : un appui sur le texte de l'encart pouvait
  // fermer un indicateur caché dessous.
  await test.step("panneau « Indicateurs (2) » déplié : l'encart s'arrête à son haut, les boutons restent visibles", async () => {
    const bascule = page.getByRole("button", { name: /^Indicateurs \(2\)/ });
    await bascule.tap();
    await expect(bascule).toHaveAttribute("aria-expanded", "true");
    const panneau = page.locator("[data-overlay-legend]");
    await expect(panneau.getByRole("button", { name: "Fermer AXIS S/R" })).toBeVisible();
    // Les cibles sont relues : celles que le panneau recouvre ne sont plus touchables. La plus
    // basse des bandes touchables est la plus proche du panneau.
    const deplie = await lire(page);
    const bande = deplie.bandes
      .filter((cible) => !cible.marqueurSousLeDoigt)
      .reduce<CibleAxisSr | undefined>((bas, cible) => (bas === undefined || cible.y > bas.y ? cible : bas), undefined);
    expect(bande, "aucune bande touchable, panneau déplié").toBeDefined();
    const surBande = await poserReticule(page, bande!);
    const encart = await attendreEncart(page, surBande, bande!.info);
    const boitePanneau = (await panneau.boundingBox())!;
    // Témoin : sous le doigt, l'encart n'aurait pas tenu au-dessus du panneau ; il est passé au-dessus du doigt.
    expect(bande!.y + 14 + encart.boite.height).toBeGreaterThan(boitePanneau.y);
    expect(encart.boite.y + encart.boite.height).toBeLessThanOrEqual(boitePanneau.y + 0.5);
    // Sans place au-dessus (écran plus court), le panneau passe DEVANT l'encart.
    const plans = await page.evaluate(() => ({
      panneau: Number(getComputedStyle(document.querySelector("[data-overlay-legend]")!).zIndex),
      encart: Number(getComputedStyle(document.querySelector("[data-candle-readout]")!).zIndex),
    }));
    expect(plans.panneau).toBeGreaterThan(plans.encart);
    await page.screenshot({ path: testInfo.outputPath("deux-indicateurs-panneau-deplie.png") });
    await bascule.tap();
    await expect(bascule).toHaveAttribute("aria-expanded", "false");
  });
});
