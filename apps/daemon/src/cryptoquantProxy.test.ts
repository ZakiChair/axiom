/**
 * Politique partagée de la route /cqapi (shared/cryptoquant-proxy.ts) : table exhaustive
 * des chemins et paramètres acceptés ou refusés, et du prédicat de clé. Module pur, sans réseau.
 */
import { describe, expect, test } from "bun:test";
import {
  CRYPTOQUANT_HOST,
  CRYPTOQUANT_PREFIXE,
  ENTETES_RELAYES_CQ,
  IDS_MINEURS_CQ,
  cheminCryptoQuantAmont,
  cleCryptoQuantValide,
} from "../../../shared/cryptoquant-proxy";

const SPOT = "/cqapi/v2/market/cq/spot/trade";
const SWAP = "/cqapi/v2/market/cq/swap/trade";
const MINEURS = "/cqapi/v1/btc/miner-data/companies";

describe("shared/cryptoquant-proxy — constantes", () => {
  test("hôte, préfixe et neuf identifiants de sociétés dans l'ordre du fournisseur", () => {
    expect(CRYPTOQUANT_HOST).toBe("api.cryptoquant.com");
    expect(CRYPTOQUANT_PREFIXE).toBe("/cqapi");
    expect([...IDS_MINEURS_CQ]).toEqual(["bitf", "cipher", "clsk", "core", "hive", "iren", "mara", "riot", "wulf"]);
  });

  test("le module partagé n'importe rien et ne lit aucun environnement (il est embarqué par la fonction Vercel)", async () => {
    const source = await Bun.file(new URL("../../../shared/cryptoquant-proxy.ts", import.meta.url)).text();
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/\brequire\(/);
    expect(source).not.toMatch(/\b(?:process|Bun|Deno)\.env\b/);
    expect(source).not.toMatch(/\bimport\.meta\.env\b/);
  });

  test("ENTETES_RELAYES_CQ : liste FERMÉE des quatre en-têtes amont, dans l'ordre — source unique pour le daemon et Vercel (plus de liste recopiée)", async () => {
    expect([...ENTETES_RELAYES_CQ]).toEqual([
      "x-ratelimit-limit",
      "x-ratelimit-remaining",
      "x-ratelimit-reset",
      "x-credit-cost",
    ]);
    const daemonSource = await Bun.file(new URL("../../../apps/daemon/src/proxy.ts", import.meta.url)).text();
    const vercelSource = await Bun.file(new URL("../../../api/proxy.ts", import.meta.url)).text();
    expect(daemonSource).not.toMatch(/"x-ratelimit-limit"/);
    expect(vercelSource).not.toMatch(/"x-ratelimit-limit"/);
  });
});

describe("cheminCryptoQuantAmont — acceptés (query normalisée : symbol|miner, window, limit)", () => {
  test.each([
    {
      nom: "spot BTC, requête type du client",
      chemin: SPOT,
      requete: "?symbol=btc_all&window=day&limit=30",
      attendu: "/v2/market/cq/spot/trade?symbol=btc_all&window=day&limit=30",
    },
    {
      nom: "spot ETH sans limit",
      chemin: SPOT,
      requete: "?symbol=eth_all&window=day",
      attendu: "/v2/market/cq/spot/trade?symbol=eth_all&window=day",
    },
    {
      nom: "perp BTC avec limit=1",
      chemin: SWAP,
      requete: "?symbol=btc_all&window=day&limit=1",
      attendu: "/v2/market/cq/swap/trade?symbol=btc_all&window=day&limit=1",
    },
    {
      nom: "perp ETH, clés dans le désordre",
      chemin: SWAP,
      requete: "?limit=30&window=day&symbol=eth_all",
      attendu: "/v2/market/cq/swap/trade?symbol=eth_all&window=day&limit=30",
    },
    {
      nom: "mineurs MARA",
      chemin: MINEURS,
      requete: "?miner=mara&window=day&limit=30",
      attendu: "/v1/btc/miner-data/companies?miner=mara&window=day&limit=30",
    },
    {
      nom: "search sans point d'interrogation initial",
      chemin: MINEURS,
      requete: "window=day&miner=wulf",
      attendu: "/v1/btc/miner-data/companies?miner=wulf&window=day",
    },
  ])("$nom", ({ chemin, requete, attendu }) => {
    expect(cheminCryptoQuantAmont(chemin, requete)).toBe(attendu);
  });

  test("les neuf sociétés sont acceptées", () => {
    for (const id of IDS_MINEURS_CQ) {
      expect(cheminCryptoQuantAmont(MINEURS, `?miner=${id}&window=day&limit=30`)).toBe(
        `/v1/btc/miner-data/companies?miner=${id}&window=day&limit=30`,
      );
    }
  });

  test("limit : chaque entier de 1 à 30 passe", () => {
    for (let n = 1; n <= 30; n += 1) {
      expect(cheminCryptoQuantAmont(SPOT, `?symbol=btc_all&window=day&limit=${n}`)).toBe(
        `/v2/market/cq/spot/trade?symbol=btc_all&window=day&limit=${n}`,
      );
    }
  });
});

