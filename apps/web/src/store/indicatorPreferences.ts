/** Favoris et récents du catalogue d'indicateurs, persistés séparément des instances. */
import { createStore, type StoreApi } from "zustand/vanilla";
import { getIndicator } from "@axiom/indicators";
import { indicatorsStore } from "./indicators";

export const PREFERENCES_INDICATEURS_KEY = "axiom:indicatorPreferences:v1";
const MAX_RECENTS = 12;

export interface PreferencesIndicateurs { favoris: string[]; recents: string[] }
export interface PreferencesIndicateursState extends PreferencesIndicateurs {
  erreurSauvegarde: string | null;
  basculerFavori: (id: string) => boolean;
  marquerRecent: (id: string) => boolean;
  reessayerSauvegarde: () => boolean;
}

function idValide(id: unknown): id is string {
  return typeof id === "string" && getIndicator(id)?.category !== undefined && getIndicator(id)?.category !== "strategy";
}

/** Validation tolérante de l'ancien stock et des sauvegardes importées. */
export function normaliserPreferences(raw: unknown): PreferencesIndicateurs {
  const o = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const liste = (value: unknown, limite = Infinity): string[] => {
    if (!Array.isArray(value)) return [];
    const vus = new Set<string>();
    for (const id of value) if (idValide(id)) vus.add(id);
    return Array.from(vus).slice(0, limite);
  };
  return { favoris: liste(o.favoris), recents: liste(o.recents, MAX_RECENTS) };
}

function stockage(): Storage | undefined {
  try { return typeof localStorage === "undefined" ? undefined : localStorage; }
  catch { return undefined; }
}

function lire(): PreferencesIndicateurs {
  try {
    const raw = stockage()?.getItem(PREFERENCES_INDICATEURS_KEY);
    return raw ? normaliserPreferences(JSON.parse(raw) as unknown) : { favoris: [], recents: [] };
  } catch {
    return { favoris: [], recents: [] };
  }
}

export function creerIndicatorPreferencesStore(): StoreApi<PreferencesIndicateursState> {
  return createStore<PreferencesIndicateursState>((set, get) => {
    const enregistrer = (): boolean => {
      try {
        const storage = stockage();
        if (storage === undefined) throw new Error("Stockage local indisponible");
        const { favoris, recents } = get();
        storage.setItem(PREFERENCES_INDICATEURS_KEY, JSON.stringify({ favoris, recents }));
        set({ erreurSauvegarde: null });
        return true;
      } catch {
        set({ erreurSauvegarde: "Préférences non enregistrées sur cet appareil. Réessayez la sauvegarde." });
        return false;
      }
    };
    return {
      ...lire(),
      erreurSauvegarde: null,
      basculerFavori: (id) => {
        if (!idValide(id)) return false;
        const favoris = get().favoris;
        set({ favoris: favoris.includes(id) ? favoris.filter((v) => v !== id) : [...favoris, id] });
        enregistrer();
        return true;
      },
      marquerRecent: (id) => {
        if (!idValide(id)) return false;
        set({ recents: [id, ...get().recents.filter((v) => v !== id)].slice(0, MAX_RECENTS) });
        enregistrer();
        return true;
      },
      reessayerSauvegarde: enregistrer,
    };
  });
}

export const indicatorPreferencesStore = creerIndicatorPreferencesStore();

/** Le récent n'est posé qu'après confirmation d'une nouvelle instance en mémoire. */
export function ajouterIndicateurAvecRecent(
  id: string,
  preferences: StoreApi<PreferencesIndicateursState> = indicatorPreferencesStore,
): boolean {
  if (!idValide(id)) return false;
  const avant = indicatorsStore.getState().indicators.length;
  indicatorsStore.getState().add(id);
  const apres = indicatorsStore.getState().indicators;
  if (apres.length !== avant + 1 || apres.at(-1)?.defId !== id) return false;
  preferences.getState().marquerRecent(id);
  return true;
}
