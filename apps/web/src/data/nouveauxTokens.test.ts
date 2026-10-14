import { describe, expect, it } from "vitest";
import {
  abregerAdresse,
  analyserFonctionsSensiblesAbi,
  assemblerNouveauxTokens,
  detecterDivergenceFondamentale,
  evaluerPotentielToken,
  filtrerNouveauxTokens,
  parserContratToken,
  parserFluxOverviewDefiLlama,
  parserInspectionEtherscan,
  parserMarchesCoinGecko,
  qualifierProfondeurLiquidite,
  urlExterneSure,
} from "./nouveauxTokens";

describe("nouveauxTokens — parsing de contrat on-chain", () => {
  it("parse une adresse EVM préfixée par chaîne et résout chainId + explorateur", () => {
    const c = parserContratToken("base:0x940181a94a35a4569e4529a3cdfb74e38fd98631");
    expect(c).not.toBeNull();
    expect(c?.chaine).toBe("Base");
    expect(c?.estEvm).toBe(true);
    expect(c?.chainIdEvm).toBe(8453);
    expect(c?.adresse).toBe("0x940181a94a35a4569e4529a3cdfb74e38fd98631");
    expect(c?.adresseCourte).toBe("0x9401…8631");
    expect(c?.explorateurUrl).toBe(
      "https://basescan.org/address/0x940181a94a35a4569e4529a3cdfb74e38fd98631",
    );
  });

  it("utilise la chaîne de repli quand l'adresse EVM n'a pas de préfixe", () => {
    const c = parserContratToken("0x912ce59144191c1204e64559fe8253a0e49e6548", "Arbitrum");
    expect(c?.chaine).toBe("Arbitrum");
    expect(c?.estEvm).toBe(true);
    expect(c?.chainIdEvm).toBe(42161);
    expect(c?.explorateurUrl).toContain("arbiscan.io/address/0x912ce5");
  });

  it("reconnaît un contrat non-EVM (Solana SPL) sans lui attribuer de chainId EVM", () => {
    const c = parserContratToken("solana:JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN");
    expect(c?.chaine).toBe("Solana");
    expect(c?.estEvm).toBe(false);
    expect(c?.chainIdEvm).toBeNull();
    expect(c?.explorateurUrl).toBe(
      "https://solscan.io/token/JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    );
  });

  it("rejette les valeurs vides, tirets ou adresses tronquées", () => {
    expect(parserContratToken(null)).toBeNull();
    expect(parserContratToken("-")).toBeNull();
    expect(parserContratToken("   ")).toBeNull();
    expect(parserContratToken("0x1234")).toBeNull();
  });

  it("filtre les URLs externes non http/https (protection XSS)", () => {
    expect(urlExterneSure("https://audit.example.com/report.pdf")).toBe(
      "https://audit.example.com/report.pdf",
    );
    expect(urlExterneSure("javascript:alert(1)")).toBeNull();
    expect(urlExterneSure("data:text/html,test")).toBeNull();
    expect(abregerAdresse("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
  });
});

describe("nouveauxTokens — moteur d'évaluation du potentiel (4 piliers)", () => {
  it("attribue un verdict 'potentiel-fort' (≥ 70/100) à un protocole rentable, à float sain et audité", () => {
    const contrat = parserContratToken("base:0x940181a94a35a4569e4529a3cdfb74e38fd98631");
    const evalForte = evaluerPotentielToken({
      mcapUsd: 80_000_000,
      fdvUsd: 100_000_000,
      volume24hUsd: 25_000_000,
      circulatingSupply: 80_000_000,
      totalSupply: 100_000_000,
      maxSupply: 100_000_000,
      tvlUsd: 120_000_000,
      tvlChange7dPct: 28,
      frais24hUsd: 80_000,
      frais30jUsd: 2_400_000, // ~29.2M$/an
      fraisChange7dPct: 22,
      revenus24hUsd: 40_000,
      revenus30jUsd: 1_200_000, // ~14.6M$/an -> P/S ~6.85x, Take-rate 50%
      revenusChange7dPct: 25,
      contrat,
      nbAudits: 2,
      forkDe: [],
    });

    expect(evalForte.scoreTotal).toBeGreaterThanOrEqual(80);
    expect(evalForte.verdict).toBe("potentiel-fort");
    expect(evalForte.piliers.revenus).toBeGreaterThanOrEqual(20);
    expect(evalForte.piliers.tokenomics).toBeGreaterThanOrEqual(20);
    expect(evalForte.piliers.traction).toBeGreaterThanOrEqual(20);
    expect(evalForte.piliers.securite).toBeGreaterThanOrEqual(20);
    expect(evalForte.floatPct).toBeCloseTo(80, 1);
    expect(evalForte.takeRatePct).toBeCloseTo(50, 1);
    expect(evalForte.ratioPs).not.toBeNull();
    expect(evalForte.ratioPs!).toBeLessThan(10);
    expect(evalForte.atouts.some((a) => a.includes("Multiple attractif"))).toBe(true);
    expect(evalForte.atouts.some((a) => a.includes("Float sain"))).toBe(true);
  });

  it("détecte et pénalise un token 'Low Float / High FDV' sans revenus ni audit", () => {
    const evalRisque = evaluerPotentielToken({
      mcapUsd: 15_000_000,
      fdvUsd: 300_000_000, // Float = 5%
      volume24hUsd: 200_000,
      circulatingSupply: 5_000_000,
      totalSupply: 100_000_000,
      maxSupply: 100_000_000,
      tvlUsd: 500_000, // FDV/TVL = 600x
      tvlChange7dPct: -25,
      frais24hUsd: null,
      frais30jUsd: null,
      fraisChange7dPct: null,
      revenus24hUsd: null,
      revenus30jUsd: null,
      revenusChange7dPct: null,
      contrat: null,
      nbAudits: 0,
      forkDe: ["Uniswap V2"],
    });

    expect(evalRisque.scoreTotal).toBeLessThan(30);
    expect(evalRisque.verdict).toBe("risque-eleve");
    expect(evalRisque.floatPct).toBeCloseTo(5, 1);
    expect(evalRisque.risques.some((r) => r.includes("Low Float / High FDV"))).toBe(true);
    expect(evalRisque.risques.some((r) => r.includes("Aucun revenu ou frais"))).toBe(true);
    expect(evalRisque.risques.some((r) => r.includes("Aucun audit"))).toBe(true);
  });

  it("ajuste le pilier sécurité selon l'inspection Etherscan v2 (code non vérifié vs vérifié + proxy)", () => {
    const contrat = parserContratToken("ethereum:0x1111111111111111111111111111111111111111");
    const base = {
      mcapUsd: 20_000_000,
      fdvUsd: 25_000_000,
      volume24hUsd: 2_000_000,
      circulatingSupply: 80,
      totalSupply: 100,
      maxSupply: 100,
      tvlUsd: 15_000_000,
      tvlChange7dPct: 10,
      frais24hUsd: 10_000,
      frais30jUsd: 300_000,
      fraisChange7dPct: 5,
      revenus24hUsd: 5_000,
      revenus30jUsd: 150_000,
      revenusChange7dPct: 5,
      contrat,
      nbAudits: 1,
      forkDe: [],
    };

    const avecVerifie = evaluerPotentielToken({
      ...base,
      inspection: {
        adresse: contrat!.adresse,
        chainId: 1,
        verifie: true,
        nomContrat: "VaultToken",
        compilateur: "v0.8.24",
        estProxy: false,
        adresseImplementation: null,
        supplyBrute: "100000000000000000000000000",
        observeLe: 1_700_000_000_000,
      },
    });

    const avecNonVerifieProxy = evaluerPotentielToken({
      ...base,
      inspection: {
        adresse: contrat!.adresse,
        chainId: 1,
        verifie: false,
        nomContrat: null,
        compilateur: null,
        estProxy: true,
        adresseImplementation: "0x2222222222222222222222222222222222222222",
        supplyBrute: null,
        observeLe: 1_700_000_000_000,
      },
    });

    expect(avecVerifie.piliers.securite).toBeGreaterThan(avecNonVerifieProxy.piliers.securite);
    expect(avecNonVerifieProxy.risques.some((r) => r.includes("NON vérifié"))).toBe(true);
    expect(avecNonVerifieProxy.risques.some((r) => r.includes("Proxy"))).toBe(true);
  });
});

describe("nouveauxTokens — croisement DefiLlama + CoinGecko + Etherscan et filtrage", () => {
  it("agrège les flux par protocole parent et croise avec CoinGecko", () => {
    const nowMs = 1_750_000_000_000;
    const ilYA15JoursSec = Math.floor((nowMs - 15 * 86_400_000) / 1000);
    const ilYA200JoursSec = Math.floor((nowMs - 200 * 86_400_000) / 1000);

    const rawFees = {
      protocols: [
        {
          slug: "hyper-dex-spot",
          name: "HyperDex Spot",
          parentProtocol: "parent#hyper-dex",
          total24h: 120_000,
          total7d: 800_000,
          total30d: 3_200_000,
          change_7d: 18,
        },
        {
          slug: "hyper-dex-perps",
          name: "HyperDex Perps",
          parentProtocol: "parent#hyper-dex",
          total24h: 80_000,
          total7d: 500_000,
          total30d: 2_000_000,
          change_7d: 18,
        },
      ],
    };

    const rawRev = {
      protocols: [
        {
          slug: "hyper-dex",
          name: "HyperDex",
          total24h: 100_000,
          total7d: 650_000,
          total30d: 2_600_000,
          change_7d: 22,
        },
      ],
    };

    const rawCg = [
      {
        id: "hyper-dex-token",
        symbol: "hdex",
        name: "HyperDex",
        current_price: 2.5,
        market_cap: 150_000_000,
        fully_diluted_valuation: 200_000_000,
        total_volume: 45_000_000,
        circulating_supply: 60_000_000,
        total_supply: 80_000_000,
        max_supply: 80_000_000,
        price_change_percentage_24h: 8.4,
        price_change_percentage_7d_in_currency: 19.2,
      },
    ];

    const rawProtocols = [
      {
        name: "HyperDex",
        slug: "hyper-dex",
        symbol: "HDEX",
        gecko_id: "hyper-dex-token",
        category: "Dexs",
        chain: "Arbitrum",
        chains: ["Arbitrum", "Base"],
        address: "arbitrum:0x912ce59144191c1204e64559fe8253a0e49e6548",
        listedAt: ilYA15JoursSec,
        tvl: 95_000_000,
        change_1d: 3.2,
        change_7d: 24.5,
        audits: "2",
        audit_links: ["https://example.com/audit.pdf"],
        forkedFrom: [],
        url: "https://hyperdex.example.com",
      },
      {
        name: "OldNoRev",
        slug: "old-no-rev",
        symbol: "OLD",
        category: "Yield",
        chain: "Ethereum",
        chains: ["Ethereum"],
        address: null,
        listedAt: ilYA200JoursSec,
        tvl: 25_000,
        audits: "0",
        forkedFrom: ["Compound"],
      },
    ];

    const fraisParCle = parserFluxOverviewDefiLlama(rawFees);
    const revenusParCle = parserFluxOverviewDefiLlama(rawRev);
    const marchesCg = parserMarchesCoinGecko(rawCg);

    const tokens = assemblerNouveauxTokens({
      rawProtocols,
      fraisParCle,
      revenusParCle,
      marchesCg,
      nowMs,
    });

    expect(tokens).toHaveLength(2);
    const hdex = tokens[0]!;
    expect(hdex.symbole).toBe("HDEX");
    expect(hdex.ageJours).toBe(15);
    expect(hdex.frais24hUsd).toBe(200_000); // 120k + 80k agrégés via parent#hyper-dex
    expect(hdex.revenus24hUsd).toBe(100_000);
    expect(hdex.mcapUsd).toBe(150_000_000);
    expect(hdex.fdvUsd).toBe(200_000_000);
    expect(hdex.evaluation.floatPct).toBeCloseTo(75, 1);
    expect(hdex.evaluation.verdict).toBe("potentiel-fort");

    // Filtrage par âge ≤ 30j
    const recents30j = filtrerNouveauxTokens(tokens, { fenetreJours: 30 });
    expect(recents30j).toHaveLength(1);
    expect(recents30j[0]?.slug).toBe("hyper-dex");

    // Filtrage par adresse de contrat partielle
    const parContrat = filtrerNouveauxTokens(tokens, {
      fenetreJours: 0,
      recherche: "0x912ce591",
    });
    expect(parContrat).toHaveLength(1);
    expect(parContrat[0]?.symbole).toBe("HDEX");

    // Filtrage uniquementAvecRevenus
    const avecRev = filtrerNouveauxTokens(tokens, {
      fenetreJours: 0,
      uniquementAvecRevenus: true,
    });
    expect(avecRev).toHaveLength(1);
    expect(avecRev[0]?.symbole).toBe("HDEX");
  });

  it("parse correctement la réponse Etherscan v2 getsourcecode + tokensupply", () => {
    const rawSource = {
      status: "1",
      result: [
        {
          SourceCode: "contract HyperToken { ... }",
          ABI: '[{"inputs":[],"name":"totalSupply"}]',
          ContractName: "HyperToken",
          CompilerVersion: "v0.8.20+commit.a1b79de6",
          Proxy: "1",
          Implementation: "0x9999999999999999999999999999999999999999",
        },
      ],
    };
    const rawSupply = {
      status: "1",
      result: "1000000000000000000000000",
    };

    const insp = parserInspectionEtherscan(
      rawSource,
      rawSupply,
      "0x1111111111111111111111111111111111111111",
      8453,
      1_750_000_000_000,
    );

    expect(insp).not.toBeNull();
    expect(insp?.verifie).toBe(true);
    expect(insp?.nomContrat).toBe("HyperToken");
    expect(insp?.estProxy).toBe(true);
    expect(insp?.adresseImplementation).toBe("0x9999999999999999999999999999999999999999");
    expect(insp?.supplyBrute).toBe("1000000000000000000000000");
  });

  it("empêche une collision de ticker CoinGecko d'attribuer la MCap/FDV d'un homonyme du top 250", () => {
    const nowMs = 1_750_000_000_000;
    const marchesCg = parserMarchesCoinGecko([
      {
        id: "uniswap",
        symbol: "uni",
        name: "Uniswap",
        current_price: 10,
        market_cap: 6_000_000_000,
        fully_diluted_valuation: 10_000_000_000,
        total_volume: 200_000_000,
        circulating_supply: 600_000_000,
        total_supply: 1_000_000_000,
        max_supply: 1_000_000_000,
      },
    ]);

    const tokens = assemblerNouveauxTokens({
      rawProtocols: [
        {
          name: "UniClone Mini",
          slug: "uniclone-mini",
          symbol: "UNI", // Même symbole qu'Uniswap mais gecko_id distinct absent du top 250
          gecko_id: "uniclone-mini-token",
          category: "Dexs",
          chain: "Base",
          address: "base:0x1234567890abcdef1234567890abcdef12345678",
          listedAt: Math.floor((nowMs - 5 * 86_400_000) / 1000),
          tvl: 500_000,
          mcap: 400_000,
        },
      ],
      fraisParCle: new Map(),
      revenusParCle: new Map(),
      marchesCg,
      nowMs,
    });

    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.mcapUsd).toBe(400_000);
    expect(tokens[0]?.fdvUsd).toBeNull();
  });

  it("calcule le takeRatePct uniquement sur des fenêtres homogènes (30j/30j ou 24h/24h)", () => {
    const evalHeterogene = evaluerPotentielToken({
      mcapUsd: 10_000_000,
      fdvUsd: 15_000_000,
      volume24hUsd: 1_000_000,
      circulatingSupply: 66,
      totalSupply: 100,
      maxSupply: 100,
      tvlUsd: 5_000_000,
      tvlChange7dPct: 5,
      frais24hUsd: null,
      frais30jUsd: 300_000, // Seul 30j est connu pour les frais
      fraisChange7dPct: null,
      revenus24hUsd: 20_000, // Seul 24h est connu pour les revenus
      revenus30jUsd: null,
      revenusChange7dPct: null,
      contrat: null,
      nbAudits: 0,
      forkDe: [],
    });

    expect(evalHeterogene.takeRatePct).toBeNull();
  });

  it("analyse les fonctions sensibles d'une ABI Etherscan (mint, blacklist, taxes, pause, Ownable)", () => {
    const abiRisquee = JSON.stringify([
      { type: "function", name: "totalSupply", stateMutability: "view" },
      { type: "function", name: "mint", stateMutability: "nonpayable" },
      { type: "function", name: "setBlacklist", stateMutability: "nonpayable" },
      { type: "function", name: "setBuyTax", stateMutability: "nonpayable" },
      { type: "function", name: "pause", stateMutability: "nonpayable" },
      { type: "function", name: "transferOwnership", stateMutability: "nonpayable" },
    ]);
    const res = analyserFonctionsSensiblesAbi(abiRisquee);
    expect(res.nbFonctions).toBe(6);
    expect(res.peutMint).toBe(true);
    expect(res.peutBlacklist).toBe(true);
    expect(res.peutModifierTaxes).toBe(true);
    expect(res.peutPause).toBe(true);
    expect(res.aControleProprietaire).toBe(true);
    expect(res.niveauRisqueAbi).toBe("eleve");
    expect(res.fonctionsSensibles).toEqual(["mint", "setBlacklist", "setBuyTax", "pause"]);

    const abiPropre = JSON.stringify([
      { type: "function", name: "totalSupply", stateMutability: "view" },
      { type: "function", name: "transfer", stateMutability: "nonpayable" },
      { type: "function", name: "approve", stateMutability: "nonpayable" },
    ]);
    const resPropre = analyserFonctionsSensiblesAbi(abiPropre);
    expect(resPropre.nbFonctions).toBe(3);
    expect(resPropre.niveauRisqueAbi).toBe("faible");
    expect(resPropre.fonctionsSensibles).toHaveLength(0);
  });

  it("détecte les divergences fondamentales (Accumulation Revenus vs Prix & Surchauffe Low-Float)", () => {
    const accum = detecterDivergenceFondamentale({
      changePrix24hPct: -4.2,
      changePrix7jPct: -8.5,
      frais24hUsd: 80_000,
      frais30jUsd: 2_100_000,
      fraisChange7dPct: 18,
      revenus24hUsd: 25_000,
      revenus30jUsd: 650_000,
      revenusChange7dPct: 22,
      floatPct: 68,
      ratioPf: 6.5,
      ratioPs: 14.2,
      ratioFdvTvl: 1.1,
    });
    expect(accum?.type).toBe("accumulation-fondamentale");
    expect(accum?.direction).toBe("haussier");

    const surchauffe = detecterDivergenceFondamentale({
      changePrix24hPct: 14.5,
      changePrix7jPct: 32,
      frais24hUsd: 200,
      frais30jUsd: 4_000,
      fraisChange7dPct: -5,
      revenus24hUsd: 0,
      revenus30jUsd: 0,
      revenusChange7dPct: null,
      floatPct: 11.5,
      ratioPf: 450,
      ratioPs: null,
      ratioFdvTvl: 18.4,
    });
    expect(surchauffe?.type).toBe("surchauffe-low-float");
    expect(surchauffe?.direction).toBe("baissier");

    expect(qualifierProfondeurLiquidite(40_000_000, 12_000_000)).toBe("profonde");
    expect(qualifierProfondeurLiquidite(50_000, 10_000)).toBe("illiquide");
  });
});
