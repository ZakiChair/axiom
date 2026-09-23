/**
 * Runtime des alertes — pont entre le moteur PUR (`@axiom/alerts`) et les flux live.
 *
 * Sources d'évaluation, sans chevauchement de types de condition (donc aucun
 * double déclenchement) :
 *  - FLUX TICKER (`subscribeTickers`) sur les symboles des alertes prix : évalue les
 *    conditions `prix-croise` à chaque mise à jour de prix (tous symboles). Le prix
 *    précédent est mémorisé par symbole (nécessaire au sens `les-deux`).
 *  - CLÔTURE DE BOUGIE (abonnement `marketStore`) sur le symbole affiché : évalue les
 *    conditions `variation-pct` et `indicateur-*` à chaque nouvelle bougie CLÔTURÉE
 *    (ces conditions requièrent les bougies, présentes uniquement pour le symbole affiché).
 *    Une def n'est évaluée que si son `timeframe` est celui du chart ; `timeframe`
 *    absent (def HÉRITÉE) = évaluée sur le TF affiché, quel qu'il soit.
 *  - POLL FUNDING (~60 s) pour les symboles ayant une alerte `funding-extreme` :
 *    injecte `fundingRate` (+ `fundingZScore` si historique dispo) dans le contexte.
 *  - STORE CVD S/P (`cvdDivergenceStore`) : le contrôleur orderflow publie le kind
 *    de divergence ; on évalue `cvd-spot-perp-div` (app ouverte uniquement — pas de
 *    pipeline orderflow côté daemon).
 *  - STORE RÉGIME (`regimeStore`) : le score composite −2..+2 (maj ~15 min) est injecté
 *    dans le contexte ; on évalue `regime-seuil` (GLOBAL, def sur BTCUSDT/binance). Sous
 *    le seuil de composants disponibles (libellé « indéterminé ») le score est du bruit :
 *    on n'injecte rien (non évaluable → armement figé). Front-only (le daemon ne calcule
 *    pas le score en v1).
 *  - POLL LIQ-CASCADE (~5 s) : injecte `liqUsdParMin` (notionnel liquidé sur la dernière
 *    minute glissante, pure `usdParMinute` sur le buffer `liqEventsStore`). Côté FRONT :
 *    évaluée uniquement pour le SYMBOLE COURANT du chart et seulement quand le flux liq
 *    est retenu (heatmap ON ou fenêtre LIQ ouverte — cf. fluxLiqRetenu) ; flux non retenu
 *    ou autre symbole → non évaluable ici (armement figé, pas de faux 0) — le daemon
 *    couvre TOUS les symboles d'alerte onglet fermé (cf. ci-dessous).
 *
 *  - ALERTES DE PRESET (`presetAlertsStore`) : un timer par alerte active (période 15 ou
 *    60 min) relance `executerScreener` (snapshot des filtres) ; les symboles ENTRANT dans
 *    l'ensemble scanné (diff, hors cooldown 6 h) sont journalisés + notifiés. AUCUNE garde
 *    de visibilité : c'est la seule source SANS relais daemon, la couper onglet caché
 *    laisserait l'opérateur non couvert (une période de 15–60 min survit à la limitation
 *    des timers d'arrière-plan). Chaque tick publie son issue (`dernierScanTs`,
 *    `derniereErreur`, champs de session du store) — le panneau les affiche.
 *
 * ONGLET FERMÉ : le daemon évalue aussi `funding-extreme` (poll premiumIndex ~60 s,
 * lot D3) ET `liq-cascade` (tick 10 s sur sa table `liquidations` ingérée Bybit+OKX,
 * tous les symboles d'alerte — ingestion d'un nouveau symbole ≤60 s). Restent FRONT-ONLY
 * (dormants côté daemon) : CVD spot/perp-div (pas de pipeline orderflow), `regime-seuil`
 * (score non calculé en v1), `flux-capitaux-seuil` (loader commun local) et les alertes de preset.
 *
 * Un déclenchement → journal du store + notification système (Notification API) + bip
 * discret (WebAudio, aucun fichier binaire). AUCUNE donnée haute fréquence ne transite
 * par React : le store n'est écrit que sur transition d'état (cf. BUILD-CONTRACT).
 *
 * Aucune modification de Chart.tsx : on lit `marketStore` en aval, sans le piloter.
 */
import { alerteActiveAuTemps, evaluerAlertes, prochaineEcheanceAlerte, typesDeDef, type AlertDef, type ContexteAlerte, type Declenchement, type MetriqueOnchainAlerte } from "@axiom/alerts";
import type { Unsubscribe } from "@axiom/types";
import { marketStore } from "../store/market";
import { fluxLiqRetenu, liqEventsStore } from "../chart/liquidationMarkers";
import { usdParMinute } from "../components/liquidationsWindow.util";
import { alertsStore, pousserDefsDaemon } from "../store/alerts";
import { cvdDivergenceStore } from "../store/cvd-divergence";
import { regimeStore } from "../store/regime";
import { orderflowStore } from "../store/orderflow";
import { presetAlertsStore, diffEntrants, filtrerCooldown } from "../store/presetAlerts";
import { isTickerSource, subscribeTickers, type TickerUpdate } from "../data/ticker";
import type { WatchlistSource } from "../store/watchlist";
import { daemonSupporte, detectDaemon, urlDaemon } from "../data/daemon";
import { coinalyzeProvider, filtrerFrontieres8h } from "../data/coinalyze";
import { histFunding } from "../data/referentiels";
import { executerScreener } from "../data/screenerRun";
import { SCREENER_POSITION_CAP } from "../data/screener";
import { extUrl } from "../data/extapi";
import { AGE_MAX_FLUX_MS } from "../data/onchain/fluxCapitaux.contract";
import { fluxCapitauxStore, garderFluxCapitauxPourAlertes } from "../store/fluxCapitaux";
import { enrichirDeclenchement } from "../data/decisionDossier";
import { capturerLectures } from "../store/analyseMultidomaine";

/** Types de condition évalués sur la clôture de bougie (nécessitent les bougies). */
const TYPES_BOUGIE = new Set(["variation-pct", "indicateur-seuil", "indicateur-croisement"]);
/** Throttle d'évaluation des composites (ms) — `computeIndicator` n'a pas à courir à chaque tick. */
const COMPOSITE_THROTTLE_MS = 1_000;

