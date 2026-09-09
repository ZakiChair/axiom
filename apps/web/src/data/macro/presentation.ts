import type { DefinitionSerieMacro, UniteMacro } from "./catalogueMacro";
import type { MacroSeries } from "./types";
import type { FrequenceMacro } from "./harmonisation";
import type { HorizonMacro } from "../../store/macroRatesView";

export function formatValeurMacro(value: number, unite: UniteMacro, signe = false): string {
  const decimales = unite === "personnes" || unite === "millions-usd-nominaux" ? 0 : unite === "indice-2017=100" || unite === "milliers" ? 3 : 2;
  const nombre = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: decimales, maximumFractionDigits: decimales, ...(signe ? { signDisplay: "exceptZero" as const } : {}) }).format(value).replace(/-/g, "−");
  if (unite === "%" || unite === "pb") return `${nombre} ${unite}`;
  if (unite === "indice-2017=100") return `${nombre} (2017=100)`;
  if (unite === "milliers") return `${nombre} milliers`;
  if (unite === "millions-usd-nominaux") return `${nombre} M$ nominaux`;
  return nombre;
}
const mois = (ts: number): string => new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" }).format(ts);
export function formatPeriodeMacro(time: number, def: Pick<DefinitionSerieMacro, "frequence" | "decalageFinMois">): string {
  const date = new Date(time);
  const annee = date.getUTCFullYear();
  if (def.decalageFinMois === 1) {
    const debut = Date.UTC(annee, date.getUTCMonth() - 1, 1);
    const fin = Date.UTC(annee, date.getUTCMonth() + 1, 1);
    const anneeDebut = new Date(debut).getUTCFullYear();
    const anneeFin = new Date(fin).getUTCFullYear();
    return `${mois(debut)}${anneeDebut !== anneeFin ? ` ${anneeDebut}` : ""}–${mois(fin)} ${anneeFin}`;
  }
  if (def.frequence === "Q") return `T${Math.floor(date.getUTCMonth() / 3) + 1} ${annee}`;
  if (def.frequence === "M") return `${mois(time)} ${annee}`;
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(time);
}
export function serieDansHorizon(points: MacroSeries, horizon: HorizonMacro, now = Date.now()): MacroSeries {
  const date = new Date(now);
  const debut = Date.UTC(date.getUTCFullYear() - horizon, date.getUTCMonth(), 1);
  return points.filter((p) => p.time >= debut && p.time <= now);
}
/** Les mois/trimestres absents coupent le tracé, sans interpolation à travers un trou. */
export function segmentsMacro(points: MacroSeries, frequence: FrequenceMacro): MacroSeries[] {
  const segments: MacroSeries[] = [];
  for (const p of points) {
    const dernierSegment = segments.at(-1);
    const precedent = dernierSegment?.at(-1);
    let suite = false;
    if (precedent) {
      const date = new Date(precedent.time);
      suite = frequence === "M" || frequence === "Q"
        ? Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + (frequence === "M" ? 1 : 3), 1) === p.time
        : p.time - precedent.time <= (frequence === "W" ? 8 : 4) * 86_400_000;
    }
    if (suite) dernierSegment!.push(p);
    else segments.push([p]);
  }
  return segments;
}
