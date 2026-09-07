import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import {
  BG_STH_REALIZED_PRICE, BG_LTH_REALIZED_PRICE, BG_REALIZED_CAP, BG_SUPPLY_PROFIT, BG_SUPPLY_LOSS,
  BG_EXCHANGE_NETFLOW, BG_EXCHANGE_RESERVE, chargerBgeometricMetrique, type BgChargement, type DefMetriqueBg,
} from "../../data/onchain/bgeometrics";
import { ecartPrixRealise, offreEnProfit, variationCalendaire } from "../../data/onchain/cohorts";
import { subscribeTickers } from "../../data/ticker";
import { bgeometricsKeyStore, getBgeometricsKey } from "../../store/onchain";
import { settingsUiStore } from "../../store/settings-ui";
import { formatUsd } from "../../lib/format";
import { Badge, NoteSource, TitreSection, TuileStat, Vide } from "../ui";
import { boutonHistorique, CourbeOnchain, dateObservation, ProvenanceOnchain, valeurUnite } from "./HistoriqueCommun";

const GROUPES = {
  cohortes: { label: "Cohortes", defs: [BG_STH_REALIZED_PRICE, BG_LTH_REALIZED_PRICE], unite: "USD" },
  capital: { label: "Capital réalisé", defs: [BG_REALIZED_CAP], unite: "USD" },
  offre: { label: "Profit / perte", defs: [BG_SUPPLY_PROFIT, BG_SUPPLY_LOSS], unite: "BTC" },
  exchanges: { label: "Exchanges", defs: [BG_EXCHANGE_NETFLOW, BG_EXCHANGE_RESERVE], unite: "BTC" },
} satisfies Record<string, { label: string; defs: DefMetriqueBg[]; unite: string }>;
type Groupe = keyof typeof GROUPES;

