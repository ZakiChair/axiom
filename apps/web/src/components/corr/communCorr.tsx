/**
 * Briques partagées des onglets de coupe transversale de CORR (Rotation, Régime) :
 * univers figé, chargement des séries via le cache de session de corr.ts, date de jour
 * UTC, mini-courbe SVG. Présentation seulement ; les calculs vivent dans data/.
 */
import { useEffect, useState } from "react";
import { chargerSeries, debutJour, type SerieCloture, type UniversCorr } from "../../data/corr";
import { REFERENCE_ROTATION, type UniversClasse } from "../../data/rotationRelative";
import { formatDateHeure } from "../../lib/format";
import { NoteSource } from "../ui";

/**
 * Univers de coupe transversale, FIGÉ à sa composition (jusqu'à « Recalculer » ou un
 * changement d'univers), classé par `classerUniversTransversal` : `alts` (paires crypto
 * cotées en dollar, une par actif, hors BTC), `references` (base BTC), `horsCrypto` et
 * `exclus` (cotation non USD ou inconnue, même actif) — tous affichés par BandeauUnivers.
 */
export interface UniversTransversal extends UniversClasse {
  /** Univers choisi dans CORR (le résumé du BRIEF n'est écrit que pour « top50 »). */
  id: UniversCorr;
  /** Libellé honnête (« Watchlist », « Top 50 cap. CoinGecko (paires Binance USDT) »). */
  libelle: string;
  /** Univers top N (biais du survivant à rappeler) plutôt que watchlist. */
  estTop: boolean;
  /** ms epoch de la composition. */
  composeA: number;
}

/** Date « JJ/MM/AAAA » d'un numéro de jour UTC (les bougies 1d sont datées en UTC). */
export function dateJourUtc(jour: number): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(debutJour(jour));
}

/** État de chargement des séries d'un univers + référence BTC. */
export interface SeriesUnivers {
  statut: "chargement" | "pret";
  series: Map<string, SerieCloture[]> | null;
  /** ms epoch de fin de chargement (sert de `nowMs` pour écarter le jour courant). */
  chargeA: number | null;
}

/** État chargé, avec la signature des symboles qu'il couvre. */
export interface SeriesSignees extends SeriesUnivers {
  signature: string | null;
}

const EN_CHARGEMENT: SeriesUnivers = { statut: "chargement", series: null, chargeA: null };

/**
 * PURE — séries servies pour l'univers de `signature` : celles d'un AUTRE univers (rendu qui
 * suit un changement d'univers, avant que l'effet ne relance le chargement) valent
 * « chargement ». Sans cette garde, Régime calculait et persistait un résumé « Top 50 » mesuré
 * sur les séries de l'univers précédent.
 */
export function seriesPourUnivers(etat: SeriesSignees, signature: string | null): SeriesUnivers {
  return etat.signature !== null && etat.signature === signature ? etat : EN_CHARGEMENT;
}

/**
 * Charge les séries de l'univers ET de la référence BTC par `chargerSeries` (cache de
 * session partagé avec la matrice : aucun refetch au changement d'onglet ; requêtes en vol
 * dédoublonnées). `nonce` = « Recalculer » (le parent a déjà vidé le cache).
 */
export function useSeriesUnivers(symbols: readonly string[] | null, nonce: number): SeriesUnivers {
  const [etat, setEtat] = useState<SeriesSignees>({ ...EN_CHARGEMENT, signature: null });
  const signature = symbols === null ? null : symbols.join("|");
  useEffect(() => {
    if (signature === null) return;
    let ignore = false;
    setEtat({ ...EN_CHARGEMENT, signature: null });
    const liste = signature.length === 0 ? [] : signature.split("|");
    void chargerSeries([...liste, REFERENCE_ROTATION]).then((series) => {
      if (!ignore) setEtat({ statut: "pret", series, chargeA: Date.now(), signature });
    });
    return () => {
      ignore = true;
    };
  }, [signature, nonce]);
  return seriesPourUnivers(etat, signature);
}

/**
 * Bandeau d'univers : libellé, date de composition, effectif, exclusions (hors crypto,
 * cotation non USD, doublons d'actif, avec leur raison), paires BTC comptées comme la
 * référence, biais du survivant.
 */
export function BandeauUnivers({
  univers,
  nCharges,
  dernierJour,
}: {
  univers: UniversTransversal;
  nCharges: number;
  dernierJour: number | null;
}) {
  const autresRefs = univers.references.filter((s) => s !== REFERENCE_ROTATION);
  return (
    <div className="mb-2 space-y-0.5 text-[11px] text-text-dim">
      <p>
        Univers : <span className="text-text">{univers.libelle}</span> · composé le{" "}
        {formatDateHeure(univers.composeA)}, {univers.estTop ? "figé jusqu'à « Recalculer »" : "suit la watchlist"} ·{" "}
        {nCharges}/{univers.alts.length} alts
        chargés · BTC = référence ({REFERENCE_ROTATION})
        {dernierJour !== null && <> · dernière clôture {dateJourUtc(dernierJour)} (UTC)</>}
      </p>
      {autresRefs.length > 0 && (
        <p>Base BTC, comptés comme la référence (pas des alts) : {autresRefs.join(", ")}.</p>
      )}
      {univers.horsCrypto.length > 0 && (
        <p>Hors crypto écartés : {univers.horsCrypto.join(", ")}.</p>
      )}
      {univers.exclus.length > 0 && (
        <div>
          <p>Écartés de la coupe ({univers.exclus.length}) :</p>
          <ul className="space-y-0.5 pl-2">
            {univers.exclus.map((e) => (
              <li key={e.symbole}>
                <span className="text-text">{e.symbole}</span> — {e.raison}
              </li>
            ))}
          </ul>
        </div>
      )}
      {univers.estTop && (
        <NoteSource>
          Biais du survivant : le classement du jour est appliqué à tout l'historique ; les actifs
          sortis du top (ou délistés) n'y figurent pas.
        </NoteSource>
      )}
    </div>
  );
}

/**
 * Mini-courbe SVG (polyligne interrompue sur les valeurs absentes) : rien sous 2 points
 * définis. Couleur = variable CSS du thème.
 */
export function MiniCourbe({
  valeurs,
  couleur = "var(--accent)",
  largeur = 72,
  hauteur = 20,
  libelle,
}: {
  valeurs: readonly (number | null)[];
  couleur?: string;
  largeur?: number;
  hauteur?: number;
  libelle: string;
}) {
  const definies = valeurs.filter((v): v is number => v !== null && Number.isFinite(v));
  if (definies.length < 2) return null;
  const min = Math.min(...definies);
  const max = Math.max(...definies);
  const etendue = max - min || 1;
  const segments: string[] = [];
  let courant: string[] = [];
  valeurs.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      if (courant.length > 1) segments.push(courant.join(" "));
      courant = [];
      return;
    }
    const x = (i / Math.max(1, valeurs.length - 1)) * largeur;
    const y = hauteur - ((v - min) / etendue) * hauteur;
    courant.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  if (courant.length > 1) segments.push(courant.join(" "));
  return (
    <svg width={largeur} height={hauteur} viewBox={`0 0 ${largeur} ${hauteur}`} role="img" aria-label={libelle}>
      {segments.map((pts, i) => (
        <polyline key={i} points={pts} fill="none" style={{ stroke: couleur }} strokeWidth={1} strokeLinejoin="round" />
      ))}
    </svg>
  );
}
