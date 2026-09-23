/** Comparaison de preuves acquises, sans score global ni causalité ajoutée. */
import { statutLectureAnalyse, validerLectureAnalyse, type LectureAnalyse } from "./analyseMultidomaine";
import { referencePrixChaine, type ResultatRotation } from "./onchain/rotationChaines";
import type { ChaineEconomieId } from "./onchain/economieChaines";
import type { PrixRotation } from "./onchain/prixRotation";

const JOUR = 86_400_000;
const EPSILON = 1e-9;
export interface SnapshotAnalyse { schemaVersion: 1; creeLe: number; lectures: LectureAnalyse[] }
export type RegleChangement = "valeur-comparable" | "source-changee" | "unite-changee" | "instrument-change" | "horizon-different" | "methode-changee" | "qualite-insuffisante" | "couverture-changee" | "valeur-inconnue" | "apparition" | "disparition" | "etat-change";
export interface ChangementAnalyse { identite: string; regle: RegleChangement; avant: LectureAnalyse | null; apres: LectureAnalyse | null; delta: number | null; description: string }
export type EtatRotationPrix = "divergence" | "concordance" | "neutre" | "non-comparable";
export interface QualificationRotationPrix { etat: EtatRotationPrix; deltaPartPp: number | null; variationPrixPct: number | null; raison: string }

const objet = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const fini = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const dateRepresentable = (x: unknown): x is number => fini(x) && Number.isFinite(new Date(x).getTime());
const clesExactes = (x: Record<string, unknown>, keys: readonly string[]) => Object.keys(x).length === keys.length && Object.keys(x).every((key) => keys.includes(key));

export function validerSnapshotAnalyse(raw: unknown): SnapshotAnalyse | null {
  if (!objet(raw) || !clesExactes(raw, ["schemaVersion", "creeLe", "lectures"]) || raw.schemaVersion !== 1 || !dateRepresentable(raw.creeLe) || !Array.isArray(raw.lectures) || raw.lectures.length > 50) return null;
  const ids = new Set<string>();
  for (const entree of raw.lectures) {
    const lecture = validerLectureAnalyse(entree);
    if (lecture === null || ids.has(lecture.id) ||
        !dateRepresentable(lecture.horizon.depuis) || !dateRepresentable(lecture.horizon.jusqua) ||
        !dateRepresentable(lecture.recupereLe) || (lecture.observeLe !== null && !dateRepresentable(lecture.observeLe)) ||
        (lecture.validiteJusqua !== null && !dateRepresentable(lecture.validiteJusqua)) ||
        lecture.recupereLe > raw.creeLe || lecture.horizon.jusqua > raw.creeLe || (lecture.observeLe !== null && lecture.observeLe > raw.creeLe)) return null;
    ids.add(lecture.id);
  }
  const snapshot = structuredClone(raw) as unknown as SnapshotAnalyse;
  for (const lecture of snapshot.lectures) lecture.statut = statutLectureAnalyse(lecture, snapshot.creeLe);
  return snapshot;
}

export function creerSnapshotAnalyse(lectures: readonly LectureAnalyse[], creeLe: number): SnapshotAnalyse {
  const snapshot = validerSnapshotAnalyse({ schemaVersion: 1, creeLe, lectures });
  if (snapshot === null) throw new Error("Snapshot d'analyse invalide.");
  return snapshot;
}
export function snapshotAnalyseEnJson(snapshot: SnapshotAnalyse): string { return JSON.stringify(snapshot, null, 2); }
const texteMd = (texte: string) => texte.replace(/[\r\n]+/g, " ").replace(/\|/g, "\\|").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function snapshotAnalyseEnMarkdown(snapshot: SnapshotAnalyse): string {
  const lignes = ["## Analyse multidomaine", "", `Snapshot ${new Date(snapshot.creeLe).toISOString()} · schemaVersion ${snapshot.schemaVersion}`, ""];
  if (snapshot.lectures.length === 0) lignes.push("_Aucune lecture acquise._");
  for (const lecture of snapshot.lectures) {
    const couverture = lecture.couverture ? `${lecture.couverture.presentes}/${lecture.couverture.attendues}` : "inconnue";
    const valeur = lecture.valeur === null ? "—" : `${lecture.valeur} ${lecture.unite ?? ""}`.trim();
    lignes.push(`- **${texteMd(lecture.domaine)}** · ${texteMd(lecture.conclusion)} · ${valeur} · ${lecture.statut} · ${new Date(lecture.horizon.depuis).toISOString()} → ${new Date(lecture.horizon.jusqua).toISOString()} · couverture ${couverture} · source ${texteMd(lecture.source)} · preuve ${lecture.preuve.fenetre}:${texteMd(lecture.preuve.reference)}`);
    for (const limite of lecture.limites) lignes.push(`  - Limite : ${texteMd(limite)}`);
  }
  return lignes.join("\n");
}

