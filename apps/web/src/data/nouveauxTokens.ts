/**
 * Découverte de nouveaux tokens (nouveaux contrats) et évaluation fondamentale
 * multi-piliers (Revenus/Frais, Tokenomics/Dilution, Traction/Liquidité, Sécurité Contrat).
 *
 * Architecture :
 *  - Fonctions de parsing, de normalisation d'adresse contrat et de scoring 100 % PURES
 *    (testables hors navigateur sans réseau ni DOM).
 *  - Agrégation réseau résiliente (DefiLlama `/protocols` + `/overview/fees` dailyFees &
 *    dailyRevenue + CoinGecko `/coins/markets` pour FDV/MCap/Supply/Volume + inspection
 *    à la demande du contrat EVM via Etherscan v2 `/ethscanapi/v2/api`).
 *  - Conformité doctrine AXIOM (doc 02) : chaque pilier est explicite et borné (0–25),
 *    les données absentes ne sont jamais extrapolées en zéros avantageux, et les risques
 *    structurels (Low Float / High FDV, absence d'audit, contrat non vérifié ou proxy)
 *    sont signalés explicitement.
 */
import { IS_VERCEL } from "../lib/deployment";
import { withDemoKey } from "./marketOverview";

// ─────────────────────────── Constantes & Référentiels ───────────────────────────

/** Durée de validité du cache mémoire (10 min). */
export const NOUVEAUX_TOKENS_TTL_MS = 10 * 60 * 1000;

const URL_PROTOCOLS = "https://api.llama.fi/protocols";
const URL_FEES_24H =
  "https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyFees";
const URL_REVENUE_24H =
  "https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyRevenue";
const URL_CG_MARKETS =
  (IS_VERCEL ? "/coingeckoapi" : "https://api.coingecko.com/api/v3") +
  "/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h,7d";
const BASE_ETHERSCAN_V2 = "/ethscanapi/v2/api";

const JOUR_MS = 86_400_000;

/** Fenêtres d'ancienneté de listing disponibles dans le filtre UI. */
export const FENETRES_ANCIENNETE = [
  { id: 30, label: "≤ 30 j" },
  { id: 90, label: "≤ 90 j" },
  { id: 180, label: "≤ 180 j" },
  { id: 365, label: "≤ 1 an" },
  { id: 0, label: "Tous (récents d'abord)" },
] as const;

export type FenetreAncienneteJours = (typeof FENETRES_ANCIENNETE)[number]["id"];

/** Chaînes EVM supportées par l'inspecteur Etherscan v2 (chainid). */
export const CHAINES_EVM_ETHERSCAN: Readonly<Record<string, { chainId: number; label: string; explorateur: string }>> = {
  ethereum: { chainId: 1, label: "Ethereum", explorateur: "https://etherscan.io/address/" },
  eth: { chainId: 1, label: "Ethereum", explorateur: "https://etherscan.io/address/" },
  arbitrum: { chainId: 42161, label: "Arbitrum", explorateur: "https://arbiscan.io/address/" },
  base: { chainId: 8453, label: "Base", explorateur: "https://basescan.org/address/" },
  optimism: { chainId: 10, label: "Optimism", explorateur: "https://optimistic.etherscan.io/address/" },
  op: { chainId: 10, label: "Optimism", explorateur: "https://optimistic.etherscan.io/address/" },
  polygon: { chainId: 137, label: "Polygon", explorateur: "https://polygonscan.com/address/" },
  bsc: { chainId: 56, label: "BSC", explorateur: "https://bscscan.com/address/" },
  binance: { chainId: 56, label: "BSC", explorateur: "https://bscscan.com/address/" },
  avax: { chainId: 43114, label: "Avalanche", explorateur: "https://snowtrace.io/address/" },
  avalanche: { chainId: 43114, label: "Avalanche", explorateur: "https://snowtrace.io/address/" },
};

const EXPLORATEURS_NON_EVM: Readonly<Record<string, string>> = {
  solana: "https://solscan.io/token/",
  sui: "https://suiscan.xyz/mainnet/coin/",
  aptos: "https://explorer.aptoslabs.com/account/",
  ton: "https://tonviewer.com/",
  tron: "https://tronscan.org/#/contract/",
};

// ─────────────────────────── Types ───────────────────────────

export type VerdictPotentiel = "potentiel-fort" | "potentiel-modere" | "speculatif" | "risque-eleve";

export interface ContratToken {
  /** Chaîne normalisée du contrat (ex. "Ethereum", "Base", "Solana"). */
  chaine: string;
  /** Adresse brute nettoyée du préfixe de chaîne (ex. "0x1234..." ou adresse SPL). */
  adresse: string;
  /** Format court d'affichage ("0x1234…abcd"). */
  adresseCourte: string;
  /** Est-ce une adresse hexadécimale EVM 20 octets (`0x` + 40 hex) ? */
  estEvm: boolean;
  /** Identifiant de chaîne Etherscan v2 si supporté (null pour Solana/Sui/etc.). */
  chainIdEvm: number | null;
  /** Lien direct vers l'explorateur de bloc (validé http/https). */
  explorateurUrl: string | null;
}

export interface InspectionContratEvm {
  adresse: string;
  chainId: number;
  verifie: boolean;
  nomContrat: string | null;
  compilateur: string | null;
  estProxy: boolean;
  adresseImplementation: string | null;
  supplyBrute: string | null;
  observeLe: number;
}

