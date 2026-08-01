/**
 * Signature d'un run de backtest — ce qui permet de dire si le résultat affiché décrit
 * encore la configuration à l'écran (lot C3).
 *
 * Aucun setter du builder n'effaçait `resultat` : après un run, on pouvait changer le
 * symbole, le pas de temps, la plage, les règles, les frais et le capital — les neuf
 * tuiles, la courbe d'équité, le Monte-Carlo et la table des trades continuaient
 * d'afficher le run PRÉCÉDENT, sans aucune marque d'obsolescence. La seule trace des
 * vrais paramètres était une note de 10 px qui ne couvrait ni les règles ni les frais
 * (revue du 2026-08-01 § 6.3).
 *
 * On compare une signature plutôt que d'invalider dans chaque setter : un setter oublié
 * (il y en a quatorze) rouvrirait le trou en silence.
 */
import type { Condition, Direction } from "@axiom/backtest";
import type { Timeframe } from "@axiom/types";

/** Plages du builder (déclarée dans store/backtest.ts ; ré-exprimée ici pour éviter un cycle). */
type PlageId = "3m" | "6m" | "1a" | "2a";

/** Tout ce qui change le résultat d'un run. */
export interface ConfigRun {
  symbol: string;
  tf: Timeframe;
  plage: PlageId;
  direction: Direction;
  tailleFixe: number;
  stopPct: number | null;
  targetPct: number | null;
  fraisPct: number;
  slippagePct: number;
  capitalInitial: number;
  reglesEntree: Condition[];
  reglesSortie: Condition[];
}

/**
 * Signature stable et comparable d'une configuration. `JSON.stringify` suffit ici : les
 * champs sont sérialisables, l'ordre des clés est fixé par la construction de l'objet, et
 * le terminal est mono-utilisateur. PURE.
 */
export function signatureRun(c: ConfigRun): string {
  return JSON.stringify([
    c.symbol.toUpperCase(),
    c.tf,
    c.plage,
    c.direction,
    c.tailleFixe,
    c.stopPct,
    c.targetPct,
    c.fraisPct,
    c.slippagePct,
    c.capitalInitial,
    c.reglesEntree,
    c.reglesSortie,
  ]);
}

/**
 * Le résultat affiché est-il PÉRIMÉ ? Vrai seulement s'il existe un run ET que la
 * configuration a changé depuis. PURE.
 */
export function runPerime(signatureAffichee: string | null, courante: ConfigRun): boolean {
  if (signatureAffichee === null) return false;
  return signatureAffichee !== signatureRun(courante);
}

/**
 * Résumé lisible d'un run, pour l'en-tête des résultats : « BTCUSDT · 1h · 6 mois ·
 * 42 trades ». La note existante ne disait que « N bougies · SYMBOLE TF ». PURE.
 */
export function resumeRun(c: ConfigRun, nbTrades: number, libellePlage: string): string {
  const trades = nbTrades === 1 ? "1 trade" : `${nbTrades} trades`;
  return `${c.symbol.toUpperCase()} · ${c.tf} · ${libellePlage} · ${trades}`;
}
