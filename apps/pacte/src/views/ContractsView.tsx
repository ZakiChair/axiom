import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";

import { Modal } from "../components/Modal";
import {
  buildContractEntry,
  validateContractEntry,
} from "../domain/entries";
import type { ContractEntryInput, EntryErrors } from "../domain/entries";
import { extractContractHints } from "../domain/importers";
import type { Contract, Currency } from "../domain/model";
import { readImportFile } from "../infra/files";

type ContractsViewProps = {
  contracts: Contract[];
  defaultCurrency: Currency;
  onAddContract: (contract: Contract) => void;
  onRemoveContract: (contractId: string) => void;
};

type ContractFormProps = {
  defaultCurrency: Currency;
  onCancel: () => void;
  onConfirm: (contract: Contract) => void;
};

const CADENCE_LABELS: Record<Contract["cadence"], string> = {
  monthly: "Mensuelle",
  quarterly: "Trimestrielle",
  annual: "Annuelle",
  "one-off": "Ponctuelle",
};

const STATUS_LABELS: Record<Contract["status"], string> = {
  active: "Actif",
  paused: "En pause",
  terminated: "Résilié",
};

function createContractInput(defaultCurrency: Currency): ContractEntryInput {
  return {
    provider: "",
    amount: "",
    currency: defaultCurrency,
    cadence: "monthly",
    startDate: "",
    category: "",
    reference: "",
    nextRenewalDate: "",
    noticeDays: "0",
    status: "active",
    merchantAliases: "",
    notes: "",
    sourceText: "",
  };
}

function localId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `${prefix}-${random}`;
}

