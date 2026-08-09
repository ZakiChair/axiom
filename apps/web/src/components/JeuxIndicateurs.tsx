/**
 * Section « Jeux » du menu Indicateurs : enregistrer le setup courant sous un nom, et
 * le rappeler d'un clic. Sur un terminal mono-utilisateur c'est le raccourci le plus
 * rentable du menu — le catalogue compte 152 entrées dans 288 px de large, sans favori
 * ni récent, et reconstituer un setup imposait de re-cocher chaque ligne
 * (revue du 2026-08-01 § 6.2).
 *
 * Le renommage/suppression se fait EN LIGNE (deux temps pour la suppression), pas par
 * `window.prompt` : le reste du chrome est entièrement custom.
 */
import { useState } from "react";
import { useStore } from "zustand";
import { indicatorsStore, type ActiveIndicator } from "../store/indicators";
import { indicatorSetsStore, MAX_JEUX } from "../store/indicatorSets";
import { pousserToast } from "../store/toasts";
import { Input } from "./ui";

export function JeuxIndicateurs({ actives }: { actives: ActiveIndicator[] }) {
  const jeux = useStore(indicatorSetsStore, (s) => s.jeux);
  const enregistrer = useStore(indicatorSetsStore, (s) => s.enregistrer);
  const supprimer = useStore(indicatorSetsStore, (s) => s.supprimer);
  const [nom, setNom] = useState("");
  /** Id en attente de confirmation de suppression (second clic sur ✕). */
  const [aConfirmer, setAConfirmer] = useState<string | null>(null);

  const peutEnregistrer = nom.trim() !== "" && actives.length > 0;
  const plein = jeux.length >= MAX_JEUX;

  function rappeler(id: string): void {
    const jeu = indicatorSetsStore.getState().jeux.find((j) => j.id === id);
    if (!jeu) return;
    indicatorsStore.getState().setAll(jeu.instances);
    pousserToast(`Jeu « ${jeu.nom} » rappelé — ${jeu.instances.length} indicateurs`);
  }

  return (
    <div className="border-b border-neutral-800 p-1">
      <div className="flex items-baseline gap-2 px-2 py-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-dim">
          Jeux
        </span>
        <span className="text-[10px] text-neutral-600">
          {jeux.length > 0 ? `${jeux.length}/${MAX_JEUX}` : "aucun"}
        </span>
      </div>

      {jeux.map((jeu) => (
        <div key={jeu.id} className="flex items-center gap-1 rounded px-2 py-1 hover:bg-neutral-800/60">
          <button
            type="button"
            title={`Rappeler « ${jeu.nom} » (${jeu.instances.length} indicateurs)`}
            onClick={() => rappeler(jeu.id)}
            className="min-w-0 flex-1 truncate text-left text-sm text-neutral-200"
          >
            {jeu.nom}
          </button>
          <span className="text-[10px] tabular-nums text-neutral-600">{jeu.instances.length}</span>
          <button
            type="button"
            title={aConfirmer === jeu.id ? "Confirmer la suppression" : "Supprimer ce jeu"}
            aria-label={aConfirmer === jeu.id ? `Confirmer la suppression de ${jeu.nom}` : `Supprimer ${jeu.nom}`}
            onClick={() => {
              if (aConfirmer === jeu.id) {
                supprimer(jeu.id);
                setAConfirmer(null);
              } else {
                setAConfirmer(jeu.id);
              }
            }}
            onBlur={() => setAConfirmer((cur) => (cur === jeu.id ? null : cur))}
            className={`rounded px-1 text-[11px] ${
              aConfirmer === jeu.id ? "text-down" : "text-neutral-400 hover:text-down"
            }`}
          >
            {aConfirmer === jeu.id ? "confirmer ?" : "✕"}
          </button>
        </div>
      ))}

      <div className="flex items-center gap-1 px-2 py-1">
        <Input
          type="text"
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !peutEnregistrer) return;
            e.preventDefault();
            e.stopPropagation(); // sinon le champ de recherche du menu ajouterait un indicateur
            enregistrer(nom, actives);
            setNom("");
          }}
          placeholder={plein ? `${MAX_JEUX} jeux maximum` : "Enregistrer ce jeu sous…"}
          disabled={plein}
          className="min-w-0 flex-1"
        />
        <button
          type="button"
          disabled={!peutEnregistrer || plein}
          title={
            actives.length === 0
              ? "Aucun indicateur actif à enregistrer"
              : `Enregistrer les ${actives.length} indicateurs actifs`
          }
          onClick={() => {
            enregistrer(nom, actives);
            setNom("");
          }}
          className="rounded px-1.5 py-0.5 text-xs text-accent hover:bg-neutral-700 disabled:cursor-not-allowed disabled:text-neutral-600"
        >
          ＋
        </button>
      </div>
    </div>
  );
}
