import { mediane, type OrderBook } from "./depth";

export interface PointDiagnostic { t: number; v: number }
export type SigneDiagnostic = "hausse" | "baisse" | "neutre";

export interface ConfigurationDiagnostic {
  /** Étendue temporelle analysée ; aucune observation antérieure n'est conservée. */
  fenetreMs: number;
  minimumObservations: number;
  /** Part de la fenêtre réellement couverte par premier→dernier point. */
  couvertureMin: number;
  seuilPrixPct: number;
  seuilOiPct: number;
  /** Delta CVD en quantité de base, jamais un pourcentage d'un cumul arbitraire. */
  seuilCvdBase: number;
  persistanceMs: number;
  trouResetMs: number;
  /** Cadences attendues, utilisées pour détecter les trous internes. */
  cadencePrixCvdMs: number;
  cadenceOiMs: number;
  /** Âge maximal de la dernière observation commune. */
  ageMaxMs: number;
}

export const CONFIG_DIAGNOSTIC_DEFAUT: ConfigurationDiagnostic = {
  fenetreMs: 60 * 60_000,
  minimumObservations: 6,
  couvertureMin: 0.8,
  seuilPrixPct: 0.5,
  seuilOiPct: 1,
  seuilCvdBase: 0,
  persistanceMs: 2 * 60_000,
  trouResetMs: 10 * 60_000,
  cadencePrixCvdMs: 5 * 60_000,
  cadenceOiMs: 5 * 60_000,
  ageMaxMs: 10 * 60_000,
};

export interface LectureDiagnostic {
  disponible: boolean;
  variation: number | null;
  signe: SigneDiagnostic | null;
  observations: number;
  couverture: number;
  unite: string;
}

export interface DiagnosticPrixOiCvd {
  code: string | null;
  libelle: string;
  prix: LectureDiagnostic;
  oi: LectureDiagnostic;
  cvd: LectureDiagnostic;
  qualite: "complet" | "incomplet";
  bornesCommunes: { debut: number; fin: number } | null;
}

/** Sous-ensemble structurel de Candle : garde ce calcul indépendant du rendu chart. */
export interface BougieDiagnostic {
  time: number;
  close: number;
  buyVolume?: number;
  sellVolume?: number;
}

/**
 * Extrait le prix et un CVD honnête d'un buffer borné. Si UNE bougie retenue ne
 * porte pas les deux volumes agressifs, tout le CVD devient indisponible.
 */
export function extrairePrixEtCvdReel(
  candles: readonly BougieDiagnostic[],
  now: number,
  fenetreMs: number,
  cadenceMs = 0,
): { prix: PointDiagnostic[]; cvdReel: PointDiagnostic[] | null } {
  const debut = now - fenetreMs;
  const retenues = candles
    .map((c) => ({ c, disponibleLe: c.time + Math.max(0, cadenceMs) }))
    .filter(({ c, disponibleLe }) => Number.isFinite(disponibleLe) && disponibleLe >= debut && disponibleLe <= now && Number.isFinite(c.close) && c.close > 0)
    .sort((a, b) => a.disponibleLe - b.disponibleLe);
  const prix = retenues.map(({ c, disponibleLe }) => ({ t: disponibleLe, v: c.close }));
  if (retenues.some((c) =>
    !Number.isFinite(c.c.buyVolume) || !Number.isFinite(c.c.sellVolume)
    || (c.c.buyVolume ?? -1) < 0 || (c.c.sellVolume ?? -1) < 0,
  )) return { prix, cvdReel: null };
  let cumul = 0;
  const cvdReel = retenues.map(({ c, disponibleLe }) => {
    cumul += c.buyVolume! - c.sellVolume!;
    return { t: disponibleLe, v: cumul };
  });
  return { prix, cvdReel };
}

function nettoyerSerie(
  serie: readonly PointDiagnostic[] | null,
  now: number,
  config: ConfigurationDiagnostic,
  strictementPositif: boolean,
): PointDiagnostic[] {
  if (serie === null || !(config.fenetreMs > 0)) return [];
  const debut = now - config.fenetreMs;
  const parTemps = new Map<number, number>();
  for (const p of serie) {
    if (!Number.isFinite(p.t) || p.t < debut || p.t > now || !Number.isFinite(p.v)) continue;
    if (strictementPositif && p.v <= 0) continue;
    parTemps.set(p.t, p.v);
  }
  return [...parTemps].sort(([a], [b]) => a - b).map(([t, v]) => ({ t, v }));
}

