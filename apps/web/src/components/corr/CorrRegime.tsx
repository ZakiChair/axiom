/**
 * Onglet « Régime » de CORR — régime transversal du marché crypto (SUG-42 volet
 * transversal, chantier du 2026-11-07) : dispersion transversale lissée 7 j, médiane des
 * corrélations alts/BTC sur 30 j, corrélation moyenne par paire et ratio d'absorption sur
 * 60 j. Calcul : data/regimeTransversal.ts (pur, testé) ; données : cache de séries 1d de
 * corr.ts. Lecture DESCRIPTIVE (aucun seuil validé), univers et effectifs affichés.
 *
 * Sur l'univers Top 50, le résumé du dernier jour est persisté (`axiom:corr:regime:v1`)
 * pour la ligne du BRIEF, qui le réutilise tant qu'il porte sur la dernière clôture.
 */
import { useEffect, useMemo } from "react";
import {
  calculerRegimeTransversal,
  FENETRE_CORR_BTC,
  FENETRE_FACTEUR,
  LISSAGE_DISPERSION,
  MIN_ACTIFS_TRANSVERSAL,
  MIN_POINTS_CORR_BTC,
  persisterRegimeTop50,
  type DerniereMesure,
  type SerieMesure,
} from "../../data/regimeTransversal";
import { courtSymbole, MAX_JOURS } from "../../data/corr";
import { REFERENCE_ROTATION } from "../../data/rotationRelative";
import { formatDec, formatPourcentage } from "../../lib/format";
import { Badge, Chargement, ErreurBloc, NoteSource, TuileStat, Vide } from "../ui";
import { BandeauUnivers, MiniCourbe, useSeriesUnivers, type UniversTransversal } from "./communCorr";

/** Pied commun d'une tuile : effectif, centile dans l'historique chargé, ou « non mesuré ». */
function piedMesure(d: DerniereMesure | null, extra?: string): string {
  if (d === null) return `non mesuré (moins de ${MIN_ACTIFS_TRANSVERSAL} alts exploitables ou historique trop court)`;
  const base = `n = ${d.nActifs} alts · centile ${Math.round(d.centile)} sur ${d.nHistorique} j chargés`;
  return extra === undefined ? base : `${base} · ${extra}`;
}

/** Une tuile de mesure : valeur du dernier jour, mini-courbe de l'historique chargé. */
function TuileMesure({
  label,
  title,
  derniere,
  serie,
  valeur,
  extraPied,
}: {
  label: string;
  title: string;
  derniere: DerniereMesure | null;
  serie: SerieMesure;
  valeur: (v: number) => string;
  extraPied?: string;
}) {
  return (
    <TuileStat
      label={label}
      title={title}
      valeur={derniere === null ? "—" : valeur(derniere.valeur)}
      extra={<MiniCourbe valeurs={serie.valeurs} libelle={`Historique chargé : ${label}`} />}
      pied={<span>{piedMesure(derniere, extraPied)}</span>}
    />
  );
}

