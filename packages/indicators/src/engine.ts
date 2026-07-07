/**
 * @axiom/indicators — engine.ts
 *
 * Moteur de calcul des indicateurs. Construit le `CalcContext` (sources dérivées
 * hl2/hlc3/ohlc4) puis délègue au `calc` déclaratif de l'`IndicatorDef`.
 *
 * Stratégie actuelle : calcul full-array (toutes les bougies à chaque appel).
 * Le mode incrémental viendra plus tard ; le contrat `IndicatorDef` n'en dépend pas.
 */

import type {
  Candle,
  CalcContext,
  IndicatorDef,
  IndicatorResult,
} from "@axiom/types";

/** Construit le contexte de calcul (sources de prix dérivées) à partir des bougies. */
export function buildCalcContext(candles: Candle[]): CalcContext {
  const n = candles.length;
  const hl2 = new Array<number>(n);
  const hlc3 = new Array<number>(n);
  const ohlc4 = new Array<number>(n);

  for (let i = 0; i < n; i++) {
    const c = candles[i];
    if (c === undefined) continue;
    hl2[i] = (c.high + c.low) / 2;
    hlc3[i] = (c.high + c.low + c.close) / 3;
    ohlc4[i] = (c.open + c.high + c.low + c.close) / 4;
  }

  return { hl2, hlc3, ohlc4 };
}

/**
 * Résout les paramètres effectifs : part des valeurs par défaut déclarées dans
 * `def.inputs`, puis applique les surcharges fournies par l'appelant.
 * Assainit les valeurs numériques : NaN/non-finis → défaut, sinon clamp [min, max].
 */
export function resolveParams(
  def: IndicatorDef,
  params?: Record<string, number | boolean | string>
): Record<string, number | boolean | string> {
  const resolved: Record<string, number | boolean | string> = {};
  for (const input of def.inputs) {
    resolved[input.key] = input.default;
  }
  if (params) {
    for (const key of Object.keys(params)) {
      const v = params[key];
      if (v !== undefined) resolved[key] = v;
    }
  }
  // Assainissement des paramètres numériques : NaN/non-finis → défaut, sinon clamp [min, max]
  for (const input of def.inputs) {
    if (input.type === "number") {
      const v = resolved[input.key];
      if (typeof v !== "number" || !Number.isFinite(v)) {
        resolved[input.key] = input.default;
      } else {
        // Clamp la valeur entre min et max
        resolved[input.key] = Math.min(
          input.max ?? v,
          Math.max(input.min ?? v, v)
        );
      }
    }
  }
  return resolved;
}

/**
 * Calcule un indicateur sur l'ensemble des bougies.
 * Les paramètres absents sont complétés par les valeurs par défaut des inputs.
 */
export function computeIndicator(
  def: IndicatorDef,
  candles: Candle[],
  params?: Record<string, number | boolean | string>
): IndicatorResult {
  const ctx = buildCalcContext(candles);
  const resolved = resolveParams(def, params);
  return def.calc(candles, resolved, ctx);
}
