/**
 * Section « Activité DEX » de CHAIN : volume DEX 24 h (DefiLlama, tous protocoles) et sa
 * part du volume total 24 h CEX + DEX (CoinGecko). Vue PURE testée en rendu statique +
 * conteneur qui charge à l'ouverture (cache 1 h dans `data/onchain/volumeDex.ts`).
 */
import { useEffect, useState } from "react";
import type { ResultatFrais } from "../../data/onchain/mempool";
import { calculerPartDex, fetchActiviteDex, type ActiviteDex as DonneesDex } from "../../data/onchain/volumeDex";
import { formatUsd } from "../../lib/format";
import { NoteSource, TitreSection, TuileStat, Vide } from "../ui";
import { CourbeOnchain, ProvenanceOnchain } from "./HistoriqueCommun";

function fmtVariation(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}% 7 j`;
}

export function VueActiviteDex({
  resultat,
  loading = false,
}: {
  resultat: ResultatFrais<DonneesDex> | null;
  loading?: boolean;
}) {
  if (resultat === null) {
    return (
      <section>
        <TitreSection>Activité DEX</TitreSection>
        <Vide>{loading ? "Chargement de l'activité DEX…" : "Activité DEX indisponible (DefiLlama)."}</Vide>
      </section>
    );
  }
  const d = resultat.donnee;
  const part = calculerPartDex(d.dex24h, d.totalVolume24h);
  const tonVariation =
    d.change7dPct === null ? "text-text-dim" : d.change7dPct >= 0 ? "text-up" : "text-down";
  return (
    <section>
      <TitreSection>Activité DEX</TitreSection>
      <div className="grid grid-cols-2 gap-2">
        <TuileStat
          label="Volume DEX 24 h"
          valeur={formatUsd(d.dex24h)}
          couleur="var(--serie-2)"
          pied={
            <>
              <span className="truncate">{d.dex7d === null ? "" : `7 j ${formatUsd(d.dex7d)}`}</span>
              <span className={`shrink-0 ${tonVariation}`}>{fmtVariation(d.change7dPct)}</span>
            </>
          }
        />
        <TuileStat
          label="Part DEX du volume total 24 h"
          valeur={part === null ? "—" : `${part.toFixed(1)} %`}
          couleur="var(--serie-3)"
          pied={
            <span className="truncate">
              {d.totalVolume24h === null
                ? "total 24 h indisponible (CoinGecko)"
                : `total ${formatUsd(d.totalVolume24h)} (CEX + DEX)`}
            </span>
          }
        />
      </div>
      {d.serie.length >= 2 && <CourbeOnchain points={d.serie} label="Volume DEX quotidien" unite="USD" />}
      <ProvenanceOnchain
        source="DefiLlama (DEX) + CoinGecko (total)"
        sourceId="defillama"
        observation={d.serie.at(-1)?.time}
        recuperation={resultat.ts}
        perime={resultat.perime}
      />
      <NoteSource>
        Volume DEX = somme des protocoles suivis par DefiLlama ; total = volume 24 h CEX + DEX publié
        par CoinGecko. La part est une valeur courante : aucun historique du total sans clé.
      </NoteSource>
    </section>
  );
}

export function ActiviteDex({ open }: { open: boolean }) {
  const [resultat, setResultat] = useState<ResultatFrais<DonneesDex> | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) {
      setResultat(null);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    void fetchActiviteDex(ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      setResultat(r);
      setLoading(false);
    });
    return () => ctrl.abort();
  }, [open]);
  return <VueActiviteDex resultat={resultat} loading={loading} />;
}
