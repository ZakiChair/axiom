/**
 * Diagnostic microstructure partagé par DOM et EQS.
 *
 * Le contrôleur n'existe que tant qu'une des deux fenêtres le retient. Il lit le
 * buffer réel du symbole maître, interroge l'OI quantité Binance à cadence lente
 * et partage le carnet multiplexé pour les coûts. Aucune écriture Zustand par tick :
 * la vue React est publiée au plus une fois par seconde.
 */
import { createStore } from "zustand/vanilla";
import type { ExchangeId, Timeframe } from "@axiom/types";
import {
  CONFIG_DIAGNOSTIC_DEFAUT,
  PersistanceDiagnostic,
  diagnostiquerPrixOiCvd,
  extrairePrixEtCvdReel,
  type ConfigurationDiagnostic,
  type DiagnosticPrixOiCvd,
  type PointDiagnostic,
  type VuePersistanceDiagnostic,
} from "../data/depthMicrostructure";
import { fetchOpenInterestHist } from "../data/binanceFutures";
import { binanceAdapter } from "../data/binance";
import { souscrireDepth, type OrderBook } from "../data/depth";
import { coutExecution } from "../data/depthExecution";
import { healthStore } from "./health";
import { isMarketDataReady, marketIdentity, marketStore } from "./market";
import { enregistrerQualite } from "./qualiteMetriques";

const STORAGE_KEY = "axiom:microstructure-diagnostic:v1";
const PUBLICATION_MS = 1_000;
const OI_POLL_MS = 60_000;
const NOTIONNELS = [10_000, 50_000, 250_000, 1_000_000] as const;

export interface ContexteDiagnostic {
  exchange: ExchangeId;
  symbol: string;
  timeframe: Timeframe;
  requestId: number;
  pret: boolean;
  connecte: boolean;
}

/** Frontière de session : identité, génération et état de connexion sont inséparables. */
export function doitReinitialiserDiagnostic(
  precedent: ContexteDiagnostic | null,
  suivant: ContexteDiagnostic,
): boolean {
  if (precedent === null) return true;
  return precedent.exchange !== suivant.exchange
    || precedent.symbol !== suivant.symbol
    || precedent.timeframe !== suivant.timeframe
    || precedent.requestId !== suivant.requestId
    || precedent.pret !== suivant.pret
    || precedent.connecte !== suivant.connecte
    || !suivant.pret
    || !suivant.connecte;
}

export function reponseCollecteValide(
  generationAttendue: number,
  generationCourante: number,
  utilisateursCourants: number,
  cleAttendue: string,
  cleCourante: string,
  sourcePrete: boolean,
): boolean {
  return utilisateursCourants > 0
    && generationAttendue === generationCourante
    && cleAttendue === cleCourante
    && sourcePrete;
}

export interface CoutDiagnostic {
  notionnelUsd: number;
  achatBps: number | null;
  venteBps: number | null;
  achatCouvert: boolean;
  venteCouvert: boolean;
}

export interface VueDiagnosticPartagee {
  symbole: string;
  statut: string;
  diagnostic: DiagnosticPrixOiCvd | null;
  persistance: VuePersistanceDiagnostic;
  couts: CoutDiagnostic[];
  provenance: {
    prix: string;
    oi: string;
    cvd: string;
    cout: string;
  };
  majTs: number | null;
}

export interface MicrostructureDiagnosticState {
  config: ConfigurationDiagnostic;
  vue: VueDiagnosticPartagee;
  setConfig: (patch: Partial<ConfigurationDiagnostic>) => void;
  reset: () => void;
}

function configLue(): ConfigurationDiagnostic {
  try {
    if (typeof window === "undefined") return CONFIG_DIAGNOSTIC_DEFAUT;
    const brut = localStorage.getItem(STORAGE_KEY);
    if (!brut) return CONFIG_DIAGNOSTIC_DEFAUT;
    const p = JSON.parse(brut) as Partial<ConfigurationDiagnostic>;
    return normaliserConfig({ ...CONFIG_DIAGNOSTIC_DEFAUT, ...p });
  } catch {
    return CONFIG_DIAGNOSTIC_DEFAUT;
  }
}

