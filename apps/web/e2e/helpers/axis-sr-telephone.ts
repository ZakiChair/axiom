import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import type { Chart, DomPosition } from "klinecharts";
import type { AnnotationsIndicateur } from "@axiom/types";
import type { ActiveIndicator } from "../../src/store/indicators";

/** Une ligne de la fixture : time, open, high, low, close, volume, buyVolume. */
type LigneFixture = [number, number, number, number, number, number, number];

const QUATRE_HEURES = 14_400_000;

/** Cas de référence d'AXIS S/R : 3 000 bougies BTCUSDT 4h, lues telles quelles dans le dépôt. */
const BOUGIES = (
  JSON.parse(
    readFileSync(new URL("../../../../packages/indicators/src/strategy/fixtures/btcusdt-4h-3000.json", import.meta.url), "utf8"),
  ) as { bougies: LigneFixture[] }
).bougies;

/**
 * Date figée une demi-heure après la clôture de la dernière bougie (31 octobre 2026) :
 * les 3 000 bougies sont closes, comme dans le cas de référence des tests d'indicateur.
 */
export const HORLOGE_AXIS_SR = BOUGIES.at(-1)![0] + QUATRE_HEURES + 1_800_000;

/**
 * Fige `Date` SEULE sur `instant` (ms) : `new Date()`, `Date()` et `Date.now()` le rendent ;
 * minuteries, `performance.now()` et `requestAnimationFrame` restent ceux du navigateur. À appeler
 * avant `page.goto` ; vaut pour chaque document de la page, rechargement compris.
 *
 * Pourquoi pas `page.clock.setFixedTime` : Playwright 1.61 y remplace aussi
 * `requestAnimationFrame`. Dans une image, les observateurs de taille passent alors AVANT le rappel
 * d'animation (dans le navigateur : entre deux), et KLineChart 9.8.12 abandonne la remise à
 * l'échelle d'un canvas quand une peinture attend (`Canvas._executeListener`) : le graphe du
 * parcours restait figé, rien n'y était repeint après un appui. C'était le harnais, pas le produit.
 *
 * Une FONCTION, pas une `class … extends Date` : une classe lève sur `Date()` sans `new`. Avec
 * `new`, l'objet rendu est une vraie date (`instanceof Date`, sous-classes comprises) ; sans, la
 * chaîne de l'instant figé, comme l'original. `parse` et `UTC` sont ceux d'origine.
 */
export async function figerDate(page: Page, instant: number): Promise<void> {
  await page.addInitScript((fixe) => {
    const Vraie = Date;
    function DateFigee(...args: unknown[]): unknown {
      if (new.target === undefined) return new Vraie(fixe).toString();
      return Reflect.construct(Vraie, args.length === 0 ? [fixe] : args, new.target);
    }
    DateFigee.prototype = Vraie.prototype;
    // `d.constructor === Date` et `new d.constructor()` restent vrais et figés.
    DateFigee.prototype.constructor = DateFigee;
    DateFigee.now = () => fixe;
    DateFigee.parse = Vraie.parse;
    DateFigee.UTC = Vraie.UTC;
    (window as unknown as { Date: unknown }).Date = DateFigee;
  }, instant);
}

/**
 * Garde du harnais : `requestAnimationFrame` de la page est celui du navigateur (aucune horloge de
 * test ne l'a remplacé), et `Date` est figée sur `instant`, avec ou sans `new`.
 */
export async function horlogeDuNavigateur(page: Page, instant: number): Promise<{ rafNatif: boolean; dateFigee: boolean }> {
  return page.evaluate((fixe) => {
    const sansNew = (Date as unknown as () => string)();
    return {
      rafNatif: /\[native code\]/.test(Function.prototype.toString.call(window.requestAnimationFrame)),
      dateFigee:
        Date.now() === fixe &&
        new Date().getTime() === fixe &&
        new Date() instanceof Date &&
        typeof sansNew === "string" &&
        Date.parse(sansNew) === Math.floor(fixe / 1000) * 1000 &&
        // Une date construite avec des arguments n'est pas figée.
        new Date(0).getTime() === 0 &&
        new Date(2026, 0, 1).getFullYear() === 2026,
    };
  }, instant);
}

