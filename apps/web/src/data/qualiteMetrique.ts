export interface QualiteMetrique {
  sourceId: string;
  sourceEffective: string;
  observeLe: number | null;
  recupereLe: number | null;
  cadenceMs: number | null;
  couverture: { disponibles: number; attendus: number } | null;
  estime: boolean;
  acces: "public" | "cle" | "abonnement" | "indisponible";
  statut: "frais" | "perime" | "partiel" | "indisponible" | "en-construction";
  raison?: string;
}
