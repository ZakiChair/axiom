/**
 * @axiom/alerts — libelles.ts
 *
 * Libellé d'une alerte : ce que lisent la liste, l'avis à l'écran, le journal, la notification du
 * bureau et les relais du daemon (macOS, Telegram). PUR.
 *
 * CONVENTION : `def.message` et le libellé ne portent JAMAIS le symbole ni l'unité de temps de
 * l'alerte. C'est l'hôte qui les ajoute (avis du web « SYMBOLE UNITÉ — libellé », titre du daemon
 * « AXIOM — SYMBOLE »). Une alerte créée ailleurs avec un message suit la même règle. Seule
 * exception apparente : le statut de mesure d'AXIS cite l'unité de la MESURE (« test 4h »,
 * « 1h : test échoué »), tel que le graphe l'écrit.
 *
 * AXIS et AXIS S/R : le libellé dit ce qui est mesuré, sans jamais dire mieux que l'infobulle du
 * graphe. La mention vient juste après le nom, avant l'évènement, pour rester lue là où le texte
 * est coupé. Seule la sortie `etat` porte le statut des campagnes (`statutAxis`, le même que sur
 * le graphe) ; toute autre sortie, réactions sur zone forte et pré-signal compris, est « non mesuré ».
 */
import { getIndicator, REGIME_TESTE, resolveParams, statutAxis } from "@axiom/indicators";
import { comparer } from "./comparer";
import { decrireCondition } from "./describe";
import type { AlertDef, Condition } from "./types";

/** Indicateurs dont les alertes portent une mention de mesure. */
const AXIS = new Set(["stratAxis", "stratAxisSr"]);
const NON_MESURE = "non mesuré";
/**
 * Sorties 0/1 d'AXIS S/R nommées quand l'alerte suit leur évènement (passage à 1). Toutes non
 * mesurées. `preAchat` (alertes A2) : le niveau du pré-signal est tracé sur le graphe, pas écrit ici.
 */
const EVENEMENTS: Readonly<Record<string, string>> = {
  reactionSupport: "réaction sur support fort",
  reactionResistance: "réaction sur résistance forte",
  preAchat: "pré-signal d'achat (niveau sur le graphe)",
};

type CondIndicateur = Extract<Condition, { type: "indicateur-seuil" | "indicateur-croisement" }>;

/** Nom d'une sortie au registre ; sa clé si le registre ne la connaît pas. */
function nomSortie(c: CondIndicateur, cle: string): string {
  return getIndicator(c.indicateurId)?.outputs.find((o) => o.key === cle)?.name ?? cle;
}

/**
 * Statut de mesure d'un signal confirmé (sortie `etat`) : celui de l'infobulle du graphe. Sans
 * unité (def héritée, évaluée sur l'unité affichée quelle qu'elle soit) : « non mesuré hors 4h ».
 * Réglages lus comme le calcul les lit (absent = défaut) ; « hors test » suit la règle du graphe :
 * stop suiveur, filtre ADX, régime hors de 0 et de la valeur testée, marge S/R d'AXIS S/R.
 */
function statutEtat(c: CondIndicateur, unite: AlertDef["timeframe"]): string {
  if (unite === undefined) return `${NON_MESURE} hors 4h`;
  const idef = getIndicator(c.indicateurId);
  const p = idef ? resolveParams(idef, c.params) : c.params;
  const regime = Number(p.regimeBtc ?? 0);
  const horsTest =
    Number(p.stopAtr ?? 0) > 0 ||
    Number(p.adxEntree ?? 0) > 0 ||
    (regime > 0 && regime !== REGIME_TESTE) ||
    (c.indicateurId === "stratAxisSr" && Number(p.margeResistanceAtr ?? 0) > 0);
  return statutAxis(unite, p.filtreFlux === true, horsTest);
}

function libelleAxis(c: CondIndicateur, unite: AlertDef["timeframe"]): string {
  const nom = getIndicator(c.indicateurId)?.name ?? c.indicateurId;
  if (c.type === "indicateur-croisement") {
    const verbe = c.sens === "hausse" ? "croise à la hausse" : c.sens === "baisse" ? "croise à la baisse" : "croise";
    return `${nom} ${NON_MESURE} · ${nomSortie(c, c.outputA)} ${verbe} ${nomSortie(c, c.outputB)}`;
  }
  // « Évènement » : vraie pour 1, fausse pour 0 (la sortie passe à 1) ; « inverse » : le contraire.
  const pour1 = comparer(1, c.comparateur, c.valeur);
  const pour0 = comparer(0, c.comparateur, c.valeur);
  const brut = `${nomSortie(c, c.output)} ${c.comparateur} ${c.valeur}`;
  if (c.output === "etat") {
    const suite = pour1 && !pour0 ? "signal d'achat" : pour0 && !pour1 ? "signal de vente" : brut;
    return `${nom} ${statutEtat(c, unite)} · ${suite}`;
  }
  const evenement = pour1 && !pour0 ? EVENEMENTS[c.output] : undefined;
  return `${nom} ${NON_MESURE} · ${evenement ?? brut}`;
}

function libelleCondition(c: Condition, unite: AlertDef["timeframe"]): string {
  if (c.type === "composite") return c.conditions.map((sous) => libelleCondition(sous, unite)).join(" ET ");
  if ((c.type === "indicateur-seuil" || c.type === "indicateur-croisement") && AXIS.has(c.indicateurId)) {
    return libelleAxis(c, unite);
  }
  return decrireCondition(c);
}

/**
 * Libellé d'une alerte : son message s'il existe, sinon celui de sa condition. Ni symbole ni
 * unité (voir la convention en tête). Hors AXIS et AXIS S/R : exactement `decrireCondition`.
 */
export function decrireAlerte(def: Pick<AlertDef, "condition"> & Partial<Pick<AlertDef, "timeframe" | "message">>): string {
  return def.message ?? libelleCondition(def.condition, def.timeframe);
}
