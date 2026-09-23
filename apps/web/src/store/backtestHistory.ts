import { createStore } from "zustand/vanilla";
import {
  decoderArchive, decoderVersion, encoderArchive, SCHEMA_ARCHIVE_BT,
  type ArchiveRunBacktest, type VersionConfigBacktest,
} from "../data/backtestArchive";
import { copierConfigRun, signatureRun, type ConfigRun } from "./backtestSignature";
import { miroiterTravailPersonnel } from "../data/daemon";

export const CLE_HISTORIQUE_BT = "axiom:backtest:history:v1";
export const MAX_RUNS_BT = 50;
export const MAX_VERSIONS_BT = 50;

type Stockage = Pick<Storage, "getItem" | "setItem">;

export interface HistoriqueBacktestState {
  runs: ArchiveRunBacktest[];
  versions: VersionConfigBacktest[];
  erreurSauvegarde: string | null;
  reessaiPossible: boolean;
  brutOriginal: string | null;
  recuperationConfirmee: boolean;
  ajouterRun: (run: ArchiveRunBacktest) => boolean;
  sauverVersion: (nom: string, config: ConfigRun) => string | null;
  supprimerRun: (id: string) => void;
  supprimerVersion: (id: string) => void;
  reessayerSauvegarde: () => boolean;
  exporterJSON: () => string;
  exporterOriginalJSON: () => string | null;
  confirmerExportOriginal: () => void;
}

function clonerConfig(config: ConfigRun): ConfigRun {
  return copierConfigRun(config);
}

let compteurId = 0;
function nouvelId(prefixe: string): string {
  compteurId++;
  return `${prefixe}:${Date.now().toString(36)}:${compteurId.toString(36)}:${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}

function serialiser(runs: ArchiveRunBacktest[], versions: VersionConfigBacktest[]): string {
  return JSON.stringify({
    schemaVersion: SCHEMA_ARCHIVE_BT,
    runs: runs.map((run) => JSON.parse(encoderArchive(run)) as unknown),
    versions,
  });
}

function hydrater(storage: Stockage): Pick<HistoriqueBacktestState, "runs" | "versions" | "erreurSauvegarde" | "reessaiPossible" | "brutOriginal" | "recuperationConfirmee"> {
  let raw: string | null = null;
  try {
    raw = storage.getItem(CLE_HISTORIQUE_BT);
    if (raw === null) return { runs: [], versions: [], erreurSauvegarde: null, reessaiPossible: false, brutOriginal: null, recuperationConfirmee: false };
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("format racine invalide");
    const doc = parsed as Record<string, unknown>;
    if (doc.schemaVersion !== SCHEMA_ARCHIVE_BT || !Array.isArray(doc.runs) || !Array.isArray(doc.versions)) {
      throw new Error("schéma ou listes invalides");
    }
    const idsRuns = new Set<string>();
    const runs = doc.runs.map(decoderArchive).filter((r): r is ArchiveRunBacktest => {
      if (r === null || idsRuns.has(r.id)) return false;
      idsRuns.add(r.id);
      return true;
    }).slice(0, MAX_RUNS_BT);
    const idsVersions = new Set<string>();
    const versions = doc.versions.map(decoderVersion).filter((v): v is VersionConfigBacktest => {
      if (v === null || idsVersions.has(v.id)) return false;
      idsVersions.add(v.id);
      return true;
    }).slice(0, MAX_VERSIONS_BT);
    const ignores = doc.runs.length - runs.length + doc.versions.length - versions.length;
    return { runs, versions, erreurSauvegarde: ignores > 0
      ? `${ignores} entrée(s) invalides ou hors limite ignorée(s). Exportez la sauvegarde d'origine avant toute modification.` : null,
      reessaiPossible: false, brutOriginal: ignores > 0 ? raw : null, recuperationConfirmee: false };
  } catch (err) {
    return { runs: [], versions: [], erreurSauvegarde: `Archive locale illisible : ${err instanceof Error ? err.message : String(err)}.${raw === null ? "" : " Exportez la sauvegarde d'origine avant toute modification."}`, reessaiPossible: false, brutOriginal: raw, recuperationConfirmee: false };
  }
}

