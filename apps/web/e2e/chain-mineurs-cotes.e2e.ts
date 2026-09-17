import { expect, test, type Page, type Route } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

/**
 * CHAIN : sous-section « Production des mineurs cotés » (CryptoQuant BASIC, clé personnelle).
 * Réseau bouchonné, horloge figée au 2026-09-16 12:00 UTC : sous horloge figée, la fenêtre
 * glissante du client (10 req / 60 s) ne se purge pas tant qu'elle n'est pas avancée, d'où une
 * spec séparée de DES (9 appels ici, 4 là-bas, chacune sous 10). Vérifie : exactement neuf
 * appels au MONTAGE de CHAIN, bouton replié, requêtes fermées `window=day&limit=30` sans `from`,
 * clé personnelle relayée ; au dépliage, les neuf sociétés (MARA non publiée, RIOT publiée, HIVE
 * sans ligne le 2026-09-10), Σ, courbe et tri interactif ; qualité publiée ; aucun appel de plus
 * au repli/dépliage ni à la réouverture 6 h 30 plus tard, le même jour UTC (seul le
 * court-circuit J-1 joue) ; une société en 503 donne une Σ partielle et une couverture 8/9 ;
 * client CryptoQuant introuvable (import() rejeté) annoncé dans l'en-tête et la vue.
 */
const JOUR_MS = 86_400_000;
const MAINTENANT = new Date("2026-09-16T12:00:00Z");
const J1 = Date.UTC(2026, 8, 15);
const IDS = ["bitf", "cipher", "clsk", "core", "hive", "iren", "mara", "riot", "wulf"] as const;
type IdMineur = (typeof IDS)[number];
/** BTC minés par jour, constants ; Σ = 130.00 BTC/j. */
const BTC: Record<IdMineur, number> = {
  bitf: 5.1,
  cipher: 7.2,
  clsk: 20.4,
  core: 3.3,
  hive: 4.4,
  iren: 18.5,
  mara: 49.05,
  riot: 15.6,
  wulf: 6.45,
};
const PX = 78_300;
const HIVE_MANQUANT = "2026-09-10";
const CHEMIN = "/cqapi/v1/btc/miner-data/companies";
const TITRE = /Production des mineurs cotés/;

const estIdMineur = (v: string | null): v is IdMineur => IDS.some((id) => id === v);

/**
 * Trente lignes de la plus récente (J-1 = 2026-09-15) à la plus ancienne (2026-08-17), enveloppe
 * CryptoQuant v1. MARA à J-1 = exemple du sondage (49.05 BTC, cumul 396.96, 3.84 M$,
 * `reported_production` null) ; RIOT publie 123 BTC ; HIVE n'a pas de ligne le 2026-09-10.
 */
function fixtureMineur(id: IdMineur) {
  const data = Array.from({ length: 30 }, (_, i) => {
    const date = new Date(J1 - i * JOUR_MS).toISOString().slice(0, 10);
    const r = BTC[id];
    const maraJ1 = id === "mara" && i === 0;
    const jourDuMois = Number(date.slice(8, 10));
    return {
      date,
      coinbase_rewards: r - 0.05,
      other_mining_rewards: 0.05,
      total_rewards: r,
      accumulated_monthly_rewards: maraJ1 ? 396.96 : r * jourDuMois,
      unique_txn: 40,
      active_address_count: 12,
      reported_production: id === "riot" ? 123 : null,
      report_accuracy: null,
      closing_usd: PX,
      total_daily_rewards_closing_usd: maraJ1 ? 3_840_000 : r * PX,
      accumulated_monthly_rewards_closing_usd: r * jourDuMois * PX,
    };
  }).filter((ligne) => !(id === "hive" && ligne.date === HIVE_MANQUANT));
  return { status: { code: 200, message: "success" }, result: { window: "day", data } };
}

interface Appel {
  url: URL;
  authorization: string | undefined;
}

/** Réseau fermé, horloge figée, clé personnelle posée, route CryptoQuant comptée. */
async function preparer(page: Page, repondre: (id: IdMineur, route: Route) => Promise<void>): Promise<Appel[]> {
  await bouchonnerReseau(page);
  await page.clock.setFixedTime(MAINTENANT);
  await page.addInitScript(() => localStorage.setItem("axiom:cryptoquant:key", "fixture-personnelle"));
  const appels: Appel[] = [];
  await page.route(
    (url) => url.pathname === CHEMIN,
    async (route) => {
      const url = new URL(route.request().url());
      appels.push({ url, authorization: route.request().headers().authorization });
      const miner = url.searchParams.get("miner");
      if (!estIdMineur(miner)) {
        await route.fulfill({ status: 404, json: { erreur: "chemin CryptoQuant refusé" } });
        return;
      }
      await repondre(miner, route);
    },
  );
  return appels;
}

