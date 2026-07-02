/**
 * Panneau « Notes / journal » — dockable à droite, NON MODAL (pattern DerivativesWindow).
 *
 * Notes horodatées ancrées au contexte de marché { symbole, source, prix? }. Création
 * rapide (symbole actif prérempli, prix courant capturé à l'enregistrement), recherche
 * plein texte + filtres symbole/tag, liste ANTICHRONO, édition inline et suppression avec
 * confirmation. Lien « voir sur le chart » = change le symbole (l'épinglage visuel sur le
 * chart viendra plus tard — on ne touche PAS au chart ici).
 *
 * Le panneau consomme un éventuel BROUILLON armé par le portefeuille (post-mortem de
 * clôture) : il pré-remplit alors le formulaire avec le contexte de la position close.
 *
 * Mutations basse fréquence (manuelles) : re-render React admis (pas de flux tick ici).
 */
import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { marketStore } from "../store/market";
import {
  notesStore,
  notesUiStore,
  parseTags,
  rechercherNotes,
  tousLesTags,
  type FiltreNotes,
} from "../store/notes";
import type { ExchangeId } from "@axiom/types";

/** Prix courant de l'actif actif (dernière clôture du buffer marché), ou undefined. */
function prixMarcheActif(): number | undefined {
  const c = marketStore.getState().candles.at(-1);
  return c ? c.close : undefined;
}

/** Formatte un prix ancré de façon lisible. */
function formatPrix(p: number | undefined): string {
  if (p === undefined || !Number.isFinite(p)) return "";
  if (p >= 1000) return p.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(2);
  return p.toPrecision(4);
}

