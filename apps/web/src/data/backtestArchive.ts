/** Archive synthétique du BT : aucune bougie, exécution ou courbe n'est persistée. */
import type { StatsBacktest } from "@axiom/backtest";
import type { CouvertureFundingBacktest } from "./backtestFunding";
import type { ConfigRun } from "../store/backtestSignature";
import { copierConfigRun, signatureRun } from "../store/backtestSignature";

export const SCHEMA_ARCHIVE_BT = 1;
export const VERSION_MOTEUR_BT = "bt-2026-09-23";

export interface ArchiveRunBacktest {
  id: string;
  creeMs: number;
  schemaVersion: 1;
  moteurVersion: string;
  config: ConfigRun;
  signature: string;
  source: "binance-spot" | "binance-perp";
  /** Bornes réellement passées à l'acquisition, distinctes de la plage relative du builder. */
  fenetreDemandee: { debutMs: number; finMs: number };
  donnees: { premiereBougieMs: number; derniereBougieMs: number; finDonneesMs: number | null; nbBougies: number };
  funding: { modele: "aucun" | "perp-lineaire"; couverture: CouvertureFundingBacktest | null; total: number | null };
  stats: StatsBacktest;
}

export interface VersionConfigBacktest {
  id: string;
  nom: string;
  creeMs: number;
  schemaVersion: 1;
  config: ConfigRun;
  signature: string;
}

const objet = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const nombre = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const nombreOuNull = (v: unknown): v is number | null => v === null || nombre(v);
const chaine = (v: unknown): v is string => typeof v === "string";
const TF_BT = ["1m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d", "3d", "1w"];

function operandeValide(v: unknown): boolean {
  if (!objet(v)) return false;
  if (v.type === "prix") return ["open", "high", "low", "close", "volume"].includes(String(v.champ));
  if (v.type === "constante") return nombre(v.valeur);
  return v.type === "indicateur" && chaine(v.indicateurId) && chaine(v.output) && objet(v.params)
    && Object.values(v.params).every((p) => nombre(p) || typeof p === "boolean" || chaine(p));
}

function conditionValide(v: unknown): boolean {
  if (!objet(v)) return false;
  if (v.type === "comparaison") return operandeValide(v.gauche) && operandeValide(v.droite)
    && [">", ">=", "<", "<="].includes(String(v.comparateur));
  return v.type === "croisement" && operandeValide(v.a) && operandeValide(v.b)
    && ["hausse", "baisse"].includes(String(v.sens));
}

export function configArchiveValide(v: unknown): v is ConfigRun {
  if (!objet(v)) return false;
  return chaine(v.symbol) && v.symbol.length > 0 && TF_BT.includes(String(v.tf)) && ["3m", "6m", "1a", "2a"].includes(String(v.plage))
    && ["long", "short", "les-deux"].includes(String(v.direction))
    && nombre(v.tailleFixe) && nombreOuNull(v.stopPct) && nombreOuNull(v.targetPct)
    && (v.stopAtr === null || (objet(v.stopAtr) && nombre(v.stopAtr.length) && nombre(v.stopAtr.mult)))
    && nombreOuNull(v.risquePct) && nombre(v.fraisPct) && nombre(v.slippagePct)
    && nombre(v.capitalInitial) && ["aucun", "binance-reel"].includes(String(v.modeFunding))
    && typeof v.intrabar === "boolean" && Array.isArray(v.reglesEntree) && v.reglesEntree.every(conditionValide)
    && Array.isArray(v.reglesSortie) && v.reglesSortie.every(conditionValide);
}

const CHAMPS_STATS = [
  "nbTrades", "nbGagnants", "nbPerdants", "winRatePct", "pnlTotal", "pnlTotalPct",
  "maxDrawdownPct", "sharpe", "expositionPct", "gainMoyenPct", "perteMoyennePct",
  "nbTradesR", "sommeR", "maeMoyenPct", "mfeMoyenPct",
] as const;

type StatsSerialisees = Omit<StatsBacktest, "profitFactor"> & { profitFactor: number | "Infinity" };
function statsValides(v: unknown): v is StatsSerialisees {
  return objet(v) && CHAMPS_STATS.every((champ) => nombre(v[champ]))
    && (nombre(v.profitFactor) || v.profitFactor === "Infinity")
    && nombreOuNull(v.expectancyR);
}

function couvertureValide(v: unknown): v is CouvertureFundingBacktest | null {
  if (v === null) return true;
  return objet(v) && v.etat === "verifiee" && nombre(v.debutMs) && nombre(v.finMs)
    && nombre(v.nombre) && Array.isArray(v.moisArchives) && v.moisArchives.every(chaine)
    && Array.isArray(v.intervallesHeures) && v.intervallesHeures.every(nombre) && chaine(v.source);
}

