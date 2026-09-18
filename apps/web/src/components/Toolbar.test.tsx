/**
 * Garde de sécurité de l'export de sauvegarde (revue 2026-09, A/B).
 *
 * Le fichier exporté exclut les credentials locaux : l'action est directe et son
 * aperçu indique que les clés devront être ressaisies.
 *
 * Env vitest node (pas de jsdom dans apps/web) : on stub le strict nécessaire de
 * `document`/`window` pour que la chaîne d'imports de Toolbar s'évalue, et on n'exerce
 * que les commandes de la palette (aucun rendu React).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// klinecharts n'est pas évaluable hors navigateur (cf. store/persist.test.ts).
vi.mock("../chart/Chart", async () => {
  const { createStore } = await import("zustand/vanilla");
  const priceScaleStore = createStore<{ type: string; setType: (t: string) => void }>((set) => ({
    type: "normal",
    setType: (type) => set({ type }),
  }));
  return { priceScaleStore };
});
// chart/drawing enregistre les overlays fibo dans klinecharts au chargement.
vi.mock("../chart/drawing", () => ({ exportChartImage: () => {} }));
// Espion sur l'effet de bord réel : c'est lui qui ne doit PAS partir sans confirmation.
vi.mock("../store/persist", () => ({
  exporterSauvegarde: vi.fn(),
  importerSauvegarde: vi.fn(() => true),
}));

const documentStub = {
  documentElement: { setAttribute: () => {}, style: { setProperty: () => {} } },
  createElement: () => ({ click: () => {}, remove: () => {}, style: {} }),
  body: { appendChild: () => {}, removeChild: () => {} },
  addEventListener: () => {},
  removeEventListener: () => {},
  hasFocus: () => true,
};
const confirmSpy = vi.fn((_message?: string) => true);
const windowStub = {
  confirm: confirmSpy,
  addEventListener: () => {},
  removeEventListener: () => {},
  matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
};
// Posés AVANT l'import dynamique de Toolbar (sa chaîne d'imports touche le DOM).
(globalThis as unknown as { document: unknown }).document = documentStub;
(globalThis as unknown as { window: unknown }).window = windowStub;

const { exporterSauvegarde } = await import("../store/persist");
const { SECTIONS_FONCTIONS, entreeNeuve } = await import("./Toolbar"); // enregistre aussi les commandes ⌘K
const { construireRegistre } = await import("../commands/registry");
const { cryptoquantUiStore, ENTREES_CQ } = await import("../store/cryptoquantUi");
const { windowManagerStore } = await import("../store/windowManager");

/** La commande ⌘K d'export (enregistrée par Toolbar via `enregistrerCommandes`). */
function commandeExport() {
  const cmd = construireRegistre().find((c) => c.id === "workspace:exporter");
  if (!cmd) throw new Error("commande workspace:exporter absente du registre");
  return cmd;
}

