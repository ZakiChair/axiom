/**
 * Profondeur d'historique par place spot : date de la plus ancienne bougie que SON adaptateur
 * sait servir. Sert au routage (la place la plus profonde passe devant). Simple CACHE (mémoire +
 * localStorage 30 j), pas une donnée personnelle : hors sauvegarde locale et daemon.
 */
import type { ExchangeId, Timeframe } from "@axiom/types";
import { getAdapter } from "./adapters";

/** Plafond du buffer marché du graphe au fil des paginations (bougies). */
export const PLAFOND_BOUGIES_GRAPHE = 20_000;

type Profondeur = { debut: number; exact: boolean };
type Mesure = Profondeur | "vide" | undefined;

/**
 * Sonde par place : [unité, bougies par requête, pages]. Binance, Bybit et MEXC servent 1 000
 * bougies par requête ; Kraken ses 720 dernières (endTime ignoré) ; OKX 300 par page ; Coinbase
 * n'a pas de 1w et plafonne à 350 : pages plus anciennes, arrêt sur page VIDE (il omet les
 * bougies sans échange, une page courte ne prouve pas le début).
 */
const SONDES: Partial<Record<ExchangeId, [Timeframe, number, number?]>> = {
  binance: ["1w", 1_000], bybit: ["1w", 1_000], mexc: ["1w", 1_000], kraken: ["1w", 720], okx: ["1w", 300], coinbase: ["1d", 350, 4],
};
/**
 * Bougies 1d par requête : une cotation assez récente pour y tenir voit son lundi hebdomadaire
 * affiné au jour (Binance HYPEUSDT : semaine du 21/09, première bougie le 24/09).
 */
const AFFINAGE: Partial<Record<ExchangeId, number>> = { binance: 1_000, bybit: 1_000, mexc: 1_000, kraken: 720, okx: 300 };
/** Bougies que le graphe obtient au plus : OKX /market/candles (1 440 dernières), Kraken, Hyperliquid. */
const PLAFONDS: Partial<Record<ExchangeId, number>> = { okx: 1_440, kraken: 720, hyperliquid: 5_000 };
const CLE = "axiom:profondeurHistorique:v1";
const TTL = 30 * 86_400_000;
const memoire = new Map<string, { v: Mesure; m: number; exp: number }>();
const enVol = new Map<string, Promise<void>>();
const files = new Map<ExchangeId, { n: number; q: (() => void)[] }>();
const ecouteurs = new Set<() => void>();
let charge = false;

/** Durée d'une bougie ; mois de 30 jours, 3M/6M/12M proportionnels. */
const duree = (tf: Timeframe) => parseInt(tf) * ({ s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5, M: 2592e6 } as Record<string, number>)[tf.slice(-1)]!;

/** `p`, ou `undefined` sur échec ou passé `ms`. */
const borne = <T>(p: Promise<T>, ms: number) => new Promise<T | undefined>((ok) => {
  const t = setTimeout(ok, ms);
  p.then(ok, () => ok(undefined)).finally(() => clearTimeout(t));
});

/** Entrée non expirée ; le stockage est relu une fois, au premier accès. */
function entree(cle: string) {
  if (!charge) {
    charge = true;
    try {
      const brut = JSON.parse(localStorage.getItem(CLE) ?? "null") as { v?: number; e?: Record<string, unknown> } | null;
      if (brut?.v === 1) for (const [k, x] of Object.entries(brut.e ?? {})) {
        if (Array.isArray(x) && typeof x[0] === "number" && typeof x[2] === "number") memoire.set(k, { v: { debut: x[0], exact: x[1] === 1 }, m: x[2], exp: x[2] + TTL });
      }
    } catch { /* stockage indisponible ou corrompu : mémoire seule */ }
  }
  const x = memoire.get(cle);
  return x && x.exp > Date.now() ? x : undefined;
}

/** Mémorise une mesure : 30 j (persistée, 1 000 plus récentes), « vide » 10 min, échec 60 s. */
function poser(cle: string, v: Mesure) {
  const m = Date.now();
  memoire.set(cle, { v, m, exp: m + (v === undefined ? 60_000 : v === "vide" ? 600_000 : TTL) });
  if (v && v !== "vide") try {
    const e: Record<string, [number, number, number]> = {};
    for (const [k, x] of [...memoire].filter(([, x]) => typeof x.v === "object" && x.exp > m).sort((a, b) => b[1].m - a[1].m).slice(0, 1_000)) {
      const p = x.v as Profondeur;
      e[k] = [p.debut, +p.exact, x.m];
    }
    localStorage.setItem(CLE, JSON.stringify({ v: 1, e }));
  } catch { /* quota ou stockage bloqué : mémoire seule */ }
  for (const f of [...ecouteurs]) try { f(); } catch { /* une vue défaillante n'arrête pas les autres */ }
}

