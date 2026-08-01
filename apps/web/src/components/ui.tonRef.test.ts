/**
 * Ton du RefBadge (D3). Les DEUX queues de distribution doivent se voir : les six usages
 * en production passaient `hausse-chaud`, si bien que la branche basse était du code
 * mort — un DVOL au 3ᵉ percentile s'affichait dans le même gris qu'un p40, alors que
 * c'est la configuration la plus actionnable de cette série (revue du 2026-08-01 § 6.4).
 *
 * Convention : haut = tension (warn), bas = compression (accent). Le `sens` dit
 * seulement LAQUELLE des deux mérite l'alerte.
 */
import { describe, expect, it } from "vitest";
import { tonRef } from "./ui";

const ref = (percentile: number) => ({ percentile, profondeurJours: 30, n: 90 });

describe("tonRef", () => {
  it("ne signale rien hors des queues", () => {
    expect(tonRef(ref(50))).toBe("neutre");
    expect(tonRef(ref(50), "hausse-chaud")).toBe("neutre");
    expect(tonRef(ref(50), "hausse-froid")).toBe("neutre");
  });

  it("sans sens : les deux queues sont signalées, avec des tons distincts", () => {
    expect(tonRef(ref(95))).toBe("warn");
    expect(tonRef(ref(5))).toBe("accent");
  });

  it("sens hausse-chaud : le HAUT alerte, le BAS reste signalé (plus en gris)", () => {
    expect(tonRef(ref(95), "hausse-chaud")).toBe("warn");
    expect(tonRef(ref(5), "hausse-chaud")).toBe("accent");
  });

  it("sens hausse-froid : le BAS alerte, le HAUT reste signalé", () => {
    expect(tonRef(ref(5), "hausse-froid")).toBe("warn");
    expect(tonRef(ref(95), "hausse-froid")).toBe("accent");
  });

  it("aucune queue ne retombe en neutre — c'était le défaut corrigé", () => {
    for (const sens of ["hausse-chaud", "hausse-froid", undefined] as const) {
      expect(tonRef(ref(97), sens)).not.toBe("neutre");
      expect(tonRef(ref(3), sens)).not.toBe("neutre");
    }
  });
});
