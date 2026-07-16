/**
 * CommandPalette — palette de commandes ⌘K, esthétique terminal (mono, dense).
 *
 * Ouverte par ⌘K/Ctrl+K (ou la touche « ? » pour l'aide), elle propose une ligne de
 * saisie unique façon Bloomberg : recherche fuzzy sur le registre de commandes, plus
 * une interprétation LIBRE de la saisie en navigation (« SOL 4H », « btcusdt »). La
 * commande de navigation synthétisée apparaît en tête des résultats.
 *
 * Navigation au clavier (flèches + Entrée), aperçu de la commande sélectionnée, et
 * historique des 20 dernières commandes (localStorage, clé dédiée). Un mode « aide »
 * affiche la table des raccourcis clavier. Basse fréquence : aucun re-render sur tick.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useStore } from "zustand";
import {
  paletteStore,
  construireRegistre,
  parseNavigation,
  commandeNavigation,
  rechercher,
  type Commande,
  type CategorieCommande,
} from "../commands/registry";
import { RACCOURCIS_AIDE } from "../commands/hotkeys";

/** Entrée d'historique persistée (id de commande + texte de saisie pour rejouer la navigation). */
interface EntreeHistorique {
  id: string;
  libelle: string;
  texte: string;
}

/** Élément affiché : commande + texte de saisie associé (pour l'historique). */
interface Item {
  cmd: Commande;
  texte: string;
}

/** Clé localStorage de l'historique (distincte des autres clés axiom:*). */
const CLE_HISTO = "axiom:paletteHistory:v1";
/** Nombre maximum d'entrées d'historique conservées. */
const MAX_HISTO = 20;

/** Libellés courts de catégorie (colonne de droite). */
const CATEGORIE_LABEL: Record<CategorieCommande, string> = {
  navigation: "nav",
  timeframe: "tf",
  indicateur: "ind",
  theme: "thème",
  panneau: "panneau",
  action: "action",
};

/** Garde de type d'une entrée d'historique restaurée. */
function estEntree(x: unknown): x is EntreeHistorique {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return typeof o.id === "string" && typeof o.libelle === "string" && typeof o.texte === "string";
}

/** Lecture tolérante de l'historique (localStorage indisponible / JSON corrompu => []). */
function lireHistorique(): EntreeHistorique[] {
  try {
    const raw = localStorage.getItem(CLE_HISTO);
    if (raw === null) return [];
    const v: unknown = JSON.parse(raw);
    if (Array.isArray(v)) return v.filter(estEntree).slice(0, MAX_HISTO);
  } catch {
    /* best-effort */
  }
  return [];
}

