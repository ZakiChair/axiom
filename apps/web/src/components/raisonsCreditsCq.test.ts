/**
 * CONTRAT des raisons du statut `credits` (spec §13) entre le client CryptoQuant et les deux vues
 * qui les reconnaissent.
 *
 * DES (`FluxTakersSection.tsx`) et CHAIN (`onchain/MineursCotes.tsx`) doivent distinguer le refus
 * du fournisseur (402, raison FIXE) du plafond local (raison VARIABLE, elle porte la somme
 * consommée) pour choisir leur en-tête. Elles ne peuvent pas importer la VALEUR du client : il
 * reste un chunk chargé à la demande (`chunkCryptoquant.test.ts`). Elles RECOPIENT donc le
 * littéral du 402 ; ce test, seul endroit à importer les deux côtés — les fichiers de test ne sont
 * pas bundlés, le garde-fou de chunk les exclut —, refuse toute dérive entre les textes.
 */
import { describe, expect, it } from "vitest";
import { raisonBudgetCreditsCq, RAISON_CREDITS_EPUISES_CQ } from "../data/onchain/cryptoquant";
import { RAISON_CREDITS_EPUISES_CQ as RAISON_DES } from "./FluxTakersSection";
import { RAISON_CREDITS_EPUISES_CQ as RAISON_CHAIN } from "./onchain/MineursCotes";

/** Texte de la spec §13, recopié depuis l'autorité (ni du client, ni des vues). */
const TEXTE_SPEC =
  "Crédits mensuels CryptoQuant épuisés (402) : plus d'appel avant la remise à zéro mensuelle ; archive affichée.";

describe("raisons du statut credits : littéraux des vues et exports du client", () => {
  it("le 402 porte le même texte dans le client, DES, CHAIN et la spec", () => {
    expect(RAISON_CREDITS_EPUISES_CQ).toBe(TEXTE_SPEC);
    expect(RAISON_DES).toBe(RAISON_CREDITS_EPUISES_CQ);
    expect(RAISON_CHAIN).toBe(RAISON_CREDITS_EPUISES_CQ);
  });

  it("la raison du plafond est reconnaissable « par défaut » : jamais égale à celle du 402", () => {
    expect(raisonBudgetCreditsCq(8_990)).toBe(
      "Budget de crédits CryptoQuant atteint (≈ 8990/10 000 sur 31 j, ce navigateur) : appels suspendus pour préserver le mois ; archive affichée.",
    );
    for (const somme of [0, 8_990, 9_000]) expect(raisonBudgetCreditsCq(somme)).not.toBe(RAISON_CREDITS_EPUISES_CQ);
  });
});
