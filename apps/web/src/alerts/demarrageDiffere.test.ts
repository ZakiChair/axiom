/**
 * Démarrage différé du runtime des alertes : succès, échec signalé (avis, « Recharger » en
 * ligne) puis nouvelle tentative (`online`, retour de l'onglet), une tentative à la fois,
 * annulation pendant le chargement, jamais deux runtimes. L'état « alertes inactives » dure
 * plus que son toast : ligne « alertes » du registre santé, posée à l'échec ou après dix
 * secondes de chargement, retirée au démarrage, absente en nominal. Le chargeur est injecté (promesses
 * pilotées par le test) ; le dernier bloc passe par le vrai `import("./runtime")`, mêmes
 * doublures que runtime.heartbeat-transition.test.ts. Aucun réseau. Le câblage d'App et le
 * comportement réel du navigateur sont tenus par e2e/mobile-alertes-differees.e2e.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { detectDaemonMock } = vi.hoisted(() => ({ detectDaemonMock: vi.fn() }));
vi.mock("../data/daemon", () => ({
  daemonPret: () => false,
  daemonSupporte: () => true,
  detectDaemon: detectDaemonMock,
  urlDaemon: (chemin: string) => chemin,
  kvPut: async () => null,
}));
vi.mock("../data/ticker", () => ({
  isTickerSource: (source: string) => source === "binance",
  subscribeTickers: () => () => {},
}));
vi.mock("../chart/liquidationMarkers", () => ({
  fluxLiqRetenu: () => false,
  liqEventsStore: { getState: () => ({ events: [] }), subscribe: () => () => {} },
}));

import {
  AVIS_ALERTES_CHARGEMENT,
  AVIS_ALERTES_INACTIVES,
  DELAI_CHARGEMENT_LENT_MS,
  SOURCE_SANTE_ALERTES,
  demarrerAlertesDifferees,
} from "./demarrageDiffere";
import { degradedLevel } from "../components/HealthPanel";
import { healthStore, type SanteSource } from "../store/health";
import { toastsStore } from "../store/toasts";

type ModuleRuntime = { demarrerAlertes: () => () => void };

/** Promesse pilotée par le test : un `import()` dont on choisit l'issue et l'instant. */
function differe(): { promesse: Promise<ModuleRuntime>; resoudre: (m: ModuleRuntime) => void; rejeter: (e: unknown) => void } {
  let resoudre!: (m: ModuleRuntime) => void;
  let rejeter!: (e: unknown) => void;
  const promesse = new Promise<ModuleRuntime>((res, rej) => {
    resoudre = res;
    rejeter = rej;
  });
  return { promesse, resoudre, rejeter };
}

/** Laisse s'exécuter les suites de promesses (sans avancer l'horloge). */
const vider = (): Promise<unknown> => vi.advanceTimersByTimeAsync(0);
const textesToasts = (): string[] => toastsStore.getState().toasts.map((t) => t.texte);
/** Ligne « alertes » du registre santé : l'état qui reste quand le toast a expiré. */
const santeAlertes = (): SanteSource | undefined => healthStore.getState().sources[SOURCE_SANTE_ALERTES];
/** La ligne telle que la pose un échec : en erreur, sans horodatage inventé. */
const ligneErreur = (texte: string): SanteSource => ({ source: "alertes", etat: "error", dernierMessageTs: 0, derniereErreur: texte });
const DEMARRAGE_ECHOUE = "Alertes inactives : démarrage échoué";

/** Écouteurs posés et pas encore retirés, par cible : « online », « visibilitychange ». */
let ecouteursActifs: string[];
/** Cible d'évènements qui tient le compte de ses écouteurs (aucune fuite après succès ou arrêt). */
function cibleComptee<T extends object>(champs: T): EventTarget & T {
  const cible = Object.assign(new EventTarget(), champs);
  const ajouter = cible.addEventListener.bind(cible);
  const retirer = cible.removeEventListener.bind(cible);
  cible.addEventListener = (type: string, ecouteur: EventListenerOrEventListenerObject | null): void => {
    ecouteursActifs.push(type);
    ajouter(type, ecouteur);
  };
  cible.removeEventListener = (type: string, ecouteur: EventListenerOrEventListenerObject | null): void => {
    const index = ecouteursActifs.indexOf(type);
    if (index >= 0) ecouteursActifs.splice(index, 1);
    retirer(type, ecouteur);
  };
  return cible;
}