/**
 * À installer après `bouchonnerReseau` : BTCUSDT 4h sur la vue principale et sur les vues
 * secondaires, sans indicateur ; klines servies depuis la fixture en respectant `startTime`,
 * `endTime` et `limit`, comme Binance (avec `startTime` les premières bougies de la fenêtre, sinon
 * les dernières). BTCUSDT est aussi le symbole de référence par défaut : la même route sert le
 * garde-fou de régime. Tout autre symbole ou intervalle est absent. La date est figée par
 * `figerDate` : le graphe tourne sur le vrai `requestAnimationFrame`. `indicateurs` : indicateurs
 * déjà persistés au premier chargement (défaut : aucun, le parcours les ajoute au toucher).
 */
export async function preparerAxisSr(page: Page, indicateurs: Array<Pick<ActiveIndicator, "defId" | "params">> = []): Promise<void> {
  await figerDate(page, HORLOGE_AXIS_SR);
  await page.addInitScript((persistes) => {
    const btc4h = { exchange: "binance", symbol: "BTCUSDT", timeframe: "4h" };
    localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
    if (!localStorage.getItem("axiom:chartState:v1")) {
      localStorage.setItem("axiom:chartState:v1", JSON.stringify({ ...btc4h, chartType: "candle_solid", indicators: persistes }));
    }
    if (!localStorage.getItem("axiom:chartLayout:v1")) {
      localStorage.setItem("axiom:chartLayout:v1", JSON.stringify({ layout: "1", slots: [btc4h, btc4h, btc4h] }));
    }
  }, indicateurs);
  await page.route("**/api.binance.com/api/v3/klines*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("symbol") !== "BTCUSDT" || params.get("interval") !== "4h") {
      return route.fulfill({ status: 503, json: { error: "fixture absente" } });
    }
    const debut = Number(params.get("startTime") ?? -Infinity);
    const fin = Number(params.get("endTime") ?? Infinity);
    const limite = Number(params.get("limit") ?? 500);
    const fenetre = BOUGIES.filter(([t]) => t >= debut && t <= fin);
    const lignes = params.has("startTime") ? fenetre.slice(0, limite) : fenetre.slice(-limite);
    return route.fulfill({
      json: lignes.map(([t, o, h, l, c, v, achat]) =>
        [t, String(o), String(h), String(l), String(c), String(v), t + QUATRE_HEURES - 1, String(v * c), 1, String(achat), String(achat * c), "0"]),
    });
  });
}

/** Point d'appui (coordonnées client) sur une annotation visible, dans la zone libre du pane des prix. */
export interface CibleAxisSr {
  /** Bougie visée. */
  idx: number;
  x: number;
  y: number;
  /** Texte d'infobulle de l'annotation visée (zone ou triangle creux) ; vide pour un point libre. */
  info: string;
  /** Segments et marqueurs d'AXIS S/R porteurs d'un texte, à 3 bougies ou moins de `idx` (textes distincts). */
  marqueursProches: number;
  /**
   * Segments et marqueurs porteurs d'un texte des AUTRES indicateurs du pane des prix (AXIS…), à
   * 3 bougies ou moins de `idx` (textes distincts) : chacun est, pour son indicateur, le « voisin »
   * que l'encart ne doit rendre qu'à défaut de marqueur ou de bande sous le doigt.
   */
  textesAutres: number;
  /**
   * Un marqueur porteur d'un texte, de N'IMPORTE QUEL indicateur du pane des prix, est sous le
   * doigt : à 1 bougie ou moins, son point à 24 px ou moins de `y`. L'encart rend alors son texte,
   * pas celui de la bande.
   */
  marqueurSousLeDoigt: boolean;
}

/** Annotation qui porte le texte d'une ligne de l'infobulle ; « inconnue » : aucune ne le porte. */
export type OrigineLigne = "zone" | "creux" | "marqueur" | "segment" | "inconnue";

