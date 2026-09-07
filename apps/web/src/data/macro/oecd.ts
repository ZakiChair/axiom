/**
 * Transport OCDE — SDMX-JSON 2.0 (sdmx.oecd.org, public, sans clé).
 *
 * En-tête CORS : l'OCDE REFLÈTE l'origine appelante (vérifié le 2026-09-06 depuis
 * localhost:5173) → appel DIRECT, aucun ajout à shared/extapi-hosts.ts.
 *
 * Format, et ses deux pièges :
 *   1. Les observations sont indexées PAR POSITION dans `structures[0].dimensions
 *      .observation[0].values`, et ce tableau N'EST PAS TRIÉ — relevé en live :
 *      ['2026-05', '2026-07', '2026-06']. D'où `trierChrono` en sortie, obligatoire.
 *   2. `REF_AREA` peut déclarer PLUSIEURS modalités même pour une clé mono-pays
 *      (la Chine arrive avec l'agrégat WXOECD). On identifie donc la série par la
 *      position lue dans sa clé « i:j:k:… », et on VÉRIFIE qu'elle correspond à la
 *      zone demandée — un silence ici produirait la courbe d'un autre pays.
 *
 * ⚠️ La clé passée doit être ENTIÈREMENT spécifiée : une clé multi-pays (« CHN+IND »)
 * ou jokerisée tronque silencieusement une série en HTTP 200. Le catalogue le garantit
 * par test (catalogueMacro.test.ts) ; ce module n'accepte qu'une zone attendue à la fois.
 *
 * QUOTA : le 429 tombe entre 10 et 12 requêtes rapprochées et son `retry-after: 0` est
 * mensonger. Il remonte comme `ErreurQuotaOecd` pour que l'appelant l'affiche en
 * « quota », jamais en « source morte ».
 */
import type { MacroPoint, MacroSeries } from "./types";
import { periodeVersMs, trierChrono } from "./harmonisation";

const BASE_OCDE = "https://sdmx.oecd.org/public/rest/data";

/** Quota OCDE atteint (HTTP 429) — à distinguer d'une panne de source. */
export class ErreurQuotaOecd extends Error {
  constructor() {
    super("Quota OCDE atteint");
    this.name = "ErreurQuotaOecd";
  }
}

/** Accès défensif à un objet inconnu. */
function champ(o: unknown, cle: string): unknown {
  return typeof o === "object" && o !== null ? (o as Record<string, unknown>)[cle] : undefined;
}

/**
 * Convertit une réponse SDMX-JSON en série, en ne retenant QUE `refAreaAttendu`.
 * Lève si la structure est inexploitable ou si la zone demandée est absente. PURE.
 */
