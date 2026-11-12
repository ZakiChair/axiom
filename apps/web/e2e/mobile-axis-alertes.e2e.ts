import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";
import {
  ajouterAxis,
  avis,
  barreFenetres,
  changerTheme,
  lireJournal,
  lireMarche,
  luEnEntier,
  mesurerAvis,
  ouverture,
  ouvrirAlertes,
  pousserAvisOrdinaire,
  preparerAxisAlertes,
  QUATRE_HEURES,
  reduireFenetreData,
  texteAvis,
  type FluxAxisAlertes,
  type GeometrieAvis,
} from "./helpers/axis-alertes-telephone";
import { horlogeDuNavigateur, lireAxisSr, lireEncart, redimensionner, type CibleAxisSr, type LectureAxisSr } from "./helpers/axis-sr-telephone";

/**
 * Alertes d'AXIS au téléphone, réseau fermé, sur le harnais des parcours AXIS S/R (`figerDate` :
 * la date seule est figée et réglable, minuteries et peinture sont celles du navigateur).
 * Chemin nominal : la place sert les bougies 0 à 2 936 du cas de référence (BTCUSDT 4h), AXIS est affiché — le graphe remonte donc à 1 500 bougies,
 * son amorce —, l'alerte « Signal d'achat » est créée au toucher, puis la place pousse la clôture
 * de la bougie 2 937, où AXIS achète (vérifié sur la fixture : état 0 à 2 936, 1 à 2 937, avec ou
 * sans série de référence, sur le tampon de 1 500 comme sur la série entière).
 *
 * Ce que le parcours tient, sur le vrai produit :
 *  - le formulaire nomme les sorties, pose comparateur et valeur, et dit ce que l'alerte portera ;
 *  - une alerte créée en cours de bougie est calibrée tout de suite (« armée ») et la clôture
 *    suivante la déclenche ;
 *  - le déclenchement pousse UN avis à l'écran, « SYMBOLE UNITÉ — libellé », avec « Voir », qui
 *    reste (encore là après 7 s), une entrée au journal ; la même clôture repoussée n'en produit
 *    pas un second ; une alerte de prix pousse le sien aussi ;
 *  - à 320, 360 et 375 px (390 px par les parcours précédents), thème par défaut puis Bloomberg
 *    (chasse fixe) : la boîte de l'avis est entièrement dans l'écran, à 16 px de ses bords,
 *    au-dessus de la navigation basse qui reste touchable, et elle suit la fenêtre quand sa
 *    largeur change ; une fenêtre réduite fait paraître la barre « Fenêtres ouvertes » : l'avis
 *    se pose au-dessus d'elle, ses boutons restent touchables ; dans la liste, le libellé se lit
 *    en entier, « non mesuré » compris, sans rien par-dessus, et une alerte que rien n'évalue le dit ;
 *  - quatre déclenchements non touchés (320 px, thèmes par défaut, Bloomberg et Matrix) : aucun
 *    avis d'alerte ne quitte l'écran sans trace — les plus anciens deviennent UN avis de synthèse,
 *    un avis ordinaire n'en chasse aucun, et la pile reste dans l'écran au-dessus des barres ;
 *  - une place qui n'a pas l'historique de l'amorce, AXIS déjà affiché : la liste écrit
 *    « historique insuffisant : N sur A », sans conseiller d'afficher ce qui l'est déjà ;
 *  - une alerte baleines, portée par un actif et non par un marché : sa ligne ne navigue pas ;
 *  - les deux lots ensemble (intégration du 12 novembre 2026) : des avis d'alerte à l'écran, le
 *    doigt sur une bande forte puis sur un triangle creux — l'encart écrit son texte complet
 *    AU-DESSUS de la pile d'avis, chaque avis reste fermable, la navigation basse touchable.
 *
 * Il prouve une géométrie et des textes dans le DOM, pas une lisibilité : les captures restent à
 * regarder. Il ne dit rien d'un vrai iPhone (police, zone de sécurité, son), ni de Safari en
 * arrière-plan.
 */
const ACHAT = 2937;
const DEMI_HEURE = 1_800_000;
const LIBELLE_ACHAT = "AXIS test 4h ≈ EMA 200 seule · signal d'achat";
const LIBELLE_REACTION = "AXIS S/R non mesuré · réaction sur support fort";
const AMORCE_AXIS = 1500;

// Les attentes les plus longues : 30 s pour l'affichage, 60 s pour la remontée de l'historique.
test.describe.configure({ timeout: 120_000 });

/** Dossier des captures à regarder : `AXIOM_CAPTURES` s'il est donné, sinon celui du test. */
function cheminCapture(testInfo: TestInfo, nom: string): string {
  const dossier = process.env.AXIOM_CAPTURES;
  if (dossier === undefined || dossier === "") return testInfo.outputPath(nom);
  mkdirSync(dossier, { recursive: true });
  return join(dossier, `${testInfo.project.name}-${nom}`);
}

