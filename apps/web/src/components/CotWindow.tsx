/**
 * Fenêtre « Rapport COT » (mnémonique COT) — dockable à droite, NON MODALE. Source CFTC.
 *
 * Résumé SYNTHÉTIQUE et VISUEL du dernier rapport hebdomadaire « Commitments of Traders »
 * (CFTC). Un SÉLECTEUR de catégorie de positionnement en tête (Spéculatif / Fonds / Commerciaux)
 * route chaque instrument d'une watchlist curée (majors FX, indices actions, or/argent, pétrole,
 * BTC/ETH CME) vers son dataset — legacy, Disaggregated ou TFF (cf. store/cot.ts). Pour chaque
 * instrument couvert : stocks longs/shorts et ajouts/réductions nets distincts, dates réelles,
 * puis net signé, sparkline 52 rapports, COT Index min–max et barre Net/OI sur échelle ±50 %.
 * Aucun changement de stock n'est présenté comme nombre brut d'ouvertures ou de clôtures.
 *
 * L'état de données vit dans `cotStore` (fetch lazy + cache 12 h PAR dataset). La fenêtre est de la
 * présentation PURE : `charger()` à l'ouverture, `setCategorie` au clic du sélecteur, `rafraichir()`
 * au bouton. Les instruments non couverts par le dataset routé (stubs `nonCouvert`) sont masqués,
 * avec une note discrète. Dégradation gracieuse : sur échec, on garde le dernier cache et on affiche
 * un état clair, jamais d'erreur bloquante.
 */
import { useEffect } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { Commande } from "../commands/registry";
import {
  CATEGORIES_COT,
  cotIndex,
  netSurOi,
  type CategoriePositionnement,
  type CotCategorie,
  type LigneCot,
  type PointCot,
} from "../data/cot";
import { cotStore } from "../store/cot";
import { windowManagerStore, mirrorOpenState } from "../store/windowManager";
import { formatDateComplete, formatEntier } from "../lib/format";
import { GuidePositionsCot, NetCot, PeriodeCot, PositionsCot } from "./cot/PositionsCot";
import { BoutonRafraichir, Chargement, EnTeteFenetre, ErreurBloc, NoteSource, Segmente } from "./ui";

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

// ─────────────────────────── Ligne d'instrument ───────────────────────────

/**
 * Sparkline SVG inline (~90×16) du net de la catégorie sur les 52 derniers rapports : trait fin
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

/** Stocks et mouvements au premier plan ; net et repères historiques en contexte. */
function Ligne({ ligne }: { ligne: LigneCot }) {
  const idx = cotIndex(ligne.serie);
  const nsoi = netSurOi(ligne.net, ligne.openInterest);
  return (
    <article className="space-y-2 border-b border-border/50 px-3 py-2 last:border-b-0" aria-label={ligne.libelle}>
      <div>
        <h3 className="text-xs font-semibold text-text">{ligne.libelle}</h3>
        <PeriodeCot ligne={ligne} />
      </div>
      <PositionsCot ligne={ligne} />
      <NetCot ligne={ligne} />
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10px] text-text-dim">
        <span className="flex items-center gap-2">Net · 52 rapports <SparklineNet serie={ligne.serie} /></span>
        <span className="flex items-center gap-1">COT Index <BadgeCotIndex valeur={idx} /> / 100</span>
      </div>
      <p className="text-[10px] tabular-nums text-text-dim">
        OI · tout le marché : {formatEntier(ligne.openInterest)} contrats ouverts
        {nsoi === null ? " · Net/OI indisponible" : ` · Net/OI ${nsoi > 0 ? "+" : ""}${nsoi.toFixed(1)} %`}
      </p>
      <BarreNet netSurOi={nsoi} />
    </article>
  );
}

// ─────────────────────────── Métadonnées des catégories de positionnement ───────────────────────────

/**
 * Une entrée par catégorie de positionnement (`legacy`/`fonds`/`commerciaux`) : segment du
 * sélecteur (label + title natif), libellé SÉMANTIQUE du net affiché (« spéculatif » n'est vrai
 * QUE pour legacy — Producer/Asset Manager sont des catégories distinctes) et dataset(s) source cité(s) dans la
 * NoteSource. L'ordre est celui du sélecteur.
 */
const CATEGORIES_POSITIONNEMENT: readonly {
  id: CategoriePositionnement;
  label: string;
  title: string;
  semantique: string;
  source: string;
}[] = [
  {
    id: "legacy",
    label: "Spéculatif",
    title: "Non-commercial (legacy)",
    semantique: "Net spéculatif (non-commercial)",
    source: "CFTC legacy",
  },
  {
    id: "fonds",
    label: "Fonds",
    title: "Managed Money / Leveraged Funds",
    semantique: "Net des fonds (Managed Money / Leveraged Funds)",
    source: "CFTC Disaggregated + TFF",
  },
  {
    id: "commerciaux",
    label: "Commerciaux",
    title: "Producer / Asset Manager",
    semantique: "Net commercial (Producer / Asset Manager)",
    source: "CFTC Disaggregated + TFF",
  },
];

