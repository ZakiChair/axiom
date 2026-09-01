import { test, expect } from "@playwright/test";

/**
 * Gate e2e du lot v2.5 — fenêtre CAP (TOTAL, TOTAL3, dominances).
 *
 * POURQUOI ICI : `apps/web` tourne en env vitest NODE (pas de jsdom, et aucune
 * dépendance de rendu ne peut être ajoutée — BUILD-CONTRACT). Le montage des trois
 * canvas et le sélecteur de dominance ne sont vérifiables que dans un vrai navigateur.
 *
 * DÉTERMINISTE ET HORS LIGNE : les appels CoinGecko sont interceptés et servis par des
 * fixtures minimales ; l'historique est semé dans localStorage avant le boot (le store
 * le relit au montage). Aucun appel réseau réel, donc aucun quota consommé.
 */

const JOUR = 86_400_000;
const T0 = Date.UTC(2026, 6, 29); // 2026-07-29, minuit UTC

/** Historique synthétique de 40 jours : TOTAL 2 T$, BTC 1 T$, ETH 0,2 T$. */
const HIST = {
  version: 1,
  majTs: T0,
  k: 1.02,
  recalibre: true,
  grille: Array.from({ length: 40 }, (_, i) => T0 - (39 - i) * JOUR),
  total: Array.from({ length: 40 }, (_, i) => 2e12 + i * 1e9),
  pieces: {
    bitcoin: Array.from({ length: 40 }, () => 1e12),
    ethereum: Array.from({ length: 40 }, () => 2e11),
  },
};

const MACRO_HIST = HIST.grille.map((t, i) => {
  const total = HIST.total[i] ?? 0;
  return { t, total, total2: total - 1e12, total3: total - 1.2e12 };
});

const MARCHES = [
  { id: "bitcoin", symbol: "btc", name: "Bitcoin", current_price: 65_000, market_cap: 1e12, price_change_percentage_24h: 1 },
  { id: "ethereum", symbol: "eth", name: "Ethereum", current_price: 3_000, market_cap: 2e11, price_change_percentage_24h: 1 },
  { id: "solana", symbol: "sol", name: "Solana", current_price: 150, market_cap: 8e10, price_change_percentage_24h: 1 },
  { id: "ripple", symbol: "xrp", name: "XRP", current_price: 2, market_cap: 1.2e11, price_change_percentage_24h: 1 },
];

const GLOBAL = {
  data: {
    total_market_cap: { usd: 2.04e12 },
    total_volume: { usd: 1e11 },
    market_cap_percentage: { btc: 49, eth: 9.8 },
    market_cap_change_percentage_24h_usd: 0.5,
  },
};

const BINANCE_KLINES = HIST.grille.map((t, i) => {
  const close = 60_000 + i * 100;
  return [t, String(close - 50), String(close + 100), String(close - 100), String(close), "100", t + JOUR - 1, "0", 10, "50", "0", "0"];
});

const CMC_DEBUT = Date.UTC(2013, 11, 31);
const CMC_FIN = Date.UTC(2026, 7, 31);
const CMC_GLOBAL_QUOTES = Array.from(
  { length: Math.floor((CMC_FIN - CMC_DEBUT) / JOUR) + 1 },
  (_, i) => {
    const t = CMC_DEBUT + i * JOUR;
    const total = 1e9 + i * 5e8;
    return {
      timestamp: new Date(t).toISOString(),
      btcDominance: 60,
      ethDominance: t >= Date.UTC(2015, 7, 7) ? 10 : 0,
      quote: [{ name: "2781", totalMarketCap: total, altcoinMarketCap: total * 0.4 }],
    };
  },
);
const CMC_ETH_POINTS = CMC_GLOBAL_QUOTES
  .filter((point) => Date.parse(point.timestamp) >= Date.UTC(2015, 7, 7))
  .map((point) => ({
    s: String(Date.parse(point.timestamp) / 1000),
    v: [1, 1, point.quote[0]!.totalMarketCap * 0.1],
  }));