function defPorte(def: AlertDef, type: string): boolean {
  return typesDeDef(def).has(type);
}

/** Période de poll funding (ms) — lent, hors chemin chaud. */
const FUNDING_POLL_MS = 60_000;
/** Période d'évaluation des alertes on-chain (ms) — métriques quotidiennes, caches CHAIN. */
const ONCHAIN_POLL_MS = 15 * 60_000;
/** Période d'évaluation de `liq-cascade` (ms) — le poll fait aussi RETOMBER la fenêtre
 *  glissante sous le seuil (ré-armement) quand le flux se calme. */
const LIQ_CASCADE_POLL_MS = 5_000;
/** Fenêtre min. d'historique funding pour un z-score (points). Horizon variable selon la
 *  source : ~10 j (perp 8h) ou ~5 j (perp 4h) en primaire (`histFunding`, cadence réelle
 *  du perp) vs toujours ~10 j en repli Coinalyze (filtré aux frontières 8h UTC). */
const FUNDING_Z_WINDOW = 30;

/** Cooldown par (alerte, symbole) d'une alerte de preset (ms) : anti-spam sur un aller-retour. */
const PRESET_COOLDOWN_MS = 6 * 3_600_000;
/** Cap indicateurs réduit pour un scan d'alerte (échantillon plus léger que le run UI). */
const PRESET_CAP_INDICATEURS = 30;

/** Applique une passe d'évaluation : persiste les defs modifiées, journalise + notifie. */
function appliquerResultat(lot: AlertDef[], ctx: ContexteAlerte): void {
  if (lot.length === 0) return;
  const res = evaluerAlertes(lot, ctx);
  if (!res.modifie) return;
  // Les abonnés de l'écriture suivante sont synchrones et peuvent modifier le registre.
  const captures = res.declenchements.map((d) => capturerLectures(d.ts));
  const store = alertsStore.getState();
  store.appliquerMisesAJour(res.defs); // fusion par id (n'écrase pas les defs hors lot)
  for (const [index, d] of res.declenchements.entries()) {
    // Une autre subscription synchrone peut supprimer ou désactiver la définition
    // pendant l'application des états. Ne pas notifier un ancien snapshot de defs.
    const def = lot.find((candidate) => candidate.id === d.alertId);
    if (!def) continue;
    const encoreNotifiable = (): boolean => alertsStore.getState().defs.some((courante) =>
      courante.id === d.alertId && courante.expireTs === def.expireTs && alerteActiveAuTemps(courante, Date.now()));
    if (!encoreNotifiable()) continue;
    store.ajouterJournal(enrichirDeclenchement(d, def, ctx, captures[index]));
    // Le journal déclenche des abonnés synchrones ; l'échéance ou la génération
    // peut changer entre l'archivage du signal et l'envoi externe.
    if (!encoreNotifiable()) continue;
    notifier(d);
  }
}

