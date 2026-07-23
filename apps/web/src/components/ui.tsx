/**
 * Primitives d'interface partagées entre fenêtres — le standard visuel AXIOM.
 *
 * Chaque primitive consacre le pattern DOMINANT relevé par l'audit d'uniformité
 * (2026-07-09) et remplace des copies locales (Metric ×2, trio
 * Chargement/Indisponible/SansCle de FundWindow, badges ×3, onglets ×N…).
 * Uniquement du MARKUP : aucune logique, aucun état — les comportements restent
 * dans les fenêtres (testables sans DOM, contrat vitest node du repo).
 *
 * Couleurs exclusivement via les tokens sémantiques (bg-bg, text-text-dim,
 * border-down/40…) : tout suit le thème courant sans travail supplémentaire.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  LABEL_NIVEAU,
  type MetaFiabilite,
  type NiveauFiabilite,
} from "../lib/fiabilite";
import { formatAge, VALEUR_ABSENTE } from "../lib/format";
import {
  type Referentiel,
  texteRef,
  estExtreme,
} from "../lib/referentiel";

/** Classes du bouton secondaire standard (recalculer, exporter, choisir…). */
export const BTN_SECONDAIRE =
  "rounded border border-border bg-bg px-2 py-1 text-[11px] text-text-dim transition hover:text-text";

/**
 * Calcule l'index de l'élément à focaliser lors d'une navigation clavier « roving »
 * dans un menu de `nb` éléments, depuis l'index `courant` (-1 = aucun focus).
 * ↑/↓ bouclent aux extrémités ; Home/End sautent aux bords. Fonction PURE (le
 * MenuDeroulant est ainsi testable sans DOM — convention vitest node du repo).
 */
export function indexRoving(
  nb: number,
  courant: number,
  touche: "ArrowDown" | "ArrowUp" | "Home" | "End",
): number {
  if (nb <= 0) return -1;
  switch (touche) {
    case "ArrowDown":
      return courant < 0 ? 0 : (courant + 1) % nb;
    case "ArrowUp":
      return courant < 0 ? nb - 1 : (courant - 1 + nb) % nb;
    case "Home":
      return 0;
    case "End":
      return nb - 1;
  }
}

/**
 * Menu déroulant contrôlé et unifié de la Toolbar (remplace les copies locales
 * divergentes relevées par l'audit). Comportements standard : ouverture au clic,
 * fermeture sur Échap, clic extérieur (mousedown document) et sélection (via
 * `fermer`), navigation clavier ↑/↓/Home/End en focus roving sur les
 * [role=menuitem], panneau borné `max-h-[70vh]` scrollable (corrige le
 * débordement du menu Fonctions hors écran sur laptop). AUCUNE dépendance :
 * positionnement absolu simple sous le déclencheur, comme les menus d'origine.
 *
 * Le déclencheur (bouton + chevron ▾) est rendu par la primitive pour un rendu
 * uniforme ; `declencheur` en fournit uniquement le libellé. Le contenu métier
 * passe par un render-prop recevant `fermer`, à appeler après une sélection.
 */
