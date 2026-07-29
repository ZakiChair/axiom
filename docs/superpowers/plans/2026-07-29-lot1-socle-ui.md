# Lot 1 « Socle UI » — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consacrer les primitives UI manquantes dans `ui.tsx`, corriger le piège structurel de FloatingWindow, puis migrer les ~36 fenêtres pour que le même besoin soit toujours résolu par le même composant — verrouillé par un test de conventions « ratchet ».

**Architecture:** Les primitives sont du MARKUP PUR (aucun hook, aucun état) testable en vitest node par inspection d'éléments React (patron `ErrorBoundary.test.tsx`) ; les comportements sont des fonctions pures exportées (patron `indexRoving`/`texteFraicheur`). La migration se fait par vagues committées, chacune faisant reculer la liste d'exceptions du test de conventions (le « ratchet » interdit toute régression et force la complétude).

**Tech Stack:** React 18, Tailwind (tokens sémantiques uniquement), Zustand vanilla, vitest 2 (env node, PAS de DOM), Playwright (`apps/web/e2e/gate-*.e2e.ts`).

**Spec:** `docs/superpowers/specs/2026-07-29-uniformisation-ui-corr-sect-themes-design.md` (§ Lot 1)

## Global Constraints

- Commentaires et libellés en **français** (convention repo).
- Couleurs **exclusivement** via tokens sémantiques (`bg-bg`, `text-text-dim`, `border-down/40`…) — jamais de hex dans les composants.
- Contrat de test : **vitest env node, sans DOM** — les composants ne s'invoquent en test que s'ils n'ont pas de hook ; toute logique va dans des fonctions pures exportées.
- Modifications **chirurgicales** : ne toucher que ce que la vague liste ; ne pas refactorer le code métier traversé ; ne pas supprimer de code mort préexistant non listé.
- Gotcha PAPER : `paperStore` réécrit les positions à chaque tick — ne pas toucher aux abonnements par signature stable existants.
- Focus standard unique : `focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent/60`.
- Densité standard du corps : `px-4 py-3`, rythme `space-y-3`, grilles de tuiles `gap-2`.
- Convention corps de fenêtre (établie Tâche 1) : fenêtre défilante → corps `px-4 py-3` SANS `flex-1`/`overflow` (le chrome défile) ; fenêtre à géométrie fixe → corps `flex min-h-0 flex-1 flex-col px-4 py-3`.
- Convention erreurs : donnée en échec = `ErreurBloc` ; erreur de formulaire inline = `<p className="text-[10px] text-down">` ; avertissement non bloquant = `text-warn`.
- Slot `actions` d'`EnTeteFenetre` : uniquement `BarrePeriodes`, `BoutonRafraichir` et/ou UNE stat courte (`Fraicheur` compte comme stat courte).
- Commandes : unit `pnpm --filter @axiom/web test` (ou `npx vitest run <fichier>` dans `apps/web`) · typecheck `pnpm -r typecheck` · E2E `pnpm --filter @axiom/web test:e2e` · CI complète `bash scripts/ci.sh`.
- Branche : `feat/coherent-lot1-socle-ui` depuis `main`. Messages de commit en français, suffixés :
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## Structure de fichiers

| Fichier | Rôle |
| --- | --- |
| `apps/web/src/components/FloatingWindow.tsx` | Modifier :296 — corps devient conteneur flex |
| `apps/web/src/components/ui.tsx` | Modifier — nouvelles primitives (Input, Select, Bouton, BoutonBascule, BoutonRafraichir, SegmenteCompact, Chip, BarreProgression, TitreSection, TuileStat) + `MenuDeroulant` direction + Metric → alias déprécié |
| `apps/web/src/components/ui.test.tsx` | Créer — tests des primitives (inspection d'éléments) |
| `apps/web/src/components/TableTriable.tsx` | Créer — composant + helpers purs `trierLignes`/`basculerTri` |
| `apps/web/src/components/TableTriable.test.tsx` | Créer — tests des helpers purs + smoke markup |
| `apps/web/src/components/uiConventions.test.ts` | Créer — test de conventions « ratchet » (scan des sources) |
| `apps/web/src/lib/canvasTokens.ts` | Modifier — constante `POLICE_CANVAS` |
| `apps/web/e2e/gate-lot1-corps-flex.e2e.ts` | Créer — gate structure du corps |
| ~20 fichiers `*Window.tsx` | Modifier par vagues (détail par tâche) |

**Fenêtres du périmètre (36)** : derivatives, fundingMatrix, liquidations, eco, news, corr, onchain, marketMap, portfolio, notes, screener, termStructure, options, dom, backtest, replay, macroRates, cot, seasonality, vol, fund, brief, globe, stablecoins, squeeze, cbprem, netliq, data, dist, expy, paper, mine, cycle, evts, scen, mcap.

---

### Task 1: Corps flex de FloatingWindow + convention structurelle

**Files:**
- Modify: `apps/web/src/components/FloatingWindow.tsx:296`
- Modify: `apps/web/src/components/McapWindow.tsx:432-437`
- Modify: `apps/web/src/components/LiquidationsWindow.tsx:995`
- Create: `apps/web/e2e/gate-lot1-corps-flex.e2e.ts`

**Interfaces:**
- Produces: convention corps de fenêtre (cf. Global Constraints) — les vagues 10-15 s'y réfèrent.

- [ ] **Step 1: Créer la branche**

```bash
cd ~/axiom && git checkout -b feat/coherent-lot1-socle-ui main
```

- [ ] **Step 2: Écrire le gate E2E (échouera avant le fix)**

Créer `apps/web/e2e/gate-lot1-corps-flex.e2e.ts` sur le modèle des `gate-*.e2e.ts` existants (regarder `smoke.e2e.ts` pour le boot) :

```ts
import { expect, test } from "@playwright/test";

/**
 * Gate Lot 1 — le corps des fenêtres flottantes est un conteneur FLEX :
 * `flex-1` des enfants n'y est plus inerte (fini les doubles ascenseurs).
 */
test("le corps de FloatingWindow est un conteneur flex-col", async ({ page }) => {
  await page.goto("/");
  // NOTE : fenêtre locale sans réseau — Notes / journal.
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await page.getByPlaceholder(/commande/i).fill("NOTE");
  await page.keyboard.press("Enter");
  const fenetre = page.locator('[data-window-id="notes"]');
  await expect(fenetre).toBeVisible();
  const corps = fenetre.locator(":scope > div.min-h-0.flex-1");
  await expect(corps).toHaveCSS("display", "flex");
  await expect(corps).toHaveCSS("flex-direction", "column");
});
```

Si `[data-window-id]` n'existe pas sur le conteneur de FloatingWindow, l'ajouter
(`data-window-id={id}` sur le div racine) — attribut inerte, utile à tous les gates suivants.

- [ ] **Step 3: Lancer le gate pour vérifier qu'il échoue**

Run: `cd apps/web && npx playwright test e2e/gate-lot1-corps-flex.e2e.ts`
Expected: FAIL (`display` vaut `block`).

- [ ] **Step 4: Corriger FloatingWindow:296**

```tsx
      {/* Corps : conteneur FLEX défilant — `flex-1` des enfants s'y résout (fini le
          bloc où flex-1 était inerte, source de doubles ascenseurs). Convention :
          fenêtre défilante = corps `px-4 py-3` nu ; géométrie fixe = corps
          `flex min-h-0 flex-1 flex-col px-4 py-3`. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
```

- [ ] **Step 5: Retirer les deux contournements locaux**

Dans `McapWindow.tsx` (~l.432) : supprimer le commentaire « `h-full` et non `flex-1`… »
et remplacer :

```tsx
      <div className="flex h-full min-h-0 flex-col px-4 py-3">
```

par :

```tsx
      <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
```

Dans `LiquidationsWindow.tsx` (~l.995), remplacer le wrapper :

```tsx
    <div className="flex h-full flex-col">
```

par :

```tsx
    <div className="flex min-h-0 flex-1 flex-col">
```

- [ ] **Step 6: Vérifier**

Run: `cd apps/web && npx playwright test e2e/gate-lot1-corps-flex.e2e.ts e2e/gate-v25-cap-dominance.e2e.ts && pnpm --filter @axiom/web test`
Expected: PASS (gate v25 garantit que les 3 graphes CAP tiennent toujours dans la fenêtre).

- [ ] **Step 7: Vérification visuelle rapide**

`pnpm dev`, ouvrir CAP, LIQ, EQS, NOTE : aucun double ascenseur, CAP occupe toute la hauteur.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "fix(web): le corps de FloatingWindow devient un conteneur flex (fin des doubles ascenseurs)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Primitives Input & Select

**Files:**
- Modify: `apps/web/src/components/ui.tsx`
- Create: `apps/web/src/components/ui.test.tsx`

**Interfaces:**
- Produces:
  - `export const CLASSES_CHAMP: string`
  - `export function Input(props: React.InputHTMLAttributes<HTMLInputElement>): JSX.Element`
  - `export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>): JSX.Element`
  - `props.className` est TOUJOURS suffixé aux classes standard (jamais remplacé).

- [ ] **Step 1: Écrire les tests (nouveaux, dans `ui.test.tsx`)**

```tsx
import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { CLASSES_CHAMP, Input, Select } from "./ui";

/** Invoque un composant SANS hook et retourne ses props d'élément racine. */
function racine(el: unknown): { type: unknown; props: Record<string, unknown> } {
  const e = el as ReactElement;
  return { type: e.type, props: e.props as Record<string, unknown> };
}

describe("Input / Select", () => {
  it("rend un <input> avec le focus standard et fusionne className", () => {
    const { type, props } = racine(Input({ placeholder: "Nom…", className: "flex-1" }));
    expect(type).toBe("input");
    expect(props.className).toContain(CLASSES_CHAMP);
    expect(props.className).toContain("flex-1");
    expect(CLASSES_CHAMP).toContain("focus:ring-accent");
    expect(CLASSES_CHAMP).toContain("rounded-md");
    expect(CLASSES_CHAMP).toContain("text-[11px]");
  });
  it("rend un <select> avec les mêmes classes de champ", () => {
    const { type, props } = racine(Select({ "aria-label": "Champ" }));
    expect(type).toBe("select");
    expect(props.className).toContain(CLASSES_CHAMP);
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd apps/web && npx vitest run src/components/ui.test.tsx`
Expected: FAIL (`CLASSES_CHAMP` non exporté).

- [ ] **Step 3: Implémenter dans `ui.tsx`**

```tsx
/**
 * Classes de champ standard (Input/Select) — UNE seule apparence, UN seul focus
 * (l'audit 2026-07-29 relevait 5 traitements de focus, 2 rayons, 3 tailles).
 */
export const CLASSES_CHAMP =
  "rounded-md border border-border bg-bg px-2 py-1 text-[11px] text-text placeholder:text-text-dim " +
  "focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent " +
  "disabled:cursor-not-allowed disabled:opacity-50";

/** Champ texte/nombre standard. `className` s'AJOUTE (largeur, flex…) sans remplacer. */
export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${CLASSES_CHAMP} ${className ?? ""}`} />;
}

