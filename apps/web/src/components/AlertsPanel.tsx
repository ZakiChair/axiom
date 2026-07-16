/**
 * AlertsPanel — section latérale des alertes (pattern SidebarSection).
 *
 * Liste dense des alertes (état actif, armement, dernière exécution, libellé de la
 * condition), création (symbole prérempli = actif courant ; types prix / var% /
 * indicateur-seuil / funding-extreme / cascade liq), suppression, bascule
 * actif/inactif, et journal repliable des déclenchements.
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
  type Comparateur,
  type Condition,
  type SensCroisement,
} from "@axiom/alerts";
import { INDICATORS, getIndicator } from "@axiom/indicators";
import { marketStore } from "../store/market";
import { alertsStore } from "../store/alerts";
import { demanderPermissionNotifications } from "../alerts/runtime";
import { formatHeure } from "../lib/format";
import { SidebarSection } from "./SidebarSection";
import { Vide } from "./ui";

/** Types d'alerte proposés à la création. */
type TypeAlerte =
  | "prix-croise"
  | "variation-pct"
  | "indicateur-seuil"
  | "funding-extreme"
  | "cvd-spot-perp-div"
  | "liq-cascade";

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

export function AlertsPanel() {
  const defs = useStore(alertsStore, (s) => s.defs);
  const journal = useStore(alertsStore, (s) => s.journal);
  const symbolCourant = useStore(marketStore, (s) => s.symbol);

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
  // funding-extreme
  const [sensFunding, setSensFunding] = useState<SensFunding>("les-deux");
  const [seuilAbsPct, setSeuilAbsPct] = useState("0.1"); // saisie en % (0.1 = 0.1 %)
  const [zSeuil, setZSeuil] = useState("2");
  // cvd-spot-perp-div
  const [kindCvd, setKindCvd] = useState<KindCvd>("les-deux");
  // liq-cascade : seuil de notionnel liquidé par minute glissante (USD/min).
  const [seuilCascade, setSeuilCascade] = useState("5000000");
  const [journalOuvert, setJournalOuvert] = useState(false);

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

  const soumettre = () => {
    let condition: Condition;
    if (type === "prix-croise") {
      const n = Number(niveau);
      if (!Number.isFinite(n)) return; // niveau requis
      condition = { type: "prix-croise", niveau: n, sens };
    } else if (type === "variation-pct") {
      const s = Number(seuilPct);
      if (!Number.isFinite(s) || s === 0) return; // seuil non nul requis
      condition = { type: "variation-pct", seuilPct: s, fenetreMs };
    } else if (type === "indicateur-seuil") {
      const v = Number(valeurInd);
      if (!Number.isFinite(v) || !indicateurId || !output) return;
      // Params vides → défauts du registry côté moteur.
      condition = {
        type: "indicateur-seuil",
        indicateurId,
        params: {},
        output,
        comparateur,
        valeur: v,
      };
    } else if (type === "funding-extreme") {
      // funding-extreme : seuilAbs en fraction (saisie % → /100) ; z optionnel.
      const absPct = Number(seuilAbsPct);
      const z = Number(zSeuil);
      const hasAbs = Number.isFinite(absPct) && absPct > 0;
      const hasZ = Number.isFinite(z) && z > 0;
      if (!hasAbs && !hasZ) return; // au moins un critère
      condition = {
        type: "funding-extreme",
        sens: sensFunding,
        ...(hasAbs ? { seuilAbs: absPct / 100 } : {}),
        ...(hasZ ? { zSeuil: z } : {}),
      };
    } else if (type === "liq-cascade") {
      // liq-cascade : seuil USD/min strictement positif requis.
      const s = Number(seuilCascade);
      if (!Number.isFinite(s) || s <= 0) return;
      condition = { type: "liq-cascade", seuilUsdParMin: s };
    } else {
      // cvd-spot-perp-div — active le pipeline orderflow via le runtime.
      condition = { type: "cvd-spot-perp-div", kind: kindCvd };
    }
    alertsStore.getState().ajouter({
      symbol: symboleEffectif,
      source: marketStore.getState().exchange,
      condition,
    });
    // Réinitialise les valeurs numériques (on garde type/sens/fenêtre pour un enchaînement rapide).
    setSymbol("");
    setNiveau("");
    setSeuilPct("");
    setValeurInd("");
  };

  const badge = `${defs.length} alerte${defs.length > 1 ? "s" : ""}`;

  return (
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
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium text-text">{d.symbol}</span>
                  <span className={`shrink-0 text-[10px] ${arm.classe}`}>{arm.texte}</span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[11px] text-text-dim">
                    {decrireCondition(d.condition)}
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums text-text-dim">
                    {formatHeure(derniere ?? 0)}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => alertsStore.getState().supprimer(d.id)}
                aria-label={`Supprimer l'alerte ${d.symbol}`}
                className="shrink-0 text-text-dim opacity-0 transition hover:text-text group-hover:opacity-100"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      {/* Formulaire de création */}
      <div className="space-y-1.5 border-t border-border p-2">
        <div className="flex gap-1.5">
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder={symbolCourant}
            spellCheck={false}
            className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1 text-xs text-text outline-none placeholder:text-text-dim focus:border-text-dim"
          />
          <select
            value={type}
            onChange={(e) => setType(e.target.value as TypeAlerte)}
            className="max-w-[42%] rounded border border-border bg-bg px-1 py-1 text-xs text-text outline-none focus:border-text-dim"
          >
            <option value="prix-croise">Prix</option>
            <option value="variation-pct">Var %</option>
            <option value="indicateur-seuil">Indicateur</option>
            <option value="funding-extreme">Funding</option>
            <option value="cvd-spot-perp-div">CVD S/P</option>
            <option value="liq-cascade">Cascade liq</option>
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

        <button
          type="button"
          onClick={soumettre}
          className="w-full rounded border border-border bg-bg px-2 py-1 text-xs text-text-dim transition hover:border-text-dim hover:text-text"
        >
          Ajouter sur {symboleEffectif}
        </button>
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
              journal.map((d, i) => (
                <div
                  key={`${d.alertId}-${d.ts}-${i}`}
                  className="flex items-baseline justify-between gap-2 py-0.5 text-[11px]"
                >
                  <span className="truncate text-text-dim">{d.message}</span>
                  <span className="shrink-0 tabular-nums text-text-dim">{formatHeure(d.ts)}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </SidebarSection>
  );
}
