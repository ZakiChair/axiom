/**
 * Barre d'actions : import / export CSV + rapport périodique (7 j / 30 j).
 *
 * Présentationnel : la génération du rapport et l'import CSV (dry-run) sont pilotés par la
 * fenêtre ; l'export CSV appelle directement le helper store (aucun état local).
 */
import { telechargerPortfolioCsv } from "../../store/portfolioCsv";
import type { Position } from "../../store/portfolio";

interface BarreCsvRapportProps {
  rapportPeriode: 7 | 30;
  setRapportPeriode: (j: 7 | 30) => void;
  rapportEnCours: boolean;
  genererRapport: () => void;
  declencherImportCsv: () => void;
  positions: Position[];
}

export function BarreCsvRapport({
  rapportPeriode,
  setRapportPeriode,
  rapportEnCours,
  genererRapport,
  declencherImportCsv,
  positions,
}: BarreCsvRapportProps) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-4 py-1.5">
      {/* Segmente période du rapport */}
      <div className="flex overflow-hidden rounded border border-border" title="Période du rapport">
        {([7, 30] as const).map((j) => (
          <button
            key={j}
            type="button"
            onClick={() => setRapportPeriode(j)}
            className={`px-2 py-0.5 text-[10px] font-medium transition ${
              rapportPeriode === j ? "bg-surface text-accent" : "text-text-dim hover:text-text"
            }`}
          >
            {j} j
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => void genererRapport()}
        disabled={rapportEnCours}
        className="rounded border border-border bg-surface px-2 py-0.5 text-[10px] text-text-dim transition hover:text-accent disabled:opacity-40"
        title="Générer un rapport HTML autonome (portefeuille, risque, journal)"
      >
        {rapportEnCours ? "Rapport…" : "📄 Rapport"}
      </button>
      <div className="flex-1" />
      <button
        type="button"
        onClick={declencherImportCsv}
        className="rounded border border-border bg-surface px-2 py-0.5 text-[10px] text-text-dim transition hover:text-accent"
        title="Importer des positions depuis un CSV (dry-run)"
      >
        Import CSV
      </button>
      <button
        type="button"
        onClick={() => telechargerPortfolioCsv(positions)}
        disabled={positions.length === 0}
        className="rounded border border-border bg-surface px-2 py-0.5 text-[10px] text-text-dim transition hover:text-accent disabled:opacity-40"
        title="Exporter les positions en CSV"
      >
        Export CSV
      </button>
    </div>
  );
}
