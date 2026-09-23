/** Capacités explicites de DATA : aucune collecte ni ouverture au chargement du module. */
import type { WindowId } from "../store/windowManager";

export type ActionData =
  | { id: "actualiser"; type: "eco"; libelle: string }
  | { id: "reglages"; type: "reglages"; libelle: string }
  | { id: "vue"; type: "fenetre"; libelle: string; fenetre: WindowId }
  | { id: "documentation"; type: "lien"; libelle: string; url: string };

export interface CapacitesSourceData {
  actions: ActionData[];
  motif: string;
}

/** Liste fermée de destinations publiques : aucun identifiant ni secret interpolé. */
const PAGES_PUBLIQUES = {
  binance: "https://developers.binance.com/docs/binance-spot-api-docs",
  bybit: "https://bybit-exchange.github.io/docs/v5/intro",
  okx: "https://www.okx.com/docs-v5/en/",
  kraken: "https://docs.kraken.com/",
  coinbase: "https://docs.cdp.coinbase.com/",
  mexc: "https://www.mexc.com/",
  hyperliquid: "https://hyperliquid.gitbook.io/hyperliquid-docs/",
  twelvedata: "https://twelvedata.com/docs",
  coinalyze: "https://api.coinalyze.net/v1/doc/",
  fred: "https://fred.stlouisfed.org/",
  forexfactory: "https://www.forexfactory.com/calendar",
  bgeometrics: "https://bitcoin-data.com/",
  coinmetrics: "https://docs.coinmetrics.io/",
  cryptoquant: "https://cryptoquant.com/",
  etherscan: "https://etherscan.io/",
  mempool: "https://mempool.space/",
  sosovalue: "https://sosovalue.com/",
  coingecko: "https://www.coingecko.com/",
  deribit: "https://docs.deribit.com/",
  cboe: "https://www.cboe.com/",
  cftc: "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm",
} as const;

interface CapaciteConnue {
  page?: keyof typeof PAGES_PUBLIQUES;
  reglages?: boolean;
  eco?: boolean;
  vue?: { id: WindowId; nom: string };
  motif: string;
}

const CHAIN = { id: "onchain", nom: "CHAIN" } as const;
const RATE = { id: "macroRates", nom: "RATE" } as const;
const ECO = { id: "eco", nom: "ECO" } as const;
const DES = { id: "derivatives", nom: "DES" } as const;
const MOTIF_CHAIN = "Ouvrez CHAIN pour actualiser ses données avec le bouton de la fenêtre.";
const MOTIF_RATE = "Ouvrez RATE pour actualiser la section concernée.";
const MOTIF_FLUX = "Le flux est piloté par le graphique ; sa reconnexion est automatique.";
const SOURCES: Record<string, CapaciteConnue> = {
  "eco:fred": { page: "fred", reglages: true, eco: true, vue: ECO, motif: "Actualiser ECO recharge le calendrier FRED et ForexFactory, dans la limite du quota." },
  "eco:forexfactory": { page: "forexfactory", eco: true, vue: ECO, motif: "Actualiser ECO recharge le calendrier ForexFactory et FRED, dans la limite du quota." },
  "macro:fred": { page: "fred", reglages: true, vue: RATE, motif: MOTIF_RATE },
  "macro:oecd": { vue: RATE, motif: MOTIF_RATE },
  "macro:eurostat": { vue: RATE, motif: MOTIF_RATE },
  "macro:ons": { vue: RATE, motif: MOTIF_RATE },
  "macro:nbs": { vue: RATE, motif: MOTIF_RATE },
  "macro:mospi": { vue: RATE, motif: MOTIF_RATE },
  "macro:statcan": { vue: RATE, motif: MOTIF_RATE },
  "macro:boj": { vue: RATE, motif: MOTIF_RATE },
  coinalyze: { page: "coinalyze", reglages: true, vue: DES, motif: "La clé se configure dans Réglages ; les dérivés se consultent dans DES." },
  twelvedata: { page: "twelvedata", reglages: true, motif: "Clé et accès à configurer dans Réglages ; les quotas du fournisseur restent applicables." },
  "twelvedata:quotes": { page: "twelvedata", reglages: true, motif: "Clé et accès à configurer dans Réglages ; les quotas du fournisseur restent applicables." },
  bgeometrics: { page: "bgeometrics", reglages: true, vue: CHAIN, motif: MOTIF_CHAIN },
  coinmetrics: { page: "coinmetrics", vue: CHAIN, motif: MOTIF_CHAIN },
  cryptoquant: { page: "cryptoquant", reglages: true, vue: CHAIN, motif: "Configurez votre clé dans Réglages ; les données figurent dans CHAIN et DES." },
  etherscan: { page: "etherscan", reglages: true, vue: CHAIN, motif: MOTIF_CHAIN },
  mempool: { page: "mempool", vue: CHAIN, motif: MOTIF_CHAIN },
  sosovalue: { page: "sosovalue", reglages: true, vue: CHAIN, motif: MOTIF_CHAIN },
  "coingecko:market": { page: "coingecko", reglages: true, vue: { id: "marketMap", nom: "MAP" }, motif: "Configurez la clé optionnelle dans Réglages ou ouvrez la vue marché." },
  "cot:cftc": { page: "cftc", vue: { id: "cot", nom: "COT" }, motif: "Le rapport et ses contrôles de chargement sont disponibles dans COT." },
  "binance:futures": { page: "binance", vue: DES, motif: "Les données dérivées se consultent dans DES ; DATA ne réinitialise pas le fournisseur." },
  "binance:coinm": { page: "binance", vue: { id: "termStructure", nom: "TERM" }, motif: "Ouvrez TERM pour consulter la structure par terme." },
  deribit: { page: "deribit", vue: { id: "options", nom: "OMON" }, motif: "Les données options et leurs contrôles sont disponibles dans OMON." },
  cboe: { page: "cboe", vue: { id: "options", nom: "OMON" }, motif: "Les données options et leurs contrôles sont disponibles dans OMON." },
  news: { vue: { id: "news", nom: "NEWS" }, motif: "Les flux et leur suivi sont disponibles dans NEWS." },
  axiomd: { motif: "La connexion dépend du daemon local axiomd. Aucune commande de démarrage n'est exposée ici." },
};

