import { lazy, Suspense, useEffect, useState } from "react";
import { useStore } from "zustand";
import { enregistrerCommandes, paletteStore } from "../commands/registry";
import { indicatorMenuUiStore } from "../store/indicator-menu-ui";
import { pousserToast } from "../store/toasts";
import { settingsUiStore } from "../store/settings-ui";
import { navigationStore, navigateTool, navigateRubrique, outilsRubrique, RUBRIQUES, rubriqueDestination, setPresentationMode, type RubriqueId } from "../store/navigation";
import { PairSearch } from "./PairSearch";
import { useMobileLayout } from "../hooks/useMobileLayout";
import { ErrorBoundary } from "./ErrorBoundary";

const Options = lazy(() => import("./ToolbarOptions").then((m) => ({ default: m.ToolbarOptions })));
const Catalogue = lazy(() => import("./ToolCatalogue").then((m) => ({ default: m.ToolCatalogue })));

enregistrerCommandes([
  {
    id: "workspace:enregistrer",
    mnemonique: "WS",
    libelle: "Enregistrer le workspace sous…",
    categorie: "action",
    motsCles: ["workspace", "preset", "enregistrer", "sauver", "layout", "espace de travail"],
    apercu: "Sauvegarde l'agencement courant sous un nom",
    action: () => { return import("./ToolbarOptions").then((m) => m.enregistrerWorkspaceAvecNom()).catch(() => pousserToast("Chargement impossible — réessayez.")); },
  },
  {
    id: "workspace:exporter",
    mnemonique: "BACKUP",
    libelle: "Exporter la sauvegarde (JSON)",
    categorie: "action",
    motsCles: ["backup", "sauvegarde", "export", "json", "exporter", "telecharger"],
    apercu: "Télécharge les données du terminal — clés API exclues, à ressaisir sur un autre poste",
    action: () => { return import("./ToolbarOptions").then((m) => m.exporterSauvegardeAvecFeedback()).catch(() => pousserToast("Chargement impossible — réessayez.")); },
  },
  {
    id: "workspace:importer",
    mnemonique: "RESTORE",
    libelle: "Importer une sauvegarde (JSON)",
    categorie: "action",
    motsCles: ["restore", "restaurer", "import", "json", "importer", "sauvegarde"],
    apercu: "Remplace l'état du terminal par une sauvegarde",
    action: () => { return import("./ToolbarOptions").then((m) => m.declencherImportSauvegarde()).catch(() => pousserToast("Chargement impossible — réessayez.")); },
  },
]);


export function Toolbar({ optionsOuvertes = false, onOptionsChange = () => {}, panneauxOuverts = false, onPanneaux = () => {}, onDessins = () => {}, onNavigate = () => {} }: {
  optionsOuvertes?: boolean; onOptionsChange?: (open: boolean) => void;
  panneauxOuverts?: boolean; onPanneaux?: () => void; onDessins?: () => void; onNavigate?: () => void;
}) {
  const mobile = useMobileLayout();
  const active = useStore(navigationStore, (s) => s.active);
  const mode = useStore(navigationStore, (s) => s.mode);
  const [catalogue, setCatalogue] = useState<RubriqueId | "all" | null>(null);
  const rubrique = rubriqueDestination(active);
  useEffect(() => indicatorMenuUiStore.subscribe((s, previous) => { if (s.open && !previous.open) onOptionsChange(true); }), [onOptionsChange]);
  useEffect(() => { setCatalogue(null); onOptionsChange(false); }, [active]);
  return <>
    <header className="axiom-analytics-header">
      <button className="axiom-brand" type="button" onClick={() => navigateTool("chart")}>AXIOM</button>
      <button type="button" className="axiom-rubriques-trigger" aria-expanded={catalogue !== null} onClick={() => { onNavigate(); setCatalogue("all"); }}>Rubriques</button>
      <div className="axiom-global-pair"><PairSearch /></div>
      <button type="button" onClick={() => paletteStore.getState().ouvrir()}>Recherche</button>
      <button type="button" aria-expanded={panneauxOuverts} onClick={onPanneaux}>Favoris</button>
      {!mobile && <button type="button" onClick={() => setPresentationMode(mode === "pages" ? "windows" : "pages")}>{mode === "pages" ? "Mode fenêtres" : "Mode pages"}</button>}
      <button type="button" onClick={() => settingsUiStore.getState().openSettings()}>Réglages</button>
    </header>
    <nav className="axiom-business-navigation" aria-label="Rubriques métier">
      <button type="button" aria-current={active === "chart" ? "page" : undefined} onClick={() => navigateTool("chart")}>Graphique</button>
      {RUBRIQUES.map((r) => <button key={r.id} type="button" aria-current={active !== "chart" && rubrique.id === r.id ? "true" : undefined} onClick={() => { onNavigate(); navigateRubrique(r.id); }}>{r.label}</button>)}
      <div className="axiom-context-actions">
        <button type="button" onClick={onDessins}>Dessins</button>
        <button type="button" aria-expanded={optionsOuvertes} onClick={() => onOptionsChange(!optionsOuvertes)}>Options du graphique</button>
      </div>
    </nav>
    {active !== "chart" && (mobile || mode === "pages") && <nav aria-label={`Outils ${rubrique.label}`} className="axiom-tool-navigation">
      {outilsRubrique(rubrique.id).map((w) => <button key={w.id} type="button" aria-current={active === w.id ? "page" : undefined} onClick={() => { onNavigate(); navigateTool(w.id); }} title={w.title}>{w.title}</button>)}
    </nav>}
    {catalogue !== null && <ErrorBoundary scope="Catalogue"><Suspense fallback={<div className="axiom-loading-surface" role="status">Chargement des outils…</div>}>
      <Catalogue key={catalogue} initial={catalogue === "all" ? undefined : catalogue} onClose={() => setCatalogue(null)} />
    </Suspense></ErrorBoundary>}
    {optionsOuvertes && <ErrorBoundary scope="Options"><Suspense fallback={<div className="axiom-loading-surface" role="status">Chargement des options…</div>}>
      <Options optionsOuvertes onOptionsChange={onOptionsChange} />
    </Suspense></ErrorBoundary>}
  </>;
}
