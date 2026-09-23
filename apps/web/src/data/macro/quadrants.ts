import { CATALOGUE_MACRO, type DefinitionSerieMacro, type RegionMacro } from "./catalogueMacro";
import { finDePeriode } from "./harmonisation";
import { formatPeriodeMacro } from "./presentation";
import { macroSeriesStore, TTL_CACHE_MS, type EtatSerie } from "../../store/macroSeries";
import type { LectureAnalyse } from "../analyseMultidomaine";

export type SensQuadrant = "accelere" | "decelere" | "stable" | "inconnu";
export type NomQuadrant = `croissance-${"accelere" | "decelere"}-inflation-${"accelere" | "decelere"}`;
export interface AxeQuadrant { sens: SensQuadrant; courant: number | null; precedent: number | null; deltaPp: number | null; periodeCourante: string | null; periodePrecedente: string | null; perimetre: string; source: string; observeLe: number | null; recupereLe: number | null; perime: boolean; motif: string | null }
export interface PointQuadrant { mois: string; finPeriode: number; croissance: AxeQuadrant; inflation: AxeQuadrant; quadrant: NomQuadrant | null; transition: { de: NomQuadrant; vers: NomQuadrant } | null; pib: { valeur: number; periode: string; source: string; observeLe: number } | null }
export interface ZoneQuadrants { region: RegionMacro; points: PointQuadrant[]; raison: string | null }
export interface ResultatQuadrants { regions: ZoneQuadrants[]; connuLe: string | null; calculeLe: number }
export interface OptionsQuadrants { regions: readonly RegionMacro[]; connuLe?: string | null; maintenant?: number; signal?: AbortSignal; force?: boolean; attenteConcurrenceMs?: number }

/** Le dernier mois commun avec ses deux axes calculés ; « stable » reste calculé. */
export function dernierMoisCommunCalcule(zone: ZoneQuadrants): PointQuadrant | null {
  for (let i = zone.points.length - 1; i >= 0; i--) {
    const point = zone.points[i]!;
    if (point.croissance.sens !== "inconnu" && point.inflation.sens !== "inconnu") return point;
  }
  return null;
}

const EPSILON_PP = 1e-9;
const MOIS_MAX_MS = 86_400_000 * 35;
const moisTexte = (time: number): string => new Date(time).toISOString().slice(0, 7);
const debutMois = (annee: number, mois: number): number => Date.UTC(annee, mois, 1);
const source = (def: DefinitionSerieMacro): string => def.source.transport === "fred" ? `FRED · ${def.source.seriesId}` : def.source.transport.toUpperCase();
const definition = (region: RegionMacro, indicateur: "production-aa" | "cpi-aa" | "pib-aa"): DefinitionSerieMacro => CATALOGUE_MACRO.find((d) => d.region === region && d.indicateur === indicateur)!;

function axe(etat: EtatSerie | undefined, def: DefinitionSerieMacro, temps: number, connuLe: string | null): AxeQuadrant {
  const perime = etat?.perime === true || (etat !== undefined && etat.statut !== "ok");
  const base = { source: source(def), perimetre: def.perimetre ?? "Périmètre non précisé", observeLe: finDePeriode(temps, "M"), recupereLe: etat?.recupereTs ?? null, perime };
  const inconnu = (motif: string): AxeQuadrant => ({ ...base, observeLe: null, sens: "inconnu", courant: null, precedent: null, deltaPp: null, periodeCourante: null, periodePrecedente: null, motif });
  if (!etat) return inconnu("Série non chargée.");
  if ((etat.contexteConnuLe ?? null) !== (def.source.transport === "fred" ? connuLe : null)) return inconnu("Millésime différent de la vue active.");
  if (etat.points.length === 0) return inconnu(etat.message ?? "Série indisponible.");
  const points = new Map(etat.points.filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value)).map((p) => [p.time, p.value]));
  const date = new Date(temps);
  const quatre = Array.from({ length: 4 }, (_, recul) => points.get(debutMois(date.getUTCFullYear(), date.getUTCMonth() - recul)));
  if (quatre.some((valeur) => valeur === undefined)) return inconnu("Quatre mois consécutifs requis (M à M−3).");
  const courant = quatre[0]!;
  const precedent = quatre[3]!;
  const deltaPp = courant - precedent;
  const sens: SensQuadrant = Math.abs(deltaPp) <= EPSILON_PP ? "stable" : deltaPp > 0 ? "accelere" : "decelere";
  return { ...base, sens, courant, precedent, deltaPp, periodeCourante: moisTexte(temps), periodePrecedente: moisTexte(debutMois(date.getUTCFullYear(), date.getUTCMonth() - 3)), motif: perime ? etat.message ?? "Historique conservé · cache périmé." : null };
}

