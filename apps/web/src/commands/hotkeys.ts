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
import { liqMarksStore } from "../chart/liquidationMarkers";
import { themeStore, THEMES } from "../store/theme";
import { SUPPORTED_TIMEFRAMES } from "../data/adapters";
import { pousserToast } from "../store/toasts";
import { paletteStore, CATEGORIE_LABEL, type Commande, type CategorieCommande } from "./registry";

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
  { touche: "⌘K → ONBOARD", description: "Rejouer le parcours d'onboarding (3 étapes)" },
  { touche: "1 – 9", description: "Timeframes rapides (1m, 5m, 15m, 1h, 4h, 1d, 1w, 1M, 3M)" },
  { touche: "/", description: "Focus sur la recherche de paires" },
  { touche: "O", description: "Orderflow (activer / désactiver)" },
  { touche: "V", description: "Profil de volume (activer / désactiver)" },
  { touche: "R", description: "Revenus on-chain (activer / désactiver)" },
  { touche: "L", description: "Heatmap liquidations (activer / désactiver)" },
  { touche: "F", description: "Plein écran du graphe" },
  { touche: "T", description: "Thème suivant" },
  { touche: "Échap", description: "Quitter le plein écran / fermer / passer l'onboarding" },
];

/**
 * Lignes d'aide des mnémoniques, DÉRIVÉES du registre réel — remplace la chaîne
 * maintenue à la main (périmée dès le lot suivant : LIQ, STBL, WTILE… manquaient).
 */
export function lignesMnemoniques(
  registre: readonly Commande[],
): { touche: string; description: string }[] {
  const parCategorie = new Map<string, string[]>();
  for (const c of registre) {
    if (c.mnemonique === undefined) continue;
    const liste = parCategorie.get(c.categorie) ?? [];
    liste.push(c.mnemonique);
    parCategorie.set(c.categorie, liste);
  }
  return [...parCategorie.entries()].map(([categorie, mnemos]) => ({
    touche: "⌘K",
    description: `${CATEGORIE_LABEL[categorie as CategorieCommande] ?? categorie} : ${mnemos.join(" ")}`,
  }));
}

// ─────────────────────────── Hook ───────────────────────────

/** Timeframes associés aux chiffres 1 à 9 (dans l'ordre). */
const TF_CHIFFRES: Timeframe[] = ["1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M", "3M"];

// ─────────────────────── Raccourcis in-situ (dérivés de RACCOURCIS_AIDE) ───────────────────────

/**
 * Associe le libellé COURT d'un bouton Toolbar au fragment identifiant sa ligne dans
 * `RACCOURCIS_AIDE` (source UNIQUE des touches). On ne duplique jamais la touche : elle
 * est relue depuis la table d'aide, donc un changement de raccourci s'y propage seul.
 */
const ASSOCIATIONS_RACCOURCI: readonly { libelle: string; fragment: string }[] = [
  { libelle: "Orderflow", fragment: "Orderflow" },
  { libelle: "Profil Vol", fragment: "Profil de volume" },
  { libelle: "Revenus", fragment: "Revenus on-chain" },
  { libelle: "Liq", fragment: "Heatmap liquidations" },
  { libelle: "Plein écran", fragment: "Plein écran" },
  { libelle: "Thème", fragment: "Thème suivant" },
];

/**
 * Touche associée à un libellé de bouton (ex. "Orderflow" → "O"), `null` si aucune.
 * PURE : dérivée de `RACCOURCIS_AIDE` (source unique), testée sans DOM. La Toolbar
 * s'en sert pour enrichir les `title` des boutons d'un suffixe « — <touche> ».
 */
export function raccourciPour(libelleCourt: string): string | null {
  const assoc = ASSOCIATIONS_RACCOURCI.find((a) => a.libelle === libelleCourt);
  if (!assoc) return null;
  const ligne = RACCOURCIS_AIDE.find((r) => r.description.includes(assoc.fragment));
  return ligne ? ligne.touche : null;
}

/**
 * Chiffre (1-9) associé à un timeframe, `null` s'il n'en a pas OU si l'aide ne documente
 * pas les raccourcis chiffrés. PURE : dérivée de `TF_CHIFFRES` + `RACCOURCIS_AIDE`.
 */
export function raccourciTimeframe(tf: string): string | null {
  if (!RACCOURCIS_AIDE.some((r) => r.description.startsWith("Timeframes rapides"))) return null;
  const i = TF_CHIFFRES.indexOf(tf as Timeframe);
  return i >= 0 && i < 9 ? String(i + 1) : null;
}

/** Code physique (Digit1/Numpad1…) → timeframe rapide — indépendant de la disposition
 * clavier : sur AZERTY, e.key des chiffres non shiftés vaut « & é " … » (revue v2). */
export function timeframePourCode(code: string): Timeframe | null {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  if (m === null || m[1] === undefined) return null;
  return TF_CHIFFRES[Number(m[1]) - 1] ?? null;
}

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

      // Timeframes rapides par code PHYSIQUE (AZERTY : e.key vaudrait & é " …).
      const tfCode = timeframePourCode(e.code);
      if (tfCode !== null) {
        const exchange = marketStore.getState().exchange;
        const supportes = SUPPORTED_TIMEFRAMES[exchange] ?? [];
        if (supportes.includes(tfCode)) marketStore.getState().setTimeframe(tfCode);
        return;
      }

      // Toggles à une touche (insensibles à la casse).
      switch (e.key.toLowerCase()) {
        case "o": {
          // Orderflow : pertinent uniquement sur les sources à flux de trades.
          if (SOURCES_FLUX_TRADES.has(marketStore.getState().exchange)) {
            orderflowStore.getState().toggle();
          } else {
            pousserToast("Orderflow indisponible sur cette source (flux de trades requis)");
          }
          break;
        }
        case "v":
          volumeProfileStore.getState().toggle();
          break;
        case "l": {
          // Heatmap liquidations : flux perp Bybit/OKX uniquement (indispo tradfi / synthétique).
          const ex = marketStore.getState().exchange;
          if (ex !== "twelvedata" && ex !== "synthetic") {
            liqMarksStore.getState().basculer();
          } else {
            pousserToast("Heatmap liquidations indisponible sur cette source (perp Bybit/OKX requis)");
          }
          break;
        }
        case "r": {
          // Revenus on-chain : indisponible en marchés traditionnels.
          if (marketStore.getState().exchange !== "twelvedata") {
            revenueStore.getState().toggle();
          } else {
            pousserToast("Revenus on-chain indisponibles en marchés traditionnels");
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
