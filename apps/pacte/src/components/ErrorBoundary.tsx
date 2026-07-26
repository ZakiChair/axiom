import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

import { rawStoredState } from "../infra/storage";
import { exportRawState } from "./StorageRecovery";

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

export function ErrorRecovery({ rawState }: { rawState: string | null }) {
  return (
    <main className="error-page">
      <p className="section-kicker">Interruption de l’affichage</p>
      <h1>Le registre n’a pas pu s’ouvrir.</h1>
      <p>
        Exportez les données brutes si elles sont accessibles, puis rechargez la page.
        Rien n’est envoyé hors de ce navigateur.
      </p>
      <div className="recovery-actions">
        <button
          className="secondary-action"
          disabled={rawState === null}
          onClick={() => rawState === null ? undefined : exportRawState(rawState)}
          type="button"
        >
          Exporter les données brutes
        </button>
        <button className="primary-action" onClick={() => window.location.reload()} type="button">
          Recharger la page
        </button>
      </div>
    </main>
  );
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("PACTE n’a pas pu afficher l’interface.", error, info);
  }

  override render() {
    return this.state.hasError
      ? <ErrorRecovery rawState={rawStoredState()} />
      : this.props.children;
  }
}
