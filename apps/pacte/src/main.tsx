import { Component, StrictMode } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./index.css";

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("PACTE n’a pas pu afficher l’interface.", error, info);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <main className="error-page">
          <p className="section-kicker">Interruption de l’affichage</p>
          <h1>Le registre n’a pas pu s’ouvrir.</h1>
          <p>
            Rechargez la page pour reprendre. Vos données restent enregistrées dans ce
            navigateur et ne sont pas envoyées ailleurs.
          </p>
          <button className="primary-action" onClick={() => window.location.reload()} type="button">
            Recharger la page
          </button>
        </main>
      );
    }

    return this.props.children;
  }
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Élément racine #root introuvable.");
}

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
