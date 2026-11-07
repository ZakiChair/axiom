/**
 * EQS — lignes d'édition des conditions de l'étage indicateurs (sous-composants de
 * ScreenerWindow, props pures : l'état vit dans store/screener).
 *
 *  - LigneConditionChamp : champ du catalogue (indicateurs historiques, flux, force
 *    relative) `op` seuil ;
 *  - LigneConditionRegle : règle au modèle du backtest (comparaison ou croisement de deux
 *    opérandes du catalogue curé, plus squeeze TTM et NR / Inside).
 * Les deux portent leur lecture : unité (au plus une en plus de celle du run) et fenêtre
 * « vraie sur au moins une des K dernières bougies closes ». Une condition refusée
 * affiche sa raison sous la ligne.
 */
import type { Timeframe } from "@axiom/types";
import type { Comparateur, Condition, Operande, SensCroisement } from "@axiom/backtest";
import { supportsIndicatorTimeframe, TIMEFRAME_REQUIS } from "@axiom/indicators";
import {
  OPERATORS,
  SCREENER_TIMEFRAMES,
  type ConditionChamp,
  type ConditionRegle,
  type IndicatorCondition,
  type IndicatorFieldSpec,
  type Operator,
} from "../data/screener";
import { champParId, FENETRE_MAX, TOUS_LES_CHAMPS, uniteCondition } from "../data/screenerRegles";
import {
  decrireOperandeScreener,
  OPERANDES_SCREENER,
  specOperandeScreener,
} from "../data/screenerOperandes";
import { Input, Select } from "./ui";

/** Groupes du sélecteur de champs (ordre d'affichage). */
const GROUPES_CHAMPS: { label: string; filtre: (f: IndicatorFieldSpec) => boolean }[] = [
  { label: "Indicateurs", filtre: (f) => f.famille === undefined },
  { label: "Flux (volume taker Binance)", filtre: (f) => f.famille === "flux" },
  { label: "Force relative vs réf. (descriptif)", filtre: (f) => f.famille === "force-relative" },
];

/** Bouton de retrait commun. */
function Retirer({ onRemove }: { onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label="Retirer la condition"
      className="rounded px-1 text-text-dim transition hover:text-down"
    >
      ✕
    </button>
  );
}

/**
 * Lecture d'une condition : unité (celle du run par défaut, imposée pour le RS Mansfield)
 * et fenêtre K en bougies closes.
 */
