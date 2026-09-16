/**
 * Store du premium Coinbase/Binance (CBPREM) — Zustand VANILLA.
 *
 * Un run (spec 2026-07-23, branche 3) : klines spot 1h ~30 j des DEUX venues déjà
 * câblées dans le sélecteur d'exchange — Coinbase (BTC-USD/ETH-USD) et Binance
 * (BTCUSDT/ETHUSDT) — via leurs `fetchKlines` EXISTANTS (aucune nouvelle URL). Le
 * calcul (alignement par openTime + stats) est PUR (data/cbprem.ts). Pas de polling :
 * un run à l'ouverture de la fenêtre + bouton Rafraîchir. Erreur NON destructive dès
 * la v1 (patron squeeze post-v1.1) : la série existante reste affichée, `erreur` n'est
 * effacée qu'au succès. Garde 200-vide : un succès HTTP à série vide n'écrase PAS une
 * série valide déjà affichée — la série/stats/majTs existants sont conservés et `erreur`
 * est posée (sinon un 200 vide effacerait silencieusement une courbe valide). Garde de
 * péremption `currentRunId` (double clic / changement de base) : les résultats d'un run
 * périmé sont ignorés.
 *
 * Filtrage de clôture : `serieCbprem` ne peut PAS filtrer les bougies en formation (sa
 * signature `{t, close}` n'expose pas `closed`). C'est le store qui écarte la dernière
 * bougie non clôturée (`closed === false`) AVANT l'alignement, via `versPointsClos`
 * (pure, testée) — sinon le premium « courant » refléterait une bougie partielle.
 *
 * Ajustement du peg USDT (doc 02 § B7) : un troisième fetch, Kraken USDT/USD 1h, EN
 * PARALLÈLE des deux venues, fournit le taux k qui convertit la jambe Binance en USD
 * (`serieCbpremAjustee`). Deux séries coexistent — `serieBrute` (USD vs USDT, inclut le
 * peg) et `serieAjustee` (peg neutralisé) — et `serie`/`stats` restent LA SÉRIE AFFICHÉE,
 * choisie par `mode` (défaut « ajuste »). L'ajustement est un bonus NON destructif : un
 * échec Kraken ne touche pas `erreur` (qui signifie « Coinbase ou Binance ont échoué ») —
 * on retombe en mode « brute » avec `noteAjustement` posée. `setMode` rebascule sans refetch.
 * Invariant après tout run RÉUSSI : `mode === "brute"` dès que `serieAjustee` est vide (l'état
 * initial et un échec Coinbase/Binance laissent le mode tel quel) ; une brute n'est un CHOIX
 * utilisateur (qui survit aux runs suivants) que si une ajustée existait pour en basculer.
 */
import type { Candle } from "@axiom/types";
import { createStore } from "zustand/vanilla";
import {
  ecartPegDernierPoint,
  serieCbprem,
  serieCbpremAjustee,
  statsPremium,
  type PointPremium,
} from "../data/cbprem";
import { binanceAdapter } from "../data/binance";
import { coinbaseAdapter } from "../data/coinbase";
import { krakenAdapter } from "../data/kraken";

/** Timeframe des deux venues (et du taux USDT/USD). */
const TF = "1h" as const;
/** ~30 jours de bougies horaires. */
const CIBLE_BOUGIES = 720;
/** Coinbase plafonne à 350 bougies/appel → pagination arrière (720 tient en ≤ 3 pages). */
const COINBASE_MAX_PAGES = 3;
/**
 * Symbole Kraken du taux de référence USDT/USD — forme à BARRE OBLIQUE (découpe explicite
 * base/cotation par `splitSymbol`). La forme concaténée « USDTUSD » serait découpée à tort en
 * base « USD » / cotation « TUSD » (suffixe « TUSD » reconnu avant « USD ») : sans effet sur
 * l'altname REST (reconcaténé à l'identique « USDTUSD »), mais faux pour le symbole WS
 * (« USD/TUSD ») — on garde la forme honnête plutôt qu'une coïncidence.
 */
const SYMBOLE_USDT_USD = "USDT/USD";
/** Note affichée quand l'ajustement est impossible (Kraken en échec ou série ajustée vide). */
const NOTE_AJUSTEMENT_INDISPONIBLE = "Ajustement USDT indisponible (Kraken) — prime brute affichée.";

/** Série affichée : ajustée du peg USDT (défaut) ou brute (USD vs USDT). */
export type ModeCbprem = "ajuste" | "brute";

/** Symboles concaténés par venue (Coinbase « BTCUSD » → « BTC-USD » via splitSymbol). */
const SYMBOLES: Record<"BTC" | "ETH", { bn: string; cb: string }> = {
  BTC: { bn: "BTCUSDT", cb: "BTCUSD" },
  ETH: { bn: "ETHUSDT", cb: "ETHUSD" },
};

