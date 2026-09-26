/**
 * Profondeur d'historique par place spot : date de la plus ancienne bougie que SON adaptateur
 * sait servir. Sert au routage (la place la plus profonde passe devant). Simple CACHE (mémoire +
 * localStorage 25 à 35 j), pas une donnée personnelle : non recopié par le daemon ; inclus dans
 * l'export JSON comme les autres caches (eco, cot).
 */
import type { ExchangeId, Timeframe } from "@axiom/types";
import { getAdapter } from "./adapters";

/** Plafond du buffer marché du graphe au fil des paginations (bougies). */
export const PLAFOND_BOUGIES_GRAPHE = 20_000;

/** Demandeur d'une mesure : chaque place sert le graphe, puis les favoris, puis la recherche. */
export type PrioriteMesure = "graphe" | "favoris" | "recherche";

type Profondeur = { debut: number; exact: boolean };
type Mesure = Profondeur | "vide" | undefined;

const JOUR = 864e5;
const SEMAINE = 7 * JOUR;

/**
 * Sonde par place : [unité, bougies par requête, pages]. Binance, Bybit et MEXC servent 1 000
 * bougies par requête ; Kraken ses 720 dernières (endTime ignoré) ; OKX 300 mois (25 ans) ;
 * Coinbase n'a pas de 1w et plafonne à 350 : pages plus anciennes, arrêt sur page VIDE (il omet
 * les bougies sans échange, une page courte ne prouve pas le début).
 */
const SONDES: Partial<Record<ExchangeId, [Timeframe, number, number?]>> = {
  binance: ["1w", 1_000], bybit: ["1w", 1_000], mexc: ["1w", 1_000], kraken: ["1w", 720], okx: ["1M", 300], coinbase: ["1d", 350, 4],
};
/**
 * Bougies 1d par requête : une cotation assez récente pour y tenir voit son lundi hebdomadaire
 * (ou son 1er du mois) affiné au jour (Binance HYPEUSDT : semaine du 21/09, première bougie le 24/09).
 */
const AFFINAGE: Partial<Record<ExchangeId, number>> = { binance: 1_000, bybit: 1_000, mexc: 1_000, kraken: 720, okx: 300 };
/**
 * Bougies que le graphe obtient au plus : OKX /market/candles (1 440 dernières), Kraken (backfill
 * de 500, sans pagination : endTime ignoré). Hyperliquid, sans sonde et seul classé pour son perp,
 * n'en a pas besoin.
 */
const PLAFONDS: Partial<Record<ExchangeId, number>> = { okx: 1_440, kraken: 500 };
/** Écart minimal entre deux départs de sonde sur une même place (ms) ; 50 ms ailleurs. */
const ESPACEMENTS: Partial<Record<ExchangeId, number>> = { kraken: 1_000, coinbase: 200, okx: 70 };
const RANGS: Record<PrioriteMesure, number> = { graphe: 0, favoris: 1, recherche: 2 };
const CLE = "axiom:profondeurHistorique:v1";

/** Mesure en file ou en cours, partagée par ses demandeurs. */
interface Sonde {
  exchange: ExchangeId;
  symbol: string;
  /** Appels qui l'attendent encore, avec leur rang : la sonde prend le plus prioritaire. */
  demandeurs: Map<object, number>;
  demarree: boolean;
  /** Verdict (mesure posée, « inconnu » à 15 s, ou retrait) ; ne rejette jamais. */
  verdict: Promise<void>;
  rendre: () => void;
}

const memoire = new Map<string, { v: Mesure; m: number; exp: number }>();
const enVol = new Map<string, Sonde>();
const files = new Map<ExchangeId, { actives: number; depart: number; attente: Sonde[]; reveil: boolean }>();
const ecouteurs = new Set<() => void>();
let charge = false;

/** Durée d'une bougie ; mois de 30 jours, 3M/6M/12M proportionnels. */
const duree = (tf: Timeframe) => parseInt(tf) * ({ s: 1e3, m: 6e4, h: 36e5, d: JOUR, w: SEMAINE, M: 30 * JOUR } as Record<string, number>)[tf.slice(-1)]!;

/**
 * TTL d'une mesure : 25 à 35 j, pseudo-aléa fixe par clé (FNV-1a), pour que les mesures d'une
 * même session n'expirent pas ensemble.
 */
function ttl(cle: string): number {
  let h = 2_166_136_261;
  for (let i = 0; i < cle.length; i++) h = Math.imul(h ^ cle.charCodeAt(i), 16_777_619);
  return (25 + 10 * ((h >>> 0) / 2 ** 32)) * JOUR;
}

