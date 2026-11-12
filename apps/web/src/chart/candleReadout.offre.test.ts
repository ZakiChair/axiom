/**
 * Bouton d'offre de l'encart du téléphone (`CandleReadout.montrer`, cinquième argument) : l'alerte
 * de prix au bord de la zone forte sous le doigt (phase 2 d'AXIS, lot 2, 12 novembre 2026).
 *
 * Ce que l'encart tient, quelle que soit l'offre : un bouton sous le texte au téléphone seulement,
 * actif pour l'état « offre », grisé et sans effet pour tout autre état, au même emplacement ; lui
 * seul capte le toucher ; un toucher agit puis fait relire l'offre à l'image suivante.
 *
 * Depuis la revue du lot (12 novembre 2026) : le bouton ne sort JAMAIS de la zone libre du pane
 * (il captait les touchers du bouton « Indicateurs (n) » et de l'en-tête d'un pane d'indicateur) ;
 * et l'offre est relue après chaque recalcul des indicateurs puis au toucher (`offreChangee`) : le
 * bouton d'une zone qui n'est plus tracée ne reste pas, et ne pose rien.
 *
 * Rendu vérifié sur un DOM minimal (pas de jsdom dans le dépôt, comme `paneHeaders.test.ts`) ; la
 * géométrie, le toucher réel et la lisibilité sont prouvés sur le vrai graphe
 * (`e2e/mobile-alerte-zone.e2e.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Chart, KLineData } from "klinecharts";
import { CandleReadout, type OffreEncart } from "./candleReadout";

/** Élément DOM minimal : arbre, attributs, style, écouteurs. */
class FauxElement {
  children: FauxElement[] = [];
  parent: FauxElement | null = null;
  readonly attributs = new Map<string, string>();
  readonly style: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  readonly ecouteurs = new Map<string, Array<() => void>>();
  type = "";
  textContent = "";
  offsetWidth = 382;
  clientWidth = 390;
  clientHeight = 612;
  /** Hauteur de l'encart sans bouton (prix et texte) ; un conteneur n'en a pas l'usage. */
  hauteurSansBouton = 162;
  /** Panneau « Indicateurs (n) » du conteneur (`[data-overlay-legend]`) : sa hauteur, 0 replié. */
  hauteurPanneau = 0;
  constructor(readonly tagName: string) {}
  /** Hauteur de l'encart : 162 px pour les prix et le texte, 48 px de plus avec le bouton (44 px et sa marge). */
  get offsetHeight(): number {
    return this.hauteurSansBouton + (this.children.some((c) => c.attributs.has("data-alerte-zone")) ? 48 : 0);
  }
  setAttribute(cle: string, valeur: string): void {
    this.attributs.set(cle, valeur);
  }
  getAttribute(cle: string): string | null {
    return this.attributs.get(cle) ?? null;
  }
  append(...noeuds: FauxElement[]): void {
    for (const n of noeuds) {
      n.parent = this;
      this.children.push(n);
    }
  }
  appendChild(n: FauxElement): FauxElement {
    this.append(n);
    return n;
  }
  replaceChildren(): void {
    this.children = [];
  }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  addEventListener(type: string, ecouteur: () => void): void {
    this.ecouteurs.set(type, [...(this.ecouteurs.get(type) ?? []), ecouteur]);
  }
  querySelector(selecteur: string): { offsetHeight: number } | null {
    return selecteur === "[data-overlay-legend]" ? { offsetHeight: this.hauteurPanneau } : null;
  }
  getBoundingClientRect(): { top: number; left: number } {
    return { top: 0, left: 0 };
  }
  /** Toucher : appelle les écouteurs « click », comme le navigateur après un appui. */
  cliquer(): void {
    for (const ecouteur of this.ecouteurs.get("click") ?? []) ecouteur();
  }
}

const BOUGIE: KLineData = { timestamp: 1, open: 77588.83, high: 77764.01, low: 77450, close: 77582.02 };
const TEXTE = "AXIS support fort · 5 touches · bord à -1.3 %";
const OFFRE = "Alerte de prix ↓ 76,601.83 · bord du support fort · niveau fixe, 7 jours";
const POSEE = "Alerte déjà posée ↓ 76,601.83 · bord du support fort";
const FRANCHI = "Pas d'alerte : le cours a déjà franchi le bord du support fort (76,601.83)";

