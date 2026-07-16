/**
 * TickerBand — bandeau d'actualités défilant façon Bloomberg TV, permanent sous la
 * Toolbar (enfant flex de la colonne App : le workspace des fenêtres flottantes,
 * mesuré par chartAreaRef, se rétrécit automatiquement). Second lecteur du
 * `newsStore` (comme NewsWindow) : headlines crypto + macro/tradfi (Bloomberg
 * economics, CNBC Economy, Finnhub forex — cf. NEWS_FEEDS).
 *
 * Contrat de perf (comme SymbolBanner) : AUCUN re-render React par tick/frame. Le
 * défilement est une animation CSS `transform: translateX` continue (boucle infinie
 * par DUPLICATION du contenu, translation de −50 %) — le seul re-render React est
 * l'arrivée de nouveaux items du store (basse fréquence : cycle de veille 3 min) ou
 * la bascule de visibilité. Les âges relatifs sont donc figés entre deux cycles
 * (dérive max ~3 min, assumée — pas d'horloge de re-render qui casserait le contrat).
 *
 * Veille : le bandeau démarre/arrête LUI-MÊME `demarrerVeilleNews()` quand il est
 * visible (autonome vis-à-vis du panneau NEWS) ; la boucle est PARTAGÉE refcomptée
 * côté data/news — panneau et bandeau ouverts ensemble ne font qu'un seul polling.
 *
 * Le CSS (keyframes, pause au survol, prefers-reduced-motion → liste statique
 * tronquée par overflow) est injecté par un <style> local : index.css est hors du
 * périmètre de cette feature, et ces règles ne servent qu'ici.
 */
import { useEffect, type CSSProperties } from "react";
import { useStore } from "zustand";
import { newsStore } from "../store/news";
import { tickerBandStore } from "../store/tickerBand";
import {
  demarrerVeilleNews,
  tempsRelatif,
  NEWS_FEEDS,
  type FeedStatut,
  type NewsItem,
  type NewsSourceId,
} from "../data/news";
import { META_SOURCE } from "../data/newsMeta";

/** Nombre max de headlines dans la piste (borne le DOM ; les items sont triés récents d'abord). */
const MAX_ITEMS = 30;
/** Vitesse de défilement visée (px/s) — la durée de l'animation en découle. */
const VITESSE_PX_S = 70;
/** Largeur estimée d'un caractère de titre (px, texte 11px) pour dimensionner la durée. */
const PX_PAR_CAR = 6;
/** Surcoût estimé par item (badge + âge + séparateur + espacements, px). */
const PX_PAR_ITEM = 170;
/**
 * Palier d'arrondi de la durée d'animation (s). Modifier `--ticker-duree` en cours
 * d'animation fait SAUTER la piste (le temps écoulé est conservé mais la fraction de
 * progression change avec la durée) : arrondir au palier supérieur rend la durée stable
 * entre deux cycles de veille au contenu proche. Limite assumée : quand le contenu varie
 * assez pour franchir un palier, la piste saute une fois (rare, ~toutes les 3 min max).
 */
const PALIER_DUREE_S = 30;

/**
 * Durée (s) du défilement d'UNE copie de la piste : largeur estimée du contenu ÷ vitesse,
 * arrondie au PALIER supérieur (cf. PALIER_DUREE_S — stabilité entre cycles). PURE
 * (testée dans TickerBand.test.ts).
 */
export function dureeDefilementS(defilants: readonly { title: string }[]): number {
  const largeurPx = defilants.reduce((px, it) => px + it.title.length * PX_PAR_CAR + PX_PAR_ITEM, 0);
  return Math.max(PALIER_DUREE_S, Math.ceil(largeurPx / VITESSE_PX_S / PALIER_DUREE_S) * PALIER_DUREE_S);
}

/**
 * true quand AUCUN des flux `ids` n'est « ok » NI en attente (statut absent = premier
 * cycle pas encore terminé) — c.-à-d. tous en « erreur »/« vide » : plus rien à espérer
 * du cycle courant. Sert à distinguer « Chargement… » d'« Actualités indisponibles ».
 * PURE (testée dans TickerBand.test.ts).
 */
export function aucunFluxActif(
  ids: readonly NewsSourceId[],
  statuts: Partial<Record<NewsSourceId, FeedStatut>>
): boolean {
  return ids.every((id) => {
    const s = statuts[id];
    return s !== undefined && s !== "ok";
  });
}

/** Ids des flux interrogés par la veille (les statuts des autres sources — gdelt — sont ignorés). */
const IDS_FLUX: readonly NewsSourceId[] = NEWS_FEEDS.map((f) => f.id);

/**
 * Valide qu'une URL est sûre à rendre en `href` (http/https uniquement). `item.link`
 * provient de flux RSS/Atom/JSON EXTERNES non fiables — sans ce garde-fou, une valeur
 * `javascript:` renvoyée par un flux s'exécuterait au clic. PURE, ne lève jamais.
 * (Même garde-fou que `NewsWindow.tsx#urlHttpSure`, dupliqué ici par convention —
 * petits helpers purs par fichier.)
 */
