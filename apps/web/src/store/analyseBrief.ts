/** Instantané affiché et référence explicite du BRIEF ; seule la référence est persistée. */
import { createStore } from "zustand/vanilla";
import type { LectureAnalyse } from "../data/analyseMultidomaine";
import { creerSnapshotAnalyse, validerSnapshotAnalyse, type SnapshotAnalyse } from "../data/analyseSynthese";
import { lectureDivergenceRotationPrix, qualifierRotationPrix } from "../data/analyseSynthese";
import { capturerLectures, remplacerLectures } from "./analyseMultidomaine";
import type { ResultatQuadrants } from "../data/macro/quadrants";
import type { RegionMacro } from "../data/macro/catalogueMacro";
import type { EconomieChainesResultat, ChaineEconomieId } from "../data/onchain/economieChaines";
import type { PrixRotation } from "../data/onchain/prixRotation";

export const CLE_ANALYSE_BRIEF = "axiom:analyseBrief:v1";
interface EtatAnalyseBrief {
  courant: SnapshotAnalyse | null;
  reference: SnapshotAnalyse | null;
  pending: SnapshotAnalyse | null;
  erreur: string | null;
  archiveInvalide: string | null;
  chargements: { quadrant: "attente" | "chargement" | "partiel" | "pret" | "erreur"; rotation: "attente" | "chargement" | "pret" | "erreur"; divergence: "attente" | "chargement" | "pret" | "erreur" };
  macroZones: { total: number; pretes: number; attente: number; indisponibles: number };
  publierCourant: (lectures: readonly LectureAnalyse[], creeLe: number) => boolean;
  chargerReference: () => void;
  enregistrerReference: () => boolean;
  reessayerSauvegarde: () => boolean;
  autoriserRemplacementArchive: () => void;
}
const copie = (snapshot: SnapshotAnalyse) => structuredClone(snapshot);

export const analyseBriefStore = createStore<EtatAnalyseBrief>((set, get) => ({
  courant: null, reference: null, pending: null, erreur: null, archiveInvalide: null,
  chargements: { quadrant: "attente", rotation: "attente", divergence: "attente" },
  macroZones: { total: 0, pretes: 0, attente: 0, indisponibles: 0 },
  publierCourant(lectures, creeLe) {
    try {
      const courant = creerSnapshotAnalyse(lectures, creeLe);
      set({ courant, erreur: null });
      return true;
    } catch {
      set({ erreur: "Instantané d'analyse invalide ; état affiché précédent conservé." });
      return false;
    }
  },
  chargerReference() {
    try {
      const brut = localStorage.getItem(CLE_ANALYSE_BRIEF);
      if (brut === null) { set({ reference: null, archiveInvalide: null, erreur: null }); return; }
      let parse: unknown;
      try { parse = JSON.parse(brut) as unknown; } catch { set({ archiveInvalide: brut, erreur: "Archive d'analyse illisible ; contenu original conservé." }); return; }
      const reference = validerSnapshotAnalyse(parse);
      if (reference === null) { set({ archiveInvalide: brut, erreur: "Archive d'analyse invalide ; contenu original conservé." }); return; }
      set({ reference, archiveInvalide: null, erreur: null });
    } catch { set({ erreur: "Lecture de la référence impossible ; ancienne référence en mémoire conservée." }); }
  },
  enregistrerReference() {
    const courant = get().courant;
    if (!courant) { set({ erreur: "Aucun instantané affiché à enregistrer." }); return false; }
    if (get().archiveInvalide !== null) { set({ erreur: "Archive invalide conservée ; exportez-la puis autorisez son remplacement." }); return false; }
    const candidat = copie(courant);
    try {
      localStorage.setItem(CLE_ANALYSE_BRIEF, JSON.stringify(candidat));
      set({ reference: candidat, pending: null, erreur: null });
      return true;
    } catch {
      set({ pending: candidat, erreur: "Sauvegarde impossible ; référence précédente conservée. Réessayez." });
      return false;
    }
  },
  reessayerSauvegarde() {
    const candidat = get().pending;
    if (!candidat || get().archiveInvalide !== null) return false;
    try {
      localStorage.setItem(CLE_ANALYSE_BRIEF, JSON.stringify(candidat));
      set({ reference: copie(candidat), pending: null, erreur: null });
      return true;
    } catch { set({ erreur: "Nouvelle tentative de sauvegarde impossible ; ancienne référence conservée." }); return false; }
  },
  autoriserRemplacementArchive() {
    set({ archiveInvalide: null, erreur: "Archive illisible toujours sur disque jusqu'à une nouvelle sauvegarde explicite." });
  },
}));

