import type { Locator, Page, WebSocketRoute } from "@playwright/test";
import { BOUGIES, figerDate, persisterBtc4h, QUATRE_HEURES, reglerDate, servirKlines } from "./axis-sr-telephone";

/**
 * Aide du parcours « alertes d'AXIS au téléphone » (mobile-axis-alertes.e2e.ts). Réseau fermé :
 * les bougies viennent du cas de référence du dépôt (BTCUSDT 4h, 3 000 bougies), servies jusqu'à
 * un indice choisi ; la clôture suivante est POUSSÉE par le flux kline du graphe principal, comme
 * la place le ferait. Aucune horloge de test : seule `Date` est figée (et réglable), les minuteurs
 * et la peinture du graphe tournent normalement.
 *
 * Harnais commun avec `axis-sr-telephone.ts` (intégration du 12 novembre 2026) : la fixture, la
 * date figée (`figerDate`, déplacée par `reglerDate`), l'état persisté et la route des klines en
 * viennent. Seuls les flux poussés et les lectures propres aux alertes sont ici.
 */

export { BOUGIES, QUATRE_HEURES };

/** Ouverture (ms) de la bougie d'indice `i`. */
export function ouverture(i: number): number {
  const ligne = BOUGIES[i];
  if (ligne === undefined) throw new Error(`bougie ${i} absente de la fixture`);
  return ligne[0];
}

export interface OptionsAxisAlertes {
  /** Nombre de bougies servies par la place : indices 0 à `servies − 1`. */
  servies: number;
  /** Instant initial de `Date` dans la page (ms). */
  maintenant: number;
  /** Définitions d'alerte déjà enregistrées (forme persistée de `axiom:alerts:v1`). */
  alertes?: unknown[];
  /** Indicateurs déjà persistés sur la vue principale (défaut : aucun). */
  indicateurs?: Parameters<typeof persisterBtc4h>[1];
}

/** Flux de marché bouchonnés : ce que le parcours pousse vers la page. */
export interface FluxAxisAlertes {
  /** Règle `Date` dans la page (les minuteurs ne sont pas touchés). */
  reglerHorloge: (maintenant: number) => Promise<void>;
  /** Pousse la clôture de la bougie d'indice `i` sur le flux kline BTCUSDT 4h ; rend le nombre de sockets servies. */
  pousserCloture: (i: number) => number;
  /** Pousse un prix sur le flux ticker BTCUSDT ; rend le nombre de sockets servies. */
  pousserPrix: (prix: number) => number;
  /** Sockets kline et ticker ouvertes par la page. */
  ouverts: () => { kline: number; ticker: number };
  /** La place coupe le flux kline : chaque socket tenue est fermée ; rend leur nombre. La page se reconnecte d'elle-même. */
  couperKline: () => number;
  /** Connexions kline ouvertes par la page depuis le début, reconnexions comprises. */
  connexionsKline: () => number;
}

/**
 * À installer APRÈS `bouchonnerReseau` (les routes les plus récentes priment) : BTCUSDT 4h sur la
 * vue principale, sans indicateur sauf `indicateurs` ; klines servies depuis la fixture en respectant `startTime`,
 * `endTime` et `limit`, comme Binance ; flux kline 4h et ticker de BTCUSDT tenus par le test.
 * BTCUSDT est aussi le symbole de référence par défaut : la même route sert le garde-fou de régime.
 */
