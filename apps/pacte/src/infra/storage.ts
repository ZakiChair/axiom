import { parsePacteState } from "../domain/guards";
import type { PacteState } from "../domain/model";

const STORAGE_KEY = "pacte:v1";

export type SaveStateResult =
  | { ok: true }
  | { ok: false; error: string };

const SAVE_ERROR = "Le coffre local n’a pas pu être enregistré. Libérez de l’espace puis réessayez.";

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

export function saveState(state: PacteState): SaveStateResult {
  try {
    const storage = availableStorage();
    if (storage === undefined) return { ok: false, error: SAVE_ERROR };
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return { ok: true };
  } catch {
    return { ok: false, error: SAVE_ERROR };
  }
}
