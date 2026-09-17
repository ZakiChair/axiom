/**
 * CryptoQuant BASIC (flux takers toutes places, production des mineurs cotés). Chunk À LA DEMANDE :
 * importé uniquement par `await import()` depuis DES et CHAIN. Parties pures puis orchestrateur.
 * Aucune raison, aucun journal, aucune URL ne porte la clé.
 */
import { CRYPTOQUANT_PREFIXE, IDS_MINEURS_CQ, cleCryptoQuantValide, type IdMineurCq } from "../../../../../shared/cryptoquant-proxy";
import { RAISON_CLE_CRYPTOQUANT, cryptoquantKeyStore, getCryptoquantKey } from "../../store/cryptoquant";
import { healthStore, type QuotaSource } from "../../store/health";
import { IS_VERCEL } from "../../lib/deployment";
import { detectDaemon, kvPut, urlDaemon } from "../daemon";
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

/**
 * Profondeur maximale d'une réponse : avec `limit=30`, le fournisseur ne remonte jamais au-delà
 * (il refuse toute date antérieure à 30 j). Un jour plus ancien (valeur zéro `0001-01-01`, epoch
 * `1970-01-01`…) est une anomalie : l'archiver polluerait la copie locale et la KV sans retour.
 */
const JOURS_MAX_REPONSE = 40;

