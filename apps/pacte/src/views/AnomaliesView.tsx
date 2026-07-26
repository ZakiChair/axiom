import { useEffect, useMemo, useRef, useState } from "react";

import { formatCalendarDate, formatCurrency } from "../domain/format";
import type {
  Anomaly,
  AnomalyConfidence,
  AnomalyKind,
  AnomalySeverity,
  ClaimCase,
} from "../domain/model";
import type { MutationResult } from "../domain/mutations";

export type AnomalyFilter = "all" | AnomalySeverity;

type AnomaliesViewProps = {
  anomalies: Anomaly[];
  cases: ClaimCase[];
  onDismissAnomaly: (anomalyId: string) => MutationResult;
  onOpenCase: (anomaly: Anomaly) => MutationResult;
  onSelectCase: (caseId: string) => void;
  selectedAnomalyId?: string;
};

const FILTER_LABELS: Record<AnomalyFilter, string> = {
  all: "Toutes",
  critical: "Critiques",
  important: "Importantes",
  vigilance: "Vigilances",
};

const SEVERITY_LABELS: Record<AnomalySeverity, string> = {
  critical: "Critique",
  important: "Importante",
  vigilance: "Vigilance",
};

const CONFIDENCE_LABELS: Record<AnomalyConfidence, string> = {
  high: "Haute",
  medium: "Moyenne",
  low: "Faible",
};

const RULE_LABELS: Record<AnomalyKind, string> = {
  duplicate: "Double débit",
  "price-increase": "Hausse non expliquée",
  "post-termination": "Débit après résiliation",
  "missing-refund": "Remboursement manquant",
  deadline: "Échéance proche",
};

export function filterAnomalies(
  anomalies: Anomaly[],
  filter: AnomalyFilter,
): Anomaly[] {
  return filter === "all"
    ? anomalies
    : anomalies.filter((anomaly) => anomaly.severity === filter);
}

export function AnomaliesView({
  anomalies,
  cases,
  onDismissAnomaly,
  onOpenCase,
  onSelectCase,
  selectedAnomalyId,
}: AnomaliesViewProps) {
  const [filter, setFilter] = useState<AnomalyFilter>("all");
  const [message, setMessage] = useState("");
  const selectedRef = useRef<HTMLElement>(null);
  const filteredAnomalies = useMemo(
    () => filterAnomalies(anomalies, filter),
    [anomalies, filter],
  );
  const casesByAnomaly = useMemo(
    () => new Map(cases.map((claim) => [claim.anomalyId, claim])),
    [cases],
  );

  useEffect(() => {
    if (!selectedAnomalyId) return;
    setFilter("all");
    selectedRef.current?.focus();
  }, [selectedAnomalyId]);

  function openClaim(anomaly: Anomaly) {
    setMessage("");
    const existing = casesByAnomaly.get(anomaly.id);
    if (existing) {
      onSelectCase(existing.id);
      return;
    }

    try {
      const result = onOpenCase(anomaly);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      onSelectCase(`case:${anomaly.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Le dossier n’a pas pu être ouvert.");
    }
  }

  function dismiss(anomaly: Anomaly) {
    setMessage("");
    if (!globalThis.confirm(`Classer le contrôle « ${anomaly.title} » ?`)) return;
    try {
      const result = onDismissAnomaly(anomaly.id);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      if (result.changed > 0) setMessage("L’anomalie a été classée dans le registre local.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "L’anomalie n’a pas pu être classée.");
    }
  }

  return (
    <section className="registry-view anomaly-view" aria-labelledby="anomalies-title">
      <header className="view-heading">
        <div>
          <p className="section-kicker">File de contrôle</p>
          <h1 id="anomalies-title">Anomalies</h1>
          <p>Chaque écart reste un contrôle automatique à confirmer à partir des faits consignés.</p>
        </div>
        <p className="control-count"><strong>{anomalies.length}</strong> contrôles actifs</p>
      </header>

      <div className="severity-filters" role="group" aria-label="Filtrer les anomalies">
        {(Object.keys(FILTER_LABELS) as AnomalyFilter[]).map((value) => (
          <button
            aria-pressed={filter === value}
            key={value}
            onClick={() => setFilter(value)}
            type="button"
          >
            {FILTER_LABELS[value]}
          </button>
        ))}
      </div>

      {message ? <p className="mutation-toast" role="status">{message}</p> : null}

      {filteredAnomalies.length > 0 ? (
        <ol className="anomaly-register">
          {filteredAnomalies.map((anomaly) => {
            const linkedCase = casesByAnomaly.get(anomaly.id);
            const selected = anomaly.id === selectedAnomalyId;
            const currency = anomaly.evidence[0]?.currency ?? "CHF";
            return (
              <li key={anomaly.id}>
                <article
                  aria-labelledby={`anomaly-title-${anomaly.id}`}
                  className={`anomaly-sheet${selected ? " is-selected" : ""}`}
                  ref={selected ? selectedRef : undefined}
                  tabIndex={selected ? -1 : undefined}
                >
                  <header className="anomaly-heading">
                    <div>
                      <span className={`severity severity-${anomaly.severity}`}>
                        {SEVERITY_LABELS[anomaly.severity]}
                      </span>
                      <p className="record-reference">Règle · {RULE_LABELS[anomaly.kind]}</p>
                      <h2 id={`anomaly-title-${anomaly.id}`}>{anomaly.title}</h2>
                    </div>
                    <p className="anomaly-amount">
                      <span>Montant à vérifier</span>
                      <strong>{formatCurrency(anomaly.amount, currency)}</strong>
                    </p>
                  </header>

                  <p className="anomaly-explanation">{anomaly.explanation}</p>
                  <dl className="audit-facts">
                    <div><dt>Confiance</dt><dd>{CONFIDENCE_LABELS[anomaly.confidence]}</dd></div>
                    <div><dt>Preuves</dt><dd>{anomaly.evidence.length}</dd></div>
                  </dl>

                  <details>
                    <summary>Preuves consignées</summary>
                    {anomaly.evidence.length > 0 ? (
                      <ul className="evidence-list">
                        {anomaly.evidence.map((evidence) => (
                          <li key={evidence.id}>
                            <time dateTime={evidence.date}>{formatCalendarDate(evidence.date)}</time>
                            <span>{evidence.label}</span>
                            <strong>{formatCurrency(evidence.amount, evidence.currency)}</strong>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="empty-note">Aucune transaction n’est associée à cette vigilance.</p>}
                  </details>

                  <div className="record-actions">
                    <button className="primary-action" onClick={() => openClaim(anomaly)} type="button">
                      {linkedCase ? "Voir le dossier" : "Ouvrir un dossier"}
                    </button>
                    <button className="danger-action" onClick={() => dismiss(anomaly)} type="button">
                      Classer cette anomalie
                    </button>
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="empty-register">
          <p className="section-kicker">File à jour</p>
          <h2>Aucune anomalie dans ce filtre</h2>
          <p>Choisissez un autre niveau de contrôle ou revenez après un nouvel import.</p>
        </div>
      )}
    </section>
  );
}
