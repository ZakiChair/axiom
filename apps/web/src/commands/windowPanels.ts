/**
 * Commandes palette des fenêtres dont le store UI vit dans le fichier composant
 * (CORR, MAP, TERM, OMON, RATE, COT, SEAG, VOL, FUND, BRIEF).
 *
 * Pilotage via `windowManagerStore` uniquement — **aucune** import des composants
 * lourds — pour permettre le code-splitting (React.lazy) des fenêtres dans App.tsx
 * sans tirer le graphe de dépendances chart/canvas au démarrage.
 *
 * Les fenêtres dont le store est déjà dans `store/*.ts` (ECO, NEWS, DOM…) gardent
 * leurs commandes exportées depuis ces modules.
 */
import type { Commande } from "./registry";
import { windowManagerStore } from "../store/windowManager";

/** Bascule d’ouverture d’une fenêtre du registre Launchpad. */
function basculer(id: string): () => void {
  return () => windowManagerStore.getState().toggleWindow(id);
}

/** Commandes panneau pilotées par le gestionnaire de fenêtres. */
export const windowPanelCommands: Commande[] = [
  {
    id: "panneau:corr",
    mnemonique: "CORR",
    libelle: "Corrélations",
    categorie: "panneau",
    motsCles: ["correlation", "corr", "pearson", "spearman", "matrice", "diversification", "hedge"],
    apercu: "Ouvre / ferme la matrice de corrélation",
    action: basculer("corr"),
  },
  {
    id: "panneau:vue-marche",
    mnemonique: "MAP",
    libelle: "Vue marché (treemap)",
    categorie: "panneau",
    motsCles: ["vue marche", "market map", "treemap", "heatmap", "carte", "secteurs", "capitalisation", "imap"],
    apercu: "Ouvre / ferme la treemap de capitalisation du marché",
    action: basculer("marketMap"),
  },
  {
    id: "panneau:vue-marche-imap",
    mnemonique: "IMAP",
    libelle: "Vue marché (treemap)",
    categorie: "panneau",
    motsCles: ["vue marche", "market map", "treemap", "heatmap", "alias map"],
    apercu: "Alias de MAP — ouvre / ferme la treemap de capitalisation du marché",
    action: basculer("marketMap"),
  },
  {
    id: "panneau:term-structure",
    mnemonique: "TERM",
    libelle: "Structure par terme (basis)",
    categorie: "panneau",
    motsCles: [
      "term structure",
      "structure par terme",
      "basis",
      "contango",
      "backwardation",
      "courbe",
      "futures",
      "deribit",
      "coin-m",
    ],
    apercu: "Ouvre / ferme la courbe de basis annualisé BTC + ETH",
    action: basculer("termStructure"),
  },
  {
    id: "panneau:options",
    mnemonique: "OMON",
    libelle: "Options (smile IV, max pain, GEX/DEX)",
    categorie: "panneau",
    motsCles: [
      "options",
      "omon",
      "smile",
      "iv",
      "volatilite implicite",
      "max pain",
      "put call ratio",
      "dvol",
      "deribit",
      "gex",
      "dex",
      "gamma exposure",
      "delta exposure",
      "cboe",
      "spx",
      "ndx",
      "vix",
    ],
    apercu: "Ouvre / ferme le moniteur d'options (smile, GEX/DEX crypto & actions)",
    action: basculer("options"),
  },
  {
    id: "panneau:macroRates",
    mnemonique: "RATE",
    libelle: "Taux & Réserves souveraines",
    categorie: "panneau",
    motsCles: [
      "taux",
      "rendements",
      "obligations",
      "souverain",
      "treasury",
      "bund",
      "banque centrale",
      "fed",
      "bce",
      "ecb",
      "or",
      "gold",
      "reserves",
      "2s10s",
    ],
    apercu: "Ouvre / ferme les taux souverains, directeurs et réserves d'or",
    action: basculer("macroRates"),
  },
  {
    id: "panneau:cot",
    mnemonique: "COT",
    libelle: "Rapport COT (CFTC)",
    categorie: "panneau",
    motsCles: [
      "cot",
      "commitments of traders",
      "cftc",
      "positionnement",
      "net speculatif",
      "non commercial",
      "futures",
      "sentiment",
    ],
    apercu: "Ouvre / ferme le résumé du rapport COT (CFTC)",
    action: basculer("cot"),
  },
  {
    id: "panneau:seasonality",
    mnemonique: "SEAG",
    libelle: "Saisonnalité",
    categorie: "panneau",
    motsCles: ["saisonnalité", "seasonality", "heatmap", "mensuel", "seag"],
    apercu: "Ouvre / ferme la heatmap de saisonnalité du symbole courant",
    action: basculer("seasonality"),
  },
  {
    id: "panneau:vol",
    mnemonique: "VOL",
    libelle: "Volatilité (cône RV, VRP)",
    categorie: "panneau",
    motsCles: ["volatilité", "volatility", "cône", "cone", "rv", "dvol", "vrp", "vol"],
    apercu: "Ouvre / ferme le cône de volatilité réalisée et la comparaison RV/DVOL",
    action: basculer("vol"),
  },
  {
    id: "panneau:fund",
    mnemonique: "FUND",
    libelle: "Fiche société (FUND)",
    categorie: "panneau",
    motsCles: [
      "fondamentaux",
      "societe",
      "action",
      "equity",
      "profil",
      "earnings",
      "resultats",
      "sec",
      "edgar",
      "finnhub",
      "insider",
      "ticker",
    ],
    apercu: "Ouvre / ferme la fiche société (SEC EDGAR + Finnhub)",
    action: basculer("fund"),
  },
  {
    id: "panneau:brief",
    mnemonique: "BRIEF",
    libelle: "Point marché (BRIEF)",
    categorie: "panneau",
    motsCles: ["brief", "point marché", "snapshot", "matin", "morning", "overnight", "résumé", "ouverture"],
    apercu: "Ouvre / ferme le snapshot marché matinal",
    action: basculer("brief"),
  },
];
