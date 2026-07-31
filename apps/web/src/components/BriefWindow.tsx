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
 *
 * Ce fichier est l'ORCHESTRATEUR : il tient l'état de chargement par section, la
 * garde d'annulation et l'export. Le rendu de chaque section vit dans `brief/*.tsx`
 * (présentation pure), les types/helpers partagés dans `brief/commun.tsx`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { lectures } from "../data/lecturesBrief";
import {
  assemblerSession,
  briefEnMarkdown,
  fetchDerivsBrief,
  fetchDvolBrief,
  fetchEcoBrief,
  fetchEtfBrief,
  fetchFearGreed,
  fetchFundingExtremes,
  fetchNewsBrief,
  fetchWatchlistOvernight,
  type DonneesBrief,
  type DvolBrief,
  type EtfBrief,
  type EvenementBrief,
  type FearGreed,
  type FundingExtreme,
  type LigneDeriv,
  type LigneWatchlist,
  type TitreNews,
} from "../data/brief";
import { fetchBreadth, type ResumBreadth } from "../data/breadth";
import { collecterSqueeze } from "../store/squeeze";
import type { PointRadar } from "../data/squeeze";
import { distVar } from "../data/distVar";
import { lireResumeLegacyCache, type LigneCotCategorie } from "../store/cot";
import { deltaSemaines } from "../data/cot";
import { formatHeureMinute } from "../lib/format";
import { BTN_SECONDAIRE, EnTeteFenetre } from "./ui";
import {
  EN_ATTENTE,
  type Section,
  type VarChart,
  type CotChart,
} from "./brief/commun";
import { SectionChapeau } from "./brief/SectionChapeau";
import { SectionBreadth } from "./brief/SectionBreadth";
import { SectionSession } from "./brief/SectionSession";
import { SectionWatchlist } from "./brief/SectionWatchlist";
import { SectionSqueeze } from "./brief/SectionSqueeze";
import { SectionFunding } from "./brief/SectionFunding";
import { SectionDerivs } from "./brief/SectionDerivs";
import { SectionVar } from "./brief/SectionVar";
import { SectionEtf } from "./brief/SectionEtf";
import { SectionCot } from "./brief/SectionCot";
import { SectionEco } from "./brief/SectionEco";
import { SectionNews } from "./brief/SectionNews";
import { SectionDvol } from "./brief/SectionDvol";

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
      regimeGamma: chapeau.regimeGamma,
      gexNetUsd: chapeau.gexNetUsd,
    });
  }, [chapeau]);

  // Horodatage du snapshot courant (fraîcheur affichée + référence des délais/âges).
  const [chargeA, setChargeA] = useState<number | null>(null);
  const [exporte, setExporte] = useState(false);
  // Chargement en cours : désactive « Rafraîchir » (le ref garde le clic synchrone contre
  // l'empilement de générations de fetchs — quota Coinalyze partagé avec DERIV).
  const [enChargement, setEnChargement] = useState(false);

  const [breadth, setBreadth] = useState<Section<ResumBreadth>>(EN_ATTENTE);
  const [squeeze, setSqueeze] = useState<Section<PointRadar[]>>(EN_ATTENTE);
  const [funding, setFunding] = useState<Section<FundingExtreme[]>>(EN_ATTENTE);
  const [watchlist, setWatchlist] = useState<Section<LigneWatchlist[]>>(EN_ATTENTE);
  const [derivs, setDerivs] = useState<Section<LigneDeriv[]>>(EN_ATTENTE);
  const [etf, setEtf] = useState<Section<EtfBrief[]>>(EN_ATTENTE);
  const [eco, setEco] = useState<Section<EvenementBrief[]>>(EN_ATTENTE);
  const [news, setNews] = useState<Section<TitreNews[]>>(EN_ATTENTE);
  const [fearGreed, setFearGreed] = useState<Section<FearGreed>>(EN_ATTENTE);
  const [dvol, setDvol] = useState<Section<DvolBrief[]>>(EN_ATTENTE);
  // Instantanés SYNCHRONES (pas de fetch) calculés en fin de `charger` : null → section absente.
  const [varChart, setVarChart] = useState<VarChart | null>(null);
  const [cot, setCot] = useState<CotChart | null>(null);

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
    setBreadth(EN_ATTENTE);
    setSqueeze(EN_ATTENTE);
    setFunding(EN_ATTENTE);
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
      lancer(
        fetchBreadth().then((b) => {
          if (b === null) throw new Error("Largeur de marché indisponible");
          return b;
        }),
        setBreadth,
      ),
      lancer(
        collecterSqueeze().then((c) => c.points),
        setSqueeze,
      ),
      lancer(fetchFundingExtremes(), setFunding),
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

    // ── Instantanés SYNCHRONES (aucun fetch) — calculés APRÈS le câblage des sections
    //    réseau pour qu'un throw imprévu ne les avorte pas (distVar est pur ; le lecteur de
    //    cache COT catche tout — assurance à coût nul). Lecture directe getState/cache.

    // VaR chart : distribution empirique des bougies DÉJÀ chargées du chart maître
    // (instantané via getState, JAMAIS abonné). < 300 bougies → distVar renvoie null → absente.
    const { symbol, timeframe, candles } = marketStore.getState();
    const niveaux = distVar(candles.map((c) => c.close));
    const h20 = niveaux?.find((n) => n.h === 20) ?? null;
    setVarChart(h20 !== null ? { h20, symbol, timeframe } : null);

    // COT (semaine) : cache legacy SEUL (aucun réseau). Les 3 instruments couverts au
    // |Δ hebdo| max. Cache absent ou aucun Δ calculable → section absente.
    const resumeCot = lireResumeLegacyCache();
    if (resumeCot === null) {
      setCot(null);
    } else {
      const avecDelta = resumeCot.lignes
        .filter((l) => !l.nonCouvert)
        .map((ligne) => ({ ligne, delta: deltaSemaines(ligne.serie, 1) }))
        .filter((x): x is { ligne: LigneCotCategorie; delta: number } => x.delta !== null)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, 3);
      setCot(avecDelta.length > 0 ? { lignes: avecDelta, dateRapport: resumeCot.dateRapport } : null);
    }
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

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {/* Chapeau interprété (H16) : régime + nuit + funding + vol, puis lecture générée. */}
        <SectionChapeau regime={regime} chapeau={chapeau} phrasesLecture={phrasesLecture} />

        {/* Régime — largeur de marché (breadth) : jauges MM50/MM200, A/D, tendance MM50. */}
        <SectionBreadth breadth={breadth} noteFraicheur={noteFraicheur} />

        {/* 0) Review de session (soir) — stores locaux portfolio + alertes + éco passés. */}
        <SectionSession session={session} eco={eco} noteFraicheur={noteFraicheur} />

        {/* 1) Watchlist overnight (Binance REST). */}
        <SectionWatchlist watchlist={watchlist} noteFraicheur={noteFraicheur} />

        {/* Squeeze — top 3 carburant-squeeze (funding < 0 & OI ↑) par intensité (cf. SQZ). */}
        <SectionSqueeze squeeze={squeeze} noteFraicheur={noteFraicheur} />

        {/* Funding extrêmes — top 3 |funding| > 0.03 %/8 h (premiumIndex, univers complet). */}
        <SectionFunding funding={funding} noteFraicheur={noteFraicheur} />

        {/* 2) Dérivés — funding + prochain règlement + ΔOI 24 h (BTC/ETH/SOL). */}
        <SectionDerivs derivs={derivs} instant={instant} noteFraicheur={noteFraicheur} />

        {/* VaR chart — VaR95/99 20 b du chart maître (distribution empirique, instantané).
            Absente sous 300 bougies (échantillon insuffisant, cf. distVar). */}
        {varChart !== null && <SectionVar varChart={varChart} noteFraicheur={noteFraicheur} />}

        {/* 3) Flux ETF de la veille (SoSoValue). */}
        <SectionEtf etf={etf} noteFraicheur={noteFraicheur} />

        {/* COT (semaine) — cache legacy SEUL : 3 instruments au |Δ hebdo net| max.
            Absente si le cache COT est vide (aucun réseau déclenché ici). */}
        {cot !== null && <SectionCot cot={cot} />}

        {/* 4) Événements éco du jour, fort impact. */}
        <SectionEco eco={eco} instant={instant} noteFraicheur={noteFraicheur} />

        {/* 5) Actualités + indice Fear & Greed. */}
        <SectionNews
          news={news}
          fearGreed={fearGreed}
          chapeau={chapeau}
          instant={instant}
          noteFraicheur={noteFraicheur}
        />

        {/* 6) Volatilité — DVOL BTC/ETH (Deribit). */}
        <SectionDvol dvol={dvol} noteFraicheur={noteFraicheur} />
      </div>
    </>
  );
}
