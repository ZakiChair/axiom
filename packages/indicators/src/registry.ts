/**
 * @axiom/indicators — registry.ts
 *
 * Registre central des indicateurs disponibles.
 * Câblage final : importe chaque `IndicatorDef` depuis son fichier dédié et
 * peuple la liste `INDICATORS`. `getIndicator` permet la résolution par id.
 *
 * 155 indicateurs câblés (TS pur, source de vérité unique — cf. BUILD-CONTRACT).
 */

import type { IndicatorDef } from "@axiom/types";

// — trend —
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
import { linreg } from "./trend/linreg";
import { efficiencyRatio } from "./trend/efficiencyRatio";
import { sslChannel } from "./trend/sslChannel";
import { halfTrend } from "./trend/halfTrend";
import { waddahAttar } from "./trend/waddahAttar";
import { heikinAshi } from "./trend/heikinAshi";
import { elderImpulse } from "./trend/elderImpulse";
import { gmma } from "./trend/gmma";
import { gannHilo } from "./trend/gannHilo";

// — momentum —
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
import { qqe } from "./momentum/qqe";
import { smi } from "./momentum/smi";
import { randomWalk } from "./momentum/randomWalk";
import { fearGreed } from "./momentum/fearGreed";
import { disparity } from "./momentum/disparity";
import { btcDominance } from "./momentum/btcDominance";
import { kdj } from "./momentum/kdj";
import { rsiDivergence } from "./momentum/rsiDivergence";

// — volatility —
import { atr } from "./volatility/atr";
import { atrRegime } from "./volatility/atrRegime";
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
import { rv } from "./volatility/rv";
import { stdErrorBands } from "./volatility/stdErrorBands";
import { stddev } from "./volatility/stddev";
import { ttmSqueeze } from "./volatility/ttmSqueeze";
import { atrPct } from "./volatility/atrPct";
import { parkinsonVol } from "./volatility/parkinsonVol";
import { choppiness } from "./volatility/choppiness";
import { ulcerIndex } from "./volatility/ulcerIndex";
import { hurst } from "./volatility/hurst";
import { vhf } from "./volatility/vhf";
import { priceZScore } from "./volatility/priceZScore";

// — statistical —
import { rollingCorrelation } from "./statistical/rollingCorrelation";
import { betaRef } from "./statistical/betaRef";
import { spreadZScore } from "./statistical/spreadZScore";

// — volume + orderflow (fichiers sous volume/ ou orderflow/ selon la catégorie UI) —
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
import { cvd } from "./orderflow/cvd";
import { cvdDivergence } from "./orderflow/cvdDivergence";
import { volumeDelta } from "./volume/volumeDelta";
import { takerBuyRatio } from "./volume/takerBuyRatio";
import { cvdSpotPerp } from "./orderflow/cvdSpotPerp";
import { relativeVolume } from "./volume/relativeVolume";
import { volumeZScore } from "./volume/volumeZScore";
import { netVolume } from "./volume/netVolume";
import { twiggsMf } from "./volume/twiggsMf";
import { vfi } from "./volume/vfi";

// — billwilliams —
import { alligator } from "./billwilliams/alligator";
import { fractals } from "./billwilliams/fractals";
import { gator } from "./billwilliams/gator";
import { marketFacilitationIndex } from "./billwilliams/marketFacilitationIndex";

// — support_resistance —
import { pivotCamarilla } from "./support_resistance/pivotCamarilla";
import { pivotDemark } from "./support_resistance/pivotDemark";
import { pivotFibonacci } from "./support_resistance/pivotFibonacci";
import { pivotHighLow } from "./support_resistance/pivotHighLow";
import { pivotStandard } from "./support_resistance/pivotStandard";
import { pivotWoodie } from "./support_resistance/pivotWoodie";
import { zigzag } from "./support_resistance/zigzag";
import { chandelierExit } from "./support_resistance/chandelierExit";
import { chandeKrollStop } from "./support_resistance/chandeKrollStop";

// — derivatives —
import { fundingRate } from "./derivatives/fundingRate";
import { fundingZScore } from "./derivatives/fundingZScore";
import { mvrv } from "./derivatives/mvrv";
import { nvt } from "./derivatives/nvt";
import { openInterest } from "./derivatives/openInterest";
import { stablecoinSupply } from "./derivatives/stablecoinSupply";
import { fundingApr } from "./derivatives/fundingApr";
import { oiChange } from "./derivatives/oiChange";
import { basisPct } from "./derivatives/basisPct";
import { mvrvZScore } from "./derivatives/mvrvZScore";
import { fundingNotional } from "./derivatives/fundingNotional";
import { ssr } from "./derivatives/ssr";
import { nupl } from "./derivatives/nupl";
import { puell } from "./derivatives/puell";
import { sopr } from "./derivatives/sopr";
import { reserveRisk } from "./derivatives/reserveRisk";
import { quarterlyBasis } from "./derivatives/quarterlyBasis";
import { realizedPrice } from "./derivatives/realizedPrice";
import { lsAccountRatio } from "./derivatives/lsAccountRatio";
import { lsTopTraderRatio } from "./derivatives/lsTopTraderRatio";
import { takerBuySellRatio } from "./derivatives/takerBuySellRatio";
import { asopr } from "./derivatives/asopr";
import { sthSopr } from "./derivatives/sthSopr";
import { lthSopr } from "./derivatives/lthSopr";
import { rhodlRatio } from "./derivatives/rhodlRatio";
import { cvdd } from "./derivatives/cvdd";
import { balancedPrice } from "./derivatives/balancedPrice";

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
  linreg,
  efficiencyRatio,
  sslChannel,
  halfTrend,
  waddahAttar,
  heikinAshi,
  elderImpulse,
  gmma,
  gannHilo,
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
  qqe,
  smi,
  randomWalk,
  fearGreed,
  disparity,
  btcDominance,
  kdj,
  rsiDivergence,
  // volatility
  atr,
  atrRegime,
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
  rv,
  stdErrorBands,
  stddev,
  ttmSqueeze,
  atrPct,
  parkinsonVol,
  choppiness,
  ulcerIndex,
  hurst,
  vhf,
  priceZScore,
  // statistical (cross-asset vs symbole de référence)
  rollingCorrelation,
  betaRef,
  spreadZScore,
  // volume (classique)
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
  relativeVolume,
  volumeZScore,
  twiggsMf,
  vfi,
  // orderflow (menu dédié — edge crypto)
  cvd,
  cvdDivergence,
  volumeDelta,
  takerBuyRatio,
  netVolume,
  cvdSpotPerp,
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
  chandelierExit,
  chandeKrollStop,
  // derivatives
  openInterest,
  fundingRate,
  stablecoinSupply,
  nvt,
  mvrv,
  fundingZScore,
  fundingApr,
  oiChange,
  basisPct,
  mvrvZScore,
  fundingNotional,
  ssr,
  nupl,
  puell,
  sopr,
  reserveRisk,
  quarterlyBasis,
  realizedPrice,
  lsAccountRatio,
  lsTopTraderRatio,
  takerBuySellRatio,
  asopr,
  sthSopr,
  lthSopr,
  rhodlRatio,
  cvdd,
  balancedPrice,
];

export function getIndicator(id: string): IndicatorDef | undefined {
  return INDICATORS.find((i) => i.id === id);
}
