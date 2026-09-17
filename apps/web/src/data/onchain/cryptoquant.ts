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

// --- Archive (pure) ---

const JOUR_MS = 86_400_000;

function jourVersMs(jour: string): number {
  return Date.parse(`${jour}T00:00:00Z`);
}

function decalerJour(jour: string, n: number): string {
  return jourUtc(jourVersMs(jour) + n * JOUR_MS);
}

function trierJours(jours: Record<string, LigneCq>): Record<string, LigneCq> {
  const trie: Record<string, LigneCq> = {};
  for (const jour of Object.keys(jours).sort()) {
    const ligne = jours[jour];
    if (ligne !== undefined) trie[jour] = ligne;
  }
  return trie;
}

/** La ligne reçue remplace celle du jour, aucun jour supprimé ; réponse vide → inchangée. */
export function fusionner(archive: ArchiveCq | null, serie: SerieCq, lignes: ReadonlyArray<{ jour: string; ligne: LigneCq }>, now: number): ArchiveCq {
  const base: ArchiveCq = archive ?? { version: 1, serie, majTs: null, jours: {} };
  if (lignes.length === 0) return base;
  const jours: Record<string, LigneCq> = { ...base.jours };
  for (const { jour, ligne } of lignes) jours[jour] = ligne;
  return { version: 1, serie, majTs: now, jours: trierJours(jours) };
}

/** Conflit → copie au `majTs` le plus grand (égalité → `a`, la copie locale). */
export function unionArchives(a: ArchiveCq | null, b: ArchiveCq | null): ArchiveCq | null {
  if (a === null) return b;
  if (b === null) return a;
  const aGagne = (a.majTs ?? -1) >= (b.majTs ?? -1);
  const [perdante, gagnante] = aGagne ? [b, a] : [a, b];
  return { version: 1, serie: a.serie, majTs: gagnante.majTs ?? perdante.majTs, jours: trierJours({ ...perdante.jours, ...gagnante.jours }) };
}

export type DecodageCq = { etat: "absente" } | { etat: "illisible" } | { etat: "versionInconnue" } | { etat: "ok"; archive: ArchiveCq };

function fini(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function finiOuNull(v: unknown): number | null | undefined {
  if (v === null || v === undefined) return null;
  return fini(v) ? v : undefined;
}

function ligneTakerStockee(v: unknown): LigneTaker | null {
  if (!estObjet(v)) return null;
  const { n, bv, qv, bbv, qbv, bsv, qsv, vwap, br, bsr, bc, sc } = v;
  if (!fini(n) || !fini(bv) || !fini(qv) || !fini(bbv) || !fini(qbv) || !fini(bsv) || !fini(qsv)
    || !fini(vwap) || !fini(br) || !fini(bsr) || !fini(bc) || !fini(sc)) return null;
  return { n, bv, qv, bbv, qbv, bsv, qsv, vwap, br, bsr, bc, sc };
}

function ligneMineurStockee(v: unknown): LigneMineur | null {
  if (!estObjet(v) || !fini(v["r"])) return null;
  const cr = finiOuNull(v["cr"]), om = finiOuNull(v["om"]), cm = finiOuNull(v["cm"]), usd = finiOuNull(v["usd"]);
  const cmu = finiOuNull(v["cmu"]), px = finiOuNull(v["px"]), decl = finiOuNull(v["decl"]), prec = finiOuNull(v["prec"]);
  if (cr === undefined || om === undefined || cm === undefined || usd === undefined
    || cmu === undefined || px === undefined || decl === undefined || prec === undefined) return null;
  return { r: v["r"], cr, om, cm, usd, cmu, px, decl, prec };
}

/** Archive déjà parsée (local ou `valeur` KV) ; version 1 : un jour invalide est ignoré, pas le blob. */
function validerArchive(valeur: unknown, serie: SerieCq): DecodageCq {
  if (!estObjet(valeur)) return { etat: "illisible" };
  const version = valeur["version"];
  if (typeof version === "number" && Number.isInteger(version) && version > 1) return { etat: "versionInconnue" };
  const joursBruts = valeur["jours"];
  if (version !== 1 || valeur["serie"] !== serie || !estObjet(joursBruts)) return { etat: "illisible" };
  const majTs = fini(valeur["majTs"]) ? valeur["majTs"] : null;
  const mineur = estSerieMineur(serie);
  const jours: Record<string, LigneCq> = {};
  for (const [jour, brut] of Object.entries(joursBruts)) {
    if (dateOnchain(jour) === null) continue;
    const ligne = mineur ? ligneMineurStockee(brut) : ligneTakerStockee(brut);
    if (ligne !== null) jours[jour] = ligne;
  }
  return { etat: "ok", archive: { version: 1, serie, majTs, jours: trierJours(jours) } };
}

export function decoderArchive(brut: string | null, serie: SerieCq): DecodageCq {
  if (brut === null) return { etat: "absente" };
  let valeur: unknown;
  try {
    valeur = JSON.parse(brut);
  } catch {
    return { etat: "illisible" };
  }
  return validerArchive(valeur, serie);
}

export interface DiagnosticCq { debut: string | null; dernier: string | null; hierPresent: boolean; manquantsFenetre: string[]; perdus: string[]; perime: boolean }

/** Trous entre `debut` et avant-hier : perdus (< J-30) ou manquants ; hier absent n'est jamais un trou. */
export function diagnostiquer(archive: ArchiveCq | null, aujourdhuiUtc: string): DiagnosticCq {
  const jours = archive === null ? [] : Object.keys(archive.jours).sort();
  const presents = new Set(jours);
  const debut = jours[0] ?? null;
  const dernier = jours[jours.length - 1] ?? null;
  const avantHier = decalerJour(aujourdhuiUtc, -2);
  const limitePerdus = decalerJour(aujourdhuiUtc, -30);
  const manquantsFenetre: string[] = [];
  const perdus: string[] = [];
  if (debut !== null) {
    for (let jour = debut; jour <= avantHier; jour = decalerJour(jour, 1)) {
      if (presents.has(jour)) continue;
      if (jour < limitePerdus) perdus.push(jour);
      else manquantsFenetre.push(jour);
    }
  }
  const perime = dernier === null || jourVersMs(aujourdhuiUtc) - jourVersMs(dernier) > 2 * JOUR_MS;
  return { debut, dernier, hierPresent: presents.has(decalerJour(aujourdhuiUtc, -1)), manquantsFenetre, perdus, perime };
}
