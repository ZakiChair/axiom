import { test, expect, type Page } from "@playwright/test";

/**
 * Gate G100 — G6, JUMEAU HERMÉTIQUE de `gate-g6-screener.e2e.ts`.
 *
 * POURQUOI CE JUMEAU : le test live accepte l'état vide « Aucun résultat. » — en
 * marché calme (funding > 0,01 %, ΔOI > 2 %, L/S > 1,5 ne matchent rien), il ne
 * vérifie NI les colonnes Δ OI / L-S NI l'enrichissement, et une régression rendant
 * zéro ligne passerait au vert. Ici les quatre points d'accès sont bouchonnés, donc
 * les assertions sont INCONDITIONNELLES : une ligne exactement, ses deux colonnes de
 * positionnement, et leurs valeurs dérivées des fixtures.
 *
 * Ce jumeau NE mesure PAS le critère ≤15 s (le réseau est bouchonné) : le chrono
 * reste la charge du test live, qui doit être conservé.
 *
 * Les quatre points d'accès du pipeline (data/screenerRun.ts) :
 *   1. `api.binance.com/api/v3/ticker/24hr`                    — univers, EN DIRECT ;
 *   2. `/extapi/fapi.binance.com/fapi/v1/premiumIndex`         — funding, via proxy ;
 *   3. `fapi.binance.com/futures/data/openInterestHist`        — ΔOI, EN DIRECT ;
 *   4. `fapi.binance.com/futures/data/globalLongShortAccountRatio` — L/S, EN DIRECT.
 * Seul le funding passe par /extapi : `data/binanceFutures.ts` appelle `fapi` en direct
 * (CORS ouvert). Les charges utiles ci-dessous respectent la forme lue par les
 * analyseurs de production (`parseTicker24h`, `parsePremiumIndex`, `parseOiHistory`,
 * `parseRatioHistory`) : tous les champs numériques sont des CHAÎNES.
 */

const HEURE = 3_600_000;
const T0 = Date.now() - 24 * HEURE;

/** Univers bouchonné : 4 paires USDT au-dessus du seuil de volume du preset (20 M$). */
const TICKER_24H = [
  { symbol: "BTCUSDT", lastPrice: "100000.00", priceChangePercent: "1.50", quoteVolume: "9000000000" },
  { symbol: "ETHUSDT", lastPrice: "3500.00", priceChangePercent: "-0.80", quoteVolume: "4000000000" },
  { symbol: "SOLUSDT", lastPrice: "180.00", priceChangePercent: "2.40", quoteVolume: "1000000000" },
  { symbol: "XRPUSDT", lastPrice: "2.00", priceChangePercent: "0.30", quoteVolume: "500000000" },
];

/**
 * Funding : `lastFundingRate` est une FRACTION, l'analyseur la passe en pourcentage
 * (×100). Seul XRPUSDT (0,002 %) tombe sous le seuil « Crowded long » (> 0,01 %) —
 * il est donc écarté AVANT l'étage de positionnement.
 */
const PREMIUM_INDEX = [
  { symbol: "BTCUSDT", lastFundingRate: "0.00042" },
  { symbol: "ETHUSDT", lastFundingRate: "0.00035" },
  { symbol: "SOLUSDT", lastFundingRate: "0.00051" },
  { symbol: "XRPUSDT", lastFundingRate: "0.00002" },
];

/** ΔOI% par symbole = variation entre le premier et le dernier point de l'historique. */
const OI_FIN: Record<string, number> = {
  BTCUSDT: 1_120_000_000, // +12 % → passe (> 2 %)
  ETHUSDT: 1_100_000_000, // +10 % → passe
  SOLUSDT: 1_005_000_000, // +0,5 % → ÉCARTÉ par le filtre ΔOI
};
const OI_DEBUT = 1_000_000_000;

/** Dernier ratio L/S par symbole (le filtre « Crowded long » exige > 1,5). */
const LS_RATIO: Record<string, number> = {
  BTCUSDT: 2.35, // passe
  ETHUSDT: 0.9, // ÉCARTÉ par le filtre L/S
  SOLUSDT: 1.8,
};

/** Symbole demandé par une requête `futures/data/*` (défaut inoffensif si absent). */
function symboleDe(url: string): string {
  return new URL(url).searchParams.get("symbol") ?? "";
}

