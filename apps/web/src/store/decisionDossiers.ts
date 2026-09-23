import { createStore } from "zustand/vanilla";
import { EXCHANGE_IDS } from "@axiom/types";
import { miroiterTravailPersonnel } from "../data/daemon";
import { conditionDecisionValide, creerDossierDepuisJournal, projeterPreuveDeclenchement, type DeclenchementEnrichi, type DossierDecision } from "../data/decisionDossier";

export const CLE_DOSSIERS_DECISION = "axiom:decisionDossiers:v1";
export const MAX_DOSSIERS_DECISION = 100;
type Stockage = Pick<Storage, "getItem" | "setItem">;

export interface DecisionDossiersState {
  dossiers: DossierDecision[];
  erreurSauvegarde: string | null;
  reessaiPossible: boolean;
  brutOriginal: string | null;
  recuperationConfirmee: boolean;
  creerDepuisJournal: (d: DeclenchementEnrichi) => string | null;
  modifier: (id: string, patch: Partial<Pick<DossierDecision, "these" | "invalidation" | "revue">>) => void;
  supprimer: (id: string) => void;
  exporterJSON: () => string;
  exporterOriginalJSON: () => string | null;
  confirmerExportOriginal: () => void;
  reessayerSauvegarde: () => boolean;
}

const objet = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const fini = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const TIMEFRAMES = new Set(["1s", "5s", "15s", "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d", "3d", "1w", "1M", "3M", "6M", "12M"]);

function dossierValide(v: unknown): v is DossierDecision {
  if (!objet(v) || v.schemaVersion !== 1 || typeof v.id !== "string" || !v.id || !fini(v.creeMs)
    || !["complete", "partielle"].includes(String(v.qualite)) || !objet(v.origine) || !objet(v.contexte)
    || typeof v.these !== "string" || typeof v.invalidation !== "string" || typeof v.revue !== "string") return false;
  const o = v.origine;
  const bougie = v.contexte.derniereBougie;
  if (bougie !== undefined && (!objet(bougie) || !["time", "open", "high", "low", "close", "volume"].every((cle) => fini(bougie[cle]))
    || (objet(bougie) && fini(o.ts) && (bougie.time as number) > o.ts))) return false;
  const flux = v.contexte.fluxCapitaux;
  if (flux !== undefined && (!objet(flux) || !fini(flux.observeLe) || !fini(o.ts) || flux.observeLe > o.ts
    || !fini(flux.valeur) || typeof flux.metrique !== "string" || typeof flux.unite !== "string" || typeof flux.source !== "string")) return false;
  return typeof o.alertId === "string" && fini(o.ts) && fini(o.valeur) && typeof o.message === "string"
    && (o.symbol === null || typeof o.symbol === "string")
    && (o.source === null || (typeof o.source === "string" && (EXCHANGE_IDS as readonly string[]).includes(o.source)))
    && (o.timeframe === null || (typeof o.timeframe === "string" && TIMEFRAMES.has(o.timeframe)))
    && (o.condition === null || conditionDecisionValide(o.condition))
    && Object.values(v.contexte).every((x) => x === null || fini(x) || typeof x === "string" || objet(x))
    && (v.qualite !== "complete" || projeterPreuveDeclenchement({ alertId: o.alertId, ts: o.ts, valeur: o.valeur,
      message: o.message, preuve: { origine: o, contexte: v.contexte } } as unknown as DeclenchementEnrichi) !== null);
}

function serialiser(dossiers: DossierDecision[]): string {
  return JSON.stringify({ schemaVersion: 1, dossiers });
}