/**
 * Écarte la bougie en formation (`closed === false`) puis projette en `{t, close}` pour
 * `serieCbprem`. On garde `closed === true` ET `closed === undefined` (convention
 * `finaliser` de backtestData : seule la bougie explicitement non clôturée est retirée).
 * PURE & testée — c'est l'unique portion normalisation du run, isolée pour la geler
 * contre une régression silencieuse (une bougie partielle fausserait le premium courant).
 */
export function versPointsClos(candles: readonly Candle[]): { t: number; close: number }[] {
  const out: { t: number; close: number }[] = [];
  for (const c of candles) {
    if (c.closed === false) continue;
    out.push({ t: c.time, close: c.close });
  }
  return out;
}

/**
 * Klines Coinbase 1h par pagination ARRIÈRE (endTime décroissant) jusqu'à `cible`
 * bougies ou `COINBASE_MAX_PAGES` pages — Coinbase renvoie ≤ 350/appel. Réutilise
 * `coinbaseAdapter.fetchKlines` (patron SeasonalityWindow). Rejette si un appel échoue.
 */
async function fetchCoinbase1h(symbol: string, cible: number): Promise<Candle[]> {
  const pages: Candle[] = [];
  let endTime: number | undefined;
  for (let i = 0; i < COINBASE_MAX_PAGES && pages.length < cible; i++) {
    const batch = await coinbaseAdapter.fetchKlines(symbol, TF, { limit: 350, endTime });
    if (batch.length === 0) break;
    pages.unshift(...batch); // batch trié chrono ↑ ; unshift = bloc plus ancien devant
    endTime = batch[0] === undefined ? undefined : batch[0].time - 1;
  }
  return pages;
}

/**
 * Taux USDT/USD 1h (Kraken) en UN appel : Kraken n'a pas d'`endTime` (pas de pagination
 * possible) et renvoie ~720 bougies, mais l'adaptateur tronque à `opts.limit ?? 500` →
 * `limit: CIBLE_BOUGIES` est impératif. Ne rejette JAMAIS (`null` en cas d'échec) : câblé
 * dans le même `Promise.all` que les venues, il ne doit pas déclencher leur `catch` —
 * `erreur` reste le contrat « Coinbase ou Binance ont échoué ». L'adaptateur REST Kraken
 * pose `closed` (openTime + 1h ≤ maintenant), donc `versPointsClos` écarte bien l'heure en
 * formation, comme pour les deux venues.
 */
async function fetchUsdtUsd1h(): Promise<Candle[] | null> {
  try {
    return await krakenAdapter.fetchKlines(SYMBOLE_USDT_USD, TF, { limit: CIBLE_BOUGIES });
  } catch (err) {
    // Avalé (bonus non destructif) mais tracé : sans cela, une erreur de programmation
    // passerait pour une simple panne Kraken.
    console.warn("[AXIOM] Taux USDT/USD Kraken indisponible — prime CBPREM brute affichée", err);
    return null;
  }
}

export interface CbpremState {
  base: "BTC" | "ETH";
  /** true pendant un run (désactive le bouton Rafraîchir). */
  enCours: boolean;
  /** Série AFFICHÉE (= `serieAjustee` ou `serieBrute` selon `mode`). */
  serie: PointPremium[];
  /** Stats de la série affichée. */
  stats: ReturnType<typeof statsPremium> | null;
  /** Message d'erreur affichable si Coinbase ou Binance échoue, sinon null — NON destructif. */
  erreur: string | null;
  /** Horodatage du dernier succès (fraîcheur affichée), sinon null. */
  majTs: number | null;
  /** Série affichée : « ajuste » par défaut ; « brute » forcé quand l'ajustée est indisponible. */
  mode: ModeCbprem;
  /** Premium USD vs USDT (inclut l'écart de peg). */
  serieBrute: PointPremium[];
  /** Premium peg neutralisé (jambe Binance convertie par USDT/USD Kraken) ; `[]` si indisponible. */
  serieAjustee: PointPremium[];
  /** Écart de peg `(k − 1) × 100` au dernier point aligné, null si ajustée indisponible. */
  ecartPegPct: number | null;
  /** Note discrète quand l'ajustement est indisponible et que la brute est affichée à sa place. */
  noteAjustement: string | null;
  setBase: (b: "BTC" | "ETH") => void;
  /** Bascule `serie`/`stats` entre ajustée et brute SANS refetch (ignoré si ajustée indisponible). */
  setMode: (m: ModeCbprem) => void;
  run: () => Promise<void>;
}

/** Identifiant du run courant : les résultats d'un run périmé (double clic / setBase) sont ignorés. */
let currentRunId = 0;