/**
 * Application ouverte une demi-heure après l'ouverture de la bougie d'indice `servies`, que la
 * place n'a pas encore servie (par défaut : la bougie d'achat).
 */
async function demarrer(
  page: Page,
  alertes?: unknown[],
  servies: number = ACHAT,
  indicateurs?: NonNullable<Parameters<typeof preparerAxisAlertes>[1]["indicateurs"]>,
): Promise<FluxAxisAlertes> {
  await bouchonnerReseau(page);
  const flux = await preparerAxisAlertes(page, {
    servies,
    maintenant: ouverture(servies) + DEMI_HEURE,
    ...(alertes ? { alertes } : {}),
    ...(indicateurs ? { indicateurs } : {}),
  });
  await page.goto("/");
  await expect(page.locator("[data-chart-status]")).toHaveCount(0, { timeout: 30_000 });
  // Garde du harnais commun (`figerDate`) : la date est figée, le graphe peint sur le vrai `requestAnimationFrame`.
  expect(await horlogeDuNavigateur(page, ouverture(servies) + DEMI_HEURE)).toEqual({ rafNatif: true, dateFigee: true });
  return flux;
}

/** AXIS affiché au toucher : le graphe remonte de lui-même à son amorce, 1 500 bougies (moins si la place n'en a pas autant). */
async function afficherAxis(page: Page, bougies: number = AMORCE_AXIS): Promise<void> {
  await ajouterAxis(page);
  await expect.poll(async () => (await lireMarche(page)).bougies, { timeout: 60_000 }).toBe(bougies);
}

/** La bougie d'achat clôture : l'horloge passe sa clôture, la place la pousse. */
async function cloturerAchat(page: Page, flux: FluxAxisAlertes): Promise<void> {
  await flux.reglerHorloge(ouverture(ACHAT) + QUATRE_HEURES + 2_000);
  await expect.poll(() => flux.ouverts().kline).toBeGreaterThan(0);
  flux.pousserCloture(ACHAT);
  await expect.poll(async () => (await lireMarche(page)).derniere).toBe(ouverture(ACHAT));
}

/**
 * L'avis est entièrement dans l'écran, à 16 px de ses bords au moins, au-dessus des barres du bas
 * de l'écran (navigation basse, et barre « Fenêtres ouvertes » quand elle est là), dont chaque
 * bouton reste touchable. Réessayé : la pile se replace après un changement de fenêtre, de thème
 * ou de barres. Rend la dernière mesure.
 */
async function attendreAvisDegage(page: Page, avisUnique: Locator): Promise<GeometrieAvis> {
  let mesure: GeometrieAvis | undefined;
  await expect(async () => {
    await expect(avisUnique).toBeInViewport({ ratio: 1 });
    const g = await mesurerAvis(page, avisUnique);
    expect(g.avis.gauche).toBeGreaterThanOrEqual(16);
    // Demi-pixel de marge : un moteur peut arrondir la largeur de la fenêtre autrement que Chromium.
    expect(Math.abs(g.avis.droite - (g.fenetre.largeur - 16))).toBeLessThanOrEqual(0.5);
    expect(g.avis.haut).toBeGreaterThanOrEqual(0);
    expect(g.avis.bas).toBeLessThanOrEqual(g.hautBarres);
    expect(g.texteContenu).toBe(true);
    expect(g.boutonsTouchables.length).toBeGreaterThanOrEqual(4);
    expect(g.boutonsTouchables).not.toContain(false);
    expect(g.boutonsFenetresTouchables).not.toContain(false);
    mesure = g;
  }).toPass({ timeout: 10_000 });
  if (mesure === undefined) throw new Error("avis non mesuré");
  return mesure;
}

/** Chaque avis de la pile est dégagé, et le dernier est posé juste au-dessus des barres (8 px). */
async function attendrePileDegagee(page: Page, lesAvis: Locator, nombre: number): Promise<void> {
  await expect(lesAvis).toHaveCount(nombre);
  let dernier: GeometrieAvis | undefined;
  for (let i = 0; i < nombre; i++) dernier = await attendreAvisDegage(page, lesAvis.nth(i));
  if (dernier === undefined) throw new Error("pile vide");
  expect(Math.abs(dernier.avis.bas - (dernier.hautBarres - 8))).toBeLessThanOrEqual(0.5);
}

