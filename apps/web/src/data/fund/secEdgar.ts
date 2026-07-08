/**
 * SEC EDGAR — résolution ticker→CIK, profil société, insiders (Form 4), 2-3 concepts
 * XBRL simples. Routé via /extapi (data.sec.gov + www.sec.gov n'ont pas de CORS
 * exploitable pour un User-Agent conforme — cf. spec Lot E1 §0). Gratuit, sans clé,
 * 10 req/s (largement suffisant en usage perso).
 *
 * Schémas RÉELS confirmés par curl direct le 2026-07-08 (identiques aux placeholders
 * du plan) :
 *   - www.sec.gov/files/company_tickers.json → objet indexé "0".."N" de
 *     `{ cik_str: number, ticker: string, title: string }`.
 *   - data.sec.gov/submissions/CIK##########.json → `{ name, sicDescription, ... }`
 *     (les Form 4 individuels ne sont PAS dans ce document — juste la liste des
 *     dépôts — cf. `parseProfilSec`).
 */
import { extUrl } from "../extapi";
import { ecrireCache, estFrais, lireCache } from "../onchain/cache";

const TTL_TICKERS_MS = 24 * 60 * 60 * 1000;
const TTL_PROFIL_MS = 6 * 60 * 60 * 1000;
const CONCEPTS_XBRL = ["Assets", "Liabilities", "NetIncomeLoss"] as const;

export interface EntreeTicker {
  cik: string;
  ticker: string;
  nom: string;
}

/** Recherche substring insensible à la casse sur ticker+nom. PURE. Plafond 15 résultats. */
export function rechercherSociete(query: string, tickers: EntreeTicker[]): EntreeTicker[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];
  const trouves = tickers.filter(
    (t) => t.ticker.toLowerCase().includes(q) || t.nom.toLowerCase().includes(q),
  );
  return trouves.slice(0, 15);
}

/** Parse la réponse `company_tickers.json` (objet indexé 0..N, PAS un tableau). PURE. */
export function parseTickers(json: unknown): EntreeTicker[] {
  if (json === null || typeof json !== "object") return [];
  const out: EntreeTicker[] = [];
  for (const brut of Object.values(json as Record<string, unknown>)) {
    const it = brut as { cik_str?: unknown; ticker?: unknown; title?: unknown };
    const ticker = typeof it.ticker === "string" ? it.ticker : undefined;
    const nom = typeof it.title === "string" ? it.title : undefined;
    const cikNum = typeof it.cik_str === "number" ? it.cik_str : Number(it.cik_str);
    if (ticker === undefined || nom === undefined || !Number.isFinite(cikNum)) continue;
    out.push({ cik: String(cikNum).padStart(10, "0"), ticker, nom });
  }
  return out;
}

/** Charge la liste complète des tickers SEC (cache 24 h, ~10 000 entrées). */
export async function chargerTickers(signal?: AbortSignal): Promise<EntreeTicker[]> {
  const cle = "sec:tickers";
  const cache = await lireCache<EntreeTicker[]>(cle);
  if (estFrais(cache, TTL_TICKERS_MS) && cache !== null) return cache.donnee;

  try {
    const res = await fetch(extUrl("www.sec.gov", "files/company_tickers.json"), { signal });
    if (!res.ok) throw new Error(`SEC tickers HTTP ${res.status}`);
    const tickers = parseTickers((await res.json()) as unknown);
    await ecrireCache(cle, tickers);
    return tickers;
  } catch {
    return cache?.donnee ?? [];
  }
}

export interface InsiderTx {
  date: string;
  initié: string;
  type: "achat" | "vente";
  montant: number | null;
}

export interface ProfilSec {
  nom: string;
  cik: string;
  secteur?: string;
  insiders: InsiderTx[];
}

/** Parse `submissions/CIK##########.json` en profil + Form 4 récents. PURE, défensive. */
export function parseProfilSec(json: unknown, cik: string): ProfilSec | null {
  if (json === null || typeof json !== "object") return null;
  const obj = json as { name?: unknown; sicDescription?: unknown };
  if (typeof obj.name !== "string") return null;
  // Les Form 4 individuels ne sont PAS dans /submissions (juste la liste des dépôts) —
  // v1 : uniquement nom + secteur ; `insiders` reste vide tant qu'un parseur Form 4 XML
  // dédié n'est pas écrit (hors scope v1, cf. spec §2 "pas un dépouillement complet").
  return {
    nom: obj.name,
    cik,
    secteur: typeof obj.sicDescription === "string" ? obj.sicDescription : undefined,
    insiders: [],
  };
}

/** Charge le profil SEC d'une société (cache 6 h). `null` si CIK inconnu/échec réseau total. */
export async function chargerProfilSec(cik: string, signal?: AbortSignal): Promise<ProfilSec | null> {
  const cle = `sec:profil:${cik}`;
  const cache = await lireCache<ProfilSec>(cle);
  if (estFrais(cache, TTL_PROFIL_MS) && cache !== null) return cache.donnee;

  try {
    const res = await fetch(extUrl("data.sec.gov", `submissions/CIK${cik}.json`), { signal });
    if (!res.ok) return cache?.donnee ?? null;
    const profil = parseProfilSec((await res.json()) as unknown, cik);
    if (profil !== null) await ecrireCache(cle, profil);
    return profil ?? cache?.donnee ?? null;
  } catch {
    return cache?.donnee ?? null;
  }
}

/** Concepts XBRL simples exposés (référence pour l'appelant — pas encore agrégés v1). */
export const CONCEPTS_XBRL_DISPONIBLES = CONCEPTS_XBRL;
