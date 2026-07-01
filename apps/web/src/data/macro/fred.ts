/**
 * Fournisseur MACRO — M2 (masse monétaire / liquidité) via l'API FRED (St. Louis Fed).
 *
 * Endpoint (clé GRATUITE requise) :
 *   GET https://api.stlouisfed.org/fred/series/observations
 *       ?series_id=WM2NS&api_key=<KEY>&file_type=json
 *   Doc         : https://fred.stlouisfed.org/docs/api/fred/series_observations.html
 *   Clé gratuite: https://fredaccount.stlouisfed.org/apikeys
 *
 *   Réponse :
 *     { observations: [ { date: "YYYY-MM-DD", value: "21861.9" }, ... ] }
 *   Une valeur MANQUANTE est représentée par la chaîne "." (filtrée ici).
 *   Params de filtrage : observation_start / observation_end (format "YYYY-MM-DD").
 *
 * Séries M2 US :
 *   - WM2NS : M2 HEBDOMADAIRE, non désaisonnalisée (défaut ici).
 *   - M2SL  : M2 MENSUELLE, désaisonnalisée.
 *   ⚠️ UNITÉ NATIVE FRED : MILLIARDS de dollars (Billions of USD) — PAS l'USD absolu
 *   comme les deux autres mesures (CoinGecko / DefiLlama). On NE re-scale PAS
 *   silencieusement : l'appelant normalise/indexe selon son besoin (ex. base 100).
 *
 * M2 MONDIAL (liquidité globale) — faisabilité en gratuit :
 *   - US : trivial et robuste (ci-dessous), via clé FRED gratuite.
 *   - Extensible à d'autres pays HÉBERGÉS par FRED en passant un `seriesId` :
 *       zone euro, Japon, Chine, Royaume-Uni publient un agrégat M2 sur FRED.
 *       (Identifiants exacts à confirmer au cas par cas sur fred.stlouisfed.org —
 *        ils diffèrent en devise/désaisonnalisation et NE sont pas additionnables tels quels.)
 *   - Sources natives gratuites pour une vraie agrégation : BCE (SDMX REST
 *       https://data-api.ecb.europa.eu/service/data/BSI/... , sans clé), BoJ, PBoC.
 *   - OBSTACLE à une « masse monétaire mondiale » propre : conversion FX vers USD +
 *       harmonisation des fréquences/unités/définitions de M2. Hors périmètre d'un
 *       simple fournisseur : on livre le M2 US extensible et on documente le chemin.
 *
 * CLÉ : l'utilisateur peut saisir SA clé dans les Réglages (param `opts.apiKey` ou
 * localStorage) ; elle est alors envoyée explicitement. Sinon on n'envoie AUCUNE clé
 * et le proxy de dev (/fredapi) injecte la clé de repli lue dans .env (voir
 * vite.config.ts) — la clé n'est donc jamais committée dans le source ni le bundle.
 * Si le .env est vide, l'API renvoie 401 (erreur remontée à l'appelant).
 */
import type { IMacroProvider, MacroFetchOptions, MacroPoint, MacroSeries } from "./types";

// Base SAME-ORIGIN via le proxy de dev Vite (cf. vite.config.ts). L'API FRED ne
// renvoie AUCUN en-tête CORS : un appel direct depuis le navigateur est bloqué.
const OBSERVATIONS_URL = "/fredapi/fred/series/observations";
const API_KEY_STORAGE = "axiom.fred.apiKey";

/** Réponse partielle de fred/series/observations (champs utiles uniquement). */
interface FredObservationsResponse {
  observations: Array<{ date: string; value: string }>;
}

/**
 * Lit la clé FRED PERSONNELLE : param explicite > localStorage > aucune.
 * `undefined` = pas de clé côté front → le proxy /fredapi injectera la clé de repli
 * (.env). On ne committe plus de clé « par défaut » dans le source.
 */
function resolveFredKey(opts?: MacroFetchOptions): string | undefined {
  if (opts?.apiKey) return opts.apiKey;
  try {
    if (typeof localStorage !== "undefined") {
      const v = localStorage.getItem(API_KEY_STORAGE);
      return v !== null && v.length > 0 ? v : undefined;
    }
  } catch {
    // Accès localStorage interdit — on s'en remet à la clé injectée par le proxy.
  }
  return undefined;
}

/** Convertit un horodatage ms en date FRED "YYYY-MM-DD" (UTC). */
function toFredDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Construit un fournisseur M2 pour une série FRED donnée.
 * @param seriesId identifiant FRED de la série M2 (défaut "WM2NS", M2 US hebdo).
 */
export function createFredM2Provider(seriesId = "WM2NS"): IMacroProvider {
  const id = `fred-${seriesId.toLowerCase()}`;
  return {
    id,

    async fetchSeries(opts?: MacroFetchOptions): Promise<MacroSeries> {
      const key = resolveFredKey(opts);
      const params = new URLSearchParams({
        series_id: seriesId,
        file_type: "json",
      });
      // Clé personnelle → envoyée explicitement (le proxy la détecte et n'injecte
      // PAS le repli). Sans clé, on n'envoie RIEN → le proxy injecte la clé .env.
      if (key !== undefined) params.set("api_key", key);
      if (opts?.start !== undefined) params.set("observation_start", toFredDate(opts.start));
      if (opts?.end !== undefined) params.set("observation_end", toFredDate(opts.end));

      const res = await fetch(`${OBSERVATIONS_URL}?${params.toString()}`, { signal: opts?.signal });
      if (!res.ok) {
        throw new Error(`FRED observations ${res.status} ${res.statusText}`);
      }
      const json = (await res.json()) as FredObservationsResponse;

      const series: MacroSeries = [];
      for (const o of json.observations) {
        const value = Number(o.value); // "." => NaN (valeur manquante)
        if (!Number.isFinite(value)) continue;
        const time = Date.parse(`${o.date}T00:00:00Z`);
        if (!Number.isFinite(time)) continue;
        const point: MacroPoint = { time, value };
        series.push(point);
      }
      return series;
    },
  };
}

/** M2 US HEBDOMADAIRE, non désaisonnalisée (WM2NS) — défaut. */
export const fredM2WeeklyProvider = createFredM2Provider("WM2NS");
/** M2 US MENSUELLE, désaisonnalisée (M2SL). */
export const fredM2MonthlyProvider = createFredM2Provider("M2SL");