test("390 px : AXIS affiché, « Signal d'achat » créé au toucher, la clôture d'achat pousse un avis qui reste", async ({ page }, testInfo) => {
  const flux = await demarrer(page);
  await afficherAxis(page);

  // Formulaire : AXIS S/R et AXIS en tête, sorties nommées, rien à deviner.
  const panneaux = await ouvrirAlertes(page);
  await panneaux.getByRole("combobox").filter({ has: page.locator('option[value="indicateur-seuil"]') }).selectOption("indicateur-seuil");
  const indicateur = panneaux.getByLabel("Indicateur de l'alerte");
  expect(await indicateur.locator("option").evaluateAll((options) => options.slice(0, 2).map((o) => o.textContent))).toEqual(["AXIS S/R", "AXIS"]);
  await indicateur.selectOption("stratAxis");
  const sortie = panneaux.getByLabel("Sortie de l'indicateur");
  expect(await sortie.locator("option").allTextContents()).toEqual(["Signal d'achat", "Signal de vente", "Non mesuré · Score (−6 à +6)"]);
  await sortie.selectOption({ label: "Signal d'achat" });
  // Comparateur et valeur sont posés d'office : aucun champ à remplir.
  await expect(panneaux.getByLabel("Comparateur")).toHaveCount(0);
  await expect(panneaux.getByPlaceholder("Seuil (ex. 70)")).toHaveCount(0);
  // La note dit la portée, le libellé exact, l'historique demandé (AXIS est déjà affiché : rien à
  // conseiller), d'où viennent les réglages et ce qui ne sonnera pas.
  const note = panneaux.locator("[data-note-alerte]");
  await expect(note.locator("p")).toHaveText([
    "Évaluée à chaque clôture 4h, application ouverte sur BTCUSDT 4h.",
    `Libellé : ${LIBELLE_ACHAT}`,
    "Évaluée seulement quand le graphe a chargé 1500 bougies.",
    "Réglages par défaut de l'indicateur, pas ceux de l'instance du graphe.",
    "Rien ne sonne application fermée ou téléphone verrouillé.",
  ]);
  await note.scrollIntoViewIfNeeded();
  await page.screenshot({ path: cheminCapture(testInfo, "formulaire-390x844.png"), animations: "disabled" });

  await panneaux.getByRole("button", { name: "Ajouter sur BTCUSDT" }).tap();
  const ligne = panneaux.locator("[data-alerte]");
  await expect(ligne).toHaveCount(1);
  await expect(ligne.locator("[data-libelle-alerte]")).toHaveText(`${LIBELLE_ACHAT} · 4h`);
  // Créée en cours de bougie : calibrée tout de suite sur la dernière bougie close (AXIS à plat : armée).
  await expect(ligne.locator("[data-etat-alerte]")).toHaveText("armée");
  await page.getByRole("button", { name: "Fermer les panneaux" }).tap();

  await cloturerAchat(page, flux);
  const lesAvis = avis(page);
  await expect(lesAvis).toHaveCount(1);
  expect(await texteAvis(lesAvis)).toBe(`BTCUSDT 4h — ${LIBELLE_ACHAT}`);
  await expect(lesAvis.getByRole("button", { name: "Voir", exact: true })).toBeVisible();
  await attendreAvisDegage(page, lesAvis);
  await page.screenshot({ path: cheminCapture(testInfo, "avis-390x844.png"), animations: "disabled" });

  // Il reste jusqu'au toucher : un avis ordinaire part après 2,5 s, 6 s avec un bouton.
  await page.waitForTimeout(7_000);
  await expect(lesAvis).toHaveCount(1);
  // La même clôture repoussée : ni second avis, ni seconde entrée au journal.
  flux.pousserCloture(ACHAT);
  await page.waitForTimeout(1_000);
  await expect(lesAvis).toHaveCount(1);

  // La navigation basse reste touchable sous l'avis : le tiroir s'ouvre, le journal compte une entrée.
  const tiroir = await ouvrirAlertes(page);
  await expect(tiroir.locator("[data-alerte] [data-etat-alerte]")).toHaveText("déclenchée");
  await tiroir.getByRole("button", { name: "Journal (1)" }).tap();
  const journal = tiroir.locator("[data-journal-alerte]");
  await expect(journal).toHaveCount(1);
  await expect(journal).toContainText(LIBELLE_ACHAT);
  await page.getByRole("button", { name: "Fermer les panneaux" }).tap();

  // « Voir » : la vue principale reste sur le marché et l'unité de l'alerte ; l'avis part au toucher.
  await lesAvis.getByRole("button", { name: "Voir", exact: true }).tap();
  await expect(lesAvis).toHaveCount(0);
  expect(await lireMarche(page)).toMatchObject({ symbol: "BTCUSDT", timeframe: "4h", focus: 0, bougies: AMORCE_AXIS + 1 });
});

