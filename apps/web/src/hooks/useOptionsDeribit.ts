import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchDeribitOptionChain, fetchDvol, type OptionPoint } from "../data/deribit";
import { histDvol } from "../data/referentiels";

export const CADENCE_OPTIONS_MS = 60_000;
const VIDE: OptionPoint[] = [];
type Devise = "BTC" | "ETH";
interface Instantane {
  devise: Devise;
  chaine: OptionPoint[];
  recuLe: number | null;
  erreur: string | null;
  chargement: boolean;
}

/** L'horloge invalide les contrats expirés même quand le réseau ne répond plus. */
export function useOptionsDeribit(devise: Devise, open: boolean) {
  const [etat, setEtat] = useState<Instantane>({ devise, chaine: VIDE, recuLe: null, erreur: null, chargement: false });
  const [vols, setVols] = useState<{ devise: Devise; dvol: number | null; historique: number[] | null }>({ devise, dvol: null, historique: null });
  const [nowMs, setNowMs] = useState(Date.now);
  const chargerRef = useRef<() => void>(() => {});
  const actualiser = useCallback(() => chargerRef.current(), []);

  useEffect(() => {
    if (!open) return;
    let ignore = false;
    let chaineEnVol = false;
    let dvolEnVol = false;
    let historiqueEnVol = false;
    // L'état publié porte toujours sa devise : avant cet effet, le render masque déjà
    // l'instantané de l'autre actif. Une réponse de l'effet précédent est ignorée.
    setEtat((prev) => prev.devise === devise ? prev : { devise, chaine: VIDE, recuLe: null, erreur: null, chargement: true });
    setVols((prev) => prev.devise === devise ? prev : { devise, dvol: null, historique: null });
    const charger = () => {
      if (ignore) return;
      setNowMs(Date.now());
      if (chaineEnVol) return;
      chaineEnVol = true;
      setEtat((prev) => ({ ...prev, chargement: true }));
      void fetchDeribitOptionChain(devise).then((chaine) => {
        if (ignore) return;
        if (chaine.length === 0) throw new Error("Chaîne vide");
        const recuLe = Math.max(...chaine.map((p) => p.receivedAt ?? 0)) || Date.now();
        setEtat({ devise, chaine, recuLe, erreur: null, chargement: false });
        setNowMs(Date.now());
      }).catch(() => {
        if (ignore) return;
        setEtat((prev) => ({ ...prev, erreur: "Actualisation indisponible : chaîne Deribit non reçue.", chargement: false }));
      }).finally(() => { chaineEnVol = false; });
      // Chaque source publie dès sa réception ; une source lente ne retient pas la chaîne.
      if (!dvolEnVol) {
        dvolEnVol = true;
        void fetchDvol(devise).then((dvol) => {
          if (!ignore) setVols((prev) => ({ ...prev, devise, dvol }));
        }).catch(() => {
          if (!ignore) setVols((prev) => ({ ...prev, devise, dvol: null }));
        }).finally(() => { dvolEnVol = false; });
      }
      if (!historiqueEnVol) {
        historiqueEnVol = true;
        void histDvol(devise).then((historique) => {
          if (!ignore) setVols((prev) => ({ ...prev, devise, historique: historique?.map((p) => p.v) ?? null }));
        }).catch(() => {
          if (!ignore) setVols((prev) => ({ ...prev, devise, historique: null }));
        }).finally(() => { historiqueEnVol = false; });
      }
    };
    chargerRef.current = charger;
    const revenir = () => {
      if (document.visibilityState === "visible") charger();
    };
    charger();
    const poll = setInterval(charger, CADENCE_OPTIONS_MS);
    const horloge = setInterval(() => setNowMs(Date.now()), 15_000);
    window.addEventListener("focus", revenir);
    document.addEventListener("visibilitychange", revenir);
    return () => {
      ignore = true;
      chargerRef.current = () => {};
      clearInterval(poll);
      clearInterval(horloge);
      window.removeEventListener("focus", revenir);
      document.removeEventListener("visibilitychange", revenir);
    };
  }, [devise, open]);

  const memeDevise = etat.devise === devise;
  const chaineRecue = memeDevise ? etat.chaine : VIDE;
  const chaine = useMemo(() => chaineRecue.filter((p) => p.expiryMs > nowMs), [chaineRecue, nowMs]);
  const prochaine = chaine.reduce((min, p) => Math.min(min, p.expiryMs), Infinity);
  useEffect(() => {
    if (!open || !Number.isFinite(prochaine)) return;
    // Limite setTimeout : les échéances longues ne doivent pas provoquer une boucle 1 ms.
    const delai = Math.min(2_147_483_647, Math.max(0, prochaine - Date.now()) + 1);
    const timer = setTimeout(() => {
      setNowMs(Date.now());
      if (Date.now() >= prochaine) actualiser();
    }, delai);
    return () => clearTimeout(timer);
  }, [open, prochaine, actualiser]);

  const observations = chaineRecue.map((p) => p.observedAt).filter((t): t is number => t !== undefined && Number.isFinite(t) && t > 0);
  return {
    chaine, nowMs, actualiser,
    majTs: memeDevise ? etat.recuLe : null,
    observedAt: observations.length === chaineRecue.length && observations.length > 0 ? Math.min(...observations) : null,
    erreur: memeDevise ? etat.erreur : null,
    loading: !memeDevise || etat.chargement,
    dvol: vols.devise === devise ? vols.dvol : null,
    dvolHistorique: vols.devise === devise ? vols.historique : null,
  };
}
