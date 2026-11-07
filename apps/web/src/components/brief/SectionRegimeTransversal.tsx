/**
 * Section BRIEF — régime transversal (une ligne) : dispersion 7 j, médiane ρ alts/BTC
 * 30 j, corrélation moyenne et ratio d'absorption 60 j sur le TOP 50 (chantier du
 * 2026-11-07, SUG-42 volet transversal). Le détail vit dans CORR › Régime.
 *
 * Chargement : résumé persisté (`axiom:corr:regime:v1`, écrit par CORR › Régime en Top 50
 * ou par cette section) réutilisé s'il porte sur la dernière clôture et date de moins de
 * 12 h — aucun appel ; sinon mesure autonome (catalogue CoinGecko en cache 5 min, klines
 * 1d via le cache de session de CORR). Comme SectionAnalyse, la section suit le jeton de
 * rafraîchissement du BRIEF (le premier chargement l'incrémente : le jeton 0 est ignoré).
 * Échec : résumé périmé affiché comme tel s'il existe, sinon « non mesuré ».
 */
import { useEffect, useState } from "react";
import {
  lireResumeRegime,
  mesurerRegimeTop50,
  resumeRegimeFrais,
  type DerniereMesure,
  type ResumeRegime,
} from "../../data/regimeTransversal";
import { corrUiStore } from "../../store/corrUi";
import { formatDateHeure, formatDec, formatPourcentage } from "../../lib/format";
import { dateJourUtc } from "../corr/communCorr";
import { Chargement, ErreurBloc, NoteSource } from "../ui";
import { TitreBloc } from "./commun";

interface Etat {
  statut: "attente" | "chargement" | "pret" | "erreur";
  resume: ResumeRegime | null;
}

/**
 * Libellé du lien vers le détail. Il DIT qu'il réécrit l'univers persisté de CORR
 * (`axiom:corr:v1`) : un utilisateur sur sa watchlist ne doit pas retrouver sa matrice en
 * Top 50 sans l'avoir lu (revue du 2026-11-07).
 */
export const LIBELLE_LIEN_DETAIL = "Détail : CORR › Régime (bascule CORR sur Top 50)";

/** Valeur formatée ou « non mesuré » (jamais un 0 de remplacement). */
function texte(d: DerniereMesure | null, format: (v: number) => string): string {
  return d === null ? "non mesuré" : format(d.valeur);
}

/**
 * Ligne de présentation (sans effet, testable en rendu statique) : valeurs du résumé,
 * « non mesuré » par mesure absente, résumé périmé signalé pendant une mise à jour ou
 * après un échec.
 */
export function LigneRegime({ statut, resume }: { statut: Etat["statut"]; resume: ResumeRegime | null }) {
  const r = resume;
  if (statut === "attente" || (statut === "chargement" && r === null)) {
    return <Chargement libelle="Mesure du top 50 (klines 1d)…" />;
  }
  if (r === null) {
    return <ErreurBloc>Régime transversal non mesuré (catalogue ou klines indisponibles).</ErreurBloc>;
  }
  return (
    <p className="text-[11px] leading-snug text-text-dim">
      {statut !== "pret" && (
        <span className="text-warn">
          {statut === "chargement" ? "Mise à jour en cours, résumé précédent — " : "Mesure du jour impossible, résumé périmé — "}
        </span>
      )}
      Dispersion 7 j{" "}
      <span className="tabular-nums text-text">{texte(r.dispersion7j, (v) => `${formatPourcentage(v * 100, 2)} /j`)}</span> ·
      ρ médiane alts/BTC 30 j <span className="tabular-nums text-text">{texte(r.medianeCorrBtc30j, (v) => formatDec(v, 2))}</span> ·
      corr. moyenne 60 j <span className="tabular-nums text-text">{texte(r.corrMoyenne60j, (v) => formatDec(v, 2))}</span> ·
      absorption 60 j <span className="tabular-nums text-text">{texte(r.absorption60j, (v) => formatDec(v, 2))}</span>
      {r.plancherBruit60j !== null && <> (bruit pur ≈ {formatDec(r.plancherBruit60j, 2)})</>} · descriptif.
    </p>
  );
}

export function SectionRegimeTransversal({ refreshToken }: { refreshToken: number }) {
  const [etat, setEtat] = useState<Etat>({ statut: "attente", resume: null });

  useEffect(() => {
    if (refreshToken === 0) return;
    let ignore = false;
    const maintenant = Date.now();
    const enCache = lireResumeRegime();
    if (enCache !== null && resumeRegimeFrais(enCache, maintenant)) {
      setEtat({ statut: "pret", resume: enCache });
      return;
    }
    setEtat({ statut: "chargement", resume: enCache });
    mesurerRegimeTop50(maintenant)
      .then((resume) => {
        if (!ignore) setEtat({ statut: "pret", resume });
      })
      .catch((err) => {
        if (ignore) return;
        console.error("[AXIOM] régime transversal indisponible", err);
        setEtat({ statut: "erreur", resume: enCache });
      });
    return () => {
      ignore = true;
    };
  }, [refreshToken]);

  const r = etat.resume;
  const ouvrirDetail = () => {
    const corr = corrUiStore.getState();
    corr.setUnivers("top50");
    corr.setOnglet("regime");
    corr.openCorr();
  };

  return (
    <section className="space-y-1">
      <TitreBloc>Régime · coupe transversale</TitreBloc>
      <LigneRegime statut={etat.statut} resume={r} />
      <NoteSource>
        {r === null
          ? "Top 50 cap. CoinGecko (paires Binance USDT), klines 1d clôturées."
          : `${r.univers} · ${r.nAlts}/${r.nAttendus} alts · clôture ${dateJourUtc(r.jour)} (UTC) · calcul ${formatDateHeure(r.calculeA)}, réutilisé jusqu'à la clôture suivante (12 h au plus).`}{" "}
        <button
          type="button"
          className="underline"
          onClick={ouvrirDetail}
          title="Ouvre CORR sur l'onglet Régime et bascule son univers sur le Top 50 : l'univers choisi dans CORR (watchlist ou autre top N) est remplacé, matrice comprise."
        >
          {LIBELLE_LIEN_DETAIL}
        </button>
      </NoteSource>
    </section>
  );
}
