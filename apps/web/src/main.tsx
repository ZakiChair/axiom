import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { WebGLSyncSpike } from "./spike/WebGLSyncSpike";
import { enablePersistence, hydrateStores } from "./store/persist";
import { startMacroHistoryPolling } from "./store/macroHistory";
import { seedMacroHistoryFromPersistedMcap } from "./store/mcap";
import { startRegimePolling } from "./store/regime";
// Effet de bord du module : pose [data-theme] sur <html> dès l'import, AVANT le
// premier rendu (pas de flash « dark -> thème persisté » au rechargement).
import "./store/theme";
import "./index.css";

// Restaure l'état persisté AVANT le rendu (stores à jour dès le premier montage),
// puis active la sauvegarde automatique sur changement.
hydrateStores();
seedMacroHistoryFromPersistedMcap();
enablePersistence();

// Échantillonnage central de la capitalisation totale crypto (CoinGecko n'expose
// pas l'historique en gratuit) : construit une série persistée VERS L'AVANT,
// lue par le panneau Macro et l'overlay du graphe. Indépendant de l'UI.
startMacroHistoryPolling();

// Score de régime composite (pastille SessionStrip + chapeau BRIEF) : tick 15 min,
// les historiques sous-jacents sont cachés 1 h (data/referentiels.ts).
startRegimePolling();

// Point d'entrée : monte <App/> dans #root.
const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Élément #root introuvable dans index.html");

// Montage isolé du SPIKE M4 : http://localhost:5173/#spike monte <WebGLSyncSpike/>,
// sinon l'app normale. Branchement minimal volontaire (ne touche à rien d'autre).
const isSpike = window.location.hash === "#spike";

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary scope="AXIOM">
      {isSpike ? <WebGLSyncSpike /> : <App />}
    </ErrorBoundary>
  </StrictMode>
);