function urlHttpSure(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * CSS du défilement — injecté localement (cf. en-tête). Boucle infinie : la piste
 * contient DEUX copies du contenu et se translate de −50 % (une largeur de copie)
 * avant de reboucler, sans couture. Pause au survol (lecture / clic). Mouvement
 * réduit : animation coupée → la première copie s'affiche en liste statique
 * tronquée par l'overflow-hidden du conteneur.
 */
const CSS_TICKER = `
@keyframes axiom-ticker-defile {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}
.axiom-ticker-piste {
  animation: axiom-ticker-defile var(--ticker-duree, 120s) linear infinite;
  will-change: transform;
}
.axiom-ticker:hover .axiom-ticker-piste { animation-play-state: paused; }
@media (prefers-reduced-motion: reduce) {
  .axiom-ticker-piste { animation: none; }
}
`;

/** Une headline de la piste : badge source, titre (lien si sûr), âge relatif. */
function ItemTicker({ item, maintenant }: { item: NewsItem; maintenant: number }) {
  const meta = META_SOURCE[item.source];
  const contenu = (
    <>
      <span
        className="shrink-0 rounded px-1 text-[9px] font-semibold uppercase tracking-wide"
        style={{ color: meta.color, border: `1px solid ${meta.color}55` }}
      >
        {meta.label}
      </span>
      <span className="whitespace-nowrap text-[11px] text-text">{item.title}</span>
      <span className="whitespace-nowrap tabular-nums text-[10px] text-text-dim">
        {tempsRelatif(item.time, maintenant)}
      </span>
    </>
  );

  // Lien externe si disponible ET de schéma sûr (nouvel onglet, rel de sécurité) ;
  // sinon bloc non cliquable — même convention que LigneNews (NewsWindow).
  // tabIndex=-1 : jusqu'à ~60 liens (2 copies × MAX_ITEMS) feraient un piège clavier, et
  // focaliser un lien hors viewport déclenche un scroll-into-view natif qui corrompt le
  // scrollLeft du conteneur overflow-hidden (combiné au translateX animé). Les mêmes
  // headlines restent accessibles au clavier via la fenêtre NEWS — choix assumé.
  const lien = urlHttpSure(item.link);
  const classes = "flex items-center gap-2";
  return (
    <span className="flex items-center">
      {lien !== null ? (
        <a
          href={lien}
          target="_blank"
          rel="noopener noreferrer"
          tabIndex={-1}
          title={item.title}
          className={`${classes} hover:underline`}
        >
          {contenu}
        </a>
      ) : (
        <span className={classes}>{contenu}</span>
      )}
      <span aria-hidden="true" className="mx-4 h-3 w-px shrink-0 bg-border" />
    </span>
  );
}

/**
 * Rend la copie de bouclage inerte (invisible à l'accessibilité ET infocalisable) —
 * complète l'aria-hidden, qui seul laisse les liens focalisables (violation ARIA).
 * React 18 ne type pas la prop `inert` : on la pose impérativement via ref.
 */
function rendreInerte(el: HTMLDivElement | null): void {
  if (el !== null) el.inert = true;
}

export function TickerBand() {
  const visible = useStore(tickerBandStore, (s) => s.visible);
  const items = useStore(newsStore, (s) => s.items);
  // Booléen dérivé (sélecteur → re-render uniquement quand il bascule, basse fréquence) :
  // tous les flux ont terminé leur cycle en erreur/vide et rien à afficher.
  const indisponible = useStore(newsStore, (s) => s.items.length === 0 && aucunFluxActif(IDS_FLUX, s.statuts));

  // Veille autonome, active uniquement bandeau visible (boucle partagée refcomptée
  // avec NewsWindow côté data/news — pas de double polling si les deux sont montés).
  useEffect(() => {
    if (!visible) return;
    const stop = demarrerVeilleNews();
    return stop;
  }, [visible]);

  if (!visible) return null;

  const defilants = items.slice(0, MAX_ITEMS);
  // Figé au render (re-render = arrivée d'items, ≤ 3 min) — cf. contrat de perf en tête.
  const maintenant = Date.now();
  // Durée ∝ largeur estimée d'une copie, arrondie par paliers (cf. dureeDefilementS).
  const dureeS = dureeDefilementS(defilants);

  return (
    <div
      className="axiom-ticker relative h-7 shrink-0 overflow-hidden border-b border-border bg-surface"
      // Ceinture-bretelles : overflow-hidden reste un scroll container — tout scroll
      // programmatique résiduel (scroll-into-view d'un focus, find-in-page…) décalerait
      // DÉFINITIVEMENT la piste animée en translateX. On repart toujours de 0.
      onScroll={(e) => {
        e.currentTarget.scrollLeft = 0;
      }}
    >
      <style>{CSS_TICKER}</style>
      {defilants.length === 0 ? (
        <div className="flex h-full items-center px-3 text-[11px] text-text-dim">
          {/* Sobre (text-dim, pas d'alarme) : l'indisponibilité des flux n'est pas critique. */}
          {indisponible
            ? "Actualités indisponibles (⌘K TICKER pour masquer)"
            : "Chargement des actualités… (⌘K TICKER pour masquer)"}
        </div>
      ) : (
        <div
          className="axiom-ticker-piste flex h-full w-max items-center"
          style={{ "--ticker-duree": `${dureeS}s` } as CSSProperties}
        >
          {/* Deux copies identiques : la seconde (décor de bouclage) est masquée aux
              lecteurs d'écran ET rendue inerte (sinon ses liens resteraient focalisables
              malgré aria-hidden — violation ARIA). */}
          {[0, 1].map((copie) => (
            <div
              key={copie}
              ref={copie === 1 ? rendreInerte : undefined}
              aria-hidden={copie === 1}
              className="flex h-full items-center pl-3"
            >
              {defilants.map((it) => (
                <ItemTicker key={`${copie}:${it.id}`} item={it} maintenant={maintenant} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
