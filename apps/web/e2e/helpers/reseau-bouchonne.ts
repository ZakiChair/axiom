import type { Page } from "@playwright/test";
import { E2E_ORIGINE, E2E_WS_ORIGINE } from "../origine";

/**
 * Chemins des modules servis par Vite en développement : jamais une API ni un proxy.
 * WebKit classe en « fetch » ou « xhr » les modules qu'un worker de module importe (déduit en
 * CI le 12 novembre 2026 : le worker du backtest recevait 503 sur chacun de ses imports et
 * échouait ; cette seule condition levée, il passe). Ils passent donc quel que soit le type
 * de ressource annoncé.
 */
const MODULES_VITE = /^\/(src|@fs|@vite|@id|node_modules|@react-refresh)(\/|$)/;

/**
 * Ferme les accès aux API et flux réels. Les specs ajoutent ensuite leurs routes
 * de fixtures (prioritaires dans Playwright). Seuls les fichiers servis par Vite
 * et son WebSocket de développement restent accessibles.
 */
export async function bouchonnerReseau(page: Page): Promise<void> {
  const origine = E2E_ORIGINE;
  await page.route("**/*", async (route) => {
    const requete = route.request();
    const url = new URL(requete.url());
    const ressource = requete.resourceType();
    if (
      url.origin === origine &&
      requete.method() === "GET" &&
      ((ressource !== "fetch" && ressource !== "xhr") || MODULES_VITE.test(url.pathname))
    ) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 503,
      json: { error: "API non fournie par les fixtures du test" },
    });
  });
  await page.routeWebSocket("**/*", (socket) => {
    const url = new URL(socket.url());
    if (url.origin === E2E_WS_ORIGINE) socket.connectToServer();
    else void socket.close();
  });
}
