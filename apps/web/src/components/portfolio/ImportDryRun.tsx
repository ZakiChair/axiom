/**
 * Panneau de validation d'import CSV (dry-run) : affiche lignes valides / erreurs avant
 * toute écriture store. La confirmation et l'annulation sont pilotées par la fenêtre.
 */
import type { ResultatParseCsvPortfolio } from "../../store/portfolioCsv";

interface ImportDryRunProps {
  importDryRun: ResultatParseCsvPortfolio;
  confirmerImportCsv: () => void;
  annuler: () => void;
}

export function ImportDryRun({ importDryRun, confirmerImportCsv, annuler }: ImportDryRunProps) {
  return (
    <div className="mb-3 rounded-md border border-accent/50 bg-bg px-3 py-2 text-[11px] text-text">
      <div className="mb-1.5 font-medium">
        Import CSV — dry-run
      </div>
      <div className="mb-1.5 flex gap-3 text-[10px] text-text-dim">
        <span>
          Valides :{" "}
          <span className="tabular-nums text-up">{importDryRun.ok.length}</span>
        </span>
        <span>
          Erreurs :{" "}
          <span
            className={`tabular-nums ${
              importDryRun.erreurs.length > 0 ? "text-down" : ""
            }`}
          >
            {importDryRun.erreurs.length}
          </span>
        </span>
      </div>
      {importDryRun.ok.length > 0 && (
        <div className="mb-1.5 max-h-24 overflow-y-auto rounded border border-border bg-surface/40 px-2 py-1 text-[10px] text-text-dim">
          {importDryRun.ok.slice(0, 12).map((l, i) => (
            <div key={`${l.symbole}-${i}`} className="tabular-nums">
              {l.symbole} {l.direction} {l.taille} @ {l.prixEntree}
              {l.source ? ` · ${l.source}` : " · (exchange actif)"}
            </div>
          ))}
          {importDryRun.ok.length > 12 && (
            <div>… +{importDryRun.ok.length - 12} autres</div>
          )}
        </div>
      )}
      {importDryRun.erreurs.length > 0 && (
        <div className="mb-1.5 max-h-20 overflow-y-auto rounded border border-down/40 bg-surface/40 px-2 py-1 text-[10px] text-down">
          {importDryRun.erreurs.slice(0, 8).map((e, i) => (
            <div key={`${e.ligne}-${i}`}>
              L{e.ligne}: {e.message}
            </div>
          ))}
          {importDryRun.erreurs.length > 8 && (
            <div>… +{importDryRun.erreurs.length - 8} autres</div>
          )}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={confirmerImportCsv}
          disabled={importDryRun.ok.length === 0}
          className="rounded border border-border bg-surface px-2 py-1 text-[10px] transition hover:text-accent disabled:opacity-40"
        >
          Importer {importDryRun.ok.length > 0 ? `(${importDryRun.ok.length})` : ""}
        </button>
        <button
          type="button"
          onClick={annuler}
          className="rounded px-2 py-1 text-[10px] text-text-dim transition hover:text-text"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}
