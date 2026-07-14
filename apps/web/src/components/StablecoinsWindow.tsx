/**
 * Fenêtre « STBL » — analyse des stablecoins (DefiLlama, gratuit, sans clé). NON MODALE.
 *
 * Quatre onglets :
 *   Vue d'ensemble — supply totale + Δ (impression nette), dominance (treemap + table).
 *   Impression    — historique de supply agrégée + barres de mint/burn net quotidien.
 *   Chaînes       — répartition de la supply par blockchain, historique par chaîne.
 *   Pegs          — écarts vs 1,00 $ en bps avec badges (pegs USD uniquement, cf. util).
 *
 * Drill-down : clic sur un émetteur (table Vue d'ensemble, treemap ou Pegs) → fiche
 * émetteur (historique de supply agrégé + répartition par chaîne), bouton retour.
 *
 * Données : data/macro/stablecoinsDetail.ts (fetch direct + cache 5 min). Les calculs
 * vivent dans stablecoinsWindow.util.ts (purs, testés sans DOM).
 */
import { useEffect, useState } from "react";
import { createStore } from "zustand/vanilla";
import { windowManagerStore, mirrorOpenState } from "../store/windowManager";
import {
  chargerEmetteurs,
  chargerHistoriqueAgrege,
  type EmetteurStablecoin,
  type PointSupply,
} from "../data/macro/stablecoinsDetail";
import { calculerDominance, deltaPct, impressionNette } from "./stablecoinsWindow.util";
import { formatUsd, formatPct, formatPourcentage, VALEUR_ABSENTE } from "../lib/format";
import {
  EnTeteFenetre,
  Onglets,
  Metric,
  Chargement,
  ErreurBloc,
  Vide,
  NoteSource,
  BTN_SECONDAIRE,
} from "./ui";

// ─────────────────────────── Store UI (vanilla, éphémère, non persisté) ───────────────────────────

export interface StablecoinsUiState {
  open: boolean;
  openStablecoins: () => void;
  closeStablecoins: () => void;
  toggleStablecoins: () => void;
}

export const stablecoinsUiStore = createStore<StablecoinsUiState>(() => ({
  open: false,
  openStablecoins: () => windowManagerStore.getState().openWindow("stablecoins"),
  closeStablecoins: () => windowManagerStore.getState().closeWindow("stablecoins"),
  toggleStablecoins: () => windowManagerStore.getState().toggleWindow("stablecoins"),
}));

mirrorOpenState("stablecoins", stablecoinsUiStore);

// ─────────────────────────── Formatage local (pur) ───────────────────────────

/** Δ USD signé compact (« +$2.1B » / « −$340M ») — formatUsd gère le compact. */
function fmtDeltaUsd(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return VALEUR_ABSENTE;
  return `${v >= 0 ? "+" : "−"}${formatUsd(Math.abs(v))}`;
}

/** Couleur token pour un delta (up/down, undefined = neutre). */
function couleurDelta(v: number | null): string | undefined {
  if (v === null || v === 0) return undefined;
  return v > 0 ? "var(--up)" : "var(--down)";
}

// ─────────────────────────── Onglets ───────────────────────────

type Onglet = "vue" | "impression" | "chaines" | "pegs";
type Statut = "loading" | "ready" | "error";

const ONGLETS: ReadonlyArray<{ id: Onglet; label: string }> = [
  { id: "vue", label: "Vue d'ensemble" },
  { id: "impression", label: "Impression" },
  { id: "chaines", label: "Chaînes" },
  { id: "pegs", label: "Pegs" },
];

// ─────────────────────────── Vue d'ensemble ───────────────────────────

function VueEnsemble({
  emetteurs,
  historique,
  onSelect,
}: {
  emetteurs: EmetteurStablecoin[];
  historique: PointSupply[];
  onSelect: (id: string) => void;
}) {
  const totalUsd = emetteurs.reduce((s, e) => s + e.mcapUsd, 0);
  const dominance = calculerDominance(emetteurs, 12);
  const d24h = impressionNette(historique, 1);
  const d7j = impressionNette(historique, 7);
  const d30j = impressionNette(historique, 30);
  const partUsdt = dominance.find((p) => p.symbole === "USDT")?.partPct ?? null;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <Metric label="Supply totale" value={formatUsd(totalUsd)} />
        <Metric label="Dominance USDT" value={formatPourcentage(partUsdt)} />
        <Metric label="Δ 24 h" value={fmtDeltaUsd(d24h)} couleur={couleurDelta(d24h)} />
        <Metric label="Δ 7 j" value={fmtDeltaUsd(d7j)} couleur={couleurDelta(d7j)} />
        <Metric label="Δ 30 j" value={fmtDeltaUsd(d30j)} couleur={couleurDelta(d30j)} />
      </div>
      {/* Treemap de dominance — Task 4 */}
      <TableEmetteurs emetteurs={emetteurs} onSelect={onSelect} />
      <NoteSource>Données DefiLlama (stablecoins.llama.fi), rafraîchies ~5 min.</NoteSource>
    </div>
  );
}

