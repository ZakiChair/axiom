/**
 * axiomd — point d'entrée du daemon localhost mono-process (Bun + SQLite).
 *
 * Rôle : proxy/cache des APIs à quota (répliquant les proxys de dev Vite) et
 * service du build front en PROD. Écoute sur 127.0.0.1:8787 (env AXIOMD_PORT).
 *
 * INVARIANTS (BUILD-CONTRACT) :
 *  - Le daemon ne touche JAMAIS au chemin chaud du renderer : les WebSockets de
 *    marché du front restent DIRECTS vers les exchanges.
 *  - Le front reste 100 % fonctionnel SANS daemon (feature-detect /health).
 *  - Déviation assumée vs roadmap E1 : les proxys Vite restent en DEV (dev sans
 *    daemon) ; le daemon est le chemin de PROD + services additionnels. La source
 *    UNIQUE des secrets reste apps/web/.env (lu par Vite ET par le daemon).
 *
 * Architecture modulaire : un Routeur où chaque module enregistre ses routes
 * (proxy aujourd'hui ; kv/alertes ajoutés par les agents suivants).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { demarrerBoucleAlertes, enregistrerAlertes } from "./alerts";
import { compterEntrees } from "./cache";
import { enregistrerCandles } from "./candles";
import { entetesCors, reponsePreflight } from "./cors";
import { chargerCles } from "./env";
import { enregistrerKv } from "./kv";
import { enregistrerProxy } from "./proxy";
import { enregistrerReplay } from "./replay";
import { Routeur } from "./router";
import { demarrerBoucleSnapshots, enregistrerSnapshots } from "./snapshots";
import { distExiste, servirStatique } from "./static";

const HOSTNAME = "127.0.0.1";
const PORT = Number(process.env.AXIOMD_PORT ?? 8787) || 8787;

/** Version lue à chaud depuis package.json (pas d'import JSON → pas de souci d'include tsc). */
const VERSION: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

// --- Assemblage du routeur -------------------------------------------------
const cles = chargerCles();
const routeur = new Routeur();

// /health : sonde de disponibilité (feature-detect du front).
// Les en-têtes CORS sont indispensables : en DEV le front (Vite 5173) sonde en
// cross-origin ; sans `Access-Control-Allow-Origin`, la détection échouerait alors
// même que le daemon tourne.
routeur.enregistrerPrefixe("/health", (req) => {
  const corps = JSON.stringify({
    ok: true,
    version: VERSION,
    uptime: process.uptime(),
    cache: { entrees: compterEntrees() },
    dist: distExiste(),
  });
  return new Response(corps, {
    headers: { "content-type": "application/json; charset=utf-8", ...entetesCors(req) },
  });
});

// Proxys (les 4 routes répliquant vite.config.ts).
enregistrerProxy(routeur, cles);

// Persistance durable (Phase 2.E2) : store clé/valeur + cache long terme des bougies.
// Snapshots AVANT kv : `/kv/snapshots` doit primer sur le handler générique `/kv`.
enregistrerSnapshots(routeur);
enregistrerKv(routeur);
enregistrerCandles(routeur);

// Alertes onglet fermé (Phase 2.E3) : routes GET /alerts/journal + POST /heartbeat.
enregistrerAlertes(routeur);

// Replay de marché (Phase 4.4) : téléchargement à la demande des dumps aggTrades.
enregistrerReplay(routeur);

// --- Gestionnaire principal ------------------------------------------------
async function gestionnaire(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return reponsePreflight(req);
  const reponse = await routeur.gerer(req, url);
  if (reponse) return reponse;
  // Fallback : service statique du build front.
  return servirStatique(url);
}

const serveur = Bun.serve({
  hostname: HOSTNAME,
  port: PORT,
  fetch: gestionnaire,
  error(err) {
    console.error("[axiomd] erreur non gérée :", err);
    return new Response("Erreur interne du daemon", { status: 500 });
  },
});

// Boucle d'alertes onglet fermé : feed Binance (symboles à alerte active) + poll KV.
// Inerte tant qu'aucune alerte binance active n'existe (aucune WS ouverte).
demarrerBoucleAlertes();

// Boucle de sauvegarde quotidienne : snapshot horodaté du KV + purge (rétention 30 j).
// Vérification à froid (~1 h) — jamais sur le chemin chaud du renderer.
demarrerBoucleSnapshots();

console.log(
  `[axiomd] v${VERSION} écoute sur http://${serveur.hostname}:${serveur.port} ` +
    `(build front ${distExiste() ? "présent" : "absent — pnpm --filter @axiom/web build"})`,
);
