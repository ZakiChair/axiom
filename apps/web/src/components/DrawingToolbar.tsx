/**
 * DrawingToolbar — barre d'outils de dessin VERTICALE, à gauche du graphe.
 *
 * Boutons : Curseur (aucun overlay) puis les outils d'analyse (droites, canaux,
 * rectangle, Fibonacci, Fibonacci selon tendance), un bouton « Réglages Fibo » et
 * « Effacer tout ». L'outil actif est mis en surbrillance (lu depuis `drawingStore`).
 * Les clics délèguent à `selectTool` / `clearAllOverlays`, qui pilotent l'instance
 * KLineChart de façon impérative (aucune donnée du moteur ne transite par React).
 *
 * INFOBULLE thémée : au survol d'un outil, un libellé précise sa fonction. Elle est
 * positionnée en `fixed` (et non en absolute) pour échapper au `overflow` de la
 * barre — sinon elle serait rognée dès que la liste défile.
 */
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import {
  drawingStore,
  selectTool,
  clearAllOverlays,
  deleteSelectedDrawing,
  type DrawingToolId,
} from "../chart/drawing";
import {
  fibStore,
  COMMON_LEVELS,
  COMMON_EXTENSIONS,
} from "../chart/fibonacci";

/** Props communes aux icônes (trait fin, hérite la couleur du bouton). */
const ICON_PROPS = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className: "h-4 w-4",
};

/** Curseur (flèche de sélection). */
function CursorIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M5 3l6 16 2.2-6.3L19.5 11 5 3z" />
    </svg>
  );
}

/** Droite de tendance (segment diagonal à deux poignées). */
function TrendLineIcon() {
  return (
    <svg {...ICON_PROPS}>
      <line x1="4" y1="20" x2="20" y2="4" />
      <circle cx="4" cy="20" r="2" />
      <circle cx="20" cy="4" r="2" />
    </svg>
  );
}

/** Ligne horizontale. */
function HorizontalLineIcon() {
  return (
    <svg {...ICON_PROPS}>
      <line x1="3" y1="12" x2="21" y2="12" />
    </svg>
  );
}

/** Rectangle. */
function RectIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="4" y="6" width="16" height="12" rx="1" />
    </svg>
  );
}

/** Retracement de Fibonacci (niveaux horizontaux empilés). */
function FibIcon() {
  return (
    <svg {...ICON_PROPS}>
      <line x1="4" y1="5" x2="20" y2="5" />
      <line x1="4" y1="10" x2="20" y2="10" />
      <line x1="4" y1="15" x2="20" y2="15" />
      <line x1="4" y1="20" x2="20" y2="20" />
    </svg>
  );
}

/** Fibonacci selon tendance (niveaux + flèche directionnelle). */
function FibTrendIcon() {
  return (
    <svg {...ICON_PROPS}>
      <line x1="3" y1="6" x2="14" y2="6" />
      <line x1="3" y1="11" x2="14" y2="11" />
      <line x1="3" y1="16" x2="14" y2="16" />
      <path d="M15 19l5-13" />
      <path d="M20 6l-3 1 1 3" />
    </svg>
  );
}

/** Rayon (demi-droite depuis une origine). */
function RayIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="4" cy="20" r="2" />
      <line x1="4" y1="20" x2="21" y2="3" />
    </svg>
  );
}

/** Droite étendue (infinie dans les deux sens). */
function ExtendedIcon() {
  return (
    <svg {...ICON_PROPS}>
      <line x1="2" y1="22" x2="22" y2="2" />
    </svg>
  );
}

/** Rayon horizontal (support/résistance directionnel). */
function HorizontalRayIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="4" cy="12" r="2" />
      <line x1="4" y1="12" x2="21" y2="12" />
    </svg>
  );
}

/** Ligne verticale (marqueur temporel). */
function VerticalLineIcon() {
  return (
    <svg {...ICON_PROPS}>
      <line x1="12" y1="3" x2="12" y2="21" />
    </svg>
  );
}

/** Ligne de prix annotée. */
function PriceLineIcon() {
  return (
    <svg {...ICON_PROPS}>
      <line x1="3" y1="12" x2="15" y2="12" strokeDasharray="3 2" />
      <rect x="16" y="9" width="6" height="6" rx="1" />
    </svg>
  );
}

/** Canal parallèle. */
function ParallelChannelIcon() {
  return (
    <svg {...ICON_PROPS}>
      <line x1="4" y1="18" x2="20" y2="6" />
      <line x1="4" y1="22" x2="20" y2="10" />
    </svg>
  );
}

