/**
 * AlertsPanel — section latérale des alertes (pattern SidebarSection).
 *
 * Liste dense des alertes (état actif, armement, dernière exécution, libellé de la
 * condition), création simple (symbole prérempli = actif courant ; type prix/variation),
 * suppression, bascule actif/inactif, et journal repliable des déclenchements.
 *
 * Ce composant se re-rend uniquement sur ÉVÉNEMENT (création, bascule, déclenchement) :
 * aucune donnée haute fréquence n'y transite (le runtime écrit le store hors render-loop).
 *
 * NON MONTÉ pour l'instant : un agent ultérieur l'intègrera à App.tsx et câblera
 * `demarrerAlertes()` + `demanderPermissionNotifications()` (cf. alerts/runtime.ts).
 */
import { useState } from "react";
import { useStore } from "zustand";
import { decrireCondition, type Condition, type SensCroisement } from "@axiom/alerts";
import { marketStore } from "../store/market";
import { alertsStore } from "../store/alerts";
import { demanderPermissionNotifications } from "../alerts/runtime";
import { SidebarSection } from "./SidebarSection";

/** Types d'alerte proposés à la création (les conditions d'indicateur restent programmatiques). */
type TypeAlerte = "prix-croise" | "variation-pct";

/** Fenêtres proposées pour la variation en %. */
const FENETRES: Array<{ label: string; ms: number }> = [
  { label: "1 min", ms: 60_000 },
  { label: "5 min", ms: 300_000 },
  { label: "15 min", ms: 900_000 },
  { label: "1 h", ms: 3_600_000 },
];

/** Heure locale HH:MM:SS d'un horodatage ms (— si absent). */
function formatHeure(ts: number | undefined): string {
  if (ts === undefined) return "—";
  return new Date(ts).toLocaleTimeString("fr-FR", { hour12: false });
}

/** Libellé + couleur de l'état d'armement d'une alerte. */
function etatArmement(arme: boolean | undefined): { texte: string; classe: string } {
  if (arme === undefined) return { texte: "calibrage", classe: "text-neutral-500" };
  if (arme) return { texte: "armée", classe: "text-emerald-400" };
  return { texte: "déclenchée", classe: "text-amber-400" };
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
  const [journalOuvert, setJournalOuvert] = useState(false);

  const symboleEffectif = (symbol.trim() || symbolCourant).toUpperCase();

  const soumettre = () => {
    let condition: Condition;
    if (type === "prix-croise") {
      const n = Number(niveau);
      if (!Number.isFinite(n)) return; // niveau requis
      condition = { type: "prix-croise", niveau: n, sens };
    } else {
      const s = Number(seuilPct);
      if (!Number.isFinite(s) || s === 0) return; // seuil non nul requis
      condition = { type: "variation-pct", seuilPct: s, fenetreMs };
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
          className="text-[10px] text-neutral-500 transition hover:text-neutral-300"
        >
          Notifs
        </button>
      }
    >
      {/* Liste des alertes */}
      <div className="max-h-64 overflow-y-auto">
        {defs.length === 0 && (
          <p className="px-3 py-3 text-[11px] text-neutral-600">
            Aucune alerte. Créez-en une ci-dessous.
          </p>
        )}
        {defs.map((d) => {
          const arm = etatArmement(d.arme);
          const derniere = d.declenchements[d.declenchements.length - 1];
          return (
            <div
              key={d.id}
              className="group flex items-center gap-2 border-l-2 border-transparent px-3 py-1.5 text-sm hover:bg-neutral-900"
            >
              <button
                type="button"
                onClick={() => alertsStore.getState().basculerActif(d.id)}
                title={d.actif ? "Désactiver" : "Activer"}
                className={`shrink-0 text-[9px] leading-none ${d.actif ? "text-emerald-400" : "text-neutral-600"}`}
              >
                ●
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium text-neutral-200">{d.symbol}</span>
                  <span className={`shrink-0 text-[10px] ${arm.classe}`}>{arm.texte}</span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[11px] text-neutral-500">
                    {decrireCondition(d.condition)}
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums text-neutral-600">
                    {formatHeure(derniere)}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => alertsStore.getState().supprimer(d.id)}
                aria-label={`Supprimer l'alerte ${d.symbol}`}
                className="shrink-0 text-neutral-600 opacity-0 transition hover:text-neutral-300 group-hover:opacity-100"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      {/* Formulaire de création */}
      <div className="space-y-1.5 border-t border-neutral-800 p-2">
        <div className="flex gap-1.5">
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder={symbolCourant}
            spellCheck={false}
            className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-neutral-500"
          />
          <select
            value={type}
            onChange={(e) => setType(e.target.value as TypeAlerte)}
            className="rounded border border-neutral-700 bg-neutral-900 px-1 py-1 text-xs text-neutral-100 outline-none focus:border-neutral-500"
          >
            <option value="prix-croise">Prix</option>
            <option value="variation-pct">Variation %</option>
          </select>
        </div>

        {type === "prix-croise" ? (
          <div className="flex gap-1.5">
            <input
              value={niveau}
              onChange={(e) => setNiveau(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && soumettre()}
              inputMode="decimal"
              placeholder="Niveau"
              className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs tabular-nums text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-neutral-500"
            />
            <select
              value={sens}
              onChange={(e) => setSens(e.target.value as SensCroisement)}
              className="rounded border border-neutral-700 bg-neutral-900 px-1 py-1 text-xs text-neutral-100 outline-none focus:border-neutral-500"
            >
              <option value="hausse">↑ hausse</option>
              <option value="baisse">↓ baisse</option>
              <option value="les-deux">↕ les deux</option>
            </select>
          </div>
        ) : (
          <div className="flex gap-1.5">
            <input
              value={seuilPct}
              onChange={(e) => setSeuilPct(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && soumettre()}
              inputMode="decimal"
              placeholder="Seuil % (± signé)"
              className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs tabular-nums text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-neutral-500"
            />
            <select
              value={fenetreMs}
              onChange={(e) => setFenetreMs(Number(e.target.value))}
              className="rounded border border-neutral-700 bg-neutral-900 px-1 py-1 text-xs text-neutral-100 outline-none focus:border-neutral-500"
            >
              {FENETRES.map((f) => (
                <option key={f.ms} value={f.ms}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <button
          type="button"
          onClick={soumettre}
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 transition hover:border-neutral-500 hover:text-neutral-100"
        >
          Ajouter sur {symboleEffectif}
        </button>
      </div>

      {/* Journal repliable */}
      <div className="border-t border-neutral-800">
        <button
          type="button"
          onClick={() => setJournalOuvert((o) => !o)}
          className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[11px] text-neutral-500 transition hover:text-neutral-300"
        >
          <span aria-hidden className="w-2 text-[9px] leading-none">
            {journalOuvert ? "▼" : "▶"}
          </span>
          Journal ({journal.length})
        </button>
        {journalOuvert && (
          <div className="max-h-40 overflow-y-auto px-3 pb-2">
            {journal.length === 0 ? (
              <p className="py-1 text-[11px] text-neutral-600">Aucun déclenchement.</p>
            ) : (
              journal.map((d, i) => (
                <div
                  key={`${d.alertId}-${d.ts}-${i}`}
                  className="flex items-baseline justify-between gap-2 py-0.5 text-[11px]"
                >
                  <span className="truncate text-neutral-400">{d.message}</span>
                  <span className="shrink-0 tabular-nums text-neutral-600">{formatHeure(d.ts)}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </SidebarSection>
  );
}