/** File par place : deux sondes à la fois, une seule chez Kraken et Coinbase. */
async function creneau(exchange: ExchangeId): Promise<() => void> {
  const f = files.get(exchange) ?? { n: 0, q: [] };
  files.set(exchange, f);
  if (f.n < (exchange === "kraken" || exchange === "coinbase" ? 1 : 2)) f.n++;
  else await new Promise<void>((ok) => f.q.push(ok));
  return () => { const suivant = f.q.shift(); if (suivant) suivant(); else f.n--; };
}

async function sonder(exchange: ExchangeId, symbol: string): Promise<Profondeur | "vide"> {
  const [tf, limit, pages = 1] = SONDES[exchange]!;
  let debut = 0;
  for (let page = 0; page < pages; page++) {
    // Page suivante en échec : la borne déjà obtenue reste une mesure prudente.
    const bougies = await getAdapter(exchange).fetchKlines(symbol, tf, page ? { limit, endTime: debut - 1 } : { limit })
      .catch((erreur: unknown) => { if (page) return null; throw erreur; });
    if (!bougies) break;
    const t = bougies[0]?.time;
    if (t === undefined) return page ? { debut, exact: true } : "vide";
    if (!(t > 0)) throw new Error("bougie illisible");
    if (page && t >= debut) break; // page qui ne recule pas : borne
    debut = t;
    if (pages < 2) {
      const exact = bougies.length < limit;
      const jours = AFFINAGE[exchange];
      if (exact && jours && debut > Date.now() - (jours - 8) * 864e5) {
        // Sonde 1d en échec ou pleine : le lundi hebdomadaire reste la mesure.
        const quotidiennes = await getAdapter(exchange).fetchKlines(symbol, "1d", { limit: jours }).catch(() => []);
        const jour = quotidiennes[0]?.time;
        if (jour && jour >= debut && quotidiennes.length < jours) debut = jour;
      }
      return { debut, exact };
    }
  }
  return { debut, exact: false };
}

/** Mesure dédoublonnée en vol ; une sonde muette rend sa place au bout de 15 s (inconnu). */
function mesurer(exchange: ExchangeId, symbol: string): Promise<void> {
  const cle = `${exchange}:${symbol}`;
  let p = enVol.get(cle);
  if (!p) {
    p = creneau(exchange).then(async (liberer) => {
      const v = await borne(sonder(exchange, symbol), 15_000);
      liberer();
      poser(cle, v);
    }).finally(() => enVol.delete(cle));
    enVol.set(cle, p);
  }
  return p;
}

/** Profondeur en cache (TTL respecté) : `undefined` inconnu, "vide" aucune bougie. */
export function lireProfondeur(exchange: ExchangeId, symbol: string): Profondeur | "vide" | undefined {
  return entree(`${exchange}:${symbol}`)?.v;
}

/**
 * Mesure les places mesurables sans entrée valide. Résout au plus tard après `delaiMs` (les
 * mesures continuent en fond et remplissent le cache) ; ne rejette jamais.
 */
export async function mesurerProfondeurs(places: readonly { exchange: ExchangeId; symbol: string }[], delaiMs = 2_500): Promise<void> {
  const mesures = places.filter(({ exchange, symbol }) => SONDES[exchange] && !entree(`${exchange}:${symbol}`))
    .map(({ exchange, symbol }) => mesurer(exchange, symbol));
  if (mesures.length) await borne(Promise.all(mesures), delaiMs);
}

/** Début de l'historique que le graphe peut afficher : `undefined` inconnu, `null` vide. */
export function debutAccessible(exchange: ExchangeId, symbol: string, timeframe: Timeframe, maintenant = Date.now()): number | null | undefined {
  const p = lireProfondeur(exchange, symbol);
  return p === "vide" ? null : p && Math.max(p.debut, maintenant - Math.min(PLAFONDS[exchange] ?? Infinity, PLAFOND_BOUGIES_GRAPHE) * duree(timeframe));
}

/**
 * Écart de début tenu pour équivalent : 5 % de la fenêtre du graphe, borné à 7 jours (grain des
 * sondes hebdomadaires), jamais sous une bougie. En 1m (fenêtre ~13,9 j), 7 jours rendraient
 * équivalente une place qui n'offre que la moitié de l'historique.
 */
export function toleranceProfondeurMs(timeframe: Timeframe): number {
  return Math.max(duree(timeframe), Math.min(6048e5, PLAFOND_BOUGIES_GRAPHE * duree(timeframe) / 20));
}

/** Notifié quand une mesure entre dans le cache. */
export function abonnerProfondeurs(listener: () => void): () => void {
  ecouteurs.add(listener);
  return () => { ecouteurs.delete(listener); };
}
