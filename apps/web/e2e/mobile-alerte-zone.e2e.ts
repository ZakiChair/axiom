import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import type { Chart } from "klinecharts";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";
import { avis, lireJournal, luEnEntier, mesurerAvis, ouvrirAlertes, preparerAxisAlertes, texteAvis, type FluxAxisAlertes } from "./helpers/axis-alertes-telephone";
import {
  BOUGIES,
  changerTheme,
  HORLOGE_AXIS_SR,
  horlogeDuNavigateur,
  lireAxisSr,
  lireEncart,
  lireSignauxDansBandesFortes,
  lireZonesAxisSr,
  redimensionner,
  type CibleAxisSr,
  type CibleSignalDansBande,
  type LectureAxisSr,
  type ZoneTracee,
} from "./helpers/axis-sr-telephone";

/**
 * Alerte de prix au bord d'une zone forte d'AXIS S/R, au téléphone, réseau fermé, sur le harnais
 * commun des parcours AXIS (`figerDate` : la date seule est figée, minuteries et peinture sont
 * celles du navigateur). Cas de référence : les 3 000 bougies BTCUSDT 4h, AXIS S/R affiché, cours
 * 77 582.02 ; le support fort le plus proche a son bord haut à 76 601.83.
 *
 * Ce que le parcours tient, sur le vrai graphe et le vrai moteur d'alertes :
 *  - le doigt sur la bande du support fort : l'encart écrit le texte de la zone ET, dessous, le
 *    bouton d'offre ; rien n'est recouvert (bandeau, bouton « Indicateurs (n) », navigation basse) ;
 *  - un toucher sur le bouton pose UNE alerte `prix-croise` au bord, à niveau fixe, qui expire dans
 *    7 jours ; un avis de pose porte « Annuler » ; l'encart et le réticule RESTENT, le bouton passe
 *    à « déjà posée » ; un second toucher n'ajoute rien ; « Annuler » supprime l'alerte et rend
 *    l'offre ;
 *  - le flux de prix passe sous le bord : UN avis « BTCUSDT — message », qui reste, une entrée au
 *    journal ; le message se lit en entier dans l'avis et dans la liste du panneau ;
 *  - la bande d'une zone faible : son texte, pas de bouton ;
 *  - rejeu actif sur la vue : le texte de la zone, pas de bouton ; le direct revenu, le bouton ;
 *  - le doigt sur un signal d'AXIS dessiné dans une bande forte : le texte d'AXIS et le bouton de
 *    la zone ; AXIS S/R fermé, ce texte reste et le bouton part avec la zone ;
 *  - à 320 × 568 en chasse fixe (Bloomberg) : texte de la zone lu en entier ; le bouton, quand la
 *    place le laisse rendre (voir plus bas), entier dans l'écran et dans l'encart, « niveau fixe »
 *    lisible ; avis et liste lus en entier, aussi en thème par défaut ;
 *  - JAMAIS un bouton hors de la zone libre du pane : il n'est rendu que si l'encart, bouton
 *    compris, y tient — sous l'ordonnée de l'infobulle, au-dessus du bouton « Indicateurs (n) »,
 *    du bas du pane et de la pile d'avis. En paysage 844 × 390 il ne tient pas : le texte de la
 *    zone seul, et un toucher sur « Indicateurs (n) » ouvre le panneau sans poser d'alerte. À
 *    320 × 568, sous un avis, de même ; l'avis fermé, le toucher suivant sur la bande le rend.
 *
 * Il prouve une géométrie et des textes dans le DOM, pas une lisibilité : les captures restent à
 * regarder. Il ne dit rien d'un vrai iPhone (police, zone de sécurité, barre de Safari), ni de
 * Safari en arrière-plan : l'alerte n'y est évaluée qu'application ouverte.
 *
 * WebKit ne tourne qu'en CI, et les thèmes écrivent dans les polices du système : un autre moteur
 * ou une autre machine peut donner une ligne de plus (15,4 px) au texte de la zone. À 320 × 568
 * en chasse fixe la zone libre (204 px) ne dépasse l'encart avec son bouton (195 px) que de 9 px,
 * mesure Chromium d'ici ; à 390 × 844 elle le dépasse de 300 px. Le parcours à 320 px tient donc
 * la RÈGLE (un bouton rendu est entier dans la zone libre ; sinon pas de bouton), pas la présence
 * du bouton, et note ce que le moteur a rendu (annotation « limite »). Sans bouton, l'alerte est
 * posée par le store, la même, pour que l'avis et la liste soient lus quand même.
 */
const BORD = 76601.83;
const OFFRE = "Alerte de prix ↓ 76,601.83 · bord du support fort · niveau fixe, 7 jours";
const POSEE = "Alerte déjà posée ↓ 76,601.83 · bord du support fort";
const SEPT_JOURS = 7 * 24 * 3_600_000;

/** « JJ/MM » de l'instant figé, en heure locale, comme le produit l'écrit (`formatDateCourte`). */
const DATE_POSE = new Date(HORLOGE_AXIS_SR).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
/** Message de l'alerte : ce que la liste, l'avis, le journal et les relais du daemon écrivent. */
const MESSAGE = `≤ 76,601.83 · bord du support fort AXIS S/R 4h du ${DATE_POSE} · niveau fixe`;
const AVIS_POSE = "Alerte de prix posée : BTCUSDT ↓ 76,601.83 · niveau fixe · expire dans 7 jours · sonne application ouverte seulement";

