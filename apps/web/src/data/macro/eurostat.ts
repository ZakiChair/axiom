/**
 * Transport Eurostat — API de dissémination, format JSON-stat 2.0.
 *
 * En-tête CORS : `Access-Control-Allow-Origin: *` (vérifié le 2026-09-06) → appel DIRECT,
 * aucun ajout à shared/extapi-hosts.ts.
 *
 * Format : `value` est un dictionnaire indexé par POSITION dans l'hypercube, pas par
 * période. La correspondance passe par `dimension.time.category.index`. Comme toutes les
 * dimensions non temporelles sont fixées à une modalité par le catalogue, la position
 * d'une observation EST son index temporel — mais on le vérifie au lieu de le supposer.
 *
 * DEUX GARDES :
 *   1. `value` vide sur un HTTP 200 = échec de source, jamais « série vide ». Eurostat
 *      répond ainsi quand un jeu est archivé ou la clé sans donnée.
 *   2. Une réponse dont une dimension non temporelle a plus d'une modalité est REFUSÉE :
 *      cela signale une requête sous-filtrée (le poste `coicop18` compte 555 modalités,
 *      d'où des milliers de valeurs) et le calcul de position ne serait plus fiable.
 *
 * ⚠️ ECOICOP v2 : la dimension est `coicop18` et le poste global `TOTAL`. Le jeu
 * `prc_hicp_manr` est ARCHIVÉ — son propre label annonce « (1997-2025) ».
 */
import type { MacroPoint, MacroSeries } from "./types";
import { periodeVersMs, trierChrono } from "./harmonisation";

const BASE_EUROSTAT = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";

function champ(o: unknown, cle: string): unknown {
  return typeof o === "object" && o !== null ? (o as Record<string, unknown>)[cle] : undefined;
}

/** Convertit une réponse JSON-stat en série. Lève sur échec de source. PURE. */
export function parseEurostatJsonStat(json: unknown): MacroSeries {
  const ids = champ(json, "id");
  const tailles = champ(json, "size");
  if (!Array.isArray(ids) || !Array.isArray(tailles) || ids.length !== tailles.length) {
    throw new Error("Eurostat : structure de dimensions inexploitable");
  }

  const positionTemps = ids.indexOf("time");
  if (positionTemps === -1) throw new Error("Eurostat : dimension temporelle absente");

  // Garde anti-payload : toute dimension non temporelle doit être réduite à une modalité.
  for (let i = 0; i < ids.length; i++) {
    if (i === positionTemps) continue;
    if (Number(tailles[i]) !== 1) {
      throw new Error(`Eurostat : réponse insuffisamment filtrée sur « ${String(ids[i])} »`);
    }
  }

  const dimension = champ(json, "dimension");
  const index = champ(champ(champ(dimension, "time"), "category"), "index");
  if (typeof index !== "object" || index === null) {
    throw new Error("Eurostat : index temporel absent");
  }

  const valeurs = champ(json, "value");
  if (typeof valeurs !== "object" || valeurs === null) {
    throw new Error("Eurostat : bloc de valeurs absent");
  }
  const table = valeurs as Record<string, unknown>;
  if (Object.keys(table).length === 0) {
    throw new Error("Eurostat : réponse vide (source indisponible ou jeu archivé)");
  }

  // Pas d'écart entre positions successives : toutes les autres dimensions valent 1, et
  // `time` est la dernière de `id`. La position d'une observation est donc son index.
  const points: MacroPoint[] = [];
  for (const [periode, pos] of Object.entries(index as Record<string, number>)) {
    const brut = table[String(pos)];
    const value = Number(brut);
    if (brut === undefined || brut === null || !Number.isFinite(value)) continue;
    const time = periodeVersMs(periode);
    if (!Number.isFinite(time)) continue;
    points.push({ time, value });
  }
  return trierChrono(points);
}

/** Récupère une série Eurostat. `filtres` doit fixer TOUTES les dimensions non temporelles. */
export async function chargerSerieEurostat(
  dataset: string,
  filtres: Record<string, string>,
  depuisMs: number,
  signal?: AbortSignal,
): Promise<MacroSeries> {
  const params = new URLSearchParams(filtres);
  params.set("sinceTimePeriod", new Date(depuisMs).toISOString().slice(0, 7));
  params.set("format", "JSON");
  const res = await fetch(`${BASE_EUROSTAT}/${dataset}?${params.toString()}`, { signal });
  if (!res.ok) throw new Error(`Eurostat ${res.status} ${res.statusText}`);
  return parseEurostatJsonStat(await res.json());
}
