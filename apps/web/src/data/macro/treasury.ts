/** Transport public du Daily Treasury Statement pour le solde quotidien du TGA. */
import { extUrl } from "../extapi";
import type { MacroSeries } from "./types";

const HOTE = "api.fiscaldata.treasury.gov";
const CHEMIN = "services/api/fiscal_service/v1/accounting/dts/operating_cash_balance";
const TAILLE_PAGE = 1000;
const MAX_PAGES = 40;
const TIMEOUT_MS = 15_000;

interface LigneDts {
  record_date?: string;
  account_type?: string;
  close_today_bal?: string;
  open_today_bal?: string;
}
interface ReponseDts { data?: LigneDts[]; meta?: { "total-pages"?: number | string }; }
export interface SerieTgaTreasury {
  points: MacroSeries;
  source: "Treasury DTS operating_cash_balance";
  /** Instant local de collecte, distinct du jour d'activité des points. */
  recupereLe: number;
}
export interface OptionsTgaTreasury { debut?: string; fin?: string; signal?: AbortSignal; }

function estDateIso(date: string | undefined): date is string {
  const match = date && /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return false;
  const [annee, mois, jour] = match.slice(1).map(Number);
  const civil = new Date(Date.UTC(annee!, mois! - 1, jour!));
  return civil.getUTCFullYear() === annee && civil.getUTCMonth() === mois! - 1 && civil.getUTCDate() === jour;
}
function nombreMillions(value: string | undefined): number | null {
  if (!value || value === "null") return null;
  const nombre = Number(value.replace(/,/g, ""));
  return Number.isFinite(nombre) ? nombre : null;
}

/** Parse la rupture documentaire du 18 avril 2022 et ne retient qu'un TGA par jour. */
export function extraireTgaDts(lignes: readonly LigneDts[]): MacroSeries {
  const points = new Map<string, number>();
  for (const ligne of lignes) {
    if (!estDateIso(ligne.record_date)) continue;
    const ancien = ligne.record_date < "2022-04-18" && ligne.account_type === "Treasury General Account (TGA)";
    const recent = ligne.record_date >= "2022-04-18" && ligne.account_type === "Treasury General Account (TGA) Closing Balance";
    if (!ancien && !recent) continue;
    const millions = nombreMillions(ancien ? ligne.close_today_bal : ligne.open_today_bal);
    if (millions === null) continue;
    points.set(ligne.record_date, millions * 1e-3);
  }
  return [...points].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ time: Date.parse(`${date}T00:00:00Z`), value }));
}

function signalBorne(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** Charge un historique borné; la disponibilité économique du DTS n'est jamais déduite de record_date. */
export async function chargerSerieTgaTreasury(options: OptionsTgaTreasury = {}): Promise<SerieTgaTreasury> {
  if (options.debut && !estDateIso(options.debut)) throw new Error("debut Treasury doit être YYYY-MM-DD.");
  if (options.fin && !estDateIso(options.fin)) throw new Error("fin Treasury doit être YYYY-MM-DD.");
  if (options.debut && options.fin && options.debut > options.fin) throw new Error("debut Treasury doit précéder fin.");
  const lignes: LigneDts[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const params = new URLSearchParams({ "page[number]": String(page), "page[size]": String(TAILLE_PAGE), sort: "record_date" });
    if (options.debut || options.fin) {
      const clauses = [options.debut ? `record_date:gte:${options.debut}` : "", options.fin ? `record_date:lte:${options.fin}` : ""].filter(Boolean);
      params.set("filter", clauses.join(","));
    }
    const response = await fetch(extUrl(HOTE, `${CHEMIN}?${params.toString()}`), { signal: signalBorne(options.signal) });
    if (!response.ok) throw new Error(`Treasury DTS ${response.status}`);
    const json = await response.json() as ReponseDts;
    lignes.push(...(json.data ?? []));
    const total = Number(json.meta?.["total-pages"] ?? page);
    if (!Number.isFinite(total) || page >= total) break;
  }
  return { points: extraireTgaDts(lignes), source: "Treasury DTS operating_cash_balance", recupereLe: Date.now() };
}