export function parseOecdSdmxJson(json: unknown, refAreaAttendu: string): MacroSeries {
  const data = champ(json, "data");
  const structures = champ(data, "structures");
  const structure = Array.isArray(structures) ? structures[0] : undefined;
  const dimensions = champ(structure, "dimensions");
  const attributs = champ(champ(structure, "attributes"), "observation");
  const positionStatut = Array.isArray(attributs) ? attributs.findIndex((a) => champ(a, "id") === "OBS_STATUS") : -1;
  const valeursStatut = positionStatut >= 0 && Array.isArray(attributs) ? champ(attributs[positionStatut], "values") : undefined;

  const observation = champ(dimensions, "observation");
  const dimTemps = Array.isArray(observation) ? observation[0] : undefined;
  const valeursTemps = champ(dimTemps, "values");
  if (!Array.isArray(valeursTemps) || valeursTemps.length === 0) {
    throw new Error("OCDE : dimension temporelle absente");
  }
  const periodes = valeursTemps.map((v) => String(champ(v, "id") ?? ""));

  const dimSeries = champ(dimensions, "series");
  if (!Array.isArray(dimSeries)) throw new Error("OCDE : dimensions de série absentes");
  const idxRefArea = dimSeries.findIndex((d) => champ(d, "id") === "REF_AREA");
  if (idxRefArea === -1) throw new Error("OCDE : dimension REF_AREA absente");
  const dimRefArea = dimSeries[idxRefArea];
  // Préférer keyPosition si disponible (pour l'ordre d'apparition dans la clé),
  // tomber sur l'index du tableau uniquement si le champ est absent ou invalide.
  // Vérifier le TYPE avant toute coercition : Number(null) vaut 0, un entier ≥ 0
  // qui passerait le garde-fou à tort et masquerait un keyPosition absent.
  const keyPosValue = champ(dimRefArea, "keyPosition");
  const posRefAreaInKey =
    typeof keyPosValue === "number" && Number.isInteger(keyPosValue) && keyPosValue >= 0
      ? keyPosValue
      : idxRefArea;
  const valeursRefArea = champ(dimRefArea, "values");
  const zones = Array.isArray(valeursRefArea)
    ? valeursRefArea.map((v) => String(champ(v, "id") ?? ""))
    : [];

  const dataSets = champ(data, "dataSets");
  const premierJeu = Array.isArray(dataSets) ? dataSets[0] : undefined;
  const series = champ(premierJeu, "series");
  if (typeof series !== "object" || series === null) {
    throw new Error("OCDE : aucun jeu de données");
  }

  for (const [cleSerie, contenu] of Object.entries(series as Record<string, unknown>)) {
    const positions = cleSerie.split(":");
    const position = Number(positions[posRefAreaInKey]);
    if (!Number.isInteger(position)) continue;
    if (zones[position] !== refAreaAttendu) continue;

    const observations = champ(contenu, "observations");
    if (typeof observations !== "object" || observations === null) continue;

    const points: MacroPoint[] = [];
    for (const [indice, cellule] of Object.entries(observations as Record<string, unknown>)) {
      const periode = periodes[Number(indice)];
      if (periode === undefined) continue;
      const time = periodeVersMs(periode);
      if (!Number.isFinite(time)) continue;
      const raw = Array.isArray(cellule) ? cellule[0] : undefined;
      const value = typeof raw === "number" ? raw : NaN;
      if (!Number.isFinite(value)) continue;
      const indiceStatut: unknown = Array.isArray(cellule) && positionStatut >= 0 ? cellule[positionStatut + 1] : undefined;
      const statut = Array.isArray(valeursStatut) && typeof indiceStatut === "number" ? champ(valeursStatut[indiceStatut], "id") : undefined;
      const noms: Record<string, string> = { E: "estimation", P: "provisoire", B: "rupture de série", I: "imputation" };
      const qualite = typeof statut === "string" && statut !== "A" ? noms[statut] ?? `statut source : ${statut}` : undefined;
      points.push({ time, value, ...(qualite ? { qualite } : {}) });
    }
    return trierChrono(points);
  }

  throw new Error(`OCDE : zone ${refAreaAttendu} absente de la réponse`);
}

/**
 * Récupère une série OCDE. `cle` doit viser UNE seule zone et fixer toutes les dimensions.
 * `refAreaAttendu` est le premier segment de la clé — vérifié à la lecture.
 */
export async function chargerSerieOecd(
  dataflow: string,
  cle: string,
  depuisMs: number,
  signal?: AbortSignal,
): Promise<MacroSeries> {
  const refAreaAttendu = cle.split(".")[0] ?? "";
  // La borne ISO mensuelle est acceptée aussi par KEI trimestriel (sonde du 7 septembre 2026).
  const debut = new Date(depuisMs).toISOString().slice(0, 7); // « YYYY-MM »
  const url = `${BASE_OCDE}/${dataflow}/${cle}?startPeriod=${debut}&format=jsondata`;
  const res = await fetch(url, { signal });
  if (res.status === 429) throw new ErreurQuotaOecd();
  if (!res.ok) throw new Error(`OCDE ${res.status} ${res.statusText}`);
  return parseOecdSdmxJson(await res.json(), refAreaAttendu);
}