/** Lignes croissantes, dédoublonnées ; `code ≠ 200` → [] ; jours ≥ aujourd'hui ou < J-40 et lignes invalides ignorés un par un. */
export function parserLignes(serie: SerieCq, json: unknown, aujourdhuiUtc: string): Array<{ jour: string; ligne: LigneCq }> {
  if (!estObjet(json)) return [];
  const status = json["status"];
  const result = json["result"];
  if (!estObjet(status) || status["code"] !== 200 || !estObjet(result)) return [];
  const data = result["data"];
  if (!Array.isArray(data)) return [];
  const mineur = estSerieMineur(serie);
  const plancher = decalerJour(aujourdhuiUtc, -JOURS_MAX_REPONSE);
  const parJour = new Map<string, LigneCq>();
  for (const brut of data) {
    if (!estObjet(brut)) continue;
    const jour = jourFournisseur(typeof brut["datetime"] === "string" ? brut["datetime"] : brut["date"]);
    if (jour === null || jour >= aujourdhuiUtc || jour < plancher) continue;
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

/**
 * Archive déjà parsée (local ou `valeur` KV) ; version 1 : un jour invalide est ignoré, pas le blob.
 * Un jour ≥ aujourd'hui UTC (journée non close, écrite par un poste à l'horloge en avance) est
 * ignoré comme au parseur ; la copie stockée n'est pas réécrite pour autant.
 */
function validerArchive(valeur: unknown, serie: SerieCq, aujourdhuiUtc: string): DecodageCq {
  if (!estObjet(valeur)) return { etat: "illisible" };
  const version = valeur["version"];
  if (typeof version === "number" && Number.isInteger(version) && version > 1) return { etat: "versionInconnue" };
  const joursBruts = valeur["jours"];
  if (version !== 1 || valeur["serie"] !== serie || !estObjet(joursBruts)) return { etat: "illisible" };
  const majTs = fini(valeur["majTs"]) ? valeur["majTs"] : null;
  const mineur = estSerieMineur(serie);
  const jours: Record<string, LigneCq> = {};
  for (const [jour, brut] of Object.entries(joursBruts)) {
    if (dateOnchain(jour) === null || jour >= aujourdhuiUtc) continue;
    const ligne = mineur ? ligneMineurStockee(brut) : ligneTakerStockee(brut);
    if (ligne !== null) jours[jour] = ligne;
  }
  return { etat: "ok", archive: { version: 1, serie, majTs, jours: trierJours(jours) } };
}

export function decoderArchive(brut: string | null, serie: SerieCq, aujourdhuiUtc: string = jourUtc(Date.now())): DecodageCq {
  if (brut === null) return { etat: "absente" };
  let valeur: unknown;
  try {
    valeur = JSON.parse(brut);
  } catch {
    return { etat: "illisible" };
  }
  return validerArchive(valeur, serie, aujourdhuiUtc);
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

// --- Persistance (localStorage ∪ KV daemon) ---

/** Mêmes namespace et préfixe que `data/onchain/cache.ts` (non exportés là-bas). */
const NS_KV = "onchain";

/** Clé localStorage d'une série ; le préfixe `axiom:onchain:cq:` est exclu des sauvegardes (`resteSurLePoste`). */
export function cleLocale(serie: SerieCq): string {
  return `axiom:onchain:cq:${serie}:v1`;
}

/** Clé KV daemon d'une série (namespace `onchain`). */
export function cleKv(serie: SerieCq): string {
  return `cq:${serie}:v1`;
}

/** Le daemon refuse au-delà de 1 048 576 caractères. */
const TAILLE_MAX_KV = 900_000;
const TIMEOUT_KV_MS = 5_000;

/** `kv` : null = pas de daemon, false = lecture ou écriture KV en échec (délai dépassé compris). */
export interface PersistanceCq { local: boolean; kv: boolean | null }
export type EtatKvCq = "sans-daemon" | "absente" | "erreur" | "presente";
export interface LectureArchiveCq {
  archive: ArchiveCq | null;
  versionInconnue: boolean;
  localIllisible: boolean;
  kv: EtatKvCq;
  persistance: PersistanceCq;
}

function lireLocal(serie: SerieCq): string | null {
  try {
    return localStorage.getItem(cleLocale(serie));
  } catch {
    return null;
  }
}

function ecrireLocal(serie: SerieCq, texte: string): boolean {
  try {
    localStorage.setItem(cleLocale(serie), texte);
    return true;
  } catch {
    // Stockage plein : signalé par `local: false`.
    return false;
  }
}

/** Tri-état par fetch brut (`kvGet` confond 404 et erreur). */
async function lireKv(serie: SerieCq, aujourdhuiUtc: string): Promise<{ etat: "absente" | "erreur" } | { etat: "presente"; decodage: DecodageCq }> {
  try {
    const res = await fetch(urlDaemon(`/kv/${encodeURIComponent(NS_KV)}/${encodeURIComponent(cleKv(serie))}`), { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_KV_MS) });
    if (res.status === 404) return { etat: "absente" };
    if (!res.ok) return { etat: "erreur" };
    const corps = (await res.json()) as unknown;
    if (!estObjet(corps) || !("valeur" in corps)) return { etat: "erreur" };
    return { etat: "presente", decodage: validerArchive(corps["valeur"], serie, aujourdhuiUtc) };
  } catch {
    return { etat: "erreur" };
  }
}

/** Résout `repli` si `promesse` ne s'est pas réglée dans `ms` ; la minuterie est toujours libérée. */
function avecDelai<T>(promesse: Promise<T>, ms: number, repli: T): Promise<T> {
  return new Promise((resolve) => {
    const minuteur = setTimeout(() => resolve(repli), ms);
    const regler = (v: T) => {
      clearTimeout(minuteur);
      resolve(v);
    };
    promesse.then(regler, () => regler(repli));
  });
}

/** `kvPut` sous la garde de taille, borné comme la lecture (`TIMEOUT_KV_MS`) : `true` seulement si le daemon a confirmé. */
async function ecrireKvBornee(serie: SerieCq, archive: ArchiveCq, texte: string): Promise<boolean> {
  if (texte.length > TAILLE_MAX_KV) return false;
  return (await avecDelai(kvPut(NS_KV, cleKv(serie), archive), TIMEOUT_KV_MS, null)) !== null;
}

function enrichit(union: ArchiveCq, local: ArchiveCq | null): boolean {
  if (local === null) return union.majTs !== null || Object.keys(union.jours).length > 0;
  return Object.keys(union.jours).length > Object.keys(local.jours).length || (union.majTs ?? 0) > (local.majTs ?? 0);
}

/**
 * Local ∪ KV (jamais sur Vercel), réécriture locale si enrichie ; version inconnue jamais écrite.
 * KV joignable mais sans la série : amorcée avec l'union non vide, `persistance.kv` reflète l'écriture.
 */
export async function lireArchiveCq(serie: SerieCq): Promise<LectureArchiveCq> {
  const aujourdhui = jourUtc(Date.now());
  const daemon = !IS_VERCEL && (await detectDaemon("kv"));
  const local = decoderArchive(lireLocal(serie), serie, aujourdhui);
  let kv: EtatKvCq = "sans-daemon";
  let archiveKv: ArchiveCq | null = null;
  let kvVersionInconnue = false;
  if (daemon) {
    const lu = await lireKv(serie, aujourdhui);
    kv = lu.etat;
    if (lu.etat === "presente") {
      if (lu.decodage.etat === "ok") archiveKv = lu.decodage.archive;
      if (lu.decodage.etat === "versionInconnue") kvVersionInconnue = true;
    }
  }
  let persistanceKv = kv === "sans-daemon" ? null : kv !== "erreur";
  const versionInconnue = local.etat === "versionInconnue" || kvVersionInconnue;
  const localIllisible = local.etat === "illisible";
  if (versionInconnue) return { archive: null, versionInconnue, localIllisible, kv, persistance: { local: true, kv: persistanceKv } };
  const archiveLocale = local.etat === "ok" ? local.archive : null;
  const archive = unionArchives(archiveLocale, archiveKv);
  let localOk = true;
  if (archive !== null && enrichit(archive, archiveLocale)) localOk = ecrireLocal(serie, JSON.stringify(archive));
  // Sans amorçage, une KV vide passerait pour une copie durable jusqu'au prochain appel réussi.
  if (kv === "absente" && archive !== null && Object.keys(archive.jours).length > 0) {
    persistanceKv = await ecrireKvBornee(serie, archive, JSON.stringify(archive));
  }
  return { archive, versionInconnue, localIllisible, kv, persistance: { local: localOk, kv: persistanceKv } };
}

/** Jamais de `kvPut` après une lecture KV en erreur ni au-delà de 900 000 caractères ; écriture bornée à `TIMEOUT_KV_MS`. */
export async function ecrireArchiveCq(serie: SerieCq, archive: ArchiveCq, kv: EtatKvCq): Promise<PersistanceCq> {
  const texte = JSON.stringify(archive);
  const local = ecrireLocal(serie, texte);
  if (kv === "sans-daemon") return { local, kv: null };
  if (kv === "erreur") return { local, kv: false };
  return { local, kv: await ecrireKvBornee(serie, archive, texte) };
}

// --- Budget de crédits (spec §13) ---

/**
 * L'offre BASIC reçoit 10 000 CRÉDITS par mois, remis à zéro à la date d'inscription (inconnue
 * du client, sans report) ; un appel réussi coûte 15 crédits (constat du 2026-09-17), un appel
 * en échec n'est pas facturé, et à crédits épuisés l'API répond 402. Aucune API ne donne le
 * solde : le client compte donc ce QU'IL consomme sur une fenêtre glissante de 31 jours UTC —
 * borne supérieure de la consommation depuis n'importe quelle date de remise à zéro — et
 * suspend ses appels au plafond de sécurité, qui garde une marge sous les 10 000.
 *
 * Compteur PAR NAVIGATEUR : les appels faits en ligne de commande, depuis un autre poste ou
 * depuis le déploiement Vercel ne sont pas vus ; le 402 reste le filet.
 */
export const PLAFOND_CREDITS_CQ = 9_000;
export const COUT_CREDITS_DEFAUT_CQ = 15;
/** Quota mensuel de l'offre, publié dans DATA (le libellé du budget porte « 10 000 » en clair). */
const LIMITE_CREDITS_MOIS = 10_000;
/** Fenêtre glissante : le jour UTC courant et les 30 précédents. */
const FENETRE_CREDITS_JOURS = 31;
/** Hors du préfixe d'archive `axiom:onchain:cq:` ; reste sur le poste (`store/persist.ts`). */
const CLE_CREDITS = "axiom:cryptoquant:credits:v1";
/** `x-credit-cost` hors de [0, 1 000] ou non entier : en-tête ignoré, coût par défaut. */
const COUT_CREDITS_MAX = 1_000;

/** Copie mémoire, source de vérité de la session : une écriture en échec ne la perd pas. */
let joursCredits: Record<string, number> | null = null;

/**
 * Jour retenu par la fenêtre : ni sorti par l'ancienneté, ni POSTÉRIEUR au jour courant. Un jour
 * futur (écrit par un poste à l'horloge en avance, comme au parseur d'archive) ne sortirait
 * jamais de la fenêtre et gonflerait la somme indéfiniment : ignoré, puis élagué.
 */
function dansFenetreCredits(jour: string, aujourdhui: string): boolean {
  return jour >= decalerJour(aujourdhui, -(FENETRE_CREDITS_JOURS - 1)) && jour <= aujourdhui;
}

/**
 * Lecture PARESSEUSE, au premier besoin seulement : illisible ou de version inconnue → vide
 * (remplacé à la prochaine écriture) ; un jour ou un total absurde est ignoré un par un, comme
 * au parseur d'archive, pour que la somme reste un entier de crédits.
 */
function creditsMemoire(): Record<string, number> {
  if (joursCredits !== null) return joursCredits;
  const jours: Record<string, number> = {};
  joursCredits = jours;
  try {
    const brut = localStorage.getItem(CLE_CREDITS);
    if (brut === null) return jours;
    const valeur = JSON.parse(brut) as unknown;
    if (!estObjet(valeur) || valeur["v"] !== 1) return jours;
    const stockes = valeur["jours"];
    if (!estObjet(stockes)) return jours;
    for (const [jour, n] of Object.entries(stockes)) {
      if (dateOnchain(jour) !== null && typeof n === "number" && Number.isInteger(n) && n >= 0) jours[jour] = n;
    }
  } catch {
    // Illisible (JSON cassé, stockage refusé) : traité comme vide.
  }
  return jours;
}

/** Somme entière consommée sur la fenêtre ; les jours écartés ne comptent plus, sans écriture. */
function sommeCredits(now: number): number {
  const aujourdhui = jourUtc(now);
  let somme = 0;
  for (const [jour, n] of Object.entries(creditsMemoire())) if (dansFenetreCredits(jour, aujourdhui)) somme += n;
  return somme;
}

/** Coût facturé d'une réponse 200 : `x-credit-cost` entier dans [0, 1 000], sinon 15. */
function coutCredits(entete: string | null): number {
  const brut = entete?.trim() ?? "";
  if (!/^\d+$/.test(brut)) return COUT_CREDITS_DEFAUT_CQ;
  const n = Number(brut);
  return n <= COUT_CREDITS_MAX ? n : COUT_CREDITS_DEFAUT_CQ;
}

/** Impute le coût au jour UTC courant, élague la fenêtre, puis écrit (échec toléré). */
function comptabiliserCredits(entete: string | null): void {
  const aujourdhui = jourUtc(Date.now());
  const jours = creditsMemoire();
  jours[aujourdhui] = (jours[aujourdhui] ?? 0) + coutCredits(entete);
  for (const jour of Object.keys(jours)) if (!dansFenetreCredits(jour, aujourdhui)) delete jours[jour];
  try {
    localStorage.setItem(CLE_CREDITS, JSON.stringify({ v: 1, jours }));
  } catch {
    // Stockage refusé : la copie mémoire reste la source de vérité de la session.
  }
}

// --- Cadence : file unique 10 req / 60 s ---

const SOURCE_SANTE = "cryptoquant";
/** Offre BASIC : 10 req/min (copie adaptée d'`acquireSlot`, `data/coinalyze.ts`). */
const LIMITE_MIN = 10;
const FENETRE_MS = 60_000;
const REPRISE_MIN_MS = 1_000;
const REPRISE_MAX_MS = 15 * 60_000;

const horodatages: number[] = [];
let chaine: Promise<unknown> = Promise.resolve();
let enAttente = 0;
/** 429 : les demandes en file attendent, les nouvelles répondent `quota`. */
let repriseTs: number | null = null;
/** `x-ratelimit-remaining: 0` : retarde le créneau suivant (0 = aucune pause). */
let pauseJusquaTs = 0;
/** Republication du quota à l'expiration du plus ancien horodatage ; absente quand la fenêtre est vide. */
let minuteurQuota: ReturnType<typeof setTimeout> | undefined;
const abonnes = new Set<() => void>();

function notifier(): void {
  for (const cb of abonnes) {
    try {
      cb();
    } catch {
      /* abonné défaillant ignoré */
    }
  }
}

function attendre(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const fin = () => {
      clearTimeout(minuteur);
      signal.removeEventListener("abort", fin);
      resolve();
    };
    const minuteur = setTimeout(fin, Math.max(0, ms));
    signal.addEventListener("abort", fin, { once: true });
  });
}