/**
 * Bouchonne les QUATRE points d'accès du pipeline. Un symbole inconnu reçoit un
 * tableau vide : la ligne reste sans métrique et le filtre de position l'écarte —
 * jamais de 404 qui ferait diverger le run des fixtures.
 */
async function bouchonnerScreener(page: Page): Promise<void> {
  await page.route("**/api.binance.com/api/v3/ticker/24hr*", (route) =>
    route.fulfill({ json: TICKER_24H }),
  );
  await page.route("**/extapi/fapi.binance.com/fapi/v1/premiumIndex*", (route) =>
    route.fulfill({ json: PREMIUM_INDEX }),
  );
  await page.route("**/futures/data/openInterestHist*", (route) => {
    const fin = OI_FIN[symboleDe(route.request().url())];
    if (fin === undefined) return route.fulfill({ json: [] });
    // 25 points 1 h (OI_HIST_LIMIT) : seuls le premier et le dernier portent le Δ%.
    const points = Array.from({ length: 25 }, (_, i) => {
      const oiUsd = i === 0 ? OI_DEBUT : i === 24 ? fin : (OI_DEBUT + fin) / 2;
      return {
        timestamp: T0 + i * HEURE,
        sumOpenInterest: String(oiUsd / 100_000),
        sumOpenInterestValue: String(oiUsd),
      };
    });
    return route.fulfill({ json: points });
  });
  await page.route("**/futures/data/globalLongShortAccountRatio*", (route) => {
    const ratio = LS_RATIO[symboleDe(route.request().url())];
    if (ratio === undefined) return route.fulfill({ json: [] });
    // 5 points (limite du pipeline) : seul le DERNIER est lu par lastLongShortRatio.
    const points = Array.from({ length: 5 }, (_, i) => ({
      timestamp: T0 + i * HEURE,
      longShortRatio: String(i === 4 ? ratio : 1),
      longAccount: "0.6",
      shortAccount: "0.4",
    }));
    return route.fulfill({ json: points });
  });
}

test.beforeEach(async ({ page }) => {
  await bouchonnerScreener(page);
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "axiom:onboarding:v1",
      JSON.stringify({ completed: true, step: 0 }),
    );
  });
});

test("preset Crowded long : lignes, colonnes Δ OI / L-S et enrichissement (fixtures)", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Fonctions" }).click();
  await page.getByRole("menuitem", { name: /Screener/ }).click();
  const fenetre = page.getByRole("complementary", { name: "Screener d'actifs" });
  await expect(fenetre).toBeVisible({ timeout: 15_000 });

  await fenetre.getByRole("button", { name: "Crowded long" }).click();
  await fenetre.getByRole("button", { name: "Lancer le screen" }).click();
  await expect(fenetre.getByText("Terminé")).toBeVisible({ timeout: 15_000 });

  // AUCUNE branche conditionnelle : les fixtures garantissent une ligne et une seule.
  // BTCUSDT passe les 4 conditions ; ETHUSDT tombe sur L/S (0,90), SOLUSDT sur ΔOI
  // (+0,5 %), XRPUSDT sur le funding (0,002 %) — les filtres sont donc discriminants.
  const lignes = fenetre.locator('button[title^="Ouvrir "]');
  await expect(lignes).toHaveCount(1);
  await expect(lignes.first()).toHaveAttribute("title", "Ouvrir BTCUSDT dans le chart");
  await expect(fenetre.getByText("Aucun résultat.", { exact: true })).toHaveCount(0);

  // Colonnes de positionnement (en-têtes de tri = boutons), rendues seulement si au
  // moins une ligne porte les métriques : leur présence PROUVE l'enrichissement.
  await expect(fenetre.getByRole("button", { name: "Δ OI" })).toBeVisible();
  await expect(fenetre.getByRole("button", { name: "L/S" })).toBeVisible();

  // Valeurs dérivées des fixtures (une seule ligne affichée, donc pas d'ambiguïté) :
  // +12,00 % d'OI et ratio 2,35 — un enrichissement muet afficherait « — ».
  await expect(fenetre.getByText("+12.00%", { exact: true })).toBeVisible();
  await expect(fenetre.getByText("2.35", { exact: true })).toBeVisible();
});
