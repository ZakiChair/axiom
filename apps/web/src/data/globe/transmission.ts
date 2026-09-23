/** Qualification manuelle d'un événement GDELT ; les canaux sont des hypothèses. */
import type { Candle } from "@axiom/types";
import type { LectureAnalyse } from "../analyseMultidomaine";
import type { EvenementDetail } from "./types";

const JOUR = 86_400_000;
export type CanalTransmission = "energie" | "transport" | "inflation" | "taux" | "dollar";
export const DOCUMENTATION_CANAL: Record<CanalTransmission, { libelle: string; explication: string; url: string }> = {
  energie: { libelle: "Énergie", explication: "Une perturbation d'un passage pétrolier peut modifier l'offre et le coût de l'énergie, sous réserve d'un blocage effectif et durable.", url: "https://www.eia.gov/international/content/analysis/special_topics/World_Oil_Transit_Chokepoints/" },
  transport: { libelle: "Transport", explication: "Un détour ou un ralentissement logistique pourrait renchérir les délais et coûts de transport ; l'événement seul ne prouve aucun effet.", url: "https://www.newyorkfed.org/research/policy/gscpi" },
  inflation: { libelle: "Inflation", explication: "Une hausse persistante des coûts d'énergie ou de transport pourrait se transmettre aux prix ; l'ampleur et le délai restent inconnus.", url: "https://www.newyorkfed.org/research/policy/gscpi" },
  taux: { libelle: "Taux", explication: "Un changement d'anticipations d'inflation ou de croissance pourrait modifier les taux ; aucune réaction de banque centrale n'est prédite.", url: "https://www.newyorkfed.org/research/policy/gscpi" },
  dollar: { libelle: "Dollar", explication: "Un changement d'aversion au risque ou de taux relatifs pourrait affecter le dollar ; sens et ampleur indéterminés.", url: "https://www.newyorkfed.org/research/policy/gscpi" },
};

/** Correspondances de thèmes seulement ; aucune direction de prix n'est attribuée. */
const EXPOSITIONS: Record<CanalTransmission, readonly string[]> = {
  energie: ["USO", "XLE", "XOM", "CVX"],
  transport: ["IYT", "XLI"],
  inflation: ["TIP", "GLD"],
  taux: ["TLT", "IEF", "SHY"],
  dollar: ["UUP"],
};
export interface ScenarioTransmission {
  id: string; evenement: EvenementDetail; canal: CanalTransmission; condition: string;
  document: { libelle: string; explication: string; url: string };
  expositions: { reconnues: Array<{ symbol: string; raison: string }>; inconnues: string[] };
}
export function dedupliquerEvenements(evenements: readonly EvenementDetail[]): EvenementDetail[] {
  const vues = new Set<string>();
  return evenements.filter((e) => {
    if (!urlSure(e.url)) return true;
    const cle = `${e.url ?? "sans-source"}|${e.codeCameo}|${e.acteur1 ?? ""}|${e.acteur2 ?? ""}`;
    if (vues.has(cle)) return false;
    vues.add(cle);
    return true;
  });
}
export function urlSure(url: string | null): url is string {
  if (!url) return false;
  try { const u = new URL(url); return u.protocol === "https:" || u.protocol === "http:"; } catch { return false; }
}
export function qualifierTransmission(evenement: EvenementDetail, canal: CanalTransmission, condition: string, watchlist: readonly string[]): ScenarioTransmission | null {
  if (!urlSure(evenement.url) || !Number.isFinite(evenement.dateMs) || evenement.dateMs <= 0 ||
      evenement.url.length > 500 || !Object.hasOwn(DOCUMENTATION_CANAL, canal) || !condition.trim() || condition.length > 350) return null;
  const reconnues: ScenarioTransmission["expositions"]["reconnues"] = [];
  const inconnues: string[] = [];
  for (const symbolBrut of new Set(watchlist)) {
    const symbol = symbolBrut.trim().toUpperCase();
    if (!symbol) continue;
    if (EXPOSITIONS[canal].includes(symbol)) reconnues.push({ symbol, raison: `Instrument explicitement relié au thème ${DOCUMENTATION_CANAL[canal].libelle.toLowerCase()} ; direction de prix inconnue.` });
    else inconnues.push(symbol);
  }
  let hash = 2166136261;
  for (const code of `${evenement.url}|${evenement.codeCameo}`) hash = Math.imul(hash ^ code.charCodeAt(0), 16777619);
  return { id: `gdelt:${evenement.codeCameo}:${(hash >>> 0).toString(16)}`,
    evenement, canal, condition: condition.trim(), document: DOCUMENTATION_CANAL[canal], expositions: { reconnues, inconnues } };
}

