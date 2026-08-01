/**
 * Registre de commandes — cœur de la « command palette » (⌘K), façon Bloomberg.
 *
 * Une COMMANDE est déclarative : { id, mnemonique?, libelle, categorie, action, motsCles }.
 * Toutes les actions pilotent des stores VANILLA (hors render-loop React) → elles sont
 * appelables aussi bien depuis la palette que depuis un raccourci clavier ou, plus tard,
 * un daemon. Ce module ne rend RIEN : il expose la liste des commandes + trois fonctions
 * PURES (parsing de navigation, score fuzzy, filtrage) testées dans registry.test.ts.
 *
 * Convention d'import : ce fichier tire quelques modules à effet de bord (store/theme
 * pose [data-theme] sur <html>, chart/drawing charge klinecharts) — non évaluables hors
 * navigateur. registry.test.ts les neutralise via vi.mock pour tester les fonctions pures.
 */
import { createStore } from "zustand/vanilla";
import type { ExchangeId, Timeframe } from "@axiom/types";
import { INDICATORS } from "@axiom/indicators";
import { marketStore } from "../store/market";
import { indicatorsStore } from "../store/indicators";
import { indicatorSetsStore } from "../store/indicatorSets";
import { themeStore, THEMES, type ThemeId } from "../store/theme";
import { orderflowStore } from "../store/orderflow";
import { volumeProfileStore } from "../store/volumeProfile";
import { revenueStore } from "../store/revenue";
import { derivativesUiStore } from "../store/derivatives-ui";
import { indicatorMenuUiStore } from "../store/indicator-menu-ui";
import { settingsUiStore } from "../store/settings-ui";
import { exportChartImage, clearAllOverlays } from "../chart/drawing";
import { QUOTE_ASSETS } from "../data/symbol";
import { pousserToast } from "../store/toasts";

// ─────────────────────────── Types ───────────────────────────

/** Familles de commandes (regroupement + libellé de catégorie affiché). */
export type CategorieCommande =
  | "navigation"
  | "timeframe"
  | "indicateur"
  | "theme"
  | "panneau"
  | "action";

/** Libellés FR courts des catégories (colonne de droite de la palette). */
export const CATEGORIE_LABEL: Record<CategorieCommande, string> = {
  navigation: "nav",
  timeframe: "tf",
  indicateur: "ind",
  theme: "thème",
  panneau: "panneau",
  action: "action",
};

/** Libellés FR longs des catégories (aide « ? » — les clés courtes y étaient cryptiques). */
export const CATEGORIE_LABEL_LONG: Record<CategorieCommande, string> = {
  navigation: "Navigation",
  timeframe: "Timeframes",
  indicateur: "Indicateurs",
  theme: "Thèmes",
  panneau: "Panneaux",
  action: "Actions",
};

/** Une commande de la palette. `action` s'exécute hors React (stores vanilla). */
export interface Commande {
  /** Identifiant stable (clé d'historique + de rendu). */
  id: string;
  /** Mnémonique Bloomberg optionnel (DES, MON, ALRT…), mis en surbrillance. */
  mnemonique?: string;
  /** Libellé lisible affiché dans la liste. */
  libelle: string;
  /** Famille de la commande. */
  categorie: CategorieCommande;
  /** Termes supplémentaires ciblés par la recherche fuzzy (synonymes, nom complet…). */
  motsCles: string[];
  /** Court aperçu de l'effet (affiché sous la sélection). */
  apercu?: string;
  /** Effet de la commande (pilote un store vanilla). */
  action: () => void;
}

/** Résultat du parsing d'une saisie de navigation (« SOL 4H BINANCE »). */
export interface NavCommande {
  symbol?: string;
  timeframe?: Timeframe;
  source?: ExchangeId;
}

// ─────────────────────────── Store UI de la palette ───────────────────────────

/** Modes d'affichage de la palette : liste des commandes ou table d'aide (raccourcis). */
export type ModePalette = "commandes" | "aide";

