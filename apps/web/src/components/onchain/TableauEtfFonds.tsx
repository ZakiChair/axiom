/**
 * Tableau compact « ETF spot par fonds » de CHAIN : les champs SoSoValue déjà reçus avec le
 * flux du jour (aucun appel supplémentaire — cf. `parseEtfFlows`). Quatre colonnes
 * (Fonds · Flux jour · Prime/décote · Encours), le reste (part de la capitalisation, cumul,
 * volume, frais) en infobulle `title` par ligne ; pied « Cumul <jour> » (le total existant)
 * puis ligne globale (encours total, avoirs en unités de l'actif, part de la capitalisation)
 * uniquement si ces champs existent — une entrée de cache antérieure n'en porte aucun.
 * Ordre des lignes = celui de `parEmetteur` (|flux| décroissant), jamais retrié ici.
 * Composant PUR (rendu statique testé) ; toute valeur absente s'affiche « — », jamais 0.
 */
import type { ActifEtf, EtfResultat, FluxEmetteur } from "../../data/onchain/etf";
import { formatEntier, formatPct, formatPourcentage, formatUsd } from "../../lib/format";
import { valeurUnite } from "./HistoriqueCommun";

const CELLULE_NOMBRE = "text-right tabular-nums";
const ENTETE = "text-[10px] text-text-dim";

/** Infobulle d'un fonds : uniquement les champs présents ; `undefined` (attribut omis) si aucun. */
function infobulleFonds(e: FluxEmetteur, unite: string): string | undefined {
  const parts: string[] = [];
  if (e.partCapitalisationPct !== undefined) parts.push(`${formatPourcentage(e.partCapitalisationPct)} de la capitalisation ${unite}`);
  if (e.cumulUsd !== undefined) parts.push(`cumul ${formatUsd(e.cumulUsd)}`);
  if (e.volumeUsd !== undefined) parts.push(`volume ${formatUsd(e.volumeUsd)}`);
  if (e.fraisPct !== undefined) parts.push(`frais ${formatPourcentage(e.fraisPct)}`);
  return parts.length === 0 ? undefined : parts.join(" · ");
}

/** Infobulle de la ligne globale : cumul et volume tous fonds, avoirs exacts — s'ils existent. */
function infobulleGlobale(etf: EtfResultat, unite: string): string | undefined {
  const parts: string[] = [];
  if (etf.cumulTotalUsd !== undefined) parts.push(`cumul ${formatUsd(etf.cumulTotalUsd)}`);
  if (etf.volumeTotalUsd !== undefined) parts.push(`volume ${formatUsd(etf.volumeTotalUsd)}`);
  if (etf.avoirsTotal !== undefined) parts.push(`avoirs ${formatEntier(etf.avoirsTotal)} ${unite}`);
  return parts.length === 0 ? undefined : parts.join(" · ");
}

export function TableauEtfFonds({ etf, actif }: { etf: EtfResultat; actif: ActifEtf }) {
  const unite = actif.toUpperCase();
  const ligneGlobale =
    etf.encoursTotalUsd !== undefined || etf.avoirsTotal !== undefined || etf.partCapitalisationTotalePct !== undefined;
  return (
    <div className="rounded-md border border-border bg-bg px-3 py-2 text-[11px]">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-2 gap-y-0.5">
        <span className={ENTETE}>Fonds</span>
        <span className={`${ENTETE} text-right`}>Flux jour</span>
        <span className={`${ENTETE} text-right`}>Prime/décote</span>
        <span className={`${ENTETE} text-right`}>Encours</span>
        {(etf.parEmetteur ?? []).map((e) => (
          // `contents` : la ligne ne crée pas de boîte, ses cellules restent alignées sur la
          // grille commune ; l'infobulle posée ici couvre toute la ligne.
          <div key={e.emetteur} className="contents" title={infobulleFonds(e, unite)}>
            <span className="truncate text-text-dim">{e.emetteur}</span>
            <span className={`${CELLULE_NOMBRE} ${e.flux >= 0 ? "text-up" : "text-down"}`}>{formatUsd(e.flux)}</span>
            <span className={CELLULE_NOMBRE}>{formatPct(e.primeDecotePct)}</span>
            <span className={CELLULE_NOMBRE}>{formatUsd(e.encoursUsd)}</span>
          </div>
        ))}
      </div>
      <div className="mt-1 flex items-center justify-between border-t border-border pt-1 font-medium">
        <span className="text-text">Cumul {etf.jour ?? ""}</span>
        <span className="tabular-nums text-text">{formatUsd(etf.total)}</span>
      </div>
      {ligneGlobale && (
        <div className="mt-0.5 flex flex-wrap justify-between gap-x-2 text-text-dim" title={infobulleGlobale(etf, unite)}>
          <span>Encours total</span>
          <span className="tabular-nums">
            {`${formatUsd(etf.encoursTotalUsd)} · avoirs ${valeurUnite(etf.avoirsTotal, unite)} · ${formatPourcentage(etf.partCapitalisationTotalePct)} de la capitalisation`}
          </span>
        </div>
      )}
    </div>
  );
}
