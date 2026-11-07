/**
 * ΔOI d'options par strike et échéance (OMON › Heatmap, métrique « ΔOI ») — SUG-C8, lot 1 du
 * chantier autorisé le 7 novembre 2026.
 *
 * POURQUOI : l'OI seul ne distingue pas un mur ancien d'un positionnement récent. La variation
 * d'OI depuis un instantané daté le fait, strike par strike.
 *
 * INSTANTANÉ : agrégé (échéance, strike, type, OI), pris par devise et par jour UTC au PREMIER
 * chargement réussi de la chaîne après 08:05 UTC (après le règlement Deribit de 08:00), jamais
 * réécrit. localStorage du navigateur, doublé dans le KV du daemon s'il est présent (patron des
 * instantanés J-1/J-7 de TERM). Rétention glissante J-0…J-7 : c'est le minimum pour disposer,
 * chaque jour, d'une référence J-1 et d'une référence J-7 (l'instantané d'aujourd'hui sera la
 * référence J-7 dans une semaine). ≈ 10 Ko par instantané BTC.
 *
 * CALCUL (pur, `nowMs` injecté) :
 *   - Δ = OI courant − OI de référence, par instrument, en contrats Deribit (1 contrat = 1 BTC
 *     ou 1 ETH) et en USD au spot COURANT ;
 *   - échéances expirées à `nowMs` exclues des deux côtés (pas de faux « mur vidé » au règlement) ;
 *   - instrument absent de la référence : Δ = OI entier, marqué « nouveau » (strike ou échéance
 *     listés depuis — piège 2 de l'étude : un strike neuf « naît » de zéro) ;
 *   - instrument de la référence absent de la chaîne courante : non mesuré (jamais 0) ;
 *   - la référence doit être strictement antérieure aux données courantes (causalité).
 *
 * LECTURE : le ΔOI n'est PAS signé. Une hausse d'OI sur un call peut venir d'une vente couverte
 * autant que d'un achat : aucun libellé directionnel. Deribit seul (ni IBIT, ni CME, ni OKX).
 */
import type { OptionPoint } from "./deribit";
import { daemonPret, detectDaemon, kvDelete, kvGet, kvPut, kvSnapshot } from "./daemon";
import { apresHeureInstantane, jourUtc } from "./surfaceConstante";

const MS_JOUR = 86_400_000;

/** Échéance d'un instantané : strikes triés et OI call/put alignés (null = pas d'instrument). */
export interface EcheanceInstantane {
  e: number;
  k: number[];
  c: (number | null)[];
  p: (number | null)[];
}

/** Instantané compact de l'OI d'une chaîne, daté à la réception des données. */
export interface InstantaneOi {
  v: 1;
  /** Instant de réception de la chaîne (ms). */
  t: number;
  /** Jour UTC de `t`. */
  j: string;
  ech: EcheanceInstantane[];
}

const arrondiOi = (oi: number): number => Math.round(oi * 1e4) / 1e4;

/** Instantané agrégé d'une chaîne (échéances postérieures à `t` seulement). PURE. */
export function construireInstantaneOi(chain: readonly OptionPoint[], t: number): InstantaneOi {
  const parEcheance = new Map<number, Map<number, { c: number | null; p: number | null }>>();
  for (const pt of chain) {
    if (!(pt.expiryMs > t) || !Number.isFinite(pt.strike) || !Number.isFinite(pt.openInterest) || pt.openInterest < 0) continue;
    const strikes = parEcheance.get(pt.expiryMs) ?? new Map<number, { c: number | null; p: number | null }>();
    const cur = strikes.get(pt.strike) ?? { c: null, p: null };
    if (pt.type === "call") cur.c = arrondiOi((cur.c ?? 0) + pt.openInterest);
    else cur.p = arrondiOi((cur.p ?? 0) + pt.openInterest);
    strikes.set(pt.strike, cur);
    parEcheance.set(pt.expiryMs, strikes);
  }
  const ech: EcheanceInstantane[] = [];
  for (const e of [...parEcheance.keys()].sort((a, b) => a - b)) {
    const strikes = parEcheance.get(e)!;
    const k = [...strikes.keys()].sort((a, b) => a - b);
    ech.push({ e, k, c: k.map((s) => strikes.get(s)!.c), p: k.map((s) => strikes.get(s)!.p) });
  }
  return { v: 1, t, j: jourUtc(t), ech };
}