/** Retire les horodatages sortis de la fenêtre glissante de 60 s. */
function purgerHorodatages(now: number): void {
  while (horodatages.length > 0) {
    const plusAncien = horodatages[0];
    if (plusAncien === undefined || now - plusAncien < FENETRE_MS) break;
    horodatages.shift();
  }
}

/** Fenêtre minute (file) et budget de crédits (§13) : une seule publication, jamais deux. */
function quotaCq(): QuotaSource {
  return {
    utilise: horodatages.length,
    limite: LIMITE_MIN,
    fenetre: "1min",
    credits: { utilise: sommeCredits(Date.now()), limite: LIMITE_CREDITS_MOIS, jours: FENETRE_CREDITS_JOURS },
  };
}

/**
 * Publie le quota (fenêtre DATA) et se replanifie à l'expiration du plus ancien horodatage :
 * le compte redescend sans attendre le créneau suivant. Toute minuterie précédente est annulée ;
 * aucune ne reste une fois la fenêtre vide.
 */
function publierQuota(): void {
  clearTimeout(minuteurQuota);
  minuteurQuota = undefined;
  healthStore.getState().setQuota(SOURCE_SANTE, quotaCq());
  const plusAncien = horodatages[0];
  if (plusAncien === undefined) return;
  minuteurQuota = setTimeout(() => {
    minuteurQuota = undefined;
    purgerHorodatages(Date.now());
    publierQuota();
  }, Math.max(0, plusAncien + FENETRE_MS - Date.now()));
}