// Les attentes les plus longues : 30 s pour l'affichage, 60 s pour la remontée aux 3 000 bougies.
test.describe.configure({ timeout: 120_000 });

/** Dossier des captures à regarder : `AXIOM_CAPTURES` s'il est donné, sinon celui du test. */
function cheminCapture(testInfo: TestInfo, nom: string): string {
  const dossier = process.env.AXIOM_CAPTURES;
  if (dossier === undefined || dossier === "") return testInfo.outputPath(nom);
  mkdirSync(dossier, { recursive: true });
  return join(dossier, `${testInfo.project.name}-${nom}`);
}

/** Application ouverte après la dernière clôture du cas de référence, AXIS S/R déjà affiché et calculé sur 3 000 bougies. */
async function demarrer(page: Page): Promise<FluxAxisAlertes> {
  await bouchonnerReseau(page);
  const flux = await preparerAxisAlertes(page, { servies: BOUGIES.length, maintenant: HORLOGE_AXIS_SR, indicateurs: [{ defId: "stratAxisSr", params: {} }] });
  await page.goto("/");
  await expect(page.locator("[data-chart-status]")).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(async () => (await lireAxisSr(page))?.calculees, { timeout: 60_000 }).toBe(3000);
  // Garde du harnais commun : la date est figée, le graphe peint sur le vrai `requestAnimationFrame`.
  expect(await horlogeDuNavigateur(page, HORLOGE_AXIS_SR)).toEqual({ rafNatif: true, dateFigee: true });
  return flux;
}

async function lire(page: Page): Promise<LectureAxisSr> {
  const lecture = await lireAxisSr(page);
  if (lecture === null) throw new Error("graphe actif absent");
  return lecture;
}

/**
 * Pose le réticule sur la cible, au doigt (même geste que `mobile-axis-sr.e2e.ts`) : le moteur
 * efface d'abord un réticule posé ailleurs et ne compte pas un appui qui en suit un autre à moins
 * de 500 ms — jusqu'à trois appuis espacés de plus que ce délai.
 */
async function poserReticule(page: Page, cible: Pick<CibleAxisSr, "idx" | "x" | "y">): Promise<void> {
  for (let appui = 0; appui < 3; appui++) {
    await page.touchscreen.tap(cible.x, cible.y);
    if ((await lire(page)).reticule.paneId !== null) break;
    await page.waitForTimeout(600);
  }
  expect((await lire(page)).reticule).toEqual({ paneId: "candle_pane", dataIndex: cible.idx });
}

/** Support fort le plus proche du cours (bord haut le plus élevé), lu sur les rubans du vrai graphe. */
function supportProche(zones: ZoneTracee[]): ZoneTracee {
  const support = zones.filter((z) => z.forte && z.role === "support").sort((a, b) => b.haut - a.haut)[0];
  if (support === undefined) throw new Error("aucun support fort tracé");
  return support;
}

/** Dernière cible touchable dans la bande de `zone`, sans marqueur sous le doigt. */
async function cibleDans(page: Page, zone: ZoneTracee): Promise<CibleAxisSr> {
  const cible = (await lire(page)).bandes.filter((c) => c.info === zone.info && !c.marqueurSousLeDoigt).at(-1);
  expect(cible, `aucun point touchable dans la bande « ${zone.info.slice(0, 40)}… »`).toBeDefined();
  return cible!;
}

const bouton = (page: Page): Locator => page.locator("[data-candle-readout] [data-alerte-zone]");

/** Définitions d'alerte du store du produit. */
async function lireAlertes(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(async () => {
    const importer = new Function("return import('/src/store/alerts.ts')") as () => Promise<{ alertsStore: { getState: () => { defs: Array<Record<string, unknown>> } } }>;
    return (await importer()).alertsStore.getState().defs;
  });
}

/**
 * Pose l'alerte du bord par le store du produit : la def que le bouton crée. Pour le seul cas où
 * le moteur de rendu ne laisse pas au bouton la place d'être rendu (voir l'en-tête) : la suite
 * lit l'avis du déclenchement et la liste, qui ne dépendent pas du geste de pose.
 */
async function poserParLeStore(page: Page): Promise<void> {
  await page.evaluate(async ([niveau, message, expireTs]) => {
    const importer = new Function("return import('/src/store/alerts.ts')") as () => Promise<{ alertsStore: { getState: () => { ajouter: (def: object) => boolean } } }>;
    (await importer()).alertsStore.getState().ajouter({ symbol: "BTCUSDT", source: "binance", condition: { type: "prix-croise", niveau, sens: "baisse" }, message, expireTs });
  }, [BORD, MESSAGE, HORLOGE_AXIS_SR + SEPT_JOURS] as const);
}

/**
 * Rejeu sur la vue principale, par le drapeau du store que le graphe lit pour dire qu'une vue ne
 * suit plus le direct (`slotLive`). Un vrai rejeu demande le daemon et ses téléchargements : le
 * parcours, hermétique, ne tient que ce que le graphe fait de ce drapeau.
 */
async function basculerRejeu(page: Page, actif: boolean): Promise<void> {
  await page.evaluate(async (a) => {
    const importer = new Function("return import('/src/store/replay.ts')") as () => Promise<{ replayStore: { setState: (etat: object) => void } }>;
    (await importer()).replayStore.setState({ active: a, slot: 0 });
  }, actif);
}

