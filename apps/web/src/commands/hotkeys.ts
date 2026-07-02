/**
 * Raccourcis clavier globaux — un SEUL écouteur keydown monté au niveau de l'App.
 *
 * Les touches nues sont ignorées quand un champ de saisie a le focus (input / textarea
 * / select / contentEditable) pour ne pas interférer avec la frappe. Seul ⌘K/Ctrl+K
 * reste actif partout (ouverture de la palette). Toutes les actions pilotent des stores
 * VANILLA (hors render-loop React) — aucune donnée haute fréquence ne transite ici.
 *
 * Table des raccourcis (RACCOURCIS_AIDE) affichée par la commande « AIDE » / la touche
 * « ? » (rendue par CommandPalette en mode aide).
 */
import { useEffect } from "react";
import type { Timeframe } from "@axiom/types";
import { createStore } from "zustand/vanilla";
import { marketStore } from "../store/market";
import { orderflowStore } from "../store/orderflow";
import { volumeProfileStore } from "../store/volumeProfile";
import { revenueStore } from "../store/revenue";
import { themeStore, THEMES } from "../store/theme";
import { SUPPORTED_TIMEFRAMES } from "../data/adapters";
import { paletteStore } from "./registry";

// ─────────────────────────── Store plein écran ───────────────────────────

export interface FullscreenState {
  /** true = chart plein écran (sidebar + toolbars masquées). */
  plein: boolean;
  /** Bascule le plein écran. */
  basculer: () => void;
  /** Force un état plein écran. */
  definir: (plein: boolean) => void;
}

/**
 * Store « plein écran » — VANILLA (hors render-loop). Éphémère : NON persisté.
 * Lu par App.tsx pour masquer la sidebar et les barres d'outils.
 */
export const fullscreenStore = createStore<FullscreenState>((set, get) => ({
  plein: false,
  basculer: () => set({ plein: !get().plein }),
  definir: (plein) => set({ plein }),
}));

// ─────────────────────────── Table des raccourcis (aide) ───────────────────────────

/** Table des raccourcis clavier — miroir documentaire de la logique ci-dessous. */
export const RACCOURCIS_AIDE: { touche: string; description: string }[] = [
  { touche: "⌘K / Ctrl+K", description: "Ouvrir la palette de commandes" },
  { touche: "?", description: "Afficher cette aide" },
  {
    touche: "⌘K puis mnémo",
    description:
      "Fonctions (panneaux) : DES ECO NEWS CORR CHAIN IMAP PORT NOTE EQS TERM OMON DOM TAPE BT REPLAY · OI/FUND (chart) · GRID1 GRID2 GRID2V GRID4 (disposition)",
  },
  { touche: "1 – 9", description: "Timeframes rapides (1m, 5m, 15m, 1h, 4h, 1d, 1w, 1M, 3M)" },
  { touche: "/", description: "Focus sur la recherche de paires" },
  { touche: "O", description: "Orderflow (activer / désactiver)" },
  { touche: "V", description: "Profil de volume (activer / désactiver)" },
  { touche: "R", description: "Revenus on-chain (activer / désactiver)" },
  { touche: "F", description: "Plein écran du graphe" },
  { touche: "T", description: "Thème suivant" },
  { touche: "Échap", description: "Quitter le plein écran / fermer" },
];

// ─────────────────────────── Hook ───────────────────────────

/** Timeframes associés aux chiffres 1 à 9 (dans l'ordre). */
const TF_CHIFFRES: Timeframe[] = ["1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M", "3M"];

/** Sources disposant d'un flux de trades (orderflow pertinent uniquement là). */
const SOURCES_FLUX_TRADES = new Set(["binance", "kraken", "coinbase"]);

/** true si l'événement vient d'un champ éditable (on n'intercepte alors pas les touches nues). */
function estChampEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/**
 * Monte l'écouteur global de raccourcis clavier. À appeler UNE fois (dans App).
 * Le nettoyage retire l'écouteur (idempotent en React StrictMode : montage/démontage).
 */
export function useRaccourcisGlobaux(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // ⌘K / Ctrl+K : palette de commandes — actif même dans un champ.
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        paletteStore.getState().ouvrir("commandes");
        return;
      }
      // Tout autre raccourci navigateur (Cmd/Ctrl/Alt) : laissé au navigateur.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Palette ouverte : elle gère son propre clavier (⌘K déjà traité au-dessus).
      if (paletteStore.getState().ouvert) return;
      // Champ de saisie focalisé : on ne capture pas les touches nues.
      if (estChampEditable(e.target)) return;

      // Échap : quitte le plein écran s'il est actif.
      if (e.key === "Escape") {
        if (fullscreenStore.getState().plein) {
          fullscreenStore.getState().definir(false);
          e.preventDefault();
        }
        return;
      }

      // « ? » : aide.
      if (e.key === "?") {
        paletteStore.getState().ouvrir("aide");
        e.preventDefault();
        return;
      }

      // « / » : focus sur la recherche de paires (input de la Toolbar).
      if (e.key === "/") {
        const input = document.querySelector<HTMLInputElement>(
          'input[aria-label="Rechercher une paire"]'
        );
        if (input !== null) {
          input.focus();
          e.preventDefault();
        }
        return;
      }

      // Chiffres 1 à 9 : timeframes rapides (uniquement si supporté par la source).
      if (e.key >= "1" && e.key <= "9") {
        const tf = TF_CHIFFRES[Number(e.key) - 1];
        if (tf !== undefined) {
          const exchange = marketStore.getState().exchange;
          const supportes = SUPPORTED_TIMEFRAMES[exchange] ?? [];
          if (supportes.includes(tf)) marketStore.getState().setTimeframe(tf);
        }
        return;
      }

      // Toggles à une touche (insensibles à la casse).
      switch (e.key.toLowerCase()) {
        case "o": {
          // Orderflow : pertinent uniquement sur les sources à flux de trades.
          if (SOURCES_FLUX_TRADES.has(marketStore.getState().exchange)) {
            orderflowStore.getState().toggle();
          }
          break;
        }
        case "v":
          volumeProfileStore.getState().toggle();
          break;
        case "r": {
          // Revenus on-chain : indisponible en marchés traditionnels.
          if (marketStore.getState().exchange !== "twelvedata") {
            revenueStore.getState().toggle();
          }
          break;
        }
        case "f":
          fullscreenStore.getState().basculer();
          break;
        case "t": {
          const { theme, setTheme } = themeStore.getState();
          const i = THEMES.indexOf(theme);
          const suivant = THEMES[(i + 1) % THEMES.length];
          if (suivant !== undefined) setTheme(suivant);
          break;
        }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
