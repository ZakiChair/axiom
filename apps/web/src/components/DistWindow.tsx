/**
 * Fenêtre « DIST » — Distribution EMPIRIQUE des rendements du chart maître projetée en
 * NIVEAUX de prix (VaR/CVaR par horizon 1/5/20 bougies). Moteur pur et testé dans
 * `data/distVar.ts` (Task 1) : cette fenêtre ne fait QUE fournir les closes et présenter
 * la sortie — AUCUN fetch propre.
 *
 * SOURCE DES CLOSES : les bougies DÉJÀ chargées du chart MAÎTRE (`marketStore` global).
 * Patron d'abonnement calqué sur ChartInstance.tsx (l.303-308) : seul l'objet BASSE
 * FRÉQUENCE `dataLoad` est abonné dans le rendu React (il bascule en « ready » quand un
 * backfill est committé, et change de requête au switch symbole/TF) ; les `candles` sont
 * lues IMPÉRATIVEMENT via `getState()` — jamais abonnées (les ticks live ne re-rendent
 * donc pas la fenêtre). Le bouton Rafraîchir re-lit ce snapshot (capte la dernière bougie
 * mise à jour en direct). C'est la réponse « couche indicateurs/aux » du brief : VOL et
 * SEAG, eux, RE-FETCHENT leurs propres bougies daily — écarté ici (« pas de fetch propre »).
 *
 * Présentation PURE : aucun store métier (le calcul est synchrone et pur, contrairement à
 * NETLIQ dont le store existe pour un fetch FRED async) — état local + compteur de
 * rafraîchissement, montée via FloatingWindow comme NetliqWindow.
 */
import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { marketStore } from "../store/market";
import { distOverlayStore } from "../chart/distLignes";
import { distVar, HORIZONS, type NiveauxVar } from "../data/distVar";
import { formatPrice, formatPct } from "../lib/format";
import { Badge, EnTeteFenetre, Chargement, ErreurBloc, Fraicheur, NoteSource, Vide } from "./ui";

/** Seuil d'échantillon exigé par `distVar` (repris pour le message « insuffisant »). */
const MIN_CLOSES = 300;

/** Lignes de quantiles du tableau, du haut (p99) vers le bas (p1). CVaR95 est ajoutée après. */
const LIGNES_QUANTILE = [
  { cle: "p99", label: "p99" },
  { cle: "p95", label: "p95" },
  { cle: "p50", label: "p50 (médiane)" },
  { cle: "p5", label: "p5" },
  { cle: "p1", label: "p1" },
] as const;

/** Classe Tailwind de teinte d'un % signé (up positif, down négatif, dim nul/absent). */
function teinteSigne(v: number): string {
  if (!Number.isFinite(v) || v === 0) return "text-text-dim";
  return v > 0 ? "text-up" : "text-down";
}

/** Une cellule prix + % teinté (empilés), tabular-nums pour l'alignement des chiffres. */
function Cellule({ prix, pct }: { prix: number; pct: number }) {
  return (
    <td className="px-3 py-1.5 text-right tabular-nums">
      <div className="text-text">{formatPrice(prix)}</div>
      <div className={`text-[10px] ${teinteSigne(pct)}`}>{formatPct(pct, 2)}</div>
    </td>
  );
}

interface Calcul {
  niveaux: NiveauxVar[] | null;
  /** Nombre de closes FINIS disponibles (pour le message « insuffisant »). */
  nCloses: number;
}

