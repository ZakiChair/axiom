import type { ReglementFunding } from "@axiom/backtest";
import type { Candle, Timeframe } from "@axiom/types";
import { extUrl } from "./extapi";

const LIMITE_BINANCE = 1000;
const LIMITE_KLINES = 1500;
const MAX_MOIS_ARCHIVES = 26;
const MAX_OCTETS_ZIP = 2 * 1024 * 1024;
const MAX_OCTETS_CSV = 8 * 1024 * 1024;
const TIMEOUT_ARCHIVE_MS = 15_000;
const SOURCE_PREUVE = "data.binance.vision SHA-256 vérifié" as const;
const cacheArchives = new Map<string, Promise<LigneArchiveFunding[]>>();

function attendre(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parse les klines USDⓈ-M et applique la borne de CLOSE `[debutMs, finMs)`. */
export function parseKlinesPerpBinance(brut: unknown, debutMs: number, finMs: number): Candle[] {
  if (!Array.isArray(brut)) throw new Error("Réponse klines perp Binance invalide.");
  const resultat: Candle[] = [];
  for (const ligne of brut) {
    if (!Array.isArray(ligne) || ligne.length < 11) throw new Error("Kline perp Binance invalide.");
    const time = Number(ligne[0]);
    const closeTime = Number(ligne[6]);
    const open = Number(ligne[1]);
    const high = Number(ligne[2]);
    const low = Number(ligne[3]);
    const close = Number(ligne[4]);
    const volume = Number(ligne[5]);
    const quoteVolume = Number(ligne[7]);
    const trades = Number(ligne[8]);
    const buyVolume = Number(ligne[9]);
    if (![time, closeTime, open, high, low, close, volume, quoteVolume, trades, buyVolume].every(Number.isFinite)) {
      throw new Error("Valeur de kline perp Binance non finie.");
    }
    if (time < debutMs || closeTime + 1 > finMs) continue;
    resultat.push({
      time, open, high, low, close, volume, quoteVolume, trades, buyVolume,
      sellVolume: volume - buyVolume,
      closed: true,
    });
  }
  return resultat;
}

/** Historique de PRIX perp linéaire, distinct des bougies spot. */
export async function accumulerKlinesPerpBinance(
  symbol: string,
  timeframe: Timeframe,
  debutMs: number,
  finMs: number,
  options: { signal?: AbortSignal; onProgress?: (nombre: number) => void; fetcher?: typeof fetch } = {},
): Promise<Candle[]> {
  const fetcher = options.fetcher ?? fetch;
  const normalise = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9]+USDT$/.test(normalise)) throw new Error("Perp Binance USDT requis.");
  const parTemps = new Map<number, Candle>();
  let endTime = finMs - 1;
  while (endTime >= debutMs && parTemps.size < 50_000) {
    if (options.signal?.aborted) throw new DOMException("Accumulation annulée", "AbortError");
    const query = new URLSearchParams({ symbol: normalise, interval: timeframe, endTime: String(endTime), limit: String(LIMITE_KLINES) });
    const response = await fetcher(extUrl("fapi.binance.com", `fapi/v1/klines?${query.toString()}`), { signal: options.signal });
    if (!response.ok) throw new Error(`Klines perp Binance indisponibles (${response.status}).`);
    const brut: unknown = await response.json();
    const toutes = Array.isArray(brut) ? brut : [];
    const lot = parseKlinesPerpBinance(toutes, debutMs, finMs);
    for (const candle of lot) parTemps.set(candle.time, candle);
    options.onProgress?.(parTemps.size);
    const premiere = toutes[0];
    const plusAncienOpen = Array.isArray(premiere) ? Number(premiere[0]) : Number.NaN;
    if (toutes.length < LIMITE_KLINES || !Number.isFinite(plusAncienOpen) || plusAncienOpen <= debutMs) break;
    endTime = plusAncienOpen - 1;
    await attendre(120);
  }
  return [...parTemps.values()].sort((a, b) => a.time - b.time).slice(-50_000);
}

export interface CouvertureFundingBacktest {
  etat: "verifiee";
  debutMs: number;
  finMs: number;
  nombre: number;
  moisArchives: string[];
  intervallesHeures: number[];
  source: "Binance USDⓈ-M REST + data.binance.vision SHA-256 vérifié";
}

export interface HistoriqueFundingBacktest {
  reglements: ReglementFunding[];
  couverture: CouvertureFundingBacktest;
}

export interface LigneArchiveFunding {
  temps: number;
  intervalleHeures: number;
  taux: number;
}

