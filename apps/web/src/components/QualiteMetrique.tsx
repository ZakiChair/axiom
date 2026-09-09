import { actualiserQualite, type QualiteMetrique as Qualite } from "../data/qualiteMetrique";
import { useHorloge } from "../lib/horloge";
import { Badge } from "./ui";

const formatDateUtc = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
});

function dateOuTiret(ts: number | null): string {
  return ts === null || !Number.isFinite(ts) ? "—" : `${formatDateUtc.format(ts)} UTC`;
}

function cadence(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "cadence inconnue";
  if (ms >= 86_400_000) return `${Math.round(ms / 86_400_000)} j`;
  if (ms >= 3_600_000) return `${Math.round(ms / 3_600_000)} h`;
  return `${Math.round(ms / 60_000)} min`;
}

export function QualiteMetrique({ qualite: releve }: { qualite: Qualite }) {
  const now = useHorloge();
  const qualite = actualiserQualite(releve, now);
  const ton = qualite.statut === "frais" ? "neutre" : qualite.statut === "indisponible" ? "down" : "warn";
  return (
    <div className="space-y-0.5 text-[10px] leading-snug text-text-dim">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge ton={ton}>{qualite.statut}</Badge>
        <span>{qualite.sourceEffective}</span>
        <span>· {qualite.acces}</span>
        {qualite.estime ? <Badge ton="warn">estimé</Badge> : null}
      </div>
      <div className="flex flex-wrap gap-x-2">
        <span>observé {dateOuTiret(qualite.observeLe)}</span>
        <span>récupéré {dateOuTiret(qualite.recupereLe)}</span>
        <span>cadence {cadence(qualite.cadenceMs)}</span>
        {qualite.couverture ? <span>couverture {qualite.couverture.disponibles}/{qualite.couverture.attendus}</span> : null}
      </div>
      {qualite.raison ? <p className={qualite.statut === "frais" ? "" : "text-warn"}>{qualite.raison}</p> : null}
    </div>
  );
}