export async function preparerAxisAlertes(page: Page, options: OptionsAxisAlertes): Promise<FluxAxisAlertes> {
  await figerDate(page, options.maintenant);
  await persisterBtc4h(page, options.indicateurs);
  await page.addInitScript((alertes) => {
    if (alertes !== null && !localStorage.getItem("axiom:alerts:v1")) {
      localStorage.setItem("axiom:alerts:v1", JSON.stringify({ defs: alertes, journal: [] }));
    }
  }, options.alertes ?? null);
  await servirKlines(page, BOUGIES.slice(0, options.servies));

  // Flux tenus par le test : la socket s'ouvre côté page, rien ne part vers la place.
  const kline = new Set<WebSocketRoute>();
  const ticker = new Set<WebSocketRoute>();
  let connexionsKline = 0;
  const tenir = (sockets: Set<WebSocketRoute>) => (socket: WebSocketRoute) => {
    if (sockets === kline) connexionsKline += 1;
    sockets.add(socket);
    socket.onMessage(() => {});
    socket.onClose(() => {
      sockets.delete(socket);
    });
  };
  await page.routeWebSocket(/stream\.binance\.com(:\d+)?\/ws\/btcusdt@kline_4h$/, tenir(kline));
  await page.routeWebSocket(/stream\.binance\.com(:\d+)?\/stream\?streams=.*btcusdt@ticker/, tenir(ticker));

  return {
    reglerHorloge: (maintenant) => reglerDate(page, maintenant),
    pousserCloture: (i) => {
      const ligne = BOUGIES[i];
      if (ligne === undefined) throw new Error(`bougie ${i} absente de la fixture`);
      const [t, o, h, l, c, v, achat] = ligne;
      const message = JSON.stringify({
        e: "kline", E: t + QUATRE_HEURES, s: "BTCUSDT",
        k: { t, T: t + QUATRE_HEURES - 1, s: "BTCUSDT", i: "4h", o: String(o), c: String(c), h: String(h), l: String(l), v: String(v), n: 1, x: true, q: String(v * c), V: String(achat), Q: String(achat * c) },
      });
      for (const socket of kline) socket.send(message);
      return kline.size;
    },
    pousserPrix: (prix) => {
      const message = JSON.stringify({ stream: "btcusdt@ticker", data: { e: "24hrTicker", s: "BTCUSDT", c: String(prix), P: "0", q: "0" } });
      for (const socket of ticker) socket.send(message);
      return ticker.size;
    },
    ouverts: () => ({ kline: kline.size, ticker: ticker.size }),
    couperKline: () => {
      const coupees = [...kline];
      for (const socket of coupees) {
        kline.delete(socket);
        void socket.close();
      }
      return coupees.length;
    },
    connexionsKline: () => connexionsKline,
  };
}

/** Pages d'historique retenues par `retenirPagesHistorique`. */
export interface PagesRetenues {
  /** Laisse passer les pages retenues et toutes les suivantes. */
  liberer: () => void;
  /** Pages en attente. */
  retenues: () => number;
}

/**
 * Retient les pages d'historique de la place — requêtes klines portant `endTime` : extension du
 * graphe, pages suivantes de la référence du garde-fou — jusqu'à `liberer()` ; le backfill (sans
 * `endTime`) passe. À installer APRÈS `preparerAxisAlertes` (la route la plus récente prime) : la
 * page libérée est servie par la route de la fixture (`route.fallback`). Sert à lire l'état de la
 * liste pendant la remontée de l'historique, qui sinon dure quelques millisecondes.
 */
export async function retenirPagesHistorique(page: Page): Promise<PagesRetenues> {
  let ouvrir: () => void = () => {};
  const porte = new Promise<void>((resolve) => {
    ouvrir = resolve;
  });
  let ouverte = false;
  let enAttente = 0;
  await page.route("**/api.binance.com/api/v3/klines*", async (route) => {
    if (!ouverte && new URL(route.request().url()).searchParams.has("endTime")) {
      enAttente += 1;
      await porte;
      enAttente -= 1;
    }
    await route.fallback();
  });
  return {
    liberer: () => {
      ouverte = true;
      ouvrir();
    },
    retenues: () => enAttente,
  };
}

/** État du graphe principal, tel que le runtime des alertes le lit (`marketStore`). */
export interface LectureMarche {
  symbol: string;
  timeframe: string;
  /** Bougies du tampon, bougie en formation comprise. */
  bougies: number;
  /** Ouverture de la dernière bougie du tampon. */
  derniere: number | null;
  /** Slot focalisé de la grille (0 = vue principale). */
  focus: number;
}

type ModulesMarche = [
  { marketStore: { getState: () => { symbol: string; timeframe: string; candles: Array<{ time: number }> } } },
  { chartLayoutStore: { getState: () => { focus: number } } },
];

export async function lireMarche(page: Page): Promise<LectureMarche> {
  return page.evaluate(async () => {
    const importer = new Function("return Promise.all([import('/src/store/market.ts'), import('/src/store/chart-layout.ts')])") as () => Promise<ModulesMarche>;
    const [marche, grille] = await importer();
    const { symbol, timeframe, candles } = marche.marketStore.getState();
    return { symbol, timeframe, bougies: candles.length, derniere: candles[candles.length - 1]?.time ?? null, focus: grille.chartLayoutStore.getState().focus };
  });
}

