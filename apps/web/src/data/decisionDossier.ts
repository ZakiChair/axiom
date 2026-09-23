/** Preuve compacte d'une alerte au moment du déclenchement et dossier de décision. */
import { METRIQUES_ONCHAIN_ALERTE, type AlertDef, type ContexteAlerte, type Declenchement } from "@axiom/alerts";
import { EXCHANGE_IDS, type Candle, type ExchangeId, type Timeframe } from "@axiom/types";

type ConditionAlerte = AlertDef["condition"];
export type BougiePreuve = Pick<Candle, "time" | "open" | "high" | "low" | "close" | "volume">;

export interface ContexteDecision {
  dernierPrix?: number;
  prixPrecedent?: number;
  fundingRate?: number;
  fundingZScore?: number;
  liqUsdParMin?: number;
  regimeScore?: number;
  cvdDivergenceKind?: ContexteAlerte["cvdDivergenceKind"];
  onchainMetriques?: ContexteAlerte["onchainMetriques"];
  fluxCapitaux?: { metrique: string; valeur: number; unite: string; observeLe: number; source: string };
  baleines?: { nombre: number; usdTotal: number };
  derniereBougie?: BougiePreuve;
}

export interface OrigineDecision {
  alertId: string;
  ts: number;
  symbol: string | null;
  source: ExchangeId | null;
  timeframe: Timeframe | null;
  condition: ConditionAlerte | null;
  valeur: number;
  message: string;
  instantane?: Declenchement["instantane"];
}

export interface PreuveDeclenchement {
  origine: OrigineDecision;
  contexte: ContexteDecision;
}

export type DeclenchementEnrichi = Declenchement & { preuve?: PreuveDeclenchement };

export interface DossierDecision {
  id: string;
  creeMs: number;
  schemaVersion: 1;
  qualite: "complete" | "partielle";
  origine: OrigineDecision;
  contexte: ContexteDecision;
  these: string;
  invalidation: string;
  revue: string;
}

const fini = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const objet = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const nonVide = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const parmi = (v: unknown, valeurs: readonly string[]): v is string => typeof v === "string" && valeurs.includes(v);
const champs = (v: Record<string, unknown>, permis: readonly string[]): boolean => Object.keys(v).every((key) => permis.includes(key));
const TIMEFRAMES: readonly string[] = ["1s", "5s", "15s", "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d", "3d", "1w", "1M", "3M", "6M", "12M"];
const COMPARATEURS = [">", ">=", "<", "<="];
const SENS = ["hausse", "baisse", "les-deux"];
const METRIQUES_FLUX = ["etf-btc-ratio", "etf-eth-ratio", "etf-sol-ratio", "stablecoins-variation-7j", "realized-cap-variation-30j", "realized-cap-variation-90j", "exchange-netflow"];

/** Valide les formes lues depuis le stockage avant toute description ou archivage. */
export function conditionDecisionValide(v: unknown): v is ConditionAlerte {
  if (!objet(v)) return false;
  switch (v.type) {
    case "prix-croise": return champs(v, ["type", "niveau", "sens"]) && fini(v.niveau) && v.niveau > 0 && parmi(v.sens, SENS);
    case "variation-pct": return champs(v, ["type", "fenetreMs", "seuilPct"]) && fini(v.fenetreMs) && v.fenetreMs > 0 && fini(v.seuilPct);
    case "indicateur-seuil":
    case "indicateur-croisement": {
      if (!champs(v, v.type === "indicateur-seuil" ? ["type", "indicateurId", "params", "output", "comparateur", "valeur"] : ["type", "indicateurId", "params", "outputA", "outputB", "sens"])
        || !nonVide(v.indicateurId) || !objet(v.params) || !Object.values(v.params).every((x) => fini(x) || typeof x === "boolean" || typeof x === "string")) return false;
      return v.type === "indicateur-seuil"
        ? nonVide(v.output) && parmi(v.comparateur, COMPARATEURS) && fini(v.valeur)
        : nonVide(v.outputA) && nonVide(v.outputB) && parmi(v.sens, SENS);
    }
    case "funding-extreme": return champs(v, ["type", "sens", "zSeuil", "seuilAbs"]) && parmi(v.sens, ["long-crowded", "short-crowded", "les-deux"])
      && (v.zSeuil === undefined || fini(v.zSeuil)) && (v.seuilAbs === undefined || fini(v.seuilAbs));
    case "cvd-spot-perp-div": return champs(v, ["type", "kind"]) && parmi(v.kind, ["spotUp_perpDown", "spotDown_perpUp", "les-deux"]);
    case "liq-cascade": return champs(v, ["type", "seuilUsdParMin"]) && fini(v.seuilUsdParMin) && v.seuilUsdParMin > 0;
    case "regime-seuil": return champs(v, ["type", "comparateur", "valeur"]) && parmi(v.comparateur, COMPARATEURS) && fini(v.valeur);
    case "onchain-seuil": return champs(v, ["type", "metrique", "comparateur", "valeur"]) && parmi(v.metrique, METRIQUES_ONCHAIN_ALERTE) && parmi(v.comparateur, COMPARATEURS) && fini(v.valeur);
    case "whale-flux": return champs(v, ["type", "seuilUsd", "direction"]) && fini(v.seuilUsd) && v.seuilUsd > 0 && parmi(v.direction, ["depot", "retrait", "tous"]);
    case "flux-capitaux-seuil": return champs(v, ["type", "metrique", "comparateur", "valeur"]) && parmi(v.metrique, METRIQUES_FLUX) && parmi(v.comparateur, COMPARATEURS) && fini(v.valeur);
    case "composite": return champs(v, ["type", "conditions"]) && Array.isArray(v.conditions) && v.conditions.length >= 2 && v.conditions.length <= 4
      && v.conditions.every((c) => conditionDecisionValide(c) && !["composite", "whale-flux", "flux-capitaux-seuil", "onchain-seuil"].includes(c.type)
        && !(c.type === "prix-croise" && c.sens === "les-deux"));
    default: return false;
  }
}

