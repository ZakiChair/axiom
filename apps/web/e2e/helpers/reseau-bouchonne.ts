import type { Page } from "@playwright/test";
import { E2E_ORIGINE, E2E_WS_ORIGINE } from "../origine";

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
      ressource !== "fetch" &&
      ressource !== "xhr"
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
