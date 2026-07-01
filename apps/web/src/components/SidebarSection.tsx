/**
 * SidebarSection — en-tête uniforme des panneaux de la colonne droite, repliable.
 *
 * Harmonise le look des sections (Watchlist, Comparer, Dérivés, Masse monétaire) :
 * même eyebrow (libellé MAJUSCULE espacé), même padding, même séparateur, et un
 * emplacement d'action optionnel à droite (badge, bouton refresh, …).
 *
 * REPLIABLE (accordéon) : avec `collapsible`, l'en-tête devient cliquable (chevron
 * ▼/▶) et les enfants sont DÉMONTÉS quand la section est repliée. La Watchlist reste
 * ouverte par défaut et occupe l'espace (`grow`) ; Dérivés / Macro / Comparer sont
 * repliés par défaut pour ne pas écraser les paires. Le slot `action` reste frère du
 * bouton de bascule (cliquer « rafraîchir » ne replie pas la section).
 *
 * ÉTAT CONTRÔLÉ : le pli/dépli vit dans `uiSectionsStore` (indexé par `title`), et non
 * plus dans un `useState` local — il devient ainsi PERSISTABLE (persist.ts) et capturé
 * par les workspaces, tout en restant piloté par clic. `defaultOpen` sert de repli tant
 * que la section n'a jamais été (dé)pliée manuellement.
 *
 * Tokens sémantiques uniquement (border/text-dim) => cohérent avec tous les thèmes.
 */
import type { ReactNode } from "react";
import { useStore } from "zustand";
import { uiSectionsStore } from "../store/ui-sections";

interface SidebarSectionProps {
  /** Titre affiché en eyebrow (MAJUSCULES). */
  title: string;
  /** Contenu optionnel aligné à droite de l'en-tête (badge, bouton…). Caché si replié. */
  action?: ReactNode;
  /** Corps de la section. */
  children: ReactNode;
  /**
   * true => la section grandit et défile quand OUVERTE (cas Watchlist : `min-h-0 flex-1`).
   * false (défaut) => la section épouse la hauteur de son contenu.
   */
  grow?: boolean;
  /** Section repliable (en-tête cliquable + chevron). Défaut false (en-tête statique). */
  collapsible?: boolean;
  /** Ouverte par défaut quand repliable. Défaut true. */
  defaultOpen?: boolean;
  /** Compteur/pastille affiché près du titre (ex. « 3 paires »). */
  badge?: ReactNode;
}

export function SidebarSection({
  title,
  action,
  children,
  grow = false,
  collapsible = false,
  defaultOpen = true,
  badge,
}: SidebarSectionProps) {
  // État de pli lu dans le store (clé = titre) ; retombe sur `defaultOpen` si jamais (dé)plié.
  const open = useStore(uiSectionsStore, (s) => s.open[title] ?? defaultOpen);
  const isOpen = !collapsible || open;

  // Grandit/défile uniquement si OUVERTE et `grow` ; sinon épouse son contenu.
  const sectionClass = `flex flex-col border-t border-border ${
    isOpen && grow ? "min-h-0 flex-1" : "shrink-0"
  }`;

  const titleNode = (
    <span className="flex items-center gap-1.5">
      {collapsible && (
        <span aria-hidden className="w-2 text-[9px] leading-none text-text-dim">
          {isOpen ? "▼" : "▶"}
        </span>
      )}
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-dim">
        {title}
      </span>
      {badge != null && (
        <span className="text-[10px] font-normal normal-case tracking-normal text-text-dim">
          {badge}
        </span>
      )}
    </span>
  );

  return (
    <section className={sectionClass}>
      <header
        className={`flex items-center justify-between gap-2 px-3 py-2 ${
          isOpen ? "border-b border-border" : ""
        }`}
      >
        {collapsible ? (
          <button
            type="button"
            onClick={() => uiSectionsStore.getState().toggle(title, defaultOpen)}
            aria-expanded={isOpen}
            className="flex flex-1 items-center text-left transition hover:opacity-80"
          >
            {titleNode}
          </button>
        ) : (
          titleNode
        )}
        {action != null && isOpen && <div className="flex items-center gap-1">{action}</div>}
      </header>
      {isOpen && children}
    </section>
  );
}