/** Change de thème par le store du produit (comme le sélecteur des Réglages). */
export async function changerTheme(page: Page, theme: "dark" | "bloomberg" | "matrix"): Promise<void> {
  await page.evaluate(async (id) => {
    const importer = new Function("return import('/src/store/theme.ts')") as () => Promise<{ themeStore: { getState: () => { setTheme: (t: string) => void } } }>;
    (await importer()).themeStore.getState().setTheme(id);
  }, theme);
}

const menuMobile = (page: Page): Locator => page.locator(".axiom-mobile-menu-root").last();

/** Ouvre « Options », ajoute AXIS (et non AXIS S/R) au toucher, referme. */
export async function ajouterAxis(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Options", exact: true }).tap();
  const options = page.getByRole("dialog", { name: "Options du graphique" });
  await options.getByRole("button", { name: /^Stratégies/ }).tap();
  await menuMobile(page).getByPlaceholder(/^Rechercher/).fill("AXIS");
  await menuMobile(page).locator("[data-item-strategie]").filter({ has: page.getByText("AXIS", { exact: true }) }).tap();
  await menuMobile(page).getByRole("button", { name: "Fermer Stratégies" }).tap();
  await page.getByRole("button", { name: "Fermer les options" }).tap();
}

/** Bouton « Panneaux » de la navigation basse. */
export const boutonPanneaux = (page: Page): Locator =>
  page.getByRole("navigation", { name: "Navigation du terminal" }).getByRole("button", { name: "Panneaux", exact: true });

/** Ouvre le tiroir Panneaux et la section Alertes (repliée par défaut) ; rend le tiroir. */
export async function ouvrirAlertes(page: Page): Promise<Locator> {
  await boutonPanneaux(page).tap();
  const panneaux = page.getByRole("dialog", { name: "Panneaux du terminal", exact: true });
  const section = panneaux.getByRole("button", { name: /^Alertes \d+ alerte/ });
  if ((await section.getAttribute("aria-expanded")) !== "true") await section.tap();
  return panneaux;
}

/** Avis à l'écran (pile des toasts), du plus ancien au plus récent. */
export const avis = (page: Page): Locator => page.locator('[aria-live="polite"] > [role="button"]');

/** Texte d'un avis sans le libellé de son bouton d'action. */
export async function texteAvis(avisUnique: Locator): Promise<string> {
  return avisUnique.evaluate((el) => Array.from(el.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? "").join(""));
}

/** Barre « Fenêtres ouvertes » : dans le flux, juste au-dessus de la navigation basse, dès qu'une fenêtre est ouverte ou réduite. */
export const barreFenetres = (page: Page): Locator => page.getByRole("toolbar", { name: "Fenêtres ouvertes" });

/** Ouvre la fenêtre DATA par le menu « Fonctions », puis la réduit : la barre « Fenêtres ouvertes » paraît. */
export async function reduireFenetreData(page: Page): Promise<void> {
  await page.getByRole("navigation", { name: "Navigation du terminal" }).getByRole("button", { name: "Fonctions", exact: true }).tap();
  await page.getByRole("menuitem", { name: /^DATA\b/ }).tap();
  const fenetre = page.getByRole("complementary", { name: "Sources de données" });
  await fenetre.getByTitle("Réduire", { exact: true }).tap();
}

/** Géométrie d'un avis et des barres du bas de l'écran, en px de la fenêtre. */
export interface GeometrieAvis {
  fenetre: { largeur: number; hauteur: number };
  avis: { gauche: number; droite: number; haut: number; bas: number };
  navigation: { haut: number; bas: number };
  /** Barre « Fenêtres ouvertes » ; `null` quand aucune fenêtre n'est ouverte. */
  barreFenetres: { haut: number; bas: number } | null;
  /** Haut de la plus haute barre du bas de l'écran : la pile des avis se pose au-dessus. */
  hautBarres: number;
  /** Pour chaque bouton de la navigation basse : l'élément sous son centre lui appartient. */
  boutonsTouchables: boolean[];
  /** De même pour les boutons de la barre des fenêtres dont le centre est dans l'écran (elle défile en largeur). */
  boutonsFenetresTouchables: boolean[];
  /** Le texte de l'avis tient dans sa boîte (aucun débordement horizontal). */
  texteContenu: boolean;
}

