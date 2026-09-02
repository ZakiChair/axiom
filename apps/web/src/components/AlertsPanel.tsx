/**
 * AlertsPanel — section latérale des alertes (pattern SidebarSection).
 *
 * Liste dense des alertes (état actif, armement, dernière exécution, libellé de la
 * condition), création (symbole prérempli = actif courant ; types prix / var% /
 * indicateur-seuil / indicateur-croisement / funding-extreme / cascade liq / score de
 * régime), suppression, bascule actif/inactif, et journal repliable des déclenchements.
 * Un clic sur une alerte (ou sur une ligne de journal) navigue le chart maître vers son
 * symbole (pattern `navigateTo`, cf. SqueezeWindow).
 *
 * Ce composant se re-rend uniquement sur ÉVÉNEMENT (création, bascule, déclenchement) :
 * aucune donnée haute fréquence n'y transite (le runtime écrit le store hors render-loop).
 *
 * CVD spot/perp-div : moteur + runtime (pont orderflow) + création UI.
 */
import { useMemo, useState } from "react";
import { useStore } from "zustand";
import {
  decrireCondition,
  validerComposite,
  type Comparateur,
  type Condition,
  type ConditionSimple,
  type SensCroisement,
} from "@axiom/alerts";
import { INDICATORS, getIndicator } from "@axiom/indicators";
import { marketStore } from "../store/market";
import { alertsStore } from "../store/alerts";
import { presetAlertsStore, type AlertePreset } from "../store/presetAlerts";
import { demanderPermissionNotifications } from "../alerts/runtime";
import { IS_VERCEL } from "../lib/deployment";
import { formatHeure } from "../lib/format";
import { navigateTo } from "../lib/navigation";
import {
  cibleAlerte,
  construireConditionCroisement,
  INDICATEURS_CROISEMENT,
} from "./alertsPanel.util";
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
 * Indicateurs utilisables pour `indicateur-seuil` : calculables sur bougies seules
 * (pas de série aux `oi`/`funding`/on-chain — le runtime n'injecte pas d'aux).
 */
const INDICATEURS_SEUIL = INDICATORS.filter((d) => !d.aux || d.aux.length === 0);

/** Libellé + couleur de l'état d'armement d'une alerte. */
function etatArmement(arme: boolean | undefined): { texte: string; classe: string } {
  if (arme === undefined) return { texte: "calibrage", classe: "text-text-dim" };
  if (arme) return { texte: "armée", classe: "text-up" };
  return { texte: "déclenchée", classe: "text-serie-3" };
}

/**
 * État du dernier scan d'une alerte de preset : pastille + libellé. Un échec avalé ne
 * doit PAS rester vert (le scan est front-only, sans relais daemon).
 */
function etatScan(a: AlertePreset): { classePastille: string; classeTexte: string; texte: string } {
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
  return { classePastille: "text-up", classeTexte: "text-text-dim", texte: `scan ${formatHeure(a.dernierScanTs)}` };
}

