/**
 * Tests des fonctions PURES du registre de commandes : parsing de navigation,
 * score fuzzy et filtrage. Les valeurs attendues sont justifiées en commentaire.
 * Vérifie aussi l'UNICITÉ GLOBALE des ids et mnémoniques sur l'union de TOUTES les
 * sources de commandes greffées par App.tsx / Toolbar.tsx (voir dernier describe).
 *
 * registry.ts (et les modules chart importés plus bas) tirent des modules à effet de
 * bord non évaluables hors navigateur (store/theme pose [data-theme] sur <html> au
 * chargement ; chart/drawing et klinecharts exigent `window`). On les neutralise via
 * vi.mock — même approche que drawing.test.ts — pour importer en environnement Node.
 */
import { describe, it, expect, vi } from "vitest";

// Le thème : forme minimale (THEMES + getState().setTheme) + `subscribe` inerte —
// chart/tradeMarkers s'abonne au thème à l'import (contrôleur démarré par effet de bord).
vi.mock("../store/theme", () => ({
  THEMES: ["dark", "bloomberg", "matrix", "cute", "aurora"] as const,
  themeStore: {
    getState: () => ({ theme: "dark", setTheme: () => {} }),
    subscribe: () => () => {},
  },
}));
// Le pont de dessin : stubs inertes (aucune de ces actions n'est exécutée ici).
// `getActiveChart`/`setFocusChart` : lus par les contrôleurs de chart/tradeMarkers et
// lib/navigation (via store/screener) démarrés à l'import — null = aucun chart actif.
vi.mock("../chart/drawing", () => ({
  exportChartImage: () => {},
  clearAllOverlays: () => {},
  getActiveChart: () => null,
  setFocusChart: () => {},
}));
// klinecharts (build UMD exigeant `window`) : stubs pour importer les modules chart —
// tradeMarkers et lib/navigation appellent registerOverlay ; liquidationHeat importe
// ActionType/DomPosition (lus uniquement dans des méthodes jamais exécutées ici).
vi.mock("klinecharts", () => ({
  registerOverlay: () => {},
  ActionType: {},
  DomPosition: {},
}));

import {
  parseNavigation,
  scoreFuzzy,
  rechercher,
  construireRegistre,
  commandeNavigation,
  appliquerNavigation,
  type Commande,
  type NavCommande,
} from "./registry";
import { marketStore } from "../store/market";
import { toastsStore, retirerToast } from "../store/toasts";
// ─── Sources de commandes greffées par App.tsx (`enregistrerCommandes([...])`) ───
// Ces modules n'enregistrent RIEN eux-mêmes : ils exportent un tableau `Commande[]`
// que App.tsx (ou Toolbar.tsx) greffe par side-effect d'import. On importe donc les
// tableaux BRUTS pour asserter l'unicité globale AVANT le dédoublonnage par id
// d'`enregistrerCommandes` (qui masquerait justement une collision d'ids).
// L'import de tradeMarkers / liquidation* démarre leurs contrôleurs (effet de bord) :
// inertes ici grâce aux mocks theme / drawing / klinecharts ci-dessus.
import { ecoCommands } from "../store/eco";
import { commandes as newsCommandes } from "../store/news";
import { commandes as onchainCommandes } from "../store/onchain";
import { commandes as portfolioCommandes } from "../store/portfolio";
import { commandes as notesCommandes } from "../store/notes";
import { commandesScreener } from "../store/screener";
import { commandesSignaux } from "../store/signaux";
import { commandes as derivChartCommandes } from "../store/derivatives-chart";
import { commandes as marksCommandes } from "../chart/tradeMarkers";
import { commandes as liqMarksCommandes } from "../chart/liquidationMarkers";
import { commandes as liqModeCommandes } from "../chart/liquidationHeat";
import { commandes as liqEstCommandes } from "../chart/liquidationEstimates";
import { commandes as whaleCommandes } from "../chart/whaleBubbles";
import { commandes as domCommandes } from "../store/dom-ui";
import { commandes as backtestCommandes } from "../store/backtest";
import { commandes as replayCommandes } from "../store/replay";
import { commandes as globeCommandes } from "../store/globe-ui";
import { commandes as tickerCommandes } from "../store/tickerBand";
import { windowPanelCommands } from "./windowPanels";
import { commandesOnboarding } from "../store/onboarding";
import { commandesPlaybooks } from "../data/playbooks";

/**
 * Toutes les sources IMPORTABLES de commandes greffées, nommées pour le diagnostic
 * (clé = module source). Miroir de la liste `enregistrerCommandes([...])` de App.tsx.
 */
