/**
 * Tests de la pure `empilerToast` (empilement + coupe du plus ancien ; un avis d'alerte ne
 * quitte la pile que par le toucher, les plus anciens fondus en un avis de synthèse) et de la
 * boucle pousser/retirer du store (minuteur d'auto-retrait via faux timers). Aucun DOM requis.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  empilerToast,
  pousserToast,
  retirerToast,
  texteSynthese,
  toastsStore,
  type Toast,
} from "./toasts";

const t = (id: number): Toast => ({ id, texte: `t${id}` });
/** Avis d'alerte : il reste jusqu'au toucher. */
const a = (id: number): Toast => ({ id, texte: `a${id}`, reste: true });
/** Avis de synthèse remplaçant `n` avis d'alerte, à la place (et sous l'id) du premier. */
const synthese = (id: number, n: number): Toast => ({ id, texte: `+ ${n} alertes plus anciennes — voir le journal`, reste: true, remplace: n });

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

describe("empilerToast — un avis d'alerte ne quitte l'écran que par le toucher", () => {
  it("règle (a) : un avis ordinaire ne chasse jamais un avis d'alerte ; c'est le plus ancien avis ordinaire qui saute", () => {
    // Trois avis d'alerte tiennent toutes les places : l'avis ordinaire paraît quand même, en plus.
    expect(empilerToast([a(1), a(2), a(3)], t(4), 3)).toEqual([a(1), a(2), a(3), t(4)]);
    // Le suivant prend la place du précédent avis ordinaire, pas celle d'un avis d'alerte.
    expect(empilerToast([a(1), a(2), a(3), t(4)], t(5), 3)).toEqual([a(1), a(2), a(3), t(5)]);
    // Les avis ordinaires se partagent les places restantes.
    expect(empilerToast([a(1), t(2), t(3)], t(4), 3)).toEqual([a(1), t(3), t(4)]);
    expect(empilerToast([t(1), a(2), t(3)], t(4), 3)).toEqual([a(2), t(3), t(4)]);
    expect(empilerToast([a(1), a(2), t(3)], t(4), 3)).toEqual([a(1), a(2), t(4)]);
  });

  it("un avis d'alerte qui arrive prend sa place sur le plus ancien avis ordinaire, jamais sur un autre avis d'alerte", () => {
    expect(empilerToast([t(1), t(2), t(3)], a(4), 3)).toEqual([t(2), t(3), a(4)]);
    expect(empilerToast([a(1), t(2), t(3)], a(4), 3)).toEqual([a(1), t(3), a(4)]);
    // Dernière place ordinaire : elle est gardée (le retour d'une action reste visible).
    expect(empilerToast([a(1), a(2), t(3)], a(4), 3)).toEqual([a(1), a(2), t(3), a(4)]);
  });

  it("règle (b) : au-delà de la place, les plus anciens avis d'alerte sont remplacés par UN avis de synthèse qui les compte", () => {
    // Quatrième déclenchement non touché : les deux plus anciens fondus, les deux plus récents lisibles.
    expect(empilerToast([a(1), a(2), a(3)], a(4), 3)).toEqual([synthese(1, 2), a(3), a(4)]);
    // Les suivants s'ajoutent à la même synthèse, qui garde sa place et son id.
    expect(empilerToast([synthese(1, 2), a(3), a(4)], a(5), 3)).toEqual([synthese(1, 3), a(4), a(5)]);
    expect(empilerToast([synthese(1, 3), a(4), a(5)], a(6), 3)).toEqual([synthese(1, 4), a(5), a(6)]);
    // L'avis ordinaire présent n'est ni compté ni chassé par la synthèse.
    expect(empilerToast([a(1), a(2), a(3), t(4)], a(5), 3)).toEqual([synthese(1, 2), a(3), t(4), a(5)]);
  });

  it("aucun avis d'alerte ne disparaît sans trace : ceux qui sont lisibles et ceux que la synthèse compte font toujours le total", () => {
    let pile: Toast[] = [];
    for (let id = 1; id <= 40; id++) {
      // Un avis ordinaire entre des avis d'alerte, comme une action de l'opérateur.
      pile = empilerToast(pile, id % 4 === 0 ? t(id) : a(id), 3);
      const alertes = pile.filter((x) => x.reste === true);
      const pousses = id - Math.floor(id / 4);
      expect(alertes.reduce((n, x) => n + (x.remplace ?? 1), 0), `après ${id} avis`).toBe(pousses);
      // Pile bornée : trois avis d'alerte au plus (synthèse comprise), un avis ordinaire en plus au pire.
      expect(alertes.length).toBeLessThanOrEqual(3);
      expect(pile.length).toBeLessThanOrEqual(4);
      expect(alertes.filter((x) => x.remplace !== undefined).length).toBeLessThanOrEqual(1);
    }
  });

  it("le texte de la synthèse dit le nombre et où retrouver les alertes", () => {
    expect(texteSynthese(2)).toBe("+ 2 alertes plus anciennes — voir le journal");
    expect(synthese(1, 2).texte).toBe(texteSynthese(2));
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

  it("durée 0 : aucun retrait automatique, avec ou sans action ; l'avis reste jusqu'au toucher", () => {
    pousserToast("BTCUSDT 4h — AXIS S/R non mesuré · réaction sur support fort", { libelle: "Voir", executer: () => {} }, 0);
    pousserToast("EQS Momentum : BTCUSDT entre dans le scan", undefined, 0);
    // Aucun minuteur n'est armé : rien ne peut retirer l'avis en arrière-plan.
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(24 * 3_600_000);
    expect(toastsStore.getState().toasts.map((x) => x.texte)).toEqual([
      "BTCUSDT 4h — AXIS S/R non mesuré · réaction sur support fort",
      "EQS Momentum : BTCUSDT entre dans le scan",
    ]);
    const id = toastsStore.getState().toasts[0]!.id;
    retirerToast(id);
    expect(toastsStore.getState().toasts).toHaveLength(1);
  });

  it("une durée explicite remplace les durées par défaut, qui restent celles des autres avis", () => {
    pousserToast("court", undefined, 1000);
    pousserToast("ordinaire");
    pousserToast("avec action", { libelle: "Annuler", executer: () => {} });
    vi.advanceTimersByTime(999);
    expect(toastsStore.getState().toasts).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(toastsStore.getState().toasts.map((x) => x.texte)).toEqual(["ordinaire", "avec action"]);
    vi.advanceTimersByTime(1500);
    expect(toastsStore.getState().toasts.map((x) => x.texte)).toEqual(["avec action"]);
    vi.advanceTimersByTime(3500);
    expect(toastsStore.getState().toasts).toHaveLength(0);
  });

  it("quatre avis d'alerte non touchés : les deux plus anciens deviennent un avis de synthèse, qui reste aussi", () => {
    for (const texte of ["a", "b", "c", "d"]) pousserToast(texte, { libelle: "Voir", executer: () => {} }, 0);
    expect(toastsStore.getState().toasts.map((x) => x.texte)).toEqual(["+ 2 alertes plus anciennes — voir le journal", "c", "d"]);
    // La synthèse n'a pas de bouton « Voir » (elle ne désigne aucun marché) et aucun minuteur ne la retire.
    expect(toastsStore.getState().toasts[0]?.action).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(24 * 3_600_000);
    expect(toastsStore.getState().toasts).toHaveLength(3);
    // Elle part au toucher, comme tout avis ; le déclenchement suivant ne refond rien tant qu'il a la place.
    retirerToast(toastsStore.getState().toasts[0]!.id);
    pousserToast("e", undefined, 0);
    expect(toastsStore.getState().toasts.map((x) => x.texte)).toEqual(["c", "d", "e"]);
  });

  it("trois avis d'alerte affichés : un avis ordinaire paraît sans en chasser aucun, puis part à son heure", () => {
    for (const texte of ["a", "b", "c"]) pousserToast(texte, undefined, 0);
    pousserToast("PNG exporté");
    expect(toastsStore.getState().toasts.map((x) => x.texte)).toEqual(["a", "b", "c", "PNG exporté"]);
    pousserToast("Paire changée", { libelle: "Annuler", executer: () => {} });
    expect(toastsStore.getState().toasts.map((x) => x.texte)).toEqual(["a", "b", "c", "Paire changée"]);
    // Les durées des avis ordinaires ne changent pas : 6 s avec une action.
    vi.advanceTimersByTime(6000);
    expect(toastsStore.getState().toasts.map((x) => x.texte)).toEqual(["a", "b", "c"]);
  });
});
