/**
 * Politique UNIQUE de la route `/cqapi` — CryptoQuant BASIC, licence PERSONNELLE.
 *
 * Consommateurs (ne jamais dupliquer la liste ailleurs) :
 *   1. api/_policy.ts                          — fonction Vercel (import suffixé « .js »)
 *   2. apps/daemon/src/proxy.ts                — daemon 127.0.0.1 (import sans extension)
 *   3. apps/web/vite.config.ts                 — proxy de dev (import sans extension)
 *   4. apps/web/src/data/onchain/cryptoquant.ts — identifiants des sociétés (client)
 *
 * Liste FERMÉE : trois chemins éligibles à l'offre BASIC, fenêtre journalière
 * obligatoire, `limit` entier 1..30, jamais `from`/`to` (le fournisseur refuse toute
 * date antérieure à 30 jours). Zéro import : module pur partagé par les trois proxys.
 */

export const CRYPTOQUANT_HOST = "api.cryptoquant.com";
export const CRYPTOQUANT_PREFIXE = "/cqapi";
export const IDS_MINEURS_CQ = ["bitf", "cipher", "clsk", "core", "hive", "iren", "mara", "riot", "wulf"] as const;
export type IdMineurCq = (typeof IDS_MINEURS_CQ)[number];

/** Même borne que le relais Bearer BGeometrics de la fonction Vercel. */
const LONGUEUR_MAX_AUTORISATION = 512;
const CHEMINS_TAKER: ReadonlySet<string> = new Set(["/v2/market/cq/spot/trade", "/v2/market/cq/swap/trade"]);
const CHEMIN_MINEURS = "/v1/btc/miner-data/companies";
const SYMBOLES_TAKER: ReadonlySet<string> = new Set(["btc_all", "eth_all"]);
const MINEURS: ReadonlySet<string> = new Set<string>(IDS_MINEURS_CQ);
/** Entier 1..99 sans zéro initial ; la borne 30 est vérifiée à part. */
const MOTIF_LIMIT = /^[1-9]\d?$/;
const LIMIT_MAX = 30;

/**
 * En-tête `Authorization: Bearer <jeton>` recevable : exactement `Bearer` (casse indifférente),
 * UNE espace, puis un jeton de caractères ASCII visibles (0x21-0x7E). Refuse CR/LF, tabulation,
 * espaces multiples, NBSP et tout caractère Unicode : un en-tête construit depuis une valeur
 * stockée donne ainsi un 401 local plutôt qu'une exception du runtime à l'émission. Plus strict
 * que le relais Bearer BGeometrics de la fonction Vercel, laissé tel quel.
 */
export function cleCryptoQuantValide(authorization: string | null | undefined): authorization is string {
  return (
    typeof authorization === "string" &&
    authorization.length <= LONGUEUR_MAX_AUTORISATION &&
    /^Bearer [\x21-\x7E]+$/i.test(authorization)
  );
}

/**
 * Traduit un chemin local `/cqapi/<chemin>` et sa query en chemin amont CryptoQuant, ou `null`
 * hors liste fermée. Toute clé de query inconnue, en double ou de casse différente est
 * refusée ; la query de sortie est reconstruite dans l'ordre symbol|miner, window, limit.
 */
export function cheminCryptoQuantAmont(pathname: string, search: string): string | null {
  if (!pathname.startsWith(`${CRYPTOQUANT_PREFIXE}/`)) return null;
  const chemin = pathname.slice(CRYPTOQUANT_PREFIXE.length);
  const taker = CHEMINS_TAKER.has(chemin);
  if (!taker && chemin !== CHEMIN_MINEURS) return null;
  const cleSujet = taker ? "symbol" : "miner";

  const params = new URLSearchParams(search);
  const vues = new Set<string>();
  for (const cle of params.keys()) {
    if (vues.has(cle)) return null; // doublon
    vues.add(cle);
    if (cle !== cleSujet && cle !== "window" && cle !== "limit") return null; // from, to, inconnue, casse
  }

  const sujet = params.get(cleSujet);
  const admis = taker ? SYMBOLES_TAKER : MINEURS;
  if (sujet === null || !admis.has(sujet)) return null;
  if (params.get("window") !== "day") return null;
  const limit = params.get("limit");
  if (limit !== null && (!MOTIF_LIMIT.test(limit) || Number(limit) > LIMIT_MAX)) return null;

  const sortie = new URLSearchParams();
  sortie.set(cleSujet, sujet);
  sortie.set("window", "day");
  if (limit !== null) sortie.set("limit", limit);
  return `${chemin}?${sortie.toString()}`;
}
