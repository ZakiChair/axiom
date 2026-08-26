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
 *    buffer avec hiérarchie de magnitude (barre de fond log, ≥ $1M en gras) ; les
 *    cascades (liq consécutives de même côté espacées de < 2 s) y sont GROUPÉES en une
 *    ligne « ×N » cliquable qui déplie/replie le détail (cf. grouperCascades) ; un clic
 *    sur une ligne simple ou de détail navigue le graphe vers la liquidation (heatmap
 *    allumée au besoin, recentrage + flash de la bande de prix — cf. voirSurGraphe) ;
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
import { flasherNiveau } from "../chart/liquidationHeat";
import { orderflowStore } from "../store/orderflow";
import { getActiveChart } from "../chart/drawing";
import { liquidationsGet, type LiqDaemon } from "../data/daemon";
import { histLiqParHeure } from "../data/referentiels";
import { referentiel, type PointSerie } from "../lib/referentiel";
import { IS_VERCEL } from "../lib/deployment";
import {
  EnTeteFenetre,
  Vide,
  NoteSource,
  TuileStat,
  Badge,
  Chargement,
  Onglets,
  RefBadge,
  SegmenteCompact,
  CLASSES_SEGMENT_CONTENEUR,
  classesSegmentItem,
  BoutonBascule,
  Fraicheur,
  Unusable,
  type TonBadge,
} from "./ui";
import {
  formatUsd,
  formatHeure,
  formatHeureMinute,
  formatDateHeure,
  formatPrice,
  formatPourcentage,
} from "../lib/format";
import {
  bucketsTemporels,
  couvreFenetre,
  daemonVersEvenements,
  filtrerFenetre,
  grouperCascades,
  magnitudeRelative,
  statsLiquidations,
  topLiquidations,
  type BucketTemporel,
  type GroupeCascade,
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
const FENETRES: ReadonlyArray<{ id: FenetreId; label: string; title: string }> = [
  { id: "5m", label: "5m", title: "Totaux et stats sur les 5m glissantes" },
  { id: "1h", label: "1h", title: "Totaux et stats sur les 1h glissantes" },
  { id: "24h", label: "24h", title: "Totaux et stats sur les 24h glissantes" },
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
 * Lien feed→chart : navigue le graphe vers une liquidation du feed — allume la heatmap si
 * elle est éteinte (setActif, relayé au contrôleur par ChartInstance), recentre le chart
 * FOCUS sur le timestamp de la liquidation (`scrollToTimestamp`, API klinecharts 9.8) puis
 * flashe la bande de prix correspondante 1,5 s (cf. chart/liquidationHeat.ts).
 */
function voirSurGraphe(ev: LiqEvent): void {
  const marks = liqMarksStore.getState();
  if (!marks.actif) marks.setActif(true);
  getActiveChart()?.scrollToTimestamp(ev.time);
  flasherNiveau(ev.price);
}

/**
 * Bascule « Sur le graphe » : active/désactive les marqueurs de liquidation sur le
 * chart (liqMarksStore, cf. chart/liquidationMarkers.ts). Rend la feature découvrable
 * depuis la fenêtre, sans passer par ⌘K LIQMARK.
 */
function ToggleChart() {
  const actif = useStore(liqMarksStore, (s) => s.actif);
  const basculer = useStore(liqMarksStore, (s) => s.basculer);
  // Footprint actif : la heatmap est atténuée ×0.5 (cf. chart/liquidationHeat.ts) — on le
  // signale d'une ligne pour expliquer la couleur plus pâle quand les deux couches coexistent.
  const footprintActif = useStore(orderflowStore, (s) => s.enabled);
  return (
    <>
      <BoutonBascule
        actif={actif}
        onClick={basculer}
        title="Afficher les liquidations sur le graphe (marqueurs)"
      >
        Sur le graphe
      </BoutonBascule>
      {actif && footprintActif && (
        <p className="text-[10px] text-text-dim">Heatmap atténuée : footprint actif.</p>
      )}
    </>
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
    <SegmenteCompact
      options={MODES_HEATMAP}
      actif={mode}
      onChange={setMode}
      ariaLabel="Mode de coloration de la heatmap"
    />
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
    <BoutonBascule
      actif={actif}
      onClick={basculer}
      title="Niveaux de liquidation ESTIMÉS depuis l'OI (modèle de levier — approximation, étiquetée EST.)"
    >
      Niveaux estimés
    </BoutonBascule>
  );
}

/** Granularités proposées : facteur multiplicatif de la taille de bucket de prix. */
const GRANULARITES: ReadonlyArray<{ id: Granularite; label: string; title: string }> = [
  { id: 0.5, label: "½×", title: "Granularité des buckets de prix — ½×" },
  { id: 1, label: "1×", title: "Granularité des buckets de prix — 1×" },
  { id: 2, label: "2×", title: "Granularité des buckets de prix — 2×" },
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
      <div role="group" aria-label="Leviers du modèle de niveaux estimés" className={CLASSES_SEGMENT_CONTENEUR}>
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
              className={`${classesSegmentItem(coche)} ${verrou ? "cursor-not-allowed" : ""}`}
            >
              ×{L}
            </button>
          );
        })}
      </div>

      {/* Granularité des buckets de prix (facteur de tailleBucket). */}
      <SegmenteCompact
        options={GRANULARITES}
        actif={granularite}
        onChange={setGranularite}
        ariaLabel="Granularité des buckets de prix"
      />
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
    <SegmenteCompact
      options={FENETRES}
      actif={fenetre}
      onChange={onChange}
      ariaLabel="Fenêtre temporelle des totaux"
    />
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
 * les tokens var() par le Tailwind du repo. CLIQUABLE (événements isolés ET lignes de
 * détail dépliées d'un groupe) : navigue le graphe vers la liquidation (cf. voirSurGraphe).
 */
function LigneFeed({ ev, maxUsd }: { ev: LiqEvent; maxUsd: number }) {
  const venue = venueInfo(ev.venue);
  const grosse = ev.usd >= SEUIL_GRAS_USD;
  const part = magnitudeRelative(ev.usd, maxUsd);
  return (
    <button
      type="button"
      onClick={() => voirSurGraphe(ev)}
      title="Voir sur le graphe"
      className="relative block w-full cursor-pointer border-b border-border/40 text-left transition hover:bg-bg"
    >
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
    </button>
  );
}

/**
 * Ligne de GROUPE du feed (cascade) : « ×N » + côté, SOMME notionnelle (gras dès
 * SEUIL_GRAS_USD), fourchette de prix, venues cumulées (badges) et barre de fond de
 * magnitude calculée sur la somme. CLIQUABLE : déplie/replie les lignes détail en
 * dessous (état porté par le parent, clé `debut-side`). Heure compacte HH:MM (du plus
 * récent événement) pour laisser la place au chevron dans la colonne.
 */
function LigneGroupe({
  g,
  maxUsd,
  ouvert,
  onToggle,
}: {
  g: GroupeCascade;
  maxUsd: number;
  ouvert: boolean;
  onToggle: () => void;
}) {
  const grosse = g.sommeUsd >= SEUIL_GRAS_USD;
  const part = magnitudeRelative(g.sommeUsd, maxUsd);
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={ouvert}
        title={`Cascade ${g.side} ×${g.events.length} — cliquer pour ${ouvert ? "replier" : "déplier"} le détail`}
        className="relative block w-full border-b border-border/40 text-left transition hover:bg-bg"
      >
        <div
          className={`absolute inset-y-0 left-0 opacity-15 ${g.side === "long" ? "bg-down" : "bg-up"}`}
          style={{ width: `${part * 100}%` }}
        />
        <div className={`relative py-1 text-xs ${GRILLE_FEED}`}>
          <span className="tabular-nums text-text-dim">
            <span aria-hidden className="mr-1 inline-block w-2 text-[9px]">
              {ouvert ? "▾" : "▸"}
            </span>
            {formatHeureMinute(g.fin)}
          </span>
          <span className="flex flex-wrap items-center gap-0.5">
            {g.venues.map((venue) => {
              const info = venueInfo(venue);
              return (
                <Badge key={venue} ton={info.ton} title={info.long}>
                  {info.court}
                </Badge>
              );
            })}
          </span>
          <span className={`font-medium ${g.side === "long" ? "text-down" : "text-up"}`}>
            {g.side === "long" ? "Long" : "Short"}
          </span>
          <span className={`text-right tabular-nums text-text ${grosse ? "font-bold" : ""}`}>
            ×{g.events.length} · {formatUsd(g.sommeUsd)}
          </span>
          <span className="text-right text-[10px] tabular-nums text-text-dim">
            {g.prixMin === g.prixMax
              ? formatPrice(g.prixMin)
              : `${formatPrice(g.prixMin)}–${formatPrice(g.prixMax)}`}
          </span>
        </div>
      </button>
      {ouvert && (
        <div className="border-l-2 border-border pl-1">
          {g.events.map((ev) => (
            <LigneFeed key={`${ev.time}-${ev.venue}-${ev.price}-${ev.qty}`} ev={ev} maxUsd={maxUsd} />
          ))}
        </div>
      )}
    </>
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
  // Groupes cascade dépliés dans le feed (clé stable `debut-side`).
  const [deplies, setDeplies] = useState<Set<string>>(() => new Set());

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

  const { stats, buckets, feed, feedMaxUsd, derniereMajTs } = useMemo(() => {
    const nowMs = Date.now();
    const depuisMs = nowMs - FENETRE_MS[fenetre];
    // Événements RÉELS uniquement : le seed Coinalyze (approx) est réservé à la heatmap.
    const reels = liqEventsStore.getState().events.filter((ev) => ev.approx !== true);
    const filtres = filtrerFenetre(reels, depuisMs);
    const stats = statsLiquidations(filtres);
    const buckets = bucketsTemporels(filtres, depuisMs, nowMs, N_BUCKETS);
    // Feed : les MAX_FEED dernières liq du buffer (indépendant de la fenêtre choisie),
    // cascades groupées (liq consécutives de même côté espacées de < 2 s → ligne ×N).
    const feed = grouperCascades(reels.slice(-MAX_FEED).reverse());
    // Barre de magnitude à l'échelle des ITEMS : la somme d'un groupe compte comme un tout.
    let feedMaxUsd = 0;
    for (const item of feed) {
      const usd = item.type === "groupe" ? item.sommeUsd : item.ev.usd;
      if (usd > feedMaxUsd) feedMaxUsd = usd;
    }
    // Horodatage du dernier événement réel du buffer (`reels` est chronologique croissant) —
    // aucun nouvel abonnement : dérivé du même tableau que les stats.
    const derniereMajTs = reels[reels.length - 1]?.time ?? null;
    return { stats, buckets, feed, feedMaxUsd, derniereMajTs };
    // `rev` et `horloge` pilotent le recalcul (le store vanilla mute hors React).
  }, [rev, horloge, fenetre, symbol]);

  // Baseline : USD liquidé/heure sur 30 j (daemon). Null si daemon absent → pas de badge.
  const [serieHeure, setSerieHeure] = useState<PointSerie[] | null>(null);
  useEffect(() => {
    let vivant = true;
    setSerieHeure(null);
    void histLiqParHeure(symbol).then((s) => {
      if (vivant) setSerieHeure(s);
    });
    return () => {
      vivant = false;
    };
  }, [symbol]);

  const baseline = useMemo(() => {
    if (serieHeure === null) return null;
    const nowMs = Date.now();
    const reels = liqEventsStore.getState().events.filter((ev) => ev.approx !== true);
    // Tant que le flux ne couvre pas une heure pleine, `total1h` sous-estime (fenêtre
    // partielle) et lirait « calme » à tort → pas de baseline.
    if (!couvreFenetre(reels, 3_600_000, nowMs)) return null;
    const total1h = statsLiquidations(filtrerFenetre(reels, nowMs - 3_600_000)).total;
    return { total1h, ref: referentiel(serieHeure, total1h, nowMs) };
  }, [serieHeure, rev, horloge, symbol]);

  /** Déplie/replie un groupe cascade du feed (clé `debut-side`). */
  const basculerGroupe = (cle: string): void => {
    setDeplies((prev) => {
      const suivant = new Set(prev);
      if (!suivant.delete(cle)) suivant.add(cle);
      return suivant;
    });
  };

  const partLongPct = stats.partLong === null ? null : stats.partLong * 100;
  // Répartition venues triée par notionnel décroissant (ordre d'affichage stable).
  const venues = Object.entries(stats.parVenue).sort((a, b) => b[1].usd - a[1].usd);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Contrôles sur leur propre rangée (wrap) : 4 contrôles dans `actions` de l'en-tête
          écrasaient le titre à la largeur par défaut de la fenêtre (460 px). */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-4 pt-2">
        <SelecteurFenetre fenetre={fenetre} onChange={setFenetre} />
        <ToggleChart />
        <SelecteurMode />
        <ToggleEstimes />
      </div>

      {/* Ligne « Réglages » (leviers estimés + granularité), sous les toggles ; masquée si
          aucune couche liquidations n'est active. */}
      <ReglagesLiq />

      {/* Bloc totaux/stats FIXE (seul le feed défile). Fenêtre glissante sélectionnée. */}
      <div className="shrink-0 px-4 pt-4">
        {/* Fraîcheur = horodatage du dernier événement RÉEL du buffer (aucun nouvel
            abonnement : dérivé du même tableau `reels` que les stats ci-dessous). */}
        <div className="mb-1 flex justify-end text-[10px] text-text-dim">
          <Fraicheur loading={false} majTs={derniereMajTs} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TuileStat disposition="inline" label={`Longs liquidés (${fenetre})`} valeur={formatUsd(stats.longUsd)} couleur="var(--down)" />
          <TuileStat disposition="inline" label={`Shorts liquidés (${fenetre})`} valeur={formatUsd(stats.shortUsd)} couleur="var(--up)" />
        </div>

        {/* Baseline USD/heure vs 30 j (daemon) : rien si le daemon est absent. */}
        {baseline !== null && (
          <div className="mt-2 flex items-center gap-2 text-[11px] tabular-nums text-text-dim">
            <span>1 h : {formatUsd(baseline.total1h)}</span>
            <RefBadge referentiel={baseline.ref} sens="hausse-chaud" />
          </div>
        )}

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
        <div className="mb-1 text-[10px] uppercase tracking-wider text-text-dim">
          Dernières liquidations ({MAX_FEED} max · indépendant de la fenêtre 5m/1h/24h)
        </div>
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
            {feed.map((item) => {
              if (item.type === "seul") {
                const { ev } = item;
                return (
                  <LigneFeed
                    key={`${ev.time}-${ev.venue}-${ev.price}-${ev.qty}`}
                    ev={ev}
                    maxUsd={feedMaxUsd}
                  />
                );
              }
              const cle = `${item.debut}-${item.side}`;
              return (
                <LigneGroupe
                  key={cle}
                  g={item}
                  maxUsd={feedMaxUsd}
                  ouvert={deplies.has(cle)}
                  onToggle={() => basculerGroupe(cle)}
                />
              );
            })}
          </div>
        )}

        <div className="mt-3">
          <NoteSource>
            Flux de liquidations Bybit (canal allLiquidation) et OKX (canal liquidation-orders) en
            direct, complétés par l'historique local quand il existe — même source de données que
            la heatmap du graphe. Long = position longue fermée de force (vente). Totaux et stats
            sur la fenêtre glissante choisie ; feed = dernières liquidations du buffer (cascades
            de même côté espacées de moins de 2 s groupées en ×N — cliquer pour le détail).
            Cliquer une liquidation la montre sur le graphe (recentrage + flash de la bande).
          </NoteSource>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── Onglet « Historique » (daemon 30 j) ───────────────────────────

