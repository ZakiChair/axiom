/**
 * Panneau « NEWS » — dockable à droite, NON MODAL (même pattern que DerivativesWindow).
 *
 * Liste dense horodatée des actualités crypto agrégées (CoinDesk, Cointelegraph, The
 * Block, Decrypt, Blockworks, Finnhub général) via flux RSS/Atom (proxy /extapi) + Finnhub
 * (appel direct). Le polling (3 min) n'est actif que fenêtre OUVERTE. Ne capture pas les
 * clics du graphe (panneau translaté hors écran + pointer-events-none quand fermé).
 *
 * Filtres : plein texte + « symbole actif » (mots-clés dérivés du symbole affiché) — ce
 * dernier pose EN PLUS les mots-clés GDELT de la veille PARTAGÉE (`definirMotsClesVeille`,
 * cf. data/news.ts : une seule boucle, pas de veille dédiée ; dégradation silencieuse si
 * GDELT est indisponible). Marquage lu/non-lu léger (persisté).
 * Dégradation par flux : une source en panne est affichée en pied de panneau, sans erreur
 * console en boucle. Bandeau Fear & Greed en en-tête (cf. data/marketOverview).
 */
import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { marketStore } from "../store/market";
import { newsStore, newsUiStore } from "../store/news";
import { EnTeteFenetre } from "./ui";
import {
  definirMotsClesVeille,
  demarrerVeilleNews,
  estPertinentPourSymbole,
  NEWS_FEEDS,
  symbolKeywords,
  type FeedStatut,
  type NewsItem,
  type NewsSourceId,
} from "../data/news";
import { fetchFearGreed, type FearGreed } from "../data/marketOverview";
import { formatAge } from "../lib/format";
import { navigateTo } from "../lib/navigation";

/** Intervalle de rafraîchissement du bandeau Fear & Greed (l'indice évolue au plus 1×/jour). */
const FNG_REFRESH_MS = 5 * 60_000;

/**
 * Valide qu'une URL est sûre à rendre en `href` (http/https uniquement). `item.link`
 * provient de flux RSS/Atom/JSON EXTERNES non fiables — sans ce garde-fou, une valeur
 * `javascript:` renvoyée par un flux (ou un cache corrompu) s'exécuterait au clic.
 * PURE, ne lève jamais. (Même garde-fou que `FundWindow.tsx#urlHttpSure`, dupliqué ici
 * par convention — petits helpers purs par fichier, cf. `readToken`.)
 */