/** Crée le runtime et démarre les abonnements. Renvoie une fonction d'arrêt. */
function creerRuntime(): Unsubscribe {
  const cleMarche = (source: AlertDef["source"], symbol: string): string => `${source}|${symbol}`;

  /** Dernier prix vu par marché (pour le `prixPrecedent` du sens `les-deux`). */
  const dernierPrix = new Map<string, number>();

  /** Contexte fusionné par marché (hors React) — les flux y écrivent leur contribution. */
  type ContextePartiel = Partial<ContexteAlerte> & { timeframeBougies?: string };
  const contextes = new Map<string, ContextePartiel>();
  const dernierEvalComposite = new Map<string, number>();

  const fusionner = (
    source: AlertDef["source"],
    symbol: string,
    patch: ContextePartiel,
  ): void => {
    const cle = cleMarche(source, symbol);
    const prev = contextes.get(cle) ?? {};
    if (patch.timeframeBougies !== undefined && patch.timeframeBougies !== prev.timeframeBougies) {
      dernierEvalComposite.delete(cle);
    }
    const { dernierPrix: prixPatch, ...reste } = patch;
    const next: ContextePartiel = { ...prev, ...reste };
    // 0 n'est pas une mesure : on n'écrase un prix ticker que par une valeur réelle.
    if (prixPatch !== undefined && Number.isFinite(prixPatch)) next.dernierPrix = prixPatch;
    contextes.set(cle, next);
  };

  const evaluerComposites = (source: AlertDef["source"], symbol: string): void => {
    const cle = cleMarche(source, symbol);
    const now = Date.now();
    const last = dernierEvalComposite.get(cle) ?? 0;
    if (now - last < COMPOSITE_THROTTLE_MS) return;
    const partiel = contextes.get(cle);
    if (!partiel || partiel.dernierPrix === undefined || !Number.isFinite(partiel.dernierPrix)) return;
    const lot = alertsStore
      .getState()
      .defs.filter((d) => {
        if (!alerteActiveAuTemps(d, Date.now()) || d.source !== source || d.symbol !== symbol || d.condition.type !== "composite") {
          return false;
        }
        const porteBougie = [...TYPES_BOUGIE].some((type) => defPorte(d, type));
        return !porteBougie || d.timeframe === undefined || d.timeframe === partiel.timeframeBougies;
      });
    if (lot.length === 0) return;
    dernierEvalComposite.set(cle, now);
    const regime = regimeStore.getState().regime;
    const regimeScore =
      regime !== null && regime.libelle !== "indéterminé" ? regime.score : undefined;
    appliquerResultat(lot, {
      maintenant: now,
      dernierPrix: partiel.dernierPrix,
      prixPrecedent: partiel.prixPrecedent,
      candles: partiel.candles,
      fundingRate: partiel.fundingRate,
      fundingZScore: partiel.fundingZScore,
      cvdDivergenceKind: partiel.cvdDivergenceKind,
      liqUsdParMin: partiel.liqUsdParMin,
      regimeScore,
    });
  };

  // ── Flux ticker : conditions prix-croise ──────────────────────────────────
  const onTicker = (source: AlertDef["source"], { symbol, price }: TickerUpdate): void => {
    if (!Number.isFinite(price)) return;
    const cle = cleMarche(source, symbol);
    const precedent = dernierPrix.get(cle);
    fusionner(source, symbol, { dernierPrix: price, prixPrecedent: precedent });
    const lot = alertsStore
      .getState()
      .defs.filter(
        (d) =>
          alerteActiveAuTemps(d, Date.now()) &&
          d.source === source &&
          d.symbol === symbol &&
          d.condition.type === "prix-croise",
      );
    if (lot.length > 0) {
      appliquerResultat(lot, {
        maintenant: Date.now(),
        dernierPrix: price,
        prixPrecedent: precedent,
      });
    }
    dernierPrix.set(cle, price);
    evaluerComposites(source, symbol);
  };

  // (Re)souscription du flux ticker quand les marchés à alertes prix changent. Les
  // sources sans route ticker restent évaluées sur les clôtures du chart maître.
  let unsubTicker: Unsubscribe = () => {};
  let cleTicker = "";
  let generationTicker = 0;
  const resyncTicker = (): void => {
    const groupes = new Map<WatchlistSource, Set<string>>();
    for (const d of alertsStore.getState().defs) {
      if (!alerteActiveAuTemps(d, Date.now()) || !defPorte(d, "prix-croise") || !isTickerSource(d.source)) continue;
      const symbols = groupes.get(d.source) ?? new Set<string>();
      symbols.add(d.symbol);
      groupes.set(d.source, symbols);
    }
    const groupesTries = [...groupes.entries()]
      .map(([source, symbols]) => [source, [...symbols].sort()] as const)
      .sort(([sourceA], [sourceB]) => sourceA.localeCompare(sourceB));
    const cle = groupesTries.map(([source, symbols]) => `${source}:${symbols.join(",")}`).join(";");
    if (cle === cleTicker) return; // ensemble inchangé → on garde la souscription en place
    cleTicker = cle;
    unsubTicker();
    generationTicker += 1;
    const generation = generationTicker;
    const unsubs = groupesTries.map(([source, symbols]) =>
      subscribeTickers(
        symbols,
        (update) => {
          if (generation !== generationTicker) return;
          onTicker(source, update);
        },
        { source },
      ),
    );
    unsubTicker = () => {
      generationTicker += 1;
      for (const unsub of unsubs) unsub();
    };
  };

  // ── Clôture de bougie : conditions variation-pct + indicateur-* ────────────
  let derniereSource = "";
  let dernierSymbole = "";
  let dernierTf = "";
  let dernierTempsCloture = 0;
  const onMarket = (): void => {
    const { exchange, symbol, timeframe, candles } = marketStore.getState();
    // Changement de source, symbole OU TF (backfill) : on réinitialise le suivi de clôture.
    // Le TF compte depuis que les defs y sont filtrées : les clôtures d'un TF plus long
    // sont ANTÉRIEURES à la dernière vue sur un TF court, et resteraient ignorées.
    if (exchange !== derniereSource || symbol !== dernierSymbole || timeframe !== dernierTf) {
      derniereSource = exchange;
      dernierSymbole = symbol;
      dernierTf = timeframe;
      dernierTempsCloture = 0;
    }
    if (candles.length < 2) return;
    const last = candles[candles.length - 1];
    if (!last) return;
    // Bougie de référence = dernière CLÔTURÉE (la live est écartée).
    const idxClose = last.closed === true ? candles.length - 1 : candles.length - 2;
    const barreClose = candles[idxClose];
    if (!barreClose || barreClose.time <= dernierTempsCloture) return; // déjà évaluée
    dernierTempsCloture = barreClose.time;

    // Une def PORTE son TF d'évaluation ; `undefined` = def héritée (évaluée sur le TF
    // affiché, comportement d'origine).
    const lot = alertsStore
      .getState()
      .defs.filter(
        (d) =>
          alerteActiveAuTemps(d, Date.now()) &&
          d.source === exchange &&
          d.symbol === symbol &&
          (TYPES_BOUGIE.has(d.condition.type) ||
            (!isTickerSource(exchange) && d.condition.type === "prix-croise")) &&
          (d.timeframe === undefined || d.timeframe === timeframe)
      );
    const avant = candles[idxClose - 1];
    const candlesCloturees = candles.slice(0, idxClose + 1);
    fusionner(exchange, symbol, {
      dernierPrix: barreClose.close,
      prixPrecedent: avant?.close,
      candles: candlesCloturees,
      timeframeBougies: timeframe,
    });
    if (lot.length > 0) {
      appliquerResultat(lot, {
        maintenant: Date.now(),
        dernierPrix: barreClose.close,
        prixPrecedent: avant?.close,
        candles: candlesCloturees,
      });
    }
    evaluerComposites(exchange, symbol);
  };

  // ── Poll funding : conditions funding-extreme ─────────────────────────────
  // Cache par symbole : rate courant + z-score optionnel (historique Coinalyze).
  const cacheFunding = new Map<string, { rate: number; z?: number; ts: number }>();

  const evaluerFundingSymbol = (source: AlertDef["source"], symbol: string): void => {
    const snap = cacheFunding.get(cleMarche(source, symbol));
    if (!snap) return;
    const lot = alertsStore
      .getState()
      .defs.filter(
        (d) =>
          alerteActiveAuTemps(d, Date.now()) &&
          d.source === source &&
          d.symbol === symbol &&
          d.condition.type === "funding-extreme",
      );
    const mkt = marketStore.getState();
    const lastCandle =
      mkt.exchange === source && mkt.symbol === symbol
        ? mkt.candles[mkt.candles.length - 1]
        : undefined;
    const prixReel = lastCandle !== undefined && Number.isFinite(lastCandle.close) ? lastCandle.close : undefined;
    fusionner(source, symbol, {
      ...(prixReel !== undefined ? { dernierPrix: prixReel } : {}),
      fundingRate: snap.rate,
      fundingZScore: snap.z,
    });
    if (lot.length > 0) {
      appliquerResultat(lot, {
        maintenant: Date.now(),
        dernierPrix: prixReel ?? 0,
        fundingRate: snap.rate,
        fundingZScore: snap.z,
      });
    }
    evaluerComposites(source, symbol);
  };

  const pollFunding = async (): Promise<void> => {
    const sourcesParSymbole = new Map<string, Set<AlertDef["source"]>>();
    const signatureFunding = (source: AlertDef["source"], symbol: string): string =>
      alertsStore.getState().defs
        .filter((d) => alerteActiveAuTemps(d, Date.now()) && d.source === source && d.symbol === symbol && defPorte(d, "funding-extreme"))
        .map((d) => `${d.id}:${d.expireTs ?? "permanent"}`)
        .sort().join("|");
    const depart = new Map<string, string>();
    for (const d of alertsStore.getState().defs) {
      if (!alerteActiveAuTemps(d, Date.now()) || !defPorte(d, "funding-extreme")) continue;
      const sources = sourcesParSymbole.get(d.symbol) ?? new Set<AlertDef["source"]>();
      sources.add(d.source);
      sourcesParSymbole.set(d.symbol, sources);
      depart.set(cleMarche(d.source, d.symbol), signatureFunding(d.source, d.symbol));
    }
    for (const [symbol, sources] of sourcesParSymbole) {
      const encoreDemande = (): boolean => !arrete && [...sources].some((source) => {
        const cle = cleMarche(source, symbol);
        const signature = depart.get(cle);
        return signature !== undefined && signature !== "" && signature === signatureFunding(source, symbol);
      });
      if (!encoreDemande()) continue;
      const snap = await chargerFunding(symbol, encoreDemande);
      if (!snap) continue;
      for (const source of sources) {
        const cle = cleMarche(source, symbol);
        if (arrete || !depart.get(cle) || depart.get(cle) !== signatureFunding(source, symbol)) continue;
        cacheFunding.set(cle, { ...snap, ts: Date.now() });
        evaluerFundingSymbol(source, symbol);
      }
    }
  };

  let fundingTimer: ReturnType<typeof setInterval> | undefined;
  const resyncFunding = (): void => {
    const aDesFunding = alertsStore
      .getState()
      .defs.some((d) => alerteActiveAuTemps(d, Date.now()) && defPorte(d, "funding-extreme"));
    if (aDesFunding && fundingTimer === undefined) {
      void pollFunding();
      fundingTimer = setInterval(() => {
        void pollFunding();
      }, FUNDING_POLL_MS);
    } else if (!aDesFunding && fundingTimer !== undefined) {
      clearInterval(fundingTimer);
      fundingTimer = undefined;
    }
  };

  // ── Poll liq-cascade : buffer liq du chart → moteur ───────────────────────
  // Côté FRONT (cf. en-tête) : le buffer `liqEventsStore` ne couvre que le symbole
  // COURANT du chart et n'est alimenté que si le flux est retenu (heatmap ON ou fenêtre
  // LIQ ouverte). Flux non retenu → on n'évalue PAS (non évaluable : l'armement reste
  // figé, on n'injecte pas un 0 trompeur). Le daemon évalue AUSSI ce type onglet fermé
  // (tick 10 s, tous les symboles d'alerte) — l'anti-doublon heartbeat (>90 s) évite la
  // double notification quand l'app est ouverte.
  const evaluerLiqCascade = (): void => {
    if (!fluxLiqRetenu()) return; // flux inactif → non évaluable
    const { exchange, symbol } = marketStore.getState();
    const lot = alertsStore
      .getState()
      .defs.filter(
        (d) =>
          alerteActiveAuTemps(d, Date.now()) &&
          d.source === exchange &&
          d.symbol === symbol &&
          d.condition.type === "liq-cascade",
      );
    // Événements RÉELS uniquement : le seed Coinalyze (`approx`) est agrégé par bougie
    // et gonflerait artificiellement la minute glissante.
    const reels = liqEventsStore.getState().events.filter((ev) => ev.approx !== true);
    const nowMs = Date.now();
    const mkt = marketStore.getState();
    const lastCandle = mkt.candles[mkt.candles.length - 1];
    const liqUsdParMin = usdParMinute(reels, nowMs);
    const prixReel = lastCandle !== undefined && Number.isFinite(lastCandle.close) ? lastCandle.close : undefined;
    fusionner(exchange, symbol, {
      ...(prixReel !== undefined ? { dernierPrix: prixReel } : {}),
      liqUsdParMin,
    });
    if (lot.length > 0) {
      appliquerResultat(lot, {
        maintenant: nowMs,
        dernierPrix: prixReel ?? 0,
        liqUsdParMin,
      });
    }
    evaluerComposites(exchange, symbol);
  };

  let liqCascadeTimer: ReturnType<typeof setInterval> | undefined;
  const resyncLiqCascade = (): void => {
    const aDesCascade = alertsStore
      .getState()
      .defs.some((d) => alerteActiveAuTemps(d, Date.now()) && defPorte(d, "liq-cascade"));
    if (aDesCascade && liqCascadeTimer === undefined) {
      evaluerLiqCascade();
      liqCascadeTimer = setInterval(evaluerLiqCascade, LIQ_CASCADE_POLL_MS);
    } else if (!aDesCascade && liqCascadeTimer !== undefined) {
      clearInterval(liqCascadeTimer);
      liqCascadeTimer = undefined;
    }
  };

  // ── CVD spot/perp-div : pont orderflow → moteur ─────────────────────────
  const evaluerCvdSymbol = (source: AlertDef["source"], symbol: string): void => {
    const kind = cvdDivergenceStore.getState().bySymbol[symbol.toUpperCase()];
    // Clé absente → undefined : non évaluable (pipeline off).
    if (kind === undefined) return;
    const lot = alertsStore
      .getState()
      .defs.filter(
        (d) =>
          alerteActiveAuTemps(d, Date.now()) &&
          d.source === source &&
          d.symbol === symbol &&
          d.condition.type === "cvd-spot-perp-div",
      );
    const mkt = marketStore.getState();
    const lastCandle =
      mkt.exchange === source && mkt.symbol === symbol
        ? mkt.candles[mkt.candles.length - 1]
        : undefined;
    const prixReel = lastCandle !== undefined && Number.isFinite(lastCandle.close) ? lastCandle.close : undefined;
    fusionner(source, symbol, {
      ...(prixReel !== undefined ? { dernierPrix: prixReel } : {}),
      cvdDivergenceKind: kind,
    });
    if (lot.length > 0) {
      appliquerResultat(lot, {
        maintenant: Date.now(),
        dernierPrix: prixReel ?? 0,
        cvdDivergenceKind: kind,
      });
    }
    evaluerComposites(source, symbol);
  };

  // Demande éphémère distincte des deux toggles utilisateur persistés.
  const resyncCvd = (): void => {
    const demandee = alertsStore
      .getState()
      .defs.some((d) => alerteActiveAuTemps(d, Date.now()) && defPorte(d, "cvd-spot-perp-div"));
    const of = orderflowStore.getState();
    if (of.alerteCvdDemandee !== demandee) of.setAlerteCvdDemandee(demandee);
  };

  const unsubCvd = cvdDivergenceStore.subscribe((s, prev) => {
    const source = marketStore.getState().exchange;
    // Évalue seulement les symboles dont le kind a changé.
    for (const [sym, kind] of Object.entries(s.bySymbol)) {
      if (prev.bySymbol[sym] !== kind) evaluerCvdSymbol(source, sym);
    }
  });

  // ── Store régime : score composite −2..+2 → moteur ────────────────────────
  // Condition GLOBALE (lot filtré par TYPE seul). « indéterminé » (< 3 composants) :
  // score = bruit → non injecté (armement figé, pas de faux déclenchement).
  const evaluerRegime = (): void => {
    const regime = regimeStore.getState().regime;
    if (regime === null || regime.libelle === "indéterminé") return; // non évaluable
    const lot = alertsStore
      .getState()
      .defs.filter((d) => alerteActiveAuTemps(d, Date.now()) && d.condition.type === "regime-seuil");
    if (lot.length === 0) return;
    appliquerResultat(lot, {
      maintenant: Date.now(),
      dernierPrix: 0, // inutilisé par la condition (score global, sans symbole)
      regimeScore: regime.score,
    });
    for (const d of alertsStore.getState().defs) {
      if (alerteActiveAuTemps(d, Date.now()) && d.condition.type === "composite") evaluerComposites(d.source, d.symbol);
    }
  };

  const unsubRegime = regimeStore.subscribe(evaluerRegime);

  // ── Flux de capitaux lents : store commun CHAIN/BRIEF/STBL ────────────────
  // Le gestionnaire conserve son poll horaire même si tous les panneaux sont fermés,
  // tant qu'une définition active en dépend. Le moteur revalide âge et qualité.
  let evaluationFluxEnCours = false;
  let relancerEvaluationFlux = false;
  const evaluerFluxCapitaux = (): void => {
    if (evaluationFluxEnCours) {
      relancerEvaluationFlux = true;
      return;
    }
    evaluationFluxEnCours = true;
    try {
      do {
        relancerEvaluationFlux = false;
        const donnees = fluxCapitauxStore.getState().donnees;
        if (!donnees) break;
        const defsAvantPasse = alertsStore.getState().defs;
        for (const metrique of donnees.metriques) {
          if (metrique.valeur === null || !Number.isFinite(metrique.valeur) || !metrique.qualite ||
            metrique.observeLe === null || metrique.qualite.recupereLe === null ||
            metrique.qualite.cadenceMs === null) continue;
          // Relire à chaque métrique : une subscription synchrone peut supprimer,
          // désactiver ou ajouter une définition pendant l'application précédente.
          const lot = alertsStore.getState().defs.filter((d) => alerteActiveAuTemps(d, Date.now()) && d.condition.type === "flux-capitaux-seuil" && d.condition.metrique === metrique.id);
          if (lot.length === 0) continue;
          const condition = lot[0]!.condition;
          if (condition.type !== "flux-capitaux-seuil") continue;
          appliquerResultat(lot, {
            maintenant: Date.now(),
            dernierPrix: 0,
            fluxCapitaux: {
              metrique: condition.metrique,
              valeur: metrique.valeur,
              unite: metrique.unite,
              observeLe: metrique.observeLe,
              recupereLe: metrique.qualite.recupereLe,
              source: metrique.qualite.sourceEffective,
              cadenceMs: metrique.qualite.cadenceMs,
              ageMaxMs: AGE_MAX_FLUX_MS,
              statut: metrique.qualite.statut,
            },
          });
        }
        if (alertsStore.getState().defs !== defsAvantPasse) relancerEvaluationFlux = true;
      } while (relancerEvaluationFlux);
    } finally {
      evaluationFluxEnCours = false;
    }
  };
  const resyncFluxCapitaux = (): void => {
    const active = alertsStore.getState().defs.some((d) => alerteActiveAuTemps(d, Date.now()) && d.condition.type === "flux-capitaux-seuil");
    garderFluxCapitauxPourAlertes(active);
    if (active) evaluerFluxCapitaux();
  };
  const unsubFluxCapitaux = fluxCapitauxStore.subscribe((state, precedent) => {
    if (state.donnees !== precedent.donnees) evaluerFluxCapitaux();
  });

  // ── Alertes de PRESET : scan périodique + diff d'entrée dans l'ensemble ────
  // Chaque alerte active relance `executerScreener` (snapshot de ses filtres) à sa
  // période propre ; les symboles ENTRANTS (absents du scan précédent) hors cooldown
  // sont journalisés + notifiés. État par alerte (baseline + cooldown) en Maps de
  // closure, nettoyé au retrait/désactivation ; jamais deux ticks concurrents d'une
  // même alerte (garde `enCours`). Aucune écriture du screenerStore (run isolé).
  const timersPreset = new Map<string, ReturnType<typeof setInterval>>();
  /** Dernier ensemble de symboles scannés par alerte (absent = amorce → pas de déclenchement). */
  const dernierEnsemble = new Map<string, Set<string>>();
  /** Cooldown par alerte : symbole → ms epoch du dernier déclenchement. */
  const cooldownsPreset = new Map<string, Map<string, number>>();
  /** Génération par ID : une échéance puis prolongation ne valide pas un ancien scan. */
  const generationsPreset = new Map<string, number>();
  const echeancesPreset = new Map<string, number | undefined>();
  /** Un seul tick en cours PAR génération, sans verrou hérité d'une génération retirée. */
  const ticksEnCours = new Map<string, number>();
  let arrete = false;

  const tickPreset = async (id: string): Promise<void> => {
    // AUCUNE garde de visibilité : c'est la seule source d'alerte sans relais daemon —
    // la couper onglet caché laissait l'opérateur non couvert sans le savoir.
    const generation = generationsPreset.get(id);
    if (generation === undefined || ticksEnCours.get(id) === generation) return;
    const alerte = presetAlertsStore.getState().alertes.find((a) => a.id === id);
    if (!alerte || !alerteActiveAuTemps(alerte, Date.now())) return;
    const encoreValide = (): boolean => {
      if (arrete || generationsPreset.get(id) !== generation) return false;
      const courante = presetAlertsStore.getState().alertes.find((a) => a.id === id);
      return courante !== undefined && alerteActiveAuTemps(courante, Date.now()) && courante.expireTs === alerte.expireTs;
    };
    ticksEnCours.set(id, generation);
    try {
      const res = await executerScreener(alerte.baseConditions, alerte.indicatorConditions, alerte.tf, {
        capIndicateurs: PRESET_CAP_INDICATEURS,
        capPosition: SCREENER_POSITION_CAP,
      });
      // Ré-validation POST-await : l'alerte a pu être retirée/désactivée pendant le scan en
      // vol — `resyncPreset` a alors déjà purgé son état. Sans ce contrôle, la ligne
      // `dernierEnsemble.set` ci-dessous RESSUSCITERAIT sa baseline (et pourrait déclencher
      // pour une alerte disparue).
      if (!encoreValide()) return;
      presetAlertsStore.getState().marquerScan(id, Date.now()); // succès : erreur effacée
      const courant = res.rows.map((r) => r.symbol);
      const precedent = dernierEnsemble.get(id) ?? null;
      const entrants = diffEntrants(precedent, courant);
      dernierEnsemble.set(id, new Set(courant));
      if (precedent === null) return; // amorce : baseline mémorisée, aucun déclenchement
      const cd = cooldownsPreset.get(id) ?? new Map<string, number>();
      const nowMs = Date.now();
      const retenus = filtrerCooldown(entrants, cd, nowMs, PRESET_COOLDOWN_MS);
      for (const sym of retenus) {
        if (!encoreValide()) return;
        cd.set(sym, nowMs);
        const d: Declenchement = {
          alertId: id,
          ts: nowMs,
          valeur: 0, // pas de valeur numérique : c'est une entrée dans un ensemble
          message: `EQS ${alerte.nom} : ${sym} entre dans le scan`,
        };
        alertsStore.getState().ajouterJournal(d);
        if (!encoreValide()) return;
        notifier(d);
      }
      cooldownsPreset.set(id, cd);
    } catch (e) {
      // Scan best-effort : un échec réseau ne casse ni la baseline ni le timer, mais il
      // est PUBLIÉ (le panneau affichait une pastille verte après des heures d'échecs).
      if (encoreValide()) presetAlertsStore
        .getState()
        .marquerScan(id, Date.now(), e instanceof Error ? e.message : String(e));
    } finally {
      if (ticksEnCours.get(id) === generation) ticksEnCours.delete(id);
    }
  };

  const resyncPreset = (): void => {
    const actives = presetAlertsStore.getState().alertes.filter((a) => alerteActiveAuTemps(a, Date.now()));
    const idsActifs = new Set(actives.map((a) => a.id));
    // Alertes disparues/désactivées : on stoppe le timer et on purge leur état.
    for (const [id, timer] of timersPreset) {
      const courante = actives.find((a) => a.id === id);
      if (idsActifs.has(id) && echeancesPreset.get(id) === courante?.expireTs) continue;
      clearInterval(timer);
      timersPreset.delete(id);
      dernierEnsemble.delete(id);
      cooldownsPreset.delete(id);
      ticksEnCours.delete(id);
      echeancesPreset.delete(id);
      generationsPreset.set(id, (generationsPreset.get(id) ?? 0) + 1);
    }
    // Nouvelles alertes actives : tick d'amorce immédiat (baseline) puis timer périodique.
    for (const a of actives) {
      if (timersPreset.has(a.id)) continue;
      generationsPreset.set(a.id, (generationsPreset.get(a.id) ?? 0) + 1);
      echeancesPreset.set(a.id, a.expireTs);
      void tickPreset(a.id);
      const periodeMs = a.periodeMin * 60_000;
      timersPreset.set(a.id, setInterval(() => void tickPreset(a.id), periodeMs));
    }
  };

  // ── Métriques on-chain lentes : alertes `onchain-seuil` ───────────────────
  // Poll 15 min sur les caches de CHAIN ; chargeur importé À LA DEMANDE (rien dans le
  // bundle d'entrée sans alerte on-chain). Une métrique absente laisse sa condition non
  // évaluable (armement figé, aucun faux déclenchement). Condition GLOBALE : lot par TYPE.
  let onchainTimer: ReturnType<typeof setInterval> | undefined;
  let onchainGeneration = 0;
  let onchainEnCoursGeneration: number | null = null;
  let onchainAbort: AbortController | null = null;
  let onchainCleRequises = "";
  let onchainDerniereEval = 0;
  const metriquesOnchainRequises = (): Set<MetriqueOnchainAlerte> => {
    const requises = new Set<MetriqueOnchainAlerte>();
    for (const d of alertsStore.getState().defs) {
      if (alerteActiveAuTemps(d, Date.now()) && d.condition.type === "onchain-seuil") requises.add(d.condition.metrique);
    }
    return requises;
  };
  const evaluerOnchain = async (): Promise<void> => {
    if (arrete || onchainEnCoursGeneration !== null) return;
    const requises = metriquesOnchainRequises();
    if (requises.size === 0) return;
    const generation = onchainGeneration;
    const controller = new AbortController();
    onchainAbort = controller;
    onchainEnCoursGeneration = generation;
    try {
      const { chargerMetriquesOnchain } = await import("./onchainMetriques");
      if (arrete || generation !== onchainGeneration) return;
      const onchainMetriques = await chargerMetriquesOnchain(requises, controller.signal);
      if (arrete || generation !== onchainGeneration) return;
      onchainDerniereEval = Date.now();
      // Relire le lot : une def a pu être retirée ou désactivée pendant le chargement.
      const lot = alertsStore.getState().defs.filter((d) => alerteActiveAuTemps(d, Date.now()) && d.condition.type === "onchain-seuil");
      appliquerResultat(lot, { maintenant: Date.now(), dernierPrix: 0, onchainMetriques });
    } catch (err) {
      if (!arrete && generation === onchainGeneration && !controller.signal.aborted) {
        console.error("[AXIOM] alertes on-chain : chargement des métriques échoué", err);
      }
    } finally {
      if (generation === onchainGeneration) {
        onchainEnCoursGeneration = null;
        onchainAbort = null;
      }
    }
  };
  const resyncOnchain = (): void => {
    const requises = metriquesOnchainRequises();
    const cle = alertsStore.getState().defs
      .filter((d) => alerteActiveAuTemps(d, Date.now()) && d.condition.type === "onchain-seuil")
      .map((d) => `${d.id}:${d.expireTs ?? "permanent"}`)
      .sort().join("|");
    const definitionsChangees = cle !== onchainCleRequises;
    if (definitionsChangees) {
      onchainGeneration += 1;
      onchainAbort?.abort();
      onchainAbort = null;
      onchainEnCoursGeneration = null;
      onchainCleRequises = cle;
    }
    if (requises.size === 0) {
      if (onchainTimer !== undefined) clearInterval(onchainTimer);
      onchainTimer = undefined;
      return;
    }
    if (onchainTimer === undefined) onchainTimer = setInterval(() => void evaluerOnchain(), ONCHAIN_POLL_MS);
    // Évaluation immédiate seulement si l'ensemble des métriques change (nouvelle alerte)
    // ou si le dernier passage date : un déclenchement quelconque ne relance rien.
    if (onchainEnCoursGeneration === null && (definitionsChangees || Date.now() - onchainDerniereEval >= ONCHAIN_POLL_MS)) {
      void evaluerOnchain();
    }
  };

  // Une échéance doit libérer les flux même en l'absence de tick ou de mutation.
  let echeanceTimer: ReturnType<typeof setTimeout> | undefined;
  const reconcilier = (): void => {
    resyncTicker();
    resyncFunding();
    resyncLiqCascade();
    resyncPreset();
    resyncCvd();
    resyncFluxCapitaux();
    resyncOnchain();
    evaluerRegime();
  };
  const planifierEcheance = (): void => {
    if (echeanceTimer !== undefined) clearTimeout(echeanceTimer);
    echeanceTimer = undefined;
    const now = Date.now();
    const prochaine = prochaineEcheanceAlerte(
      [...alertsStore.getState().defs, ...presetAlertsStore.getState().alertes], now,
    );
    if (prochaine === null) return;
    echeanceTimer = setTimeout(() => {
      echeanceTimer = undefined;
      reconcilier();
      planifierEcheance();
    }, Math.min(2_147_483_647, Math.max(1, prochaine - now)));
  };
  const auRetourOnglet = (): void => { reconcilier(); planifierEcheance(); };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", auRetourOnglet);

  // Démarrage : souscriptions + calibrage immédiat contre l'état courant.
  reconcilier();
  planifierEcheance();
  // Calibrage CVD sur l'état déjà publié (si orderflow déjà actif).
  for (const sym of Object.keys(cvdDivergenceStore.getState().bySymbol)) {
    evaluerCvdSymbol(marketStore.getState().exchange, sym);
  }
  evaluerRegime(); // calibrage régime sur le score déjà publié
  const unsubAlerts = alertsStore.subscribe((state, precedent) => {
    if (state.defs === precedent.defs) return;
    reconcilier(); // re-route et libère les besoins au changement de définitions
    planifierEcheance();
  });
  const unsubMarket = marketStore.subscribe(onMarket);
  onMarket(); // calibrage initial des conditions bougie sur le backfill présent

  // Ajout/retrait/bascule d'une alerte de preset → re-cadre les timers de scan.
  const unsubPreset = presetAlertsStore.subscribe(() => { resyncPreset(); planifierEcheance(); });

  const stopHeartbeat = demarrerHeartbeat();

  return () => {
    arrete = true;
    onchainGeneration += 1;
    onchainAbort?.abort();
    onchainAbort = null;
    unsubAlerts();
    unsubMarket();
    unsubTicker();
    unsubCvd();
    unsubRegime();
    unsubFluxCapitaux();
    garderFluxCapitauxPourAlertes(false);
    unsubPreset();
    orderflowStore.getState().setAlerteCvdDemandee(false);
    if (echeanceTimer !== undefined) clearTimeout(echeanceTimer);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", auRetourOnglet);
    stopHeartbeat();
    if (fundingTimer !== undefined) clearInterval(fundingTimer);
    if (liqCascadeTimer !== undefined) clearInterval(liqCascadeTimer);
    if (onchainTimer !== undefined) clearInterval(onchainTimer);
    for (const timer of timersPreset.values()) clearInterval(timer);
    timersPreset.clear();
    dernierEnsemble.clear();
    cooldownsPreset.clear();
    ticksEnCours.clear();
    generationsPreset.clear();
    echeancesPreset.clear();
  };
}

