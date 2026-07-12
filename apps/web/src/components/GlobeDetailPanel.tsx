/**
 * Panneau latéral détail de la fenêtre GLOBE — MARKUP SEUL (contrat ui.tsx),
 * la logique (sélection, fetch de zone) vit dans GlobeWindow. Glisse depuis la
 * droite DANS le corps de la fenêtre (adaptation du pattern SettingsPanel).
 */
import { Chargement, Vide } from "./ui";
import { lignesEvenement, sousTitreSelection, titreSelection, type SelectionGlobe } from "./globeDetail.util";
import type { EvenementDetail } from "../data/globe/types";

export function GlobeDetailPanel({ selection, evenements, onFermer }: {
  selection: SelectionGlobe;
  /** Liste du détail de zone : "chargement", null (indisponible) ou les événements. */
  evenements: EvenementDetail[] | "chargement" | null;
  onFermer: () => void;
}) {
  const nowMs = Date.now();
  return (
    <div className="absolute right-0 top-0 z-10 flex h-full w-[min(280px,85%)] flex-col border-l border-border bg-surface">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-1.5">
        <div className="min-w-0">
          <div className="truncate text-[12px] text-text">{titreSelection(selection)}</div>
          <div className="truncate text-[10px] text-text-dim">{sousTitreSelection(selection, nowMs)}</div>
        </div>
        <button type="button" onClick={onFermer} aria-label="Fermer le détail" className="ml-2 shrink-0 text-text-dim transition hover:text-text">✕</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {selection.type !== "evenement" ? (
          <Vide>Détail agrégé ci-dessus — pas de liste d'événements pour cette couche.</Vide>
        ) : evenements === "chargement" ? (
          <Chargement libelle="Détail de la zone…" />
        ) : evenements === null ? (
          <Vide>Détail indisponible (daemon hors ligne ?).</Vide>
        ) : evenements.length === 0 ? (
          <Vide>Aucun événement dans la fenêtre servie.</Vide>
        ) : (
          <ul className="space-y-2">
            {evenements.map((evt, i) => {
              const l = lignesEvenement(evt, nowMs);
              return (
                <li key={i} className="border-b border-border pb-1.5 text-[11px] last:border-b-0">
                  <div className="text-text">{l.entete}</div>
                  <div className="text-text-dim">{l.detail}</div>
                  {evt.url !== null ? (
                    <a href={evt.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">source ↗</a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