const SOURCES_GREFFEES: Record<string, readonly Commande[]> = {
  "store/eco": ecoCommands,
  "store/news": newsCommandes,
  "store/onchain": onchainCommandes,
  "store/portfolio": portfolioCommandes,
  "store/notes": notesCommandes,
  "store/screener": commandesScreener,
  "store/signaux": commandesSignaux,
  "store/derivatives-chart": derivChartCommandes,
  "chart/tradeMarkers": marksCommandes,
  "chart/liquidationMarkers": liqMarksCommandes,
  "chart/liquidationHeat": liqModeCommandes,
  "chart/liquidationEstimates": liqEstCommandes,
  "chart/whaleBubbles": whaleCommandes,
  "store/dom-ui": domCommandes,
  "store/backtest": backtestCommandes,
  "store/replay": replayCommandes,
  "store/globe-ui": globeCommandes,
  "store/tickerBand": tickerCommandes,
  "commands/windowPanels": windowPanelCommands,
  "store/onboarding": commandesOnboarding,
  "data/playbooks": commandesPlaybooks,
};

/**
 * Sources inline NON importables en environnement de test — miroir statique (id +
 * mnémonique seulement), à maintenir à la main si ces définitions inline changent :
 *  - `commandesGrille` : défini inline dans App.tsx (l'importer tirerait tout le rendu
 *    React et les fenêtres lazy) ;
 *  - `workspace:*` : défini inline dans Toolbar.tsx (importe chart/Chart → klinecharts
 *    et des composants React non évaluables hors navigateur).
 * Le miroir verrouille les sources IMPORTÉES contre une collision avec ces mnémoniques
 * connus. Une commande inline AJOUTÉE plus tard à App.tsx ou Toolbar.tsx est détectée
 * par le test « aucun mnémonique inline inconnu » (scan des sources) plus bas.
 */
const MIROIR_COMMANDES_INLINE: { id: string; mnemonique: string; source: string }[] = [
  { id: "layout:1", mnemonique: "GRID1", source: "App.tsx (inline)" },
  { id: "layout:2h", mnemonique: "GRID2", source: "App.tsx (inline)" },
  { id: "layout:2v", mnemonique: "GRID2V", source: "App.tsx (inline)" },
  { id: "layout:2x2", mnemonique: "GRID4", source: "App.tsx (inline)" },
  { id: "workspace:enregistrer", mnemonique: "WS", source: "Toolbar.tsx (inline)" },
  { id: "workspace:exporter", mnemonique: "BACKUP", source: "Toolbar.tsx (inline)" },
  { id: "workspace:importer", mnemonique: "RESTORE", source: "Toolbar.tsx (inline)" },
];

describe("parseNavigation — symbole + timeframe + source, ordre libre", () => {
  it("complète une base crypto nue en …USDT", () => {
    // « BTC » → base sans cotation → complétée en BTCUSDT.
    expect(parseNavigation("BTC")).toEqual({ symbol: "BTCUSDT" });
  });

  it("parse « SOL 4H » = symbole SOLUSDT + timeframe 4h", () => {
    expect(parseNavigation("SOL 4H")).toEqual({ symbol: "SOLUSDT", timeframe: "4h" });
  });

  it("est insensible à l'ordre et à la casse (« 4h sol binance »)", () => {
    expect(parseNavigation("4h sol binance")).toEqual({
      symbol: "SOLUSDT",
      timeframe: "4h",
      source: "binance",
    });
  });

  it("conserve un symbole déjà suffixé d'une cotation connue (BTCUSDT)", () => {
    expect(parseNavigation("BTCUSDT")).toEqual({ symbol: "BTCUSDT" });
  });

  it("distingue minute (15M) et mois (1MO) via la convention M / MO", () => {
    // 15M = 15 minutes ; 1MO = 1 mois (identifiant Timeframe « 1M »).
    expect(parseNavigation("ETH 15M")).toEqual({ symbol: "ETHUSDT", timeframe: "15m" });
    expect(parseNavigation("ETH 1MO")).toEqual({ symbol: "ETHUSDT", timeframe: "1M" });
  });

  it("n'ajoute pas de cotation en source tradfi (SPY reste SPY)", () => {
    expect(parseNavigation("SPY TRADFI")).toEqual({ symbol: "SPY", source: "twelvedata" });
  });

  it("conserve un symbole au format à slash (EUR/USD)", () => {
    expect(parseNavigation("EUR/USD TD")).toEqual({ symbol: "EUR/USD", source: "twelvedata" });
  });

  it("gère un préfixe numérique (1000PEPE → 1000PEPEUSDT)", () => {
    expect(parseNavigation("1000PEPE")).toEqual({ symbol: "1000PEPEUSDT" });
  });

  it("renvoie null sur saisie vide", () => {
    expect(parseNavigation("   ")).toBeNull();
  });

  it("timeframe seul (sans symbole) est valide", () => {
    expect(parseNavigation("1d")).toEqual({ timeframe: "1d" });
  });
});