export function DistWindow() {
  const symbol = useStore(marketStore, (s) => s.symbol);
  const timeframe = useStore(marketStore, (s) => s.timeframe);
  // Seul objet basse fréquence abonné : bascule « ready » à la fin d'un backfill et
  // change de requête au switch symbole/TF → déclenche le recalcul avec des closes frais.
  const dataLoad = useStore(marketStore, (s) => s.dataLoad);
  // Overlay des bandes VaR sur le chart maître (toggle persisté, défaut OFF).
  const overlayActif = useStore(distOverlayStore, (s) => s.actif);

  // Compteur de rafraîchissement : sa hausse force la re-lecture du snapshot de bougies
  // (capte la dernière bougie mise à jour en direct, hors abonnement haute fréquence).
  const [refreshTick, setRefreshTick] = useState(0);

  // Recalcul : lit les closes IMPÉRATIVEMENT (getState) — recomposé quand `dataLoad`
  // change (nouveau jeu committé / switch) ou au rafraîchissement manuel.
  const calcul = useMemo<Calcul>(() => {
    const closes = marketStore.getState().candles.map((c) => c.close);
    const nCloses = closes.filter((c) => Number.isFinite(c)).length;
    return { niveaux: distVar(closes), nCloses };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLoad, refreshTick]);

  // Horodatage de fraîcheur : réactualisé à chaque recalcul (nouveau résultat).
  const [majTs, setMajTs] = useState<number | null>(null);
  useEffect(() => {
    setMajTs(Date.now());
  }, [calcul]);

  // La bande de bougies est vidée pendant un backfill (status « loading ») : ne JAMAIS
  // afficher le message « insuffisant » sur cette frame transitoire d'un switch légitime.
  const enChargement = dataLoad.status === "loading";
  const enErreur = dataLoad.status === "error";

  // Badge d'en-tête : VaR95 sur l'horizon 20 bougies = p5 (queue basse) en %. Gardé pour
  // undefined même si N ≥ 300 garantit sa présence (le badge le lit sans crainte).
  const h20 = calcul.niveaux?.find((n) => n.h === 20);

  const rafraichir = (): void => setRefreshTick((t) => t + 1);

  return (
    <>
      <EnTeteFenetre
        mnemo="DIST"
        titre="Distribution des rendements"
        sousTitre={
          <span className="inline-flex items-center gap-2">
            <span>
              {symbol} · {timeframe}
            </span>
            {h20 !== undefined && <Badge ton="down">VaR95 20b {formatPct(h20.pct.p5, 1)}</Badge>}
          </span>
        }
        actions={
          <span className="flex items-center gap-2">
            {/* Overlay des bandes VaR (p5/p95 · p1/p99 de l'horizon 20 b) sur le chart maître. */}
            <button
              type="button"
              onClick={() => distOverlayStore.getState().basculer()}
              aria-pressed={overlayActif}
              title="Afficher les bandes VaR sur le chart maître"
              className={`rounded border px-2 py-1 text-[11px] transition ${
                overlayActif
                  ? "border-accent/60 bg-accent/15 text-accent"
                  : "border-border bg-bg text-text-dim hover:text-text"
              }`}
            >
              Bandes VaR {overlayActif ? "ON" : "OFF"}
            </button>
            <button
              type="button"
              onClick={rafraichir}
              className="rounded border border-border bg-bg px-2 py-1 text-[11px] text-text-dim transition hover:text-text"
            >
              ↻ Rafraîchir
            </button>
          </span>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col px-4 py-4">
        {enErreur ? (
          <ErreurBloc>Bougies du chart indisponibles ({dataLoad.error}).</ErreurBloc>
        ) : enChargement ? (
          <Chargement libelle="Chargement des bougies du chart…" />
        ) : calcul.niveaux === null ? (
          <Vide>
            Échantillon insuffisant : {calcul.nCloses} bougie{calcul.nCloses > 1 ? "s" : ""} chargée
            {calcul.nCloses > 1 ? "s" : ""} sur {MIN_CLOSES} requises. Élargissez l'historique
            (timeframe plus courte ou plus de recul).
          </Vide>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="border-b border-border text-text-dim">
                  <th className="px-3 py-1.5 text-left font-medium">Niveau</th>
                  {calcul.niveaux.map((n) => (
                    <th key={n.h} className="px-3 py-1.5 text-right font-medium">
                      {n.h} b
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {LIGNES_QUANTILE.map((ligne) => (
                  <tr key={ligne.cle} className="border-b border-border/50">
                    <td className="px-3 py-1.5 text-left text-text-dim">{ligne.label}</td>
                    {calcul.niveaux!.map((n) => (
                      <Cellule key={n.h} prix={n.niveaux[ligne.cle]} pct={n.pct[ligne.cle]} />
                    ))}
                  </tr>
                ))}
                {/* CVaR95 : moyenne de la queue ≤ p5 (perte attendue conditionnelle) — teintée down. */}
                <tr className="border-t border-border">
                  <td className="px-3 py-1.5 text-left font-medium text-text">CVaR95</td>
                  {calcul.niveaux.map((n) => (
                    <Cellule key={n.h} prix={n.cvar95Niveau} pct={n.cvar95Pct} />
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between">
          <NoteSource>
            Distribution empirique des {calcul.nCloses} dernières bougies {timeframe} du chart
            MAÎTRE (horizons {HORIZONS.join(" / ")} b, fenêtres chevauchantes,
            {calcul.niveaux?.map((n) => n.nEchantillons).join(" / ") ?? "—"} échantillons) — PAS
            une prévision.
          </NoteSource>
          <Fraicheur loading={enChargement} majTs={majTs} />
        </div>
      </div>
    </>
  );
}