let fenetre: EventTarget & { location: { reload: () => void } };
let documentTest: EventTarget & { visibilityState: string };
let recharger: ReturnType<typeof vi.fn<() => void>>;
let erreurConsole: ReturnType<typeof vi.spyOn>;
let arret: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  toastsStore.setState({ toasts: [] });
  healthStore.setState({ sources: {} });
  ecouteursActifs = [];
  recharger = vi.fn<() => void>();
  fenetre = cibleComptee({ location: { reload: recharger } });
  documentTest = cibleComptee({ visibilityState: "visible" });
  vi.stubGlobal("window", fenetre);
  vi.stubGlobal("document", documentTest);
  vi.stubGlobal("navigator", { onLine: true });
  erreurConsole = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  arret?.();
  arret = undefined;
  erreurConsole.mockRestore();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("démarrage différé — chargement réussi", () => {
  it("charge une fois, démarre une fois, sans avis ni erreur ; l'arrêt arrête le runtime une seule fois", async () => {
    const stopRuntime = vi.fn();
    const demarrerAlertes = vi.fn(() => stopRuntime);
    const charger = vi.fn(async () => ({ demarrerAlertes }));
    arret = demarrerAlertesDifferees(charger);
    expect(demarrerAlertes).not.toHaveBeenCalled(); // rien de synchrone : le module n'est pas encore là
    await vider();
    expect(charger).toHaveBeenCalledTimes(1);
    expect(demarrerAlertes).toHaveBeenCalledTimes(1);
    expect(textesToasts()).toEqual([]);
    expect(erreurConsole).not.toHaveBeenCalled();
    expect(ecouteursActifs).toEqual([]);
    expect(healthStore.getState().sources).toEqual({}); // nominal : aucune ligne santé

    // Runtime démarré : ni `online` ni un retour d'onglet ne relancent un chargement.
    fenetre.dispatchEvent(new Event("online"));
    documentTest.dispatchEvent(new Event("visibilitychange"));
    await vider();
    expect(charger).toHaveBeenCalledTimes(1);
    expect(demarrerAlertes).toHaveBeenCalledTimes(1);

    arret();
    arret();
    arret = undefined;
    expect(stopRuntime).toHaveBeenCalledTimes(1);
    expect(healthStore.getState().sources).toEqual({});
  });
});