export interface PreuveArchiveFunding {
  lignes: LigneArchiveFunding[];
  mois: string[];
  source: typeof SOURCE_PREUVE;
}

export interface OptionsPreuveFunding {
  signal?: AbortSignal;
  maintenantMs?: number;
  chargerPreuve?: (
    symbol: string,
    debutMs: number,
    finMs: number,
    options: { signal?: AbortSignal; fetcher: typeof fetch; maintenantMs: number },
  ) => Promise<PreuveArchiveFunding>;
}

function nombreDecimalStrict(valeur: unknown, champ: string): number {
  if (typeof valeur !== "number" && typeof valeur !== "string") {
    throw new Error(`${champ} Binance absent ou de type incompatible.`);
  }
  if (typeof valeur === "string" && valeur.trim() === "") {
    throw new Error(`${champ} Binance vide.`);
  }
  const nombre = typeof valeur === "number" ? valeur : Number(valeur.trim());
  if (!Number.isFinite(nombre)) throw new Error(`${champ} Binance invalide.`);
  return nombre;
}

/** Parse sans proxy de prix : `markPrice` doit venir du règlement Binance lui-même. */
export function parseReglementsFundingBinance(brut: unknown): ReglementFunding[] {
  if (!Array.isArray(brut)) throw new Error("Réponse funding Binance invalide.");
  const resultat: ReglementFunding[] = [];
  for (const ligne of brut) {
    if (typeof ligne !== "object" || ligne === null) throw new Error("Ligne funding Binance invalide.");
    const objet = ligne as Record<string, unknown>;
    if (objet.rateType !== undefined && objet.rateType !== "Regular") {
      throw new Error(`rateType Binance ${String(objet.rateType)} non supporté ; règlement refusé.`);
    }
    const temps = nombreDecimalStrict(objet.fundingTime, "fundingTime");
    const taux = nombreDecimalStrict(objet.fundingRate, "fundingRate");
    const mark = nombreDecimalStrict(objet.markPrice, "markPrice");
    if (mark <= 0) {
      throw new Error("markPrice Binance absent ou invalide ; aucun proxy n'est inventé.");
    }
    resultat.push({ temps, taux, mark, tempsMark: temps });
  }
  resultat.sort((a, b) => a.temps - b.temps);
  for (let i = 1; i < resultat.length; i++) {
    if (resultat[i]!.temps === resultat[i - 1]!.temps) throw new Error("Règlement funding Binance dupliqué.");
  }
  return resultat;
}

/** Chemin fermé aux seules archives mensuelles funding BTC/ETH prises en charge. */
export function cheminArchiveFundingBinance(symbol: string, mois: string, checksum: boolean): string {
  if (symbol !== "BTCUSDT" && symbol !== "ETHUSDT") throw new Error("Archives funding vérifiables limitées à BTCUSDT/ETHUSDT.");
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(mois)) throw new Error("Mois archive funding invalide.");
  const nom = `${symbol}-fundingRate-${mois}.zip`;
  return `data/futures/um/monthly/fundingRate/${symbol}/${nom}${checksum ? ".CHECKSUM" : ""}`;
}

/** CSV officiel : aucun arrondi des timestamps, cadence lue sur chaque ligne. */
export function parseArchiveFundingCsv(csv: string): LigneArchiveFunding[] {
  const lignesTexte = csv.replace(/\r/g, "").split("\n");
  if (lignesTexte[0] !== "calc_time,funding_interval_hours,last_funding_rate") {
    throw new Error("Schéma archive funding Binance inattendu.");
  }
  const lignes: LigneArchiveFunding[] = [];
  let precedent = Number.NEGATIVE_INFINITY;
  for (const texte of lignesTexte.slice(1)) {
    if (texte === "") continue;
    const champs = texte.split(",");
    if (champs.length !== 3) throw new Error("Ligne archive funding Binance invalide.");
    const temps = nombreDecimalStrict(champs[0], "calc_time");
    const intervalleHeures = nombreDecimalStrict(champs[1], "funding_interval_hours");
    const taux = nombreDecimalStrict(champs[2], "last_funding_rate");
    if (!Number.isInteger(temps) || temps <= precedent) throw new Error("Échéances archive funding non strictement ordonnées.");
    if (!Number.isInteger(intervalleHeures) || intervalleHeures <= 0) throw new Error("Cadence archive funding invalide.");
    lignes.push({ temps, intervalleHeures, taux });
    precedent = temps;
  }
  return lignes;
}