/** File sérialisée des 13 séries ; quota publié à chaque créneau puis à chaque expiration ; annulée → `false` sans créneau. */
export function acquerirCreneauCq(signal: AbortSignal): Promise<boolean> {
  enAttente++;
  notifier();
  const tour = chaine.then(async (): Promise<boolean> => {
    try {
      for (;;) {
        if (signal.aborted) return false;
        const now = Date.now();
        if (repriseTs !== null && now >= repriseTs) {
          repriseTs = null;
          notifier();
        }
        if (pauseJusquaTs !== 0 && now >= pauseJusquaTs) {
          pauseJusquaTs = 0;
          notifier();
        }
        const pause = Math.max(repriseTs ?? 0, pauseJusquaTs);
        if (now < pause) {
          await attendre(pause - now, signal);
          continue;
        }
        purgerHorodatages(now);
        if (horodatages.length < LIMITE_MIN) {
          horodatages.push(now);
          publierQuota();
          return true;
        }
        const plusAncien = horodatages[0];
        await attendre(plusAncien === undefined ? FENETRE_MS : FENETRE_MS - (now - plusAncien), signal);
      }
    } finally {
      enAttente--;
      notifier();
    }
  });
  chaine = tour.catch(() => undefined);
  return tour;
}

function secondesEntete(valeur: string | null): number | null {
  if (valeur === null || !/^\d+$/.test(valeur.trim())) return null;
  const s = Number(valeur.trim());
  return Number.isFinite(s) ? s : null;
}

