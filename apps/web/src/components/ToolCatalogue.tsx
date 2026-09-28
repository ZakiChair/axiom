import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { navigationStore, navigateTool, RUBRIQUES, outilsRubrique, type RubriqueId } from "../store/navigation";
import { IS_VERCEL } from "../lib/deployment";
import { cryptoquantUiStore, ENTREES_CQ } from "../store/cryptoquantUi";
import { marketMapUiStore } from "../store/marketmap-ui";
import { commandesSignaux } from "../commands/windowPanels";
import { estNouvelle } from "../store/windowManager";
import type { DefinitionFenetre } from "../store/windowManager";

const RACCOURCIS = [
  { mnemonic: "CQTAKR", badge: ENTREES_CQ.takers.badge, title: ENTREES_CQ.takers.libelle, ouvrir: () => cryptoquantUiStore.getState().demander("takers") },
  { mnemonic: "CQMINE", badge: ENTREES_CQ.mineurs.badge, title: ENTREES_CQ.mineurs.libelle, ouvrir: () => cryptoquantUiStore.getState().demander("mineurs") },
  { mnemonic: "TOP", title: "Classement des performances", ouvrir: () => marketMapUiStore.getState().ouvrirClassement() },
  { mnemonic: "IMAP", title: "Vue marché · alias MAP", ouvrir: () => navigateTool("marketMap") },
  { mnemonic: "SIG", title: "Signaux de stratégies", ouvrir: () => commandesSignaux[0]!.action() },
];
const clavierMenu = (e: React.KeyboardEvent<HTMLDivElement>) => {
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
            e.preventDefault();
            const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
            const i = items.indexOf(document.activeElement as HTMLButtonElement);
            items[e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
          };
export function ToolCatalogue({ initial, onClose }: { initial?: RubriqueId; onClose: () => void }) {
  const modal = useRef<HTMLDialogElement>(null);
  const [filtre, setFiltre] = useState("");
  const [section, setSection] = useState<RubriqueId | undefined>(initial);
  const active = useStore(navigationStore, (s) => s.active);
  useEffect(() => {
    const precedent = document.activeElement as HTMLElement | null;
    modal.current?.showModal();
    modal.current?.querySelector<HTMLInputElement>("input")?.focus();
    const fermer = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      if (e.key === "Tab") {
        const controles = Array.from(modal.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input") ?? []).filter((el) => el.getClientRects().length > 0);
        const premier = controles[0], dernier = controles[controles.length - 1];
        if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier?.focus(); }
        else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier?.focus(); }
      }
    };
    document.addEventListener("keydown", fermer);
    return () => { document.removeEventListener("keydown", fermer); modal.current?.close(); precedent?.focus(); };
  }, [onClose]);
  return <dialog ref={modal} aria-label="Rubriques et outils" className="axiom-catalogue-backdrop" onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="axiom-catalogue" onClick={(e) => e.stopPropagation()}>
      <div className="axiom-sheet-heading"><h2>Rubriques et outils</h2><button type="button" onClick={onClose} aria-label="Fermer les rubriques">✕</button></div>
      <input type="search" aria-label="Filtrer les outils" placeholder="Nom, fonction ou mnémonique…" value={filtre} onChange={(e) => { setFiltre(e.target.value); setSection(undefined); }} />
      <div className="axiom-catalogue-sections"><button type="button" aria-pressed={!section} onClick={() => setSection(undefined)}>Tout</button>
        {RUBRIQUES.map((r) => <button type="button" key={r.id} aria-pressed={section === r.id} onClick={() => { setSection(r.id); setFiltre(""); }}>{r.label}</button>)}
      </div>
      <div className="axiom-catalogue-results">
        {RUBRIQUES.filter((r) => !section || r.id === section).map((r) => {
          const outils = outilsRubrique(r.id).filter((w) => `${w.title} ${w.mnemonic}`.toLocaleLowerCase("fr").includes(filtre.toLocaleLowerCase("fr")));
          return outils.length > 0 && <section key={r.id}><h3>{r.label}</h3><div role="menu" aria-label={r.label} onKeyDown={clavierMenu}>
            {outils.map((w) => <button type="button" role="menuitem" data-tool-id={w.id} key={w.id} aria-current={active === w.id ? "page" : undefined}
              onClick={() => { navigateTool(w.id); onClose(); }}><span>{w.mnemonic}</span><strong>{w.title}</strong>{"nouveau" in w && w.nouveau && estNouvelle(w.id) && <em className="axiom-new-tool">nouveau</em>}
              {IS_VERCEL && (w as DefinitionFenetre).vercel && <small>{(w as DefinitionFenetre).vercel === "unusable" ? "Serveur local requis" : "Données partielles"}</small>}
            </button>)}
          </div></section>;
        })}
        {!section && <section><h3>Accès directs</h3><div role="menu" aria-label="Accès directs" onKeyDown={clavierMenu}>
          {RACCOURCIS.filter((r) => `${r.mnemonic} ${r.title}`.toLocaleLowerCase("fr").includes(filtre.toLocaleLowerCase("fr"))).map((r) => <button type="button" role="menuitem" key={r.mnemonic} onClick={() => { r.ouvrir(); onClose(); }}><span>{r.mnemonic}</span><strong>{r.title}</strong>{"badge" in r && r.badge && estNouvelle(r.badge) && <em className="axiom-new-tool">nouveau</em>}</button>)}
        </div></section>}
        {!RACCOURCIS.some((r) => `${r.mnemonic} ${r.title}`.toLocaleLowerCase("fr").includes(filtre.toLocaleLowerCase("fr"))) && !RUBRIQUES.some((r) => outilsRubrique(r.id).some((w) => `${w.title} ${w.mnemonic}`.toLocaleLowerCase("fr").includes(filtre.toLocaleLowerCase("fr")))) && <p>Aucun outil ne correspond à cette recherche.</p>}
      </div>
    </section>
  </dialog>;
}