/** Extrait le seul CSV d'un ZIP Binance (deflate raw, sans dépendance runtime). */
export async function extraireCsvZipMonoFichier(zip: Uint8Array, nomAttendu: string): Promise<string> {
  if (zip.byteLength < 30 || zip.byteLength > MAX_OCTETS_ZIP) throw new Error("Archive funding ZIP vide ou trop volumineuse.");
  const vue = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  if (vue.getUint32(0, true) !== 0x04034b50) throw new Error("Signature ZIP funding invalide.");
  const flags = vue.getUint16(6, true);
  const methode = vue.getUint16(8, true);
  if ((flags & 0x0001) !== 0 || (flags & 0x0008) !== 0 || methode !== 8) throw new Error("ZIP funding chiffré, étendu ou non-deflate refusé.");
  const tailleCompressee = vue.getUint32(18, true);
  const tailleCsv = vue.getUint32(22, true);
  const tailleNom = vue.getUint16(26, true);
  const tailleExtra = vue.getUint16(28, true);
  const debutNom = 30;
  const debutCorps = debutNom + tailleNom + tailleExtra;
  const finCorps = debutCorps + tailleCompressee;
  if (tailleCsv > MAX_OCTETS_CSV || finCorps > zip.byteLength) throw new Error("Tailles ZIP funding invalides.");
  let positionEocd = -1;
  for (let i = zip.byteLength - 22; i >= Math.max(finCorps, zip.byteLength - 65_557); i--) {
    if (vue.getUint32(i, true) === 0x06054b50) {
      positionEocd = i;
      break;
    }
  }
  if (
    positionEocd < 0
    || vue.getUint16(positionEocd + 8, true) !== 1
    || vue.getUint16(positionEocd + 10, true) !== 1
    || vue.getUint32(positionEocd + 16, true) !== finCorps
    || vue.getUint32(finCorps, true) !== 0x02014b50
  ) {
    throw new Error("ZIP funding non mono-fichier ou répertoire central invalide.");
  }
  const nom = new TextDecoder().decode(zip.subarray(debutNom, debutNom + tailleNom));
  if (nom !== nomAttendu) throw new Error("Nom du CSV funding inattendu.");
  const compresse = zip.slice(debutCorps, finCorps);
  const flux = new Blob([compresse]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const extrait = await lireFluxBorne(flux, MAX_OCTETS_CSV, "CSV funding décompressé trop volumineux.");
  if (extrait.byteLength !== tailleCsv) throw new Error("Taille CSV funding différente du ZIP.");
  return new TextDecoder().decode(extrait);
}

async function lireFluxBorne(
  flux: ReadableStream<Uint8Array>,
  maximum: number,
  message: string,
): Promise<Uint8Array> {
  const lecteur = flux.getReader();
  const morceaux: Uint8Array[] = [];
  let taille = 0;
  try {
    while (true) {
      const { done, value } = await lecteur.read();
      if (done) break;
      taille += value.byteLength;
      if (taille > maximum) {
        await lecteur.cancel(message);
        throw new Error(message);
      }
      morceaux.push(value);
    }
  } finally {
    lecteur.releaseLock();
  }
  const resultat = new Uint8Array(taille);
  let position = 0;
  for (const morceau of morceaux) {
    resultat.set(morceau, position);
    position += morceau.byteLength;
  }
  return resultat;
}

function moisUtc(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function instantDateValide(ms: number): boolean {
  return Number.isSafeInteger(ms) && Number.isFinite(new Date(ms).getTime());
}

/** Dernier milliseconde du dernier mois dont l'archive mensuelle peut être close. */
export function finFenetreFundingArchivee(maintenantMs: number): number {
  if (!instantDateValide(maintenantMs)) throw new Error("Instant courant funding invalide.");
  const maintenant = new Date(maintenantMs);
  return Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), 1) - 1;
}

function debutMoisSuivant(mois: string): number {
  const [annee, numero] = mois.split("-").map(Number) as [number, number];
  return Date.UTC(annee, numero, 1);
}