/**
 * Charge le funding courant (Binance premiumIndex, fraction) + z-score optionnel
 * depuis l'historique Coinalyze (best-effort : z omis si indisponible).
 */
async function chargerFunding(
  symbol: string,
  encoreDemande: () => boolean
): Promise<{ rate: number; z?: number } | undefined> {
  if (!encoreDemande()) return undefined;
  let rate: number | undefined;

  // 1) Snapshot Binance fapi (gratuit, fiable) — fraction lastFundingRate.
  try {
    const res = await fetch(
      extUrl("fapi.binance.com", `fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`)
    );
    if (!encoreDemande()) return undefined;
    if (res.ok) {
      const raw: unknown = await res.json();
      if (!encoreDemande()) return undefined;
      const last =
        raw !== null && typeof raw === "object"
          ? Number((raw as { lastFundingRate?: unknown }).lastFundingRate)
          : Number.NaN;
      if (Number.isFinite(last)) rate = last;
    }
  } catch {
    /* best-effort */
  }

  // 2) Repli Coinalyze si premiumIndex a échoué.
  if (!encoreDemande()) return undefined;
  if (rate === undefined) {
    try {
      const fr = await coinalyzeProvider.fetchFundingRate(symbol);
      if (!encoreDemande()) return undefined;
      if (Number.isFinite(fr.rate)) rate = fr.rate;
    } catch {
      /* best-effort */
    }
  }
  if (rate === undefined) return undefined;

  // 3) Z-score sur les RÈGLEMENTS RÉELS (Binance fapi/v1/fundingRate via histFunding —
  //    cadence 8 h OU 4 h selon le perp, memoïsé). Repli : Coinalyze « 4hour » filtré aux
  //    frontières de règlement 8 h UTC (00/08/16) — « 8hour » N'EXISTE PAS chez Coinalyze
  //    et repliait en silence sur du 5 min : les 30 « règlements » couvraient ~2 h 30,
  //    écart-type ≈ 0, z aberrant. Filtre sur le TEMPS (pas sur l'index) : un
  //    sous-échantillonnage par index ne garantit pas l'alignement sur les vraies
  //    frontières de règlement (cf. `filtrerFrontieres8h`).
  let z: number | undefined;
  try {
    let rates = ((await histFunding(symbol)) ?? []).map((p) => p.v);
    if (!encoreDemande()) return undefined;
    if (rates.length === 0) {
      const since = Date.now() - FUNDING_Z_WINDOW * 8 * 3_600_000;
      const hist = await coinalyzeProvider.fetchFundingRateHistory(symbol, "4hour", since);
      if (!encoreDemande()) return undefined;
      // Filtre les taux finis AVANT la sélection par frontière (sinon un point non-fini
      // sur une frontière retenue élargirait silencieusement un trou à ~16 h).
      const finis = hist.filter((h) => Number.isFinite(h.rate));
      rates = filtrerFrontieres8h(finis).map((h) => h.rate);
    }
    // Inclut le rate courant s'il n'est pas déjà le dernier point.
    const series =
      rates.length > 0 && rates[rates.length - 1] === rate ? rates : [...rates, rate];
    if (series.length >= Math.min(5, FUNDING_Z_WINDOW)) {
      const win = series.slice(-FUNDING_Z_WINDOW);
      const mean = win.reduce((a, b) => a + b, 0) / win.length;
      const variance = win.reduce((a, b) => a + (b - mean) ** 2, 0) / win.length;
      const sd = Math.sqrt(variance);
      z = sd === 0 ? 0 : (rate - mean) / sd;
    }
  } catch {
    /* z optionnel */
  }

  if (!encoreDemande()) return undefined;
  return { rate, z };
}