export function CorrRegime({ univers, nonce }: { univers: UniversTransversal; nonce: number }) {
  const { statut, series, chargeA } = useSeriesUnivers(univers.alts, nonce);
  const alts = univers.alts;

  const resultat = useMemo(() => {
    if (series === null || chargeA === null) return null;
    return calculerRegimeTransversal(series, alts, series.get(REFERENCE_ROTATION) ?? [], chargeA);
  }, [series, chargeA, alts]);

  // Univers Top 50 : le résumé du jour alimente la ligne du BRIEF (écriture best-effort).
  useEffect(() => {
    if (resultat === null || chargeA === null || univers.id !== "top50") return;
    persisterRegimeTop50(resultat, chargeA, alts.length);
  }, [resultat, chargeA, univers.id, alts.length]);

  const d = resultat?.derniers;
  const plancher = d?.plancherBruit60j ?? null;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <Badge ton="warn" title="Aucun seuil validé : les centiles situent la valeur du jour dans l'historique chargé, ils ne prédisent rien">
          Descriptif
        </Badge>
      </div>
      <BandeauUnivers
        univers={univers}
        nCharges={resultat?.nAlts ?? 0}
        dernierJour={resultat?.dernierJour ?? null}
      />

      {alts.length === 0 ? (
        <Vide>Aucun alt crypto coté en dollar dans l'univers. Ajoutez des paires à la watchlist ou choisissez un top N.</Vide>
      ) : statut === "chargement" || resultat === null || d === undefined ? (
        <Chargement libelle={`Séries 1d (${alts.length} alts + BTC, ${MAX_JOURS} jours)…`} />
      ) : !resultat.refDisponible ? (
        <ErreurBloc>Série BTCUSDT indisponible : le régime transversal ne peut pas être calculé. Réessayez avec « Recalculer ».</ErreurBloc>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <TuileMesure
              label={`Dispersion transversale (${LISSAGE_DISPERSION} j)`}
              title="Écart-type des log-rendements du jour entre les alts, moyenne sur 7 jours. Haute : les alts divergent (la sélection compte) ; basse : ils bougent ensemble."
              derniere={d.dispersion7j}
              serie={resultat.dispersion7j}
              valeur={(v) => `${formatPourcentage(v * 100, 2)} /j`}
            />
            <TuileMesure
              label={`Médiane ρ alts/BTC (${FENETRE_CORR_BTC} j)`}
              title={`Médiane des corrélations de Pearson de chaque alt avec BTC (≥ ${MIN_POINTS_CORR_BTC} rendements communs).`}
              derniere={d.medianeCorrBtc30j}
              serie={resultat.medianeCorrBtc30j}
              valeur={(v) => formatDec(v, 2)}
            />
            <TuileMesure
              label={`Corrélation moyenne par paire (${FENETRE_FACTEUR} j)`}
              title="Moyenne des corrélations entre alts (hors diagonale), alts à 60 rendements complets seulement."
              derniere={d.corrMoyenne60j}
              serie={resultat.corrMoyenne60j}
              valeur={(v) => formatDec(v, 2)}
            />
            <TuileMesure
              label={`Ratio d'absorption (${FENETRE_FACTEUR} j)`}
              title="Part de variance du premier facteur (λ₁/n) de la matrice de corrélation des alts. Sur du bruit pur, la valeur n'est pas 1/n mais proche du bord de Marchenko-Pastur."
              derniere={d.absorption60j}
              serie={resultat.absorption60j}
              valeur={(v) => formatDec(v, 2)}
              extraPied={plancher === null ? undefined : `bruit pur ≈ ${formatDec(plancher, 2)}`}
            />
          </div>

          {resultat.exclus.length > 0 && (
            <p className="mt-2 text-[11px] text-text-dim">
              Écartés du calcul ({resultat.exclus.length}) :{" "}
              {resultat.exclus.map((e) => `${e.symbole} (${e.raison})`).join(" ; ")}.
            </p>
          )}

          {resultat.altsSansSerie.length > 0 && (
            <p className="mt-2 text-[11px] text-text-dim">
              Séries indisponibles ({resultat.altsSansSerie.length}) :{" "}
              {resultat.altsSansSerie.map((s) => courtSymbole(s)).join(", ")}.
            </p>
          )}

          <p className="mt-2 text-[11px] leading-snug text-text-dim">
            Lecture descriptive : corrélations hautes et dispersion basse = marché porté par un facteur
            commun (BTC), la sélection d'alts pèse peu ; corrélations basses et dispersion haute =
            marché dispersé. Les trois mesures de corrélation se recoupent largement quand le facteur
            BTC domine ; les corrélations montent aussi mécaniquement avec la volatilité.
          </p>
        </>
      )}

      <div className="mt-3">
        <NoteSource>
          Log-rendements 1d clos (jour en cours exclu) des alts cotés en dollar, calendrier des
          clôtures BTCUSDT ; un rendement
          exige les clôtures des jours d et d−1. Dispersion : écart-type population entre alts (≥{" "}
          {MIN_ACTIFS_TRANSVERSAL}), lissée {LISSAGE_DISPERSION} j. Matrice {FENETRE_FACTEUR} j : alts à
          fenêtre complète, corrélations (rendements standardisés), λ₁ par itération de puissance.
          Centile = rang de la valeur du jour dans l'historique chargé (~{MAX_JOURS} j), pas une
          probabilité. Klines réutilisées des sources existantes, en cache de session.
        </NoteSource>
      </div>
    </div>
  );
}
