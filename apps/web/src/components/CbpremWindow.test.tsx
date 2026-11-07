/**
 * Libellés de la fenêtre CBPREM : le z affiché est le z GLISSANT 7 j du dernier point, et
 * son absence est dite (« indisponible ») au lieu d'un chiffre ou d'un tiret ambigu.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CbpremWindow } from "./CbpremWindow";
import { cbpremStore } from "../store/cbprem";
import { statsPremium, type PointPremium } from "../data/cbprem";

// Le snapshot SSR de Zustand est figé à la création ; les fixtures visent ici l'état courant.
vi.mock("zustand", async (importOriginal) => ({
  ...(await importOriginal<typeof import("zustand")>()),
  useStore: <T, U>(store: { getState: () => T }, select: (state: T) => U) => select(store.getState()),
}));

const initial = cbpremStore.getState();
afterEach(() => cbpremStore.setState(initial, true));

const HEURE_MS = 3_600_000;

function rendu(serie: PointPremium[] | null): string {
  if (serie !== null) {
    cbpremStore.setState({ serie, serieAjustee: serie, stats: statsPremium(serie), majTs: 1, enCours: false });
  }
  return renderToStaticMarkup(<CbpremWindow />);
}

describe("CBPREM — libellés du z glissant 7 j", () => {
  it("affiche le z glissant du dernier point quand la fenêtre de 168 h suffit", () => {
    // Série 1..30 horaire : z(30) = 1.6752467319482305 (cf. data/cbprem.test.ts).
    const serie = Array.from({ length: 30 }, (_, k) => ({ t: k * HEURE_MS, premiumPct: k + 1 }));
    const html = rendu(serie);
    expect(html).toMatch(/Z glissant 7j <span[^>]*>1\.68<\/span>/);
    expect(html).not.toContain("Z 30j");
    expect(html).toContain("bandes ±2σ et z glissants 7 j, passé seul, descriptifs");
  });

  it("dit « indisponible » quand la série est trop courte pour un z", () => {
    const serie = Array.from({ length: 10 }, (_, k) => ({ t: k * HEURE_MS, premiumPct: k / 100 }));
    const html = rendu(serie);
    expect(html).toMatch(/Z glissant 7j <span[^>]*>indisponible<\/span>/);
  });

  it("avant tout run, le z reste un tiret (rien n'a encore été mesuré)", () => {
    // Rendu SSR : l'effet qui lance le run ne s'exécute pas, le store reste à l'état initial.
    const html = rendu(null);
    expect(html).toMatch(/Z glissant 7j <span[^>]*>—<\/span>/);
  });
});