/** Store isolable pour les tests ; en production, un singleton utilise localStorage. */
export function creerHistoriqueBacktest(storage: Stockage) {
  const initial = hydrater(storage);
  return createStore<HistoriqueBacktestState>((set, get) => {
    const exportRequis = (): boolean => {
      if (get().brutOriginal === null || get().recuperationConfirmee) return false;
      set({ erreurSauvegarde: "Archive partiellement illisible : exportez la sauvegarde d'origine avant toute modification.", reessaiPossible: false });
      return true;
    };
    const persister = (runs: ArchiveRunBacktest[], versions: VersionConfigBacktest[]): boolean => {
      if (exportRequis()) return false;
      try {
        const valeur = serialiser(runs, versions);
        storage.setItem(CLE_HISTORIQUE_BT, valeur);
        miroiterTravailPersonnel(CLE_HISTORIQUE_BT, valeur);
        set({ erreurSauvegarde: null, reessaiPossible: false });
        return true;
      } catch (err) {
        set({ erreurSauvegarde: `Sauvegarde locale impossible : ${err instanceof Error ? err.message : String(err)}. Réessayez.`, reessaiPossible: true });
        return false;
      }
    };
    return {
      ...initial,
      ajouterRun: (source) => {
        if (exportRequis()) return false;
        const actuel = get();
        if (actuel.runs.length >= MAX_RUNS_BT) {
          set({ erreurSauvegarde: `Limite de ${MAX_RUNS_BT} runs atteinte : supprimez ou exportez un run.`, reessaiPossible: false });
          return false;
        }
        const run: ArchiveRunBacktest = {
          ...source, id: nouvelId("run"), config: clonerConfig(source.config),
          fenetreDemandee: { ...source.fenetreDemandee }, donnees: { ...source.donnees },
          funding: { ...source.funding, couverture: source.funding.couverture === null ? null
            : JSON.parse(JSON.stringify(source.funding.couverture)) as ArchiveRunBacktest["funding"]["couverture"] },
          stats: { ...source.stats },
        };
        const runs = [run, ...actuel.runs];
        set({ runs });
        persister(runs, get().versions);
        return true;
      },
      sauverVersion: (nom, config) => {
        if (exportRequis()) return null;
        const propre = nom.trim();
        if (!propre) { set({ erreurSauvegarde: "Donnez un nom à la version.", reessaiPossible: false }); return null; }
        const actuel = get();
        if (actuel.versions.length >= MAX_VERSIONS_BT) {
          set({ erreurSauvegarde: `Limite de ${MAX_VERSIONS_BT} versions atteinte : supprimez ou exportez une version.`, reessaiPossible: false });
          return null;
        }
        const copie = clonerConfig(config);
        const version: VersionConfigBacktest = {
          id: nouvelId("version"), nom: propre, creeMs: Date.now(), schemaVersion: 1,
          config: copie, signature: signatureRun(copie),
        };
        const versions = [version, ...actuel.versions];
        set({ versions });
        persister(get().runs, versions);
        return version.id;
      },
      supprimerRun: (id) => {
        if (exportRequis()) return;
        const runs = get().runs.filter((r) => r.id !== id);
        set({ runs });
        persister(runs, get().versions);
      },
      supprimerVersion: (id) => {
        if (exportRequis()) return;
        const versions = get().versions.filter((v) => v.id !== id);
        set({ versions });
        persister(get().runs, versions);
      },
      reessayerSauvegarde: () => persister(get().runs, get().versions),
      exporterJSON: () => serialiser(get().runs, get().versions),
      exporterOriginalJSON: () => get().brutOriginal,
      confirmerExportOriginal: () => {
        if (get().brutOriginal !== null) set({ recuperationConfirmee: true,
          erreurSauvegarde: "Sauvegarde d'origine exportée. Les entrées rejetées restent dans ce fichier ; la prochaine modification enregistrera les données valides." });
      },
    };
  });
}

// Le store BT est chargé à la demande avec sa fenêtre ; aucun accès au storage au boot.
export const backtestHistoryStore = creerHistoriqueBacktest({
  getItem: (key) => typeof localStorage === "undefined" ? null : localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
});
