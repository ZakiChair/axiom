/** NBS Chine : catalogue public vérifié le 7 septembre 2026. POST de lecture strictement borné. */
export const NBS_HOST = "data.stats.gov.cn";
export const NBS_CHEMIN = "/dg/website/publicrelease/web/external/stream/esData";
export const NBS_RACINE = "fc982599aa684be7969d7b90b1bd0e84";
export type SerieNbs = "core-cpi-aa" | "ppi-aa" | "chomage" | "production-aa";
export interface RequeteNbs {
  cid: string;
  indicatorIds: [string];
  daCatalogId: "";
  das: [{ text: "全国"; value: "000000000000" }];
  showType: "1";
  dts: [string];
  rootId: typeof NBS_RACINE;
}
interface SegmentNbs { cid: string; indicateur: string; debut?: number; fin?: number }
/** Indices CPI/PPI = même mois de l'année précédente 100 ; chômage/IP = % natif. */
export const CATALOGUE_NBS: Record<SerieNbs, readonly SegmentNbs[]> = {
  "core-cpi-aa": [
    { cid: "809d2522b0fe4be89142650341b19083", indicateur: "c2050e97c49a4763a6d0f0f38bf0b4ed", debut: 2021 * 12, fin: 2025 * 12 + 11 },
    { cid: "5c7452825c7c4dcba391db5ca7f335c5", indicateur: "71be3d43d2fb44188199840272463ae0", debut: 2026 * 12 },
  ],
  "ppi-aa": [{ cid: "60e8b361f11c4a878c652a6487a25561", indicateur: "150633e52b9a470a9a9fd1b296dd6c5b" }],
  chomage: [{ cid: "ee3b7046b390415b9b7745e3d16f6052", indicateur: "3888eac6062945a79c8a27e5f13d4953" }],
  "production-aa": [{ cid: "3f2e14f0542348ed9fe02476eca3450b", indicateur: "ef1b1765960d45a29b4d7c4ca91be916" }],
};
const numeroMois = (ms: number): number => { const d = new Date(ms); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
const codeMois = (n: number): string => `${Math.floor(n / 12)}${String(n % 12 + 1).padStart(2, "0")}MM`;
/** Une ou plusieurs requêtes, chaque corps <= 121 observations mensuelles (écart 120 mois). */
export function construireRequetesNbs(serie: SerieNbs, debutMs: number, finMs: number): RequeteNbs[] {
  const debut = numeroMois(debutMs);
  const fin = numeroMois(finMs);
  if (!Number.isFinite(debut) || !Number.isFinite(fin) || debut > fin) return [];
  return CATALOGUE_NBS[serie].flatMap((segment) => {
    const resultat: RequeteNbs[] = [];
    const borneFin = Math.min(fin, segment.fin ?? fin);
    for (let borne = Math.max(debut, segment.debut ?? debut); borne <= borneFin; borne += 121) {
      resultat.push({ cid: segment.cid, indicatorIds: [segment.indicateur], daCatalogId: "", das: [{ text: "全国", value: "000000000000" }], showType: "1", dts: [`${codeMois(borne)}-${codeMois(Math.min(borne + 120, borneFin))}`], rootId: NBS_RACINE });
    }
    return resultat;
  });
}
/** Pas d'URL, d'expression ni de dimension libre ; utilisé par les trois proxys. */
export function validerRequeteNbs(body: unknown, nowMs = Date.now()): body is RequeteNbs {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const r = body as Record<string, unknown>;
  const cles = ["cid", "indicatorIds", "daCatalogId", "das", "showType", "dts", "rootId"];
  if (Object.keys(r).length !== cles.length || !cles.every((c) => Object.hasOwn(r, c))) return false;
  if (r.daCatalogId !== "" || r.showType !== "1" || r.rootId !== NBS_RACINE) return false;
  if (!Array.isArray(r.indicatorIds) || r.indicatorIds.length !== 1) return false;
  const segment = Object.values(CATALOGUE_NBS).flat().find((s) => s.cid === r.cid && s.indicateur === (r.indicatorIds as unknown[])[0]);
  if (!segment || !Array.isArray(r.das) || r.das.length !== 1) return false;
  const zone = r.das[0] as Record<string, unknown> | null;
  if (!zone || typeof zone !== "object" || Object.keys(zone).length !== 2 || zone.text !== "全国" || zone.value !== "000000000000") return false;
  if (!Array.isArray(r.dts) || r.dts.length !== 1 || typeof r.dts[0] !== "string") return false;
  const dates = /^(\d{4})(0[1-9]|1[0-2])MM-(\d{4})(0[1-9]|1[0-2])MM$/.exec(r.dts[0]);
  if (!dates) return false;
  const debut = Number(dates[1]) * 12 + Number(dates[2]) - 1;
  const fin = Number(dates[3]) * 12 + Number(dates[4]) - 1;
  return debut >= 1900 * 12 && debut <= fin && fin - debut <= 120 && fin <= numeroMois(nowMs)
    && debut >= (segment.debut ?? debut) && fin <= (segment.fin ?? fin);
}