describe("commandeNavigation — libellé explicite quand la paire change", () => {
  it("un changement de paire s'annonce explicitement dans la palette", () => {
    const cmd = commandeNavigation({ symbol: "DERIVUSDT" });
    expect(cmd.libelle).toBe("Changer la paire → DERIVUSDT");
    const tf = commandeNavigation({ timeframe: "4h" });
    expect(tf.libelle).toBe("Aller à 4h");
  });
});

describe("appliquerNavigation — garde du toast de changement de paire", () => {
  it("ne pousse AUCUN toast si le symbole ne change pas", () => {
    const avant = marketStore.getState();
    const identiteAvant = { exchange: avant.exchange, symbol: avant.symbol, timeframe: avant.timeframe };
    const toastsAvant = toastsStore.getState().toasts;

    appliquerNavigation({ symbol: identiteAvant.symbol });

    // Aucun setState : références inchangées (marché ET toasts).
    expect(toastsStore.getState().toasts).toBe(toastsAvant);
    const apres = marketStore.getState();
    expect({ exchange: apres.exchange, symbol: apres.symbol, timeframe: apres.timeframe }).toEqual(
      identiteAvant,
    );
  });

  it("pousse un toast avec Annuler si la paire change, et Annuler restaure exchange+symbol+timeframe", () => {
    vi.useFakeTimers();
    try {
      const avant = marketStore.getState();
      const identiteAvant = { exchange: avant.exchange, symbol: avant.symbol, timeframe: avant.timeframe };
      const nav: NavCommande =
        identiteAvant.exchange === "kraken"
          ? { source: "binance", symbol: "ETHUSDT", timeframe: "4h" }
          : { source: "kraken", symbol: "ETHUSDT", timeframe: "4h" };

      appliquerNavigation(nav);

      // La paire a bien changé, et un toast Annuler a été poussé.
      const apresChangement = marketStore.getState();
      expect(apresChangement.symbol).toBe("ETHUSDT");
      const toasts = toastsStore.getState().toasts;
      const dernier = toasts[toasts.length - 1];
      expect(dernier?.action?.libelle).toBe("Annuler");

      dernier?.action?.executer();

      // Annuler restaure l'identité exacte d'avant (exchange + symbole + timeframe).
      const apresAnnuler = marketStore.getState();
      expect({
        exchange: apresAnnuler.exchange,
        symbol: apresAnnuler.symbol,
        timeframe: apresAnnuler.timeframe,
      }).toEqual(identiteAvant);
    } finally {
      // Nettoyage : purge tout toast résiduel et ses minuteurs avant de rendre la main.
      for (const t of toastsStore.getState().toasts) retirerToast(t.id);
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });
});

describe("scoreFuzzy — sous-séquence + ordonnancement", () => {
  it("renvoie null quand ce n'est pas une sous-séquence", () => {
    // « xyz » n'est pas une sous-séquence de « rsi ».
    expect(scoreFuzzy("xyz", "rsi")).toBeNull();
  });

  it("renvoie 0 pour une requête vide (tout correspond)", () => {
    expect(scoreFuzzy("", "n'importe quoi")).toBe(0);
  });

  it("accepte une sous-séquence non contiguë", () => {
    // « bb » est une sous-séquence de « bollinger bands ».
    expect(scoreFuzzy("bb", "bollinger bands")).not.toBeNull();
  });

  it("score une correspondance contiguë en début de mot mieux qu'éparse", () => {
    const contigu = scoreFuzzy("rsi", "rsi");
    const epars = scoreFuzzy("rsi", "relative strength index");
    expect(contigu).not.toBeNull();
    expect(epars).not.toBeNull();
    // Non-null garantis ci-dessus.
    expect((contigu as number) > (epars as number)).toBe(true);
  });
});

describe("rechercher — filtrage + tri par pertinence", () => {
  const registre: Commande[] = [
    { id: "a", mnemonique: "RSI", libelle: "RSI — activer", categorie: "indicateur", motsCles: ["momentum"], action: () => {} },
    { id: "b", mnemonique: "DES", libelle: "Produits dérivés", categorie: "panneau", motsCles: ["funding"], action: () => {} },
    { id: "c", libelle: "Timeframe 4h", categorie: "timeframe", motsCles: ["tf", "4h"], action: () => {} },
  ];

  it("renvoie le registre inchangé pour une requête vide", () => {
    expect(rechercher(registre, "").map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("exclut les commandes sans correspondance", () => {
    // « momentum » (mot-clé de a) n'est sous-séquence d'aucune autre commande.
    expect(rechercher(registre, "momentum").map((c) => c.id)).toEqual(["a"]);
  });

  it("classe en tête la commande dont le mnémonique commence par la requête", () => {
    // « des » démarre le mnémonique DES → bonus de tête.
    const res = rechercher(registre, "des");
    expect(res[0]?.id).toBe("b");
  });

  it("trouve via les mots-clés (funding → DES)", () => {
    expect(rechercher(registre, "funding").map((c) => c.id)).toEqual(["b"]);
  });
});

describe("construireRegistre — commandes attendues présentes", () => {
  const registre = construireRegistre();
  const ids = new Set(registre.map((c) => c.id));
  const mnemos = new Set(registre.map((c) => c.mnemonique));

  it("contient les mnémoniques de panneaux Bloomberg", () => {
    for (const m of ["DES", "MON", "MACRO", "SANTE", "ALRT", "REGLAGES"]) {
      expect(mnemos.has(m)).toBe(true);
    }
  });

  it("expose une commande de bascule pour l'indicateur RSI", () => {
    expect(ids.has("ind:rsi")).toBe(true);
  });

  it("expose les 11 timeframes et les 5 thèmes", () => {
    expect(registre.filter((c) => c.categorie === "timeframe")).toHaveLength(11);
    expect(registre.filter((c) => c.categorie === "theme")).toHaveLength(5);
  });
});

describe("unicité globale — ids et mnémoniques de TOUTES les sources", () => {
  // Union BRUTE : registre statique + sources greffées + miroir inline, chaque entrée
  // étiquetée de sa source pour le diagnostic. Volontairement AVANT tout passage par
  // `enregistrerCommandes` : son dédoublonnage par id masquerait une collision d'ids
  // entre deux sources. Aucun compte total figé : robuste à l'ajout de commandes.
  const union: { id: string; mnemonique: string | undefined; source: string }[] = [
    ...construireRegistre().map((c) => ({
      id: c.id,
      mnemonique: c.mnemonique,
      source: "registry (statique)",
    })),
    ...Object.entries(SOURCES_GREFFEES).flatMap(([source, cmds]) =>
      cmds.map((c) => ({ id: c.id, mnemonique: c.mnemonique, source })),
    ),
    ...MIROIR_COMMANDES_INLINE,
  ];

  it("chaque source greffée fournit au moins une commande", () => {
    // Garde contre une couverture silencieusement vidée (export cassé, mock trop large).
    for (const [source, cmds] of Object.entries(SOURCES_GREFFEES)) {
      expect(cmds.length, `source ${source} vide`).toBeGreaterThan(0);
    }
  });

  it("aucun id dupliqué entre toutes les sources", () => {
    // SENSIBLE à la casse, comme le dédoublonnage (===) d'`enregistrerCommandes` :
    // « tf:1m » (minute) et « tf:1M » (mois) coexistent par design.
    const vus = new Map<string, string>();
    for (const c of union) {
      expect(
        vus.get(c.id),
        `id « ${c.id} » dupliqué entre ${vus.get(c.id)} et ${c.source}`,
      ).toBeUndefined();
      vus.set(c.id, c.source);
    }
  });

  it("aucun mnémonique dupliqué entre toutes les sources (insensible à la casse)", () => {
    const vus = new Map<string, string>();
    for (const c of union) {
      if (c.mnemonique === undefined) continue;
      const cle = c.mnemonique.toLowerCase();
      expect(
        vus.get(cle),
        `« ${c.mnemonique} » dupliqué entre ${vus.get(cle)} et ${c.id} (${c.source})`,
      ).toBeUndefined();
      vus.set(cle, `${c.id} (${c.source})`);
    }
  });

  it("aucun mnémonique inline inconnu dans App.tsx / Toolbar.tsx (scan des sources)", async () => {
    // Ferme la limite du miroir statique : tout littéral `mnemonique: "X"` écrit dans
    // ces deux fichiers doit exister dans l'union (miroir inline, source greffée ou
    // registre statique — les entrées de MENU réutilisent le mnémonique de leur
    // commande, ex. TICKER). Une commande inline ajoutée avec un mnémonique NEUF fait
    // donc échouer ce test tant que MIROIR_COMMANDES_INLINE n'est pas mis à jour.
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const connus = new Set(
      union.filter((c) => c.mnemonique !== undefined).map((c) => c.mnemonique!.toLowerCase()),
    );
    const FICHIERS = ["../App.tsx", "../components/Toolbar.tsx"];
    const inconnus: string[] = [];
    for (const rel of FICHIERS) {
      const source = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf-8");
      for (const m of source.matchAll(/\bmnemonique\s*:\s*"([^"]+)"/g)) {
        const mnemo = m[1] as string;
        if (!connus.has(mnemo.toLowerCase())) inconnus.push(`${rel} : « ${mnemo} »`);
      }
    }
    expect(inconnus, "mnémonique(s) inline hors miroir — mettre à jour MIROIR_COMMANDES_INLINE").toEqual([]);
  });
});
