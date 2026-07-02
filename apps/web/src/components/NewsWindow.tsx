/**
 * Panneau « NEWS » — dockable à droite, NON MODAL (même pattern que DerivativesWindow).
 *
 * Liste dense horodatée des actualités crypto agrégées (CoinDesk, Cointelegraph, The
 * Block, Decrypt, Blockworks) via flux RSS/Atom (proxy /extapi). Le polling (3 min) n'est
 * actif que fenêtre OUVERTE. Ne capture pas les clics du graphe (panneau translaté hors
 * écran + pointer-events-none quand fermé).
 *
 * Filtres : plein texte + « symbole actif » (mots-clés dérivés du symbole affiché).
 * Marquage lu/non-lu léger (persisté). Dégradation par flux : une source en panne est
 * affichée en pied de panneau, sans erreur console en boucle.
 */
import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { marketStore } from "../store/market";
import { newsStore, newsUiStore } from "../store/news";
import {
  demarrerVeilleNews,
  estPertinentPourSymbole,
  NEWS_FEEDS,
  symbolKeywords,
  tempsRelatif,
  type FeedStatut,
  type NewsItem,
  type NewsSourceId,
} from "../data/news";

/** Métadonnées d'affichage par source (label + couleur du badge). */
const META_SOURCE: Record<NewsSourceId, { label: string; color: string }> = Object.fromEntries(
  NEWS_FEEDS.map((f) => [f.id, { label: f.label, color: f.color }])
) as Record<NewsSourceId, { label: string; color: string }>;

/** Libellé humain d'un statut de flux (pied de panneau). */
const LABEL_STATUT: Record<FeedStatut, string> = {
  ok: "ok",
  vide: "vide",
  erreur: "hors ligne",
};

/** Badge coloré de la source. */
function BadgeSource({ source }: { source: NewsSourceId }) {
  const meta = META_SOURCE[source];
  return (
    <span
      className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
      style={{ color: meta.color, border: `1px solid ${meta.color}55` }}
    >
      {meta.label}
    </span>
  );
}

/** Une ligne de news : puce non-lu, badge source, titre-lien, horodatage relatif. */
function LigneNews({
  item,
  lu,
  maintenant,
  onOuvrir,
}: {
  item: NewsItem;
  lu: boolean;
  maintenant: number;
  onOuvrir: (id: string) => void;
}) {
  const contenu = (
    <>
      <span className="mt-1 flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${lu ? "bg-transparent" : "bg-accent"}`}
        />
        <BadgeSource source={item.source} />
        <span className="tabular-nums text-[10px] text-text-dim">{tempsRelatif(item.time, maintenant)}</span>
      </span>
      <span className={`text-[12px] leading-snug ${lu ? "text-text-dim" : "text-text"}`}>{item.title}</span>
      {item.summary && <span className="text-[10px] leading-snug text-text-dim">{item.summary}</span>}
    </>
  );

  // Lien externe si disponible (nouvel onglet, rel de sécurité) ; sinon bloc non cliquable.
  if (item.link) {
    return (
      <a
        href={item.link}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => onOuvrir(item.id)}
        className="flex flex-col gap-1 border-b border-border px-3 py-2 transition hover:bg-bg"
      >
        {contenu}
      </a>
    );
  }
  return <div className="flex flex-col gap-1 border-b border-border px-3 py-2">{contenu}</div>;
}

