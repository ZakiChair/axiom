import type { ReactNode } from "react";

export type ViewId =
  | "dashboard"
  | "contracts"
  | "transactions"
  | "anomalies"
  | "cases"
  | "data";

type ShellProps = {
  activeView: ViewId;
  anomalyCount: number;
  children: ReactNode;
  onNavigate: (view: ViewId) => void;
};

type NavigationProps = Pick<ShellProps, "activeView" | "anomalyCount" | "onNavigate"> & {
  mobile?: boolean;
};

const NAVIGATION_ITEMS: ReadonlyArray<{
  id: ViewId;
  label: string;
  mobileLabel: string;
}> = [
  { id: "dashboard", label: "Vue d’ensemble", mobileLabel: "Accueil" },
  { id: "contracts", label: "Contrats", mobileLabel: "Contrats" },
  { id: "transactions", label: "Transactions", mobileLabel: "Mouvements" },
  { id: "anomalies", label: "Anomalies", mobileLabel: "Alertes" },
  { id: "cases", label: "Dossiers", mobileLabel: "Dossiers" },
  { id: "data", label: "Données", mobileLabel: "Données" },
];

function Navigation({
  activeView,
  anomalyCount,
  mobile = false,
  onNavigate,
}: NavigationProps) {
  return (
    <nav
      aria-label={mobile ? "Navigation mobile" : "Navigation principale"}
      className={mobile ? "mobile-navigation" : "sidebar-navigation"}
    >
      <ul>
        {NAVIGATION_ITEMS.map((item) => (
          <li key={item.id}>
            <button
              aria-current={activeView === item.id ? "page" : undefined}
              className="navigation-button"
              onClick={() => onNavigate(item.id)}
              type="button"
            >
              <span>{mobile ? item.mobileLabel : item.label}</span>
              {item.id === "anomalies" && anomalyCount > 0 ? (
                <span className="navigation-count" aria-label={`${anomalyCount} anomalies`}>
                  {anomalyCount}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function Shell({ activeView, anomalyCount, children, onNavigate }: ShellProps) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#contenu-principal">
        Aller au contenu
      </a>

      <aside className="sidebar">
        <div className="brand-block">
          <p className="brand-kicker">Registre domestique</p>
          <p className="brand-name">PACTE</p>
          <p className="brand-subtitle">Contrôle local des contrats</p>
        </div>

        <Navigation
          activeView={activeView}
          anomalyCount={anomalyCount}
          onNavigate={onNavigate}
        />

        <div className="local-vault" aria-label="Stockage dans le navigateur">
          <span className="vault-mark" aria-hidden="true" />
          <span>
            <strong>Coffre local</strong>
            <small>Aucun envoi externe</small>
          </span>
        </div>
      </aside>

      <main id="contenu-principal" className="main-content" tabIndex={-1}>
        {children}
      </main>

      <Navigation
        activeView={activeView}
        anomalyCount={anomalyCount}
        mobile
        onNavigate={onNavigate}
      />
    </div>
  );
}