export interface PaletteUiState {
  /** true quand la palette est ouverte. */
  ouvert: boolean;
  /** Vue courante (commandes / aide). */
  mode: ModePalette;
  /** Ouvre la palette (mode « commandes » par défaut). */
  ouvrir: (mode?: ModePalette) => void;
  /** Ferme la palette. */
  fermer: () => void;
}

/**
 * Store d'ouverture de la palette — VANILLA (hors render-loop). Placé ici (et non dans
 * un store dédié) pour être importable par hotkeys.ts ET CommandPalette.tsx sans cycle.
 * Éphémère : NON persisté.
 */
export const paletteStore = createStore<PaletteUiState>((set) => ({
  ouvert: false,
  mode: "commandes",
  ouvrir: (mode = "commandes") => set({ ouvert: true, mode }),
  fermer: () => set({ ouvert: false }),
}));

// ─────────────────────────── Parsing de navigation (pur) ───────────────────────────

/**
 * Alias de timeframe reconnus par la saisie. Convention pour lever l'ambiguïté
 * minute/mois : les MINUTES s'écrivent avec un M simple (1M, 5M, 15M, 30M) et les MOIS
 * avec le suffixe « MO » (1MO, 3MO, 6MO, 12MO). Ainsi « SOL 15M » = 15 minutes.
 * Les valeurs sont les identifiants Timeframe canoniques de l'app (cf. adapters.ts).
 */
const ALIAS_TF: Record<string, Timeframe> = {
  "1S": "1s",
  "1M": "1m", "3M": "3m", "5M": "5m", "15M": "15m", "30M": "30m",
  "1H": "1h", "2H": "2h", "4H": "4h", "6H": "6h", "12H": "12h",
  "1D": "1d", "3D": "3d", "1W": "1w",
  "1MO": "1M", "3MO": "3M", "6MO": "6M", "12MO": "12M",
};

/** Alias de source (exchange) reconnus par la saisie. */
const ALIAS_SOURCE: Record<string, ExchangeId> = {
  BINANCE: "binance", BIN: "binance", BN: "binance",
  KRAKEN: "kraken", KRK: "kraken", KR: "kraken",
  COINBASE: "coinbase", COIN: "coinbase", CB: "coinbase",
  MEXC: "mexc",
  TWELVEDATA: "twelvedata", TRADFI: "twelvedata", TD: "twelvedata",
};

/** Libellé court des sources câblées (aperçu de commande de navigation). */
const SOURCE_LABEL: Partial<Record<ExchangeId, string>> = {
  binance: "Binance",
  kraken: "Kraken",
  coinbase: "Coinbase",
  twelvedata: "TradFi",
  mexc: "MEXC",
};

/**
 * Normalise un token en symbole exploitable :
 *  - « EUR/USD » (slash) : conservé tel quel ;
 *  - source tradfi : conservé tel quel (SPY, GLD…), aucune complétion de cotation ;
 *  - déjà suffixé d'une cotation connue (BTCUSDT, ETHUSD…) : conservé ;
 *  - base crypto nue (BTC, SOL, 1INCH…) : complétée en …USDT.
 */
function normaliserSymbole(token: string, source: ExchangeId | undefined): string {
  const s = token.toUpperCase();
  if (s.includes("/")) return s;
  if (source === "twelvedata") return s;
  if (QUOTE_ASSETS.some((q) => s.endsWith(q) && s.length > q.length)) return s;
  // Base alphanumérique (préfixe numérique optionnel, ex. 1000PEPE, 1INCH) → …USDT.
  if (/^[0-9]{0,4}[A-Z]{2,6}$/.test(s)) return `${s}USDT`;
  return s;
}

/**
 * Parse une saisie libre en intention de navigation (symbole + TF + source), dans
 * n'importe quel ordre : « SOL 4H », « 4H SOL BINANCE », « btcusdt ». Fonction PURE.
 * Renvoie null si rien d'exploitable n'est reconnu.
 */
