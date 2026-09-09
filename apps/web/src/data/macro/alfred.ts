/**
 * Vues ALFRED : FRED date les disponibilités par jour, jamais par heure. Ce module
 * conserve donc les quatre dates reçues sans fabriquer de timestamp intrajournalier.
 */
import { ErreurHttpFred, lireCleFred } from "./fred";

const OBSERVATIONS_URL = "/fredapi/fred/series/observations";
const DEBUT_ALFRED = "1776-07-04";
const FIN_ALFRED = "9999-12-31";

export interface ObservationAlfred {
  periode: string;
  valeur: number;
  connuDepuis: string;
  connuJusqua: string;
}

export interface OptionsAlfred {
  signal?: AbortSignal;
  debut?: string;
  fin?: string;
}

interface ReponseAlfred {
  observations: Array<{ date: string; value: string; realtime_start: string; realtime_end: string }>;
}

function assertDate(value: string, nom: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${nom} doit être une date YYYY-MM-DD valide.`);
  }
}

function construireParams(seriesId: string, opts: OptionsAlfred, realtimeStart: string, realtimeEnd: string, outputType?: "4"): URLSearchParams {
  if (!seriesId.trim()) throw new Error("seriesId ALFRED requis.");
  if (opts.debut) assertDate(opts.debut, "debut");
  if (opts.fin) assertDate(opts.fin, "fin");
  const params = new URLSearchParams({ series_id: seriesId, file_type: "json", realtime_start: realtimeStart, realtime_end: realtimeEnd });
  if (opts.debut) params.set("observation_start", opts.debut);
  if (opts.fin) params.set("observation_end", opts.fin);
  if (outputType) params.set("output_type", outputType);
  const key = lireCleFred();
  if (key) params.set("api_key", key);
  return params;
}

async function charger(params: URLSearchParams, signal?: AbortSignal): Promise<ObservationAlfred[]> {
  const response = await fetch(`${OBSERVATIONS_URL}?${params.toString()}`, { signal });
  if (!response.ok) throw new ErreurHttpFred(response.status, response.statusText);
  const json = await response.json() as ReponseAlfred;
  return json.observations.flatMap((observation) => {
    const valeur = Number(observation.value);
    if (!Number.isFinite(valeur)) return [];
    try {
      assertDate(observation.date, "periode");
      assertDate(observation.realtime_start, "realtime_start");
      assertDate(observation.realtime_end, "realtime_end");
    } catch {
      return [];
    }
    return [{ periode: observation.date, valeur, connuDepuis: observation.realtime_start, connuJusqua: observation.realtime_end }];
  });
}

/** Vue connue au jour inclus `connuLe`; les réponses trop tardives sont filtrées défensivement. */
export async function chargerVueAlfred(seriesId: string, connuLe: string, options: OptionsAlfred = {}): Promise<ObservationAlfred[]> {
  assertDate(connuLe, "connuLe");
  const observations = await charger(construireParams(seriesId, options, connuLe, connuLe), options.signal);
  return observations.filter((o) => o.connuDepuis <= connuLe && o.connuJusqua >= connuLe);
}

/** Premières valeurs publiées pour chaque période, sans cutoff point-in-time. */
export async function chargerPremieresPublicationsAlfred(seriesId: string, options: OptionsAlfred = {}): Promise<ObservationAlfred[]> {
  return charger(construireParams(seriesId, options, DEBUT_ALFRED, FIN_ALFRED, "4"), options.signal);
}