/** Entrée non expirée ; le stockage est relu une fois, au premier accès. */
function entree(cle: string) {
  if (!charge) {
    charge = true;
    try {
      const brut = JSON.parse(localStorage.getItem(CLE) ?? "null") as { v?: number; e?: Record<string, unknown> } | null;
      if (brut?.v === 1) for (const [k, x] of Object.entries(brut.e ?? {})) {
        if (Array.isArray(x) && typeof x[0] === "number" && typeof x[2] === "number") memoire.set(k, { v: { debut: x[0], exact: x[1] === 1 }, m: x[2], exp: x[2] + ttl(k) });
      }
    } catch { /* stockage indisponible ou corrompu : mémoire seule */ }
  }
  const x = memoire.get(cle);
  return x && x.exp > Date.now() ? x : undefined;
}

/** Mémorise une mesure : 25 à 35 j (persistée, 1 000 plus récentes), « vide » 24 h, échec 60 s. */
function poser(cle: string, v: Mesure) {
  const m = Date.now();
  memoire.set(cle, { v, m, exp: m + (v === undefined ? 60_000 : v === "vide" ? JOUR : ttl(cle)) });
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
      return { debut: exact ? await affiner(exchange, symbol, tf, debut) : debut, exact };
    }
  }
  return { debut, exact: false };
}

/**
 * Début exact ramené sous le grain de la sonde ; une requête en échec, pleine ou incohérente
 * garde le grain. Cotation récente : sonde 1d. OKX plus ancien : page 1w autour du 1er du mois
 * (un mois peut précéder de 30 j la première bougie, un lundi de 6 j : la tolérance l'absorbe).
 */
async function affiner(exchange: ExchangeId, symbol: string, tf: Timeframe, debut: number): Promise<number> {
  const jours = AFFINAGE[exchange];
  if (jours && debut > Date.now() - (jours - 8) * JOUR) {
    const quotidiennes = await getAdapter(exchange).fetchKlines(symbol, "1d", { limit: jours }).catch(() => []);
    const jour = quotidiennes[0]?.time;
    return jour && jour >= debut && quotidiennes.length < jours ? jour : debut;
  }
  if (tf !== "1M") return debut;
  const semaines = await getAdapter(exchange).fetchKlines(symbol, "1w", { limit: 6, endTime: debut + 5 * SEMAINE }).catch(() => []);
  const lundi = semaines[0]?.time;
  return lundi && lundi > debut - SEMAINE && lundi < debut + 5 * SEMAINE ? Math.max(debut, lundi) : debut;
}

const rang = (s: Sonde) => Math.min(...s.demandeurs.values());

/**
 * Démarre les sondes en attente : deux créneaux par place, départs espacés, la plus prioritaire
 * d'abord puis l'ordre d'arrivée. Favoris et recherche n'en prennent qu'un : le second reste au
 * graphe, qu'une sonde de recherche en cours ne retarde ainsi jamais au-delà de l'espacement (deux
 * requêtes chez une cotation récente affinée au jour, jusqu'à quatre pages chez Coinbase). Chez
 * Kraken et Coinbase, deux requêtes ne sont donc en vol à la fois que si l'une sert le graphe ; les
 * départs restent espacés (1 s, 200 ms), et l'affinage enchaînait déjà deux requêtes sans espacement.
 */
function servir(exchange: ExchangeId): void {
  const f = files.get(exchange)!;
  while (!f.reveil && f.attente.length && f.actives < 2) {
    const i = f.attente.reduce((meilleure, s, j) => rang(s) < rang(f.attente[meilleure]!) ? j : meilleure, 0);
    if (f.actives === 1 && rang(f.attente[i]!) > 0) return;
    const reste = f.depart + (ESPACEMENTS[exchange] ?? 50) - Date.now();
    if (reste > 0) {
      f.reveil = true;
      setTimeout(() => { f.reveil = false; servir(exchange); }, reste);
      return;
    }
    demarrer(f, f.attente.splice(i, 1)[0]!);
  }
}

/**
 * Au-delà de 15 s, verdict « inconnu » pour ses demandeurs ; le créneau reste pris jusqu'à la fin
 * réelle de la requête (affinage compris), dont la réponse tardive entre encore au cache.
 */
function demarrer(f: { actives: number; depart: number }, s: Sonde): void {
  const cle = `${s.exchange}:${s.symbol}`;
  f.actives++;
  f.depart = Date.now();
  s.demarree = true;
  let rendu = false;
  const t = setTimeout(() => { rendu = true; poser(cle, undefined); s.rendre(); }, 15_000);
  void sonder(s.exchange, s.symbol).catch(() => undefined).then((v) => {
    clearTimeout(t);
    if (v !== undefined || !rendu) poser(cle, v);
    s.rendre();
    enVol.delete(cle);
    f.actives--;
    servir(s.exchange);
  });
}

/** Sonde de cette place (nouvelle ou déjà en vol) ; l'appel s'y inscrit à son rang. */
function rejoindre(exchange: ExchangeId, symbol: string, appel: object, r: number): Sonde {
  const cle = `${exchange}:${symbol}`;
  let s = enVol.get(cle);
  if (!s) {
    let rendre!: () => void;
    const verdict = new Promise<void>((ok) => { rendre = ok; });
    s = { exchange, symbol, demandeurs: new Map(), demarree: false, verdict, rendre };
    enVol.set(cle, s);
    const f = files.get(exchange) ?? { actives: 0, depart: -Infinity, attente: [], reveil: false };
    files.set(exchange, f);
    f.attente.push(s);
  }
  s.demandeurs.set(appel, r);
  return s;
}