test("390 px : une alerte de prix pousse aussi son avis, sans unité, et ne le double pas", async ({ page }) => {
  const flux = await demarrer(page);
  const panneaux = await ouvrirAlertes(page);
  await panneaux.getByPlaceholder("Niveau").fill("85000");
  await panneaux.getByRole("button", { name: "Ajouter sur BTCUSDT" }).tap();
  await expect(panneaux.locator("[data-alerte] [data-libelle-alerte]")).toHaveText("Prix franchit 85000 à la hausse");
  await page.getByRole("button", { name: "Fermer les panneaux" }).tap();

  // Le runtime ouvre le flux de prix de BTCUSDT pour cette alerte.
  await expect.poll(() => flux.ouverts().ticker).toBeGreaterThan(0);
  const lesAvis = avis(page);
  // Premier prix : calibrage, aucun avis.
  flux.pousserPrix(84_000);
  await page.waitForTimeout(500);
  await expect(lesAvis).toHaveCount(0);
  flux.pousserPrix(85_100);
  await expect(lesAvis).toHaveCount(1);
  expect(await texteAvis(lesAvis)).toBe("BTCUSDT — Prix franchit 85000 à la hausse");
  await expect(lesAvis.getByRole("button", { name: "Voir", exact: true })).toBeVisible();
  await attendreAvisDegage(page, lesAvis);
  // Le prix reste au-dessus : pas de second avis.
  flux.pousserPrix(85_200);
  await page.waitForTimeout(500);
  await expect(lesAvis).toHaveCount(1);
  // Un toucher sur l'avis le ferme.
  await lesAvis.tap({ position: { x: 12, y: 8 } });
  await expect(lesAvis).toHaveCount(0);
});

test("390 px : une alerte baleines ne désigne aucun marché — sa ligne ne navigue pas", async ({ page }) => {
  // Convention de @axiom/alerts : l'alerte est portée par l'actif surveillé (« USDT »), pas par un marché.
  const BALEINES = {
    id: "e2e-baleines", symbol: "USDT", source: "binance", actif: true, declenchements: [],
    condition: { type: "whale-flux", seuilUsd: 10_000_000, direction: "tous" },
  };
  await demarrer(page, [BALEINES]);
  const panneaux = await ouvrirAlertes(page);
  const ligne = panneaux.locator('[data-alerte="e2e-baleines"]');
  await expect(ligne.locator("[data-libelle-alerte]")).toHaveText("Baleine ≥ 10M $ (toutes directions)");
  const bouton = ligne.getByTitle("Actif surveillé : aucun marché à afficher");
  await expect(bouton).toBeDisabled();
  // Un appui quand même : la vue principale ne part pas sur « USDT », marché qui n'existe pas.
  await bouton.tap({ force: true });
  await page.waitForTimeout(500);
  expect(await lireMarche(page)).toMatchObject({ symbol: "BTCUSDT", timeframe: "4h" });
  await expect(page.locator("[data-chart-status]")).toHaveCount(0);
});

