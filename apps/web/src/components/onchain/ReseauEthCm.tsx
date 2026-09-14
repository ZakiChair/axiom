import type { ResultatFrais } from "../../data/onchain/mempool";
import type { ReseauEthCm, VariationReserve } from "../../data/onchain/reseauEthCm";
import { metaSource } from "../../lib/fiabilite";
import { formatDec, formatEntier, formatPct, formatPourcentage, formatPrice } from "../../lib/format";
import { Badge, BadgeFiabilite, NoteSource, TuileStat, Vide } from "../ui";
import { VueFluxNetExchanges } from "./FluxNetExchanges";
import { ProvenanceOnchain, valeurUnite } from "./HistoriqueCommun";

const usd = (v: number | null) => (v === null ? "—" : `$${formatPrice(v)}`);
const signe = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${formatEntier(v)} ETH`);

/** Variation en % suivie du drapeau de périmètre : marche détectée ou contrôle impossible. */
function variation(v: VariationReserve | undefined): string {
  if (v === undefined) return "—";
  const drapeau = v.marche === true ? " (périmètre)" : v.marche === null && v.pct !== null ? " (non contrôlé)" : "";
  return `${formatPct(v.pct)}${drapeau}`;
}

/**
 * Sous-bloc Coin Metrics de la section RÉSEAU ETH (sous les tuiles Etherscan) : réserve et
 * variations des exchanges, émission nette, prix réalisé reconstitué, flux nets. Vue pure.
 */
export function VueReseauEthCm({ resultat, loading = false }: { resultat: ResultatFrais<ReseauEthCm> | null; loading?: boolean }) {
  const sousTitre = <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-text-dim">Coin Metrics Community</p>;
  if (resultat === null) {
    return <>{sousTitre}<Vide>{loading ? "Chargement Coin Metrics ETH…" : "Réseau ETH Coin Metrics indisponible."}</Vide></>;
  }
  const { reserve, fluxNet, emission, prixRealise: p, flash, derniereObservation } = resultat.donnee;
  const fiabilite = <BadgeFiabilite meta={metaSource("coinmetrics")} />;
  const badgeFlash = <>{fiabilite}{flash && <Badge ton="warn">flash</Badge>}</>;
  const [v30, v90, v365] = reserve?.variations ?? [];
  return <div className="space-y-2">
    {sousTitre}
    <div className="grid grid-cols-2 gap-2">
      <TuileStat label="Réserve exchanges ETH" valeur={valeurUnite(reserve?.stockEth, "ETH")} badge={badgeFlash}
        pied={`${formatPourcentage(reserve?.partOffrePct)} de l'offre`} />
      <TuileStat label="Variation de la réserve (30 j)" valeur={variation(v30)} badge={badgeFlash}
        title={`Écart Δréserve − Σflux net : 30 j ${signe(v30?.ecartPerimetre ?? null)} · 90 j ${signe(v90?.ecartPerimetre ?? null)} · 365 j ${signe(v365?.ecartPerimetre ?? null)}`}
        pied={`90 j ${variation(v90)} · 365 j ${variation(v365)}`} />
      <TuileStat label="Émission nette ETH (30 j)" valeur={emission.pctAn30 === null ? "—" : `${formatPct(emission.pctAn30)}/an`} badge={fiabilite}
        pied={`7 j ${formatPct(emission.pctAn7)}/an · 365 j ${formatPct(emission.pctAn365)}/an · frais totaux 30 j ${emission.fraisTotaux30Eth === null ? "—" : `${formatEntier(emission.fraisTotaux30Eth)} ETH`}`} />
      <TuileStat label="Prix réalisé ETH" valeur={usd(p.prixRealiseUsd)} badge={fiabilite}
        pied={`spot CM ${usd(p.spotCmUsd)} · écart ${formatPct(p.ecartSpotPct)} · MVRV ${formatDec(p.mvrv, 2)}`} />
    </div>
    <VueFluxNetExchanges actif="ETH" net={fluxNet} flash={flash} />
    <ProvenanceOnchain source="Coin Metrics Community · labels Coin Metrics" sourceId="coinmetrics"
      observation={derniereObservation ?? undefined} recuperation={resultat.ts} perime={resultat.perime} />
    <NoteSource>Périmètre d'adresses révisable : le stock labellisé change par marches ; « (périmètre) » signale un jour de
      l'horizon où Δréserve − flux net dépasse 0,5 % du stock, « (non contrôlé) » un jour manquant. Statut flash : flux et
      réserve récents révisables ; une entrée ne prouve pas une vente. Émission nette = variation annualisée de l'offre ;
      frais totaux = frais payés (base et priorité). Prix réalisé reconstitué : capitalisation ÷ MVRV ÷ offre, au même jour.</NoteSource>
  </div>;
}
