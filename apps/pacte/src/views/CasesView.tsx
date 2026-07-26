import { useState } from "react";

import {
  formatCalendarDate,
  formatCurrency,
  formatTimestamp,
  localDateKey,
} from "../domain/format";
import type { ClaimCase, ClaimCaseStatus } from "../domain/model";
import type { MutationResult } from "../domain/mutations";
import { downloadText } from "../infra/files";
import { nextNotification } from "./notifications";
import type { Notification } from "./notifications";

type CaseChanges = Partial<Pick<ClaimCase, "status" | "note" | "letter">>;
type CaseDraft = Pick<ClaimCase, "note" | "letter">;
type CaseDrafts = Record<string, CaseDraft>;
type CaseNotification = Notification & { caseId: string };

type CasesViewProps = {
  cases: ClaimCase[];
  onSelectCase: (caseId: string) => void;
  onUpdateCase: (caseId: string, changes: CaseChanges) => MutationResult;
  selectedCaseId?: string;
};

const STATUS_LABELS: Record<ClaimCaseStatus, string> = {
  review: "À examiner",
  ready: "Prêt",
  sent: "Envoyé",
  answered: "Réponse reçue",
  resolved: "Résolu",
  abandoned: "Abandonné",
};

export function caseLetterFileName(provider: string, date: string): string {
  const slug = provider
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-CH")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `reclamation-${slug || "dossier"}-${date}.txt`;
}

export function caseDraftFor(drafts: CaseDrafts, claim: ClaimCase): CaseDraft {
  return drafts[claim.id] ?? { note: claim.note, letter: claim.letter };
}

export function updateCaseDraft(
  drafts: CaseDrafts,
  claim: ClaimCase,
  changes: Partial<CaseDraft>,
): CaseDrafts {
  return {
    ...drafts,
    [claim.id]: { ...caseDraftFor(drafts, claim), ...changes },
  };
}

