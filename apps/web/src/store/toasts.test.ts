/**
 * Tests de la pure `empilerToast` (empilement + coupe du plus ancien) et de la boucle
 * pousser/retirer du store (minuteur d'auto-retrait via faux timers). Aucun DOM requis.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  empilerToast,
  pousserToast,
  retirerToast,
  toastsStore,
  type Toast,
} from "./toasts";

const t = (id: number): Toast => ({ id, texte: `t${id}` });

describe("empilerToast", () => {
  it("ajoute le nouveau toast en fin de pile quand sous le maximum", () => {
    expect(empilerToast([t(1)], t(2), 3)).toEqual([t(1), t(2)]);
  });

  it("coupe le plus ANCIEN (en tête) au-delà du maximum", () => {
    expect(empilerToast([t(1), t(2), t(3)], t(4), 3)).toEqual([t(2), t(3), t(4)]);
  });

  it("garde exactement `max` toasts quand la pile est pleine", () => {
    expect(empilerToast([t(1), t(2)], t(3), 3)).toHaveLength(3);
  });

  it("ne mute pas la liste d'entrée (renvoie une nouvelle liste)", () => {
    const source = [t(1)];
    empilerToast(source, t(2), 3);
    expect(source).toEqual([t(1)]);
  });
});

describe("pousserToast / retirerToast", () => {
  beforeEach(() => {
    toastsStore.setState({ toasts: [] });
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("empile un toast avec un id incrémental et un texte", () => {
    pousserToast("PNG exporté");
    const toasts = toastsStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.texte).toBe("PNG exporté");
  });

  it("borne la pile à 3 (le plus ancien saute)", () => {
    pousserToast("a");
    pousserToast("b");
    pousserToast("c");
    pousserToast("d");
    const textes = toastsStore.getState().toasts.map((x) => x.texte);
    expect(textes).toEqual(["b", "c", "d"]);
  });

  it("retire automatiquement le toast après 2500 ms", () => {
    pousserToast("éphémère");
    expect(toastsStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(2500);
    expect(toastsStore.getState().toasts).toHaveLength(0);
  });

  it("retirerToast enlève par id ; no-op si l'id est absent", () => {
    pousserToast("x");
    const id = toastsStore.getState().toasts[0]!.id;
    retirerToast(999);
    expect(toastsStore.getState().toasts).toHaveLength(1);
    retirerToast(id);
    expect(toastsStore.getState().toasts).toHaveLength(0);
  });

  it("un toast peut porter une action (Annuler)", () => {
    let annule = false;
    pousserToast("Paire changée → DERIVUSDT", {
      libelle: "Annuler",
      executer: () => {
        annule = true;
      },
    });
    const t2 = toastsStore.getState().toasts.at(-1);
    expect(t2?.action?.libelle).toBe("Annuler");
    t2?.action?.executer();
    expect(annule).toBe(true);
    if (t2) retirerToast(t2.id);
  });

  it("un toast avec action reste affiché 6000 ms (pas 2500)", () => {
    pousserToast("Paire changée → DERIVUSDT", { libelle: "Annuler", executer: () => {} });
    vi.advanceTimersByTime(2500);
    expect(toastsStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(3500);
    expect(toastsStore.getState().toasts).toHaveLength(0);
  });
});