export interface LectureAxisSr {
  /** Slot (0 = vue principale) du graphe actif. */
  slot: string | null;
  /** Bougies chargées. */
  bougies: number;
  /** Bougies sur lesquelles l'instance AXIS S/R montée a été calculée (0 sans elle). */
  calculees: number;
  /**
   * Indicateurs actifs, dans l'ordre du magasin, qui est celui du montage : identifiant de leur
   * définition et bougies sur lesquelles l'instance montée sur le pane des prix a été calculée
   * (0 : pas montée sur ce pane, ou pas encore calculée).
   */
  indicateurs: Array<{ defId: string; calculees: number }>;
  /** `candle.tooltip.offsetTop` : ordonnée de la première rangée de l'infobulle, dans le pane des prix. */
  offsetTop: number;
  /** Zone de tracé du pane des prix (coordonnées client). */
  pane: { x: number; y: number; width: number; height: number };
  /**
   * Le moteur a repris la largeur de son conteneur. Après un changement de fenêtre, il ne
   * redimensionne ses panes qu'à sa passe suivante (observateur de taille, puis rappel
   * d'animation) : avant elle, `pane`, cibles et tiers du pane sont ceux de l'ancienne fenêtre.
   */
  aJour: boolean;
  /**
   * Zones actives : les rubans porteurs d'un texte d'infobulle. `alpha` est l'opacité de la
   * bande : positive pour une zone forte, nulle pour une faible (bords seuls).
   */
  zones: Array<{ info: string; alpha: number }>;
  /** Tous les rubans, zones fortes cassées comprises. */
  rubans: number;
  /** Étiquettes ancrées au bord droit (« S fort · n », « R forte · n », « faible »). */
  etiquettes: string[];
  /** Réticule réel : pane et bougie (au repos, aucun pane et la dernière bougie). */
  reticule: { paneId: string | null; dataIndex: number | null };
  /** Lignes que la source de l'infobulle d'AXIS S/R rend pour ce réticule (3 au plus). */
  lignes: string[];
  /** Pour chaque ligne, l'annotation du graphe qui en porte le texte. */
  origines: OrigineLigne[];
  /** Milieu de chaque bande de zone à chaque bougie visible, là où l'appui atteint le graphe. */
  bandes: CibleAxisSr[];
  /** Triangles creux visibles (signaux précoces). */
  creux: CibleAxisSr[];
  /**
   * Points libres : hors de toute bande (à 10 px près), sans segment ni marqueur porteur d'un
   * texte, d'aucun indicateur du pane des prix, à 3 bougies ou moins. L'encart n'y porte aucun texte.
   */
  libres: CibleAxisSr[];
}

type Axe = { convertToPixel: (v: number) => number };
type IndicateurMonte = {
  extendData?: { series?: Record<string, unknown[]>; annotations?: AnnotationsIndicateur };
  createTooltipDataSource?: (p: object) => { values?: Array<{ value: unknown }> };
};
type ChartInterne = Chart & {
  getDrawPaneById: (id: string) => { getAxisComponent: () => Axe } | null;
  getXAxisPane: () => { getAxisComponent: () => Axe };
  _chartStore: { getTooltipStore: () => { getCrosshair: () => { paneId?: string; dataIndex?: number } } };
};
type Modules = [
  { getActiveChart: () => ChartInterne | null },
  { indicatorsStore: { getState: () => { indicators: ActiveIndicator[] } } },
];

/**
 * Lit le VRAI graphe actif : tout ce qui suit est dessiné sur canvas, rien n'est dans le DOM.
 * Les lignes viennent du rappel `createTooltipDataSource` de l'instance AXIS S/R montée, appelé
 * avec le réticule et l'axe des prix réels. Sans AXIS S/R : zones, lignes et cibles vides. Zones,
 * lignes et bandes sont celles d'AXIS S/R ; les marqueurs « sous le doigt » et les points libres
 * tiennent compte de TOUS les indicateurs montés sur le pane des prix.
 */
