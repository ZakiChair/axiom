import { expect, test, type Page } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

/**
 * DES : section « Flux takers toutes places » (CryptoQuant BASIC, clé personnelle, archive
 * côté client). Réseau bouchonné, horloge figée au 2026-09-16 12:00 UTC (J-1 = 2026-09-15),
 * clé factice posée avant le chargement. Vérifie : quatre appels au MONTAGE de la fenêtre
 * alors que la section est repliée ; requêtes `window=day&limit=30` sans `from`/`to`, clé en
 * en-tête seulement ; aucun appel sur les segmentés, le changement de source ni la
 * réouverture (J-1 archivé) ; archive locale fusionnée sans doublon ; 429 et 401 affichés
 * après un seul appel, sans perdre ni réécrire l'archive.
 *
 * L'horloge figée gèle `Date.now()` : la fenêtre glissante 10 req/min ne se purge jamais,
 * d'où une spec séparée de CHAIN (4 appels ici, 9 là-bas, chacun sous 10). Le cas « sans
 * clé » n'est pas hermétique en e2e (le serveur de dev lit apps/web/.env) : il est couvert
 * en unitaire.
 */
const CLE = "CLE-E2E-FACTICE";
const CLE_ARCHIVE_SPOT_BTC = "axiom:onchain:cq:taker:spot:btc:v1";
const JOUR_MS = 86_400_000;
const J_MOINS_1 = Date.UTC(2026, 8, 15);
const EXCLUS_SPOT_BTC = new Set(["2026-09-01", "2026-09-02"]);

type Marche = "spot" | "swap";
type Symbole = "btc_all" | "eth_all";

/** Dernier jour de chaque série : des ratios distincts pour suivre les segmentés à l'écran. */
const DERNIERS: Record<`${Marche}:${Symbole}`, { bsr: number; qv: number }> = {
  "spot:btc_all": { bsr: 0.9802, qv: 12_007_360_401.32 },
  "spot:eth_all": { bsr: 1.0417, qv: 5_430_000_000 },
  "swap:btc_all": { bsr: 0.9533, qv: 61_200_000_000 },
  "swap:eth_all": { bsr: 1.1234, qv: 27_800_000_000 },
};

const jourIso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Ligne fournisseur `market/cq/{spot,swap}/trade` (champs du sondage du 2026-09-16). */
function ligneFournisseur(marche: Marche, symbole: Symbole, t: number) {
  const { bsr, qv } = t === J_MOINS_1 ? DERNIERS[`${marche}:${symbole}`] : { bsr: 1, qv: 11_500_000_000 };
  const br = bsr / (1 + bsr);
  return {
    datetime: `${jourIso(t)} 00:00:00`,
    symbol: symbole,
    base: symbole.slice(0, 3),
    quote: "all",
    trade_count: 12_099_486,
    base_volume: 156_928.13,
    quote_volume: qv,
    base_buy_volume: 77_681.2,
    quote_buy_volume: qv * br,
    base_sell_volume: 79_246.93,
    quote_sell_volume: qv * (1 - br),
    vwap: symbole === "btc_all" ? 76_515.03 : 2_450.5,
    buy_ratio: br,
    sell_ratio: 1 - br,
    buy_sell_ratio: bsr,
    buy_count: 6_133_017,
    sell_count: 5_966_469,
    ...(marche === "swap" ? { inverse: false } : {}),
  };
}

/** Enveloppe de 30 jours, du plus récent au plus ancien (ordre fournisseur) ; spot BTC troué. */
function reponseFournisseur(marche: Marche, symbole: Symbole) {
  const data = Array.from({ length: 30 }, (_, i) => J_MOINS_1 - i * JOUR_MS)
    .filter((t) => !(marche === "spot" && symbole === "btc_all" && EXCLUS_SPOT_BTC.has(jourIso(t))))
    .map((t) => ligneFournisseur(marche, symbole, t));
  return { status: { code: 200, message: "success" }, result: { window: "DAY", data } };
}

/** Archive spot BTC d'une session antérieure : dix jours du 2026-08-07 au 2026-08-16. */
function archivePrealable() {
  const jours: Record<string, Record<string, number>> = {};
  for (let i = 1; i <= 10; i++) {
    jours[jourIso(Date.UTC(2026, 7, 17) - i * JOUR_MS)] = {
      n: 11_000_000,
      bv: 150_000,
      qv: 11_000_000_000,
      bbv: 75_000,
      qbv: 5_400_000_000,
      bsv: 75_000,
      qsv: 5_600_000_000,
      vwap: 75_000,
      br: 0.4909,
      bsr: 0.9643,
      bc: 5_500_000,
      sc: 5_500_000,
    };
  }
  return { version: 1, serie: "taker:spot:btc", majTs: Date.UTC(2026, 7, 17, 6), jours };
}

