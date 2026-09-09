import { afterEach, describe, expect, it, vi } from "vitest";
import { creerGestionnaireFluxCapitaux, ecouterRotationsClesFlux } from "./fluxCapitaux";
import type { VueFluxCapitaux } from "../data/onchain/fluxCapitaux";
import { soSoValueKeyStore } from "./sosovalue";

const SNAPSHOT: VueFluxCapitaux = { recupereLe: 10, metriques: [] };

afterEach(() => vi.useRealTimers());

describe("gestionnaire partagé des flux de capitaux", () => {
  it("coalesce les vues et ne conserve le timer qu'avec un consommateur", async () => {
    vi.useFakeTimers();
    let resoudre!: (value: VueFluxCapitaux) => void;
    const charger = vi.fn(() => new Promise<VueFluxCapitaux>((resolve) => { resoudre = resolve; }));
    const gestionnaire = creerGestionnaireFluxCapitaux(charger, 60_000);

    const libererChain = gestionnaire.retenirVue();
    const libererBrief = gestionnaire.retenirVue();
    expect(charger).toHaveBeenCalledTimes(1);
    resoudre(SNAPSHOT);
    await Promise.resolve();
    expect(gestionnaire.store.getState().donnees).toBe(SNAPSHOT);

    libererChain();
    libererBrief();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(charger).toHaveBeenCalledTimes(1);
  });

  it("continue de charger sans panneau quand une alerte lente est active", async () => {
    vi.useFakeTimers();
    const charger = vi.fn(async () => SNAPSHOT);
    const gestionnaire = creerGestionnaireFluxCapitaux(charger, 60_000);
    gestionnaire.garderPourAlertes(true);
    await Promise.resolve();
    expect(charger).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(charger).toHaveBeenCalledTimes(2);
    gestionnaire.garderPourAlertes(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(charger).toHaveBeenCalledTimes(2);
  });

  it("relance après un démontage/remontage pendant une requête annulée", () => {
    vi.useFakeTimers();
    const charger = vi.fn((_signal?: AbortSignal) => new Promise<VueFluxCapitaux>(() => {}));
    const gestionnaire = creerGestionnaireFluxCapitaux(charger, 60_000);
    const liberer = gestionnaire.retenirVue();
    liberer();
    gestionnaire.retenirVue();
    expect(charger).toHaveBeenCalledTimes(2);
  });

  it("dégrade la qualité des données conservées si le rafraîchissement échoue", async () => {
    vi.useFakeTimers();
    let panne = false;
    const snapshot: VueFluxCapitaux = { recupereLe: 10, metriques: [{
      id: "exchange-netflow", libelle: "Flux", valeur: 10, unite: "BTC/j", periode: "jour", observeLe: 9,
      source: "BGeometrics", alerte: true, qualite: { sourceId: "flux:exchange-netflow", sourceEffective: "BGeometrics", observeLe: 9,
        recupereLe: 10, cadenceMs: 86_400_000, couverture: null, estime: false, acces: "abonnement", statut: "frais" },
    }] };
    const charger = vi.fn(async () => { if (panne) throw new Error("hors ligne"); return snapshot; });
    const gestionnaire = creerGestionnaireFluxCapitaux(charger, 60_000);
    gestionnaire.garderPourAlertes(true);
    await Promise.resolve();
    panne = true;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(gestionnaire.store.getState().donnees?.metriques[0]?.qualite).toMatchObject({ statut: "perime", raison: "Rafraîchissement échoué · hors ligne" });
  });

  it("annule et recharge lors d'une rotation de clé sans publier l'ancienne génération", async () => {
    const attentes: Array<{ signal?: AbortSignal; resoudre: (vue: VueFluxCapitaux) => void }> = [];
    const charger = vi.fn((signal?: AbortSignal) => new Promise<VueFluxCapitaux>((resoudre) => attentes.push({ signal, resoudre })));
    const gestionnaire = creerGestionnaireFluxCapitaux(charger, 60_000);
    soSoValueKeyStore.getState().setKey("premiere-cle");
    const arreterRotations = ecouterRotationsClesFlux(gestionnaire);
    const liberer = gestionnaire.retenirVue();
    expect(charger).toHaveBeenCalledTimes(1);

    soSoValueKeyStore.getState().setKey("deuxieme-cle");
    expect(attentes[0]?.signal?.aborted).toBe(true);
    expect(charger).toHaveBeenCalledTimes(2);
    const ancienne: VueFluxCapitaux = { recupereLe: 1, metriques: [] };
    const nouvelle: VueFluxCapitaux = { recupereLe: 2, metriques: [] };
    attentes[0]!.resoudre(ancienne);
    attentes[1]!.resoudre(nouvelle);
    await Promise.resolve();
    expect(gestionnaire.store.getState().donnees).toBe(nouvelle);
    liberer();
    arreterRotations();
    soSoValueKeyStore.getState().clearKey();
  });
});
