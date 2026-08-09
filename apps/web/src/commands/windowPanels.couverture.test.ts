/**
 * Test CROISÉ registre de fenêtres ↔ palette ⌘K.
 *
 * `WINDOW_REGISTRY` (store/windowManager.ts) est la source unique des fenêtres : le menu
 * Fonctions, la persistance et le montage (map typée par `WindowId`) en dérivent — oublier
 * une entrée y casse la compilation. SEULE la palette ⌘K échappe à cette dérivation : les
 * commandes `panneau:*` sont écrites À LA MAIN (ici, ou dans le store de la fenêtre). Une
 * 38ᵉ fenêtre serait donc muette au ⌘K sans que rien ne le signale.
 *
 * Ce fichier ferme le trou : toute fenêtre du registre DOIT être ouvrable par une commande,
 * soit de `windowPanelCommands`, soit — liste explicite ci-dessous — d'un autre module.
 *
 * Méthode : les ids couverts sont obtenus en EXÉCUTANT chaque action contre un
 * `windowManagerStore` factice (et non en relisant le source) — un `basculer()` mal câblé
 * est ainsi détecté. Le registre lui-même reste RÉEL (spread de `importOriginal`).
 */
import { describe, it, expect, vi } from "vitest";

// Journal des `toggleWindow(id)` déclenchés. `vi.hoisted` : `vi.mock` est remonté au-dessus
// des imports, la fabrique ne peut donc pas fermer sur une const déclarée normalement.
const { fenetresBasculees } = vi.hoisted(() => ({ fenetresBasculees: [] as string[] }));

// Seul `windowManagerStore` est remplacé : le reste du module (dont WINDOW_REGISTRY) est
// le vrai. Les actions globales (WMIN/WALL/WTILE/WCASC/WCLOSE) sont neutralisées — en
// environnement Node elles lèveraient (lecture de `window.innerWidth`).
vi.mock("../store/windowManager", async (importOriginal) => {
  const reel = await importOriginal<typeof import("../store/windowManager")>();
  return {
    ...reel,
    windowManagerStore: {
      getState: () => ({
        toggleWindow: (id: string) => {
          fenetresBasculees.push(id);
        },
        minimizeAll: () => {},
        restoreAll: () => {},
        tileOpenWindows: () => {},
        cascadeAll: () => {},
        closeAll: () => {},
      }),
    },
  };
});

import { WINDOW_REGISTRY } from "../store/windowManager";
import { windowPanelCommands } from "./windowPanels";

/**
 * Fenêtres dont la commande ⌘K vit AILLEURS que dans `windowPanels.ts` (leur store métier
 * porte déjà la commande). Vérifiées une par une le 2026-08-09 — chaque entrée cite le
 * module et l'id de commande constatés.
 *
 * LIMITE ASSUMÉE : cette liste asserte OÙ se trouve la commande, pas qu'elle existe encore.
 * Supprimer `panneau:eco` de store/eco.ts laisserait ce test vert (l'unicité globale de
 * registry.test.ts, elle, garde ces sources non vides).
 */
const FENETRES_COMMANDEES_AILLEURS: Record<string, string> = {
  // `registry.ts` → `panneau:derives` (DES), via `derivativesUiStore.toggleDerivatives()`.
  // Seule fenêtre commandée depuis le registre statique et non depuis un store greffé.
  derivatives: "commands/registry.ts — panneau:derives (DES)",
  eco: "store/eco.ts — panneau:eco (ECO), via toggleEco()",
  news: "store/news.ts — panneau:news (NEWS), via toggleNews()",
  onchain: "store/onchain.ts — panneau:onchain (CHAIN), via toggleOnchain()",
  portfolio: "store/portfolio.ts — panneau:portfolio (PORT), via togglePortfolio()",
  notes: "store/notes.ts — panneau:notes (NOTE), via toggleNotes()",
  screener: "store/screener.ts — panneau:screener (EQS), via toggle()",
  dom: "store/dom-ui.ts — panneau:dom (DOM), via toggleDom()",
  backtest: "store/backtest.ts — panneau:backtest (BT), via toggle()",
  replay: "store/replay.ts — panneau:replay (REPLAY), toggleWindow direct",
  globe: "store/globe-ui.ts — panneau:globe (GLOBE), via toggleGlobe()",
};

describe("couverture ⌘K du registre de fenêtres", () => {
  // Une seule exécution des actions, partagée par les cas ci-dessous.
  for (const cmd of windowPanelCommands) cmd.action();
  const idsCouverts = new Set(fenetresBasculees);
  const idsRegistre = new Set<string>(WINDOW_REGISTRY.map((w) => w.id));

  it("toute fenêtre du registre est ouvrable depuis la palette", () => {
    const muettes = [...idsRegistre].filter(
      (id) => !idsCouverts.has(id) && FENETRES_COMMANDEES_AILLEURS[id] === undefined,
    );
    expect(
      muettes,
      "fenêtre(s) sans commande ⌘K — ajouter la commande dans windowPanels.ts, " +
        "ou déclarer son module dans FENETRES_COMMANDEES_AILLEURS",
    ).toEqual([]);
  });

  it("aucune entrée morte dans FENETRES_COMMANDEES_AILLEURS", () => {
    // Une fenêtre rapatriée dans windowPanels.ts doit sortir de la liste, sinon celle-ci
    // documente un emplacement faux.
    const mortes = Object.keys(FENETRES_COMMANDEES_AILLEURS).filter((id) => idsCouverts.has(id));
    expect(
      mortes,
      "fenêtre(s) désormais commandées par windowPanels.ts — les retirer de la liste",
    ).toEqual([]);
  });

  it("windowPanels.ts ne bascule aucune fenêtre absente du registre", () => {
    // Sens inverse : un renommage d'id dans le registre laisserait ici un `basculer()` mort.
    expect([...idsCouverts].filter((id) => !idsRegistre.has(id))).toEqual([]);
  });
});