/** Ajoute (`ajouter`) ou ferme (`fermer`) un indicateur par le store du produit, comme le menu et la croix de la légende. */
async function basculerIndicateur(page: Page, action: "ajouter" | "fermer", defId: string): Promise<void> {
  await page.evaluate(async ([a, id]) => {
    const importer = new Function("return import('/src/store/indicators.ts')") as () => Promise<{
      indicatorsStore: { getState: () => { indicators: Array<{ instanceId: string; defId: string }>; add: (defId: string) => void; remove: (instanceId: string) => void } };
    }>;
    const etat = (await importer()).indicatorsStore.getState();
    if (a === "ajouter") etat.add(id);
    else for (const instance of etat.indicators.filter((i) => i.defId === id)) etat.remove(instance.instanceId);
  }, [action, defId] as const);
}

type Boite = { haut: number; bas: number; gauche: number; droite: number };

/** Géométrie, en px de la fenêtre, de l'encart, de son bouton et de ce qu'ils ne doivent pas recouvrir. */
interface Geometrie {
  fenetre: { largeur: number; hauteur: number };
  encart: Boite;
  bouton: Boite;
  /** Bloc du texte de la zone. */
  texte: Boite;
  bandeau: Boite;
  indicateurs: Boite;
  navigation: Boite;
  /** Pile d'avis ; hauteur nulle quand elle est vide. */
  pile: Boite;
  /** L'élément sous le centre du bouton d'offre est ce bouton : rien n'est posé dessus. */
  boutonDecouvert: boolean;
  /** De même pour le bouton « Indicateurs (n) » : il reste touchable. */
  indicateursTouchable: boolean;
  /** Le libellé du bouton tient dans sa boîte, sans coupe. */
  libelleContenu: boolean;
}

async function mesurer(page: Page): Promise<Geometrie> {
  return page.evaluate(() => {
    const boite = (el: Element | null | undefined, nom: string): Boite => {
      if (!el) throw new Error(`${nom} absent`);
      const r = el.getBoundingClientRect();
      return { haut: r.top, bas: r.bottom, gauche: r.left, droite: r.right };
    };
    const decouvert = (el: Element | null | undefined): boolean => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const dessous = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return dessous !== null && el.contains(dessous);
    };
    const encart = document.querySelector("[data-candle-readout]");
    const offre = encart?.querySelector<HTMLElement>("[data-alerte-zone]");
    const indicateurs = Array.from(document.querySelectorAll("button")).find((b) => /^Indicateurs \(\d+\)/.test(b.textContent ?? ""));
    return {
      fenetre: { largeur: document.documentElement.clientWidth, hauteur: window.innerHeight },
      encart: boite(encart, "encart"),
      bouton: boite(offre, "bouton d'offre"),
      texte: boite(encart?.querySelector("[data-candle-readout-texte]"), "texte de l'encart"),
      bandeau: boite(document.querySelector("[data-chart-banner]"), "bandeau"),
      indicateurs: boite(indicateurs, "bouton Indicateurs"),
      navigation: boite(document.querySelector(".axiom-mobile-navigation"), "navigation basse"),
      pile: boite(document.querySelector("[data-pile-avis]"), "pile d'avis"),
      boutonDecouvert: decouvert(offre),
      indicateursTouchable: decouvert(indicateurs),
      libelleContenu: offre !== null && offre !== undefined && offre.scrollWidth <= offre.clientWidth + 1 && offre.scrollHeight <= offre.clientHeight + 1,
    };
  });
}

/** Deux boîtes se recouvrent, à un demi-pixel d'arrondi près. */
const seRecouvrent = (a: Boite, b: Boite): boolean => a.gauche < b.droite - 0.5 && b.gauche < a.droite - 0.5 && a.haut < b.bas - 0.5 && b.haut < a.bas - 0.5;

/**
 * Le bouton d'offre est rendu, donc ENTIER DANS LA ZONE LIBRE du pane des prix : dans l'écran et
 * dans l'encart, sous le texte de la zone, haut de 44 px au moins, son libellé non coupé et rien
 * posé dessus ; l'encart qui le porte ne recouvre ni le bandeau, ni le bouton « Indicateurs (n) »
 * (qui reste touchable), ni la navigation basse, et ne dépasse pas le bas du pane des prix (sous
 * lequel vit l'en-tête d'un pane d'indicateur). Bords mesurés par `getBoundingClientRect`, au
 * demi-pixel : un moteur peut arrondir autrement que Chromium. Vaut à toute taille d'écran et sous
 * tout moteur : faute de place, le bouton n'est pas rendu (`offreRendue`).
 * `sousAvis` : un avis est à l'écran — l'encart s'arrête au-dessus de la pile ; c'est l'avis, pas
 * l'encart, qui recouvre alors le bouton « Indicateurs (n) » (limite antérieure, au contrat).
 */