export const cbpremStore = createStore<CbpremState>((set, get) => ({
  base: "BTC",
  enCours: false,
  serie: [],
  stats: null,
  erreur: null,
  majTs: null,
  mode: "ajuste",
  serieBrute: [],
  serieAjustee: [],
  ecartPegPct: null,
  noteAjustement: null,

  setBase: (b) => {
    set({ base: b });
    void get().run(); // relance le run sur la nouvelle base (garde currentRunId périme l'ancien)
  },

  setMode: (m) => {
    const { mode, serieAjustee, serieBrute } = get();
    if (m === mode) return;
    if (m === "ajuste" && serieAjustee.length === 0) return; // ajustée indisponible : reste en brute
    const serie = m === "ajuste" ? serieAjustee : serieBrute;
    set({ mode: m, serie, stats: statsPremium(serie) }); // pur, aucun refetch
  },

  run: async () => {
    const runId = ++currentRunId;
    // On ne remet PAS `erreur` à null ici : un bandeau reste visible pendant le retry et
    // n'est effacé qu'au succès (ci-dessous) — pas de clignotement, série préservée.
    set({ enCours: true });

    const { bn, cb } = SYMBOLES[get().base];

    let klinesBn: Candle[];
    let klinesCb: Candle[];
    let klinesUsdt: Candle[] | null;
    try {
      // Binance : max 1000/appel → 720 en un seul fetch. Coinbase : paginé (≤ 350/appel).
      // Kraken USDT/USD en parallèle, mais `fetchUsdtUsd1h` ne rejette jamais : ce `catch`
      // ne concerne QUE Coinbase/Binance.
      [klinesBn, klinesCb, klinesUsdt] = await Promise.all([
        binanceAdapter.fetchKlines(bn, TF, { limit: CIBLE_BOUGIES }),
        fetchCoinbase1h(cb, CIBLE_BOUGIES),
        fetchUsdtUsd1h(),
      ]);
    } catch {
      if (runId !== currentRunId) return;
      // Wording honnête au PREMIER échec (aucune série encore affichée) : rien n'est
      // « conservé », on n'annonce donc pas un premium précédent inexistant.
      const aDeja = get().serie.length > 0;
      set({
        enCours: false,
        erreur: aDeja
          ? "Klines indisponibles (Coinbase ou Binance) — dernier premium conservé."
          : "Klines indisponibles (Coinbase ou Binance).",
      });
      return;
    }
    if (runId !== currentRunId) return;

    // Écarte la bougie en formation de chaque source AVANT l'alignement, puis calculs purs.
    const cbClos = versPointsClos(klinesCb);
    const bnClos = versPointsClos(klinesBn);
    const usdtClos = klinesUsdt === null ? [] : versPointsClos(klinesUsdt);
    const serieBrute = serieCbprem(cbClos, bnClos);
    // Sous-ensemble de la brute (mêmes gardes + k valide) : vide dès que la brute l'est.
    const serieAjustee = serieCbpremAjustee(cbClos, bnClos, usdtClos);

    if (serieBrute.length === 0 && get().serie.length > 0) {
      // Garde 200-vide : un succès HTTP à série vide n'écrase PAS une série valide déjà
      // affichée (violerait l'invariant erreur non destructive) — on conserve l'existant.
      set({ enCours: false, erreur: "Réponse vide des venues — courbe précédente conservée." });
      return;
    }

    // Mode affiché : « brute » FORCÉ si l'ajustée manque ; sinon « ajuste » (défaut), SAUF si
    // l'utilisateur avait CHOISI la brute. Le choix se reconnaît STRUCTURELLEMENT — brute
    // affichée alors qu'une ajustée existait pour en basculer — et non par la note (qui a sa
    // propre condition d'affichage : un premier run vide laisse un brute forcé SANS note, qui
    // collerait sinon au run suivant). Un mode imposé par une panne Kraken ou par un run vide
    // ne colle donc pas : on revient au défaut dès que l'ajustement redevient possible.
    const ajusteeDispo = serieAjustee.length > 0;
    const precedent = get();
    const bruteChoisie = precedent.mode === "brute" && precedent.serieAjustee.length > 0;
    const mode: ModeCbprem = !ajusteeDispo || bruteChoisie ? "brute" : "ajuste";
    const serie = mode === "ajuste" ? serieAjustee : serieBrute;

    // Succès : séries/stats mises à jour, `erreur` effacée, fraîcheur horodatée. La note
    // n'est posée que si une brute est effectivement affichée à la place de l'ajustée
    // (sur un premier run vide, « prime brute affichée » serait faux).
    set({
      enCours: false,
      mode,
      serieBrute,
      serieAjustee,
      serie,
      stats: statsPremium(serie),
      ecartPegPct: ajusteeDispo ? ecartPegDernierPoint(serieAjustee, usdtClos) : null,
      noteAjustement: !ajusteeDispo && serieBrute.length > 0 ? NOTE_AJUSTEMENT_INDISPONIBLE : null,
      erreur: null,
      majTs: Date.now(),
    });
  },
}));
