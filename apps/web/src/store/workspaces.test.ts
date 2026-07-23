/**
 * Tests du store des workspaces (presets nommés). Logique pure de sélection/snapshot :
 * on vérifie enregistrement, application via les setters des stores, renommage,
 * suppression, l'auto-maj du « Défaut » au moment de le quitter, et la normalisation
 * défensive d'un contenu persisté corrompu.
 *
 * workspaces.ts tire `priceScaleStore` (chart/Chart) et `themeStore` (store/theme), tous
 * deux non évaluables hors navigateur (klinecharts / accès `document`). On les neutralise
 * par de vrais stores vanilla minimaux — même approche que registry.test.ts / persist.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../chart/Chart", async () => {
  const { createStore } = await import("zustand/vanilla");
  const priceScaleStore = createStore<{ type: string; setType: (t: string) => void }>((set) => ({
    type: "normal",
    setType: (type) => set({ type }),
  }));
  return { priceScaleStore };
});

vi.mock("../store/theme", async () => {
  const { createStore } = await import("zustand/vanilla");
  const THEMES = ["dark", "bloomberg", "matrix", "cute", "aurora"] as const;
  const themeStore = createStore<{ theme: string; setTheme: (t: string) => void }>((set) => ({
    theme: "dark",
    setTheme: (theme) => set({ theme }),
  }));
  return { THEMES, themeStore };
});

import { marketStore } from "./market";
import { indicatorsStore } from "./indicators";
import { compareStore } from "./compare";
import { orderflowStore } from "./orderflow";
import { volumeProfileStore } from "./volumeProfile";
import { revenueStore } from "./revenue";
import { macroOverlayStore } from "./macro-overlays";
import { uiSectionsStore } from "./ui-sections";
import { priceScaleStore } from "../chart/Chart";
import { themeStore } from "../store/theme";
import { windowManagerStore } from "./windowManager";
import { workspacesStore, DEFAULT_WORKSPACE_ID, type WorkspaceContent } from "./workspaces";

/** Mock localStorage en mémoire (la persistance interne du store écrit dessus). */
function installMockLocalStorage(): void {
  const data = new Map<string, string>();
  const mock: Storage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
    key: (i) => Array.from(data.keys())[i] ?? null,
    get length() {
      return data.size;
    },
  };
  (globalThis as { localStorage?: Storage }).localStorage = mock;
}

/** Contenu de workspace vierge (session baseline). */
function contenuVierge(): WorkspaceContent {
  return {
    exchange: "binance",
    symbol: "BTCUSDT",
    timeframe: "1m",
    indicators: [],
    orderflow: false,
    volumeProfile: false,
    revenue: false,
    compare: [],
    macroOverlays: [],
    theme: "dark",
    sections: {},
    priceScale: "normal",
    windowGeometry: {},
  };
}

/** Retrouve un workspace par nom. */
function parNom(name: string) {
  return workspacesStore.getState().workspaces.find((w) => w.name === name);
}

beforeEach(() => {
  installMockLocalStorage();
  marketStore.setState({ exchange: "binance", symbol: "BTCUSDT", timeframe: "1m", candles: [] });
  indicatorsStore.setState({ indicators: [] });
  compareStore.getState().clear();
  orderflowStore.getState().setEnabled(false);
  volumeProfileStore.getState().setEnabled(false);
  revenueStore.getState().setEnabled(false);
  macroOverlayStore.getState().setEnabled([]);
  uiSectionsStore.getState().setAll({});
  priceScaleStore.getState().setType("normal");
  themeStore.getState().setTheme("dark");
  // Un unique « Défaut » vierge, actif.
  workspacesStore.setState({
    workspaces: [{ id: DEFAULT_WORKSPACE_ID, name: "Défaut", content: contenuVierge() }],
    currentId: DEFAULT_WORKSPACE_ID,
  });
});