function contextePib(etat: EtatSerie | undefined, def: DefinitionSerieMacro, finMois: number, connuLe: string | null): PointQuadrant["pib"] {
  if (!etat || etat.statut !== "ok" || etat.perime || (etat.contexteConnuLe ?? null) !== (def.source.transport === "fred" ? connuLe : null)) return null;
  const point = etat.points.filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value) && finDePeriode(p.time, "Q") <= finMois).at(-1);
  return point ? { valeur: point.value, periode: formatPeriodeMacro(point.time, def), source: source(def), observeLe: finDePeriode(point.time, "Q") } : null;
}

/** Les dates sont des périodes observées ; une série révisée ne prouve pas sa disponibilité passée. */
export function calculerQuadrants(series: Record<string, EtatSerie>, options: OptionsQuadrants): ResultatQuadrants {
  const connuLe = options.connuLe ?? null;
  const maintenant = options.maintenant ?? Date.now();
  // Le millésime ALFRED fixe la borne historique de connaissance. Date.now ne sert
  // qu'à la récupération courante ; l'âge de la période n'annule pas sa lecture.
  const finVue = connuLe ? Date.parse(`${connuLe}T23:59:59.999Z`) : maintenant;
  const regions = options.regions.map((region): ZoneQuadrants => {
    const croissanceDef = definition(region, "production-aa");
    const inflationDef = definition(region, "cpi-aa");
    const pibDef = definition(region, "pib-aa");
    if (connuLe && (croissanceDef.source.transport !== "fred" || inflationDef.source.transport !== "fred")) return { region, points: [], raison: "Vue ALFRED indisponible pour cette zone ; source courante révisable uniquement." };
    const croissanceEtat = series[croissanceDef.id];
    const inflationEtat = series[inflationDef.id];
    if (connuLe && [croissanceEtat, inflationEtat].some((e) => e && (e.contexteConnuLe ?? null) !== connuLe)) return { region, points: [], raison: "Millésime différent de la vue active." };
    const temps = new Set<number>();
    for (const etat of [croissanceEtat, inflationEtat]) for (const point of etat?.points ?? []) {
      if (Number.isFinite(point.time) && finDePeriode(point.time, "M") <= finVue) temps.add(point.time);
    }
    const mois = [...temps].sort((a, b) => a - b);
    const points: PointQuadrant[] = [];
    for (const tempsMois of mois) {
      const finPeriode = finDePeriode(tempsMois, "M");
      const croissance = axe(croissanceEtat, croissanceDef, tempsMois, connuLe);
      const inflation = axe(inflationEtat, inflationDef, tempsMois, connuLe);
      const quadrant: NomQuadrant | null = (croissance.sens === "accelere" || croissance.sens === "decelere") && (inflation.sens === "accelere" || inflation.sens === "decelere")
        ? `croissance-${croissance.sens}-inflation-${inflation.sens}` : null;
      const precedent = points.at(-1);
      const transition = quadrant && precedent?.quadrant && precedent.quadrant !== quadrant && finPeriode - precedent.finPeriode < MOIS_MAX_MS
        ? { de: precedent.quadrant, vers: quadrant } : null;
      points.push({ mois: moisTexte(tempsMois), finPeriode, croissance, inflation, quadrant, transition,
        pib: contextePib(series[pibDef.id], pibDef, finPeriode, connuLe) });
    }
    const raison = points.length ? null : [croissanceEtat?.message, inflationEtat?.message].filter((message): message is string => !!message).filter((message, index, all) => all.indexOf(message) === index).join(" · ") || "Aucune période commune chargée.";
    return { region, points, raison };
  });
  return { regions, connuLe, calculeLe: maintenant };
}

