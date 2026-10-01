import { createStore } from "zustand/vanilla";
import { IS_VERCEL } from "../lib/deployment";

import { PROVIDER_IDS as SERVER_PROVIDERS, type ProviderId as ServerProvider } from "../../../../shared/server-credentials";
export { SERVER_PROVIDERS, type ServerProvider };
type Providers = Partial<Record<ServerProvider, boolean>>;

/** Uniquement des capacités publiques : aucune valeur de clé n'entre dans ce store. */
export const serverCredentialsStore = createStore<{ providers: Providers }>(() => ({ providers: {} }));
export const hasServerCredential = (provider: ServerProvider): boolean => serverCredentialsStore.getState().providers[provider] === true;

type ResultatChargement = Providers | "reessayer" | null;
let operationEnCours: Promise<void> | undefined;

/** Une tentative bornée, même si fetch ou la lecture du corps ignore l'abandon.
 * Aucune publication ici : une réponse périmée ne peut écraser la reprise. */
async function chargerCapacites(): Promise<ResultatChargement> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const requete = (async (): Promise<ResultatChargement> => {
    try {
      const response = await fetch("/api/config", { cache: "no-store", signal: controller.signal });
      if (!response.ok) return response.status >= 500 && response.status < 600 ? "reessayer" : null;
      const data: unknown = await response.json();
      const raw = data && typeof data === "object" && "providers" in data ? data.providers : null;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
      const providers: Providers = {};
      for (const id of SERVER_PROVIDERS) providers[id] = (raw as Record<string, unknown>)[id] === true;
      return providers;
    } catch (error) {
      // Un JSON malformé est définitif ; les erreurs réseau/lecture peuvent être temporaires.
      return error instanceof SyntaxError ? null : "reessayer";
    }
  })();
  const limite = new Promise<ResultatChargement>((resolve) => {
    timeout = setTimeout(() => { controller.abort(); resolve("reessayer"); }, 15_000);
  });
  try { return await Promise.race([requete, limite]); }
  finally { clearTimeout(timeout); }
}

async function chargerAvecReprise(): Promise<void> {
  let resultat = await chargerCapacites();
  if (resultat === "reessayer") {
    await new Promise<void>((resolve) => setTimeout(resolve, 2_000));
    resultat = await chargerCapacites();
  }
  if (resultat !== null && resultat !== "reessayer") serverCredentialsStore.setState({ providers: resultat });
}

/** Attend au plus 2s avant le rendu ; la configuration peut arriver ensuite.
 * Les appels rapprochés partagent les deux tentatives au maximum, sans polling. */
export async function initializeServerCredentials(): Promise<void> {
  if (!IS_VERCEL) return;
  operationEnCours ??= chargerAvecReprise()
    .catch(() => { /* Mode dégradé : les clés personnelles restent disponibles. */ })
    .finally(() => { operationEnCours = undefined; });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const limiteMontage = new Promise<void>((resolve) => { timeout = setTimeout(resolve, 2_000); });
  try { await Promise.race([operationEnCours, limiteMontage]); }
  finally { clearTimeout(timeout); }
}
