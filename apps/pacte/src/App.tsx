import { useCallback, useEffect, useRef, useState } from "react";

import { Shell } from "./components/Shell";
import type { ViewId } from "./components/Shell";
import type { PacteState } from "./domain/model";
import { usePacte } from "./hooks/usePacte";
import { ContractsView } from "./views/ContractsView";
import { DashboardView } from "./views/DashboardView";
import { TransactionsView } from "./views/TransactionsView";

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
  const mainRef = useRef<HTMLElement>(null);
  const shouldFocusMain = useRef(false);
  const pacte = usePacte();
  const activeTitle = activeView === "dashboard" ? "Vue d’ensemble" : VIEW_COPY[activeView].title;
  const headingId = activeView === "dashboard" ? "dashboard-title" : `${activeView}-title`;

  const navigateTo = useCallback((view: ViewId) => {
    if (view === activeView) return;
    shouldFocusMain.current = true;
    setActiveView(view);
  }, [activeView]);

  useEffect(() => {
    if (!shouldFocusMain.current) return;
    shouldFocusMain.current = false;
    mainRef.current?.focus();
  }, [activeView]);

  return (
    <Shell
      activeView={activeView}
      anomalyCount={pacte.anomalies.length}
      headingId={headingId}
      mainRef={mainRef}
      onNavigate={navigateTo}
      viewTitle={activeTitle}
    >
      {activeView === "dashboard" ? (
        <DashboardView
          anomalies={pacte.anomalies}
          onNavigate={navigateTo}
          score={pacte.score}
          state={pacte.state}
        />
      ) : activeView === "contracts" ? (
        <ContractsView
          contracts={pacte.state.contracts}
          defaultCurrency={pacte.state.household.currency}
          onAddContract={pacte.addContract}
          onRemoveContract={pacte.removeContract}
        />
      ) : activeView === "transactions" ? (
        <TransactionsView
          defaultCurrency={pacte.state.household.currency}
          onImportTransactions={pacte.importTransactions}
          transactions={pacte.state.transactions}
        />
      ) : (
        <PlaceholderView
          anomalyCount={pacte.anomalies.length}
          onNavigate={navigateTo}
          state={pacte.state}
          view={activeView}
        />
      )}
    </Shell>
  );
}