interface Appel {
  url: string;
  authorization: string | undefined;
}

interface Reponse {
  status: number;
  headers?: Record<string, string>;
  json: unknown;
}

async function preparer(
  page: Page,
  options: { archive?: boolean; reponse?: (marche: Marche, symbole: Symbole) => Reponse } = {},
): Promise<Appel[]> {
  await bouchonnerReseau(page);
  await page.clock.setFixedTime(new Date("2026-09-16T12:00:00Z"));
  await page.addInitScript(
    ({ cle, cleArchive, archive }) => {
      localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
      localStorage.setItem("axiom:cryptoquant:key", cle);
      if (archive !== null) localStorage.setItem(cleArchive, archive);
    },
    {
      cle: CLE,
      cleArchive: CLE_ARCHIVE_SPOT_BTC,
      archive: options.archive === true ? JSON.stringify(archivePrealable()) : null,
    },
  );
  const appels: Appel[] = [];
  await page.route(
    (url) => url.pathname.startsWith("/cqapi/v2/market/cq/"),
    (route) => {
      const requete = route.request();
      const url = new URL(requete.url());
      appels.push({ url: requete.url(), authorization: requete.headers()["authorization"] });
      const marche: Marche = url.pathname.includes("/swap/") ? "swap" : "spot";
      const symbole: Symbole = url.searchParams.get("symbol") === "eth_all" ? "eth_all" : "btc_all";
      const reponse = options.reponse?.(marche, symbole) ?? { status: 200, json: reponseFournisseur(marche, symbole) };
      return route.fulfill(reponse);
    },
  );
  return appels;
}

async function ouvrirDes(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Produits dérivés" }).click();
  const des = page.getByRole("complementary", { name: "Produits dérivés" });
  const bouton = des.getByRole("button", { name: /Flux takers toutes places/i });
  const section = des
    .locator("section")
    .filter({ has: page.getByRole("button", { name: /Flux takers toutes places/i }) });
  return { des, bouton, section };
}

async function lireArchive(page: Page): Promise<string | null> {
  return page.evaluate((cle) => localStorage.getItem(cle), CLE_ARCHIVE_SPOT_BTC);
}

test("DES : flux takers chargés au montage (4 appels), repliés par défaut, sans appel sur segmentés, source ni réouverture", async ({ page }) => {
  const appels = await preparer(page);
  const { des, bouton, section } = await ouvrirDes(page);

  // Chargement au MONTAGE : la section reste repliée, l'en-tête résume l'archive.
  await expect(bouton).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => appels.length).toBe(4);
  await expect(bouton).toContainText("archive 28 j · J-1 2026-09-15");
  await expect(section).not.toContainText("Ratio taker");

  // Requêtes : les quatre séries, fenêtre journalière de 30 lignes, jamais from/to ; la clé
  // voyage dans l'en-tête Authorization, jamais dans l'URL.
  const series = appels.map((a) => {
    const u = new URL(a.url);
    return `${u.pathname}?${u.searchParams.get("symbol")}`;
  });
  expect(series.sort()).toEqual([
    "/cqapi/v2/market/cq/spot/trade?btc_all",
    "/cqapi/v2/market/cq/spot/trade?eth_all",
    "/cqapi/v2/market/cq/swap/trade?btc_all",
    "/cqapi/v2/market/cq/swap/trade?eth_all",
  ]);
  for (const appel of appels) {
    const u = new URL(appel.url);
    expect(u.searchParams.get("window")).toBe("day");
    expect(u.searchParams.get("limit")).toBe("30");
    expect(u.searchParams.has("from")).toBe(false);
    expect(u.searchParams.has("to")).toBe(false);
    expect(appel.url).not.toContain(CLE);
    expect(appel.authorization).toBe(`Bearer ${CLE}`);
  }

  // Dépliage : lectures du spot BTC.
  await bouton.click();
  await expect(bouton).toHaveAttribute("aria-expanded", "true");
  await expect(section).toContainText("0.98");
  await expect(section).toContainText("$12.01B");
  await expect(section).toContainText("observation 2026-09-15 (J-1)");
  await expect(section).toContainText("Archive locale depuis 2026-08-17");
  await expect(section).toContainText("2 manquants dans la fenêtre");
  await expect(section).toContainText("composition non documentée");
  await expect(section.getByRole("img", { name: "Ratio taker achat/vente quotidien" })).toBeVisible();

  // Segmentés : lecture des archives déjà chargées, aucun appel.
  await section.getByRole("button", { name: "ETH", exact: true }).click();
  await expect(section).toContainText("1.04");
  await section.getByRole("button", { name: "Perp", exact: true }).click();
  await expect(section).toContainText("1.12");
  await expect(section).toContainText("champ inverse non documenté");
  await section.getByRole("button", { name: "BTC", exact: true }).click();
  await expect(section).toContainText("0.95");
  await page.waitForTimeout(300);
  expect(appels).toHaveLength(4);

  // Archive locale : 28 jours (spot BTC sans le 1er ni le 2 septembre), version 1, sans la clé.
  const brut = await lireArchive(page);
  expect(brut).not.toBeNull();
  expect(brut).not.toContain(CLE);
  const archive = JSON.parse(brut ?? "{}") as { version?: number; jours?: Record<string, unknown> };
  expect(archive.version).toBe(1);
  expect(Object.keys(archive.jours ?? {})).toHaveLength(28);
  expect(Object.keys(archive.jours ?? {})).not.toContain("2026-09-01");
  expect(Object.keys(archive.jours ?? {})).toContain("2026-09-15");

  // Source hors Binance : la branche Coinalyze bascule, la section reste en place.
  await page.getByRole("combobox", { name: "Source" }).selectOption("bybit");
  await expect(des).toContainText("Binance uniquement");
  await expect(section).toContainText("0.95");
  expect(appels).toHaveLength(4);

  // Fermeture puis réouverture : J-1 archivé pour les quatre séries → aucun appel.
  await des.getByTitle("Fermer").click();
  await expect(des).toHaveCount(0);
  await page.getByRole("button", { name: "Produits dérivés" }).click();
  await expect(bouton).toHaveAttribute("aria-expanded", "false");
  await expect(bouton).toContainText("J-1 2026-09-15");
  await page.waitForTimeout(300);
  expect(appels).toHaveLength(4);
});

