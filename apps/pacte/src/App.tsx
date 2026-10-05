import { useCallback, useEffect, useRef, useState } from "react";

import { Shell } from "./components/Shell";
import { StorageRecovery } from "./components/StorageRecovery";
import type { ViewId } from "./components/Shell";
import { usePacte } from "./hooks/usePacte";
import { AnomaliesView } from "./views/AnomaliesView";
import { CasesView } from "./views/CasesView";
import { ContractsView } from "./views/ContractsView";
import { DataView } from "./views/DataView";
import { DashboardView } from "./views/DashboardView";
import { TransactionsView } from "./views/TransactionsView";

const VIEW_TITLES: Record<ViewId, string> = {
  dashboard: "Vue d’ensemble",
  contracts: "Contrats",
  transactions: "Transactions",
  anomalies: "Anomalies",
  cases: "Dossiers",
  data: "Données",
};

type FocusOwner = "main" | "target";

export function App() {
  const [activeView, setActiveView] = useState<ViewId>("dashboard");
  const [selectedAnomalyId, setSelectedAnomalyId] = useState<string>();
  const [selectedCaseId, setSelectedCaseId] = useState<string>();
  const mainRef = useRef<HTMLElement>(null);
  const shouldFocusMain = useRef(false);
  const pacte = usePacte();
  const activeTitle = VIEW_TITLES[activeView];
  const headingId = activeView === "dashboard" ? "dashboard-title" : `${activeView}-title`;

  const navigateTo = useCallback((view: ViewId, focusOwner: FocusOwner = "main") => {
    if (view === "anomalies" && focusOwner === "main") setSelectedAnomalyId(undefined);
    if (view === activeView) return;
    shouldFocusMain.current = focusOwner === "main";
    setActiveView(view);
  }, [activeView]);

  const openAnomaly = useCallback((anomalyId: string) => {
    setSelectedAnomalyId(anomalyId);
    navigateTo("anomalies", "target");
  }, [navigateTo]);

  const openCase = useCallback((caseId: string) => {
    setSelectedCaseId(caseId);
    navigateTo("cases");
  }, [navigateTo]);

  useEffect(() => {
    if (!shouldFocusMain.current) return;
    shouldFocusMain.current = false;
    mainRef.current?.focus();
  }, [activeView]);

  if (pacte.storageRecovery.required) {
    return (
      <StorageRecovery
        onRestoreDemo={pacte.restoreCorruptStorage}
        rawState={pacte.storageRecovery.raw}
      />
    );
  }

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
          onOpenAnomaly={openAnomaly}
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
          contracts={pacte.state.contracts}
          defaultCurrency={pacte.state.household.currency}
          onAssignContract={pacte.assignTransactionContract}
          onImportTransactions={pacte.importTransactions}
          transactions={pacte.state.transactions}
        />
      ) : activeView === "anomalies" ? (
        <AnomaliesView
          anomalies={pacte.anomalies}
          cases={pacte.state.cases}
          onDismissAnomaly={pacte.dismissAnomaly}
          onOpenCase={pacte.openCase}
          onSelectCase={openCase}
          selectedAnomalyId={selectedAnomalyId}
        />
      ) : activeView === "cases" ? (
        <CasesView
          cases={pacte.state.cases}
          onSelectCase={setSelectedCaseId}
          onUpdateCase={pacte.updateCase}
          selectedCaseId={selectedCaseId}
        />
      ) : (
        <DataView
          onReplaceState={pacte.replaceState}
          onResetEmpty={pacte.resetEmpty}
          onRestoreDemo={pacte.restoreDemo}
          state={pacte.state}
        />
      )}
    </Shell>
  );
}