function moisCouvrant(debutMs: number, finMs: number): string[] {
  const resultat: string[] = [];
  let curseur = Date.UTC(new Date(debutMs).getUTCFullYear(), new Date(debutMs).getUTCMonth(), 1);
  const dernier = Date.UTC(new Date(finMs).getUTCFullYear(), new Date(finMs).getUTCMonth(), 1);
  while (curseur <= dernier) {
    resultat.push(moisUtc(curseur));
    if (resultat.length > MAX_MOIS_ARCHIVES) throw new Error(`Fenêtre funding limitée à ${MAX_MOIS_ARCHIVES} archives mensuelles.`);
    curseur = Date.UTC(new Date(curseur).getUTCFullYear(), new Date(curseur).getUTCMonth() + 1, 1);
  }
  return resultat;
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const copie = new Uint8Array(data.byteLength);
  copie.set(data);
  const digest = await crypto.subtle.digest("SHA-256", copie.buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function lireArchiveBorne(
  url: string,
  fetcher: typeof fetch,
  maximum: number,
  signal?: AbortSignal,
): Promise<{ response: Response; contenu: Uint8Array }> {
  const controleur = new AbortController();
  const interrompre = (): void => controleur.abort(signal?.reason);
  if (signal?.aborted) interrompre();
  else signal?.addEventListener("abort", interrompre, { once: true });
  const timer = setTimeout(() => controleur.abort(new Error("Timeout archive funding.")), TIMEOUT_ARCHIVE_MS);
  try {
    const response = await fetcher(url, { signal: controleur.signal });
    const tailleTexte = response.headers.get("content-length");
    if (tailleTexte !== null) {
      const taille = Number(tailleTexte);
      if (!Number.isFinite(taille) || taille < 0 || taille > maximum) throw new Error("Corps archive funding trop volumineux.");
    }
    if (response.body === null) return { response, contenu: new Uint8Array() };
    return {
      response,
      contenu: await lireFluxBorne(response.body, maximum, "Corps archive funding trop volumineux."),
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", interrompre);
  }
}

async function chargerMoisArchive(symbol: string, mois: string, fetcher: typeof fetch, signal?: AbortSignal): Promise<LigneArchiveFunding[]> {
  const cle = `${symbol}:${mois}`;
  const existant = cacheArchives.get(cle);
  if (existant !== undefined) return existant;
  const promesse = (async () => {
    const cheminZip = cheminArchiveFundingBinance(symbol, mois, false);
    const [zipCharge, checksumCharge] = await Promise.all([
      lireArchiveBorne(extUrl("data.binance.vision", cheminZip), fetcher, MAX_OCTETS_ZIP, signal),
      lireArchiveBorne(extUrl("data.binance.vision", cheminArchiveFundingBinance(symbol, mois, true)), fetcher, 512, signal),
    ]);
    const reponseZip = zipCharge.response;
    const reponseChecksum = checksumCharge.response;
    if (!reponseZip.ok || !reponseChecksum.ok) throw new Error(`Archive funding ${mois} indisponible ou mois non clos.`);
    const checksumTexte = new TextDecoder().decode(checksumCharge.contenu);
    if (checksumTexte.length > 512) throw new Error("Checksum archive funding trop volumineux.");
    const nomZip = cheminZip.split("/").at(-1)!;
    const match = checksumTexte.trim().match(/^([0-9a-f]{64})\s+(.+)$/i);
    if (match === null || match[2] !== nomZip) throw new Error("Format checksum archive funding invalide.");
    const zip = zipCharge.contenu;
    if (zip.byteLength > MAX_OCTETS_ZIP) throw new Error("Archive funding ZIP trop volumineuse.");
    if ((await sha256Hex(zip)) !== match[1]!.toLowerCase()) throw new Error("SHA-256 archive funding invalide.");
    const csv = await extraireCsvZipMonoFichier(zip, nomZip.replace(/\.zip$/, ".csv"));
    const lignes = parseArchiveFundingCsv(csv);
    if (lignes.length === 0) throw new Error(`Archive funding ${mois} vide : couverture non attestée.`);
    const debutMois = Date.UTC(Number(mois.slice(0, 4)), Number(mois.slice(5, 7)) - 1, 1);
    const finMois = debutMoisSuivant(mois);
    if (lignes.some((ligne) => ligne.temps < debutMois || ligne.temps >= finMois)) {
      throw new Error(`Échéance funding hors du mois ${mois}.`);
    }
    return lignes;
  })();
  cacheArchives.set(cle, promesse);
  try {
    return await promesse;
  } catch (erreur) {
    cacheArchives.delete(cle);
    throw erreur;
  }
}

export async function chargerPreuveArchiveFundingBinance(
  symbol: string,
  debutMs: number,
  finMs: number,
  options: { signal?: AbortSignal; fetcher: typeof fetch; maintenantMs: number },
): Promise<PreuveArchiveFunding> {
  if (!instantDateValide(debutMs) || !instantDateValide(finMs) || debutMs > finMs) throw new Error("Bornes archive funding invalides.");
  if (!instantDateValide(options.maintenantMs)) throw new Error("Instant courant funding invalide.");
  const mois = moisCouvrant(debutMs, finMs);
  const debutMoisCourant = Date.UTC(new Date(options.maintenantMs).getUTCFullYear(), new Date(options.maintenantMs).getUTCMonth(), 1);
  if (mois.some((m) => debutMoisSuivant(m) > debutMoisCourant)) {
    throw new Error("Mois courant funding non encore attesté par l'archive officielle.");
  }
  const lots: LigneArchiveFunding[][] = [];
  for (const m of mois) lots.push(await chargerMoisArchive(symbol, m, options.fetcher, options.signal));
  const lignes = lots.flat().filter((ligne) => ligne.temps >= debutMs && ligne.temps <= finMs);
  return { lignes, mois, source: SOURCE_PREUVE };
}

function verifierRestContrePreuve(
  reglements: ReglementFunding[],
  preuve: PreuveArchiveFunding,
): void {
  const parTemps = new Map(reglements.map((r) => [r.temps, r]));
  const attendus = new Set<number>();
  let precedent = Number.NEGATIVE_INFINITY;
  for (const ligne of preuve.lignes) {
    if (!Number.isFinite(ligne.temps) || ligne.temps <= precedent || !Number.isFinite(ligne.taux) || !Number.isInteger(ligne.intervalleHeures) || ligne.intervalleHeures <= 0) {
      throw new Error("Preuve d'échéances funding invalide.");
    }
    precedent = ligne.temps;
    attendus.add(ligne.temps);
    const observe = parTemps.get(ligne.temps);
    if (observe === undefined) throw new Error(`Échéance funding ${ligne.temps} absente de l'historique REST.`);
    if (observe.taux !== ligne.taux) throw new Error(`Taux funding différent de l'archive à ${ligne.temps}.`);
  }
  for (const reglement of reglements) {
    if (!attendus.has(reglement.temps)) throw new Error(`Règlement REST ${reglement.temps} non attesté par l'archive.`);
  }
}

/** Télécharge l'historique USDⓈ-M sur [debutMs, finMs], pagination avant calcul. */
export async function fetchReglementsFundingBinance(
  symbol: string,
  debutMs: number,
  finMs: number,
  fetcher: typeof fetch = fetch,
  options: OptionsPreuveFunding = {},
): Promise<HistoriqueFundingBacktest> {
  if (!instantDateValide(debutMs) || !instantDateValide(finMs) || debutMs > finMs) {
    throw new Error("Bornes funding invalides.");
  }
  const normalise = symbol.trim().toUpperCase();
  if (normalise !== "BTCUSDT" && normalise !== "ETHUSDT") {
    throw new Error("Funding réel vérifiable disponible uniquement pour BTCUSDT/ETHUSDT.");
  }

  const parTemps = new Map<number, ReglementFunding>();
  let curseur = debutMs;
  while (curseur <= finMs) {
    const query = new URLSearchParams({
      symbol: normalise,
      startTime: String(curseur),
      endTime: String(finMs),
      limit: String(LIMITE_BINANCE),
    });
    const response = await fetcher(extUrl("fapi.binance.com", `fapi/v1/fundingRate?${query.toString()}`), { signal: options.signal });
    if (!response.ok) throw new Error(`Funding Binance indisponible (${response.status}).`);
    const lot = parseReglementsFundingBinance(await response.json());
    for (const reglement of lot) {
      if (reglement.temps >= debutMs && reglement.temps <= finMs) parTemps.set(reglement.temps, reglement);
    }
    if (lot.length < LIMITE_BINANCE) break;
    const dernier = lot.at(-1)?.temps;
    if (dernier === undefined || dernier < curseur) throw new Error("Pagination funding Binance incohérente.");
    curseur = dernier + 1;
  }

  const reglements = [...parTemps.values()].sort((a, b) => a.temps - b.temps);
  const chargerPreuve = options.chargerPreuve ?? chargerPreuveArchiveFundingBinance;
  const preuve = await chargerPreuve(normalise, debutMs, finMs, {
    fetcher, maintenantMs: options.maintenantMs ?? Date.now(), ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  verifierRestContrePreuve(reglements, preuve);
  const intervallesHeures = [...new Set(preuve.lignes.map((ligne) => ligne.intervalleHeures))].sort((a, b) => a - b);
  return {
    reglements,
    couverture: {
      etat: "verifiee",
      debutMs,
      finMs,
      nombre: reglements.length,
      moisArchives: preuve.mois,
      intervallesHeures,
      source: "Binance USDⓈ-M REST + data.binance.vision SHA-256 vérifié",
    },
  };
}
