import type {
  Anomaly,
  AnomalyEvidence,
  ClaimCase,
  Contract,
  PacteState,
  Transaction,
} from "./model";
import { matchContract } from "./normalize";

function copyContract(contract: Contract): Contract {
  return {
    ...contract,
    expectedRefund: contract.expectedRefund ? { ...contract.expectedRefund } : undefined,
    merchantAliases: [...contract.merchantAliases],
  };
}

function copyEvidence(evidence: AnomalyEvidence): AnomalyEvidence {
  return { ...evidence };
}

function contractIdForTransaction(
  transaction: Transaction,
  state: PacteState,
): string | undefined {
  return transaction.contractId ?? matchContract(transaction, state.contracts);
}

function findContract(anomaly: Anomaly, state: PacteState): Contract {
  const direct = anomaly.contractId
    ? state.contracts.find((contract) => contract.id === anomaly.contractId)
    : undefined;
  if (direct) return direct;

  const transaction = state.transactions.find((candidate) =>
    anomaly.transactionIds.includes(candidate.id),
  );
  const contractId = transaction ? contractIdForTransaction(transaction, state) : undefined;
  const inferred = contractId
    ? state.contracts.find((contract) => contract.id === contractId)
    : undefined;

  if (!inferred) {
    throw new Error(`Contrat introuvable pour l’anomalie ${anomaly.id}.`);
  }

  return inferred;
}

function formatAmount(amount: number, currency: Contract["currency"]): string {
  return `${amount.toLocaleString("fr-CH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).replace(".", ",")} ${currency}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("fr-CH", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function requestedAmount(claim: ClaimCase): number {
  const firstAmount = Math.abs(claim.evidence[0]?.amount ?? 0);

  if (claim.anomalyId.includes(":price-increase:")) {
    return Math.max(0, firstAmount - claim.contractSnapshot.amount);
  }

  return firstAmount;
}

export function createClaimCase(
  anomaly: Anomaly,
  state: PacteState,
  now: Date,
): ClaimCase {
  const contract = copyContract(findContract(anomaly, state));
  const createdAt = now.toISOString();
  const claim: ClaimCase = {
    id: `case:${anomaly.id}`,
    anomalyId: anomaly.id,
    status: "review",
    createdAt,
    contractSnapshot: contract,
    evidence: anomaly.evidence.map(copyEvidence),
    timeline: [
      {
        at: createdAt,
        status: "review",
        note: `Dossier créé depuis le contrôle « ${anomaly.title} ».`,
      },
    ],
    note: `${anomaly.title}\n${anomaly.explanation}`,
    letter: "",
  };

  claim.letter = generateClaimLetter(claim, state.household);
  return claim;
}

export function generateClaimLetter(
  claim: ClaimCase,
  household: PacteState["household"],
): string {
  const contract = claim.contractSnapshot;
  const amount = requestedAmount(claim);
  const evidenceLines = claim.evidence.length > 0
    ? claim.evidence.map(
      (evidence) =>
        `- Le ${formatDate(evidence.date)} : ${evidence.label} — ${formatAmount(Math.abs(evidence.amount), evidence.currency)}.`,
    )
    : ["- Aucun justificatif transactionnel n’est encore listé dans ce dossier."];
  const attachmentLines = claim.evidence.length > 0
    ? claim.evidence.map(
      (evidence) => `- Justificatif du ${formatDate(evidence.date)} : ${evidence.label}.`,
    )
    : ["- Documents utiles relatifs au contrat et à l’opération examinée."];

  return [
    household.name,
    "",
    `À l’attention de ${contract.provider}`,
    `Référence du contrat : ${contract.reference}`,
    "",
    `Objet : demande de vérification — dossier ${claim.id}`,
    "",
    "Madame, Monsieur,",
    "",
    `Je vous contacte au sujet du contrat référencé ${contract.reference}. Les éléments suivants ont été relevés :`,
    ...evidenceLines,
    "",
    "Demande chiffrée",
    `Je vous demande de vérifier ces éléments et, si une erreur est confirmée, de rembourser le montant concerné de ${formatAmount(amount, contract.currency)}.`,
    "",
    "Pièces à joindre",
    ...attachmentLines,
    "",
    "Je souhaite recevoir votre réponse dans un délai de 14 jours à compter de l’envoi de cette lettre.",
    "",
    "Je vous remercie de votre examen et vous adresse mes salutations distinguées.",
    "",
    household.name,
    "",
    "Avertissement : Vérifiez les dates, montants et pièces avant tout envoi. Ce modèle décrit uniquement les faits enregistrés dans PACTE.",
  ].join("\n");
}
