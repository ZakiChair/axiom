/**
 * Fenêtre « BRIEF » — Snapshot marché (ouverture + review de session). Non modale,
 * montée génériquement sous <FloatingWindow> (comme FUND/VOL).
 *
 * POURQUOI : donner en UN écran le contexte d'ouverture de journée en composant des
 * sources DÉJÀ intégrées (watchlist overnight, dérivés, flux ETF, éco du jour, actualités
 * + Fear & Greed, DVOL) ET la review de session du soir (trades clos, PnL réalisé,
 * alertes déclenchées, éco passés — stores portfolio/alertes locaux). C'est un
 * INSTANTANÉ, pas un flux : les données marché sont chargées au montage (et sur
 * « Rafraîchir »), JAMAIS en polling continu. Chaque section se charge indépendamment
 * (data/brief.ts délègue aux modules existants) : une source en panne affiche
 * ErreurBloc/Vide sans casser l'écran. L'export « → Notes » sérialise l'instantané
 * via la fonction PURE `briefEnMarkdown` et l'ajoute au journal (store notes existant).
 *
 * Fenêtre-vitrine du standard UI : primitives components/ui.tsx + helpers lib/format.ts,
 * store UI vanilla éphémère + `mirrorOpenState`, aucun helper de formatage local dupliqué.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { Commande } from "../commands/registry";
import { windowManagerStore, mirrorOpenState } from "../store/windowManager";
import { watchlistStore } from "../store/watchlist";
import { marketStore } from "../store/market";
import { notesStore } from "../store/notes";
import { portfolioStore } from "../store/portfolio";
import { alertsStore } from "../store/alerts";
import { regimeStore } from "../store/regime";
import { tonRegime } from "../data/regime";
import { lectures } from "../data/lecturesBrief";
import {
  assemblerSession,
  briefEnMarkdown,
  fetchDerivsBrief,
  fetchDvolBrief,
  fetchEcoBrief,
  fetchEtfBrief,
  fetchFearGreed,
  fetchNewsBrief,
  fetchWatchlistOvernight,
  type DonneesBrief,
  type DvolBrief,
  type EtfBrief,
  type EvenementBrief,
  type FearGreed,
  type LigneDeriv,
  type LigneWatchlist,
  type TitreNews,
} from "../data/brief";
import {
  formatAge,
  formatDelai,
  formatDec,
  formatFunding,
  formatHeureMinute,
  formatPct,
  formatPourcentage,
  formatPrice,
  formatUsd,
  formatUsdSigne,
  VALEUR_ABSENTE,
} from "../lib/format";
import { navigateTo } from "../lib/navigation";
import {
  Badge,
  BTN_SECONDAIRE,
  Chargement,
  EnTeteFenetre,
  ErreurBloc,
  Metric,
  NoteSource,
  RefBadge,
  Vide,
} from "./ui";

// ─────────────────────────── Store UI (vanilla, éphémère, non persisté) ───────────────────────────

export interface BriefUiState {
  open: boolean;
  openBrief: () => void;
  closeBrief: () => void;
  toggleBrief: () => void;
}

export const briefUiStore = createStore<BriefUiState>(() => ({
  open: false,
  openBrief: () => windowManagerStore.getState().openWindow("brief"),
  closeBrief: () => windowManagerStore.getState().closeWindow("brief"),
  toggleBrief: () => windowManagerStore.getState().toggleWindow("brief"),
}));

mirrorOpenState("brief", briefUiStore);

/** Commandes exposées à la palette (⌘K) — greffées par App.tsx via `enregistrerCommandes`. */
export const commandes: Commande[] = [
  {
    id: "panneau:brief",
    mnemonique: "BRIEF",
    libelle: "Point marché (BRIEF)",
    categorie: "panneau",
    motsCles: ["brief", "point marché", "snapshot", "matin", "morning", "overnight", "résumé", "ouverture"],
    apercu: "Ouvre / ferme le snapshot marché matinal",
    action: () => briefUiStore.getState().toggleBrief(),
  },
];

