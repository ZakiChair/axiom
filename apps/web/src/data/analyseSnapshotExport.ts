/** Sérialisation pure d'un snapshot déjà validé, sans acquisition ni calcul de rotation. */
import type { SnapshotAnalyse } from "./analyseSynthese";

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