export async function lireAxisSr(page: Page): Promise<LectureAxisSr | null> {
  return page.evaluate(async () => {
    const importer = new Function("return Promise.all([import('/src/chart/drawing.ts'), import('/src/store/indicators.ts')])") as () => Promise<Modules>;
    const [dessin, store] = await importer();
    const chart = dessin.getActiveChart();
    const dom = chart?.getDom("candle_pane", "main" as DomPosition);
    const axeY = chart?.getDrawPaneById("candle_pane")?.getAxisComponent();
    if (!chart || !dom || !axeY) return null;
    const boite = dom.getBoundingClientRect();
    const offsetTop = chart.getStyles().candle.tooltip.offsetTop;
    const actifs = store.indicatorsStore.getState().indicators;
    const monte = (i: ActiveIndicator) => chart.getIndicatorByPaneId("candle_pane", `AXIOM_${i.instanceId}`) as IndicateurMonte | null;
    const calculees = (m: IndicateurMonte | null) => Object.values(m?.extendData?.series ?? {})[0]?.length ?? 0;
    const instance = actifs.find((i) => i.defId === "stratAxisSr");
    const indicateur = instance ? monte(instance) : null;
    const annotations = indicateur?.extendData?.annotations ?? {};
    /** Annotations des autres indicateurs du pane des prix. */
    const autres = actifs.filter((i) => i !== instance).map((i) => monte(i)?.extendData?.annotations ?? {});
    const crosshair = chart._chartStore.getTooltipStore().getCrosshair();
    const source = indicateur?.createTooltipDataSource?.({ indicator: indicateur, crosshair, yAxis: axeY });

    // Zone libre : sous les trois rangées de l'infobulle, et là où l'appui atteint le canvas
    // (ni légende, ni bouton par-dessus).
    const axeX = chart.getXAxisPane().getAxisComponent();
    const libreDe = offsetTop + 70;
    const textes = (a: AnnotationsIndicateur) =>
      [
        ...(a.segments ?? []).map((s) => ({ idx: s.aIdx, info: s.info })),
        ...(a.marqueurs ?? []).map((m) => ({ idx: m.idx, info: m.info })),
      ].filter((t) => t.info !== undefined);
    const porteurs = textes(annotations);
    const porteursAutres = autres.flatMap(textes);
    // Marqueurs porteurs d'un texte, de tous les indicateurs du pane, avec l'ordonnée de leur
    // point : l'encart rend celui qui est sous le doigt (1 bougie, 24 px). Marge de 6 px ici : une
    // cible « sans marqueur » l'est nettement.
    const points = [annotations, ...autres]
      .flatMap((a) => a.marqueurs ?? [])
      .filter((m) => m.info !== undefined)
      .map((m) => ({ idx: m.idx, y: axeY.convertToPixel(m.valeur) }));
    const proches = (liste: typeof porteurs, idx: number) => new Set(liste.filter((t) => Math.abs(t.idx - idx) <= 3).map((t) => t.info)).size;
    const cible = (idx: number, yA: number, yB: number, info: string): CibleAxisSr[] => {
      const x = axeX.convertToPixel(idx);
      const haut = Math.max(libreDe, Math.min(yA, yB));
      const bas = Math.min(boite.height - 4, Math.max(yA, yB));
      const y = (haut + bas) / 2;
      if (bas - haut < 4 || x < 4 || x > boite.width - 4 || !dom.contains(document.elementFromPoint(boite.x + x, boite.y + y))) return [];
      const marqueurSousLeDoigt = points.some((p) => Math.abs(p.idx - idx) <= 1 && Math.abs(p.y - y) <= 30);
      return [{ idx, x: boite.x + x, y: boite.y + y, info, marqueursProches: proches(porteurs, idx), textesAutres: proches(porteursAutres, idx), marqueurSousLeDoigt }];
    };
    const { from, to } = chart.getVisibleRange();
    const fin = Math.min(to, chart.getDataList().length);
    const zonesTracees = (annotations.rubans ?? []).filter((r) => r.info !== undefined);
    const bandes: CibleAxisSr[] = [];
    const libres: CibleAxisSr[] = [];
    for (let idx = from; idx < fin; idx++) {
      // Bords (px) des bandes à cette bougie, de haut en bas.
      const bords: Array<[number, number]> = [];
      for (const r of zonesTracees) {
        const haut = r.hauts[idx - r.deIdx];
        const bas = r.bas[idx - r.deIdx];
        if (idx < r.deIdx || haut === undefined || bas === undefined) continue;
        bandes.push(...cible(idx, axeY.convertToPixel(haut), axeY.convertToPixel(bas), r.info!));
        bords.push([axeY.convertToPixel(haut), axeY.convertToPixel(bas)]);
      }
      if (proches(porteurs, idx) + proches(porteursAutres, idx) > 0) continue;
      // Entre deux bandes voisines (ou une bande et le bord de la zone libre) : au milieu de l'intervalle.
      const limites = [libreDe, ...bords.flat().sort((a, b) => a - b), boite.height - 4];
      for (let k = 0; k + 1 < limites.length; k += 2) {
        const [haut, bas] = [limites[k]! + 10, limites[k + 1]! - 10];
        if (bas - haut >= 4) libres.push(...cible(idx, haut, bas, ""));
      }
    }
    const creux = (annotations.marqueurs ?? [])
      .filter((m) => m.creux === true && m.info !== undefined && m.idx >= from && m.idx < to)
      .flatMap((m) => cible(m.idx, axeY.convertToPixel(m.valeur) - 6, axeY.convertToPixel(m.valeur) + 6, m.info!));

    // Une ligne se reconnaît à l'annotation qui porte son texte, jamais à son libellé.
    const lignes = (source?.values ?? []).map((v) => String(v.value));
    const origine = (ligne: string): OrigineLigne => {
      if (zonesTracees.some((r) => r.info === ligne)) return "zone";
      const marqueur = (annotations.marqueurs ?? []).find((m) => m.info === ligne);
      if (marqueur !== undefined) return marqueur.creux === true ? "creux" : "marqueur";
      return (annotations.segments ?? []).some((s) => s.info === ligne) ? "segment" : "inconnue";
    };

    return {
      slot: chart.getDom()?.closest("[data-chart-slot]")?.getAttribute("data-chart-slot") ?? null,
      bougies: chart.getDataList().length,
      calculees: calculees(indicateur),
      indicateurs: actifs.map((i) => ({ defId: i.defId, calculees: calculees(monte(i)) })),
      offsetTop,
      pane: { x: boite.x, y: boite.y, width: boite.width, height: boite.height },
      aJour: Math.abs((chart.getSize("candle_pane")?.width ?? -1) - (chart.getDom()?.clientWidth ?? -2)) < 1,
      zones: zonesTracees.map((r) => ({ info: r.info!, alpha: r.alpha })),
      rubans: (annotations.rubans ?? []).length,
      etiquettes: (annotations.labels ?? []).filter((l) => l.ancrageX === "droite").map((l) => l.texte),
      reticule: { paneId: crosshair.paneId ?? null, dataIndex: crosshair.dataIndex ?? null },
      lignes,
      origines: lignes.map(origine),
      bandes,
      creux,
      libres,
    };
  });
}

