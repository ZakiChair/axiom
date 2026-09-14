/**
 * Section « Modèles de prix » de CYCLE : multiple 200 semaines (prix / SMA 1 400 j) avec la
 * lecture prix / SMA 2 ans en pied, et Pi Cycle Bottom (EMA 150 j contre 0,745 × SMA 471 j)
 * avec ses croisements historiques.
 *
 * Vue PURE (testée en rendu statique) : les modèles sont calculés une fois par run dans
 * `cycleStore`, jamais au rendu (le survol du chart re-rend la fenêtre à chaque mouvement).
 * Aucune alerte, aucune prévision : des repères de zone, libellés avec leurs limites.
 */
import {
  JOURS_200_SEMAINES,
  JOURS_2_ANS,
  PI_COEFFICIENT,
  PI_EMA_JOURS,
  PI_SMA_JOURS,
  type ModelesPrix,
  type RatioMoyenne,
  type SequenceRatio,
} from "../../data/modelesPrix";
import { formatDec, formatEntier, formatPct, VALEUR_ABSENTE } from "../../lib/format";
import { Badge, NoteSource, TitreSection, TuileStat } from "../ui";

/** Date ISO UTC « AAAA-MM-JJ » (points PriceUSD datés à 00:00 UTC, lisible sans fuseau). */
const dateIso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Côté de la moyenne en toutes lettres. */
const cote = (s: SequenceRatio): string => (s.sens === "dessus" ? "au-dessus" : "en dessous");

/** « 28 j au-dessus » / « 228 j en dessous ». */
function texteSequence(s: SequenceRatio): string {
  return `${formatEntier(s.jours)} j ${cote(s)}`;
}

/** Détail d'un ratio pour l'infobulle : moyenne, percentile et début de la séquence. */
function detailRatio(libelle: string, r: RatioMoyenne): string {
  const pct = Number.isFinite(r.percentile) ? ` · percentile ${formatDec(r.percentile, 1)} depuis le ${dateIso(r.premierMs)}` : "";
  return `${libelle} ${formatEntier(r.moyenne)} $${pct} · ${cote(r.sequence)} depuis le ${dateIso(r.sequence.depuisMs)}`;
}

export function VueModelesPrix({ modeles }: { modeles: ModelesPrix | null }) {
  const m200 = modeles?.multiple200Semaines ?? null;
  const m2ans = modeles?.ratio2Ans ?? null;
  const pi = modeles?.piCycleBottom ?? null;

  const titre200 = [
    m200 !== null ? detailRatio(`SMA ${formatEntier(JOURS_200_SEMAINES)} j (proxy 200 semaines)`, m200) : null,
    m2ans !== null ? detailRatio(`SMA ${JOURS_2_ANS} j`, m2ans) : null,
  ]
    .filter((t) => t !== null)
    .join("\n");

  // Croisements historiques lus dans les données ; le contexte (calage, 2022, 2026) est documenté.
  const signaux = pi?.episodes ?? [];
  const notePi =
    pi === null
      ? ""
      : ` · Pi Cycle Bottom : coefficient ${PI_COEFFICIENT} calé a posteriori, n = ${signaux.length} signa${signaux.length > 1 ? "ux" : "l"}${
          signaux.length > 0
            ? ` (${signaux.map((e) => `${dateIso(e.entreeMs)} → ${e.sortieMs !== null ? dateIso(e.sortieMs) : "en cours"}`).join(" · ")})`
            : ""
        } ; celui de 2022 précédait le creux de 4 mois, le plus bas du 2026-06-30 n'a pas été signalé`;

  const dernierEpisode = signaux.at(-1);

  return (
    <section className="mt-3 shrink-0">
      <TitreSection>Modèles de prix</TitreSection>
      <div className="grid grid-cols-2 gap-2">
        <TuileStat
          label="Multiple 200 semaines"
          valeur={m200 !== null ? formatDec(m200.ratio, 2) : VALEUR_ABSENTE}
          title={titre200 || undefined}
          badge={
            m200 !== null && Number.isFinite(m200.percentile) ? (
              <Badge title="Rang percentile du multiple dans son historique">pct {formatDec(m200.percentile, 0)}</Badge>
            ) : undefined
          }
          extra={
            m200 !== null ? <span className="text-[10px] text-text-dim">{texteSequence(m200.sequence)}</span> : undefined
          }
          pied={
            <>
              <span>{`Prix / SMA 2 ans ${m2ans !== null ? formatDec(m2ans.ratio, 2) : VALEUR_ABSENTE}`}</span>
              {m2ans !== null && <span>{texteSequence(m2ans.sequence)}</span>}
            </>
          }
        />
        <TuileStat
          label="Pi Cycle Bottom"
          valeur={pi !== null ? formatPct(pi.ecartPct, 1) : VALEUR_ABSENTE}
          title={
            pi !== null
              ? `EMA ${PI_EMA_JOURS} j ${formatEntier(pi.ema150)} $ · seuil ${PI_COEFFICIENT} × SMA ${PI_SMA_JOURS} j ${formatEntier(pi.seuil)} $ · ratio ${formatDec(pi.ratio, 3)} (signal sous 1)`
              : undefined
          }
          badge={
            pi !== null ? (
              pi.ratio < 1 ? <Badge ton="accent">signal</Badge> : <Badge>pas de signal</Badge>
            ) : undefined
          }
          pied={
            <>
              <span>{`EMA ${PI_EMA_JOURS} / ${PI_COEFFICIENT} × SMA ${PI_SMA_JOURS}`}</span>
              {pi !== null && (
                <span>
                  {dernierEpisode === undefined
                    ? "aucun signal"
                    : dernierEpisode.sortieMs === null
                      ? `signal depuis ${dateIso(dernierEpisode.entreeMs)}`
                      : `dernier signal ${dateIso(dernierEpisode.entreeMs)}`}
                </span>
              )}
            </>
          }
        />
      </div>
      <div className="mt-1">
        <NoteSource>
          Coin Metrics · PriceUSD quotidien · SMA {formatEntier(JOURS_200_SEMAINES)} j = proxy de la moyenne 200
          semaines · des zones, pas des supports : le prix est resté 250 j sous cette moyenne en 2022-23 et la zone
          sous la SMA 2 ans a duré de 1 à 18 mois{notePi} · aucun de ces modèles ne prévoit le prix
        </NoteSource>
      </div>
    </section>
  );
}
