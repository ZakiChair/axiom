import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveProtocolSlug } from "./protocolRevenue";

describe("protocol revenue slug resolution", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps PUMPUSDT to the pump.fun DefiLlama revenue slug", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ protocols: [] }), { status: 200 })
    );

    await expect(resolveProtocolSlug("PUMPUSDT")).resolves.toBe("pump.fun");
  });

  // Régression : la résolution DYNAMIQUE doit fonctionner pour les actifs NON curés.
  // Le ticker (`symbol`) vit sur /protocols ; overview/fees ne porte que des `slug`.
  // On joint les deux. (Bug historique : l'index était bâti depuis overview/fees, qui
  // n'expose jamais `symbol` ⇒ index toujours vide ⇒ seuls les tokens curés résolvaient.)
  it("résout un ticker NON curé via /protocols ∩ slugs porteurs de revenus", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/protocols")) {
        // /protocols → tableau plat trié par TVL décroissant, chaque item a `symbol`.
        return Promise.resolve(
          new Response(
            JSON.stringify([
              { symbol: "UNI", slug: "uniswap-v3" }, // curé (uniswap) doit primer
              { symbol: "JUP", slug: "jupiter-aggregator" },
              { symbol: "RAY", slug: "raydium-amm" },
              { symbol: "NOFEE", slug: "nofee-protocol" }, // pas de revenus → exclu
            ]),
            { status: 200 }
          )
        );
      }
      // overview/fees → { protocols: [{ slug }] } : l'ensemble des slugs à revenus.
      return Promise.resolve(
        new Response(
          JSON.stringify({
            protocols: [
              { slug: "uniswap-v3" },
              { slug: "jupiter-aggregator" },
              { slug: "raydium-amm" },
            ],
          }),
          { status: 200 }
        )
      );
    });

    // Tickers non curés → résolus dynamiquement vers un slug porteur de revenus.
    await expect(resolveProtocolSlug("JUPUSDT")).resolves.toBe("jupiter-aggregator");
    await expect(resolveProtocolSlug("RAYUSDT")).resolves.toBe("raydium-amm");
    // Présent dans /protocols mais slug absent des revenus → non mappé.
    await expect(resolveProtocolSlug("NOFEEUSDT")).resolves.toBeNull();
    // Inconnu partout → null (dégradation propre).
    await expect(resolveProtocolSlug("ZZZUSDT")).resolves.toBeNull();
    // La table curée prime sur la résolution dynamique (uniswap, pas uniswap-v3).
    await expect(resolveProtocolSlug("UNIUSDT")).resolves.toBe("uniswap");
  });
});