export function MenuDeroulant({
  declencheur,
  titre,
  ariaLabel,
  align = "left",
  classePanneau = "w-60",
  declencheurClasse = "flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-xs text-text hover:border-text-dim",
  chevron = true,
  children,
}: {
  /** Contenu du bouton déclencheur (libellé) — le chevron ▾ est ajouté par la primitive. */
  declencheur: ReactNode;
  /** Infobulle (attribut `title`) du bouton déclencheur. */
  titre?: string;
  /** Nom accessible du déclencheur — requis quand `declencheur` est une icône seule (⚙). */
  ariaLabel?: string;
  /** Bord d'alignement du panneau sous le déclencheur. */
  align?: "left" | "right";
  /** Classe de largeur du panneau (défaut `w-60`). */
  classePanneau?: string;
  /** Classes du bouton déclencheur (défaut : bouton bordé standard). */
  declencheurClasse?: string;
  /** Affiche le chevron ▾ (désactivable pour un déclencheur-icône). */
  chevron?: boolean;
  children: (fermer: () => void) => ReactNode;
}) {
  const [ouvert, setOuvert] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const declencheurRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const fermer = () => setOuvert(false);

  // Fermeture globale (quel que soit le focus) : clic extérieur (mousedown document)
  // et touche Échap — Échap rend le focus au déclencheur.
  useEffect(() => {
    if (!ouvert) return;
    const surClicExterieur = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOuvert(false);
    };
    const surEchap = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOuvert(false);
        declencheurRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", surClicExterieur);
    document.addEventListener("keydown", surEchap);
    return () => {
      document.removeEventListener("mousedown", surClicExterieur);
      document.removeEventListener("keydown", surEchap);
    };
  }, [ouvert]);

  // Navigation clavier ↑/↓/Home/End en focus roving sur les [role=menuitem] du panneau.
  const surTouche = (e: React.KeyboardEvent) => {
    if (!ouvert) return;
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const menu = menuRef.current;
    if (!menu) return;
    const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'));
    if (items.length === 0) return;
    e.preventDefault();
    const courant = items.findIndex((el) => el === document.activeElement);
    items[indexRoving(items.length, courant, e.key)]?.focus();
  };

  return (
    <div className="relative" ref={wrapperRef} onKeyDown={surTouche}>
      <button
        type="button"
        ref={declencheurRef}
        onClick={() => setOuvert((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={ouvert}
        aria-label={ariaLabel}
        title={titre}
        className={declencheurClasse}
      >
        {declencheur}
        {chevron && <span aria-hidden className="text-[9px] text-text-dim">▾</span>}
      </button>

      {ouvert && (
        <div
          role="menu"
          ref={menuRef}
          className={`absolute ${align === "right" ? "right-0" : "left-0"} z-50 mt-1 ${classePanneau} max-h-[70vh] overflow-y-auto rounded border border-border bg-surface p-1 shadow-xl`}
        >
          {children(fermer)}
        </div>
      )}
    </div>
  );
}

/**
 * En-tête interne standard d'une fenêtre flottante : titre en capitales
 * espacées + sous-titre discret, actions éventuelles à droite (7/7 fenêtres
 * du groupe marché suivaient déjà exactement ce markup).
 */
export function EnTeteFenetre({
  titre,
  sousTitre,
  actions,
  mnemo,
}: {
  titre: string;
  sousTitre?: ReactNode;
  actions?: ReactNode;
  /** Mnémonique ⌘K de la fenêtre — affiché « MNEMO · Titre » (convention terminal, revue v2). */
  mnemo?: string;
}) {
  return (
    <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-text">
          {mnemo !== undefined && (
            <>
              <span className="text-accent">{mnemo}</span>
              <span className="text-text-dim"> · </span>
            </>
          )}
          {titre}
        </h2>
        {sousTitre !== undefined && <p className="mt-0.5 text-[11px] text-text-dim">{sousTitre}</p>}
      </div>
      {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/** État de chargement standard : textuel, centré, discret (pas de spinner). */
export function Chargement({ libelle = "Chargement…" }: { libelle?: string }) {
  return <div className="px-1 py-6 text-center text-[11px] text-text-dim">{libelle}</div>;
}

/** Bloc d'erreur standard : bordure « down » adoucie, texte compact, sans retry. */
export function ErreurBloc({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-down/40 px-3 py-2 text-[11px] text-down">
      {children}
    </div>
  );
}

/** État vide/indisponible explicite (« convention d'honnêteté » : jamais de panneau muet). */
export function Vide({ children }: { children: ReactNode }) {
  return (
    <div className="rounded border border-border bg-bg px-3 py-4 text-center text-[11px] text-text-dim">
      {children}
    </div>
  );
}

/**
 * Section dépendant d'une clé API non configurée : message + lien vers les
 * Réglages (généralisation d'IndisponibleSansCle de FundWindow).
 */
export function SansCle({
  message,
  onOuvrirReglages,
}: {
  message: string;
  onOuvrirReglages: () => void;
}) {
  return (
    <div className="rounded border border-border bg-bg px-3 py-4 text-center text-[11px] text-text-dim">
      <p>{message}</p>
      <button type="button" onClick={onOuvrirReglages} className="mt-2 text-accent hover:underline">
        Ouvrir les réglages ⚙
      </button>
    </div>
  );
}

/**
 * Tuile « libellé / valeur » standard (ex-Metric locaux de DERIV et OMON).
 * `couleur` accepte un token CSS (`var(--up)`) ; `extra` accueille un élément
 * à droite de la valeur (sparkline de DERIV).
 */
export function Metric({
  label,
  value,
  couleur,
  extra,
  labelExtra,
}: {
  label: string;
  value: string;
  couleur?: string;
  extra?: ReactNode;
  /** Élément accolé au libellé (ex. BadgeFiabilite de DERIV). */
  labelExtra?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 rounded-md border border-border bg-bg px-3 py-2">
      {/* min-w-0 + flex-wrap : un libellé long accompagné d'un badge se replie au
          lieu de pousser la valeur hors de la tuile (backlog lot A). */}
      <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-text-dim">
        {label}
        {labelExtra}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {extra}
        <span
          className="tabular-nums text-sm font-medium text-text"
          style={couleur ? { color: couleur } : undefined}
        >
          {value}
        </span>
      </span>
    </div>
  );
}

/** Tons disponibles pour la pastille Badge (tokens sémantiques uniquement). */
export type TonBadge = "neutre" | "up" | "down" | "accent" | "warn";

const TONS_BADGE: Record<TonBadge, string> = {
  neutre: "border-border text-text-dim",
  up: "border-up text-up",
  down: "border-down text-down",
  accent: "border-accent text-accent",
  warn: "border-warn text-warn",
};

/** Pastille d'état standard (ex-StatusBadge des Réglages, généralisée). */
export function Badge({
  children,
  ton = "neutre",
  title,
}: {
  children: ReactNode;
  ton?: TonBadge;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${TONS_BADGE[ton]}`}
    >
      {children}
    </span>
  );
}

/** Orientation d'un référentiel : quelle queue de distribution est « chaude » (warn). */
export type SensRef = "hausse-chaud" | "hausse-froid";

/** Ton du RefBadge — pur, testé (défaut : les deux extrêmes sont chauds). */
export function tonRef(refe: Referentiel, sens?: SensRef): TonBadge {
  if (!estExtreme(refe)) return "neutre";
  if (sens === "hausse-chaud") return refe.percentile >= 90 ? "warn" : "neutre";
  if (sens === "hausse-froid") return refe.percentile <= 10 ? "warn" : "neutre";
  return "warn";
}

/**
 * Badge de référentiel : « p97 · 90 j » (warn si extrême), ou « réf. en construction »
 * quand l'historique est trop court/absent. `referentiel` (PAS `ref` : prop React réservé).
 */
export function RefBadge({
  referentiel: refe,
  sens,
}: {
  referentiel: Referentiel | null;
  sens?: SensRef;
}) {
  if (refe === null) {
    return (
      <Badge ton="neutre" title="Référentiel indisponible : historique trop court (moins de 5 jours) ou source en échec.">
        réf. en construction
      </Badge>
    );
  }
  const titre = `${Math.round(refe.percentile)}e percentile sur ${Math.round(refe.profondeurJours)} j de données (${refe.n} points)`;
  return (
    <Badge ton={tonRef(refe, sens)} title={titre}>
      {texteRef(refe)}
    </Badge>
  );
}

/**
 * Rangée d'onglets standard : actif `bg-bg text-text` (le corps des fenêtres
 * flottantes est en bg-surface — un pill bg-surface y serait invisible),
 * inactif estompé. Les fenêtres gardent leur état d'onglet local.
 */
export function Onglets<T extends string>({
  options,
  actif,
  onChange,
}: {
  options: ReadonlyArray<{ id: T; label: string }>;
  actif: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex gap-1 border-b border-border px-3 py-2">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`rounded px-2.5 py-1 text-[11px] transition ${
            actif === o.id ? "bg-bg text-text" : "text-text-dim hover:text-text"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Groupe segmenté standard (bascule exclusive) : conteneur bordé arrondi,
 * segment actif `bg-bg text-text` (standard §2 — jamais bg-surface, invisible
 * sur le corps bg-surface des fenêtres). Consacre le pattern d'OptionsWindow.
 */
export function Segmente<T extends string | number>({
  options,
  actif,
  onChange,
}: {
  options: ReadonlyArray<{ id: T; label: string; title?: string }>;
  actif: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-md border border-border text-[11px]">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          title={o.title}
          aria-pressed={actif === o.id}
          className={`flex-1 px-3 py-1.5 transition ${
            actif === o.id ? "bg-bg text-text" : "text-text-dim hover:text-text"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Note de bas de section : source + cadence (« Données Deribit, ~1 min. »). */
export function NoteSource({ children }: { children: ReactNode }) {
  return <p className="text-[10px] leading-snug text-text-dim">{children}</p>;
}

/**
 * Classes de bordure/texte du badge de fiabilité (tokens sémantiques uniquement —
 * jamais de hex). Aligné doctrine doc 02 : 🟢 up / 🟡 ambre / 🔴 dim|down.
 */
const TONS_FIABILITE: Record<NiveauFiabilite, string> = {
  fiable: "border-up/50 text-up",
  partiel: "border-warn/50 text-warn",
  estimation: "border-border text-text-dim",
  indisponible: "border-down/50 text-down",
};

/**
 * Pastille de fiabilité centralisée (Lot A0).
 * Accepte soit un `MetaFiabilite` (label catalogue), soit un `niveau` + `label`
 * libre. `title` = tooltip long (detail).
 */
export function BadgeFiabilite({
  meta,
  niveau,
  label,
  title,
}: {
  /** Résultat de `metaSource(id)` — prioritaire si fourni. */
  meta?: MetaFiabilite;
  niveau?: NiveauFiabilite;
  /** Court label ; défaut = libellé FR du niveau. */
  label?: string;
  title?: string;
}) {
  const n = meta?.niveau ?? niveau ?? "indisponible";
  const texte = meta?.label ?? label ?? LABEL_NIVEAU[n];
  const tip = title ?? meta?.detail;
  return (
    <span
      title={tip}
      className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${TONS_FIABILITE[n]}`}
    >
      {texte}
    </span>
  );
}

/** Texte de fraîcheur standard (pur, testé) — forme canonique de la revue v2 (H11). */
export function texteFraicheur(
  loading: boolean,
  majTs: number | null,
  now: number,
  cadence?: string,
): string {
  if (loading) return "maj…";
  if (majTs !== null && Number.isFinite(majTs)) return `maj ${formatAge(majTs, now)}`;
  return cadence !== undefined ? `maj ~${cadence}` : VALEUR_ABSENTE;
}

/** Ligne de fraîcheur standard — remplace les 4 variantes divergentes des fenêtres. */
export function Fraicheur({
  loading,
  majTs,
  cadence,
}: {
  loading: boolean;
  majTs?: number | null;
  cadence?: string;
}) {
  return <span className="tabular-nums">{texteFraicheur(loading, majTs ?? null, Date.now(), cadence)}</span>;
}

// ─────────────────────────── Graphes : périodes & infobulle ───────────────────────────

/** Préréglages de plage temporelle communs aux graphes canvas (STBL, CHAIN, VOL, BT). */
export const PERIODES_STANDARD: ReadonlyArray<{ id: string; jours: number | null; label: string }> = [
  { id: "30j", jours: 30, label: "30 j" },
  { id: "90j", jours: 90, label: "90 j" },
  { id: "1a", jours: 365, label: "1 a" },
  { id: "tout", jours: null, label: "Tout" },
];

/**
 * Boutons de période uniformes. `actif = null` → aucun bouton allumé (l'utilisateur a
 * zoomé/panné manuellement : plage personnalisée).
 */
export function BarrePeriodes({
  actif,
  onChange,
}: {
  actif: string | null;
  onChange: (p: { id: string; jours: number | null }) => void;
}) {
  return (
    <Onglets
      options={PERIODES_STANDARD.map((p) => ({ id: p.id, label: p.label }))}
      actif={actif ?? ""}
      onChange={(id) => {
        const p = PERIODES_STANDARD.find((x) => x.id === id);
        if (p) onChange(p);
      }}
    />
  );
}

export interface LigneInfobulle {
  label: string;
  valeur: string;
  couleur?: string;
}

/**
 * Curseur de graphe : trait vertical + infobulle overlay. À rendre dans un parent
 * `relative` qui contient le canvas. `xPix` en pixels CSS relatifs au graphe ;
 * l'infobulle bascule à gauche du trait près du bord droit.
 */
export function InfobulleGraphe({
  xPix,
  largeurGraphe,
  titre,
  lignes,
}: {
  xPix: number;
  largeurGraphe: number;
  titre: string;
  lignes: LigneInfobulle[];
}) {
  return (
    <>
      <div
        className="pointer-events-none absolute inset-y-0 w-px bg-text-dim/60"
        style={{ left: xPix }}
      />
      <div
        className="pointer-events-none absolute z-10 whitespace-nowrap rounded border border-border bg-surface px-2 py-1 text-[11px] tabular-nums text-text shadow-lg"
        style={{ left: Math.min(xPix + 10, Math.max(0, largeurGraphe - 150)), top: 6 }}
      >
        <div className="text-text-dim">{titre}</div>
        {lignes.map((l, i) => (
          <div key={i} style={l.couleur !== undefined ? { color: l.couleur } : undefined}>
            {l.label} : {l.valeur}
          </div>
        ))}
      </div>
    </>
  );
}
