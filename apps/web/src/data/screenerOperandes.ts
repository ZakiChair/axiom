/**
 * EQS — catalogue des opérandes des règles du screener (fenêtre EQS seulement).
 *
 * Réutilise le catalogue curé du backtest (CATALOGUE_OPERANDES, store/backtest.ts) au lieu
 * d'ouvrir les 219 définitions du registre, dont beaucoup n'ont pas de sortie scalaire.
 * Retire ce que le screener ne peut pas servir à l'identique du graphe : définitions à
 * série auxiliaire (AXIS lit refClose) et amorces au-delà d'une requête Binance
 * (AXIS : 1500 bougies). Ajoute le squeeze TTM et la compression NR / Inside, dont les
 * TRANSITIONS donnent les évènements (sortie de squeeze = `on` croise 0,5 vers le bas).
 *
 * Chargé avec la fenêtre EQS (React.lazy) : store/backtest reste hors du chemin initial.
 */
import type { Operande } from "@axiom/backtest";
import { getIndicator } from "@axiom/indicators";
import { CATALOGUE_OPERANDES, type OperandeSpec } from "../store/backtest";
import { LIMITE_KLINES_BINANCE } from "./screenerRegles";

/** Opérandes propres au screener (évènements de volatilité). */
const OPERANDES_EVENEMENTS: OperandeSpec[] = [
  {
    id: "ttmSqueeze:on",
    label: "TTM Squeeze actif (1 / 0)",
    categorie: "indicateur",
    paramKey: "length",
    defaultParam: 20,
    make: (p) => ({
      type: "indicateur",
      indicateurId: "ttmSqueeze",
      params: { length: p ?? 20, multBB: 2, multKC: 1.5 },
      output: "on",
    }),
  },
  {
    id: "narrowRange:nr",
    label: "NR, plus petite amplitude (1 / 0)",
    categorie: "indicateur",
    paramKey: "length",
    defaultParam: 7,
    make: (p) => ({ type: "indicateur", indicateurId: "narrowRange", params: { length: p ?? 7 }, output: "nr" }),
  },
  {
    id: "narrowRange:inside",
    label: "Inside bar (1 / 0)",
    categorie: "indicateur",
    make: () => ({ type: "indicateur", indicateurId: "narrowRange", params: { length: 7 }, output: "inside" }),
  },
];

/** true si l'opérande produit par la spec est servi par le screener. */
function accepte(spec: OperandeSpec): boolean {
  const op = spec.make(spec.defaultParam);
  if (op.type !== "indicateur") return true;
  const def = getIndicator(op.indicateurId);
  if (def === undefined) return false;
  if ((def.aux?.length ?? 0) > 0 || (def.auxFacultatives?.length ?? 0) > 0) return false;
  return (def.amorceBougies ?? 0) <= LIMITE_KLINES_BINANCE;
}

/**
 * Libellé honnête dans le screener : le RVOL saisonnier H1 demande 84 jours d'historique
 * (2016 bougies 1h), au-delà d'une requête Binance ; le screener n'en lit qu'environ
 * 41 jours (999 bougies closes), et le run l'annonce par la note « amorce plafonnée ».
 */
function libelleScreener(spec: OperandeSpec): OperandeSpec {
  if (spec.id !== "rvolSeasonal:rvol") return spec;
  const jours = Math.floor((LIMITE_KLINES_BINANCE - 1) / 24);
  return { ...spec, label: `${spec.label} · ≈ ${jours} j lus` };
}

/** Catalogue des opérandes proposés dans les règles du screener. */
export const OPERANDES_SCREENER: OperandeSpec[] = [
  ...CATALOGUE_OPERANDES.filter(accepte).map(libelleScreener),
  ...OPERANDES_EVENEMENTS,
];

/** Résout une spec d'opérande du screener par son id. */
export function specOperandeScreener(id: string): OperandeSpec | undefined {
  return OPERANDES_SCREENER.find((s) => s.id === id);
}

/** Spec et paramètre d'un opérande (pour re-remplir les contrôles d'une règle). */
export function decrireOperandeScreener(op: Operande): { specId: string; param?: number } {
  if (op.type === "prix") return { specId: `prix:${op.champ}` };
  if (op.type === "constante") return { specId: "constante" };
  const specId = `${op.indicateurId}:${op.output}`;
  const spec = specOperandeScreener(specId);
  if (spec?.paramKey !== undefined) {
    const v = Number(op.params[spec.paramKey]);
    return { specId, param: Number.isFinite(v) ? v : undefined };
  }
  return { specId };
}
