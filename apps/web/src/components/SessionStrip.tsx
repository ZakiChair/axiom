/**
 * SessionStrip — bandeau dense (11px) sous la Toolbar : P&L jour, alertes actives,
 * pastille santé globale. Acceptation G8 (chrome session visible sans ouvrir de fenêtre).
 *
 * Contrat de perf (PortfolioWindow / BUILD-CONTRACT) :
 *  - AUCUN re-render React sur tick de prix : le P&L est recalculé à chaque ticker et
 *    écrit IMPÉRATIVEMENT dans le DOM via des refs ;
 *  - re-render seulement si la liste de positions, le nb d'alertes actives ou le niveau
 *    de dégradation santé change (basse fréquence).
 *
 * Masqué en plein écran par le parent (App.tsx, même gate que Toolbar).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useStore } from "zustand";
import { subscribeTickers, type TickerUpdate } from "../data/ticker";
import {
  portfolioStore,
  portfolioUiStore,
  pnlSessionDepuis,
  debutJourLocalMs,
  type Position,
} from "../store/portfolio";
import { alertsStore } from "../store/alerts";
import { healthStore, type SanteSource } from "../store/health";
import { degradedLevel } from "./HealthPanel";
import { formatUsd } from "../lib/format";

/** Écrit un montant signé + coloré (tokens --up/--down) dans une cellule DOM. */
function writeMoney(el: HTMLElement, n: number | undefined): void {
  if (n === undefined || !Number.isFinite(n)) {
    el.textContent = "—";
    el.style.color = "";
    return;
  }
  const plus = n > 0 ? "+" : "";
  el.textContent = `${plus}${formatUsd(n)}`;
  el.style.color = n > 0 ? "var(--up)" : n < 0 ? "var(--down)" : "";
}

/**
 * Signature santé hors horodatages (évite re-render sur chaque message WS).
 * PURE — alignée sur le principe de HealthPanel.panelSignature.
 */
function healthLevelSignature(sources: Record<string, SanteSource>): string {
  return degradedLevel(sources) ?? "ok";
}

/** Compte les alertes actives. PURE. */
export function compterAlertesActives(defs: readonly { actif: boolean }[]): number {
  let n = 0;
  for (const d of defs) if (d.actif) n += 1;
  return n;
}

export function SessionStrip() {
  const positions = useStore(portfolioStore, (s) => s.positions);
  const nbAlertes = useStore(alertsStore, (s) => compterAlertesActives(s.defs));
  // Abonnement bas-fréquence : ne change que si le niveau de dégradation bascule.
  const healthSig = useStore(healthStore, (s) => healthLevelSignature(s.sources));
  const healthLevel = healthSig === "ok" ? null : (healthSig as "error" | "warn");

  const openPositions = useMemo(() => positions.filter((p) => p.statut === "ouvert"), [positions]);
  const openSymbolsKey = useMemo(
    () =>
      Array.from(new Set(openPositions.map((p) => p.symbole)))
        .sort()
        .join(","),
    [openPositions],
  );

  const positionsRef = useRef<Position[]>(positions);
  positionsRef.current = positions;

  const latest = useRef(new Map<string, number>());
  const totalRef = useRef<HTMLSpanElement>(null);
  const latentRef = useRef<HTMLSpanElement>(null);
  const realiseRef = useRef<HTMLSpanElement>(null);

  /** Repeint les 3 cellules P&L depuis les derniers prix + positions courantes. */
  const repaintPnl = useCallback(() => {
    const prix = Object.fromEntries(latest.current);
    const session = pnlSessionDepuis(positionsRef.current, prix, debutJourLocalMs(Date.now()));
    if (totalRef.current) writeMoney(totalRef.current, session.total);
    if (latentRef.current) writeMoney(latentRef.current, session.latent);
    if (realiseRef.current) writeMoney(realiseRef.current, session.realise);
  }, []);

  // Souscription ticker des symboles ouverts — écriture DOM only.
  useEffect(() => {
    const symbols = openSymbolsKey ? openSymbolsKey.split(",") : [];
    if (symbols.length === 0) {
      repaintPnl();
      return;
    }
    const onTick = (u: TickerUpdate) => {
      latest.current.set(u.symbol, u.price);
      repaintPnl();
    };
    return subscribeTickers(symbols, onTick);
  }, [openSymbolsKey, repaintPnl]);

  // Structure changée (ajout/clôture) → repaint immédiat (refs déjà attachées).
  useLayoutEffect(() => {
    repaintPnl();
  }, [positions, repaintPnl]);

  const pastilleClass =
    healthLevel === "error"
      ? "bg-down"
      : healthLevel === "warn"
        ? "bg-amber-500"
        : "bg-up";
  const pastilleTitle =
    healthLevel === "error"
      ? "Santé : une source en erreur"
      : healthLevel === "warn"
        ? "Santé : source dégradée (stale/reconnexion)"
        : "Santé : sources OK";

  return (
    <div
      role="status"
      aria-label="Session : P&L jour, alertes, santé"
      className="flex shrink-0 items-center gap-3 border-b border-border bg-surface px-3 py-0.5 text-[11px] leading-tight text-text-dim"
    >
      <button
        type="button"
        onClick={() => portfolioUiStore.getState().openPortfolio()}
        title="Ouvrir le portefeuille (P&L jour : latent + réalisé session)"
        className="flex items-center gap-1.5 tabular-nums transition hover:text-text"
      >
        <span className="uppercase tracking-[0.08em]">P&amp;L jour</span>
        <span ref={totalRef} className="font-medium text-text">
          —
        </span>
        <span className="text-text-dim">
          <span className="opacity-70">L</span>{" "}
          <span ref={latentRef}>—</span>
          <span className="mx-1 opacity-40">·</span>
          <span className="opacity-70">R</span>{" "}
          <span ref={realiseRef}>—</span>
        </span>
      </button>

      <span aria-hidden className="text-border">
        |
      </span>

      <div className="flex items-center gap-1 tabular-nums" title="Nombre d'alertes actives">
        <span className="uppercase tracking-[0.08em]">Alertes</span>
        <span className="font-medium text-text">{nbAlertes}</span>
      </div>

      <span aria-hidden className="text-border">
        |
      </span>

      <div className="flex items-center gap-1.5" title={pastilleTitle}>
        <span
          aria-hidden
          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${pastilleClass}`}
        />
        <span className="uppercase tracking-[0.08em]">Santé</span>
        <span className="sr-only">{pastilleTitle}</span>
      </div>
    </div>
  );
}