/** Table des top émetteurs (mcap, part, Δ7 j, prix, mécanisme). Clic → drill-down. */
function TableEmetteurs({
  emetteurs,
  onSelect,
}: {
  emetteurs: EmetteurStablecoin[];
  onSelect: (id: string) => void;
}) {
  const total = emetteurs.reduce((s, e) => s + e.mcapUsd, 0);
  const tries = [...emetteurs].sort((a, b) => b.mcapUsd - a.mcapUsd).slice(0, 25);
  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="border-b border-border text-left text-text-dim">
          <th className="py-1 pr-2 font-normal">Émetteur</th>
          <th className="py-1 pr-2 text-right font-normal">Supply</th>
          <th className="py-1 pr-2 text-right font-normal">Part</th>
          <th className="py-1 pr-2 text-right font-normal">Δ 7 j</th>
          <th className="py-1 pr-2 text-right font-normal">Prix</th>
          <th className="py-1 font-normal">Mécanisme</th>
        </tr>
      </thead>
      <tbody>
        {tries.map((e) => {
          const d7 = deltaPct(e.mcapUsd, e.mcap7jUsd);
          return (
            <tr
              key={e.id}
              onClick={() => onSelect(e.id)}
              className="cursor-pointer border-b border-border/50 hover:bg-bg"
            >
              <td className="py-1 pr-2 font-medium text-text">{e.symbole}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{formatUsd(e.mcapUsd)}</td>
              <td className="py-1 pr-2 text-right tabular-nums text-text-dim">
                {total > 0 ? formatPourcentage((e.mcapUsd / total) * 100, 1) : VALEUR_ABSENTE}
              </td>
              <td className="py-1 pr-2 text-right tabular-nums" style={{ color: couleurDelta(d7) }}>
                {formatPct(d7)}
              </td>
              <td className="py-1 pr-2 text-right tabular-nums">
                {e.prix === null ? VALEUR_ABSENTE : e.prix.toFixed(4)}
              </td>
              <td className="py-1 text-text-dim">{e.pegMechanism || VALEUR_ABSENTE}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─────────────────────────── Fenêtre ───────────────────────────

export function StablecoinsWindow() {
  const [onglet, setOnglet] = useState<Onglet>("vue");
  const [statut, setStatut] = useState<Statut>("loading");
  const [emetteurs, setEmetteurs] = useState<EmetteurStablecoin[] | null>(null);
  const [historique, setHistorique] = useState<PointSupply[] | null>(null);
  const [emetteurSelId, setEmetteurSelId] = useState<string | null>(null);
  const [essai, setEssai] = useState(0); // bouton « Réessayer »

  useEffect(() => {
    const ctrl = new AbortController();
    let ignore = false;
    setStatut("loading");
    void Promise.all([chargerEmetteurs(ctrl.signal), chargerHistoriqueAgrege(ctrl.signal)])
      .then(([liste, serie]) => {
        if (ignore) return;
        setEmetteurs(liste);
        setHistorique(serie);
        setStatut("ready");
      })
      .catch(() => {
        if (!ignore) setStatut("error");
      });
    return () => {
      ignore = true;
      ctrl.abort();
    };
  }, [essai]);

  return (
    <>
      <EnTeteFenetre titre="Stablecoins" sousTitre="Supply, impression, dominance, pegs · DefiLlama" />
      <Onglets
        options={ONGLETS}
        actif={onglet}
        onChange={(id) => {
          setEmetteurSelId(null); // changer d'onglet referme la fiche émetteur
          setOnglet(id);
        }}
      />
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {statut === "loading" && <Chargement />}
        {statut === "error" && (
          <ErreurBloc>
            Impossible de charger les données DefiLlama.{" "}
            <button type="button" className={BTN_SECONDAIRE} onClick={() => setEssai((n) => n + 1)}>
              Réessayer
            </button>
          </ErreurBloc>
        )}
        {statut === "ready" && emetteurs !== null && historique !== null && (
          <>
            {onglet === "vue" && (
              <VueEnsemble emetteurs={emetteurs} historique={historique} onSelect={setEmetteurSelId} />
            )}
            {onglet === "impression" && <Vide>Onglet Impression — Task 5.</Vide>}
            {onglet === "chaines" && <Vide>Onglet Chaînes — Task 6.</Vide>}
            {onglet === "pegs" && <Vide>Onglet Pegs — Task 7.</Vide>}
          </>
        )}
      </div>
    </>
  );
}
