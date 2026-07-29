/**
 * Table triable STANDARD — remplace les deux mécanismes concurrents relevés par
 * l'audit (<table> HTML nus de PAPER/RATE/STBL, grilles + SortHeader dupliqué de
 * EQS/BT). Composant CONTRÔLÉ et SANS hook : l'état de tri vit dans la fenêtre
 * (persistable), les helpers sont purs (contrat vitest node du repo).
 */
import type { ReactNode } from "react";
import { Vide } from "./ui";

export interface ColonneTable<L> {
  id: string;
  label: string;
  align?: "left" | "right";
  /** Fraction de grille CSS (défaut "1fr"). */
  largeur?: string;
  triable?: boolean;
  /** Valeur de tri — requise si `triable`. null = envoyé en fin de liste. */
  valeurTri?: (ligne: L) => number | string | null;
  rendu: (ligne: L) => ReactNode;
}

export interface TriTable {
  colonne: string;
  dir: 1 | -1;
}

/** Clic d'en-tête : nouvelle colonne → desc (-1) ; même colonne → inversion. */
export function basculerTri(tri: TriTable | null, colonne: string): TriTable {
  if (tri !== null && tri.colonne === colonne) return { colonne, dir: tri.dir === -1 ? 1 : -1 };
  return { colonne, dir: -1 };
}

/** Trie une COPIE des lignes ; null/undefined toujours en fin quelle que soit la direction. */
export function trierLignes<L>(
  lignes: readonly L[],
  colonnes: readonly ColonneTable<L>[],
  tri: TriTable | null,
): L[] {
  if (tri === null) return [...lignes];
  const col = colonnes.find((c) => c.id === tri.colonne);
  if (col === undefined || col.valeurTri === undefined) return [...lignes];
  const v = col.valeurTri;
  return [...lignes].sort((a, b) => {
    const va = v(a);
    const vb = v(b);
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * tri.dir;
    return String(va).localeCompare(String(vb)) * tri.dir;
  });
}

export function TableTriable<L>({
  colonnes,
  lignes,
  tri = null,
  onTri,
  cle,
  vide,
  maxHauteur,
  surClicLigne,
}: {
  colonnes: readonly ColonneTable<L>[];
  lignes: readonly L[];
  tri?: TriTable | null;
  onTri?: (tri: TriTable) => void;
  cle: (ligne: L) => string;
  vide?: ReactNode;
  maxHauteur?: string;
  surClicLigne?: (ligne: L) => void;
}) {
  const grille = colonnes.map((c) => c.largeur ?? "1fr").join(" ");
  const alignementBouton = (c: ColonneTable<L>) =>
    c.align === "right" ? "text-right justify-end" : "text-left justify-start";
  const alignementSpan = (c: ColonneTable<L>) =>
    c.align === "right" ? "text-right" : "text-left";
  const corps = (
    <div
      style={maxHauteur !== undefined ? { maxHeight: maxHauteur } : undefined}
      className={maxHauteur !== undefined ? "overflow-y-auto" : undefined}
    >
      {lignes.length === 0 && vide !== undefined ? (
        <Vide>{vide}</Vide>
      ) : (
        lignes.map((l) => (
          <div
            key={cle(l)}
            onClick={surClicLigne !== undefined ? () => surClicLigne(l) : undefined}
            className={`grid items-center gap-2 border-b border-border/50 px-3 py-1.5 text-[11px] last:border-b-0 ${
              surClicLigne !== undefined ? "cursor-pointer hover:bg-surface" : ""
            }`}
            style={{ gridTemplateColumns: grille }}
          >
            {colonnes.map((c) => (
              <span key={c.id} className={`tabular-nums ${c.align === "right" ? "text-right" : ""}`}>
                {c.rendu(l)}
              </span>
            ))}
          </div>
        ))
      )}
    </div>
  );
  return (
    <section className="rounded-md border border-border bg-bg">
      <div
        className="grid items-center gap-2 border-b border-border px-3 py-1.5"
        style={{ gridTemplateColumns: grille }}
      >
        {colonnes.map((c) =>
          c.triable === true && c.valeurTri !== undefined && onTri !== undefined ? (
            <button
              key={c.id}
              type="button"
              onClick={() => onTri(basculerTri(tri, c.id))}
              className={`flex w-full items-center gap-0.5 text-[10px] uppercase tracking-wide text-text-dim transition hover:text-text ${alignementBouton(c)}`}
            >
              {c.label}
              {tri !== null && tri.colonne === c.id && <span>{tri.dir === -1 ? "▾" : "▴"}</span>}
            </button>
          ) : (
            <span
              key={c.id}
              className={`text-[10px] uppercase tracking-wide text-text-dim ${alignementSpan(c)}`}
            >
              {c.label}
            </span>
          ),
        )}
      </div>
      {corps}
    </section>
  );
}