function hydrater(storage: Stockage): Pick<DecisionDossiersState, "dossiers" | "erreurSauvegarde" | "reessaiPossible" | "brutOriginal" | "recuperationConfirmee"> {
  let raw: string | null = null;
  try {
    raw = storage.getItem(CLE_DOSSIERS_DECISION);
    if (raw === null) return { dossiers: [], erreurSauvegarde: null, reessaiPossible: false, brutOriginal: null, recuperationConfirmee: false };
    const doc = JSON.parse(raw) as unknown;
    if (!objet(doc) || doc.schemaVersion !== 1 || !Array.isArray(doc.dossiers)) throw new Error("schéma invalide");
    const ids = new Set<string>();
    const dossiers = doc.dossiers.filter((x): x is DossierDecision => {
      if (!dossierValide(x) || ids.has(x.id)) return false;
      ids.add(x.id);
      return true;
    }).slice(0, MAX_DOSSIERS_DECISION);
    const ignores = doc.dossiers.length - dossiers.length;
    return { dossiers, erreurSauvegarde: ignores > 0 ? `${ignores} dossier(s) invalide(s) ou hors limite. Exportez la sauvegarde d'origine avant modification.` : null,
      reessaiPossible: false, brutOriginal: ignores > 0 ? raw : null, recuperationConfirmee: false };
  } catch (err) {
    return { dossiers: [], erreurSauvegarde: `Dossiers illisibles : ${err instanceof Error ? err.message : String(err)}.${raw === null ? "" : " Exportez la sauvegarde d'origine avant modification."}`,
      reessaiPossible: false, brutOriginal: raw, recuperationConfirmee: false };
  }
}

let compteurId = 0;
function nouvelId(): string {
  compteurId++;
  return `decision:${Date.now().toString(36)}:${compteurId.toString(36)}:${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}

export function creerStoreDossiersDecision(storage: Stockage) {
  const initial = hydrater(storage);
  return createStore<DecisionDossiersState>((set, get) => {
    const exportRequis = (): boolean => {
      if (get().brutOriginal === null || get().recuperationConfirmee) return false;
      set({ erreurSauvegarde: "Exportez la sauvegarde d'origine avant toute modification.", reessaiPossible: false });
      return true;
    };
    const persister = (dossiers: DossierDecision[]): boolean => {
      if (exportRequis()) return false;
      try {
        const valeur = serialiser(dossiers);
        storage.setItem(CLE_DOSSIERS_DECISION, valeur);
        try { miroiterTravailPersonnel(CLE_DOSSIERS_DECISION, valeur); } catch { /* miroir facultatif */ }
        set({ erreurSauvegarde: null, reessaiPossible: false });
        return true;
      } catch (err) {
        set({ erreurSauvegarde: `Sauvegarde locale impossible : ${err instanceof Error ? err.message : String(err)}. Réessayez.`, reessaiPossible: true });
        return false;
      }
    };
    return {
      ...initial,
      creerDepuisJournal: (d) => {
        const existant = get().dossiers.find((x) => x.origine.alertId === d.alertId && x.origine.ts === d.ts);
        if (existant) return existant.id;
        if (exportRequis()) return null;
        if (get().dossiers.length >= MAX_DOSSIERS_DECISION) {
          set({ erreurSauvegarde: `Limite de ${MAX_DOSSIERS_DECISION} dossiers atteinte. Exportez ou supprimez un dossier.`, reessaiPossible: false });
          return null;
        }
        const nouveau = creerDossierDepuisJournal(nouvelId(), d);
        const dossiers = [nouveau, ...get().dossiers];
        set({ dossiers });
        persister(dossiers);
        return nouveau.id;
      },
      modifier: (id, patch) => {
        if (exportRequis()) return;
        const dossiers = get().dossiers.map((d) => d.id === id ? { ...d, ...patch } : d);
        if (!dossiers.some((d) => d.id === id)) return;
        set({ dossiers });
        persister(dossiers);
      },
      supprimer: (id) => {
        if (exportRequis()) return;
        const dossiers = get().dossiers.filter((d) => d.id !== id);
        set({ dossiers });
        persister(dossiers);
      },
      exporterJSON: () => serialiser(get().dossiers),
      exporterOriginalJSON: () => get().brutOriginal,
      confirmerExportOriginal: () => {
        if (get().brutOriginal !== null) set({ recuperationConfirmee: true,
          erreurSauvegarde: "Sauvegarde d'origine exportée. Les éléments rejetés restent dans ce fichier ; la prochaine modification enregistrera les dossiers valides." });
      },
      reessayerSauvegarde: () => persister(get().dossiers),
    };
  });
}

export const decisionDossiersStore = creerStoreDossiersDecision({
  getItem: (key) => typeof localStorage === "undefined" ? null : localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
});