export type MesureQuotidienne =
  | { statut: "attente" | "indisponible"; description: string }
  | { statut: "mesure"; avant: { date: number; prix: number }; apres: { date: number; prix: number }; variationPct: number; description: string; couverture: { presentes: 2; attendues: 2 } };

/** Date GDELT = DATEADDED (référencement), non heure d'occurrence ou de première publication. */
export function mesurerAutourEvenement(dateGdeltMs: number, bougies: readonly Pick<Candle, "time" | "close" | "closed">[], maintenant: number): MesureQuotidienne {
  if (!Number.isFinite(dateGdeltMs) || !Number.isFinite(maintenant)) return { statut: "indisponible", description: "Date invalide." };
  const jourEvenement = Math.floor(dateGdeltMs / JOUR) * JOUR;
  if (jourEvenement > maintenant) return { statut: "attente", description: "Jour GDELT futur : séance ultérieure en attente." };
  const closes = bougies.filter((b) => b.closed === true && Number.isFinite(b.time) && Number.isFinite(b.close) && b.close > 0 && b.time + JOUR <= maintenant)
    .sort((a, b) => a.time - b.time);
  const avant = closes.filter((b) => b.time < jourEvenement).at(-1);
  const apres = closes.filter((b) => b.time >= jourEvenement).at(-1);
  if (!avant || !apres) return { statut: jourEvenement + JOUR > maintenant ? "attente" : "indisponible", description: "Deux séances closes autour du jour GDELT ne sont pas disponibles." };
  return { statut: "mesure", avant: { date: avant.time, prix: avant.close }, apres: { date: apres.time, prix: apres.close },
    variationPct: 100 * (apres.close / avant.close - 1), couverture: { presentes: 2, attendues: 2 },
    description: "Comparaison quotidienne descriptive autour du jour de référencement GDELT, sans causalité ni réaction intrajournalière attribuée." };
}

/** À publier seulement après choix explicite de l'événement, du canal et de la condition. */
export function lectureTransmission(scenario: ScenarioTransmission, recupereLe: number): LectureAnalyse {
  return { id: `geo:${scenario.id}:${scenario.canal}`.slice(0, 160), domaine: "geo", nature: "scenario-conditionnel",
    conclusion: `${scenario.condition}. Canal supposé : ${scenario.document.libelle.toLowerCase()} ; exposition et direction de marché non établies.`,
    tags: [{ cle: "geo", valeur: scenario.canal }], instrument: null,
    horizon: { depuis: scenario.evenement.dateMs, jusqua: scenario.evenement.dateMs }, unite: null, valeur: null,
    source: scenario.evenement.url!, observeLe: scenario.evenement.dateMs, recupereLe, validiteJusqua: null,
    statut: "partiel", couverture: { presentes: 1, attendues: 1 },
    limites: ["DATEADDED GDELT = référencement, ni occurrence certaine ni première publication prouvée.", "Canal et exposition : hypothèses choisies par l'utilisateur, sans causalité estimée.", scenario.document.url],
    preuve: { fenetre: "GLOBE", reference: scenario.evenement.url! } };
}
