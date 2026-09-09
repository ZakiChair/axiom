export interface SourceChain<T = unknown> {
  id: string;
  charger: (signal: AbortSignal) => Promise<T>;
}

export interface PublicationChain<T = unknown> {
  id: string;
  valeur: T | null;
  erreur?: string;
}

export interface ChargeurChain {
  lancer: <T>(sources: readonly SourceChain<T>[], publier: (publication: PublicationChain<T>) => void) => Promise<void>;
  annuler: () => void;
  enCours: () => boolean;
}

const DELAI_RESEAU_MS = 15_000;

function signalAvecDelai(parent: AbortSignal): {
  signal: AbortSignal;
  attendre: <T>(promesse: Promise<T>) => Promise<T>;
  terminer: () => void;
} {
  const controleur = new AbortController();
  const propager = () => controleur.abort(parent.reason);
  parent.addEventListener("abort", propager, { once: true });
  const timer = setTimeout(() => controleur.abort(new DOMException("Délai réseau dépassé", "TimeoutError")), DELAI_RESEAU_MS);
  let rejeter!: (raison: unknown) => void;
  const annulation = new Promise<never>((_resolve, reject) => { rejeter = reject; });
  const surAnnulation = () => rejeter(controleur.signal.reason ?? new DOMException("Annulé", "AbortError"));
  controleur.signal.addEventListener("abort", surAnnulation, { once: true });
  return {
    signal: controleur.signal,
    attendre: <T,>(promesse: Promise<T>) => Promise.race([promesse, annulation]),
    terminer: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", propager);
      controleur.signal.removeEventListener("abort", surAnnulation);
    },
  };
}

/** Un cycle concurrent par source ; chaque résultat est publié dès son arrivée. */
export function creerChargeurChain(): ChargeurChain {
  let generation = 0;
  let controleur: AbortController | null = null;
  let actif = false;
  return {
    async lancer<T>(sources: readonly SourceChain<T>[], publier: (publication: PublicationChain<T>) => void): Promise<void> {
      generation += 1;
      const locale = generation;
      controleur?.abort();
      controleur = new AbortController();
      const cycle = controleur;
      actif = true;
      await Promise.allSettled(sources.map(async (source) => {
        const delai = signalAvecDelai(cycle.signal);
        try {
          const valeur = await delai.attendre(source.charger(delai.signal));
          if (locale === generation && !cycle.signal.aborted) publier({ id: source.id, valeur });
        } catch (e) {
          if (locale === generation && !cycle.signal.aborted) {
            publier({ id: source.id, valeur: null, erreur: e instanceof Error ? e.message : "échec" });
          }
        } finally {
          delai.terminer();
        }
      }));
      if (locale === generation) actif = false;
    },
    annuler(): void {
      generation += 1;
      controleur?.abort();
      controleur = null;
      actif = false;
    },
    enCours: () => actif,
  };
}