describe("démarrage différé — échec de chargement", () => {
  it("signale l'échec (console.error + avis), puis retente au prochain `online` et remplace l'avis au succès", async () => {
    const echec = new TypeError("Failed to fetch dynamically imported module");
    const stopRuntime = vi.fn();
    const demarrerAlertes = vi.fn(() => stopRuntime);
    const charger = vi.fn<() => Promise<ModuleRuntime>>()
      .mockRejectedValueOnce(echec)
      .mockResolvedValueOnce({ demarrerAlertes });
    arret = demarrerAlertesDifferees(charger);
    await vider();
    expect(charger).toHaveBeenCalledTimes(1);
    expect(demarrerAlertes).not.toHaveBeenCalled();
    expect(AVIS_ALERTES_INACTIVES).toBe("Alertes inactives : module non chargé");
    expect(textesToasts()).toEqual([AVIS_ALERTES_INACTIVES]);
    expect(erreurConsole).toHaveBeenCalledTimes(1);
    expect(erreurConsole).toHaveBeenCalledWith(`[AXIOM] ${AVIS_ALERTES_INACTIVES}`, echec);
    expect(ecouteursActifs).toEqual(["online", "visibilitychange"]);
    expect(SOURCE_SANTE_ALERTES).toBe("alertes");
    expect(santeAlertes()).toEqual(ligneErreur(AVIS_ALERTES_INACTIVES));

    fenetre.dispatchEvent(new Event("online"));
    await vider();
    expect(charger).toHaveBeenCalledTimes(2);
    expect(demarrerAlertes).toHaveBeenCalledTimes(1);
    // L'avis encore affiché et la ligne santé disparaissent ; un toast annonce le rétablissement.
    expect(textesToasts()).toEqual(["Alertes actives"]);
    expect(healthStore.getState().sources).toEqual({});
    expect(erreurConsole).toHaveBeenCalledTimes(1);

    // Chargé : les écouteurs sont retirés, plus aucune tentative.
    expect(ecouteursActifs).toEqual([]);
    fenetre.dispatchEvent(new Event("online"));
    documentTest.dispatchEvent(new Event("visibilitychange"));
    await vider();
    expect(charger).toHaveBeenCalledTimes(2);

    arret();
    arret = undefined;
    expect(stopRuntime).toHaveBeenCalledTimes(1);
  });

  it("retente au retour de l'onglet au premier plan, jamais quand il passe en arrière-plan", async () => {
    const demarrerAlertes = vi.fn(() => () => {});
    const charger = vi.fn<() => Promise<ModuleRuntime>>()
      .mockRejectedValueOnce(new Error("réseau coupé"))
      .mockResolvedValueOnce({ demarrerAlertes });
    arret = demarrerAlertesDifferees(charger);
    await vider();
    expect(charger).toHaveBeenCalledTimes(1);

    documentTest.visibilityState = "hidden";
    documentTest.dispatchEvent(new Event("visibilitychange"));
    await vider();
    expect(charger).toHaveBeenCalledTimes(1);

    documentTest.visibilityState = "visible";
    documentTest.dispatchEvent(new Event("visibilitychange"));
    await vider();
    expect(charger).toHaveBeenCalledTimes(2);
    expect(demarrerAlertes).toHaveBeenCalledTimes(1);
  });

  it("une seule tentative à la fois : les évènements reçus pendant un chargement ne l'empilent pas", async () => {
    const seconde = differe();
    const demarrerAlertes = vi.fn(() => () => {});
    const charger = vi.fn<() => Promise<ModuleRuntime>>()
      .mockRejectedValueOnce(new Error("réseau coupé"))
      .mockReturnValueOnce(seconde.promesse);
    arret = demarrerAlertesDifferees(charger);
    await vider();

    fenetre.dispatchEvent(new Event("online"));
    fenetre.dispatchEvent(new Event("online"));
    documentTest.dispatchEvent(new Event("visibilitychange"));
    await vider();
    expect(charger).toHaveBeenCalledTimes(2);

    seconde.resoudre({ demarrerAlertes });
    await vider();
    expect(demarrerAlertes).toHaveBeenCalledTimes(1);
  });

  it("chaque nouvel échec est signalé à son tour, et la tentative suivante reste possible", async () => {
    const demarrerAlertes = vi.fn(() => () => {});
    const charger = vi.fn<() => Promise<ModuleRuntime>>()
      .mockRejectedValueOnce(new Error("échec 1"))
      .mockRejectedValueOnce(new Error("échec 2"))
      .mockResolvedValueOnce({ demarrerAlertes });
    arret = demarrerAlertesDifferees(charger);
    await vider();
    await vi.advanceTimersByTimeAsync(7_000); // le premier avis a expiré (toast actionnable : 6 s)
    expect(textesToasts()).toEqual([]);
    // Le toast a expiré, pas l'état : la ligne santé reste tant que le runtime n'est pas démarré.
    expect(santeAlertes()).toEqual(ligneErreur(AVIS_ALERTES_INACTIVES));

    fenetre.dispatchEvent(new Event("online"));
    await vider();
    expect(charger).toHaveBeenCalledTimes(2);
    expect(erreurConsole).toHaveBeenCalledTimes(2);
    expect(textesToasts()).toEqual([AVIS_ALERTES_INACTIVES]);
    expect(ecouteursActifs).toEqual(["online", "visibilitychange"]); // armés une seule fois
    await vi.advanceTimersByTimeAsync(60 * 60_000); // une heure d'onglet laissé au premier plan
    expect(textesToasts()).toEqual([]);
    expect(santeAlertes()).toEqual(ligneErreur(AVIS_ALERTES_INACTIVES));

    documentTest.dispatchEvent(new Event("visibilitychange"));
    await vider();
    expect(charger).toHaveBeenCalledTimes(3);
    expect(demarrerAlertes).toHaveBeenCalledTimes(1);
    // Avis déjà expiré : le rétablissement est quand même annoncé, et la ligne santé retirée.
    expect(textesToasts()).toEqual(["Alertes actives"]);
    expect(healthStore.getState().sources).toEqual({});
  });

  it("la ligne posée met en erreur le niveau santé global (pastille « Santé » du bandeau) sans toucher aux autres sources", async () => {
    healthStore.getState().setEtat("binance", "connected", { dernierMessageTs: 1 });
    expect(degradedLevel(healthStore.getState().sources)).toBeNull();
    const demarrerAlertes = vi.fn(() => () => {});
    const charger = vi.fn<() => Promise<ModuleRuntime>>()
      .mockRejectedValueOnce(new Error("réseau coupé"))
      .mockResolvedValueOnce({ demarrerAlertes });
    arret = demarrerAlertesDifferees(charger);
    await vider();
    expect(degradedLevel(healthStore.getState().sources)).toBe("error");
    expect(Object.keys(healthStore.getState().sources).sort()).toEqual(["alertes", "binance"]);

    fenetre.dispatchEvent(new Event("online"));
    await vider();
    expect(degradedLevel(healthStore.getState().sources)).toBeNull();
    expect(healthStore.getState().sources).toEqual({ binance: { source: "binance", etat: "connected", dernierMessageTs: 1 } });
  });

  it("deux échecs rapprochés (réveil du téléphone : retour d'onglet puis `online`) ne laissent qu'un avis", async () => {
    const charger = vi.fn<() => Promise<ModuleRuntime>>().mockRejectedValue(new Error("chunk introuvable"));
    arret = demarrerAlertesDifferees(charger);
    await vider();
    const idPremier = toastsStore.getState().toasts[0]?.id;

    await vi.advanceTimersByTimeAsync(1_000);
    documentTest.dispatchEvent(new Event("visibilitychange"));
    await vider();
    await vi.advanceTimersByTimeAsync(300);
    fenetre.dispatchEvent(new Event("online"));
    await vider();
    expect(charger).toHaveBeenCalledTimes(3);
    expect(erreurConsole).toHaveBeenCalledTimes(3); // chaque échec reste journalisé
    // Un seul avis, le plus récent : il remplace celui de l'échec précédent.
    expect(textesToasts()).toEqual([AVIS_ALERTES_INACTIVES]);
    const idDernier = toastsStore.getState().toasts[0]?.id;
    expect(idDernier).not.toBe(idPremier);

    // Les minuteurs des avis remplacés n'emportent pas le dernier : il vit ses 6 s entières.
    await vi.advanceTimersByTimeAsync(5_900);
    expect(toastsStore.getState().toasts.map((t) => t.id)).toEqual([idDernier]);
    await vi.advanceTimersByTimeAsync(200);
    expect(textesToasts()).toEqual([]);
    expect(santeAlertes()).toEqual(ligneErreur(AVIS_ALERTES_INACTIVES));
  });

  it("l'avis d'un autre texte n'est jamais retiré par un nouvel échec", async () => {
    const charger = vi.fn<() => Promise<ModuleRuntime>>().mockRejectedValue(new Error("chunk introuvable"));
    arret = demarrerAlertesDifferees(charger);
    await vider();
    toastsStore.setState((s) => ({ toasts: [...s.toasts, { id: 9_999, texte: "Workspace enregistré" }] }));
    fenetre.dispatchEvent(new Event("online"));
    await vider();
    expect(textesToasts()).toEqual(["Workspace enregistré", AVIS_ALERTES_INACTIVES]);
  });

  it("en ligne, l'avis propose « Recharger » (seul remède quand le navigateur a mémorisé l'échec)", async () => {
    const charger = vi.fn<() => Promise<ModuleRuntime>>().mockRejectedValue(new Error("chunk introuvable"));
    arret = demarrerAlertesDifferees(charger);
    await vider();
    const [avis] = toastsStore.getState().toasts;
    expect(avis?.texte).toBe(AVIS_ALERTES_INACTIVES);
    expect(avis?.action?.libelle).toBe("Recharger");
    expect(recharger).not.toHaveBeenCalled();
    avis?.action?.executer();
    expect(recharger).toHaveBeenCalledTimes(1);
  });

  it("hors ligne, l'avis ne propose pas de recharger ; le bouton revient avec l'échec suivant, réseau rétabli", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const charger = vi.fn<() => Promise<ModuleRuntime>>().mockRejectedValue(new Error("réseau coupé"));
    arret = demarrerAlertesDifferees(charger);
    await vider();
    expect(toastsStore.getState().toasts.map((t) => [t.texte, t.action?.libelle])).toEqual([[AVIS_ALERTES_INACTIVES, undefined]]);
    await vi.advanceTimersByTimeAsync(3_000);

    vi.stubGlobal("navigator", { onLine: true });
    fenetre.dispatchEvent(new Event("online"));
    await vider();
    expect(toastsStore.getState().toasts.map((t) => [t.texte, t.action?.libelle])).toEqual([[AVIS_ALERTES_INACTIVES, "Recharger"]]);
  });

  it("arrêt après un échec : écouteurs retirés, plus aucune tentative", async () => {
    const charger = vi.fn<() => Promise<ModuleRuntime>>().mockRejectedValue(new Error("réseau coupé"));
    arret = demarrerAlertesDifferees(charger);
    await vider();
    expect(ecouteursActifs).toEqual(["online", "visibilitychange"]);
    expect(santeAlertes()).toEqual(ligneErreur(AVIS_ALERTES_INACTIVES));
    arret();
    arret = undefined;
    expect(ecouteursActifs).toEqual([]);
    expect(healthStore.getState().sources).toEqual({}); // plus d'instance : plus de ligne santé
    fenetre.dispatchEvent(new Event("online"));
    documentTest.dispatchEvent(new Event("visibilitychange"));
    await vider();
    expect(charger).toHaveBeenCalledTimes(1);
  });

  it("un arrêt périmé ne retire pas la ligne santé posée par l'instance vivante", async () => {
    const charger = vi.fn<() => Promise<ModuleRuntime>>().mockRejectedValue(new Error("réseau coupé"));
    const arretPremier = demarrerAlertesDifferees(charger);
    await vider();
    arretPremier();
    expect(healthStore.getState().sources).toEqual({});

    arret = demarrerAlertesDifferees(charger);
    await vider();
    expect(santeAlertes()).toEqual(ligneErreur(AVIS_ALERTES_INACTIVES));
    arretPremier(); // arrêt périmé du premier montage
    expect(santeAlertes()).toEqual(ligneErreur(AVIS_ALERTES_INACTIVES));
    arret();
    arret = undefined;
    expect(healthStore.getState().sources).toEqual({});
  });

  it("module chargé mais démarrage en échec : signalé, sans nouvelle tentative", async () => {
    const panne = new TypeError("définition illisible");
    const demarrerAlertes = vi.fn((): (() => void) => {
      throw panne;
    });
    const charger = vi.fn(async () => ({ demarrerAlertes }));
    arret = demarrerAlertesDifferees(charger);
    await vider();
    expect(textesToasts()).toEqual([DEMARRAGE_ECHOUE]);
    expect(erreurConsole).toHaveBeenCalledWith(`[AXIOM] ${DEMARRAGE_ECHOUE}`, panne);
    expect(ecouteursActifs).toEqual([]);
    expect(santeAlertes()).toEqual(ligneErreur(DEMARRAGE_ECHOUE));

    fenetre.dispatchEvent(new Event("online"));
    documentTest.dispatchEvent(new Event("visibilitychange"));
    await vider();
    expect(charger).toHaveBeenCalledTimes(1);
    expect(demarrerAlertes).toHaveBeenCalledTimes(1);
    // Aucune nouvelle tentative : la ligne santé reste jusqu'au rechargement, le toast expire.
    await vi.advanceTimersByTimeAsync(7_000);
    expect(textesToasts()).toEqual([]);
    expect(santeAlertes()).toEqual(ligneErreur(DEMARRAGE_ECHOUE));
  });

  it("chargement en échec, puis module chargé mais démarrage en échec : un seul avis, celui du dernier état", async () => {
    const demarrerAlertes = vi.fn((): (() => void) => {
      throw new TypeError("définition illisible");
    });
    const charger = vi.fn<() => Promise<ModuleRuntime>>()
      .mockRejectedValueOnce(new Error("réseau coupé"))
      .mockResolvedValueOnce({ demarrerAlertes });
    arret = demarrerAlertesDifferees(charger);
    await vider();
    expect(textesToasts()).toEqual([AVIS_ALERTES_INACTIVES]);

    fenetre.dispatchEvent(new Event("online"));
    await vider();
    // « module non chargé » serait faux désormais : l'avis et la ligne santé disent le démarrage échoué.
    expect(textesToasts()).toEqual([DEMARRAGE_ECHOUE]);
    expect(santeAlertes()).toEqual(ligneErreur(DEMARRAGE_ECHOUE));
    expect(ecouteursActifs).toEqual([]);
    arret();
    arret = undefined;
    expect(healthStore.getState().sources).toEqual({});
  });
});