// Singleton : évite les doubles souscriptions (ex. double montage en React StrictMode).
let arreter: Unsubscribe | null = null;

/**
 * Démarre le runtime des alertes (idempotent : un second appel arrête d'abord le
 * précédent). À câbler UNE fois par un agent ultérieur (ex. dans App). Renvoie l'arrêt.
 */
export function demarrerAlertes(): Unsubscribe {
  if (arreter) arreter();
  const stop = creerRuntime();
  arreter = () => {
    stop();
    arreter = null;
  };
  return arreter;
}

// ───────── Heartbeat vers le daemon (anti-doublon onglet fermé) ─────────
//
// Tant que l'app est OUVERTE, elle POST /heartbeat toutes les 30 s avec
// `{visible, canNotify}`. Le daemon relaie macOS sauf si le heartbeat est récent
// ET `canNotify: true` (onglet visible + permission). Champ absent (legacy) ⇒ relais.
// Telegram reste propriétaire du daemon. Sans daemon : aucun POST.

/** Intervalle d'émission du heartbeat (ms). */
const HEARTBEAT_MS = 30_000;

function ongletVisible(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "visible";
}

function permissionNotificationAccordee(): boolean {
  return typeof Notification !== "undefined" && Notification.permission === "granted";
}

/** Corps heartbeat v2 : le front ne notifie que si visible ET permission. */
function payloadHeartbeat(): { visible: boolean; canNotify: boolean } {
  const visible = ongletVisible();
  return { visible, canNotify: visible && permissionNotificationAccordee() };
}