export interface PiliersPotentiel {
  /** 0–25 : Frais/revenus générés, ratio P/F ou P/S, take-rate, croissance. */
  revenus: number;
  /** 0–25 : Float (MCap/FDV ou Circulating/Total), dilution résiduelle, FDV/TVL. */
  tokenomics: number;
  /** 0–25 : TVL absolue, dynamique TVL 7j, liquidité / rotation du capital. */
  traction: number;
  /** 0–25 : Contrat identifié, audits, architecture originale vs fork, vérification Etherscan. */
  securite: number;
}

export interface EvaluationPotentiel {
  /** Score composite sur 100 (somme des 4 piliers 0–25). */
  scoreTotal: number;
  piliers: PiliersPotentiel;
  verdict: VerdictPotentiel;
  /** Points forts factuels justifiant le potentiel. */
  atouts: string[];
  /** Risques ou angles morts identifiés (dilution, absence de revenus, contrat proxy…). */
  risques: string[];
  /** Ratio Float en % (0–100) : MCap/FDV ou Circulating/Total Supply. */
  floatPct: number | null;
  /** Ratio Price-to-Fees annualisé (FDV ou MCap / Frais annualisés). */
  ratioPf: number | null;
  /** Ratio Price-to-Revenue annualisé (FDV ou MCap / Revenus annualisés). */
  ratioPs: number | null;
  /** Ratio FDV (ou MCap) / TVL. */
  ratioFdvTvl: number | null;
  /** Part des frais captée en revenus par le protocole (%). */
  takeRatePct: number | null;
}

export interface NouveauToken {
  id: string;
  slug: string;
  symbole: string;
  nom: string;
  categorie: string;
  chainePrincipale: string;
  chaines: string[];
  /** Timestamp ms d'apparition / listing sur DefiLlama (null si inconnu). */
  listeLeMs: number | null;
  /** Âge en jours depuis le listing (null si inconnu). */
  ageJours: number | null;
  contrat: ContratToken | null;
  // — Métriques financières & tokenomics —
  prixUsd: number | null;
  mcapUsd: number | null;
  fdvUsd: number | null;
  volume24hUsd: number | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
  maxSupply: number | null;
  changePrix24hPct: number | null;
  changePrix7jPct: number | null;
  // — Métriques on-chain / protocole —
  tvlUsd: number | null;
  tvlChange1dPct: number | null;
  tvlChange7dPct: number | null;
  frais24hUsd: number | null;
  frais7jUsd: number | null;
  frais30jUsd: number | null;
  fraisChange7dPct: number | null;
  revenus24hUsd: number | null;
  revenus7jUsd: number | null;
  revenus30jUsd: number | null;
  revenusChange7dPct: number | null;
  // — Métadonnées de sécurité —
  nbAudits: number;
  auditUrls: string[];
  forkDe: string[];
  siteUrl: string | null;
  // — Évaluation calculée —
  evaluation: EvaluationPotentiel;
}

export interface CatalogueNouveauxTokens {
  tokens: NouveauToken[];
  recupereLe: number;
  perime: boolean;
  sourcesActives: {
    protocols: boolean;
    fees: boolean;
    revenue: boolean;
    coingecko: boolean;
  };
}

// ─────────────────────────── Helpers purs ───────────────────────────

