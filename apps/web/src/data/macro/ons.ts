/**
 * Transport ONS (Office for National Statistics, Royaume-Uni).
 *
 * ⚠️ HÔTE : `www.ons.gov.uk`. L'ancienne API `api.ons.gov.uk` est DÉCOMMISSIONNÉE
 * (retirée le 25/11/2024 — elle répond 404 avec un message d'adieu).
 *
 * En-tête CORS : `Access-Control-Allow-Origin: *` (vérifié le 2026-09-06) → appel DIRECT.
 *
 * Format : un document par série, contenant `years`, `quarters` ET `months`. On ne lit
 * que `months`. Les valeurs sont des CHAÎNES (« 2.9 », parfois « NA ») et le mois est en
 * anglais en toutes lettres dans le champ `month`.
 *
 * VOLUME : la série D7G7 sert 451 mois, ~119 Ko, et l'API n'accepte AUCUN bornage amont.
 * On tronque donc à la fenêtre demandée DÈS le parsing, avant toute mise en cache.
 */
import type { MacroPoint, MacroSeries } from "./types";
import { filtrerFenetre, trierChrono } from "./harmonisation";

const BASE_ONS = "https://www.ons.gov.uk";

/** Mois anglais → index 0-11. Le champ `month` de l'ONS est en toutes lettres. */
const MOIS_ANGLAIS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

function champ(o: unknown, cle: string): unknown {
  return typeof o === "object" && o !== null ? (o as Record<string, unknown>)[cle] : undefined;
}

/** Convertit un document ONS en série, tronquée à `depuisMs`. PURE. */
export function parseOnsTimeseries(json: unknown, depuisMs: number): MacroSeries {
  const mois = champ(json, "months");
  if (!Array.isArray(mois)) throw new Error("ONS : bloc « months » absent");

  const points: MacroPoint[] = [];
  for (const entree of mois) {
    const annee = Number(champ(entree, "year"));
    const nomMois = String(champ(entree, "month") ?? "").trim().toLowerCase();
    const indexMois = MOIS_ANGLAIS[nomMois];
    if (!Number.isInteger(annee) || indexMois === undefined) continue;

    // « NA » et toute chaîne non numérique deviennent NaN → point écarté.
    const value = Number(champ(entree, "value"));
    if (!Number.isFinite(value)) continue;

    points.push({ time: Date.UTC(annee, indexMois, 1), value });
  }
  return filtrerFenetre(trierChrono(points), depuisMs);
}

/** Récupère une série ONS. `chemin` est le chemin du document, sans barre initiale. */
export async function chargerSerieOns(
  chemin: string,
  depuisMs: number,
  signal?: AbortSignal,
): Promise<MacroSeries> {
  const res = await fetch(`${BASE_ONS}/${chemin}`, { signal });
  if (!res.ok) throw new Error(`ONS ${res.status} ${res.statusText}`);
  return parseOnsTimeseries(await res.json(), depuisMs);
}
