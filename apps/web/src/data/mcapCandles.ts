import type { Candle, IExchangeAdapter, Timeframe } from "@axiom/types";
import { createStore } from "zustand/vanilla";
// Échantillon {t, v} d'une série autonome (USD pour TOTAL*, % pour STABLE.D).
import type { PointSerie } from "../lib/referentiel";
import { macroHistoryStore, type McapSnapshot } from "../store/macroHistory";
import { bucketStartMs } from "./binance";
import {
  chargerHistoriqueCmc,
  fetchPageHistoriqueCmc,
  historiqueCmcDisponible,
  type IntervalleCmc,
} from "./cmcMcap";
import { chargerHistoriqueCcData, historiqueCcDataDisponible } from "./ccdataMcap";
import {
  JOUR_MS,
  estSymboleCapitalisation,
  estSymboleDominance,
  minuitUtc,
  type SymboleCapitalisationUsd,
} from "./mcap";

export const TIMEFRAMES_CAPITALISATION: Timeframe[] = [
  "1h", "4h", "1d", "1w", "1M", "3M", "6M", "12M",
];

const HEURE_MS = 3_600_000;
/** Cadence du repoll de la bougie courante quand l'historique long CMC/CCData est actif. */
export const REPOLL_MCAP_INTRADAY_MS = 5 * 60_000;
export const REPOLL_MCAP_LENT_MS = 15 * 60_000;
const MOIS_PAR_TIMEFRAME: Partial<Record<Timeframe, number>> = {
  "1M": 1,
  "3M": 3,
  "6M": 6,
  "12M": 12,
};

/** Mesure de McapSnapshot par capitalisation en USD — la dominance (en %) n'en a aucune. */
const MESURE_PAR_SYMBOLE: Record<SymboleCapitalisationUsd, "total" | "total2" | "total3"> = {
  TOTAL: "total",
  TOTAL2: "total2",
  TOTAL3: "total3",
};

function debutSemaineUtc(time: number): number {
  const jour = minuitUtc(time);
  const lundiDepuis = (new Date(jour).getUTCDay() + 6) % 7;
  return jour - lundiDepuis * JOUR_MS;
}

export function debutBucketCapitalisation(time: number, timeframe: Timeframe): number {
  if (timeframe === "1h") return Math.floor(time / HEURE_MS) * HEURE_MS;
  if (timeframe === "4h") return Math.floor(time / (4 * HEURE_MS)) * 4 * HEURE_MS;
  if (timeframe === "1d") return minuitUtc(time);
  if (timeframe === "1w") return debutSemaineUtc(time);
  const mois = MOIS_PAR_TIMEFRAME[timeframe];
  if (mois !== undefined) return bucketStartMs(time, mois);
  throw new Error(`Timeframe de capitalisation non supporté : ${timeframe}`);
}

function finBucketCapitalisation(time: number, timeframe: Timeframe): number {
  if (timeframe === "1h") return time + HEURE_MS;
  if (timeframe === "4h") return time + 4 * HEURE_MS;
  if (timeframe === "1d") return time + JOUR_MS;
  if (timeframe === "1w") return time + 7 * JOUR_MS;
  const mois = MOIS_PAR_TIMEFRAME[timeframe];
  if (mois === undefined) return time;
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + mois, 1);
}

/**
 * Bougies OHLC d'une série d'instantanés : bucket `debutBucketCapitalisation`, ouverture =
 * clôture précédente (le dernier instantané du bucket d'avant), haut/bas sur les points du
 * bucket, volume 0, `closed` selon la fin du bucket. Une valeur non finie ou ≤ 0 est écartée
 * (avant USDT, la somme des stablecoins est nulle : la dominance ne trace rien).
 */
export function construireBougiesSerie(
  points: readonly PointSerie[],
  timeframe: Timeframe = "1d",
  maintenant = Date.now(),
): Candle[] {
  const candles: Candle[] = [];
  let closePrecedent: number | null = null;

  for (const point of [...points].sort((a, b) => a.t - b.t)) {
    const valeur = point.v;
    if (!Number.isFinite(point.t) || !Number.isFinite(valeur) || valeur <= 0) continue;
    const time = debutBucketCapitalisation(point.t, timeframe);
    const derniere = candles.at(-1);

    if (derniere?.time === time) {
      derniere.high = Math.max(derniere.high, valeur);
      derniere.low = Math.min(derniere.low, valeur);
      derniere.close = valeur;
      closePrecedent = valeur;
      continue;
    }

    const open = closePrecedent ?? valeur;
    candles.push({
      time,
      open,
      high: Math.max(open, valeur),
      low: Math.min(open, valeur),
      close: valeur,
      volume: 0,
      closed: finBucketCapitalisation(time, timeframe) <= maintenant,
    });
    closePrecedent = valeur;
  }

  return candles;
}

