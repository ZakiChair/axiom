/**
 * Fonction Vercel `GET /hlpool` (rewrite vercel.json → /api/hlpool) — POOL RÉDUIT de la couche
 * LIQHL en mode navigateur (extension du 25 septembre, décision du propriétaire « le
 * déploiement n'est toujours pas ok » : les niveaux de liquidation RÉELS doivent vivre sur
 * Vercel, sans daemon).
 *
 * Le leaderboard Hyperliquid pèse ≈ 39 Mo non compressés (≈ 33 s sur la liaison du poste) :
 * chaque visiteur ne doit pas le télécharger. La fonction le lit une fois, en extrait le pool
 * (~1 500 adresses, `extrairePool` PARTAGÉ avec le daemon et le navigateur) et répond
 * `{ ts, nValeur, tailleCible, adresses }` (≈ 65 Ko) avec
 * `Cache-Control: public, s-maxage=21600, stale-while-revalidate=86400` : le CDN Vercel le
 * sert à tous pendant 6 h. Le scan des positions (`clearinghouseState` × 1 500) reste dans le
 * navigateur, sur l'IP du visiteur (quota HL par IP) — cette fonction n'appelle JAMAIS
 * api.hyperliquid.xyz/info.
 *
 * AUCUN secret, AUCUNE lecture d'environnement, aucun paramètre lu (la requête ne choisit ni
 * l'hôte ni le chemin amont : URL fixe) — test structurel apps/daemon/src/vercelProxy.test.ts.
 * GET seul (autre méthode → 405). Amont en échec → 502 JSON `no-store` (jamais un pool vide
 * mis en cache 6 h) ; si l'instance garde un pool en mémoire, même périmé, il est servi avec un
 * cache court (même règle de repli que le pool persisté du daemon).
 *
 * MÉMOIRE D'INSTANCE : une requête qui contourne le cache CDN (query string arbitraire) est
 * servie par le pool gardé en mémoire tant qu'il a moins de 6 h, et les requêtes simultanées
 * partagent UN seul téléchargement en vol — pas d'amplification vers les ≈ 39 Mo.
 *
 * Délai amont 45 s sous `maxDuration` 60 s (valable sur tous les plans Vercel) : depuis un
 * datacenter le téléchargement prend quelques secondes ; la marge couvre le parse (≈ 39 Mo de
 * JSON) et la réponse. Import `../shared/hyperliquidScan.js` : même convention que
 * api/proxy.ts (../shared/*.js), résolue par le traçage de fichiers du bundler Vercel.
 */
import { N_VALEUR_POOL, poolEstFrais, TAILLE_POOL, telechargerPool, type PoolHL } from "../shared/hyperliquidScan.js";

export const config = { maxDuration: 60 };

/** Délai du téléchargement du leaderboard : 45 s, sous maxDuration (60 s). */
export const TIMEOUT_HLPOOL_AMONT_MS = 45_000;
/** Pool servi : CDN 6 h (TTL du pool), puis périmé servi 24 h pendant la revalidation. */
export const CACHE_HLPOOL = "public, s-maxage=21600, stale-while-revalidate=86400";
/** Pool PÉRIMÉ servi faute d'amont : 10 min de CDN seulement, pour réessayer tôt. */
export const CACHE_HLPOOL_REPLI = "public, s-maxage=600";

const ENTETES_SECURITE: Readonly<Record<string, string>> = {
  "x-content-type-options": "nosniff",
};

function json(status: number, corps: unknown, entetes: Record<string, string>): Response {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...ENTETES_SECURITE, ...entetes },
  });
}

/**
 * Gestionnaire `/hlpool` avec sa mémoire d'instance. `fetchImpl` et `maintenant` sont
 * injectables (tests) ; l'export par défaut en crée UN pour la durée de vie de l'instance.
 */
export function creerGestionnaireHlPool(
  fetchImpl: typeof fetch = fetch,
  maintenant: () => number = () => Date.now(),
): (request: Request) => Promise<Response> {
  let memoire: PoolHL | null = null;
  let enVol: Promise<PoolHL> | null = null;

  const telecharger = (now: number): Promise<PoolHL> => {
    if (enVol !== null) return enVol;
    const p = telechargerPool(fetchImpl, { signal: AbortSignal.timeout(TIMEOUT_HLPOOL_AMONT_MS) }).then(
      (adresses): PoolHL => ({ ts: now, nValeur: N_VALEUR_POOL, tailleCible: TAILLE_POOL, adresses }),
    );
    enVol = p;
    const liberer = (): void => {
      if (enVol === p) enVol = null;
    };
    p.then(liberer, liberer);
    return p;
  };

  return async (request: Request): Promise<Response> => {
    if (request.method !== "GET") {
      return json(405, { erreur: "méthode non autorisée" }, { allow: "GET", "cache-control": "no-store" });
    }
    const now = maintenant();
    if (memoire !== null && poolEstFrais(memoire, now)) {
      return json(200, memoire, { "cache-control": CACHE_HLPOOL });
    }
    try {
      memoire = await telecharger(now);
      return json(200, memoire, { "cache-control": CACHE_HLPOOL });
    } catch {
      if (memoire !== null) return json(200, memoire, { "cache-control": CACHE_HLPOOL_REPLI });
      return json(502, { erreur: "leaderboard Hyperliquid indisponible" }, { "cache-control": "no-store" });
    }
  };
}

const traiter = creerGestionnaireHlPool();

export default { fetch: (request: Request): Promise<Response> => traiter(request) };
