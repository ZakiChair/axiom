/**
 * Garde de sécurité de l'export de sauvegarde (revue 2026-09, A/B).
 *
 * Le fichier exporté est le SEUL artefact du terminal conçu pour quitter la machine et
 * il embarque les clés API en clair : il doit donc être précédé d'une confirmation, sur
 * le modèle de celle de l'import. L'aperçu ⌘K doit porter le même avertissement, et ne
 * plus promettre « tout le terminal » (la clé CoinGecko est hors préfixe `axiom:`).
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
await import("./Toolbar"); // enregistre les commandes ⌘K à l'import
const { construireRegistre } = await import("../commands/registry");

/** La commande ⌘K d'export (enregistrée par Toolbar via `enregistrerCommandes`). */
function commandeExport() {
  const cmd = construireRegistre().find((c) => c.id === "workspace:exporter");
  if (!cmd) throw new Error("commande workspace:exporter absente du registre");
  return cmd;
}

describe("export de sauvegarde — confirmation obligatoire", () => {
  beforeEach(() => {
    vi.mocked(exporterSauvegarde).mockClear();
    confirmSpy.mockClear();
    confirmSpy.mockReturnValue(true);
  });

  it("n'exporte RIEN si l'utilisateur annule la confirmation", () => {
    confirmSpy.mockReturnValue(false);
    commandeExport().action();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(exporterSauvegarde).not.toHaveBeenCalled();
  });

  it("exporte une fois la confirmation acceptée", () => {
    commandeExport().action();
    expect(exporterSauvegarde).toHaveBeenCalledTimes(1);
  });

  it("avertit des clés API en clair, du dépôt et du dossier synchronisé", () => {
    commandeExport().action();
    const message = String(confirmSpy.mock.calls[0]?.[0] ?? "");
    expect(message).toMatch(/clés API/i);
    expect(message).toMatch(/clair/i);
    expect(message).toMatch(/dépôt/i);
    expect(message).toMatch(/synchronisé/i);
  });
});

describe("aperçu ⌘K de l'export", () => {
  it("porte le même avertissement (clés API en clair)", () => {
    const apercu = commandeExport().apercu ?? "";
    expect(apercu).toMatch(/clés API/i);
    expect(apercu).toMatch(/clair/i);
  });

  it("ne promet plus « tout le terminal » : CoinGecko est hors export", () => {
    const apercu = commandeExport().apercu ?? "";
    expect(apercu).toMatch(/coingecko/i);
  });
});