/** Valide un instantané lu (localStorage ou KV), ou null. */
export function validerInstantane(brut: unknown): InstantaneOi | null {
  if (typeof brut !== "object" || brut === null) return null;
  const x = brut as Partial<InstantaneOi>;
  if (x.v !== 1 || typeof x.t !== "number" || !Number.isFinite(x.t) || typeof x.j !== "string" || jourUtc(x.t) !== x.j) return null;
  if (!Array.isArray(x.ech)) return null;
  const nombreOuNull = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);
  const ok = x.ech.every(
    (e) =>
      typeof e === "object" && e !== null && typeof e.e === "number" && Number.isFinite(e.e) &&
      Array.isArray(e.k) && Array.isArray(e.c) && Array.isArray(e.p) &&
      e.c.length === e.k.length && e.p.length === e.k.length &&
      e.k.every((s) => typeof s === "number" && Number.isFinite(s)) && e.c.every(nombreOuNull) && e.p.every(nombreOuNull),
  );
  return ok ? (x as InstantaneOi) : null;
}

// ─────────────────────────── Calcul du Δ ───────────────────────────

/** ΔOI d'une cellule (échéance, strike), calls et puts. */
export interface CelluleDeltaOi {
  expiryMs: number;
  strike: number;
  /** Δ du call / du put en contrats ; null = non mesuré (absent d'un côté ou de l'autre). */
  deltaCall: number | null;
  deltaPut: number | null;
  /** Somme des côtés mesurés ; null si aucun. */
  delta: number | null;
  /** `delta` × spot courant ; null sans spot. */
  deltaUsd: number | null;
  /** OI de référence et OI courant des côtés mesurés. */
  oiAvant: number;
  oiApres: number;
  /** Un côté au moins absent de la référence (listé depuis) : Δ = OI entier. */
  nouveau: boolean;
  /** Un côté au moins présent à la référence mais absent de la chaîne courante : non mesuré. */
  absent: boolean;
}

export interface ResultatDeltaOi {
  /** Instant et jour UTC de l'instantané de référence (toujours affichés). */
  refT: number;
  refJour: string;
  cellules: CelluleDeltaOi[];
  /** Plus grand |delta| (échelle de la heatmap). */
  deltaAbsMax: number;
  /** Échéances de la référence expirées depuis, exclues du Δ. */
  echeancesExpirees: number;
}

type Cotes = { c: number | null; p: number | null };

/**
 * ΔOI de la chaîne courante contre un instantané de référence. null si la référence n'est pas
 * strictement antérieure à `nowMs` (causalité). PURE.
 */
export function calculerDeltaOi(
  chain: readonly OptionPoint[],
  ref: InstantaneOi,
  spot: number,
  nowMs: number,
): ResultatDeltaOi | null {
  if (!(ref.t < nowMs)) return null;
  const courant = construireInstantaneOi(chain, nowMs);
  const cle = (e: number, k: number) => `${e}|${k}`;
  const avant = new Map<string, { e: number; k: number; cotes: Cotes }>();
  let echeancesExpirees = 0;
  for (const e of ref.ech) {
    if (!(e.e > nowMs)) {
      echeancesExpirees += 1;
      continue;
    }
    e.k.forEach((k, i) => avant.set(cle(e.e, k), { e: e.e, k, cotes: { c: e.c[i] ?? null, p: e.p[i] ?? null } }));
  }
  const apres = new Map<string, { e: number; k: number; cotes: Cotes }>();
  for (const e of courant.ech) {
    e.k.forEach((k, i) => apres.set(cle(e.e, k), { e: e.e, k, cotes: { c: e.c[i] ?? null, p: e.p[i] ?? null } }));
  }

  const cellules: CelluleDeltaOi[] = [];
  let deltaAbsMax = 0;
  for (const id of new Set([...avant.keys(), ...apres.keys()])) {
    const a = avant.get(id);
    const b = apres.get(id);
    const ref0 = (a ?? b)!;
    let oiAvant = 0;
    let oiApres = 0;
    let nouveau = false;
    let absent = false;
    const cote = (x: number | null | undefined, y: number | null | undefined): number | null => {
      const avantMesure = x !== null && x !== undefined;
      const apresMesure = y !== null && y !== undefined;
      if (apresMesure && avantMesure) {
        oiAvant += x;
        oiApres += y;
        return y - x;
      }
      if (apresMesure) {
        nouveau = true;
        oiApres += y;
        return y;
      }
      if (avantMesure) absent = true;
      return null;
    };
    const deltaCall = cote(a?.cotes.c, b?.cotes.c);
    const deltaPut = cote(a?.cotes.p, b?.cotes.p);
    const delta = deltaCall === null && deltaPut === null ? null : (deltaCall ?? 0) + (deltaPut ?? 0);
    if (delta !== null && Math.abs(delta) > deltaAbsMax) deltaAbsMax = Math.abs(delta);
    cellules.push({
      expiryMs: ref0.e,
      strike: ref0.k,
      deltaCall,
      deltaPut,
      delta,
      deltaUsd: delta !== null && Number.isFinite(spot) && spot > 0 ? delta * spot : null,
      oiAvant,
      oiApres,
      nouveau,
      absent,
    });
  }
  cellules.sort((x, y) => x.expiryMs - y.expiryMs || x.strike - y.strike);
  return { refT: ref.t, refJour: ref.j, cellules, deltaAbsMax, echeancesExpirees };
}

