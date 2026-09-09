/**
 * Bloc « RÉGIME · composite » du BRIEF (D1) — le raisonnement du score, enfin visible.
 *
 * Le détail des huit composants n'existait que dans l'attribut `title` de la pastille du
 * SessionStrip : huit fragments concaténés sur une ligne, infobulle système tronquée par
 * l'écran, non copiable, inatteignable au clavier, invisible au tactile. Et le clic sur
 * cette pastille ouvrait BRIEF… qui n'affichait justement pas la décomposition : la
 * promesse « clic = détail » n'était pas tenue.
 *
 * Le bloc porte aussi les deux choses que le score taisait :
 *  - sa COUVERTURE (« 6/8 composants ») — un score sur trois notes s'affichait
 *    exactement comme un score sur huit, alors que la panne partielle est le cas
 *    nominal ;
 *  - son ÉCHELLE (−2..+2), écrite noir sur blanc dans le formulaire d'alerte, jamais là
 *    où on lit la valeur.
 *
 * (revue du 2026-08-01 § 6.4)
 */
import type { Regime } from "../../data/regime";
import { fiabiliteRegime, SCORE_MAX, SCORE_MIN, tonRegime } from "../../data/regime";
import { Badge, Fraicheur, TitreSection } from "../ui";
import { useStore } from "zustand";
import { qualiteMetriquesStore } from "../../store/qualiteMetriques";
import { QualiteMetrique } from "../QualiteMetrique";

/** Classes de ton du libellé de régime — littérales, pour survivre à la purge Tailwind. */
const CLASSE_TON_REGIME: Record<"up" | "down" | "neutre", string> = {
  up: "text-up",
  down: "text-down",
  neutre: "text-text",
};

/** Ton du badge d'une note : la note EST un signe, elle se lit comme telle. */
function tonNote(note: number | null): "up" | "down" | "neutre" {
  if (note === null) return "neutre";
  if (note > 0) return "up";
  if (note < 0) return "down";
  return "neutre";
}