/** Abandon d'un appel : ses sondes non démarrées que personne d'autre n'attend quittent la file. */
function retirer(appel: object, sondes: readonly Sonde[]): void {
  for (const s of sondes) {
    s.demandeurs.delete(appel);
    const f = files.get(s.exchange)!;
    const i = f.attente.indexOf(s);
    if (s.demarree || s.demandeurs.size || i < 0) continue;
    f.attente.splice(i, 1);
    enVol.delete(`${s.exchange}:${s.symbol}`);
    s.rendre();
  }
}

/** Profondeur en cache (TTL respecté) : `undefined` inconnu, "vide" aucune bougie. */
export function lireProfondeur(exchange: ExchangeId, symbol: string): Profondeur | "vide" | undefined {
  return entree(`${exchange}:${symbol}`)?.v;
}

/**
 * Mesure les places mesurables sans entrée valide, servies par place selon `priorite` (une sonde
 * déjà en file est promue par un demandeur plus prioritaire). Résout au plus tard après `delaiMs`
 * (les mesures continuent en fond et remplissent le cache), dès que `assez()` vaut vrai (évalué
 * d'emblée — aucune sonde alors — puis à chaque mesure entrée au cache), ou aussitôt à l'abandon
 * de `signal`, qui retire, même après la résolution, les sondes non démarrées de cet appel
 * qu'aucun autre demandeur n'attend. Ne rejette jamais.
 */
export function mesurerProfondeurs(
  places: readonly { exchange: ExchangeId; symbol: string }[],
  delaiMs = 2_500,
  options: { priorite?: PrioriteMesure; signal?: AbortSignal; assez?: () => boolean } = {},
): Promise<void> {
  const { priorite = "graphe", signal, assez } = options;
  const suffit = () => { try { return !!assez?.(); } catch { return false; } };
  const aMesurer = places.filter(({ exchange, symbol }) => SONDES[exchange] && !entree(`${exchange}:${symbol}`));
  if (!aMesurer.length || signal?.aborted || suffit()) return Promise.resolve();
  const appel = {};
  const sondes = [...new Set(aMesurer.map(({ exchange, symbol }) => rejoindre(exchange, symbol, appel, RANGS[priorite])))];
  for (const exchange of new Set(sondes.map((s) => s.exchange))) servir(exchange);
  return new Promise<void>((fin) => {
    let desabonner = () => {};
    const terminer = () => { clearTimeout(t); desabonner(); fin(); };
    const t = setTimeout(terminer, delaiMs);
    if (assez) desabonner = abonnerProfondeurs(() => { if (suffit()) terminer(); });
    const abandon = () => { retirer(appel, sondes); terminer(); };
    signal?.addEventListener("abort", abandon, { once: true });
    void Promise.all(sondes.map((s) => s.verdict)).then(() => { signal?.removeEventListener("abort", abandon); terminer(); });
  });
}

/** Début le plus ancien que le graphe peut afficher sur cette place : maintenant − min(plafond, 20 000) bougies. */
export function plancherAccessible(exchange: ExchangeId, timeframe: Timeframe, maintenant = Date.now()): number {
  return maintenant - Math.min(PLAFONDS[exchange] ?? Infinity, PLAFOND_BOUGIES_GRAPHE) * duree(timeframe);
}

/**
 * Début de l'historique que le graphe peut afficher, ramené au plancher : `undefined` inconnu,
 * `null` vide. Pour une borne (`exact:false`), c'est le début au plus tard : le réel peut être antérieur.
 */
export function debutAccessible(exchange: ExchangeId, symbol: string, timeframe: Timeframe, maintenant = Date.now()): number | null | undefined {
  const p = lireProfondeur(exchange, symbol);
  return p === "vide" ? null : p && Math.max(p.debut, plancherAccessible(exchange, timeframe, maintenant));
}

/**
 * Écart de début tenu pour équivalent : 5 % de la fenêtre du graphe, borné à 7 jours (grain des
 * sondes hebdomadaires), jamais sous une bougie. En 1m (fenêtre ~13,9 j), 7 jours rendraient
 * équivalente une place qui n'offre que la moitié de l'historique.
 */
export function toleranceProfondeurMs(timeframe: Timeframe): number {
  return Math.max(duree(timeframe), Math.min(SEMAINE, PLAFOND_BOUGIES_GRAPHE * duree(timeframe) / 20));
}

/** Notifié quand une mesure entre dans le cache. */
export function abonnerProfondeurs(listener: () => void): () => void {
  ecouteurs.add(listener);
  return () => { ecouteurs.delete(listener); };
}
