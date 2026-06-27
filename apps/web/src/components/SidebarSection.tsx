/**
 * SidebarSection — en-tête uniforme des panneaux de la colonne droite.
 *
 * Harmonise le look « chaotique » des sections (Watchlist, Comparer, Dérivés,
 * Masse monétaire) : même eyebrow (libellé MAJUSCULE espacé), même padding,
 * même séparateur (border-t entre sections + border-b sous l'en-tête), et un
 * emplacement d'action optionnel à droite (badge, bouton refresh, …).
 *
 * Tokens sémantiques uniquement (border/text-dim) => cohérent avec tous les
 * thèmes, aucune couleur en dur.
 */
import type { ReactNode } from "react";

interface SidebarSectionProps {
  /** Titre affiché en eyebrow (MAJUSCULES). */
  title: string;
  /** Contenu optionnel aligné à droite de l'en-tête (badge, bouton…). */
  action?: ReactNode;
  /** Corps de la section. */
  children: ReactNode;
  /**
   * true => la section grandit et défile (cas Watchlist : `min-h-0 flex-1`).
   * false (défaut) => la section épouse la hauteur de son contenu.
   */
  grow?: boolean;
}

export function SidebarSection({ title, action, children, grow = false }: SidebarSectionProps) {
  return (
    <section
      className={`flex flex-col border-t border-border ${grow ? "min-h-0 flex-1" : "shrink-0"}`}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-dim">
          {title}
        </span>
        {action != null && <div className="flex items-center gap-1">{action}</div>}
      </header>
      {children}
    </section>
  );
}