function formatAmount(amount: number, currency: Currency): string {
  return new Intl.NumberFormat("fr-CH", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("fr-CH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function errorId(field: keyof ContractEntryInput): string {
  return `contract-${field}-error`;
}

function FieldError({
  errors,
  field,
}: {
  errors: EntryErrors<ContractEntryInput>;
  field: keyof ContractEntryInput;
}) {
  const message = errors[field];
  return message ? <span className="field-error" id={errorId(field)}>{message}</span> : null;
}

function ContractForm({ defaultCurrency, onCancel, onConfirm }: ContractFormProps) {
  const [input, setInput] = useState(() => createContractInput(defaultCurrency));
  const [errors, setErrors] = useState<EntryErrors<ContractEntryInput>>({});
  const [formError, setFormError] = useState("");
  const [fileMessage, setFileMessage] = useState("");
  const [readingFile, setReadingFile] = useState(false);

  function updateField(field: keyof ContractEntryInput, value: string) {
    setInput((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setFormError("");
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;

    setReadingFile(true);
    setFormError("");
    setFileMessage("");
    try {
      const text = await readImportFile(file);
      const hints = extractContractHints(text);
      setInput((current) => ({
        ...current,
        ...(hints.amount === undefined ? {} : { amount: String(hints.amount) }),
        ...(hints.currency === undefined ? {} : { currency: hints.currency }),
        ...(hints.noticeDays === undefined ? {} : { noticeDays: String(hints.noticeDays) }),
        sourceText: text,
      }));
      setFileMessage(
        "Indices extraits. Vérifiez chaque champ : le contrat ne sera ajouté qu’après votre confirmation.",
      );
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Le fichier n’a pas pu être lu.");
    } finally {
      setReadingFile(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateContractEntry(input);
    setErrors(nextErrors);
    setFormError("");
    if (Object.keys(nextErrors).length > 0) return;

    try {
      onConfirm(buildContractEntry(input, localId("contract")));
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Le contrat n’a pas pu être ajouté.");
    }
  }

  const describedBy = (field: keyof ContractEntryInput) => (
    errors[field] ? errorId(field) : undefined
  );

  return (
    <form className="entry-form" noValidate onSubmit={submit}>
      <fieldset className="import-fieldset">
        <legend>Préremplir depuis un document</legend>
        <p>
          Texte ou PDF, lu localement. L’extraction PDF reste indicative et demande une vérification humaine.
        </p>
        <label className="file-control" htmlFor="contract-file">Choisir un document</label>
        <input
          accept=".txt,.pdf,text/plain,application/pdf"
          id="contract-file"
          onChange={handleFile}
          type="file"
        />
        {readingFile ? <p className="form-note" role="status">Lecture locale en cours…</p> : null}
        {fileMessage ? <p className="confirmation-note" role="status">{fileMessage}</p> : null}
      </fieldset>

      <div className="form-grid">
        <div className="field-group field-wide">
          <label htmlFor="contract-provider">Fournisseur *</label>
          <input
            aria-describedby={describedBy("provider")}
            aria-invalid={errors.provider ? "true" : undefined}
            id="contract-provider"
            onChange={(event) => updateField("provider", event.currentTarget.value)}
            required
            value={input.provider}
          />
          <FieldError errors={errors} field="provider" />
        </div>

        <div className="field-group">
          <label htmlFor="contract-amount">Montant *</label>
          <input
            aria-describedby={describedBy("amount")}
            aria-invalid={errors.amount ? "true" : undefined}
            id="contract-amount"
            inputMode="decimal"
            onChange={(event) => updateField("amount", event.currentTarget.value)}
            placeholder="89,90"
            required
            value={input.amount}
          />
          <FieldError errors={errors} field="amount" />
        </div>

        <div className="field-group">
          <label htmlFor="contract-currency">Devise *</label>
          <select
            aria-describedby={describedBy("currency")}
            aria-invalid={errors.currency ? "true" : undefined}
            id="contract-currency"
            onChange={(event) => updateField("currency", event.currentTarget.value)}
            required
            value={input.currency}
          >
            <option value="CHF">CHF</option>
            <option value="EUR">EUR</option>
          </select>
          <FieldError errors={errors} field="currency" />
        </div>

        <div className="field-group">
          <label htmlFor="contract-cadence">Cadence *</label>
          <select
            aria-describedby={describedBy("cadence")}
            aria-invalid={errors.cadence ? "true" : undefined}
            id="contract-cadence"
            onChange={(event) => updateField("cadence", event.currentTarget.value)}
            required
            value={input.cadence}
          >
            <option value="monthly">Mensuelle</option>
            <option value="quarterly">Trimestrielle</option>
            <option value="annual">Annuelle</option>
            <option value="one-off">Ponctuelle</option>
          </select>
          <FieldError errors={errors} field="cadence" />
        </div>

        <div className="field-group">
          <label htmlFor="contract-startDate">Début *</label>
          <input
            aria-describedby={describedBy("startDate")}
            aria-invalid={errors.startDate ? "true" : undefined}
            id="contract-startDate"
            onChange={(event) => updateField("startDate", event.currentTarget.value)}
            required
            type="date"
            value={input.startDate}
          />
          <FieldError errors={errors} field="startDate" />
        </div>

        <div className="field-group">
          <label htmlFor="contract-category">Catégorie</label>
          <input id="contract-category" onChange={(event) => updateField("category", event.currentTarget.value)} value={input.category} />
        </div>

        <div className="field-group">
          <label htmlFor="contract-reference">Référence</label>
          <input id="contract-reference" onChange={(event) => updateField("reference", event.currentTarget.value)} value={input.reference} />
        </div>

        <div className="field-group">
          <label htmlFor="contract-nextRenewalDate">Prochain renouvellement</label>
          <input
            aria-describedby={describedBy("nextRenewalDate")}
            aria-invalid={errors.nextRenewalDate ? "true" : undefined}
            id="contract-nextRenewalDate"
            onChange={(event) => updateField("nextRenewalDate", event.currentTarget.value)}
            type="date"
            value={input.nextRenewalDate}
          />
          <FieldError errors={errors} field="nextRenewalDate" />
        </div>

        <div className="field-group">
          <label htmlFor="contract-noticeDays">Préavis (jours)</label>
          <input
            aria-describedby={describedBy("noticeDays")}
            aria-invalid={errors.noticeDays ? "true" : undefined}
            id="contract-noticeDays"
            min="0"
            onChange={(event) => updateField("noticeDays", event.currentTarget.value)}
            step="1"
            type="number"
            value={input.noticeDays}
          />
          <FieldError errors={errors} field="noticeDays" />
        </div>

        <div className="field-group">
          <label htmlFor="contract-status">Statut</label>
          <select
            aria-describedby={describedBy("status")}
            aria-invalid={errors.status ? "true" : undefined}
            id="contract-status"
            onChange={(event) => updateField("status", event.currentTarget.value)}
            value={input.status}
          >
            <option value="active">Actif</option>
            <option value="paused">En pause</option>
            <option value="terminated">Résilié</option>
          </select>
          <FieldError errors={errors} field="status" />
        </div>

        <div className="field-group field-wide">
          <label htmlFor="contract-merchantAliases">Alias marchand</label>
          <textarea
            id="contract-merchantAliases"
            onChange={(event) => updateField("merchantAliases", event.currentTarget.value)}
            placeholder="Un alias par ligne ou séparé par une virgule"
            rows={2}
            value={input.merchantAliases}
          />
        </div>

        <div className="field-group field-wide">
          <label htmlFor="contract-notes">Notes</label>
          <textarea id="contract-notes" onChange={(event) => updateField("notes", event.currentTarget.value)} rows={3} value={input.notes} />
        </div>

        {input.sourceText ? (
          <div className="field-group field-wide">
            <label htmlFor="contract-sourceText">Texte importé à vérifier</label>
            <textarea
              id="contract-sourceText"
              onChange={(event) => updateField("sourceText", event.currentTarget.value)}
              rows={5}
              value={input.sourceText}
            />
          </div>
        ) : null}
      </div>

      {formError ? <p className="dialog-error" id="contract-form-error" role="alert">{formError}</p> : null}
      <p className="required-note">* Champs requis. Vérifiez les informations avant de confirmer.</p>
      <div className="form-actions">
        <button className="secondary-action" onClick={onCancel} type="button">Annuler</button>
        <button className="primary-action" type="submit">Confirmer le contrat</button>
      </div>
    </form>
  );
}

function ContractCard({ contract, onRemove }: { contract: Contract; onRemove: (contract: Contract) => void }) {
  return (
    <li className="registry-card">
      <div className="registry-card-heading">
        <div>
          <p className="record-reference">{contract.reference || "Sans référence"}</p>
          <h2>{contract.provider}</h2>
        </div>
        <span className={`status-label status-${contract.status}`}>{STATUS_LABELS[contract.status]}</span>
      </div>
      <p className="record-amount">
        {formatAmount(contract.amount, contract.currency)} · {CADENCE_LABELS[contract.cadence]}
      </p>
      <details>
        <summary>Voir les clauses</summary>
        <dl className="clause-grid">
          <div><dt>Début</dt><dd>{formatDate(contract.startDate)}</dd></div>
          <div><dt>Préavis</dt><dd>{contract.noticeDays} jours</dd></div>
          <div><dt>Renouvellement</dt><dd>{contract.nextRenewalDate ? formatDate(contract.nextRenewalDate) : "Non renseigné"}</dd></div>
          <div><dt>Catégorie</dt><dd>{contract.category || "Non renseignée"}</dd></div>
          <div className="clause-wide"><dt>Alias marchand</dt><dd>{contract.merchantAliases.length > 0 ? contract.merchantAliases.join(" · ") : "Aucun alias"}</dd></div>
          {contract.notes ? <div className="clause-wide"><dt>Notes</dt><dd>{contract.notes}</dd></div> : null}
        </dl>
      </details>
      <button className="danger-action" onClick={() => onRemove(contract)} type="button">
        Retirer du registre
      </button>
    </li>
  );
}

export function ContractsView({
  contracts,
  defaultCurrency,
  onAddContract,
  onRemoveContract,
}: ContractsViewProps) {
  const [filter, setFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shouldFocusHeading = useRef(false);
  const normalizedFilter = filter.trim().toLocaleLowerCase("fr-CH");
  const filteredContracts = useMemo(() => contracts.filter((contract) => (
    normalizedFilter === ""
    || [contract.provider, contract.reference, contract.category, ...contract.merchantAliases]
      .some((value) => value.toLocaleLowerCase("fr-CH").includes(normalizedFilter))
  )), [contracts, normalizedFilter]);

  useEffect(() => {
    if (!shouldFocusHeading.current) return;
    shouldFocusHeading.current = false;
    headingRef.current?.focus();
  }, [toast]);

  function addContract(contract: Contract) {
    onAddContract(contract);
    shouldFocusHeading.current = true;
    setModalOpen(false);
    setToast({ id: Date.now(), message: `${contract.provider} a été ajouté au registre.` });
  }

  function removeContract(contract: Contract) {
    if (!globalThis.confirm(`Retirer ${contract.provider} du registre ?`)) return;
    try {
      onRemoveContract(contract.id);
      shouldFocusHeading.current = true;
      setToast({ id: Date.now(), message: `${contract.provider} a été retiré du registre.` });
    } catch (error) {
      setToast({
        id: Date.now(),
        message: error instanceof Error ? error.message : "Le contrat n’a pas pu être retiré.",
      });
    }
  }

  return (
    <section className="registry-view" aria-labelledby="contracts-title">
      <header className="view-heading">
        <div>
          <p className="section-kicker">Registre des engagements</p>
          <h1 id="contracts-title" ref={headingRef} tabIndex={-1}>Contrats</h1>
          <p>Clauses, échéances et libellés marchands réunis dans le coffre local.</p>
        </div>
        <button className="primary-action" onClick={() => setModalOpen(true)} type="button">Nouveau contrat</button>
      </header>

      {toast ? <p className="mutation-toast" key={toast.id} role="status">{toast.message}</p> : null}

      <div className="registry-toolbar">
        <div className="filter-field">
          <label htmlFor="contract-filter">Filtrer le registre</label>
          <input
            id="contract-filter"
            onChange={(event) => setFilter(event.currentTarget.value)}
            placeholder="Fournisseur, référence, catégorie ou alias"
            type="search"
            value={filter}
          />
        </div>
        <p><strong>{filteredContracts.length}</strong> sur {contracts.length} contrats</p>
      </div>

      {filteredContracts.length > 0 ? (
        <ul className="registry-grid">
          {filteredContracts.map((contract) => (
            <ContractCard contract={contract} key={contract.id} onRemove={removeContract} />
          ))}
        </ul>
      ) : (
        <div className="empty-register">
          <p className="section-kicker">Aucune fiche</p>
          <h2>{contracts.length === 0 ? "Le registre est vide" : "Aucun contrat ne correspond"}</h2>
          <p>{contracts.length === 0 ? "Ajoutez votre premier engagement pour commencer le contrôle." : "Modifiez le filtre pour retrouver une autre fiche."}</p>
        </div>
      )}

      {modalOpen ? (
        <Modal onClose={() => setModalOpen(false)} title="Nouveau contrat">
          <ContractForm defaultCurrency={defaultCurrency} onCancel={() => setModalOpen(false)} onConfirm={addContract} />
        </Modal>
      ) : null}
    </section>
  );
}