// ─────────────────────────── Composant ───────────────────────────

export function CotWindow() {
  // État piloté par le store de catégories (data/cot.ts + store/cot.ts). L'ancien orchestrateur
  // interne (chargerRapportCot / clé de cache plate) est abandonné : le store route chaque
  // instrument vers son dataset selon la catégorie choisie.
  const categorie = useStore(cotStore, (s) => s.categorie);
  const resume = useStore(cotStore, (s) => s.resume);
  const enCours = useStore(cotStore, (s) => s.enCours);
  const erreur = useStore(cotStore, (s) => s.erreur);

  // Chargement au PREMIER montage (FloatingWindow ne monte l'enfant qu'à l'ouverture). Garde
  // `dateMaj === null` + `!enCours` : StrictMode-safe (charger() pose `enCours:true` de façon
  // synchrone avant son premier await) et pas de re-fetch aux ouvertures suivantes. La catégorie
  // n'est PAS en dépendance : `setCategorie` relance déjà `charger()` dans le store (l'ajouter
  // ici double-runnerait — même écueil que CBPREM).
  useEffect(() => {
    const s = cotStore.getState();
    if (!s.enCours && s.dateMaj === null) void s.charger();
  }, []);

  const meta =
    CATEGORIES_POSITIONNEMENT.find((c) => c.id === categorie) ?? CATEGORIES_POSITIONNEMENT[0]!;

  // Lignes réellement couvertes par le dataset routé : les stubs `nonCouvert` sont MASQUÉS et leur
  // net/OI (NaN) ne doit JAMAIS alimenter cotIndex/netSurOi — d'où le filtre AVANT tout rendu.
  const lignesVisibles = resume.lignes.filter((l) => !l.nonCouvert);
  const nbNonCouvert = resume.lignes.length - lignesVisibles.length;
  const aucuneVisible = lignesVisibles.length === 0;

  return (
    <>
      <EnTeteFenetre
        mnemo="COT"
        titre="CFTC"
        sousTitre={
          <>
            {meta.semantique} · dernier disponible : {formatDateComplete(resume.dateRapport ?? 0)}
            {enCours ? " · maj…" : ""}
          </>
        }
        actions={
          <>
            <Segmente
              options={CATEGORIES_POSITIONNEMENT.map((c) => ({
                id: c.id,
                label: c.label,
                title: c.title,
              }))}
              actif={categorie}
              onChange={(id) => void cotStore.getState().setCategorie(id)}
            />
            <BoutonRafraichir
              onClick={() => void cotStore.getState().rafraichir()}
              title="Rafraîchir le rapport COT"
            />
          </>
        }
      />

      <div
        role="region"
        aria-label="Rapports COT"
        tabIndex={0}
        className="min-w-0 flex-1 overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      >
        <GuidePositionsCot />
        {/* Signal « indisponible » : jamais tiré de la longueur (une ligne par instrument, stubs
            inclus), mais de enCours/erreur/aucune-ligne-couverte. Ordre : enCours d'abord (pas de
            faux « non couvert » pendant un chargement), puis erreur, puis vide. */}
        {aucuneVisible ? (
          enCours ? (
            <Chargement />
          ) : erreur ? (
            <div className="px-3 py-2">
              <ErreurBloc>{erreur}</ErreurBloc>
            </div>
          ) : (
            <div className="px-3 py-6 text-center text-[11px] text-text-dim">
              Aucun marché couvert par ce rapport.
            </div>
          )
        ) : (
          <>
            {/* Dégradation non destructive : sur échec de refetch avec données conservées, un
                bandeau discret plutôt qu'un remplacement de la liste. */}
            {erreur && (
              <div className="px-3 pt-2">
                <ErreurBloc>{erreur}</ErreurBloc>
              </div>
            )}

            {CATEGORIES_COT.map((cat: { id: CotCategorie; libelle: string }) => {
              const duGroupe = lignesVisibles.filter((l) => l.categorie === cat.id);
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
            })}

            {nbNonCouvert > 0 && (
              <div className="px-3 py-2 text-[10px] text-text-dim">
                {nbNonCouvert} marché{nbNonCouvert > 1 ? "s" : ""} non couvert
                {nbNonCouvert > 1 ? "s" : ""} par ce rapport.
              </div>
            )}

            <div className="px-3 py-3">
              <NoteSource>
                {meta.semantique} = longs − shorts. OI = contrats ouverts de tout le marché,
                pas la somme longs + shorts de cette catégorie. Barre Net/OI : échelle ±50 %.
                COT Index : position du net dans son amplitude min–max des 156 derniers rapports
                (≈ 3 ans), pas un percentile ; 0 = minimum du net, 100 = maximum, 50 si constant.
                Indisponible avec moins de 26 rapports. Source {meta.source}, publication hebdomadaire.
              </NoteSource>
            </div>
          </>
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