/** TOTAL/TOTAL2/TOTAL3 : projection de la mesure du snapshot, puis constructeur générique. */
export function construireBougiesCapitalisation(
  snapshots: readonly McapSnapshot[],
  symbol: SymboleCapitalisationUsd,
  timeframe: Timeframe = "1d",
  maintenant = Date.now(),
): Candle[] {
  const mesure = MESURE_PAR_SYMBOLE[symbol];
  return construireBougiesSerie(
    snapshots.map((snapshot) => ({ t: snapshot.t, v: snapshot[mesure] })),
    timeframe,
    maintenant,
  );
}

/** Source réellement servie par le dernier `fetchKlines` d'une série de capitalisation. */
export type SourceCapitalisation = "cmc" | "ccdata" | "coingecko";

/**
 * Provenance RÉELLE des bougies de capitalisation, posée par l'adaptateur AU MOMENT où il
 * choisit sa source. Le bandeau ne doit pas la re-deviner par disponibilité : un repli
 * CoinGecko avec un cache CMC présent afficherait sinon « CoinMarketCap » sur des données
 * CoinGecko (l'étiquetage des sources est une exigence du contrat — UNUSABLE/PARTIAL).
 * Clé : `${symbole}:${timeframe}` — deux slots sur des TF différents ne s'écrasent pas.
 */
export const sourcesCapitalisationStore = createStore<{
  sources: Record<string, SourceCapitalisation>;
}>(() => ({ sources: {} }));

function publierSourceCapitalisation(
  symbol: string,
  tf: Timeframe,
  source: SourceCapitalisation,
): void {
  sourcesCapitalisationStore.setState((state) =>
    state.sources[`${symbol}:${tf}`] === source
      ? state
      : { sources: { ...state.sources, [`${symbol}:${tf}`]: source } },
  );
}

/**
 * Chargeur mémorisé d'un module paresseux : un seul `import()` en vol, oublié en cas d'échec
 * pour que l'essai suivant réessaie. Cela ne rattrape qu'une coupure réseau passagère : après
 * un redéploiement, l'ancien chunk n'existe plus et seul un rechargement de la page aide.
 */
export function chargeurMemorise<T>(importer: () => Promise<T>): () => Promise<T> {
  let enCours: Promise<T> | undefined;
  return () => (enCours ??= importer().catch((erreur: unknown) => {
    enCours = undefined;
    throw erreur;
  }));
}

/**
 * Abonnement servi par un chunk : `subscribeKline` rend son désabonnement tout de suite, le
 * module arrive après. Désabonner AVANT le chunk annule l'abonnement (aucun minuteur orphelin) ;
 * chunk non chargé : rien (fetchKlines a déjà affiché « rechargez la page »).
 */
export function abonnerApresChargement<M>(
  charger: () => Promise<M>,
  abonner: (module: M) => () => void,
): () => void {
  let arret: (() => void) | undefined;
  let annule = false;
  charger().then((module) => {
    if (!annule) arret = abonner(module);
  }, () => {});
  return () => {
    annule = true;
    arret?.();
  };
}

/**
 * STABLE.D (dominance des stablecoins, en %) vit dans un chunk à part : budget d'entrée, cf.
 * MODULES_DIFFERES. JAMAIS d'import de valeur statique de ce module ici ni ailleurs.
 */
const chargerDominance = chargeurMemorise(() => import("./dominanceStablecoins"));

