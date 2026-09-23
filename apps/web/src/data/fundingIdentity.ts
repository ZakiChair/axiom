/** Identité commune explicite des quatre venues historiques, sans alias de contrat. */
import type { ExchangeId } from "@axiom/types";

export interface IdentiteFunding {
  base: string;
  cexSymbol: string;
  okxInstId: string;
}

export function normaliserIdentiteFunding(exchange: ExchangeId, symbol: string): IdentiteFunding | null {
  if (exchange === "synthetic" || exchange === "twelvedata") return null;
  const s = symbol.trim().toUpperCase();
  const usdt = /^([A-Z0-9]{2,20})USDT$/.exec(s);
  const perpHl = exchange === "hyperliquid" ? /^([A-Z0-9]{2,20})-PERP$/.exec(s) : null;
  const base = usdt?.[1] ?? perpHl?.[1];
  if (base === undefined) return null;
  // La base est reprise à l'identique : aucun XBT→BTC, kPEPE→1000PEPE ou quote implicite.
  return { base, cexSymbol: `${base}USDT`, okxInstId: `${base}-USDT-SWAP` };
}