/** Rangée de l'infobulle telle que le moteur l'a peinte sur le canvas. */
export interface RangeePeinte {
  /** Texte peint, sans les espaces insécables qui le complètent. */
  texte: string;
  /** Ordonnée (px du pane) passée à `fillText`. */
  y: number;
  /** Largeur (px), mesurée par le canvas dans la police du dessin, du texte sans « … » final. */
  largeurCorps: number;
  /** Largeur (px) du texte peint, espaces insécables de fin compris. */
  largeurPeinte: number;
  /** Police du canvas au moment du dessin. */
  police: string;
}

/**
 * À installer avant `page.goto` : relève chaque texte « AXIS … » que le moteur du graphe peint à
 * x = 12, l'abscisse du premier texte d'une rangée de l'infobulle (`offsetLeft` 4 + `marginLeft` 8).
 * Le canvas n'a pas de DOM : c'est la seule preuve de ce qui est réellement écrit, mesures comprises
 * (elles sont celles du moteur de rendu du navigateur, espaces insécables de fin inclus).
 */
export async function espionnerRangees(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const insecables = new RegExp(`${String.fromCharCode(160)}+$`);
    const peintes: RangeePeinte[] = [];
    (window as unknown as { __rangeesPeintes: RangeePeinte[] }).__rangeesPeintes = peintes;
    const natif = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (this: CanvasRenderingContext2D, texte: string, x: number, y: number, ...reste: [number?]) {
      if (x === 12 && typeof texte === "string" && texte.startsWith("AXIS")) {
        const sansFin = texte.replace(insecables, "");
        peintes.push({
          texte: sansFin,
          y,
          largeurCorps: this.measureText(sansFin.endsWith("…") ? sansFin.slice(0, -1) : sansFin).width,
          largeurPeinte: this.measureText(texte).width,
          police: this.font,
        });
        if (peintes.length > 200) peintes.splice(0, 100);
      }
      return natif.call(this, texte, x, y, ...reste);
    };
  });
}

/**
 * Rangées de la DERNIÈRE peinture de l'infobulle (après `espionnerRangees`) : la suite finale de
 * textes à ordonnées strictement croissantes. Vide tant que rien n'a été peint.
 */
export async function lireRangees(page: Page): Promise<RangeePeinte[]> {
  return page.evaluate(() => {
    const peintes = (window as unknown as { __rangeesPeintes?: RangeePeinte[] }).__rangeesPeintes ?? [];
    const dernieres: RangeePeinte[] = [];
    for (let i = peintes.length - 1; i >= 0; i--) {
      const rangee = peintes[i]!;
      if (dernieres.length > 0 && rangee.y >= dernieres[0]!.y) break;
      dernieres.unshift(rangee);
    }
    return dernieres;
  });
}

/** Largeurs (px) de `textes` dans `police`, mesurées par un canvas de la page. */
export async function mesurerTextes(page: Page, police: string, textes: string[]): Promise<number[]> {
  return page.evaluate(
    ([p, ts]) => {
      const ctx = document.createElement("canvas").getContext("2d")!;
      ctx.font = p;
      return ts.map((t) => ctx.measureText(t).width);
    },
    [police, textes] as const,
  );
}