/** Seuils de `x-ratelimit-reset` : au-delà, la valeur est un epoch (ms, puis s) et non un délai. */
const EPOCH_MS_MIN = 1e12;
const EPOCH_S_MIN = 1e9;

/** Délai restant (ms) annoncé par `x-ratelimit-reset` : epoch en ms (> 1e12), epoch en s (> 1e9), sinon secondes relatives. */
function delaiReset(valeur: string | null, now: number): number | null {
  const n = secondesEntete(valeur);
  if (n === null) return null;
  if (n > EPOCH_MS_MIN) return n - now;
  if (n > EPOCH_S_MIN) return n * 1000 - now;
  return n * 1000;
}

function borner(ms: number): number {
  return Math.min(REPRISE_MAX_MS, Math.max(REPRISE_MIN_MS, ms));
}

/**
 * 429 → suspension bornée [1 s, 15 min] (reset, sinon retry-after, sinon 60 s) ; remaining 0 → pause.
 * Les deux échéances ne reculent jamais : un 429 plus court ne raccourcit pas une reprise annoncée.
 */
export function noterReponseCq(res: Response): void {
  const now = Date.now();
  const reset = delaiReset(res.headers.get("x-ratelimit-reset"), now);
  if (res.status === 429) {
    const retry = secondesEntete(res.headers.get("retry-after"));
    repriseTs = Math.max(repriseTs ?? 0, now + borner(reset ?? (retry ?? 60) * 1000));
    notifier();
    return;
  }
  if (res.headers.get("x-ratelimit-remaining")?.trim() === "0") {
    pauseJusquaTs = Math.max(pauseJusquaTs, now + borner(reset ?? 60_000));
    notifier();
  }
}

/** `enAttente` : demandes sans créneau (ni requête en vol, ni consommateur coalescé) ; `repriseTs` : reprise la plus tardive (429 ou `remaining: 0`). */
export function etatFileCq(): { enAttente: number; repriseTs: number | null } {
  const reprise = Math.max(repriseTs ?? 0, pauseJusquaTs);
  return { enAttente, repriseTs: reprise > Date.now() ? reprise : null };
}

export function abonnerFileCq(cb: () => void): () => void {
  abonnes.add(cb);
  return () => {
    abonnes.delete(cb);
  };
}

// --- Orchestrateur ---

/** PRÉSENCE d'une clé `.env` côté proxy (define Vite, jamais la valeur). */
declare const __CQ_CLE_ENV__: boolean;
const CQ_CLE_ENV_PRESENTE: boolean = typeof __CQ_CLE_ENV__ !== "undefined" ? __CQ_CLE_ENV__ : false;