function urlHttpSure(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** Bandeau compact de l'indice Fear & Greed (en-tête du panneau). */
function BandeauFearGreed({ fng }: { fng: FearGreed | null }) {
  if (fng === null) return null;
  return (
    <span
      className="shrink-0 rounded border border-border px-2 py-1 text-[10px] uppercase tracking-wide text-text-dim"
      title="Indice Fear & Greed (alternative.me)"
    >
      F&amp;G <span className="tabular-nums text-text">{fng.value}</span>
      {fng.classification && <span className="ml-1">{fng.classification}</span>}
    </span>
  );
}

/**
 * Métadonnées d'affichage par source (label + couleur du badge). GDELT est une source
 * DYNAMIQUE (ciblée par symbole, cf. en-tête du fichier) — volontairement absente de
 * `NEWS_FEEDS` — donc ajoutée à part ici, sinon `META_SOURCE["gdelt"]` est `undefined`
 * et fait planter `BadgeSource`/le filtre dès qu'un article GDELT est rendu. Les couleurs
 * par source sont des couleurs de MARQUE, volontairement hors thème (badges de source).
 */
const META_SOURCE: Record<NewsSourceId, { label: string; color: string }> = {
  ...(Object.fromEntries(NEWS_FEEDS.map((f) => [f.id, { label: f.label, color: f.color }])) as Record<
    NewsSourceId,
    { label: string; color: string }
  >),
  gdelt: { label: "GDELT", color: "#ec4899" },
};

/** Libellé humain d'un statut de flux (pied de panneau). */
const LABEL_STATUT: Record<FeedStatut, string> = {
  ok: "ok",
  vide: "vide",
  erreur: "hors ligne",
};

/** Attribution permanente des sources (pied de panneau), comme les autres fenêtres. */
const SOURCES_LABEL = NEWS_FEEDS.map((f) => f.label).join(" · ");

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

/** Pose un marqueur chart à l'horodatage de l'article (bus C2) + marque lu. */
function ouvrirNews(item: NewsItem, onOuvrir: (id: string) => void): void {
  onOuvrir(item.id);
  if (item.time > 0) {
    navigateTo({
      markTime: item.time,
      markLabel: item.title,
      source: "news",
    });
  }
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
        <span className="tabular-nums text-[10px] text-text-dim">{formatAge(item.time, maintenant)}</span>
      </span>
      <span className={`text-[12px] leading-snug ${lu ? "text-text-dim" : "text-text"}`}>{item.title}</span>
      {item.summary && <span className="text-[10px] leading-snug text-text-dim">{item.summary}</span>}
    </>
  );

  // Lien externe si disponible ET de schéma sûr (nouvel onglet, rel de sécurité) ; sinon
  // bouton qui marque le chart (lien absent OU schéma non http/https, ex. `javascript:`).
  const lien = urlHttpSure(item.link);
  if (lien !== null) {
    return (
      <a
        href={lien}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => ouvrirNews(item, onOuvrir)}
        className="flex flex-col gap-1 border-b border-border px-3 py-2 transition hover:bg-bg"
        title="Ouvrir l'article + marquer sur le chart"
      >
        {contenu}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={() => ouvrirNews(item, onOuvrir)}
      className="flex w-full flex-col gap-1 border-b border-border px-3 py-2 text-left transition hover:bg-bg"
      title="Marquer sur le chart"
    >
      {contenu}
    </button>
  );
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
  const [fng, setFng] = useState<FearGreed | null>(null);

  const motsCles = useMemo(() => symbolKeywords(symbol), [symbol]);

  // Mots-clés GDELT de la veille PARTAGÉE : posés quand le filtre symbole est actif,
  // remis à null sinon et à la fermeture/démontage (cleanup). Un changement de symbole ou
  // du filtre repasse ici (deps) — definirMotsClesVeille déclenche alors un cycle immédiat
  // côté veille (pas de boucle dédiée, cf. data/news.ts). Déclaré AVANT l'effet de veille
  // pour que le premier cycle à l'ouverture parte déjà avec les bons mots-clés.
  useEffect(() => {
    if (!open) return;
    definirMotsClesVeille(filtreSymbole ? motsCles : null);
    return () => definirMotsClesVeille(null);
  }, [open, filtreSymbole, motsCles]);

  // Veille news partagée (refcomptée) + tick d'horloge, conditionnées à l'ouverture
  // (comme le polling des dérivés).
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

  // Bandeau Fear & Greed : réutilise `fetchFearGreed` (déjà appelé par MarketMapWindow),
  // sans store partagé — la fonction a son propre cache localStorage 1 h, un second appelant
  // ne duplique donc pas la requête réseau au-delà de la fenêtre de fraîcheur.
  useEffect(() => {
    if (!open) return;
    let ignore = false;
    const charger = () => {
      void fetchFearGreed().then((v) => {
        if (!ignore) setFng(v);
      });
    };
    charger();
    const timer = setInterval(charger, FNG_REFRESH_MS);
    return () => {
      ignore = true;
      clearInterval(timer);
    };
  }, [open]);

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
      {/* En-tête standard (croix de fermeture fournie par le chrome FloatingWindow). */}
      <EnTeteFenetre
        titre="NEWS · Actualités"
        sousTitre={
          derniereMaj === null
            ? "Chargement…"
            : `${visibles.length} article${visibles.length > 1 ? "s" : ""} · ${nonLus} non lu${
                nonLus > 1 ? "s" : ""
              } · maj ${formatAge(derniereMaj, maintenant)}`
        }
        actions={<BandeauFearGreed fng={fng} />}
      />

      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <input
          type="text"
          value={filtre}
          onChange={(e) => setFiltre(e.target.value)}
          placeholder="Filtrer…"
          className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1 text-[11px] text-text placeholder:text-text-dim outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={() => setFiltreSymbole((v) => !v)}
          aria-pressed={filtreSymbole}
          title="Filtrer sur le symbole affiché"
          className={`shrink-0 rounded border border-border px-2 py-1 text-[10px] uppercase tracking-wide transition ${
            filtreSymbole ? "bg-surface text-text" : "text-text-dim hover:text-text"
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

      <div className="flex-1 overflow-y-auto">
        {visibles.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] leading-snug text-text-dim">
            {derniereMaj === null
              ? "Chargement…"
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

      {/* Attribution permanente des sources (comme les autres fenêtres) ; les flux hors
          ligne éventuels sont signalés à la suite plutôt que dans un pied séparé. */}
      <p className="border-t border-border px-3 py-2 text-[10px] leading-snug text-text-dim">
        {SOURCES_LABEL}
        {fluxHs.length > 0 &&
          ` · Hors ligne : ${fluxHs
            .map((f) => `${f.label} (${LABEL_STATUT[statuts[f.id] ?? "erreur"]})`)
            .join(", ")}`}
      </p>
    </>
  );
}
