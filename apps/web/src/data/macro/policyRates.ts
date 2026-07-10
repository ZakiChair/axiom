/**
 * Taux directeurs des banques centrales — source BIS SDMX, dataflow WS_CBPOL.
 *
 * UN SEUL appel récupère les douze grandes banques curées (Fed, BCE, BoE, BoJ, BNS,
 * PBOC, BoC, RBA, BCB, RBI, BoK, Banxico) :
 *   GET https://stats.bis.org/api/v1/data/WS_CBPOL/D.<ZONES_BIS>/all
 *       ?format=csv&lastNObservations=1
 *   Colonnes utiles : REF_AREA (US/XM/JP/…), TIME_PERIOD (date), OBS_VALUE (taux
 *   en %, ex. 3.625), TITLE (libellé source). Sans clé, réponse « guest ». Routé via
 *   le proxy /extapi (hôte `stats.bis.org`, sans en-tête CORS).
 *
 * Le parsing (CSV → taux) est PUR et testé (policyRates.test.ts). Seul `charger*` a un
 * effet de bord. Dégradation gracieuse : source en panne → tableau vide, jamais d'erreur.
 */
import { extUrl } from "../extapi";
import { accesseurColonnes, parseCsv } from "./csv";

// ─────────────────────────── Types + mapping des banques ───────────────────────────

/** Un taux directeur normalisé (une banque centrale). */
export interface TauxDirecteur {
  /** Code de zone BIS (US, XM, JP, CN, …). */
  refArea: string;
  /** Nom d'affichage FR de la banque centrale. */
  banque: string;
  /** Sigle court (Fed, BCE, PBOC, Banxico, …). */
  sigle: string;
  /** Taux directeur en POURCENT. */
  taux: number;
  /** Date de l'observation (« YYYY-MM-DD »). */
  date: string;
}

/**
 * Zones BIS ciblées → identité de la banque centrale. L'ORDRE fixe l'affichage
 * (les cinq grandes d'abord, Fed en tête, puis le reste du jeu curé). Toute zone
 * hors de cette table est ignorée (on ne surface que les banques curées).
 */
const BANQUES: ReadonlyArray<{ refArea: string; banque: string; sigle: string }> = [
  { refArea: "US", banque: "Réserve fédérale (US)", sigle: "Fed" },
  { refArea: "XM", banque: "Banque centrale européenne", sigle: "BCE" },
  { refArea: "GB", banque: "Bank of England", sigle: "BoE" },
  { refArea: "JP", banque: "Banque du Japon", sigle: "BoJ" },
  { refArea: "CH", banque: "Banque nationale suisse", sigle: "BNS" },
  { refArea: "CN", banque: "Banque populaire de Chine", sigle: "PBOC" },
  { refArea: "CA", banque: "Banque du Canada", sigle: "BoC" },
  { refArea: "AU", banque: "Banque de réserve d'Australie", sigle: "RBA" },
  { refArea: "BR", banque: "Banque centrale du Brésil", sigle: "BCB" },
  { refArea: "IN", banque: "Banque de réserve de l'Inde", sigle: "RBI" },
  { refArea: "KR", banque: "Banque de Corée", sigle: "BoK" },
  { refArea: "MX", banque: "Banque du Mexique", sigle: "Banxico" },
];

/** Codes des zones interrogées (clé BIS `D.US+XM+GB+JP+CH+CN+…`). */
export const ZONES_BIS = BANQUES.map((b) => b.refArea).join("+");

// ─────────────────────────── Parsing PUR ───────────────────────────

/**
 * Parse le CSV BIS WS_CBPOL en taux directeurs normalisés, dans l'ordre d'affichage
 * de `BANQUES` (Fed en tête). Ne retient qu'une observation par zone (la
 * dernière rencontrée, l'appel `lastNObservations=1` n'en renvoyant qu'une). Ignore
 * toute zone non ciblée ou toute valeur non numérique. Fonction PURE.
 */
export function parseBisPolicyRatesCsv(csv: string): TauxDirecteur[] {
  const { entetes, lignes } = parseCsv(csv);
  if (entetes.length === 0) return [];
  const col = accesseurColonnes(entetes);

  // Regroupe la dernière observation valide par zone.
  const parZone = new Map<string, { taux: number; date: string }>();
  for (const ligne of lignes) {
    const refArea = col(ligne, "REF_AREA");
    const valeurBrute = col(ligne, "OBS_VALUE");
    const date = col(ligne, "TIME_PERIOD") ?? "";
    if (refArea === undefined || valeurBrute === undefined) continue;
    const taux = Number(valeurBrute);
    if (!Number.isFinite(taux)) continue;
    parZone.set(refArea, { taux, date });
  }

  const out: TauxDirecteur[] = [];
  for (const { refArea, banque, sigle } of BANQUES) {
    const obs = parZone.get(refArea);
    if (obs === undefined) continue;
    out.push({ refArea, banque, sigle, taux: obs.taux, date: obs.date });
  }
  return out;
}

// ─────────────────────────── Chargement (effet de bord) ───────────────────────────

/**
 * Charge les taux directeurs des grandes banques centrales curées (effet de bord :
 * fetch CSV texte). Dégradation gracieuse : renvoie [] en cas d'échec réseau/HTTP.
 */
export async function chargerTauxDirecteurs(signal?: AbortSignal): Promise<TauxDirecteur[]> {
  try {
    const chemin = `api/v1/data/WS_CBPOL/D.${ZONES_BIS}/all?format=csv&lastNObservations=1`;
    const res = await fetch(extUrl("stats.bis.org", chemin), { signal });
    if (!res.ok) return [];
    return parseBisPolicyRatesCsv(await res.text());
  } catch {
    return [];
  }
}
