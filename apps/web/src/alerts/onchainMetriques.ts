/**
 * Chargement LENT des métriques on-chain pour les alertes `onchain-seuil` (runtime front).
 *
 * Réutilise les chargeurs de CHAIN (mêmes caches localStorage : 5 min mempool, 6 h
 * hashrate / revenus, 24 h BGeometrics / thermocap) : une alerte n'ajoute aucun appel
 * réseau quand la fenêtre CHAIN a déjà tourné. Importé À LA DEMANDE par le runtime
 * (rien dans le bundle d'entrée tant qu'aucune alerte on-chain n'existe) et ne charge
 * que les métriques REQUISES par les alertes actives (quota BGeometrics).
 *
 * Une métrique indisponible reste ABSENTE du résultat (condition non évaluable côté
 * moteur, armement figé) — jamais remplacée par 0.
 */
import type { MetriqueOnchainAlerte } from "@axiom/alerts";
import {
  BG_MVRV,
  BG_NUPL,
  BG_SOPR,
  fetchBgeometricMetrique,
  type DefMetriqueBg,
} from "../data/onchain/bgeometrics";
import { fetchHashrate, fetchMempoolReseau } from "../data/onchain/mempool";
import { calculerHashprice, fetchRevenusMineurs } from "../data/onchain/mineurs";
import { fetchThermocap } from "../data/onchain/thermocap";
import { getBgeometricsKey } from "../store/onchain";

export type ValeursOnchain = Partial<Record<MetriqueOnchainAlerte, number>>;

const DEFS_BG: ReadonlyArray<[MetriqueOnchainAlerte, DefMetriqueBg]> = [
  ["mvrv-z", BG_MVRV],
  ["sopr", BG_SOPR],
  ["nupl", BG_NUPL],
];

function poser(out: ValeursOnchain, m: MetriqueOnchainAlerte, v: number | null | undefined): void {
  if (v !== undefined && v !== null && Number.isFinite(v)) out[m] = v;
}

/** Dernières valeurs des métriques demandées ; les indisponibles sont omises. */
export async function chargerMetriquesOnchain(
  requises: ReadonlySet<MetriqueOnchainAlerte>,
  signal?: AbortSignal,
): Promise<ValeursOnchain> {
  const out: ValeursOnchain = {};
  const taches: Promise<void>[] = [];
  const cle = getBgeometricsKey();
  for (const [m, def] of DEFS_BG) {
    if (!requises.has(m)) continue;
    taches.push(fetchBgeometricMetrique(def, cle, signal).then((r) => poser(out, m, r?.serie.dernier?.value)));
  }
  if (requises.has("thermocap")) {
    taches.push(fetchThermocap(signal).then((r) => poser(out, "thermocap", r?.donnee.dernier?.value)));
  }
  if (requises.has("hashprice")) {
    taches.push(
      Promise.all([fetchHashrate(signal), fetchRevenusMineurs(signal)]).then(([hr, rev]) => {
        if (hr === null || rev === null) return;
        poser(out, "hashprice", calculerHashprice(rev.donnee, hr.donnee.points).dernier?.value);
      }),
    );
  }
  if (requises.has("frais-sat-vb")) {
    taches.push(fetchMempoolReseau(signal).then((r) => poser(out, "frais-sat-vb", r?.donnee.fees.fastestFee)));
  }
  await Promise.allSettled(taches);
  return out;
}
