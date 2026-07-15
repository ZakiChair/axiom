/**
 * Fenêtre « Liquidations » (mnémonique LIQ) — SOURCE UNIQUE : lit le buffer borné du
 * singleton (`liqEventsStore`, cf. chart/liquidationMarkers.ts : seed daemon/localStorage/
 * Coinalyze + live) au lieu d'ouvrir son propre WS. Le flux est retenu via
 * `retenirFluxLiq` (refcount) : il est actif dès que la fenêtre est ouverte OU que la
 * heatmap du chart est ON — mêmes chiffres partout, un seul jeu de sockets.
 *
 * Affiche : totaux/stats sur FENÊTRE GLISSANTE (5m/1h/24h), barre de dominance,
 * mini-histogramme temporel (shorts ↑ / longs ↓), et le feed des ~60 dernières liq du
 * buffer avec hiérarchie de magnitude (barre de fond log, ≥ $1M en gras).
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
} from "../chart/liquidationMarkers";
import { liqEstStore } from "../chart/liquidationEstimates";
import { EnTeteFenetre, Vide, NoteSource, Metric, Badge, type TonBadge } from "./ui";
import { formatUsd, formatHeure, formatPrice, formatPourcentage } from "../lib/format";
import {
  bucketsTemporels,
  filtrerFenetre,
  magnitudeRelative,
  statsLiquidations,
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

export function LiquidationsWindow() {
  const symbol = useStore(marketStore, (s) => s.symbol);
  const [fenetre, setFenetre] = useState<FenetreId>("1h");
  // Révision du buffer, throttlée : SEULE trace du flux dans le state React (un entier).
  const [rev, setRev] = useState(() => liqEventsStore.getState().rev);
  // Horloge lente : force un recalcul périodique pour faire glisser la fenêtre.
  const [horloge, setHorloge] = useState(0);

  // Retient le flux du singleton (refcount) : source unique fenêtre + heatmap. Le
  // changement de symbole est géré par le singleton lui-même (reseed daemon/localStorage).
  useEffect(() => retenirFluxLiq(), []);

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
    <div className="flex h-full flex-col">
      <EnTeteFenetre
        titre="Liquidations"
        sousTitre={`${symbol} · ${okxCouvre(symbol) ? "perp Bybit + OKX (live)" : "perp Bybit (live)"}`}
        actions={
          <div className="flex items-center gap-1.5">
            <SelecteurFenetre fenetre={fenetre} onChange={setFenetre} />
            <ToggleChart />
            <ToggleEstimes />
          </div>
        }
      />

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
