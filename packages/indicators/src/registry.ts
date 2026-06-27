/**
 * @axiom/indicators — registry.ts
 *
 * Registre central des indicateurs disponibles.
 * Câblage final : importe chaque `IndicatorDef` depuis son fichier dédié et
 * peuple la liste `INDICATORS`. `getIndicator` permet la résolution par id.
 *
 * 86 indicateurs câblés (TS pur, source de vérité unique — cf. BUILD-CONTRACT).
 */

import type { IndicatorDef } from "@axiom/types";

// — trend (27) —
import { adx } from "./trend/adx";
import { alma } from "./trend/alma";
import { aroon } from "./trend/aroon";
import { coppock } from "./trend/coppock";
import { dema } from "./trend/dema";
import { dpo } from "./trend/dpo";
import { ema } from "./trend/ema";
import { frama } from "./trend/frama";
import { hma } from "./trend/hma";
import { ichimoku } from "./trend/ichimoku";
import { kama } from "./trend/kama";
import { kst } from "./trend/kst";
import { macd } from "./trend/macd";
import { mcginley } from "./trend/mcginley";
import { psar } from "./trend/psar";
import { schaff } from "./trend/schaff";
import { sma } from "./trend/sma";
import { smma } from "./trend/smma";
import { supertrend } from "./trend/supertrend";
import { t3 } from "./trend/t3";
import { tema } from "./trend/tema";
import { trix } from "./trend/trix";
import { vortex } from "./trend/vortex";
import { vwma } from "./trend/vwma";
import { waveTrend } from "./trend/waveTrend";
import { wma } from "./trend/wma";
import { zlema } from "./trend/zlema";

// — momentum (21) —
import { accelerator } from "./momentum/accelerator";
import { awesome } from "./momentum/awesome";
import { bop } from "./momentum/bop";
import { cci } from "./momentum/cci";
import { cmo } from "./momentum/cmo";
import { connorsRsi } from "./momentum/connorsRsi";
import { easeOfMovement } from "./momentum/easeOfMovement";
import { elderRay } from "./momentum/elderRay";
import { fisher } from "./momentum/fisher";
import { forceIndex } from "./momentum/forceIndex";
import { mfi } from "./momentum/mfi";
import { momentum } from "./momentum/momentum";
import { ppo } from "./momentum/ppo";
import { roc } from "./momentum/roc";
import { rsi } from "./momentum/rsi";
import { rvi } from "./momentum/rvi";
import { stochRsi } from "./momentum/stochRsi";
import { stochastic } from "./momentum/stochastic";
import { tsi } from "./momentum/tsi";
import { ultimateOsc } from "./momentum/ultimateOsc";
import { williamsR } from "./momentum/williamsR";

// — volatility (13) —
import { atr } from "./volatility/atr";
import { bbBandwidth } from "./volatility/bbBandwidth";
import { bbPercentB } from "./volatility/bbPercentB";
import { bollinger } from "./volatility/bollinger";
import { chaikinVol } from "./volatility/chaikinVol";
import { donchian } from "./volatility/donchian";
import { envelopes } from "./volatility/envelopes";
import { historicalVol } from "./volatility/historicalVol";
import { keltner } from "./volatility/keltner";
import { massIndex } from "./volatility/massIndex";
import { relativeVolatilityIndex } from "./volatility/relativeVolatilityIndex";
import { stdErrorBands } from "./volatility/stdErrorBands";
import { stddev } from "./volatility/stddev";

// — volume (14) —
import { adLine } from "./volume/adLine";
import { anchoredVwap } from "./volume/anchored-vwap";
import { chaikinOsc } from "./volume/chaikinOsc";
import { cmf } from "./volume/cmf";
import { klinger } from "./volume/klinger";
import { nvi } from "./volume/nvi";
import { obv } from "./volume/obv";
import { pvi } from "./volume/pvi";
import { pvt } from "./volume/pvt";
import { volume } from "./volume/volume";
import { volumeMa } from "./volume/volumeMa";
import { volumeOsc } from "./volume/volumeOsc";
import { vwap } from "./volume/vwap";
import { vwapBands } from "./volume/vwapBands";

// — billwilliams (4) —
import { alligator } from "./billwilliams/alligator";
import { fractals } from "./billwilliams/fractals";
import { gator } from "./billwilliams/gator";
import { marketFacilitationIndex } from "./billwilliams/marketFacilitationIndex";

// — support_resistance (7) —
import { pivotCamarilla } from "./support_resistance/pivotCamarilla";
import { pivotDemark } from "./support_resistance/pivotDemark";
import { pivotFibonacci } from "./support_resistance/pivotFibonacci";
import { pivotHighLow } from "./support_resistance/pivotHighLow";
import { pivotStandard } from "./support_resistance/pivotStandard";
import { pivotWoodie } from "./support_resistance/pivotWoodie";
import { zigzag } from "./support_resistance/zigzag";

export const INDICATORS: IndicatorDef[] = [
  // trend
  adx,
  alma,
  aroon,
  coppock,
  dema,
  dpo,
  ema,
  frama,
  hma,
  ichimoku,
  kama,
  kst,
  macd,
  mcginley,
  psar,
  schaff,
  sma,
  smma,
  supertrend,
  t3,
  tema,
  trix,
  vortex,
  vwma,
  waveTrend,
  wma,
  zlema,
  // momentum
  accelerator,
  awesome,
  bop,
  cci,
  cmo,
  connorsRsi,
  easeOfMovement,
  elderRay,
  fisher,
  forceIndex,
  mfi,
  momentum,
  ppo,
  roc,
  rsi,
  rvi,
  stochRsi,
  stochastic,
  tsi,
  ultimateOsc,
  williamsR,
  // volatility
  atr,
  bbBandwidth,
  bbPercentB,
  bollinger,
  chaikinVol,
  donchian,
  envelopes,
  historicalVol,
  keltner,
  massIndex,
  relativeVolatilityIndex,
  stdErrorBands,
  stddev,
  // volume
  adLine,
  anchoredVwap,
  chaikinOsc,
  cmf,
  klinger,
  nvi,
  obv,
  pvi,
  pvt,
  volume,
  volumeMa,
  volumeOsc,
  vwap,
  vwapBands,
  // billwilliams
  alligator,
  fractals,
  gator,
  marketFacilitationIndex,
  // support_resistance
  pivotCamarilla,
  pivotDemark,
  pivotFibonacci,
  pivotHighLow,
  pivotStandard,
  pivotWoodie,
  zigzag,
];

export function getIndicator(id: string): IndicatorDef | undefined {
  return INDICATORS.find((i) => i.id === id);
}