export function parseNavigation(input: string): NavCommande | null {
  const tokens = input.trim().toUpperCase().split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return null;

  const nav: NavCommande = {};
  const restes: string[] = [];
  for (const tok of tokens) {
    const tf = ALIAS_TF[tok];
    if (nav.timeframe === undefined && tf !== undefined) {
      nav.timeframe = tf;
      continue;
    }
    const src = ALIAS_SOURCE[tok];
    if (nav.source === undefined && src !== undefined) {
      nav.source = src;
      continue;
    }
    restes.push(tok);
  }

  // Premier token non classé = symbole (les suivants sont ignorés).
  const brut = restes[0];
  if (brut !== undefined) nav.symbol = normaliserSymbole(brut, nav.source);

  if (nav.symbol === undefined && nav.timeframe === undefined && nav.source === undefined) {
    return null;
  }
  return nav;
}

/**
 * Applique une intention de navigation au store marché (source → symbole → TF).
 * Un changement de PAIRE bascule tout le terminal : toast annulable (revue v2 —
 * « DERIV » tapé dans ⌘K avait changé la paire globale silencieusement).
 */
export function appliquerNavigation(nav: NavCommande): void {
  const m = marketStore.getState();
  const avant = { exchange: m.exchange, symbol: m.symbol, timeframe: m.timeframe };
  if (nav.source !== undefined) m.setExchange(nav.source);
  if (nav.symbol !== undefined) m.setSymbol(nav.symbol);
  if (nav.timeframe !== undefined) m.setTimeframe(nav.timeframe);
  if (nav.symbol !== undefined && nav.symbol !== avant.symbol) {
    pousserToast(`Paire changée → ${nav.symbol}`, {
      libelle: "Annuler",
      executer: () => marketStore.getState().setMarket(avant),
    });
  }
}

/**
 * Construit la commande de navigation à partir d'une intention. Le libellé annonce
 * explicitement un changement de PAIRE (« Changer la paire → X ») — les autres
 * navigations (timeframe/source seuls) restent « Aller à … » (revue v2).
 */
export function commandeNavigation(nav: NavCommande): Commande {
  const parts: string[] = [];
  if (nav.symbol !== undefined) parts.push(nav.symbol);
  if (nav.timeframe !== undefined) parts.push(nav.timeframe);
  if (nav.source !== undefined) parts.push(SOURCE_LABEL[nav.source] ?? nav.source);
  const cible = parts.join(" · ");
  const libelle = nav.symbol !== undefined ? `Changer la paire → ${cible}` : `Aller à ${cible}`;
  return {
    id: "nav",
    libelle,
    categorie: "navigation",
    motsCles: parts,
    apercu: "Change le graphe (symbole / timeframe / source)",
    action: () => appliquerNavigation(nav),
  };
}

// ─────────────────────────── Recherche fuzzy (pur) ───────────────────────────

/**
 * Score de correspondance fuzzy par SOUS-SÉQUENCE : chaque caractère de `requete`
 * doit apparaître dans `cible`, dans l'ordre. Renvoie null si ce n'est pas une
 * sous-séquence, sinon un score (plus haut = meilleur). Bonus : début de mot,
 * caractères consécutifs, cible courte ; malus : caractères sautés. Fonction PURE.
 */
export function scoreFuzzy(requete: string, cible: string): number | null {
  const q = requete.trim().toLowerCase();
  if (q.length === 0) return 0;
  const c = cible.toLowerCase();

  let score = 0;
  let curseur = 0;
  let precedent = -2;
  for (const ch of q) {
    let idx = -1;
    for (let k = curseur; k < c.length; k++) {
      if (c[k] === ch) {
        idx = k;
        break;
      }
    }
    if (idx === -1) return null; // pas une sous-séquence

    const avant = idx > 0 ? c[idx - 1] : undefined;
    if (idx === 0 || avant === " " || avant === ":" || avant === "-") score += 6; // début de mot
    if (idx === precedent + 1) score += 4; // consécutif
    score -= (idx - curseur) * 0.5; // caractères sautés

    precedent = idx;
    curseur = idx + 1;
  }
  score += Math.max(0, 16 - c.length) * 0.3; // légère préférence aux cibles concises
  return score;
}

