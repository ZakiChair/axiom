/**
 * BRIEF — assemblage du « point marché » (ouverture + review de session soir).
 *
 * POURQUOI ce module : la fenêtre BRIEF ne fait QUE composer, en un seul écran, des
 * sources DÉJÀ intégrées ailleurs dans le terminal (watchlist/tickers Binance, dérivés
 * Coinalyze/Binance, flux ETF SoSoValue, calendrier éco, veille news, DVOL Deribit) plus
 * la review de session locale (trades clos du portefeuille, journal d'alertes, éco
 * passés). Aucune source ni clé nouvelle. On centralise ici les FETCHERS par section —
 * chacun DÉLÈGUE aux modules data existants et se charge indépendamment (l'appelant les
 * combine en Promise.allSettled : une source en panne n'ébrèche pas les autres) — les
 * assembleurs PURES de session (`assemblerSession`, …) et la fonction PURE
 * `briefEnMarkdown`, testable sans DOM, qui sérialise l'instantané pour l'export
 * « → Notes ». Les seules fonctions à effet de bord sont les `fetch*` ; le reste est pur.
 */
import type { Declenchement } from "@axiom/alerts";
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
  debutJourLocalMs,
  pnlRealisePosition,
  type Direction,
  type Position,
} from "../store/portfolio";
import {
  formatAge,
  formatDateComplete,
  formatDelai,
  formatFunding,
  formatHeureMinute,
  formatPct,
  formatPourcentage,
  formatPrice,
  formatUsd,
  formatUsdSigne,
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

/** Trade clôturé du jour civil local (review de session). */
export interface TradeClosBrief {
  symbole: string;
  direction: Direction;
  /** PnL net réalisé (devise de cotation). */
  pnlNet: number;
  /** Rendement net en % du notionnel d'entrée. */
  pnlPct: number;
  dateSortie: number;
  prixEntree: number;
  prixSortie: number;
}

/** Déclenchement d'alerte du jour civil local. */
export interface AlerteDeclencheeBrief {
  alertId: string;
  ts: number;
  message: string;
  valeur: number;
}

/**
 * Review de session (soir) : trades clos, PnL réalisé, alertes, éco passés.
 * Assemblée localement (portfolio + journal alertes + calendrier déjà chargé).
 */
export interface SessionBrief {
  tradesClos: TradeClosBrief[];
  /** Somme des PnL nets des clôtures du jour. */
  pnlRealise: number;
  gagnants: number;
  perdants: number;
  alertes: AlerteDeclencheeBrief[];
  /**
   * Évènements éco fort impact du jour déjà écoulés.
   * `null` = calendrier éco indisponible (section absente).
   */
  ecoPasses: EvenementBrief[] | null;
}

/**
 * Instantané complet du brief passé à `briefEnMarkdown`. `null` = section absente/en
 * échec (la fonction markdown tolère chaque section manquante indépendamment).
 */
export interface DonneesBrief {
  /** Review de session (local) — absente seulement si non assemblée. */
  session: SessionBrief | null;
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

/**
 * Positions clôturées dont `dateSortie` tombe le jour civil local de `now`, triées
 * chronologiquement. Ignore les clôtures sans PnL calculable. PURE.
 */
export function tradesClosDuJour(positions: readonly Position[], now: number): TradeClosBrief[] {
  const debut = debutJourLocalMs(now);
  const out: TradeClosBrief[] = [];
  for (const p of positions) {
    if (p.statut !== "clos") continue;
    const sortie = p.dateSortie;
    if (sortie === undefined || sortie < debut) continue;
    // Hors du jour civil (horloge injectée) — évite d'inclure un futur saisi à la main.
    if (sortie > now) continue;
    const pnl = pnlRealisePosition(p);
    if (pnl === null || p.prixSortie === undefined) continue;
    out.push({
      symbole: p.symbole,
      direction: p.direction,
      pnlNet: pnl.net,
      pnlPct: pnl.pct,
      dateSortie: sortie,
      prixEntree: p.prixEntree,
      prixSortie: p.prixSortie,
    });
  }
  out.sort((a, b) => a.dateSortie - b.dateSortie);
  return out;
}

/**
 * Entrées du journal d'alertes dont `ts` tombe le jour civil local de `now`, triées
 * chronologiquement (le journal store est plus-récent-en-tête). PURE.
 */
export function alertesDeclencheesDuJour(
  journal: readonly Declenchement[],
  now: number,
): AlerteDeclencheeBrief[] {
  const debut = debutJourLocalMs(now);
  const out: AlerteDeclencheeBrief[] = [];
  for (const d of journal) {
    if (d.ts < debut || d.ts > now) continue;
    out.push({ alertId: d.alertId, ts: d.ts, message: d.message, valeur: d.valeur });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

/** Évènements éco déjà écoulés à `now` (time ≤ now), ordre inchangé. PURE. */
export function evenementsEcoPasses(
  events: readonly EvenementBrief[],
  now: number,
): EvenementBrief[] {
  return events.filter((e) => e.time <= now);
}

/**
 * Assemble la section Session depuis le portefeuille, le journal d'alertes et les
 * évènements éco du jour (déjà filtrés fort impact). `eco === null` → calendrier
 * indisponible (ecoPasses null). PURE.
 */
export function assemblerSession(
  positions: readonly Position[],
  journal: readonly Declenchement[],
  eco: readonly EvenementBrief[] | null,
  now: number,
): SessionBrief {
  const tradesClos = tradesClosDuJour(positions, now);
  let pnlRealise = 0;
  let gagnants = 0;
  let perdants = 0;
  for (const t of tradesClos) {
    pnlRealise += t.pnlNet;
    if (t.pnlNet > 0) gagnants += 1;
    else if (t.pnlNet < 0) perdants += 1;
  }
  return {
    tradesClos,
    pnlRealise,
    gagnants,
    perdants,
    alertes: alertesDeclencheesDuJour(journal, now),
    ecoPasses: eco === null ? null : evenementsEcoPasses(eco, now),
  };
}

/**
 * Sérialise l'instantané en markdown court (l'export « → Notes »). Tolère chaque
 * section absente (null) indépendamment. `now` injecté → fonction PURE.
 */
export function briefEnMarkdown(
  d: DonneesBrief,
  now: number,
  lecture?: readonly string[],
): string {
  const l: string[] = [];
  l.push(`# BRIEF — Point marché · ${formatDateComplete(now)} ${formatHeureMinute(now)}`);
  l.push("");

  // Lecture générée (chapeau) — en tête, avant les sections factuelles.
  if (lecture !== undefined && lecture.length > 0) {
    l.push("## Lecture");
    l.push("");
    for (const phrase of lecture) l.push(`- ${phrase}`);
    l.push("");
  }

  l.push("## Session (review)");
  if (d.session === null) {
    l.push("_Section indisponible._");
  } else {
    const s = d.session;
    const n = s.tradesClos.length;
    l.push(
      `**PnL réalisé** ${formatUsdSigne(s.pnlRealise)} · ${n} trade${n === 1 ? "" : "s"} · ` +
        `${s.gagnants} gagnant${s.gagnants === 1 ? "" : "s"} / ${s.perdants} perdant${s.perdants === 1 ? "" : "s"}`,
    );
    l.push("");
    l.push("### Trades clos");
    if (s.tradesClos.length === 0) l.push("_Aucun trade clôturé aujourd'hui._");
    else
      for (const t of s.tradesClos) {
        l.push(
          `- ${formatHeureMinute(t.dateSortie)} · ${t.symbole} ${t.direction} · ` +
            `${formatUsdSigne(t.pnlNet)} (${formatPct(t.pnlPct)}) · ` +
            `${formatPrice(t.prixEntree)} → ${formatPrice(t.prixSortie)}`,
        );
      }
    l.push("");
    l.push("### Alertes déclenchées");
    if (s.alertes.length === 0) l.push("_Aucune alerte déclenchée aujourd'hui._");
    else
      for (const a of s.alertes) {
        const val = Number.isFinite(a.valeur)
          ? a.valeur.toLocaleString("en-US", { maximumFractionDigits: 6 })
          : VALEUR_ABSENTE;
        l.push(`- ${formatHeureMinute(a.ts)} · ${a.message} · valeur ${val}`);
      }
    l.push("");
    l.push("### Événements éco passés");
    if (s.ecoPasses === null) l.push("_Calendrier éco indisponible._");
    else if (s.ecoPasses.length === 0) l.push("_Aucun événement à fort impact écoulé aujourd'hui._");
    else
      for (const ev of s.ecoPasses) {
        const heure = `${ev.timeApprox ? "~" : ""}${formatHeureMinute(ev.time)}`;
        l.push(`- ${heure} · ${ev.pays} · ${ev.titre}`);
      }
  }
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
        `- ${r.symbole} · funding ${formatFunding(r.fundingActuel)} · prédit ${formatFunding(r.fundingPredit)} · ` +
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