export interface ChargeursAnalyseBrief {
  chargerMacro?: (region: RegionMacro, signal: AbortSignal) => Promise<ResultatQuadrants | null>;
  regionsMacro?: readonly RegionMacro[];
  delaiMacroMs?: number;
  chargerEconomie?: () => Promise<EconomieChainesResultat | null>;
  chargerPrix?: (id: ChaineEconomieId, debut: number, fin: number, maintenant: number) => Promise<PrixRotation | null>;
  maintenant?: () => number;
}
let generation = 0;
let controleur: AbortController | null = null;
const IDS_PRIX = ["ethereum", "solana", "arbitrum"] as const;

async function macroParDefaut(region: RegionMacro, signal: AbortSignal): Promise<ResultatQuadrants | null> {
  const { chargerQuadrants } = await import("../data/macro/quadrants");
  if (signal.aborted) return null;
  return chargerQuadrants({ regions: [region], connuLe: null, signal });
}
async function economieParDefaut(): Promise<EconomieChainesResultat | null> {
  const { actualiserEconomieChaines, economieChainesStore } = await import("./economieChaines");
  await actualiserEconomieChaines();
  return economieChainesStore.getState().donnees;
}
async function prixParDefaut(id: ChaineEconomieId, debut: number, fin: number, maintenant: number): Promise<PrixRotation | null> {
  const { chargerPrixRotation } = await import("../data/onchain/prixRotation");
  return chargerPrixRotation(id, debut, fin, maintenant);
}

export function annulerActualisationAnalyseBrief(): void {
  generation += 1;
  controleur?.abort();
  controleur = null;
  analyseBriefStore.setState({ chargements: { quadrant: "attente", rotation: "attente", divergence: "attente" }, macroZones: { total: 0, pretes: 0, attente: 0, indisponibles: 0 } });
}

