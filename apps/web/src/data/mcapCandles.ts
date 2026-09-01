import type { Candle, IExchangeAdapter, Timeframe } from "@axiom/types";
import { createStore } from "zustand/vanilla";
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
  minuitUtc,
  type SymboleCapitalisation,
} from "./mcap";

export const TIMEFRAMES_CAPITALISATION: Timeframe[] = [
  "1h", "4h", "1d", "1w", "1M", "3M", "6M", "12M",
];

const HEURE_MS = 3_600_000;
/** Cadence du repoll de la bougie courante quand l'historique long CMC/CCData est actif. */
const REPOLL_MCAP_INTRADAY_MS = 5 * 60_000;
const REPOLL_MCAP_LENT_MS = 15 * 60_000;
const MOIS_PAR_TIMEFRAME: Partial<Record<Timeframe, number>> = {
  "1M": 1,
  "3M": 3,
  "6M": 6,
  "12M": 12,
};

const MESURE_PAR_SYMBOLE: Record<SymboleCapitalisation, "total" | "total2" | "total3"> = {
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

export function construireBougiesCapitalisation(
  snapshots: readonly McapSnapshot[],
  symbol: SymboleCapitalisation,
  timeframe: Timeframe = "1d",
  maintenant = Date.now(),
): Candle[] {
  const mesure = MESURE_PAR_SYMBOLE[symbol];
  const candles: Candle[] = [];
  let closePrecedent: number | null = null;

  for (const snapshot of [...snapshots].sort((a, b) => a.t - b.t)) {
    const valeur = snapshot[mesure];
    if (!Number.isFinite(snapshot.t) || !Number.isFinite(valeur) || valeur <= 0) continue;
    const time = debutBucketCapitalisation(snapshot.t, timeframe);
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

export const capitalisationAdapter: IExchangeAdapter = {
  id: "synthetic",

  async fetchKlines(symbol, tf, opts) {
    if (!estSymboleCapitalisation(symbol)) {
      throw new Error(`Symbole de capitalisation invalide : ${symbol}`);
    }
    if (!TIMEFRAMES_CAPITALISATION.includes(tf)) {
      throw new Error(`Timeframe de capitalisation non supporté : ${tf}`);
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
