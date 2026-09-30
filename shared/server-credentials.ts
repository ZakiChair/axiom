/** Contrat public : identifiants et noms de variables, jamais de valeurs de clés. */
export const PROVIDER_ENV = {
  fred: "FRED_API_KEY",
  coinalyze: "COINALYZE_API_KEY",
  twelvedata: "TWELVE_DATA_KEY",
  sosovalue: "SOSOVALUE_API_KEY",
  etherscan: "ETHERSCAN_API_KEY",
  bgeometrics: "BGEOMETRICS_API_KEY",
  cryptoquant: "CRYPTOQUANT_API_KEY",
  ccdata: "CCDATA_API_KEY",
  defillama: "DEFILLAMA_API_KEY",
  finnhub: "FINNHUB_API_KEY",
  coingecko: "COINGECKO_API_KEY",
} as const;

export type ProviderId = keyof typeof PROVIDER_ENV;
export type ProviderCapabilities = Record<ProviderId, boolean>;
export interface ServerCredentialsConfig { providers: ProviderCapabilities }
export const PROVIDER_IDS = Object.keys(PROVIDER_ENV) as ProviderId[];
