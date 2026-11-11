/**
 * Sélecteur de l'unité de calcul d'une instance (SUG-1, phase 1 : graphe seul).
 *
 * Rendu par l'éditeur de paramètres (chargé avec le menu Indicateurs, hors chemin initial).
 * Ne propose que les unités admises pour la définition sur le graphe affiché
 * (`unitesProposees`) ; une unité déjà posée mais refusée ici (autre graphe, autre place)
 * reste visible avec son motif, jamais effacée en silence. « Graphe » retire la clé.
 */
import { useStore } from "zustand";
import type { IndicatorDef } from "@axiom/types";
import { marketStore } from "../store/market";
import { Select } from "../components/ui";
import type { ContexteIndicateur } from "../lib/indicatorUsability";
import { CLE_UNITE, uniteDemandee } from "./uniteParam";
import { DUREE_UNITE, defAdmiseUnite, raisonUniteRefusee, unitesProposees } from "./uniteSuperieure";

type Params = Record<string, number | boolean | string>;

/** Moyennes mobiles : sur données synthétiques, presque redondantes avec une période ×N. */
const MOYENNES_MOBILES: ReadonlySet<string> = new Set([
  "sma", "ema", "wma", "dema", "tema", "hma", "smma", "zlema", "alma", "kama", "t3", "vwma", "mcginley", "frama",
]);

/** Paramètres avec l'unité choisie ; "" (unité du graphe) retire la clé. PURE. */
export function paramsAvecUnite(params: Params, unite: string): Params {
  const reste: Params = {};
  for (const [cle, v] of Object.entries(params)) if (cle !== CLE_UNITE) reste[cle] = v;
  return unite === "" ? reste : { ...reste, [CLE_UNITE]: unite };
}

interface PropsSelecteurUnite {
  def: IndicatorDef;
  params: Params;
  onChange: (params: Params) => void;
}

/** Sélecteur relié au marché du graphe principal (celui que le menu Indicateurs règle). */
export function SelecteurUnite(props: PropsSelecteurUnite) {
  const exchange = useStore(marketStore, (s) => s.exchange);
  const symbol = useStore(marketStore, (s) => s.symbol);
  const timeframe = useStore(marketStore, (s) => s.timeframe);
  return <VueSelecteurUnite {...props} ctx={{ exchange, symbol, timeframe }} />;
}

/** Vue pure du sélecteur, pour un marché donné. Exportée pour les tests. */
export function VueSelecteurUnite({ def, params, onChange, ctx }: PropsSelecteurUnite & { ctx: ContexteIndicateur }) {
  const { timeframe } = ctx;
  const unite = uniteDemandee(params);
  const proposees = defAdmiseUnite(def) ? unitesProposees(def, ctx) : [];
  if (unite === null && proposees.length === 0) return null;

  const refus = unite === null ? null : raisonUniteRefusee(def, ctx, unite);
  const dureeSup = unite === null ? undefined : DUREE_UNITE[unite as keyof typeof DUREE_UNITE];
  const dureeGraphe = DUREE_UNITE[timeframe];
  const facteur = dureeSup !== undefined && dureeGraphe !== undefined ? Math.round(dureeSup / dureeGraphe) : null;

  return (
    <div className="mt-1 flex flex-col gap-1 border-t border-neutral-800/80 pt-1.5">
      <label className="flex items-center justify-between gap-2 text-xs text-neutral-300">
        <span className="truncate">Unité de calcul</span>
        <Select value={unite ?? ""} onChange={(e) => onChange(paramsAvecUnite(params, e.target.value))} className="w-24">
          <option value="">Graphe ({timeframe})</option>
          {proposees.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
          {unite !== null && !proposees.some((u) => u === unite) && <option value={unite}>{unite} (refusée)</option>}
        </Select>
      </label>
      {unite !== null && (
        <p className="text-[10px] leading-snug text-neutral-500">
          {refus !== null
            ? `Refusée sur ce graphe : ${refus}.`
            : `Lue à la clôture de chaque bougie ${unite} : escalier en retard d'au plus une bougie ${unite}, sans repeinture. Graphe seulement (ni alertes ni backtest).`}
          {refus === null && MOYENNES_MOBILES.has(def.id) && facteur !== null
            ? ` Moyenne mobile : proche d'une période ×${facteur} sur ${timeframe}.`
            : ""}
        </p>
      )}
    </div>
  );
}
