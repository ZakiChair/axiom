/** Extraction de données publiées, sans interpréter HTML ou JavaScript. Aucun accès réseau. */
export interface PointGeo { time: number; value: number }
export interface SerieGeo { id: string; nom: string; points: PointGeo[] }

const CONTRATS = {
  gpr: { debut: "1985-01-01", noms: ["GPR", "GPR Threats", "GPR Acts"], ids: ["gpr", "gpr-menaces", "gpr-actes"] },
  tpu: { debut: "1960-01-01", noms: ["TPU Monthly"], ids: ["tpu"] },
} as const;

export function extraireSeriesGeo(html: string, id: "gpr" | "tpu"): SerieGeo[] {
  if (html.length > 16 * 1024 * 1024) throw new Error("Document géopolitique trop volumineux.");
  const contrat = CONTRATS[id];
  const candidats: SerieGeo[][] = [];
  for (const match of html.matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    let data: unknown;
    try { data = (JSON.parse(match[1] ?? "") as { x?: { data?: unknown } })?.x?.data; } catch { continue; }
    if (!Array.isArray(data) || data.length !== contrat.noms.length) continue;
    const traces = data as { name?: unknown; x?: unknown; y?: unknown }[];
    if (!traces.every((t, i) => t.name === contrat.noms[i] && Array.isArray(t.x) && Array.isArray(t.y)
      && t.x.length === t.y.length && t.x.length <= 2400 && t.x[0] === contrat.debut
      && t.x.every(d => typeof d === "string" && /^\d{4}-(0[1-9]|1[0-2])-01$/.test(d)))) continue;
    const series = traces.map((trace, i) => {
      const x = trace.x as string[];
      const y = trace.y as unknown[];
      const points: PointGeo[] = [];
      for (let j = 0; j < x.length; j++) {
        const time = Date.parse(`${x[j]}T00:00:00Z`);
        const value = y[j];
        if (typeof value === "number" && Number.isFinite(value) && Number.isFinite(time)) points.push({ time, value });
      }
      if (points.some((p, j) => j > 0 && p.time <= points[j - 1]!.time)) throw new Error("Série géopolitique non chronologique.");
      return { id: contrat.ids[i]!, nom: contrat.noms[i]!, points };
    });
    if (series.every(s => s.points.length > 0)) candidats.push(series);
  }
  if (candidats.length !== 1) throw new Error("Contrat de la source géopolitique absent ou ambigu.");
  return candidats[0]!;
}

const MOIS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Matrice NY Fed : une seule édition (colonne) pour tout l'historique, sans mélange. */
export function parseGscpi(csv: string): { points: PointGeo[]; millesime: string } {
  const lignes = csv.trim().split(/\r?\n/);
  const colonnes = (lignes.shift() ?? "").replace(/^\uFEFF/, "").split(",");
  if (colonnes[0] !== "Date") throw new Error("En-tête GSCPI inconnu.");
  const editions = colonnes.flatMap((c, i) => {
    const m = /^(\w{3})-(\d{2})$/.exec(c.trim());
    const mois = m ? MOIS.indexOf(m[1]!) : -1;
    return m && mois >= 0 ? [{ colonne: i, time: Date.UTC(2000 + Number(m[2]), mois, 1) }] : [];
  }).sort((a, b) => b.time - a.time);
  const edition = editions[0];
  if (!edition) throw new Error("Millésime GSCPI introuvable.");
  const points = new Map<number, PointGeo>();
  for (const ligne of lignes) {
    const champs = ligne.split(",");
    const d = /^(\d{1,2})-(\w{3})-(\d{4})$/.exec(champs[0]?.trim() ?? "");
    const valeur = champs[edition.colonne]?.trim();
    if (!d || !valeur || !/^-?\d+(?:\.\d+)?$/.test(valeur)) continue;
    const mois = MOIS.indexOf(d[2]!);
    const annee = Number(d[3]), jour = Number(d[1]);
    const date = new Date(Date.UTC(annee, mois, jour));
    if (mois < 0 || date.getUTCMonth() !== mois || date.getUTCDate() !== jour) continue;
    const time = Date.UTC(annee, mois, 1), value = Number(valeur);
    if (Number.isFinite(value)) points.set(time, { time, value });
  }
  if (!points.size) throw new Error("Historique GSCPI vide.");
  return { points: [...points.values()].sort((a, b) => a.time - b.time), millesime: new Date(edition.time).toISOString().slice(0, 7) };
}
