/**
 * Fenêtre « Liquidations » (mnémonique LIQ) — SOURCE UNIQUE : lit le buffer borné du
 * singleton (`liqEventsStore`, cf. chart/liquidationMarkers.ts : seed daemon/localStorage/
 * Coinalyze + live) au lieu d'ouvrir son propre WS. Le flux est retenu via
 * `retenirFluxLiq` (refcount) : il est actif dès que la fenêtre est ouverte OU que la
 * heatmap du chart est ON — mêmes chiffres partout, un seul jeu de sockets.
 *
 * Deux onglets (primitive `Onglets`) :
 *  • « Live » — totaux/stats sur FENÊTRE GLISSANTE (5m/1h/24h), barre de dominance,
 *    mini-histogramme temporel (shorts ↑ / longs ↓), et le feed des ~60 dernières liq du
 *    buffer avec hiérarchie de magnitude (barre de fond log, ≥ $1M en gras) ;
 *  • « Historique » — lecture PONCTUELLE de l'historique persistant du daemon axiomd
 *    (SQLite, rétention 30 j) sur 1h/24h/7j/30j : totaux, dominance, histogramme
 *    48 buckets, top 10 des plus grosses liq. Replis honnêtes (daemon absent vs fenêtre
 *    vide) et cache module-level 60 s par (symbole, fenêtre) — pas de refetch en boucle.
 *
 * Les événements `approx` (seed Coinalyze) sont EXCLUS de la fenêtre : prix approximés
 * par bougie, pas des liquidations individuelles — ils restent réservés à la heatmap.
 * Aucune donnée haute fréquence dans le state React : seule la révision du store
 * (throttlée ~500 ms) et une horloge lente y transitent ; les événements sont lus à la
 * volée dans le store vanilla. Rendu par FloatingWindow (frame fournie par App.tsx).
 */
import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { marketStore } from "../store/market";
import { okxCouvre } from "../data/liquidations";
import {
  liqEventsStore,
  liqMarksStore,
  retenirFluxLiq,
  type LiqEvent,
  type LiqHeatMode,
  type Granularite,
} from "../chart/liquidationMarkers";
import { liqEstStore, LEVIERS } from "../chart/liquidationEstimates";
import { liquidationsGet, type LiqDaemon } from "../data/daemon";
import {
  EnTeteFenetre,
  Vide,
  NoteSource,
  Metric,
  Badge,
  Chargement,
  Onglets,
  type TonBadge,
} from "./ui";
import {
  formatUsd,
  formatHeure,
  formatDateHeure,
  formatPrice,
  formatPourcentage,
} from "../lib/format";
import {
  bucketsTemporels,
  daemonVersEvenements,
  filtrerFenetre,
  magnitudeRelative,
  statsLiquidations,
  topLiquidations,
  type BucketTemporel,
} from "./liquidationsWindow.util";

/** Nombre max de liquidations affichées dans le feed (dernières du buffer). */
const MAX_FEED = 60;
/** Throttle du rafraîchissement React sur publication du store (~2 rendus/s max). */
const THROTTLE_MS = 500;
/** Horloge lente : fait glisser la fenêtre temporelle même quand le flux est silencieux. */
const HORLOGE_MS = 30_000;
/** Nombre de buckets du mini-histogramme temporel. */
const N_BUCKETS = 32;
/** Seuil de mise en gras d'une liquidation dans le feed. */
const SEUIL_GRAS_USD = 1_000_000;

/** Fenêtres glissantes proposées (segmented en en-tête). */
type FenetreId = "5m" | "1h" | "24h";
const FENETRES: ReadonlyArray<{ id: FenetreId; label: string }> = [
  { id: "5m", label: "5m" },
  { id: "1h", label: "1h" },
  { id: "24h", label: "24h" },
];
const FENETRE_MS: Record<FenetreId, number> = {
  "5m": 5 * 60_000,
  "1h": 60 * 60_000,
  "24h": 24 * 60 * 60_000,
};