/**
 * Top `n` des strikes « construits » (Δ > 0, décroissant) et « vidés » (Δ < 0, croissant) d'une
 * échéance. Descriptif : aucun sens d'achat ou de vente n'est déduit. PURE.
 */
export function topStrikesDeltaOi(
  resultat: ResultatDeltaOi,
  expiryMs: number,
  n = 5,
): { construits: CelluleDeltaOi[]; vides: CelluleDeltaOi[] } {
  const ech = resultat.cellules.filter((c) => c.expiryMs === expiryMs && c.delta !== null);
  return {
    construits: ech.filter((c) => c.delta! > 0).sort((a, b) => b.delta! - a.delta!).slice(0, n),
    vides: ech.filter((c) => c.delta! < 0).sort((a, b) => a.delta! - b.delta!).slice(0, n),
  };
}

// ─────────────────────────── Persistance (localStorage + KV daemon) ───────────────────────────

/** Namespace KV du daemon (une clé par devise et par jour UTC). */
export const NS_KV_OI = "oi-strikes";
/** Préfixe localStorage (déclaré dans store/persist.ts : instantanés restés sur le poste). */
export const PREFIXE_LOCAL_OI = "axiom:oiStrikes:";
/** Rétention : aujourd'hui et les 7 jours UTC précédents. */
export const JOURS_CONSERVES = 7;

export type DeviseOi = "BTC" | "ETH";

export function cleLocaleOi(devise: DeviseOi, jour: string): string {
  return `${PREFIXE_LOCAL_OI}${devise}:${jour}`;
}

function cleKvOi(devise: DeviseOi, jour: string): string {
  return `${devise}:${jour}`;
}

/** Jour UTC à J-`decalage` de `nowMs`. */
export function jourDecale(nowMs: number, decalage: number): string {
  return jourUtc(nowMs - decalage * MS_JOUR);
}

function lireLocal(devise: DeviseOi, jour: string): InstantaneOi | null {
  try {
    const brut = localStorage.getItem(cleLocaleOi(devise, jour));
    return brut ? validerInstantane(JSON.parse(brut)) : null;
  } catch {
    return null;
  }
}

/** Jours UTC (« AAAA-MM-JJ ») des instantanés locaux d'une devise, triés croissant. */
export function joursLocauxOi(devise: DeviseOi): string[] {
  const prefixe = `${PREFIXE_LOCAL_OI}${devise}:`;
  const jours: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k !== null && k.startsWith(prefixe)) jours.push(k.slice(prefixe.length));
    }
  } catch {
    /* stockage indisponible */
  }
  return jours.sort();
}

/** Supprime les instantanés locaux antérieurs à J-7 (rétention glissante). */
function elaguerLocal(devise: DeviseOi, nowMs: number): void {
  const limite = jourDecale(nowMs, JOURS_CONSERVES);
  for (const jour of joursLocauxOi(devise)) {
    if (jour >= limite) continue;
    try {
      localStorage.removeItem(cleLocaleOi(devise, jour));
    } catch {
      /* ignoré */
    }
  }
}