function lireVariation(
  serie: readonly PointDiagnostic[] | null,
  now: number,
  config: ConfigurationDiagnostic,
  seuil: number,
  unite: string,
  mode: "pourcentage" | "delta",
  strictementPositif: boolean,
  cadenceMs: number,
  bornes: { debut: number; fin: number } | null,
): LectureDiagnostic {
  const points = nettoyerSerie(serie, now, config, strictementPositif)
    .filter((p) => bornes === null || (p.t >= bornes.debut && p.t <= bornes.fin));
  const premier = points[0];
  const dernier = points.at(-1);
  const span = premier && dernier ? Math.max(0, dernier.t - premier.t) : 0;
  const cadence = Number.isFinite(cadenceMs) && cadenceMs > 0 ? cadenceMs : config.fenetreMs;
  const attendus = span > 0 ? Math.floor(span / cadence) + 1 : 0;
  const densite = attendus > 0 ? Math.min(1, points.length / attendus) : 0;
  const couvertureTemps = Math.min(1, span / config.fenetreMs);
  const couverture = Math.min(couvertureTemps, densite);
  let trouInterne = false;
  for (let i = 1; i < points.length; i++) {
    if (points[i]!.t - points[i - 1]!.t > cadence * 1.5) { trouInterne = true; break; }
  }
  const ageValide = dernier !== undefined && now >= dernier.t && now - dernier.t <= config.ageMaxMs;
  const disponible = Boolean(
    premier && dernier
    && points.length >= Math.max(2, config.minimumObservations)
    && couverture >= config.couvertureMin
    && !trouInterne
    && ageValide,
  );
  if (!disponible || !premier || !dernier) {
    return { disponible: false, variation: null, signe: null, observations: points.length, couverture, unite };
  }
  const variation = mode === "pourcentage"
    ? ((dernier.v / premier.v) - 1) * 100
    : dernier.v - premier.v;
  const absSeuil = Math.max(0, Number.isFinite(seuil) ? seuil : 0);
  const signe: SigneDiagnostic = variation > absSeuil
    ? "hausse"
    : variation < -absSeuil
      ? "baisse"
      : "neutre";
  return { disponible: true, variation, signe, observations: points.length, couverture, unite };
}

const GLYPHE_SIGNE: Record<SigneDiagnostic, string> = { hausse: "↑", baisse: "↓", neutre: "→" };
const CODE_SIGNE: Record<SigneDiagnostic, string> = { hausse: "+", baisse: "-", neutre: "0" };

/**
 * Lecture pure d'un même intervalle prix spot / OI perp en quantité / CVD spot réel.
 * Une série absente ou trop courte rend le triplet indisponible : elle n'est jamais
 * remplacée par zéro. Le CVD est exprimé comme delta de cumul en quantité de base.
 */