describe("démarrage différé — chargement qui traîne", () => {
  it("après dix secondes sans module, l'état est dit au registre santé, sans toast ni erreur ; le démarrage le lève sans annoncer de rétablissement", async () => {
    const chargement = differe();
    const demarrerAlertes = vi.fn(() => () => {});
    arret = demarrerAlertesDifferees(() => chargement.promesse);
    await vi.advanceTimersByTimeAsync(DELAI_CHARGEMENT_LENT_MS - 1);
    expect(santeAlertes()).toBeUndefined(); // un chargement ordinaire ne s'affiche pas
    await vi.advanceTimersByTimeAsync(1);
    expect(santeAlertes()).toEqual(ligneErreur(AVIS_ALERTES_CHARGEMENT));
    expect(textesToasts()).toEqual([]); // rien n'a échoué : pas d'avis
    expect(erreurConsole).not.toHaveBeenCalled();
    expect(ecouteursActifs).toEqual([]); // la tentative est toujours en cours : rien à relancer

    chargement.resoudre({ demarrerAlertes });
    await vider();
    expect(demarrerAlertes).toHaveBeenCalledTimes(1);
    expect(healthStore.getState().sources).toEqual({});
    expect(textesToasts()).toEqual([]); // aucun avis n'avait été affiché : pas de « Alertes actives »
  });

  it("un chargement terminé avant dix secondes ne pose jamais la ligne, même longtemps après", async () => {
    const chargement = differe();
    arret = demarrerAlertesDifferees(() => chargement.promesse);
    await vi.advanceTimersByTimeAsync(DELAI_CHARGEMENT_LENT_MS - 1);
    chargement.resoudre({ demarrerAlertes: () => () => {} });
    await vi.advanceTimersByTimeAsync(DELAI_CHARGEMENT_LENT_MS * 3);
    expect(healthStore.getState().sources).toEqual({});
  });

  it("l'échec qui suit un chargement lent remplace l'état par l'avis d'échec, et la tentative suivante redevient lente à son tour", async () => {
    const premier = differe();
    const second = differe();
    const charger = vi.fn<() => Promise<ModuleRuntime>>().mockReturnValueOnce(premier.promesse).mockReturnValueOnce(second.promesse);
    arret = demarrerAlertesDifferees(charger);
    await vi.advanceTimersByTimeAsync(DELAI_CHARGEMENT_LENT_MS);
    premier.rejeter(new Error("chunk introuvable"));
    await vider();
    expect(santeAlertes()).toEqual(ligneErreur(AVIS_ALERTES_INACTIVES));
    expect(textesToasts()).toEqual([AVIS_ALERTES_INACTIVES]);

    // Nouvelle tentative qui traîne à son tour : l'état dit qu'un chargement est en cours.
    fenetre.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(DELAI_CHARGEMENT_LENT_MS);
    expect(santeAlertes()).toEqual(ligneErreur(AVIS_ALERTES_CHARGEMENT));
    second.resoudre({ demarrerAlertes: () => () => {} });
    await vider();
    expect(healthStore.getState().sources).toEqual({});
  });

  it("un arrêt pendant un chargement lent retire la ligne ; un arrêt plus tôt désarme la minuterie", async () => {
    const lent = differe();
    arret = demarrerAlertesDifferees(() => lent.promesse);
    await vi.advanceTimersByTimeAsync(DELAI_CHARGEMENT_LENT_MS);
    expect(santeAlertes()).toEqual(ligneErreur(AVIS_ALERTES_CHARGEMENT));
    arret();
    arret = undefined;
    expect(healthStore.getState().sources).toEqual({});

    const interrompu = differe();
    const arreterTot = demarrerAlertesDifferees(() => interrompu.promesse);
    await vi.advanceTimersByTimeAsync(DELAI_CHARGEMENT_LENT_MS - 1);
    arreterTot();
    await vi.advanceTimersByTimeAsync(DELAI_CHARGEMENT_LENT_MS);
    expect(healthStore.getState().sources).toEqual({});
  });
});

