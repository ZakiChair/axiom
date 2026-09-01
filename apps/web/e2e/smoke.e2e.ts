import { test, expect } from "@playwright/test";

/**
 * Smoke e2e AXIOM — amorce structurelle (Lot review). Ces tests valident que le
 * terminal DÉMARRE et que ses briques d'UI de base répondent, SANS dépendre de
 * données de marché live (les WS/REST exchange peuvent échouer hors ligne).
 *
 * Avant chaque test : on marque l'onboarding comme terminé (clé
 * `axiom:onboarding:v1`) pour que l'overlay de premier lancement ne masque pas la
 * Toolbar — sinon le menu Fonctions serait inaccessible dans un profil vierge.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "axiom:onboarding:v1",
      JSON.stringify({ completed: true, step: 0 }),
    );
  });
});

test("le terminal démarre et rend son canvas de chart", async ({ page }) => {
  await page.goto("/");
  // La Toolbar (menu Fonctions dérivé du registre) est présente.
  await expect(page.getByRole("button", { name: "Fonctions" })).toBeVisible();
  // Le chart principal (KLineChart) monte un <canvas> — preuve que le renderer tourne.
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
});

test("garde les axes du temps et des prix visibles sur mobile", async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 748 });
  await page.goto("/");
  await expect(page.locator("main canvas").first()).toBeVisible({ timeout: 15_000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(
      () =>
        page.locator("main").evaluate((main) => {
          const bounds = main.getBoundingClientRect();
          const canvases = [...main.querySelectorAll("canvas")].map((canvas) => {
            const rect = canvas.getBoundingClientRect();
            return {
              left: rect.left,
              right: rect.right,
              top: rect.top,
              bottom: rect.bottom,
              width: rect.width,
              height: rect.height,
            };
          });
          const timeAxis = canvases.find(
            (rect) =>
              rect.width >= bounds.width / 2 &&
              rect.height >= 20 &&
              rect.height <= 40 &&
              rect.top >= bounds.top + bounds.height / 2,
          );
          const priceAxis = canvases.find(
            (rect) =>
              Math.abs(rect.right - bounds.right) <= 1 &&
              rect.width >= 76 &&
              rect.width < bounds.width / 2 &&
              rect.height >= bounds.height / 2,
          );
          return {
            tempsVisible: timeAxis !== undefined && timeAxis.bottom <= bounds.bottom + 1,
            prixLisibles: priceAxis !== undefined,
          };
        }),
      { timeout: 15_000 },
    )
    .toEqual({ tempsVisible: true, prixLisibles: true });
});

test("le menu Fonctions ouvre une fenêtre Launchpad (COT, sans data live)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Fonctions" }).click();
  // Item dérivé de WINDOW_REGISTRY (mnémonique COT + libellé).
  await page.getByRole("menuitem", { name: /Rapport COT/ }).click();
  // FloatingWindow expose role="complementary" + aria-label={title}.
  await expect(page.getByRole("complementary", { name: /Rapport COT/ })).toBeVisible({
    timeout: 15_000,
  });
});

test("le menu Fonctions ouvre la fenêtre Funding cross-exchange (FUNDX)", async ({ page }) => {
  const erreurs: string[] = [];
  page.on("pageerror", (e) => erreurs.push(String(e)));
  await page.goto("/");
  await page.getByRole("button", { name: "Fonctions" }).click();
  await page.getByRole("menuitem", { name: /Funding cross-exchange/ }).click();
  await expect(page.getByRole("complementary", { name: /Funding cross-exchange/ })).toBeVisible({
    timeout: 15_000,
  });
  expect(erreurs).toEqual([]);
});

test("le menu Fonctions ouvre la fenêtre Liquidations (LIQ)", async ({ page }) => {
  const erreurs: string[] = [];
  page.on("pageerror", (e) => erreurs.push(String(e)));
  await page.goto("/");
  await page.getByRole("button", { name: "Fonctions" }).click();
  await page.getByRole("menuitem", { name: /^LIQ/ }).click();
  await expect(page.getByRole("complementary", { name: "Liquidations" })).toBeVisible({ timeout: 15_000 });
  expect(erreurs).toEqual([]);
});

test("bascule vers Bybit (CORS-ouvert) et charge le chart via l'adaptateur", async ({ page }) => {
  const erreurs: string[] = [];
  page.on("pageerror", (e) => erreurs.push(String(e)));
  await page.goto("/");
  // Sélecteur de source (Toolbar) — Bybit est une option dérivée d'EXCHANGES.
  await page.getByRole("combobox", { name: "Source" }).selectOption("bybit");
  // Le chart se réinstancie sur la nouvelle source ; le canvas reste rendu.
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 20_000 });
  // Aucune exception non catchée au changement de source (câblage adaptateur sain).
  expect(erreurs).toEqual([]);
});

test("le chart principal AFFICHE les bougies du backfill (prix du bandeau dérivé des données)", async ({ page }) => {
  // Déterministe et hors ligne (patron gate-lot3-corr) : klines bouchonnées à un close
  // FIXE, WebSockets neutralisées (la page « se connecte » mais ne reçoit rien) → le prix
  // affiché ne peut venir QUE du backfill REST bouchonné. Un adaptateur qui renvoie
  // 0 bougie laisserait le bandeau à « — » avec un canvas monté mais VIDE → échec.
  const MINUTE = 60_000;
  const T_FIN = Math.floor(Date.now() / MINUTE) * MINUTE;
  const CLOSE_FIXE = "42123.5"; // formatPrice → « 42,123.50 » dans le bandeau symbole
  const lignes = Array.from({ length: 180 }, (_, i) => {
    const t = T_FIN - (179 - i) * MINUTE;
    // [openTime, open, high, low, close, volume, closeTime, quoteVol, trades, buyBase, buyQuote, ignore]
    return [t, "42000", "42200", "41900", CLOSE_FIXE, "1000", t + MINUTE - 1, "100000", 100, "500", "50000", "0"];
  });
  await page.routeWebSocket("**/*", () => {});
  // Repli générique AVANT la route klines : la plus récente/spécifique gagne (cf. gate-lot3-corr).
  await page.route("**/api.binance.com/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/api.binance.com/api/v3/klines*", (route) => route.fulfill({ json: lignes }));

  await page.goto("/");
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 20_000 });
  // Assertion SUR LES DONNÉES : le bandeau symbole affiche le close du backfill bouchonné.
  await expect(page.getByText("42,123.50").first()).toBeVisible({ timeout: 20_000 });
});
