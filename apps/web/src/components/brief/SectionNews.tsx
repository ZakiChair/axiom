/**
 * Section BRIEF — actualités + indice Fear & Greed. Le badge F&G (référentiel ~90 j)
 * s'appuie sur le chapeau ; l'âge des titres se calcule vs `instant`. Dégradation
 * gracieuse via `corps`.
 */
import type { FearGreed, TitreNews } from "../../data/brief";
import type { Chapeau } from "../../store/regime";
import { formatAge } from "../../lib/format";
import { navigateTo } from "../../lib/navigation";
import { Badge, NoteSource, RefBadge, Vide } from "../ui";
import { corps, TitreBloc, type Section } from "./commun";

interface Props {
  news: Section<TitreNews[]>;
  fearGreed: Section<FearGreed>;
  chapeau: Chapeau | null;
  instant: number;
  noteFraicheur: string;
}

export function SectionNews({ news, fearGreed, chapeau, instant, noteFraicheur }: Props) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <TitreBloc>Actualités</TitreBloc>
        {fearGreed.statut === "ready" && fearGreed.data !== null && (
          <div className="flex items-center gap-1.5">
            <Badge ton="accent" title="Indice Fear & Greed (alternative.me)">
              F&G {fearGreed.data.value}
              {fearGreed.data.classification ? ` · ${fearGreed.data.classification}` : ""}
            </Badge>
            {/* Un F&G nu ne dit pas s'il est extrême : 72 en marché euphorique
                n'est qu'un p40. Le référentiel situe la valeur dans ~90 j. */}
            <RefBadge referentiel={chapeau?.fearGreedRef ?? null} sens="hausse-chaud" />
          </div>
        )}
      </div>
      {corps(news, "Actualités indisponibles.", (titres) =>
        titres.length === 0 ? (
          <Vide>Aucune actualité.</Vide>
        ) : (
          <div className="space-y-1.5">
            {titres.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() =>
                  navigateTo({
                    markTime: n.time,
                    markLabel: n.titre,
                    source: "brief",
                  })
                }
                title="Marquer sur le chart"
                className="flex w-full flex-col gap-0.5 text-left transition hover:bg-bg"
              >
                <div className="flex items-center gap-2 text-[10px] text-text-dim">
                  <span className="uppercase">{n.source}</span>
                  <span className="tabular-nums">{formatAge(n.time, instant)}</span>
                </div>
                <span className="text-[11px] leading-snug text-text">{n.titre}</span>
              </button>
            ))}
          </div>
        ),
      )}
      <NoteSource>Flux RSS/Finnhub · Fear &amp; Greed alternative.me · {noteFraicheur}.</NoteSource>
    </section>
  );
}
