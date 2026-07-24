/**
 * Fenêtre BRIEF — types et helpers d'affichage partagés entre l'orchestrateur
 * (BriefWindow) et les sections. Extraits tels quels du composant monolithique :
 * aucun changement de comportement, simple mise en commun.
 */
import type { ReactNode } from "react";
import { formatPourcentage } from "../../lib/format";
import type { NiveauxVar } from "../../data/distVar";
import type { LigneCotCategorie } from "../../store/cot";
import { Chargement, ErreurBloc } from "../ui";

// ─────────────────────────── État de chargement par section ───────────────────────────

export type Statut = "idle" | "loading" | "ready" | "error";

/** État d'une section : statut de chargement + données (null tant qu'absentes). */
export interface Section<T> {
  statut: Statut;
  data: T | null;
}

export const EN_ATTENTE = { statut: "loading" as Statut, data: null };

/** Instantané VaR du chart maître (section VaR) — null si < 300 bougies (section absente). */
export interface VarChart {
  h20: NiveauxVar;
  symbol: string;
  timeframe: string;
}

/** Instantané COT legacy (section COT) — null si cache absent / aucun Δ hebdo (section absente). */
export interface CotChart {
  lignes: { ligne: LigneCotCategorie; delta: number }[];
  dateRapport: number | null;
}

// ─────────────────────────── Helpers d'affichage (locaux, purs) ───────────────────────────

/** Couleur sémantique d'une variation (vert/rouge/neutre) — token CSS ou undefined. */
export function couleurVariation(v: number | null): string | undefined {
  if (v === null || !Number.isFinite(v) || v === 0) return undefined;
  return v > 0 ? "var(--up)" : "var(--down)";
}

/** Titre de bloc (petites capitales espacées, ton estompé). */
export function TitreBloc({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-dim">{children}</h3>
  );
}

/**
 * Rend le corps d'une section selon son statut : Chargement → ErreurBloc → contenu. Le
 * cas « donnée présente mais vide » est décidé par `rendu` (qui peut renvoyer <Vide/>).
 */
export function corps<T>(section: Section<T>, erreur: string, rendu: (data: T) => ReactNode): ReactNode {
  if (section.statut === "idle" || section.statut === "loading") return <Chargement />;
  if (section.statut === "error" || section.data === null) return <ErreurBloc>{erreur}</ErreurBloc>;
  return rendu(section.data);
}

/** Teinte d'une jauge breadth par tranche : > 60 % up, < 40 % down, sinon estompé. */
export function teinteBreadth(pct: number): string {
  if (pct > 60) return "var(--up)";
  if (pct < 40) return "var(--down)";
  return "var(--text-dim)";
}

/** Jauge horizontale « % de l'univers au-dessus de sa MM », teintée par tranche. */
export function JaugeBreadth({ label, pct }: { label: string; pct: number }) {
  const couleur = teinteBreadth(pct);
  const largeur = Math.max(0, Math.min(100, pct));
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-text-dim">{label}</span>
        <span className="tabular-nums" style={{ color: couleur }}>
          {formatPourcentage(pct, 0)}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg">
        <div className="h-full rounded-full" style={{ width: `${largeur}%`, backgroundColor: couleur }} />
      </div>
    </div>
  );
}
