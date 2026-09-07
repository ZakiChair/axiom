import { parseGscpi, type SerieGeo } from "../../../../../shared/geo-series";
import { ecrireCache, estFrais, lireCache } from "../onchain/cache";
import { extUrl } from "../extapi";

export type IndiceGeo = "gpr" | "tpu" | "gscpi";
export const SOURCES_GEO = {
  gpr: { nom: "Risque géopolitique", source: "https://www.matteoiacoviello.com/gpr.htm", route: "/extapi/www.matteoiacoviello.com/gpr.htm", unite: "indice", attribution: "Caldara & Iacoviello · CC BY 4.0", detail: "Fréquence d’articles sur les risques géopolitiques ; indice de presse, pas une probabilité de conflit." },
  tpu: { nom: "Incertitude commerciale", source: "https://www.matteoiacoviello.com/tpu.htm", route: "/extapi/www.matteoiacoviello.com/tpu.htm", unite: "indice", attribution: "Caldara, Iacoviello, Molligo, Prestipino & Raffo · CC BY 4.0", detail: "Incertitude de politique commerciale dans la presse ; ne mesure pas le taux effectif des droits de douane." },
  gscpi: { nom: "Pression sur les chaînes d’approvisionnement", source: "https://www.newyorkfed.org/research/policy/gscpi", route: "/extapi/www.newyorkfed.org/medialibrary/research/interactives/data/gscpi/gscpi_interactive_data.csv", unite: "écarts-types", attribution: "Federal Reserve Bank of New York · GSCPI", detail: "Écart à la moyenne historique ; positif = pression supérieure à la normale. Transport et enquêtes industrielles combinés." },
} as const;

/** Lecture streaming avec délai global, annulation et borne sur les octets réellement reçus. */
export async function lireTexteBorne(url: string, signal?: AbortSignal, maxOctets = 2 * 1024 * 1024): Promise<string> {
  const controleur = new AbortController();
  const abort = () => controleur.abort(signal?.reason);
  const timer = setTimeout(() => controleur.abort(new Error("Délai de la source dépassé.")), 20_000);
  if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
  let lecteur: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const res = await fetch(url, { signal: controleur.signal, credentials: "omit" });
    if (!res.ok) { await res.body?.cancel(); throw new Error(`Source indisponible (HTTP ${res.status}).`); }
    if (Number(res.headers.get("content-length")) > maxOctets) { await res.body?.cancel(); throw new Error("Réponse trop volumineuse."); }
    if (!res.body) throw new Error("Réponse vide.");
    lecteur = res.body.getReader();
    const decoder = new TextDecoder();
    let texte = "", total = 0;
    for (;;) {
      controleur.signal.throwIfAborted();
      const { done, value } = await lecteur.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxOctets) throw new Error("Réponse trop volumineuse.");
      texte += decoder.decode(value, { stream: true });
    }
    return texte + decoder.decode();
  } catch (err) { await lecteur?.cancel().catch(() => undefined); throw err; }
  finally { lecteur?.releaseLock(); clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}

export interface HistoriqueGeo { series: SerieGeo[]; millesime: string | null; recupereTs: number; perime: boolean }
function seriesValides(x: unknown): x is SerieGeo[] {
  return Array.isArray(x) && x.length > 0 && x.length <= 3 && x.every(s => s && typeof s.id === "string" && typeof s.nom === "string" && Array.isArray(s.points) && s.points.length > 0 && s.points.length <= 2400 && s.points.every((p: { time?: unknown; value?: unknown }) => typeof p.time === "number" && Number.isFinite(p.time) && typeof p.value === "number" && Number.isFinite(p.value)));
}
export async function chargerIndiceGeo(id: IndiceGeo, signal?: AbortSignal): Promise<HistoriqueGeo> {
  const cle = `globe:indice:v1:${id}`;
  const cache = await lireCache<HistoriqueGeo>(cle);
  if (cache && seriesValides(cache.donnee?.series) && estFrais(cache, 24 * 3_600_000)) return { ...cache.donnee, perime: false };
  try {
    const route = SOURCES_GEO[id].route.slice("/extapi/".length);
    const slash = route.indexOf("/");
    const texte = await lireTexteBorne(extUrl(route.slice(0, slash), route.slice(slash)), signal);
    const gscpi = id === "gscpi" ? parseGscpi(texte) : null;
    const series: unknown = gscpi ? [{ id: "gscpi", nom: "GSCPI", points: gscpi.points }] : JSON.parse(texte);
    if (!seriesValides(series)) throw new Error("Historique géopolitique invalide.");
    signal?.throwIfAborted();
    const resultat = { series, millesime: gscpi?.millesime ?? null, recupereTs: Date.now(), perime: false };
    await ecrireCache(cle, resultat);
    return resultat;
  } catch (err) {
    if (signal?.aborted) throw err;
    if (cache && seriesValides(cache.donnee?.series)) return { ...cache.donnee, perime: true };
    throw err;
  }
}
