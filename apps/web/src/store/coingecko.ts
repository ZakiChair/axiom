/**
 * Store clé Demo CoinGecko — Zustand VANILLA. Clé OPTIONNELLE : toutes les sources
 * CoinGecko d'AXIOM fonctionnent sans (endpoints publics), la clé ne fait que relever
 * les quotas. Elle compte surtout pour le backfill de la fenêtre CAP : 100 appels
 * cadencés, ~3,5 min avec clé contre 5 à 20 min sans.
 *
 * ⚠️ Emplacement de stockage IMPOSÉ : `axiom.coingecko.demoApiKey`, déjà lu par
 * `data/marketOverview.ts` (`resolveDemoKey`) et `data/macro/coingecko.ts`. Ce store ne
 * fait qu'ouvrir une saisie dans les Réglages sur une clé jusqu'ici seulement lisible.
 *
 * ⚠️ Conséquence assumée (revue 2026-09) : cet emplacement utilise des POINTS, il est donc
 * hors du filtre `axiom:` de l'export/import de sauvegarde (`store/persist`). Cette clé
 * n'est PAS sauvegardée : après un import sur un autre poste, il faut la ressaisir (sans
 * elle, la capitalisation reste fonctionnelle mais sur le quota public, plus lent).
 */
import { createStore } from "zustand/vanilla";

const STORAGE_KEY = "axiom.coingecko.demoApiKey";

function readKey(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v !== null && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

function writeKey(key: string | null): void {
  try {
    if (key === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, key);
  } catch {
    /* best-effort : la persistance n'est pas bloquante */
  }
}

export interface CoinGeckoKeyState {
  hasKey: boolean;
  setKey: (key: string) => void;
  clearKey: () => void;
}

export const coingeckoKeyStore = createStore<CoinGeckoKeyState>((set) => ({
  hasKey: readKey() !== null,
  setKey: (key) => {
    const k = key.trim();
    const value = k.length > 0 ? k : null;
    writeKey(value);
    set({ hasKey: value !== null });
  },
  clearKey: () => {
    writeKey(null);
    set({ hasKey: false });
  },
}));
