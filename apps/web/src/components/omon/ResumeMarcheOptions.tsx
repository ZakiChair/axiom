import type { EcheanceMarcheOptions, MarcheOptions } from "../../data/marcheOptions";
import { formatDec, formatPourcentage, formatUsd } from "../../lib/format";
import { Bouton, Badge } from "../ui";
import { TableTriable, type ColonneTable } from "../TableTriable";

interface Props {
  compacte?: boolean;
  devise: "BTC" | "ETH";
  resume: MarcheOptions;
  loading: boolean;
  erreur: string | null;
  majTs: number | null;
  observedAt: number | null;
  nowMs: number;
  onRefresh: () => void;
}

const heure = (t: number) => new Date(t).toLocaleTimeString("fr-FR", { timeZone: "UTC" }) + " UTC";
const date = (t: number) => new Date(t).toLocaleDateString("fr-FR", { timeZone: "UTC", day: "2-digit", month: "short", year: "2-digit" });

const COLONNES: ColonneTable<EcheanceMarcheOptions>[] = [
  { id: "echeance", label: "Échéance UTC", largeur: "88px", rendu: (e) => <span className="whitespace-nowrap">{date(e.expiryMs)}{e.nbOiInconnus > 0 && <span className="ml-1 text-warn" title={`${e.nbOiInconnus} options avec OI inconnu`}>*</span>}</span> },
  { id: "part", label: "Part OI", align: "right", largeur: "54px", rendu: (e) => formatPourcentage(e.partOiPct, 1) },
  { id: "oi", label: "OI $", align: "right", largeur: "68px", rendu: (e) => formatUsd(e.oiUsd) },
  { id: "pc", label: "P/C", align: "right", largeur: "36px", rendu: (e) => formatDec(e.pcOi, 2) },
  { id: "gex", label: "GEX $/1 %", align: "right", largeur: "78px", rendu: (e) => formatUsd(e.gexUsd) },
  { id: "dex", label: "DEX $", align: "right", largeur: "78px", rendu: (e) => formatUsd(e.dexUsd) },
];

