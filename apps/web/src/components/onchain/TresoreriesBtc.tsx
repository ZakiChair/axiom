/**
 * Tuile « Trésoreries d'entreprises BTC » de CHAIN (sous les flux de capitaux) : stock détenu par
 * les sociétés cotées, prix de revient de Strategy et coût pondéré, sociétés sous leur coût et
 * sensibilité à −10/−20/−30 %. Données déclaratives CoinGecko non horodatées (badge partiel
 * permanent). Vue PURE testée en rendu statique + conteneur qui charge à l'ouverture
 * (un appel, cache 6 h dans `data/onchain/tresoreriesBtc.ts`).
 */
import { useEffect, useState } from "react";
import type { ResultatFrais } from "../../data/onchain/mempool";
import { qualiteTresoreriesBtc } from "../../data/onchain/qualiteChain";
import {
  accesTresoreries,
  chargerTresoreriesBtcAvecRaison,
  resumerTresoreries,
  SYMBOLE_STRATEGY,
  type ChargeTresoreries,
  type TresoreriesBtc as DonneesTresoreries,
} from "../../data/onchain/tresoreriesBtc";
import type { MetaFiabilite } from "../../lib/fiabilite";
import { formatEntier, formatPct, formatPourcentage, formatPrice } from "../../lib/format";
import { enregistrerQualite } from "../../store/qualiteMetriques";
import { Badge, BadgeFiabilite, NoteSource, TitreSection, TuileStat, Vide } from "../ui";
import { dateObservation } from "./HistoriqueCommun";

/** Méta locale : CoinGecko n'est pas au catalogue de fiabilité (« source inconnue » sinon). */
const META_TRESORERIES: MetaFiabilite = {
  niveau: "partiel",
  label: "avoirs déclaratifs non horodatés (jusqu'à J-14)",
  detail: "Avoirs et coûts d'entrée déclarés par les sociétés cotées, compilés par CoinGecko sans date de mise à jour ; déclarations jusqu'à J-14 constatées.",
};

const usd = (v: number | null | undefined) => (v == null ? "—" : `$${formatPrice(v)}`);
const societes = (n: number) => `${n} société${n > 1 ? "s" : ""}`;

export function VueTresoreriesBtc({
  resultat,
  loading = false,
  raison,
}: {
  resultat: ResultatFrais<DonneesTresoreries> | null;
  loading?: boolean;
  /** Motif du dernier échec CoinGecko (code HTTP, réseau, réponse illisible). */
  raison?: string;
}) {
  const titre = (
    <TitreSection extra={<BadgeFiabilite meta={META_TRESORERIES} />}>Trésoreries d'entreprises BTC</TitreSection>
  );
  if (resultat === null) {
    return (
      <section>
        {titre}
        <Vide>{loading ? "Chargement des trésoreries CoinGecko…" : `Trésoreries d'entreprises indisponibles (${raison ?? "CoinGecko"}).`}</Vide>
      </section>
    );
  }
  const r = resumerTresoreries(resultat.donnee);
  const s = r.strategy;
  const seuil = s?.seuilSousCoutPct ?? null;
  return (
    <section>
      {titre}
      <div className="grid grid-cols-2 gap-2">
        <TuileStat
          label="Total détenu"
          valeur={`${formatEntier(r.totalBtc)} BTC`}
          couleur="var(--serie-1)"
          pied={<span className="truncate">{`${societes(r.nbSocietes)} détentrice${r.nbSocietes > 1 ? "s" : ""}`}</span>}
        />
        <TuileStat
          label="Strategy"
          valeur={s === null ? "—" : `${formatEntier(s.avoirsBtc)} BTC`}
          couleur="var(--serie-2)"
          extra={
            <span className="text-[10px] text-text-dim">
              {seuil === null ? "" : seuil >= 0 ? "déjà sous son coût" : `passe sous son coût à ${formatPct(seuil)}`}
            </span>
          }
          pied={
            <span className="truncate">
              {s === null
                ? `absente de la liste CoinGecko (${SYMBOLE_STRATEGY})`
                : s.coutMoyenUsd == null ? "coût non publié" : `coût moyen ${usd(s.coutMoyenUsd)} · prix implicite ${formatPct(s.ecartSpotPct)}`}
            </span>
          }
        />
        <TuileStat
          label="Coût pondéré (coût connu)"
          valeur={usd(r.coutPondereUsd)}
          couleur="var(--serie-3)"
          pied={
            <span className="truncate">
              {`${societes(r.nbAvecCout)} · couverture ${formatPourcentage(r.couvertureCoutPct)} des BTC`}
            </span>
          }
        />
        <TuileStat
          label="Sous leur coût"
          valeur={r.sousCout === null ? "—" : societes(r.sousCout.societes)}
          couleur="var(--serie-4)"
          pied={<span className="truncate">{r.sousCout === null ? "" : `${formatEntier(r.sousCout.btc)} BTC`}</span>}
        />
        <div className="col-span-2">
          <TuileStat
            label="Sensibilité : sous leur coût si le prix baisse"
            valeur={usd(r.spotImpliciteUsd)}
            extra={<span className="text-[10px] text-text-dim">prix implicite CoinGecko</span>}
            pied={
              r.sensibilite.length === 0 ? (
                <span>Prix de comparaison indisponible : aucun décompte calculé.</span>
              ) : (
                <ul className="space-y-0.5">
                  {r.sensibilite.map((p) => (
                    <li key={p.baissePct} className="tabular-nums">
                      {`−${p.baissePct} % (${usd(p.prixUsd)}) : ${societes(p.societes)} · ${formatEntier(p.btc)} BTC`}
                    </li>
                  ))}
                </ul>
              )
            }
          />
        </div>
      </div>
      <NoteSource>
        Avoirs et coûts d'entrée déclarés par les sociétés cotées, compilés par CoinGecko sans date de mise à jour
        (déclarations jusqu'à J-14). Coût moyen historique, pas un seuil de liquidation ; prix de comparaison = prix
        implicite CoinGecko (valeur ÷ avoirs), pas un cours live. Coût retenu entre 1 000 et 200 000 $/BTC : les
        sociétés sans coût publié ou aberrant sont exclues du coût pondéré et des décomptes.
        {` · CoinGecko · récupéré ${dateObservation(resultat.ts)}`}
        {resultat.perime && <> · <Badge ton="warn">cache périmé</Badge>{raison ? ` · ${raison}` : ""}</>}
      </NoteSource>
    </section>
  );
}

export function TresoreriesBtc({ open }: { open: boolean }) {
  const [charge, setCharge] = useState<ChargeTresoreries | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) {
      setCharge(null);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    // Un abandon (fermeture) rejette l'attente : ni état ni qualité publiés pour ce cycle.
    void chargerTresoreriesBtcAvecRaison(ctrl.signal).then((c) => {
      setCharge(c);
      setLoading(false);
      enregistrerQualite("chain:tresoreries-btc", "Trésoreries BTC · CoinGecko", qualiteTresoreriesBtc(c.resultat, accesTresoreries(), c.raison));
    }, () => {});
    return () => ctrl.abort();
  }, [open]);
  return <VueTresoreriesBtc resultat={charge?.resultat ?? null} loading={loading} raison={charge?.raison} />;
}