/** Intercepte les trois endpoints CoinGecko utilisés par la fenêtre. */
async function bouchonnerCoinGecko(page: import("@playwright/test").Page): Promise<void> {
  await page.route("**/api.coingecko.com/api/v3/coins/markets*", (route) =>
    route.fulfill({ json: MARCHES })
  );
  await page.route("**/api.coingecko.com/api/v3/global*", (route) => route.fulfill({ json: GLOBAL }));
  await page.route("**/api.coingecko.com/api/v3/coins/*/market_chart*", (route) =>
    route.fulfill({
      json: {
        market_caps: Array.from({ length: 40 }, (_, i) => [T0 - (39 - i) * JOUR, 8e10]),
      },
    })
  );
  await page.route("**/api/v3/klines*", (route) => route.fulfill({ json: BINANCE_KLINES }));
}

test.beforeEach(async ({ page }) => {
  await bouchonnerCoinGecko(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
  });
});

test.describe("avec historique reconstruit", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(
      ([hist, dominances, macroHist]) => {
        window.localStorage.setItem("axiom:mcap:v1", hist as string);
        window.localStorage.setItem("axiom:mcap:dominances", dominances as string);
        window.localStorage.setItem("axiom:macroHistory:v1", macroHist as string);
      },
      [JSON.stringify(HIST), JSON.stringify(["bitcoin", "ethereum"]), JSON.stringify(MACRO_HIST)]
    );
  });

  test("la commande CAP ouvre la fenêtre et monte les trois graphiques", async ({ page }) => {
    await page.goto("/");
    // Attendre le montage AVANT la frappe : l'écouteur ⌘K est posé par un effet React,
    // une pression trop précoce se perd (leçon du gate v2.4).
    await expect(page.getByRole("button", { name: /^Indicateurs/ })).toBeVisible();

    await page.keyboard.press("ControlOrMeta+k");
    await page.getByPlaceholder(/^Commande/).fill("CAP");
    await page.keyboard.press("Enter");

    await expect(page.getByPlaceholder(/^Commande/)).toHaveCount(0);
    await expect(page.getByLabel("TOTAL — capitalisation crypto")).toBeVisible();
    await expect(page.getByLabel("TOTAL3 — hors BTC et ETH")).toBeVisible();
    await expect(page.getByLabel("Dominances")).toBeVisible();
    // La note de source dit d'où viennent les chiffres et ce qu'ils valent.
    await expect(page.getByText(/reconstruit par somme du top 100/)).toBeVisible();
  });

  test("TOTAL3 utilise l'historique long CMC sans clé et bascule contre BTC puis SOL", async ({ page }) => {
    let appelsCmc = 0;
    let authorizationPresente = false;
    const intervallesGlobaux = new Set<string>();
    await page.route("**/extapi/api.coinmarketcap.com/data-api/**", (route) => {
      appelsCmc += 1;
      authorizationPresente ||= route.request().headers().authorization !== undefined;
      const url = new URL(route.request().url());
      const debut = Number(url.searchParams.get("timeStart")) * 1000;
      const fin = Number(url.searchParams.get("timeEnd")) * 1000;
      const intervalle = url.searchParams.get("interval") ?? "1d";
      if (url.pathname.includes("global-metrics")) {
        intervallesGlobaux.add(intervalle);
        const pas = intervalle === "1h" ? 3_600_000 : intervalle === "4h" ? 4 * 3_600_000 : JOUR;
        const quotes = intervalle === "1d"
          ? CMC_GLOBAL_QUOTES.filter((point) => {
              const t = Date.parse(point.timestamp);
              return t >= debut && t <= fin;
            })
          : Array.from({ length: Math.floor((fin - debut) / pas) + 1 }, (_, i) => {
              const t = debut + i * pas;
              const total = 2e12 + i * 1e9;
              return {
                timestamp: new Date(t).toISOString(),
                btcDominance: 50,
                ethDominance: 10,
                quote: [{ name: "2781", totalMarketCap: total, altcoinMarketCap: total * 0.5 }],
              };
            });
        return route.fulfill({ json: { data: { quotes }, status: { error_code: "0" } } });
      }
      const points = intervalle === "1d"
        ? CMC_ETH_POINTS.filter((point) => {
            const t = Number(point.s) * 1000;
            return t >= debut && t <= fin;
          })
        : Array.from({ length: Math.floor((fin - debut) / 3_600_000) + 1 }, (_, i) => ({
            s: String((debut + i * 3_600_000) / 1000),
            v: [1, 1, 2e11 + i * 1e8],
          }));
      return route.fulfill({ json: { data: { points }, status: { error_code: "0" } } });
    });
    await page.goto("/");
    await expect(page.getByRole("button", { name: /^Indicateurs/ })).toBeVisible();

    await page.getByRole("combobox", { name: "Rechercher une paire" }).fill("TOTAL3");
    await page.getByRole("option", { name: "TOTAL3", exact: true }).click();

    await expect(page.getByText("TOTAL3", { exact: true })).toBeVisible();
    await expect(page.getByText("CoinMarketCap · daily", { exact: true })).toBeVisible();
    await expect.poll(() => appelsCmc).toBeGreaterThanOrEqual(4);
    expect(authorizationPresente).toBe(false);

    for (const tf of ["1h", "4h", "1d", "1w", "1M", "3M", "6M", "12M"]) {
      await expect(page.getByRole("button", { name: tf, exact: true })).toBeEnabled();
    }
    await page.getByRole("button", { name: "1h", exact: true }).click();
    await expect(page.getByText("CoinMarketCap · 1h", { exact: true })).toBeVisible();
    await expect.poll(() => intervallesGlobaux.has("1h")).toBe(true);
    await page.getByRole("button", { name: "4h", exact: true }).click();
    await expect(page.getByText("CoinMarketCap · 4h", { exact: true })).toBeVisible();
    await expect.poll(() => intervallesGlobaux.has("4h")).toBe(true);
    for (const tf of ["1w", "1M", "3M", "6M", "12M", "1d"]) {
      const bouton = page.getByRole("button", { name: tf, exact: true });
      await bouton.click();
      await expect(bouton).toHaveClass(/bg-emerald-500/);
    }

    await expect(page.getByRole("button", { name: "÷BTC" })).toBeVisible();
    await page.getByRole("button", { name: "÷BTC" }).click();
    await expect(page.getByText("TOTAL3 / BTCUSDT", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Choisir l'actif de comparaison" }).click();
    await page.getByTitle("Comparer vs SOL").click();
    await expect(page.getByText("TOTAL3 / SOLUSDT", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "÷SOL", exact: true }).click();
    await expect(page.getByText("TOTAL3 / SOLUSDT", { exact: true })).toHaveCount(0);
    await expect(page.getByText("TOTAL3", { exact: true })).toBeVisible();
  });

  test("ajouter une dominance ajoute sa pastille ; la retirer la fait disparaître", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /^Indicateurs/ })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByPlaceholder(/^Commande/).fill("CAP");
    await page.keyboard.press("Enter");

    // `exact` obligatoire : la watchlist expose « Retirer SOLUSDT », dont « Retirer SOL »
    // est une sous-chaîne — et getByRole matche en sous-chaîne par défaut.
    await expect(page.getByRole("button", { name: "Retirer SOL", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "+ dominance" }).click();
    await page.getByLabel("Rechercher une pièce").fill("sol");
    // role="menuitem" (primitive MenuDeroulant, T12) — même convention que les autres
    // menus de la Toolbar (cf. gate-g3-playbooks, gate-g2-badges…).
    await page.getByRole("menuitem", { name: /SOL\s+Solana/ }).click();

    await expect(page.getByRole("button", { name: "Retirer SOL", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Retirer SOL", exact: true }).click();
    await expect(page.getByRole("button", { name: "Retirer SOL", exact: true })).toHaveCount(0);
  });
});

test.describe("sans historique local", () => {
  test("propose de reconstruire les 365 jours en annonçant la durée", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /^Indicateurs/ })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByPlaceholder(/^Commande/).fill("CAP");
    await page.keyboard.press("Enter");

    await expect(page.getByRole("button", { name: /Construire l'historique/ })).toBeVisible();
    await expect(page.getByText(/100 appels cadencés/)).toBeVisible();
  });
});