describe("CandleReadout — bouton d'offre sous le texte", () => {
  let images: Array<() => void>;
  let conteneur: FauxElement;
  let encart: CandleReadout;

  /**
   * Encart créé dans un conteneur en mise en page téléphone (ou de bureau). `hauteurPane` : pane
   * des prix, qui commence à 0 ; `hauteurConteneur` : le graphe entier, panes d'indicateurs et axe
   * du temps compris (le bouton « Indicateurs (n) » est à 32 px de son bas, la zone libre s'arrête
   * 80 px avant lui). Par défaut, le portrait 390 × 844 sans pane d'indicateur.
   */
  const monter = (mobile: boolean, hauteurPane = 584, hauteurConteneur = 612): void => {
    conteneur = new FauxElement("div");
    conteneur.dataset.mobile = String(mobile);
    conteneur.clientHeight = hauteurConteneur;
    const chart = {
      getSize: () => ({ top: 0, left: 0, width: 390, height: hauteurPane }),
      getStyles: () => ({ candle: { tooltip: { offsetTop: 52 } } }),
    };
    encart = new CandleReadout(chart as unknown as Chart, conteneur as unknown as HTMLElement);
  };
  const boite = (): FauxElement => conteneur.children[0]!;
  const bouton = (): FauxElement | undefined => boite().children.find((c) => c.attributs.has("data-alerte-zone"));
  const blocTexte = (): FauxElement | undefined => boite().children.find((c) => c.attributs.has("data-candle-readout-texte"));
  /** Joue les rappels d'animation en attente (une image). */
  const imageSuivante = (): void => {
    for (const rappel of images.splice(0)) rappel();
  };
  const offre = (etat: string, libelle: string, executer: () => void = () => {}): (() => OffreEncart) => () => ({ etat, libelle, executer });

  beforeEach(() => {
    images = [];
    vi.stubGlobal("document", { createElement: (tag: string) => new FauxElement(tag), querySelector: () => null });
    vi.stubGlobal("requestAnimationFrame", (rappel: () => void) => images.push(rappel));
    monter(true);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("téléphone, état « offre » : un bouton actif après le texte, cible de 44 px, seul à capter le toucher", () => {
    encart.montrer(BOUGIE, 200, 500, TEXTE, offre("offre", OFFRE));
    const b = bouton()!;
    expect(b.tagName).toBe("button");
    expect(b.type).toBe("button");
    expect(b.textContent).toBe(OFFRE);
    expect(b.getAttribute("data-alerte-zone")).toBe("offre");
    expect(b.getAttribute("aria-disabled")).toBeNull();
    expect(b.style.cssText).toContain("min-height:44px");
    expect(b.style.cssText).toContain("pointer-events:auto");
    expect(b.style.cssText).toContain("white-space:normal");
    expect(b.style.cssText).toContain("color:var(--accent)");
    // L'encart, lui, reste traversable.
    expect(boite().style.cssText).toContain("pointer-events:none");
    // Sous le texte : six lignes de prix, le bloc de texte, puis le bouton, dernier.
    expect(boite().children.map((c) => (c === b ? "bouton" : c === blocTexte() ? "texte" : "prix"))).toEqual(["prix", "prix", "prix", "prix", "prix", "prix", "texte", "bouton"]);
    expect(blocTexte()?.textContent).toBe(TEXTE);
  });

  it("un toucher agit une fois, puis l'offre est relue à l'image suivante : le bouton passe à « déjà posée »", () => {
    const executer = vi.fn();
    let posee = false;
    encart.montrer(BOUGIE, 200, 500, TEXTE, () => (posee ? { etat: "posee", libelle: POSEE, executer } : { etat: "offre", libelle: OFFRE, executer: () => { executer(); posee = true; } }));
    bouton()!.cliquer();
    expect(executer).toHaveBeenCalledTimes(1);
    // Rien n'est redessiné avant l'image suivante (l'avis de pose n'est pas encore à l'écran).
    expect(bouton()?.textContent).toBe(OFFRE);
    imageSuivante();
    expect(bouton()?.textContent).toBe(POSEE);
    expect(bouton()?.getAttribute("data-alerte-zone")).toBe("posee");
    // L'encart et son texte sont toujours là.
    expect(boite().style.display).toBe("grid");
    expect(blocTexte()?.textContent).toBe(TEXTE);
  });

  it.each([["posee", POSEE], ["franchi", FRANCHI]])("état « %s » : même emplacement, grisé, aria-disabled, sans effet — mais il capte encore le toucher", (etat, libelle) => {
    const executer = vi.fn();
    encart.montrer(BOUGIE, 200, 500, TEXTE, offre(etat, libelle, executer));
    const b = bouton()!;
    expect(b.textContent).toBe(libelle);
    expect(b.getAttribute("data-alerte-zone")).toBe(etat);
    expect(b.getAttribute("aria-disabled")).toBe("true");
    expect(b.style.cssText).toContain("color:var(--text-dim)");
    expect(b.style.cssText).toContain("min-height:44px");
    // Traversable, le toucher irait au graphe, qui effacerait son réticule.
    expect(b.style.cssText).toContain("pointer-events:auto");
    expect(boite().children.at(-1)).toBe(b);
    b.cliquer();
    expect(executer).not.toHaveBeenCalled();
    expect(images).toEqual([]);
  });

  it("téléphone sans offre (pas de bande forte sous le doigt, zone faible, rejeu) : pas de bouton", () => {
    encart.montrer(BOUGIE, 200, 500, TEXTE, () => undefined);
    expect(bouton()).toBeUndefined();
    expect(blocTexte()?.textContent).toBe(TEXTE);
    encart.montrer(BOUGIE, 200, 500, TEXTE);
    expect(bouton()).toBeUndefined();
  });

  it("bureau : l'offre n'est jamais lue, ni bouton ni texte dans l'encart", () => {
    monter(false);
    const lire = vi.fn(offre("offre", OFFRE));
    encart.montrer(BOUGIE, 200, 500, TEXTE, lire);
    expect(lire).not.toHaveBeenCalled();
    expect(bouton()).toBeUndefined();
    expect(blocTexte()).toBeUndefined();
    expect(boite().style.display).toBe("block");
  });

  it("offre sans texte visé : le bouton est rendu, l'encart prend toute la largeur sur fond opaque", () => {
    encart.montrer(BOUGIE, 200, 500, undefined, offre("offre", OFFRE));
    expect(bouton()?.textContent).toBe(OFFRE);
    expect(blocTexte()).toBeUndefined();
    expect(boite().style.width).toBe("382px");
    expect(boite().style.background).toBe("var(--surface)");
    // Sans texte ni offre : l'encart des prix seuls, étroit et translucide.
    encart.montrer(BOUGIE, 200, 500);
    expect(boite().style.width).toBe("");
    expect(boite().style.background).not.toBe("var(--surface)");
  });

  // Le bouton est au bas de l'encart : sous un avis, c'est lui qui serait recouvert, et l'avis
  // capterait son toucher. Le pane du faux graphe commence à 0, l'infobulle à 52 px : l'encart ne
  // monte pas plus haut. La pile d'avis est posée à l'ordonnée donnée ; l'encart s'arrête 4 px avant.
  describe("un avis à l'écran", () => {
    const avecPile = (haut: number, hauteur = 90): void => {
      vi.stubGlobal("document", {
        createElement: (tag: string) => new FauxElement(tag),
        querySelector: (selecteur: string) => (selecteur === "[data-pile-avis]" ? { getBoundingClientRect: () => ({ top: haut, height: hauteur }) } : null),
      });
    };
    const hautEncart = (): number => Number.parseFloat(boite().style.top ?? "");

    it("l'encart, bouton compris (210 px), tient au-dessus de la pile : le bouton est rendu, l'encart au-dessus de l'avis", () => {
      avecPile(266);
      encart.montrer(BOUGIE, 200, 500, TEXTE, offre("offre", OFFRE));
      expect(bouton()?.textContent).toBe(OFFRE);
      expect(hautEncart()).toBe(52);
      expect(hautEncart() + 210).toBeLessThanOrEqual(266 - 4);
    });

    it("il ne tient pas (1 px de trop) : le bouton n'est pas rendu, l'encart reste celui du texte, au-dessus de l'avis", () => {
      avecPile(265);
      encart.montrer(BOUGIE, 200, 500, TEXTE, offre("offre", OFFRE));
      expect(bouton()).toBeUndefined();
      expect(blocTexte()?.textContent).toBe(TEXTE);
      // Sans le bouton : 162 px, posés contre la pile.
      expect(hautEncart()).toBe(265 - 4 - 162);
    });

    it("pile vide (hauteur nulle), ou avis fermé puis encart relu : le bouton est rendu", () => {
      avecPile(100, 0);
      encart.montrer(BOUGIE, 200, 500, TEXTE, offre("offre", OFFRE));
      expect(bouton()?.textContent).toBe(OFFRE);
      // Un avis paraît, trop haut : à la relecture le bouton part ; l'avis fermé, il revient.
      avecPile(200);
      encart.relire();
      imageSuivante();
      expect(bouton()).toBeUndefined();
      avecPile(200, 0);
      encart.relire();
      imageSuivante();
      expect(bouton()?.textContent).toBe(OFFRE);
    });
  });

  // Constat majeur de la revue du lot : le bouton débordait de la zone libre avec l'encart, et
  // captait les touchers de ce qu'il recouvrait — un toucher sur « Indicateurs (n) » ou sur
  // l'en-tête d'un pane d'indicateur posait une alerte. Zone libre : de l'ordonnée de l'infobulle
  // (52 px ici) au plus haut de — bas du pane des prix, 80 px sous le bas du conteneur moins le
  // panneau « Indicateurs (n) » déplié, 4 px au-dessus de la pile d'avis.
  describe("zone libre du pane : le bouton n'en sort jamais", () => {
    const hautEncart = (): number => Number.parseFloat(boite().style.top ?? "");
    const offrir = (): void => encart.montrer(BOUGIE, 200, 500, TEXTE, offre("offre", OFFRE));

    it("paysage 844 × 390 (pane de 219 px, sans avis) : pas de bouton ; l'encart reste celui du texte, là où il tenait", () => {
      monter(true, 219, 247);
      // Mesures du vrai graphe : 85 px sans bouton, 133 px avec ; la zone libre fait 167 − 52 = 115 px.
      boite().hauteurSansBouton = 85;
      encart.montrer(BOUGIE, 200, 100, TEXTE, offre("offre", OFFRE));
      expect(bouton()).toBeUndefined();
      expect(blocTexte()?.textContent).toBe(TEXTE);
      expect(boite().style.display).toBe("grid");
      // Entier dans la zone libre : il ne dépasse plus sur le bouton « Indicateurs (n) ».
      expect(hautEncart()).toBeGreaterThanOrEqual(52);
      expect(hautEncart() + 85).toBeLessThanOrEqual(247 - 80);
    });

    it("à un pixel près : rendu quand l'encart, bouton compris (210 px), tient exactement ; retiré s'il manque 1 px", () => {
      // Bas de la zone libre = hauteur du conteneur − 80 ; elle commence à 52 px.
      monter(true, 584, 52 + 210 + 80);
      offrir();
      expect(bouton()?.textContent).toBe(OFFRE);
      expect(hautEncart()).toBe(52);
      monter(true, 584, 52 + 210 + 80 - 1);
      offrir();
      expect(bouton()).toBeUndefined();
      expect(blocTexte()?.textContent).toBe(TEXTE);
      // Sans le bouton, 162 px : posé contre le bas de la zone libre.
      expect(hautEncart()).toBe(52 + 209 - 162);
    });

    it("pane d'indicateur sous le pane des prix (320 × 568 avec RSI, pane de 207 px) : pas de bouton sur l'en-tête du pane voisin", () => {
      monter(true, 207, 338);
      offrir();
      expect(bouton()).toBeUndefined();
      expect(blocTexte()?.textContent).toBe(TEXTE);
      // Limite antérieure, inchangée : l'encart du texte (162 px pour 155 libres) part du haut et
      // dépasse vers le bas ; il est traversable.
      expect(hautEncart()).toBe(52);
      expect(boite().style.cssText).toContain("pointer-events:none");
    });

    it("panneau « Indicateurs (n) » déplié : la zone libre s'arrête à son haut, le bouton n'est pas rendu dessous", () => {
      // Replié : 532 px de bas, le bouton tient. Déplié sur 280 px : 532 − 280 − 52 = 200 px libres.
      offrir();
      expect(bouton()?.textContent).toBe(OFFRE);
      conteneur.hauteurPanneau = 280;
      offrir();
      expect(bouton()).toBeUndefined();
      // 10 px de plus : 210 px libres, il tient de nouveau.
      conteneur.hauteurPanneau = 270;
      offrir();
      expect(bouton()?.textContent).toBe(OFFRE);
    });

    it("la place revenue (rotation, panneau replié), l'encart relu rend le bouton", () => {
      conteneur.hauteurPanneau = 280;
      offrir();
      expect(bouton()).toBeUndefined();
      conteneur.hauteurPanneau = 0;
      encart.relire();
      imageSuivante();
      expect(bouton()?.textContent).toBe(OFFRE);
    });

    it("bureau : aucune borne nouvelle, l'encart des prix se place comme avant", () => {
      monter(false, 219, 247);
      boite().hauteurSansBouton = 60;
      encart.montrer(BOUGIE, 200, 100, TEXTE, offre("offre", OFFRE));
      expect(bouton()).toBeUndefined();
      expect(boite().style.display).toBe("block");
      // Sous le curseur (y + 14), jusqu'à 174 px : la zone libre du téléphone (52 à 167 px) l'aurait
      // fait basculer au-dessus ; au bureau seul le bas du pane (219 px) le fait.
      expect(hautEncart()).toBe(114);
      encart.montrer(BOUGIE, 200, 180, TEXTE, offre("offre", OFFRE));
      expect(hautEncart()).toBe(180 - 14 - 60);
    });
  });

  // Constat de la revue du lot : le bouton restait après la zone. Quand le texte de l'encart vient
  // d'un autre indicateur (signal d'AXIS dans une bande forte), fermer AXIS S/R ne change pas ce
  // texte ; l'encart n'était pas réaffiché, et le toucher du bouton posait une alerte au bord
  // d'une zone que le graphe ne traçait plus. `ChartInstance` demande `offreChangee` après chaque
  // recalcul ; le bouton la demande au toucher.
  describe("offreChangee — l'offre relue n'est plus celle du bouton", () => {
    /** Offre que le test fait varier : `undefined` quand la zone n'est plus tracée. */
    let courante: OffreEncart | undefined;
    const lire = vi.fn(() => courante);
    const AUTRE_BORD = "Alerte de prix ↓ 76,529.83 · bord du support fort · niveau fixe, 7 jours";

    beforeEach(() => {
      lire.mockClear();
      courante = { etat: "offre", libelle: OFFRE, executer: vi.fn() };
      encart.montrer(BOUGIE, 200, 500, TEXTE, lire);
    });

    it("offre inchangée : faux, et l'encart n'est pas réaffiché (le bouton sous le doigt n'est pas remplacé)", () => {
      const avant = bouton();
      expect(encart.offreChangee()).toBe(false);
      expect(encart.offreChangee()).toBe(false);
      expect(lire).toHaveBeenCalledTimes(3);
      expect(bouton()).toBe(avant);
      expect(images).toEqual([]);
    });

    it("zone qui n'est plus tracée (AXIS S/R fermé, rejeu), bord déplacé, bord franchi, alerte posée ailleurs : vrai", () => {
      courante = undefined;
      expect(encart.offreChangee()).toBe(true);
      courante = { etat: "offre", libelle: AUTRE_BORD, executer: () => {} };
      expect(encart.offreChangee()).toBe(true);
      courante = { etat: "franchi", libelle: FRANCHI, executer: () => {} };
      expect(encart.offreChangee()).toBe(true);
      courante = { etat: "posee", libelle: POSEE, executer: () => {} };
      expect(encart.offreChangee()).toBe(true);
      // Réaffiché avec l'offre relue, il est de nouveau à jour.
      encart.montrer(BOUGIE, 200, 500, TEXTE, lire);
      expect(bouton()?.textContent).toBe(POSEE);
      expect(encart.offreChangee()).toBe(false);
    });

    it("une offre paraît là où il n'y en avait pas (AXIS S/R ajouté sous le réticule) : vrai", () => {
      courante = undefined;
      encart.montrer(BOUGIE, 200, 500, TEXTE, lire);
      expect(bouton()).toBeUndefined();
      expect(encart.offreChangee()).toBe(false);
      courante = { etat: "offre", libelle: OFFRE, executer: () => {} };
      expect(encart.offreChangee()).toBe(true);
    });

    it("bouton retiré faute de place : l'offre lue reste la référence, pas de réaffichage en boucle", () => {
      conteneur.hauteurPanneau = 280;
      encart.montrer(BOUGIE, 200, 500, TEXTE, lire);
      expect(bouton()).toBeUndefined();
      expect(encart.offreChangee()).toBe(false);
      courante = undefined;
      expect(encart.offreChangee()).toBe(true);
    });

    it("encart masqué, encart sans offre, bureau : faux — au bureau l'offre n'est jamais lue", () => {
      encart.cacher();
      lire.mockClear();
      courante = undefined;
      expect(encart.offreChangee()).toBe(false);
      expect(lire).not.toHaveBeenCalled();
      encart.montrer(BOUGIE, 200, 500, TEXTE);
      expect(encart.offreChangee()).toBe(false);
      monter(false);
      courante = { etat: "offre", libelle: OFFRE, executer: () => {} };
      encart.montrer(BOUGIE, 200, 500, TEXTE, lire);
      expect(encart.offreChangee()).toBe(false);
      expect(lire).not.toHaveBeenCalled();
    });

    it.each([
      ["la zone n'est plus tracée", undefined, undefined],
      ["le bord a bougé", { etat: "offre", libelle: AUTRE_BORD, executer: () => {} }, AUTRE_BORD],
      ["le cours a franchi le bord", { etat: "franchi", libelle: FRANCHI, executer: () => {} }, FRANCHI],
    ] as const)("au toucher, l'offre est relue — %s : rien n'est exécuté, et le bouton est relu à l'image suivante", (_cas, relue, attendu) => {
      const executer = courante!.executer;
      courante = relue;
      bouton()!.cliquer();
      expect(executer).not.toHaveBeenCalled();
      imageSuivante();
      expect(bouton()?.textContent).toBe(attendu);
      // L'encart et son texte restent.
      expect(boite().style.display).toBe("grid");
      expect(blocTexte()?.textContent).toBe(TEXTE);
    });

    it("au toucher, offre inchangée : exécutée une fois", () => {
      bouton()!.cliquer();
      expect(courante!.executer).toHaveBeenCalledTimes(1);
    });
  });

  it("relire : l'offre est relue à l'image suivante, pas avant ; sans effet si l'encart est masqué d'ici là", () => {
    let etat = "offre";
    const lire = vi.fn(() => ({ etat, libelle: etat === "offre" ? OFFRE : POSEE, executer: () => {} }));
    encart.montrer(BOUGIE, 200, 500, TEXTE, lire);
    expect(lire).toHaveBeenCalledTimes(1);
    // Une alerte est posée ailleurs (menu, autre vue) : `ChartInstance` demande la relecture.
    etat = "posee";
    encart.relire();
    expect(lire).toHaveBeenCalledTimes(1);
    expect(bouton()?.textContent).toBe(OFFRE);
    imageSuivante();
    expect(lire).toHaveBeenCalledTimes(2);
    expect(bouton()?.textContent).toBe(POSEE);
    // Masqué entre la demande et l'image : rien n'est réaffiché, l'offre n'est pas relue.
    encart.relire();
    encart.cacher();
    imageSuivante();
    expect(lire).toHaveBeenCalledTimes(2);
    expect(boite().style.display).toBe("none");
    // Masqué : une relecture demandée ne réaffiche rien non plus.
    encart.relire();
    imageSuivante();
    expect(lire).toHaveBeenCalledTimes(2);
    expect(boite().style.display).toBe("none");
  });
});