export function diagnostiquerPrixOiCvd(
  series: {
    prix: readonly PointDiagnostic[] | null;
    oiQuantite: readonly PointDiagnostic[] | null;
    cvdReel: readonly PointDiagnostic[] | null;
  },
  config: ConfigurationDiagnostic,
  now: number,
): DiagnosticPrixOiCvd {
  const propres = [
    nettoyerSerie(series.prix, now, config, true),
    nettoyerSerie(series.oiQuantite, now, config, true),
    nettoyerSerie(series.cvdReel, now, config, false),
  ];
  const bornesCommunes = propres.every((s) => s.length > 0)
    ? {
      debut: Math.max(...propres.map((s) => s[0]!.t)),
      fin: Math.min(...propres.map((s) => s.at(-1)!.t)),
    }
    : null;
  const bornes = bornesCommunes !== null && bornesCommunes.fin >= bornesCommunes.debut ? bornesCommunes : null;
  const prix = lireVariation(series.prix, now, config, config.seuilPrixPct, "%", "pourcentage", true, config.cadencePrixCvdMs, bornes);
  const oi = lireVariation(series.oiQuantite, now, config, config.seuilOiPct, "%", "pourcentage", true, config.cadenceOiMs, bornes);
  const cvd = lireVariation(series.cvdReel, now, config, config.seuilCvdBase, "quantité base", "delta", false, config.cadencePrixCvdMs, bornes);
  if (!prix.disponible || !oi.disponible || !cvd.disponible || prix.signe === null || oi.signe === null || cvd.signe === null) {
    return { code: null, libelle: "Diagnostic incomplet", prix, oi, cvd, qualite: "incomplet", bornesCommunes: bornes };
  }
  return {
    code: `prix${CODE_SIGNE[prix.signe]}|oi${CODE_SIGNE[oi.signe]}|cvd${CODE_SIGNE[cvd.signe]}`,
    libelle: `Prix ${GLYPHE_SIGNE[prix.signe]} · OI ${GLYPHE_SIGNE[oi.signe]} · CVD ${GLYPHE_SIGNE[cvd.signe]}`,
    prix,
    oi,
    cvd,
    qualite: "complet",
    bornesCommunes: bornes,
  };
}

export interface VuePersistanceDiagnostic {
  code: string | null;
  confirme: boolean;
  persistanceMs: number;
}

/** Confirmation temporelle indépendante de la cadence d'échantillonnage. */
export class PersistanceDiagnostic {
  private code: string | null = null;
  private depuis: number | null = null;
  private dernier: number | null = null;

  constructor(private readonly dureeMs: number, private readonly trouResetMs: number) {}

  reset(): void { this.code = null; this.depuis = null; this.dernier = null; }
  deconnecter(): void { this.reset(); }

  observe(code: string | null, now: number): VuePersistanceDiagnostic {
    if (!Number.isFinite(now) || code === null) {
      this.reset();
      return this.view(now);
    }
    const trou = this.dernier !== null && (now < this.dernier || now - this.dernier > this.trouResetMs);
    if (trou || code !== this.code || this.depuis === null) {
      this.code = code;
      this.depuis = now;
    }
    this.dernier = now;
    return this.view(now);
  }

  view(now: number): VuePersistanceDiagnostic {
    if (this.code === null || this.depuis === null || this.dernier === null || !Number.isFinite(now)) {
      return { code: null, confirme: false, persistanceMs: 0 };
    }
    if (now < this.dernier || now - this.dernier > this.trouResetMs) {
      this.reset();
      return { code: null, confirme: false, persistanceMs: 0 };
    }
    const persistanceMs = Math.max(0, now - this.depuis);
    return { code: this.code, confirme: persistanceMs >= this.dureeMs, persistanceMs };
  }
}

/** Paramètres fixes, exposés dans le DOM ; aucune donnée persistée ni extrapolée. */
export const MICRO_CONFIG = {
  ofiWindowMs: 30_000, ofiWarmupMs: 5_000, ofiMinimum: 20,
  staleMs: 5_000, bandBps: 10, baselineMs: 10_000, baselineMinimum: 20,
  withdrawalFraction: 0.5, withdrawalMaxMs: 1_000,
  recoveryFraction: 0.8, recoveryHoldMs: 500, recoveryTimeoutMs: 30_000,
  historyMs: 30 * 60_000, maxSamples: 512, maxEvents: 128,
} as const;

export interface BestQuote { bid: number; bidQty: number; ask: number; askQty: number }
export interface ReconstitutionView {
  medianMs: number | null;
  completed: number;
  censored: number;
  pendingMs: number | null;
  baselineSamples: number;
}
export interface MicrostructureView {
  status: string;
  ofi: number | null;
  ofiNormalized: number | null;
  micropriceBps: number | null;
  samples: number;
  durationMs: number;
  resilienceStatus: string;
  bid: ReconstitutionView;
  ask: ReconstitutionView;
}

/** OFI L1 : ajouts/retraits au meilleur prix ET changements du meilleur prix. */
export function contributionOfi(p: BestQuote, c: BestQuote): number {
  return (c.bid >= p.bid ? c.bidQty : 0) - (c.bid <= p.bid ? p.bidQty : 0)
    - (c.ask <= p.ask ? c.askQty : 0) + (c.ask >= p.ask ? p.askQty : 0);
}

