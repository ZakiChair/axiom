# AXIS S/R — zones classées par force et signal précoce : plan de construction

> **Pour les agents exécutants :** SOUS-COMPÉTENCE REQUISE : `superpowers:subagent-driven-development`
> (retenue ici : `.devin/provider-rules.md` impose un développeur par lot et une revue
> indépendante) ou `superpowers:executing-plans`. Les étapes sont des cases à cocher (`- [ ]`).

**But :** dans AXIS S/R, tracer les zones classées par force et marquer d'un triangle creux la
bougie qui réagit sur une zone forte, sans toucher aux signaux confirmés.

**Architecture :** le moteur `zonesSrAxis` suit ses zones en une passe et rend, en plus de
l'existant, les évènements de réaction et les « pistes » des zones à tracer. La définition
`stratAxisSr` en tire deux sorties masquées et les annotations. Le rendu web apprend le triangle
creux et l'étiquette ancrée à droite. L'amorce d'AXIS S/R passe à 3 000 bougies et la série de
référence du garde-fou suit.

**Pile :** TypeScript strict, Vitest, KLineChart 9.8 (canvas), pnpm.

**Conception :** [`docs/superpowers/specs/2026-11-09-axis-sr-zones-fortes-design.md`](../specs/2026-11-09-axis-sr-zones-fortes-design.md).
Chaque exécutant lit la conception et `BUILD-CONTRACT.md` avant son lot.

## Contraintes globales

- Aucune dépendance nouvelle ; TypeScript strict (`noUncheckedIndexedAccess`) ; commentaires,
  noms de tests et textes en français.
- `packages/indicators/src/strategy/stratAxis.ts` et `stratAxis.test.ts` ne sont **pas modifiés**.
- Pour une même série et les mêmes réglages existants : `etat`, `score`, `prixSignal`, `stop`,
  `support`, `resistance`, marqueurs et étiquettes des signaux confirmés et des forts mouvements
  identiques à ceux d'avant.
- Causalité : rien de ce qui est décidé à la bougie `i` ne lit une bougie `> i`. Les réactions
  se décident avec les zones connues après `i − 1`.
- Une seule passe : aucune relance de `zonesSrAxis` par bougie hors des tests.
- Couleurs par jetons (`--up`, `--down`), jamais d'hexadécimal hors des replis nommés existants.
- Aucun chiffre de performance dans l'interface. Mention exacte des signaux précoces :
  `signal précoce non mesuré — lecture indicative, jamais une promesse`.
- Budget d'entrée bloquant : 1 220 000 octets bruts, 360 000 gzip. Départ : 1 188 293 / 354 533.
  Sous 3 000 de marge gzip, libérer des octets avant de livrer. Les lots 1, 3 et 4 lancent
  `pnpm --filter @axiom/web build` (le budget y est vérifié) et relèvent la taille d'entrée au rapport.
- Commandes : chemins littéraux, jamais de variable shell dans une commande qui lance `bun`, le
  gestionnaire de versions ou un script ; une commande composée qui le nomme est refusée par
  l'isolement du worktree : la découper en commandes simples.
