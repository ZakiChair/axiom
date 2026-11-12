/**
 * AlertsPanel — section latérale des alertes (pattern SidebarSection).
 *
 * Liste dense des alertes (état actif, armement, dernière exécution, libellé de la
 * condition), création (symbole prérempli = actif courant ; types prix / var% /
 * indicateur-seuil / indicateur-croisement / funding-extreme / cascade liq / score de
 * régime), suppression, bascule actif/inactif, et journal repliable des déclenchements.
 * Un clic sur une alerte (ou sur une ligne de journal) ramène la vue PRINCIPALE sur son
 * symbole et son unité (`voirAlerte` du runtime) : c'est elle que les alertes de bougie lisent.
 *
 * Depuis le 12 novembre 2026 : chaque ligne porte le libellé de l'alerte (`decrireAlerte`, qui
 * dit ce qui est mesuré) suivi de son unité, en entier (retour à la ligne, jamais coupé) ; une
 * def de bougie que rien n'évalue l'écrit (« hors graphe », « historique insuffisant ») au lieu
 * de « armée » ; une alerte posée alors que sa condition est déjà vraie l'écrit au lieu de
 * « déclenchée » ; le formulaire d'indicateur nomme les sorties, pose comparateur et valeur quand
 * une seule lecture a un sens, et dit sous lui ce que l'alerte portera et ce qui ne sonnera pas.
 *
 * Ce composant se re-rend uniquement sur ÉVÉNEMENT (création, bascule, déclenchement) :
 * aucune donnée haute fréquence n'y transite (le runtime écrit le store hors render-loop).
 *
 * CVD spot/perp-div : moteur + runtime (pont orderflow) + création UI.
 */
import { useMemo, useState } from "react";
import { useStore } from "zustand";
import {
  decrireAlerte,
  alerteActiveAuTemps,
  conditionSupporteTimeframe,
  estFrontOnly,
  LIBELLES_METRIQUE_ONCHAIN,
  METRIQUES_ONCHAIN_ALERTE,
  validerComposite,
  type Comparateur,
  type MetriqueOnchainAlerte,
  type Condition,
  type ConditionSimple,
  type SensCroisement,
} from "@axiom/alerts";
import { getIndicator, supportsIndicatorTimeframe, TIMEFRAME_REQUIS } from "@axiom/indicators";
import { marketStore } from "../store/market";
import { alertsStore } from "../store/alerts";
import { indicatorsStore } from "../store/indicators";
import { decisionDossiersStore } from "../store/decisionDossiers";
import { windowManagerStore } from "../store/windowManager";
import { presetAlertsStore, type AlertePreset } from "../store/presetAlerts";
import { demanderPermissionNotifications, voirAlerte } from "../alerts/runtime";
import { useExpirationClock } from "../alerts/useExpirationClock";
import { daemonSupporte } from "../data/daemon";
import { IS_VERCEL } from "../lib/deployment";
import { formatHeure } from "../lib/format";
import { motifUniteHorsGraphe, uniteImbriquee } from "../chart/uniteParam";
import {
  cibleAlerte,
  construireConditionCroisement,
  construireConditionSeuil,
  etatArmement,
  evaluationAlerte,
  explicationMuette,
  INDICATEURS_CROISEMENT,
  INDICATEURS_SEUIL,
  noteAlerteSeuil,
  sansMarche,
  sortiesAlerte,
  texteEvaluation,
} from "./alertsPanel.util";
import { refusAlertePerp, titreOptionsPerp } from "./optionsPerp.util";
import { SidebarSection } from "./SidebarSection";
import { Badge, Unusable, Vide } from "./ui";

/** Types d'alerte proposés à la création. */
type TypeAlerte =
  | "prix-croise"
  | "variation-pct"
  | "indicateur-seuil"
  | "indicateur-croisement"
  | "funding-extreme"
  | "cvd-spot-perp-div"
  | "liq-cascade"
  | "regime-seuil"
  | "onchain-seuil"
  | "whale-flux";

/** Symbole porteur neutre d'une alerte GLOBALE (regime-seuil, indépendante du symbole). */
const PORTEUR_GLOBAL = { symbol: "BTCUSDT", source: "binance" } as const;

/** Actifs suivis par le collecteur whales du daemon (couverture v1 — cf. data/whales.ts). */
const ACTIFS_WHALE = ["BTC", "USDT", "USDC"] as const;

/** Direction d'une alerte baleine (filtre de la condition whale-flux). */
type DirectionAlerteWhale = "tous" | "depot" | "retrait";

/** Sens funding (overcrowding). */
type SensFunding = "long-crowded" | "short-crowded" | "les-deux";

/** Kind de divergence CVD spot/perp. */
type KindCvd = "spotUp_perpDown" | "spotDown_perpUp" | "les-deux";

/** Fenêtres proposées pour la variation en %. */
const FENETRES: Array<{ label: string; ms: number }> = [
  { label: "1 min", ms: 60_000 },
  { label: "5 min", ms: 300_000 },
  { label: "15 min", ms: 900_000 },
  { label: "1 h", ms: 3_600_000 },
];

const COMPARATEURS: Comparateur[] = [">", ">=", "<", "<="];

/**
 * État du dernier scan d'une alerte de preset : pastille + libellé. Un échec avalé ne
 * doit PAS rester vert (le scan est front-only, sans relais daemon).
 */
function etatScan(a: AlertePreset, maintenant: number): { classePastille: string; classeTexte: string; texte: string } {
  if (a.expireTs !== undefined && maintenant >= a.expireTs) return { classePastille: "text-warn", classeTexte: "text-warn", texte: "expirée" };
  if (!a.actif) return { classePastille: "text-text-dim", classeTexte: "text-text-dim", texte: "en pause" };
  if (a.derniereErreur !== undefined) {
    return {
      classePastille: "text-warn",
      classeTexte: "text-warn",
      texte: `échec ${formatHeure(a.dernierScanTs ?? 0)} — ${a.derniereErreur}`,
    };
  }
  if (a.dernierScanTs === undefined) {
    return { classePastille: "text-text-dim", classeTexte: "text-text-dim", texte: "aucun scan" };
  }
  if (a.avertissement !== undefined) {
    return { classePastille: "text-warn", classeTexte: "text-warn", texte: `scan ${formatHeure(a.dernierScanTs)} incomplet — ${a.avertissement}` };
  }
  return { classePastille: "text-up", classeTexte: "text-text-dim", texte: `scan ${formatHeure(a.dernierScanTs)}` };
}