export function AlertsPanel() {
  const defs = useStore(alertsStore, (s) => s.defs);
  const journal = useStore(alertsStore, (s) => s.journal);
  const symbolCourant = useStore(marketStore, (s) => s.symbol);
  const tfCourant = useStore(marketStore, (s) => s.timeframe);
  // Alertes de scan (EQS) : liste réactive + message discret sur refus de reprise (limite).
  const alertesScan = useStore(presetAlertsStore, (s) => s.alertes);
  const [msgScan, setMsgScan] = useState<string | null>(null);

  const basculerScan = (id: string) => {
    if (presetAlertsStore.getState().basculer(id) === "limite") {
      setMsgScan("4 alertes de scan max");
      setTimeout(() => setMsgScan(null), 4000);
    }
  };

  // Formulaire de création (état local React).
  const [symbol, setSymbol] = useState("");
  const [type, setType] = useState<TypeAlerte>("prix-croise");
  const [niveau, setNiveau] = useState("");
  const [sens, setSens] = useState<SensCroisement>("hausse");
  const [seuilPct, setSeuilPct] = useState("");
  const [fenetreMs, setFenetreMs] = useState(FENETRES[0]?.ms ?? 60_000);
  // indicateur-seuil
  const [indicateurId, setIndicateurId] = useState(INDICATEURS_SEUIL[0]?.id ?? "rsi");
  const [output, setOutput] = useState(INDICATEURS_SEUIL[0]?.outputs[0]?.key ?? "rsi");
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

  const outputsDispo = useMemo(() => {
    const idef = getIndicator(indicateurId);
    return idef?.outputs ?? [];
  }, [indicateurId]);

  const onChangeIndicateur = (id: string) => {
    setIndicateurId(id);
    const idef = getIndicator(id);
    const firstOut = idef?.outputs[0]?.key;
    if (firstOut) setOutput(firstOut);
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
    if (composer && (type === "whale-flux" || (type === "prix-croise" && sens === "les-deux"))) {
      setErreurForm("Type non composable (whale-flux / prix ↕).");
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
      const v = Number(valeurInd);
      if (!Number.isFinite(v) || !indicateurId || !output) {
        setErreurForm("Indicateur, sortie et valeur requis.");
        return;
      }
      // Params vides → défauts du registry côté moteur.
      condition = {
        type: "indicateur-seuil",
        indicateurId,
        params: {},
        output,
        comparateur,
        valeur: v,
      };
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
      type === "regime-seuil"
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
    alertsStore.getState().ajouter({
      symbol: cible.symbol,
      source: cible.source,
      condition,
      ...(tfDef !== undefined ? { timeframe: tfDef } : {}),
    });
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
          const arm = etatArmement(d.arme);
          const derniere = d.declenchements[d.declenchements.length - 1];
          const whaleUnusable = IS_VERCEL && d.condition.type === "whale-flux";
          return (
            <div
              key={d.id}
              className="group flex items-center gap-2 border-l-2 border-transparent px-3 py-1.5 text-[11px] hover:bg-surface"
            >
              <button
                type="button"
                onClick={() => alertsStore.getState().basculerActif(d.id)}
                title={d.actif ? "Désactiver" : "Activer"}
                className={`shrink-0 text-[9px] leading-none ${d.actif ? "text-up" : "text-text-dim"}`}
              >
                ●
              </button>
              <button
                type="button"
                onClick={() =>
                  navigateTo({ symbol: d.symbol, exchange: d.source, source: "alerte" })
                }
                title="Voir sur le chart"
                className="min-w-0 flex-1 text-left"
              >
                {/* Spans (et non divs) : contenu autorisé dans un <button>. */}
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium text-text">{d.symbol}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {whaleUnusable && <Badge ton="down">UNUSABLE</Badge>}
                    <span className={`text-[10px] ${arm.classe}`}>{arm.texte}</span>
                  </span>
                </span>
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[11px] text-text-dim">
                    {decrireCondition(d.condition)}
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums text-text-dim">
                    {formatHeure(derniere ?? 0)}
                  </span>
                </span>
              </button>
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
                className={`shrink-0 transition ${
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
                <span className="truncate">⋀ {decrireCondition(c)}</span>
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
            <option value="funding-extreme">Funding</option>
            <option value="cvd-spot-perp-div">CVD S/P</option>
            <option value="liq-cascade">Cascade liq</option>
            <option value="regime-seuil">Régime</option>
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
            <div className="flex gap-1.5">
              <select
                value={indicateurId}
                onChange={(e) => onChangeIndicateur(e.target.value)}
                className="min-w-0 flex-1 rounded border border-border bg-bg px-1 py-1 text-xs text-text outline-none focus:border-text-dim"
              >
                {INDICATEURS_SEUIL.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <select
                value={output}
                onChange={(e) => setOutput(e.target.value)}
                className="max-w-[30%] rounded border border-border bg-bg px-1 py-1 text-xs text-text outline-none focus:border-text-dim"
              >
                {outputsDispo.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.key}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-1.5">
              <select
                value={comparateur}
                onChange={(e) => setComparateur(e.target.value as Comparateur)}
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
              const aUneBougie = composition.some((c) =>
                c.type === "variation-pct" || c.type === "indicateur-seuil" || c.type === "indicateur-croisement",
              );
              alertsStore.getState().ajouter({
                symbol: symboleCompose ?? symboleEffectif,
                source: marketStore.getState().exchange,
                condition: { type: "composite", conditions: [...composition] },
                ...(aUneBougie ? { timeframe: marketStore.getState().timeframe } : {}),
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
                // La def peut avoir été supprimée depuis : sans cible, pas de navigation.
                const cible = cibleAlerte(defs, d.alertId);
                const contenu = (
                  <>
                    <span className="truncate text-text-dim">{d.message}</span>
                    <span className="shrink-0 tabular-nums text-text-dim">{formatHeure(d.ts)}</span>
                  </>
                );
                const classes = "flex w-full items-baseline justify-between gap-2 py-0.5 text-left text-[11px]";
                return cible === null ? (
                  <div key={`${d.alertId}-${d.ts}-${i}`} className={classes}>
                    {contenu}
                  </div>
                ) : (
                  <button
                    key={`${d.alertId}-${d.ts}-${i}`}
                    type="button"
                    onClick={() =>
                      navigateTo({
                        symbol: cible.symbol,
                        exchange: cible.source,
                        markTime: d.ts,
                        source: "alerte",
                      })
                    }
                    title="Marquer sur le chart"
                    className={`${classes} transition hover:bg-bg`}
                  >
                    {contenu}
                  </button>
                );
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
                className={`shrink-0 text-[9px] leading-none ${etatScan(a).classePastille}`}
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
                <div className={`truncate text-[10px] ${etatScan(a).classeTexte}`}>
                  {etatScan(a).texte}
                </div>
              </div>
              <button
                type="button"
                onClick={() => presetAlertsStore.getState().retirer(a.id)}
                aria-label={`Supprimer l'alerte de scan ${a.nom}`}
                className="shrink-0 text-text-dim opacity-0 transition hover:text-down group-hover:opacity-100 focus-visible:opacity-100"
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
