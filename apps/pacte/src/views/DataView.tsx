import { useRef, useState } from "react";
import type { ChangeEvent } from "react";

import { parsePacteState } from "../domain/guards";
import type { PacteState } from "../domain/model";
import type { MutationResult } from "../domain/mutations";
import { downloadText } from "../infra/files";

type DataViewProps = {
  onReplaceState: (state: PacteState) => MutationResult;
  onResetEmpty: () => MutationResult;
  onRestoreDemo: () => MutationResult;
  state: PacteState;
};

type BackupParseResult =
  | { ok: true; state: PacteState }
  | { ok: false; error: string };

export function createStateExport(state: PacteState, now: Date): {
  name: string;
  content: string;
  type: string;
} {
  return {
    name: `pacte-sauvegarde-${now.toISOString().slice(0, 10)}.json`,
    content: JSON.stringify(state, null, 2),
    type: "application/json;charset=utf-8",
  };
}

export function parseBackupText(text: string): BackupParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "Le fichier ne contient pas un JSON lisible." };
  }
  const state = parsePacteState(parsed);
  return state
    ? { ok: true, state }
    : { ok: false, error: "Cette sauvegarde ne correspond pas au format PACTE V1." };
}

export function DataView({ onReplaceState, onResetEmpty, onRestoreDemo, state }: DataViewProps) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function showMutation(result: MutationResult, success: string) {
    if (!result.ok) {
      setMessage("");
      setError(result.error);
      return;
    }
    setError("");
    setMessage(success);
  }

  function exportState() {
    const backup = createStateExport(state, new Date());
    downloadText(backup.name, backup.content, backup.type);
    setMessage("La sauvegarde JSON a été préparée sur cet appareil.");
    setError("");
  }

  async function importState(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    setReading(true);
    setMessage("");
    setError("");
    try {
      const parsed = parseBackupText(await file.text());
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      if (!globalThis.confirm("Remplacer toutes les données locales par cette sauvegarde validée ?")) return;
      const result = onReplaceState(parsed.state);
      showMutation(result, "La sauvegarde validée a remplacé le coffre local.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "La sauvegarde n’a pas pu être lue.");
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function restoreDemo() {
    if (!globalThis.confirm("Restaurer le jeu de démonstration et remplacer le coffre actuel ?")) return;
    try {
      showMutation(onRestoreDemo(), "Le jeu de démonstration a été restauré.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "La démonstration n’a pas pu être restaurée.");
    }
  }

  function resetEmpty() {
    if (!globalThis.confirm("Créer un coffre vide et supprimer les contrats, mouvements et dossiers actuels ?")) return;
    try {
      showMutation(onResetEmpty(), "Un coffre vide a été créé pour ce foyer.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Le coffre vide n’a pas pu être créé.");
    }
  }

  return (
    <section className="registry-view data-view" aria-labelledby="data-title">
      <header className="view-heading">
        <div>
          <p className="section-kicker">Coffre du navigateur</p>
          <h1 id="data-title">Données</h1>
          <p>Contrôlez ici la sauvegarde complète du registre, sans compte ni service distant.</p>
        </div>
      </header>

      {message ? <p className="mutation-toast" role="status">{message}</p> : null}
      {error ? <p className="dialog-error" role="alert">{error}</p> : null}

      <section className="local-scope" aria-labelledby="local-scope-title">
        <div className="audit-marker" aria-hidden="true">LC</div>
        <div>
          <p className="section-kicker">Portée de la V1</p>
          <h2 id="local-scope-title">Stockage local non chiffré</h2>
          <p>Les données restent dans le stockage de ce navigateur. PACTE ne les transmet à aucun serveur, mais ne chiffre pas ce coffre local.</p>
          <dl className="vault-summary">
            <div><dt>Contrats</dt><dd>{state.contracts.length}</dd></div>
            <div><dt>Mouvements</dt><dd>{state.transactions.length}</dd></div>
            <div><dt>Dossiers</dt><dd>{state.cases.length}</dd></div>
          </dl>
        </div>
      </section>

      <div className="data-actions-grid">
        <section>
          <p className="record-reference">Sauvegarde sortante</p>
          <h2>Exporter le registre</h2>
          <p>Créez un JSON complet et daté, à conserver dans un emplacement de confiance.</p>
          <button className="primary-action" onClick={exportState} type="button">Exporter la sauvegarde</button>
        </section>
        <section>
          <p className="record-reference">Sauvegarde entrante</p>
          <h2>Importer après validation</h2>
          <p>Le schéma PACTE V1 est contrôlé avant toute confirmation de remplacement.</p>
          <label className="file-control" htmlFor="backup-file">Importer une sauvegarde</label>
          <input accept=".json,application/json" id="backup-file" onChange={importState} ref={fileRef} type="file" />
          {reading ? <p className="form-note" role="status">Validation locale en cours…</p> : null}
        </section>
      </div>

      <section className="danger-zone" aria-labelledby="danger-zone-title">
        <p className="section-kicker">Remplacements explicites</p>
        <h2 id="danger-zone-title">Repartir d’un état connu</h2>
        <p>Ces actions remplacent le registre seulement après votre confirmation et une persistance réussie.</p>
        <div className="record-actions">
          <button className="secondary-action" onClick={restoreDemo} type="button">Restaurer la démonstration</button>
          <button className="danger-action" onClick={resetEmpty} type="button">Créer un coffre vide</button>
        </div>
      </section>
    </section>
  );
}