type Boite = { x: number; y: number; width: number; height: number };

/** Encart O/H/L/C du graphe actif, et son bloc de texte quand il en porte un. */
export interface LectureEncart {
  /** `display` calculé de l'encart (« none » : masqué). */
  affichage: string;
  /** Boîte de l'encart (coordonnées client). */
  boite: Boite;
  /** Opacité du fond de l'encart (1 : opaque), lue sur un pixel peint de cette couleur. */
  fondAlpha: number;
  /** Texte du bloc `[data-candle-readout-texte]`, `null` sans bloc. */
  texte: string | null;
  /** Le bloc de texte déborde de sa boîte (`scrollWidth > clientWidth`). */
  deborde: boolean;
  /** Lignes du bloc de texte. */
  lignes: number;
  /** Largeur de la fenêtre (px). */
  largeurEcran: number;
}

/** Lit l'encart du graphe actif ; `null` s'il n'existe pas. */
export async function lireEncart(page: Page): Promise<LectureEncart | null> {
  return page.evaluate(async () => {
    const importer = new Function("return import('/src/chart/drawing.ts')") as () => Promise<Modules[0]>;
    const chart = (await importer()).getActiveChart();
    const encart = chart?.getDom()?.closest("[data-chart-slot]")?.querySelector<HTMLElement>("[data-candle-readout]");
    if (!encart) return null;
    const bloc = encart.querySelector<HTMLElement>("[data-candle-readout-texte]");
    const style = getComputedStyle(encart);
    // Le fond calculé peut être écrit `rgb(…)`, `rgba(…)` ou `color(srgb … / α)` selon le moteur :
    // un canvas le peint, et l'alpha se lit sur le pixel.
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    // Couleur non reconnue par le canvas : `fillStyle` garde « transparent », l'alpha lu vaut 0.
    ctx.fillStyle = "transparent";
    ctx.fillStyle = style.backgroundColor;
    ctx.fillRect(0, 0, 1, 1);
    const b = encart.getBoundingClientRect();
    return {
      affichage: style.display,
      boite: { x: b.x, y: b.y, width: b.width, height: b.height },
      fondAlpha: ctx.getImageData(0, 0, 1, 1).data[3]! / 255,
      texte: bloc?.textContent ?? null,
      deborde: bloc ? bloc.scrollWidth > bloc.clientWidth : false,
      lignes: bloc ? Math.round(bloc.getBoundingClientRect().height / parseFloat(getComputedStyle(bloc).lineHeight)) : 0,
      largeurEcran: window.innerWidth,
    };
  });
}

/**
 * Change la fenêtre et attend que le moteur du graphe ait repris sa nouvelle largeur (`aJour`).
 * Sur le vrai `requestAnimationFrame` (`figerDate`), le graphe ne redimensionne ses panes qu'à la
 * passe qui suit le changement : lue avant elle, la hauteur du pane — donc son tiers, et les
 * cibles d'un appui — est celle de l'ancienne fenêtre. À préférer à `page.setViewportSize` dès
 * que la suite lit la géométrie du graphe sans attendre un état qui en dépend.
 */
export async function redimensionner(page: Page, largeur: number, hauteur: number): Promise<void> {
  await page.setViewportSize({ width: largeur, height: hauteur });
  await expect.poll(async () => (await lireAxisSr(page))?.aJour ?? false).toBe(true);
}

/**
 * Change de thème et relit le graphe actif DANS LE MÊME INSTANT, avant tout redimensionnement :
 * couleur de la grille avant et après (témoin que la palette a bien été reposée) et ordonnée de
 * l'infobulle telle que le changement de thème la laisse.
 */
export async function changerTheme(page: Page, theme: string): Promise<{ grilleAvant: string; grilleApres: string; offsetTop: number }> {
  return page.evaluate(async (id) => {
    const importer = new Function("return Promise.all([import('/src/chart/drawing.ts'), import('/src/store/theme.ts')])") as () => Promise<[
      Modules[0],
      { themeStore: { getState: () => { setTheme: (t: string) => void } } },
    ]>;
    const [dessin, themes] = await importer();
    const chart = dessin.getActiveChart();
    if (!chart) throw new Error("graphe actif absent");
    const grilleAvant = String(chart.getStyles().grid.horizontal.color);
    themes.themeStore.getState().setTheme(id);
    const styles = chart.getStyles();
    return { grilleAvant, grilleApres: String(styles.grid.horizontal.color), offsetTop: styles.candle.tooltip.offsetTop };
  }, theme);
}