/** Présentation d'une venue : libellé court/long + ton du Badge (teintes distinctes). */
const VENUES: Record<string, { court: string; long: string; ton: TonBadge }> = {
  bybit: { court: "BYB", long: "Bybit", ton: "accent" },
  okx: { court: "OKX", long: "OKX", ton: "neutre" },
};

/** Présentation d'une venue, avec repli générique (venues inconnues du daemon). */
function venueInfo(venue: string): { court: string; long: string; ton: TonBadge } {
  return VENUES[venue] ?? { court: venue.slice(0, 3).toUpperCase(), long: venue, ton: "neutre" };
}

/** Grille partagée en-tête/lignes du feed (colonnes alignées). */
const GRILLE_FEED = "grid grid-cols-[60px_52px_42px_1fr_88px] items-center gap-2";

/**
 * Bascule « Sur le graphe » : active/désactive les marqueurs de liquidation sur le
 * chart (liqMarksStore, cf. chart/liquidationMarkers.ts). Rend la feature découvrable
 * depuis la fenêtre, sans passer par ⌘K LIQMARK.
 */
function ToggleChart() {
  const actif = useStore(liqMarksStore, (s) => s.actif);
  const basculer = useStore(liqMarksStore, (s) => s.basculer);
  return (
    <button
      type="button"
      onClick={basculer}
      aria-pressed={actif}
      title="Afficher les liquidations sur le graphe (marqueurs)"
      className={`rounded border px-2 py-1 text-[11px] font-medium transition ${
        actif ? "border-accent bg-bg text-accent" : "border-border bg-bg text-text-dim hover:text-text"
      }`}
    >
      {actif ? "● Sur le graphe" : "Sur le graphe"}
    </button>
  );
}

/** Modes de coloration des cellules de la heatmap (segmented compact pour l'en-tête). */
const MODES_HEATMAP: ReadonlyArray<{ id: LiqHeatMode; label: string; title: string }> = [
  { id: "intensite", label: "Intensité", title: "Cellules colorées par intensité totale (rampe viridis, échelle log)" },
  { id: "dominance", label: "L-S", title: "Cellules teintées par dominance long/short (longs = teinte baissière, shorts = haussière)" },
];

/**
 * Sélecteur segmenté du mode de coloration de la heatmap (intensité / dominance L-S).
 * Visible SEULEMENT quand « Sur le graphe » est actif (le mode ne s'applique qu'aux
 * cellules de la heatmap — cf. chart/liquidationHeat.ts, commande ⌘K LIQMODE).
 */