/**
 * Module du client tel que le demande l'`import()` de la sous-section : les e2e tournent sur le
 * serveur Vite de développement (`playwright.config.ts`), qui sert le fichier source, et non sur
 * le build (chunk `cryptoquant-*.js`). Chemin exact : le store de clé (`/src/store/cryptoquant.ts`,
 * import statique de la vue) doit continuer de se charger. Recopié de la spec DES (une spec
 * n'importe pas une autre spec).
 */
const MODULE_CLIENT = "/src/data/onchain/cryptoquant.ts";

/** Fait échouer le chargement du client (404, comme un chunk évincé) ; renvoie les URL interceptées. */
async function rendreClientIntrouvable(page: Page): Promise<string[]> {
  const interceptees: string[] = [];
  await page.route(
    (url) => url.pathname === MODULE_CLIENT,
    (route) => {
      interceptees.push(route.request().url());
      return route.fulfill({ status: 404, contentType: "text/plain", body: "module introuvable" });
    },
  );
  return interceptees;
}

/** Calqué sur `ouvrirChainSansCle` (onchain-complements.e2e.ts:176-186) : une spec n'importe pas une autre spec. */
async function ouvrirChain(page: Page) {
  await page.addInitScript(() =>
    localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 })),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Fonctions" }).click();
  await page.getByRole("menuitem", { name: /On-chain/ }).click();
  return page.getByRole("complementary", { name: "On-chain", exact: true });
}

test("CHAIN : mineurs cotés — neuf appels au montage, lecture et tri au dépliage, aucun appel ensuite", async ({ page }) => {
  const appels = await preparer(page, (id, route) => route.fulfill({ json: fixtureMineur(id) }));
  const chain = await ouvrirChain(page);
  const bouton = chain.getByRole("button", { name: TITRE });
  await expect(bouton).toHaveAttribute("aria-expanded", "false");
  await expect(chain.getByRole("table", { name: "Production des mineurs cotés" })).toHaveCount(0);

  // Montage de CHAIN : les neuf séries, une fois chacune, requête fermée, clé personnelle relayée.
  await expect.poll(() => appels.length).toBe(9);
  expect(appels.map((a) => a.url.searchParams.get("miner")).sort()).toEqual([...IDS].sort());
  for (const { url, authorization } of appels) {
    expect(url.search).toMatch(/^\?miner=[a-z]+&window=day&limit=30$/);
    expect(url.searchParams.has("from")).toBe(false);
    expect(authorization).toBe("Bearer fixture-personnelle");
  }
  await expect(chain).toContainText("archive 30 j · J-1 2026-09-15");
  const qualite = chain
    .locator("details", { hasText: "Qualité des blocs" })
    .locator("div.bg-surface", { hasText: "Mineurs cotés · CryptoQuant" });
  await expect(qualite).toContainText("couverture 9/9");
  await expect(qualite).toContainText("partiel");
  await expect(qualite).toContainText("1 jour manquant dans la fenêtre de 30 j.");
  const hive = await page.evaluate(() => localStorage.getItem("axiom:onchain:cq:mineur:hive:v1"));
  expect(hive).not.toBeNull();
  expect(Object.keys((JSON.parse(hive ?? "{}") as { jours?: Record<string, unknown> }).jours ?? {})).toHaveLength(29);

  // Dépliage : lecture des neuf sociétés, sans appel.
  await bouton.click();
  await expect(bouton).toHaveAttribute("aria-expanded", "true");
  const tableau = chain.getByRole("table", { name: "Production des mineurs cotés" });
  const lignes = tableau.getByRole("row");
  await expect(lignes).toHaveCount(10);
  await expect(tableau).toContainText("MARA");
  await expect(tableau).toContainText("49.05");
  await expect(tableau).toContainText("396.96");
  await expect(tableau).toContainText("$3.84M");
  await expect(tableau).toContainText("non publié");
  await expect(tableau).toContainText("123.00 BTC");
  await expect(chain).toContainText(
    "2026-09-15 (J-1) · 9/9 sociétés · Σ 130.00 BTC/j · cumul mois Σ 1611.21 BTC · Σ $10.18M/j",
  );
  await expect(chain.getByText("Σ 9", { exact: true })).toBeVisible();
  await expect(chain).not.toContainText("Σ partielle");
  await expect(chain.getByRole("img", { name: "Production Σ 9 sociétés" })).toBeVisible();
  await expect(chain).toContainText(
    "Archive locale depuis 2026-08-17 · 30 j · 1 manquant dans la fenêtre (2026-09-10) · 0 perdu",
  );
  await expect(chain).toContainText("miner-data/companies (9 requêtes)");
  expect(appels).toHaveLength(9);

  // Tri interactif : défaut BTC J-1 décroissant ; « Société » → décroissant puis croissant.
  await expect(lignes.nth(1)).toContainText("MARA");
  await tableau.getByRole("button", { name: "Société" }).click();
  await expect(lignes.nth(1)).toContainText("WULF");
  await tableau.getByRole("button", { name: "Société" }).click();
  await expect(lignes.nth(1)).toContainText("BITF");
  expect(appels).toHaveLength(9);

  // Repli puis dépliage : l'état du conteneur sert, tri conservé, aucun appel.
  await bouton.click();
  await expect(bouton).toHaveAttribute("aria-expanded", "false");
  await bouton.click();
  await expect(tableau).toContainText("49.05");
  await expect(lignes.nth(1)).toContainText("BITF");
  await page.waitForTimeout(300);
  expect(appels).toHaveLength(9);

  // Fermeture puis réouverture de CHAIN : J-1 archivé pour les neuf séries → zéro appel.
  // L'horloge avance d'abord de 6 h 30 sans changer de jour UTC (J-1 reste le 2026-09-15) :
  // la reprise 6 h est écoulée et la fenêtre de 60 s purgée, si bien que seul le
  // court-circuit J-1 explique zéro appel.
  await page.clock.setFixedTime(new Date("2026-09-16T18:30:00Z"));
  expect(await page.evaluate(() => Date.now())).toBe(Date.UTC(2026, 8, 16, 18, 30));
  await chain.getByTitle("Fermer").click();
  await expect(chain).toHaveCount(0);
  await page.getByRole("button", { name: "Fonctions" }).click();
  await page.getByRole("menuitem", { name: /On-chain/ }).click();
  await expect(bouton).toHaveAttribute("aria-expanded", "false");
  await expect(chain).toContainText("archive 30 j · J-1 2026-09-15");
  await expect(qualite).toContainText("couverture 9/9");
  await page.waitForTimeout(500);
  expect(appels).toHaveLength(9);
});

