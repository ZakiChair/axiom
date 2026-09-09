export interface QualiteMetrique {
  sourceId: string;
  sourceEffective: string;
  observeLe: number | null;
  recupereLe: number | null;
  cadenceMs: number | null;
  /** Âge maximal de l'observation, fixé par la source ; distinct de la cadence de collecte. */
  ageMaxMs?: number | null;
  couverture: { disponibles: number; attendus: number } | null;
  estime: boolean;
  acces: "public" | "cle" | "abonnement" | "indisponible";
  statut: "frais" | "perime" | "partiel" | "indisponible" | "en-construction";
  raison?: string;
}

/** Projection de lecture : ne modifie ni l'acquisition ni le dernier diagnostic de source. */
export function actualiserQualite(qualite: QualiteMetrique, now: number): QualiteMetrique {
  if (qualite.statut === "indisponible" || qualite.statut === "perime") return qualite;
  const { observeLe, ageMaxMs } = qualite;
  const observationConnue = observeLe !== null && Number.isFinite(observeLe);
  const seuilConnu = ageMaxMs != null && Number.isFinite(ageMaxMs) && ageMaxMs > 0;
  let motif: string | null = null;
  let statut: QualiteMetrique["statut"] = qualite.statut;
  if (observationConnue && (observeLe > now || (seuilConnu && now - observeLe > ageMaxMs))) {
    statut = "perime";
    motif = observeLe > now ? "Observation datée dans le futur." : "Dernière observation devenue trop ancienne.";
  } else if (statut === "frais" && (!observationConnue || !seuilConnu || !Number.isFinite(now))) {
    statut = "partiel";
    motif = "Fraîcheur actuelle indéterminée : observation ou délai de validité inconnu.";
  }
  return motif === null ? qualite : { ...qualite, statut, raison: [qualite.raison, motif].filter(Boolean).join(" ") };
}
