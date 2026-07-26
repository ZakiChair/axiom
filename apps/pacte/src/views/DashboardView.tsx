import type { Anomaly, Contract, Currency, PacteState } from "../domain/model";
import type { ViewId } from "../components/Shell";
import { formatCalendarDate, formatCurrency, localDateKey } from "../domain/format";
import { isNonNegativeAmount, isPositiveAmount, shiftIsoDate } from "../domain/limits";

type DashboardViewProps = {
  anomalies: Anomaly[];
  onNavigate: (view: ViewId) => void;
  onOpenAnomaly: (anomalyId: string) => void;
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

export function getUpcomingDeadlines(contracts: Contract[], today: string): Deadline[] {
  return contracts
    .flatMap((contract) => {
      if (contract.status !== "active" || !contract.nextRenewalDate) return [];

      const date = shiftIsoDate(contract.nextRenewalDate, -contract.noticeDays);
      return date ? [{
        contractId: contract.id,
        date,
        provider: contract.provider,
      }] : [];
    })
    .filter((deadline) => deadline.date >= today)
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(0, 2);
}

type CurrencyTotals = Record<Currency, number>;

export type DashboardKpis = {
  activeContracts: number;
  recurringMonthly: CurrencyTotals;
  recoverable: CurrencyTotals;
};

function emptyCurrencyTotals(): CurrencyTotals {
  return { CHF: 0, EUR: 0 };
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function computeDashboardKpis(
  contracts: Contract[],
  anomalies: Anomaly[],
): DashboardKpis {
  const activeContracts = contracts.filter((contract) => contract.status === "active");
  const recurringMonthly = emptyCurrencyTotals();
  const recoverable = emptyCurrencyTotals();

  for (const contract of activeContracts) {
    const divisor = contract.cadence === "monthly"
      ? 1
      : contract.cadence === "quarterly"
        ? 3
        : contract.cadence === "annual"
          ? 12
          : undefined;
    if (divisor && isPositiveAmount(contract.amount)) {
      recurringMonthly[contract.currency] += contract.amount / divisor;
    }
  }

  for (const anomaly of anomalies) {
    if (isNonNegativeAmount(anomaly.amount)) {
      recoverable[anomaly.currency] += anomaly.amount;
    }
  }

  recurringMonthly.CHF = roundMoney(recurringMonthly.CHF);
  recurringMonthly.EUR = roundMoney(recurringMonthly.EUR);
  recoverable.CHF = roundMoney(recoverable.CHF);
  recoverable.EUR = roundMoney(recoverable.EUR);

  return {
    activeContracts: activeContracts.length,
    recurringMonthly,
    recoverable,
  };
}

export function getRecentContracts(contracts: Contract[], limit = 4): Contract[] {
  return contracts.slice(-limit).reverse();
}

function CurrencyAmounts({ totals }: { totals: CurrencyTotals }) {
  return (
    <span className="currency-totals">
      <span>{formatCurrency(totals.CHF, "CHF")}</span>
      <span>{formatCurrency(totals.EUR, "EUR")}</span>
    </span>
  );
}

function scoreLabel(score: number): string {
  if (score >= 80) return "Sous contrôle";
  if (score >= 55) return "À surveiller";
  return "À reprendre";
}

export function DashboardView({ anomalies, onNavigate, onOpenAnomaly, score, state }: DashboardViewProps) {
  const now = new Date();
  const today = localDateKey(now);
  const deadlines = getUpcomingDeadlines(state.contracts, today);
  const kpis = computeDashboardKpis(state.contracts, anomalies);
  const priorityAnomalies = anomalies.slice(0, 3);
  const compactContracts = getRecentContracts(state.contracts);

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
            <dd>{kpis.activeContracts}</dd>
          </div>
          <div>
            <dt>Total mensuel récurrent</dt>
            <dd><CurrencyAmounts totals={kpis.recurringMonthly} /></dd>
          </div>
          <div className="kpi-alert">
            <dt>Potentiellement récupérable</dt>
            <dd><CurrencyAmounts totals={kpis.recoverable} /></dd>
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
                      {formatCurrency(contract.amount, contract.currency)}
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
                    <button onClick={() => onOpenAnomaly(anomaly.id)} type="button">
                      <span className={`severity severity-${anomaly.severity}`}>
                        {SEVERITY_LABELS[anomaly.severity]}
                      </span>
                      <strong>{anomaly.title}</strong>
                      <span>
                        {formatCurrency(
                          anomaly.amount,
                          anomaly.currency,
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
                      <time dateTime={deadline.date}>{formatCalendarDate(deadline.date)}</time>
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
