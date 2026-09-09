import { describe, expect, it, vi } from "vitest";
import { creerChargeurChain, type SourceChain } from "./chargementChain";

describe("chargement CHAIN indépendant", () => {
  it("publie une source rapide pendant qu'une autre reste suspendue", async () => {
    let liberer!: (value: string) => void;
    const lente = new Promise<string>((resolve) => { liberer = resolve; });
    const sources: SourceChain<string>[] = [
      { id: "lente", charger: async () => lente },
      { id: "rapide", charger: async () => "visible" },
    ];
    const publications: string[] = [];
    const cycle = creerChargeurChain().lancer(sources, (p) => publications.push(`${p.id}:${p.valeur}`));
    await Promise.resolve();
    await Promise.resolve();
    expect(publications).toEqual(["rapide:visible"]);
    liberer("fin");
    await cycle;
  });

  it("ignore les publications d'une génération remplacée", async () => {
    let liberer!: (value: string) => void;
    const ancienne = new Promise<string>((resolve) => { liberer = resolve; });
    const chargeur = creerChargeurChain();
    const publications: string[] = [];
    void chargeur.lancer([{ id: "cm", charger: async () => ancienne }], (p) => publications.push(String(p.valeur)));
    await chargeur.lancer([{ id: "cm", charger: async () => "nouveau" }], (p) => publications.push(String(p.valeur)));
    liberer("ancien");
    await Promise.resolve();
    expect(publications).toEqual(["nouveau"]);
  });

  it("aborte le cycle au démontage et fournit un délai réseau de 15 secondes", async () => {
    vi.useFakeTimers();
    let signalVu: AbortSignal | undefined;
    const chargeur = creerChargeurChain();
    void chargeur.lancer([{ id: "reseau", charger: async (signal) => {
      signalVu = signal;
      return await new Promise<string>(() => undefined);
    } }], () => undefined);
    await Promise.resolve();
    expect(signalVu?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(signalVu?.aborted).toBe(true);
    chargeur.annuler();
    vi.useRealTimers();
  });

  it("annule une promesse pendante avant le timeout sans publication tardive", async () => {
    vi.useFakeTimers();
    let liberer!: (value: string) => void;
    let signalVu: AbortSignal | undefined;
    const chargeur = creerChargeurChain();
    const publications: string[] = [];
    const cycle = chargeur.lancer([{ id: "reseau", charger: async (signal) => {
      signalVu = signal;
      return await new Promise<string>((resolve) => { liberer = resolve; });
    } }], (p) => publications.push(String(p.valeur)));
    await Promise.resolve();
    chargeur.annuler();
    await cycle;
    expect(signalVu?.aborted).toBe(true);
    expect(publications).toEqual([]);
    liberer("trop tard");
    await Promise.resolve();
    expect(publications).toEqual([]);
    vi.useRealTimers();
  });
});