export function AlertsPanel() {
  const defs = useStore(alertsStore, (s) => s.defs);
  const journal = useStore(alertsStore, (s) => s.journal);
  const symbolCourant = useStore(marketStore, (s) => s.symbol);
  const exchangeCourant = useStore(marketStore, (s) => s.exchange);
  const tfCourant = useStore(marketStore, (s) => s.timeframe);
  // Taille du tampon du graphe principal (change à chaque bougie et à chaque page d'historique,
  // pas à chaque tick) : une alerte n'est pas évaluée sous l'amorce de son indicateur.
  const bougiesGraphe = useStore(marketStore, (s) => s.candles.length);
  // Indicateurs de la vue principale : le graphe étend son historique à leur amorce, « affichez
  // l'indicateur » n'est donc un remède que pour celui qui n'y est pas.
  const indicateursActifs = useStore(indicatorsStore, (s) => s.indicators);
  const indicateursAffiches = useMemo(() => indicateursActifs.map((i) => i.defId), [indicateursActifs]);
  const graphe = { exchange: exchangeCourant, symbol: symbolCourant, timeframe: tfCourant, bougies: bougiesGraphe, indicateurs: indicateursAffiches };
  // Le daemon local, quand il est là, évalue aussi les alertes de bougie en 1m sur Binance.
  const daemonAlertes = daemonSupporte("alerts");
  // Alertes de scan (EQS) : liste réactive + message discret sur refus de reprise (limite).
  const alertesScan = useStore(presetAlertsStore, (s) => s.alertes);
  const maintenant = useExpirationClock(defs, alertesScan);
  const [msgScan, setMsgScan] = useState<string | null>(null);

  const prolongerScan = (a: AlertePreset) => {
    const base = Math.max(Date.now(), a.expireTs ?? Date.now());
    const res = presetAlertsStore.getState().prolonger(a.id, base + 24 * 3_600_000);
    setMsgScan(res === "limite" ? "4 alertes de scan max" : res === "ok" ? "Alerte prolongée de 24 h" : "Échéance invalide");
  };

  const basculerScan = (id: string) => {
    if (presetAlertsStore.getState().basculer(id) === "limite") {
      setMsgScan("4 alertes de scan max");
      setTimeout(() => setMsgScan(null), 4000);
    }
  };

  // Formulaire de création (état local React).
  const [symbol, setSymbol] = useState("");
  const [type, setType] = useState<TypeAlerte>("prix-croise");
  const [dureeAlerteMs, setDureeAlerteMs] = useState(0);
  const [niveau, setNiveau] = useState("");
  const [sens, setSens] = useState<SensCroisement>("hausse");
  const [seuilPct, setSeuilPct] = useState("");
  const [fenetreMs, setFenetreMs] = useState(FENETRES[0]?.ms ?? 60_000);
  // indicateur-seuil : AXIS S/R puis AXIS en tête ; la sortie est une entrée NOMMÉE (clé de
  // `sortiesAlerte`), qui porte son comparateur et sa valeur quand une seule lecture a un sens.
  const [indicateurId, setIndicateurId] = useState(INDICATEURS_SEUIL[0]?.id ?? "rsi");
  const [sortieCle, setSortieCle] = useState(() => {
    const premier = INDICATEURS_SEUIL[0];
    return (premier ? sortiesAlerte(premier)[0]?.cle : undefined) ?? "rsi";
  });
  const [comparateur, setComparateur] = useState<Comparateur>(">");
  const [valeurInd, setValeurInd] = useState("");
  // indicateur-croisement : état PROPRE (catalogue différent de `indicateur-seuil` —
  // partager `indicateurId` laisserait des sorties périmées en changeant de type).
  const [indicateurCroise, setIndicateurCroise] = useState(INDICATEURS_CROISEMENT[0]?.id ?? "macd");
  const [outputA, setOutputA] = useState(INDICATEURS_CROISEMENT[0]?.outputs[0]?.key ?? "macd");
  const [outputB, setOutputB] = useState(INDICATEURS_CROISEMENT[0]?.outputs[1]?.key ?? "signal");
  // Sens PROPRE au croisement : `sens` est conservé d'une soumission à l'autre
  // (enchaînement rapide) et le partager ferait fuiter le choix d'un type vers l'autre.
  const [sensCroisement, setSensCroisement] = useState<SensCroisement>("hausse");
  // funding-extreme
  const [sensFunding, setSensFunding] = useState<SensFunding>("les-deux");
  const [seuilAbsPct, setSeuilAbsPct] = useState("0.1"); // saisie en % (0.1 = 0.1 %)
  const [zSeuil, setZSeuil] = useState("2");
  // cvd-spot-perp-div
  const [kindCvd, setKindCvd] = useState<KindCvd>("les-deux");
  // liq-cascade : seuil de notionnel liquidé par minute glissante (USD/min).
  const [seuilCascade, setSeuilCascade] = useState("5000000");
  // regime-seuil : comparateur + valeur (−2..+2), score composite de régime.
  const [comparateurRegime, setComparateurRegime] = useState<Comparateur>("<=");
  const [valeurRegime, setValeurRegime] = useState("-1.2");
  // onchain-seuil : métrique quotidienne + comparateur + seuil, condition globale.
  const [metriqueOnchain, setMetriqueOnchain] = useState<MetriqueOnchainAlerte>("mvrv-z");
  const [comparateurOnchain, setComparateurOnchain] = useState<Comparateur>(">=");
  const [valeurOnchain, setValeurOnchain] = useState("7");
  // whale-flux : actif surveillé + seuil d'UN transfert (USD) + filtre de direction.
  const [actifWhale, setActifWhale] = useState<string>("BTC");
  const [seuilWhale, setSeuilWhale] = useState("10000000");
  const [directionWhale, setDirectionWhale] = useState<DirectionAlerteWhale>("tous");
  const [journalOuvert, setJournalOuvert] = useState(false);
  const [erreurForm, setErreurForm] = useState<string | null>(null);
  // Suppression armée (pattern SettingsPanel.restaurer) : id de l'alerte à confirmer.
  const [confirmSuppr, setConfirmSuppr] = useState<string | null>(null);
  const [composer, setComposer] = useState(false);
  const [composition, setComposition] = useState<ConditionSimple[]>([]);
  const [symboleCompose, setSymboleCompose] = useState<string | null>(null);

  const symboleEffectif = (symbol.trim() || symbolCourant).toUpperCase();
  // Cible des contrôles perp : le symbole de la composition en cours, sinon le symbole effectif —
  // une composition vidée par « × » ne garde pas son ancien symbole.
  const symboleCible = (composition.length > 0 ? symboleCompose : null) ?? symboleEffectif;
  // Funding, CVD S/P et Cascade liq exigent un marché perp pour la cible (source du graphe et
  // symbole saisi ou composé) : options désactivées sur STABLE.D, SPY… (création seulement :
  // les défs déjà persistées restent, inertes au runtime). Titre propre à un graphe Twelve Data.
  const titrePerp = titreOptionsPerp(exchangeCourant, symboleCible);

  const sortiesDispo = useMemo(() => {
    const idef = getIndicator(indicateurId);
    return idef ? sortiesAlerte(idef) : [];
  }, [indicateurId]);
  const sortieChoisie = sortiesDispo.find((s) => s.cle === sortieCle);
  // Condition en cours de saisie (null : incomplète) : le formulaire affiche le libellé qu'elle portera.
  const conditionSeuil = construireConditionSeuil(indicateurId, sortieCle, comparateur, valeurInd);

  const onChangeIndicateur = (id: string) => {
    setIndicateurId(id);
    const idef = getIndicator(id);
    const premiere = idef ? sortiesAlerte(idef)[0]?.cle : undefined;
    if (premiere) setSortieCle(premiere);
  };

  const outputsCroisement = useMemo(() => {
    return getIndicator(indicateurCroise)?.outputs ?? [];
  }, [indicateurCroise]);

  const onChangeIndicateurCroise = (id: string) => {
    setIndicateurCroise(id);
    // Deux premières sorties du nouvel indicateur (garanti ≥ 2 par le catalogue).
    const outs = getIndicator(id)?.outputs ?? [];
    const a = outs[0]?.key;
    const b = outs[1]?.key;
    if (a) setOutputA(a);
    if (b) setOutputB(b);
  };

  const soumettre = () => {
    if (IS_VERCEL && type === "whale-flux") return;
    if (composer && (type === "whale-flux" || type === "onchain-seuil" || (type === "prix-croise" && sens === "les-deux"))) {
      setErreurForm("Type non composable (whale-flux / on-chain / prix ↕).");
      return;
    }
    // Contrôle défensif : le type choisi survit à un changement de graphe (option désactivée depuis).
    const refusPerp = refusAlertePerp([type], marketStore.getState().exchange, symboleCible);
    if (refusPerp !== null) {
      setErreurForm(refusPerp);
      return;
    }
    let condition: Condition;
    if (type === "prix-croise") {
      const n = Number(niveau);
      if (!Number.isFinite(n)) {
        setErreurForm("Niveau requis.");
        return;
      }
      condition = { type: "prix-croise", niveau: n, sens };
    } else if (type === "variation-pct") {
      const s = Number(seuilPct);
      if (!Number.isFinite(s) || s === 0) {
        setErreurForm("Seuil non nul requis.");
        return;
      }
      condition = { type: "variation-pct", seuilPct: s, fenetreMs };
    } else if (type === "indicateur-seuil") {
      // Params vides → défauts du registry côté moteur. Une sortie nommée porte son seuil.
      if (conditionSeuil === null) {
        setErreurForm("Indicateur, sortie et valeur requis.");
        return;
      }
      condition = conditionSeuil;
    } else if (type === "indicateur-croisement") {
      const c = construireConditionCroisement(indicateurCroise, outputA, outputB, sensCroisement);
      if (c === null) {
        setErreurForm("Deux sorties DIFFÉRENTES du même indicateur requises.");
        return;
      }
      condition = c;
    } else if (type === "funding-extreme") {
      // funding-extreme : seuilAbs en fraction (saisie % → /100) ; z optionnel.
      const absPct = Number(seuilAbsPct);
      const z = Number(zSeuil);
      const hasAbs = Number.isFinite(absPct) && absPct > 0;
      const hasZ = Number.isFinite(z) && z > 0;
      if (!hasAbs && !hasZ) {
        setErreurForm("Au moins un critère (seuil absolu ou z-score) requis.");
        return;
      }
      condition = {
        type: "funding-extreme",
        sens: sensFunding,
        ...(hasAbs ? { seuilAbs: absPct / 100 } : {}),
        ...(hasZ ? { zSeuil: z } : {}),
      };
    } else if (type === "liq-cascade") {
      // liq-cascade : seuil USD/min strictement positif requis.
      const s = Number(seuilCascade);
      if (!Number.isFinite(s) || s <= 0) {
        setErreurForm("Seuil de cascade (> 0) requis.");
        return;
      }
      condition = { type: "liq-cascade", seuilUsdParMin: s };
    } else if (type === "regime-seuil") {
      // regime-seuil : score composite borné −2..+2, condition globale.
      const v = Number(valeurRegime);
      if (!Number.isFinite(v) || v < -2 || v > 2) {
        setErreurForm("Seuil de régime requis (entre −2 et +2).");
        return;
      }
      condition = { type: "regime-seuil", comparateur: comparateurRegime, valeur: v };
    } else if (type === "onchain-seuil") {
      const v = Number(valeurOnchain);
      if (!Number.isFinite(v)) {
        setErreurForm("Seuil on-chain requis.");
        return;
      }
      condition = { type: "onchain-seuil", metrique: metriqueOnchain, comparateur: comparateurOnchain, valeur: v };
    } else if (type === "whale-flux") {
      // whale-flux : seuil d'UN transfert (USD) strictement positif requis.
      const s = Number(seuilWhale);
      if (!Number.isFinite(s) || s <= 0) {
        setErreurForm("Seuil baleine (> 0 $) requis.");
        return;
      }
      condition = { type: "whale-flux", seuilUsd: s, direction: directionWhale };
    } else {
      // cvd-spot-perp-div — active le pipeline orderflow via le runtime.
      condition = { type: "cvd-spot-perp-div", kind: kindCvd };
    }
    if (!conditionSupporteTimeframe(condition, marketStore.getState().timeframe)) {
      setErreurForm("RVOL saisonnier : choisir l’intervalle 1h du graphique.");
      return;
    }
    setErreurForm(null);
    if (composer) {
      if (composition.length >= 4) {
        setErreurForm("4 sous-conditions maximum.");
        return;
      }
      if (composition.length === 0) setSymboleCompose(symboleEffectif);
      setComposition((cs) => [...cs, condition as ConditionSimple]);
      return;
    }
    // regime-seuil est GLOBAL : porté par un symbole neutre (BTCUSDT/binance).
    // whale-flux est porté par l'ACTIF surveillé (convention @axiom/alerts, source binance).
    const cible =
      type === "regime-seuil" || type === "onchain-seuil"
        ? PORTEUR_GLOBAL
        : type === "whale-flux"
          ? { symbol: actifWhale, source: "binance" as const }
          : { symbol: symboleEffectif, source: marketStore.getState().exchange };
    // Conditions de BOUGIE : la def porte le TF courant du chart (le runtime ne
    // l'évalue plus que sur ce TF-là). Les autres types n'ont pas de TF.
    const tfDef =
      type === "variation-pct" || type === "indicateur-seuil" || type === "indicateur-croisement"
        ? marketStore.getState().timeframe
        : undefined;
    const creee = alertsStore.getState().ajouter({
      symbol: cible.symbol,
      source: cible.source,
      condition,
      ...(tfDef !== undefined ? { timeframe: tfDef } : {}),
      ...(dureeAlerteMs > 0 ? { expireTs: Date.now() + dureeAlerteMs } : {}),
    });
    if (!creee) { setErreurForm("Échéance invalide."); return; }
    // Réinitialise les valeurs numériques (on garde type/sens/fenêtre pour un enchaînement rapide).
    setSymbol("");
    setNiveau("");
    setSeuilPct("");
    setValeurInd("");
  };

  const badge = `${defs.length} alerte${defs.length > 1 ? "s" : ""}`;

  return (
    <>
    <SidebarSection
      title="Alertes"
      collapsible
      defaultOpen={false}
      badge={badge}
      action={
        <button
          type="button"
          onClick={demanderPermissionNotifications}
          title="Autoriser les notifications système"
          className="text-[10px] text-text-dim transition hover:text-text"
        >
          Notifications
        </button>
      }
    >
      {IS_VERCEL && (
        <div className="px-3 py-2">
          <Unusable raison="L’évaluation et les notifications onglet fermé nécessitent axiomd ; les alertes front restent actives tant que l’application est ouverte." />
        </div>
      )}
      {/* Liste des alertes */}
      <div className="max-h-64 overflow-y-auto">
        {defs.length === 0 && (
          <div className="px-3 py-2">
            <Vide>Aucune alerte. Créez-en une ci-dessous.</Vide>
          </div>
        )}
        {defs.map((d) => {
          const arm = etatArmement(d);
          const expiree = d.expireTs !== undefined && maintenant >= d.expireTs;
          const derniere = d.declenchements[d.declenchements.length - 1];
          const whaleUnusable = IS_VERCEL && d.condition.type === "whale-flux";
          const frontOnly = estFrontOnly(d);
          // Paramètre « unité » réservé au graphe (import, définition persistée) : badge dédié.
          const unite = uniteImbriquee(d.condition);
          const timeframeUnusable = unite === null && !conditionSupporteTimeframe(d.condition, d.timeframe);
          // Def de bougie que rien n'évalue : le dire à la place de « armée » (graphe principal
          // ailleurs, ou historique plus court que l'amorce de l'indicateur).
          const evaluation = evaluationAlerte(d, graphe, daemonAlertes);
          const nonEvaluee = expiree || !d.actif ? null : texteEvaluation(evaluation);
          const etatTexte = expiree ? "expirée" : !d.actif ? "en pause" : nonEvaluee ?? arm.texte;
          const etatClasse = expiree || nonEvaluee !== null ? "text-warn" : arm.classe;
          // « historique insuffisant : N sur A », suivi de « affichez l'indicateur » quand il n'est pas
          // sur la vue principale, et « condition déjà vraie… » : trop longs pour la ligne du symbole.
          const etatLong = nonEvaluee !== null ? evaluation.etat === "historique" : !expiree && d.actif && arm.long === true;
          // Def créée avant que le formulaire cesse de proposer les sorties de prix d'une stratégie.
          const muette = explicationMuette(d.condition);
          return (
            <div
              key={d.id}
              data-alerte={d.id}
              className="group flex items-center gap-2 border-l-2 border-transparent px-3 py-1.5 text-[11px] hover:bg-surface"
            >
              <button
                type="button"
                onClick={() => alertsStore.getState().basculerActif(d.id)}
                title={d.actif ? "Désactiver" : "Activer"}
                className={`shrink-0 text-[9px] leading-none ${alerteActiveAuTemps(d, maintenant) ? "text-up" : "text-text-dim"}`}
              >
                ●
              </button>
              <button
                type="button"
                // Alerte baleines : son symbole est l'actif surveillé, pas un marché — aucune vue à ouvrir.
                disabled={sansMarche(d.condition)}
                onClick={() => void voirAlerte(d)}
                title={sansMarche(d.condition) ? "Actif surveillé : aucun marché à afficher" : "Voir sur la vue principale"}
                className="min-w-0 flex-1 text-left"
              >
                {/* Spans (et non divs) : contenu autorisé dans un <button>. */}
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium text-text">{d.symbol}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {whaleUnusable && <Badge ton="down">UNUSABLE</Badge>}
                    {timeframeUnusable && <Badge ton="down" title="RVOL saisonnier : recréer cette alerte sur le graphique 1h.">1h requis</Badge>}
                    {unite !== null && <Badge ton="down" title={motifUniteHorsGraphe(unite, "alerte")}>non évaluée</Badge>}
                    {muette !== null && <Badge ton="down" title={muette}>muette</Badge>}
                    {frontOnly && (
                      <Badge ton="neutre" title="Évaluée seulement app ouverte (CVD / régime)">
                        front-only
                      </Badge>
                    )}
                    {!etatLong && <span data-etat-alerte className={`text-[10px] ${etatClasse}`}>{etatTexte}</span>}
                  </span>
                </span>
                {/* Le libellé revient à la ligne : jamais coupé, « non mesuré » compris. */}
                <span className="flex items-baseline justify-between gap-2">
                  <span data-libelle-alerte className="min-w-0 break-words text-[11px] text-text-dim">
                    {decrireAlerte(d)}{d.timeframe !== undefined ? ` · ${d.timeframe}` : ""}
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums text-text-dim">
                    {formatHeure(derniere ?? 0)}
                  </span>
                </span>
                {etatLong && <span data-etat-alerte className={`block break-words text-[10px] ${etatClasse}`}>{etatTexte}</span>}
                {muette !== null && <span className="block break-words text-[10px] text-warn">{muette}</span>}
                {d.expireTs !== undefined && (
                  <span className="block text-[10px] tabular-nums text-text-dim">
                    Échéance {new Date(d.expireTs).toLocaleString("fr-CH", { dateStyle: "short", timeStyle: "short" })}
                  </span>
                )}
              </button>
              {d.expireTs !== undefined && (
                <button type="button" onClick={() => alertsStore.getState().prolonger(d.id, Math.max(Date.now(), d.expireTs!) + 24 * 3_600_000)}
                  aria-label={`Prolonger l'alerte ${d.symbol} de 24 h`} title="Prolonger de 24 h"
                  className="shrink-0 text-[10px] text-text-dim hover:text-text">+24 h</button>
              )}
              <button
                type="button"
                onClick={() => {
                  // 1er clic : arme la confirmation ; 2e clic : supprime (pattern SettingsPanel.restaurer).
                  if (confirmSuppr !== d.id) {
                    setConfirmSuppr(d.id);
                    return;
                  }
                  setConfirmSuppr(null);
                  alertsStore.getState().supprimer(d.id);
                }}
                onBlur={() => setConfirmSuppr((c) => (c === d.id ? null : c))}
                aria-label={
                  confirmSuppr === d.id
                    ? `Confirmer la suppression de l'alerte ${d.symbol}`
                    : `Supprimer l'alerte ${d.symbol}`
                }
                className={`axiom-action-tactile shrink-0 transition ${
                  confirmSuppr === d.id
                    ? "text-[10px] font-semibold uppercase text-down opacity-100"
                    : "text-text-dim opacity-0 hover:text-text group-hover:opacity-100 focus-visible:opacity-100"
                }`}
              >
                {confirmSuppr === d.id ? "confirmer ?" : "×"}
              </button>
            </div>
          );
        })}
      </div>

      {/* Formulaire de création */}
      <div className="space-y-1.5 border-t border-border p-2">
        <label className="flex items-center gap-2 text-[10px] text-text-dim">
          Durée
          <select value={dureeAlerteMs} onChange={(e) => setDureeAlerteMs(Number(e.target.value))}
            aria-label="Durée de l'alerte" className="rounded border border-border bg-bg px-1 py-0.5 text-xs text-text">
            <option value={0}>Sans échéance</option>
            <option value={3_600_000}>1 h</option>
            <option value={24 * 3_600_000}>24 h</option>
            <option value={7 * 24 * 3_600_000}>7 jours</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 px-0.5 text-[10px] text-text-dim">
          <input
            type="checkbox"
            checked={composer}
            onChange={(e) => {
              setComposer(e.target.checked);
              if (!e.target.checked) {
                setComposition([]);
                setSymboleCompose(null);
              }
            }}
          />
          Composer (ET)
        </label>
        {composer && composition.length > 0 && (
          <ul className="space-y-0.5 px-0.5">
            {composition.map((c, i) => (
              <li key={i} className="flex items-baseline gap-1 text-[11px] text-text-dim">
                <span className="min-w-0 break-words">⋀ {decrireAlerte({ condition: c, timeframe: tfCourant })}</span>
                <button
                  type="button"
                  onClick={() => setComposition((cs) => cs.filter((_, j) => j !== i))}
                  className="shrink-0 text-text-dim hover:text-text"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-1.5">
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder={symbolCourant}
            spellCheck={false}
            disabled={composer && composition.length > 0}
            className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1 text-xs text-text outline-none placeholder:text-text-dim focus:border-text-dim disabled:opacity-60"
          />
          <select
            value={type}
            onChange={(e) => setType(e.target.value as TypeAlerte)}
            className="max-w-[42%] rounded border border-border bg-bg px-1 py-1 text-xs text-text outline-none focus:border-text-dim"
          >
            <option value="prix-croise">Prix</option>
            <option value="variation-pct">Var %</option>
            <option value="indicateur-seuil">Indicateur</option>
            <option value="indicateur-croisement">Croisement</option>
            <option value="funding-extreme" disabled={titrePerp !== null} title={titrePerp ?? undefined}>Funding</option>
            <option value="cvd-spot-perp-div" disabled={titrePerp !== null} title={titrePerp ?? undefined}>CVD S/P</option>
            <option value="liq-cascade" disabled={titrePerp !== null} title={titrePerp ?? undefined}>Cascade liq</option>
            <option value="regime-seuil">Régime</option>
            <option value="onchain-seuil">On-chain</option>
            <option value="whale-flux">Baleines</option>
          </select>
        </div>

        {type === "prix-croise" && (
          <div className="flex gap-1.5">
            <input
              value={niveau}
              onChange={(e) => setNiveau(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && soumettre()}
              inputMode="decimal"
              placeholder="Niveau"
              className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1 text-xs tabular-nums text-text outline-none placeholder:text-text-dim focus:border-text-dim"
            />
            <select
              value={sens}
              onChange={(e) => setSens(e.target.value as SensCroisement)}
              className="rounded border border-border bg-bg px-1 py-1 text-xs text-text outline-none focus:border-text-dim"
            >
              <option value="hausse">↑ hausse</option>
              <option value="baisse">↓ baisse</option>
              <option value="les-deux">↕ les deux</option>
            </select>
          </div>
        )}

        {type === "variation-pct" && (
          <div className="flex gap-1.5">
            <input
              value={seuilPct}
              onChange={(e) => setSeuilPct(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && soumettre()}
              inputMode="decimal"
              placeholder="Seuil % (± signé)"
              className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1 text-xs tabular-nums text-text outline-none placeholder:text-text-dim focus:border-text-dim"
            />
            <select
              value={fenetreMs}
              onChange={(e) => setFenetreMs(Number(e.target.value))}
              className="rounded border border-border bg-bg px-1 py-1 text-xs text-text outline-none focus:border-text-dim"
            >
              {FENETRES.map((f) => (
                <option key={f.ms} value={f.ms}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {type === "indicateur-seuil" && (
          <div className="space-y-1.5">
            <select
              value={indicateurId}
              onChange={(e) => onChangeIndicateur(e.target.value)}
              aria-label="Indicateur de l'alerte"
              className="w-full rounded border border-border bg-bg px-1 py-1 text-xs text-text outline-none focus:border-text-dim"
            >
              {INDICATEURS_SEUIL.map((d) => (
                <option key={d.id} value={d.id} disabled={!supportsIndicatorTimeframe(d.id, tfCourant)}>
                  {d.name}{supportsIndicatorTimeframe(d.id, tfCourant) ? "" : ` · ${TIMEFRAME_REQUIS[d.id] ?? "1h"} requis`}
                </option>
              ))}
            </select>
            {/* Sur sa propre ligne : les sorties portent leur nom, pas leur clé. */}
            <select
              value={sortieCle}
              onChange={(e) => setSortieCle(e.target.value)}
              aria-label="Sortie de l'indicateur"
              className="w-full rounded border border-border bg-bg px-1 py-1 text-xs text-text outline-none focus:border-text-dim"
            >
              {sortiesDispo.map((s) => (
                <option key={s.cle} value={s.cle}>
                  {s.libelle}
                </option>
              ))}
            </select>
            {/* Une sortie nommée porte son comparateur et sa valeur : rien à deviner, rien à saisir. */}
            {sortieChoisie?.prereglage === undefined && (
              <div className="flex gap-1.5">
                <select
                  value={comparateur}
                  onChange={(e) => setComparateur(e.target.value as Comparateur)}
                  aria-label="Comparateur"
                  className="rounded border border-border bg-bg px-1 py-1 text-xs text-text outline-none focus:border-text-dim"
                >
                  {COMPARATEURS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <input
                  value={valeurInd}
                  onChange={(e) => setValeurInd(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && soumettre()}
                  inputMode="decimal"
                  placeholder="Seuil (ex. 70)"
                  className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1 text-xs tabular-nums text-text outline-none placeholder:text-text-dim focus:border-text-dim"
                />
              </div>
            )}
            <div data-note-alerte className="space-y-0.5 px-0.5 text-[10px] text-text-dim">
              {noteAlerteSeuil(conditionSeuil, sortieChoisie, { symbol: symboleCible, source: exchangeCourant, timeframe: tfCourant }, { daemonAlertes, indicateursAffiches }).map((ligne) => (
                <p key={ligne} className={ligne.startsWith("Libellé : ") ? "break-words text-text" : "break-words"}>{ligne}</p>
              ))}
            </div>
          </div>
        )}

        {type === "indicateur-croisement" && (
          <div className="space-y-1.5">
            <select
              value={indicateurCroise}
              onChange={(e) => onChangeIndicateurCroise(e.target.value)}
              className="w-full rounded border border-border bg-bg px-1 py-1 text-xs text-text outline-none focus:border-text-dim"
            >
              {INDICATEURS_CROISEMENT.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-1.5">
              <select
                value={outputA}
                onChange={(e) => setOutputA(e.target.value)}
                className="min-w-0 flex-1 rounded border border-border bg-bg px-1 py-1 text-xs text-text outline-none focus:border-text-dim"
              >
                {outputsCroisement.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.key}
                  </option>
                ))}
              </select>
              <span aria-hidden className="shrink-0 text-[10px] text-text-dim">
                ×
              </span>
              <select
                value={outputB}
                onChange={(e) => setOutputB(e.target.value)}
                className="min-w-0 flex-1 rounded border border-border bg-bg px-1 py-1 text-xs text-text outline-none focus:border-text-dim"
              >
                {outputsCroisement.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.key}
                  </option>
                ))}
              </select>
            </div>
            <select
              value={sensCroisement}
              onChange={(e) => setSensCroisement(e.target.value as SensCroisement)}
              className="w-full rounded border border-border bg-bg px-1 py-1 text-xs text-text outline-none focus:border-text-dim"
            >
              <option value="hausse">↑ A croise B à la hausse</option>
              <option value="baisse">↓ A croise B à la baisse</option>
              <option value="les-deux">↕ les deux</option>
            </select>
            <p className="px-0.5 text-[10px] text-text-dim">
              Évalué à la clôture de bougie {tfCourant} (TF figé à la création). Onglet
              fermé, le daemon ne couvre que la minute.
            </p>
          </div>
        )}

        {type === "funding-extreme" && (
          <div className="space-y-1.5">
            <select
              value={sensFunding}
              onChange={(e) => setSensFunding(e.target.value as SensFunding)}
              className="w-full rounded border border-border bg-bg px-1 py-1 text-xs text-text outline-none focus:border-text-dim"
            >
              <option value="les-deux">↕ long/short crowded</option>
              <option value="long-crowded">Long crowded (rate +)</option>
              <option value="short-crowded">Short crowded (rate −)</option>
            </select>
            <div className="flex gap-1.5">
              <input
                value={seuilAbsPct}
                onChange={(e) => setSeuilAbsPct(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && soumettre()}
                inputMode="decimal"
                placeholder="|rate| % (ex. 0.1)"
                title="Seuil absolu du funding en pourcent (0.1 = 0.1 %)"
                className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1 text-xs tabular-nums text-text outline-none placeholder:text-text-dim focus:border-text-dim"
              />
              <input
                value={zSeuil}
                onChange={(e) => setZSeuil(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && soumettre()}
                inputMode="decimal"
                placeholder="|z|"
                title="Seuil |z-score| (défaut 2)"
                className="w-16 rounded border border-border bg-bg px-2 py-1 text-xs tabular-nums text-text outline-none placeholder:text-text-dim focus:border-text-dim"
              />
            </div>
            <p className="px-0.5 text-[10px] text-text-dim">
              Extrême si |rate| ou |z| dépasse le seuil (onglet ouvert).
            </p>
          </div>
        )}

        {type === "cvd-spot-perp-div" && (
          <div className="space-y-1.5">
            <select
              value={kindCvd}
              onChange={(e) => setKindCvd(e.target.value as KindCvd)}
              className="w-full rounded border border-border bg-bg px-1 py-1 text-xs text-text outline-none focus:border-text-dim"
            >
              <option value="les-deux">Toute divergence S/P</option>
              <option value="spotUp_perpDown">Spot↑ Perp↓ (cash mène)</option>
              <option value="spotDown_perpUp">Spot↓ Perp↑ (levier mène)</option>
            </select>
            <p className="px-0.5 text-[10px] text-text-dim">
              Active orderflow + CVD S/P (Binance). App ouverte uniquement.
            </p>
          </div>
        )}

        {type === "liq-cascade" && (
          <div className="space-y-1.5">
            <input
              value={seuilCascade}
              onChange={(e) => setSeuilCascade(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && soumettre()}
              inputMode="numeric"
              placeholder="Seuil $/min (ex. 5000000)"
              title="Notionnel liquidé par minute glissante (USD/min, tous côtés)"
              className="w-full rounded border border-border bg-bg px-2 py-1 text-xs tabular-nums text-text outline-none placeholder:text-text-dim focus:border-text-dim"
            />
            <p className="px-0.5 text-[10px] text-text-dim">
              Front : symbole affiché, flux liq actif (heatmap ou fenêtre LIQ ouverte).
              Daemon onglet fermé : tous les symboles d&apos;alerte (tick 10 s, nouveau
              symbole ingéré en ≤60 s).
            </p>
          </div>
        )}

        {type === "regime-seuil" && (
          <div className="space-y-1.5">
            <div className="flex gap-1.5">
              <select
                value={comparateurRegime}
                onChange={(e) => setComparateurRegime(e.target.value as Comparateur)}
                className="rounded border border-border bg-bg px-1 py-1 text-xs text-text outline-none focus:border-text-dim"
              >
                {COMPARATEURS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input
                value={valeurRegime}
                onChange={(e) => setValeurRegime(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && soumettre()}
                inputMode="decimal"
                placeholder="Score (−2 à +2)"
                title="Score de régime composite, borné −2..+2"
                className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1 text-xs tabular-nums text-text outline-none placeholder:text-text-dim focus:border-text-dim"
              />
            </div>
            <p className="px-0.5 text-[10px] text-text-dim">
              Alerte globale (score BRIEF −2..+2). App ouverte uniquement.
            </p>
          </div>
        )}

        {type === "onchain-seuil" && (
          <div className="space-y-1.5">
            <div className="flex gap-1.5">
              <select
                value={metriqueOnchain}
                onChange={(e) => setMetriqueOnchain(e.target.value as MetriqueOnchainAlerte)}
                title="Métrique on-chain quotidienne (fenêtre CHAIN)"
                className="min-w-0 flex-1 rounded border border-border bg-bg px-1 py-1 text-xs text-text outline-none focus:border-text-dim"
              >
                {METRIQUES_ONCHAIN_ALERTE.map((m) => (
                  <option key={m} value={m}>
                    {LIBELLES_METRIQUE_ONCHAIN[m]}
                  </option>
                ))}
              </select>
              <select
                value={comparateurOnchain}
                onChange={(e) => setComparateurOnchain(e.target.value as Comparateur)}
                className="rounded border border-border bg-bg px-1 py-1 text-xs text-text outline-none focus:border-text-dim"
              >
                {COMPARATEURS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input
                value={valeurOnchain}
                onChange={(e) => setValeurOnchain(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && soumettre()}
                inputMode="decimal"
                placeholder="Seuil"
                title="Seuil dans l'unité de la métrique (ex. MVRV-Z 7, hashprice 35 $/PH/j, frais 50 sat/vB)"
                className="w-24 rounded border border-border bg-bg px-2 py-1 text-xs tabular-nums text-text outline-none placeholder:text-text-dim focus:border-text-dim"
              />
            </div>
            <p className="px-0.5 text-[10px] text-text-dim">
              Alerte globale sur une métrique quotidienne (caches CHAIN, évaluation toutes les
              15 min). App ouverte uniquement ; MVRV-Z / SOPR / NUPL soumis au quota BGeometrics.
            </p>
          </div>
        )}

        {type === "whale-flux" && (
          <div className="space-y-1.5">
            {IS_VERCEL && (
              <Unusable raison="Les alertes Baleines dépendent du collecteur local axiomd, indisponible sur Vercel." />
            )}
            <div className="flex gap-1.5">
              <select
                value={actifWhale}
                onChange={(e) => setActifWhale(e.target.value)}
                title="Actif surveillé (couverture du collecteur : BTC natif + stables ERC-20)"
                className="rounded border border-border bg-bg px-1 py-1 text-xs text-text outline-none focus:border-text-dim"
              >
                {ACTIFS_WHALE.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              <input
                value={seuilWhale}
                onChange={(e) => setSeuilWhale(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && soumettre()}
                inputMode="numeric"
                placeholder="Seuil $ (ex. 10000000)"
                title="Notionnel d'UN transfert on-chain (USD)"
                className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1 text-xs tabular-nums text-text outline-none placeholder:text-text-dim focus:border-text-dim"
              />
              <select
                value={directionWhale}
                onChange={(e) => setDirectionWhale(e.target.value as DirectionAlerteWhale)}
                title="Filtre de direction (étiquetage heuristique — liste curée d'adresses exchange)"
                className="rounded border border-border bg-bg px-1 py-1 text-xs text-text outline-none focus:border-text-dim"
              >
                <option value="tous">↕ toutes</option>
                <option value="depot">→ dépôt</option>
                <option value="retrait">← retrait</option>
              </select>
            </div>
            <p className="px-0.5 text-[10px] text-text-dim">
              Évaluée par le daemon uniquement (collecteur whales, tick 30 s, fenêtre 10 min)
              — notification onglet fermé comprise. Fenêtre WHALES pour le fil.
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={soumettre}
          disabled={IS_VERCEL && type === "whale-flux"}
          className="w-full rounded border border-border bg-bg px-2 py-1 text-xs text-text-dim transition hover:border-text-dim hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
        >
          {composer
            ? `+ Ajouter à la composition (${composition.length}/4)`
            : type === "regime-seuil"
              ? "Ajouter (régime global)"
              : type === "onchain-seuil"
                ? "Ajouter (on-chain global)"
              : type === "whale-flux"
                ? `Ajouter (baleines ${actifWhale})`
                : `Ajouter sur ${symboleEffectif}`}
        </button>
        {composer && (
          <button
            type="button"
            onClick={() => {
              if (!validerComposite(composition)) {
                setErreurForm("2 à 4 sous-conditions requises.");
                return;
              }
              if (!conditionSupporteTimeframe({ type: "composite", conditions: composition }, marketStore.getState().timeframe)) {
                setErreurForm("RVOL saisonnier : choisir l’intervalle 1h avant de créer la composition.");
                return;
              }
              // Le graphe a pu passer sur une série depuis l'ajout d'une sous-condition perp.
              const refusCompose = refusAlertePerp(composition.map((c) => c.type), marketStore.getState().exchange, symboleCible);
              if (refusCompose !== null) {
                setErreurForm(refusCompose);
                return;
              }
              const aUneBougie = composition.some((c) =>
                c.type === "variation-pct" || c.type === "indicateur-seuil" || c.type === "indicateur-croisement",
              );
              alertsStore.getState().ajouter({
                symbol: symboleCible,
                source: marketStore.getState().exchange,
                condition: { type: "composite", conditions: [...composition] },
                ...(aUneBougie ? { timeframe: marketStore.getState().timeframe } : {}),
                ...(dureeAlerteMs > 0 ? { expireTs: Date.now() + dureeAlerteMs } : {}),
              });
              setComposition([]);
              setSymboleCompose(null);
              setErreurForm(null);
            }}
            disabled={composition.length < 2}
            className="w-full rounded border border-border bg-bg px-2 py-1 text-xs text-text-dim transition hover:border-text-dim hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
          >
            Créer l'alerte composée ({composition.length}/4)
          </button>
        )}
        {erreurForm !== null && <p className="text-[10px] text-down">{erreurForm}</p>}
      </div>

      {/* Journal repliable */}
      <div className="border-t border-border">
        <button
          type="button"
          onClick={() => setJournalOuvert((o) => !o)}
          className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[11px] text-text-dim transition hover:text-text"
        >
          <span aria-hidden className="w-2 text-[9px] leading-none">
            {journalOuvert ? "▾" : "▸"}
          </span>
          Journal ({journal.length})
        </button>
        {journalOuvert && (
          <div className="max-h-40 overflow-y-auto px-3 pb-2">
            {journal.length === 0 ? (
              <Vide>Aucun déclenchement.</Vide>
            ) : (
              journal.map((d, i) => {
                // La def peut avoir été supprimée depuis, ou ne désigner aucun marché (baleines) :
                // sans cible, pas de navigation.
                const preuve = d.preuve?.origine;
                const cible = preuve?.symbol && preuve.source
                  ? { symbol: preuve.symbol, source: preuve.source, ...(preuve.timeframe ? { timeframe: preuve.timeframe } : {}) }
                  : cibleAlerte(defs, d.alertId);
                // Marque : la bougie évaluée quand le déclenchement vient d'une clôture, sinon son instant.
                const tempsMarque = d.preuve?.contexte.derniereBougie?.time ?? d.ts;
                const contenu = (
                  <>
                    <span className="min-w-0 break-words text-text-dim">{d.message}{d.instantane ? ` · ${d.valeur.toLocaleString("fr-FR")} ${d.instantane.unite} · obs. ${new Date(d.instantane.observeLe).toISOString().slice(0, 10)} · ${d.instantane.source}` : ""}</span>
                    <span className="shrink-0 tabular-nums text-text-dim">{formatHeure(d.ts)}</span>
                  </>
                );
                const classes = "flex w-full items-baseline justify-between gap-2 py-0.5 text-left text-[11px]";
                return <div key={`${d.alertId}-${d.ts}-${i}`} data-journal-alerte className="flex items-center gap-1">
                  {cible === null ? <div className={`${classes} min-w-0 flex-1`}>{contenu}</div> : <button
                    type="button"
                    onClick={() => void voirAlerte(cible, tempsMarque)}
                    title="Marquer sur la vue principale"
                    className={`${classes} min-w-0 flex-1 transition hover:bg-bg`}
                  >{contenu}</button>}
                  <button type="button" title="Créer un dossier de décision dans EXPY" className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-text-dim hover:text-text" onClick={() => {
                    decisionDossiersStore.getState().creerDepuisJournal(d);
                    windowManagerStore.getState().openWindow("expy");
                  }}>Dossier</button>
                </div>;
              })
            )}
          </div>
        )}
      </div>
    </SidebarSection>

    {/* Alertes de scan (EQS) : présente seulement s'il en existe (créées depuis le screener). */}
    {alertesScan.length > 0 && (
      <SidebarSection
        title="Alertes de scan"
        collapsible
        defaultOpen={false}
        badge={`${alertesScan.length}`}
      >
        <div className="max-h-64 overflow-y-auto">
          {alertesScan.map((a) => (
            <div
              key={a.id}
              className="group flex items-center gap-2 border-l-2 border-transparent px-3 py-1.5 text-[11px] hover:bg-surface"
            >
              <button
                type="button"
                onClick={() => basculerScan(a.id)}
                title={a.actif ? "Mettre en pause" : "Reprendre"}
                  className={`shrink-0 text-[9px] leading-none ${etatScan(a, maintenant).classePastille}`}
              >
                ●
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium text-text">{a.nom}</span>
                  <span className="shrink-0 text-[10px] tabular-nums text-text-dim">
                    toutes les {a.periodeMin} min
                  </span>
                </div>
                <div className={`truncate text-[10px] ${etatScan(a, maintenant).classeTexte}`} title={etatScan(a, maintenant).texte}>
                  {etatScan(a, maintenant).texte}
                </div>
                {a.expireTs !== undefined && <div className="text-[10px] tabular-nums text-text-dim">Échéance {new Date(a.expireTs).toLocaleString("fr-CH", { dateStyle: "short", timeStyle: "short" })}</div>}
              </div>
              {a.expireTs !== undefined && (
                <button type="button" onClick={() => prolongerScan(a)} aria-label={`Prolonger l'alerte de scan ${a.nom} de 24 h`}
                  className="shrink-0 text-[10px] text-text-dim hover:text-text">+24 h</button>
              )}
              <button
                type="button"
                onClick={() => presetAlertsStore.getState().retirer(a.id)}
                aria-label={`Supprimer l'alerte de scan ${a.nom}`}
                className="axiom-action-tactile shrink-0 text-text-dim opacity-0 transition hover:text-down group-hover:opacity-100 focus-visible:opacity-100"
              >
                ×
              </button>
            </div>
          ))}
          {msgScan !== null && <p className="px-3 py-1 text-[10px] text-warn">{msgScan}</p>}
        </div>
      </SidebarSection>
    )}
    </>
  );
}