test("DES : archive locale antérieure fusionnée sans doublon (début 2026-08-07)", async ({ page }) => {
  const appels = await preparer(page, { archive: true });
  const { bouton, section } = await ouvrirDes(page);
  await expect.poll(() => appels.length).toBe(4);
  await bouton.click();
  await expect(section).toContainText("Archive locale depuis 2026-08-07");
  await expect(section).toContainText("38 j archivés");
  await expect(section).toContainText("0.98");

  const brut = (await lireArchive(page)) ?? "";
  const dates = brut.match(/"\d{4}-\d{2}-\d{2}"/g) ?? [];
  expect(dates).toHaveLength(38);
  expect(new Set(dates).size).toBe(dates.length);
  expect(dates).toContain('"2026-08-07"');
  expect(dates).toContain('"2026-09-15"');
});

test("DES : 429 CryptoQuant — délai de reprise affiché, archive servie et non réécrite", async ({ page }) => {
  const appels = await preparer(page, {
    archive: true,
    reponse: () => ({
      status: 429,
      headers: { "x-ratelimit-limit": "10", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "30" },
      json: { status: { code: 429, message: "Too Many Requests" } },
    }),
  });
  const { bouton, section } = await ouvrirDes(page);

  await expect(bouton).toContainText("quota atteint, reprise 30 s");
  await bouton.click();
  await expect(section).toContainText(/nouvel essai dans 30 s/);
  await expect(section).toContainText("Archive locale depuis 2026-08-07");
  await expect(section).toContainText("0.96");
  await expect(section).toContainText("cache ou observation périmé");
  await expect(section).toContainText("J-1 en attente de publication");

  // Spec §4.3 étape 4 : après le 429, les trois autres séries répondent « quota » sans appel.
  await page.waitForTimeout(300);
  expect(appels).toHaveLength(1);
  // 429 : aucune écriture de l'archive — toujours les dix mêmes jours et le même majTs.
  const apres = JSON.parse((await lireArchive(page)) ?? "{}") as { majTs?: number; jours?: Record<string, unknown> };
  expect(apres.majTs).toBe(archivePrealable().majTs);
  expect(Object.keys(apres.jours ?? {}).sort()).toEqual(Object.keys(archivePrealable().jours).sort());
});

test("DES : 401 CryptoQuant — clé refusée affichée avec l'accès aux Réglages, un seul appel, rien d'archivé", async ({ page }) => {
  const appels = await preparer(page, {
    reponse: () => ({ status: 401, json: { erreur: "clé CryptoQuant personnelle requise" } }),
  });
  const { bouton, section } = await ouvrirDes(page);

  await expect.poll(() => appels.length).toBe(1);
  await expect(bouton).toContainText("clé CryptoQuant refusée");
  await bouton.click();
  await expect(section).toContainText(/Clé CryptoQuant refusée/);
  await expect(section.getByRole("button", { name: "Ouvrir les réglages ⚙" })).toBeVisible();
  // Refus mémorisé pour la version de clé : les trois autres séries répondent sans appel.
  await page.waitForTimeout(300);
  expect(appels).toHaveLength(1);
  expect(appels.every((a) => !a.url.includes(CLE))).toBe(true);
  expect(await lireArchive(page)).toBeNull();
});
