/**
 * BRIEF — assemblage du « point marché » matinal.
 *
 * POURQUOI ce module : la fenêtre BRIEF ne fait QUE composer, en un seul écran, des
 * sources DÉJÀ intégrées ailleurs dans le terminal (watchlist/tickers Binance, dérivés
 * Coinalyze/Binance, flux ETF SoSoValue, calendrier éco, veille news, DVOL Deribit).
 * Aucune source ni clé nouvelle. On centralise ici les FETCHERS par section — chacun
 * DÉLÈGUE aux modules data existants et se charge indépendamment (l'appelant les combine
 * en Promise.allSettled : une source en panne n'ébrèche pas les autres) — et la fonction
 * PURE `briefEnMarkdown`, testable sans DOM, qui sérialise l'instantané pour l'export
 * « → Notes ». Les seules fonctions à effet de bord sont les `fetch*` ; le reste est pur.
 */
import { fetchOpenInterestHist } from "./binanceFutures";
import { coinalyzeProvider, fetchPredictedFundingRate } from "./coinalyze";
import { fetchEtfFlows, type ActifEtf } from "./onchain/etf";
import { chargerEvenementsEco, type EcoEvent } from "./eco";
import { fetchDvol } from "./deribit";
import { fetchFearGreed, type FearGreed } from "./marketOverview";
import { fetchToutesLesNews, type NewsItem } from "./news";
import { resolveTickerSource } from "./ticker";
import { watchlistStore } from "../store/watchlist";
import { getSoSoValueKey } from "../store/sosovalue";
import {
  formatAge,
  formatDateComplete,
  formatDelai,
  formatHeureMinute,
  formatPct,
  formatPourcentage,
  formatPrice,
  formatUsd,
  VALEUR_ABSENTE,
} from "../lib/format";

// ─────────────────────────── Types des sections ───────────────────────────

/** Ligne « overnight » de la watchlist : dernier prix + variation 24 h (Binance REST). */
export interface LigneWatchlist {
  symbole: string;
  /** Dernier prix, ou null si la source ne couvre pas ce symbole. */
  prix: number | null;
  /** Variation 24 h en %, ou null. */
  variation24h: number | null;
}

/** Ligne dérivés d'un actif majeur (funding + prochain règlement + ΔOI 24 h). */
export interface LigneDeriv {
  /** Code court affiché (« BTC », « ETH », « SOL »). */
  symbole: string;
  /** Funding courant, en FRACTION (convention interne, ×100 à l'affichage), ou null. */
  fundingActuel: number | null;
  /** Funding prédit du prochain règlement, en fraction, ou null. */
  fundingPredit: number | null;
  /** Horodatage ms du prochain règlement estimé, ou null. */
  prochainReglement: number | null;
  /** Variation d'Open Interest sur ~24 h, en %, ou null. */
  deltaOiPct: number | null;
}

/** Flux ETF quotidien d'un actif (veille), agrégé tous émetteurs. */
export interface EtfBrief {
  actif: ActifEtf;
  disponible: boolean;
  /** Flux net total du jour en USD (positif = entrées), ou null si indisponible. */
  total: number | null;
  /** Jour de référence SoSoValue (« YYYY-MM-DD »), ou null. */
  jour: string | null;
  /** Raison d'indisponibilité éventuelle (clé absente, 5xx…). */
  raison?: string;
}

/** Évènement éco du jour à fort impact (heure + libellé + provenance approximée). */
export interface EvenementBrief {
  time: number;
  pays: string;
  titre: string;
  /** Vrai quand l'heure est approximée (FRED/FOMC ne donnent qu'une date). */
  timeApprox: boolean;
}

/** Titre d'actualité condensé pour le brief. */
export interface TitreNews {
  id: string;
  titre: string;
  source: string;
  time: number;
}

/** Point DVOL (indice de volatilité implicite Deribit) d'une devise. */
export interface DvolBrief {
  devise: "BTC" | "ETH";
  /** Valeur DVOL (en points de %), ou null si indisponible. */
  valeur: number | null;
}

/**
 * Instantané complet du brief passé à `briefEnMarkdown`. `null` = section absente/en
 * échec (la fonction markdown tolère chaque section manquante indépendamment).
 */
export interface DonneesBrief {
  watchlist: LigneWatchlist[] | null;
  derivs: LigneDeriv[] | null;
  etf: EtfBrief[] | null;
  eco: EvenementBrief[] | null;
  news: TitreNews[] | null;
  fearGreed: FearGreed | null;
  dvol: DvolBrief[] | null;
}

// ─────────────────────────── Fonctions PURES (testées) ───────────────────────────

