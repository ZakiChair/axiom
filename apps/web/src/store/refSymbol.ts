/**
 * Store refSymbol — symbole de RÉFÉRENCE des indicateurs croisés (Zustand VANILLA).
 *
 * Réglage global unique : le symbole spot dont la close sert de jambe « croisée »
 * aux indicateurs statistiques (corrélation roulante, bêta, spread z-score vs
 * référence) via la série aux `refClose`. Défaut `BTCUSDT`.
 *
 * Persistance déléguée à persist.ts (patron orderflow.enabled : snapshot / hydrate /
 * subscribe) — ce store ne touche JAMAIS localStorage lui-même. Lu en BASSE fréquence
 * (auxProvider construit la clé de cache `refClose:${refSymbol}:${tf}`).
 */
import { createStore } from "zustand/vanilla";

/** Symbole de référence par défaut (le benchmark crypto naturel). */
export const REF_SYMBOL_DEFAUT = "BTCUSDT";

export interface RefSymbolState {
  /** Symbole spot de référence, toujours en MAJUSCULES sans espaces de bord. */
  refSymbol: string;
  /** Normalise (trim + MAJUSCULES). Une valeur vide après trim est ignorée. */
  setRefSymbol: (symbol: string) => void;
}

export const refSymbolStore = createStore<RefSymbolState>((set) => ({
  refSymbol: REF_SYMBOL_DEFAUT,
  setRefSymbol: (symbol) => {
    const normalise = symbol.trim().toUpperCase();
    // Une clé de cache `refClose::${tf}` (symbole vide) serait cassée : on ignore.
    if (normalise === "") return;
    set({ refSymbol: normalise });
  },
}));
