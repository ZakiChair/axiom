/**
 * Budget de hauteur des panes. Deux exigences opposées à tenir ensemble :
 *  - le pane prix ne doit jamais être étouffé (le cas mesuré avant correctif :
 *    sept oscillateurs, pane prix à 4 px CSS) ;
 *  - le redimensionnement manuel à la poignée doit TENIR, y compris au-delà de la
 *    hauteur par défaut — une première version rognait tout à chaque frame et rendait
 *    la poignée inerte.
 *
 * Les tests d'invariant balaient plusieurs valeurs de PART_PRIX_MIN plutôt que d'en
 * relire la constante : abaisser la garantie doit faire ÉCHOUER la suite, pas la
 * suivre en silence.
 */
import { describe, expect, it } from "vitest";
import {
  HAUTEUR_PANE_MIN,
  PART_PRIX_MIN,
  hauteursCorrigees,
  paneMax,
} from "./paneBudget";

describe("hauteursCorrigees", () => {
  it("ne corrige rien quand il n'y a aucun pane séparé", () => {
    expect(hauteursCorrigees(565, [])).toBeNull();
  });

  it("ne corrige rien quand la hauteur n'est pas encore connue (montage)", () => {
    expect(hauteursCorrigees(0, [100, 100])).toBeNull();
    expect(hauteursCorrigees(Number.NaN, [100])).toBeNull();
  });

  it("LAISSE INTACT un pane agrandi à la main tant que le prix garde sa part", () => {
    // 900 px utiles, budget = 495. Un pane à 250 px (bien au-dessus du défaut de 100)
    // et un à 100 : total 350 ≤ 495 → aucune correction, la poignée tient.
    expect(hauteursCorrigees(900, [250, 100])).toBeNull();
  });

  it("rogne quand le prix est étouffé, et RESPECTE les proportions voulues", () => {
    // 600 utiles, budget = 330. Panes à 300 et 150 (total 450) → facteur 0,733.
    const corrigees = hauteursCorrigees(600, [300, 150]);
    expect(corrigees).not.toBeNull();
    const [a, b] = corrigees ?? [];
    expect((a ?? 0) + (b ?? 0)).toBeLessThanOrEqual(600 * (1 - PART_PRIX_MIN));
    // Le pane que l'utilisateur avait agrandi reste le plus grand.
    expect(a).toBeGreaterThan(b ?? 0);
  });

  it("reproduit le cas mesuré : sept panes de 100 px sur 806 px utiles", () => {
    const corrigees = hauteursCorrigees(806, Array(7).fill(100));
    expect(corrigees).not.toBeNull();
    const total = (corrigees ?? []).reduce((s, h) => s + h, 0);
    const prix = 806 - total;
    expect(prix / 806).toBeGreaterThanOrEqual(PART_PRIX_MIN - 0.01);
  });

  it("ne descend jamais un pane sous le plancher de lisibilité", () => {
    const corrigees = hauteursCorrigees(400, Array(10).fill(100)) ?? [];
    for (const h of corrigees) expect(h).toBeGreaterThanOrEqual(HAUTEUR_PANE_MIN);
  });

  it("n'émet rien quand tout est déjà au plancher (pas de réécriture à chaque frame)", () => {
    // 300 utiles, 5 panes déjà à 60 px : la correction proportionnelle les y laisse.
    expect(hauteursCorrigees(300, Array(5).fill(HAUTEUR_PANE_MIN))).toBeNull();
  });

  it("est IDEMPOTENT : réappliquer la correction ne change plus rien", () => {
    const une = hauteursCorrigees(600, [300, 150]);
    expect(une).not.toBeNull();
    expect(hauteursCorrigees(600, une ?? [])).toBeNull();
  });

  it("garantit la part du prix sous plusieurs valeurs de garantie (test non tautologique)", () => {
    // On ne relit pas PART_PRIX_MIN pour construire le cas : on vérifie que la part
    // effectivement rendue au prix atteint au moins 0,40 — plancher qui échouerait si
    // quelqu'un abaissait la garantie à 0,20 « pour laisser plus de place ».
    for (const utile of [400, 565, 806, 1200]) {
      for (const n of [2, 4, 7, 10]) {
        const corrigees = hauteursCorrigees(utile, Array(n).fill(100)) ?? Array(n).fill(100);
        const prix = utile - corrigees.reduce((s, h) => s + h, 0);
        // Au-delà du plafond de panes, le plancher de 60 px prime : on ne teste
        // l'invariant que dans le domaine où il est atteignable (rôle de paneMax).
        if (n <= paneMax(utile)) expect(prix / utile).toBeGreaterThanOrEqual(0.4);
      }
    }
  });
});

describe("paneMax", () => {
  it("vaut 0 sur une hauteur inconnue", () => {
    expect(paneMax(0)).toBe(0);
    expect(paneMax(Number.NaN)).toBe(0);
  });

  it("plafonne à 5 panes sur la hauteur où klinecharts en laissait passer 7", () => {
    expect(paneMax(565)).toBe(5);
  });

  it("croît avec la hauteur disponible", () => {
    expect(paneMax(1200)).toBeGreaterThan(paneMax(565));
  });

  it("reste cohérent avec le rognage : n panes au plafond tiennent dans le budget", () => {
    for (const utile of [400, 565, 806, 1200]) {
      const n = paneMax(utile);
      if (n === 0) continue;
      expect(n * HAUTEUR_PANE_MIN).toBeLessThanOrEqual(utile * (1 - PART_PRIX_MIN));
    }
  });
});
