/**
 * FootprintSettingsPanel — paramètres avancés du rendu footprint.
 *
 * Ouvert par un clic droit sur le bouton « Orderflow » de la Toolbar.
 */
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { orderflowStore, type OrderflowState } from "../store/orderflow";

interface FieldProps {
  label: string;
  children: React.ReactNode;
}

function Field({ label, children }: FieldProps) {
  return (
    <label className="mt-2 flex items-center gap-2 text-[11px] text-text-dim">
      {children}
      <span>{label}</span>
    </label>
  );
}

export function FootprintSettingsPanel({ onClose }: { onClose: () => void }) {
  const showImbalances = useStore(orderflowStore, (s) => s.showImbalances);
  const ratioPct = useStore(orderflowStore, (s) => s.imbalanceRatioPct);
  const minVol = useStore(orderflowStore, (s) => s.imbalanceMinVol);
  const showBarPoc = useStore(orderflowStore, (s) => s.showBarPoc);
  const showBarVa = useStore(orderflowStore, (s) => s.showBarVa);
  const showDivergences = useStore(orderflowStore, (s) => s.showDivergences);

  const setShowImbalances = useStore(orderflowStore, (s) => s.setShowImbalances);
  const setRatioPct = useStore(orderflowStore, (s) => s.setImbalanceRatioPct);
  const setMinVol = useStore(orderflowStore, (s) => s.setImbalanceMinVol);
  const setShowBarPoc = useStore(orderflowStore, (s) => s.setShowBarPoc);
  const setShowBarVa = useStore(orderflowStore, (s) => s.setShowBarVa);
  const setShowDivergences = useStore(orderflowStore, (s) => s.setShowDivergences);

  const [draftRatio, setDraftRatio] = useState(String(ratioPct));
  const [draftMinVol, setDraftMinVol] = useState(String(minVol));

  // Synchroniser le draft quand le store change (ex. via un autre onglet).
  useEffect(() => { setDraftRatio(String(ratioPct)); }, [ratioPct]);
  useEffect(() => { setDraftMinVol(String(minVol)); }, [minVol]);

  const submitRatio = () => {
    const v = Number.parseInt(draftRatio, 10);
    if (Number.isFinite(v) && v >= 100) setRatioPct(v);
  };
  const submitMinVol = () => {
    const v = Number.parseInt(draftMinVol, 10);
    if (Number.isFinite(v) && v >= 0) setMinVol(v);
  };

  return (
    <>
      {/* Fond cliquable : ferme le panneau. */}
      <div onClick={onClose} className="fixed inset-0 z-40" aria-hidden />
      <div
        role="dialog"
        aria-label="Paramètres Footprint"
        className="fixed bottom-3 left-12 z-50 w-64 rounded-md border border-border bg-surface p-3 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-dim">
            Footprint
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-[10px] text-text-dim transition hover:text-text"
          >
            fermer
          </button>
        </div>

        <Field label="Imbalances">
          <input
            type="checkbox"
            checked={showImbalances}
            onChange={(e) => setShowImbalances(e.target.checked)}
            className="h-3 w-3 accent-[var(--accent)]"
          />
        </Field>

        {showImbalances && (
          <>
            <div className="mt-2 flex items-center gap-2 text-[11px] text-text-dim">
              <span>Seuil %</span>
              <input
                value={draftRatio}
                onChange={(e) => setDraftRatio(e.target.value)}
                onBlur={submitRatio}
                onKeyDown={(e) => { if (e.key === "Enter") submitRatio(); }}
                inputMode="numeric"
                spellCheck={false}
                className="w-16 rounded border border-border bg-bg px-2 py-0.5 text-[11px] text-text outline-none placeholder:text-text-dim focus:border-accent"
              />
              <span className="text-[10px] opacity-70">(≥ {ratioPct}% × passif adjacent)</span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-text-dim">
              <span>Vol min</span>
              <input
                value={draftMinVol}
                onChange={(e) => setDraftMinVol(e.target.value)}
                onBlur={submitMinVol}
                onKeyDown={(e) => { if (e.key === "Enter") submitMinVol(); }}
                inputMode="numeric"
                spellCheck={false}
                className="w-16 rounded border border-border bg-bg px-2 py-0.5 text-[11px] text-text outline-none placeholder:text-text-dim focus:border-accent"
              />
            </div>
          </>
        )}

        <Field label="POC (point of control)">
          <input
            type="checkbox"
            checked={showBarPoc}
            onChange={(e) => setShowBarPoc(e.target.checked)}
            className="h-3 w-3 accent-[var(--accent)]"
          />
        </Field>

        <Field label="Zone de valeur (VA 70 %)">
          <input
            type="checkbox"
            checked={showBarVa}
            onChange={(e) => setShowBarVa(e.target.checked)}
            className="h-3 w-3 accent-[var(--accent)]"
          />
        </Field>

        <Field label="Divergences delta">
          <input
            type="checkbox"
            checked={showDivergences}
            onChange={(e) => setShowDivergences(e.target.checked)}
            className="h-3 w-3 accent-[var(--accent)]"
          />
        </Field>
      </div>
    </>
  );
}