function normaliserConfig(c: ConfigurationDiagnostic): ConfigurationDiagnostic {
  return {
    fenetreMs: Math.min(4 * 60 * 60_000, Math.max(30 * 60_000, Number.isFinite(c.fenetreMs) ? c.fenetreMs : CONFIG_DIAGNOSTIC_DEFAUT.fenetreMs)),
    minimumObservations: Math.min(100, Math.max(2, Math.floor(Number.isFinite(c.minimumObservations) ? c.minimumObservations : CONFIG_DIAGNOSTIC_DEFAUT.minimumObservations))),
    couvertureMin: Math.min(1, Math.max(0.5, Number.isFinite(c.couvertureMin) ? c.couvertureMin : CONFIG_DIAGNOSTIC_DEFAUT.couvertureMin)),
    seuilPrixPct: Math.min(20, Math.max(0, Number.isFinite(c.seuilPrixPct) ? c.seuilPrixPct : CONFIG_DIAGNOSTIC_DEFAUT.seuilPrixPct)),
    seuilOiPct: Math.min(50, Math.max(0, Number.isFinite(c.seuilOiPct) ? c.seuilOiPct : CONFIG_DIAGNOSTIC_DEFAUT.seuilOiPct)),
    seuilCvdBase: Math.max(0, Number.isFinite(c.seuilCvdBase) ? c.seuilCvdBase : CONFIG_DIAGNOSTIC_DEFAUT.seuilCvdBase),
    persistanceMs: Math.min(30 * 60_000, Math.max(0, Number.isFinite(c.persistanceMs) ? c.persistanceMs : CONFIG_DIAGNOSTIC_DEFAUT.persistanceMs)),
    trouResetMs: Math.min(60 * 60_000, Math.max(60_000, Number.isFinite(c.trouResetMs) ? c.trouResetMs : CONFIG_DIAGNOSTIC_DEFAUT.trouResetMs)),
    cadencePrixCvdMs: 5 * 60_000,
    cadenceOiMs: 5 * 60_000,
    ageMaxMs: Math.min(30 * 60_000, Math.max(5 * 60_000, Number.isFinite(c.ageMaxMs) ? c.ageMaxMs : CONFIG_DIAGNOSTIC_DEFAUT.ageMaxMs)),
  };
}

function vueVide(symbole = "—", statut = "Diagnostic arrêté"): VueDiagnosticPartagee {
  const actif = symbole.replace(/(?:USDT|USDC|BUSD)$/i, "") || "sous-jacent";
  return {
    symbole,
    statut,
    diagnostic: null,
    persistance: { code: null, confirme: false, persistanceMs: 0 },
    couts: [],
    provenance: {
      prix: "Binance spot · historique 5 min à la demande",
      oi: `Binance USDⓈ-M perp · sumOpenInterest (quantité ${actif}/contrats, pas oiUsd)`,
      cvd: "Binance spot · taker buy/sell des bougies réelles",
      cout: "Binance spot · carnet L2 reçu · hors frais",
    },
    majTs: null,
  };
}

function publierQualiteIndisponible(raison: string): void {
  const signature = `indisponible:${raison}`;
  if (signature === derniereSignatureQualite) return;
  derniereSignatureQualite = signature;
  enregistrerQualite("microstructure:prix-oi-cvd", "Diagnostic prix / OI / CVD", {
    sourceId: "binance-mixte",
    sourceEffective: "Binance spot 5m + Binance USDⓈ-M OI 5m",
    observeLe: null,
    recupereLe: null,
    cadenceMs: 5 * 60_000,
    couverture: { disponibles: 0, attendus: 3 },
    estime: false,
    acces: "indisponible",
    statut: "indisponible",
    raison,
  });
}

