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
          </li>
        ))}
      </ul>

      <p className="text-[10px] text-text-dim">
        Moyenne des composants disponibles. La volatilité pèse deux notes (implicite et
        réalisée) et les deux sont corrélées : en régime de stress elles chargent le score
        dans le même sens.
      </p>
    </section>
  );
}