/** Actualise les seules familles macro/on-chain à la demande ; DOM/GLOBE restent acquis. */
export async function actualiserAnalyseBrief(chargeurs: ChargeursAnalyseBrief = {}): Promise<void> {
  const numero = ++generation;
  controleur?.abort();
  const ctrl = new AbortController();
  controleur = ctrl;
  const now = chargeurs.maintenant ?? Date.now;
  const actif = () => generation === numero && !ctrl.signal.aborted;
  const publier = (): void => {
    if (!actif()) return;
    const instant = now();
    analyseBriefStore.getState().publierCourant(capturerLectures(instant), instant);
  };
  analyseBriefStore.setState({ chargements: { quadrant: "chargement", rotation: "chargement", divergence: "chargement" }, macroZones: { total: 0, pretes: 0, attente: 0, indisponibles: 0 } });
  publier();
  const macro = (async () => {
    try {
      const [{ ORDRE_REGIONS }, { lecturesQuadrants }] = await Promise.all([import("../data/macro/catalogueMacro"), import("../data/macro/quadrants")]);
      if (!actif()) return;
      const regions = chargeurs.regionsMacro ?? ORDRE_REGIONS;
      const delai = Number.isFinite(chargeurs.delaiMacroMs) ? Math.max(1, chargeurs.delaiMacroMs!) : 120_000;
      const terminees = new Map<RegionMacro, "prete" | "indisponible">();
      const locaux = new Set<AbortController>();
      const annulerLocaux = () => { for (const local of locaux) local.abort(); };
      ctrl.signal.addEventListener("abort", annulerLocaux, { once: true });
      analyseBriefStore.setState((s) => ({ macroZones: { total: regions.length, pretes: 0, attente: regions.length, indisponibles: 0 }, chargements: { ...s.chargements, quadrant: regions.length ? "chargement" : "erreur" } }));
      const actualiserProgression = () => {
        const pretes = [...terminees.values()].filter((etat) => etat === "prete").length;
        const indisponibles = terminees.size - pretes;
        const attente = regions.length - terminees.size;
        const statut = attente > 0 ? pretes > 0 ? "partiel" : "chargement" : indisponibles === 0 ? "pret" : pretes > 0 ? "partiel" : "erreur";
        analyseBriefStore.setState((s) => ({ macroZones: { total: regions.length, pretes, attente, indisponibles }, chargements: { ...s.chargements, quadrant: statut } }));
      };
      try {
        await Promise.all(regions.map(async (region) => {
          const local = new AbortController();
          locaux.add(local);
          if (ctrl.signal.aborted) local.abort();
          type Issue = { type: "resultat"; valeur: ResultatQuadrants | null } | { type: "erreur" | "delai" | "annule" };
          let timer: ReturnType<typeof setTimeout> | undefined;
          let annuler = () => {};
          const limite = new Promise<Issue>((resolve) => {
            annuler = () => resolve({ type: "annule" });
            local.signal.addEventListener("abort", annuler, { once: true });
            timer = setTimeout(() => { resolve({ type: "delai" }); local.abort(); }, delai);
            if (local.signal.aborted) annuler();
          });
          const acquisition: Promise<Issue> = Promise.resolve().then(() => local.signal.aborted ? { type: "annule" } as Issue : (chargeurs.chargerMacro ?? macroParDefaut)(region, local.signal).then((valeur): Issue => ({ type: "resultat", valeur }), (): Issue => ({ type: "erreur" }))).catch((): Issue => ({ type: "erreur" }));
          const issue = await Promise.race([acquisition, limite]);
          if (timer !== undefined) clearTimeout(timer);
          local.signal.removeEventListener("abort", annuler);
          locaux.delete(local);
          if (!actif()) return;
          const zone = issue.type === "resultat" ? issue.valeur?.regions.find((item) => item.region === region) : null;
          const lectures = zone && issue.type === "resultat" && issue.valeur ? lecturesQuadrants({ ...issue.valeur, regions: [zone] }) : [];
          if (lectures.length > 0) {
            const reference = `production-aa-${region.toLowerCase()}/cpi-aa-${region.toLowerCase()}`;
            const autres = capturerLectures(now()).filter((lecture) => lecture.domaine === "quadrant" && lecture.preuve.reference !== reference);
            remplacerLectures("quadrant", [...autres, ...lectures]);
            publier();
          }
          terminees.set(region, lectures.some((lecture) => lecture.statut !== "indisponible") ? "prete" : "indisponible");
          actualiserProgression();
        }));
      } finally {
        ctrl.signal.removeEventListener("abort", annulerLocaux);
        annulerLocaux();
      }
    } catch {
      if (actif()) analyseBriefStore.setState((s) => ({ chargements: { ...s.chargements, quadrant: "erreur" } }));
    }
  })();
  const onchain = (async () => {
    try {
      const donnees = await (chargeurs.chargerEconomie ?? economieParDefaut)();
      if (!actif()) return;
      if (donnees === null) throw new Error("Économie des chaînes indisponible.");
      const { calculerRotationChaines, lectureRotation } = await import("../data/onchain/rotationChaines");
      if (!actif()) return;
      const rotation = calculerRotationChaines(donnees, "tvl", 30, now());
      remplacerLectures("divergence", []);
      remplacerLectures("rotation", rotation.chaines.map((chaine) => lectureRotation(rotation, chaine.id)));
      analyseBriefStore.setState((s) => ({ chargements: { ...s.chargements, rotation: "pret" } }));
      publier();
      const prix = new Map<ChaineEconomieId, PrixRotation | null>();
      if (!rotation.perime && rotation.dateDebut !== null && rotation.dateFin !== null) {
        await Promise.all(IDS_PRIX.map(async (id) => {
          let value: PrixRotation | null = null;
          try { value = await (chargeurs.chargerPrix ?? prixParDefaut)(id, rotation.dateDebut!, rotation.dateFin!, now()); }
          catch { /* une seule source prix en panne ne masque pas les autres */ }
          prix.set(id, value);
        }));
      }
      if (!actif()) return;
      remplacerLectures("divergence", rotation.chaines.map((chaine) => {
        const p = prix.get(chaine.id) ?? null;
        return lectureDivergenceRotationPrix(qualifierRotationPrix(rotation, chaine.id, p), rotation, chaine.id, p, now());
      }));
      analyseBriefStore.setState((s) => ({ chargements: { ...s.chargements, divergence: "pret" } }));
      publier();
    } catch {
      if (actif()) analyseBriefStore.setState((s) => ({ chargements: { ...s.chargements, rotation: "erreur", divergence: "erreur" } }));
    }
  })();
  await Promise.allSettled([macro, onchain]);
  if (actif()) controleur = null;
}