describe("démarrage différé — démontage pendant le chargement", () => {
  it("un arrêt avant la fin du chargement annule le démarrage", async () => {
    const chargement = differe();
    const demarrerAlertes = vi.fn(() => () => {});
    arret = demarrerAlertesDifferees(() => chargement.promesse);
    arret();
    arret = undefined;
    chargement.resoudre({ demarrerAlertes });
    await vider();
    expect(demarrerAlertes).not.toHaveBeenCalled();
  });

  it("un échec arrivé après l'arrêt reste muet et n'arme aucune nouvelle tentative", async () => {
    const chargement = differe();
    const charger = vi.fn(() => chargement.promesse);
    arret = demarrerAlertesDifferees(charger);
    arret();
    arret = undefined;
    chargement.rejeter(new Error("réseau coupé"));
    await vider();
    expect(textesToasts()).toEqual([]);
    expect(erreurConsole).not.toHaveBeenCalled();
    expect(healthStore.getState().sources).toEqual({});
    fenetre.dispatchEvent(new Event("online"));
    await vider();
    expect(charger).toHaveBeenCalledTimes(1);
  });

  it("double montage StrictMode (montage, démontage, remontage) : un seul runtime démarré, arrêté par le second arrêt", async () => {
    const chargement = differe(); // un même module pour les deux `import()`, comme dans le navigateur
    const stopRuntime = vi.fn();
    const demarrerAlertes = vi.fn(() => stopRuntime);
    const charger = vi.fn(() => chargement.promesse);
    const arretPremier = demarrerAlertesDifferees(charger);
    arretPremier();
    arret = demarrerAlertesDifferees(charger);
    chargement.resoudre({ demarrerAlertes });
    await vider();
    expect(demarrerAlertes).toHaveBeenCalledTimes(1);

    arretPremier(); // arrêt périmé du premier montage : sans effet sur le runtime vivant
    expect(stopRuntime).not.toHaveBeenCalled();
    arret();
    arret = undefined;
    expect(stopRuntime).toHaveBeenCalledTimes(1);
  });
});

