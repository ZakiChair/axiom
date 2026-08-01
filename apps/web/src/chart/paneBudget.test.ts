/**
 * Budget de hauteur des panes. Le cas qui compte est celui mesuré dans le navigateur
 * avant le correctif : conteneur ~565 px, sept panes d'indicateurs → pane prix à 4 px.
 */
import { describe, expect, it } from "vitest";
import {
  HAUTEUR_PANE_DEFAUT,
  HAUTEUR_PANE_MIN,
  PART_PRIX_MIN,
  hauteurPaneIndicateur,
  paneMax,
} from "./paneBudget";

describe("hauteurPaneIndicateur", () => {
  it("laisse faire klinecharts quand il n'y a aucun pane séparé", () => {
    expect(hauteurPaneIndicateur(565, 0)).toBeNull();
  });

  it("laisse faire quand la hauteur n'est pas encore connue (montage)", () => {
    expect(hauteurPaneIndicateur(0, 3)).toBeNull();
    expect(hauteurPaneIndicateur(Number.NaN, 3)).toBeNull();
  });

  it("ne dépasse jamais la hauteur par défaut quand la place ne manque pas", () => {
    // 900 px, 2 panes : le budget (495) permettrait 247 px par pane — inutile.
    expect(hauteurPaneIndicateur(900, 2)).toBe(HAUTEUR_PANE_DEFAUT);
  });

  it("resserre les panes plutôt que d'écraser le prix", () => {
    // 565 px utiles, 5 panes (le plafond à cette hauteur) : sans budget, klinecharts
    // donnerait 5 × 100 = 500 px aux oscillateurs et 65 px au prix.
    const h = hauteurPaneIndicateur(565, 5);
    expect(h).not.toBeNull();
    expect(h).toBeLessThan(HAUTEUR_PANE_DEFAUT);
    expect((h ?? 0) * 5).toBeLessThanOrEqual(565 * (1 - PART_PRIX_MIN));
  });

  it("au-delà du plafond, le plancher de pane prime — d'où le refus à l'activation", () => {
    // 7 panes ne TIENNENT pas à 565 px : chacun tombe au plancher et le prix repasse
    // sous sa part. C'est précisément le cas que `paneMax` doit interdire en amont ;
    // le budget seul ne peut pas le rattraper, et ce test le dit explicitement.
    const h = hauteurPaneIndicateur(565, 7) ?? 0;
    expect(h).toBe(HAUTEUR_PANE_MIN);
    expect(7).toBeGreaterThan(paneMax(565));
  });

  it("garantit au prix sa part tant que le nombre de panes reste sous le plafond", () => {
    for (const utile of [400, 565, 800, 1200]) {
      const max = paneMax(utile);
      for (let n = 1; n <= max; n++) {
        const h = hauteurPaneIndicateur(utile, n) ?? 0;
        const restePrix = utile - h * n;
        expect(restePrix / utile).toBeGreaterThanOrEqual(PART_PRIX_MIN - 0.02);
      }
    }
  });

  it("ne descend jamais sous le plancher de lisibilité d'un pane", () => {
    expect(hauteurPaneIndicateur(565, 20)).toBe(HAUTEUR_PANE_MIN);
  });
});

describe("paneMax", () => {
  it("vaut 0 sur une hauteur inconnue", () => {
    expect(paneMax(0)).toBe(0);
    expect(paneMax(Number.NaN)).toBe(0);
  });

  it("plafonne à 5 panes sur la hauteur où klinecharts en laissait passer 7", () => {
    // 565 × 0,55 / 60 = 5,18. Cinq panes au plancher laissent 265 px au prix (46,9 %).
    expect(paneMax(565)).toBe(5);
  });

  it("croît avec la hauteur disponible", () => {
    expect(paneMax(1200)).toBeGreaterThan(paneMax(565));
  });
});