async function attendreBoutonDegage(page: Page, sousAvis = false): Promise<Geometrie> {
  let mesure: Geometrie | undefined;
  await expect(async () => {
    const g = await mesurer(page);
    const pane = (await lire(page)).pane;
    expect(g.encart.bas).toBeLessThanOrEqual(pane.y + pane.height + 0.5);
    expect(g.bouton.gauche).toBeGreaterThanOrEqual(g.encart.gauche - 0.5);
    expect(g.bouton.droite).toBeLessThanOrEqual(g.encart.droite + 0.5);
    expect(g.bouton.haut).toBeGreaterThanOrEqual(g.texte.bas - 0.5);
    expect(g.bouton.bas).toBeLessThanOrEqual(g.encart.bas + 0.5);
    expect(g.bouton.bas - g.bouton.haut).toBeGreaterThanOrEqual(43.5);
    expect(g.encart.gauche).toBeGreaterThanOrEqual(-0.5);
    expect(g.encart.droite).toBeLessThanOrEqual(g.fenetre.largeur + 0.5);
    expect(g.encart.haut).toBeGreaterThanOrEqual(-0.5);
    expect(g.encart.bas).toBeLessThanOrEqual(g.fenetre.hauteur + 0.5);
    expect(g.libelleContenu).toBe(true);
    expect(g.boutonDecouvert).toBe(true);
    for (const [nom, obstacle] of [["bandeau", g.bandeau], ["bouton Indicateurs", g.indicateurs], ["navigation basse", g.navigation]] as const) {
      expect(seRecouvrent(g.encart, obstacle), `l'encart recouvre : ${nom}`).toBe(false);
    }
    if (sousAvis) {
      expect(g.pile.bas - g.pile.haut).toBeGreaterThan(0);
      expect(g.encart.bas).toBeLessThanOrEqual(g.pile.haut + 0.5);
    } else {
      expect(g.indicateursTouchable).toBe(true);
    }
    mesure = g;
  }).toPass({ timeout: 10_000 });
  if (mesure === undefined) throw new Error("bouton non mesuré");
  return mesure;
}

/**
 * L'encart est à l'écran sur une bande forte, son texte attendu par l'appelant (le bouton est
 * rendu, ou non, dans le même instant que lui). LA RÈGLE : un bouton rendu est entier dans la zone
 * libre (`attendreBoutonDegage`) ; sinon il n'y a pas de bouton, et l'encart est celui du texte.
 * Rend la géométrie quand le bouton est rendu, `null` quand la place manque.
 */
async function offreRendue(page: Page, sousAvis = false): Promise<Geometrie | null> {
  if ((await bouton(page).count()) === 0) return null;
  return attendreBoutonDegage(page, sousAvis);
}

/** Le bouton « Indicateurs (n) » du graphe. */
const indicateurs = (page: Page): Locator => page.getByRole("button", { name: /^Indicateurs \(\d+\)/ });

/** Encart et pile d'avis, un avis à l'écran : le bouton est-il rendu, et où l'encart s'arrête-t-il ? */
interface SousAvis {
  bouton: boolean;
  hauteurEncart: number;
  basEncart: number;
  hautPile: number;
  hauteurPile: number;
}

/**
 * Un avis est à l'écran et l'encart a été relu (à l'image qui suit l'avis) : JAMAIS un bouton sous
 * un avis. Soit l'encart, bouton compris, tient au-dessus de la pile ; soit le bouton n'est pas
 * rendu. Rend la mesure.
 */
async function attendreSousAvis(page: Page): Promise<SousAvis> {
  let mesure: SousAvis | undefined;
  await expect(async () => {
    const g = await page.evaluate(() => {
      const encart = document.querySelector("[data-candle-readout]")!.getBoundingClientRect();
      const pile = document.querySelector("[data-pile-avis]")!.getBoundingClientRect();
      return {
        bouton: document.querySelector("[data-candle-readout] [data-alerte-zone]") !== null,
        hauteurEncart: encart.height,
        basEncart: encart.bottom,
        hautPile: pile.top,
        hauteurPile: pile.height,
      };
    });
    expect(g.hauteurPile).toBeGreaterThan(0);
    expect(g.hauteurEncart).toBeGreaterThan(0);
    if (g.bouton) expect(g.basEncart).toBeLessThanOrEqual(g.hautPile + 0.5);
    mesure = g;
  }).toPass({ timeout: 5_000 });
  if (mesure === undefined) throw new Error("encart non mesuré");
  return mesure;
}

/** Un toucher au centre du bouton, au doigt : grisé (`aria-disabled`), il reçoit le toucher comme un autre. */
async function toucherBouton(page: Page): Promise<void> {
  const boite = await bouton(page).boundingBox();
  if (boite === null) throw new Error("bouton d'offre absent");
  await page.touchscreen.tap(boite.x + boite.width / 2, boite.y + boite.height / 2);
}

/** L'avis d'alerte est entier dans l'écran, à 16 px de ses bords, au-dessus de la navigation basse, son texte non coupé. */
async function attendreAvisEntier(page: Page, avisUnique: Locator): Promise<void> {
  await expect(async () => {
    const g = await mesurerAvis(page, avisUnique);
    expect(g.avis.gauche).toBeGreaterThanOrEqual(15.5);
    expect(g.avis.droite).toBeLessThanOrEqual(g.fenetre.largeur - 15.5);
    expect(g.avis.haut).toBeGreaterThanOrEqual(0);
    expect(g.avis.bas).toBeLessThanOrEqual(g.hautBarres + 0.5);
    expect(g.texteContenu).toBe(true);
    expect(g.boutonsTouchables).not.toContain(false);
  }).toPass({ timeout: 10_000 });
}

/** Le flux pousse un prix au-dessus du bord (calibrage, aucun avis), puis un prix dessous : l'alerte sonne. */
async function franchirLeBord(page: Page, flux: FluxAxisAlertes): Promise<Locator> {
  // Le runtime ouvre le flux de prix de BTCUSDT pour cette alerte.
  await expect.poll(() => flux.ouverts().ticker).toBeGreaterThan(0);
  const declenchement = avis(page).filter({ hasText: "BTCUSDT — " });
  flux.pousserPrix(77_000);
  await page.waitForTimeout(500);
  await expect(declenchement).toHaveCount(0);
  flux.pousserPrix(76_500);
  await expect(declenchement).toHaveCount(1);
  expect(await texteAvis(declenchement)).toBe(`BTCUSDT — ${MESSAGE}`);
  return declenchement;
}