export function CasesView({ cases, onSelectCase, onUpdateCase, selectedCaseId }: CasesViewProps) {
  const activeCase = cases.find((claim) => claim.id === selectedCaseId) ?? cases[0];
  const [drafts, setDrafts] = useState<CaseDrafts>({});
  const [notification, setNotification] = useState<CaseNotification | null>(null);
  const activeDraft = activeCase ? caseDraftFor(drafts, activeCase) : { note: "", letter: "" };

  function notify(kind: Notification["kind"], message: string) {
    if (!activeCase) return;
    setNotification((current) => ({
      ...nextNotification(current, kind, message),
      caseId: activeCase.id,
    }));
  }

  function update(changes: CaseChanges, successMessage: string): boolean {
    if (!activeCase) return false;
    try {
      const result = onUpdateCase(activeCase.id, changes);
      if (!result.ok) {
        notify("error", result.error);
        return false;
      }
      notify("success", successMessage);
      return true;
    } catch (error) {
      notify(
        "error",
        error instanceof Error ? error.message : "Le dossier n’a pas pu être enregistré.",
      );
      return false;
    }
  }

  async function copyLetter() {
    if (!activeCase) return;
    try {
      await navigator.clipboard.writeText(activeDraft.letter);
      notify("success", "La lettre a été copiée dans le presse-papiers.");
    } catch {
      notify("error", "La copie a échoué. Sélectionnez le texte de la lettre pour le copier.");
    }
  }

  function downloadLetter() {
    if (!activeCase) return;
    downloadText(
      caseLetterFileName(activeCase.contractSnapshot.provider, localDateKey(new Date())),
      activeDraft.letter,
      "text/plain;charset=utf-8",
    );
  }

  return (
    <section className="registry-view cases-view" aria-labelledby="cases-title">
      <header className="view-heading">
        <div>
          <p className="section-kicker">Suivi des démarches</p>
          <h1 id="cases-title">Dossiers</h1>
          <p>Les preuves restent figées ; seuls le suivi, la note et la lettre sont éditables.</p>
        </div>
        <p className="control-count"><strong>{cases.length}</strong> dossiers locaux</p>
      </header>

      {cases.length === 0 ? (
        <div className="empty-register">
          <p className="section-kicker">Aucune démarche</p>
          <h2>Ouvrez un dossier depuis une anomalie</h2>
          <p>PACTE préparera une lettre factuelle à partir des seules preuves sélectionnées.</p>
        </div>
      ) : activeCase ? (
        <div className="case-workspace">
          <aside className="case-master" aria-label="Liste des dossiers">
            <ol>
              {cases.map((claim) => (
                <li key={claim.id}>
                  <button
                    aria-current={claim.id === activeCase.id ? "true" : undefined}
                    onClick={() => onSelectCase(claim.id)}
                    type="button"
                  >
                    <span className="record-reference">{STATUS_LABELS[claim.status]}</span>
                    <strong>{claim.contractSnapshot.provider}</strong>
                    <span>{claim.anomalySnapshot.title}</span>
                  </button>
                </li>
              ))}
            </ol>
          </aside>

          <article className="case-file" aria-labelledby="active-case-title">
            <header className="case-file-heading">
              <div>
                <p className="record-reference">{activeCase.contractSnapshot.reference}</p>
                <h2 id="active-case-title">{activeCase.contractSnapshot.provider}</h2>
                <p>{activeCase.anomalySnapshot.title}</p>
              </div>
              <div className="field-group case-status-field">
                <label htmlFor="case-status">Statut du dossier</label>
                <select
                  id="case-status"
                  onChange={(event) => update(
                    { status: event.currentTarget.value as ClaimCaseStatus },
                    "Le statut et la chronologie ont été enregistrés.",
                  )}
                  value={activeCase.status}
                >
                  {(Object.keys(STATUS_LABELS) as ClaimCaseStatus[]).map((status) => (
                    <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                  ))}
                </select>
              </div>
            </header>

            {notification?.caseId === activeCase.id ? (
              <p
                className={notification.kind === "error" ? "dialog-error" : "mutation-toast"}
                key={notification.id}
                role={notification.kind === "error" ? "alert" : "status"}
              >
                {notification.message}
              </p>
            ) : null}

            <section className="case-evidence" aria-labelledby="case-evidence-title">
              <p className="section-kicker">Instantané du contrôle</p>
              <h3 id="case-evidence-title">Preuves figées</h3>
              <p>{activeCase.anomalySnapshot.explanation}</p>
              <ul className="evidence-list">
                {activeCase.evidence.map((evidence) => (
                  <li key={evidence.id}>
                    <time dateTime={evidence.date}>{formatCalendarDate(evidence.date)}</time>
                    <span>{evidence.label}</span>
                    <strong>{formatCurrency(evidence.amount, evidence.currency)}</strong>
                  </li>
                ))}
              </ul>
            </section>

            <section className="case-timeline" aria-labelledby="case-timeline-title">
              <p className="section-kicker">Journal daté</p>
              <h3 id="case-timeline-title">Chronologie du dossier</h3>
              <ol>
                {activeCase.timeline.map((event, index) => (
                  <li key={`${event.at}-${index}`}>
                    <time dateTime={event.at}>{formatTimestamp(event.at)}</time>
                    <strong>{STATUS_LABELS[event.status]}</strong>
                    <span>{event.note}</span>
                  </li>
                ))}
              </ol>
            </section>

            <div className="case-editor">
              <div className="field-group">
                <label htmlFor="case-note">Note de suivi</label>
                <textarea
                  id="case-note"
                  onChange={(event) => {
                    const note = event.currentTarget.value;
                    setDrafts((current) => updateCaseDraft(current, activeCase, { note }));
                  }}
                  rows={5}
                  value={activeDraft.note}
                />
              </div>
              <div className="field-group">
                <label htmlFor="case-letter">Lettre de réclamation</label>
                <textarea
                  id="case-letter"
                  onChange={(event) => {
                    const letter = event.currentTarget.value;
                    setDrafts((current) => updateCaseDraft(current, activeCase, { letter }));
                  }}
                  rows={22}
                  value={activeDraft.letter}
                />
              </div>
              <p className="legal-note">Vérifiez les informations et les délais applicables dans votre juridiction avant tout envoi.</p>
              <div className="record-actions no-print">
                <button className="primary-action" onClick={() => update(activeDraft, "La note et la lettre ont été enregistrées.")} type="button">Enregistrer les modifications</button>
                <button className="secondary-action" onClick={copyLetter} type="button">Copier la lettre</button>
                <button className="secondary-action" onClick={downloadLetter} type="button">Télécharger en .txt</button>
                <button className="secondary-action" onClick={() => window.print()} type="button">Imprimer la lettre</button>
              </div>
            </div>

            <section className="printable-letter" aria-label="Lettre active à imprimer">
              <pre>{activeDraft.letter}</pre>
            </section>
          </article>
        </div>
      ) : null}
    </section>
  );
}
