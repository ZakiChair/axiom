import { createStore } from "zustand/vanilla";
import { chargerEconomieChaines, type EconomieChainesResultat } from "../data/onchain/economieChaines";
import { enregistrerQualite } from "./qualiteMetriques";

interface EtatEconomieChaines { donnees: EconomieChainesResultat | null; chargement: boolean; erreur: string | null }
export const economieChainesStore = createStore<EtatEconomieChaines>(() => ({ donnees: null, chargement: false, erreur: null }));

let consommateurs = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let controleur: AbortController | null = null;
let travail: Promise<void> | null = null;

export function actualiserEconomieChaines(): Promise<void> {
  if (travail && !controleur?.signal.aborted) return travail;
  controleur = new AbortController();
  const local = controleur;
  economieChainesStore.setState({ chargement: true, erreur: null });
  const promesse = chargerEconomieChaines({ signal: local.signal }).then((donnees) => {
    if (local.signal.aborted) return;
    const now = Date.now();
    for (const chaine of donnees.chaines) {
      for (const [id, serie] of Object.entries({ tvl: chaine.tvl, dex: chaine.dex, stablecoins: chaine.stablecoins, frais: chaine.frais, revenus: chaine.revenus })) {
        enregistrerQualite(`chain:economie:${chaine.id}:${id}`, `${chaine.libelle} · ${id}`, {
          sourceId: `defillama:${id}`, sourceEffective: serie.repli ? `cache ${serie.source}` : serie.source,
          observeLe: serie.resume.observeLe, recupereLe: serie.recupereLe, cadenceMs: 86_400_000,
          couverture: null, estime: false, acces: serie.disponible ? "public" : "indisponible",
          statut: !serie.disponible ? "indisponible" : serie.perime || serie.resume.observeLe === null || serie.resume.observeLe > now || now - serie.resume.observeLe > 3 * 86_400_000 ? "perime" : "frais",
          ...(serie.raison ? { raison: serie.raison } : serie.resume.observeLe !== null && (serie.resume.observeLe > now || now - serie.resume.observeLe > 3 * 86_400_000) ? { raison: serie.resume.observeLe > now ? "Observation datée dans le futur" : "Dernière observation trop ancienne" } : {}),
        });
      }
    }
    economieChainesStore.setState({ donnees, chargement: false, erreur: null });
  }).catch((erreur: unknown) => {
    if (!local.signal.aborted) economieChainesStore.setState({ chargement: false, erreur: erreur instanceof Error ? erreur.message : "Économie des chaînes indisponible" });
  }).finally(() => {
    if (controleur === local) controleur = null;
    if (travail === promesse) travail = null;
  });
  travail = promesse;
  return travail;
}

export function retenirEconomieChaines(): () => void {
  consommateurs += 1;
  if (timer === null) {
    void actualiserEconomieChaines();
    timer = setInterval(() => void actualiserEconomieChaines(), 60 * 60_000);
  }
  let libere = false;
  return () => {
    if (libere) return;
    libere = true;
    consommateurs = Math.max(0, consommateurs - 1);
    if (consommateurs === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
      controleur?.abort();
      controleur = null;
      travail = null;
    }
  };
}