export function CommandPalette() {
  const ouvert = useStore(paletteStore, (s) => s.ouvert);
  const mode = useStore(paletteStore, (s) => s.mode);
  const fermer = useStore(paletteStore, (s) => s.fermer);

  const registre = useMemo(() => construireRegistre(), []);
  const [requete, setRequete] = useState("");
  const [indexSel, setIndexSel] = useState(0);
  const [historique, setHistorique] = useState<EntreeHistorique[]>(() => lireHistorique());

  const inputRef = useRef<HTMLInputElement>(null);
  const listeRef = useRef<HTMLDivElement>(null);

  // Liste affichée : navigation synthétisée + fuzzy sur requête, sinon historique / registre.
  const items = useMemo<Item[]>(() => {
    const q = requete.trim();
    if (q.length === 0) {
      const histo: Item[] = [];
      for (const e of historique) {
        if (e.id === "nav") {
          const nav = parseNavigation(e.texte);
          if (nav !== null) histo.push({ cmd: commandeNavigation(nav), texte: e.texte });
        } else {
          const cmd = registre.find((c) => c.id === e.id);
          if (cmd !== undefined) histo.push({ cmd, texte: e.texte });
        }
      }
      if (histo.length > 0) return histo;
      return registre.map((cmd) => ({ cmd, texte: "" }));
    }
    const base: Item[] = rechercher(registre, q).map((cmd) => ({ cmd, texte: "" }));
    const nav = parseNavigation(q);
    if (nav !== null) {
      // La navigation ne prend la tête que si la saisie « ressemble » à une navigation :
      // timeframe/source explicite, plusieurs tokens, ou aucun mnémonique de commande ne
      // débute par la requête. Ainsi « RSI » ouvre l'indicateur, « BTC » navigue.
      const tokens = q.split(/\s+/).filter((t) => t.length > 0);
      const qUpper = q.toUpperCase();
      const matchMnemo = registre.some(
        (c) => c.mnemonique !== undefined && c.mnemonique.toUpperCase().startsWith(qUpper)
      );
      const navProeminent =
        nav.timeframe !== undefined || nav.source !== undefined || tokens.length > 1 || !matchMnemo;
      if (navProeminent) return [{ cmd: commandeNavigation(nav), texte: q }, ...base];
    }
    return base;
  }, [requete, registre, historique]);

  // Ouverture : recharge l'historique, remet la saisie à zéro, focalise le champ.
  useEffect(() => {
    if (!ouvert) return;
    setHistorique(lireHistorique());
    setRequete("");
    setIndexSel(0);
    // Focus différé : l'input vient d'être monté.
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [ouvert]);

  // Toute évolution de la liste réinitialise la sélection en tête.
  useEffect(() => {
    setIndexSel(0);
  }, [requete]);

  // Fait défiler l'élément sélectionné dans la vue.
  useEffect(() => {
    const el = listeRef.current?.querySelector<HTMLElement>(`[data-idx="${indexSel}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [indexSel, items]);

  // Échap ferme (couvre le mode aide, sans champ focalisé).
  useEffect(() => {
    if (!ouvert) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        fermer();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ouvert, fermer]);

  if (!ouvert) return null;

  /** Exécute une commande, la journalise dans l'historique, ferme la palette. */
  const executer = (item: Item): void => {
    item.cmd.action();
    const entree: EntreeHistorique = { id: item.cmd.id, libelle: item.cmd.libelle, texte: item.texte };
    setHistorique((prev) => {
      const filtre = prev.filter((x) => !(x.id === entree.id && x.texte === entree.texte));
      const suivant = [entree, ...filtre].slice(0, MAX_HISTO);
      try {
        localStorage.setItem(CLE_HISTO, JSON.stringify(suivant));
      } catch {
        /* best-effort */
      }
      return suivant;
    });
    fermer();
  };

  const onKeyDownInput = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndexSel((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndexSel((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = items[indexSel];
      if (it !== undefined) executer(it);
    }
  };

  const selection = items[indexSel];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 backdrop-blur-sm pt-[12vh]"
      onMouseDown={fermer}
    >
      {/* Panneau (mousedown stoppé pour ne pas fermer au clic interne). */}
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-[min(680px,94vw)] overflow-hidden rounded-lg border border-border bg-surface font-mono shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={mode === "aide" ? "Aide des raccourcis" : "Palette de commandes"}
      >
        {mode === "aide" ? (
          <div>
            <div className="border-b border-border px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-dim">
              Aide — raccourcis clavier
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-2">
              {RACCOURCIS_AIDE.map((r) => (
                <div
                  key={r.touche}
                  className="flex items-center gap-3 px-2 py-1.5 text-sm"
                >
                  <kbd className="w-32 shrink-0 rounded border border-border bg-bg px-2 py-0.5 text-center text-[11px] text-accent">
                    {r.touche}
                  </kbd>
                  <span className="text-text">{r.description}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-border px-4 py-2 text-[10px] text-text-dim">
              Échap pour fermer · ⌘K pour les commandes
            </div>
          </div>
        ) : (
          <div>
            {/* Ligne de saisie type terminal. */}
            <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
              <span aria-hidden className="text-accent">›</span>
              <input
                ref={inputRef}
                value={requete}
                onChange={(e) => setRequete(e.target.value)}
                onKeyDown={onKeyDownInput}
                placeholder="Commande — ex. SOL 4H · RSI · DES · THEME MATRIX"
                spellCheck={false}
                autoComplete="off"
                aria-label="Saisie de commande"
                className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-dim"
              />
              <span className="shrink-0 text-[10px] uppercase tracking-wider text-text-dim">
                {items.length} résultat{items.length > 1 ? "s" : ""}
              </span>
            </div>

            {/* Résultats. */}
            <div
              ref={listeRef}
              role="listbox"
              aria-activedescendant={items.length > 0 && indexSel >= 0 ? `palette-item-${indexSel}` : undefined}
              className="max-h-[52vh] overflow-y-auto py-1"
            >
              {items.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-text-dim">
                  Aucune commande. Essayez « RSI », « SOL 4H », « DES »…
                </div>
              ) : (
                items.map((it, i) => (
                  <button
                    key={`${it.cmd.id}:${it.texte}:${i}`}
                    id={`palette-item-${i}`}
                    data-idx={i}
                    type="button"
                    role="option"
                    aria-selected={i === indexSel}
                    onMouseEnter={() => setIndexSel(i)}
                    onClick={() => executer(it)}
                    className={`flex w-full items-center gap-3 px-4 py-1.5 text-left ${
                      it.cmd.id === "nav" ? "border-l-2 border-accent " : ""
                    }${i === indexSel ? "bg-accent/15" : "hover:bg-bg"}`}
                  >
                    <span className="w-24 shrink-0 truncate text-[11px] font-semibold uppercase tracking-wider text-accent">
                      {it.cmd.id === "nav" ? "→" : (it.cmd.mnemonique ?? "")}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-text">{it.cmd.libelle}</span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wider text-text-dim">
                      {CATEGORIE_LABEL[it.cmd.categorie]}
                    </span>
                  </button>
                ))
              )}
            </div>

            {/* Aperçu de la commande sélectionnée + rappel des touches. */}
            <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2 text-[11px] text-text-dim">
              <span className="min-w-0 truncate">{selection?.cmd.apercu ?? ""}</span>
              <span className="shrink-0">↑↓ naviguer · ⏎ exécuter · ? aide</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