describe("workspacesStore — enregistrer / appliquer", () => {
  it("saveAs capture l'agencement courant et devient le workspace courant", () => {
    marketStore.getState().setSymbol("ETHUSDT");
    marketStore.getState().setTimeframe("4h");
    orderflowStore.getState().setEnabled(true);

    workspacesStore.getState().saveAs("scalp");

    const scalp = parNom("scalp");
    expect(scalp).toBeDefined();
    expect(workspacesStore.getState().currentId).toBe(scalp?.id);
    expect(scalp?.content.symbol).toBe("ETHUSDT");
    expect(scalp?.content.timeframe).toBe("4h");
    expect(scalp?.content.orderflow).toBe(true);
  });

  it("apply reconfigure les stores via leurs setters (symbole, TF, toggles)", () => {
    marketStore.getState().setSymbol("ETHUSDT");
    marketStore.getState().setTimeframe("4h");
    orderflowStore.getState().setEnabled(true);
    priceScaleStore.getState().setType("log");
    workspacesStore.getState().saveAs("scalp");
    const idScalp = parNom("scalp")?.id ?? "";

    // Change la session live puis applique le preset.
    marketStore.getState().setSymbol("BTCUSDT");
    marketStore.getState().setTimeframe("1m");
    orderflowStore.getState().setEnabled(false);
    priceScaleStore.getState().setType("normal");

    // On repart de « Défaut » pour que apply(idScalp) ne soit pas un no-op « déjà courant ».
    workspacesStore.getState().apply(DEFAULT_WORKSPACE_ID);
    workspacesStore.getState().apply(idScalp);

    expect(marketStore.getState().symbol).toBe("ETHUSDT");
    expect(marketStore.getState().timeframe).toBe("4h");
    expect(orderflowStore.getState().enabled).toBe(true);
    expect(priceScaleStore.getState().type).toBe("log");
    expect(workspacesStore.getState().currentId).toBe(idScalp);
  });

  it("apply est un no-op si le workspace est déjà courant", () => {
    workspacesStore.getState().saveAs("a"); // currentId = a
    const idA = parNom("a")?.id ?? "";
    marketStore.getState().setSymbol("SOLUSDT"); // modif libre non enregistrée
    workspacesStore.getState().apply(idA); // déjà courant -> ne doit rien ré-appliquer
    expect(marketStore.getState().symbol).toBe("SOLUSDT"); // la vue courante est préservée
  });

  it("saveAs écrase un preset de même nom (même id réutilisé)", () => {
    marketStore.getState().setSymbol("ETHUSDT");
    workspacesStore.getState().saveAs("dup");
    const id1 = parNom("dup")?.id;

    marketStore.getState().setSymbol("SOLUSDT");
    workspacesStore.getState().saveAs("dup");

    const dups = workspacesStore.getState().workspaces.filter((w) => w.name === "dup");
    expect(dups).toHaveLength(1);
    expect(dups[0]?.id).toBe(id1);
    expect(dups[0]?.content.symbol).toBe("SOLUSDT");
  });
});

describe("workspacesStore — « Défaut » auto-mis à jour", () => {
  it("fige la session libre dans « Défaut » quand on le quitte, et la restaure au retour", () => {
    // Un preset cible « alt » (peu importe son contenu exact).
    marketStore.getState().setSymbol("ADAUSDT");
    workspacesStore.getState().saveAs("alt"); // currentId = alt
    const idAlt = parNom("alt")?.id ?? "";

    // Revenir sur « Défaut » pour repartir d'une session libre contrôlée.
    workspacesStore.getState().apply(DEFAULT_WORKSPACE_ID);
    expect(workspacesStore.getState().currentId).toBe(DEFAULT_WORKSPACE_ID);
    marketStore.getState().setSymbol("DOTUSDT"); // session libre sur « Défaut »

    // Quitter « Défaut » vers « alt » -> DOTUSDT est figé dans « Défaut ».
    workspacesStore.getState().apply(idAlt);
    expect(marketStore.getState().symbol).toBe("ADAUSDT"); // preset appliqué

    // Retour sur « Défaut » -> la session libre (DOTUSDT) est restaurée.
    workspacesStore.getState().apply(DEFAULT_WORKSPACE_ID);
    expect(marketStore.getState().symbol).toBe("DOTUSDT");
  });
});

describe("workspacesStore — renommer / supprimer", () => {
  it("renomme un preset ; le « Défaut » garde son nom réservé", () => {
    workspacesStore.getState().saveAs("temp");
    const idTemp = parNom("temp")?.id ?? "";
    workspacesStore.getState().rename(idTemp, "renommé");
    expect(workspacesStore.getState().workspaces.find((w) => w.id === idTemp)?.name).toBe("renommé");

    workspacesStore.getState().rename(DEFAULT_WORKSPACE_ID, "piraté");
    expect(workspacesStore.getState().workspaces.find((w) => w.id === DEFAULT_WORKSPACE_ID)?.name).toBe(
      "Défaut"
    );
  });

  it("supprime un preset ; « Défaut » indestructible ; bascule sur Défaut si courant", () => {
    workspacesStore.getState().saveAs("jetable"); // currentId = jetable
    const idJetable = parNom("jetable")?.id ?? "";

    // Défaut indestructible.
    workspacesStore.getState().remove(DEFAULT_WORKSPACE_ID);
    expect(workspacesStore.getState().workspaces.some((w) => w.id === DEFAULT_WORKSPACE_ID)).toBe(true);

    // Supprime le preset courant -> disparait + currentId retombe sur Défaut.
    workspacesStore.getState().remove(idJetable);
    expect(workspacesStore.getState().workspaces.some((w) => w.id === idJetable)).toBe(false);
    expect(workspacesStore.getState().currentId).toBe(DEFAULT_WORKSPACE_ID);
  });
});