/** Canal de prix (horizontal). */
function PriceChannelIcon() {
  return (
    <svg {...ICON_PROPS}>
      <line x1="3" y1="8" x2="21" y2="8" />
      <line x1="3" y1="16" x2="21" y2="16" />
    </svg>
  );
}

/** Réglages Fibonacci (curseurs / sliders). */
function SlidersIcon() {
  return (
    <svg {...ICON_PROPS}>
      <line x1="4" y1="8" x2="20" y2="8" />
      <circle cx="9" cy="8" r="2" />
      <line x1="4" y1="16" x2="20" y2="16" />
      <circle cx="15" cy="16" r="2" />
    </svg>
  );
}

/** Corbeille (« Effacer tout »). */
function TrashIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2" />
      <path d="M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13" />
    </svg>
  );
}

/** Définition d'un outil de dessin (id store + libellé infobulle + icône). */
interface ToolDef {
  id: DrawingToolId;
  label: string;
  Icon: () => JSX.Element;
}

const TOOLS: ToolDef[] = [
  { id: "cursor", label: "Curseur", Icon: CursorIcon },
  { id: "trendLine", label: "Droite de tendance", Icon: TrendLineIcon },
  { id: "ray", label: "Rayon", Icon: RayIcon },
  { id: "extended", label: "Droite étendue", Icon: ExtendedIcon },
  { id: "horizontalLine", label: "Ligne horizontale", Icon: HorizontalLineIcon },
  { id: "horizontalRay", label: "Rayon horizontal", Icon: HorizontalRayIcon },
  { id: "verticalLine", label: "Ligne verticale", Icon: VerticalLineIcon },
  { id: "priceLine", label: "Ligne de prix", Icon: PriceLineIcon },
  { id: "parallelChannel", label: "Canal parallèle", Icon: ParallelChannelIcon },
  { id: "priceChannel", label: "Canal de prix", Icon: PriceChannelIcon },
  { id: "rect", label: "Rectangle", Icon: RectIcon },
  { id: "fib", label: "Retracement de Fibonacci", Icon: FibIcon },
  { id: "fibTrend", label: "Fibonacci selon tendance", Icon: FibTrendIcon },
];

/** Panneau de réglages Fibonacci (niveaux à cocher, zones, ajout libre, reset). */
function FibSettingsPanel({ onClose }: { onClose: () => void }) {
  const levels = useStore(fibStore, (s) => s.levels);
  const extensions = useStore(fibStore, (s) => s.extensions);
  const showZones = useStore(fibStore, (s) => s.showZones);
  const toggleRatio = useStore(fibStore, (s) => s.toggleRatio);
  const addRatio = useStore(fibStore, (s) => s.addRatio);
  const setShowZones = useStore(fibStore, (s) => s.setShowZones);
  const reset = useStore(fibStore, (s) => s.reset);

  const [draft, setDraft] = useState("");

  const submitAdd = () => {
    const v = Number.parseFloat(draft.replace(",", "."));
    if (Number.isFinite(v)) addRatio(v);
    setDraft("");
  };

  const Chip = ({ r, active }: { r: number; active: boolean }) => (
    <button
      type="button"
      onClick={() => toggleRatio(r)}
      className={`rounded px-1.5 py-0.5 text-[11px] tabular-nums transition ${
        active
          ? "bg-accent text-accent-ink"
          : "border border-border text-text-dim hover:text-text"
      }`}
    >
      {String(r)}
    </button>
  );

  return (
    <>
      {/* Fond cliquable : ferme le panneau. */}
      <div onClick={onClose} className="fixed inset-0 z-40" aria-hidden />
      <div
        role="dialog"
        aria-label="Réglages Fibonacci"
        className="fixed bottom-3 left-12 z-50 max-h-[80vh] w-60 overflow-y-auto rounded-md border border-border bg-surface p-3 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-dim">
            Fibonacci
          </span>
          <button
            type="button"
            onClick={reset}
            className="text-[10px] text-text-dim transition hover:text-text"
            title="Réinitialiser les niveaux par défaut"
          >
            réinitialiser
          </button>
        </div>

        <label className="mt-3 flex items-center gap-2 text-[11px] text-text-dim">
          <input
            type="checkbox"
            checked={showZones}
            onChange={(e) => setShowZones(e.target.checked)}
            className="h-3 w-3 accent-[var(--accent)]"
          />
          <span>Zones colorées entre niveaux</span>
        </label>

        <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-text-dim">
          Niveaux de retracement
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {COMMON_LEVELS.map((r) => (
            <Chip key={r} r={r} active={levels.includes(r)} />
          ))}
        </div>

        <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-text-dim">
          Projection (selon tendance)
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {COMMON_EXTENSIONS.map((r) => (
            <Chip key={r} r={r} active={extensions.includes(r)} />
          ))}
        </div>

        <div className="mt-3 flex gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitAdd();
            }}
            placeholder="ex. 0.666"
            inputMode="decimal"
            spellCheck={false}
            className="w-full rounded border border-border bg-bg px-2 py-1 text-[11px] text-text outline-none placeholder:text-text-dim focus:border-accent"
          />
          <button
            type="button"
            onClick={submitAdd}
            className="shrink-0 rounded bg-accent px-2 py-1 text-[11px] font-medium text-accent-ink transition hover:opacity-90"
          >
            +
          </button>
        </div>

        <p className="mt-2 text-[10px] leading-snug text-text-dim">
          Les niveaux ≤ 1 s'appliquent au retracement ; &gt; 1 à la projection « selon
          tendance ». Couleurs synchronisées avec le thème.
        </p>
      </div>
    </>
  );
}

