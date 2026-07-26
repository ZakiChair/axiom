import type { Contract, Transaction } from "./model";

const LEGAL_FORMS = /(?:\s+(?:sa|sarl|sas|sasu|ag|gmbh|ltd|llc|inc|s\s+a))+$/;

export function normalizeMerchant(value: string): string {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-CH")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  return normalized.replace(LEGAL_FORMS, "").trim();
}

export function matchContract(transaction: Transaction, contracts: Contract[]): string | undefined {
  const label = normalizeMerchant(transaction.label);
  let matchingContractId: string | undefined;
  let longestAlias = 0;

  for (const contract of contracts) {
    for (const alias of contract.merchantAliases) {
      const normalizedAlias = normalizeMerchant(alias);

      if (normalizedAlias.length > longestAlias && label.includes(normalizedAlias)) {
        matchingContractId = contract.id;
        longestAlias = normalizedAlias.length;
      }
    }
  }

  return matchingContractId;
}