function contextePreuveValide(v: unknown, ts: number): v is ContexteDecision {
  if (!objet(v) || Object.keys(v).some((key) => !["dernierPrix", "prixPrecedent", "fundingRate", "fundingZScore", "liqUsdParMin", "regimeScore", "cvdDivergenceKind", "onchainMetriques", "fluxCapitaux", "baleines", "derniereBougie"].includes(key))) return false;
  for (const key of ["dernierPrix", "prixPrecedent", "fundingRate", "fundingZScore", "liqUsdParMin", "regimeScore"]) if (v[key] !== undefined && !fini(v[key])) return false;
  if (v.cvdDivergenceKind !== undefined && v.cvdDivergenceKind !== null && !parmi(v.cvdDivergenceKind, ["spotUp_perpDown", "spotDown_perpUp"])) return false;
  if (v.onchainMetriques !== undefined && (!objet(v.onchainMetriques) || Object.entries(v.onchainMetriques).some(([key, value]) => !parmi(key, METRIQUES_ONCHAIN_ALERTE) || !fini(value)))) return false;
  const flux = v.fluxCapitaux;
  if (flux !== undefined && (!objet(flux) || !champs(flux, ["metrique", "valeur", "unite", "observeLe", "source"]) || !nonVide(flux.metrique) || !fini(flux.valeur) || !nonVide(flux.unite)
    || !fini(flux.observeLe) || flux.observeLe > ts || !nonVide(flux.source))) return false;
  const baleines = v.baleines;
  if (baleines !== undefined && (!objet(baleines) || !champs(baleines, ["nombre", "usdTotal"]) || !Number.isInteger(baleines.nombre) || (baleines.nombre as number) < 0 || !fini(baleines.usdTotal))) return false;
  const bougie = v.derniereBougie;
  if (bougie !== undefined && (!objet(bougie) || !champs(bougie, ["time", "open", "high", "low", "close", "volume"]) || !["time", "open", "high", "low", "close", "volume"].every((key) => fini(bougie[key]))
    || (bougie.time as number) > ts)) return false;
  return true;
}

/** Retourne une projection compacte vérifiée, ou null ; aucun marché courant n'est consulté. */
export function projeterPreuveDeclenchement(d: DeclenchementEnrichi): PreuveDeclenchement | null {
  const p = d.preuve;
  if (!objet(p) || !objet(p.origine) || !contextePreuveValide(p.contexte, d.ts)) return null;
  const o = p.origine;
  if (o.alertId !== d.alertId || o.ts !== d.ts || o.valeur !== d.valeur || o.message !== d.message
    || !nonVide(o.symbol) || !parmi(o.source, EXCHANGE_IDS) || (o.timeframe !== null && !parmi(o.timeframe, TIMEFRAMES))
    || !conditionDecisionValide(o.condition)) return null;
  const c = p.contexte;
  return { origine: { alertId: d.alertId, ts: d.ts, symbol: o.symbol, source: o.source as ExchangeId,
    timeframe: o.timeframe as Timeframe | null, condition: JSON.parse(JSON.stringify(o.condition)) as ConditionAlerte,
    valeur: d.valeur, message: d.message,
    ...(d.instantane ? { instantane: { ...d.instantane } } : {}) },
  contexte: {
    ...(["dernierPrix", "prixPrecedent", "fundingRate", "fundingZScore", "liqUsdParMin", "regimeScore", "cvdDivergenceKind"] as const)
      .reduce((acc, key) => c[key] === undefined ? acc : { ...acc, [key]: c[key] }, {} as ContexteDecision),
    ...(c.onchainMetriques ? { onchainMetriques: { ...c.onchainMetriques } } : {}),
    ...(c.fluxCapitaux ? { fluxCapitaux: { ...c.fluxCapitaux } } : {}),
    ...(c.baleines ? { baleines: { ...c.baleines } } : {}),
    ...(c.derniereBougie ? { derniereBougie: { ...c.derniereBougie } } : {}),
  } };
}