/** Horodatage court « JJ/MM HH:MM ». */
function formatDate(ts: number): string {
  return new Date(ts).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function NotesWindow() {
  const brouillon = useStore(notesUiStore, (s) => s.brouillon);
  const notes = useStore(notesStore, (s) => s.notes);
  const activeSymbol = useStore(marketStore, (s) => s.symbol);
  const activeExchange = useStore(marketStore, (s) => s.exchange);

  // Formulaire de création. `ancre` = contexte imposé par un post-mortem (sinon actif).
  const [texte, setTexte] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [ancre, setAncre] = useState<{ symbole: string; source: ExchangeId; prix?: number } | null>(null);

  // Filtres de la liste.
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [symbolFilterOnly, setSymbolFilterOnly] = useState(false);

  // Édition inline.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTexte, setEditTexte] = useState("");
  const [editTags, setEditTags] = useState("");

  // Consomme un brouillon armé par le portefeuille (post-mortem) : seed du formulaire.
  useEffect(() => {
    if (!brouillon) return;
    setTexte(brouillon.texte);
    setTagsInput((brouillon.tags ?? []).join(" "));
    setAncre({ symbole: brouillon.symbole, source: brouillon.source, prix: brouillon.prix });
    notesUiStore.getState().consommerBrouillon();
  }, [brouillon]);

  const tagsDispo = useMemo(() => tousLesTags(notes), [notes]);

  const visibles = useMemo(() => {
    const filtre: FiltreNotes = {
      texte: query,
      tag: tagFilter || undefined,
      symbole: symbolFilterOnly ? activeSymbol : undefined,
    };
    return rechercherNotes(notes, filtre);
  }, [notes, query, tagFilter, symbolFilterOnly, activeSymbol]);

  const ancreSymbole = ancre?.symbole ?? activeSymbol;
  const ancrePrix = ancre?.prix ?? prixMarcheActif();

  const submit = () => {
    if (!texte.trim()) return;
    notesStore.getState().ajouter({
      symbole: ancre?.symbole ?? activeSymbol,
      source: ancre?.source ?? activeExchange,
      prix: ancre?.prix ?? prixMarcheActif(),
      texte: texte.trim(),
      tags: parseTags(tagsInput),
    });
    setTexte("");
    setTagsInput("");
    setAncre(null);
  };

  const startEdit = (id: string, texteInit: string, tags: string[]) => {
    setEditingId(id);
    setEditTexte(texteInit);
    setEditTags(tags.join(" "));
  };

  const saveEdit = () => {
    if (editingId) {
      notesStore.getState().modifier(editingId, { texte: editTexte.trim(), tags: parseTags(editTags) });
    }
    setEditingId(null);
  };

  const supprimer = (id: string) => {
    if (window.confirm("Supprimer cette note ?")) notesStore.getState().supprimer(id);
  };

  const voirSurChart = (symbole: string, source: ExchangeId) => {
    marketStore.getState().setExchange(source);
    marketStore.getState().setSymbol(symbole);
  };

  return (
    <>
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-text">Notes / journal</h2>
          <p className="mt-0.5 text-[11px] text-text-dim">Annotations ancrées au marché</p>
        </div>
        {/* close button removed — FloatingWindow chrome provides one */}
      </header>

      {/* Création rapide */}
      <section className="shrink-0 border-b border-border px-4 py-3">
        <div className="mb-1.5 flex items-center justify-between text-[10px] text-text-dim">
          <span>
            Ancré : <span className="font-medium text-text">{ancreSymbole}</span>
            {ancrePrix !== undefined ? <span className="tabular-nums"> @ {formatPrix(ancrePrix)}</span> : null}
            {ancre ? <span className="ml-1 text-accent">· post-mortem</span> : null}
          </span>
          {ancre && (
            <button type="button" onClick={() => setAncre(null)} className="text-text-dim transition hover:text-text">
              utiliser l'actif
            </button>
          )}
        </div>
        <textarea
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          placeholder="Note (markdown court)… ⌘/Ctrl+Entrée pour enregistrer"
          rows={3}
          className="w-full resize-none rounded border border-border bg-bg px-2 py-1.5 text-[12px] text-text outline-none placeholder:text-text-dim focus:border-text-dim"
        />
        <div className="mt-1.5 flex items-center gap-1.5">
          <input
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="tags (espace/virgule)"
            spellCheck={false}
            className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1 text-[11px] text-text outline-none placeholder:text-text-dim focus:border-text-dim"
          />
          <button
            type="button"
            onClick={submit}
            className="shrink-0 rounded border border-border bg-bg px-3 py-1 text-[11px] text-text transition hover:text-accent"
          >
            Enregistrer
          </button>
        </div>
      </section>

      {/* Filtres */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-4 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher…"
          className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1 text-[11px] text-text outline-none placeholder:text-text-dim focus:border-text-dim"
        />
        <select
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          className="shrink-0 rounded border border-border bg-bg px-1.5 py-1 text-[11px] text-text-dim outline-none focus:border-text-dim"
        >
          <option value="">tous tags</option>
          {tagsDispo.map((t) => (
            <option key={t} value={t}>
              #{t}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setSymbolFilterOnly((v) => !v)}
          aria-pressed={symbolFilterOnly}
          title="Filtrer sur le symbole actif"
          className={`shrink-0 rounded border px-1.5 py-1 text-[10px] transition ${
            symbolFilterOnly ? "border-accent text-accent" : "border-border text-text-dim hover:text-text"
          }`}
        >
          {activeSymbol}
        </button>
      </div>

      {/* Liste antichrono */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {visibles.length === 0 ? (
          <p className="rounded-md border border-border bg-bg px-3 py-3 text-[11px] text-text-dim">
            {notes.length === 0 ? "Aucune note. Créez-en une ci-dessus." : "Aucune note ne correspond au filtre."}
          </p>
        ) : (
          <div className="space-y-1.5">
            {visibles.map((n) => (
              <div key={n.id} className="rounded-md border border-border bg-bg px-2.5 py-2">
                <div className="flex items-center justify-between gap-2 text-[10px] text-text-dim">
                  <button
                    type="button"
                    onClick={() => voirSurChart(n.symbole, n.source)}
                    className="flex items-center gap-1.5 text-left transition hover:text-text"
                    title="Voir sur le chart"
                  >
                    <span className="font-medium text-text">{n.symbole}</span>
                    {n.prix !== undefined ? <span className="tabular-nums">@ {formatPrix(n.prix)}</span> : null}
                  </button>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums">{formatDate(n.timestamp)}</span>
                    {editingId !== n.id && (
                      <>
                        <button
                          type="button"
                          onClick={() => startEdit(n.id, n.texte, n.tags)}
                          aria-label="Éditer la note"
                          className="transition hover:text-text"
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          onClick={() => supprimer(n.id)}
                          aria-label="Supprimer la note"
                          className="transition hover:text-down"
                        >
                          ×
                        </button>
                      </>
                    )}
                  </span>
                </div>

                {editingId === n.id ? (
                  <div className="mt-1.5">
                    <textarea
                      autoFocus
                      value={editTexte}
                      onChange={(e) => setEditTexte(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveEdit();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      rows={3}
                      className="w-full resize-none rounded border border-border bg-surface px-2 py-1.5 text-[12px] text-text outline-none focus:border-text-dim"
                    />
                    <div className="mt-1 flex items-center gap-1.5">
                      <input
                        value={editTags}
                        onChange={(e) => setEditTags(e.target.value)}
                        placeholder="tags"
                        spellCheck={false}
                        className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 text-[11px] text-text outline-none focus:border-text-dim"
                      />
                      <button type="button" onClick={saveEdit} className="shrink-0 rounded border border-border bg-surface px-2 py-1 text-[10px] text-text transition hover:text-accent">
                        Enregistrer
                      </button>
                      <button type="button" onClick={() => setEditingId(null)} className="shrink-0 rounded px-1.5 py-1 text-[10px] text-text-dim transition hover:text-text">
                        Annuler
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-snug text-text">{n.texte}</p>
                    {n.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {n.tags.map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setTagFilter(t)}
                            className="rounded bg-surface px-1.5 py-0.5 text-[9px] text-text-dim transition hover:text-text"
                          >
                            #{t}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
