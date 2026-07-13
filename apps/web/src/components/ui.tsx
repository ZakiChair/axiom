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
import type { ReactNode } from "react";
import {
  LABEL_NIVEAU,
  type MetaFiabilite,
  type NiveauFiabilite,
} from "../lib/fiabilite";

/** Classes du bouton secondaire standard (recalculer, exporter, choisir…). */
export const BTN_SECONDAIRE =
  "rounded border border-border bg-bg px-2 py-1 text-[11px] text-text-dim transition hover:text-text";

/**
 * En-tête interne standard d'une fenêtre flottante : titre en capitales
 * espacées + sous-titre discret, actions éventuelles à droite (7/7 fenêtres
 * du groupe marché suivaient déjà exactement ce markup).
 */
export function EnTeteFenetre({
  titre,
  sousTitre,
  actions,
}: {
  titre: string;
  sousTitre?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-text">{titre}</h2>
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
}: {
  label: string;
  value: string;
  couleur?: string;
  extra?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 rounded-md border border-border bg-bg px-3 py-2">
      <span className="text-[11px] text-text-dim">{label}</span>
      <span className="flex items-center gap-2">
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
export type TonBadge = "neutre" | "up" | "down" | "accent";

const TONS_BADGE: Record<TonBadge, string> = {
  neutre: "border-border text-text-dim",
  up: "border-up text-up",
  down: "border-down text-down",
  accent: "border-accent text-accent",
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
  partiel: "border-amber-500/50 text-amber-500",
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