/** Liste déroulante native standard — même gabarit que Input. */
export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${CLASSES_CHAMP} ${className ?? ""}`} />;
}
```

(Ajouter `import type React from "react"` seulement si le fichier ne référence pas déjà les types React nécessaires.)

- [ ] **Step 4: Vérifier**

Run: `cd apps/web && npx vitest run src/components/ui.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui.tsx apps/web/src/components/ui.test.tsx
git commit -m "feat(web): primitives Input/Select — un seul gabarit de champ et de focus

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Primitives Bouton (primaire/secondaire/danger), BoutonBascule, BoutonRafraichir

**Files:**
- Modify: `apps/web/src/components/ui.tsx`
- Modify: `apps/web/src/components/ui.test.tsx`

**Interfaces:**
- Produces:
  - `export type VarianteBouton = "primaire" | "secondaire" | "danger"`
  - `export const CLASSES_BOUTON: Record<VarianteBouton, string>`
  - `export function Bouton({ variante?, ...props }: { variante?: VarianteBouton } & React.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element` (défaut `secondaire`, `type="button"` par défaut)
  - `export function BoutonBascule({ actif, ...props }: { actif: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element` — pose `aria-pressed`, préfixe « ● » quand actif
  - `export function BoutonRafraichir({ onClick, libelle?, disabled?, title? }): JSX.Element` — « ↻ {libelle} », défaut « Rafraîchir »
- `BTN_SECONDAIRE` (constante existante) reste exporté : `CLASSES_BOUTON.secondaire === BTN_SECONDAIRE`.

- [ ] **Step 1: Écrire les tests**

Ajouter à `ui.test.tsx` :

```tsx
import { Bouton, BoutonBascule, BoutonRafraichir, BTN_SECONDAIRE, CLASSES_BOUTON } from "./ui";

describe("Bouton", () => {
  it("variante par défaut = secondaire, type=button", () => {
    const { props } = racine(Bouton({ children: "Exporter" }));
    expect(props.type).toBe("button");
    expect(props.className).toContain(CLASSES_BOUTON.secondaire);
  });
  it("le secondaire reste identique à BTN_SECONDAIRE (compat classes)", () => {
    expect(CLASSES_BOUTON.secondaire).toBe(BTN_SECONDAIRE);
  });
  it("primaire = accent bordé (standard CAP), danger = hover down", () => {
    expect(CLASSES_BOUTON.primaire).toContain("border-accent/60");
    expect(CLASSES_BOUTON.primaire).toContain("bg-accent/10");
    expect(CLASSES_BOUTON.danger).toContain("hover:text-down");
  });
  it("BoutonBascule pose aria-pressed et le point quand actif", () => {
    const on = racine(BoutonBascule({ actif: true, children: "Sur le graphe" }));
    expect(on.props["aria-pressed"]).toBe(true);
    expect(on.props.className).toContain("border-accent");
    const off = racine(BoutonBascule({ actif: false, children: "Sur le graphe" }));
    expect(off.props["aria-pressed"]).toBe(false);
  });
  it("BoutonRafraichir : glyphe ↻ et libellé par défaut", () => {
    const el = racine(BoutonRafraichir({ onClick: () => {} }));
    expect(JSON.stringify(el.props.children)).toContain("↻");
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd apps/web && npx vitest run src/components/ui.test.tsx`
Expected: FAIL (`Bouton` non exporté).

- [ ] **Step 3: Implémenter dans `ui.tsx`**

```tsx
/** Variantes de bouton standard — l'audit relevait 3 langages d'action primaire. */
export type VarianteBouton = "primaire" | "secondaire" | "danger";

export const CLASSES_BOUTON: Record<VarianteBouton, string> = {
  /** Action principale d'une fenêtre (lancer un run, construire…) — standard CAP. */
  primaire:
    "rounded border border-accent/60 bg-accent/10 px-3 py-1.5 text-[11px] font-medium text-accent " +
    "transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40",
  /** Action secondaire (recalculer, exporter, choisir…) — reprend BTN_SECONDAIRE. */
  secondaire: BTN_SECONDAIRE,
  /** Action d'interruption/suppression (annuler un run, retirer…). */
  danger:
    "rounded border border-border bg-bg px-2 py-1 text-[11px] text-text-dim transition hover:text-down " +
    "disabled:cursor-not-allowed disabled:opacity-40",
};

/** Bouton standard. `variante` par défaut : secondaire. `type` par défaut : button. */
export function Bouton({
  variante = "secondaire",
  className,
  type = "button",
  ...props
}: { variante?: VarianteBouton } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} type={type} className={`${CLASSES_BOUTON[variante]} ${className ?? ""}`} />;
}

/**
 * Bouton-bascule standard (état ON/OFF) : actif = bordure/texte accent + « ● »
 * (langage LIQ, consacré — remplace ON/OFF textuel et opacity-60).
 */
export function BoutonBascule({
  actif,
  className,
  children,
  ...props
}: { actif: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      type="button"
      aria-pressed={actif}
      className={`rounded border px-2 py-1 text-[11px] font-medium transition ${
        actif ? "border-accent bg-bg text-accent" : "border-border bg-bg text-text-dim hover:text-text"
      } ${className ?? ""}`}
    >
      {actif ? "● " : ""}
      {children}
    </button>
  );
}

/** Action « rafraîchir » standard : glyphe ↻, TOUJOURS dans le slot actions de l'en-tête. */
export function BoutonRafraichir({
  onClick,
  libelle = "Rafraîchir",
  disabled,
  title,
}: {
  onClick: () => void;
  libelle?: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <Bouton onClick={onClick} disabled={disabled} title={title ?? libelle}>
      ↻ {libelle}
    </Bouton>
  );
}
```

- [ ] **Step 4: Vérifier**

Run: `cd apps/web && npx vitest run src/components/ui.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui.tsx apps/web/src/components/ui.test.tsx
git commit -m "feat(web): primitives Bouton/BoutonBascule/BoutonRafraichir — un langage d'action unique

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Primitives SegmenteCompact, Chip, BarreProgression, TitreSection

**Files:**
- Modify: `apps/web/src/components/ui.tsx`
- Modify: `apps/web/src/components/ui.test.tsx`

**Interfaces:**
- Produces:
  - `export const CLASSES_SEGMENT_CONTENEUR: string` (= `"flex items-center gap-0.5 rounded border border-border p-0.5"`)
  - `export function classesSegmentItem(actif: boolean): string` (pure)
  - `export function SegmenteCompact<T extends string | number>({ options, actif, onChange, ariaLabel }: { options: ReadonlyArray<{ id: T; label: string; title?: string }>; actif: T; onChange: (id: T) => void; ariaLabel: string }): JSX.Element`
  - `export function Chip({ children, onRetirer?, retirerLabel?, title? }): JSX.Element`
  - `export function BarreProgression({ fraction, ariaLabel? }: { fraction: number; ariaLabel?: string }): JSX.Element`
  - `export function TitreSection({ children, extra? }: { children: ReactNode; extra?: ReactNode }): JSX.Element`
- Le groupe multi-sélection des leviers LIQ réutilisera `CLASSES_SEGMENT_CONTENEUR` + `classesSegmentItem` (pas le composant, qui est exclusif).

- [ ] **Step 1: Écrire les tests**

```tsx
import {
  BarreProgression, Chip, classesSegmentItem, CLASSES_SEGMENT_CONTENEUR, SegmenteCompact, TitreSection,
} from "./ui";

describe("SegmenteCompact", () => {
  it("conteneur role=group + item actif bg-bg", () => {
    const el = racine(
      SegmenteCompact({
        options: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
        actif: "a", onChange: () => {}, ariaLabel: "Mode",
      }),
    );
    expect(el.props.role).toBe("group");
    expect(el.props.className).toContain(CLASSES_SEGMENT_CONTENEUR);
    expect(classesSegmentItem(true)).toContain("bg-bg text-text");
    expect(classesSegmentItem(false)).toContain("text-text-dim");
    expect(classesSegmentItem(false)).toContain("text-[10px]");
  });
});

describe("Chip / BarreProgression / TitreSection", () => {
  it("Chip : croix ✕ seulement si onRetirer", () => {
    const avec = JSON.stringify(racine(Chip({ children: "BTC", onRetirer: () => {}, retirerLabel: "Retirer BTC" })).props.children);
    expect(avec).toContain("✕");
    const sans = JSON.stringify(racine(Chip({ children: "BTC" })).props.children);
    expect(sans).not.toContain("✕");
  });
  it("BarreProgression : fraction bornée [0,1], piste bg-bg, remplissage bg-accent", () => {
    const el = racine(BarreProgression({ fraction: 1.7 }));
    expect(el.props["aria-valuenow"]).toBe(100);
    expect(el.props.className).toContain("bg-bg");
  });
  it("TitreSection : h3 gabarit unique", () => {
    const el = racine(TitreSection({ children: "Positions" }));
    expect(el.type).toBe("h3");
    expect(el.props.className).toContain("text-[10px] uppercase tracking-wide text-text-dim");
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd apps/web && npx vitest run src/components/ui.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implémenter dans `ui.tsx`**

```tsx
/** Conteneur du segmenté COMPACT (variante en-tête/réglages, consacrée depuis LIQ). */
export const CLASSES_SEGMENT_CONTENEUR = "flex items-center gap-0.5 rounded border border-border p-0.5";

/** Classes d'un item de segmenté compact (pure — réutilisable pour les groupes multi). */
export function classesSegmentItem(actif: boolean): string {
  return `rounded px-1.5 py-0.5 text-[10px] font-medium transition ${
    actif ? "bg-bg text-text" : "text-text-dim hover:text-text"
  }`;
}

/**
 * Segmenté compact standard (bascule EXCLUSIVE, plus dense que `Segmente`) —
 * réglages de fenêtre, sélecteurs d'en-tête. Pour un groupe multi-sélection,
 * réutiliser CLASSES_SEGMENT_CONTENEUR + classesSegmentItem (cf. leviers LIQ).
 */
export function SegmenteCompact<T extends string | number>({
  options,
  actif,
  onChange,
  ariaLabel,
}: {
  options: ReadonlyArray<{ id: T; label: string; title?: string }>;
  actif: T;
  onChange: (id: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className={CLASSES_SEGMENT_CONTENEUR}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={actif === o.id}
          title={o.title}
          className={classesSegmentItem(actif === o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Pastille supprimable standard (extras CORR, dominances CAP, presets EQS/BT). */
export function Chip({
  children,
  onRetirer,
  retirerLabel,
  title,
}: {
  children: ReactNode;
  onRetirer?: () => void;
  /** Nom accessible de la croix — REQUIS si `onRetirer` est fourni. */
  retirerLabel?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className="flex items-center gap-1 rounded border border-border bg-bg px-1.5 py-0.5 text-[10px] text-text-dim"
    >
      {children}
      {onRetirer !== undefined && (
        <button
          type="button"
          onClick={onRetirer}
          aria-label={retirerLabel}
          className="leading-none text-text-dim transition hover:text-down"
        >
          ✕
        </button>
      )}
    </span>
  );
}

/** Barre de progression standard : piste bg-bg, remplissage accent, pleine largeur. */
export function BarreProgression({ fraction, ariaLabel }: { fraction: number; ariaLabel?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-1 w-full overflow-hidden rounded bg-bg"
    >
      <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Titre de section interne standard — un seul gabarit (l'audit relevait 4 variantes h3/span/div). */
export function TitreSection({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <h3 className="mb-1 flex items-baseline justify-between gap-2 text-[10px] uppercase tracking-wide text-text-dim">
      <span>{children}</span>
      {extra !== undefined && <span className="normal-case tracking-normal">{extra}</span>}
    </h3>
  );
}
```

- [ ] **Step 4: Vérifier**

Run: `cd apps/web && npx vitest run src/components/ui.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui.tsx apps/web/src/components/ui.test.tsx
git commit -m "feat(web): primitives SegmenteCompact/Chip/BarreProgression/TitreSection

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Primitive TuileStat (fusion Metric/StatCard/StatMC/Widget)

**Files:**
- Modify: `apps/web/src/components/ui.tsx`
- Modify: `apps/web/src/components/ui.test.tsx`

**Interfaces:**
- Produces:

```tsx
export function TuileStat({
  label, valeur, disposition = "empilee", ton, couleur, title, badge, extra, pied,
}: {
  label: string;
  valeur: string;
  /** `inline` = libellé et valeur sur une ligne (ex-Metric) ; `empilee` = libellé au-dessus (ex-StatCard). */
  disposition?: "inline" | "empilee";
  /** Teinte sémantique de la valeur. */
  ton?: "up" | "down";
  /** Couleur CSS brute (`var(--serie-1)`, `var(--up)`) — PRIORITAIRE sur `ton`. */
  couleur?: string;
  title?: string;
  /** Accolé au libellé (BadgeFiabilite, RefBadge, badge de zone…). */
  badge?: ReactNode;
  /** Accolé à la valeur (sparkline…). */
  extra?: ReactNode;
  /** Ligne du bas (sous-texte, Fraicheur…) — disposition empilée uniquement. */
  pied?: ReactNode;
}): JSX.Element
```

- `Metric` devient un ALIAS DÉPRÉCIÉ : wrapper qui appelle `TuileStat` disposition `inline` (`value`→`valeur`, `labelExtra`→`badge`). Supprimé en Task 16.

- [ ] **Step 1: Écrire les tests**

```tsx
import { Metric, TuileStat } from "./ui";

describe("TuileStat", () => {
  it("empilée : libellé au-dessus, ton down applique text-down", () => {
    const el = racine(TuileStat({ label: "PnL net", valeur: "−123", ton: "down" }));
    const html = JSON.stringify(el.props);
    expect(html).toContain("PnL net");
    expect(html).toContain("text-down");
    expect(html).toContain("tabular-nums");
  });
  it("couleur brute prioritaire sur ton", () => {
    const el = racine(TuileStat({ label: "OI", valeur: "1,2 Md", ton: "up", couleur: "var(--serie-1)" }));
    expect(JSON.stringify(el.props)).toContain("var(--serie-1)");
  });
  it("inline : même tuile bordée, libellé et valeur sur une ligne", () => {
    const el = racine(TuileStat({ label: "Funding", valeur: "0,01 %", disposition: "inline" }));
    expect((el.props.className as string)).toContain("items-baseline justify-between");
  });
  it("Metric (déprécié) délègue à TuileStat inline", () => {
    const viaMetric = racine(Metric({ label: "x", value: "1" }));
    expect(viaMetric.type).toBe(TuileStat);
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd apps/web && npx vitest run src/components/ui.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implémenter**

Remplacer ENTIÈREMENT le corps de `Metric` (ui.tsx:248-281) par le duo suivant (le
commentaire de Metric signale la dépréciation) :

```tsx
/**
 * Tuile de statistique STANDARD — fusionne les 4 variantes locales relevées par
 * l'audit (Metric partagée, StatCard/StatMC de BT, Widget de CHAIN).
 */
export function TuileStat({
  label,
  valeur,
  disposition = "empilee",
  ton,
  couleur,
  title,
  badge,
  extra,
  pied,
}: {
  label: string;
  valeur: string;
  disposition?: "inline" | "empilee";
  ton?: "up" | "down";
  couleur?: string;
  title?: string;
  badge?: ReactNode;
  extra?: ReactNode;
  pied?: ReactNode;
}) {
  const classeTon = ton === "up" ? "text-up" : ton === "down" ? "text-down" : "text-text";
  const styleCouleur = couleur !== undefined ? { color: couleur } : undefined;
  if (disposition === "inline") {
    return (
      <div
        title={title}
        className="flex items-baseline justify-between gap-3 rounded-md border border-border bg-bg px-3 py-2"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-text-dim">
          {label}
          {badge}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {extra}
          <span className={`tabular-nums text-sm font-medium ${classeTon}`} style={styleCouleur}>
            {valeur}
          </span>
        </span>
      </div>
    );
  }
  return (
    <div title={title} className="flex flex-col gap-1 rounded-md border border-border bg-bg px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[10px] uppercase tracking-wider text-text-dim">{label}</span>
        {badge !== undefined && <span className="flex shrink-0 items-center gap-1">{badge}</span>}
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className={`tabular-nums text-sm font-medium ${classeTon}`} style={styleCouleur}>
          {valeur}
        </span>
        {extra}
      </div>
      {pied !== undefined && (
        <div className="flex items-center justify-between gap-2 text-[10px] text-text-dim">{pied}</div>
      )}
    </div>
  );
}

/** @deprecated Alias de compat (supprimé en fin de Lot 1) — utiliser TuileStat. */
export function Metric({
  label,
  value,
  couleur,
  extra,
  labelExtra,
}: {
  label: string;
  value: string;
  couleur?: string;
  extra?: ReactNode;
  labelExtra?: ReactNode;
}) {
  return (
    <TuileStat label={label} valeur={value} disposition="inline" couleur={couleur} extra={extra} badge={labelExtra} />
  );
}
```

- [ ] **Step 4: Vérifier (suite complète : Metric est consommé ailleurs)**

Run: `cd apps/web && pnpm --filter @axiom/web test && pnpm -r typecheck`
Expected: PASS (l'alias préserve l'API `value`/`labelExtra`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui.tsx apps/web/src/components/ui.test.tsx
git commit -m "feat(web): TuileStat — la tuile de statistique unique (Metric devient alias déprécié)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: TableTriable (helpers purs + composant)

**Files:**
- Create: `apps/web/src/components/TableTriable.tsx`
- Create: `apps/web/src/components/TableTriable.test.tsx`

**Interfaces:**
- Produces:

```tsx
export interface ColonneTable<L> {
  id: string;
  label: string;
  align?: "left" | "right";        // défaut "left"
  largeur?: string;                 // fraction de grille CSS, ex. "1.2fr" (défaut "1fr")
  triable?: boolean;                // défaut false
  valeurTri?: (ligne: L) => number | string | null;  // requis si triable
  rendu: (ligne: L) => ReactNode;
}
export interface TriTable { colonne: string; dir: 1 | -1; }
/** Pure : clic sur une colonne — nouvelle colonne → desc (-1), même colonne → inverse. */
export function basculerTri(tri: TriTable | null, colonne: string): TriTable;
/** Pure : trie une copie ; null/undefined en fin ; nombres par différence, chaînes par localeCompare. */
export function trierLignes<L>(lignes: readonly L[], colonnes: readonly ColonneTable<L>[], tri: TriTable | null): L[];
export function TableTriable<L>({ colonnes, lignes, tri, onTri, cle, vide, maxHauteur, surClicLigne }: {
  colonnes: readonly ColonneTable<L>[];
  lignes: readonly L[];
  tri?: TriTable | null;            // contrôlé par la fenêtre (persistable)
  onTri?: (tri: TriTable) => void;
  cle: (ligne: L) => string;
  vide?: ReactNode;                 // rendu <Vide> si lignes.length === 0
  maxHauteur?: string;              // ex. "34vh" → wrapper scrollable
  surClicLigne?: (ligne: L) => void;
}): JSX.Element
```

- Markup : `section rounded-md border border-border bg-bg` ; en-tête grille
  `text-[10px] uppercase tracking-wide text-text-dim` (triable = bouton avec ▾/▴) ;
  rangées grille `text-[11px]`, séparateur `border-b border-border/50`, dernier sans bord.
- Composant SANS hook (contrôlé) → invocable en test node.

- [ ] **Step 1: Écrire les tests**

```tsx
import { describe, expect, it } from "vitest";
import { basculerTri, trierLignes, TableTriable, type ColonneTable } from "./TableTriable";

interface Ligne { sym: string; prix: number | null; }
const COLS: ColonneTable<Ligne>[] = [
  { id: "sym", label: "Symbole", triable: true, valeurTri: (l) => l.sym, rendu: (l) => l.sym },
  { id: "prix", label: "Prix", align: "right", triable: true, valeurTri: (l) => l.prix, rendu: (l) => String(l.prix) },
];
const LIGNES: Ligne[] = [
  { sym: "ETH", prix: 3200 },
  { sym: "BTC", prix: 64000 },
  { sym: "XRP", prix: null },
];

describe("basculerTri", () => {
  it("nouvelle colonne → desc ; même colonne → inversion", () => {
    expect(basculerTri(null, "prix")).toEqual({ colonne: "prix", dir: -1 });
    expect(basculerTri({ colonne: "prix", dir: -1 }, "prix")).toEqual({ colonne: "prix", dir: 1 });
    expect(basculerTri({ colonne: "prix", dir: 1 }, "sym")).toEqual({ colonne: "sym", dir: -1 });
  });
});

describe("trierLignes", () => {
  it("nombres desc, null TOUJOURS en fin, entrée non mutée", () => {
    const copie = [...LIGNES];
    const tri = trierLignes(LIGNES, COLS, { colonne: "prix", dir: -1 });
    expect(tri.map((l) => l.sym)).toEqual(["BTC", "ETH", "XRP"]);
    expect(trierLignes(LIGNES, COLS, { colonne: "prix", dir: 1 }).map((l) => l.sym)).toEqual(["ETH", "BTC", "XRP"]);
    expect(LIGNES).toEqual(copie);
  });
  it("chaînes par localeCompare ; tri null/colonne inconnue → ordre d'origine", () => {
    expect(trierLignes(LIGNES, COLS, { colonne: "sym", dir: 1 }).map((l) => l.sym)).toEqual(["BTC", "ETH", "XRP"]);
    expect(trierLignes(LIGNES, COLS, null).map((l) => l.sym)).toEqual(["ETH", "BTC", "XRP"]);
    expect(trierLignes(LIGNES, COLS, { colonne: "zzz", dir: 1 }).map((l) => l.sym)).toEqual(["ETH", "BTC", "XRP"]);
  });
});

describe("TableTriable (markup)", () => {
  it("grille dérivée des largeurs + état vide", () => {
    const el = TableTriable({ colonnes: COLS, lignes: [], cle: (l) => l.sym, vide: "Aucun trade." }) as {
      props: Record<string, unknown>;
    };
    expect(JSON.stringify(el.props)).toContain("Aucun trade.");
    const plein = TableTriable({ colonnes: COLS, lignes: LIGNES, cle: (l) => l.sym }) as {
      props: Record<string, unknown>;
    };
    expect(JSON.stringify(plein.props)).toContain("1fr 1fr");
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd apps/web && npx vitest run src/components/TableTriable.test.tsx`
Expected: FAIL (module absent).

- [ ] **Step 3: Implémenter `TableTriable.tsx`**

```tsx
/**
 * Table triable STANDARD — remplace les deux mécanismes concurrents relevés par
 * l'audit (<table> HTML nus de PAPER/RATE/STBL, grilles + SortHeader dupliqué de
 * EQS/BT). Composant CONTRÔLÉ et SANS hook : l'état de tri vit dans la fenêtre
 * (persistable), les helpers sont purs (contrat vitest node du repo).
 */
import type { ReactNode } from "react";
import { Vide } from "./ui";

export interface ColonneTable<L> {
  id: string;
  label: string;
  align?: "left" | "right";
  /** Fraction de grille CSS (défaut "1fr"). */
  largeur?: string;
  triable?: boolean;
  /** Valeur de tri — requise si `triable`. null = envoyé en fin de liste. */
  valeurTri?: (ligne: L) => number | string | null;
  rendu: (ligne: L) => ReactNode;
}

export interface TriTable {
  colonne: string;
  dir: 1 | -1;
}

/** Clic d'en-tête : nouvelle colonne → desc (-1) ; même colonne → inversion. */
export function basculerTri(tri: TriTable | null, colonne: string): TriTable {
  if (tri !== null && tri.colonne === colonne) return { colonne, dir: tri.dir === -1 ? 1 : -1 };
  return { colonne, dir: -1 };
}

/** Trie une COPIE des lignes ; null/undefined toujours en fin quelle que soit la direction. */
export function trierLignes<L>(
  lignes: readonly L[],
  colonnes: readonly ColonneTable<L>[],
  tri: TriTable | null,
): L[] {
  if (tri === null) return [...lignes];
  const col = colonnes.find((c) => c.id === tri.colonne);
  if (col === undefined || col.valeurTri === undefined) return [...lignes];
  const v = col.valeurTri;
  return [...lignes].sort((a, b) => {
    const va = v(a);
    const vb = v(b);
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * tri.dir;
    return String(va).localeCompare(String(vb)) * tri.dir;
  });
}

export function TableTriable<L>({
  colonnes,
  lignes,
  tri = null,
  onTri,
  cle,
  vide,
  maxHauteur,
  surClicLigne,
}: {
  colonnes: readonly ColonneTable<L>[];
  lignes: readonly L[];
  tri?: TriTable | null;
  onTri?: (tri: TriTable) => void;
  cle: (ligne: L) => string;
  vide?: ReactNode;
  maxHauteur?: string;
  surClicLigne?: (ligne: L) => void;
}) {
  const grille = colonnes.map((c) => c.largeur ?? "1fr").join(" ");
  const alignement = (c: ColonneTable<L>) => (c.align === "right" ? "text-right justify-end" : "text-left justify-start");
  const corps = (
    <div style={maxHauteur !== undefined ? { maxHeight: maxHauteur } : undefined} className={maxHauteur !== undefined ? "overflow-y-auto" : undefined}>
      {lignes.length === 0 && vide !== undefined ? (
        <Vide>{vide}</Vide>
      ) : (
        lignes.map((l) => (
          <div
            key={cle(l)}
            onClick={surClicLigne !== undefined ? () => surClicLigne(l) : undefined}
            className={`grid items-center gap-2 border-b border-border/50 px-3 py-1.5 text-[11px] last:border-b-0 ${
              surClicLigne !== undefined ? "cursor-pointer hover:bg-surface" : ""
            }`}
            style={{ gridTemplateColumns: grille }}
          >
            {colonnes.map((c) => (
              <span key={c.id} className={`tabular-nums ${c.align === "right" ? "text-right" : ""}`}>
                {c.rendu(l)}
              </span>
            ))}
          </div>
        ))
      )}
    </div>
  );
  return (
    <section className="rounded-md border border-border bg-bg">
      <div
        className="grid items-center gap-2 border-b border-border px-3 py-1.5"
        style={{ gridTemplateColumns: grille }}
      >
        {colonnes.map((c) =>
          c.triable === true && onTri !== undefined ? (
            <button
              key={c.id}
              type="button"
              onClick={() => onTri(basculerTri(tri, c.id))}
              className={`flex w-full items-center gap-0.5 text-[10px] uppercase tracking-wide text-text-dim transition hover:text-text ${alignement(c)}`}
            >
              {c.label}
              {tri !== null && tri.colonne === c.id && <span>{tri.dir === -1 ? "▾" : "▴"}</span>}
            </button>
          ) : (
            <span key={c.id} className={`text-[10px] uppercase tracking-wide text-text-dim ${alignement(c)}`}>
              {c.label}
            </span>
          ),
        )}
      </div>
      {corps}
    </section>
  );
}
```

- [ ] **Step 4: Vérifier**

Run: `cd apps/web && npx vitest run src/components/TableTriable.test.tsx && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/TableTriable.tsx apps/web/src/components/TableTriable.test.tsx
git commit -m "feat(web): TableTriable — le mécanisme de table unique (tri pur, markup contrôlé)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: POLICE_CANVAS + MenuDeroulant direction « haut »

**Files:**
- Modify: `apps/web/src/lib/canvasTokens.ts`
- Modify: `apps/web/src/lib/canvasTokens.test.ts`
- Modify: `apps/web/src/components/ui.tsx` (MenuDeroulant)
- Modify: `apps/web/src/components/ui.test.tsx`

**Interfaces:**
- Produces:
  - `export const POLICE_CANVAS = "10px ui-sans-serif, system-ui, sans-serif"` (canvasTokens.ts) — police unique des axes/étiquettes canvas.
  - `MenuDeroulant` accepte `direction?: "bas" | "haut"` (défaut `"bas"`) : `"haut"` rend le panneau `bottom-full mb-1` (popover CAP en bas de fenêtre).

- [ ] **Step 1: Tests**

Dans `canvasTokens.test.ts`, ajouter :

```ts
import { POLICE_CANVAS } from "./canvasTokens";

it("POLICE_CANVAS : police unique des axes canvas", () => {
  expect(POLICE_CANVAS).toBe("10px ui-sans-serif, system-ui, sans-serif");
});
```

Le panneau de MenuDeroulant n'est rendu qu'à l'ouverture (hook) — la direction se
teste via la fonction pure de classes. Dans `ui.test.tsx` :

```tsx
import { classesPanneauMenu } from "./ui";

it("classesPanneauMenu : bas = mt-1, haut = bottom-full mb-1", () => {
  expect(classesPanneauMenu("left", "bas")).toContain("mt-1");
  expect(classesPanneauMenu("left", "haut")).toContain("bottom-full mb-1");
  expect(classesPanneauMenu("right", "bas")).toContain("right-0");
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd apps/web && npx vitest run src/lib/canvasTokens.test.ts src/components/ui.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implémenter**

`canvasTokens.ts` :

```ts
/** Police UNIQUE des axes/étiquettes canvas (l'audit relevait 4 variantes pour le même rôle). */
export const POLICE_CANVAS = "10px ui-sans-serif, system-ui, sans-serif";
```

`ui.tsx` — extraire la construction des classes du panneau en fonction pure et l'utiliser
dans `MenuDeroulant` (remplacer la classe inline l.154) :

```tsx
/** Classes du panneau de MenuDeroulant (pure — testable sans DOM). */
export function classesPanneauMenu(align: "left" | "right", direction: "bas" | "haut"): string {
  const h = align === "right" ? "right-0" : "left-0";
  const v = direction === "haut" ? "bottom-full mb-1" : "mt-1";
  return `absolute ${h} z-50 ${v} max-h-[70vh] overflow-y-auto rounded border border-border bg-surface p-1 shadow-xl`;
}
```

Dans `MenuDeroulant`, ajouter la prop `direction = "bas"` (type `"bas" | "haut"`) et
remplacer la className du panneau par
`` `${classesPanneauMenu(align, direction)} ${classePanneau}` `` (retirer `mt-1`,
`absolute`, `left-0/right-0`, `max-h-[70vh] overflow-y-auto rounded border…` de
l'ancienne chaîne inline — ils viennent désormais de la fonction).

- [ ] **Step 4: Vérifier**

Run: `cd apps/web && pnpm --filter @axiom/web test`
Expected: PASS (les consommateurs existants de MenuDeroulant sont inchangés : défaut « bas »).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/canvasTokens.ts apps/web/src/lib/canvasTokens.test.ts apps/web/src/components/ui.tsx apps/web/src/components/ui.test.tsx
git commit -m "feat(web): POLICE_CANVAS unique + MenuDeroulant ouvrable vers le haut

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Test de conventions « ratchet »

**Files:**
- Create: `apps/web/src/components/uiConventions.test.ts`

**Interfaces:**
- Produces: le mécanisme de ratchet que TOUTES les vagues suivantes font reculer. Chaque
  vague retire des fichiers des listes `exceptions` ; le test échoue si un fichier listé
  ne matche plus (exception périmée) OU si un fichier non listé matche (régression).

- [ ] **Step 1: Écrire le test (PASSE immédiatement : les exceptions décrivent l'état actuel)**

```ts
/**
 * Conventions UI — test « RATCHET » (Lot 1 Socle UI).
 *
 * Scanne les sources de src/components et interdit les patterns locaux remplacés
 * par les primitives de ui.tsx / TableTriable.tsx. Les `exceptions` sont les
 * fichiers PAS ENCORE migrés : chaque vague de migration retire des entrées.
 * ÉGALITÉ STRICTE dans les deux sens — un fichier listé qui ne matche plus est
 * une exception périmée (à retirer), un fichier non listé qui matche est une
 * régression (interdite).
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const DOSSIER = dirname(fileURLToPath(import.meta.url));
/** Fichiers hors périmètre : primitives elles-mêmes et tests. */
const HORS_PERIMETRE = new Set(["ui.tsx", "TableTriable.tsx"]);

const SOURCES: Array<{ nom: string; texte: string }> = readdirSync(DOSSIER)
  .filter((f) => f.endsWith(".tsx") && !f.includes(".test.") && !HORS_PERIMETRE.has(f))
  .map((nom) => ({ nom, texte: readFileSync(join(DOSSIER, nom), "utf8") }));

interface Motif {
  id: string;
  description: string;
  regex: RegExp;
  /** Fichiers encore autorisés à matcher (état au moment du commit — le ratchet). */
  exceptions: string[];
}

const MOTIFS: Motif[] = [
  {
    id: "champ-local",
    description: "constante input locale — utiliser <Input>/<Select> (ui.tsx)",
    regex: /const\s+input(Class|Cls)\s*=/,
    exceptions: ["ScreenerWindow.tsx", "BacktestWindow.tsx", "PaperWindow.tsx"],
  },
  {
    id: "table-nue",
    description: "<table> nu — utiliser TableTriable",
    regex: /<table\b/,
    exceptions: ["PaperWindow.tsx", "MacroRatesWindow.tsx", "StablecoinsWindow.tsx"],
  },
  {
    id: "sort-header-local",
    description: "SortHeader local dupliqué — utiliser TableTriable",
    regex: /function SortHeader\(/,
    exceptions: ["ScreenerWindow.tsx", "BacktestWindow.tsx"],
  },
  {
    id: "tuile-locale",
    description: "tuile KPI locale — utiliser TuileStat",
    regex: /function (StatCard|StatMC|Widget)\(/,
    exceptions: ["BacktestWindow.tsx", "OnchainWindow.tsx"],
  },
  {
    id: "segmente-maison",
    description: "segmenté compact maison — utiliser SegmenteCompact ou CLASSES_SEGMENT_*",
    regex: /rounded border border-border p-0\.5/,
    exceptions: ["LiquidationsWindow.tsx"],
  },
  {
    id: "barre-progression-maison",
    description: "barre de progression maison — utiliser BarreProgression",
    regex: /h-1 w-(full|64) overflow-hidden rounded/,
    exceptions: ["ScreenerWindow.tsx", "BacktestWindow.tsx", "McapWindow.tsx"],
  },
  {
    id: "btn-secondaire-copie",
    description: "classes de BTN_SECONDAIRE recopiées inline — utiliser <Bouton>",
    regex: /border-border bg-bg px-2 py-1 text-\[11px\] text-text-dim/,
    exceptions: ["CorrWindow.tsx", "McapWindow.tsx", "ScreenerWindow.tsx"],
  },
  {
    id: "police-canvas-divergente",
    description: "police canvas non standard — utiliser POLICE_CANVAS (canvasTokens)",
    regex: /(9px ui-sans-serif|11px ui-monospace|10px system-ui)/,
    exceptions: [
      "CorrWindow.tsx", "McapWindow.tsx", "EvtsWindow.tsx", "VolWindow.tsx",
      "StablecoinsWindow.tsx", "OnchainWindow.tsx", "BacktestWindow.tsx",
    ],
  },
];

describe("conventions UI (ratchet)", () => {
  for (const motif of MOTIFS) {
    it(`${motif.id} — ${motif.description}`, () => {
      const fautifs = SOURCES.filter((s) => motif.regex.test(s.texte)).map((s) => s.nom).sort();
      expect(fautifs, `Fichiers matchant « ${motif.id} » (mettre à jour exceptions UNIQUEMENT en migrant)`).toEqual(
        [...motif.exceptions].sort(),
      );
    });
  }
});
```

- [ ] **Step 2: Lancer et AJUSTER les exceptions à la réalité**

Run: `cd apps/web && npx vitest run src/components/uiConventions.test.ts`
Le premier run peut révéler des fautifs non recensés par l'audit (échantillon de 12
fenêtres seulement). Pour chaque écart : AJOUTER le fichier aux `exceptions` du motif
(état des lieux honnête — il sera migré en vague 14/15). Ne JAMAIS élargir une regex
pour « faire passer ».
Expected après ajustement: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/uiConventions.test.ts
git commit -m "test(web): conventions UI en ratchet — l'uniformisation ne pourra plus régresser

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Vague EQS + BT (Screener, Backtest)

**Files:**
- Modify: `apps/web/src/components/ScreenerWindow.tsx`
- Modify: `apps/web/src/components/BacktestWindow.tsx`
- Modify: `apps/web/src/components/uiConventions.test.ts` (retrait des exceptions)

**Interfaces:**
- Consumes: `Input`, `Select`, `Bouton`, `BarreProgression`, `Chip`, `TitreSection`, `TuileStat`, `TableTriable`/`trierLignes`/`basculerTri`/`TriTable`, `POLICE_CANVAS` (Task 2-7).

- [ ] **Step 1: Rougir le ratchet**

Dans `uiConventions.test.ts`, retirer `ScreenerWindow.tsx` et `BacktestWindow.tsx` de
TOUS les motifs (`champ-local`, `sort-header-local`, `tuile-locale`,
`barre-progression-maison`, `btn-secondaire-copie`, `police-canvas-divergente`).

Run: `cd apps/web && npx vitest run src/components/uiConventions.test.ts`
Expected: FAIL (les fichiers matchent encore).

- [ ] **Step 2: Migrer ScreenerWindow.tsx**

Checklist exhaustive (références = état actuel) :
- Supprimer `const inputClass` (l.98-99). Chaque `<select className={inputClass}>` →
  `<Select …>` ; `<select className={`${inputClass} flex-1`}>` → `<Select className="flex-1" …>` ;
  chaque `<input className={…inputClass…}>` → `<Input …>`. Conserver TOUS les autres
  props (value, onChange, aria-label, placeholder, type).
- Boutons primaires « Lancer le screen » (l.790) et « Scanner les setups » (l.421) →
  `<Bouton variante="primaire" onClick={run}>Lancer le screen</Bouton>` (idem Scanner).
  NOTE : la couleur passe de vert (border-up) à accent — décision de spec (un seul
  langage d'action primaire).
- Boutons « Annuler » (l.415, l.782) → `<Bouton variante="danger" onClick={cancel}>Annuler</Bouton>`.
- Tous les boutons secondaires inline (presets l.611/629, « Valider sur l'historique »
  l.358-365, « Enregistrer » l.687, « ⏰ Alerte » l.705, « + ajouter » l.755) →
  `<Bouton …>` (garder `disabled`, `title` ; le libellé du bouton Valider garde son
  texte dynamique `Mesure… {done}/{total}`).
- Chips « Mes presets » (l.648-668) → `<Chip onRetirer={() => deletePreset(p.id)} retirerLabel={`Supprimer le preset ${p.name}`}>` avec en children le bouton de chargement existant.
- Barres de progression (l.436-441, l.803-810) →
  `<BarreProgression fraction={progress.done / progress.total} ariaLabel="Progression du scan" />`
  (garder la condition d'affichage `runState === "running" && progress.total > 0`).
  NOTE : le remplissage passe de `bg-up` à `bg-accent` — décision de spec.
- Erreur de validation `text-warn` (l.367) → `text-down` (petit `<p>` inline conservé,
  convention « erreur de formulaire »).
- Titres de section `div text-[10px] uppercase…` (« Presets » l.597, « Filtres
  indicateurs » l.735-737, etc.) → `<TitreSection>…</TitreSection>`.
- Table de résultats : supprimer `SortHeader` (l.215-241) et `type SortKey`/`SortState`
  locaux ; construire `const COLONNES_RESULTATS: ColonneTable<ScreenLigne>[]` (7 colonnes :
  symbol left triable/valeurTri `l.symbol`, lastPrice right, priceChangePct24h right avec
  rendu teinté up/down existant, volumeUsd24h right, fundingPct right, oiChangePct right,
  longShortRatio right — reprendre les formateurs des cellules actuelles dans `rendu`).
  L'état de tri local devient `useState<TriTable>({ colonne: "volumeUsd24h", dir: -1 })`
  (équivalent du défaut actuel) ; lignes triées via `trierLignes(...)` dans le `useMemo`
  existant ; rendu via `<TableTriable colonnes={…} lignes={…} tri={tri} onTri={setTri}
  cle={(l) => l.symbol} surClicLigne={…ouvrir le chart comme aujourd'hui…} />`.
  Le surlignage 9e décile actuel se conserve DANS les `rendu` de colonnes (inchangé).
- Corps : `className="flex-1 space-y-3 overflow-y-auto px-4 py-3"` (l.594 et l.407 VueSignaux)
  → `"space-y-3 px-4 py-3"` (le chrome défile désormais — Task 1).
- Police canvas 9px/10px éventuelle → `POLICE_CANVAS` (import depuis `../lib/canvasTokens`).

- [ ] **Step 3: Migrer BacktestWindow.tsx**

- Supprimer `const inputClass` (l.71-73) → `<Input>`/`<Select>` partout (OperandeSelect,
  TF, champs numériques).
- « Lancer le backtest » (l.1195 : `bg-accent/20`) → `<Bouton variante="primaire">` ;
  « Annuler » (l.1187) → `<Bouton variante="danger">`.
- Barre de progression (l.1208-1212) → `<BarreProgression fraction={pctProgress / 100} />`.
- `StatCard` (l.839-847) et `StatMC` (l.643-661) : supprimer les deux composants locaux ;
  chaque usage devient `<TuileStat label={…} valeur={…} ton={…} title={…} />`
  (disposition par défaut `empilee` = markup identique).
- `SortHeader` (l.753-775) + grille `TradesTable` → `TableTriable` : colonnes
  `[{ id: "sens", label: "Sens", largeur: "0.6fr", rendu: … }, { id: "tempsEntree", label: "Entrée", triable: true, valeurTri: (t) => t.tempsEntree, align: "right", rendu: … }, { id: "sortie", label: "Sortie", align: "right", rendu: … }, { id: "dureeBarres", label: "Durée", triable: true, valeurTri: (t) => t.dureeBarres, align: "right", rendu: … }, { id: "pnl", label: "PnL", triable: true, valeurTri: (t) => t.pnl, align: "right", rendu: … }, { id: "pnlPct", label: "PnL%", triable: true, valeurTri: (t) => t.pnlPct, align: "right", rendu: … }]`
  — reprendre les rendus de cellules actuels (L/S teinté, date+prix, raison, pnl teinté).
  `maxHauteur="34vh"`, `vide="Aucun trade."`, tri par défaut `{ colonne: "tempsEntree", dir: 1 }`.
- Chips (l.950-966) → `<Chip>`.
- Titres de section → `<TitreSection>`.
- Corps `flex-1 overflow-y-auto` → convention Task 1.
- Police canvas `10px system-ui` (l.413) → `POLICE_CANVAS`.

- [ ] **Step 4: Vérifier**

Run: `cd apps/web && pnpm --filter @axiom/web test && pnpm -r typecheck && npx playwright test e2e/gate-g6-screener.e2e.ts`
Expected: PASS (le gate screener existant valide le parcours métier).

- [ ] **Step 5: Vérification visuelle**

`pnpm dev` : EQS (les 2 vues) et BT — tri des tables, progression pendant un run, presets.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "refactor(web): EQS et BT sur les primitives (Input/Bouton/TableTriable/TuileStat/BarreProgression)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Vague LIQ (Liquidations)

**Files:**
- Modify: `apps/web/src/components/LiquidationsWindow.tsx`
- Modify: `apps/web/src/components/uiConventions.test.ts`

**Interfaces:**
- Consumes: `SegmenteCompact`, `CLASSES_SEGMENT_CONTENEUR`, `classesSegmentItem`, `BoutonBascule`, `Fraicheur`.

- [ ] **Step 1: Rougir le ratchet** — retirer `LiquidationsWindow.tsx` de `segmente-maison`.

Run: `cd apps/web && npx vitest run src/components/uiConventions.test.ts` → FAIL.

- [ ] **Step 2: Migrer**

- `SelecteurMode` (l.177-198), granularité (l.285-305), `SelecteurFenetre` (l.311-340),
  `SelecteurFenetreHisto` (l.763-792) → `<SegmenteCompact options={…} actif={…}
  onChange={…} ariaLabel="…" />` (reprendre les `title` par option, les libellés et les
  aria-label actuels).
- Leviers multi-sélection (l.254-282) : GARDER la logique (dernier coché verrouillé),
  remplacer le conteneur par `className={CLASSES_SEGMENT_CONTENEUR}` et la classe des
  items par `` `${classesSegmentItem(coche)} ${verrou ? "cursor-not-allowed" : ""}` ``.
- `ToggleChart` (l.147-151) et `ToggleEstimes` (l.215-219) → `<BoutonBascule actif={actif}
  onClick={basculer} title={…}>Sur le graphe</BoutonBascule>` (le « ● » vient de la
  primitive — retirer le préfixe conditionnel du libellé).
- Déplacer `SelecteurFenetreHisto` du slot `actions` d'`EnTeteFenetre` (l.1004-1008) vers
  la rangée « Réglages » de l'onglet historique (convention slot actions).
- Ajouter `Fraicheur` sur l'onglet live : afficher `<Fraicheur loading={false}
  majTs={tsDernierEvenement} />` à côté des totaux — si le store n'expose pas le
  timestamp du dernier évènement, dériver `tsDernier` du dernier élément du flux déjà
  rendu (aucun nouvel abonnement).

- [ ] **Step 3: Vérifier**

Run: `cd apps/web && pnpm --filter @axiom/web test && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 4: Visuel** — LIQ live + historique : segmentés, toggles, heatmap intacte.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor(web): LIQ sur SegmenteCompact/BoutonBascule + Fraicheur

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Vague PAPER + RATE + STBL

**Files:**
- Modify: `apps/web/src/components/PaperWindow.tsx`
- Modify: `apps/web/src/components/MacroRatesWindow.tsx`
- Modify: `apps/web/src/components/StablecoinsWindow.tsx`
- Modify: `apps/web/src/components/uiConventions.test.ts`

**Interfaces:**
- Consumes: `Input`, `Bouton`, `BoutonBascule`, `BoutonRafraichir`, `TableTriable`, `TitreSection`, `Segmente`, `Fraicheur`.

- [ ] **Step 1: Rougir le ratchet** — retirer les 3 fichiers de `table-nue`,
  `PaperWindow.tsx` de `champ-local`, `StablecoinsWindow.tsx` de `police-canvas-divergente`.

- [ ] **Step 2: Migrer PaperWindow.tsx**

- Supprimer `const inputCls` (l.185-186) → `<Input className="w-24" …>` (solde),
  `<Input …>` (formulaire d'ordre). ⚠️ gotcha paperStore : ne pas toucher aux sélecteurs
  d'abonnement.
- Slot actions (l.194-236) : NE GARDER dans l'en-tête aucun contrôle — déplacer le
  toggle « Lignes » (→ `<BoutonBascule actif={overlayActif} …>Lignes</BoutonBascule>`)
  et l'éditeur de solde (bouton ⚙ + Input) en tête de corps, dans une rangée
  `flex items-center gap-2` au-dessus des badges Solde/Équity.
- Les 3 `<table>` sans en-têtes (ordres l.352, positions l.392, historique l.473) →
  `TableTriable` AVEC en-têtes : ordres = colonnes Symbole/Sens/Type/Prix/Taille/(action ✕
  en colonne `align:"right"` non triable) ; positions = Symbole/Sens/Taille/Entrée/PnL
  latent/TP-SL/(actions) ; historique = Symbole/Sens/PnL/Motif/Date. Aucune triable
  n'est requise (triable: false partout = en-têtes simples) — l'apport est l'en-tête et
  le gabarit unique. Reprendre les rendus de cellules actuels tels quels (y compris
  l'édition TP/SL inline dans `rendu`).
- Titres `h3 text-[10px] tracking-wider` (l.346, 386, 469) → `<TitreSection>` (le texte
  garde son compteur : `Ordres en attente ({ordres.length})`).
- Ajouter `<Fraicheur loading={false} majTs={tsDernierTick} />` près des badges d'équity
  si un timestamp de dernier tick est déjà disponible dans le store ; sinon omettre
  (ne pas créer de nouvel état pour ça).

- [ ] **Step 3: Migrer MacroRatesWindow.tsx**

- Bascule Tableau/Courbe maison (l.291-303) → `<Segmente options={VUES_RENDEMENTS…} …>`
  (primitive existante — même rendu).
- `EnteteSection` locale (l.504-511) → `<TitreSection extra={info}>{titre}</TitreSection>`
  et supprimer le composant local. NOTE : le titre passe de `text-text` à `text-text-dim`
  (gabarit unique, décision de spec).
- Bouton ⟳ (l.592-601) → `<BoutonRafraichir onClick={rafraichir} />` dans le même slot actions.
- Chips pays `opacity-60` (l.329-331) → `<BoutonBascule actif={…}>` compact.
- `<table>` (l.353, 389, 446) → `TableTriable` (colonnes = celles des th actuels,
  `align:"right"` pour les numériques, non triables) ; th `font-medium` disparaît de fait.
- Les mentions « au {date} » par section restent via `extra` de TitreSection (même
  formateur `formatDateSource`).

- [ ] **Step 4: Migrer StablecoinsWindow.tsx**

- `<table>` (l.266, 618, 696) → `TableTriable` (mêmes colonnes que les th actuels ;
  rangées `text-[11px]` déjà conformes).
- Police canvas `10px ui-sans-serif` (l.156) et `10px system-ui` (l.386) → `POLICE_CANVAS`.
- Ajouter `<Fraicheur loading={loading} majTs={majTs} />` dans le slot actions de
  l'en-tête (le store STBL expose déjà son horodatage de refresh — vérifier le nom exact
  dans `store/stablecoins` et utiliser le champ existant).
- `BarrePeriodes` reste en tête de corps (l.502 — déjà conforme).

- [ ] **Step 5: Vérifier**

Run: `cd apps/web && pnpm --filter @axiom/web test && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 6: Visuel** — PAPER (ordre complet : formulaire → position → TP/SL), RATE (3 onglets), STBL.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "refactor(web): PAPER/RATE/STBL — tables avec en-têtes via TableTriable, primitives partout

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: Vague CHAIN + CAP (Onchain, Mcap)

**Files:**
- Modify: `apps/web/src/components/OnchainWindow.tsx`
- Modify: `apps/web/src/components/McapWindow.tsx`
- Modify: `apps/web/src/components/uiConventions.test.ts`

**Interfaces:**
- Consumes: `TuileStat` (pied/badge/extra), `Vide`, `ErreurBloc`, `Fraicheur`, `Badge`, `SegmenteCompact`, `MenuDeroulant` (direction « haut »), `Input`, `Chip`, `Bouton`, `BoutonRafraichir`, `BarreProgression`, `POLICE_CANVAS`.

- [ ] **Step 1: Rougir le ratchet** — retirer `OnchainWindow.tsx` de `tuile-locale` et
  `police-canvas-divergente` ; retirer `McapWindow.tsx` de `btn-secondaire-copie`,
  `barre-progression-maison` et `police-canvas-divergente`.

- [ ] **Step 2: Migrer OnchainWindow.tsx**

- Supprimer `Widget` (l.217-269) → `<TuileStat label={libelle} valeur={valeur}
  couleur={color !== undefined ? `var(${color})` : undefined}
  badge={<>{badge}<BadgeFiabilite meta={meta} /></>}
  extra={spark && spark.length >= 2 ? <Sparkline values={spark} color={color ?? "--text-dim"} /> : undefined}
  pied={(sousTexte ?? fraicheur) !== undefined ? <><span className="truncate">{sousTexte ?? ""}</span><span className="shrink-0">{perime ? <Badge ton="warn">cache périmé</Badge> : null} {fraicheur ?? ""}</span></> : undefined} />`.
  (Adapter mécaniquement chaque site d'appel — les props locales `perime`/`fraicheur`
  se composent dans `pied`.)
- Blocs « indisponible » ad hoc (l.470, 834-840, 889-896) → `<Vide>` (avec le même texte)
  + `BadgeFiabilite META_INDISPONIBLE` conservé à côté du titre de section.
- `fmtAge`/`fmtJour` maison (l.259-264) : supprimer au profit de `texteFraicheur`/
  `<Fraicheur>` ; le préfixe « cache périmé · » devient le `Badge ton="warn"` ci-dessus.
- « · maj… » glissé dans le sous-titre (l.609) → `<Fraicheur …>` dans le slot actions
  (stat courte autorisée).
- Sélecteur ETF btc/eth/sol (l.766-779) → `<SegmenteCompact>`.
- Titres `h3 text-[11px] font-semibold tracking-[0.12em]` (l.617-619) → `<TitreSection>`.
- Polices canvas (l.388 et autres) → `POLICE_CANVAS`.

- [ ] **Step 3: Migrer McapWindow.tsx**

- `AjoutDominance` (l.293-346) → `<MenuDeroulant direction="haut" declencheur="+ dominance"
  titre="Ajouter une dominance (top 100)" classePanneau="w-56">{(fermer) => (…)}</MenuDeroulant>` :
  le champ de filtre devient `<Input autoFocus …>`, chaque candidat reste un bouton de
  menu (`role="menuitem"`) qui appelle `ajouterDominance` PUIS `fermer()`. Échap/clic
  extérieur viennent désormais de la primitive. Le bouton déclencheur reprend
  `declencheurClasse={CLASSES_BOUTON.secondaire}` et `chevron={false}`.
- Chips de dominance (l.539-560) → `<Chip onRetirer={() => retirerDominance(c.id)}
  retirerLabel={`Retirer ${c.libelle}`}>` avec la pastille de couleur en children
  (glyphe croix ✕ standard — remplace « × »).
- Boutons : « Construire l'historique (365 j) » (l.464) → `<Bouton variante="primaire">` ;
  « Interrompre » (l.447) et « ↻ Rafraîchir » (l.421-427) → `<BoutonRafraichir
  onClick={() => void mcapStore.getState().prolonger(true)} disabled={backfill.enCours} />`
  et `<Bouton>Interrompre (la progression est conservée)</Bouton>`.
- Progression (l.443-445) → `<div className="w-64"><BarreProgression
  fraction={progression / 100} ariaLabel="Progression du backfill" /></div>`
  (piste passe de bg-border à bg-bg — standard).
- Bandeau d'erreur maison (l.479-481) → `<ErreurBloc>{erreur ?? backfill.erreur}</ErreurBloc>`
  dans le même emplacement (`mb-2`).
- `BarrePeriodes` : DÉPLACER du slot actions (l.415-418) vers la première rangée du corps
  (au-dessus des graphes), dans un `flex items-center justify-between` avec le
  BoutonRafraichir qui reste en en-tête. (Convention : BarrePeriodes en tête de corps.)
- Police canvas `9px ui-sans-serif` (l.108) → `POLICE_CANVAS`.
- Champ de recherche du popover : le style ad hoc `outline-none focus:border-accent/60`
  (l.311) disparaît avec `<Input>`.

- [ ] **Step 4: Vérifier**

Run: `cd apps/web && pnpm --filter @axiom/web test && pnpm -r typecheck && npx playwright test e2e/gate-v25-cap-dominance.e2e.ts`
Expected: PASS.

- [ ] **Step 5: Visuel** — CHAIN (widgets, états indisponibles), CAP (popover dominance vers le haut, chips, backfill).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "refactor(web): CHAIN/CAP — TuileStat, MenuDeroulant, états et fraîcheur standard

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: Vague CORR + OMON + VOL + EVTS

**Files:**
- Modify: `apps/web/src/components/CorrWindow.tsx`
- Modify: `apps/web/src/components/OptionsWindow.tsx`
- Modify: `apps/web/src/components/VolWindow.tsx`
- Modify: `apps/web/src/components/EvtsWindow.tsx`
- Modify: `apps/web/src/components/uiConventions.test.ts`

**Interfaces:**
- Consumes: `Input`, `Bouton`, `BoutonRafraichir`, `Chip`, `Select`, `POLICE_CANVAS`.

- [ ] **Step 1: Rougir le ratchet** — retirer `CorrWindow.tsx` de `btn-secondaire-copie`
  et `police-canvas-divergente` ; retirer `EvtsWindow.tsx` et `VolWindow.tsx` de
  `police-canvas-divergente`.

- [ ] **Step 2: Migrer CorrWindow.tsx**

- « ↻ Recalculer » (l.443-448) → `<BoutonRafraichir onClick={recalculer}
  libelle="Recalculer" />` DÉPLACÉ dans le slot actions d'`EnTeteFenetre`, avec la
  `<Fraicheur …>` existante à côté (stat courte). La rangée du corps qui les portait
  disparaît.
- Champ d'ajout (l.457-462) → `<Input className="min-w-0 flex-1" …>` ; bouton « + »
  (l.463-468) → `<Bouton>+</Bouton>`.
- Chips extras (l.469-486) → `<Chip onRetirer={…} retirerLabel={`Retirer ${s}`}>{s}</Chip>`.
- Tooltip de matrice (l.505-512) : aligner les classes sur l'infobulle partagée —
  `text-[11px]` au lieu de `text-[10px]` (le positionnement souris reste).
- Corps `px-4 py-4` (l.423) → `px-4 py-3` + retirer `flex-1 overflow-y-auto` (convention Task 1).
- Police canvas `9px ui-sans-serif` (l.236) → `POLICE_CANVAS`.

- [ ] **Step 3: Migrer OptionsWindow.tsx**

- Selects natifs (l.631, 660 : `rounded-md … px-2 py-1.5`) → `<Select>`.
- Corps `px-4 py-4` (l.550) → `px-4 py-3`.
- Export de commandes ⌘K en bas de fichier (l.751-783) → déplacer en tête de fichier
  (convention : exports de commandes après les imports, comme CORR/VOL/RATE).

- [ ] **Step 4: Migrer VolWindow.tsx et EvtsWindow.tsx**

- VOL : corps `p-3` (l.469) → `px-4 py-3` ; police canvas `11px ui-monospace` (l.298) →
  `POLICE_CANVAS`.
- EVTS : corps `p-3` (l.335) → `px-4 py-3` ; police canvas (l.173) → `POLICE_CANVAS` ;
  la stat courte du slot actions (l.326-332) est conforme (la garder).

- [ ] **Step 5: Vérifier**

Run: `cd apps/web && pnpm --filter @axiom/web test && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 6: Visuel** — CORR (matrice + tooltip + ajout), OMON, VOL, EVTS.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "refactor(web): CORR/OMON/VOL/EVTS — champs, chips, rafraîchir et densité standard

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 14: Balayage des fenêtres restantes

**Files:**
- Modify (selon besoin) : `DerivativesWindow.tsx`, `FundingMatrixWindow.tsx`, `EcoWindow.tsx`,
  `NewsWindow.tsx`, `MarketMapWindow.tsx`, `PortfolioWindow.tsx`, `NotesWindow.tsx`,
  `TermStructureWindow.tsx`, `DomWindow.tsx`, `ReplayWindow.tsx`, `CotWindow.tsx`,
  `SeasonalityWindow.tsx`, `FundWindow.tsx`, `BriefWindow.tsx`, `GlobeWindow.tsx`,
  `SqueezeWindow.tsx`, `CbpremWindow.tsx`, `NetliqWindow.tsx`, `DataWindow.tsx`,
  `DistWindow.tsx`, `ExpyWindow.tsx`, `MineWindow.tsx`, `CycleWindow.tsx`, `ScenWindow.tsx`
- Modify: `apps/web/src/components/uiConventions.test.ts` (exceptions résiduelles → zéro)

**Interfaces:**
- Consumes: toutes les primitives des Tasks 2-7.

- [ ] **Step 1: Inventaire mécanique**

Pour CHAQUE fenêtre listée, vérifier et corriger UNIQUEMENT ces 7 points (rien d'autre —
modifications chirurgicales) :

1. Corps : densité `px-4 py-3` + `space-y-3` ; retirer `flex-1 overflow-y-auto` interne
   (fenêtre défilante) OU passer à `flex min-h-0 flex-1 flex-col` (géométrie fixe : DOM,
   GLOBE, MAP, SEAG et toute fenêtre à canvas plein cadre).
2. Titres de section internes → `TitreSection`.
3. Inputs/selects/boutons inline → `Input`/`Select`/`Bouton` (et `BoutonRafraichir` pour
   tout ↻/⟳).
4. États : tout chargement textuel ad hoc → `Chargement` ; erreurs → `ErreurBloc`
   (données) ou `<p className="text-[10px] text-down">` (formulaire) ; vides → `Vide`.
5. Fraîcheur : là où le store expose un horodatage → `Fraicheur` (slot actions ou près
   des données) ; ne PAS créer de nouvel état.
6. Police canvas → `POLICE_CANVAS`.
7. Slot actions d'en-tête : uniquement BarrePeriodes / BoutonRafraichir / une stat courte —
   tout le reste descend dans le corps.

- [ ] **Step 2: Vider les exceptions résiduelles du ratchet**

Toute exception encore listée dans `uiConventions.test.ts` (y compris celles découvertes
en Task 8 Step 2) doit tomber à ZÉRO dans cette tâche : `exceptions: []` pour tous les motifs.

Run: `cd apps/web && npx vitest run src/components/uiConventions.test.ts`
Expected: PASS avec toutes les listes vides.

- [ ] **Step 3: Vérifier**

Run: `cd apps/web && pnpm --filter @axiom/web test && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor(web): balayage des fenêtres restantes — conventions à zéro exception

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 15: Suppression de Metric + resserrage final

**Files:**
- Modify: `apps/web/src/components/ui.tsx` (suppression Metric)
- Modify: tous les consommateurs restants de `Metric` (grep)
- Modify: `apps/web/src/components/uiConventions.test.ts` (nouveau motif)

- [ ] **Step 1: Migrer les derniers consommateurs**

```bash
cd apps/web && grep -rn "Metric" src/components --include="*.tsx" | grep -v "test\|TuileStat"
```

Chaque `<Metric label=… value=… couleur=… extra=… labelExtra=… />` →
`<TuileStat label=… valeur=… disposition="inline" couleur=… extra=… badge=… />`.

- [ ] **Step 2: Supprimer l'alias `Metric` de ui.tsx et son test de délégation**

- [ ] **Step 3: Ajouter le motif au ratchet**

```ts
  {
    id: "metric-deprecie",
    description: "Metric supprimé — utiliser TuileStat",
    regex: /\bMetric\b/,
    exceptions: [],
  },
```

- [ ] **Step 4: Vérifier**

Run: `cd apps/web && pnpm --filter @axiom/web test && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor(web): suppression de Metric — TuileStat est la seule tuile

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 16: Gate final — CI complète, E2E, revue visuelle

- [ ] **Step 1: Suite complète**

Run: `cd ~/axiom && bash scripts/ci.sh`
Expected: PASS (unit web+packages, typecheck, build).

- [ ] **Step 2: E2E complète**

Run: `cd apps/web && npx playwright test`
Expected: PASS (les gates g2/g3/g4/g6/g7/g8/g10, v24, v25, smoke et lot1 passent).

- [ ] **Step 3: Gate visuel navigateur (leçon PixelHotel : le rendu réel prime)**

`pnpm dev`, puis passer en revue LES 36 FENÊTRES au zoom navigateur (ouvrir par lots de
6 via le menu Fonctions) : aucun double ascenseur, densité homogène, boutons/champs/
tables/tuiles identiques d'une fenêtre à l'autre, thème dark ET un thème clair (cute).
Consigner tout écart et le corriger avant de conclure.

- [ ] **Step 4: Commit final éventuel + point d'arrêt**

```bash
git add -A && git commit -m "chore(web): lot 1 socle UI — gate visuel passé" # si des retouches ont eu lieu
```

NE PAS merger dans main sans l'accord de Zaki (revue de fin de lot).

---

## Auto-revue du plan (faite à la rédaction)

- **Couverture spec § Lot 1** : primitives 1.1 → Tasks 2-6 ; structure 1.2 → Tasks 1, 9-14
  (densité/slot actions/BarrePeriodes) ; états 1.3 → Tasks 9-14 (+ MenuDeroulant Task 7,
  polices canvas Tasks 7/9-14) ; garde-fous 1.4 → Tasks 8, 14, 15 ; critères de succès →
  Task 16 (+ gate E2E Task 1).
- **Placeholders** : aucun TBD ; les vagues listent chaque remplacement avec fichier:ligne
  et le ratchet garantit mécaniquement la complétude au-delà de l'échantillon audité.
- **Cohérence de types** : `TriTable`/`ColonneTable`/`trierLignes`/`basculerTri` (Task 6)
  = ceux consommés en Tasks 9/11 ; `classesSegmentItem`/`CLASSES_SEGMENT_CONTENEUR`
  (Task 4) = ceux consommés en Task 10 ; `direction` de MenuDeroulant (Task 7) = celui
  consommé en Task 12 ; `TuileStat` props (Task 5) = usages Tasks 9/12/15.