/**
 * Variation d'Open Interest en % du PREMIER au DERNIER point d'un historique
 * (chronologique). Renvoie null si moins de 2 points ou base nulle/non finie. PURE.
 */
export function deltaOiPct(points: readonly { oiUsd: number }[]): number | null {
  const premier = points[0];
  const dernier = points[points.length - 1];
  if (premier === undefined || dernier === undefined || premier === dernier) return null;
  if (!Number.isFinite(premier.oiUsd) || premier.oiUsd <= 0 || !Number.isFinite(dernier.oiUsd)) return null;
  return ((dernier.oiUsd - premier.oiUsd) / premier.oiUsd) * 100;
}

/**
 * Ne retient que les évènements éco à FORT impact tombant le MÊME jour calendaire
 * (heure locale) que `now`, triés chronologiquement. `now` injecté → fonction PURE.
 */
export function evenementsDuJour(events: readonly EcoEvent[], now: number): EvenementBrief[] {
  const ref = new Date(now);
  const out: EvenementBrief[] = [];
  for (const e of events) {
    if (e.impact !== "high") continue;
    const d = new Date(e.time);
    if (
      d.getFullYear() !== ref.getFullYear() ||
      d.getMonth() !== ref.getMonth() ||
      d.getDate() !== ref.getDate()
    ) {
      continue;
    }
    out.push({ time: e.time, pays: e.country, titre: e.title, timeApprox: e.timeApprox ?? false });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

/** Les 5 titres les plus récents (tri décroissant sur `time`), condensés. PURE. */
export function top5News(items: readonly NewsItem[]): TitreNews[] {
  return items
    .slice()
    .sort((a, b) => b.time - a.time)
    .slice(0, 5)
    .map((it) => ({ id: it.id, titre: it.title, source: it.source, time: it.time }));
}

/** Funding (fraction) → pourcentage signé 4 décimales (convention DERIV), ou « — ». */
function fmtFunding(rate: number | null): string {
  return rate === null ? VALEUR_ABSENTE : formatPct(rate * 100, 4);
}

/**
 * Sérialise l'instantané en markdown court (l'export « → Notes »). Tolère chaque
 * section absente (null) indépendamment. `now` injecté → fonction PURE.
 */
export function briefEnMarkdown(d: DonneesBrief, now: number): string {
  const l: string[] = [];
  l.push(`# BRIEF — Point marché · ${formatDateComplete(now)} ${formatHeureMinute(now)}`);
  l.push("");

  l.push("## Watchlist (overnight)");
  if (d.watchlist === null) l.push("_Section indisponible._");
  else if (d.watchlist.length === 0) l.push("_Aucun symbole dans la watchlist._");
  else for (const w of d.watchlist) l.push(`- ${w.symbole} · ${formatPrice(w.prix)} · ${formatPct(w.variation24h)}`);
  l.push("");

  l.push("## Dérivés");
  if (d.derivs === null) {
    l.push("_Section indisponible._");
  } else {
    for (const r of d.derivs) {
      const prochain = r.prochainReglement === null ? VALEUR_ABSENTE : formatDelai(r.prochainReglement, now);
      const oi = r.deltaOiPct === null ? VALEUR_ABSENTE : formatPct(r.deltaOiPct);
      l.push(
        `- ${r.symbole} · funding ${fmtFunding(r.fundingActuel)} · prédit ${fmtFunding(r.fundingPredit)} · ` +
          `prochain règlement ${prochain} · ΔOI 24 h ${oi}`,
      );
    }
  }
  l.push("");

  l.push("## Flux ETF (veille)");
  if (d.etf === null) {
    l.push("_Section indisponible._");
  } else {
    for (const e of d.etf) {
      if (e.disponible && e.total !== null) {
        l.push(`- ${e.actif.toUpperCase()} · ${formatUsd(e.total)}${e.jour !== null ? ` (${e.jour})` : ""}`);
      } else {
        l.push(`- ${e.actif.toUpperCase()} · indisponible`);
      }
    }
  }
  l.push("");

  l.push("## Événements éco du jour (fort impact)");
  if (d.eco === null) l.push("_Section indisponible._");
  else if (d.eco.length === 0) l.push("_Aucun événement à fort impact aujourd'hui._");
  else
    for (const ev of d.eco) {
      const heure = `${ev.timeApprox ? "~" : ""}${formatHeureMinute(ev.time)}`;
      // Un évènement déjà écoulé du jour n'est pas « imminent » : on le marque « passé ».
      const delai = ev.time <= now ? "passé" : formatDelai(ev.time, now);
      l.push(`- ${heure} · ${ev.pays} · ${ev.titre} · ${delai}`);
    }
  l.push("");

  l.push("## Actualités");
  if (d.fearGreed !== null) {
    const cls = d.fearGreed.classification ? ` (${d.fearGreed.classification})` : "";
    l.push(`Fear & Greed : ${d.fearGreed.value}${cls}`);
  }
  if (d.news === null) l.push("_Section indisponible._");
  else if (d.news.length === 0) l.push("_Aucune actualité._");
  else for (const n of d.news) l.push(`- ${n.source} · ${formatAge(n.time, now)} — ${n.titre}`);
  l.push("");

  l.push("## Volatilité (DVOL)");
  if (d.dvol === null) l.push("_Section indisponible._");
  else for (const v of d.dvol) l.push(`- ${v.devise} · ${v.valeur === null ? VALEUR_ABSENTE : formatPourcentage(v.valeur, 1)}`);
  l.push("");

  l.push("_Sources : Binance, Coinalyze, SoSoValue, ForexFactory/FRED, flux news, Deribit._");
  return l.join("\n");
}

// ─────────────────────────── Fetchers par section (effet de bord) ───────────────────────────

/** Ticker 24 h REST Binance (même donnée que la watchlist, sans ouvrir de flux WS). */
const BINANCE_TICKER_24H = "https://api.binance.com/api/v3/ticker/24hr";

/** Forme brute (partielle) d'une entrée /ticker/24hr. */
interface RawTicker24h {
  symbol?: string;
  lastPrice?: string;
  priceChangePercent?: string;
}

/**
 * Construit une ligne watchlist depuis l'entrée ticker (ou son absence). PURE : un
 * ticker absent — symbole non couvert ou en échec du repli par symbole — ou aux champs
 * non numériques donne prix/variation à null (affichés « — »).
 */
export function ligneDepuisTicker(symbole: string, t: RawTicker24h | undefined): LigneWatchlist {
  const prix = t !== undefined ? Number(t.lastPrice) : NaN;
  const variation = t !== undefined ? Number(t.priceChangePercent) : NaN;
  return {
    symbole,
    prix: Number.isFinite(prix) ? prix : null,
    variation24h: Number.isFinite(variation) ? variation : null,
  };
}

/**
 * Prix + variation 24 h « overnight » des symboles de la watchlist, via UN SEUL appel
 * REST Binance /ticker/24hr (pas de flux WS : le brief est un instantané). Seul le
 * sous-ensemble routé Binance est requêté (source résolue comme le ticker de la
 * watchlist) ; les symboles non couverts restent à null (« — »).
 */
export async function fetchWatchlistOvernight(
  symboles: readonly string[],
  signal?: AbortSignal,
): Promise<LigneWatchlist[]> {
  const sources = watchlistStore.getState().sources;
  // Un « / » casserait le filtre symbols de l'API (comme le stream ticker) → écarté.
  const binance = symboles.filter(
    (s) => resolveTickerSource(s, sources[s]) === "binance" && !s.includes("/"),
  );
  const parSymbole = new Map<string, RawTicker24h>();
  if (binance.length > 0) {
    try {
      const url = `${BINANCE_TICKER_24H}?symbols=${encodeURIComponent(JSON.stringify(binance))}`;
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`Binance ticker24h ${res.status}`);
      const json = (await res.json()) as RawTicker24h[];
      for (const t of json) if (typeof t.symbol === "string") parSymbole.set(t.symbol, t);
    } catch (err) {
      // Le batch échoue EN BLOC si un seul symbole est invalide. L'annulation reste propagée ;
      // sinon on replie sur des requêtes par symbole (watchlist petite) — chaque symbole en
      // échec reste absent de la map, donc affiché « — » plutôt que d'ébrécher la section.
      if (signal?.aborted) throw err;
      const repli = await Promise.allSettled(
        binance.map(async (s) => {
          const res = await fetch(`${BINANCE_TICKER_24H}?symbol=${encodeURIComponent(s)}`, { signal });
          if (!res.ok) throw new Error(`Binance ticker24h ${s} ${res.status}`);
          return (await res.json()) as RawTicker24h;
        }),
      );
      for (const r of repli) {
        if (r.status === "fulfilled" && typeof r.value.symbol === "string") {
          parSymbole.set(r.value.symbol, r.value);
        }
      }
    }
  }
  return symboles.map((s) => ligneDepuisTicker(s, parSymbole.get(s)));
}

/** Actifs majeurs suivis par la section dérivés (code court ↔ paire perpétuelle). */
const SYMBOLES_DERIVES: readonly { code: string; paire: string }[] = [
  { code: "BTC", paire: "BTCUSDT" },
  { code: "ETH", paire: "ETHUSDT" },
  { code: "SOL", paire: "SOLUSDT" },
];
/** Historique OI pour le ΔOI 24 h : 25 pts horaires ≈ 24 h (Binance fapi, sans clé). */
const OI_PERIOD = "1h" as const;
const OI_LIMIT = 25;

/**
 * Funding courant + prédit (Coinalyze, mêmes fonctions que DERIV) et ΔOI 24 h (Binance
 * fapi, sans clé) pour BTC/ETH/SOL. Chaque actif tolère l'échec partiel d'une source
 * (Promise.allSettled) : un champ manquant reste null, jamais d'exception propagée.
 */
export async function fetchDerivsBrief(): Promise<LigneDeriv[]> {
  return Promise.all(
    SYMBOLES_DERIVES.map(async ({ code, paire }) => {
      const [fundingR, preditR, oiR] = await Promise.allSettled([
        coinalyzeProvider.fetchFundingRate(paire),
        fetchPredictedFundingRate(paire),
        fetchOpenInterestHist(paire, OI_PERIOD, OI_LIMIT),
      ]);
      const fundingActuel =
        fundingR.status === "fulfilled" && Number.isFinite(fundingR.value.rate) ? fundingR.value.rate : null;
      const fundingPredit =
        preditR.status === "fulfilled" && Number.isFinite(preditR.value.rate) ? preditR.value.rate : null;
      const prochainReglement =
        preditR.status === "fulfilled" && preditR.value.nextFundingTime > 0 ? preditR.value.nextFundingTime : null;
      const deltaOi = oiR.status === "fulfilled" ? deltaOiPct(oiR.value) : null;
      return { symbole: code, fundingActuel, fundingPredit, prochainReglement, deltaOiPct: deltaOi };
    }),
  );
}

/** Actifs ETF spot couverts par SoSoValue. */
const ACTIFS_ETF: readonly ActifEtf[] = ["btc", "eth", "sol"];

/**
 * Flux ETF quotidiens BTC/ETH/SOL (SoSoValue). Réutilise la clé personnelle des Réglages
 * si saisie, sinon le proxy /sosoapi injecte la clé de repli. `fetchEtfFlows` dégrade
 * gracieusement (jamais d'exception) → chaque actif porte son propre `disponible`.
 */
export async function fetchEtfBrief(signal?: AbortSignal): Promise<EtfBrief[]> {
  const cle = getSoSoValueKey();
  const resultats = await Promise.all(ACTIFS_ETF.map((a) => fetchEtfFlows(a, cle, signal)));
  return ACTIFS_ETF.map((actif, i) => {
    const r = resultats[i];
    if (r === undefined || !r.disponible) {
      return { actif, disponible: false, total: null, jour: null, raison: r?.raison };
    }
    return { actif, disponible: true, total: r.total ?? null, jour: r.jour ?? null };
  });
}

/**
 * Évènements éco du jour à fort impact (calendrier fusionné ForexFactory/FRED/FOMC).
 * `chargerEvenementsEco` dégrade gracieusement (cache + FOMC statique) → jamais d'erreur.
 */
export async function fetchEcoBrief(now: number, signal?: AbortSignal): Promise<EvenementBrief[]> {
  const { events } = await chargerEvenementsEco({ signal });
  return evenementsDuJour(events, now);
}

/**
 * Les 5 actualités les plus récentes (mêmes flux que NewsWindow via `fetchToutesLesNews`).
 * Lève si TOUS les flux sont hors ligne (la section affiche alors une erreur explicite).
 */
export async function fetchNewsBrief(signal?: AbortSignal): Promise<TitreNews[]> {
  const { items, toutEnErreur } = await fetchToutesLesNews(signal);
  if (toutEnErreur) throw new Error("Flux d'actualités hors ligne");
  return top5News(items);
}

/** Devises cotées en DVOL par Deribit. */
const DEVISES_DVOL: readonly ("BTC" | "ETH")[] = ["BTC", "ETH"];

/**
 * DVOL BTC/ETH (source Deribit de VolWindow). `fetchDvol` échoue silencieusement (null) →
 * cette fonction ne lève jamais : chaque devise porte sa valeur ou null.
 */
export async function fetchDvolBrief(): Promise<DvolBrief[]> {
  const valeurs = await Promise.all(DEVISES_DVOL.map((d) => fetchDvol(d)));
  return DEVISES_DVOL.map((devise, i) => ({ devise, valeur: valeurs[i] ?? null }));
}

// Ré-export pour l'appelant (la section Fear & Greed partage la source de NewsWindow).
export { fetchFearGreed };
export type { FearGreed };