export function NewsWindow() {
  const open = useStore(newsUiStore, (s) => s.open);
  const items = useStore(newsStore, (s) => s.items);
  const statuts = useStore(newsStore, (s) => s.statuts);
  const derniereMaj = useStore(newsStore, (s) => s.derniereMaj);
  const lus = useStore(newsStore, (s) => s.lus);
  const marquerLu = useStore(newsStore, (s) => s.marquerLu);
  const marquerLus = useStore(newsStore, (s) => s.marquerLus);
  const symbol = useStore(marketStore, (s) => s.symbol);

  const [filtre, setFiltre] = useState("");
  const [filtreSymbole, setFiltreSymbole] = useState(false);
  // Tick léger (30 s) pour rafraîchir les horodatages relatifs, uniquement fenêtre ouverte.
  const [maintenant, setMaintenant] = useState(() => Date.now());

  // Veille news + tick d'horloge conditionnés à l'ouverture (comme le polling des dérivés).
  useEffect(() => {
    if (!open) return;
    setMaintenant(Date.now());
    const stop = demarrerVeilleNews();
    const horloge = setInterval(() => setMaintenant(Date.now()), 30_000);
    return () => {
      stop();
      clearInterval(horloge);
    };
  }, [open]);

  const motsCles = useMemo(() => symbolKeywords(symbol), [symbol]);

  const visibles = useMemo(() => {
    const q = filtre.trim().toLowerCase();
    return items.filter((it) => {
      if (filtreSymbole && !estPertinentPourSymbole(it, motsCles)) return false;
      if (q.length === 0) return true;
      const meta = META_SOURCE[it.source];
      return (
        it.title.toLowerCase().includes(q) ||
        it.summary.toLowerCase().includes(q) ||
        meta.label.toLowerCase().includes(q)
      );
    });
  }, [items, filtre, filtreSymbole, motsCles]);

  const nonLus = visibles.reduce((n, it) => (lus.has(it.id) ? n : n + 1), 0);
  const fluxHs = NEWS_FEEDS.filter((f) => statuts[f.id] === "erreur");

  return (
    <>
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 font-mono">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-text">Actualités</h2>
          <p className="mt-0.5 text-[11px] text-text-dim">
            {derniereMaj === null
              ? "chargement…"
              : `${visibles.length} article${visibles.length > 1 ? "s" : ""} · ${nonLus} non lu${
                  nonLus > 1 ? "s" : ""
                } · maj ${tempsRelatif(derniereMaj, maintenant)}`}
          </p>
        </div>
        {/* close button removed — FloatingWindow chrome provides one */}
      </header>

      <div className="flex items-center gap-2 border-b border-border px-3 py-2 font-mono">
        <input
          type="text"
          value={filtre}
          onChange={(e) => setFiltre(e.target.value)}
          placeholder="Filtrer…"
          className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1 text-[11px] text-text placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-border"
        />
        <button
          type="button"
          onClick={() => setFiltreSymbole((v) => !v)}
          aria-pressed={filtreSymbole}
          title="Filtrer sur le symbole affiché"
          className={`shrink-0 rounded border px-2 py-1 text-[10px] uppercase tracking-wide transition ${
            filtreSymbole
              ? "border-accent/60 text-accent"
              : "border-border text-text-dim hover:text-text"
          }`}
        >
          {symbolKeywords(symbol).length > 0 ? `#${symbol}` : "symbole"}
        </button>
        <button
          type="button"
          onClick={() => marquerLus(visibles.map((it) => it.id))}
          title="Tout marquer comme lu"
          className="shrink-0 rounded border border-border px-2 py-1 text-[10px] uppercase tracking-wide text-text-dim transition hover:text-text"
        >
          Tout lu
        </button>
      </div>

      <div className="flex-1 overflow-y-auto font-mono">
        {visibles.length === 0 ? (
          <div className="px-3 py-4 text-[11px] leading-snug text-text-dim">
            {derniereMaj === null
              ? "Récupération des flux…"
              : filtreSymbole
                ? `Aucune actualité pour ${symbol}.`
                : "Aucune actualité (flux indisponibles ou filtre trop restrictif)."}
          </div>
        ) : (
          visibles.map((it) => (
            <LigneNews key={it.id} item={it} lu={lus.has(it.id)} maintenant={maintenant} onOuvrir={marquerLu} />
          ))
        )}
      </div>

      {fluxHs.length > 0 && (
        <p className="border-t border-border px-3 py-2 text-[10px] leading-snug text-text-dim font-mono">
          Hors ligne : {fluxHs.map((f) => `${f.label} (${LABEL_STATUT[statuts[f.id] ?? "erreur"]})`).join(", ")}
        </p>
      )}
    </>
  );
}