test("390 px : le doigt sur le support fort offre l'alerte de prix à son bord — posée, annulée, reposée, elle sonne quand le cours passe le bord", async ({ page }, testInfo) => {
  const flux = await demarrer(page);
  const zones = await lireZonesAxisSr(page);
  const support = supportProche(zones);
  // Le bord proposé est relu sur les rubans du vrai graphe : le haut du support fort le plus proche.
  expect(support.haut).toBeCloseTo(BORD, 2);
  // Message finissant par « · niveau fixe » (arbitrage du 12 novembre 2026) : 69 caractères.
  expect(MESSAGE).toHaveLength(69);

  // Sans toucher : pas d'encart, pas de bouton.
  await expect(bouton(page)).toHaveCount(0);

  // Le doigt dans la bande du support fort : le texte de la zone, et dessous le bouton d'offre.
  const cible = await cibleDans(page, support);
  await poserReticule(page, cible);
  await expect.poll(async () => (await lireEncart(page))?.texte).toBe(support.info);
  await expect(bouton(page)).toHaveText(OFFRE);
  await expect(bouton(page)).toHaveAttribute("data-alerte-zone", "offre");
  await expect(bouton(page)).not.toHaveAttribute("aria-disabled", "true");
  await attendreBoutonDegage(page);
  expect(await luEnEntier(bouton(page))).toMatchObject({ dansEcran: true, sansCoupe: true, decouvert: true });
  expect(await lireAlertes(page)).toEqual([]);
  await page.screenshot({ path: cheminCapture(testInfo, "390x844-offre.png"), animations: "disabled" });

  // Un toucher sur le bouton : UNE alerte de prix au bord, à niveau fixe, qui expire dans 7 jours.
  await toucherBouton(page);
  await expect.poll(async () => (await lireAlertes(page)).length).toBe(1);
  const [posee] = await lireAlertes(page);
  expect(posee).toMatchObject({
    symbol: "BTCUSDT",
    source: "binance",
    actif: true,
    condition: { type: "prix-croise", niveau: BORD, sens: "baisse" },
    message: MESSAGE,
    expireTs: HORLOGE_AXIS_SR + SEPT_JOURS,
  });
  // Alerte de prix : sans unité, évaluée à chaque prix reçu.
  expect(posee?.timeframe).toBeUndefined();
  // Avis de pose, avec « Annuler ».
  const lesAvis = avis(page);
  await expect(lesAvis).toHaveCount(1);
  expect(await texteAvis(lesAvis)).toBe(AVIS_POSE);
  await expect(lesAvis.getByRole("button", { name: "Annuler", exact: true })).toBeVisible();
  // L'encart et le réticule sont restés : le toucher du bouton n'a pas atteint le graphe.
  expect((await lire(page)).reticule).toEqual({ paneId: "candle_pane", dataIndex: cible.idx });
  expect(await lireEncart(page)).toMatchObject({ affichage: "grid", texte: support.info });
  // Le bouton, au même emplacement, dit que l'alerte existe ; grisé, sans effet.
  await expect(bouton(page)).toHaveText(POSEE);
  await expect(bouton(page)).toHaveAttribute("data-alerte-zone", "posee");
  await expect(bouton(page)).toHaveAttribute("aria-disabled", "true");
  // L'encart s'est replacé au-dessus de l'avis de pose : le bouton reste lisible.
  await attendreBoutonDegage(page, true);
  await page.screenshot({ path: cheminCapture(testInfo, "390x844-posee.png"), animations: "disabled" });

  // Second toucher, sur le bouton grisé : toujours une seule alerte, ni second avis, et l'encart reste.
  await toucherBouton(page);
  await page.waitForTimeout(500);
  expect(await lireAlertes(page)).toHaveLength(1);
  await expect(lesAvis).toHaveCount(1);
  expect((await lire(page)).reticule).toEqual({ paneId: "candle_pane", dataIndex: cible.idx });
  expect(await lireEncart(page)).toMatchObject({ affichage: "grid", texte: support.info });

  // « Annuler » : plus aucune alerte, le bouton revient à l'offre.
  await lesAvis.getByRole("button", { name: "Annuler", exact: true }).tap();
  await expect.poll(async () => (await lireAlertes(page)).length).toBe(0);
  await expect(lesAvis).toHaveCount(0);
  await expect(bouton(page)).toHaveText(OFFRE);
  await expect(bouton(page)).toHaveAttribute("data-alerte-zone", "offre");

  // Reposée. Son avis de pose est fermé au toucher : la suite ne suit que l'avis de l'alerte.
  await toucherBouton(page);
  await expect.poll(async () => (await lireAlertes(page)).length).toBe(1);
  await expect(lesAvis).toHaveCount(1);
  await lesAvis.tap({ position: { x: 12, y: 8 } });
  await expect(lesAvis).toHaveCount(0);

  // Le cours passe sous le bord : UN avis, « SYMBOLE — message », avec « Voir ».
  const declenchement = await franchirLeBord(page, flux);
  await expect(declenchement.getByRole("button", { name: "Voir", exact: true })).toBeVisible();
  await attendreAvisEntier(page, declenchement);
  expect(await lireJournal(page)).toEqual([MESSAGE]);
  await page.screenshot({ path: cheminCapture(testInfo, "390x844-declenchement.png"), animations: "disabled" });
  // Le cours reste sous le bord : pas de second avis. Et l'avis reste : un avis ordinaire à
  // bouton part après 6 s.
  flux.pousserPrix(76_400);
  await page.waitForTimeout(7_000);
  await expect(lesAvis).toHaveCount(1);
  expect(await texteAvis(lesAvis)).toBe(`BTCUSDT — ${MESSAGE}`);
  expect(await lireJournal(page)).toEqual([MESSAGE]);
  // L'alerte existe toujours (elle se réarme jusqu'à son échéance) : le bouton le dit encore.
  await expect(bouton(page)).toHaveText(POSEE);
  // Fermé au toucher : l'avis ne recouvre plus le bas du graphe pour la suite.
  await lesAvis.tap({ position: { x: 12, y: 8 } });
  await expect(lesAvis).toHaveCount(0);

  // La bande d'une zone FAIBLE : l'encart en écrit le texte, sans bouton.
  const faibles = zones.filter((z) => !z.forte).map((z) => z.info);
  const surFaible = (await lire(page)).bandes.filter((c) => faibles.includes(c.info) && !c.marqueurSousLeDoigt).at(-1);
  expect(surFaible, "aucune bande faible touchable").toBeDefined();
  await page.waitForTimeout(600);
  await poserReticule(page, surFaible!);
  await expect.poll(async () => (await lireEncart(page))?.texte).toBe(surFaible!.info);
  await expect(bouton(page)).toHaveCount(0);

  // REJEU actif sur la vue : le doigt sur la bande du support fort lit son texte, sans bouton.
  // Le direct revenu, le toucher suivant rend le bouton (l'alerte existe : « déjà posée »).
  await basculerRejeu(page, true);
  await page.waitForTimeout(600);
  await poserReticule(page, await cibleDans(page, support));
  await expect.poll(async () => (await lireEncart(page))?.texte).toBe(support.info);
  await expect(bouton(page)).toHaveCount(0);
  await basculerRejeu(page, false);
  const enDirect = await cibleDans(page, support);
  const autreBougie = (await lire(page)).bandes.filter((c) => c.info === support.info && !c.marqueurSousLeDoigt && c.idx !== enDirect.idx).at(-1);
  expect(autreBougie, "aucune autre bougie touchable dans la bande du support fort").toBeDefined();
  await page.waitForTimeout(600);
  await poserReticule(page, autreBougie!);
  await expect(bouton(page)).toHaveText(POSEE);

  // BOUTON D'UNE ZONE DISPARUE. Le doigt sur un signal d'AXIS dessiné DANS une bande forte :
  // l'encart écrit le texte d'AXIS, et dessous le bouton de la zone. AXIS S/R fermé, ce texte ne
  // change pas — rien ne réaffichait l'encart, le bouton restait, et son toucher posait l'alerte
  // au bord d'une zone que le graphe ne traçait plus (revue du lot). Le bouton part avec la zone.
  // AXIS S/R pose son propre marqueur sur la bougie d'un signal d'AXIS, et à égalité l'encart écrit
  // le texte de l'indicateur monté d'abord : AXIS est donc monté AVANT AXIS S/R, refermé puis
  // rajouté (l'ordre qu'obtient qui affiche AXIS puis AXIS S/R).
  await basculerIndicateur(page, "fermer", "stratAxisSr");
  await basculerIndicateur(page, "ajouter", "stratAxis");
  await basculerIndicateur(page, "ajouter", "stratAxisSr");
  await expect.poll(async () => (await lire(page)).indicateurs.map((i) => `${i.defId} ${i.calculees}`), { timeout: 60_000 }).toEqual(["stratAxis 3000", "stratAxisSr 3000"]);
  // Le graphe est ramené vers le passé, fenêtre après fenêtre (40 bougies, moins qu'un écran),
  // jusqu'à montrer un tel signal : la fixture en porte un à la bougie 2 850, dans la bande de la
  // résistance forte, puis aux bougies 2 697, 2 559 et 2 552. Le zoom reste celui du graphe
  // (6 px par bougie), celui des appuis des autres parcours.
  let signaux: CibleSignalDansBande[] = [];
  for (let fin = 3000; fin >= 2560 && signaux.length === 0; fin -= 40) {
    await page.evaluate(async (derniere) => {
      const importer = new Function("return import('/src/chart/drawing.ts')") as () => Promise<{ getActiveChart: () => Chart | null }>;
      (await importer()).getActiveChart()?.scrollToDataIndex(derniere - 1);
    }, fin);
    await page.waitForTimeout(300);
    signaux = await lireSignauxDansBandesFortes(page);
  }
  const signal = signaux[0];
  expect(signal, "aucun signal d'un autre indicateur dans une bande forte").toBeDefined();
  await page.waitForTimeout(600);
  await poserReticule(page, signal!);
  // Le texte d'un marqueur d'AXIS sur cette bougie (deux peuvent s'y superposer), pas celui d'une
  // zone. L'encart arrête un signal confirmé après son détail, suivi de « … » (`texteEncart`).
  const texteAxis = (await lireEncart(page))?.texte ?? "";
  expect(texteAxis.length).toBeGreaterThan(20);
  expect(signaux.some((s) => s.idx === signal!.idx && s.info.startsWith(texteAxis.replace(/ …$/, "")))).toBe(true);
  expect((await lireZonesAxisSr(page)).map((z) => z.info)).not.toContain(texteAxis);
  await expect(bouton(page)).toHaveText(/ · bord (du support fort|de la résistance forte)/);
  const avantFermeture = await lireAlertes(page);
  await basculerIndicateur(page, "fermer", "stratAxisSr");
  await expect.poll(async () => (await lireZonesAxisSr(page)).length).toBe(0);
  await expect(bouton(page)).toHaveCount(0);
  // L'encart et son texte, eux, sont restés : c'est bien l'offre seule qui a été relue.
  expect(await lireEncart(page)).toMatchObject({ affichage: "grid", texte: texteAxis });
  expect(await lireAlertes(page)).toEqual(avantFermeture);
});