export const capitalisationAdapter: IExchangeAdapter = {
  id: "synthetic",

  async fetchKlines(symbol, tf, opts) {
    if (!estSymboleCapitalisation(symbol)) {
      throw new Error(`Symbole de capitalisation invalide : ${symbol}`);
    }
    if (!TIMEFRAMES_CAPITALISATION.includes(tf)) {
      throw new Error(`Timeframe de capitalisation non supporté : ${tf}`);
    }
    if (estSymboleDominance(symbol)) {
      // CMC seul : ni CCData ni l'échantillonnage CoinGecko n'ont les capitalisations par
      // stablecoin. La provenance n'est publiée qu'après un succès.
      const module = await chargerDominance().catch((cause: unknown) => {
        // Chunk introuvable (redéploiement : l'ancien nom haché n'existe plus) ou réseau coupé :
        // texte fixe défini ICI, jamais importé du chunk ; dataLoadErrorMessage l'affiche tel quel.
        throw Object.assign(new Error("Dominance stablecoins non chargée (réseau ou mise à jour d'AXIOM) ; rechargez la page.", { cause }), {
          name: "ErreurDominanceStablecoins",
        });
      });
      const bougies = await module.bougiesDominance(tf, opts);
      publierSourceCapitalisation(symbol, tf, "cmc");
      return bougies;
    }

    let snapshots: McapSnapshot[];
    let erreurIntraday: unknown = null;
    let source: SourceCapitalisation;
    if (tf === "1h" || tf === "4h") {
      try {
        snapshots = await fetchPageHistoriqueCmc(tf, {
          endTime: opts?.endTime,
          limit: opts?.limit,
        });
        source = "cmc";
      } catch (error) {
        erreurIntraday = error;
        snapshots = macroHistoryStore.getState().snapshots;
        source = "coingecko";
      }
    } else {
      const historiqueCmc = await chargerHistoriqueCmc();
      const historiqueCcData = historiqueCmc === null ? await chargerHistoriqueCcData() : null;
      snapshots = historiqueCmc ?? historiqueCcData ?? macroHistoryStore.getState().snapshots;
      source = historiqueCmc !== null ? "cmc" : historiqueCcData !== null ? "ccdata" : "coingecko";
    }

    const candles = construireBougiesCapitalisation(snapshots, symbol, tf);
    const endTime = opts?.endTime;
    const bornees = endTime === undefined
      ? candles
      : candles.filter((candle) => candle.time <= endTime);
    const limit = opts?.limit;
    const result = limit === undefined ? bornees : bornees.slice(-Math.max(0, Math.floor(limit)));
    if (result.length === 0 && erreurIntraday !== null) throw erreurIntraday;
    publierSourceCapitalisation(symbol, tf, source);
    return result;
  },

  subscribeKline(symbol, tf, cb) {
    if (!estSymboleCapitalisation(symbol) || !TIMEFRAMES_CAPITALISATION.includes(tf)) {
      return () => {};
    }
    if (estSymboleDominance(symbol)) {
      // Repoll CMC du module ; pas de mode dégradé macroHistory (aucune pièce stable dedans).
      return abonnerApresChargement(chargerDominance, (module) => module.abonnerDominance(tf, cb));
    }
    if (historiqueCmcDisponible() || historiqueCcDataDisponible()) {
      // Historique long actif : on ne mélange PAS les ticks CoinGecko (niveaux différents
      // de CMC → la bougie courante sauterait à chaque raccord). La dernière bougie est
      // rafraîchie par un repoll léger de la MÊME source CMC : la page couvre le bucket
      // courant + un point du bucket précédent, pour que l'open (close précédent,
      // forward-fill) reste identique à celui de l'historique affiché.
      const intervalle: IntervalleCmc = tf === "1h" || tf === "4h" ? tf : "1d";
      const pas = intervalle === "1h" ? HEURE_MS : intervalle === "4h" ? 4 * HEURE_MS : JOUR_MS;
      let arrete = false;
      let derniereSignature = "";
      const rafraichir = async (): Promise<void> => {
        try {
          // La provenance RÉELLEMENT servie (posée par fetchKlines) peut être "coingecko"
          // ou "ccdata" même si `historiqueCmcDisponible()` est vrai (ex. repli après panne
          // de l'endpoint intraday CMC avec un cache daily présent). Repoller CMC pousserait
          // alors une bougie de niveau différent sur une série affichée à un autre niveau —
          // le même saut interdit par la note de conception ci-dessus, en sens inverse.
          const sourceServie = sourcesCapitalisationStore.getState().sources[`${symbol}:${tf}`];
          if (sourceServie !== "cmc") return;
          const maintenant = Date.now();
          const debutBucket = debutBucketCapitalisation(maintenant, tf);
          const limit = Math.ceil((maintenant - debutBucket) / pas) + 2;
          const snapshots = await fetchPageHistoriqueCmc(intervalle, { limit });
          if (arrete) return;
          const candle = construireBougiesCapitalisation(snapshots, symbol, tf).at(-1);
          // Bucket courant absent de la page (retard amont) : ne rien émettre plutôt
          // que de réécrire une bougie déjà close avec des données partielles.
          if (candle === undefined || candle.time !== debutBucket) return;
          const signature = `${candle.time}:${candle.open}:${candle.high}:${candle.low}:${candle.close}`;
          if (signature === derniereSignature) return;
          derniereSignature = signature;
          cb(candle);
        } catch {
          // Repoll best-effort : une panne transitoire laisse la bougie en l'état.
        }
      };
      const timer = setInterval(
        () => void rafraichir(),
        tf === "1h" || tf === "4h" ? REPOLL_MCAP_INTRADAY_MS : REPOLL_MCAP_LENT_MS,
      );
      return () => {
        arrete = true;
        clearInterval(timer);
      };
    }
    // Mode dégradé (ni CMC ni CCData) : la série vit sur l'échantillonneur macroHistory.
    let derniereSignature = "";
    return macroHistoryStore.subscribe((state) => {
      const candle = construireBougiesCapitalisation(state.snapshots, symbol, tf).at(-1);
      if (candle === undefined) return;
      const signature = `${candle.time}:${candle.open}:${candle.high}:${candle.low}:${candle.close}`;
      if (signature === derniereSignature) return;
      derniereSignature = signature;
      cb(candle);
    });
  },

  subscribeTrades() {
    return () => {};
  },
};
