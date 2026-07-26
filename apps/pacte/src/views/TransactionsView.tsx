import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";

import { Modal } from "../components/Modal";
import {
  buildTransactionEntry,
  firstInvalidField,
  hasEntryErrors,
  validateTransactionEntry,
} from "../domain/entries";
import type { EntryErrors, TransactionEntryInput } from "../domain/entries";
import { formatCalendarDate, formatCurrency } from "../domain/format";
import { parseTransactionCsv } from "../domain/importers";
import type { CsvImportResult } from "../domain/importers";
import type { Currency, Transaction } from "../domain/model";
import type { MutationResult } from "../domain/mutations";
import { readImportFile } from "../infra/files";

type TransactionsViewProps = {
  defaultCurrency: Currency;
  onImportTransactions: (transactions: Transaction[]) => MutationResult;
  transactions: Transaction[];
};

type ManualTransactionFormProps = {
  defaultCurrency: Currency;
  onCancel: () => void;
  onConfirm: (transaction: Transaction) => MutationResult;
};

type CsvImportFormProps = {
  defaultCurrency: Currency;
  onCancel: () => void;
  onConfirm: (transactions: Transaction[]) => MutationResult;
};

const TRANSACTION_FIELD_ORDER: ReadonlyArray<keyof TransactionEntryInput> = [
  "date",
  "label",
  "amount",
  "currency",
];

export function transactionImportMessage(changed: number): string {
  if (changed === 0) {
    return "Aucun nouveau mouvement : toutes les lignes étaient déjà dans le journal.";
  }
  if (changed === 1) return "1 mouvement a été ajouté au journal.";
  return `${changed} mouvements ont été ajoutés au journal.`;
}

function localDate(): string {
  const date = new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function createTransactionInput(defaultCurrency: Currency): TransactionEntryInput {
  return { date: localDate(), label: "", amount: "", currency: defaultCurrency };
}

function localId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `${prefix}-${random}`;
}

const MAX_VISIBLE_TRANSACTIONS = 250;

export function transactionOrigin(transaction: Transaction): {
  label: string;
  className: string;
} {
  if (transaction.id.startsWith("transaction-manual-")) {
    return { label: "Saisie manuelle", className: "origin-manual" };
  }
  if (transaction.importedAt) {
    return { label: "Import CSV", className: "origin-csv" };
  }
  return { label: "Registre initial", className: "origin-initial" };
}

function transactionErrorId(field: keyof TransactionEntryInput): string {
  return `transaction-${field}-error`;
}

function TransactionFieldError({
  errors,
  field,
}: {
  errors: EntryErrors<TransactionEntryInput>;
  field: keyof TransactionEntryInput;
}) {
  const message = errors[field];
  return message ? <span className="field-error" id={transactionErrorId(field)}>{message}</span> : null;
}

