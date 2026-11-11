import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
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
 * Horloge figée une demi-heure après la clôture de la dernière bougie (31 octobre 2026) :
 * les 3 000 bougies sont closes, comme dans le cas de référence des tests d'indicateur.
 */
export const HORLOGE_AXIS_SR = BOUGIES.at(-1)![0] + QUATRE_HEURES + 1_800_000;

/**
 * À installer après `bouchonnerReseau` : BTCUSDT 4h sur la vue principale et sur les vues
 * secondaires, sans indicateur ; klines servies depuis la fixture en respectant `startTime`,
 * `endTime` et `limit`, comme Binance (avec `startTime` les premières bougies de la fenêtre, sinon
 * les dernières). BTCUSDT est aussi le symbole de référence par défaut : la même route sert le
 * garde-fou de régime. Tout autre symbole ou intervalle est absent.
 */
export async function preparerAxisSr(page: Page): Promise<void> {
  await page.clock.setFixedTime(HORLOGE_AXIS_SR);
  await page.addInitScript(() => {
    const btc4h = { exchange: "binance", symbol: "BTCUSDT", timeframe: "4h" };
    localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
    if (!localStorage.getItem("axiom:chartState:v1")) {
      localStorage.setItem("axiom:chartState:v1", JSON.stringify({ ...btc4h, chartType: "candle_solid", indicators: [] }));
    }
    if (!localStorage.getItem("axiom:chartLayout:v1")) {
      localStorage.setItem("axiom:chartLayout:v1", JSON.stringify({ layout: "1", slots: [btc4h, btc4h, btc4h] }));
    }
  });
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
  /** Texte d'infobulle de l'annotation visée (zone ou triangle creux). */
  info: string;
  /** Segments et marqueurs porteurs d'un texte, à 3 bougies ou moins de `idx` (textes distincts). */
  marqueursProches: number;
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
  /** `candle.tooltip.offsetTop` : ordonnée de la première rangée de l'infobulle, dans le pane des prix. */
  offsetTop: number;
  /** Zone de tracé du pane des prix (coordonnées client). */
  pane: { x: number; y: number; width: number; height: number };
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
 * avec le réticule et l'axe des prix réels. Sans AXIS S/R : zones, lignes et cibles vides.
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
    const instance = store.indicatorsStore.getState().indicators.find((i) => i.defId === "stratAxisSr");
    const indicateur = instance ? chart.getIndicatorByPaneId("candle_pane", `AXIOM_${instance.instanceId}`) as IndicateurMonte | null : null;
    const annotations = indicateur?.extendData?.annotations ?? {};
    const crosshair = chart._chartStore.getTooltipStore().getCrosshair();
    const source = indicateur?.createTooltipDataSource?.({ indicator: indicateur, crosshair, yAxis: axeY });

    // Zone libre : sous les trois rangées de l'infobulle, et là où l'appui atteint le canvas
    // (ni légende, ni bouton par-dessus).
    const axeX = chart.getXAxisPane().getAxisComponent();
    const libreDe = offsetTop + 70;
    const porteurs = [
      ...(annotations.segments ?? []).map((s) => ({ idx: s.aIdx, info: s.info })),
      ...(annotations.marqueurs ?? []).map((m) => ({ idx: m.idx, info: m.info })),
    ].filter((a) => a.info !== undefined);
    const cible = (idx: number, yA: number, yB: number, info: string): CibleAxisSr[] => {
      const x = axeX.convertToPixel(idx);
      const haut = Math.max(libreDe, Math.min(yA, yB));
      const bas = Math.min(boite.height - 4, Math.max(yA, yB));
      const y = (haut + bas) / 2;
      if (bas - haut < 4 || x < 4 || x > boite.width - 4 || !dom.contains(document.elementFromPoint(boite.x + x, boite.y + y))) return [];
      const marqueursProches = new Set(porteurs.filter((a) => Math.abs(a.idx - idx) <= 3).map((a) => a.info)).size;
      return [{ idx, x: boite.x + x, y: boite.y + y, info, marqueursProches }];
    };
    const { from, to } = chart.getVisibleRange();
    const zonesTracees = (annotations.rubans ?? []).filter((r) => r.info !== undefined);
    const bandes: CibleAxisSr[] = [];
    for (let idx = from; idx < Math.min(to, chart.getDataList().length); idx++) {
      for (const r of zonesTracees) {
        const haut = r.hauts[idx - r.deIdx];
        const bas = r.bas[idx - r.deIdx];
        if (haut !== undefined && bas !== undefined) bandes.push(...cible(idx, axeY.convertToPixel(haut), axeY.convertToPixel(bas), r.info!));
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
      calculees: Object.values(indicateur?.extendData?.series ?? {})[0]?.length ?? 0,
      offsetTop,
      pane: { x: boite.x, y: boite.y, width: boite.width, height: boite.height },
      zones: zonesTracees.map((r) => ({ info: r.info!, alpha: r.alpha })),
      rubans: (annotations.rubans ?? []).length,
      etiquettes: (annotations.labels ?? []).filter((l) => l.ancrageX === "droite").map((l) => l.texte),
      reticule: { paneId: crosshair.paneId ?? null, dataIndex: crosshair.dataIndex ?? null },
      lignes,
      origines: lignes.map(origine),
      bandes,
      creux,
    };
  });
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
