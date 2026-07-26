import { parsePacteState } from "../domain/guards";
import type { PacteState } from "../domain/model";

const STORAGE_KEY = "pacte:v1";

function availableStorage(): Storage | undefined {
  if (typeof window !== "undefined") return window.localStorage;

  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  return descriptor && "value" in descriptor
    ? descriptor.value as Storage | undefined
    : undefined;
}

export function rawStoredState(): string | null {
  try {
    return availableStorage()?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function loadState(): PacteState | null {
  const rawState = rawStoredState();

  if (rawState === null) {
    return null;
  }

  try {
    return parsePacteState(JSON.parse(rawState));
  } catch {
    return null;
  }
}

export function saveState(state: PacteState): void {
  try {
    availableStorage()?.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Le coffre reste local : une erreur de quota ne doit pas faire tomber l'interface.
  }
}