/** Envoie un heartbeat (best-effort, silencieux) si le daemon est détecté présent. */
function envoyerHeartbeat(): void {
  if (!daemonSupporte("alerts")) return;
  try {
    void fetch(urlDaemon("/heartbeat"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payloadHeartbeat()),
    }).catch(() => {});
  } catch {
    /* best-effort */
  }
}

/**
 * Démarre le heartbeat périodique + un push initial des défs au daemon une fois
 * celui-ci confirmé présent. Renvoie une fonction d'arrêt.
 */
function demarrerHeartbeat(): Unsubscribe {
  let arrete = false;
  // Détection (mémoïsée) : au succès, on sème les défs courantes et on bat le cœur.
  void detectDaemon(["alerts", "kv"]).then((present) => {
    if (!present || arrete) return;
    pousserDefsDaemon();
    envoyerHeartbeat();
  });
  // Le relais change dès que l'onglet est masqué, sans fenêtre muette de 30 secondes.
  const documentHeartbeat = typeof document !== "undefined" ? document : undefined;
  documentHeartbeat?.addEventListener("visibilitychange", envoyerHeartbeat);
  const timer = setInterval(envoyerHeartbeat, HEARTBEAT_MS);
  return () => {
    arrete = true;
    clearInterval(timer);
    documentHeartbeat?.removeEventListener("visibilitychange", envoyerHeartbeat);
  };
}