/** La famille/zone RATE reste stable lorsque le mois et le quadrant changent. */
export function identiteSemantiqueLecture(lecture: LectureAnalyse): string {
  if (lecture.domaine === "quadrant") return `quadrant:${lecture.preuve.reference}`;
  return `${lecture.domaine}:${lecture.id}`;
}

function methode(lecture: LectureAnalyse): string {
  // Rotation et divergence portent leurs valeurs/dates dans la référence de preuve.
  // Leur identifiant stable encode déjà la définition, la métrique et l'horizon.
  if (lecture.domaine === "rotation" || lecture.domaine === "divergence") return lecture.id;
  // La référence DOM termine par l'instant de calcul ; ce suffixe n'est pas une méthode.
  return lecture.domaine === "liquidite" ? lecture.preuve.reference.replace(/:\d+$/, "") : lecture.preuve.reference;
}
function instrumentEgal(a: LectureAnalyse["instrument"], b: LectureAnalyse["instrument"]): boolean {
  return a === null ? b === null : b !== null && a.symbol === b.symbol && a.source === b.source;
}
function couvertureEgale(a: LectureAnalyse["couverture"], b: LectureAnalyse["couverture"]): boolean {
  return a === null ? b === null : b !== null && a.presentes === b.presentes && a.attendues === b.attendues;
}
function changement(avant: LectureAnalyse | null, apres: LectureAnalyse | null, identite: string): ChangementAnalyse {
  if (!avant) return { identite, regle: "apparition", avant, apres, delta: null, description: "Nouvelle lecture acquise." };
  if (!apres) return { identite, regle: "disparition", avant, apres, delta: null, description: "Lecture absente du snapshot courant." };
  const refuser = (regle: RegleChangement, description: string): ChangementAnalyse => ({ identite, regle, avant, apres, delta: null, description });
  if (avant.nature !== apres.nature || avant.preuve.fenetre !== apres.preuve.fenetre || methode(avant) !== methode(apres)) return refuser("methode-changee", "Définition ou méthode modifiée ; aucun delta chiffré.");
  if (avant.source !== apres.source) return refuser("source-changee", "Source modifiée ; aucun delta chiffré.");
  if (avant.unite !== apres.unite) return refuser("unite-changee", "Unité modifiée ; aucun delta chiffré.");
  if (!instrumentEgal(avant.instrument, apres.instrument)) return refuser("instrument-change", "Instrument ou marché modifié ; aucun delta chiffré.");
  if (avant.horizon.jusqua - avant.horizon.depuis !== apres.horizon.jusqua - apres.horizon.depuis) return refuser("horizon-different", "Durées observées différentes ; aucun delta chiffré.");
  if (avant.statut !== "frais" || apres.statut !== "frais") return refuser("qualite-insuffisante", "Preuve partielle, périmée ou indisponible ; aucun delta chiffré.");
  if (!couvertureEgale(avant.couverture, apres.couverture)) return refuser("couverture-changee", `Couverture ${avant.couverture ? `${avant.couverture.presentes}/${avant.couverture.attendues}` : "inconnue"} → ${apres.couverture ? `${apres.couverture.presentes}/${apres.couverture.attendues}` : "inconnue"} ; aucun delta chiffré.`);
  if (avant.valeur === null || apres.valeur === null) return refuser(avant.conclusion === apres.conclusion ? "valeur-inconnue" : "etat-change", "État qualitatif changé ou valeur numérique inconnue.");
  return { identite, regle: "valeur-comparable", avant, apres, delta: apres.valeur - avant.valeur, description: "Même identité, méthode, source, unité et durée ; delta descriptif." };
}
export function comparerSnapshotsAnalyse(reference: SnapshotAnalyse, courant: SnapshotAnalyse): ChangementAnalyse[] {
  const avant = new Map(reference.lectures.map((lecture) => [identiteSemantiqueLecture(lecture), lecture]));
  const apres = new Map(courant.lectures.map((lecture) => [identiteSemantiqueLecture(lecture), lecture]));
  return [...new Set([...avant.keys(), ...apres.keys()])].map((id) => changement(avant.get(id) ?? null, apres.get(id) ?? null, id));
}