- Coût d'un calcul complet à 3 000 bougies : sous 10 ms sur le poste du propriétaire
  (2,9 ms aujourd'hui).
- Un lot ne touche que ses fichiers. Un fichier hors lot qui doit changer se signale au rapport.
- Branche `feat/axis-sr-zones-fortes`, worktree `.worktrees/axis-sr-zones-fortes`. Ne rien
  reprendre de `feat/axis-toutes-unites`. Ni fusion, ni poussée, ni déploiement sans accord
  explicite du propriétaire.
- Messages de commit en français, à l'impératif, terminés par la ligne
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Exceptions autorisées par la conception (§5) au contrat de build : `@axiom/types` reçoit
  exactement deux champs **optionnels**, `creux?: boolean` sur `MarqueurAnnotation` et
  `ancrageX?: "centre" | "droite"` sur `LabelAnnotation`, rien d'autre ; `stratAxisSr.amorceBougies`
  = 3000 (`stratAxis` reste à 1500) ; `REFCLOSE_LIMIT` = 3000.
- L'app web lit les **sources** de `@axiom/indicators` (`exports: ./src/index.ts`) : tout lot qui
  change une définition d'indicateur lance aussi `pnpm --filter @axiom/web test`.

## Points de revue

Entrées que la conception implique sans les nommer, et qui casseraient l'outil chez
l'utilisateur. Chacune a son test dans le lot propriétaire.

1. **Série sans volume** (forex, séries synthétiques) : aucun `NaN`, `rejetsVolume` nul partout,
   réactions toujours calculées. → Lot 2, test « sans volume ».
2. **Historique vide ou très court** (0, 1, 8 bougies : jeton tout juste coté) : aucune
   exception, séries de la bonne longueur, aucune annotation de zone. → Lots 2 et 3.
3. **Bougies plates** (`high = low`, fréquentes en 1 s et 1 min) : jamais de réaction, jamais de
   division par zéro. → Lot 2, test « bougies plates ».
4. **Dernière bougie en formation** : une mèche qui entre dans une zone forte ne produit ni
   triangle ni alerte avant la clôture ; sorties indéfinies sur cette bougie. → Lot 3.
5. **Prix très petits** (0,000 075) : mêmes réactions qu'à l'échelle 1, bornes lisibles dans
   les infobulles (`0.00007563`). → Lots 2 et 3.

## Fichiers

| Fichier | Rôle | Lot |
| --- | --- | --- |
| `packages/types/src/index.ts` | champs optionnels `creux` et `ancrageX` | 1 |
| `apps/web/src/chart/annotationsPane.ts` (+ test) | triangle creux, étiquettes ancrées à droite | 1 |
| `apps/web/src/chart/annotationsPrix.ts` (+ test) | mêmes champs pour les panes séparés | 1 |
| `packages/indicators/src/strategy/fixtures/btcusdt4h.ts` | lecture de la fixture BTC en `Candle[]` | 2 |
| `packages/indicators/src/strategy/stratAxisSr.ts` | moteur (lot 2), puis définition (lot 3) | 2, 3 |
| `packages/indicators/src/strategy/stratAxisSr.reactions.test.ts` | oracle, cas de référence, causalité | 2 |
| `packages/indicators/src/strategy/stratAxisSr.test.ts` | mise à jour du contrat et de la fixture dorée | 3 |
| `packages/indicators/src/strategy/stratAxisSr.trace.test.ts` | annotations et sorties | 3 |
| `packages/alerts/src/engine.axisSr.test.ts` | preuve d'alerte | 3 |
| `apps/web/src/chart/auxProvider.ts` (+ test), `extensionSession.test.ts` | profondeur 3 000 | 4 |
| `BUILD-CONTRACT.md`, `docs/axis-2026-10-07.md`, `README.md` | documents | 5 |

Ordre : lots 1, 2, 3, 4, 5, 6, l'un après l'autre : un seul implémenteur à la fois dans le worktree.

---

### Task 1 — Lot 1 : Rendu : triangle creux et étiquette ancrée à droite (développeur web)

**Fichiers**
- Modifier : `packages/types/src/index.ts` (`MarqueurAnnotation`, `LabelAnnotation`)
- Modifier : `apps/web/src/chart/annotationsPane.ts`, `apps/web/src/chart/annotationsPrix.ts`
- Tests : `apps/web/src/chart/annotationsPane.test.ts`, `apps/web/src/chart/annotationsPrix.test.ts`

**Interfaces produites**

```ts
// packages/types/src/index.ts
export interface MarqueurAnnotation {
  // … champs existants inchangés
  /** true = triangle au trait, non rempli, plus petit (signal précoce). Absent = rendu actuel. */
  creux?: boolean;
}
export interface LabelAnnotation {
  // … champs existants inchangés
  /** "droite" = texte à droite de la bougie, aligné à gauche, centré verticalement sur `valeur`
   *  (`position` ignorée). Absent ou "centre" = rendu actuel. */
  ancrageX?: "centre" | "droite";
}
```

- [ ] **Étape 1 — tests en échec, `annotationsPane.test.ts`** (contexte factice et axes
  existants : x = idx × 10, y = valeur × 2)

```ts
it("marqueur creux : contour seul, demi-base 4, jamais rempli", () => {
  const ctx = fauxCtx();
  dessinerAnnotationsPane(ctx, { marqueurs: [
    { idx: 3, valeur: 50, forme: "triangleHaut", couleur: "--up", cible: "prix", creux: true },
    { idx: 5, valeur: 50, forme: "triangleBas", couleur: "--down", cible: "prix", creux: true },
  ] }, "prix", AXES, FENETRE);
  expect(ctx.ops).toEqual([
    "beginPath", "moveTo(30,96)", "lineTo(26,104)", "lineTo(34,104)", "closePath", "stroke",
    "beginPath", "moveTo(50,104)", "lineTo(46,96)", "lineTo(54,96)", "closePath", "stroke",
  ]);
});

it("étiquettes ancrées à droite : à x + 8, centrées sur la valeur, écartées d'au moins 11 px", () => {
  const ctx = fauxCtx();
  dessinerAnnotationsPane(ctx, { labels: [
    { idx: 9, valeur: 52, texte: "R forte · 8", couleur: "--down", cible: "prix", ancrageX: "droite" },
    { idx: 9, valeur: 50, texte: "R forte · 12", couleur: "--down", cible: "prix", ancrageX: "droite" },
    { idx: 9, valeur: 80, texte: "S fort · 5", couleur: "--up", cible: "prix", ancrageX: "droite" },
  ] }, "prix", AXES, FENETRE);
  expect(ctx.ops).toEqual(["fillText(R forte · 12,98,100)", "fillText(R forte · 8,98,111)", "fillText(S fort · 5,98,160)"]);
  expect(ctx.textAlign).toBe("left");
  expect(ctx.textBaseline).toBe("middle");
});

it("ruban long : seuls les points de la fenêtre visible (± 1 bougie) sont parcourus", () => {
  const ctx = fauxCtx();
  const n = 3000;
  dessinerAnnotationsPane(ctx, { rubans: [
    { deIdx: 0, hauts: new Array<number>(n).fill(60), bas: new Array<number>(n).fill(50), couleur: "--up", alpha: 0.2 },
  ] }, "prix", AXES, { de: 1000, a: 1010 });
  // 12 indices (999 à 1010) à l'aller et au retour : 1 moveTo + 23 lineTo, jamais 6 000.
  expect(ctx.ops.filter((o) => o.startsWith("moveTo")).length).toBe(1);
  expect(ctx.ops.filter((o) => o.startsWith("lineTo")).length).toBe(23);
  expect(ctx.ops[1]).toBe("moveTo(9990,120)");
});
```

  AXIS S/R passera de 4 à 24 rubans, longs de milliers de bougies : sans ce découpage, chaque
  image du graphe parcourrait plus de 100 000 points hors écran.

- [ ] **Étape 2 — tests en échec, `annotationsPrix.test.ts`**, sur le modèle du test « figure
  label : fond TRANSPARENT » : `extendData` `{ genre: "marqueur", forme: "triangleHaut", couleur: "--up", creux: true }`
  aux coordonnées (30, 100) rend un seul polygone de sommets (30, 96), (26, 104), (34, 104), de
  style `{ style: "stroke", borderColor: <couleur résolue>, borderSize: 1.5 }` ;
  `{ genre: "label", texte: "R forte · 12", couleur: "--down", dessous: false, droite: true }`
  rend un texte en `x: 38, y: 100, align: "left", baseline: "middle"`, fond transparent.
- [ ] **Étape 3 — lancer** : `pnpm --filter @axiom/web exec vitest run src/chart/annotationsPane.test.ts src/chart/annotationsPrix.test.ts` → les nouveaux tests échouent.
- [ ] **Étape 4 — types** : ajouter les deux champs optionnels ci-dessus.
- [ ] **Étape 5 — `annotationsPane.ts`** : constantes `DEMI_TRIANGLE_CREUX = 4`,
  `DECALAGE_LABEL_DROITE = 8`, `ECART_LABELS_DROITE = 11`. Marqueur creux : même tracé de
  triangle à demi-base 4, `lineWidth` 1,5, `stroke()` sans `fill()`, sans `save`/`restore`.
  Étiquettes « droite » : dessinées après les étiquettes centrées ; triées par y croissant ;
  un y plus proche que 11 px du précédent est porté à `y précédent + 11` ; police
  `10px sans-serif`. Rubans : ne parcourir que les indices de `max(deIdx, fenetre.de − 1)` à
  `min(dernier indice, fenetre.a)` ; le test existant « ruban : polygone fermé » reste vert.
- [ ] **Étape 6 — `annotationsPrix.ts`** : `ExtendAnnotation` porte `creux?: boolean` (marqueur)
  et `droite?: boolean` (label) ; `appliquer` les renseigne depuis `m.creux` et
  `l.ancrageX === "droite"` ; `createPointFigures` rend les figures de l'étape 2.
- [ ] **Étape 7 — vérifier** : les deux fichiers de test passent en entier (anciens tests
  compris) ; `pnpm --filter @axiom/types typecheck && pnpm --filter @axiom/web typecheck` → 0 erreur.
- [ ] **Étape 8 — commit** : `Rendre le triangle creux et l'étiquette ancrée à droite des annotations`.

---

### Task 2 — Lot 2 : Moteur : pistes de zones et réactions en une passe (développeur paquets)

**Fichiers**
- Créer : `packages/indicators/src/strategy/fixtures/btcusdt4h.ts`
- Modifier : `packages/indicators/src/strategy/stratAxisSr.ts` (constantes, types, `zonesSrAxis` ; la définition `stratAxisSr` n'est pas touchée dans ce lot)
- Créer : `packages/indicators/src/strategy/stratAxisSr.reactions.test.ts`

**Interfaces produites**

```ts
// fixtures/btcusdt4h.ts — 3 000 bougies closes, sellVolume = volume − buyVolume, closed: true
export function bougiesBtcusdt4h(): Candle[];

// stratAxisSr.ts
export const FORCE_ZONE_FORTE_DEFAUT = 6;
/** Bougies minimales entre deux réactions d'une même zone. */
export const REARMEMENT_REACTION_AXIS = 4;
/** Zones fortes désactivées gardées pour le tracé (les plus récentes). */
export const MAX_ZONES_CASSEES_AXIS = 12;

export interface ZoneSrAxis {
  // … champs existants inchangés, plus :
  /** Rang de création (0, 1, 2…), unique : la même zone porte le même id quel que soit `fin`. */
  id: number;
}
export interface ReactionZoneSrAxis {
  idx: number;          // bougie de décision, ≤ fin
  sens: 1 | -1;         // +1 réaction sur support, −1 sur résistance
  /** État de la zone après la bougie idx − 1 ; `nature` = rôle par position face à close[idx − 1]. */
  zone: ZoneSrAxis;
}
export interface PisteZoneSrAxis {
  /** Dernier état : à `fin` si active ; au moment de la désactivation sinon (après une éventuelle
   *  fusion de la même bougie). `nature` = rôle par position face à close[`finIdx`]. */
  zone: ZoneSrAxis;
  active: boolean;
  /** Dernière bougie où la zone était active (`fin` si elle l'est encore). */
  finIdx: number;
  /** Bornes connues à la clôture : 1re entrée à `confirmationIdx`, puis une entrée par bougie où elles changent. */
  evolution: Array<{ idx: number; bas: number; haut: number }>;
}
export interface ResultatSrAxis {
  // … cinq champs existants inchangés (zones, support, resistance, supportHaut, resistanceBas)
  /** Évènements du §4.5, par idx croissant. */
  reactions: ReactionZoneSrAxis[];
  /** Zones actives à `fin` (confirmationIdx croissant), puis au plus MAX_ZONES_CASSEES_AXIS zones
   *  fortes au moment de leur désactivation (finIdx décroissant). */
  pistes: PisteZoneSrAxis[];
}
export function zonesSrAxis(
  candles: Candle[], flux: FluxBougie[], atr: Array<number | undefined>,
  pivotSr?: number, zoneSrAtr?: number, seuilRvol?: number, maxZonesSr?: number, fin?: number,
  forceZoneForte: number = FORCE_ZONE_FORTE_DEFAUT,   // 9e paramètre, nouveau
): ResultatSrAxis;
```

- [ ] **Étape 1 — `fixtures/btcusdt4h.ts`** : lit `./btcusdt-4h-3000.json` (colonnes `time`,
  `open`, `high`, `low`, `close`, `volume`, `buyVolume`) et rend les `Candle`. Le fichier JSON
  n'est pas modifié.

- [ ] **Étape 2 — tests en échec, `stratAxisSr.reactions.test.ts`.** L'oracle et le générateur
  ci-dessous sont la référence de la conception (§4.5, §6.1) : les recopier tels quels. Le
  réarmement se compte par zone, donc par `id` : une clé dérivée du niveau ne convient pas, le
  niveau d'une zone se déplace à chaque fusion.

```ts
/** Référence lente : zones connues après i − 1 (moteur relancé à chaque bougie), règle appliquée telle quelle. */
function reactionsNaives(candles: Candle[], g: number, forceMin: number, fin: number): string[] {
  const flux = fluxAxis(candles, undefined, 20, 6);
  const atr = rma(trueRange(candles), 14);
  const dernier = new Map<number, number>();
  const out: string[] = [];
  for (let i = 1; i <= fin; i++) {
    const c = candles[i]!;
    const amplitude = c.high - c.low;
    if (!(amplitude > 0)) continue;
    const position = (c.close - c.low) / amplitude;
    for (const z of zonesSrAxis(candles, flux, atr, g, 0.5, 1.5, 48, i - 1).zones) {
      if (z.force < forceMin) continue;
      const support = z.niveau <= candles[i - 1]!.close;
      const reagit = support
        ? c.low <= z.haut && c.close > z.haut && position >= 0.5
        : c.high >= z.bas && c.close < z.bas && position <= 0.5;
      if (!reagit) continue;
      if (i - (dernier.get(z.id) ?? -99) < 4) continue;
      dernier.set(z.id, i);
      out.push(`${i}:${support ? 1 : -1}:${z.id}`);
    }
  }
  return out.sort();
}

/** Moteur en une passe, mêmes entrées, même format trié. */
const reactionsMoteur = (candles: Candle[], g: number, forceMin: number, fin: number) => {
  const r = zonesSrAxis(candles, fluxAxis(candles, undefined, 20, 6), rma(trueRange(candles), 14), g, 0.5, 1.5, 4, fin, forceMin);
  return { r, texte: r.reactions.map((e) => `${e.idx}:${e.sens}:${e.zone.id}`).sort() };
};
const court = (r: ReactionZoneSrAxis[]) => r.map((e) => `${e.idx}${e.sens > 0 ? "S" : "R"}`).join(" ");

/** Marché en range à graine fixe : rappel vers 100, pointes de volume. */
function serieSynthetique(n: number, graine: number): Candle[] {
  let s = graine;
  const alea = (): number => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  const out: Candle[] = [];
  let prix = 100;
  for (let i = 0; i < n; i++) {
    const open = prix;
    const close = Math.max(1, open + (100 - open) * 0.05 + (alea() - 0.5) * 4);
    const high = Math.max(open, close) + alea() * 2;
    const low = Math.min(open, close) - alea() * 2;
    const volume = 10 + (alea() < 0.15 ? 40 : 0) + alea() * 5;
    out.push({ time: i * 3_600_000, open, high, low, close, volume, closed: true });
    prix = close;
  }
  return out;
}
```

  Tests et valeurs attendues (toutes mesurées le 9 novembre sur le code de la branche) :

  | Test | Entrées | Attendu |
  | --- | --- | --- |
  | synthétique | `serieSynthetique(600, 7)`, g = 3, seuil 3, fin 599 | `syn[0].close` ≈ 98.95512335933745 ; texte = oracle ; 112 évènements (58 S, 54 R) ; début `32S 39S 46R 48S 56S 60R 62S 64R` ; fin `555R 576S 585R 599S` ; 21 évènements sur zone inversée ; pistes : 3 actives, 5 désactivées de `finIdx` `[555, 496, 407, 236, 184]` |
  | fixture dorée | `golden/fixture-ohlcv.json`, g = 5, fin 298 | seuil 6 : aucun évènement ; seuil 2 : texte = oracle et `73S 86S 92S 98S 102S 125R 130R 139R 147S 153S 161R 173S 188S 192R` |
  | BTC, tranche | `bougiesBtcusdt4h().slice(-1200)`, g = 5, seuil 6, fin 1199 | texte = oracle ; 50 évènements (32 S, 18 R) — délai du test 30 s |
  | BTC, référence | `bougiesBtcusdt4h()`, g = 5, seuil 6, fin 2999 | 122 évènements (62 S, 60 R) ; trois premiers idx 250, 262, 280 ; supports ≥ 2700 : `2733 2750 2766 2798 2803 2809 2853 2860 2896 2901 2904 2916 2928 2946 2957 2961 2974 2980 2985 2988` ; résistances ≥ 2700 : `2754 2761 2767 2811 2821 2824 2835 2838 2850 2859 2954` |
  | BTC, zones citées | même appel | évènement 2733 : zone `{ nature: "support", touches: 4, rejetsVolume: 2, inversions: 0, force: 6, deIdx: 2581, confirmationIdx: 2586 }`, bas ≈ 75592.65, haut ≈ 76529.83 ; évènement 2761 : `{ nature: "resistance", touches: 9, rejetsVolume: 6, inversions: 1, force: 15.5, deIdx: 951 }` |
  | BTC, pistes | même appel | 20 actives dont 8 de force ≥ 6 ; 12 désactivées (les plus récentes des 27 zones fortes désactivées), `finIdx` = `[2986, 2954, 2858, 2692, 2591, 2568, 2558, 2275, 2168, 2084, 1997, 1922]` ; active la plus proche du close 77582.02 parmi les fortes : support [75626.55 – 76601.83], 5 touches, 2 rejets, `confirmationIdx` 2586 ; résistance [85314.76 – 86430.38], 12 touches, 7 rejets, inversée, `confirmationIdx` 956 ; résistance [86702.87 – 87649.68], 8 touches, 4 rejets, inversée |
  | pistes, forme | BTC tranche | pour chaque piste : `evolution[0].idx === zone.confirmationIdx`, idx strictement croissants, dernière entrée = `zone.bas`/`zone.haut` ; active ⇒ `finIdx === fin` |
  | causalité, préfixe | BTC tranche, k ∈ {300, 700, 1100} | réactions du préfixe `slice(0, k + 1)` (fin = k) = réactions de la série entière d'idx ≤ k |
  | causalité, futur altéré | BTC tranche, mêmes k, bougies > k remplacées par `{ ...c, high: 1e12 + i, low: 1, close: 1e12 - i, volume: 1e12 }` | réactions d'idx ≤ k inchangées |
  | causalité, bandes | BTC tranche | pour chaque piste active et chaque entrée `e` de son `evolution` : la zone de même `id` dans `zonesSrAxis(…, 48, e.idx).zones` existe et a `bas`/`haut` égaux à ceux de `e` (53 entrées vérifiées) |
| identifiants | BTC tranche, k ∈ {300, 700, 1100} | ids uniques dans `zonesSrAxis(…, 48, k).zones` ; une zone de même id à `fin` = k et à `fin` = 1199 a mêmes `deIdx` et `confirmationIdx` ; id croissant avec `confirmationIdx` |
  | existant inchangé | fixture dorée, seuils 2 et 50 | `zones`, `support`, `resistance`, `supportHaut`, `resistanceBas` identiques pour les deux seuils |
  | sans volume | BTC tranche, `volume: 0`, sans `buyVolume`/`sellVolume` | texte = oracle ; 21 évènements ; `rejetsVolume === 0` sur toutes les pistes ; aucun `NaN` dans les bornes |
  | série courte | `[]`, 1 bougie, 8 bougies | `reactions` et `pistes` vides, `support.length === n`, aucune exception |
  | bougies plates | synthétique où `i % 50 === 25` ⇒ `open = high = low = close` | texte = oracle ; 112 évènements ; aucun sur une bougie plate |
  | échelle | BTC tranche, prix × 1e-9 | même liste `idx:sens` qu'à l'échelle 1 |

- [ ] **Étape 3 — lancer** : `pnpm --filter @axiom/indicators exec vitest run src/strategy/stratAxisSr.reactions.test.ts` → échec (`reactions` indéfini).

- [ ] **Étape 4 — étendre `zonesSrAxis`** dans la boucle existante, sans seconde passe :
  - au début de l'itération `i` (`1 ≤ i ≤ fin`), **avant** l'enregistrement du pivot `p = i − g`
    et **avant** les cassures de la bougie `i`, appliquer la règle du §4.5 aux zones actives ;
    rôle = `z.niveau <= candles[i − 1].close` ; réarmement par zone (`REARMEMENT_REACTION_AXIS`) ;
    l'évènement garde une copie de la zone, `nature` mise au rôle ;
  - chaque zone reçoit son `id` à la création (compteur partant de 0) ;
  - chaque zone tient son `evolution` : une entrée à sa création (bougie de confirmation), une
    à chaque fusion qui change ses bornes (au plus une par bougie, la dernière remplace) ;
  - à la désactivation (cassure ou plafond du vivier) pendant la bougie `i` : `finIdx = i − 1`,
    et la zone rejoint les « cassées » si sa force, à cet instant, atteint `forceZoneForte` ;
  - les chemins de sortie anticipée (`maxZonesSr ≤ 0`, série trop courte) rendent aussi
    `reactions` et `pistes`.

- [ ] **Étape 5 — vérifier** : le fichier de l'étape 2 passe ; `stratAxisSr.test.ts` et
  `stratAxis.test.ts` passent **sans modification** (le champ `id` ajouté aux zones ne doit casser
  aucune assertion existante) ; `pnpm --filter @axiom/indicators test` et `typecheck` → vert ;
  `pnpm --filter @axiom/web test` → vert.
- [ ] **Étape 6 — commit** : `Suivre les zones d'AXIS S/R en une passe : pistes et réactions sur zone forte`.

---

### Task 3 — Lot 3 : Définition : réglages, sorties, amorce, tracé, alerte (développeur paquets)

**Fichiers**
- Modifier : `packages/indicators/src/strategy/stratAxisSr.ts` (en-tête, définition `stratAxisSr`, aides de tracé)
- Modifier : `packages/indicators/src/strategy/stratAxisSr.test.ts`
- Créer : `packages/indicators/src/strategy/stratAxisSr.trace.test.ts`
- Créer : `packages/alerts/src/engine.axisSr.test.ts`

**Interfaces**
- Consomme : `creux`, `ancrageX` (lot 1) ; `zonesSrAxis(…, forceZoneForte)`, `ReactionZoneSrAxis`,
  `PisteZoneSrAxis`, `FORCE_ZONE_FORTE_DEFAUT`, `bougiesBtcusdt4h()` (lot 2).
- Produit :

```ts
export const AMORCE_AXIS_SR = 3000;            // stratAxisSr.amorceBougies ; stratAxis reste à AMORCE_AXIS
export const ALPHA_ZONE_CASSEE = 0.09;
export function alphaZoneForte(force: number): number;   // min(0.34, 0.14 + 0.012 × min(16, force))
/** §4.3 : fortes actives (toutes), faibles actives (les maxZonesSr plus proches, partage moitié/moitié
 *  actuel), cassées ; chaque liste par proximité au prix, sauf cassées (ordre reçu). maxZonesSr ≤ 0 : tout vide. */
export function zonesTraceesAxis(
  pistes: PisteZoneSrAxis[], prixRef: number, maxZonesSr: number, forceZoneForte: number,
): { fortes: PisteZoneSrAxis[]; faibles: PisteZoneSrAxis[]; cassees: PisteZoneSrAxis[] };
```

  Réglages, à la suite des 21 existants (23 au total) ; sorties, à la suite des 6 (8 au total) :

```ts
{ key: "maxZonesSr", name: "Zones faibles tracées (0 = aucune zone)", type: "number", default: MAX_ZONES_SR_DEFAUT, min: 0, max: 12 }, // libellé seul changé
{ key: "forceZoneForte", name: "Force d'une zone forte (touches + rejets sur volume fort)", type: "number", default: FORCE_ZONE_FORTE_DEFAUT, min: 2, max: 50 },
{ key: "signauxPrecoces", name: "Signaux précoces sur zone forte (non mesurés)", type: "boolean", default: true },

{ key: "reactionSupport", name: "Réaction sur support fort", style: "line", masquee: true },
{ key: "reactionResistance", name: "Réaction sur résistance forte", style: "line", masquee: true },
```

**Règles de tracé** (conception §3, §4.3, §4.4, §4.7)

- **Sorties** : pour `i ≤ fin`, 1 si la bougie porte un évènement de ce sens, 0 sinon ; pour
  `i > fin`, `undefined`. Indépendantes de `signauxPrecoces` et de `maxZonesSr`.
- **Rubans**, dans cet ordre : fortes, faibles, cassées (`zonesTraceesAxis`). Un ruban part de
  `confirmationIdx` et va jusqu'à `n − 1` (zone active) ou `finIdx` (cassée) ; `hauts[k]`/`bas[k]`
  = bornes de la dernière entrée d'`evolution` d'idx ≤ `confirmationIdx + k`. Couleur selon
  `zone.nature`. Alpha : `alphaZoneForte(force)`, `0` pour une faible, `ALPHA_ZONE_CASSEE`.
  Info : fortes et faibles seulement.
- **Bords** (segments) : un segment haut et un segment bas par palier d'`evolution`, horizontaux,
  `cible: "prix"`, **sans `info`** ; `trait: "plein"` pour une forte, `"pointille"` pour une
  faible ; aucun bord pour une cassée. La ligne médiane actuelle disparaît.
- **Étiquettes de zone**, ajoutées après les étiquettes existantes, fortes puis faibles :
  `{ idx: n − 1, valeur: zone.niveau, texte, couleur, cible: "prix", ancrageX: "droite" }` ;
  texte `S fort · ${touches}` ou `R forte · ${touches}` ; `faible` pour une faible.
- **Triangles creux**, rangés dans `marqueurs` après les signaux confirmés et avant les forts
  mouvements : un par (bougie, sens), zone citée = la plus forte puis la plus proche du close ;
  aucun sur une bougie de signal confirmé ; les `MAX_SIGNAUX_AXIS` (120) plus récents ;
  `valeur` = `low` (support) ou `high` (résistance) ; `creux: true` ; rien si `signauxPrecoces`
  est faux.
- `maxZonesSr` = 0 : ni ruban, ni bord, ni étiquette de zone ; les triangles creux restent.
- **Textes** (accords « touche(s) », « rejet(s) » comme le texte actuel) :

```
AXIS zone forte de support [75626.55 – 76601.83] (niveau 76114.19, -1.89 % du cours) — 5 touches, 2 rejets sur volume fort — touches comptées sur 3000 bougies
AXIS zone forte de résistance [85314.76 – 86430.38] (niveau 85872.57, +10.69 % du cours) — 12 touches, 7 rejets sur volume fort, polarité inversée — touches comptées sur 3000 bougies
AXIS S/R réaction sur support fort [75592.65 – 76529.83] — 4 touches, 2 rejets sur volume fort ; la bougie est entrée dans la zone et a clôturé au-dessus ; signal précoce non mesuré — lecture indicative, jamais une promesse
```

  (« faible » à la place de « forte » ; « résistance forte … a clôturé au-dessous » pour l'autre sens.)

- [ ] **Étape 1 — mettre à jour `stratAxisSr.test.ts`**
  - contrat : `amorceBougies` = `AMORCE_AXIS_SR` = 3000 et `stratAxis.amorceBougies` = `AMORCE_AXIS` ;
    23 réglages, les six derniers étant les quatre existants (libellé de `maxZonesSr` changé) puis
    les deux nouveaux ; 8 sorties, les deux nouvelles en dernier ; `stratAxis` toujours 17 et 4 ;
  - `resume()` : écarter aussi `m.creux === true` ;
  - identité avec `stratAxis` : calculer AXIS S/R avec `{ ...EMA50, signauxPrecoces: false }` ;
    `marqueurs` égaux ; `labels` égaux après retrait de ceux d'`ancrageX === "droite"` ;
  - fixture dorée : 4 rubans (2 `--up`, 2 `--down`), tous d'alpha 0, finissant à `n − 1`, info
    `/^AXIS zone faible de (support|résistance) \[/` et finissant par `touches comptées sur 300 bougies` ;
    tous les segments `pointille`, `cible: "prix"`, sans `info`, horizontaux, au moins 8 ;
    `maxZonesSr: 0` : rubans et segments absents, séries inchangées ;
  - causalité : ajouter `reactionSupport` et `reactionResistance` aux séries contrôlées, avec
    `{ ...EMA50, margeResistanceAtr: 0.5, forceZoneForte: 2 }`.
  Les chaînes attendues de `margeResistanceAtr` (`"60▲ 88▼ 108▲ 139▼ 280▲"`…) ne changent pas.

- [ ] **Étape 2 — tests en échec, `stratAxisSr.trace.test.ts`** : `bougiesBtcusdt4h()`, réglages
  par défaut, `aux = { refClose: closes }`, unité `"4h"`.

  | Test | Attendu |
  | --- | --- |
  | sorties | longueur 3000 ; somme `reactionSupport` 62, `reactionResistance` 60 ; `reactionSupport[2733] === 1`, `reactionResistance[2761] === 1` ; `reactionResistance[2850] === 1` alors que 2850 porte un signal confirmé |
  | rubans | 24 ; `[0]` : `--up`, alpha ≈ 0.224, `deIdx` 2586, 414 points, dernier haut ≈ 76601.83, info = 1re chaîne ci-dessus ; `[1]` : `--down`, alpha ≈ 0.332, `deIdx` 956, info = 2e chaîne ; `[8]` info commence par `AXIS zone faible de résistance [78917.30 – 79672.11]` ; `[9]` par `AXIS zone faible de support [74552.38 – 75480.41]` ; `[8..11]` alpha 0 ; `[12..23]` alpha 0.09 sans info, `[12]` finit à l'idx 2986 |
  | bords | aucun `info` ; horizontaux ; `cible: "prix"` ; au moins 16 `plein` et 8 `pointille` |
  | étiquettes de zone | 12 d'`ancrageX: "droite"`, toutes à l'idx 2999 ; textes dans l'ordre `S fort · 5`, `R forte · 12`, `R forte · 8`, `S fort · 8`, `S fort · 7`, `S fort · 8`, `R forte · 4`, `R forte · 4`, puis quatre `faible` |
  | triangles creux | 120 ; premier idx 262, dernier 2988 ; aucun à 2850 ni sur un idx de signal confirmé ; celui de 2733 : `triangleHaut`, `--up`, `valeur` = `low`, info = 3e chaîne ; dans `marqueurs`, tous après le dernier signal confirmé et avant le premier `--accent` |
  | `signauxPrecoces: false` | aucun marqueur creux ; séries et rubans identiques au défaut |
  | `maxZonesSr: 0` | `rubans` et `segments` absents ; aucune étiquette « droite » ; 120 triangles creux |
  | `forceZoneForte: 50` | sommes des deux sorties nulles ; aucun triangle creux ; 4 rubans, tous d'alpha 0 |
  | bougie en formation | dernière bougie `closed: false`, `low` abaissé à 75000 : sorties `undefined` à 2999, aucun marqueur creux à 2999 |
  | prix × 1e-9 | mêmes idx de triangles creux ; info de `rubans[0]` contient `[0.00007563 – 0.00007660]` |
  | série courte | `[]` et 8 bougies : aucune exception, séries de longueur n, ni ruban ni marqueur creux |
  | coût | médiane de 30 calculs complets < 25 ms (borne large pour la CI ; relever la médiane réelle au rapport) |

- [ ] **Étape 3 — test en échec, `packages/alerts/src/engine.axisSr.test.ts`**, sur le modèle de
  `engine.axis.test.ts` (même pilote `declenchements`, préfixes croissants, bougies closes) :
  les bougies viennent du JSON, importé comme le fait déjà `engine.axis.test.ts`
  (`import fixtureBtc from "../../indicators/src/strategy/fixtures/btcusdt-4h-3000.json"`), puis
  converties en `Candle` dans le test (`sellVolume = volume − buyVolume`, `closed: true`). Importer
  `fixtures/btcusdt4h.ts` depuis `packages/alerts` casse `tsc` (TS6059 : hors `rootDir`). Condition
  `{ type: "indicateur-seuil", indicateurId: "stratAxisSr", params: {}, output: "reactionSupport", comparateur: ">=", valeur: 1 }`,
  première évaluation à l'idx 2700 → déclenchements exactement aux 20 supports ≥ 2700 du lot 2 ;
  même test sur `reactionResistance` → les 11 résistances ≥ 2700. Délai 60 s par test.
- [ ] **Étape 4 — lancer** les trois fichiers → échecs attendus.
- [ ] **Étape 5 — implémenter** : constantes et aides ci-dessus, réglages, sorties, amorce, tracé,
  textes ; mettre à jour l'en-tête du fichier (points 2 et 3 de la liste, plus les signaux
  précoces et la profondeur de 3 000 bougies).
- [ ] **Étape 6 — vérifier** : `pnpm --filter @axiom/indicators test`, `pnpm --filter @axiom/alerts test`,
  `pnpm --filter @axiom/web test`, et les trois `typecheck` → tout vert ; `stratAxis.test.ts` non
  modifié. Un test web qui épingle l'ancien nombre de réglages ou de sorties d'AXIS S/R se met à
  jour dans ce lot (fichier nommé au rapport).
- [ ] **Étape 7 — commit** : `Tracer les zones d'AXIS S/R par force et marquer les réactions sur zone forte`.

---

### Task 4 — Lot 4 : Profondeur : 3 000 bougies pour AXIS S/R et sa référence (développeur web)

**Fichiers**
- Modifier : `apps/web/src/chart/auxProvider.ts` (`REFCLOSE_LIMIT`, chargement de `refClose`)
- Tests : `apps/web/src/chart/auxProvider.test.ts`, `apps/web/src/chart/extensionSession.test.ts`

**Interfaces**
- Consomme : `getIndicator("stratAxisSr")?.amorceBougies === 3000` (lot 3).
- Produit : `export const REFCLOSE_LIMIT = 3000;`

- [ ] **Étape 1 — tests en échec, `extensionSession.test.ts`** (bloc `amorceMinimale` existant)

```ts
expect(getIndicator("stratAxisSr")?.amorceBougies).toBe(3000);
expect(amorceMinimale(["stratAxisSr"])).toBe(3000);
expect(amorceMinimale(["stratAxis", "stratAxisSr", "rsi"])).toBe(3000);
expect(amorceMinimale(["stratAxis"])).toBe(1500);
expect(limitePageAmorce(500, 3000, 500)).toBe(500);
expect(limitePageAmorce(2800, 3000, 500)).toBe(200);
expect(REFCLOSE_LIMIT).toBeGreaterThanOrEqual(3000); // la référence couvre l'amorce la plus longue
expect(PLAFOND_BOUGIES_GRAPHE).toBeGreaterThanOrEqual(3000); // data/profondeurHistorique.ts : 20 000
```

  Plus un test « l'extension compte en BOUGIES : 500 → 3 000 en cinq pages de 500 (AXIS S/R) »,
  copie du test existant à 1 500 avec `bougiesMin: amorceMinimale(["stratAxisSr"])` : 5 pages,
  `limits` = `[500, 500, 500, 500, 500]`, tampon de 3 000 bougies, puis 0 page au second appel
  (plafond actuel de 8 pages par extension, `MAX_PAGES_SESSION`).

- [ ] **Étape 2 — tests en échec, `auxProvider.test.ts`** : remplacer le test « la source
  complète (≥ 1 500 bougies) couvre l'amorce en deux pages fusionnées » par les deux suivants
  (même montage : `vi.spyOn(binanceAdapter, "fetchKlines")`, `ids: ["refClose"]`).

  | Test | Pages servies | Attendu |
  | --- | --- | --- |
  | source complète | trois pages de 1 000 bougies, `time = (debut + i) × H`, `close = debut + i`, débuts 2000, 1000, 0 ; `candleTimes: [0, 1500 * H, 2999 * H]` | 3 appels : `{ limit: 1000 }`, `{ limit: 1000, endTime: 2000 * H - 1 }`, `{ limit: 1000, endTime: 1000 * H - 1 }` ; `refClose: [0, 1500, 2999]` |
  | source courte | les pages actuelles du test (1 000 puis 501 bougies), puis `[]` | 3 appels, le 2e `{ limit: 1000, endTime: 501 * H - 1 }`, le 3e `{ limit: 1000, endTime: -1 }` ; même `refClose` qu'aujourd'hui (`[50, 550, 599, 1099]`) |

  Le test « référence stricte » (deux appels quand la seconde page n'apporte rien) reste inchangé.

- [ ] **Étape 3 — implémenter** : `REFCLOSE_LIMIT = 3000`, exporté. Charger par pages de
  `min(1000, REFCLOSE_LIMIT − total)` : la première sans borne, chaque suivante avec
  `endTime` = ouverture de la plus ancienne bougie reçue − 1 ; fusion sans doublon ; arrêt quand
  le total atteint `REFCLOSE_LIMIT` ou qu'une page n'apporte aucune bougie nouvelle. Une seule
  entrée de cache, comme aujourd'hui. Mettre à jour les commentaires qui disent « 1 500 ».
- [ ] **Étape 4 — vérifier** : `pnpm --filter @axiom/web exec vitest run src/chart` → vert. Si un
  autre test épingle « deux appels » pour `refClose`, l'adapter à la règle de l'étape 3 et le
  dire au rapport. `pnpm --filter @axiom/web typecheck` → 0 erreur.
- [ ] **Étape 5 — commit** : `Porter à 3 000 bougies la profondeur d'AXIS S/R et de sa série de référence`.

---

### Task 5 — Lot 5 : Documents (orchestrateur)

**Fichiers** : `BUILD-CONTRACT.md`, `docs/axis-2026-10-07.md`, `README.md`.

- [ ] **`BUILD-CONTRACT.md`** : section « AXIS S/R — zones classées par force et signal précoce
  (demande du 9 novembre 2026) » : la demande citée, le périmètre (aucune fenêtre, aucun
  fournisseur, aucun indicateur ; deux champs optionnels dans `@axiom/types` ; amorce de 3 000
  bougies pour `stratAxisSr` ; `REFCLOSE_LIMIT` 3 000), les limites connues (profondeur
  d'historique, alertes), la mention « non mesuré », le renvoi à la conception.
- [ ] **`docs/axis-2026-10-07.md`**, section AXIS S/R : zones fortes, faibles et cassées ; règle
  de réaction ; réglages et sorties ; profondeur ; limites de lecture ; la mesure rapide du §9
  de la conception, présentée comme hors protocole.
- [ ] **`README.md`**, paragraphe AXIS S/R : trois phrases (zones par force, triangle creux
  « non mesuré », 3 000 bougies).
- [ ] **Commit** : `Documenter les zones par force et les signaux précoces d'AXIS S/R`.

---

### Task 6 — Lot 6 : Preuves et revue finale (orchestrateur et réviseur)

- [ ] `pnpm check` → `==> [ci] OK` ; relever les comptes de tests et le budget d'entrée
  (départ 1 188 293 / 354 533 ; marge gzip ≥ 3 000 exigée).
- [ ] `pnpm check:e2e` → vert.
- [ ] Coût du calcul à 3 000 bougies : médiane relevée au lot 3, comparée à 2,9 ms.
- [ ] Application réelle (`pnpm run up`) : BTCUSDT 4h, ＋ AXIS S/R. Capture bureau (1440 px) et
  téléphone (390 px). Vérifier à l'œil : zones fortes pleines et étiquetées dans la marge
  droite, faibles en pointillé, cassées estompées, triangles creux, signaux pleins inchangés,
  infobulle de zone finissant par « touches comptées sur N bougies », 3 000 bougies chargées.
- [ ] Revue indépendante du diff complet (`git diff main...HEAD`) : causalité, identité des
  signaux confirmés, textes, budget ; correctifs éventuels par le développeur du lot concerné.
- [ ] Rapport au propriétaire, avec les captures. Fusion, poussée, déploiement : sur son accord.
