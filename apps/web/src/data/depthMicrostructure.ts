import { mediane, type OrderBook } from "./depth";

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