export async function mesurerAvis(page: Page, avisUnique: Locator): Promise<GeometrieAvis> {
  return avisUnique.evaluate((el) => {
    const boite = el.getBoundingClientRect();
    const barre = document.querySelector(".axiom-mobile-navigation");
    if (barre === null) throw new Error("navigation basse absente");
    const nav = barre.getBoundingClientRect();
    const largeur = document.documentElement.clientWidth;
    /** Boutons d'une barre dont le centre est dans l'écran : chacun répond-il au toucher ? */
    const touchables = (conteneur: Element): boolean[] =>
      Array.from(conteneur.querySelectorAll("button")).flatMap((bouton) => {
        const b = bouton.getBoundingClientRect();
        const x = b.left + b.width / 2;
        if (b.width === 0 || x < 0 || x > largeur) return [];
        const dessous = document.elementFromPoint(x, b.top + b.height / 2);
        return [dessous !== null && conteneur.contains(dessous)];
      });
    const fenetres = document.querySelector(".axiom-taskbar");
    const f = fenetres?.getBoundingClientRect() ?? null;
    return {
      fenetre: { largeur, hauteur: window.innerHeight },
      avis: { gauche: boite.left, droite: boite.right, haut: boite.top, bas: boite.bottom },
      navigation: { haut: nav.top, bas: nav.bottom },
      barreFenetres: f === null ? null : { haut: f.top, bas: f.bottom },
      hautBarres: f === null ? nav.top : Math.min(nav.top, f.top),
      boutonsTouchables: touchables(barre),
      boutonsFenetresTouchables: fenetres ? touchables(fenetres) : [],
      texteContenu: el.scrollWidth <= el.clientWidth,
    };
  });
}

/** Pousse un avis ordinaire par le store du produit, comme le retour d'une action de l'opérateur. */
export async function pousserAvisOrdinaire(page: Page, texte: string): Promise<void> {
  await page.evaluate(async (t) => {
    const importer = new Function("return import('/src/store/toasts.ts')") as () => Promise<{ pousserToast: (texte: string) => void }>;
    (await importer()).pousserToast(t);
  }, texte);
}

/**
 * Pousse un avis d'alerte par `notifier` du runtime, la fonction qui pousse l'avis de chaque
 * déclenchement (« SYMBOLE UNITÉ — message », bouton « Voir », reste jusqu'au toucher). Sans unité :
 * « Voir » garde celle du graphe, comme pour une alerte de prix.
 */
export async function pousserAvisAlerte(page: Page, message: string, marche: { symbol: string; source: string; timeframe?: string }): Promise<void> {
  await page.evaluate(async ([texte, def]) => {
    const importer = new Function("return import('/src/alerts/runtime.ts')") as () => Promise<{
      notifier: (d: { alertId: string; ts: number; valeur: number; message: string }, def: object) => void;
    }>;
    (await importer()).notifier({ alertId: "e2e-avis", ts: Date.now(), valeur: 0, message: texte }, def);
  }, [message, marche] as const);
}

/** Ouverture (ms) de la bougie que la dernière navigation a marquée sur le graphe (« Voir », journal) ; `null` sans marque. */
export async function lireMarque(page: Page): Promise<number | null> {
  return page.evaluate(async () => {
    const importer = new Function("return import('/src/lib/navigation.ts')") as () => Promise<{ navMarkStore: { getState: () => { time: number | null } } }>;
    return (await importer()).navMarkStore.getState().time;
  });
}

/**
 * Pose une instance d'indicateur sur la vue principale par le store du produit, réglages compris
 * (comme l'éditeur de paramètres du menu Indicateurs). Rend son identifiant.
 */