function ManualTransactionForm({
  defaultCurrency,
  onCancel,
  onConfirm,
}: ManualTransactionFormProps) {
  const [input, setInput] = useState(() => createTransactionInput(defaultCurrency));
  const [errors, setErrors] = useState<EntryErrors<TransactionEntryInput>>({});
  const [formError, setFormError] = useState("");
  const shouldFocusInvalidField = useRef(false);

  useEffect(() => {
    if (!shouldFocusInvalidField.current) return;
    shouldFocusInvalidField.current = false;
    const field = firstInvalidField(errors, TRANSACTION_FIELD_ORDER);
    if (field) document.getElementById(`transaction-${field}`)?.focus();
  }, [errors]);

  function updateField(field: keyof TransactionEntryInput, value: string) {
    setInput((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setFormError("");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateTransactionEntry(input);
    setErrors(nextErrors);
    setFormError("");
    if (hasEntryErrors(nextErrors)) {
      shouldFocusInvalidField.current = true;
      return;
    }

    try {
      const result = onConfirm(buildTransactionEntry(
        input,
        localId("transaction-manual"),
        new Date().toISOString(),
      ));
      if (!result.ok) setFormError(result.error);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Le mouvement n’a pas pu être ajouté.");
    }
  }

  const describedBy = (field: keyof TransactionEntryInput) => (
    errors[field] ? transactionErrorId(field) : undefined
  );

  return (
    <form className="entry-form" noValidate onSubmit={submit}>
      <div className="form-grid">
        <div className="field-group">
          <label htmlFor="transaction-date">Date *</label>
          <input
            aria-describedby={describedBy("date")}
            aria-invalid={errors.date ? "true" : undefined}
            id="transaction-date"
            onChange={(event) => updateField("date", event.currentTarget.value)}
            required
            type="date"
            value={input.date}
          />
          <TransactionFieldError errors={errors} field="date" />
        </div>
        <div className="field-group field-wide">
          <label htmlFor="transaction-label">Libellé du mouvement *</label>
          <input
            aria-describedby={describedBy("label")}
            aria-invalid={errors.label ? "true" : undefined}
            id="transaction-label"
            onChange={(event) => updateField("label", event.currentTarget.value)}
            required
            value={input.label}
          />
          <TransactionFieldError errors={errors} field="label" />
        </div>
        <div className="field-group">
          <label htmlFor="transaction-amount">Montant *</label>
          <input
            aria-describedby={describedBy("amount")}
            aria-invalid={errors.amount ? "true" : undefined}
            id="transaction-amount"
            inputMode="decimal"
            onChange={(event) => updateField("amount", event.currentTarget.value)}
            placeholder="Débit positif, crédit négatif"
            required
            value={input.amount}
          />
          <TransactionFieldError errors={errors} field="amount" />
        </div>
        <div className="field-group">
          <label htmlFor="transaction-currency">Devise *</label>
          <select
            aria-describedby={describedBy("currency")}
            aria-invalid={errors.currency ? "true" : undefined}
            id="transaction-currency"
            onChange={(event) => updateField("currency", event.currentTarget.value)}
            required
            value={input.currency}
          >
            <option value="CHF">CHF</option>
            <option value="EUR">EUR</option>
          </select>
          <TransactionFieldError errors={errors} field="currency" />
        </div>
      </div>
      {hasEntryErrors(errors) ? (
        <div className="dialog-error" role="alert">
          <p>Corrigez les champs signalés avant de confirmer le mouvement.</p>
          <ul>{Object.values(errors).filter(Boolean).map((message) => <li key={message}>{message}</li>)}</ul>
        </div>
      ) : null}
      {formError ? <p className="dialog-error" role="alert">{formError}</p> : null}
      <p className="required-note">* Champs requis.</p>
      <div className="form-actions">
        <button className="secondary-action" onClick={onCancel} type="button">Annuler</button>
        <button className="primary-action" type="submit">Confirmer le mouvement</button>
      </div>
    </form>
  );
}

function CsvPreview({ result }: { result: CsvImportResult }) {
  const warnings = [...new Set(result.warnings)];
  return (
    <div className="csv-preview">
      <div className="import-summary">
        <p><strong>{result.transactions.length}</strong> mouvements prêts</p>
        <p><strong>{result.skippedRows}</strong> lignes ignorées</p>
      </div>
      {warnings.length > 0 ? (
        <div className="warning-panel" role="status">
          <p>Avertissements</p>
          <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </div>
      ) : null}
      {result.transactions.length > 0 ? (
        <div className="table-scroll preview-table">
          <table>
            <caption>Aperçu des cinq premières lignes importables</caption>
            <thead><tr><th scope="col">Date</th><th scope="col">Libellé</th><th scope="col">Montant</th></tr></thead>
            <tbody>
              {result.transactions.slice(0, 5).map((transaction) => (
                <tr key={transaction.id}>
                  <td>{formatCalendarDate(transaction.date)}</td>
                  <td>{transaction.label}</td>
                  <td className="numeric-cell">{formatCurrency(transaction.amount, transaction.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="dialog-error">Aucune ligne valide à importer.</p>}
    </div>
  );
}

function CsvImportForm({ defaultCurrency, onCancel, onConfirm }: CsvImportFormProps) {
  const [step, setStep] = useState<"choose" | "preview">("choose");
  const [result, setResult] = useState<CsvImportResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState("");
  const [readingFile, setReadingFile] = useState(false);

  async function readCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;

    setReadingFile(true);
    setFileError("");
    try {
      const text = await readImportFile(file);
      setResult(parseTransactionCsv(text, {
        currency: defaultCurrency,
        importedAt: new Date().toISOString(),
      }));
      setFileName(file.name);
      setStep("preview");
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "Le fichier CSV n’a pas pu être lu.");
    } finally {
      setReadingFile(false);
    }
  }

  function confirmImport() {
    if (!result || result.transactions.length === 0) return;
    try {
      const mutation = onConfirm(result.transactions);
      if (!mutation.ok) setFileError(mutation.error);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "Les mouvements n’ont pas pu être importés.");
    }
  }

  return (
    <div className="entry-form">
      <ol className="import-steps" aria-label="Étapes de l’import">
        <li aria-current={step === "choose" ? "step" : undefined}>1. Choisir</li>
        <li aria-current={step === "preview" ? "step" : undefined}>2. Vérifier</li>
      </ol>

      {step === "choose" ? (
        <div className="import-choice">
          <p>Le fichier reste sur cet appareil. Aucune écriture n’a lieu à cette étape.</p>
          <label className="file-control" htmlFor="transaction-csv">Choisir un fichier CSV</label>
          <input accept=".csv,text/csv,text/plain" id="transaction-csv" onChange={readCsv} type="file" />
          {readingFile ? <p className="form-note" role="status">Lecture locale en cours…</p> : null}
        </div>
      ) : result ? (
        <div>
          <p className="confirmation-note">
            Fichier « {fileName} » analysé. Vérifiez l’aperçu avant d’écrire dans le journal.
          </p>
          <CsvPreview result={result} />
        </div>
      ) : null}

      {fileError ? <p className="dialog-error" role="alert">{fileError}</p> : null}
      <div className="form-actions">
        {step === "preview" ? (
          <button className="secondary-action" onClick={() => { setStep("choose"); setResult(null); setFileError(""); }} type="button">Changer de fichier</button>
        ) : <button className="secondary-action" onClick={onCancel} type="button">Annuler</button>}
        {step === "preview" ? (
          <button className="primary-action" disabled={!result || result.transactions.length === 0} onClick={confirmImport} type="button">
            Confirmer l’import
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function TransactionsView({
  defaultCurrency,
  onImportTransactions,
  transactions,
}: TransactionsViewProps) {
  const [filter, setFilter] = useState("");
  const [modal, setModal] = useState<"manual" | "csv" | null>(null);
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shouldFocusHeading = useRef(false);
  const normalizedFilter = filter.trim().toLocaleLowerCase("fr-CH");
  const filteredTransactions = useMemo(() => transactions.filter((transaction) => (
    normalizedFilter === ""
    || transaction.label.toLocaleLowerCase("fr-CH").includes(normalizedFilter)
    || transaction.date.includes(normalizedFilter)
    || transaction.currency.toLocaleLowerCase("fr-CH").includes(normalizedFilter)
  )), [normalizedFilter, transactions]);
  const visibleTransactions = filteredTransactions.slice(0, MAX_VISIBLE_TRANSACTIONS);

  useEffect(() => {
    if (!shouldFocusHeading.current) return;
    shouldFocusHeading.current = false;
    headingRef.current?.focus();
  }, [toast]);

  function finishMutation(message: string) {
    shouldFocusHeading.current = true;
    setModal(null);
    setToast({ id: Date.now(), message });
  }

  function addManual(transaction: Transaction) {
    const result = onImportTransactions([transaction]);
    if (!result.ok) return result;
    finishMutation("Le mouvement a été ajouté au journal.");
    return result;
  }

  function importCsv(imported: Transaction[]) {
    const result = onImportTransactions(imported);
    if (!result.ok) return result;
    finishMutation(transactionImportMessage(result.changed));
    return result;
  }

  return (
    <section className="registry-view" aria-labelledby="transactions-title">
      <header className="view-heading">
        <div>
          <p className="section-kicker">Journal des mouvements</p>
          <h1 id="transactions-title" ref={headingRef} tabIndex={-1}>Transactions</h1>
          <p>Débits et crédits consignés localement avant rapprochement.</p>
        </div>
        <div className="heading-actions">
          <button className="secondary-action" onClick={() => setModal("manual")} type="button">Ajouter un mouvement</button>
          <button className="primary-action" onClick={() => setModal("csv")} type="button">Importer un CSV</button>
        </div>
      </header>

      {toast ? <p className="mutation-toast" key={toast.id} role="status">{toast.message}</p> : null}

      <div className="registry-toolbar">
        <div className="filter-field">
          <label htmlFor="transaction-filter">Filtrer le journal</label>
          <input
            id="transaction-filter"
            onChange={(event) => setFilter(event.currentTarget.value)}
            placeholder="Libellé, date ou devise"
            type="search"
            value={filter}
          />
        </div>
        <p aria-label={filteredTransactions.length > MAX_VISIBLE_TRANSACTIONS
          ? `${visibleTransactions.length} mouvements affichés sur ${filteredTransactions.length}`
          : undefined}
        >
          {filteredTransactions.length > MAX_VISIBLE_TRANSACTIONS
            ? <><strong>{visibleTransactions.length}</strong> mouvements affichés sur {filteredTransactions.length}</>
            : <><strong>{filteredTransactions.length}</strong> sur {transactions.length} mouvements</>}
        </p>
      </div>

      {filteredTransactions.length > 0 ? (
        <div className="table-scroll transaction-register">
          <table>
            <caption className="visually-hidden">Mouvements enregistrés</caption>
            <thead><tr><th scope="col">Date</th><th scope="col">Libellé</th><th scope="col">Origine</th><th scope="col">Montant</th></tr></thead>
            <tbody>
              {visibleTransactions.map((transaction) => {
                const origin = transactionOrigin(transaction);
                return (
                <tr key={transaction.id}>
                  <td><time dateTime={transaction.date}>{formatCalendarDate(transaction.date)}</time></td>
                  <th scope="row">{transaction.label}</th>
                  <td><span className={`origin-label ${origin.className}`}>{origin.label}</span></td>
                  <td className={transaction.amount < 0 ? "numeric-cell credit-amount" : "numeric-cell"}>
                    {formatCurrency(transaction.amount, transaction.currency)}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-register">
          <p className="section-kicker">Aucune ligne</p>
          <h2>{transactions.length === 0 ? "Le journal est vide" : "Aucun mouvement ne correspond"}</h2>
          <p>{transactions.length === 0 ? "Ajoutez un mouvement ou importez un relevé CSV." : "Modifiez le filtre pour retrouver un autre mouvement."}</p>
        </div>
      )}

      {modal === "manual" ? (
        <Modal onClose={() => setModal(null)} title="Ajouter un mouvement">
          <ManualTransactionForm defaultCurrency={defaultCurrency} onCancel={() => setModal(null)} onConfirm={addManual} />
        </Modal>
      ) : null}
      {modal === "csv" ? (
        <Modal onClose={() => setModal(null)} title="Importer un relevé CSV">
          <CsvImportForm defaultCurrency={defaultCurrency} onCancel={() => setModal(null)} onConfirm={importCsv} />
        </Modal>
      ) : null}
    </section>
  );
}
