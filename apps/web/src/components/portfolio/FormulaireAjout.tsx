/**
 * Formulaire d'ajout compact d'une position (symbole · sens · taille · prix · frais · note).
 *
 * Présentationnel : l'état du formulaire et la soumission (validation + écriture store) sont
 * portés par la fenêtre. Le type `FormState` est partagé pour éviter toute divergence.
 */
import type { Dispatch, SetStateAction } from "react";
import type { Direction } from "../../store/portfolio";

/** État local du formulaire d'ajout (basse fréquence, React admis). */
export interface FormState {
  symbole: string;
  direction: Direction;
  taille: string;
  prixEntree: string;
  fraisPct: string;
  note: string;
}

interface FormulaireAjoutProps {
  form: FormState;
  setForm: Dispatch<SetStateAction<FormState>>;
  erreurForm: string | null;
  submitAdd: () => void;
}

export function FormulaireAjout({ form, setForm, erreurForm, submitAdd }: FormulaireAjoutProps) {
  return (
    <section className="mt-3 rounded-md border border-border bg-bg p-2.5">
      <div className="mb-2 text-[10px] uppercase tracking-wider text-text-dim">Nouvelle position</div>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          value={form.symbole}
          onChange={(e) => setForm((f) => ({ ...f, symbole: e.target.value.toUpperCase() }))}
          placeholder="Symbole"
          spellCheck={false}
          className="w-24 rounded border border-border bg-bg px-1.5 py-1 text-[11px] text-text outline-none focus:border-text-dim"
        />
        <div className="flex overflow-hidden rounded border border-border">
          {(["long", "short"] as Direction[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setForm((f) => ({ ...f, direction: d }))}
              className={`px-2 py-1 text-[10px] font-semibold uppercase transition ${
                form.direction === d
                  ? `bg-surface ${d === "long" ? "text-up" : "text-down"}`
                  : "text-text-dim hover:text-text"
              }`}
            >
              {d}
            </button>
          ))}
        </div>
        <input
          value={form.taille}
          onChange={(e) => setForm((f) => ({ ...f, taille: e.target.value }))}
          placeholder="Taille"
          inputMode="decimal"
          className="w-16 rounded border border-border bg-bg px-1.5 py-1 text-[11px] tabular-nums text-text outline-none focus:border-text-dim"
        />
        <input
          value={form.prixEntree}
          onChange={(e) => setForm((f) => ({ ...f, prixEntree: e.target.value }))}
          placeholder="Prix"
          inputMode="decimal"
          className="w-20 rounded border border-border bg-bg px-1.5 py-1 text-[11px] tabular-nums text-text outline-none focus:border-text-dim"
        />
        <input
          value={form.fraisPct}
          onChange={(e) => setForm((f) => ({ ...f, fraisPct: e.target.value }))}
          placeholder="Frais %"
          inputMode="decimal"
          className="w-16 rounded border border-border bg-bg px-1.5 py-1 text-[11px] tabular-nums text-text outline-none focus:border-text-dim"
        />
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <input
          value={form.note}
          onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitAdd();
          }}
          placeholder="Note (optionnel)"
          className="min-w-0 flex-1 rounded border border-border bg-bg px-1.5 py-1 text-[11px] text-text outline-none focus:border-text-dim"
        />
        <button
          type="button"
          onClick={submitAdd}
          className="shrink-0 rounded border border-border bg-surface px-3 py-1 text-[11px] text-text transition hover:text-accent"
        >
          Ajouter
        </button>
      </div>
      {erreurForm !== null && <p className="mt-1.5 text-[10px] text-down">{erreurForm}</p>}
    </section>
  );
}
