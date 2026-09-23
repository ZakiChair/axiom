import { useEffect, useState } from "react";
import { echeanceAlerteValide } from "@axiom/alerts";

type AlerteDatee = { actif: boolean; expireTs?: number };
const AUCUN_SCAN: readonly AlerteDatee[] = [];

/** L'affichage d'une pause datée doit aussi basculer à « expirée ». */
function prochaineEcheanceVisuelle(defs: readonly AlerteDatee[], maintenant: number): number | null {
  let prochaine: number | null = null;
  for (const def of defs) {
    if (!echeanceAlerteValide(def) || def.expireTs === undefined || def.expireTs <= maintenant) continue;
    if (prochaine === null || def.expireTs < prochaine) prochaine = def.expireTs;
  }
  return prochaine;
}

/** Horloge basse fréquence : re-render seulement au changement d'état ou à l'échéance. */
export function useExpirationClock(
  defs: readonly AlerteDatee[],
  scans: readonly AlerteDatee[] = AUCUN_SCAN,
): number {
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => { setMaintenant(Date.now()); }, [defs, scans]);
  useEffect(() => {
    const actualiser = (): void => setMaintenant(Date.now());
    const now = Date.now();
    const alertes = [...defs, ...scans];
    // L'échéance peut passer entre le rendu et l'armement : aucun timer futur ne
    // resterait alors pour corriger un état affiché encore antérieur à cette borne.
    if (alertes.some((def) => echeanceAlerteValide(def) && def.expireTs !== undefined &&
      maintenant < def.expireTs && def.expireTs <= now)) setMaintenant(now);
    const prochaine = prochaineEcheanceVisuelle(alertes, now);
    const timer = prochaine === null ? undefined : setTimeout(
      actualiser, Math.min(2_147_483_647, Math.max(1, prochaine - now)),
    );
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", actualiser);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", actualiser);
    };
  }, [defs, scans, maintenant]);
  return maintenant;
}
