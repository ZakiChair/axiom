/** Vue légère de la stabilité du coût L2, calculée hors React par le collecteur partagé. */
import { useState } from "react";
import { useStore } from "zustand";
import type { FenetreStabilite, VueStabiliteCarnet, VueStabiliteCote } from "../../data/depthStability";
import { microstructureDiagnosticStore } from "../../store/microstructure-diagnostic";

const FENETRES: readonly FenetreStabilite[] = [1, 5, 15];
const bps = (valeur: number | null): string => valeur === null ? "—" : `${valeur.toFixed(1)} bps`;
const pourcentage = (fraction: number): string => `${Math.round(fraction * 100)} %`;

function LigneCote({ nom, cote }: { nom: string; cote: VueStabiliteCote }) {
  return <div className="flex flex-wrap gap-x-3 tabular-nums">
    <span className="font-medium text-text">{nom}</span>
    <span>courant {bps(cote.courantBps)}</span>
    <span>médiane {bps(cote.medianeBps)}</span>
    <span>p95 {bps(cote.p95Bps)}</span>
    <span>n={cote.creneauxCouverts} créneaux valides</span>
    <span>{cote.versionsDistinctes} version{cote.versionsDistinctes === 1 ? "" : "s"} distincte{cote.versionsDistinctes === 1 ? "" : "s"}</span>
    <span>couv. {pourcentage(cote.couverture)} durée / {pourcentage(cote.couvertureFenetre)} fenêtre</span>
    <span>carnet insuffisant {cote.insuffisants} ({pourcentage(cote.proportionInsuffisante)})</span>
  </div>;
}

export function DepthStabilityPanel({
  symbole, cotation, notionnelCotation, vue, onNotionnelChange,
}: {
  symbole: string;
  cotation: string | null;
  notionnelCotation: number;
  vue: VueStabiliteCarnet | null;
  onNotionnelChange: (notionnel: number) => void;
}) {
  const [minutes, setMinutes] = useState<FenetreStabilite>(1);
  if (cotation === null) return <section data-testid="depth-stability" aria-label="Stabilité du coût du carnet" className="border-b border-border bg-bg px-3 py-2 text-[10px] text-text-dim">
    <span className="font-medium text-text">Liquidité L2 · {symbole}</span> · Devise de cotation indisponible ; aucun coût calculé.
  </section>;
  const f = vue?.fenetres[minutes];
  return <section data-testid="depth-stability" aria-label="Stabilité du coût du carnet" className="space-y-1 border-b border-border bg-bg px-3 py-2 text-[10px] text-text-dim">
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-medium text-text">Liquidité L2 · {symbole}</span>
      <label>Montant cible <input aria-label={`Montant cible de liquidité en ${cotation}`} type="number" min="0.000001" max="10000000" step="0.000001"
        value={notionnelCotation} onChange={(e) => onNotionnelChange(Number(e.target.value))}
        className="w-28 rounded border border-border bg-surface px-1 tabular-nums text-text" /> {cotation}</label>
      <div role="group" aria-label="Fenêtre de stabilité" className="flex gap-1">
        {FENETRES.map((n) => <button key={n} type="button" aria-pressed={minutes === n} onClick={() => setMinutes(n)}
          className="rounded border border-border px-1.5 py-0.5">{n} min</button>)}
      </div>
    </div>
    {f ? <>
      <div className="tabular-nums">
        {Math.floor(f.dureeMs / 1_000)} s observée{f.dureeMs >= 2_000 ? "s" : ""} / {minutes} min ·
        {" "}{pourcentage(f.achat.couverture)} de la durée · {pourcentage(f.achat.couvertureFenetre)} de la fenêtre ·
        {" "}{f.achat.creneauxCouverts}/{f.attendus} créneaux achat couverts · {f.invalides} carnets invalides ·
        {" "}âge {vue?.ageMs === null ? "indisponible" : `${((vue?.ageMs ?? 0) / 1_000).toFixed(1)} s`}
      </div>
      <LigneCote nom="Achat" cote={f.achat} />
      <LigneCote nom="Vente" cote={f.vente} />
    </> : <div>Synchronisation du carnet ; aucune durée observée.</div>}
    <p>Binance spot · montant en {cotation}, sans conversion · carnet reçu · échantillonnage 1 s · quantiles après 20 créneaux valides · hors frais. Mesures descriptives sur niveaux visibles ; aucune garantie d'exécution future.</p>
  </section>;
}

/** Abonnement limité à la section lente ; le canvas DOM ne reçoit aucun render L2. */
export function PanneauStabiliteCarnet() {
  const vue = useStore(microstructureDiagnosticStore, (s) => s.vue);
  const notionnelCotation = useStore(microstructureDiagnosticStore, (s) => s.notionnelLiquidite);
  const setNotionnelLiquidite = useStore(microstructureDiagnosticStore, (s) => s.setNotionnelLiquidite);
  return <DepthStabilityPanel symbole={vue.symbole} cotation={vue.cotation} notionnelCotation={notionnelCotation} vue={vue.stabilite} onNotionnelChange={setNotionnelLiquidite} />;
}
