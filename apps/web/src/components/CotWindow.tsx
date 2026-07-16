/**
 * Fenêtre « Rapport COT » (mnémonique COT) — dockable à droite, NON MODALE. Source CFTC.
 *
 * Résumé SYNTHÉTIQUE et VISUEL du dernier rapport hebdomadaire « Commitments of Traders »
 * (CFTC, dataset Legacy Futures Only). Pour une watchlist curée (majors FX, indices actions,
 * or/argent, pétrole, BTC/ETH CME) : POSITION NETTE SPÉCULATIVE (longs − shorts des « non-
 * commercials ») en barre divergente centrée sur zéro (vert = net long, rouge = net short,
 * longueur ∝ |net|), la VARIATION HEBDO (flèche + delta) et l'open interest. Regroupé par
 * famille pour une lecture au coup d'œil — ce n'est pas un dump de table brute.
 *
 * Données TRÈS lentes (publication hebdo le vendredi) : elles vivent dans le state React et
 * sont mises en cache 12 h par data/cot.ts. Chargement à l'ouverture (servi du cache si
 * frais) + rafraîchissement manuel. Dégradation gracieuse : sur échec, on garde le dernier
 * cache et on affiche un état clair, jamais d'erreur bloquante.
 */
import { useCallback, useEffect, useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { Commande } from "../commands/registry";
import {
  CATEGORIES_COT,
  chargerRapportCot,
  type CotCategorie,
  type LigneCot,
  type ResumeCot,
} from "../data/cot";
import { windowManagerStore, mirrorOpenState } from "../store/windowManager";
import { formatDateComplete } from "../lib/format";
import { EnTeteFenetre } from "./ui";

// ─────────────────────────── Store UI (vanilla, éphémère, non persisté) ───────────────────────────

export interface CotUiState {
  open: boolean;
  openCot: () => void;
  closeCot: () => void;
  toggleCot: () => void;
}

export const cotUiStore = createStore<CotUiState>(() => ({
  open: false,
  openCot: () => windowManagerStore.getState().openWindow("cot"),
  closeCot: () => windowManagerStore.getState().closeWindow("cot"),
  toggleCot: () => windowManagerStore.getState().toggleWindow("cot"),
}));

mirrorOpenState("cot", cotUiStore);

// ─────────────────────────── Format utilitaires ───────────────────────────

/** Formate un entier de position de façon compacte (181339 → « 181K », 3524 → « 3.5K »).
 * Helper LOCAL conservé : décimales adaptées aux lots (0/1) plus lisibles que les 2 déc.
 * du `formatCompact` partagé ; casse du suffixe alignée sur le standard (K majuscule). */
function formatCompact(v: number): string {
  const abs = Math.abs(v);
  if (!Number.isFinite(v)) return "—";
  if (abs >= 1000) {
    const k = abs / 1000;
    return `${k >= 10 ? k.toFixed(0) : k.toFixed(1)}K`;
  }
  return abs.toFixed(0);
}

/** Formate une valeur signée (+/−) compacte pour le net et le delta. */
function formatSigned(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const signe = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${signe}${formatCompact(v)}`;
}

// ─────────────────────────── Ligne d'instrument ───────────────────────────

/** Barre divergente centrée sur zéro : net long vers la droite (up), net short vers la
 * gauche (down), longueur ∝ |net| / maxAbs. `ratio` ∈ [0, 1]. */
function BarreNet({ net, maxAbs }: { net: number; maxAbs: number }) {
  const ratio = maxAbs > 0 ? Math.min(1, Math.abs(net) / maxAbs) : 0;
  const largeur = `${(ratio * 50).toFixed(2)}%`;
  const positif = net >= 0;
  return (
    <div className="relative h-1.5 w-full rounded bg-bg">
      {/* Repère central (zéro). */}
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />
      <div
        className={`absolute inset-y-0 rounded ${positif ? "left-1/2 bg-up" : "right-1/2 bg-down"}`}
        style={{ width: largeur }}
      />
    </div>
  );
}

/** Une ligne d'instrument : libellé + OI, barre nette, net signé + variation hebdo. */
function Ligne({ ligne, maxAbs }: { ligne: LigneCot; maxAbs: number }) {
  const netCouleur = ligne.net > 0 ? "text-up" : ligne.net < 0 ? "text-down" : "text-text";
  const deltaCouleur =
    ligne.delta === null ? "text-text-dim" : ligne.delta > 0 ? "text-up" : ligne.delta < 0 ? "text-down" : "text-text-dim";
  const fleche = ligne.delta === null ? "" : ligne.delta > 0 ? "↑" : ligne.delta < 0 ? "↓" : "→";

  return (
    <div className="space-y-1 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <span className="text-xs text-text">{ligne.libelle}</span>
          {Number.isFinite(ligne.openInterest) && (
            <span className="ml-2 text-[10px] tabular-nums text-text-dim">
              OI {formatCompact(ligne.openInterest)}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-baseline gap-2 tabular-nums">
          <span className={`text-sm font-medium ${netCouleur}`}>{formatSigned(ligne.net)}</span>
          <span className={`w-14 text-right text-[11px] ${deltaCouleur}`}>
            {ligne.delta === null ? "—" : `${fleche} ${formatSigned(ligne.delta)}`}
          </span>
        </div>
      </div>
      <BarreNet net={ligne.net} maxAbs={maxAbs} />
    </div>
  );
}

// ─────────────────────────── Composant ───────────────────────────

export function CotWindow() {
  const open = useStore(cotUiStore, (s) => s.open);

  const [resume, setResume] = useState<ResumeCot | null>(null);
  const [loading, setLoading] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(async (force: boolean) => {
    setLoading(true);
    const { resume } = await chargerRapportCot({ force });
    setResume(resume);
    setErreur(resume.lignes.length === 0 ? "Rapport COT indisponible pour le moment." : null);
    setLoading(false);
  }, []);

  // Chargement à l'ouverture (idempotent : servi du cache 12 h sans requête si frais).
  useEffect(() => {
    if (open && resume === null) void charger(false);
  }, [open, resume, charger]);

  const lignes = resume?.lignes ?? [];
  // Échelle commune des barres : le plus grand |net| de toute la watchlist (comparaison
  // honnête entre l'or, très net-long, et un indice net-short).
  const maxAbs = lignes.reduce((m, l) => Math.max(m, Math.abs(l.net)), 0);

  return (
    <>
      <EnTeteFenetre
        mnemo="COT"
        titre="CFTC"
        sousTitre={
          <>
            Net spéculatif · {formatDateComplete(resume?.dateRapport ?? 0)}
            {loading ? " · maj…" : ""}
          </>
        }
        actions={
          <button
            type="button"
            onClick={() => void charger(true)}
            aria-label="Rafraîchir le rapport COT"
            title="Rafraîchir"
            className="rounded p-1 text-sm leading-none text-text-dim transition hover:bg-bg hover:text-text"
          >
            ⟳
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto">
        {erreur && (
          <div className="border-b border-down/40 px-3 py-2 text-[11px] text-down">{erreur}</div>
        )}

        {lignes.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-text-dim">
            {loading ? "Chargement…" : "Aucune donnée COT disponible."}
          </div>
        ) : (
          CATEGORIES_COT.map((cat: { id: CotCategorie; libelle: string }) => {
            const duGroupe = lignes.filter((l) => l.categorie === cat.id);
            if (duGroupe.length === 0) return null;
            return (
              <section key={cat.id} className="border-b border-border last:border-b-0">
                <h3 className="bg-bg/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-dim">
                  {cat.libelle}
                </h3>
                {duGroupe.map((l) => (
                  <Ligne key={l.nom} ligne={l} maxAbs={maxAbs} />
                ))}
              </section>
            );
          })
        )}

        {lignes.length > 0 && (
          <p className="px-3 py-3 text-[10px] leading-snug text-text-dim">
            Position nette spéculative (« non-commercial ») = longs − shorts. Barre ∝ ampleur
            du net (vert = net long, rouge = net short) ; flèche = variation vs semaine
            précédente. Source CFTC, publication hebdomadaire.
          </p>
        )}
      </div>
    </>
  );
}

// ─────────────────────────── Commande palette (enregistrée par l'intégrateur) ───────────────────────────

export const commandes: Commande[] = [
  {
    id: "panneau:cot",
    mnemonique: "COT",
    libelle: "Rapport COT (CFTC)",
    categorie: "panneau",
    motsCles: [
      "cot",
      "commitments of traders",
      "cftc",
      "positionnement",
      "net speculatif",
      "non commercial",
      "futures",
      "sentiment",
    ],
    apercu: "Ouvre / ferme le résumé du rapport COT (CFTC)",
    action: () => cotUiStore.getState().toggleCot(),
  },
];
