/**
 * DrawingToolbar — barre d'outils de dessin VERTICALE, à gauche du graphe.
 *
 * Boutons : Curseur (aucun overlay), Droite de tendance ('segment'), Ligne
 * horizontale ('horizontalStraightLine'), Rectangle ('rect'), Fib retracement
 * ('fibonacciLine'), puis « Effacer tout ». L'outil actif est mis en surbrillance
 * (lu depuis le `drawingStore` vanilla). Les clics délèguent à `selectTool` /
 * `clearAllOverlays`, qui pilotent l'instance KLineChart de façon impérative
 * (aucune donnée du moteur de rendu ne transite par le state React).
 */
import { useStore } from "zustand";
import {
  drawingStore,
  selectTool,
  clearAllOverlays,
  type DrawingToolId,
} from "../chart/drawing";

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
  { id: "fib", label: "Fib retracement", Icon: FibIcon },
];

export function DrawingToolbar() {
  const tool = useStore(drawingStore, (s) => s.tool);

  return (
    <nav
      className="flex w-10 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-neutral-800 bg-neutral-950 py-2"
      aria-label="Outils de dessin"
    >
      {TOOLS.map(({ id, label, Icon }) => {
        const active = tool === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => selectTool(id)}
            aria-pressed={active}
            title={label}
            className={`flex h-8 w-8 items-center justify-center rounded transition ${
              active
                ? "bg-accent text-bg"
                : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
            }`}
          >
            <Icon />
            <span className="sr-only">{label}</span>
          </button>
        );
      })}

      {/* Séparateur avant l'action destructive. */}
      <div className="my-1 h-px w-6 bg-neutral-800" />

      <button
        type="button"
        onClick={clearAllOverlays}
        title="Effacer tout"
        className="flex h-8 w-8 items-center justify-center rounded text-neutral-400 transition hover:bg-neutral-800 hover:text-down"
      >
        <TrashIcon />
        <span className="sr-only">Effacer tout</span>
      </button>
    </nav>
  );
}
