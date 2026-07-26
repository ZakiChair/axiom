import type { Anomaly, Contract, PacteState } from "../domain/model";
import type { ViewId } from "../components/Shell";

type DashboardViewProps = {
  anomalies: Anomaly[];
  onNavigate: (view: ViewId) => void;
  score: number;
  state: PacteState;
};

type Deadline = {
  contractId: string;
  date: string;
  provider: string;
};

const SEVERITY_LABELS: Record<Anomaly["severity"], string> = {
  critical: "Critique",
  important: "Important",
  vigilance: "Vigilance",
};

const CONTRACT_STATUS_LABELS: Record<Contract["status"], string> = {
  active: "Actif",
  paused: "En pause",
  terminated: "Résilié",
};

const DAY_IN_MS = 24 * 60 * 60 * 1_000;

function addDays(date: string, days: number): string {
  const time = Date.parse(`${date}T00:00:00.000Z`) + days * DAY_IN_MS;
  return new Date(time).toISOString().slice(0, 10);
}

function upcomingDeadlines(contracts: Contract[]): Deadline[] {
  return contracts
    .flatMap((contract) => {
      if (contract.status !== "active" || !contract.nextRenewalDate) return [];

      return [{
        contractId: contract.id,
        date: addDays(contract.nextRenewalDate, -contract.noticeDays),
        provider: contract.provider,
      }];
    })
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(0, 2);
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("fr-CH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00.000Z`));
}

function formatAmount(amount: number, currency: PacteState["household"]["currency"]): string {
  return new Intl.NumberFormat("fr-CH", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function scoreLabel(score: number): string {
  if (score >= 80) return "Sous contrôle";
  if (score >= 55) return "À surveiller";
  return "À reprendre";
}

export function DashboardView({ anomalies, onNavigate, score, state }: DashboardViewProps) {
  const deadlines = upcomingDeadlines(state.contracts);
  const activeContracts = state.contracts.filter((contract) => contract.status === "active");
  const priorityAnomalies = anomalies.slice(0, 3);
  const compactContracts = state.contracts.slice(0, 4);

  return (
    <div className="dashboard-view">
      <section className="dashboard-ledger" aria-labelledby="dashboard-title">
        <header className="dashboard-heading">
          <p className="section-kicker">État du registre · mise à jour locale</p>
          <h1 id="dashboard-title">Bonjour, {state.household.name}</h1>
          <p>
            Voici les points qui demandent votre attention dans les contrats du foyer.
          </p>
        </header>

        <dl className="kpi-row" aria-label="Indicateurs du foyer">
          <div>
            <dt>Contrats actifs</dt>
            <dd>{activeContracts.length}</dd>
          </div>
          <div>
            <dt>Mouvements suivis</dt>
            <dd>{state.transactions.length}</dd>
          </div>
          <div className="kpi-alert">
            <dt>Contrôles actifs</dt>
            <dd>{anomalies.length}</dd>
          </div>
        </dl>

        <section className="contracts-register" aria-labelledby="contracts-title">
          <div className="section-heading-row">
            <div>
              <p className="section-kicker">Extrait du registre</p>
              <h2 id="contracts-title">Contrats suivis</h2>
            </div>
            <button className="text-action" onClick={() => onNavigate("contracts")} type="button">
              Voir le registre
            </button>
          </div>

          {compactContracts.length > 0 ? (
            <ul className="contract-list">
              {compactContracts.map((contract) => (
                <li key={contract.id}>
                  <button onClick={() => onNavigate("contracts")} type="button">
                    <span className="contract-provider">{contract.provider}</span>
                    <span className="contract-reference">{contract.reference}</span>
                    <span className={`status-label status-${contract.status}`}>
                      {CONTRACT_STATUS_LABELS[contract.status]}
                    </span>
                    <span className="contract-amount">
                      {formatAmount(contract.amount, contract.currency)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-note">Le registre est vide. Ajoutez un contrat pour commencer.</p>
          )}
        </section>
      </section>

      <aside className="audit-rail" aria-label="Marge d’audit">
        <section className="score-section" aria-labelledby="score-title">
          <div className="audit-marker" aria-hidden="true">SC</div>
          <div>
            <p className="section-kicker">Indice de contrôle</p>
            <h2 id="score-title" className="visually-hidden">Score du foyer</h2>
            <div
              aria-label={`Score de contrôle : ${score} sur 100, ${scoreLabel(score)}`}
              className="score-disc"
              role="img"
            >
              <strong>{score}</strong>
              <span>/ 100</span>
            </div>
            <p className="score-caption">{scoreLabel(score)}</p>
          </div>
        </section>

        <section className="priority-section" aria-labelledby="priorities-title">
          <div className="audit-marker" aria-hidden="true">PR</div>
          <div className="audit-section-content">
            <div className="section-heading-row compact-heading">
              <div>
                <p className="section-kicker">À traiter d’abord</p>
                <h2 id="priorities-title">Priorités</h2>
              </div>
              <button
                aria-label="Voir toutes les anomalies"
                className="text-action"
                onClick={() => onNavigate("anomalies")}
                type="button"
              >
                Tout voir
              </button>
            </div>

            {priorityAnomalies.length > 0 ? (
              <ol className="priority-list">
                {priorityAnomalies.map((anomaly) => (
                  <li key={anomaly.id}>
                    <button onClick={() => onNavigate("anomalies")} type="button">
                      <span className={`severity severity-${anomaly.severity}`}>
                        {SEVERITY_LABELS[anomaly.severity]}
                      </span>
                      <strong>{anomaly.title}</strong>
                      <span>
                        {formatAmount(
                          anomaly.amount,
                          anomaly.evidence[0]?.currency ?? state.household.currency,
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="empty-note">Aucun écart actif dans le registre.</p>
            )}
          </div>
        </section>

        <section className="deadline-section" aria-labelledby="deadlines-title">
          <div className="audit-marker" aria-hidden="true">ÉC</div>
          <div className="audit-section-content">
            <p className="section-kicker">Préavis à noter</p>
            <h2 id="deadlines-title">Échéances</h2>
            {deadlines.length > 0 ? (
              <ol className="deadline-list">
                {deadlines.map((deadline) => (
                  <li key={deadline.contractId}>
                    <button onClick={() => onNavigate("contracts")} type="button">
                      <time dateTime={deadline.date}>{formatDate(deadline.date)}</time>
                      <span>{deadline.provider}</span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="empty-note">Aucun préavis renseigné.</p>
            )}
          </div>
        </section>
      </aside>
    </div>
  );
}