interface DepthPoint { t: number; quantity: number }
interface Pending { start: number; baseline: number; recoveredSince: number | null }
interface Outcome { t: number; recoveryMs: number | null }
interface SideState { history: DepthPoint[]; since: number | null; pending: Pending | null; outcomes: Outcome[] }
function newSide(): SideState { return { history: [], since: null, pending: null, outcomes: [] }; }

function finish(side: SideState, now: number, recoveryMs: number | null): void {
  side.outcomes.push({ t: now, recoveryMs });
  side.outcomes = side.outcomes.filter((e) => now - e.t <= MICRO_CONFIG.historyMs).slice(-MICRO_CONFIG.maxEvents);
  side.pending = null;
  side.history = [];
  side.since = null;
}

/** Bande FIXE pendant la référence et l'événement : un prix qui sort censure le suivi. */
function updateSide(side: SideState, quantity: number, now: number): void {
  const c = MICRO_CONFIG;
  side.history = side.history.filter((p) => p.t >= now - c.baselineMs);
  const pending = side.pending;
  if (pending) {
    if (now - pending.start >= c.recoveryTimeoutMs) {
      finish(side, now, null);
    } else if (quantity >= pending.baseline * c.recoveryFraction) {
      pending.recoveredSince ??= now;
      if (now - pending.recoveredSince >= c.recoveryHoldMs) finish(side, now, pending.recoveredSince - pending.start);
    } else {
      pending.recoveredSince = null;
    }
  } else if (side.history.length >= c.baselineMinimum && side.since !== null && now - side.since >= c.baselineMs) {
    const baseline = mediane(side.history.map((p) => p.quantity));
    const previous = side.history.at(-1)!;
    if (baseline > 0 && quantity <= baseline * c.withdrawalFraction
      && previous.quantity > baseline * c.withdrawalFraction && now - previous.t <= c.withdrawalMaxMs) {
      side.pending = { start: now, baseline, recoveredSince: null };
    }
  }
  side.since ??= now;
  side.history.push({ t: now, quantity });
  if (side.history.length > c.maxSamples) side.history.splice(0, side.history.length - c.maxSamples);
}

function sideView(side: SideState, now: number): ReconstitutionView {
  const outcomes = side.outcomes.filter((e) => now - e.t <= MICRO_CONFIG.historyMs);
  const resolved = outcomes.flatMap((e) => e.recoveryMs === null ? [] : [e.recoveryMs]);
  return {
    medianMs: resolved.length ? mediane(resolved) : null,
    completed: resolved.length,
    censored: outcomes.length - resolved.length,
    pendingMs: side.pending ? Math.max(0, now - side.pending.start) : null,
    baselineSamples: side.history.length,
  };
}

function readQuote(book: OrderBook): BestQuote | null {
  let bid = -Infinity; let ask = Infinity;
  for (const [p, q] of book.bids) {
    if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(q) || q <= 0) return null;
    bid = Math.max(bid, p);
  }
  for (const [p, q] of book.asks) {
    if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(q) || q <= 0) return null;
    ask = Math.min(ask, p);
  }
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid >= ask) return null;
  return { bid, ask, bidQty: book.bids.get(bid)!, askQty: book.asks.get(ask)! };
}

/** État de session hors React ; alimentation avec le carnet cousu, horloge monotone. */
export class DepthMicrostructure {
  private book: OrderBook | null = null;
  private previous: BestQuote | null = null;
  private lastId = -1;
  private lastTime: number | null = null;
  private start = 0;
  private flow: Array<{ t: number; value: number; depth: number }> = [];
  private anchor: number | null = null;
  private bid = newSide();
  private ask = newSide();
  private status = "initialisation";
  private resilienceStatus = "référence 10 s en cours";

  reset(): void {
    this.book = null; this.previous = null; this.lastId = -1; this.lastTime = null;
    this.flow = []; this.anchor = null; this.bid = newSide(); this.ask = newSide();
    this.status = "initialisation"; this.resilienceStatus = "référence 10 s en cours";
  }