/**
 * Filtre et ORDONNE un registre par pertinence pour `requete` (fuzzy sur mnémonique,
 * libellé et mots-clés). Requête vide → registre inchangé. Fonction PURE.
 */
export function rechercher(registre: readonly Commande[], requete: string): Commande[] {
  const q = requete.trim();
  if (q.length === 0) return registre.slice();

  const notes: { cmd: Commande; note: number }[] = [];
  for (const cmd of registre) {
    const cibles = [cmd.mnemonique ?? "", cmd.libelle, ...cmd.motsCles];
    let meilleur: number | null = null;
    for (const cible of cibles) {
      if (cible.length === 0) continue;
      const s = scoreFuzzy(q, cible);
      if (s !== null && (meilleur === null || s > meilleur)) meilleur = s;
    }
    // Bonus fort quand le mnémonique COMMENCE par la requête (frappe Bloomberg directe).
    if (cmd.mnemonique !== undefined && cmd.mnemonique.toLowerCase().startsWith(q.toLowerCase())) {
      meilleur = (meilleur ?? 0) + 30;
    }
    if (meilleur !== null) notes.push({ cmd, note: meilleur });
  }
  notes.sort((a, b) => b.note - a.note || a.cmd.libelle.localeCompare(b.cmd.libelle));
  return notes.map((n) => n.cmd);
}

// ─────────────────────────── Focus des panneaux (impératif) ───────────────────────────

/** Normalise un texte pour comparaison : sans accents, en MAJUSCULES. */
function normaliserTexte(s: string): string {
  // ̀-ͯ = plage Unicode des diacritiques combinants (é → e, etc.).
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
}

/**
 * Amène un panneau de la sidebar à l'écran et le déplie s'il est replié, en le
 * repérant par le texte de son en-tête (ex. « WATCHLIST », « ALERTES »). Impératif :
 * les sections de la sidebar gèrent leur pli en interne (SidebarSection), sans store.
 */
export function focusPanneauSidebar(titre: string): void {
  const cible = normaliserTexte(titre);
  const sections = document.querySelectorAll<HTMLElement>("aside section");
  for (const section of sections) {
    const header = section.querySelector("header");
    if (header === null) continue;
    if (normaliserTexte(header.textContent ?? "").includes(cible)) {
      // Déplie si la section est repliée (bouton de bascule aria-expanded=false).
      const toggle = header.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
      toggle?.click();
      section.scrollIntoView({ block: "nearest", behavior: "smooth" });
      return;
    }
  }
}

// ─────────────────────────── Extension additive (commandes tierces) ───────────────────────────

/**
 * Commandes enregistrées par d'autres modules (ex. Workspaces) et ajoutées au registre.
 * Point d'extension ADDITIF : le registre reste la source unique, mais un module peut y
 * greffer ses commandes SANS que ce fichier ait à le connaître (pas de dépendance croisée).
 */
const commandesExternes: Commande[] = [];

/**
 * Enregistre des commandes tierces dans la palette. Dédoublonné par `id` (idempotent face
 * au HMR / double import). À appeler à l'IMPORT du module tiers, AVANT le premier rendu de
 * la palette (les commandes deviennent visibles au prochain `construireRegistre`).
 */
export function enregistrerCommandes(cmds: Commande[]): void {
  for (const cmd of cmds) {
    if (!commandesExternes.some((c) => c.id === cmd.id)) commandesExternes.push(cmd);
  }
}

// ─────────────────────────── Construction du registre ───────────────────────────

/** Timeframes proposés comme commandes (miroir des bascules de la Toolbar). */
const TF_COMMANDES: Timeframe[] = ["1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M", "3M", "6M", "12M"];

/** Libellés lisibles des thèmes (ordre = THEMES). */
const THEME_LABEL: Record<ThemeId, string> = {
  dark: "Sombre",
  bloomberg: "Bloomberg",
  matrix: "Matrix",
  cute: "Cute",
  aurora: "Aurora",
};

/**
 * Construit la liste complète des commandes statiques. Appelée UNE fois (les actions
 * sont des closures lisant les stores via getState() au moment de l'exécution).
 */
