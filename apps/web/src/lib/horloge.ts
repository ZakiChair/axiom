import { useEffect, useState } from "react";

const abonnes = new Set<(now: number) => void>();
let minuteur: ReturnType<typeof setInterval> | null = null;

function actualiser(): void {
  const now = Date.now();
  for (const abonne of abonnes) abonne(now);
}

/** Une horloge locale pour les badges visibles, sans déclencher de collecte. */
export function abonnerHorloge(abonne: (now: number) => void): () => void {
  abonnes.add(abonne);
  if (minuteur === null) {
    minuteur = setInterval(actualiser, 10_000);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", actualiser);
  }
  abonne(Date.now());
  return () => {
    abonnes.delete(abonne);
    if (abonnes.size === 0 && minuteur !== null) {
      clearInterval(minuteur);
      minuteur = null;
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", actualiser);
    }
  };
}

export function useHorloge(): number {
  const [, setNow] = useState(Date.now);
  useEffect(() => abonnerHorloge(setNow), []);
  // Le tick provoque le rendu ; une donnée arrivée entre deux ticks se compare
  // à l'heure réelle de ce rendu, pas à une horloge mémorisée dix secondes avant.
  return Date.now();
}
