/**
 * @axiom/indicators — registry.ts
 *
 * Registre central des indicateurs disponibles.
 * Câblage final : importe chaque `IndicatorDef` depuis son fichier dédié et
 * peuple la liste `INDICATORS`. `getIndicator` permet la résolution par id.
 */

import type { IndicatorDef } from "@axiom/types";
import { sma } from "./trend/sma";
import { ema } from "./trend/ema";
import { macd } from "./trend/macd";
import { rsi } from "./momentum/rsi";
import { bollinger } from "./volatility/bollinger";
import { volume } from "./volume/volume";
import { vwap } from "./volume/vwap";

export const INDICATORS: IndicatorDef[] = [sma, ema, macd, rsi, bollinger, volume, vwap];

export function getIndicator(id: string): IndicatorDef | undefined {
  return INDICATORS.find((i) => i.id === id);
}
