/**
 * Fenêtre « REPLAY » — rejeu de marché (roadmap §4.4), dockable à droite, NON MODAL.
 *
 * Suit le pattern DerivativesWindow/EcoWindow (le graphe reste interactif). Trois temps :
 *  1. SÉLECTION : symbole (Binance spot) + jour (7 derniers) + timeframe.
 *  2. TÉLÉCHARGEMENT : demande au daemon le dump aggTrades du jour + suivi de progression.
 *  3. LECTURE : démarre le rejeu sur le slot FOCUS (bannière REPLAY sur le chart),
 *     contrôles ⏵⏸ + vitesse + curseur temporel ; « quitter » repasse en live.
 *
 * Stockage : liste des jours téléchargés + purge. Dégradation claire si le daemon est
 * absent (« le replay nécessite le daemon axiomd »).
 */
import { useRef, useState } from "react";
import { useStore } from "zustand";
import { replayStore, joursProposes, REPLAY_TFS, VITESSES } from "../store/replay";
import { debutJour, JOUR_MS } from "../data/replayFeed";
import { BoutonRafraichir, EnTeteFenetre, NoteSource, Vide } from "./ui";
import { formatEntier } from "../lib/format";

/** Formate un nombre d'octets en Ko/Mo. */
function formatOctets(o: number): string {
  if (o >= 1_048_576) return `${(o / 1_048_576).toFixed(1)} Mo`;
  if (o >= 1024) return `${(o / 1024).toFixed(0)} Ko`;
  return `${o} o`;
}

/** Heure UTC (HH:MM:SS) d'un timestamp ms — le rejeu raisonne en jour UTC. */
function heureUtc(t: number): string {
  if (!Number.isFinite(t)) return "--:--:--";
  return new Date(t).toISOString().slice(11, 19);
}

