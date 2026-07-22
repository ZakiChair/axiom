/**
 * Tests des helpers PURS de raccourcis in-situ (`raccourciPour`, `raccourciTimeframe`)
 * dérivés de RACCOURCIS_AIDE, et de `lignesMnemoniques` (aide dérivée du registre réel).
 * hotkeys.ts (et registry.ts, importé ici pour construireRegistre) tirent des modules à
 * effet de bord non évaluables hors navigateur (store/theme pose [data-theme] ;
 * chart/drawing charge klinecharts ; chart/liquidationMarkers idem). On les neutralise
 * via vi.mock — même approche que registry.test.ts — pour importer les modules réels en
 * environnement Node.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../store/theme", () => ({
  THEMES: ["dark", "bloomberg", "matrix", "cute", "aurora"] as const,
  themeStore: { getState: () => ({ theme: "dark", setTheme: () => {} }) },
}));
vi.mock("../chart/drawing", () => ({
  exportChartImage: () => {},
  clearAllOverlays: () => {},
}));
vi.mock("../chart/liquidationMarkers", () => ({
  liqMarksStore: { getState: () => ({ basculer: () => {} }) },
}));

import { construireRegistre, enregistrerCommandes } from "./registry";
import { raccourciPour, raccourciTimeframe, lignesMnemoniques, timeframePourCode } from "./hotkeys";
// Les deux sources externes n'exportent qu'un tableau `Commande[]` — c'est App.tsx qui les
// greffe dans le registre via `enregistrerCommandes([...])`. Un simple import side-effect ne
// greffe donc RIEN dans `commandesExternes` (même remarque que registry.test.ts). On reproduit
// ici l'appel d'`enregistrerCommandes` pour que la dérivation ci-dessous couvre aussi ces deux
// sources injectables sans DOM (les ~17 autres, greffées par App.tsx, restent hors scope).
import { commandes as derivChartCommandes } from "../store/derivatives-chart";
import { windowPanelCommands } from "./windowPanels";

enregistrerCommandes([...derivChartCommandes, ...windowPanelCommands]);

describe("raccourciPour", () => {
  it("mappe les libellés de boutons vers leur touche (dérivé de RACCOURCIS_AIDE)", () => {
    expect(raccourciPour("Orderflow")).toBe("O");
    expect(raccourciPour("Profil Vol")).toBe("V");
    expect(raccourciPour("Revenus")).toBe("R");
    expect(raccourciPour("Liq")).toBe("L");
    expect(raccourciPour("Plein écran")).toBe("F");
    expect(raccourciPour("Thème")).toBe("T");
  });

  it("renvoie null pour un libellé inconnu", () => {
    expect(raccourciPour("Produits dérivés")).toBeNull();
    expect(raccourciPour("")).toBeNull();
  });
});

describe("raccourciTimeframe", () => {
  it("associe les 9 premiers timeframes aux chiffres 1-9", () => {
    expect(raccourciTimeframe("1m")).toBe("1");
    expect(raccourciTimeframe("5m")).toBe("2");
    expect(raccourciTimeframe("1h")).toBe("4");
    expect(raccourciTimeframe("3M")).toBe("9");
  });

  it("renvoie null pour les timeframes sans chiffre (au-delà de 9)", () => {
    expect(raccourciTimeframe("6M")).toBeNull();
    expect(raccourciTimeframe("12M")).toBeNull();
  });

  it("renvoie null pour un timeframe inconnu", () => {
    expect(raccourciTimeframe("42x")).toBeNull();
  });
});

describe("timeframePourCode", () => {
  it("mappe les codes physiques Digit/Numpad vers les timeframes (AZERTY inclus)", () => {
    expect(timeframePourCode("Digit1")).toBe("1m");
    expect(timeframePourCode("Numpad4")).toBe("1h");
    expect(timeframePourCode("Digit9")).toBe("3M");
    expect(timeframePourCode("KeyA")).toBeNull();
  });

  it("ignore Shift+chiffre quand la touche produit un symbole (QWERTY : Shift+5 = %)", () => {
    // Sur QWERTY, Shift+5 tape « % » — une saisie délibérée de symbole, pas un TF.
    expect(timeframePourCode("Digit5", { shiftKey: true, key: "%" })).toBeNull();
  });

  it("accepte Shift+chiffre quand la touche produit le chiffre (AZERTY : Shift requis)", () => {
    // Sur AZERTY, les chiffres EXIGENT Shift : e.key vaut bien « 5 » → TF légitime.
    expect(timeframePourCode("Digit5", { shiftKey: true, key: "5" })).toBe("4h");
    expect(timeframePourCode("Digit5", { shiftKey: false, key: "(" })).toBe("4h");
  });
});

describe("lignesMnemoniques", () => {
  it("chaque mnémonique du registre apparaît dans l'aide dérivée (l'aide ne peut plus se périmer)", () => {
    const registre = construireRegistre();
    // Ancrage anti-régression : si l'enregistrement des commandes externes disparaît,
    // le registre perd FRATE/STBL et ce test doit rougir (il serait sinon auto-référentiel).
    expect(registre.some((c) => c.mnemonique === "FRATE")).toBe(true);
    expect(registre.some((c) => c.mnemonique === "STBL")).toBe(true);
    const texte = lignesMnemoniques(registre).map((l) => l.description).join(" ");
    for (const c of registre) {
      if (c.mnemonique !== undefined) expect(texte).toContain(c.mnemonique);
    }
  });
});