/** Règle nommée TVL30/part de cohorte ↔ prix du token, descriptive seulement. */
export function qualifierRotationPrix(resultat: ResultatRotation, id: ChaineEconomieId, prix: PrixRotation | null): QualificationRotationPrix {
  const ligne = resultat.chaines.find((item) => item.id === id);
  const delta = ligne?.deltaPartPp ?? null;
  const base = { deltaPartPp: delta, variationPrixPct: prix?.variationPct ?? null };
  const indisponible = (raison: string): QualificationRotationPrix => ({ ...base, etat: "non-comparable", raison });
  const symbol = referencePrixChaine(id);
  if (symbol === null) return indisponible("Base n'a pas de token natif de référence.");
  if (resultat.metrique !== "tvl" || resultat.horizonJours !== 30) return indisponible("Règle définie seulement pour TVL sur 30 jours.");
  if (resultat.perime) return indisponible("Dernière journée commune ou source TVL périmée.");
  if (resultat.couverture.presentes !== 4 || resultat.dateDebut === null || resultat.dateFin === null || delta === null || !fini(delta)) return indisponible("Cohorte ou borne de part incomplète.");
  if (prix === null || prix.symbol !== symbol || prix.source !== "Binance spot" || prix.unite !== "USDT" || prix.periode !== "1d" || prix.dateDebut !== resultat.dateDebut || prix.dateFin !== resultat.dateFin || !fini(prix.variationPct) || !fini(prix.prixDebut) || !fini(prix.prixFin) || prix.prixDebut <= 0 || prix.prixFin <= 0 || Math.abs(prix.variationPct - 100 * (prix.prixFin / prix.prixDebut - 1)) > 1e-8) return indisponible("Prix spot de référence absent, incohérent ou dates/source incompatibles.");
  if (Math.abs(delta) <= EPSILON || Math.abs(prix.variationPct) <= EPSILON) return { ...base, etat: "neutre", raison: "Au moins un axe est numériquement nul." };
  return { ...base, etat: Math.sign(delta) === Math.sign(prix.variationPct) ? "concordance" : "divergence", raison: "Comparaison descriptive de deux mesures distinctes aux mêmes dates." };
}

export function lectureDivergenceRotationPrix(qualification: QualificationRotationPrix, resultat: ResultatRotation, id: ChaineEconomieId, prix: PrixRotation | null, recupereLe: number): LectureAnalyse {
  const disponible = qualification.etat !== "non-comparable";
  const symbole = referencePrixChaine(id);
  const depuis = resultat.dateDebut ?? recupereLe;
  const jusqua = resultat.dateFin !== null ? resultat.dateFin + JOUR - 1 : recupereLe;
  const pp = qualification.deltaPartPp === null ? "inconnu" : `${qualification.deltaPartPp.toFixed(2)} pp`;
  const prixPct = qualification.variationPrixPct === null ? "inconnu" : `${qualification.variationPrixPct.toFixed(2)} %`;
  const reference = `${id} TVL30 : Δpart ${pp} (${resultat.dateDebut ?? "?"}→${resultat.dateFin ?? "?"}) ; ${symbole ?? "sans token"} Binance spot 1d : ${prixPct} (${prix?.dateDebut ?? "?"}→${prix?.dateFin ?? "?"})`;
  return { id: `divergence:rotation-prix:tvl:30:${id}`, domaine: "divergence", nature: "observation",
    conclusion: `${id} : ${qualification.etat} descriptive part TVL ${pp} / prix ${symbole ?? "sans token"} ${prixPct}.`,
    tags: [{ cle: "divergence", valeur: `rotation-prix:${id}:${qualification.etat}` }], instrument: symbole ? { symbol: symbole, source: "binance" } : null,
    horizon: { depuis, jusqua }, unite: null, valeur: null, source: symbole ? `${resultat.source} / Binance spot` : resultat.source,
    observeLe: resultat.dateFin !== null ? jusqua : null, recupereLe,
    validiteJusqua: resultat.dateFin !== null ? Math.min(resultat.recupereLe + 3 * JOUR, resultat.dateFin + 4 * JOUR) : null,
    statut: !disponible ? resultat.perime ? "perime" : "indisponible" : "frais",
    couverture: { presentes: disponible ? 2 : Number(qualification.deltaPartPp !== null) + Number(prix !== null), attendues: 2 },
    limites: [qualification.raison, "TVL USD sensible aux prix ; la chaîne et son token sont des objets distincts. Ni transfert de capitaux ni causalité ni recommandation."],
    preuve: { fenetre: "BRIEF", reference } };
}
