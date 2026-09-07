import { ecrireCache, estFrais, lireCache } from "../onchain/cache";
import { lireTexteBorne } from "./indicesGeo";

export interface JourPortWatch { time: number; navires: number | null; tankers: number | null; cargos: number | null }
export type MesurePortWatch = "navires" | "tankers" | "cargos";
const JOUR = 86_400_000;
const URL_QUERY = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query";

function nombre(x: unknown): number | null {
  if (x === null || x === undefined || x === "" || typeof x === "boolean") return null;
  const n = Number(x);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function parseHistoriquePortWatch(json: unknown, portid: string): JourPortWatch[] {
  const features = (json as { features?: { attributes?: Record<string, unknown> }[] } | null)?.features;
  if (!Array.isArray(features)) throw new Error("Historique PortWatch invalide.");
  const points = new Map<number, JourPortWatch>();
  for (const f of features) {
    const a = f.attributes;
    if (!a || a.portid !== portid || typeof a.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(a.date)) continue;
    const time = Date.parse(`${a.date}T00:00:00Z`);
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== a.date) continue;
    points.set(time, { time, navires: nombre(a.n_total), tankers: nombre(a.n_tanker), cargos: nombre(a.n_cargo) });
  }
  return [...points.values()].sort((a, b) => a.time - b.time);
}

function finAnneePrecedente(time: number, n: number): number {
  const d = new Date(time), annee = d.getUTCFullYear() - n, mois = d.getUTCMonth();
  const jour = Math.min(d.getUTCDate(), new Date(Date.UTC(annee, mois + 1, 0)).getUTCDate());
  return Date.UTC(annee, mois, jour);
}

export function statistiquesPortWatch(points: readonly JourPortWatch[], mesure: MesurePortWatch) {
  const fin = points.at(-1)?.time ?? null;
  const parDate = new Map(points.map(p => [p.time, p[mesure]]));
  const moyenne = (t: number): number | null => {
    let somme = 0;
    for (let j = 0; j < 7; j++) {
      const value = parDate.get(t - j * JOUR);
      if (value === null || value === undefined || !Number.isFinite(value)) return null;
      somme += value;
    }
    return somme / 7;
  };
  const moyenne7j = fin === null ? null : moyenne(fin);
  const refs = fin === null ? [] : [1, 2, 3].map(n => moyenne(finAnneePrecedente(fin, n))).filter((n): n is number => n !== null).sort((a, b) => a - b);
  const reference = refs.length < 2 ? null : refs.length === 2 ? (refs[0]! + refs[1]!) / 2 : refs[1]!;
  return { fin, moyenne7j, reference, anneesReference: refs.length, ecartPct: moyenne7j === null || reference === null || reference === 0 ? null : (moyenne7j / reference - 1) * 100 };
}

export interface HistoriquePortWatch { points: JourPortWatch[]; recupereTs: number; perime: boolean }
/** Historique à la demande pour un détroit : quatre pages maximum, cache six heures. */
export async function chargerHistoriquePortWatch(portid: string, fin: string, signal?: AbortSignal): Promise<HistoriquePortWatch> {
  if (!/^chokepoint\d{1,3}$/.test(portid) || !/^\d{4}-\d{2}-\d{2}$/.test(fin) || !Number.isFinite(Date.parse(fin)) || new Date(fin).toISOString().slice(0, 10) !== fin) throw new Error("Détroit ou date invalide.");
  // Une entrée par détroit, remplacée à chaque édition (pas une copie par jour).
  const cle = `globe:portwatch:v1:${portid}`;
  const cache = await lireCache<{ fin: string; points: JourPortWatch[] }>(cle);
  if (cache?.donnee?.fin === fin && Array.isArray(cache.donnee.points) && estFrais(cache, 6 * 3_600_000)) return { points: cache.donnee.points, recupereTs: cache.ts, perime: false };
  const debut = new Date(finAnneePrecedente(Date.parse(fin), 3) - 6 * JOUR).toISOString().slice(0, 10);
  const points: JourPortWatch[] = [];
  try {
    for (let page = 0; page < 4; page++) {
      const query = new URLSearchParams({ f: "json", returnGeometry: "false", where: `portid='${portid}' AND date>=DATE'${debut}' AND date<=DATE'${fin}'`, outFields: "date,portid,n_total,n_tanker,n_cargo", orderByFields: "date ASC", resultRecordCount: "1000", resultOffset: String(page * 1000) });
      const json = JSON.parse(await lireTexteBorne(`${URL_QUERY}?${query}`, signal, 2 * 1024 * 1024)) as { exceededTransferLimit?: boolean };
      points.push(...parseHistoriquePortWatch(json, portid));
      if (!json.exceededTransferLimit) {
        if (!points.length) throw new Error("Historique PortWatch vide.");
        const uniques = [...new Map(points.map(p => [p.time, p])).values()].sort((a, b) => a.time - b.time);
        signal?.throwIfAborted();
        await ecrireCache(cle, { fin, points: uniques });
        return { points: uniques, recupereTs: Date.now(), perime: false };
      }
    }
    throw new Error("Pagination PortWatch incomplète.");
  } catch (err) {
    if (signal?.aborted) throw err;
    if (cache && Array.isArray(cache.donnee?.points)) return { points: cache.donnee.points, recupereTs: cache.ts, perime: true };
    throw err;
  }
}