/** Reprise après un appel réussi sans J-1. */
const REPRISE_MS = 6 * 3600_000;
const TIMEOUT_MS = 15_000;

/** Définie dans le store (module déjà partagé par Réglages, DES et CHAIN), jamais recopiée ici. */
export { RAISON_CLE_CRYPTOQUANT } from "../../store/cryptoquant";
export const RAISON_CLE_REFUSEE_CRYPTOQUANT = "Clé CryptoQuant refusée (Réglages ⚙).";
export const RAISON_ERREUR_CRYPTOQUANT = "CryptoQuant injoignable ; archive affichée.";
export const RAISON_ARCHIVE_ILLISIBLE_CRYPTOQUANT = "Archive locale CryptoQuant illisible : remplacée à la prochaine écriture.";
export const RAISON_VERSION_CRYPTOQUANT = "Archive CryptoQuant écrite par une version plus récente d'AXIOM : ni lue ni réécrite.";
export const RAISON_ANNULE_CRYPTOQUANT = "Chargement CryptoQuant annulé.";
const RAISON_OFFRE_DEFAUT = "Offre CryptoQuant insuffisante pour cette série (403).";

/**
 * Les deux raisons du statut `credits` (§13). CONTRAT avec les vues : DES et CHAIN les
 * RECOPIENT en littéraux locaux et n'importent aucune VALEUR de ce module — il doit rester dans
 * son chunk chargé à la demande (`chunkCryptoquant.test.ts`). Leurs tests comparent ces
 * littéraux à ces exports ; toute retouche du texte doit donc rester synchrone des deux côtés.
 */
export const RAISON_CREDITS_EPUISES_CQ =
  "Crédits mensuels CryptoQuant épuisés (402) : plus d'appel avant la remise à zéro mensuelle ; archive affichée.";

/** `n` = somme entière consommée sur la fenêtre ; « 10 000 » en clair (= `LIMITE_CREDITS_MOIS`). */
export function raisonBudgetCreditsCq(n: number): string {
  return `Budget de crédits CryptoQuant atteint (≈ ${n}/10 000 sur 31 j, ce navigateur) : appels suspendus pour préserver le mois ; archive affichée.`;
}

function raisonQuota(restantMs: number): string {
  return `Quota CryptoQuant atteint (429) ; nouvel essai dans ${Math.max(1, Math.ceil(restantMs / 1000))} s.`;
}

export type StatutCq = "pret" | "cle-requise" | "quota" | "offre" | "credits" | "erreur";
export interface ChargementCq { serie: SerieCq; statut: StatutCq; raison: string | null; archive: ArchiveCq | null; diagnostic: DiagnosticCq; persistance: PersistanceCq; appel: boolean }

/** Refus mémorisés en session pour la `version` de clé qui les a produits. */
type FamilleCq = "taker" | "mineurs";
const refusOffre = new Map<FamilleCq, { version: number; raison: string }>();
let refusCle: { version: number; raison: string } | null = null;
/** 402 : mémoire GLOBALE (toutes familles), valable 24 h — un nouvel essai est gratuit. */
const MEMOIRE_CREDITS_MS = 24 * 3600_000;
let refusCredits: { version: number; ts: number } | null = null;

function familleSerie(serie: SerieCq): FamilleCq {
  return estSerieMineur(serie) ? "mineurs" : "taker";
}

function versionCle(): number {
  return cryptoquantKeyStore.getState().version;
}

/**
 * `status.message` amont (403), borné, affiché seulement avec une clé PERSONNELLE vérifiable et
 * absente du message. Sans elle (repli `.env`), le client ignore la clé injectée par le proxy et
 * ne peut pas exclure qu'elle soit recopiée : message par défaut.
 */
async function raisonOffre(res: Response, cle: string | null): Promise<string> {
  try {
    const corps = (await res.json()) as unknown;
    const status = estObjet(corps) ? corps["status"] : null;
    const brut = estObjet(status) && typeof status["message"] === "string" ? status["message"].trim() : "";
    // Test d'inclusion de la clé sur le message ENTIER, avant tout troncage : sinon une clé qui
    // tombe sur la coupure de 200 caractères y survit en partie et un fragment fuit dans la raison.
    if (brut === "" || cle === null || brut.includes(cle)) return RAISON_OFFRE_DEFAUT;
    const message = brut.slice(0, 200);
    return `Offre CryptoQuant insuffisante : ${message}`;
  } catch {
    return RAISON_OFFRE_DEFAUT;
  }
}