/** Copie une seule bougie connue au temps du signal, sans garder la série OHLC. */
function derniereBougieConnue(candles: Candle[] | undefined, ts: number): BougiePreuve | undefined {
  if (!candles) return undefined;
  for (let i = candles.length - 1; i >= 0; i--) {
    const c = candles[i];
    if (!c || c.closed === false || !fini(c.time) || c.time > ts) continue;
    if (![c.open, c.high, c.low, c.close, c.volume].every(fini)) continue;
    return { time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
  }
  return undefined;
}

/** Extrait uniquement les observations effectivement passées au moteur à cet instant. */
export function contexteDecision(ctx: ContexteAlerte, ts: number): ContexteDecision {
  const out: ContexteDecision = {};
  if (fini(ctx.dernierPrix) && ctx.dernierPrix > 0) out.dernierPrix = ctx.dernierPrix;
  if (fini(ctx.prixPrecedent) && ctx.prixPrecedent > 0) out.prixPrecedent = ctx.prixPrecedent;
  if (fini(ctx.fundingRate)) out.fundingRate = ctx.fundingRate;
  if (fini(ctx.fundingZScore)) out.fundingZScore = ctx.fundingZScore;
  if (fini(ctx.liqUsdParMin)) out.liqUsdParMin = ctx.liqUsdParMin;
  if (fini(ctx.regimeScore)) out.regimeScore = ctx.regimeScore;
  if (ctx.cvdDivergenceKind !== undefined) out.cvdDivergenceKind = ctx.cvdDivergenceKind;
  if (ctx.onchainMetriques) {
    const valides = Object.entries(ctx.onchainMetriques).filter(([, v]) => fini(v));
    if (valides.length > 0) out.onchainMetriques = Object.fromEntries(valides) as ContexteDecision["onchainMetriques"];
  }
  const flux = ctx.fluxCapitaux;
  if (flux && fini(flux.valeur) && fini(flux.observeLe) && flux.observeLe <= ts) {
    out.fluxCapitaux = { metrique: flux.metrique, valeur: flux.valeur, unite: flux.unite,
      observeLe: flux.observeLe, source: flux.source };
  }
  if (ctx.whaleMouvements) {
    const valeurs = ctx.whaleMouvements.map((m) => m.usd).filter(fini);
    out.baleines = { nombre: valeurs.length, usdTotal: valeurs.reduce((a, b) => a + b, 0) };
  }
  const bougie = derniereBougieConnue(ctx.candles, ts);
  if (bougie) out.derniereBougie = bougie;
  return out;
}

/** Capture l'origine tant que la définition existe ; aucun lookup différé du marché. */
export function enrichirDeclenchement(d: Declenchement, def: AlertDef, ctx: ContexteAlerte): DeclenchementEnrichi {
  return {
    ...d,
    preuve: {
      origine: { alertId: d.alertId, ts: d.ts, symbol: def.symbol, source: def.source,
        timeframe: def.timeframe ?? null, condition: JSON.parse(JSON.stringify(def.condition)) as ConditionAlerte,
        valeur: d.valeur, message: d.message, ...(d.instantane ? { instantane: { ...d.instantane } } : {}) },
      contexte: contexteDecision(ctx, d.ts),
    },
  };
}

/** Anciens journaux sans preuve deviennent des dossiers partiels, jamais rétro-remplis. */
export function creerDossierDepuisJournal(id: string, d: DeclenchementEnrichi, creeMs = Date.now()): DossierDecision {
  const preuve = projeterPreuveDeclenchement(d);
  return {
    id, creeMs, schemaVersion: 1, qualite: preuve ? "complete" : "partielle",
    origine: preuve ? JSON.parse(JSON.stringify(preuve.origine)) as OrigineDecision
      : { alertId: d.alertId, ts: d.ts, symbol: null, source: null, timeframe: null,
        condition: null, valeur: d.valeur, message: d.message,
        ...(d.instantane ? { instantane: { ...d.instantane } } : {}) },
    contexte: preuve ? JSON.parse(JSON.stringify(preuve.contexte)) as ContexteDecision : {},
    these: "", invalidation: "", revue: "",
  };
}