let configInitiale = configLue();
let persistance = new PersistanceDiagnostic(configInitiale.persistanceMs, configInitiale.trouResetMs);
let contexte: ContexteDiagnostic | null = null;
let oiQuantite: PointDiagnostic[] = [];
let bougiesSpot: Awaited<ReturnType<typeof binanceAdapter.fetchKlines>> = [];
let livre: OrderBook | null = null;
let livreRecuA: number | null = null;
let unsubDepth: (() => void) | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let utilisateurs = 0;
let dernierFetchOi = 0;
let fetchOiGeneration: number | null = null;
let dernierFetchPrixCvd = 0;
let fetchPrixCvdGeneration: number | null = null;
let generationCollecteur = 0;
let recupereOiA: number | null = null;
let recuperePrixCvdA: number | null = null;
let derniereSignatureQualite = "";

export const microstructureDiagnosticStore = createStore<MicrostructureDiagnosticState>((set, get) => ({
  config: configInitiale,
  vue: vueVide(),
  setConfig: (patch) => {
    const config = normaliserConfig({ ...get().config, ...patch });
    try { if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch { /* stockage optionnel */ }
    persistance = new PersistanceDiagnostic(config.persistanceMs, config.trouResetMs);
    oiQuantite = [];
    bougiesSpot = [];
    recupereOiA = null;
    recuperePrixCvdA = null;
    dernierFetchOi = 0;
    dernierFetchPrixCvd = 0;
    generationCollecteur += 1;
    set({ config, vue: vueVide(marketStore.getState().symbol, "Paramètres modifiés · nouvelle chauffe") });
    void publier();
  },
  reset: () => {
    persistance.reset();
    oiQuantite = [];
    bougiesSpot = [];
    recupereOiA = null;
    recuperePrixCvdA = null;
    dernierFetchOi = 0;
    dernierFetchPrixCvd = 0;
    livre = null;
    livreRecuA = null;
    contexte = null;
    generationCollecteur += 1;
    set({ vue: vueVide(marketStore.getState().symbol, "Réinitialisé") });
  },
}));

function contexteCourant(): ContexteDiagnostic {
  const marche = marketStore.getState();
  const identite = marketIdentity(marche);
  const etat = healthStore.getState().sources[marche.exchange]?.etat;
  const connecte = etat === undefined || etat === "connected" || etat === "polling";
  return {
    ...identite,
    requestId: marche.dataLoad.requestId,
    pret: isMarketDataReady(marche, identite, marche.dataLoad.requestId),
    connecte,
  };
}

function rebrancherDepth(suivant: ContexteDiagnostic): void {
  unsubDepth?.();
  unsubDepth = null;
  livre = null;
  livreRecuA = null;
  if (utilisateurs === 0 || suivant.exchange !== "binance") return;
  unsubDepth = souscrireDepth(
    suivant.symbol,
    (book) => { livre = book; livreRecuA = Date.now(); },
    () => {
      livre = null;
      livreRecuA = null;
      persistance.deconnecter();
      oiQuantite = [];
      bougiesSpot = [];
      recupereOiA = null;
      recuperePrixCvdA = null;
      generationCollecteur += 1;
      dernierFetchOi = 0;
      dernierFetchPrixCvd = 0;
    },
  );
}

async function chargerOi(suivant: ContexteDiagnostic, now: number): Promise<void> {
  if (fetchOiGeneration === generationCollecteur || suivant.exchange !== "binance" || !suivant.pret || !suivant.connecte) return;
  dernierFetchOi = now;
  const generation = generationCollecteur;
  fetchOiGeneration = generation;
  const cle = `${suivant.exchange}:${suivant.symbol}:${suivant.timeframe}:${suivant.requestId}`;
  try {
    const config = microstructureDiagnosticStore.getState().config;
    const limite = Math.min(500, Math.max(7, Math.ceil(config.fenetreMs / (5 * 60_000)) + 2));
    const points = await fetchOpenInterestHist(suivant.symbol, "5m", limite);
    const encore = contexteCourant();
    const encoreCle = `${encore.exchange}:${encore.symbol}:${encore.timeframe}:${encore.requestId}`;
    if (!reponseCollecteValide(generation, generationCollecteur, utilisateurs, cle, encoreCle, encore.pret && encore.connecte)) return;
    // Garde explicite : seule la quantité OI strictement positive est admise.
    oiQuantite = points.flatMap((p) =>
      Number.isFinite(p.time) && Number.isFinite(p.oi) && p.oi > 0
        ? [{ t: p.time, v: p.oi }]
        : [],
    );
    recupereOiA = Date.now();
  } catch {
    const encore = contexteCourant();
    const encoreCle = `${encore.exchange}:${encore.symbol}:${encore.timeframe}:${encore.requestId}`;
    if (!reponseCollecteValide(generation, generationCollecteur, utilisateurs, cle, encoreCle, encore.pret && encore.connecte)) return;
    oiQuantite = [];
    recupereOiA = null;
  } finally {
    if (fetchOiGeneration === generation) fetchOiGeneration = null;
  }
}

async function chargerPrixCvd(suivant: ContexteDiagnostic, now: number): Promise<void> {
  if (fetchPrixCvdGeneration === generationCollecteur || suivant.exchange !== "binance" || !suivant.pret || !suivant.connecte) return;
  dernierFetchPrixCvd = now;
  const generation = generationCollecteur;
  fetchPrixCvdGeneration = generation;
  const cle = `${suivant.exchange}:${suivant.symbol}:${suivant.timeframe}:${suivant.requestId}`;
  try {
    const config = microstructureDiagnosticStore.getState().config;
    const limite = Math.min(500, Math.max(7, Math.ceil(config.fenetreMs / (5 * 60_000)) + 2));
    const candles = await binanceAdapter.fetchKlines(suivant.symbol, "5m", { limit: limite });
    const encore = contexteCourant();
    const encoreCle = `${encore.exchange}:${encore.symbol}:${encore.timeframe}:${encore.requestId}`;
    if (!reponseCollecteValide(generation, generationCollecteur, utilisateurs, cle, encoreCle, encore.pret && encore.connecte)) return;
    bougiesSpot = candles;
    recuperePrixCvdA = Date.now();
  } catch {
    const encore = contexteCourant();
    const encoreCle = `${encore.exchange}:${encore.symbol}:${encore.timeframe}:${encore.requestId}`;
    if (!reponseCollecteValide(generation, generationCollecteur, utilisateurs, cle, encoreCle, encore.pret && encore.connecte)) return;
    bougiesSpot = [];
    recuperePrixCvdA = null;
  } finally {
    if (fetchPrixCvdGeneration === generation) fetchPrixCvdGeneration = null;
  }
}

function publierQualite(diagnostic: DiagnosticPrixOiCvd): void {
  const disponibles = [diagnostic.prix, diagnostic.oi, diagnostic.cvd].filter((l) => l.disponible).length;
  const statut = diagnostic.qualite === "complet"
    ? "frais" as const
    : disponibles === 0
      ? "indisponible" as const
      : "partiel" as const;
  const signature = `${statut}:${disponibles}:${diagnostic.bornesCommunes?.debut ?? 0}:${diagnostic.bornesCommunes?.fin ?? 0}`;
  if (signature === derniereSignatureQualite) return;
  derniereSignatureQualite = signature;
  enregistrerQualite("microstructure:prix-oi-cvd", "Diagnostic prix / OI / CVD", {
    sourceId: "binance-mixte",
    sourceEffective: "Binance spot 5m + Binance USDⓈ-M OI 5m",
    observeLe: diagnostic.bornesCommunes?.fin ?? null,
    recupereLe: recupereOiA !== null && recuperePrixCvdA !== null ? Math.min(recupereOiA, recuperePrixCvdA) : null,
    cadenceMs: 5 * 60_000,
    couverture: { disponibles, attendus: 3 },
    estime: false,
    acces: disponibles === 0 ? "indisponible" : "public",
    statut,
    ...(statut === "frais" ? {} : { raison: "Une série est absente, périmée, trop courte ou trouée." }),
  });
}

export function calculerCoutsCarnet(
  book: OrderBook | null,
  recuA: number | null,
  now: number,
  ageMaxMs: number,
): CoutDiagnostic[] {
  if (book === null || recuA === null || now < recuA || now - recuA > ageMaxMs) return [];
  return NOTIONNELS.map((notionnelUsd) => {
    const achat = coutExecution(book, "achat", notionnelUsd);
    const vente = coutExecution(book, "vente", notionnelUsd);
    return {
      notionnelUsd,
      achatBps: achat?.slippageBps ?? null,
      venteBps: vente?.slippageBps ?? null,
      achatCouvert: achat?.couvert ?? false,
      venteCouvert: vente?.couvert ?? false,
    };
  });
}

async function publier(): Promise<void> {
  if (utilisateurs === 0) return;
  const now = Date.now();
  const suivant = contexteCourant();
  if (doitReinitialiserDiagnostic(contexte, suivant)) {
    const identiteChangee = contexte === null
      || contexte.exchange !== suivant.exchange
      || contexte.symbol !== suivant.symbol
      || contexte.timeframe !== suivant.timeframe
      || contexte.requestId !== suivant.requestId;
    contexte = suivant;
    persistance.reset();
    oiQuantite = [];
    bougiesSpot = [];
    recupereOiA = null;
    recuperePrixCvdA = null;
    dernierFetchOi = 0;
    dernierFetchPrixCvd = 0;
    generationCollecteur += 1;
    if (identiteChangee) rebrancherDepth(suivant);
  }
  if (suivant.exchange !== "binance") {
    publierQualiteIndisponible("Le diagnostic réel est disponible sur Binance uniquement.");
    microstructureDiagnosticStore.setState({ vue: vueVide(suivant.symbol, "Disponible sur Binance uniquement") });
    return;
  }
  if (!suivant.pret || !suivant.connecte) {
    publierQualiteIndisponible(suivant.connecte ? "Historique du marché maître en chargement." : "Flux Binance déconnecté.");
    microstructureDiagnosticStore.setState({ vue: vueVide(suivant.symbol, suivant.connecte ? "Backfill en cours" : "Flux déconnecté · diagnostic réarmé") });
    return;
  }
  const config = microstructureDiagnosticStore.getState().config;
  if (now - dernierFetchOi >= OI_POLL_MS) void chargerOi(suivant, now);
  if (now - dernierFetchPrixCvd >= OI_POLL_MS) void chargerPrixCvd(suivant, now);
  const series = extrairePrixEtCvdReel(bougiesSpot, now, config.fenetreMs, 5 * 60_000);
  const diagnostic = diagnostiquerPrixOiCvd({
    prix: series.prix,
    oiQuantite: oiQuantite.length > 0 ? oiQuantite : null,
    cvdReel: series.cvdReel,
  }, config, now);
  const confirmation = persistance.observe(diagnostic.code, now);
  publierQualite(diagnostic);
  microstructureDiagnosticStore.setState({
    vue: {
      ...vueVide(suivant.symbol, diagnostic.libelle),
      diagnostic,
      persistance: confirmation,
      couts: calculerCoutsCarnet(livre, livreRecuA, now, 5_000),
      majTs: now,
    },
  });
}

/** Retient le collecteur à la demande ; le dernier release coupe timers et sockets. */
export function retenirDiagnosticMicrostructure(): () => void {
  utilisateurs += 1;
  if (utilisateurs === 1) {
    contexte = null;
    dernierFetchOi = 0;
    dernierFetchPrixCvd = 0;
    generationCollecteur += 1;
    timer = setInterval(() => void publier(), PUBLICATION_MS);
    void publier();
  }
  let relache = false;
  return () => {
    if (relache) return;
    relache = true;
    utilisateurs = Math.max(0, utilisateurs - 1);
    if (utilisateurs > 0) return;
    if (timer !== null) clearInterval(timer);
    timer = null;
    unsubDepth?.();
    unsubDepth = null;
    livre = null;
    livreRecuA = null;
    contexte = null;
    oiQuantite = [];
    bougiesSpot = [];
    recupereOiA = null;
    recuperePrixCvdA = null;
    generationCollecteur += 1;
    persistance.reset();
    publierQualiteIndisponible("Diagnostic inactif : ouvrir DOM ou EQS pour collecter le symbole suivi.");
    microstructureDiagnosticStore.setState({ vue: vueVide(marketStore.getState().symbol) });
  };
}
