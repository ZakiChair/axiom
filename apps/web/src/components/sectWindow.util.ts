/**
 * Helpers PURS de la fenêtre SECT (contrat vitest node du repo : la logique
 * testable vit hors du composant). Cf. SectWindow.tsx pour le contexte.
 */

/**
 * Paire Binance réellement ouvrable pour un membre : la paire curée n'est retenue
 * que si elle figure dans le catalogue Binance chargé (« sinon rien », patron MAP —
 * une paire curée périmée/délistée est ainsi inoffensive). `null` tant que le
 * catalogue n'est pas disponible.
 */
export function paireOuvrable(
  paireBinance: string | undefined,
  catalogue: ReadonlySet<string> | null,
): string | null {
  if (paireBinance === undefined || catalogue === null) return null;
  return catalogue.has(paireBinance) ? paireBinance : null;
}

/** Classe de couleur d'une perf : up/down par signe, estompé si valeur absente. */
export function classePct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "text-text-dim";
  return v >= 0 ? "text-up" : "text-down";
}
