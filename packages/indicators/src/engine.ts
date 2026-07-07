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

/**
 * Construit le contexte de calcul (sources de prix dérivées) à partir des bougies.
 * `sourceKey` sélectionne la série mono-prix exposée en `ctx.source` (défaut "close") :
 * c'est la série que les defs mono-source (SMA, EMA, WMA, RSI, MACD, Bollinger…) doivent lire.
 */
export function buildCalcContext(
  candles: Candle[],
  sourceKey: string = "close"
): CalcContext {
  const n = candles.length;
  const hl2 = new Array<number>(n);
  const hlc3 = new Array<number>(n);
  const ohlc4 = new Array<number>(n);
  const source = new Array<number>(n);

  for (let i = 0; i < n; i++) {
    const c = candles[i];
    if (c === undefined) continue;
    hl2[i] = (c.high + c.low) / 2;
    hlc3[i] = (c.high + c.low + c.close) / 3;
    ohlc4[i] = (c.open + c.high + c.low + c.close) / 4;

    switch (sourceKey) {
      case "open":
        source[i] = c.open;
        break;
      case "high":
        source[i] = c.high;
        break;
      case "low":
        source[i] = c.low;
        break;
      case "hl2":
        source[i] = hl2[i]!;
        break;
      case "hlc3":
        source[i] = hlc3[i]!;
        break;
      case "ohlc4":
        source[i] = ohlc4[i]!;
        break;
      case "close":
      default:
        source[i] = c.close;
        break;
    }
  }

  return { hl2, hlc3, ohlc4, source };
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
  const resolved = resolveParams(def, params);
  // `source` (si le def le déclare) pilote la série mono-prix exposée en ctx.source.
  const sourceKey =
    typeof resolved.source === "string" ? resolved.source : "close";
  const ctx = buildCalcContext(candles, sourceKey);
  return def.calc(candles, resolved, ctx);
}
