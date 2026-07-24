/**
 * Hook d'assemblage de la section « Risque » du portefeuille (état + vue dérivée).
 *
 * Encapsule : l'état de collecte (idle/loading/error/ready), la garde anti-course, la
 * collecte LAZY au dépliage, et la vue de risque dérivée (poids canonique → VaR/CVaR,
 * contributions, stress, equity). AUCUN calcul propre : toutes les fonctions pures viennent
 * de data/portRisque. Les refs `openRef`/`latest` (positions ouvertes à jour + derniers prix
 * WS) sont partagées avec la boucle de repaint impérative de la fenêtre.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { Position } from "../../store/portfolio";
import {
  serieRendementsPortefeuille,
  risquePortefeuille,
  contributionsRisque,
  betasVsRef,
  stressGrid,
  equityHistorique,
  collecterRisquePortefeuille,
  klinesVersRendements,
  klinesVersClotures,
  RISQUE_SYMBOLE_REF,
  type SerieActif,
  type CollecteRisque,
} from "../../data/portRisque";

/** État de la collecte de risque (machine à états simple). */
export type EtatRisque =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; collecte: CollecteRisque };

interface ParamsRisque {
  open: boolean;
  openPositions: Position[];
  /** Positions ouvertes « toujours à jour » (évite une closure périmée). */
  openRef: MutableRefObject<Position[]>;
  /** Derniers prix WS connus (MÊME source que les PnL latents). */
  latest: MutableRefObject<Map<string, number>>;
}

export function usePortfolioRisque({ open, openPositions, openRef, latest }: ParamsRisque) {
  // Section « Risque » : repliée par défaut, collecte LAZY au dépliage (+ Rafraîchir).
  const [showRisk, setShowRisk] = useState(false);
  const [risque, setRisque] = useState<EtatRisque>({ status: "idle" });
  /** Garde anti-course : une collecte lente ne doit pas écraser un Rafraîchir plus récent. */
  const risqueRunId = useRef(0);

  /** Collecte les klines des positions ouvertes (+ BTCUSDT réf.) et arme l'état « Risque ». */
  const collecterRisque = useCallback(async (force: boolean) => {
    const ouvertes = openRef.current;
    if (ouvertes.length === 0) return;
    const runId = ++risqueRunId.current;
    setRisque({ status: "loading" });
    // Prix courants : MÊME source que les PnL latents (WS tickers, latest.current) ?? prix d'entrée.
    const prix: Record<string, number> = {};
    for (const p of ouvertes) prix[p.symbole] = latest.current.get(p.symbole) ?? p.prixEntree;
    try {
      const collecte = await collecterRisquePortefeuille(ouvertes, prix, force);
      if (runId !== risqueRunId.current) return;
      setRisque({ status: "ready", collecte });
    } catch (e) {
      if (runId !== risqueRunId.current) return;
      setRisque({ status: "error", message: e instanceof Error ? e.message : "collecte échouée" });
    }
  }, []);

  // Déclenche la collecte au 1er dépliage de la section (lazy). Rafraîchir force ensuite.
  useEffect(() => {
    if (open && showRisk && risque.status === "idle" && openPositions.length > 0) {
      void collecterRisque(false);
    }
  }, [open, showRisk, risque.status, openPositions.length, collecterRisque]);

  /**
   * Vue de risque dérivée : UN tableau de poids canonique (unique par symbole, w signé =
   * Σ signe·taille·prixCourant) alimente TOUTES les fonctions pures ⇒ badges $, contributions
   * et stress cohérents par construction. Symboles sans klines = exclus (comptés « hors calcul »).
   */
  const vueRisque = useMemo(() => {
    if (risque.status !== "ready") return null;
    const { klines, refDispo, poids, sommeAbs } = risque.collecte;

    const horsCalcul = openPositions.filter((p) => !klines.has(p.symbole)).length;
    if (poids.length === 0) return { vide: true as const, horsCalcul };

    const inclusSet = new Set(poids.map((p) => p.symbol));
    const series: SerieActif[] = poids.map((p) => ({
      symbol: p.symbol,
      rendements: klinesVersRendements(klines.get(p.symbol)!),
    }));

    const risqueP = risquePortefeuille(serieRendementsPortefeuille(series, poids));
    const ctrs = new Map(contributionsRisque(series, poids).map((c) => [c.symbol, c.ctr]));

    const refSerie: SerieActif | null = refDispo
      ? { symbol: RISQUE_SYMBOLE_REF, rendements: klinesVersRendements(klines.get(RISQUE_SYMBOLE_REF)!) }
      : null;
    const betaMap = new Map<string, number | null>(
      (refSerie ? betasVsRef(series, refSerie) : series.map((s) => ({ symbol: s.symbol, beta: null }))).map(
        (b) => [b.symbol, b.beta],
      ),
    );
    const stress = stressGrid(poids, betaMap);

    // Equity rétro-projeté : agrégats netTaille/coût LOCAUX (propres à l'equity, hors contrat
    // de risque partagé) ; clôtures + tailles NETTES agrégées (drop des symboles net-plats).
    const aggEquity = new Map<string, { netTaille: number; cout: number }>();
    for (const p of openPositions) {
      if (!inclusSet.has(p.symbole)) continue;
      const signe = p.direction === "long" ? 1 : -1;
      const cur = aggEquity.get(p.symbole) ?? { netTaille: 0, cout: 0 };
      cur.netTaille += signe * p.taille;
      cur.cout += signe * p.taille * p.prixEntree;
      aggEquity.set(p.symbole, cur);
    }
    const closes = new Map<string, { t: number; close: number }[]>();
    const tailles = new Map<string, { taille: number; entree: number; signe: 1 | -1 }>();
    for (const s of inclusSet) {
      closes.set(s, klinesVersClotures(klines.get(s)!));
      const agg = aggEquity.get(s);
      if (!agg || Math.abs(agg.netTaille) < 1e-12) continue;
      const signe: 1 | -1 = agg.netTaille > 0 ? 1 : -1;
      tailles.set(s, { taille: Math.abs(agg.netTaille), entree: agg.cout / agg.netTaille, signe });
    }
    const equity = equityHistorique(closes, tailles);

    const lignes = poids.map((p) => ({
      symbol: p.symbol,
      poidsPct: sommeAbs > 0 ? (p.poids / sommeAbs) * 100 : 0,
      beta: betaMap.get(p.symbol) ?? null,
      ctrPct: (ctrs.get(p.symbol) ?? 0) * 100,
    }));

    return { vide: false as const, horsCalcul, sommeAbs, risqueP, lignes, stress, equity };
  }, [risque, openPositions]);

  return { showRisk, setShowRisk, risque, collecterRisque, vueRisque };
}

/** Type de la vue de risque dérivée (exposé pour le composant de rendu). */
export type VueRisque = ReturnType<typeof usePortfolioRisque>["vueRisque"];