/** Réutilise exclusivement les trois familles déjà routées par le store MACRO. */
export async function chargerQuadrants(options: OptionsQuadrants): Promise<ResultatQuadrants | null> {
  const regions = options.connuLe ? options.regions.filter((r) => ["production-aa", "cpi-aa"].every((id) => definition(r, id as "production-aa" | "cpi-aa").source.transport === "fred")) : options.regions;
  if (regions.length > 0) await Promise.all((["production-aa", "cpi-aa", "pib-aa"] as const).map((indicateur) => macroSeriesStore.getState().demanderIndicateur(indicateur, { regions, horizonAnnees: 5, signal: options.signal, force: options.force, connuLe: options.connuLe })));
  if (options.signal?.aborted) return null;
  // Un autre consommateur du store peut avoir lancé la même famille avec un autre
  // AbortSignal après nous. La garde `versions` ignore alors notre réponse ; attendre
  // que la requête gagnante termine avant de figer le snapshot.
  const ids = regions.flatMap((region) => (["production-aa", "cpi-aa", "pib-aa"] as const).map((indicateur) => definition(region, indicateur)));
  const stable = (): boolean => ids.every((def) => {
    const etat = macroSeriesStore.getState().series[def.id];
    return etat !== undefined && etat.statut !== "loading";
  });
  while (!stable()) {
    const termine = await new Promise<"stable" | "annule" | "delai">((resolve) => {
      let fini = false;
      let desabonner = (): void => {};
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finir = (issue: "stable" | "annule" | "delai"): void => {
        if (fini) return;
        fini = true;
        desabonner();
        if (timer !== undefined) clearTimeout(timer);
        options.signal?.removeEventListener("abort", annuler);
        resolve(issue);
      };
      const annuler = (): void => finir("annule");
      desabonner = macroSeriesStore.subscribe(() => { if (stable()) finir("stable"); });
      options.signal?.addEventListener("abort", annuler, { once: true });
      const attenteMs = Number.isFinite(options.attenteConcurrenceMs) ? Math.max(1, options.attenteConcurrenceMs!) : 20_000;
      timer = setTimeout(() => finir("delai"), attenteMs);
      if (options.signal?.aborted) finir("annule");
      else if (stable()) finir("stable");
    });
    if (termine === "annule") return null;
    if (termine === "delai") throw new Error("Attente des séries macro concurrentes dépassée.");
  }
  if (options.signal?.aborted) return null;
  const series = macroSeriesStore.getState().series;
  if (ids.some((def) => def.source.transport === "fred" && (series[def.id]?.contexteConnuLe ?? null) !== (options.connuLe ?? null))) return null;
  return calculerQuadrants(series, options);
}

/** Projette la dernière période de chaque zone en preuve bornée pour BRIEF/EXPY. */
export function lecturesQuadrants(resultat: ResultatQuadrants): LectureAnalyse[] {
  return resultat.regions.flatMap((zone) => {
    const { region, points } = zone;
    const point = dernierMoisCommunCalcule(zone) ?? points.at(-1);
    if (!point) return [];
    const recups = [point.croissance.recupereLe, point.inflation.recupereLe].filter((date): date is number => date !== null && date > 0);
    const recupereLe = Math.max(...recups, 0);
    if (recupereLe <= 0) return [];
    const complet = point.quadrant !== null;
    const moisPlusRecents = points.filter((p) => p.finPeriode > point.finPeriode);
    const limites = [point.croissance.motif, point.inflation.motif,
      moisPlusRecents.length ? `Mois plus récents partiels : ${moisPlusRecents.map((p) => p.mois).join(", ")} ; dernier mois commun calculable ${point.mois}.` : null,
      recups.length < 2 ? "Date de récupération d'un axe inconnue." : null,
      resultat.connuLe ? `Vue ALFRED au ${resultat.connuLe}, sans heure de publication.` : "Historique courant révisable ; pas de disponibilité historique certifiée."].filter((x): x is string => x !== null);
    const debut = new Date(`${point.mois}-01T00:00:00Z`);
    debut.setUTCMonth(debut.getUTCMonth() - 3);
    const lecture: LectureAnalyse = {
      id: `macro:${region}:${point.mois}:${resultat.connuLe ?? "courant"}`,
      domaine: "quadrant", nature: "observation",
      conclusion: complet ? `${region} : croissance ${point.croissance.sens}, inflation ${point.inflation.sens}.` : `${region} : quadrant indéterminé.`,
      tags: [{ cle: "quadrant", valeur: point.quadrant ?? "indetermine" }], instrument: null,
      horizon: { depuis: debut.getTime(), jusqua: point.finPeriode }, unite: null, valeur: null,
      source: `${point.croissance.source} / ${point.inflation.source}`,
      observeLe: complet ? point.finPeriode : null, recupereLe,
      // Une acquisition récente d'un axe ne prolonge pas la validité de l'autre.
      validiteJusqua: recups.length === 2 ? Math.min(...recups) + TTL_CACHE_MS : null,
      statut: !complet ? "indisponible" : point.croissance.perime || point.inflation.perime ? "perime" : resultat.connuLe || recups.length < 2 ? "partiel" : "frais",
      couverture: { presentes: Number(point.croissance.sens !== "inconnu") + Number(point.inflation.sens !== "inconnu"), attendues: 2 },
      limites, preuve: { fenetre: "RATE", reference: `production-aa-${region.toLowerCase()}/cpi-aa-${region.toLowerCase()}` },
    };
    return [lecture];
  });
}
