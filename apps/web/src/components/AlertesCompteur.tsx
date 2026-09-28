import { useStore } from "zustand";
import { alerteActiveAuTemps } from "@axiom/alerts";
import { alertsStore } from "../store/alerts";
import { useExpirationClock } from "../alerts/useExpirationClock";

/** Même définition d'une alerte effective pour le bandeau et les favoris. */
export function compterAlertesActives(defs: readonly { actif: boolean; expireTs?: number }[], maintenant = Date.now()): number {
  let n = 0;
  for (const d of defs) if (alerteActiveAuTemps(d, maintenant)) n += 1;
  return n;
}

export function AlertesCompteur() {
  const defs = useStore(alertsStore, (s) => s.defs);
  const maintenant = useExpirationClock(defs);
  return <div className="flex items-center gap-1 tabular-nums" title="Nombre d'alertes actives">
    <span className="uppercase tracking-[0.08em]">Alertes</span>
    <span className="font-medium text-text">{compterAlertesActives(defs, maintenant)}</span>
  </div>;
}