export function ResumeMarcheOptions({ compacte = false, devise, resume, loading, erreur, majTs, observedAt, nowMs, onRefresh }: Props) {
  const age = majTs === null ? null : nowMs - Math.min(majTs, observedAt ?? majTs);
  const perime = age !== null && age > 4 * 60_000;
  const present = majTs !== null && resume.echeances.length > 0;
  // Tolère seulement le bruit d’addition flottante, pas une vraie lacune masquée par l’arrondi.
  const couverturePartielle = resume.couvertureOiPct !== null && resume.couvertureOiPct < 100 - 1e-9;
  const couvertureCompacte = resume.couvertureOiPct === null ? "indisponible"
    : couverturePartielle && resume.couvertureOiPct.toFixed(1) === "100.0" ? "<100 %"
    : formatPourcentage(resume.couvertureOiPct, 1);
  const avertissementCouverture = resume.nbOiInconnus > 0
    ? <p className="mt-1 text-[10px] text-warn">Couverture partielle : OI inconnu pour {resume.nbOiInconnus} options. Montants et parts portent sur l’OI connu.</p>
    : null;
  const perimetre = <p className="mt-2 text-[10px] leading-relaxed text-text-dim">Options inverses Deribit uniquement ; les autres places et les options USDC sont exclues. OI valorisé à l’index {devise}/USD. Expositions modélisées, positions dealers inconnues. Aucun comparatif avant/après expiration sans historique.</p>;
  const contexte = (
    <>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 tabular-nums">
        <div className="flex justify-between gap-1"><dt className="text-text-dim">OI notionnel</dt><dd>{formatUsd(resume.oiUsd)}</dd></div>
        <div className="flex justify-between gap-1"><dt className="text-text-dim">P/C OI</dt><dd>{formatDec(resume.pcOi, 2)}</dd></div>
        <div className="flex justify-between gap-1"><dt className="text-text-dim">Échéances actives</dt><dd>{resume.echeances.length}</dd></div>
        {!compacte && <div className="flex justify-between gap-1" title="Part de l'OI connu dont IV, forward et index permettent de calculer les greeks."><dt className="text-text-dim">Greeks / OI connu</dt><dd>{formatPourcentage(resume.couvertureOiPct, 1)}</dd></div>}
      </dl>
      {!compacte && avertissementCouverture}
      {resume.dominante && <p className="mt-2 text-[10px] text-text-dim">Concentration : {formatPourcentage(resume.dominante.partOiPct, 1)} de l’OI au {date(resume.dominante.expiryMs)}.</p>}
      <p className="mt-0.5 text-[10px] text-text-dim">Sous 7 jours : {formatPourcentage(resume.courtTerme.partOiPct, 1)} de l’OI · GEX {formatUsd(resume.courtTerme.gexUsd)}/1 %.</p>
      {resume.prochaineEcheance !== null && <p className="mt-0.5 text-[10px] text-text-dim">Prochaine échéance : {date(resume.prochaineEcheance)} à 08:00 UTC.</p>}
      <details className="mt-2 border-t border-border pt-1.5">
        <summary className="cursor-pointer text-text-dim">Expositions par échéance ({resume.echeances.length}) <Badge>calls + / puts −</Badge></summary>
        <div className="mt-1 overflow-x-auto">
          <div className="min-w-[470px]">
            <TableTriable colonnes={COLONNES} lignes={resume.echeances}
              cle={(e) => String(e.expiryMs)} ariaLabel="Expositions par échéance" maxHauteur="12rem"
              titreLigne={(e) => `Greeks : ${formatPourcentage(e.couvertureOiPct, 1)} de l'OI connu de cette échéance`} />
          </div>
        </div>
      </details>
    </>
  );
  const heures = (
    <div className={compacte ? "flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-dim" : "mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-dim"}>
        <span>Observé : {observedAt === null ? "heure non fournie" : <time dateTime={new Date(observedAt).toISOString()} title={new Date(observedAt).toISOString()}>{heure(observedAt)}</time>}</span>
        <span>Reçu : {majTs === null ? "—" : <time data-reception dateTime={new Date(majTs).toISOString()} title={new Date(majTs).toISOString()}>{heure(majTs)}</time>}</span>
        <span>Calculé : {heure(nowMs)}</span>
        {compacte && present && <span title="Part de l'OI connu dont IV, forward et index permettent de calculer les greeks.">
          Greeks / OI connu : {couvertureCompacte}
          {couverturePartielle && " (partiel)"}
        </span>}
      </div>
  );
  return (
    <section aria-label={`Marché options ${devise}`} className={compacte ? "mb-2 rounded-md border border-border bg-bg px-2 py-1.5 text-[11px]" : "mb-3 rounded-md border border-border bg-bg p-2.5 text-[11px]"}>
      <div className={compacte ? "flex flex-wrap items-center gap-x-3 gap-y-1" : "flex flex-wrap items-center justify-between gap-2"}>
        <span className={compacte ? "whitespace-nowrap font-medium text-text" : "font-medium text-text"}>Deribit {devise}{compacte && " · inverses"}</span>
        {compacte && heures}
        <Bouton className={compacte ? "ml-auto" : undefined} onClick={onRefresh} disabled={loading} aria-label="Actualiser les options">{loading ? "Chargement…" : "↻ Actualiser"}</Bouton>
      </div>
      {!compacte && heures}
      {perime && <p className="mt-1 text-warn" role="status">Instantané périmé : plus de 4 min sans données récentes.</p>}
      {erreur && <p className="mt-1 text-warn" role="status">{erreur} {majTs !== null ? "Dernier instantané conservé ; échéances expirées retirées." : "Données indisponibles."}</p>}
      {compacte && present && avertissementCouverture}
      {!present ? (
        <p className="mt-2 text-text-dim">{loading ? "Chargement de la chaîne d’options…" : majTs === null ? "Données indisponibles." : "Aucune échéance active dans le dernier instantané."}</p>
      ) : compacte ? (
        <details className="mt-1 border-t border-border pt-0.5">
          <summary className="cursor-pointer text-text-dim">Contexte de chaîne</summary>
          {contexte}
          {perimetre}
        </details>
      ) : contexte}
      {!compacte && perimetre}
    </section>
  );
}