// ───────── Notification système + bip WebAudio (best-effort) ─────────

/**
 * Demande la permission de notification si elle n'a pas encore été décidée.
 * À appeler depuis un geste utilisateur (contrainte navigateur). Sans effet si refusée/accordée.
 */
export function demanderPermissionNotifications(): void {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  } catch {
    /* API absente / bloquée : best-effort */
  }
}

/** Notifie un déclenchement : Notification API seulement si onglet visible ET permission. */
export function notifier(d: Declenchement): void {
  try {
    if (ongletVisible() && permissionNotificationAccordee()) {
      new Notification("AXIOM — alerte", { body: d.message });
    }
  } catch {
    /* best-effort */
  }
  bip();
}

type AudioCtor = typeof AudioContext;
let audioCtx: AudioContext | null = null;

/** Récupère le constructeur AudioContext (préfixe webkit sur certains navigateurs). */
function ctorAudio(): AudioCtor | undefined {
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext;
}

/** Bip court et discret (oscillateur sinus ~120 ms, volume faible). */
function bip(): void {
  try {
    const Ctor = ctorAudio();
    if (!Ctor) return;
    if (!audioCtx) audioCtx = new Ctor();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.05; // discret
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const t = audioCtx.currentTime;
    osc.start(t);
    osc.stop(t + 0.12);
  } catch {
    /* audio best-effort (contexte non repris tant qu'aucun geste utilisateur) */
  }
}
