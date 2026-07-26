import { parsePacteState } from "../domain/guards";
import type { PacteState } from "../domain/model";

const STORAGE_KEY = "pacte:v1";

export function rawStoredState(): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
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
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  } catch {
    // Le coffre reste local : une erreur de quota ne doit pas faire tomber l'interface.
  }
}