/** Fenêtres proposées par l'onglet Historique (borne basse de la lecture daemon). */
type FenetreHistoId = "1h" | "24h" | "7j" | "30j";
const FENETRES_HISTO: ReadonlyArray<{ id: FenetreHistoId; label: string; title: string }> = [
  { id: "1h", label: "1h", title: "Historique daemon sur les 1h écoulés" },
  { id: "24h", label: "24h", title: "Historique daemon sur les 24h écoulés" },
  { id: "7j", label: "7j", title: "Historique daemon sur les 7j écoulés" },
  { id: "30j", label: "30j", title: "Historique daemon sur les 30j écoulés" },
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
    <SegmenteCompact
      options={FENETRES_HISTO}
      actif={fenetre}
      onChange={onChange}
      ariaLabel="Fenêtre de l'historique"
    />
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
function ContenuHistorique({
  fenetre,
  onChangeFenetre,
}: {
  fenetre: FenetreHistoId;
  onChangeFenetre: (f: FenetreHistoId) => void;
}) {
  const symbol = useStore(marketStore, (s) => s.symbol);
  const [etat, setEtat] = useState<EtatHisto>(
    IS_VERCEL ? { statut: "absent" } : { statut: "chargement" },
  );

  // Lecture à l'activation de l'onglet et à chaque changement fenêtre/symbole (cache 60 s ;
  // garde anti-course : si les deps changent pendant l'attente, le résultat est jeté).
  useEffect(() => {
    if (IS_VERCEL) {
      setEtat({ statut: "absent" });
      return;
    }
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
      {/* Rangée « Réglages » de l'onglet, sous les onglets Live/Historique — le sélecteur de
          fenêtre ne dépend QUE de cet onglet (retiré du slot actions de l'en-tête). */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-4 py-2">
        <span className="text-[10px] uppercase tracking-wider text-text-dim">Réglages</span>
        <SelecteurFenetreHisto fenetre={fenetre} onChange={onChangeFenetre} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {etat.statut === "chargement" && <Chargement libelle="Lecture de l'historique daemon…" />}

        {etat.statut === "absent" &&
          (IS_VERCEL ? (
            <Unusable raison="L'historique persistant dépend du daemon local axiomd, indisponible sur Vercel." />
          ) : (
            <Vide>
              <div className="flex flex-col items-center gap-2">
                <Badge ton="neutre">daemon absent</Badge>
                <span>Historique indisponible — daemon axiomd requis (npm run daemon)</span>
              </div>
            </Vide>
          ))}

        {derives !== null &&
          (derives.stats.nb === 0 ? (
            <Vide>Aucune liquidation enregistrée sur la fenêtre</Vide>
          ) : (
            <>
              {/* Totaux longs/shorts de la fenêtre. */}
              <div className="grid grid-cols-2 gap-3">
                <TuileStat
                  disposition="inline"
                  label={`Longs liquidés (${fenetre})`}
                  valeur={formatUsd(derives.stats.longUsd)}
                  couleur="var(--down)"
                />
                <TuileStat
                  disposition="inline"
                  label={`Shorts liquidés (${fenetre})`}
                  valeur={formatUsd(derives.stats.shortUsd)}
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
                  <span>Date · heure</span>
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
  const symbol = useStore(marketStore, (s) => s.symbol);
  // Fenêtre de l'onglet Historique, levée ici pour survivre au changement d'onglet
  // (le sélecteur — cf. SelecteurFenetreHisto — vit dans la rangée « Réglages » du corps).
  const [fenetre, setFenetre] = useState<FenetreHistoId>("24h");

  // Retient le flux du singleton (refcount) TANT QUE la fenêtre est ouverte, quel que soit
  // l'onglet affiché : source unique fenêtre + heatmap. Le changement de symbole est géré
  // par le singleton lui-même (reseed daemon/localStorage).
  useEffect(() => retenirFluxLiq(), []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnTeteFenetre
        mnemo="LIQ"
        titre="Liquidations"
        sousTitre={
          onglet === "live"
            ? `${symbol} · ${okxCouvre(symbol) ? "perp Bybit + OKX (live)" : "perp Bybit (live)"}`
            : `${symbol} · historique daemon (rétention 30 j)`
        }
      />
      <Onglets options={ONGLETS} actif={onglet} onChange={setOnglet} />
      {onglet === "live" ? (
        <ContenuLive />
      ) : (
        <ContenuHistorique fenetre={fenetre} onChangeFenetre={setFenetre} />
      )}
    </div>
  );
}