// ─────────────────────────── État de chargement par section ───────────────────────────

type Statut = "idle" | "loading" | "ready" | "error";

/** État d'une section : statut de chargement + données (null tant qu'absentes). */
interface Section<T> {
  statut: Statut;
  data: T | null;
}

const EN_ATTENTE = { statut: "loading" as Statut, data: null };

// ─────────────────────────── Helpers d'affichage (locaux, purs) ───────────────────────────

/** Couleur sémantique d'une variation (vert/rouge/neutre) — token CSS ou undefined. */
function couleurVariation(v: number | null): string | undefined {
  if (v === null || !Number.isFinite(v) || v === 0) return undefined;
  return v > 0 ? "var(--up)" : "var(--down)";
}

/** Titre de bloc (petites capitales espacées, ton estompé). */
function TitreBloc({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-dim">{children}</h3>
  );
}

/**
 * Rend le corps d'une section selon son statut : Chargement → ErreurBloc → contenu. Le
 * cas « donnée présente mais vide » est décidé par `rendu` (qui peut renvoyer <Vide/>).
 */
function corps<T>(section: Section<T>, erreur: string, rendu: (data: T) => ReactNode): ReactNode {
  if (section.statut === "idle" || section.statut === "loading") return <Chargement />;
  if (section.statut === "error" || section.data === null) return <ErreurBloc>{erreur}</ErreurBloc>;
  return rendu(section.data);
}

// ─────────────────────────── Composant principal ───────────────────────────

