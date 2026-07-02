/**
 * Flux ETF spot BTC — tentative DefiLlama, sinon DÉGRADATION propre.
 *
 * ⚠️ ÉTAT (vérifié en réel le 2026-07-02) : AUCUN endpoint DefiLlama gratuit ne sert
 * les flux ETF — `api.llama.fi/etfs`, `/etf/flows`, `/etfs/overview` renvoient 404, et
 * `/overview/etfs` renvoie 500 « Internal Error ». Conformément à la mission, on ne
 * SCRAPE PAS Farside en v1 : la section ETF affiche « source indisponible » proprement.
 *
 * Ce module TENTE tout de même l'appel (au cas où l'endpoint réapparaîtrait) puis
 * dégrade en `disponible:false`. Le résultat négatif est mémoïsé en cache pour éviter
 * de marteler un endpoint cassé à chaque ouverture de la fenêtre.
 */
import { ecrireCache, estFrais, lireCache } from "./cache";

/** Endpoint testé (le plus proche d'exister — renvoie 500 aujourd'hui). */
const URL_TENTATIVE = "https://api.llama.fi/overview/etfs";
/** TTL du résultat (négatif comme positif) : 6 h. */
export const ETF_TTL_MS = 6 * 60 * 60 * 1000;

/** Flux d'un émetteur pour la journée. */
export interface FluxEmetteur {
  emetteur: string;
  /** Flux net du jour (USD ; + = entrées). */
  flux: number;
}

/** Résultat de la section ETF (dégradable). */
export interface EtfResultat {
  disponible: boolean;
  /** Raison de l'indisponibilité (affichée telle quelle). */
  raison?: string;
  jour?: string;
  parEmetteur?: FluxEmetteur[];
  /** Cumul net du jour (USD). */
  total?: number;
}

/**
 * Parse une réponse ETF DefiLlama en flux par émetteur. DÉFENSIF : toute forme non
 * reconnue (null, chaîne d'erreur, tableau vide) → `disponible:false`. PURE.
 *
 * NB : la forme exacte n'étant pas documentée en gratuit, on ne reconnaît qu'un schéma
 * plausible `{ day, issuers:[{ name, flow }] }` ; l'endpoint réel ne le renvoie pas
 * aujourd'hui, mais ce parseur reste prêt si DefiLlama réexpose la donnée.
 */
export function parseEtfFlows(json: unknown): EtfResultat {
  const indisponible: EtfResultat = { disponible: false, raison: "Flux ETF indisponibles (source gratuite fermée)." };
  if (json === null || typeof json !== "object") return indisponible;

  const obj = json as { day?: unknown; issuers?: unknown };
  if (!Array.isArray(obj.issuers) || obj.issuers.length === 0) return indisponible;

  const parEmetteur: FluxEmetteur[] = [];
  for (const brut of obj.issuers) {
    const it = brut as { name?: unknown; flow?: unknown };
    const emetteur = typeof it.name === "string" ? it.name : undefined;
    const flux = typeof it.flow === "number" ? it.flow : Number(it.flow);
    if (emetteur === undefined || !Number.isFinite(flux)) continue;
    parEmetteur.push({ emetteur, flux });
  }
  if (parEmetteur.length === 0) return indisponible;

  const total = parEmetteur.reduce((s, e) => s + e.flux, 0);
  return {
    disponible: true,
    jour: typeof obj.day === "string" ? obj.day : undefined,
    parEmetteur,
    total,
  };
}

/**
 * Tente de récupérer les flux ETF ; renvoie toujours un résultat exploitable
 * (`disponible:false` en cas d'échec). Le résultat est caché 6 h pour éviter de
 * re-tenter un endpoint cassé à chaque ouverture.
 */
export async function fetchEtfFlows(signal?: AbortSignal): Promise<EtfResultat> {
  const cle = "etf:flows";
  const cache = await lireCache<EtfResultat>(cle);
  if (estFrais(cache, ETF_TTL_MS) && cache !== null) return cache.donnee;

  let resultat: EtfResultat;
  try {
    const res = await fetch(URL_TENTATIVE, { signal });
    resultat = res.ok ? parseEtfFlows((await res.json()) as unknown) : { disponible: false, raison: `Source ETF indisponible (HTTP ${res.status}).` };
  } catch {
    resultat = { disponible: false, raison: "Flux ETF indisponibles (source gratuite fermée)." };
  }
  await ecrireCache(cle, resultat);
  return resultat;
}