describe("cheminCryptoQuantAmont — refusés (null)", () => {
  const BTC = "?symbol=btc_all&window=day&limit=30";
  test.each([
    { nom: "exchange-flows (plan Professional)", chemin: "/cqapi/v1/btc/exchange-flows/reserve", requete: "?exchange=all_exchange&window=day" },
    { nom: "market-indicator MVRV (plan Professional)", chemin: "/cqapi/v1/btc/market-indicator/mvrv", requete: "?window=day" },
    { nom: "miner-flows (plan Professional)", chemin: "/cqapi/v1/btc/miner-flows/reserve", requete: "?miner=f2pool&window=day" },
    { nom: "sans préfixe /cqapi", chemin: "/v2/market/cq/spot/trade", requete: BTC },
    { nom: "autre préfixe", chemin: "/bgapi/v2/market/cq/spot/trade", requete: BTC },
    { nom: "préfixe seul", chemin: "/cqapi", requete: BTC },
    { nom: "préfixe collé au chemin", chemin: "/cqapiv2/market/cq/spot/trade", requete: BTC },
    { nom: "slash final", chemin: `${SPOT}/`, requete: BTC },
    { nom: "double barre après le préfixe", chemin: "/cqapi//v2/market/cq/spot/trade", requete: BTC },
    { nom: "double barre au milieu du chemin", chemin: "/cqapi/v2/market//cq/spot/trade", requete: BTC },
    { nom: "casse du chemin", chemin: "/cqapi/v2/market/cq/SPOT/trade", requete: BTC },
    { nom: "séparateur encodé", chemin: "/cqapi/v2/market/cq/spot%2Ftrade", requete: BTC },
    { nom: "chaîne contenant .. (non normalisée)", chemin: "/cqapi/v2/market/cq/spot/../swap/trade", requete: BTC },
    { nom: "symbole hors liste", chemin: SPOT, requete: "?symbol=sol_all&window=day&limit=30" },
    { nom: "symbole d'une seule place", chemin: SPOT, requete: "?symbol=btc_usd&window=day" },
    { nom: "symbole en majuscules", chemin: SPOT, requete: "?symbol=BTC_ALL&window=day" },
    { nom: "symbole absent", chemin: SPOT, requete: "?window=day&limit=30" },
    { nom: "miner sur un chemin taker", chemin: SPOT, requete: "?miner=mara&window=day" },
    { nom: "symbol sur le chemin mineurs", chemin: MINEURS, requete: "?symbol=btc_all&window=day" },
    { nom: "symbol et miner ensemble (spot)", chemin: SPOT, requete: "?symbol=btc_all&miner=mara&window=day&limit=30" },
    { nom: "miner et symbol ensemble (perp)", chemin: SWAP, requete: "?miner=mara&symbol=eth_all&window=day" },
    { nom: "miner et symbol ensemble (mineurs)", chemin: MINEURS, requete: "?miner=mara&symbol=btc_all&window=day&limit=30" },
    { nom: "symbol puis miner ensemble (mineurs)", chemin: MINEURS, requete: "?symbol=btc_all&miner=mara&window=day" },
    { nom: "société inconnue", chemin: MINEURS, requete: "?miner=inconnu&window=day" },
    { nom: "société en majuscules", chemin: MINEURS, requete: "?miner=MARA&window=day" },
    { nom: "société absente", chemin: MINEURS, requete: "?window=day&limit=30" },
    { nom: "window absente", chemin: SPOT, requete: "?symbol=btc_all&limit=30" },
    { nom: "window=hour (403 en BASIC)", chemin: SPOT, requete: "?symbol=btc_all&window=hour" },
    { nom: "window=block", chemin: SPOT, requete: "?symbol=btc_all&window=block" },
    { nom: "window en majuscules", chemin: SPOT, requete: "?symbol=btc_all&window=DAY" },
    { nom: "clé Window (casse)", chemin: SPOT, requete: "?symbol=btc_all&Window=day" },
    { nom: "clé Symbol (casse)", chemin: SPOT, requete: "?Symbol=btc_all&window=day" },
    { nom: "limit=0", chemin: SPOT, requete: "?symbol=btc_all&window=day&limit=0" },
    { nom: "limit=31", chemin: SPOT, requete: "?symbol=btc_all&window=day&limit=31" },
    { nom: "limit=100", chemin: SPOT, requete: "?symbol=btc_all&window=day&limit=100" },
    { nom: "limit=030 (zéro initial)", chemin: SPOT, requete: "?symbol=btc_all&window=day&limit=030" },
    { nom: "limit=1.5", chemin: SPOT, requete: "?symbol=btc_all&window=day&limit=1.5" },
    { nom: "limit=-1", chemin: SPOT, requete: "?symbol=btc_all&window=day&limit=-1" },
    { nom: "limit=+5 (encodé)", chemin: SPOT, requete: "?symbol=btc_all&window=day&limit=%2B5" },
    { nom: "limit vide", chemin: SPOT, requete: "?symbol=btc_all&window=day&limit=" },
    { nom: "limit=abc", chemin: SPOT, requete: "?symbol=btc_all&window=day&limit=abc" },
    { nom: "limit précédé d'un espace", chemin: SPOT, requete: "?symbol=btc_all&window=day&limit=%2030" },
    { nom: "from refusé", chemin: SPOT, requete: "?symbol=btc_all&window=day&from=20260901" },
    { nom: "to refusé", chemin: SPOT, requete: "?symbol=btc_all&window=day&to=20260915" },
    { nom: "from et to refusés (mineurs)", chemin: MINEURS, requete: "?miner=mara&window=day&from=20260801&to=20260915" },
    { nom: "paramètre inconnu", chemin: SPOT, requete: "?symbol=btc_all&window=day&format=json" },
    { nom: "clé API en query", chemin: SPOT, requete: "?symbol=btc_all&window=day&api_key=secret" },
    { nom: "nom de paramètre vide", chemin: SPOT, requete: "?symbol=btc_all&window=day&=x" },
    { nom: "doublon symbol identique", chemin: SPOT, requete: "?symbol=btc_all&symbol=btc_all&window=day" },
    { nom: "doublon symbol contradictoire", chemin: SPOT, requete: "?symbol=btc_all&symbol=sol_all&window=day" },
    { nom: "doublon window", chemin: SPOT, requete: "?symbol=btc_all&window=day&window=day" },
    { nom: "doublon limit", chemin: SPOT, requete: "?symbol=btc_all&window=day&limit=30&limit=30" },
    { nom: "doublon miner", chemin: MINEURS, requete: "?miner=mara&miner=riot&window=day" },
    { nom: "query vide", chemin: SPOT, requete: "" },
    { nom: "point d'interrogation seul", chemin: SPOT, requete: "?" },
  ])("$nom", ({ chemin, requete }) => {
    expect(cheminCryptoQuantAmont(chemin, requete)).toBeNull();
  });
});

