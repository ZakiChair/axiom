import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { WebGLSyncSpike } from "./spike/WebGLSyncSpike";
import { enablePersistence, hydrateStores } from "./store/persist";
// Effet de bord du module : pose [data-theme] sur <html> dès l'import, AVANT le
// premier rendu (pas de flash « dark -> thème persisté » au rechargement).
import "./store/theme";
import "./index.css";

// Restaure l'état persisté AVANT le rendu (stores à jour dès le premier montage),
// puis active la sauvegarde automatique sur changement.
hydrateStores();
enablePersistence();

// Point d'entrée : monte <App/> dans #root.
const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Élément #root introuvable dans index.html");

// Montage isolé du SPIKE M4 : http://localhost:5173/#spike monte <WebGLSyncSpike/>,
// sinon l'app normale. Branchement minimal volontaire (ne touche à rien d'autre).
const isSpike = window.location.hash === "#spike";

createRoot(rootElement).render(
  <StrictMode>{isSpike ? <WebGLSyncSpike /> : <App />}</StrictMode>
);