export function decoderArchive(v: unknown): ArchiveRunBacktest | null {
  if (!objet(v) || v.schemaVersion !== SCHEMA_ARCHIVE_BT || !chaine(v.id) || !v.id
    || !nombre(v.creeMs) || !chaine(v.moteurVersion) || !v.moteurVersion || !configArchiveValide(v.config)
    || !chaine(v.signature) || v.signature !== signatureRun(v.config)
    || !["binance-spot", "binance-perp"].includes(String(v.source))
    || !objet(v.fenetreDemandee) || !nombre(v.fenetreDemandee.debutMs) || !nombre(v.fenetreDemandee.finMs)
    || !objet(v.donnees) || !nombre(v.donnees.premiereBougieMs) || !nombre(v.donnees.derniereBougieMs)
    || !nombreOuNull(v.donnees.finDonneesMs) || !nombre(v.donnees.nbBougies)
    || !Number.isInteger(v.donnees.nbBougies) || v.donnees.nbBougies < 1
    || v.donnees.premiereBougieMs > v.donnees.derniereBougieMs
    || !objet(v.funding) || !["aucun", "perp-lineaire"].includes(String(v.funding.modele))
    || !couvertureValide(v.funding.couverture) || !nombreOuNull(v.funding.total) || !statsValides(v.stats)) return null;
  if ((v.config.modeFunding === "aucun") !== (v.source === "binance-spot")
    || (v.config.modeFunding === "aucun") !== (v.funding.modele === "aucun")) return null;
  return {
    id: v.id, creeMs: v.creeMs, schemaVersion: 1, moteurVersion: v.moteurVersion,
    config: copierConfigRun(v.config), signature: v.signature,
    source: v.source as ArchiveRunBacktest["source"],
    fenetreDemandee: v.fenetreDemandee as unknown as ArchiveRunBacktest["fenetreDemandee"],
    donnees: v.donnees as unknown as ArchiveRunBacktest["donnees"],
    funding: v.funding as unknown as ArchiveRunBacktest["funding"],
    stats: { ...v.stats, profitFactor: v.stats.profitFactor === "Infinity" ? Infinity : v.stats.profitFactor },
  };
}

export function decoderVersion(v: unknown): VersionConfigBacktest | null {
  if (!objet(v) || v.schemaVersion !== 1 || !chaine(v.id) || !v.id || !chaine(v.nom) || !v.nom.trim()
    || !nombre(v.creeMs) || !configArchiveValide(v.config) || !chaine(v.signature)
    || v.signature !== signatureRun(v.config)) return null;
  return { id: v.id, nom: v.nom, creeMs: v.creeMs, schemaVersion: 1, config: copierConfigRun(v.config), signature: v.signature };
}

/** JSON portable : Infinity est une valeur métier explicite du profit factor. */
export function encoderArchive(archive: ArchiveRunBacktest): string {
  return JSON.stringify({ ...archive, stats: {
    ...archive.stats, profitFactor: archive.stats.profitFactor === Infinity ? "Infinity" : archive.stats.profitFactor,
  } });
}

export function comparerArchives(a: ArchiveRunBacktest, b: ArchiveRunBacktest): {
  comparable: boolean; avertissements: string[]; deltas: Partial<Record<keyof StatsBacktest, number>> | null;
} {
  const avertissements: string[] = [];
  if (a.config.symbol !== b.config.symbol) avertissements.push("Marchés différents");
  if (a.source !== b.source) avertissements.push("Sources différentes");
  if (a.config.tf !== b.config.tf) avertissements.push("Timeframes différents");
  if (a.donnees.premiereBougieMs !== b.donnees.premiereBougieMs
    || a.donnees.derniereBougieMs !== b.donnees.derniereBougieMs
    || a.donnees.finDonneesMs !== b.donnees.finDonneesMs) avertissements.push("Bornes de données différentes");
  const comparable = avertissements.length === 0;
  if (a.config.fraisPct !== b.config.fraisPct || a.config.slippagePct !== b.config.slippagePct) avertissements.push("Frais différents");
  if (a.config.capitalInitial !== b.config.capitalInitial) avertissements.push("Capitaux initiaux différents");
  if (!comparable) return { comparable, avertissements, deltas: null };
  const deltas: Partial<Record<keyof StatsBacktest, number>> = {};
  for (const champ of [...CHAMPS_STATS, "expectancyR", "profitFactor"] as const) {
    const av = a.stats[champ], bv = b.stats[champ];
    if (typeof av === "number" && typeof bv === "number" && Number.isFinite(av) && Number.isFinite(bv)) deltas[champ] = bv - av;
  }
  return { comparable, avertissements, deltas };
}
