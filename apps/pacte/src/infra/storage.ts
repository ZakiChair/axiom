import { parsePacteState } from "../domain/guards";
import type { PacteState } from "../domain/model";

const STORAGE_KEY = "pacte:v1";

export type SaveStateResult =
  | { ok: true }
  | { ok: false; error: string };

export type StoredStateInspection =
  | { status: "missing" }
  | { status: "valid"; state: PacteState }
  | { status: "corrupt"; raw: string | null };

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
  const inspected = inspectStoredState();
  return inspected.status === "valid" ? inspected.state : null;
}

export function inspectStoredState(): StoredStateInspection {
  let raw: string | null;
  try {
    const storage = availableStorage();
    if (storage === undefined) return { status: "missing" };
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { status: "corrupt", raw: null };
  }

  if (raw === null) return { status: "missing" };

  try {
    const state = parsePacteState(JSON.parse(raw));
    return state ? { status: "valid", state } : { status: "corrupt", raw };
  } catch {
    return { status: "corrupt", raw };
  }
}

export function saveState(state: PacteState): SaveStateResult {
  if (parsePacteState(state) === null) return { ok: false, error: SAVE_ERROR };

  try {
    const storage = availableStorage();
    if (storage === undefined) return { ok: false, error: SAVE_ERROR };
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return { ok: true };
  } catch {
    return { ok: false, error: SAVE_ERROR };
  }
}