/** Supprime du KV les instantanés de la devise antérieurs à J-7 (une passe par capture). */
async function elaguerKv(devise: DeviseOi, nowMs: number): Promise<void> {
  const instantanes = await kvSnapshot(NS_KV_OI);
  if (instantanes === null) return;
  const limite = jourDecale(nowMs, JOURS_CONSERVES);
  const prefixe = `${devise}:`;
  for (const cle of Object.keys(instantanes)) {
    if (cle.startsWith(prefixe) && cle.slice(prefixe.length) < limite) await kvDelete(NS_KV_OI, cle);
  }
}

/** Instantané d'un jour : KV du daemon d'abord s'il est présent, puis localStorage (patron TERM). */
export async function lireInstantaneOi(devise: DeviseOi, jour: string): Promise<InstantaneOi | null> {
  if (daemonPret()) {
    const distant = validerInstantane(await kvGet(NS_KV_OI, cleKvOi(devise, jour)));
    if (distant !== null) return distant;
  }
  return lireLocal(devise, jour);
}

/** Références J-1 et J-7 et jours couverts localement (couverture affichée). */
export interface ReferencesOi {
  j1: InstantaneOi | null;
  j7: InstantaneOi | null;
  /** Jour UTC attendu de chaque référence (affiché quand l'instantané manque). */
  jourJ1: string;
  jourJ7: string;
  joursLocaux: string[];
  daemon: boolean;
}

/** Lit les références J-1 et J-7 de `nowMs` (sonde du daemon mémoïsée 60 s). Ne jette jamais. */
export async function lireReferencesOi(devise: DeviseOi, nowMs: number): Promise<ReferencesOi> {
  const daemon = await detectDaemon("kv").catch(() => false);
  const jourJ1 = jourDecale(nowMs, 1);
  const jourJ7 = jourDecale(nowMs, JOURS_CONSERVES);
  const [j1, j7] = await Promise.all([lireInstantaneOi(devise, jourJ1), lireInstantaneOi(devise, jourJ7)]);
  return { j1, j7, jourJ1, jourJ7, joursLocaux: joursLocauxOi(devise), daemon: daemon && daemonPret() };
}

const capturesSession = new Set<string>();

/**
 * Instantané du jour : au premier chargement réussi après 08:05 UTC, si aucun instantané de ce
 * jour n'existe (localStorage, puis KV), écrit l'instantané daté de la réception de la chaîne,
 * puis élague au-delà de J-7. Renvoie true si un instantané a été écrit. Ne jette jamais.
 */
export async function capturerInstantaneOi(devise: DeviseOi, chain: readonly OptionPoint[], recuLe: number): Promise<boolean> {
  if (!apresHeureInstantane(recuLe) || chain.length === 0) return false;
  const jour = jourUtc(recuLe);
  const cleSession = `${devise}:${jour}`;
  if (capturesSession.has(cleSession)) return false;
  capturesSession.add(cleSession);
  if (lireLocal(devise, jour) !== null) return false;
  if (daemonPret()) {
    const distant = validerInstantane(await kvGet(NS_KV_OI, cleKvOi(devise, jour)));
    if (distant !== null) {
      // Premier instantané pris ailleurs (autre navigateur) : recopié localement, jamais remplacé.
      try {
        localStorage.setItem(cleLocaleOi(devise, jour), JSON.stringify(distant));
      } catch {
        /* quota : ignoré */
      }
      return false;
    }
  }
  const instantane = construireInstantaneOi(chain, recuLe);
  if (instantane.ech.length === 0) return false;
  elaguerLocal(devise, recuLe);
  try {
    localStorage.setItem(cleLocaleOi(devise, jour), JSON.stringify(instantane));
  } catch {
    /* quota / mode privé : le KV seul portera l'instantané s'il est présent */
  }
  if (daemonPret()) {
    await kvPut(NS_KV_OI, cleKvOi(devise, jour), instantane);
    await elaguerKv(devise, recuLe);
  }
  return true;
}

/** Réservé aux tests : oublie les captures de la session. */
export function _viderCapturesOi(): void {
  capturesSession.clear();
}
