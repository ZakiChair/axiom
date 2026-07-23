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
  cotIndex,
  deltaSemaines,
  netSurOi,
  type CotCategorie,
  type LigneCot,
  type PointCot,
  type ResumeCot,
} from "../data/cot";
import { windowManagerStore, mirrorOpenState } from "../store/windowManager";
import { formatDateComplete } from "../lib/format";
import { Chargement, EnTeteFenetre, ErreurBloc, NoteSource } from "./ui";

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

/**
 * Sparkline SVG inline (~90×16) du net spéculatif sur les 52 dernières semaines : trait fin
 * `text-dim` (via `currentColor`), zéro matérialisé par un pointillé discret, dernier point
 * marqué d'un cercle teinté selon le signe. Pas d'axe ni d'interaction — c'est une tendance.
 */
function SparklineNet({ serie }: { serie: PointCot[] }) {
  const largeur = 90;
  const hauteur = 16;
  const pts = serie.slice(-52);
  // Réserve toujours l'emplacement (alignement de colonne), même série vide.
  if (pts.length === 0) {
    return <span className="inline-block shrink-0" style={{ width: largeur, height: hauteur }} aria-hidden />;
  }
  const nets = pts.map((p) => p.net);
  // Le domaine INCLUT toujours zéro : sinon le trait du zéro sort du cadre pour un instrument
  // durablement d'un seul côté (l'or, net-long persistant), et le signe du net (au-dessus / en
  // dessous du zéro) ne serait plus lisible. Le compromis est une amplitude hebdo comprimée pour
  // ces instruments — acceptable, le badge COT Index porte déjà la position dans l'amplitude.
  const min = Math.min(0, ...nets);
  const max = Math.max(0, ...nets);
  const span = max - min || 1;
  const y = (v: number) => hauteur - ((v - min) / span) * hauteur;
  const step = pts.length > 1 ? largeur / (pts.length - 1) : 0;
  const points = pts.map((p, i) => `${(i * step).toFixed(1)},${y(p.net).toFixed(1)}`).join(" ");
  const dernier = pts[pts.length - 1]!;
  const xDernier = (pts.length - 1) * step;
  const teinte = dernier.net > 0 ? "var(--up)" : dernier.net < 0 ? "var(--down)" : "var(--text-dim)";
  return (
    <svg width={largeur} height={hauteur} className="shrink-0 text-text-dim" aria-hidden="true">
      <line
        x1={0}
        y1={y(0).toFixed(1)}
        x2={largeur}
        y2={y(0).toFixed(1)}
        stroke="currentColor"
        strokeWidth={0.5}
        strokeDasharray="2 2"
        opacity={0.6}
      />
      {pts.length > 1 && (
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1} strokeLinejoin="round" />
      )}
      <circle cx={xDernier.toFixed(1)} cy={y(dernier.net).toFixed(1)} r={1.5} fill={teinte} />
    </svg>
  );
}

/** Badge COT Index (0-100) : valeur nue teintée up ≥ 80 / down ≤ 20 / neutre sinon ;
 * « — » si null (moins de 26 semaines d'historique). Largeur fixe pour aligner la colonne. */
function BadgeCotIndex({ valeur }: { valeur: number | null }) {
  if (valeur === null) {
    return <span className="w-7 text-right text-[11px] tabular-nums text-text-dim">—</span>;
  }
  const n = Math.round(valeur);
  const couleur = n >= 80 ? "text-up" : n <= 20 ? "text-down" : "text-text-dim";
  return <span className={`w-7 text-right text-[11px] font-medium tabular-nums ${couleur}`}>{n}</span>;
}

/** Barre divergente centrée sur zéro à l'échelle net/OI %, fixe et commune ±50 % (l'or et
 * BTC deviennent comparables), avec graduations discrètes à ±25 %. « — » (pas de barre) si
 * l'OI n'est pas exploitable (netSurOi null). */
