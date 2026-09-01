/**
 * Séries synthétiques (SYN) — TOTAL* autonomes, parse des ratios/spreads et composition OHLC.
 *
 * Encodage : `exA:LEGA|op|exB:LEGB` (ex. `binance:ETHUSDT|/|binance:BTCUSDT`).
 * Le séparateur `|` n'apparaît dans aucun ticker ; `:` sépare source/jambe au
 * PREMIER `:` seulement (les tickers Twelve Data contiennent des `/`, ex. EUR/USD).
 *
 * Composition OHLC jambe-à-jambe (Oa∘Ob, Ha∘Hb, La∘Lb, Ca∘Cb) puis re-clamp
 * H=max(O,H,L,C), L=min(O,H,L,C) — approximation standard (idem TradingView),
 * le max d'un ratio n'étant pas le ratio des max. volume=0 par convention.
 * Jambe B absente d'un bucket → forward-fill de son dernier close (marché fermé).
 */
import type { Candle, ExchangeId, IExchangeAdapter } from "@axiom/types";
import { estSymboleCapitalisation } from "./mcap";

export type SyntheticOp = "/" | "-";
export type SyntheticLegSource = Exclude<ExchangeId, "synthetic"> | "mcap";

export interface SyntheticSpec {
  exA: SyntheticLegSource;
  legA: string;
  exB: SyntheticLegSource;
  legB: string;
  op: SyntheticOp;
}

/** Sources autorisées comme jambe : marchés câblés historiques + pseudo-source `mcap`. */
const LEG_EXCHANGES: ReadonlySet<string> = new Set([
  "binance", "kraken", "coinbase", "twelvedata", "mexc", "mcap",
]);

function splitLeg(leg: string): { ex: SyntheticLegSource; sym: string } | null {
  const i = leg.indexOf(":");
  if (i <= 0 || i >= leg.length - 1) return null;
  const ex = leg.slice(0, i);
  const sym = leg.slice(i + 1);
  if (!LEG_EXCHANGES.has(ex) || (ex === "mcap" && !estSymboleCapitalisation(sym))) return null;
  return { ex: ex as SyntheticLegSource, sym };
}

export function parseSyntheticSymbol(symbol: string): SyntheticSpec | null {
  const parts = symbol.split("|");
  if (parts.length !== 3) return null;
  const [rawA, op, rawB] = parts;
  if (op !== "/" && op !== "-") return null;
  if (rawA === undefined || rawB === undefined) return null;
  const a = splitLeg(rawA);
  const b = splitLeg(rawB);
  if (a === null || b === null) return null;
  return { exA: a.ex, legA: a.sym, exB: b.ex, legB: b.sym, op };
}

export function encodeSyntheticSymbol(spec: SyntheticSpec): string {
  return `${spec.exA}:${spec.legA}|${spec.op}|${spec.exB}:${spec.legB}`;
}

export function formatSyntheticLabel(spec: SyntheticSpec): string {
  return `${spec.legA} ${spec.op} ${spec.legB}`;
}

function apply(op: SyntheticOp, x: number, y: number): number {
  return op === "/" ? x / y : x - y;
}

export function combineKlines(a: Candle[], b: Candle[], op: SyntheticOp): Candle[] {
  const out: Candle[] = [];
  let bi = 0;
  let lastB: Candle | null = null;

  for (const ca of a) {
    while (bi < b.length) {
      const cb = b[bi];
      if (cb === undefined || cb.time > ca.time) break;
      lastB = cb;
      bi += 1;
    }
    if (lastB === null) continue;

    const exact = lastB.time === ca.time;
    const bo = exact ? lastB.open : lastB.close;
    const bh = exact ? lastB.high : lastB.close;
    const bl = exact ? lastB.low : lastB.close;
    const bc = lastB.close;

    if (![ca.open, ca.high, ca.low, ca.close, bo, bh, bl, bc].every(Number.isFinite)) continue;
    if (op === "/" && (bo === 0 || bh === 0 || bl === 0 || bc === 0)) continue;

    const o = apply(op, ca.open, bo);
    const h = apply(op, ca.high, bh);
    const l = apply(op, ca.low, bl);
    const cl = apply(op, ca.close, bc);
    if (![o, h, l, cl].every(Number.isFinite)) continue;
    out.push({
      time: ca.time,
      open: o,
      high: Math.max(o, h, l, cl),
      low: Math.min(o, h, l, cl),
      close: cl,
      volume: 0,
      ...(ca.closed === undefined ? {} : { closed: ca.closed }),
    });
  }
  return out;
}

/**
 * Adapter virtuel : délègue les TOTAL* autonomes ou compose 2 jambes via les adaptateurs
 * injectés pour éviter l'import circulaire avec adapters.ts (qui nous enregistre).
 * subscribeTrades est un no-op : orderflow/footprint/CVD/DOM inertes sur SYN.
 */
export function createSyntheticAdapter(
  resolve: (ex: SyntheticLegSource) => IExchangeAdapter,
  standalone?: IExchangeAdapter,
): IExchangeAdapter {
  return {
    id: "synthetic",

    async fetchKlines(symbol, tf, opts) {
      if (estSymboleCapitalisation(symbol)) {
        if (standalone === undefined) throw new Error(`Série de capitalisation indisponible : ${symbol}`);
        return standalone.fetchKlines(symbol, tf, opts);
      }
      const spec = parseSyntheticSymbol(symbol);
      if (spec === null) throw new Error(`Symbole synthétique invalide : ${symbol}`);
      const [a, b] = await Promise.all([
        resolve(spec.exA).fetchKlines(spec.legA, tf, opts),
        resolve(spec.exB).fetchKlines(spec.legB, tf, opts),
      ]);
      return combineKlines(a, b, spec.op);
    },

    subscribeKline(symbol, tf, cb) {
      if (estSymboleCapitalisation(symbol)) {
        return standalone?.subscribeKline(symbol, tf, cb) ?? (() => {});
      }
      const spec = parseSyntheticSymbol(symbol);
      if (spec === null) return () => {};
      let lastA: Candle | null = null;
      let lastB: Candle | null = null;
      const emit = (): void => {
        if (lastA === null || lastB === null) return;
        const merged = combineKlines([lastA], [lastB], spec.op);
        const cd = merged[0];
        if (cd !== undefined) cb(cd);
      };
      const offA = resolve(spec.exA).subscribeKline(spec.legA, tf, (cd) => { lastA = cd; emit(); });
      const offB = resolve(spec.exB).subscribeKline(spec.legB, tf, (cd) => { lastB = cd; emit(); });
      return () => { offA(); offB(); };
    },

    subscribeTrades() {
      return () => {};
    },
  };
}
