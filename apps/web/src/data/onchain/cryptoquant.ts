/**
 * CryptoQuant BASIC (flux takers toutes places, production des mineurs cotés). Chunk À LA DEMANDE :
 * importé uniquement par `await import()` depuis DES et CHAIN. Parties pures puis orchestrateur.
 * Aucune raison, aucun journal, aucune URL ne porte la clé.
 */
import { CRYPTOQUANT_PREFIXE, IDS_MINEURS_CQ, type IdMineurCq } from "../../../../../shared/cryptoquant-proxy";
import { dateOnchain, nombreOnchain } from "./cohorts";

// --- Catalogue ---

/** Les 13 séries admises (4 taker + 9 mineurs). */
export type SerieCq = "taker:spot:btc" | "taker:spot:eth" | "taker:swap:btc" | "taker:swap:eth" | `mineur:${IdMineurCq}`;
export const SERIES_TAKER: readonly SerieCq[] = ["taker:spot:btc", "taker:spot:eth", "taker:swap:btc", "taker:swap:eth"];
export const SERIES_MINEURS: readonly SerieCq[] = IDS_MINEURS_CQ.map((id): SerieCq => `mineur:${id}`);

/** Valeurs fournisseur BRUTES sous clés courtes, rien de dérivé. */
export interface LigneTaker { n: number; bv: number; qv: number; bbv: number; qbv: number; bsv: number; qsv: number; vwap: number; br: number; bsr: number; bc: number; sc: number }
/** `r` obligatoire ; le reste `null` si non publié (jamais 0). */
export interface LigneMineur { r: number; cr: number | null; om: number | null; cm: number | null; usd: number | null; cmu: number | null; px: number | null; decl: number | null; prec: number | null }
export type LigneCq = LigneTaker | LigneMineur;
/** Clé jour "YYYY-MM-DD" UTC ; `majTs` = dernier appel réussi. */
export interface ArchiveCq { version: 1; serie: SerieCq; majTs: number | null; jours: Record<string, LigneCq> }

const PREFIXE_SERIE_MINEUR = "mineur:";

export function jourUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function estSerieMineur(serie: SerieCq): serie is `mineur:${IdMineurCq}` {
  return serie.startsWith(PREFIXE_SERIE_MINEUR);
}

/** Toujours `window=day&limit=30`, jamais `from`/`to`. */
export function cheminSerie(serie: SerieCq): string {
  if (estSerieMineur(serie)) {
    return `${CRYPTOQUANT_PREFIXE}/v1/btc/miner-data/companies?miner=${serie.slice(PREFIXE_SERIE_MINEUR.length)}&window=day&limit=30`;
  }
  const marche = serie.startsWith("taker:spot:") ? "spot" : "swap";
  const actif = serie.endsWith(":eth") ? "eth" : "btc";
  return `${CRYPTOQUANT_PREFIXE}/v2/market/cq/${marche}/trade?symbol=${actif}_all&window=day&limit=30`;
}

// --- Parseur ---

function estObjet(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** "YYYY-MM-DD" (mineurs) ou "YYYY-MM-DD 00:00:00" (taker), validé par `dateOnchain`. */
function jourFournisseur(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T]\d{2}:\d{2}:\d{2})?$/.exec(v.trim());
  const jour = m?.[1];
  return jour !== undefined && dateOnchain(jour) !== null ? jour : null;
}

function requis(v: unknown): number | undefined {
  return nombreOnchain(v) ?? undefined;
}

function ligneTakerFournisseur(l: Record<string, unknown>): LigneTaker | null {
  const n = requis(l["trade_count"]), bv = requis(l["base_volume"]), qv = requis(l["quote_volume"]);
  const bbv = requis(l["base_buy_volume"]), qbv = requis(l["quote_buy_volume"]);
  const bsv = requis(l["base_sell_volume"]), qsv = requis(l["quote_sell_volume"]);
  const vwap = requis(l["vwap"]), br = requis(l["buy_ratio"]), bsr = requis(l["buy_sell_ratio"]);
  const bc = requis(l["buy_count"]), sc = requis(l["sell_count"]);
  if (n === undefined || bv === undefined || qv === undefined || bbv === undefined || qbv === undefined || bsv === undefined
    || qsv === undefined || vwap === undefined || br === undefined || bsr === undefined || bc === undefined || sc === undefined) return null;
  return { n, bv, qv, bbv, qbv, bsv, qsv, vwap, br, bsr, bc, sc };
}

function ligneMineurFournisseur(l: Record<string, unknown>): LigneMineur | null {
  const r = nombreOnchain(l["total_rewards"]);
  if (r === null) return null;
  return {
    r,
    cr: nombreOnchain(l["coinbase_rewards"]),
    om: nombreOnchain(l["other_mining_rewards"]),
    cm: nombreOnchain(l["accumulated_monthly_rewards"]),
    usd: nombreOnchain(l["total_daily_rewards_closing_usd"]),
    cmu: nombreOnchain(l["accumulated_monthly_rewards_closing_usd"]),
    px: nombreOnchain(l["closing_usd"]),
    decl: nombreOnchain(l["reported_production"]),
    prec: nombreOnchain(l["report_accuracy"]),
  };
}

/** Lignes croissantes, dédoublonnées ; `code ≠ 200` → [] ; jours ≥ aujourd'hui et lignes invalides ignorés un par un. */
export function parserLignes(serie: SerieCq, json: unknown, aujourdhuiUtc: string): Array<{ jour: string; ligne: LigneCq }> {
  if (!estObjet(json)) return [];
  const status = json["status"];
  const result = json["result"];
  if (!estObjet(status) || status["code"] !== 200 || !estObjet(result)) return [];
  const data = result["data"];
  if (!Array.isArray(data)) return [];
  const mineur = estSerieMineur(serie);
  const parJour = new Map<string, LigneCq>();
  for (const brut of data) {
    if (!estObjet(brut)) continue;
    const jour = jourFournisseur(typeof brut["datetime"] === "string" ? brut["datetime"] : brut["date"]);
    if (jour === null || jour >= aujourdhuiUtc) continue;
    const ligne = mineur ? ligneMineurFournisseur(brut) : ligneTakerFournisseur(brut);
    if (ligne !== null) parJour.set(jour, ligne);
  }
  return [...parJour.keys()].sort().flatMap((jour) => {
    const ligne = parJour.get(jour);
    return ligne === undefined ? [] : [{ jour, ligne }];
  });
}