export function construireRegistre(): Commande[] {
  const commandes: Commande[] = [];

  // — Timeframes —
  for (const tf of TF_COMMANDES) {
    // « 1M » (mois) entrait en collision insensible à la casse avec « 1m » (minute) :
    // les timeframes mensuels prennent le suffixe MO (1MO, 3MO, 6MO, 12MO).
    const mois = tf.endsWith("M");
    commandes.push({
      id: `tf:${tf}`,
      mnemonique: mois ? `${tf.slice(0, -1)}MO` : tf.toUpperCase(),
      libelle: `Timeframe ${tf}${mois ? " (mois)" : ""}`,
      categorie: "timeframe",
      motsCles: ["timeframe", "tf", "intervalle", tf],
      apercu: `Bascule le graphe en ${tf}`,
      action: () => marketStore.getState().setTimeframe(tf),
    });
  }

  // — Indicateurs (fuzzy sur le registre @axiom/indicators, bascule activer/désactiver) —
  for (const def of INDICATORS) {
    commandes.push({
      id: `ind:${def.id}`,
      mnemonique: def.id.toUpperCase(),
      libelle: `${def.name} — activer / désactiver`,
      categorie: "indicateur",
      motsCles: ["indicateur", def.name, def.category, def.id],
      apercu: `Ajoute ou retire ${def.name} du graphe`,
      action: () => indicatorsStore.getState().toggle(def.id),
    });
  }

  // — Thèmes —
  for (const id of THEMES) {
    commandes.push({
      id: `theme:${id}`,
      mnemonique: `THEME ${id.toUpperCase()}`,
      libelle: `Thème ${THEME_LABEL[id]}`,
      categorie: "theme",
      motsCles: ["theme", "apparence", id, THEME_LABEL[id]],
      apercu: `Applique le thème ${THEME_LABEL[id]}`,
      action: () => themeStore.getState().setTheme(id),
    });
  }

  // — Jeux d'indicateurs nommés (dynamiques : dérivés du store, pas d'une liste figée) —
  for (const jeu of indicatorSetsStore.getState().jeux) {
    commandes.push({
      id: `ind-set:${jeu.id}`,
      mnemonique: "JEU",
      libelle: `Jeu « ${jeu.nom} » — rappeler`,
      categorie: "indicateur",
      motsCles: ["jeu", "setup", "preset", "indicateurs", jeu.nom, jeu.id],
      apercu: `Remplace les indicateurs par ce jeu (${jeu.instances.length})`,
      action: () => indicatorsStore.getState().setAll(jeu.instances),
    });
  }

  // — Panneaux par mnémonique Bloomberg —
  commandes.push(
    {
      id: "panneau:derives",
      mnemonique: "DES",
      libelle: "Produits dérivés",
      categorie: "panneau",
      motsCles: ["derives", "derivatives", "open interest", "funding", "liquidations", "coinalyze"],
      apercu: "Ouvre / ferme le panneau des produits dérivés",
      action: () => derivativesUiStore.getState().toggleDerivatives(),
    },
    {
      id: "panneau:watchlist",
      mnemonique: "MON",
      libelle: "Watchlist (focus)",
      categorie: "panneau",
      motsCles: ["watchlist", "monitor", "favoris", "paires"],
      apercu: "Fait défiler jusqu'à la watchlist",
      action: () => focusPanneauSidebar("WATCHLIST"),
    },
    {
      id: "panneau:macro",
      mnemonique: "MACRO",
      libelle: "Masse monétaire (indicateurs)",
      categorie: "panneau",
      motsCles: ["macro", "masse monetaire", "liquidite", "m2", "stablecoins"],
      // Les mesures macro ont quitté la sidebar : elles vivent dans l'onglet « Macro »
      // du menu Indicateurs, que cette commande ouvre directement.
      apercu: "Ouvre l'onglet Macro du menu Indicateurs",
      action: () => indicatorMenuUiStore.getState().ouvrirSurMacro(),
    },
    {
      id: "panneau:sante",
      mnemonique: "SANTE",
      libelle: "Santé des sources (focus)",
      categorie: "panneau",
      motsCles: ["sante", "health", "statut", "quotas", "ws", "poll"],
      apercu: "Fait défiler jusqu'au panneau de santé",
      action: () => focusPanneauSidebar("SANTE"),
    },
    {
      id: "panneau:alertes",
      mnemonique: "ALRT",
      libelle: "Alertes (focus)",
      categorie: "panneau",
      motsCles: ["alertes", "alerts", "alarmes", "conditions"],
      apercu: "Fait défiler jusqu'au panneau des alertes",
      action: () => focusPanneauSidebar("ALERTES"),
    },
    {
      id: "panneau:reglages",
      mnemonique: "REGLAGES",
      libelle: "Réglages",
      categorie: "panneau",
      motsCles: ["reglages", "settings", "cles", "api", "parametres"],
      apercu: "Ouvre le panneau des réglages",
      action: () => settingsUiStore.getState().openSettings(),
    },
  );

  // — Actions chart —
  commandes.push(
    {
      id: "action:export",
      mnemonique: "EXPORT",
      libelle: "Exporter le graphe (PNG)",
      categorie: "action",
      motsCles: ["export", "image", "png", "capture", "telecharger"],
      apercu: "Télécharge une image du graphe courant",
      action: () => {
        const { symbol, timeframe } = marketStore.getState();
        exportChartImage(symbol, timeframe);
      },
    },
    {
      id: "action:effacer-dessins",
      mnemonique: "CLR",
      libelle: "Effacer les dessins",
      categorie: "action",
      motsCles: ["effacer", "dessins", "overlays", "clear", "nettoyer"],
      apercu: "Supprime tous les tracés du graphe",
      action: () => clearAllOverlays(),
    },
    {
      id: "action:orderflow",
      mnemonique: "OF",
      libelle: "Orderflow — activer / désactiver",
      categorie: "action",
      motsCles: ["orderflow", "cvd", "footprint", "flux"],
      apercu: "Bascule l'orderflow (sources à flux de trades)",
      action: () => orderflowStore.getState().toggle(),
    },
    {
      id: "action:ocn",
      mnemonique: "OCN",
      libelle: "OCN — Open/Close Net (positions encore ouvertes)",
      categorie: "action",
      motsCles: ["ocn", "open close net", "oi", "open interest", "positions", "flux"],
      apercu: "Bascule l'overlay OCN (active l'orderflow si besoin) — Binance perp",
      action: () => {
        const s = orderflowStore.getState();
        const suivant = !s.showOpenCloseNet;
        s.setShowOpenCloseNet(suivant);
        // Prérequis : l'OCN se nourrit du footprint tick → orderflow obligatoire.
        if (suivant && !s.enabled) s.setEnabled(true);
      },
    },
    {
      id: "action:volume-profile",
      mnemonique: "VP",
      libelle: "Profil de volume — activer / désactiver",
      categorie: "action",
      motsCles: ["volume profile", "vpvr", "profil", "volume"],
      apercu: "Bascule le profil de volume par zone de prix",
      action: () => volumeProfileStore.getState().toggle(),
    },
    {
      id: "action:revenus",
      mnemonique: "REV",
      libelle: "Revenus on-chain — activer / désactiver",
      categorie: "action",
      motsCles: ["revenus", "revenue", "defillama", "protocole", "on-chain"],
      apercu: "Bascule la courbe de revenus du protocole",
      action: () => revenueStore.getState().toggle(),
    },
    {
      id: "action:aide",
      mnemonique: "AIDE",
      libelle: "Aide — raccourcis clavier",
      categorie: "action",
      motsCles: ["aide", "help", "raccourcis", "clavier", "?"],
      apercu: "Affiche la table des raccourcis clavier",
      action: () => paletteStore.getState().ouvrir("aide"),
    },
  );

  // Commandes greffées par d'autres modules (Workspaces…) en fin de registre.
  return [...commandes, ...commandesExternes];
}