function BarreNet({ netSurOi: nsoi }: { netSurOi: number | null }) {
  if (nsoi === null) {
    return (
      <div className="flex h-1.5 w-full items-center justify-center text-[9px] leading-none text-text-dim">
        —
      </div>
    );
  }
  // Échelle fixe ±50 % : |netSurOi| plafonné à 50 mappé sur la demi-largeur (50 %) du conteneur.
  const ratio = Math.min(Math.abs(nsoi), 50) / 50;
  const largeur = `${(ratio * 50).toFixed(2)}%`;
  const positif = nsoi >= 0;
  return (
    <div className="relative h-1.5 w-full rounded bg-bg">
      {/* Repère central (zéro). */}
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />
      {/* Graduations discrètes à ±25 % (moitié de l'échelle ±50 %). */}
      <div className="absolute inset-y-0 left-1/4 w-px bg-border" />
      <div className="absolute inset-y-0 left-3/4 w-px bg-border" />
      <div
        className={`absolute inset-y-0 rounded ${positif ? "left-1/2 bg-up" : "right-1/2 bg-down"}`}
        style={{ width: largeur }}
      />
    </div>
  );
}

/** Une ligne d'instrument : libellé + OI, sparkline, badge COT Index, barre net/OI, net signé
 * + variation hebdo (delta 4 sem + net et OI exacts au survol via `title` natif). */
function Ligne({ ligne }: { ligne: LigneCot }) {
  const netCouleur = ligne.net > 0 ? "text-up" : ligne.net < 0 ? "text-down" : "text-text";
  const deltaCouleur =
    ligne.delta === null ? "text-text-dim" : ligne.delta > 0 ? "text-up" : ligne.delta < 0 ? "text-down" : "text-text-dim";
  const fleche = ligne.delta === null ? "" : ligne.delta > 0 ? "↑" : ligne.delta < 0 ? "↓" : "→";

  const idx = cotIndex(ligne.serie);
  const nsoi = netSurOi(ligne.net, ligne.openInterest);
  const delta4 = deltaSemaines(ligne.serie, 4);

  // Infobulle native : delta 4 sem + net et OI exacts (le résumé visuel reste compact).
  const titre = [
    `Δ4sem : ${delta4 === null ? "—" : formatSigned(delta4)}`,
    `net ${ligne.net.toLocaleString("fr-FR")}`,
    Number.isFinite(ligne.openInterest) ? `OI ${ligne.openInterest.toLocaleString("fr-FR")}` : null,
  ]
    .filter((s) => s !== null)
    .join(" · ");

  return (
    <div className="space-y-1 px-3 py-2" title={titre}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-xs text-text">{ligne.libelle}</span>
          {Number.isFinite(ligne.openInterest) && (
            <span className="ml-2 text-[10px] tabular-nums text-text-dim">
              OI {formatCompact(ligne.openInterest)}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 tabular-nums">
          <SparklineNet serie={ligne.serie} />
          <BadgeCotIndex valeur={idx} />
          <span className={`text-sm font-medium ${netCouleur}`}>{formatSigned(ligne.net)}</span>
          <span className={`w-14 text-right text-[11px] ${deltaCouleur}`}>
            {ligne.delta === null ? "—" : `${fleche} ${formatSigned(ligne.delta)}`}
          </span>
        </div>
      </div>
      <BarreNet netSurOi={nsoi} />
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
          <div className="px-3 py-2">
            <ErreurBloc>{erreur}</ErreurBloc>
          </div>
        )}

        {lignes.length === 0 ? (
          loading ? (
            <Chargement />
          ) : (
            <div className="px-3 py-6 text-center text-[11px] text-text-dim">
              Aucune donnée COT disponible.
            </div>
          )
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
                  <Ligne key={l.nom} ligne={l} />
                ))}
              </section>
            );
          })
        )}

        {lignes.length > 0 && (
          <div className="px-3 py-3">
            <NoteSource>
              Position nette spéculative (« non-commercial ») = longs − shorts. Barre = net
              rapporté à l'open interest (échelle ±50 %) ; flèche = variation vs semaine
              précédente. COT Index = position du net spéculatif dans son amplitude 3 ans (0 =
              extrême short, 100 = extrême long). Source CFTC, publication hebdomadaire.
            </NoteSource>
          </div>
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
