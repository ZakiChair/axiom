/**
 * Section « Mineurs » de CHAIN : Hash Ribbons (SMA 30 / 60 j du hashrate mempool.space,
 * déjà chargé par la fenêtre — aucun second appel) et hashprice (revenus mineurs
 * blockchain.info rapportés au hashrate du même jour UTC).
 *
 * Vue PURE `VueMineurs` (testée en rendu statique) + conteneur `Mineurs` qui charge les
 * revenus à l'ouverture (cache 6 h, dégradation gracieuse dans `data/onchain/mineurs.ts`).
 */
import { useEffect, useState } from "react";
import type { PointMetrique, SerieMetrique } from "../../data/onchain/coinmetrics";
import type { ResultatFrais } from "../../data/onchain/mempool";
import {
  calculerHashprice,
  calculerHashRibbons,
  fetchRevenusMineurs,
  RIBBONS_COURTE,
  RIBBONS_LONGUE,
  type EtatRibbons,
} from "../../data/onchain/mineurs";
import { formatDec, formatUsd } from "../../lib/format";
import { Badge, NoteSource, TitreSection, TuileStat, Vide, type TonBadge } from "../ui";
import { CourbeOnchain, dateObservation, ProvenanceOnchain } from "./HistoriqueCommun";

const ETATS: Record<EtatRibbons, { texte: string; ton: TonBadge }> = {
  capitulation: { texte: "Capitulation", ton: "down" },
  reprise: { texte: "Reprise", ton: "up" },
  expansion: { texte: "Expansion", ton: "neutre" },
};

function ehs(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return "—";
  return `${(v / 1e18).toFixed(1)} EH/s`;
}

export function VueMineurs({
  hashrate,
  revenus,
  loading = false,
}: {
  hashrate: SerieMetrique | null;
  revenus: ResultatFrais<PointMetrique[]> | null;
  loading?: boolean;
}) {
  const points = hashrate?.points ?? [];
  const rubans = calculerHashRibbons(points);
  const hashprice = revenus === null ? null : calculerHashprice(revenus.donnee, points);
  const dernierRevenu = revenus?.donnee.at(-1);
  const etat = rubans.etat === null ? null : ETATS[rubans.etat];

  return (
    <section>
      <TitreSection>Mineurs</TitreSection>
      <div className="grid grid-cols-2 gap-2">
        <TuileStat
          label={`Hash Ribbons (SMA ${RIBBONS_COURTE} / ${RIBBONS_LONGUE} j)`}
          valeur={etat?.texte ?? "—"}
          ton={rubans.etat === "capitulation" ? "down" : rubans.etat === "reprise" ? "up" : undefined}
          badge={etat === null ? undefined : <Badge ton={etat.ton}>hashrate</Badge>}
          pied={
            <>
              <span className="truncate">
                {`courte ${ehs(rubans.courte.at(-1)?.value)} · longue ${ehs(rubans.longue.at(-1)?.value)}`}
              </span>
              <span className="shrink-0">
                {rubans.croisement === null
                  ? ""
                  : `croisement ${rubans.croisement.sens} le ${dateObservation(rubans.croisement.time)}`}
              </span>
            </>
          }
        />
        <TuileStat
          label="Hashprice"
          valeur={hashprice?.dernier === undefined ? "—" : `${formatDec(hashprice.dernier.value, 2)} $/PH/j`}
          couleur="var(--serie-4)"
          pied={
            <>
              <span className="truncate">{`revenus / j ${formatUsd(dernierRevenu?.value)}`}</span>
              <span className="shrink-0">{dernierRevenu === undefined ? "" : dateObservation(dernierRevenu.time)}</span>
            </>
          }
        />
      </div>
      {loading && revenus === null ? (
        <Vide>Chargement des revenus mineurs…</Vide>
      ) : hashprice !== null && hashprice.points.length >= 2 ? (
        <CourbeOnchain points={hashprice.points} label="Hashprice" unite="$/PH/j" />
      ) : revenus === null ? (
        <Vide>Revenus mineurs indisponibles (blockchain.info).</Vide>
      ) : null}
      {revenus !== null && (
        <ProvenanceOnchain
          source="mempool.space + blockchain.info"
          sourceId="blockchain-info"
          observation={dernierRevenu?.time}
          recuperation={revenus.ts}
          perime={revenus.perime}
        />
      )}
      <NoteSource>
        Hash Ribbons : capitulation quand la SMA {RIBBONS_COURTE} j du hashrate passe sous la SMA {RIBBONS_LONGUE} j,
        reprise pendant 30 j après le croisement inverse. Hashprice = revenus quotidiens des mineurs
        (subvention + frais, valorisés au prix du jour) ÷ hashrate moyen du même jour UTC.
      </NoteSource>
    </section>
  );
}

export function Mineurs({ open, hashrate }: { open: boolean; hashrate: ResultatFrais<SerieMetrique> | null }) {
  const [revenus, setRevenus] = useState<ResultatFrais<PointMetrique[]> | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) {
      setRevenus(null);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    void fetchRevenusMineurs(ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      setRevenus(r);
      setLoading(false);
    });
    return () => ctrl.abort();
  }, [open]);
  return <VueMineurs hashrate={hashrate?.donnee ?? null} revenus={revenus} loading={loading} />;
}