describe("cleCryptoQuantValide", () => {
  test("accepte « Bearer », une espace et un jeton ASCII visible, casse du schéma indifférente, jusqu'à 512 caractères", () => {
    const limite = `Bearer ${"x".repeat(505)}`;
    expect(limite).toHaveLength(512);
    const visibles = Array.from({ length: 0x7e - 0x21 + 1 }, (_, i) => String.fromCharCode(0x21 + i)).join("");
    for (const valeur of ["Bearer abc", "bearer abc", "BEARER abc", `Bearer ${visibles}`, limite]) {
      expect(cleCryptoQuantValide(valeur)).toBe(true);
    }
  });

  test("refuse absence, autre schéma, jeton vide ou composé, espace initial et plus de 512 caractères", () => {
    for (const valeur of [
      null,
      undefined,
      "",
      "Bearer",
      "Bearer ",
      "Bearer a b",
      "Apikey abc",
      "Basic abc",
      "Token abc",
      "abc",
      " Bearer abc",
      `Bearer ${"x".repeat(506)}`,
    ]) {
      expect(cleCryptoQuantValide(valeur)).toBe(false);
    }
  });

  test.each([
    { nom: "saut de ligne comme séparateur", valeur: "Bearer\ntok" },
    { nom: "retour chariot comme séparateur", valeur: "Bearer\rtok" },
    { nom: "CR/LF puis en-tête injecté", valeur: "Bearer \r\nX-Inj: 1" },
    { nom: "saut de ligne dans le jeton", valeur: "Bearer tok\nX-Inj: 1" },
    { nom: "tabulation comme séparateur", valeur: "Bearer\ttok" },
    { nom: "double espace", valeur: "Bearer  tok" },
    { nom: "triple espace", valeur: "Bearer   tok" },
    { nom: "NBSP (U+00A0) comme séparateur", valeur: "Bearer tok" },
    { nom: "NBSP (U+00A0) dans le jeton", valeur: "Bearer to k" },
    { nom: "espace de largeur nulle (U+200B) dans le jeton", valeur: "Bearer to​k" },
    { nom: "caractère non ASCII dans le jeton", valeur: "Bearer tokén" },
    { nom: "caractère de contrôle DEL dans le jeton", valeur: "Bearer tok" },
    { nom: "tabulation finale", valeur: "Bearer tok\t" },
  ])("refuse un en-tête mal formé : $nom", ({ valeur }) => {
    expect(cleCryptoQuantValide(valeur)).toBe(false);
  });
});
