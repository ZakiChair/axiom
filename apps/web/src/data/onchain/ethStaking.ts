import { ecrireCache, estFrais, lireCache } from "./cache";
import { dateOnchain, nombreOnchain } from "./cohorts";

export const ETH_STAKING_SOURCE = "https://raw.githubusercontent.com/etheralpha/validatorqueue-com/main/historical_data.json";
export interface PointEthStaking { time: number; entreeEth: number; sortieEth: number; attenteEntreeJours: number;
  attenteSortieJours: number; stakeEth: number; stakePct: number; aprPct: number | null }
export interface EthStakingResultat { points: PointEthStaking[]; ts: number; perime: boolean; raison?: string }
/** Historique quotidien depuis la correction post-Pectra ; les files sont déjà en ETH. */
export function parseEthStaking(json: unknown, maintenant = Date.now()): PointEthStaking[] {
  const points = new Map<number, PointEthStaking>();
  if (!Array.isArray(json)) return [];
  for (const row of json.slice(-5000)) {
    if (!row || typeof row !== "object") continue;
    const time = dateOnchain(row.date);
    if (time === null || time < Date.UTC(2025, 4, 22) || time > maintenant) continue;
    const valeurs = [row.entry_queue, row.exit_queue, row.entry_wait, row.exit_wait, row.staked_amount, row.staked_percent].map(nombreOnchain);
    if (valeurs.some((v) => v === null || v < 0) || valeurs[5]! > 100) continue;
    points.set(time, { time, entreeEth: valeurs[0]!, sortieEth: valeurs[1]!, attenteEntreeJours: valeurs[2]!,
      attenteSortieJours: valeurs[3]!, stakeEth: valeurs[4]!, stakePct: valeurs[5]!, aprPct: nombreOnchain(row.apr) });
  }
  return [...points.values()].sort((a, b) => a.time - b.time);
}
export async function fetchEthStaking(signal?: AbortSignal): Promise<EthStakingResultat | null> {
  const cache = await lireCache<PointEthStaking[]>("eth:validatorqueue:v1");
  const resultat = (points: PointEthStaking[], ts: number, erreur?: string): EthStakingResultat => ({ points, ts,
    perime: Boolean(erreur) || Date.now() - (points.at(-1)?.time ?? 0) > 48 * 3600_000, raison: erreur });
  if (cache && estFrais(cache, 6 * 3600_000)) return resultat(cache.donnee, cache.ts);
  try {
    const response = await fetch(ETH_STAKING_SOURCE, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`ValidatorQueue HTTP ${response.status}`);
    if (!response.body) throw new Error("Historique ValidatorQueue absent");
    const lecteur = response.body.getReader();
    const decodeur = new TextDecoder(); let texte = ""; let taille = 0;
    try {
      while (true) {
        const { done, value } = await lecteur.read();
        if (done) break;
        taille += value.byteLength;
        if (taille > 2 * 1024 * 1024) { await lecteur.cancel(); throw new Error("Historique ValidatorQueue trop volumineux"); }
        texte += decodeur.decode(value, { stream: true });
      }
      texte += decodeur.decode();
    } finally { lecteur.releaseLock(); }
    const points = parseEthStaking(JSON.parse(texte));
    if (!points.length) throw new Error("Historique ValidatorQueue absent");
    signal?.throwIfAborted();
    await ecrireCache("eth:validatorqueue:v1", points);
    return resultat(points, Date.now());
  } catch (e) {
    return cache ? resultat(cache.donnee, cache.ts, e instanceof Error ? e.message : "ValidatorQueue injoignable") : null;
  }
}
