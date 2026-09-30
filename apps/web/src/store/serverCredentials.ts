import { createStore } from "zustand/vanilla";
import { IS_VERCEL } from "../lib/deployment";

import { PROVIDER_IDS as SERVER_PROVIDERS, type ProviderId as ServerProvider } from "../../../../shared/server-credentials";
export { SERVER_PROVIDERS, type ServerProvider };
type Providers = Partial<Record<ServerProvider, boolean>>;

/** Uniquement des capacités publiques : aucune valeur de clé n'entre dans ce store. */
export const serverCredentialsStore = createStore<{ providers: Providers }>(() => ({ providers: {} }));
export const hasServerCredential = (provider: ServerProvider): boolean => serverCredentialsStore.getState().providers[provider] === true;

/** Avant le premier rendu : une panne de configuration ne bloque jamais le terminal. */
export async function initializeServerCredentials(): Promise<void> {
  if (!IS_VERCEL) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);
  try {
    const response = await fetch("/api/config", { cache: "no-store", signal: controller.signal });
    if (!response.ok) return;
    const data: unknown = await response.json();
    const raw = data && typeof data === "object" && "providers" in data ? data.providers : null;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const providers: Providers = {};
    for (const id of SERVER_PROVIDERS) providers[id] = (raw as Record<string, unknown>)[id] === true;
    serverCredentialsStore.setState({ providers });
  } catch { /* Mode dégradé : clés personnelles et sources publiques restent disponibles. */ }
  finally { clearTimeout(timeout); }
}