function nombreFini(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function nombrePositif(v: unknown): number | null {
  const n = nombreFini(v);
  return n !== null && n > 0 ? n : null;
}

function chainePropre(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 && s !== "-" ? s : null;
}

/** Valide qu'une URL externe est strictement http: ou https: (garde-fou XSS). PURE. */
export function urlExterneSure(url: unknown): string | null {
  if (typeof url !== "string" || url.trim().length === 0) return null;
  try {
    const u = new URL(url.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Abrège une adresse on-chain pour l'affichage tabulaire ("0x1234…abcd"). PURE. */
export function abregerAdresse(adresse: string): string {
  const s = adresse.trim();
  if (s.length <= 13) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

/**
 * Parse le champ `address` de DefiLlama (ex: "0x...", "arbitrum:0x...", "solana:So11...")
 * et résout la chaîne, le format EVM, le chainId Etherscan et l'URL d'explorateur. PURE.
 */
export function parserContratToken(
  rawAddress: unknown,
  fallbackChain?: string | null,
): ContratToken | null {
  const brut = chainePropre(rawAddress);
  if (brut === null) return null;

  // Certains protocoles listent plusieurs adresses séparées par une virgule : on prend la première.
  const premier = brut.split(",")[0]?.trim() ?? "";
  if (premier.length === 0) return null;

  let prefixeChaine: string | null = null;
  let adresse = premier;
  const idxDeuxPoints = premier.indexOf(":");
  if (idxDeuxPoints > 0) {
    prefixeChaine = premier.slice(0, idxDeuxPoints).trim();
    adresse = premier.slice(idxDeuxPoints + 1).trim();
  }
  if (adresse.length < 8) return null;

  const estEvm = /^0x[a-fA-F0-9]{40}$/.test(adresse);
  const cleChaine = (prefixeChaine ?? fallbackChain ?? (estEvm ? "ethereum" : "")).trim().toLowerCase();

  const evmInfo = CHAINES_EVM_ETHERSCAN[cleChaine] ?? (estEvm && cleChaine === "multi-chain" ? CHAINES_EVM_ETHERSCAN.ethereum : undefined);
  const chaine =
    evmInfo?.label ??
    (prefixeChaine ? prefixeChaine.charAt(0).toUpperCase() + prefixeChaine.slice(1) : fallbackChain && fallbackChain !== "Multi-Chain" ? fallbackChain : estEvm ? "Ethereum" : "On-chain");

  let explorateurUrl: string | null = null;
  if (estEvm && evmInfo) {
    explorateurUrl = `${evmInfo.explorateur}${adresse}`;
  } else if (estEvm) {
    explorateurUrl = `https://etherscan.io/address/${adresse}`;
  } else {
    const baseNonEvm = EXPLORATEURS_NON_EVM[cleChaine];
    if (baseNonEvm) explorateurUrl = `${baseNonEvm}${encodeURIComponent(adresse)}`;
  }

  return {
    chaine,
    adresse,
    adresseCourte: abregerAdresse(adresse),
    estEvm,
    chainIdEvm: estEvm ? (evmInfo?.chainId ?? 1) : null,
    explorateurUrl,
  };
}

// ─────────────────────────── Moteur d'évaluation du potentiel (PUR) ───────────────────────────

export interface EntreeEvaluationPotentiel {
  mcapUsd: number | null;
  fdvUsd: number | null;
  volume24hUsd: number | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
  maxSupply: number | null;
  tvlUsd: number | null;
  tvlChange7dPct: number | null;
  frais24hUsd: number | null;
  frais30jUsd: number | null;
  fraisChange7dPct: number | null;
  revenus24hUsd: number | null;
  revenus30jUsd: number | null;
  revenusChange7dPct: number | null;
  contrat: ContratToken | null;
  nbAudits: number;
  forkDe: readonly string[];
  inspection?: InspectionContratEvm | null;
}

function borner(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(v)));
}

/**
 * Évalue le potentiel fondamental d'un token/contrat sur 4 piliers explicites (0–25 chacun).
 * Fonction 100 % PURE et déterministe.
 */
export function evaluerPotentielToken(entree: EntreeEvaluationPotentiel): EvaluationPotentiel {
  const atouts: string[] = [];
  const risques: string[] = [];

  // Valorisation de référence : FDV en priorité (capte la dilution totale), sinon MCap.
  const valoRef =
    entree.fdvUsd !== null && entree.fdvUsd > 0
      ? entree.fdvUsd
      : entree.mcapUsd !== null && entree.mcapUsd > 0
        ? entree.mcapUsd
        : null;

  // ── 1. PILIER REVENUS & CASH-FLOW (0–25) ──
  const fraisAnn =
    entree.frais30jUsd !== null && entree.frais30jUsd > 0
      ? entree.frais30jUsd * (365 / 30)
      : entree.frais24hUsd !== null && entree.frais24hUsd >= 0
        ? entree.frais24hUsd * 365
        : entree.frais30jUsd !== null && entree.frais30jUsd >= 0
          ? 0
          : null;

  const revAnn =
    entree.revenus30jUsd !== null && entree.revenus30jUsd > 0
      ? entree.revenus30jUsd * (365 / 30)
      : entree.revenus24hUsd !== null && entree.revenus24hUsd >= 0
        ? entree.revenus24hUsd * 365
        : entree.revenus30jUsd !== null && entree.revenus30jUsd >= 0
          ? 0
          : null;

  const ratioPf = valoRef !== null && fraisAnn !== null && fraisAnn > 0 ? valoRef / fraisAnn : null;
  const ratioPs = valoRef !== null && revAnn !== null && revAnn > 0 ? valoRef / revAnn : null;
  // Take-rate calculé sur une fenêtre homogène (30j/30j en priorité, sinon 24h/24h).
  const takeRatePct =
    entree.frais30jUsd !== null &&
    entree.frais30jUsd > 0 &&
    entree.revenus30jUsd !== null &&
    entree.revenus30jUsd >= 0
      ? Math.min(100, (entree.revenus30jUsd / entree.frais30jUsd) * 100)
      : entree.frais24hUsd !== null &&
          entree.frais24hUsd > 0 &&
          entree.revenus24hUsd !== null &&
          entree.revenus24hUsd >= 0
        ? Math.min(100, (entree.revenus24hUsd / entree.frais24hUsd) * 100)
        : null;

  let scoreRevenus = 0;
  const fluxRefAnn = revAnn !== null && revAnn > 0 ? revAnn : fraisAnn;
  if (fluxRefAnn !== null && fluxRefAnn > 0) {
    if (fluxRefAnn >= 10_000_000) scoreRevenus += 10;
    else if (fluxRefAnn >= 1_000_000) scoreRevenus += 7;
    else if (fluxRefAnn >= 100_000) scoreRevenus += 4;
    else if (fluxRefAnn >= 10_000) scoreRevenus += 2;

    const multipleRef = ratioPs ?? ratioPf;
    if (multipleRef !== null) {
      if (multipleRef <= 15) {
        scoreRevenus += 10;
        atouts.push(`Multiple attractif (${ratioPs !== null ? "P/S" : "P/F"} ${multipleRef.toFixed(1)}x)`);
      } else if (multipleRef <= 40) {
        scoreRevenus += 7;
        atouts.push(`Valorisation soutenue par les flux (${multipleRef.toFixed(1)}x)`);
      } else if (multipleRef <= 100) {
        scoreRevenus += 4;
      } else {
        scoreRevenus += 1;
        risques.push(`Multiple élevé vs flux (${multipleRef.toFixed(0)}x)`);
      }
    } else {
      // Flux positifs mais FDV/MCap non publiée : bonus modéré pour la génération de cash-flow réel.
      scoreRevenus += 5;
      atouts.push("Protocole générateur de revenus on-chain");
    }

    if (takeRatePct !== null && takeRatePct >= 25) {
      scoreRevenus += 3;
      atouts.push(`Take-rate élevé (${takeRatePct.toFixed(0)} % des frais captés)`);
    } else if (takeRatePct !== null && takeRatePct > 0) {
      scoreRevenus += 1;
    }

    const croissanceFlux = entree.revenusChange7dPct ?? entree.fraisChange7dPct;
    if (croissanceFlux !== null && croissanceFlux >= 15) {
      scoreRevenus += 2;
    }
  } else {
    risques.push("Aucun revenu ou frais on-chain recensé");
  }
  scoreRevenus = borner(scoreRevenus, 0, 25);

  // ── 2. PILIER TOKENOMICS & DILUTION (0–25) ──
  let floatPct: number | null = null;
  if (
    entree.circulatingSupply !== null &&
    entree.circulatingSupply > 0 &&
    entree.totalSupply !== null &&
    entree.totalSupply > 0
  ) {
    floatPct = Math.min(100, (entree.circulatingSupply / entree.totalSupply) * 100);
  } else if (
    entree.mcapUsd !== null &&
    entree.mcapUsd > 0 &&
    entree.fdvUsd !== null &&
    entree.fdvUsd > 0
  ) {
    floatPct = Math.min(100, (entree.mcapUsd / entree.fdvUsd) * 100);
  }

  const ratioFdvTvl =
    valoRef !== null && entree.tvlUsd !== null && entree.tvlUsd > 0
      ? valoRef / entree.tvlUsd
      : null;

  let scoreTokenomics = 0;
  if (floatPct !== null) {
    if (floatPct >= 70) {
      scoreTokenomics += 15;
      atouts.push(`Float sain (${floatPct.toFixed(0)} % en circulation)`);
    } else if (floatPct >= 40) {
      scoreTokenomics += 10;
    } else if (floatPct >= 15) {
      scoreTokenomics += 4;
      risques.push(`Dilution latente importante (Float ${floatPct.toFixed(0)} %)`);
    } else {
      scoreTokenomics += 0;
      risques.push(`Low Float / High FDV (${floatPct.toFixed(1)} % en circulation)`);
    }
  } else {
    // Sans données de supply circulante/FDV, note prudente plafonnée.
    scoreTokenomics += 6;
  }

  if (ratioFdvTvl !== null) {
    if (ratioFdvTvl <= 1.0) {
      scoreTokenomics += 10;
      atouts.push(`Ratio FDV/TVL décoté (${ratioFdvTvl.toFixed(2)}x)`);
    } else if (ratioFdvTvl <= 3.0) {
      scoreTokenomics += 7;
    } else if (ratioFdvTvl <= 8.0) {
      scoreTokenomics += 4;
    } else {
      risques.push(`FDV/TVL tendu (${ratioFdvTvl.toFixed(1)}x)`);
    }
  } else if (entree.maxSupply !== null && entree.totalSupply !== null && entree.maxSupply === entree.totalSupply) {
    scoreTokenomics += 4;
  } else if (floatPct === null) {
    risques.push("Tokenomics (FDV / offre circulante) non publiées");
  }
  scoreTokenomics = borner(scoreTokenomics, 0, 25);

  // ── 3. PILIER TRACTION, TVL & LIQUIDITÉ (0–25) ──
  let scoreTraction = 0;
  if (entree.tvlUsd !== null && entree.tvlUsd > 0) {
    if (entree.tvlUsd >= 50_000_000) {
      scoreTraction += 10;
      atouts.push("TVL institutionnelle (≥ $50M)");
    } else if (entree.tvlUsd >= 10_000_000) {
      scoreTraction += 8;
    } else if (entree.tvlUsd >= 1_000_000) {
      scoreTraction += 5;
    } else if (entree.tvlUsd >= 100_000) {
      scoreTraction += 2;
    }
  }

  if (entree.tvlChange7dPct !== null) {
    if (entree.tvlChange7dPct >= 20) {
      scoreTraction += 8;
      atouts.push(`Forte traction TVL (+${entree.tvlChange7dPct.toFixed(1)} % sur 7j)`);
    } else if (entree.tvlChange7dPct >= 5) {
      scoreTraction += 5;
    } else if (entree.tvlChange7dPct >= 0) {
      scoreTraction += 2;
    } else if (entree.tvlChange7dPct <= -20) {
      risques.push(`Contraction TVL (${entree.tvlChange7dPct.toFixed(1)} % sur 7j)`);
    }
  }

  const rotationVolMcap =
    entree.volume24hUsd !== null && entree.mcapUsd !== null && entree.mcapUsd > 0
      ? (entree.volume24hUsd / entree.mcapUsd) * 100
      : null;
  const rendementFraisTvl =
    entree.frais24hUsd !== null && entree.tvlUsd !== null && entree.tvlUsd > 0
      ? (entree.frais24hUsd / entree.tvlUsd) * 100
      : null;

  if ((rotationVolMcap !== null && rotationVolMcap >= 10) || (rendementFraisTvl !== null && rendementFraisTvl >= 0.1)) {
    scoreTraction += 7;
    if (rendementFraisTvl !== null && rendementFraisTvl >= 0.15) {
      atouts.push(`Capital très productif (Frais 24h/TVL ${rendementFraisTvl.toFixed(2)} %)`);
    }
  } else if ((rotationVolMcap !== null && rotationVolMcap >= 3) || (rendementFraisTvl !== null && rendementFraisTvl >= 0.02)) {
    scoreTraction += 4;
  }
  scoreTraction = borner(scoreTraction, 0, 25);

  // ── 4. PILIER CONTRAT, SÉCURITÉ & ARCHITECTURE (0–25) ──
  let scoreSecurite = 0;
  if (entree.contrat !== null) {
    scoreSecurite += 8;
  } else {
    risques.push("Adresse de contrat non référencée");
  }

  if (entree.nbAudits > 0) {
    scoreSecurite += 9;
    atouts.push(`Protocole audité (${entree.nbAudits} audit${entree.nbAudits > 1 ? "s" : ""})`);
  } else {
    risques.push("Aucun audit de sécurité référencé");
  }

  if (entree.forkDe.length === 0) {
    scoreSecurite += 5;
  } else {
    scoreSecurite += 2;
    risques.push(`Fork de ${entree.forkDe.slice(0, 2).join(", ")}`);
  }

  if (entree.inspection !== undefined && entree.inspection !== null) {
    if (entree.inspection.verifie) {
      scoreSecurite += 3;
      atouts.push(
        `Contrat vérifié sur Etherscan${entree.inspection.nomContrat ? ` (${entree.inspection.nomContrat})` : ""}`,
      );
    } else {
      scoreSecurite -= 10;
      risques.push("Code source du contrat NON vérifié sur l'explorateur");
    }
    if (entree.inspection.estProxy) {
      scoreSecurite -= 2;
      risques.push("Contrat Proxy (logique modifiable par l'admin)");
    }
  }
  scoreSecurite = borner(scoreSecurite, 0, 25);

  const scoreTotal = scoreRevenus + scoreTokenomics + scoreTraction + scoreSecurite;
  const verdict: VerdictPotentiel =
    scoreTotal >= 70
      ? "potentiel-fort"
      : scoreTotal >= 50
        ? "potentiel-modere"
        : scoreTotal >= 30
          ? "speculatif"
          : "risque-eleve";

  return {
    scoreTotal,
    piliers: {
      revenus: scoreRevenus,
      tokenomics: scoreTokenomics,
      traction: scoreTraction,
      securite: scoreSecurite,
    },
    verdict,
    atouts,
    risques,
    floatPct,
    ratioPf,
    ratioPs,
    ratioFdvTvl,
    takeRatePct,
  };
}

// ─────────────────────────── Parsing & Croisement des sources (PUR) ───────────────────────────

export interface ResumeFluxProtocole {
  total24h: number | null;
  total7d: number | null;
  total30d: number | null;
  change7dPct: number | null;
}

export interface MarcheCoinGecko {
  id: string;
  symbol: string;
  name: string;
  priceUsd: number | null;
  mcapUsd: number | null;
  fdvUsd: number | null;
  volume24hUsd: number | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
  maxSupply: number | null;
  change24hPct: number | null;
  change7dPct: number | null;
}

function cleNormalisee(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function additionnerNullable(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

/**
 * Parse la réponse `/overview/fees` (dailyFees ou dailyRevenue) en dictionnaire indexé
 * par slug, nom normalisé et `parentProtocol` (ex. `parent#aerodrome` → `aerodrome`). PURE.
 */
export function parserFluxOverviewDefiLlama(raw: unknown): Map<string, ResumeFluxProtocole> {
  const map = new Map<string, ResumeFluxProtocole>();
  if (!raw || typeof raw !== "object") return map;
  const protocols = (raw as { protocols?: unknown }).protocols;
  if (!Array.isArray(protocols)) return map;

  for (const item of protocols) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const total24h = nombreFini(rec.total24h);
    const total7d = nombreFini(rec.total7d);
    const total30d = nombreFini(rec.total30d);
    const change7dPct = nombreFini(rec.change_7d);
    if (total24h === null && total7d === null && total30d === null) continue;

    const entree: ResumeFluxProtocole = { total24h, total7d, total30d, change7dPct };
    const cles = new Set<string>();
    for (const champ of [rec.slug, rec.module, rec.name]) {
      if (typeof champ === "string" && champ.trim().length > 0) {
        cles.add(cleNormalisee(champ));
      }
    }
    if (typeof rec.parentProtocol === "string" && rec.parentProtocol.includes("#")) {
      const parentSlug = rec.parentProtocol.split("#")[1];
      if (parentSlug) cles.add(cleNormalisee(parentSlug));
    }

    for (const cle of cles) {
      if (!cle) continue;
      const existant = map.get(cle);
      if (!existant) {
        map.set(cle, entree);
      } else {
        // Agrège les sous-modules d'un même protocole parent (ex. V2 + V3 + Slipstream).
        map.set(cle, {
          total24h: additionnerNullable(existant.total24h, entree.total24h),
          total7d: additionnerNullable(existant.total7d, entree.total7d),
          total30d: additionnerNullable(existant.total30d, entree.total30d),
          change7dPct: existant.change7dPct ?? entree.change7dPct,
        });
      }
    }
  }
  return map;
}

/** Parse la réponse `/coins/markets` de CoinGecko avec les champs FDV et Supply. PURE. */
export function parserMarchesCoinGecko(raw: unknown): MarcheCoinGecko[] {
  if (!Array.isArray(raw)) return [];
  const out: MarcheCoinGecko[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const id = chainePropre(r.id);
    const symbol = chainePropre(r.symbol);
    const name = chainePropre(r.name);
    if (!id || !symbol || !name) continue;
    out.push({
      id: id.toLowerCase(),
      symbol: symbol.toUpperCase(),
      name,
      priceUsd: nombrePositif(r.current_price),
      mcapUsd: nombrePositif(r.market_cap),
      fdvUsd: nombrePositif(r.fully_diluted_valuation),
      volume24hUsd: nombrePositif(r.total_volume),
      circulatingSupply: nombrePositif(r.circulating_supply),
      totalSupply: nombrePositif(r.total_supply),
      maxSupply: nombrePositif(r.max_supply),
      change24hPct: nombreFini(r.price_change_percentage_24h),
      change7dPct: nombreFini(r.price_change_percentage_7d_in_currency),
    });
  }
  return out;
}

/**
 * Construit et évalue la liste des nouveaux tokens / nouveaux contrats à partir des réponses
 * brutes DefiLlama (`/protocols`, `dailyFees`, `dailyRevenue`) et CoinGecko (`/coins/markets`).
 *
 * Retient :
 *  - Les protocoles/tokens dotés d'un contrat on-chain (`address`) OU d'un symbole/token listé
 *    récemment (`listedAt`), hors CEX et bridges purement canoniques sans token.
 *  - Trie par défaut du plus récent (`listedAt` décroissant) puis par score de potentiel.
 * Fonction PURE (`nowMs` injecté).
 */
export function assemblerNouveauxTokens(params: {
  rawProtocols: unknown;
  fraisParCle: ReadonlyMap<string, ResumeFluxProtocole>;
  revenusParCle: ReadonlyMap<string, ResumeFluxProtocole>;
  marchesCg: readonly MarcheCoinGecko[];
  nowMs: number;
  limite?: number;
}): NouveauToken[] {
  const { rawProtocols, fraisParCle, revenusParCle, marchesCg, nowMs, limite = 250 } = params;
  if (!Array.isArray(rawProtocols)) return [];

  const cgParId = new Map<string, MarcheCoinGecko>();
  const cgParSymbole = new Map<string, MarcheCoinGecko>();
  for (const m of marchesCg) {
    cgParId.set(m.id.toLowerCase(), m);
    // Conserve le plus gros MCap en cas de collision de ticker.
    const existant = cgParSymbole.get(m.symbol.toUpperCase());
    if (!existant || (m.mcapUsd ?? 0) > (existant.mcapUsd ?? 0)) {
      cgParSymbole.set(m.symbol.toUpperCase(), m);
    }
  }

  const candidats: NouveauToken[] = [];

  for (const item of rawProtocols) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    const nom = chainePropre(p.name);
    const slug = chainePropre(p.slug);
    if (!nom || !slug) continue;

    const categorie = chainePropre(p.category) ?? "DeFi";
    if (categorie === "CEX") continue;

    const symboleBrut = chainePropre(p.symbol);
    const chainePrincipale = chainePropre(p.chain) ?? "Multi-Chain";
    const chaines = Array.isArray(p.chains)
      ? p.chains.filter((c): c is string => typeof c === "string" && c.trim().length > 0)
      : chainePrincipale !== "Multi-Chain"
        ? [chainePrincipale]
        : [];

    const contrat = parserContratToken(p.address, chaines[0] ?? chainePrincipale);
    const listedAtSec = nombrePositif(p.listedAt);
    const listeLeMs = listedAtSec !== null ? (listedAtSec < 10_000_000_000 ? listedAtSec * 1000 : listedAtSec) : null;
    const ageJours =
      listeLeMs !== null && listeLeMs <= nowMs
        ? Math.max(0, Math.floor((nowMs - listeLeMs) / JOUR_MS))
        : null;

    // On exige soit un contrat on-chain, soit un ticker de token, soit un listing daté récent.
    if (contrat === null && symboleBrut === null && listeLeMs === null) continue;

    const geckoId = chainePropre(p.gecko_id)?.toLowerCase() ?? null;
    const symbole = (symboleBrut ?? slug.slice(0, 6)).toUpperCase();
    // Anti-collision de ticker : si `gecko_id` est connu, on exige une correspondance exacte par ID
    // (évite qu'un nouveau protocole absent du top 250 hérite de la MCap/FDV d'un homonyme).
    // Si `gecko_id` est absent, le repli par symbole n'est accepté que si le nom ou l'ID normalisé concorde.
    const cg = geckoId
      ? cgParId.get(geckoId)
      : symboleBrut
        ? (() => {
            const candidatCg = cgParSymbole.get(symbole);
            if (!candidatCg) return undefined;
            const nomCg = cleNormalisee(candidatCg.name);
            const idCg = cleNormalisee(candidatCg.id);
            const nomProto = cleNormalisee(nom);
            const slugProto = cleNormalisee(slug);
            return nomCg === nomProto || idCg === slugProto ? candidatCg : undefined;
          })()
        : undefined;

    const clesRecherche = [cleNormalisee(slug), cleNormalisee(nom)];
    if (typeof p.parentProtocol === "string" && p.parentProtocol.includes("#")) {
      const parentSlug = p.parentProtocol.split("#")[1];
      if (parentSlug) clesRecherche.push(cleNormalisee(parentSlug));
    }

    let frais: ResumeFluxProtocole | undefined;
    let revenus: ResumeFluxProtocole | undefined;
    for (const c of clesRecherche) {
      if (!frais) frais = fraisParCle.get(c);
      if (!revenus) revenus = revenusParCle.get(c);
    }

    const tvlUsd = nombrePositif(p.tvl);
    const mcapUsd = cg?.mcapUsd ?? nombrePositif(p.mcap);
    const fdvUsd = cg?.fdvUsd ?? nombrePositif(p.fdv);

    // Filtre le bruit : ignore les entrées fantômes sans TVL (< $10k), sans MCap et sans revenus/frais.
    const aActivite =
      (tvlUsd !== null && tvlUsd >= 10_000) ||
      (mcapUsd !== null && mcapUsd >= 50_000) ||
      (frais?.total24h !== null && (frais?.total24h ?? 0) >= 100) ||
      (revenus?.total24h !== null && (revenus?.total24h ?? 0) >= 50);
    if (!aActivite) continue;

    const auditLinks = Array.isArray(p.audit_links)
      ? p.audit_links.map(urlExterneSure).filter((u): u is string => u !== null)
      : [];
    const auditsNum = nombreFini(p.audits);
    const nbAudits = Math.max(auditLinks.length, auditsNum !== null && auditsNum > 0 ? Math.round(auditsNum) : 0);

    const forkDe = Array.isArray(p.forkedFrom)
      ? p.forkedFrom.filter((f): f is string => typeof f === "string" && f.trim().length > 0)
      : [];

    const tvlChange1dPct = nombreFini(p.change_1d);
    const tvlChange7dPct = nombreFini(p.change_7d);
    const frais24hUsd = frais?.total24h ?? null;
    const frais7jUsd = frais?.total7d ?? null;
    const frais30jUsd = frais?.total30d ?? null;
    const fraisChange7dPct = frais?.change7dPct ?? null;
    const revenus24hUsd = revenus?.total24h ?? null;
    const revenus7jUsd = revenus?.total7d ?? null;
    const revenus30jUsd = revenus?.total30d ?? null;
    const revenusChange7dPct = revenus?.change7dPct ?? null;

    const evaluation = evaluerPotentielToken({
      mcapUsd,
      fdvUsd,
      volume24hUsd: cg?.volume24hUsd ?? null,
      circulatingSupply: cg?.circulatingSupply ?? null,
      totalSupply: cg?.totalSupply ?? null,
      maxSupply: cg?.maxSupply ?? null,
      tvlUsd,
      tvlChange7dPct,
      frais24hUsd,
      frais30jUsd,
      fraisChange7dPct,
      revenus24hUsd,
      revenus30jUsd,
      revenusChange7dPct,
      contrat,
      nbAudits,
      forkDe,
    });

    candidats.push({
      id: slug,
      slug,
      symbole,
      nom,
      categorie,
      chainePrincipale: contrat?.chaine ?? (chaines[0] ?? chainePrincipale),
      chaines,
      listeLeMs,
      ageJours,
      contrat,
      prixUsd: cg?.priceUsd ?? null,
      mcapUsd,
      fdvUsd,
      volume24hUsd: cg?.volume24hUsd ?? null,
      circulatingSupply: cg?.circulatingSupply ?? null,
      totalSupply: cg?.totalSupply ?? null,
      maxSupply: cg?.maxSupply ?? null,
      changePrix24hPct: cg?.change24hPct ?? null,
      changePrix7jPct: cg?.change7dPct ?? null,
      tvlUsd,
      tvlChange1dPct,
      tvlChange7dPct,
      frais24hUsd,
      frais7jUsd,
      frais30jUsd,
      fraisChange7dPct,
      revenus24hUsd,
      revenus7jUsd,
      revenus30jUsd,
      revenusChange7dPct,
      nbAudits,
      auditUrls: auditLinks,
      forkDe,
      siteUrl: urlExterneSure(p.url),
      evaluation,
    });
  }

  // Tri initial : protocoles avec `listeLeMs` récent en tête (≤ 365 j), puis par score/revenus.
  candidats.sort((a, b) => {
    const aRecent = a.ageJours !== null && a.ageJours <= 365 ? 1 : 0;
    const bRecent = b.ageJours !== null && b.ageJours <= 365 ? 1 : 0;
    if (aRecent !== bRecent) return bRecent - aRecent;
    if (a.listeLeMs !== null && b.listeLeMs !== null && a.listeLeMs !== b.listeLeMs) {
      return b.listeLeMs - a.listeLeMs;
    }
    return b.evaluation.scoreTotal - a.evaluation.scoreTotal;
  });

  return candidats.slice(0, limite);
}

/**
 * Filtre la liste des nouveaux tokens selon les critères de l'opérateur. PURE.
 */
export function filtrerNouveauxTokens(
  tokens: readonly NouveauToken[],
  filtres: {
    recherche?: string;
    fenetreJours?: FenetreAncienneteJours;
    chaine?: string;
    uniquementAvecContrat?: boolean;
    uniquementAvecRevenus?: boolean;
  },
): NouveauToken[] {
  const q = (filtres.recherche ?? "").trim().toLowerCase();
  const fenetre = filtres.fenetreJours ?? 180;
  const chaine = filtres.chaine && filtres.chaine !== "toutes" ? filtres.chaine.toLowerCase() : null;

  return tokens.filter((t) => {
    if (fenetre > 0) {
      if (t.ageJours === null || t.ageJours > fenetre) return false;
    }
    if (chaine !== null) {
      const matchChaine =
        t.chainePrincipale.toLowerCase() === chaine ||
        t.chaines.some((c) => c.toLowerCase() === chaine);
      if (!matchChaine) return false;
    }
    if (filtres.uniquementAvecContrat && t.contrat === null) return false;
    if (
      filtres.uniquementAvecRevenus &&
      (t.revenus24hUsd === null || t.revenus24hUsd <= 0) &&
      (t.frais24hUsd === null || t.frais24hUsd <= 0)
    ) {
      return false;
    }
    if (q.length > 0) {
      const dansSymbole = t.symbole.toLowerCase().includes(q);
      const dansNom = t.nom.toLowerCase().includes(q);
      const dansCategorie = t.categorie.toLowerCase().includes(q);
      const dansContrat = t.contrat?.adresse.toLowerCase().includes(q) ?? false;
      if (!dansSymbole && !dansNom && !dansCategorie && !dansContrat) return false;
    }
    return true;
  });
}

// ─────────────────────────── Inspection Etherscan v2 (Contrat EVM) ───────────────────────────

/** Parse la réponse `contract/getsourcecode` d'Etherscan v2. PURE. */
export function parserInspectionEtherscan(
  rawSource: unknown,
  rawSupply: unknown,
  adresse: string,
  chainId: number,
  nowMs: number,
): InspectionContratEvm | null {
  if (!rawSource || typeof rawSource !== "object") return null;
  const r = rawSource as { status?: unknown; result?: unknown };
  if (r.status !== "1" || !Array.isArray(r.result) || r.result.length === 0) return null;
  const first = r.result[0] as Record<string, unknown> | undefined;
  if (!first || typeof first !== "object") return null;

  const abi = typeof first.ABI === "string" ? first.ABI : "";
  const sourceCode = typeof first.SourceCode === "string" ? first.SourceCode.trim() : "";
  const verifie = sourceCode.length > 0 && abi !== "Contract source code not verified";
  const nomContrat = chainePropre(first.ContractName);
  const compilateur = chainePropre(first.CompilerVersion);
  const impl = chainePropre(first.Implementation);
  const estProxy = first.Proxy === "1" || impl !== null;

  let supplyBrute: string | null = null;
  if (rawSupply && typeof rawSupply === "object") {
    const s = rawSupply as { status?: unknown; result?: unknown };
    if (s.status === "1" && typeof s.result === "string" && /^\d+$/.test(s.result.trim())) {
      supplyBrute = s.result.trim();
    }
  }

  return {
    adresse,
    chainId,
    verifie,
    nomContrat,
    compilateur,
    estProxy,
    adresseImplementation: impl,
    supplyBrute,
    observeLe: nowMs,
  };
}

const cacheInspection = new Map<string, InspectionContratEvm>();

/**
 * Inspecte un contrat EVM à la demande via Etherscan v2 (`/ethscanapi/v2/api`).
 * Valide strictement le format `0x` + 40 hex avant tout appel réseau.
 */
export async function inspecterContratEvm(
  adresse: string,
  chainId = 1,
  apiKey?: string | null,
  signal?: AbortSignal,
): Promise<InspectionContratEvm | null> {
  const adr = adresse.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(adr)) return null;
  const cleCache = `${chainId}:${adr.toLowerCase()}`;
  const hit = cacheInspection.get(cleCache);
  if (hit) return hit;

  const suffixeCle = apiKey && apiKey.trim().length > 0 ? `&apikey=${encodeURIComponent(apiKey.trim())}` : "";
  const urlSource = `${BASE_ETHERSCAN_V2}?chainid=${chainId}&module=contract&action=getsourcecode&address=${adr}${suffixeCle}`;
  const urlSupply = `${BASE_ETHERSCAN_V2}?chainid=${chainId}&module=stats&action=tokensupply&contractaddress=${adr}${suffixeCle}`;

  try {
    const [resSource, resSupply] = await Promise.all([
      fetch(urlSource, { signal }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(urlSupply, { signal }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    const parsed = parserInspectionEtherscan(resSource, resSupply, adr, chainId, Date.now());
    if (parsed !== null) cacheInspection.set(cleCache, parsed);
    return parsed;
  } catch {
    return null;
  }
}

// ─────────────────────────── Pipeline réseau avec cache ───────────────────────────

let cacheCatalogue: { data: CatalogueNouveauxTokens; ts: number } | null = null;
let promesseCatalogueEnVol: Promise<CatalogueNouveauxTokens> | null = null;

export function _viderCacheNouveauxTokens(): void {
  cacheCatalogue = null;
  promesseCatalogueEnVol = null;
  cacheInspection.clear();
}

/**
 * Charge et croise les protocoles/tokens récents (DefiLlama + CoinGecko).
 * Cache mémoire 10 min ; repli sur le cache périmé si les sources échouent.
 */
export async function chargerNouveauxTokens(opts?: {
  force?: boolean;
  signal?: AbortSignal;
}): Promise<CatalogueNouveauxTokens> {
  if (opts?.signal?.aborted) {
    throw new DOMException("Requête annulée", "AbortError");
  }
  const now = Date.now();
  if (!opts?.force && cacheCatalogue !== null && now - cacheCatalogue.ts < NOUVEAUX_TOKENS_TTL_MS) {
    return cacheCatalogue.data;
  }
  if (!opts?.force && promesseCatalogueEnVol !== null) {
    return promesseCatalogueEnVol;
  }

  // La promesse mutualisée n'attache pas le `signal` d'un seul appelant aux `fetch` partagés
  // afin que le démontage d'un composant n'annule pas le chargement pour un autre abonné.
  const executer = async (): Promise<CatalogueNouveauxTokens> => {
    const [rawProtocols, rawFees, rawRevenue, rawCg] = await Promise.all([
      fetch(URL_PROTOCOLS)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch(URL_FEES_24H)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch(URL_REVENUE_24H)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch(withDemoKey(URL_CG_MARKETS))
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]);

    if (!Array.isArray(rawProtocols)) {
      if (cacheCatalogue !== null) {
        return { ...cacheCatalogue.data, perime: true };
      }
      throw new Error("Catalogue des nouveaux tokens/contrats indisponible (DefiLlama injoignable).");
    }

    const fraisParCle = parserFluxOverviewDefiLlama(rawFees);
    const revenusParCle = parserFluxOverviewDefiLlama(rawRevenue);
    const marchesCg = parserMarchesCoinGecko(rawCg);
    const recupereLe = Date.now();

    const tokens = assemblerNouveauxTokens({
      rawProtocols,
      fraisParCle,
      revenusParCle,
      marchesCg,
      nowMs: recupereLe,
      limite: 300,
    });

    const data: CatalogueNouveauxTokens = {
      tokens,
      recupereLe,
      perime: false,
      sourcesActives: {
        protocols: true,
        fees: fraisParCle.size > 0,
        revenue: revenusParCle.size > 0,
        coingecko: marchesCg.length > 0,
      },
    };
    cacheCatalogue = { data, ts: recupereLe };
    return data;
  };

  const p = executer().finally(() => {
    if (promesseCatalogueEnVol === p) promesseCatalogueEnVol = null;
  });
  promesseCatalogueEnVol = p;
  return p;
}
