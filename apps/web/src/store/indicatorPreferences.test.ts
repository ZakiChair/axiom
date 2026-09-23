import { afterEach, describe, expect, it, vi } from "vitest";
import { INDICATORS } from "@axiom/indicators";
import { indicatorsStore } from "./indicators";
import {
  creerIndicatorPreferencesStore, normaliserPreferences,
  PREFERENCES_INDICATEURS_KEY,
  ajouterIndicateurAvecRecent,
} from "./indicatorPreferences";

const ids = INDICATORS.filter((d) => d.category !== "strategy").slice(0, 14).map((d) => d.id);

afterEach(() => { vi.unstubAllGlobals(); indicatorsStore.setState({ indicators: [] }); });

describe("préférences des indicateurs", () => {
  it("hydrate uniquement les IDs du registre, sans doublon ni plus de 12 récents", () => {
    const parsed = normaliserPreferences({ favoris: [ids[0], "inconnu", ids[0], "stratPsar"], recents: [...ids, ids[0], "inconnu"] });
    expect(parsed.favoris).toEqual([ids[0]]);
    expect(parsed.recents).toEqual(ids.slice(0, 12));
    expect(normaliserPreferences({ favoris: "ema", recents: null })).toEqual({ favoris: [], recents: [] });
  });

  it("quota : mutation RAM conservée, erreur visible et réessai du même état", () => {
    const ecrire = vi.fn<(key: string, value: string) => void>(() => { throw new DOMException("quota", "QuotaExceededError"); });
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: ecrire });
    const store = creerIndicatorPreferencesStore();
    expect(store.getState().basculerFavori(ids[0]!)).toBe(true);
    expect(store.getState().favoris).toEqual([ids[0]]);
    expect(store.getState().erreurSauvegarde).toMatch(/non enregistrées/i);
    ecrire.mockImplementation(() => undefined);
    expect(store.getState().reessayerSauvegarde()).toBe(true);
    expect(store.getState().favoris).toEqual([ids[0]]);
    expect(store.getState().erreurSauvegarde).toBeNull();
    expect(ecrire).toHaveBeenLastCalledWith(PREFERENCES_INDICATEURS_KEY, JSON.stringify({ favoris: [ids[0]], recents: [] }));
  });

  it("un ajout ignoré ne devient pas récent ; les ajouts effectifs remontent sans doublon", () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
    const store = creerIndicatorPreferencesStore();
    expect(ajouterIndicateurAvecRecent("inconnu", store)).toBe(false);
    expect(store.getState().recents).toEqual([]);
    expect(ajouterIndicateurAvecRecent(ids[0]!, store)).toBe(true);
    expect(ajouterIndicateurAvecRecent(ids[1]!, store)).toBe(true);
    expect(ajouterIndicateurAvecRecent(ids[0]!, store)).toBe(true);
    expect(store.getState().recents).toEqual([ids[0], ids[1]]);
  });

  it("stockage absent : conserve l'état et réessaie lorsque le stockage revient", () => {
    vi.stubGlobal("localStorage", undefined);
    const store = creerIndicatorPreferencesStore();
    store.getState().basculerFavori(ids[0]!);
    expect(store.getState().reessayerSauvegarde()).toBe(false);
    const ecrire = vi.fn();
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: ecrire });
    expect(store.getState().reessayerSauvegarde()).toBe(true);
    expect(ecrire).toHaveBeenCalledTimes(1);
  });
});