export function SectionRegime({ regime, majTs }: { regime: Regime | null; majTs: number | null }) {
  const registreQualite = useStore(qualiteMetriquesStore, (s) => s.metriques);
  const qualites = Object.entries(registreQualite)
    .filter(([id]) => id.startsWith("regime:"))
    .sort(([a], [b]) => a.localeCompare(b));
  if (regime === null) return null;
  const { couverture } = regime;
  const fiabilite = fiabiliteRegime(couverture);

  return (
    <section className="space-y-1.5">
      <div className="flex flex-wrap items-baseline gap-2">
        <TitreSection>Régime · composite</TitreSection>
        {/* Couverture : ce que le score a réellement pu lire. */}
        <Badge
          ton={fiabilite === "complet" ? "neutre" : fiabilite === "partiel" ? "warn" : "down"}
          title={
            fiabilite === "complet"
              ? "Toutes les sources ont répondu."
              : fiabilite === "partiel"
                ? "Certaines sources n'ont pas répondu : le score porte sur moins de composants."
                : "Trop peu de composants disponibles — le score serait du bruit."
          }
        >
          {couverture.disponibles}/{couverture.total} composants
        </Badge>
        <span className="ml-auto text-[10px] text-text-dim">
          {/* La fraîcheur du chapeau vient de SON poller, pas du « Rafraîchir » du BRIEF
              (qui ne pilote que les sections réseau). `majTs` était écrit à chaque cycle
              et lu par personne. */}
          <Fraicheur loading={false} majTs={majTs} cadence="15 min" cadenceMs={15 * 60_000} />
        </span>
      </div>

      <div className="flex items-baseline gap-2">
        {/* Classe LITTÉRALE, jamais construite : Tailwind scanne la source et ne verrait
            pas `text-${…}` — la classe serait purgée du CSS et le libellé rendu sans
            couleur (piège classique). */}
        <span className={`text-sm font-semibold ${CLASSE_TON_REGIME[tonRegime(regime.libelle)]}`}>
          {regime.libelle}
        </span>
        {/* Pas de chiffre en « indéterminé » : sous MIN_COMPOSANTS le score serait du
            bruit, et le SessionStrip le supprime déjà — les deux surfaces doivent dire
            la même chose. */}
        {regime.libelle !== "indéterminé" && (
          <>
            <span className="tabular-nums text-sm text-text">
              {regime.score >= 0 ? "+" : ""}
              {regime.score.toFixed(2)}
            </span>
            <span className="text-[10px] text-text-dim">
              sur une échelle {SCORE_MIN} à +{SCORE_MAX}
            </span>
          </>
        )}
      </div>

      <ul className="space-y-0.5">
        {regime.composants.map((c) => (
          <li key={c.id} className="flex items-center gap-2 text-[11px]">
            <span className="min-w-0 flex-1 truncate text-text-dim">{c.libelle}</span>
            <span className="tabular-nums text-text">{c.detail}</span>
            <Badge ton={tonNote(c.note)}>
              {c.note === null ? "—" : c.note > 0 ? `+${c.note}` : String(c.note)}
            </Badge>
            <span className="w-28 text-right tabular-nums text-[10px] text-text-dim">
              {c.contribution === null || c.contribution === undefined
                ? "—"
                : `${c.note}/${couverture.disponibles} = ${c.contribution >= 0 ? "+" : ""}${c.contribution.toFixed(2)}`}
            </span>
          </li>
        ))}
      </ul>

      <div className="grid gap-1 rounded border border-border bg-bg px-2 py-1.5 text-[10px] text-text-dim md:grid-cols-2">
        <span>
          Signes : +{regime.signes.positifs} / −{regime.signes.negatifs} / 0 {regime.signes.neutres}
          {` · ${regime.signes.opposes} paire(s) opposée(s)`}
        </span>
        <span>
          Vol corrélée : {regime.poidsVolatilite.disponibles}/{regime.poidsVolatilite.totalDisponibles}
          {` (${(regime.poidsVolatilite.fraction * 100).toFixed(0)} % du poids disponible)`}
        </span>
        <span className="md:col-span-2">
          Stabilité seuils −20 % / référence / +20 % : {regime.stabilite.seuilsMoins20} / {regime.stabilite.reference} / {regime.stabilite.seuilsPlus20}
          {regime.stabilite.stable ? " · stable" : " · verdict sensible"}
        </span>
        <span className="md:col-span-2">
          Paliers bas/haut testés : 0,32/0,96 · 0,40/1,20 · 0,48/1,44, avec le même score observé.
        </span>
      </div>

      {regime.sensibiliteGamma && (
        <div className="rounded border border-border bg-bg px-2 py-1.5 text-[10px] text-text-dim">
          <span className="font-medium text-text">Gamma : </span>
          {regime.sensibiliteGamma.lectures.map((h) => `${h.libelle} = ${h.regime}`).join(" · ")}
          {regime.sensibiliteGamma.change ? " · verdict sensible à l’hypothèse" : " · verdict invariant"}
          <span> · scénarios non observés</span>
        </div>
      )}

      {qualites.length > 0 ? (
        <details open={qualites.some(([, entree]) => entree.qualite.statut !== "frais")} className="rounded border border-border bg-bg px-2 py-1.5">
          <summary className="cursor-pointer text-[10px] font-medium text-text-dim">Qualité des métriques lentes</summary>
          <div className="mt-1.5 grid gap-1.5 md:grid-cols-2">
            {qualites.map(([id, entree]) => (
              <div key={id} className="rounded bg-surface px-2 py-1">
                <p className="text-[10px] font-medium text-text">{entree.libelle}</p>
                <QualiteMetrique qualite={entree.qualite} />
              </div>
            ))}
          </div>
        </details>
      ) : null}

      <p className="text-[10px] text-text-dim">
        Moyenne des composants disponibles. La volatilité pèse deux notes (implicite et
        réalisée) et les deux sont corrélées : en régime de stress elles chargent le score
        dans le même sens.
      </p>
    </section>
  );
}