test.describe("écrans étroits", () => {
  // Du plus étroit au plus large ; 390 px est tenu par les parcours ci-dessus.
  const ECRANS = [
    { width: 320, height: 568 },
    { width: 360, height: 740 },
    { width: 375, height: 667 },
  ] as const;
  const THEMES = ["dark", "bloomberg"] as const;
  test.use({ viewport: ECRANS[0] });

  /** Deux alertes déjà enregistrées : l'achat d'AXIS, armé, et une réaction d'AXIS S/R que rien n'évaluera ici. */
  const ALERTES = [
    {
      id: "e2e-achat", symbol: "BTCUSDT", source: "binance", timeframe: "4h", actif: true, arme: true, declenchements: [],
      condition: { type: "indicateur-seuil", indicateurId: "stratAxis", params: {}, output: "etat", comparateur: ">=", valeur: 1 },
    },
    {
      id: "e2e-reaction", symbol: "BTCUSDT", source: "binance", timeframe: "4h", actif: true, declenchements: [],
      condition: { type: "indicateur-seuil", indicateurId: "stratAxisSr", params: {}, output: "reactionSupport", comparateur: ">=", valeur: 1 },
    },
  ];

  async function poserTheme(page: Page, theme: (typeof THEMES)[number] | "matrix"): Promise<void> {
    await changerTheme(page, theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  }

  /** Textes des avis de la pile, du plus ancien au plus récent, sans le libellé de leur bouton. */
  async function textesDesAvis(lesAvis: Locator): Promise<string[]> {
    const textes: string[] = [];
    for (let i = 0; i < (await lesAvis.count()); i++) textes.push(await texteAvis(lesAvis.nth(i)));
    return textes;
  }

  /** Dans la liste : chaque libellé lu en entier, « non mesuré » compris, et l'état de l'alerte que rien n'évalue. */
  async function verifierListe(panneaux: Locator, largeur: number): Promise<void> {
    const achat = panneaux.locator('[data-alerte="e2e-achat"]');
    const reaction = panneaux.locator('[data-alerte="e2e-reaction"]');
    await expect(achat.locator("[data-libelle-alerte]")).toHaveText(`${LIBELLE_ACHAT} · 4h`);
    // « non mesuré » juste après le nom, dans un texte lu en entier.
    await expect(reaction.locator("[data-libelle-alerte]")).toHaveText(`${LIBELLE_REACTION} · 4h`);
    for (const libelle of [achat.locator("[data-libelle-alerte]"), reaction.locator("[data-libelle-alerte]")]) {
      const lecture = await luEnEntier(libelle);
      expect(lecture, `libellé à ${largeur} px`).toMatchObject({ dansEcran: true, sansCoupe: true, decouvert: true });
      // À 320 px le libellé ne tient pas sur une ligne : il revient à la ligne au lieu d'être coupé.
      expect(lecture.lignes).toBeGreaterThanOrEqual(largeur === 320 ? 2 : 1);
    }
    // AXIS S/R demande 3 000 bougies ; seul AXIS est affiché, le graphe s'est arrêté à son amorce.
    const etat = reaction.locator("[data-etat-alerte]");
    await expect(etat).toHaveText("historique insuffisant : 1501 sur 3000, affichez l'indicateur");
    expect(await luEnEntier(etat), `état à ${largeur} px`).toMatchObject({ dansEcran: true, sansCoupe: true, decouvert: true });
  }

  test("320, 360 et 375 px, thème par défaut puis Bloomberg : l'avis tient dans l'écran au-dessus de la navigation, la liste se lit en entier", async ({ page }, testInfo) => {
    const flux = await demarrer(page, ALERTES);
    await afficherAxis(page);
    await cloturerAchat(page, flux);

    const lesAvis = avis(page);
    await expect(lesAvis).toHaveCount(1);
    expect(await texteAvis(lesAvis)).toBe(`BTCUSDT 4h — ${LIBELLE_ACHAT}`);

    // L'avis reste à l'écran d'une largeur à l'autre : sa boîte suit la fenêtre et la navigation.
    for (const ecran of ECRANS) {
      await page.setViewportSize(ecran);
      for (const theme of THEMES) {
        // Bloomberg : chasse fixe, caractères plus larges.
        await poserTheme(page, theme);
        await expect(lesAvis).toHaveCount(1);
        await attendreAvisDegage(page, lesAvis);
        if (ecran.width === 320) {
          await page.screenshot({ path: cheminCapture(testInfo, `avis-320x568${theme === "dark" ? "" : `-${theme}`}.png`), animations: "disabled" });
        }
      }
    }

    // Une fenêtre ouverte puis réduite, l'avis toujours là : la barre « Fenêtres ouvertes » paraît
    // au-dessus de la navigation basse. L'avis se pose au-dessus d'elle, ses boutons répondent.
    await page.setViewportSize(ECRANS[0]);
    await poserTheme(page, "dark");
    const sansBarre = await attendreAvisDegage(page, lesAvis);
    expect(sansBarre.barreFenetres).toBeNull();
    await reduireFenetreData(page);
    await expect(barreFenetres(page)).toBeVisible();
    await expect.poll(async () => (await mesurerAvis(page, lesAvis)).avis.bas).toBeLessThan(sansBarre.avis.bas);
    const avecBarre = await attendreAvisDegage(page, lesAvis);
    expect(avecBarre.barreFenetres).not.toBeNull();
    expect(avecBarre.barreFenetres!.haut).toBeLessThan(avecBarre.navigation.haut);
    // « Graphique », « Tout restaurer » et la fenêtre sont dans l'écran à 320 px (la croix se
    // découvre en faisant défiler la barre) : tous touchables, l'avis n'en recouvre aucun.
    expect(avecBarre.boutonsFenetresTouchables.length).toBeGreaterThanOrEqual(3);
    expect(avecBarre.boutonsFenetresTouchables).not.toContain(false);
    expect(Math.abs(avecBarre.avis.bas - (avecBarre.barreFenetres!.haut - 8))).toBeLessThanOrEqual(0.5);
    await page.screenshot({ path: cheminCapture(testInfo, "avis-barre-fenetres-320x568.png"), animations: "disabled" });
    // La fenêtre fermée par sa croix, la barre disparaît : l'avis redescend au-dessus de la navigation.
    await barreFenetres(page).getByRole("button", { name: "Fermer Sources de données" }).tap();
    await expect(barreFenetres(page)).toHaveCount(0);
    await expect.poll(async () => (await mesurerAvis(page, lesAvis)).avis.bas).toBe(sansBarre.avis.bas);
    await attendreAvisDegage(page, lesAvis);

    // L'avis toujours là, la navigation répond : le tiroir s'ouvre sur la liste.
    const panneaux = await ouvrirAlertes(page);
    await expect(panneaux.locator('[data-alerte="e2e-achat"] [data-etat-alerte]')).toHaveText("déclenchée");
    // L'avis est posé au-dessus de tout, bas du tiroir compris : il part au toucher, la liste se lit alors en entier.
    await lesAvis.tap({ position: { x: 12, y: 8 } });
    await expect(lesAvis).toHaveCount(0);
    for (const ecran of ECRANS) {
      await page.setViewportSize(ecran);
      for (const theme of THEMES) {
        await poserTheme(page, theme);
        await verifierListe(panneaux, ecran.width);
        if (ecran.width === 320) {
          await page.screenshot({ path: cheminCapture(testInfo, `liste-320x568${theme === "dark" ? "" : `-${theme}`}.png`), animations: "disabled" });
        }
      }
    }
  });

  test("320 px, quatre déclenchements non touchés : aucun avis d'alerte ne quitte l'écran sans trace, un avis ordinaire n'en chasse aucun, la pile reste dans l'écran", async ({ page }, testInfo) => {
    const seuil = (indicateurId: string, output: string, comparateur: string, valeur: number): unknown =>
      ({ type: "indicateur-seuil", indicateurId, params: {}, output, comparateur, valeur });
    const armee = { symbol: "BTCUSDT", source: "binance", actif: true, arme: true, declenchements: [] };
    /** Quatre alertes armées sur le même marché (ordre de création) : le RSI tire à l'ouverture, les trois autres à la clôture d'achat. */
    const QUATRE = [
      { ...armee, id: "e2e-1-achat", timeframe: "4h", condition: seuil("stratAxis", "etat", ">=", 1) },
      { ...armee, id: "e2e-2-rsi", timeframe: "4h", condition: seuil("rsi", "rsi", ">", 50) },
      { ...armee, id: "e2e-3-variation", timeframe: "4h", condition: { type: "variation-pct", fenetreMs: QUATRE_HEURES, seuilPct: 1 } },
      { ...armee, id: "e2e-4-achat-sans-unite", condition: seuil("stratAxis", "etat", ">=", 1) },
    ];
    const SYNTHESE = "+ 2 alertes plus anciennes — voir le journal";
    const VARIATION = "BTCUSDT 4h — Variation +1% sur 4 h";
    const SANS_UNITE = "BTCUSDT — AXIS non mesuré hors 4h · signal d'achat";

    const flux = await demarrer(page, QUATRE);
    const lesAvis = avis(page);
    // À l'ouverture le RSI est déjà au-dessus de 50 : son alerte, armée, tire, et son avis reste sans être touché.
    await expect(lesAvis).toHaveCount(1);
    expect(await textesDesAvis(lesAvis)).toEqual(["BTCUSDT 4h — rsi(rsi) > 50"]);
    await afficherAxis(page);
    await cloturerAchat(page, flux);

    // Trois autres alertes tirent sur la clôture d'achat : quatre avis pour trois places. Les deux
    // plus anciens (RSI, achat d'AXIS) deviennent UN avis de synthèse ; le journal garde les quatre.
    await expect(lesAvis).toHaveCount(3);
    expect(await textesDesAvis(lesAvis)).toEqual([SYNTHESE, VARIATION, SANS_UNITE]);
    expect(await lireJournal(page)).toEqual([
      "AXIS non mesuré hors 4h · signal d'achat",
      "Variation +1% sur 4 h",
      LIBELLE_ACHAT,
      "rsi(rsi) > 50",
    ]);
    // La synthèse ne désigne aucun marché : pas de « Voir » ; les deux autres le gardent.
    await expect(lesAvis.nth(0).getByRole("button")).toHaveCount(0);
    await expect(lesAvis.getByRole("button", { name: "Voir", exact: true })).toHaveCount(2);

    // La pile entière dans l'écran, au-dessus de la navigation qui reste touchable, dans les trois thèmes.
    for (const theme of ["dark", "bloomberg", "matrix"] as const) {
      await poserTheme(page, theme);
      await attendrePileDegagee(page, lesAvis, 3);
      await page.screenshot({ path: cheminCapture(testInfo, `pile-synthese-320x568${theme === "dark" ? "" : `-${theme}`}.png`), animations: "disabled" });
    }

    // Un avis ordinaire (retour d'une action) paraît sans chasser aucun avis d'alerte, en Matrix,
    // le thème le plus large : quatre avis, toujours dans l'écran.
    await pousserAvisOrdinaire(page, "Workspace enregistré");
    await attendrePileDegagee(page, lesAvis, 4);
    expect(await textesDesAvis(lesAvis)).toEqual([SYNTHESE, VARIATION, SANS_UNITE, "Workspace enregistré"]);
    await page.screenshot({ path: cheminCapture(testInfo, "pile-quatre-320x568-matrix.png"), animations: "disabled" });
    // Il part à son heure (2,5 s) ; les avis d'alerte restent, bien après.
    await expect(lesAvis).toHaveCount(3, { timeout: 6_000 });
    await page.waitForTimeout(4_000);
    expect(await textesDesAvis(lesAvis)).toEqual([SYNTHESE, VARIATION, SANS_UNITE]);

    // La synthèse part au toucher, comme tout avis ; les deux autres restent.
    await lesAvis.nth(0).tap({ position: { x: 12, y: 8 } });
    await expect(lesAvis).toHaveCount(2);
    expect(await textesDesAvis(lesAvis)).toEqual([VARIATION, SANS_UNITE]);
  });
});

// Intégration du 12 novembre 2026 : les deux lots au même toucher. Un avis d'alerte reste jusqu'au
// toucher, par-dessus le graphe ; l'encart du texte complet s'ouvre sous le doigt. Avant la borne
// posée à l'intégration, deux avis à l'écran, l'encart d'une bande basse passait sous la pile.
test("des avis d'alerte à l'écran, le doigt sur une bande forte puis sur un triangle creux : l'encart s'écrit au-dessus de la pile, à 390 × 844 et 320 × 568 en chasse fixe", async ({ page }, testInfo) => {
  const armee = { symbol: "BTCUSDT", source: "binance", timeframe: "4h", actif: true, arme: true, declenchements: [] };
  const DEUX = [
    { ...armee, id: "e2e-achat", condition: { type: "indicateur-seuil", indicateurId: "stratAxis", params: {}, output: "etat", comparateur: ">=", valeur: 1 } },
    { ...armee, id: "e2e-variation", condition: { type: "variation-pct", fenetreMs: QUATRE_HEURES, seuilPct: 1 } },
  ];
  // AXIS et AXIS S/R déjà affichés : le graphe remonte tout ce que la place sert (2 937 bougies),
  // AXIS S/R dessine ses zones (sous son amorce de 3 000 : son texte le dit, « sur 2938 bougies »).
  const flux = await demarrer(page, DEUX, ACHAT, [{ defId: "stratAxis", params: {} }, { defId: "stratAxisSr", params: {} }]);
  await expect.poll(async () => (await lireMarche(page)).bougies, { timeout: 60_000 }).toBe(ACHAT);
  await cloturerAchat(page, flux);
  const lesAvis = avis(page);
  await expect(lesAvis).toHaveCount(2);
  expect(await texteAvis(lesAvis.nth(0))).toBe(`BTCUSDT 4h — ${LIBELLE_ACHAT}`);
  await expect.poll(async () => (await lireAxisSr(page))?.calculees, { timeout: 60_000 }).toBe(ACHAT + 1);

  const lire = async (): Promise<LectureAxisSr> => {
    const lecture = await lireAxisSr(page);
    if (lecture === null) throw new Error("graphe actif absent");
    return lecture;
  };
  /** Boîtes des avis de la pile (px de la fenêtre), du plus ancien au plus récent. */
  const boitesAvis = () => lesAvis.evaluateAll((els) => els.map((el) => {
    const b = el.getBoundingClientRect();
    return { haut: b.top, bas: b.bottom, gauche: b.left, droite: b.right };
  }));
  /**
   * Pose le réticule sur la cible (jusqu'à trois appuis : le moteur efface d'abord un réticule
   * posé ailleurs), attend l'encart et son texte complet, et vérifie qu'aucun avis ne le recouvre.
   */
  async function toucher(cible: CibleAxisSr, nom: string): Promise<void> {
    for (let appui = 0; appui < 3; appui++) {
      await page.touchscreen.tap(cible.x, cible.y);
      if ((await lire()).reticule.paneId !== null) break;
      await page.waitForTimeout(600);
    }
    expect((await lire()).reticule).toEqual({ paneId: "candle_pane", dataIndex: cible.idx });
    await expect.poll(async () => {
      const lu = await lireEncart(page);
      return lu === null || lu.affichage === "none" ? "encart masqué" : lu.texte;
    }).toBe(cible.info);
    const encart = (await lireEncart(page))!;
    expect(encart.deborde, `${nom} : texte qui déborde`).toBe(false);
    expect(encart.fondAlpha).toBe(1);
    const basEncart = encart.boite.y + encart.boite.height;
    for (const boite of await boitesAvis()) {
      expect(basEncart, `${nom} : l'encart passe sous un avis`).toBeLessThanOrEqual(boite.haut + 0.5);
    }
  }

  const etapes = [
    { largeur: 390, hauteur: 844, theme: "dark", avisAttendus: 2, avecCreux: true },
    // Écran court : la zone libre ne contient l'encart qu'au-dessus d'UN avis (limite consignée au
    // contrat), et aucun triangle creux n'y est touchable entre les rangées de l'infobulle et l'avis.
    { largeur: 320, hauteur: 568, theme: "matrix", avisAttendus: 1, avecCreux: false },
  ] as const;
  for (const { largeur, hauteur, theme, avisAttendus, avecCreux } of etapes) {
    await test.step(`${largeur} × ${hauteur}, thème ${theme}, ${avisAttendus} avis`, async () => {
      if ((await lesAvis.count()) > avisAttendus) {
        // Un avis se ferme au toucher, les autres restent.
        await lesAvis.last().tap({ position: { x: 12, y: 8 } });
        await expect(lesAvis).toHaveCount(avisAttendus);
      }
      await redimensionner(page, largeur, hauteur);
      await changerTheme(page, theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      for (let i = 0; i < avisAttendus; i++) await attendreAvisDegage(page, lesAvis.nth(i));
      const lecture = await lire();
      const fortes = new Set(lecture.zones.filter((zone) => zone.alpha > 0).map((zone) => zone.info));
      // La bande forte touchable la plus basse : la plus proche de la pile d'avis.
      const bande = lecture.bandes
        .filter((cible) => fortes.has(cible.info) && !cible.marqueurSousLeDoigt)
        .reduce<CibleAxisSr | undefined>((bas, cible) => (bas === undefined || cible.y > bas.y ? cible : bas), undefined);
      expect(bande, "aucune bande forte touchable").toBeDefined();
      await toucher(bande!, "bande forte");
      await page.screenshot({ path: cheminCapture(testInfo, `ensemble-${largeur}x${hauteur}-zone.png`), animations: "disabled" });

      // Triangle creux : son texte s'ouvre par sa réserve, lue dans l'encart au-dessus de la pile.
      if (avecCreux) {
        const creux = lecture.creux.at(-1);
        expect(creux, "aucun triangle creux touchable").toBeDefined();
        expect(creux!.info).toMatch(/^[^—]*non mesuré/);
        await toucher(creux!, "triangle creux");
        await page.screenshot({ path: cheminCapture(testInfo, `ensemble-${largeur}x${hauteur}-creux.png`), animations: "disabled" });
      }

      // La pile est restée entière et dégagée : navigation basse touchable, avis dans l'écran.
      await expect(lesAvis).toHaveCount(avisAttendus);
      for (let i = 0; i < avisAttendus; i++) await attendreAvisDegage(page, lesAvis.nth(i));
    });
  }

  // Chaque avis reste fermable au toucher, l'encart affiché.
  await lesAvis.first().tap({ position: { x: 12, y: 8 } });
  await expect(lesAvis).toHaveCount(0);
});

test("390 px : place sans l'historique de l'amorce — « affichez l'indicateur » tant qu'il ne l'est pas, puis « N sur A » seul", async ({ page }, testInfo) => {
  // La place n'a que 1 200 bougies : AXIS en demande 1 500, aucun geste n'y changera rien.
  const SERVIES = 1200;
  const ALERTE_ACHAT = {
    id: "e2e-achat", symbol: "BTCUSDT", source: "binance", timeframe: "4h", actif: true, arme: true, declenchements: [],
    condition: { type: "indicateur-seuil", indicateurId: "stratAxis", params: {}, output: "etat", comparateur: ">=", valeur: 1 },
  };
  await demarrer(page, [ALERTE_ACHAT], SERVIES);

  // AXIS n'est pas sur la vue principale : l'afficher est le remède, la liste et le formulaire le disent.
  const chargees = (await lireMarche(page)).bougies;
  expect(chargees).toBeLessThan(AMORCE_AXIS);
  let panneaux = await ouvrirAlertes(page);
  const etat = panneaux.locator('[data-alerte="e2e-achat"] [data-etat-alerte]');
  await expect(etat).toHaveText(`historique insuffisant : ${chargees} sur 1500, affichez l'indicateur`);
  await panneaux.getByRole("combobox").filter({ has: page.locator('option[value="indicateur-seuil"]') }).selectOption("indicateur-seuil");
  await panneaux.getByLabel("Indicateur de l'alerte").selectOption("stratAxis");
  const note = panneaux.locator("[data-note-alerte]");
  await expect(note.locator("p").nth(2)).toHaveText("Évaluée seulement quand le graphe a chargé 1500 bougies : affichez AXIS.");
  await page.getByRole("button", { name: "Fermer les panneaux" }).tap();

  // AXIS affiché : le graphe remonte tout ce que la place a, et s'arrête à 1 200.
  await afficherAxis(page, SERVIES);
  panneaux = await ouvrirAlertes(page);
  // Plus de remède à conseiller : l'indicateur est affiché, c'est la source qui est à sec.
  await expect(etat).toHaveText("historique insuffisant : 1200 sur 1500");
  expect(await luEnEntier(etat)).toMatchObject({ dansEcran: true, sansCoupe: true, decouvert: true });
  await expect(note.locator("p").nth(2)).toHaveText("Évaluée seulement quand le graphe a chargé 1500 bougies.");
  await etat.scrollIntoViewIfNeeded();
  await page.screenshot({ path: cheminCapture(testInfo, "historique-court-390x844.png"), animations: "disabled" });
  // L'alerte n'a été ni calibrée ni évaluée : aucun avis, journal vide.
  await expect(avis(page)).toHaveCount(0);
  expect(await lireJournal(page)).toEqual([]);
});