export function ReplayWindow() {
  const s = useStore(replayStore);
  // Valeur locale du curseur pendant un glissé (évite un seek à chaque frame du drag).
  const [scrub, setScrub] = useState<number | null>(null);
  const scrubRef = useRef<number | null>(null);

  const updateScrub = (value: number): void => {
    scrubRef.current = value;
    setScrub(value);
  };
  const commitScrub = (): void => {
    const value = scrubRef.current;
    scrubRef.current = null;
    setScrub(null);
    if (value !== null) replayStore.getState().seek(value);
  };

  const debut = debutJour(s.jour);
  const valeurCurseur = scrub ?? s.curseur;

  const statutPret =
    s.statut.etat === "pret" &&
    s.statut.symbole?.toUpperCase() === s.symbole &&
    s.statut.jour === s.jour;
  const enTelechargement = s.statut.etat === "en_cours";

  return (
    <>
      {/* Pas d'actions : la croix de fermeture est fournie par le chrome FloatingWindow. */}
      <EnTeteFenetre
        mnemo="REPLAY"
        titre="Replay de marché"
        sousTitre="Dumps aggTrades officiels (data.binance.vision) · Binance spot"
      />

      <div className="flex-1 overflow-y-auto">
        {s.daemonAbsent && (
          <div className="m-3">
            <Vide>
              Le replay nécessite le daemon <span className="font-mono">axiomd</span> (port 8787).
              Démarrez-le puis rouvrez ce panneau.
            </Vide>
          </div>
        )}

        {/* 1. Sélection ------------------------------------------------------ */}
        <section className="space-y-2 border-b border-border px-4 py-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Sélection</h3>
          <div className="flex items-center gap-2">
            <label className="w-16 text-[11px] text-text-dim">Symbole</label>
            <input
              aria-label="Symbole à rejouer"
              defaultValue={s.symbole}
              key={s.symbole}
              onKeyDown={(e) => {
                if (e.key === "Enter")
                  replayStore.getState().setSymbole((e.target as HTMLInputElement).value);
              }}
              onBlur={(e) => replayStore.getState().setSymbole(e.target.value)}
              disabled={s.active}
              className="flex-1 rounded border border-border bg-bg px-1.5 py-1 font-mono text-[11px] uppercase text-text focus:border-text-dim focus:outline-none disabled:opacity-50"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="w-16 text-[11px] text-text-dim">Jour (UTC)</label>
            <select
              aria-label="Jour à rejouer"
              value={s.jour}
              onChange={(e) => replayStore.getState().setJour(e.target.value)}
              disabled={s.active}
              className="flex-1 rounded border border-border bg-bg px-1.5 py-1 text-[11px] text-text focus:border-text-dim focus:outline-none disabled:opacity-50"
            >
              {joursProposes().map((j) => (
                <option key={j} value={j}>
                  {j}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="w-16 text-[11px] text-text-dim">Timeframe</label>
            <div className="flex gap-1">
              {REPLAY_TFS.map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => replayStore.getState().setTf(tf)}
                  disabled={s.active}
                  aria-pressed={s.tf === tf}
                  className={`rounded px-2 py-1 font-mono text-[11px] transition disabled:opacity-50 ${
                    s.tf === tf ? "bg-bg text-text" : "text-text-dim hover:text-text"
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* 2. Téléchargement ------------------------------------------------ */}
        <section className="space-y-2 border-b border-border px-4 py-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">
            Téléchargement
          </h3>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-text-dim">
              {s.statut.etat === "pret" && (
                <span className="text-up">
                  prêt · {formatEntier(s.statut.recus ?? 0)} trades
                </span>
              )}
              {s.statut.etat === "en_cours" && (
                <span className="text-accent">
                  téléchargement… {s.statut.recus ? `${formatEntier(s.statut.recus)} trades` : ""}
                </span>
              )}
              {s.statut.etat === "erreur" && (
                <span className="text-down">échec · {s.statut.erreur ?? "erreur"}</span>
              )}
              {s.statut.etat === "absent" && <span>non téléchargé</span>}
            </span>
            <button
              type="button"
              onClick={() => replayStore.getState().telecharger()}
              disabled={enTelechargement || s.daemonAbsent}
              className="rounded bg-accent/20 px-3 py-1 text-xs font-medium text-text transition hover:bg-accent/30 disabled:opacity-40"
            >
              {enTelechargement ? "Téléchargement…" : statutPret ? "Re-télécharger" : "Télécharger"}
            </button>
          </div>
          <NoteSource>
            Un jour = un fichier zip officiel décompressé côté daemon. Les jours très liquides
            (BTC) peuvent peser plusieurs Mo et prendre un moment.
          </NoteSource>
        </section>

        {/* 3. Lecture ------------------------------------------------------- */}
        <section className="space-y-3 border-b border-border px-4 py-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Lecture</h3>

          {!s.active ? (
            <button
              type="button"
              onClick={() => replayStore.getState().start()}
              disabled={!statutPret}
              className="w-full rounded bg-accent/25 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-text transition hover:bg-accent/35 disabled:opacity-40"
            >
              Démarrer le replay sur le graphe focus
            </button>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => replayStore.getState().basculerLecture()}
                  aria-label={s.playing ? "Pause" : "Lecture"}
                  className="rounded bg-bg px-3 py-1.5 text-sm text-text transition hover:bg-accent/20"
                >
                  {s.playing ? "⏸" : "⏵"}
                </button>
                <div className="flex flex-1 items-center gap-1">
                  {VITESSES.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => replayStore.getState().setVitesse(v)}
                      aria-pressed={s.vitesse === v}
                      className={`flex-1 rounded px-1 py-1 font-mono text-[11px] transition ${
                        s.vitesse === v ? "bg-bg text-text" : "text-text-dim hover:text-text"
                      }`}
                    >
                      ×{v}
                    </button>
                  ))}
                </div>
              </div>

              {/* Curseur temporel sur le jour (UTC). */}
              <div className="space-y-1">
                <input
                  type="range"
                  aria-label="Curseur temporel"
                  min={debut}
                  max={debut + JOUR_MS}
                  step={1000}
                  value={valeurCurseur}
                  onChange={(e) => updateScrub(Number(e.target.value))}
                  onPointerUp={commitScrub}
                  onKeyUp={commitScrub}
                  onBlur={commitScrub}
                  className="w-full accent-accent"
                />
                <div className="flex justify-between tabular-nums text-[10px] text-text-dim">
                  <span>{heureUtc(valeurCurseur)} UTC</span>
                  <span>{(s.progression * 100).toFixed(1)} %</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => replayStore.getState().stop()}
                className="w-full rounded border border-border px-3 py-1.5 text-xs text-text-dim transition hover:bg-bg hover:text-text"
              >
                Quitter le replay (retour au live)
              </button>
            </>
          )}
        </section>

        {/* 4. Stockage ------------------------------------------------------ */}
        <section className="space-y-2 px-4 py-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">
              Stockage ({s.jours.length})
            </h3>
            <BoutonRafraichir
              onClick={() => replayStore.getState().rafraichirJours()}
              title="Rafraîchir la liste des jours"
            />
          </div>
          {s.jours.length === 0 ? (
            <Vide>Aucun jour téléchargé.</Vide>
          ) : (
            <ul className="space-y-1">
              {s.jours.map((j) => (
                <li
                  key={`${j.symbole}|${j.jour}`}
                  className="flex items-center justify-between gap-2 rounded bg-bg px-2 py-1 text-[11px]"
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-mono text-text">{j.symbole}</span>{" "}
                    <span className="text-text-dim">{j.jour}</span>
                    {j.etat === "pret" ? (
                      <span className="ml-1 text-text-dim">
                        · {formatEntier(j.recus)} · {formatOctets(j.octets)}
                      </span>
                    ) : (
                      <span className="ml-1 text-down">· {j.etat}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => replayStore.getState().purger(j.symbole, j.jour)}
                    aria-label={`Purger ${j.symbole} ${j.jour}`}
                    className="rounded px-1 text-text-dim transition hover:bg-surface hover:text-down"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