/** PURE. Les canaux WS connus partagent seulement la documentation de leur exchange. */
export function actionsSourceData(source: string): CapacitesSourceData {
  let definition = Object.hasOwn(SOURCES, source) ? SOURCES[source] : undefined;
  if (definition === undefined && /^(binance|bybit|okx|kraken|coinbase|mexc|hyperliquid)(?::(?:trades|depth|quotes|ticker|klines))?$/.test(source)) {
    definition = { page: source.split(":")[0] as keyof typeof PAGES_PUBLIQUES, motif: MOTIF_FLUX };
  }
  if (definition === undefined) return { actions: [], motif: "Aucune action disponible pour cette source dans DATA." };
  const actions: ActionData[] = [];
  if (definition.eco) actions.push({ id: "actualiser", type: "eco", libelle: "Actualiser ECO" });
  if (definition.reglages) actions.push({ id: "reglages", type: "reglages", libelle: "Configurer" });
  if (definition.vue) actions.push({ id: "vue", type: "fenetre", libelle: `Ouvrir ${definition.vue.nom}`, fenetre: definition.vue.id });
  if (definition.page) actions.push({ id: "documentation", type: "lien", libelle: "Page publique ↗", url: PAGES_PUBLIQUES[definition.page] });
  return { actions, motif: definition.motif };
}

export interface DependancesActionsData {
  actualiserEco: (source: string) => Promise<void>;
  ouvrirReglages: () => void | Promise<void>;
  ouvrirFenetre: (id: WindowId) => void | Promise<void>;
}

/** Le store ECO rend void : attendre son résultat et vérifier la source, pas seulement FOMC/cache. */
async function actualiserEco(source: string): Promise<void> {
  const [{ ecoStore }, { healthStore }] = await Promise.all([import("../store/eco"), import("../store/health")]);
  if (ecoStore.getState().status === "loading") throw new Error("Une actualisation du calendrier est déjà en cours. Consultez ECO.");
  const debut = Date.now();
  await new Promise<void>((resolve, reject) => {
    let termine = false;
    let demarre = false;
    let desabonner = () => {};
    const finir = (erreur?: string) => {
      if (termine) return;
      termine = true;
      clearTimeout(timer);
      desabonner();
      if (erreur) reject(new Error(erreur));
      else resolve();
    };
    const verifier = () => {
      const etat = ecoStore.getState();
      if (etat.status === "loading") { demarre = true; return; }
      if (!demarre) return;
      if (etat.brideDebit) { finir("Quota du calendrier atteint : aucune nouvelle collecte. Réessayez après la fenêtre de cinq minutes."); return; }
      if (etat.status === "error" || etat.error) { finir(etat.error ?? "Échec du chargement du calendrier."); return; }
      if (etat.status !== "ready") return;
      const sante = healthStore.getState().sources[source];
      if (sante?.etat === "error") { finir(sante.derniereErreur ?? "La source du calendrier reste indisponible."); return; }
      if (!sante || sante.dernierMessageTs < debut) { finir("Aucun nouveau relevé confirmé pour cette source. Consultez ECO."); return; }
      finir();
    };
    const timer = setTimeout(() => finir("Actualisation non confirmée après 25 secondes. Consultez ECO."), 25_000);
    desabonner = ecoStore.subscribe(verifier);
    try {
      ecoStore.getState().refresh(true);
      verifier();
    } catch (erreur) {
      finir(erreur instanceof Error ? erreur.message : "Échec du chargement du calendrier.");
    }
  });
}

const DEPENDANCES: DependancesActionsData = {
  actualiserEco,
  ouvrirReglages: async () => {
    const { settingsUiStore } = await import("../store/settings-ui");
    settingsUiStore.getState().openSettings();
  },
  ouvrirFenetre: async (id) => {
    const { windowManagerStore } = await import("../store/windowManager");
    windowManagerStore.getState().openWindow(id);
  },
};

/** Exécute uniquement une capacité du registre. Les liens restent des ancres natives. */
export async function executerActionData(source: string, id: string, deps = DEPENDANCES): Promise<string> {
  const action = actionsSourceData(source).actions.find((a) => a.id === id);
  if (!action || action.type === "lien") throw new Error("Action indisponible pour cette source.");
  if (action.type === "eco") {
    await deps.actualiserEco(source);
    return "Calendrier actualisé : nouveau relevé confirmé pour cette source.";
  }
  if (action.type === "reglages") {
    await deps.ouvrirReglages();
    return "Réglages ouverts pour configurer la clé de cette source.";
  }
  await deps.ouvrirFenetre(action.fenetre);
  return `${action.libelle.replace("Ouvrir ", "")} ouvert ; utilisez les contrôles de cette fenêtre.`;
}