function chargementAnnule(serie: SerieCq): ChargementCq {
  return { serie, statut: "erreur", raison: RAISON_ANNULE_CRYPTOQUANT, archive: null, diagnostic: diagnostiquer(null, jourUtc(Date.now())), persistance: { local: true, kv: null }, appel: false };
}

/** Ordre §4.3 ; l'archive existante est toujours renvoyée. */
async function chargerUneFois(serie: SerieCq, signal: AbortSignal): Promise<ChargementCq> {
  // Recalculé après le créneau : l'attente (jusqu'à 15 min après un 429) peut franchir minuit UTC.
  let aujourdhui = jourUtc(Date.now());
  const lecture = await lireArchiveCq(serie);
  let archive = lecture.archive;
  let persistance = lecture.persistance;
  const fin = (statut: StatutCq, raison: string | null, appel: boolean): ChargementCq =>
    ({ serie, statut, raison, archive, diagnostic: diagnostiquer(archive, aujourdhui), persistance, appel });
  const raisonLecture = lecture.localIllisible ? RAISON_ARCHIVE_ILLISIBLE_CRYPTOQUANT : null;

  if (lecture.versionInconnue) return fin("erreur", RAISON_VERSION_CRYPTOQUANT, false);
  if (diagnostiquer(archive, aujourdhui).hierPresent) return fin("pret", raisonLecture, false);
  const cle = getCryptoquantKey();
  if (cle === null && !(CQ_CLE_ENV_PRESENTE && !IS_VERCEL)) return fin("cle-requise", RAISON_CLE_CRYPTOQUANT, false);
  // En-tête impossible (caractère invisible collé, clé trop longue) : `fetch` lèverait avant tout
  // envoi et la série passerait pour « injoignable ». Refus local, sans créneau ni appel.
  if (cle !== null && !cleCryptoQuantValide(`Bearer ${cle}`)) return fin("cle-requise", RAISON_CLE_REFUSEE_CRYPTOQUANT, false);
  const version = versionCle();
  if (refusCle !== null && refusCle.version === version) return fin("cle-requise", refusCle.raison, false);
  const offre = refusOffre.get(familleSerie(serie));
  if (offre !== undefined && offre.version === version) return fin("offre", offre.raison, false);
  const now = Date.now();
  if (repriseTs !== null && now < repriseTs) return fin("quota", raisonQuota(repriseTs - now), false);
  // `majTs` futur (horloge d'un poste en avance, ou relu tel via `unionArchives`) traité comme expiré :
  // sinon la différence négative reste `< REPRISE_MS` indéfiniment et gèle la série.
  if (archive !== null && archive.majTs !== null && archive.majTs <= now && now - archive.majTs < REPRISE_MS) return fin("pret", raisonLecture, false);
  /**
   * §13 : mémoire du 402 puis plafond de crédits, contrôlés AVANT le créneau (une série dans sa
   * reprise reste `pret` sans appel) puis de nouveau APRÈS l'avoir obtenu — une autre série a pu
   * répondre entre-temps. Dans les deux cas, zéro appel.
   */
  const refusBudget = (): ChargementCq | null => {
    const maintenant = Date.now();
    if (refusCredits !== null && refusCredits.version === version && maintenant - refusCredits.ts < MEMOIRE_CREDITS_MS) {
      return fin("credits", RAISON_CREDITS_EPUISES_CQ, false);
    }
    const somme = sommeCredits(maintenant);
    return somme + COUT_CREDITS_DEFAUT_CQ > PLAFOND_CREDITS_CQ ? fin("credits", raisonBudgetCreditsCq(somme), false) : null;
  };
  const refusAvantCreneau = refusBudget();
  if (refusAvantCreneau !== null) return refusAvantCreneau;
  if (!(await acquerirCreneauCq(signal))) return fin("erreur", RAISON_ANNULE_CRYPTOQUANT, false);
  aujourdhui = jourUtc(Date.now());
  const refusApresCreneau = refusBudget();
  if (refusApresCreneau !== null) return refusApresCreneau;

  // Clé personnelle seulement ; sans elle, le proxy Vite/daemon injecte le repli `.env`.
  const headers: Record<string, string> = { accept: "application/json" };
  if (cle !== null) headers["Authorization"] = `Bearer ${cle}`;
  try {
    const res = await fetch(cheminSerie(serie), {
      headers,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
    });
    noterReponseCq(res);
    // Seul un 200 est facturé (§13) ; le coût est lu AVANT tout accès au corps, et une réponse
    // vide ou invalide compte donc comme les autres.
    if (res.status === 200) {
      comptabiliserCredits(res.headers.get("x-credit-cost"));
      publierQuota();
    }
    if (res.status === 401) {
      const raison = cle !== null ? RAISON_CLE_REFUSEE_CRYPTOQUANT : RAISON_CLE_CRYPTOQUANT;
      if (versionCle() === version) refusCle = { version, raison };
      return fin("cle-requise", raison, true);
    }
    if (res.status === 403) {
      const raison = await raisonOffre(res, cle);
      if (versionCle() === version) refusOffre.set(familleSerie(serie), { version, raison });
      return fin("offre", raison, true);
    }
    if (res.status === 429) return fin("quota", raisonQuota((repriseTs ?? Date.now()) - Date.now()), true);
    // Crédits mensuels épuisés : raison FIXE, le corps amont n'est jamais lu.
    if (res.status === 402) {
      if (versionCle() === version) refusCredits = { version, ts: Date.now() };
      healthStore.getState().marquerErreur(SOURCE_SANTE, "CryptoQuant : crédits mensuels épuisés");
      return fin("credits", RAISON_CREDITS_EPUISES_CQ, true);
    }
    if (res.status !== 200) {
      healthStore.getState().marquerErreur(SOURCE_SANTE, `CryptoQuant HTTP ${res.status}`);
      return fin("erreur", RAISON_ERREUR_CRYPTOQUANT, true);
    }
    const lignes = parserLignes(serie, (await res.json()) as unknown, aujourdhui);
    if (lignes.length === 0) {
      healthStore.getState().marquerErreur(SOURCE_SANTE, "CryptoQuant : réponse vide ou invalide");
      return fin("erreur", RAISON_ERREUR_CRYPTOQUANT, true);
    }
    archive = fusionner(archive, serie, lignes, Date.now());
    persistance = await ecrireArchiveCq(serie, archive, lecture.kv);
    healthStore.getState().setEtat(SOURCE_SANTE, "polling", { dernierMessageTs: Date.now() });
    return fin("pret", raisonLecture, true);
  } catch {
    if (signal.aborted) return fin("erreur", RAISON_ANNULE_CRYPTOQUANT, true);
    // Message fixe : jamais `e.message`.
    healthStore.getState().marquerErreur(SOURCE_SANTE, "CryptoQuant injoignable");
    return fin("erreur", RAISON_ERREUR_CRYPTOQUANT, true);
  }
}

