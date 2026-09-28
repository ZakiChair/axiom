import { paletteStore } from "../commands/registry";
import { settingsUiStore } from "../store/settings-ui";
import { FonctionsMenu } from "./Toolbar";

export function MobileNavigation({ panneauxOuverts, dessinsOuverts, onPanneaux, onDessins, onNavigate }: {
  panneauxOuverts: boolean;
  dessinsOuverts: boolean;
  onPanneaux: () => void;
  onDessins: () => void;
  onNavigate: () => void;
}) {
  return <nav aria-label="Navigation du terminal" className="axiom-mobile-navigation">
    <div onClickCapture={onNavigate}><FonctionsMenu /></div>
    <button type="button" onClick={() => { onNavigate(); paletteStore.getState().ouvrir(); }}>Recherche</button>
    <button type="button" aria-expanded={panneauxOuverts} aria-controls="panneaux-terminal" onClick={onPanneaux}>Panneaux</button>
    <button type="button" aria-expanded={dessinsOuverts} aria-controls="outils-dessin" onClick={onDessins}>Dessins</button>
    <button type="button" onClick={() => { onNavigate(); settingsUiStore.getState().openSettings(); }}>Réglages</button>
  </nav>;
}