export async function poserInstance(page: Page, defId: string, params: Record<string, number | boolean | string>): Promise<string> {
  return page.evaluate(async ([id, reglages]) => {
    const importer = new Function("return import('/src/store/indicators.ts')") as () => Promise<{
      indicatorsStore: { getState: () => { append: (instances: Array<{ defId: string; params: object }>) => string[] } };
    }>;
    const [instanceId] = (await importer()).indicatorsStore.getState().append([{ defId: id, params: reglages }]);
    if (instanceId === undefined) throw new Error(`instance ${id} non posée`);
    return instanceId;
  }, [defId, params] as const);
}

/** Réglages (`condition.params`) de chaque alerte enregistrée, dans l'ordre de la liste. */
export async function lireReglagesAlertes(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(async () => {
    const importer = new Function("return import('/src/store/alerts.ts')") as () => Promise<{
      alertsStore: { getState: () => { defs: Array<{ condition: { params?: Record<string, unknown> } }> } };
    }>;
    return (await importer()).alertsStore.getState().defs.map((d) => d.condition.params ?? {});
  });
}

/** Messages du journal des alertes (store du produit), du plus récent au plus ancien. */
export async function lireJournal(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const importer = new Function("return import('/src/store/alerts.ts')") as () => Promise<{ alertsStore: { getState: () => { journal: Array<{ message: string }> } } }>;
    return (await importer()).alertsStore.getState().journal.map((j) => j.message);
  });
}

/** Ce qu'on peut dire, depuis le DOM, de la lecture d'un texte. */
export interface LectureTexte {
  /** Sa boîte tient dans l'écran et dans chaque ancêtre qui rogne (liste défilante, tiroir). */
  dansEcran: boolean;
  /** Ni débordement horizontal coupé, ni points de suspension. */
  sansCoupe: boolean;
  /** Rien n'est posé par-dessus : début, milieu et fin de chaque ligne répondent au toucher. */
  decouvert: boolean;
  /** Nombre de lignes de texte. */
  lignes: number;
}

/** Un élément de texte est lu en entier : dans l'écran, non coupé, et sans rien par-dessus (un avis, par exemple). */
export async function luEnEntier(element: Locator): Promise<LectureTexte> {
  await element.scrollIntoViewIfNeeded();
  return element.evaluate((el) => {
    const boite = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    // Remonte les ancêtres qui rognent : la boîte doit tenir dans chacun.
    let dansEcran = boite.left >= 0 && boite.right <= document.documentElement.clientWidth && boite.top >= 0 && boite.bottom <= window.innerHeight;
    for (let parent = el.parentElement; parent !== null && dansEcran; parent = parent.parentElement) {
      const debordement = getComputedStyle(parent);
      if (debordement.overflowX === "visible" && debordement.overflowY === "visible") continue;
      const p = parent.getBoundingClientRect();
      if (debordement.overflowX !== "visible" && (boite.left < p.left - 0.5 || boite.right > p.right + 0.5)) dansEcran = false;
      if (debordement.overflowY !== "visible" && (boite.top < p.top - 0.5 || boite.bottom > p.bottom + 0.5)) dansEcran = false;
    }
    // Lignes réelles du texte : un rectangle par ligne (les fragments d'une même ligne sont réunis).
    const etendue = document.createRange();
    etendue.selectNodeContents(el);
    const lignes: Array<{ haut: number; bas: number; gauche: number; droite: number }> = [];
    for (const r of Array.from(etendue.getClientRects())) {
      if (r.width === 0 || r.height === 0) continue;
      const milieu = (r.top + r.bottom) / 2;
      const ligne = lignes.find((l) => milieu > l.haut && milieu < l.bas);
      if (ligne === undefined) lignes.push({ haut: r.top, bas: r.bottom, gauche: r.left, droite: r.right });
      else {
        ligne.gauche = Math.min(ligne.gauche, r.left);
        ligne.droite = Math.max(ligne.droite, r.right);
      }
    }
    const decouvert = lignes.length > 0 && lignes.every((l) =>
      [l.gauche + 1, (l.gauche + l.droite) / 2, l.droite - 1].every((x) => {
        const dessous = document.elementFromPoint(x, (l.haut + l.bas) / 2);
        return dessous !== null && (el.contains(dessous) || dessous.contains(el));
      }));
    return {
      dansEcran,
      sansCoupe: el.scrollWidth <= el.clientWidth + 1 && style.textOverflow !== "ellipsis",
      decouvert,
      lignes: lignes.length,
    };
  });
}