function SelecteurMode() {
  const actif = useStore(liqMarksStore, (s) => s.actif);
  const mode = useStore(liqMarksStore, (s) => s.mode);
  const setMode = useStore(liqMarksStore, (s) => s.setMode);
  if (!actif) return null;
  return (
    <div
      role="group"
      aria-label="Mode de coloration de la heatmap"
      className="flex items-center gap-0.5 rounded border border-border p-0.5"
    >
      {MODES_HEATMAP.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => setMode(m.id)}
          aria-pressed={mode === m.id}
          title={m.title}
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition ${
            mode === m.id ? "bg-bg text-text" : "text-text-dim hover:text-text"
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Bascule « Niveaux estimés » : superpose des niveaux de liquidation ESTIMÉS (modèle de
 * levier appliqué à l'OI, liqEstStore, cf. chart/liquidationEstimates.ts). Couche INDÉPENDANTE
 * de la heatmap réelle. Étiquetée « EST. » à l'écran — approximation, PAS des liquidations
 * réelles (garde-fou BUILD-CONTRACT).
 */
function ToggleEstimes() {
  const actif = useStore(liqEstStore, (s) => s.actif);
  const basculer = useStore(liqEstStore, (s) => s.basculer);
  return (
    <button
      type="button"
      onClick={basculer}
      aria-pressed={actif}
      title="Niveaux de liquidation ESTIMÉS depuis l'OI (modèle de levier — approximation, étiquetée EST.)"
      className={`rounded border px-2 py-1 text-[11px] font-medium transition ${
        actif ? "border-accent bg-bg text-accent" : "border-border bg-bg text-text-dim hover:text-text"
      }`}
    >
      {actif ? "● Niveaux estimés" : "Niveaux estimés"}
    </button>
  );
}

/** Granularités proposées : facteur multiplicatif de la taille de bucket de prix. */
const GRANULARITES: ReadonlyArray<{ id: Granularite; label: string }> = [
  { id: 0.5, label: "½×" },
  { id: 1, label: "1×" },
  { id: 2, label: "2×" },
];

/**
 * Ligne « Réglages » compacte de la couche liquidations, visible dès que « Sur le graphe »
 * OU « Niveaux estimés » est actif :
 *  • cases cochables des LEVIERS du modèle de niveaux estimés (liqEstStore) — la DERNIÈRE
 *    cochée est verrouillée (le store refuse de tout décocher) ;
 *  • segmented de granularité des buckets de prix (½× / 1× / 2×, liqMarksStore) — applique un
 *    facteur à la taille de bucket de la heatmap RÉELLE ET des niveaux estimés.
 * Stores vanilla lus directement : aucun re-render implicite hors ces sélecteurs.
 */
function ReglagesLiq() {
  const heatActif = useStore(liqMarksStore, (s) => s.actif);
  const estActif = useStore(liqEstStore, (s) => s.actif);
  const leviers = useStore(liqEstStore, (s) => s.leviers);
  const basculerLevier = useStore(liqEstStore, (s) => s.basculerLevier);
  const granularite = useStore(liqMarksStore, (s) => s.granularite);
  const setGranularite = useStore(liqMarksStore, (s) => s.setGranularite);
  if (!heatActif && !estActif) return null;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-4 py-2">
      <span className="text-[10px] uppercase tracking-wider text-text-dim">Réglages</span>

      {/* Leviers du modèle estimé : cases cochables, dernier coché non-décochable. */}
      <div
        role="group"
        aria-label="Leviers du modèle de niveaux estimés"
        className="flex items-center gap-0.5 rounded border border-border p-0.5"
      >
        {LEVIERS.map((L) => {
          const coche = leviers.includes(L);
          const verrou = coche && leviers.length === 1; // dernier coché : non-décochable
          return (
            <button
              key={L}
              type="button"
              onClick={() => basculerLevier(L)}
              aria-pressed={coche}
              disabled={verrou}
              title={
                verrou
                  ? `Levier ×${L} — au moins un levier doit rester coché`
                  : `${coche ? "Retirer" : "Inclure"} le levier ×${L} du modèle de niveaux estimés`
              }
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition ${
                coche ? "bg-bg text-text" : "text-text-dim hover:text-text"
              } ${verrou ? "cursor-not-allowed" : ""}`}
            >
              ×{L}
            </button>
          );
        })}
      </div>

      {/* Granularité des buckets de prix (facteur de tailleBucket). */}
      <div
        role="group"
        aria-label="Granularité des buckets de prix"
        title="Granularité des buckets de prix"
        className="flex items-center gap-0.5 rounded border border-border p-0.5"
      >
        {GRANULARITES.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => setGranularite(g.id)}
            aria-pressed={granularite === g.id}
            title={`Granularité des buckets de prix — ${g.label}`}
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition ${
              granularite === g.id ? "bg-bg text-text" : "text-text-dim hover:text-text"
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Sélecteur segmenté de fenêtre glissante (pattern Onglets, compact pour l'en-tête). */
function SelecteurFenetre({
  fenetre,
  onChange,
}: {
  fenetre: FenetreId;
  onChange: (f: FenetreId) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Fenêtre temporelle des totaux"
      className="flex items-center gap-0.5 rounded border border-border p-0.5"
    >
      {FENETRES.map((f) => (
        <button
          key={f.id}
          type="button"
          onClick={() => onChange(f.id)}
          aria-pressed={fenetre === f.id}
          title={`Totaux et stats sur les ${f.label} glissantes`}
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition ${
            fenetre === f.id ? "bg-bg text-text" : "text-text-dim hover:text-text"
          }`}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Mini-histogramme temporel de la fenêtre : shorts vers le HAUT (teinte --up, rachats
 * forcés), longs vers le BAS (teinte --down, ventes forcées), zéro central. Hauteurs
 * relatives au plus gros bucket. Rien si la fenêtre est vide.
 */
function Histogramme({ buckets }: { buckets: BucketTemporel[] }) {
  let max = 0;
  for (const b of buckets) max = Math.max(max, b.longUsd, b.shortUsd);
  if (max <= 0) return null;
  return (
    <div
      className="mt-3 flex h-14 items-stretch gap-px"
      title="Liquidations par tranche de temps — shorts vers le haut, longs vers le bas"
    >
      {buckets.map((b) => (
        <div key={b.t} className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-1 items-end border-b border-border/60">
            <div
              className="w-full"
              style={{ height: `${(b.shortUsd / max) * 100}%`, background: "var(--up)" }}
            />
          </div>
          <div className="flex flex-1 items-start">
            <div
              className="w-full"
              style={{ height: `${(b.longUsd / max) * 100}%`, background: "var(--down)" }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Ligne du feed : barre de fond proportionnelle à la magnitude LOG de la liquidation
 * (teinte du côté), montant en gras dès SEUIL_GRAS_USD. L'opacité passe par une classe
 * séparée (`opacity-15`) : les modificateurs slash (bg-down/15) ne sont PAS générés sur
 * les tokens var() par le Tailwind du repo.
 */
function LigneFeed({ ev, maxUsd }: { ev: LiqEvent; maxUsd: number }) {
  const venue = venueInfo(ev.venue);
  const grosse = ev.usd >= SEUIL_GRAS_USD;
  const part = magnitudeRelative(ev.usd, maxUsd);
  return (
    <div className="relative border-b border-border/40">
      <div
        className={`absolute inset-y-0 left-0 opacity-15 ${ev.side === "long" ? "bg-down" : "bg-up"}`}
        style={{ width: `${part * 100}%` }}
      />
      <div className={`relative py-1 text-xs ${GRILLE_FEED}`}>
        <span className="tabular-nums text-text-dim">{formatHeure(ev.time)}</span>
        <Badge ton={venue.ton} title={venue.long}>
          {venue.court}
        </Badge>
        <span className={`font-medium ${ev.side === "long" ? "text-down" : "text-up"}`}>
          {ev.side === "long" ? "Long" : "Short"}
        </span>
        <span className={`text-right tabular-nums text-text ${grosse ? "font-bold" : ""}`}>
          {formatUsd(ev.usd)}
        </span>
        <span className="text-right tabular-nums text-text-dim">{formatPrice(ev.price)}</span>
      </div>
    </div>
  );
}

/** Onglet « Live » : TOUT le contenu temps réel de la fenêtre (source : liqEventsStore). */
function ContenuLive() {
  const symbol = useStore(marketStore, (s) => s.symbol);
  const [fenetre, setFenetre] = useState<FenetreId>("1h");
  // Révision du buffer, throttlée : SEULE trace du flux dans le state React (un entier).
  const [rev, setRev] = useState(() => liqEventsStore.getState().rev);
  // Horloge lente : force un recalcul périodique pour faire glisser la fenêtre.
  const [horloge, setHorloge] = useState(0);

  // Rafraîchissement throttlé sur publication du store (trailing edge ~500 ms).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = liqEventsStore.subscribe(() => {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        setRev(liqEventsStore.getState().rev);
      }, THROTTLE_MS);
    });
    return () => {
      unsub();
      if (timer !== null) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setHorloge((n) => n + 1), HORLOGE_MS);
    return () => clearInterval(timer);
  }, []);

  const { stats, buckets, feed, feedMaxUsd } = useMemo(() => {
    const nowMs = Date.now();
    const depuisMs = nowMs - FENETRE_MS[fenetre];
    // Événements RÉELS uniquement : le seed Coinalyze (approx) est réservé à la heatmap.
    const reels = liqEventsStore.getState().events.filter((ev) => ev.approx !== true);
    const filtres = filtrerFenetre(reels, depuisMs);
    const stats = statsLiquidations(filtres);
    const buckets = bucketsTemporels(filtres, depuisMs, nowMs, N_BUCKETS);
    // Feed : les MAX_FEED dernières liq du buffer (indépendant de la fenêtre choisie).
    const feed = reels.slice(-MAX_FEED).reverse();
    let feedMaxUsd = 0;
    for (const ev of feed) if (ev.usd > feedMaxUsd) feedMaxUsd = ev.usd;
    return { stats, buckets, feed, feedMaxUsd };
    // `rev` et `horloge` pilotent le recalcul (le store vanilla mute hors React).
  }, [rev, horloge, fenetre, symbol]);

  const partLongPct = stats.partLong === null ? null : stats.partLong * 100;
  // Répartition venues triée par notionnel décroissant (ordre d'affichage stable).
  const venues = Object.entries(stats.parVenue).sort((a, b) => b[1].usd - a[1].usd);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnTeteFenetre
        titre="Liquidations"
        sousTitre={`${symbol} · ${okxCouvre(symbol) ? "perp Bybit + OKX (live)" : "perp Bybit (live)"}`}
        actions={
          <div className="flex items-center gap-1.5">
            <SelecteurFenetre fenetre={fenetre} onChange={setFenetre} />
            <ToggleChart />
            <SelecteurMode />
            <ToggleEstimes />
          </div>
        }
      />

      {/* Ligne « Réglages » (leviers estimés + granularité), sous les toggles ; masquée si
          aucune couche liquidations n'est active. */}
      <ReglagesLiq />

      {/* Bloc totaux/stats FIXE (seul le feed défile). Fenêtre glissante sélectionnée. */}
      <div className="shrink-0 px-4 pt-4">
        <div className="grid grid-cols-2 gap-3">
          <Metric label={`Longs liquidés (${fenetre})`} value={formatUsd(stats.longUsd)} couleur="var(--down)" />
          <Metric label={`Shorts liquidés (${fenetre})`} value={formatUsd(stats.shortUsd)} couleur="var(--up)" />
        </div>

        {/* Barre de dominance long/short (part du notionnel de la fenêtre). */}
        {partLongPct !== null && (
          <div className="mt-3">
            <div className="flex h-2 overflow-hidden rounded bg-surface">
              <div className="bg-down" style={{ width: `${partLongPct}%` }} />
              <div className="flex-1 bg-up" />
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-text-dim">
              <span>Longs {formatPourcentage(partLongPct)}</span>
              <span>Shorts {formatPourcentage(100 - partLongPct)}</span>
            </div>
          </div>
        )}

        {/* Ligne de stats compacte : nb · max · répartition par venue. */}
        {stats.nb > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-dim">
            <span className="tabular-nums">{stats.nb} liq</span>
            <span className="tabular-nums">max {formatUsd(stats.maxUsd)}</span>
            {venues.map(([venue, v]) => {
              const info = venueInfo(venue);
              return (
                <span key={venue} className="flex items-center gap-1">
                  <Badge ton={info.ton} title={info.long}>
                    {info.court}
                  </Badge>
                  <span className="tabular-nums">
                    {formatUsd(v.usd)} · {v.nb}
                  </span>
                </span>
              );
            })}
          </div>
        )}

        <Histogramme buckets={buckets} />
      </div>

      {/* Feed des dernières liquidations du buffer (scrollable, en-tête sticky). */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
        {feed.length === 0 ? (
          <Vide>
            En attente de liquidations… (flux live ; l'historique local — daemon/navigateur —
            se charge automatiquement s'il existe)
          </Vide>
        ) : (
          <div className="text-xs">
            <div
              className={`sticky top-0 z-10 border-b border-border bg-surface pb-1 text-[10px] uppercase tracking-wider text-text-dim ${GRILLE_FEED}`}
            >
              <span>Heure</span>
              <span>Venue</span>
              <span>Côté</span>
              <span className="text-right">Notionnel</span>
              <span className="text-right">Prix</span>
            </div>
            {feed.map((ev) => (
              <LigneFeed key={`${ev.time}-${ev.venue}-${ev.price}-${ev.qty}`} ev={ev} maxUsd={feedMaxUsd} />
            ))}
          </div>
        )}

        <div className="mt-3">
          <NoteSource>
            Flux de liquidations Bybit (canal allLiquidation) et OKX (canal liquidation-orders) en
            direct, complétés par l'historique local quand il existe — même source de données que
            la heatmap du graphe. Long = position longue fermée de force (vente). Totaux et stats
            sur la fenêtre glissante choisie ; feed = dernières liquidations du buffer.
          </NoteSource>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── Onglet « Historique » (daemon 30 j) ───────────────────────────

/** Fenêtres proposées par l'onglet Historique (borne basse de la lecture daemon). */
type FenetreHistoId = "1h" | "24h" | "7j" | "30j";
const FENETRES_HISTO: ReadonlyArray<{ id: FenetreHistoId; label: string }> = [
  { id: "1h", label: "1h" },
  { id: "24h", label: "24h" },
  { id: "7j", label: "7j" },
  { id: "30j", label: "30j" },
];
const FENETRE_HISTO_MS: Record<FenetreHistoId, number> = {
  "1h": 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  "7j": 7 * 24 * 60 * 60_000,
  "30j": 30 * 24 * 60 * 60_000,
};

/** Nombre de buckets de l'histogramme temporel de l'onglet Historique. */
const N_BUCKETS_HISTO = 48;
/** Taille du top des plus grosses liquidations affiché. */
const N_TOP = 10;
/** Borne haute de lecture daemon (généreuse : couvre les fenêtres les plus chargées). */
const LIMITE_HISTO = 100_000;
/** TTL du cache des lectures (pas de refetch en va-et-vient entre onglets). */
const CACHE_HISTO_MS = 60_000;

/** Une lecture d'historique mise en cache (`rows` null = daemon absent/sans capability). */
interface EntreeCacheHisto {
  t: number;
  depuis: number;
  rows: LiqDaemon[] | null;
}

/** Cache module-level par « symbole|fenêtre » : survit aux montages/démontages d'onglet. */
const cacheHisto = new Map<string, EntreeCacheHisto>();

/** Lit l'historique daemon de la fenêtre (via le cache 60 s). */
async function chargerHistorique(symbol: string, fenetre: FenetreHistoId): Promise<EntreeCacheHisto> {
  const cle = `${symbol}|${fenetre}`;
  const connue = cacheHisto.get(cle);
  if (connue !== undefined && Date.now() - connue.t < CACHE_HISTO_MS) return connue;
  const depuis = Date.now() - FENETRE_HISTO_MS[fenetre];
  const rows = await liquidationsGet(symbol, { depuis, limite: LIMITE_HISTO });
  const entree: EntreeCacheHisto = { t: Date.now(), depuis, rows };
  cacheHisto.set(cle, entree);
  return entree;
}

/** État de l'onglet Historique : lecture en cours, daemon absent, ou données prêtes. */
type EtatHisto =
  | { statut: "chargement" }
  | { statut: "absent" }
  | { statut: "pret"; events: LiqEvent[]; depuis: number; jusqua: number };

/** Sélecteur segmenté de fenêtre de l'onglet Historique (même style que SelecteurFenetre). */
function SelecteurFenetreHisto({
  fenetre,
  onChange,
}: {
  fenetre: FenetreHistoId;
  onChange: (f: FenetreHistoId) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Fenêtre de l'historique"
      className="flex items-center gap-0.5 rounded border border-border p-0.5"
    >
      {FENETRES_HISTO.map((f) => (
        <button
          key={f.id}
          type="button"
          onClick={() => onChange(f.id)}
          aria-pressed={fenetre === f.id}
          title={`Historique daemon sur les ${f.label} écoulés`}
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition ${
            fenetre === f.id ? "bg-bg text-text" : "text-text-dim hover:text-text"
          }`}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

/** Grille des lignes du top Historique (1re colonne élargie : date + heure). */
const GRILLE_TOP = "grid grid-cols-[86px_52px_42px_1fr_88px] items-center gap-2";

/**
 * Ligne du top Historique : mêmes codes que LigneFeed (barre de fond de magnitude log,
 * gras ≥ SEUIL_GRAS_USD) mais horodatée DATE + heure — sur 7j/30j, l'heure seule est ambiguë.
 */
function LigneTop({ ev, maxUsd }: { ev: LiqEvent; maxUsd: number }) {
  const venue = venueInfo(ev.venue);
  const grosse = ev.usd >= SEUIL_GRAS_USD;
  const part = magnitudeRelative(ev.usd, maxUsd);
  return (
    <div className="relative border-b border-border/40">
      <div
        className={`absolute inset-y-0 left-0 opacity-15 ${ev.side === "long" ? "bg-down" : "bg-up"}`}
        style={{ width: `${part * 100}%` }}
      />
      <div className={`relative py-1 text-xs ${GRILLE_TOP}`}>
        <span className="tabular-nums text-text-dim">{formatDateHeure(ev.time)}</span>
        <Badge ton={venue.ton} title={venue.long}>
          {venue.court}
        </Badge>
        <span className={`font-medium ${ev.side === "long" ? "text-down" : "text-up"}`}>
          {ev.side === "long" ? "Long" : "Short"}
        </span>
        <span className={`text-right tabular-nums text-text ${grosse ? "font-bold" : ""}`}>
          {formatUsd(ev.usd)}
        </span>
        <span className="text-right tabular-nums text-text-dim">{formatPrice(ev.price)}</span>
      </div>
    </div>
  );
}

/**
 * Onglet « Historique » : lecture ponctuelle du fil persistant du daemon (SQLite 30 j)
 * sur la fenêtre choisie, puis agrégats FROIDS (totaux, dominance, histogramme, top 10)
 * via les mêmes pures que l'onglet Live. Replis honnêtes : daemon absent (null) vs
 * fenêtre vide ([]) — le daemon n'enregistre que depuis son démarrage.
 */
function ContenuHistorique() {
  const symbol = useStore(marketStore, (s) => s.symbol);
  const [fenetre, setFenetre] = useState<FenetreHistoId>("24h");
  const [etat, setEtat] = useState<EtatHisto>({ statut: "chargement" });

  // Lecture à l'activation de l'onglet et à chaque changement fenêtre/symbole (cache 60 s ;
  // garde anti-course : si les deps changent pendant l'attente, le résultat est jeté).
  useEffect(() => {
    let annule = false;
    setEtat({ statut: "chargement" });
    void chargerHistorique(symbol, fenetre).then(({ rows, depuis }) => {
      if (annule) return;
      if (rows === null) setEtat({ statut: "absent" });
      else
        setEtat({
          statut: "pret",
          events: daemonVersEvenements(rows),
          depuis,
          jusqua: depuis + FENETRE_HISTO_MS[fenetre],
        });
    });
    return () => {
      annule = true;
    };
  }, [symbol, fenetre]);

  // Agrégats de la fenêtre — données froides : recalcul uniquement sur nouvel état.
  const derives = useMemo(() => {
    if (etat.statut !== "pret") return null;
    return {
      stats: statsLiquidations(etat.events),
      buckets: bucketsTemporels(etat.events, etat.depuis, etat.jusqua, N_BUCKETS_HISTO),
      top: topLiquidations(etat.events, N_TOP),
    };
  }, [etat]);

  const partLongPct =
    derives === null || derives.stats.partLong === null ? null : derives.stats.partLong * 100;
  const venues =
    derives === null ? [] : Object.entries(derives.stats.parVenue).sort((a, b) => b[1].usd - a[1].usd);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnTeteFenetre
        titre="Liquidations"
        sousTitre={`${symbol} · historique daemon (rétention 30 j)`}
        actions={<SelecteurFenetreHisto fenetre={fenetre} onChange={setFenetre} />}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {etat.statut === "chargement" && <Chargement libelle="Lecture de l'historique daemon…" />}

        {etat.statut === "absent" && (
          <Vide>
            <div className="flex flex-col items-center gap-2">
              <Badge ton="neutre">daemon absent</Badge>
              <span>Historique indisponible — daemon axiomd requis (npm run daemon)</span>
            </div>
          </Vide>
        )}

        {derives !== null &&
          (derives.stats.nb === 0 ? (
            <Vide>Aucune liquidation enregistrée sur la fenêtre</Vide>
          ) : (
            <>
              {/* Totaux longs/shorts de la fenêtre. */}
              <div className="grid grid-cols-2 gap-3">
                <Metric
                  label={`Longs liquidés (${fenetre})`}
                  value={formatUsd(derives.stats.longUsd)}
                  couleur="var(--down)"
                />
                <Metric
                  label={`Shorts liquidés (${fenetre})`}
                  value={formatUsd(derives.stats.shortUsd)}
                  couleur="var(--up)"
                />
              </div>

              {/* Barre de dominance long/short (part du notionnel de la fenêtre). */}
              {partLongPct !== null && (
                <div className="mt-3">
                  <div className="flex h-2 overflow-hidden rounded bg-surface">
                    <div className="bg-down" style={{ width: `${partLongPct}%` }} />
                    <div className="flex-1 bg-up" />
                  </div>
                  <div className="mt-1 flex justify-between text-[10px] text-text-dim">
                    <span>Longs {formatPourcentage(partLongPct)}</span>
                    <span>Shorts {formatPourcentage(100 - partLongPct)}</span>
                  </div>
                </div>
              )}

              {/* Ligne de stats compacte : nb · max · répartition par venue. */}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-dim">
                <span className="tabular-nums">{derives.stats.nb} liq</span>
                <span className="tabular-nums">max {formatUsd(derives.stats.maxUsd)}</span>
                {venues.map(([venue, v]) => {
                  const info = venueInfo(venue);
                  return (
                    <span key={venue} className="flex items-center gap-1">
                      <Badge ton={info.ton} title={info.long}>
                        {info.court}
                      </Badge>
                      <span className="tabular-nums">
                        {formatUsd(v.usd)} · {v.nb}
                      </span>
                    </span>
                  );
                })}
              </div>

              <Histogramme buckets={derives.buckets} />

              {/* Top des plus grosses liquidations de la fenêtre. */}
              <div className="mt-4 text-xs">
                <div
                  className={`border-b border-border pb-1 text-[10px] uppercase tracking-wider text-text-dim ${GRILLE_TOP}`}
                >
                  <span>Heure</span>
                  <span>Venue</span>
                  <span>Côté</span>
                  <span className="text-right">Notionnel</span>
                  <span className="text-right">Prix</span>
                </div>
                {derives.top.map((ev) => (
                  <LigneTop
                    key={`${ev.time}-${ev.venue}-${ev.price}-${ev.qty}`}
                    ev={ev}
                    maxUsd={derives.top[0]?.usd ?? 0}
                  />
                ))}
              </div>
            </>
          ))}

        <div className="mt-3">
          <NoteSource>
            Historique daemon local (depuis son démarrage, rétention 30 j) — Bybit + OKX.
          </NoteSource>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── Fenêtre (onglets Live / Historique) ───────────────────────────

type OngletId = "live" | "historique";
const ONGLETS: ReadonlyArray<{ id: OngletId; label: string }> = [
  { id: "live", label: "Live" },
  { id: "historique", label: "Historique" },
];

export function LiquidationsWindow() {
  const [onglet, setOnglet] = useState<OngletId>("live");

  // Retient le flux du singleton (refcount) TANT QUE la fenêtre est ouverte, quel que soit
  // l'onglet affiché : source unique fenêtre + heatmap. Le changement de symbole est géré
  // par le singleton lui-même (reseed daemon/localStorage).
  useEffect(() => retenirFluxLiq(), []);

  return (
    <div className="flex h-full flex-col">
      <Onglets options={ONGLETS} actif={onglet} onChange={setOnglet} />
      {onglet === "live" ? <ContenuLive /> : <ContenuHistorique />}
    </div>
  );
}
