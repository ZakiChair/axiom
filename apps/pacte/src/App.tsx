import { useState } from "react";

import { Shell } from "./components/Shell";
import type { ViewId } from "./components/Shell";
import type { PacteState } from "./domain/model";
import { usePacte } from "./hooks/usePacte";
import { DashboardView } from "./views/DashboardView";

type PlaceholderViewProps = {
  anomalyCount: number;
  onNavigate: (view: ViewId) => void;
  state: PacteState;
  view: Exclude<ViewId, "dashboard">;
};

const VIEW_COPY: Record<Exclude<ViewId, "dashboard">, {
  eyebrow: string;
  title: string;
  description: string;
  detail: (state: PacteState, anomalyCount: number) => string;
}> = {
  contracts: {
    eyebrow: "Registre des engagements",
    title: "Contrats",
    description: "Le détail, l’ajout et la modification des contrats seront disponibles ici.",
    detail: (state) => `${state.contracts.length} contrats sont déjà consignés dans le coffre.`,
  },
  transactions: {
    eyebrow: "Journal des mouvements",
    title: "Transactions",
    description: "L’import et le rapprochement des mouvements seront disponibles ici.",
    detail: (state) => `${state.transactions.length} mouvements sont actuellement suivis.`,
  },
  anomalies: {
    eyebrow: "File de contrôle",
    title: "Anomalies",
    description: "La revue des preuves et l’ouverture d’un dossier seront disponibles ici.",
    detail: (_state, anomalyCount) => `${anomalyCount} contrôles demandent votre attention.`,
  },
  cases: {
    eyebrow: "Suivi des démarches",
    title: "Dossiers",
    description: "Les lettres, pièces et changements de statut seront réunis ici.",
    detail: (state) => `${state.cases.length} dossiers sont enregistrés dans le coffre.`,
  },
  data: {
    eyebrow: "Coffre du navigateur",
    title: "Données",
    description: "La sauvegarde, la restauration et la remise à zéro seront disponibles ici.",
    detail: () => "Les données restent sur cet appareil et ne sont envoyées à aucun service.",
  },
};

function PlaceholderView({ anomalyCount, onNavigate, state, view }: PlaceholderViewProps) {
  const copy = VIEW_COPY[view];

  return (
    <section className="placeholder-view" aria-labelledby={`${view}-title`}>
      <p className="section-kicker">{copy.eyebrow}</p>
      <h1 id={`${view}-title`}>{copy.title}</h1>
      <p className="placeholder-description">{copy.description}</p>
      <p className="placeholder-detail">{copy.detail(state, anomalyCount)}</p>
      <button className="primary-action" onClick={() => onNavigate("dashboard")} type="button">
        Revenir à la vue d’ensemble
      </button>
    </section>
  );
}

export function App() {
  const [activeView, setActiveView] = useState<ViewId>("dashboard");
  const pacte = usePacte();

  return (
    <Shell
      activeView={activeView}
      anomalyCount={pacte.anomalies.length}
      onNavigate={setActiveView}
    >
      {activeView === "dashboard" ? (
        <DashboardView
          anomalies={pacte.anomalies}
          onNavigate={setActiveView}
          score={pacte.score}
          state={pacte.state}
        />
      ) : (
        <PlaceholderView
          anomalyCount={pacte.anomalies.length}
          onNavigate={setActiveView}
          state={pacte.state}
          view={activeView}
        />
      )}
    </Shell>
  );
}