describe("workspacesStore — validation au chargement", () => {
  it("normalise un contenu persisté corrompu vers des défauts sûrs", async () => {
    installMockLocalStorage();
    localStorage.setItem(
      "axiom:workspaces:v1",
      JSON.stringify({
        workspaces: [
          { id: "defaut", name: "Défaut", content: {} },
          {
            id: "x",
            name: "X",
            content: {
              exchange: "deribit", // source non câblée (retirée d'ExchangeId) -> binance
              symbol: "", // vide -> BTCUSDT
              priceScale: "diagonale", // -> normal
              theme: "neon", // inconnu -> dark
              orderflow: "non", // pas booléen -> false
              macroOverlays: ["m2", "bidon"], // "bidon" filtré
              sections: { a: 1 }, // valeur non booléenne écartée
              indicators: "pas-un-tableau", // -> []
            },
          },
        ],
        currentId: "x",
      })
    );

    vi.resetModules();
    const mod = await import("./workspaces");
    const wsX = mod.workspacesStore.getState().workspaces.find((w) => w.id === "x");

    expect(wsX?.content.exchange).toBe("binance");
    expect(wsX?.content.symbol).toBe("BTCUSDT");
    expect(wsX?.content.priceScale).toBe("normal");
    expect(wsX?.content.theme).toBe("dark");
    expect(wsX?.content.orderflow).toBe(false);
    expect(wsX?.content.macroOverlays).toEqual(["m2"]);
    expect(wsX?.content.sections).toEqual({});
    expect(wsX?.content.indicators).toEqual([]);
  });

  // Source de vérité unique (EXCHANGE_IDS) : la restauration doit accepter TOUTE source
  // câblée, y compris "synthetic" (9ᵉ entrée absente de la copie locale historique).
  // Régression si RESTORABLE_EXCHANGES diverge de l'autorité @axiom/types.
  it("restaure un workspace persisté avec la source 'synthetic' (liste complète des exchanges câblés)", async () => {
    installMockLocalStorage();
    localStorage.setItem(
      "axiom:workspaces:v1",
      JSON.stringify({
        workspaces: [
          { id: "defaut", name: "Défaut", content: contenuVierge() },
          { id: "synth", name: "Synth", content: { ...contenuVierge(), exchange: "synthetic" } },
        ],
        currentId: "synth",
      })
    );

    vi.resetModules();
    const mod = await import("./workspaces");
    const wsSynth = mod.workspacesStore.getState().workspaces.find((w) => w.id === "synth");

    expect(wsSynth?.content.exchange).toBe("synthetic");
  });

  it("un workspace relu depuis localStorage conserve l'état ouvert des fenêtres (sémantique unique, revue v2 H15)", async () => {
    windowManagerStore.getState().openWindow("derivatives");
    workspacesStore.getState().saveAs("plan");

    // Simule un reload : ré-exécute la lecture initiale (module frais) sur le JSON
    // réellement persisté par la sauvegarde ci-dessus — même mécanique que le test de
    // corruption ci-dessus (vi.resetModules() + réimport lit `axiom:workspaces:v1`).
    vi.resetModules();
    const mod = await import("./workspaces");
    const plan = mod.workspacesStore.getState().workspaces.find((w) => w.name === "plan");

    expect(plan?.content.windowGeometry["derivatives"]?.open).toBe(true);
  });
});

describe("workspacesStore — re-clamp de la géométrie à l'apply", () => {
  it("une fenêtre ouverte sauvegardée hors du workspace courant est re-clampée dans ses bornes (revue whole-branch #1)", () => {
    const workspace = { x: 0, y: 0, width: 1920, height: 1080 };
    windowManagerStore.setState({ windows: {}, workspace });

    // Contenu « grand écran » : une fenêtre ouverte positionnée bien au-delà du
    // workspace courant (ex. sauvegardée sur un moniteur plus large).
    const contenu: WorkspaceContent = {
      ...contenuVierge(),
      windowGeometry: {
        derivatives: {
          id: "derivatives",
          open: true,
          x: 5000,
          y: 5000,
          width: 420,
          height: 640,
          z: 1,
          minimized: false,
          groupColor: null,
          preSnapGeometry: null,
        },
      },
    };
    workspacesStore.setState({
      workspaces: [
        { id: DEFAULT_WORKSPACE_ID, name: "Défaut", content: contenuVierge() },
        { id: "grand-ecran", name: "Grand écran", content: contenu },
      ],
      currentId: DEFAULT_WORKSPACE_ID,
    });

    workspacesStore.getState().apply("grand-ecran");

    const fenetre = windowManagerStore.getState().windows["derivatives"];
    expect(fenetre?.open).toBe(true);
    // Re-clampée : entièrement contenue dans le workspace courant, pas seulement un bord.
    expect(fenetre?.x).toBeLessThanOrEqual(workspace.x + workspace.width - (fenetre?.width ?? 0));
    expect(fenetre?.y).toBeLessThanOrEqual(workspace.y + workspace.height - (fenetre?.height ?? 0));
  });
});