describe("démarrage différé — vrai module alerts/runtime", () => {
  const fetchMock = vi.fn();
  const heartbeats = (): unknown[] => fetchMock.mock.calls.filter(([url]) => url === "/heartbeat");

  beforeEach(() => {
    // Le runtime ne lit `window` que pour le bip : on lui rend l'absence de DOM de Vitest.
    vi.unstubAllGlobals();
    vi.stubGlobal("document", documentTest);
    vi.stubGlobal("Notification", { permission: "granted" });
    detectDaemonMock.mockReset();
    detectDaemonMock.mockResolvedValue(true);
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response("{}", { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
  });

  it("double montage StrictMode : un seul runtime bat le cœur, et plus aucun après l'arrêt", async () => {
    const arretPremier = demarrerAlertesDifferees();
    arretPremier();
    arret = demarrerAlertesDifferees();
    await vi.dynamicImportSettled();
    await vider();
    // Une détection du daemon par runtime créé : le montage annulé n'en a créé aucun.
    expect(detectDaemonMock).toHaveBeenCalledTimes(1);
    // Un heartbeat initial, puis un par période de 30 s.
    expect(heartbeats()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(heartbeats()).toHaveLength(2);
    expect(textesToasts()).toEqual([]);
    expect(erreurConsole).not.toHaveBeenCalled();
    expect(santeAlertes()).toBeUndefined();

    arret();
    arret = undefined;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(heartbeats()).toHaveLength(2);
  });
});