export function BriefWindow() {
  const open = useStore(briefUiStore, (s) => s.open);
  // Stores locaux pour la review de session (pas de fetch réseau).
  const positions = useStore(portfolioStore, (s) => s.positions);
  const journalAlertes = useStore(alertsStore, (s) => s.journal);
  // Chapeau AUTONOME : régime + valeurs courantes viennent du store regime (poller 15 min),
  // indépendants des sections réseau de la fenêtre (qui peuvent être en erreur séparément).
  const regime = useStore(regimeStore, (s) => s.regime);
  const chapeau = useStore(regimeStore, (s) => s.chapeau);

  const phrasesLecture = useMemo(() => {
    if (chapeau === null) return [];
    return lectures({
      nuitBtcPct: chapeau.nuitBtcPct,
      fundingPercentile: chapeau.fundingRef?.percentile ?? null,
      dvolPercentile: chapeau.dvolRef?.percentile ?? null,
      deltaOi24hPct: chapeau.deltaOi24hPct,
      fearGreed: chapeau.fearGreed,
    });
  }, [chapeau]);

  // Horodatage du snapshot courant (fraîcheur affichée + référence des délais/âges).
  const [chargeA, setChargeA] = useState<number | null>(null);
  const [exporte, setExporte] = useState(false);
  // Chargement en cours : désactive « Rafraîchir » (le ref garde le clic synchrone contre
  // l'empilement de générations de fetchs — quota Coinalyze partagé avec DERIV).
  const [enChargement, setEnChargement] = useState(false);

  const [watchlist, setWatchlist] = useState<Section<LigneWatchlist[]>>(EN_ATTENTE);
  const [derivs, setDerivs] = useState<Section<LigneDeriv[]>>(EN_ATTENTE);
  const [etf, setEtf] = useState<Section<EtfBrief[]>>(EN_ATTENTE);
  const [eco, setEco] = useState<Section<EvenementBrief[]>>(EN_ATTENTE);
  const [news, setNews] = useState<Section<TitreNews[]>>(EN_ATTENTE);
  const [fearGreed, setFearGreed] = useState<Section<FearGreed>>(EN_ATTENTE);
  const [dvol, setDvol] = useState<Section<DvolBrief[]>>(EN_ATTENTE);

  // Garde d'annulation : chaque `charger` incrémente la génération et remplace le
  // contrôleur ; les callbacks des fetchs de la génération précédente sont ignorés
  // (fermeture/démontage/refresh) — même esprit que l'`ignore` de FundWindow.
  const genRef = useRef(0);
  const ctrlRef = useRef<AbortController | null>(null);
  // Miroir synchrone de `enChargement` : lisible dans le callback (mémoïsé `[]`) sans le
  // rendre dépendant de l'état (sinon l'effet [open, charger] rechargerait en boucle).
  const enCoursRef = useRef(false);

  const charger = useCallback(() => {
    // Un chargement est déjà en cours → on ignore ce déclenchement (clic répété).
    if (enCoursRef.current) return;
    enCoursRef.current = true;
    setEnChargement(true);
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    const gen = ++genRef.current;
    const vivant = (): boolean => genRef.current === gen && !ctrl.signal.aborted;

    const now = Date.now();
    setChargeA(now);
    setWatchlist(EN_ATTENTE);
    setDerivs(EN_ATTENTE);
    setEtf(EN_ATTENTE);
    setEco(EN_ATTENTE);
    setNews(EN_ATTENTE);
    setFearGreed(EN_ATTENTE);
    setDvol(EN_ATTENTE);

    /** Branche une promesse de section sur son setter, sous garde d'annulation. */
    const lancer = <T,>(p: Promise<T>, set: (s: Section<T>) => void): Promise<void> => {
      return p
        .then((data) => {
          if (vivant()) set({ statut: "ready", data });
        })
        .catch((err) => {
          if (!vivant()) return;
          console.error("[AXIOM] section brief indisponible", err);
          set({ statut: "error", data: null });
        });
    };

    const symboles = watchlistStore.getState().symbols;
    const taches = [
      lancer(fetchWatchlistOvernight(symboles, ctrl.signal), setWatchlist),
      lancer(fetchDerivsBrief(), setDerivs),
      lancer(fetchEtfBrief(ctrl.signal), setEtf),
      lancer(fetchEcoBrief(now, ctrl.signal), setEco),
      lancer(fetchNewsBrief(ctrl.signal), setNews),
      lancer(
        fetchFearGreed(ctrl.signal).then((v) => {
          if (v === null) throw new Error("Fear & Greed indisponible");
          return v;
        }),
        setFearGreed,
      ),
      lancer(fetchDvolBrief(), setDvol),
    ];
    // Toutes les sections réglées → on rouvre « Rafraîchir » (sauf génération périmée).
    void Promise.allSettled(taches).then(() => {
      if (!vivant()) return;
      enCoursRef.current = false;
      setEnChargement(false);
    });
  }, []);

  // Charge au montage/ouverture ; annule les fetchs en vol à la fermeture/démontage.
  useEffect(() => {
    if (!open) return;
    charger();
    return () => {
      ctrlRef.current?.abort();
      genRef.current += 1;
      // Fermeture/démontage : on lève la garde pour qu'une réouverture puisse recharger.
      enCoursRef.current = false;
      setEnChargement(false);
    };
  }, [open, charger]);

  // Confirmation transitoire de l'export « → Notes ».
  useEffect(() => {
    if (!exporte) return;
    const t = window.setTimeout(() => setExporte(false), 2000);
    return () => window.clearTimeout(t);
  }, [exporte]);

  const instant = chargeA ?? Date.now();
  const noteFraicheur = chargeA === null ? "maj…" : `maj ${formatHeureMinute(chargeA)}`;

  // Session : pure, locale — re-calculée quand positions/journal/éco/horloge snapshot changent.
  const session = useMemo(
    () =>
      assemblerSession(
        positions,
        journalAlertes,
        eco.statut === "error" ? null : eco.data,
        instant,
      ),
    [positions, journalAlertes, eco.statut, eco.data, instant],
  );

  const exporterVersNotes = (): void => {
    const now = chargeA ?? Date.now();
    const donnees: DonneesBrief = {
      session: assemblerSession(
        portfolioStore.getState().positions,
        alertsStore.getState().journal,
        eco.statut === "error" ? null : eco.data,
        now,
      ),
      watchlist: watchlist.data,
      derivs: derivs.data,
      etf: etf.data,
      eco: eco.data,
      news: news.data,
      fearGreed: fearGreed.data,
      dvol: dvol.data,
    };
    const { symbol, exchange } = marketStore.getState();
    notesStore.getState().ajouter({
      symbole: symbol,
      source: exchange,
      texte: briefEnMarkdown(donnees, now, phrasesLecture),
      tags: ["brief", "session"],
    });
    setExporte(true);
  };

  return (
    <>
      <EnTeteFenetre
        mnemo="BRIEF"
        titre="Point marché"
        sousTitre={`Ouverture + review de session · ${noteFraicheur}`}
        actions={
          <>
            <button
              type="button"
              onClick={charger}
              disabled={enChargement}
              className={`${BTN_SECONDAIRE} disabled:cursor-not-allowed disabled:opacity-40`}
            >
              Rafraîchir
            </button>
            <button type="button" onClick={exporterVersNotes} className={BTN_SECONDAIRE}>
              {exporte ? "✓ Notes" : "→ Notes"}
            </button>
          </>
        }
      />

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {/* Chapeau interprété (H16) : régime + nuit + funding + vol, puis lecture générée. */}
        <section className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Metric
              label="Régime"
              value={
                regime === null || regime.libelle === "indéterminé"
                  ? "—"
                  : `${regime.libelle} ${regime.score >= 0 ? "+" : ""}${formatDec(regime.score, 1)}`
              }
              couleur={
                regime === null
                  ? undefined
                  : tonRegime(regime.libelle) === "up"
                    ? "var(--up)"
                    : tonRegime(regime.libelle) === "down"
                      ? "var(--down)"
                      : undefined
              }
            />
            <Metric
              label="Nuit"
              value={chapeau?.nuitBtcPct !== null && chapeau !== null ? formatPct(chapeau.nuitBtcPct, 1) : "—"}
              couleur={
                chapeau?.nuitBtcPct != null
                  ? chapeau.nuitBtcPct >= 0
                    ? "var(--up)"
                    : "var(--down)"
                  : undefined
              }
              extra={
                chapeau?.nuitEthPct != null ? (
                  <span className="text-[10px] tabular-nums text-text-dim">ETH {formatPct(chapeau.nuitEthPct, 1)}</span>
                ) : undefined
              }
            />
            <Metric
              label="Funding BTC"
              value={formatFunding(chapeau?.fundingBtcRate)}
              labelExtra={<RefBadge referentiel={chapeau?.fundingRef ?? null} sens="hausse-chaud" />}
            />
            {/* Convention couleur Vol : DVOL en HAUSSE = stress → --down ; en baisse → --up. */}
            <Metric
              label="Vol (DVOL)"
              labelExtra={<RefBadge referentiel={chapeau?.dvolRef ?? null} sens="hausse-chaud" />}
              value={chapeau?.dvolCourant != null ? formatPourcentage(chapeau.dvolCourant, 1) : "—"}
              couleur={
                chapeau?.dvolDeltaPts != null
                  ? chapeau.dvolDeltaPts >= 0
                    ? "var(--down)"
                    : "var(--up)"
                  : undefined
              }
              extra={
                chapeau?.dvolDeltaPts != null ? (
                  <span className="text-[10px] tabular-nums text-text-dim">
                    {chapeau.dvolDeltaPts >= 0 ? "+" : ""}
                    {formatDec(chapeau.dvolDeltaPts, 1)} pts vs veille
                  </span>
                ) : undefined
              }
            />
          </div>
          {phrasesLecture.length > 0 && (
            <p className="text-[12px] leading-snug text-text">{phrasesLecture.join(" ")}</p>
          )}
        </section>

        {/* 0) Review de session (soir) — stores locaux portfolio + alertes + éco passés. */}
        <section className="space-y-2">
          <TitreBloc>Session · review</TitreBloc>
          <div className="grid grid-cols-3 gap-2">
            <Metric
              label="PnL réalisé"
              value={formatUsdSigne(session.pnlRealise)}
              couleur={couleurVariation(session.pnlRealise)}
            />
            <Metric label="Trades clos" value={String(session.tradesClos.length)} />
            <Metric label="W / L" value={`${session.gagnants} / ${session.perdants}`} />
          </div>

          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wide text-text-dim">Trades clos</p>
            {session.tradesClos.length === 0 ? (
              <Vide>Aucun trade clôturé aujourd&apos;hui.</Vide>
            ) : (
              <table className="w-full text-[11px] tabular-nums">
                <tbody>
                  {session.tradesClos.map((t, i) => (
                    <tr
                      key={`${t.symbole}-${t.dateSortie}-${i}`}
                      className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-bg"
                      onClick={() =>
                        navigateTo({ symbol: t.symbole, exchange: "binance", source: "brief" })
                      }
                      title={`Ouvrir ${t.symbole} dans le chart`}
                    >
                      <td className="py-1 text-text-dim">{formatHeureMinute(t.dateSortie)}</td>
                      <td className="py-1 text-text">{t.symbole}</td>
                      <td className="py-1 text-text-dim">{t.direction}</td>
                      <td
                        className="py-1 text-right"
                        style={{ color: couleurVariation(t.pnlNet) }}
                      >
                        {formatUsdSigne(t.pnlNet)}
                      </td>
                      <td
                        className="py-1 text-right"
                        style={{ color: couleurVariation(t.pnlPct) }}
                      >
                        {formatPct(t.pnlPct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wide text-text-dim">
              Alertes déclenchées
              {session.alertes.length > 0 ? ` · ${session.alertes.length}` : ""}
            </p>
            {session.alertes.length === 0 ? (
              <Vide>Aucune alerte déclenchée aujourd&apos;hui.</Vide>
            ) : (
              <div className="space-y-1">
                {session.alertes.map((a, i) => (
                  <div
                    key={`${a.alertId}-${a.ts}-${i}`}
                    className="flex items-baseline gap-2 text-[11px]"
                  >
                    <span className="w-12 shrink-0 tabular-nums text-text-dim">
                      {formatHeureMinute(a.ts)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-text">{a.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wide text-text-dim">Éco passés</p>
            {eco.statut === "idle" || eco.statut === "loading" ? (
              <Chargement />
            ) : session.ecoPasses === null ? (
              <ErreurBloc>Calendrier éco indisponible.</ErreurBloc>
            ) : session.ecoPasses.length === 0 ? (
              <Vide>Aucun événement à fort impact écoulé aujourd&apos;hui.</Vide>
            ) : (
              <div className="space-y-1">
                {session.ecoPasses.map((ev, i) => (
                  <button
                    key={`pass-${ev.time}-${i}`}
                    type="button"
                    onClick={() =>
                      navigateTo({
                        markTime: ev.time,
                        markLabel: `${ev.pays} ${ev.titre}`,
                        source: "brief",
                      })
                    }
                    title="Marquer sur le chart"
                    className="flex w-full items-baseline gap-2 text-left text-[11px] transition hover:bg-bg"
                  >
                    <span className="w-14 shrink-0 tabular-nums text-text-dim">
                      {ev.timeApprox ? "~" : ""}
                      {formatHeureMinute(ev.time)}
                    </span>
                    <span className="w-10 shrink-0 text-text-dim">{ev.pays}</span>
                    <span className="min-w-0 flex-1 truncate text-text">{ev.titre}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <NoteSource>
            Portefeuille local · journal alertes · calendrier éco (passés) · {noteFraicheur}.
          </NoteSource>
        </section>

        {/* 1) Watchlist overnight (Binance REST). */}
        <section className="space-y-2">
          <TitreBloc>Watchlist · overnight</TitreBloc>
          {corps(watchlist, "Prix overnight indisponibles.", (rows) =>
            rows.length === 0 ? (
              <Vide>Aucun symbole dans la watchlist.</Vide>
            ) : (
              <table className="w-full text-[11px] tabular-nums">
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.symbole}
                      className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-bg"
                      onClick={() =>
                        navigateTo({ symbol: r.symbole, exchange: "binance", source: "brief" })
                      }
                      title={`Ouvrir ${r.symbole} dans le chart`}
                    >
                      <td className="py-1 text-text">{r.symbole}</td>
                      <td className="py-1 text-right text-text">{formatPrice(r.prix)}</td>
                      <td className="py-1 text-right" style={{ color: couleurVariation(r.variation24h) }}>
                        {formatPct(r.variation24h)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ),
          )}
          <NoteSource>Données Binance (ticker 24 h) · {noteFraicheur}.</NoteSource>
        </section>

        {/* 2) Dérivés — funding + prochain règlement + ΔOI 24 h (BTC/ETH/SOL). */}
        <section className="space-y-2">
          <TitreBloc>Dérivés</TitreBloc>
          {corps(derivs, "Dérivés indisponibles.", (lignes) => (
            <div className="space-y-2">
              {lignes.map((d) => (
                <button
                  key={d.symbole}
                  type="button"
                  onClick={() =>
                    navigateTo({
                      symbol: `${d.symbole}USDT`,
                      exchange: "binance",
                      source: "brief",
                    })
                  }
                  title={`Ouvrir ${d.symbole}USDT dans le chart`}
                  className="w-full rounded-md border border-border bg-bg px-3 py-2 text-left transition hover:border-text-dim"
                >
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-medium text-text">{d.symbole}</span>
                    <span className="text-[11px] tabular-nums" style={{ color: couleurVariation(d.deltaOiPct) }}>
                      ΔOI 24 h {d.deltaOiPct === null ? VALEUR_ABSENTE : formatPct(d.deltaOiPct)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-text-dim">
                    <span>
                      funding <span className="tabular-nums text-text">{formatFunding(d.fundingActuel)}</span>
                    </span>
                    <span>
                      prédit <span className="tabular-nums text-text">{formatFunding(d.fundingPredit)}</span>
                    </span>
                    <span>
                      prochain règlement{" "}
                      <span className="text-text">
                        {d.prochainReglement === null ? VALEUR_ABSENTE : formatDelai(d.prochainReglement, instant)}
                      </span>
                    </span>
                  </div>
                </button>
              ))}
            </div>
          ))}
          <NoteSource>Funding Coinalyze · Open Interest Binance fapi · {noteFraicheur}.</NoteSource>
        </section>

        {/* 3) Flux ETF de la veille (SoSoValue). */}
        <section className="space-y-2">
          <TitreBloc>Flux ETF · veille</TitreBloc>
          {corps(etf, "Flux ETF indisponibles.", (actifs) => (
            <div className="space-y-1">
              {actifs.map((e) => (
                <div key={e.actif} className="flex items-baseline justify-between text-[11px]">
                  <span className="uppercase text-text-dim">{e.actif}</span>
                  {e.disponible && e.total !== null ? (
                    <span className="tabular-nums" style={{ color: couleurVariation(e.total) }}>
                      {formatUsd(e.total)}
                      {e.jour !== null && <span className="ml-1 text-[10px] text-text-dim">({e.jour})</span>}
                    </span>
                  ) : (
                    <span className="text-text-dim">indisponible</span>
                  )}
                </div>
              ))}
            </div>
          ))}
          <NoteSource>Données SoSoValue (flux nets quotidiens) · {noteFraicheur}.</NoteSource>
        </section>

        {/* 4) Événements éco du jour, fort impact. */}
        <section className="space-y-2">
          <TitreBloc>Événements éco du jour</TitreBloc>
          {corps(eco, "Calendrier éco indisponible.", (evs) =>
            evs.length === 0 ? (
              <Vide>Aucun événement à fort impact aujourd'hui.</Vide>
            ) : (
              <div className="space-y-1">
                {evs.map((ev, i) => (
                  <button
                    key={`${ev.time}-${i}`}
                    type="button"
                    onClick={() =>
                      navigateTo({
                        markTime: ev.time,
                        markLabel: `${ev.pays} ${ev.titre}`,
                        source: "brief",
                      })
                    }
                    title="Marquer sur le chart"
                    className="flex w-full items-baseline gap-2 text-left text-[11px] transition hover:bg-bg"
                  >
                    <span className="w-14 shrink-0 tabular-nums text-text-dim">
                      {ev.timeApprox ? "~" : ""}
                      {formatHeureMinute(ev.time)}
                    </span>
                    <span className="w-10 shrink-0 text-text-dim">{ev.pays}</span>
                    <span className="min-w-0 flex-1 truncate text-text">{ev.titre}</span>
                    <span className="shrink-0 text-[10px] text-text-dim">
                      {ev.time <= instant ? "passé" : formatDelai(ev.time, instant)}
                    </span>
                  </button>
                ))}
              </div>
            ),
          )}
          <NoteSource>ForexFactory · FRED · FOMC (fort impact seulement) · {noteFraicheur}.</NoteSource>
        </section>

        {/* 5) Actualités + indice Fear & Greed. */}
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <TitreBloc>Actualités</TitreBloc>
            {fearGreed.statut === "ready" && fearGreed.data !== null && (
              <div className="flex items-center gap-1.5">
                <Badge ton="accent" title="Indice Fear & Greed (alternative.me)">
                  F&G {fearGreed.data.value}
                  {fearGreed.data.classification ? ` · ${fearGreed.data.classification}` : ""}
                </Badge>
                {/* Un F&G nu ne dit pas s'il est extrême : 72 en marché euphorique
                    n'est qu'un p40. Le référentiel situe la valeur dans ~90 j. */}
                <RefBadge referentiel={chapeau?.fearGreedRef ?? null} sens="hausse-chaud" />
              </div>
            )}
          </div>
          {corps(news, "Actualités indisponibles.", (titres) =>
            titres.length === 0 ? (
              <Vide>Aucune actualité.</Vide>
            ) : (
              <div className="space-y-1.5">
                {titres.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() =>
                      navigateTo({
                        markTime: n.time,
                        markLabel: n.titre,
                        source: "brief",
                      })
                    }
                    title="Marquer sur le chart"
                    className="flex w-full flex-col gap-0.5 text-left transition hover:bg-bg"
                  >
                    <div className="flex items-center gap-2 text-[10px] text-text-dim">
                      <span className="uppercase">{n.source}</span>
                      <span className="tabular-nums">{formatAge(n.time, instant)}</span>
                    </div>
                    <span className="text-[11px] leading-snug text-text">{n.titre}</span>
                  </button>
                ))}
              </div>
            ),
          )}
          <NoteSource>Flux RSS/Finnhub · Fear &amp; Greed alternative.me · {noteFraicheur}.</NoteSource>
        </section>

        {/* 6) Volatilité — DVOL BTC/ETH (Deribit). */}
        <section className="space-y-2">
          <TitreBloc>Volatilité · DVOL</TitreBloc>
          {corps(dvol, "DVOL indisponible.", (vals) => (
            <div className="grid grid-cols-2 gap-2">
              {vals.map((v) => (
                <Metric
                  key={v.devise}
                  label={`DVOL ${v.devise}`}
                  value={v.valeur === null ? VALEUR_ABSENTE : formatPourcentage(v.valeur, 1)}
                />
              ))}
            </div>
          ))}
          <NoteSource>Données Deribit (indice DVOL) · {noteFraicheur}.</NoteSource>
        </section>
      </div>
    </>
  );
}