test("paysage puis 320 × 568, en chasse fixe : jamais un bouton hors de la zone libre ; message lu en entier dans l'avis et dans la liste", async ({ page }, testInfo) => {
  // PAYSAGE 844 × 390, chasse fixe. Le pane des prix y est court : l'encart avec son bouton n'y
  // tient pas (mesure Chromium : 149 px pour 119 libres). Avant la correction de la revue du lot,
  // le bouton débordait sur « Indicateurs (n) » et en captait le toucher : un appui au centre de
  // « Indicateurs (1) » posait une alerte au lieu d'ouvrir le panneau.
  await page.setViewportSize({ width: 844, height: 390 });
  const flux = await demarrer(page);
  await changerTheme(page, "bloomberg");
  const support = supportProche(await lireZonesAxisSr(page));
  expect(support.haut).toBeCloseTo(BORD, 2);
  /** Dernière bougie touchable de la bande du support fort, hors `sauf`, une fois le graphe remis en page. */
  const viser = async (sauf?: number): Promise<CibleAxisSr> => {
    let trouvee: CibleAxisSr | undefined;
    await expect.poll(async () => {
      trouvee = (await lire(page)).bandes.filter((c) => c.info === support.info && !c.marqueurSousLeDoigt && c.idx !== sauf).at(-1);
      return trouvee !== undefined;
    }, { message: "aucune bougie touchable dans la bande du support fort" }).toBe(true);
    return trouvee!;
  };
  await poserReticule(page, await viser());
  await expect.poll(async () => (await lireEncart(page))?.texte).toBe(support.info);
  const enPaysage = await offreRendue(page);
  testInfo.annotations.push({
    type: "limite",
    description: `paysage 844 × 390 Bloomberg : bouton d'offre ${enPaysage ? "rendu, entier dans la zone libre" : "non rendu, l'encart avec lui ne tient pas dans la zone libre"} ; encart de ${Math.round((await lireEncart(page))!.boite.height)} px pour un pane des prix de ${Math.round((await lire(page)).pane.height)} px`,
  });
  await page.screenshot({ path: cheminCapture(testInfo, "844x390-bloomberg-zone.png"), animations: "disabled" });
  // Un vrai toucher au centre de « Indicateurs (n) », sans attendre qu'il soit dégagé : il ouvre
  // son panneau, et ne pose rien.
  const boiteIndicateurs = (await indicateurs(page).boundingBox())!;
  const centre = { x: boiteIndicateurs.x + boiteIndicateurs.width / 2, y: boiteIndicateurs.y + boiteIndicateurs.height / 2 };
  await page.touchscreen.tap(centre.x, centre.y);
  await expect(indicateurs(page)).toHaveAttribute("aria-expanded", "true");
  expect(await lireAlertes(page)).toEqual([]);
  await expect(avis(page)).toHaveCount(0);
  await page.touchscreen.tap(centre.x, centre.y);
  await expect(indicateurs(page)).toHaveAttribute("aria-expanded", "false");

  // ROTATION vers 320 × 568, toujours en chasse fixe.
  await redimensionner(page, 320, 568);
  // Sur cet écran le support fort n'est touchable qu'au ras du bouton « Indicateurs (n) », à sa
  // droite : sa bande est au bas de la fenêtre de prix. Le graphe est dézoomé (4 px par bougie,
  // ce qu'un pincement fait) pour que plusieurs bougies restent à droite du bouton, quelle que
  // soit sa largeur sous la police du moteur. Playwright n'a pas de geste de pincement.
  await page.evaluate(async () => {
    const importer = new Function("return import('/src/chart/drawing.ts')") as () => Promise<{ getActiveChart: () => Chart | null }>;
    (await importer()).getActiveChart()?.setBarSpace(4);
  });
  const cible = await viser();
  await page.waitForTimeout(600);
  await poserReticule(page, cible);
  await expect.poll(async () => (await lireEncart(page))?.texte).toBe(support.info);
  // Le texte de la zone se lit en entier, bouton ou non. (L'encart est traversable hors de son
  // bouton : « rien par-dessus » ne se lit, pour son texte, que par la géométrie et sur la capture.)
  expect((await lireEncart(page))?.deborde).toBe(false);
  expect(await luEnEntier(page.locator("[data-candle-readout-texte]"))).toMatchObject({ dansEcran: true, sansCoupe: true });
  // LA RÈGLE, sur l'écran où la place est la plus comptée : rendu, le bouton est entier dans la
  // zone libre, dans l'écran et dans l'encart, son libellé — « niveau fixe » compris — lu en
  // entier ; sinon il n'est pas rendu. Ce que le moteur a fait est noté (LIMITE consignée : sur cet
  // écran l'encart, bouton compris, occupe l'essentiel du pane des prix).
  const offre = await offreRendue(page);
  const pane = (await lire(page)).pane;
  if (offre !== null) {
    await expect(bouton(page)).toHaveText(OFFRE);
    expect(await luEnEntier(bouton(page))).toMatchObject({ dansEcran: true, sansCoupe: true, decouvert: true });
    expect(OFFRE).toContain("niveau fixe");
  }
  testInfo.annotations.push({
    type: "limite",
    description: offre !== null
      ? `320 × 568 Bloomberg : encart de ${Math.round(offre.encart.bas - offre.encart.haut)} px avec le bouton (${Math.round(offre.bouton.bas - offre.bouton.haut)} px), pour un pane des prix de ${Math.round(pane.height)} px ; il s'arrête à ${Math.round(offre.indicateurs.haut - offre.encart.bas)} px du bouton « Indicateurs »`
      : `320 × 568 Bloomberg : bouton d'offre non rendu sous ce moteur, l'encart avec lui ne tient pas dans la zone libre (encart du texte : ${Math.round((await lireEncart(page))!.boite.height)} px, pane des prix : ${Math.round(pane.height)} px)`,
  });
  await page.screenshot({ path: cheminCapture(testInfo, "320x568-bloomberg-offre.png"), animations: "disabled" });

  const lesAvis = avis(page);
  if (offre !== null) {
    // Posée : l'avis de pose paraît. Sur cet écran court, l'encart avec son bouton ne tient pas
    // au-dessus de lui : le bouton, qui passerait sous l'avis, n'est pas rendu ; le texte de la
    // zone reste. (Sur un moteur dont la police laisserait la place, le bouton reste : l'attente
    // ne tient que la règle — jamais un bouton sous un avis.)
    await toucherBouton(page);
    await expect.poll(async () => (await lireAlertes(page)).length).toBe(1);
    await expect(lesAvis).toHaveCount(1);
    expect(await texteAvis(lesAvis)).toBe(AVIS_POSE);
    const sousPose = await attendreSousAvis(page);
    expect(await lireEncart(page)).toMatchObject({ affichage: "grid", texte: support.info });
    testInfo.annotations.push({
      type: "limite",
      description: `320 × 568 Bloomberg, avis de pose de ${Math.round(sousPose.hauteurPile)} px à l'écran : bouton ${sousPose.bouton ? "rendu" : "non rendu"}, encart de ${Math.round(sousPose.hauteurEncart)} px à ${Math.round(sousPose.hautPile - sousPose.basEncart)} px au-dessus de l'avis`,
    });
    await lesAvis.tap({ position: { x: 12, y: 8 } });
    await expect(lesAvis).toHaveCount(0);
  } else {
    // Pas de bouton sous ce moteur : la même alerte, par le store (voir l'en-tête).
    await poserParLeStore(page);
  }
  expect(await lireAlertes(page)).toMatchObject([{ condition: { type: "prix-croise", niveau: BORD, sens: "baisse" }, message: MESSAGE, expireTs: HORLOGE_AXIS_SR + SEPT_JOURS }]);
  // Aucun avis à l'écran : le toucher suivant sur la bande (une autre bougie) rend le bouton là
  // où il tenait — son texte, plus court que l'offre, n'y prend pas plus de place —, et il dit
  // que l'alerte existe.
  await page.waitForTimeout(600);
  await poserReticule(page, await viser(cible.idx));
  await expect.poll(async () => (await lireEncart(page))?.texte).toBe(support.info);
  const posee = await offreRendue(page);
  if (offre !== null) expect(posee, "le bouton tenait avant l'avis : il doit revenir").not.toBeNull();
  if (posee !== null) {
    await expect(bouton(page)).toHaveText(POSEE);
    await expect(bouton(page)).toHaveAttribute("aria-disabled", "true");
  }
  expect(await lireAlertes(page)).toHaveLength(1);

  // Le cours passe sous le bord : l'avis se lit en entier, en chasse fixe puis en thème par défaut.
  const declenchement = await franchirLeBord(page, flux);
  await attendreAvisEntier(page, declenchement);
  expect(await luEnEntier(declenchement)).toMatchObject({ dansEcran: true, sansCoupe: true, decouvert: true });
  await attendreSousAvis(page);
  await page.screenshot({ path: cheminCapture(testInfo, "320x568-bloomberg-declenchement.png"), animations: "disabled" });
  await changerTheme(page, "dark");
  await attendreAvisEntier(page, declenchement);
  expect(await luEnEntier(declenchement)).toMatchObject({ dansEcran: true, sansCoupe: true, decouvert: true });
  await page.screenshot({ path: cheminCapture(testInfo, "320x568-defaut-declenchement.png"), animations: "disabled" });
  await declenchement.tap({ position: { x: 12, y: 8 } });
  await expect(lesAvis).toHaveCount(0);

  // Dans la liste du panneau : le même message, en entier, sans rien par-dessus — thème par défaut puis chasse fixe.
  const panneaux = await ouvrirAlertes(page);
  const libelle = panneaux.locator("[data-alerte] [data-libelle-alerte]");
  await expect(libelle).toHaveText(MESSAGE);
  expect(await luEnEntier(libelle)).toMatchObject({ dansEcran: true, sansCoupe: true, decouvert: true });
  await changerTheme(page, "bloomberg");
  await expect(libelle).toHaveText(MESSAGE);
  expect(await luEnEntier(libelle)).toMatchObject({ dansEcran: true, sansCoupe: true, decouvert: true });
  await page.screenshot({ path: cheminCapture(testInfo, "320x568-bloomberg-liste.png"), animations: "disabled" });
});