export function CohortesBtc({ open }: { open: boolean }) {
  const [groupe, setGroupe] = useState<Groupe | null>(null);
  const [resultats, setResultats] = useState<Record<string, BgChargement>>({});
  // L'objet change aussi lors du remplacement d'une clé déjà présente.
  const cleEtat = useStore(bgeometricsKeyStore);
  const [spot, setSpot] = useState<{ prix: number; ts: number } | null>(null);
  const spotRecu = useRef<typeof spot>(null);
  const [maintenant, setMaintenant] = useState(Date.now);
  useEffect(() => {
    if (!open || !groupe) return;
    const ctrl = new AbortController(); setResultats({});
    for (const def of GROUPES[groupe].defs) {
      void chargerBgeometricMetrique(def, getBgeometricsKey(), ctrl.signal).then(r => {
        if (!ctrl.signal.aborted) setResultats(anciens => ({ ...anciens, [def.id]: r }));
      });
    }
    return () => ctrl.abort();
  }, [open, groupe, cleEtat]);
  useEffect(() => {
    if (!open || groupe !== "cohortes") return;
    setSpot(null); spotRecu.current = null;
    const stop = subscribeTickers(["BTC/USD"], t => {
      if (t.price > 0 && Number.isFinite(t.price)) spotRecu.current = { prix: t.price, ts: Date.now() };
    }, { source: "coinbase" });
    // Le flux écrit une ref ; React reçoit au plus une publication par seconde.
    const timer = setInterval(() => { setSpot(spotRecu.current); setMaintenant(Date.now()); }, 1000);
    return () => { stop(); clearInterval(timer); };
  }, [open, groupe]);
  const selection = groupe ? GROUPES[groupe] : null;
  const prixSpot = spot && maintenant - spot.ts <= 90_000 ? spot.prix : null;
  const capital = resultats[BG_REALIZED_CAP.id]?.resultat;
  const profit = resultats[BG_SUPPLY_PROFIT.id]?.resultat;
  const perte = resultats[BG_SUPPLY_LOSS.id]?.resultat;
  const offre = offreEnProfit(profit?.serie.points ?? [], perte?.serie.points ?? []);
  return <section>
    <TitreSection>Cohortes et flux BTC</TitreSection>
    <div className="flex flex-wrap gap-1">
      {(Object.keys(GROUPES) as Groupe[]).map(id => <button key={id} type="button" className={boutonHistorique}
        aria-pressed={groupe === id} onClick={() => setGroupe(id === groupe ? null : id)}>{GROUPES[id].label}</button>)}
    </div>
    {!selection ? <NoteSource>Charger un groupe à la demande · cache 24 h · quota BGeometrics partagé avec les graphiques.</NoteSource> : <div className="mt-2 space-y-2">
      {groupe === "cohortes" && <NoteSource>Spot BTC/USD · Coinbase : {formatUsd(prixSpot ?? undefined)} · {spot && prixSpot !== null ? `reçu à ${new Date(spot.ts).toLocaleTimeString("fr-FR")}` : "en attente ou périmé"}.
        Écart du spot courant au prix réalisé quotidien (coût d'acquisition on-chain de la cohorte).</NoteSource>}
      <div className="grid grid-cols-2 gap-2">
        {selection.defs.map(def => {
          const chargement = resultats[def.id]; const r = chargement?.resultat;
          const distance = groupe === "cohortes" ? ecartPrixRealise(prixSpot, r?.serie.dernier?.value ?? null) : null;
          return <div key={def.id} className="min-w-0 space-y-1">
            <TuileStat label={def.libelle} valeur={selection.unite === "USD" ? formatUsd(r?.serie.dernier?.value) : valeurUnite(r?.serie.dernier?.value, selection.unite)}
              badge={r?.perime ? <Badge ton="warn">périmé</Badge> : undefined}
              pied={groupe === "cohortes" ? `Écart spot : ${distance === null ? "—" : `${distance >= 0 ? "+" : ""}${distance.toFixed(2)} %`}` : undefined} />
            {r && <CourbeOnchain points={r.serie.points} label={def.libelle} unite={selection.unite} zero={def.id === "exchangeNetflow"} />}
            {!chargement ? <Vide>Chargement…</Vide> : chargement.raison ? <NoteSource>{chargement.raison}</NoteSource> : null}
            {r && <ProvenanceOnchain source="BGeometrics" observation={r.serie.dernier?.time} recuperation={r.ts} perime={r.perime} />}
          </div>;
        })}
        {groupe === "capital" && [30, 90].map(jours => {
          const v = variationCalendaire(capital?.serie.points ?? [], jours);
          return <TuileStat key={jours} label={`Variation ${jours} jours`} valeur={formatUsd(v?.absolue)}
            pied={v ? `${v.pct === null ? "—" : `${v.pct.toFixed(2)} %`} · ${dateObservation(v.debut)} → ${dateObservation(v.fin)}` : "Historique insuffisant : date de référence absente"} />;
        })}
        {groupe === "offre" && <TuileStat label="Part de l'offre en profit" valeur={offre ? `${offre.pct.toFixed(2)} %` : "—"}
          pied={offre ? `Profit / (profit + perte) · ${dateObservation(offre.time)}` : "Attente d'observations à date commune"} />}
      </div>
      {groupe === "exchanges" ? <>
        <button type="button" className={boutonHistorique} onClick={() => settingsUiStore.getState().openSettings()}>Clé BGeometrics ⚙</button>
        <NoteSource>Accès avec abonnement éligible. Netflow = entrées moins sorties des adresses labellisées exchanges (BTC).
          Les labels sont incomplets et révisables ; une entrée ne prouve pas une vente. Les réserves suivent le périmètre du fournisseur.</NoteSource>
      </> : <NoteSource>Mesures quotidiennes BGeometrics, révisables. STH : détenteurs court terme ; LTH : long terme.
        Les calculs conservent les dates publiées et restent absents si les références manquent.</NoteSource>}
    </div>}
  </section>;
}
