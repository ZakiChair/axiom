import { useState } from "react";

import { localDateKey } from "../domain/format";
import type { MutationResult } from "../domain/mutations";
import { downloadText } from "../infra/files";

type StorageRecoveryProps = {
  onRestoreDemo: () => MutationResult;
  rawState: string | null;
};

export function createRawRecoveryExport(rawState: string, now: Date): {
  name: string;
  content: string;
  type: string;
} {
  return {
    name: `pacte-recuperation-brute-${localDateKey(now)}.txt`,
    content: rawState,
    type: "text/plain;charset=utf-8",
  };
}

export function exportRawState(rawState: string): void {
  const backup = createRawRecoveryExport(rawState, new Date());
  downloadText(backup.name, backup.content, backup.type);
}

export function StorageRecovery({ onRestoreDemo, rawState }: StorageRecoveryProps) {
  const [error, setError] = useState("");

  function restoreDemo() {
    if (!globalThis.confirm(
      "Remplacer le coffre corrompu par le jeu de démonstration ? Vérifiez d’abord votre export brut.",
    )) return;

    try {
      const result = onRestoreDemo();
      if (!result.ok) setError(result.error);
    } catch (caught) {
      setError(caught instanceof Error
        ? caught.message
        : "Le jeu de démonstration n’a pas pu être enregistré.");
    }
  }

  return (
    <main className="error-page recovery-page">
      <section aria-labelledby="storage-recovery-title" role="alert">
        <p className="section-kicker">Récupération requise</p>
        <h1 id="storage-recovery-title">Coffre local à récupérer</h1>
        <p>
          La valeur enregistrée n’est pas un coffre PACTE V1 valide. Le parcours est
          bloqué pour éviter tout remplacement silencieux.
        </p>
        <p>
          Exportez la valeur brute si elle est accessible, puis choisissez la
          restauration seulement après une confirmation explicite.
        </p>
        {error ? <p className="dialog-error">{error}</p> : null}
        <div className="recovery-actions">
          <button
            className="secondary-action"
            disabled={rawState === null}
            onClick={() => rawState === null ? undefined : exportRawState(rawState)}
            type="button"
          >
            Exporter la valeur brute
          </button>
          <button className="primary-action" onClick={restoreDemo} type="button">
            Restaurer la démonstration
          </button>
        </div>
        {rawState === null ? (
          <p className="form-note">
            Le navigateur n’a pas permis de relire la valeur brute. Ne fermez pas cet
            écran avant d’avoir vérifié les réglages de stockage du site.
          </p>
        ) : null}
      </section>
    </main>
  );
}