export function DrawingToolbar() {
  const tool = useStore(drawingStore, (s) => s.tool);
  // Infobulle survolée : libellé + position verticale (px viewport).
  const [hover, setHover] = useState<{ label: string; y: number } | null>(null);
  const [fibPanelOpen, setFibPanelOpen] = useState(false);

  // Suppr/Backspace supprime le dessin sélectionné (clic gauche). Ignoré pendant la
  // saisie dans un champ (watchlist, recherche, réglages Fibo…) pour ne pas avaler
  // la frappe. Écouteur global monté une fois (la barre d'outils est toujours montée).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (deleteSelectedDrawing()) e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const showTip = (label: string) => (e: { currentTarget: HTMLElement }) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover({ label, y: r.top + r.height / 2 });
  };
  const hideTip = () => setHover(null);

  return (
    <>
      <nav
        className="flex w-10 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-border bg-surface py-2"
        aria-label="Outils de dessin"
      >
        {TOOLS.map(({ id, label, Icon }) => {
          const active = tool === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => selectTool(id)}
              onMouseEnter={showTip(label)}
              onMouseLeave={hideTip}
              onFocus={showTip(label)}
              onBlur={hideTip}
              aria-pressed={active}
              aria-label={label}
              className={`flex h-8 w-8 items-center justify-center rounded transition ${
                active
                  ? "bg-accent text-accent-ink shadow-[var(--accent-glow)]"
                  : "text-text-dim hover:bg-bg hover:text-text"
              }`}
            >
              <Icon />
            </button>
          );
        })}

        {/* Séparateur. */}
        <div className="my-1 h-px w-6 bg-border" />

        {/* Réglages Fibonacci. */}
        <button
          type="button"
          onClick={() => setFibPanelOpen((o) => !o)}
          onMouseEnter={showTip("Réglages Fibonacci")}
          onMouseLeave={hideTip}
          onFocus={showTip("Réglages Fibonacci")}
          onBlur={hideTip}
          aria-pressed={fibPanelOpen}
          aria-label="Réglages Fibonacci"
          className={`flex h-8 w-8 items-center justify-center rounded transition ${
            fibPanelOpen
              ? "bg-accent text-accent-ink shadow-[var(--accent-glow)]"
              : "text-text-dim hover:bg-bg hover:text-text"
          }`}
        >
          <SlidersIcon />
        </button>

        {/* Effacer tout. */}
        <button
          type="button"
          onClick={clearAllOverlays}
          onMouseEnter={showTip("Effacer tout")}
          onMouseLeave={hideTip}
          onFocus={showTip("Effacer tout")}
          onBlur={hideTip}
          aria-label="Effacer tout"
          className="flex h-8 w-8 items-center justify-center rounded text-text-dim transition hover:bg-bg hover:text-down"
        >
          <TrashIcon />
        </button>
      </nav>

      {/* Infobulle thémée (fixed → jamais rognée par le scroll de la barre). */}
      {hover && (
        <div
          role="tooltip"
          style={{ top: hover.y }}
          className="pointer-events-none fixed left-11 z-50 -translate-y-1/2 whitespace-nowrap rounded border border-border bg-surface px-2 py-1 text-[11px] text-text shadow-lg"
        >
          {hover.label}
        </div>
      )}

      {fibPanelOpen && <FibSettingsPanel onClose={() => setFibPanelOpen(false)} />}
    </>
  );
}
