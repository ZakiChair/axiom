import { useStore } from "zustand";
import { navigationStore, navigateTool } from "../store/navigation";

export function MobileNavigation({ panneauxOuverts, dessinsOuverts, onPanneaux, onDessins, onOptions, onNavigate }: {
  panneauxOuverts: boolean; dessinsOuverts: boolean;
  onPanneaux: () => void; onDessins: () => void; onOptions: () => void; onNavigate: () => void;
}) {
  const active = useStore(navigationStore, (s) => s.active);
  return <nav aria-label="Navigation du terminal" className="axiom-mobile-navigation">
    <button type="button" aria-current={active === "chart" ? "page" : undefined} onClick={() => { onNavigate(); navigateTool("chart"); }}>Graphique</button>
    <button type="button" aria-expanded={panneauxOuverts} aria-controls="panneaux-terminal" onClick={onPanneaux}>Panneaux</button>
    <button type="button" aria-expanded={dessinsOuverts} aria-controls="outils-dessin" onClick={onDessins}>Dessins</button>
    <button type="button" onClick={onOptions}>Options</button>
  </nav>;
}
