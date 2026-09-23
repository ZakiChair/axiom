/** Éditeur de paramètres partagé sans charger le catalogue des indicateurs. */
import type { IndicatorDef, IndicatorInput } from "@axiom/types";
import type { ActiveIndicator } from "../store/indicators";
import { Input, Select } from "./ui";

export function InstanceParamsEditor({
  def,
  instance,
  onChange,
}: {
  def: IndicatorDef;
  instance: ActiveIndicator;
  onChange: (params: ActiveIndicator["params"]) => void;
}) {
  if (def.inputs.length === 0) {
    return <div className="px-2 pb-2 text-[11px] text-neutral-500">Aucun paramètre.</div>;
  }

  const set = (key: string, value: number | boolean | string) =>
    onChange({ ...instance.params, [key]: value });

  const renderControl = (input: IndicatorInput) => {
    const value = instance.params[input.key] ?? input.default;
    // Choix explicite (select) ou source avec options : liste déroulante.
    if ((input.type === "select" || input.type === "source") && input.options && input.options.length > 0) {
      return (
        <Select
          value={String(value)}
          onChange={(e) => set(input.key, e.target.value)}
          className="w-24"
        >
          {input.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </Select>
      );
    }
    if (input.type === "boolean") {
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => set(input.key, e.target.checked)}
          className="accent-accent"
        />
      );
    }
    if (input.type === "number") {
      return (
        <Input
          type="number"
          value={typeof value === "number" ? value : Number(value)}
          min={input.min}
          max={input.max}
          onChange={(e) => {
            const n = e.target.valueAsNumber;
            // On ignore une saisie non finie (champ vidé transitoirement).
            if (Number.isFinite(n)) set(input.key, n);
          }}
          className="w-20"
        />
      );
    }
    // Repli (source sans options) : saisie texte libre.
    return (
      <Input
        type="text"
        value={String(value)}
        onChange={(e) => set(input.key, e.target.value)}
        className="w-24"
      />
    );
  };

  return (
    <div className="flex flex-col gap-1.5 px-2 pb-2">
      {def.inputs.map((input) => (
        <label key={input.key} className="flex items-center justify-between gap-2 text-xs text-neutral-300">
          <span className="truncate">{input.name}</span>
          {renderControl(input)}
        </label>
      ))}
    </div>
  );
}
