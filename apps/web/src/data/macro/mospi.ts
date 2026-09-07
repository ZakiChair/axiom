/** PLFS mensuel officiel : personnes 15+, rural + urbain, Current Weekly Status. */
import type { MacroSeries } from "./types";
import { extUrl } from "../extapi";

const MOIS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function champ(o: unknown, key: string): unknown { return o && typeof o === "object" ? (o as Record<string, unknown>)[key] : undefined; }
const PERIMETRE = { frequency: "Monthly", indicator: "UR (Unemployment Rate, in per cent)", state: "All India", AgeGroup: "15 years and above", gender: "person", sector: "rural + urban", unit: "%" };

/** Les libellés de dimensions sont renvoyés à la place des codes : contrôle du périmètre complet. */
export function parseSerieMospi(json: unknown): MacroSeries {
  const data = champ(json, "data");
  if (champ(json, "statusCode") !== true || !Array.isArray(data)) throw new Error("MoSPI : données indisponibles");
  const points = new Map<number, number>();
  for (const ligne of data) {
    if (!Object.entries(PERIMETRE).every(([key, value]) => champ(ligne, key) === value)) continue;
    const year = champ(ligne, "year"), month = champ(ligne, "month"), raw = champ(ligne, "value");
    if (typeof year !== "string" || !/^\d{4}$/.test(year) || Number(year) < 2025 || typeof month !== "string") continue;
    const mois = MOIS.indexOf(month);
    if (mois < 0 || (typeof raw !== "number" && (typeof raw !== "string" || raw.trim() === ""))) continue;
    const value = Number(raw), time = Date.UTC(Number(year), mois, 1);
    if (!Number.isFinite(value) || value < 0 || value > 100) continue;
    if (points.has(time) && points.get(time) !== value) throw new Error("MoSPI : observations contradictoires");
    points.set(time, value);
  }
  return [...points].map(([time, value]) => ({ time, value })).sort((a, b) => a.time - b.time);
}

export async function chargerSerieMospi(_serie: "chomage", depuisMs: number, signal?: AbortSignal): Promise<MacroSeries> {
  const points = new Map<number, number>();
  let totalPages = 1;
  for (let page = 1; page <= totalPages; page++) {
    if (signal?.aborted) throw new DOMException("Annulé", "AbortError");
    // year_type_code est mal renseigné sur l'historique mensuel amont : ce filtre
    // élimine 13/16 mois au 07/09/2026. Les années explicites des lignes sont contrôlées.
    const params = new URLSearchParams({ indicator_code: "3", frequency_code: "3", state_code: "99", gender_code: "3", sector_code: "3", age_code: "1", limit: "200", page: String(page), Format: "JSON" });
    const response = await fetch(extUrl("api.mospi.gov.in", `/api/plfs/getData?${params}`), { signal });
    if (!response.ok) throw new Error(`MoSPI ${response.status}`);
    const json: unknown = await response.json();
    const meta = champ(json, "meta_data"), pages = champ(meta, "totalPages");
    if (typeof pages !== "number" || !Number.isInteger(pages) || pages < 1 || pages > 10 || champ(meta, "page") !== page) throw new Error("MoSPI : pagination invalide");
    totalPages = pages;
    for (const point of parseSerieMospi(json)) {
      if (points.has(point.time) && points.get(point.time) !== point.value) throw new Error("MoSPI : observations contradictoires");
      points.set(point.time, point.value);
    }
  }
  return [...points].map(([time, value]) => ({ time, value })).filter((p) => p.time >= depuisMs && p.time <= Date.now()).sort((a, b) => a.time - b.time);
}