function Lecture({
  cond,
  tfRun,
  onChange,
}: {
  cond: IndicatorCondition;
  tfRun: Timeframe;
  onChange: (c: IndicatorCondition) => void;
}) {
  const impose = cond.kind === "indicator" ? champParId(cond.fieldId)?.tfImpose : undefined;
  return (
    <span className="flex items-center gap-1 text-[10px] text-text-dim">
      {impose !== undefined ? (
        <span title="Unité imposée par le champ">{impose}</span>
      ) : (
        <Select
          value={cond.tf === undefined || cond.tf === tfRun ? "" : cond.tf}
          onChange={(e) => {
            const tf = e.target.value === "" ? undefined : (e.target.value as Timeframe);
            onChange({ ...cond, tf: tf === tfRun ? undefined : tf });
          }}
          aria-label="Unité de la condition"
          title="Unité de la condition : au plus une en plus de celle du run"
        >
          <option value="">TF run</option>
          {SCREENER_TIMEFRAMES.filter((t) => t !== tfRun).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
      )}
      <label className="flex items-center gap-0.5" title="Vraie sur au moins une des K dernières bougies closes">
        sur
        <Input
          type="number"
          min={1}
          max={FENETRE_MAX}
          value={cond.fenetre ?? 1}
          onChange={(e) => {
            const k = Math.round(Number(e.target.value));
            onChange({ ...cond, fenetre: k > 1 ? k : undefined });
          }}
          className="w-10 tabular-nums"
          aria-label="Fenêtre K (bougies closes)"
        />
        b.
      </label>
    </span>
  );
}

/** Raison de refus sous la ligne (rien si la condition est évaluable). */
function Raison({ raison }: { raison: string | null }) {
  return raison === null ? null : <p className="text-[10px] text-down">{raison}</p>;
}

/** Ligne d'une condition sur un champ du catalogue. */
export function LigneConditionChamp({
  cond,
  tfRun,
  raison,
  onChange,
  onRemove,
}: {
  cond: ConditionChamp;
  tfRun: Timeframe;
  raison: string | null;
  onChange: (c: IndicatorCondition) => void;
  onRemove: () => void;
}) {
  const spec = champParId(cond.fieldId);
  return (
    <div className="space-y-1">
      <div className="axiom-screener-ligne flex flex-wrap items-center gap-1.5">
        <Select
          value={cond.fieldId}
          onChange={(e) => {
            const suivant = champParId(e.target.value);
            onChange({ ...cond, fieldId: e.target.value, param: suivant?.defaultParam });
          }}
          className="min-w-0 flex-1"
          aria-label="Indicateur"
          title={spec?.aide}
        >
          {GROUPES_CHAMPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {TOUS_LES_CHAMPS.filter(g.filtre).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                  {f.unit ? ` (${f.unit})` : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        {spec?.paramKey !== undefined && (
          <Input
            type="number"
            value={cond.param ?? spec.defaultParam ?? 0}
            onChange={(e) => onChange({ ...cond, param: Number(e.target.value) })}
            className="w-14 tabular-nums"
            aria-label={spec.paramKey}
            title={spec.paramKey}
          />
        )}
        <Select
          value={cond.op}
          onChange={(e) => onChange({ ...cond, op: e.target.value as Operator })}
          aria-label="Opérateur"
        >
          {OPERATORS.map((op) => (
            <option key={op} value={op}>
              {op}
            </option>
          ))}
        </Select>
        <Input
          type="number"
          value={cond.value}
          onChange={(e) => onChange({ ...cond, value: Number(e.target.value) })}
          className="w-16 tabular-nums"
          aria-label="Valeur"
        />
        <Lecture cond={cond} tfRun={tfRun} onChange={onChange} />
        <Retirer onRemove={onRemove} />
      </div>
      <Raison raison={raison} />
    </div>
  );
}

/** Opérande par défaut d'un terme rebasculé (close). */
const OPERANDE_DEFAUT: Operande = { type: "prix", champ: "close" };

/** Bascule une règle entre comparaison et croisement en conservant l'opérande gauche. */
export function basculerTypeRegle(c: Condition, type: Condition["type"]): Condition {
  if (type === c.type) return c;
  if (type === "croisement") {
    const a = c.type === "comparaison" ? c.gauche : OPERANDE_DEFAUT;
    const b = c.type === "comparaison" ? c.droite : { type: "constante" as const, valeur: 0 };
    return { type: "croisement", a, b, sens: "hausse" };
  }
  const gauche = c.type === "croisement" ? c.a : OPERANDE_DEFAUT;
  const droite = c.type === "croisement" ? c.b : { type: "constante" as const, valeur: 0 };
  return { type: "comparaison", gauche, comparateur: ">", droite };
}

/** Terme d'une règle : valeur constante ou opérande du catalogue (+ paramètre principal). */
function Terme({
  op,
  unite,
  onChange,
  aria,
}: {
  op: Operande;
  unite: Timeframe;
  onChange: (o: Operande) => void;
  aria: string;
}) {
  const { specId, param } = decrireOperandeScreener(op);
  const spec = specOperandeScreener(specId);
  return (
    <span className="flex items-center gap-1">
      <Select
        value={specId}
        onChange={(e) => {
          if (e.target.value === "constante") {
            onChange({ type: "constante", valeur: 0 });
            return;
          }
          const s = specOperandeScreener(e.target.value);
          if (s) onChange(s.make(s.defaultParam));
        }}
        aria-label={aria}
      >
        <option value="constante">valeur</option>
        {specId !== "constante" && spec === undefined && <option value={specId}>{specId} (hors catalogue)</option>}
        {OPERANDES_SCREENER.map((s) => {
          const o = s.make(s.defaultParam);
          const compatible = o.type !== "indicateur" || supportsIndicatorTimeframe(o.indicateurId, unite);
          const requis = o.type === "indicateur" ? TIMEFRAME_REQUIS[o.indicateurId] : undefined;
          return (
            <option key={s.id} value={s.id} disabled={!compatible}>
              {s.label}
              {compatible || requis === undefined ? "" : ` · ${requis} requis`}
            </option>
          );
        })}
      </Select>
      {op.type === "constante" ? (
        <Input
          type="number"
          value={op.valeur}
          onChange={(e) => onChange({ type: "constante", valeur: Number(e.target.value) })}
          className="w-16 tabular-nums"
          aria-label={`${aria} (valeur)`}
        />
      ) : (
        spec?.paramKey !== undefined && (
          <Input
            type="number"
            value={param ?? spec.defaultParam ?? 0}
            onChange={(e) => onChange(spec.make(Number(e.target.value)))}
            className="w-12 tabular-nums"
            aria-label={`${aria} (${spec.paramKey})`}
            title={spec.paramKey}
          />
        )
      )}
    </span>
  );
}

/** Ligne d'une règle (comparaison ou croisement d'opérandes). */
export function LigneConditionRegle({
  cond,
  tfRun,
  raison,
  onChange,
  onRemove,
}: {
  cond: ConditionRegle;
  tfRun: Timeframe;
  raison: string | null;
  onChange: (c: IndicatorCondition) => void;
  onRemove: () => void;
}) {
  const c = cond.condition;
  const unite = uniteCondition(cond, tfRun);
  const majCondition = (suivante: Condition) => onChange({ ...cond, condition: suivante });
  return (
    <div className="space-y-1">
      <div className="axiom-screener-ligne flex flex-wrap items-center gap-1.5">
        <Select
          value={c.type}
          onChange={(e) => majCondition(basculerTypeRegle(c, e.target.value as Condition["type"]))}
          aria-label="Type de règle"
        >
          <option value="comparaison">comparaison</option>
          <option value="croisement">croisement</option>
        </Select>
        {c.type === "comparaison" ? (
          <>
            <Terme op={c.gauche} unite={unite} onChange={(g) => majCondition({ ...c, gauche: g })} aria="Terme gauche" />
            <Select
              value={c.comparateur}
              onChange={(e) => majCondition({ ...c, comparateur: e.target.value as Comparateur })}
              aria-label="Comparateur"
            >
              {OPERATORS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </Select>
            <Terme op={c.droite} unite={unite} onChange={(d) => majCondition({ ...c, droite: d })} aria="Terme droit" />
          </>
        ) : (
          <>
            <Terme op={c.a} unite={unite} onChange={(a) => majCondition({ ...c, a })} aria="Terme A" />
            <Select
              value={c.sens}
              onChange={(e) => majCondition({ ...c, sens: e.target.value as SensCroisement })}
              aria-label="Sens du croisement"
            >
              <option value="hausse">croise ↑</option>
              <option value="baisse">croise ↓</option>
            </Select>
            <Terme op={c.b} unite={unite} onChange={(b) => majCondition({ ...c, b })} aria="Terme B" />
          </>
        )}
        <Lecture cond={cond} tfRun={tfRun} onChange={onChange} />
        <Retirer onRemove={onRemove} />
      </div>
      <Raison raison={raison} />
    </div>
  );
}

/** Ligne d'une condition quelconque. */
export function LigneCondition(props: {
  cond: IndicatorCondition;
  tfRun: Timeframe;
  raison: string | null;
  onChange: (c: IndicatorCondition) => void;
  onRemove: () => void;
}) {
  const { cond, ...reste } = props;
  return cond.kind === "indicator" ? (
    <LigneConditionChamp cond={cond} {...reste} />
  ) : (
    <LigneConditionRegle cond={cond} {...reste} />
  );
}