test("CHAIN : mineurs cotés — une société en 503, Σ partielle et couverture 8/9", async ({ page }) => {
  const appels = await preparer(page, (id, route) =>
    id === "wulf"
      ? route.fulfill({ status: 503, json: { status: { code: 503, message: "Service Unavailable" } } })
      : route.fulfill({ json: fixtureMineur(id) }),
  );
  const chain = await ouvrirChain(page);
  await expect.poll(() => appels.length).toBe(9);
  const qualite = chain
    .locator("details", { hasText: "Qualité des blocs" })
    .locator("div.bg-surface", { hasText: "Mineurs cotés · CryptoQuant" });
  await expect(qualite).toContainText("couverture 8/9");
  await expect(qualite).toContainText("partiel");
  await expect(qualite).toContainText("CryptoQuant injoignable");

  await chain.getByRole("button", { name: TITRE }).click();
  await expect(chain).toContainText("2026-09-15 (J-1) · 8/9 sociétés · Σ partielle 8/9");
  await expect(chain).not.toContainText("Σ 130.00");
  await expect(chain.getByText("Σ 9", { exact: true })).toHaveCount(0);
  await expect(chain).toContainText("archive servie");
  const tableau = chain.getByRole("table", { name: "Production des mineurs cotés" });
  await expect(tableau.getByRole("row")).toHaveCount(10);
  await expect(tableau).toContainText("WULF");
  await expect(tableau).toContainText("MARA");
  await page.waitForTimeout(300);
  expect(appels).toHaveLength(9);
});

test("CHAIN : mineurs cotés — client CryptoQuant introuvable (import() rejeté), en-tête et vue le disent, aucun appel", async ({ page }) => {
  const appels = await preparer(page, (id, route) => route.fulfill({ json: fixtureMineur(id) }));
  const interceptees = await rendreClientIntrouvable(page);
  const chain = await ouvrirChain(page);
  const bouton = chain.getByRole("button", { name: TITRE });
  // L'état de l'en-tête est rendu à côté du bouton, dans le même bloc.
  const entete = bouton.locator("xpath=..");

  await expect(entete).toContainText("client CryptoQuant non chargé");
  await expect(entete).not.toContainText("chargement");
  expect(interceptees.length).toBeGreaterThan(0);
  await bouton.click();
  await expect(bouton).toHaveAttribute("aria-expanded", "true");
  await expect(chain).toContainText(
    "Client CryptoQuant non chargé (réseau ou mise à jour d'AXIOM) ; rechargez la page.",
  );
  await expect(chain.getByRole("table", { name: "Production des mineurs cotés" })).toHaveCount(0);
  expect(appels).toHaveLength(0);
});