interface TravailCq { promesse: Promise<ChargementCq>; controleur: AbortController; consommateurs: number }
const travaux = new Map<SerieCq, TravailCq>();

/** Coalescence par série ; le départ du dernier consommateur annule la passe. */
export function chargerSerieCq(serie: SerieCq, signal?: AbortSignal): Promise<ChargementCq> {
  if (signal?.aborted) return Promise.resolve(chargementAnnule(serie));
  let travail = travaux.get(serie);
  if (travail === undefined || travail.controleur.signal.aborted) {
    const controleur = new AbortController();
    const nouveau: TravailCq = {
      controleur,
      consommateurs: 0,
      promesse: chargerUneFois(serie, controleur.signal).catch((): ChargementCq => ({ ...chargementAnnule(serie), raison: RAISON_ERREUR_CRYPTOQUANT })),
    };
    travaux.set(serie, nouveau);
    void nouveau.promesse.then(() => {
      if (travaux.get(serie) === nouveau) travaux.delete(serie);
    });
    travail = nouveau;
  }
  const courant = travail;
  courant.consommateurs++;
  return new Promise((resolve) => {
    let termine = false;
    const finir = (r: ChargementCq) => {
      if (termine) return;
      termine = true;
      signal?.removeEventListener("abort", annuler);
      courant.consommateurs--;
      if (courant.consommateurs === 0) courant.controleur.abort();
      resolve(r);
    };
    const annuler = () => finir(chargementAnnule(serie));
    signal?.addEventListener("abort", annuler, { once: true });
    void courant.promesse.then(finir);
  });
}

/**
 * Premier chargement du module (DES ou CHAIN ouvre sa section) : le budget déjà consommé sur ce
 * navigateur est publié dans DATA sans attendre un créneau. Somme NULLE : rien n'est publié, pour
 * ne pas créer une ligne de santé « cryptoquant » alors qu'aucun appel n'a eu lieu (I9, I10).
 */
if (sommeCredits(Date.now()) > 0) publierQuota();