describe("export de sauvegarde sans credential", () => {
  beforeEach(() => {
    vi.mocked(exporterSauvegarde).mockClear();
    confirmSpy.mockClear();
    confirmSpy.mockReturnValue(true);
  });

  it("exporte directement, sans confirmation devenue inutile", () => {
    commandeExport().action();
    expect(exporterSauvegarde).toHaveBeenCalledTimes(1);
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

describe("aperçu ⌘K de l'export", () => {
  it("porte la même promesse d'exclusion des clés API", () => {
    const apercu = commandeExport().apercu ?? "";
    expect(apercu).toMatch(/clés API/i);
    expect(apercu).toMatch(/exclues/i);
  });

  it("prévient que les clés devront être ressaisies", () => {
    const apercu = commandeExport().apercu ?? "";
    expect(apercu).toMatch(/ressaisir/i);
  });
});

/**
 * Menu « Fonctions » : les deux entrées de NAVIGATION CryptoQuant (décision du propriétaire
 * du 2026-09-18). Elles ne sont PAS des fenêtres du registre — elles posent une cible dans le
 * magasin d'intention, qui ouvre la fenêtre hôte et fait déplier la section visée.
 *
 * Pas de rendu React ici (environnement node, patron du reste du fichier) : les entrées sont
 * lues dans `SECTIONS_FONCTIONS` et leur `ouvrir()` est exécuté contre les stores RÉELS.
 */
describe("menu Fonctions : entrées de navigation CryptoQuant", () => {
  /** Entrées d'un groupe du menu, ou `[]` si le groupe n'existe pas. */
  function entrees(groupe: string) {
    return SECTIONS_FONCTIONS.find((s) => s.groupe === groupe)?.entrees ?? [];
  }
  function entree(groupe: string, mnemonique: string) {
    const e = entrees(groupe).find((f) => f.mnemonique === mnemonique);
    if (!e) throw new Error(`entrée ${mnemonique} absente du groupe « ${groupe} »`);
    return e;
  }

  beforeEach(() => {
    cryptoquantUiStore.setState({ cible: null });
  });

  it("CQTAKR vit dans « Marché & dérivés », en fin de groupe, avec son libellé exact", () => {
    const groupe = entrees("Marché & dérivés");
    const e = entree("Marché & dérivés", "CQTAKR");
    expect(e.libelle).toBe("Flux takers toutes places (CryptoQuant)");
    // Entrée spéciale : le tri par mnémonique du registre ne s'applique pas, elle suit les
    // fenêtres du groupe (comme TICKER dans « Outils »).
    expect(groupe[groupe.length - 1]?.mnemonique).toBe("CQTAKR");
  });

  it("CQMINE vit dans « On-chain & stablecoins », en fin de groupe, avec son libellé exact", () => {
    const groupe = entrees("On-chain & stablecoins");
    const e = entree("On-chain & stablecoins", "CQMINE");
    expect(e.libelle).toBe("Production des mineurs cotés (CryptoQuant)");
    expect(groupe[groupe.length - 1]?.mnemonique).toBe("CQMINE");
  });

  it("aucune des deux entrées n'est une fenêtre du registre ; leur badge a son propre id", () => {
    const takers = entree("Marché & dérivés", "CQTAKR");
    const mineurs = entree("On-chain & stablecoins", "CQMINE");
    for (const e of [takers, mineurs]) {
      expect(e.id).toBeUndefined();
      expect(e.nouveau).toBe(true);
    }
    expect(takers.badgeId).toBe(ENTREES_CQ.takers.badge);
    expect(mineurs.badgeId).toBe(ENTREES_CQ.mineurs.badge);
  });

  it("badge « nouveau » affiché avant le 1er clic, éteint après, et seulement pour sa section", () => {
    const valeurs = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => valeurs.get(k) ?? null,
      setItem: (k: string, v: string) => void valeurs.set(k, v),
      removeItem: (k: string) => void valeurs.delete(k),
      clear: () => valeurs.clear(),
      key: () => null,
      length: 0,
    });
    try {
      const takers = entree("Marché & dérivés", "CQTAKR");
      const mineurs = entree("On-chain & stablecoins", "CQMINE");
      expect(entreeNeuve(takers)).toBe(true);
      expect(entreeNeuve(mineurs)).toBe(true);
      takers.ouvrir();
      expect(entreeNeuve(takers)).toBe(false);
      // L'autre entrée garde son badge : les clés « vue » sont distinctes.
      expect(entreeNeuve(mineurs)).toBe(true);
      // Une entrée sans clé de badge (TICKER) n'en affiche jamais.
      expect(entreeNeuve({ mnemonique: "TICKER", libelle: "x", nouveau: true, ouvrir: () => {} })).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("ouvrir() : CQTAKR demande la section takers et ouvre DES", () => {
    entree("Marché & dérivés", "CQTAKR").ouvrir();
    expect(cryptoquantUiStore.getState().cible).toBe("takers");
    expect(windowManagerStore.getState().windows["derivatives"]?.open).toBe(true);
  });

  it("ouvrir() : CQMINE demande la section mineurs et ouvre CHAIN", () => {
    entree("On-chain & stablecoins", "CQMINE").ouvrir();
    expect(cryptoquantUiStore.getState().cible).toBe("mineurs");
    expect(windowManagerStore.getState().windows["onchain"]?.open).toBe(true);
  });
});
