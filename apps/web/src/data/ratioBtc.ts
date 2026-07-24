/**
 * Mapping PUR du toggle « ÷BTC » : marché courant ⇄ ratio synthétique X/BTC.
 * Zéro import React/store — le moteur SYN (data/synthetic.ts) fait tout le reste
 * (live, AT). Détoggle SANS ÉTAT : quitter un ratio = revenir à sa jambe A.
 */
import type { ExchangeId } from "@axiom/types";
import { encodeSyntheticSymbol, parseSyntheticSymbol, type SyntheticSpec } from "./synthetic";
import { splitSymbol } from "./symbol";

/** Ticker BTC de référence par source jambe (catalogues normalisés format Binance). */
export const BTC_REF: Partial<Record<ExchangeId, string>> = {
  binance: "BTCUSDT",
  mexc: "BTCUSDT",
  kraken: "BTCUSD",
  coinbase: "BTCUSD",
};

/**
 * Symbole SYN du ratio X/BTC pour le marché courant, ou null si non basculable :
 * source sans réf BTC (twelvedata, synthetic, non-jambe), base déjà BTC,
 * quote déjà BTC (ex. ETHBTC), ou symbole non découpable (splitSymbol throw).
 */
export function symboleRatioBtc(symbol: string, exchange: ExchangeId): string | null {
  // Garde de source EN PREMIER : un SYN encodé contient un `/` que splitSymbol
  // découperait à tort sans lever — c'est cette garde qui l'écarte (réf undefined).
  const ref = BTC_REF[exchange];
  if (ref === undefined) return null;

  let parts: { base: string; quote: string };
  try {
    parts = splitSymbol(symbol, exchange);
  } catch {
    return null;
  }
  if (parts.base === "BTC" || parts.quote === "BTC") return null;

  return encodeSyntheticSymbol({ exA: exchange, legA: symbol, exB: exchange, legB: ref, op: "/" });
}

/**
 * Spec SYN si le marché courant EST un ratio ÷BTC posé par le toggle
 * (exchange="synthetic", op="/", exB===exA, legB===BTC_REF[exA]), sinon null.
 */
export function estRatioBtc(symbol: string, exchange: ExchangeId): SyntheticSpec | null {
  if (exchange !== "synthetic") return null;
  const spec = parseSyntheticSymbol(symbol);
  if (spec === null) return null;
  if (spec.op !== "/" || spec.exB !== spec.exA || spec.legB !== BTC_REF[spec.exA]) return null;
  return spec;
}
