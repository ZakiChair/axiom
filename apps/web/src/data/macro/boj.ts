/**
 * PPI japonais national, toutes marchandises, variation annuelle publiée (CGPI,
 * base 2020). Biens produits ET vendus au Japon, exportations exclues, taxe de
 * consommation incluse. API BOJ lancée le 18/02/2026, GET JSON sans clé, sans CORS : extapi.
 * https://www.stat-search.boj.or.jp/info/api_manual_en.pdf
 * Le suffixe `%` distingue l'a/a de l'indice ; il doit être encodé `%25` en URL.
 * `LAST_UPDATE` décrit la dernière modification de série, pas sa disponibilité
 * historique pour un backtest. Les observations sont datées par `SURVEY_DATES`.
 */
import { extUrl } from "../extapi";
import type { MacroSeries } from "./types";
import { periodeVersMs, trierChrono } from "./harmonisation";

const CODE_PPI_AA = "PRCG20_2200000000%";
function champ(obj: unknown, cle: string): unknown {
  return typeof obj === "object" && obj !== null ? (obj as Record<string, unknown>)[cle] : undefined;
}

/** Taux annuel natif en %, sans nouvelle transformation ni conversion de null en 0. */
export function parseBojSeries(json: unknown, code: string, depuisMs: number): MacroSeries {
  if (code !== CODE_PPI_AA || champ(json, "STATUS") !== 200) throw new Error("BOJ : série PPI annuelle invalide");
  if (champ(json, "NEXTPOSITION") != null) throw new Error("BOJ : historique tronqué");
  const resultats = champ(json, "RESULTSET");
  if (!Array.isArray(resultats)) throw new Error("BOJ : résultats absents");
  const candidats = resultats.filter((r) => champ(r, "SERIES_CODE") === code);
  if (candidats.length !== 1) throw new Error("BOJ : série PPI absente");
  const serie = candidats[0];
  if (champ(serie, "UNIT") !== "%" || champ(serie, "FREQUENCY") !== "MONTHLY") throw new Error("BOJ : unité ou fréquence inattendue");
  const bloc = champ(serie, "VALUES");
  const dates = champ(bloc, "SURVEY_DATES");
  const valeurs = champ(bloc, "VALUES");
  if (!Array.isArray(dates) || !Array.isArray(valeurs) || dates.length !== valeurs.length) throw new Error("BOJ : observations désalignées");
  const points = new Map<number, number>();
  for (let i = 0; i < dates.length; i++) {
    const periode = String(dates[i]);
    if (!/^\d{4}(0[1-9]|1[0-2])$/.test(periode)) continue;
    const time = periodeVersMs(`${periode.slice(0, 4)}-${periode.slice(4)}`);
    const value: unknown = valeurs[i];
    if (!Number.isFinite(time) || time < depuisMs || typeof value !== "number" || !Number.isFinite(value)) continue;
    if (points.has(time) && points.get(time) !== value) throw new Error("BOJ : mois contradictoire");
    points.set(time, value);
  }
  return trierChrono([...points].map(([time, value]) => ({ time, value })));
}

export async function chargerSerieBoj(code: string, depuisMs: number, signal?: AbortSignal): Promise<MacroSeries> {
  if (code !== CODE_PPI_AA || !Number.isFinite(depuisMs)) throw new Error("BOJ : demande PPI annuelle invalide");
  const startDate = new Date(depuisMs).toISOString().slice(0, 7).replace("-", "");
  const params = new URLSearchParams({ format: "json", lang: "en", db: "PR01", code, startDate });
  const res = await fetch(extUrl("www.stat-search.boj.or.jp", `api/v1/getDataCode?${params}`), { signal });
  if (!res.ok) throw new Error(`BOJ ${res.status} ${res.statusText}`);
  return parseBojSeries(await res.json(), code, depuisMs);
}
