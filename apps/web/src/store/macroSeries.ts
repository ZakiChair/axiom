/** Séries macro : cache explicite, historique conservé en cas d'échec, aucune boucle de polling. */
import { createStore } from "zustand/vanilla";
import type { MacroSeries } from "../data/macro/types";
import { type DefinitionSerieMacro, type IndicateurMacro, type RegionMacro, seriesDeIndicateur } from "../data/macro/catalogueMacro";
import { chargerSerieMacro, cleSante, type ResultatSerieMacro } from "../data/macro/chargerSerieMacro";
import { finDePeriode } from "../data/macro/harmonisation";
import type { HorizonMacro } from "./macroRatesView";
import { healthStore } from "./health";

export const FENETRE_MACRO_MS = 5 * 365.25 * 24 * 3_600_000;
export const TTL_CACHE_MS = 24 * 3_600_000;
/** File commune à toutes les familles : changer d'onglet ne contourne pas le quota. */
export const ESPACEMENT_OCDE_MS = 7_000;
export const PREFIXE_CACHE = "axiom.macro.serie.";
export type StatutSerie = "idle" | "loading" | "ok" | "quota" | "sansCle" | "panne" | "indisponible";
export interface EtatSerie {
  statut: StatutSerie;
  points: MacroSeries;
  /** Fin de la dernière période observée, jamais date de récupération. */
  majTs: number | null;
  message: string | null;
  recupereTs?: number;
  perime?: boolean;
}
interface EntreeCache { ts: number; depuis: number; signature: string; points: MacroSeries }
export interface OptionsDemande {
  force?: boolean;
  regions?: readonly RegionMacro[];
  horizonAnnees?: HorizonMacro;
  signal?: AbortSignal;
  attendre?: (ms: number) => Promise<void>;
  /** Vue ALFRED au jour indiqué pour les seules séries FRED compatibles. */
  connuLe?: string | null;
}
export interface MacroSeriesState {
  series: Record<string, EtatSerie>;
  demanderIndicateur: (indicateur: IndicateurMacro, opts?: OptionsDemande) => Promise<void>;
}
const etatVide = (): EtatSerie => ({ statut: "idle", points: [], majTs: null, message: null });
const signature = (def: DefinitionSerieMacro): string => JSON.stringify([2, def.source, def.transformation, def.decalageFinMois]);
function cleCache(def: DefinitionSerieMacro, connuLe?: string | null): string { return PREFIXE_CACHE + def.id + (connuLe ? `.alfred-${connuLe}` : ""); }
function lireCache(def: DefinitionSerieMacro, connuLe?: string | null): EntreeCache | null {
  try {
    const entree = JSON.parse(localStorage.getItem(cleCache(def, connuLe) ?? "null") as string) as EntreeCache | null;
    if (!entree || entree.signature !== signature(def) || !Number.isFinite(entree.ts) || !Number.isFinite(entree.depuis) || !Array.isArray(entree.points) || !entree.points.length) return null;
    if (entree.points.some((p) => !Number.isFinite(p.time) || !Number.isFinite(p.value))) return null;
    return { ...entree, points: entree.points.slice().sort((a, b) => a.time - b.time) };
  } catch { return null; }
}
function ecrireCache(def: DefinitionSerieMacro, points: MacroSeries, depuis: number, ts: number, connuLe?: string | null): void {
  try { localStorage.setItem(cleCache(def, connuLe), JSON.stringify({ ts, depuis, signature: signature(def), points } satisfies EntreeCache)); } catch { /* Cache facultatif. */ }
}
function ttl(def: DefinitionSerieMacro): number { return def.frequence === "D" ? 3_600_000 : def.frequence === "W" ? 6 * 3_600_000 : TTL_CACHE_MS; }
const attendreParDefaut = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function attendreAnnulable(ms: number, attendre: (ms: number) => Promise<void>, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted || ms <= 0) return;
  let annuler: () => void = () => {};
  const annulation = new Promise<void>((resolve) => { annuler = resolve; signal?.addEventListener("abort", annuler, { once: true }); });
  try { await Promise.race([attendre(ms), annulation]); } finally { signal?.removeEventListener("abort", annuler); }
}
let fileOecd = Promise.resolve();
let dernierOecdTs = 0;
let quotaOecdJusqua = 0;
function dansFileOecd(charger: () => Promise<ResultatSerieMacro>, opts: OptionsDemande): Promise<ResultatSerieMacro> {
  const operation = fileOecd.then(async (): Promise<ResultatSerieMacro> => {
    if (opts.signal?.aborted) return { statut: "annule" };
    if (Date.now() < quotaOecdJusqua) return { statut: "quota", message: "Quota OCDE — réessayer après une minute." };
    await attendreAnnulable(Math.max(0, dernierOecdTs + ESPACEMENT_OCDE_MS - Date.now()), opts.attendre ?? attendreParDefaut, opts.signal);
    if (opts.signal?.aborted) return { statut: "annule" };
    const resultat = await charger();
    dernierOecdTs = Date.now();
    if (resultat.statut === "quota") quotaOecdJusqua = Date.now() + 60_000;
    return resultat;
  });
  fileOecd = operation.then(() => {}, () => {});
  return operation;
}
const chargementsEnCours = new Map<string, { promesse: Promise<void>; signal?: AbortSignal }>();
const versions = new Map<string, symbol>();
export const macroSeriesStore = createStore<MacroSeriesState>((set, get) => {
  const majSerie = (id: string, patch: Partial<EtatSerie>): void => set((s) => ({ series: { ...s.series, [id]: { ...(s.series[id] ?? etatVide()), ...patch } } }));
  async function executerChargement(indicateur: IndicateurMacro, opts: OptionsDemande): Promise<void> {
    if (opts.signal?.aborted) return;
    const now = Date.now();
    // Début de mois stable : deux lectures successives partagent le même cache.
    const date = new Date(now);
    const depuis = Date.UTC(date.getUTCFullYear() - (opts.horizonAnnees ?? 5), date.getUTCMonth(), 1);
    const definitions = seriesDeIndicateur(indicateur).filter((d) => !opts.regions || opts.regions.includes(d.region));
    const version = Symbol();
    await Promise.all(definitions.map(async (def) => {
      versions.set(def.id, version);
      const cache = lireCache(def, opts.connuLe);
      const frais = !!cache && now - cache.ts <= ttl(def) && cache.depuis <= depuis;
      if (cache && !(get().series[def.id]?.points.length)) {
        const dernier = cache.points.at(-1)!;
        majSerie(def.id, { points: cache.points, majTs: finDePeriode(dernier.time, def.frequence, def.decalageFinMois), recupereTs: cache.ts, perime: !frais, statut: "ok", message: null });
      }
      if (frais && !opts.force) {
        const dernier = cache.points.at(-1)!;
        majSerie(def.id, { points: cache.points, majTs: finDePeriode(dernier.time, def.frequence, def.decalageFinMois), recupereTs: cache.ts, perime: false, statut: "ok", message: null });
        return;
      }
      const precedent = get().series[def.id] ?? etatVide();
      majSerie(def.id, { statut: "loading", message: null, ...(cache && !frais ? { perime: true } : {}) });
      const charger = (): Promise<ResultatSerieMacro> => chargerSerieMacro(def, depuis, opts.signal, opts.connuLe).catch(() => opts.signal?.aborted ? { statut: "annule" } : { statut: "panne", message: "Source indisponible." });
      const resultat = def.source.transport === "oecd" ? await dansFileOecd(charger, opts) : await charger();
      if (versions.get(def.id) !== version) return;
      if (resultat.statut === "annule" || opts.signal?.aborted) {
        majSerie(def.id, { ...precedent, statut: precedent.statut === "loading" ? (precedent.points.length ? "ok" : "idle") : precedent.statut });
        return;
      }
      if (resultat.statut === "ok") {
        const ts = Date.now();
        const dernier = resultat.points.at(-1)!;
        majSerie(def.id, { statut: "ok", points: resultat.points, majTs: finDePeriode(dernier.time, def.frequence, def.decalageFinMois), message: null, recupereTs: ts, perime: false });
        ecrireCache(def, resultat.points, depuis, ts, opts.connuLe);
        healthStore.getState().setEtat(cleSante(def), "polling", { dernierMessageTs: ts });
      } else {
        majSerie(def.id, { statut: resultat.statut, message: resultat.message, perime: precedent.points.length > 0 });
        if (resultat.statut === "indisponible") return;
        if (resultat.statut === "quota") healthStore.getState().setEtat(cleSante(def), "polling", { derniereErreur: resultat.message });
        else healthStore.getState().marquerErreur(cleSante(def), resultat.message);
      }
    }));
  }
  return {
    series: {},
    demanderIndicateur: (indicateur, opts = {}) => {
      const cle = JSON.stringify([indicateur, opts.regions?.slice().sort(), opts.horizonAnnees ?? 5, opts.connuLe ?? null]);
      const enCours = chargementsEnCours.get(cle);
      const partageable = enCours && !enCours.signal?.aborted && enCours.signal === opts.signal;
      if (partageable && !opts.force) return enCours.promesse;
      const lancement = partageable ? enCours.promesse.then(() => executerChargement(indicateur, opts)) : executerChargement(indicateur, opts);
      const promesse = lancement.finally(() => { if (chargementsEnCours.get(cle)?.promesse === promesse) chargementsEnCours.delete(cle); });
      chargementsEnCours.set(cle, { promesse, ...(opts.signal ? { signal: opts.signal } : {}) });
      return promesse;
    },
  };
});