  observe(book: OrderBook, now: number): void {
    const c = MICRO_CONFIG;
    if (!Number.isFinite(now) || !Number.isSafeInteger(book.lastUpdateId)) {
      this.reset(); this.status = "carnet ou horloge invalide"; return;
    }
    if (this.book && (book !== this.book || book.lastUpdateId < this.lastId
      || this.lastTime !== null && (now < this.lastTime || now - this.lastTime > c.staleMs))) this.reset();
    if (book === this.book && book.lastUpdateId === this.lastId) return; // rejeu du même snapshot
    const quote = readQuote(book);
    if (!quote) { this.reset(); this.status = "carnet invalide / croisé / vide"; return; }
    if (this.lastTime === null) this.start = now;
    if (this.previous) this.flow.push({ t: now, value: contributionOfi(this.previous, quote), depth: (quote.bidQty + quote.askQty) / 2 });
    this.flow = this.flow.filter((p) => p.t > now - c.ofiWindowMs).slice(-c.maxSamples);
    this.previous = quote; this.book = book; this.lastId = book.lastUpdateId; this.lastTime = now;
    this.status = "en direct";
    const mid = (quote.bid + quote.ask) / 2;
    if (this.anchor !== null && Math.abs(mid / this.anchor - 1) > c.bandBps / 10_000) {
      for (const side of [this.bid, this.ask]) {
        if (side.pending) finish(side, now, null);
        side.history = []; side.since = null;
      }
      this.anchor = null;
    }
    this.anchor ??= mid;
    const low = this.anchor * (1 - c.bandBps / 10_000);
    const high = this.anchor * (1 + c.bandBps / 10_000);
    let bidDepth = 0; let askDepth = 0; let bidCovered = false; let askCovered = false;
    for (const [p, q] of book.bids) {
      if (p <= low) bidCovered = true;
      if (p >= low && p <= high) bidDepth += q;
    }
    for (const [p, q] of book.asks) {
      if (p >= high) askCovered = true;
      if (p >= low && p <= high) askDepth += q;
    }
    if (!bidCovered || !askCovered) {
      for (const side of [this.bid, this.ask]) {
        if (side.pending) finish(side, now, null);
        side.history = []; side.since = null;
      }
      this.resilienceStatus = "couverture reçue < ±10 bps";
      return;
    }
    updateSide(this.bid, bidDepth, now); updateSide(this.ask, askDepth, now);
    this.resilienceStatus = "heuristique L2 · retraits / reconstitution";
  }

  view(now: number): MicrostructureView {
    const fresh = this.lastTime !== null && now >= this.lastTime && now - this.lastTime <= MICRO_CONFIG.staleMs;
    const durationMs = fresh ? Math.min(MICRO_CONFIG.ofiWindowMs, now - this.start) : 0;
    const flow = fresh ? this.flow.filter((p) => p.t > now - MICRO_CONFIG.ofiWindowMs) : [];
    const ready = fresh && durationMs >= MICRO_CONFIG.ofiWarmupMs && flow.length >= MICRO_CONFIG.ofiMinimum;
    const ofi = ready ? flow.reduce((sum, p) => sum + p.value, 0) : null;
    const meanDepth = flow.reduce((sum, p) => sum + p.depth, 0) / flow.length;
    const q = fresh ? this.previous : null;
    const mid = q ? (q.bid + q.ask) / 2 : 0;
    const microprice = q ? (q.ask * q.bidQty + q.bid * q.askQty) / (q.bidQty + q.askQty) : null;
    const status = this.lastTime !== null && !fresh ? "flux muet > 5 s · indisponible" : this.status;
    return {
      status, ofi, ofiNormalized: ofi !== null && meanDepth > 0 ? ofi / meanDepth : null,
      micropriceBps: microprice === null ? null : (microprice / mid - 1) * 10_000,
      samples: flow.length, durationMs, resilienceStatus: fresh ? this.resilienceStatus : status,
      bid: sideView(fresh ? this.bid : newSide(), now), ask: sideView(fresh ? this.ask : newSide(), now),
    };
  }
}
