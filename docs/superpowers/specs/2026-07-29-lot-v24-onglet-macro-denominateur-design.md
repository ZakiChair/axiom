# Lot v2.4 — Onglet « Macro » du menu Indicateurs + bouton de dénominateur (÷ETH / ÷SOL)

Date : 2026-07-29 · Origine : demande Zaki (« ajoute les indicateurs macro dans
un onglet d'indicateur dédié, nul besoin qu'il prenne de la place sur la barre
latérale ; ajoute également un bouton — comme pour ÷BTC — qui compare par
rapport à un actif de notre choix (sol, eth) »). Périmètre arrêté en
brainstorming : **les 3 mesures macro existantes, déplacées** (aucune nouvelle
source) et **liste courte ETH/SOL** pour le dénominateur.

**Constat fondateur** : les mesures macro ne sont PAS des `IndicatorDef`. Le
registre `@axiom/indicators` décrit des `calc(dataList)` purs sur bougies ;
les macros sont des séries fetchées en async (FRED, DefiLlama, CoinGecko)
dessinées par un contrôleur impératif dédié (`chart/macro.ts`, pane
`axiom_macro`). Les enregistrer dans le registre pour hériter de la recherche
et du groupage les ferait retomber dans `INDICATEURS_ANALYSE` — exactement le
catalogue qu'on désencombre. D'où **un onglet**, dont le contenu n'est pas
dérivé du registre.

Invariants BUILD-CONTRACT : aucune dépendance nouvelle ; TS strict
(`noUncheckedIndexedAccess`) ; docblocks FR ; aucune donnée haute fréquence
dans le state React (les séries macro sont basse fréquence — explicitement
sanctionné par `data/macro/types.ts`) ; `pnpm check` vert ; gate visuel
navigateur en fin de lot (les défauts d'UI ne se voient pas aux tests
unitaires).

---

## 1. Onglet « Macro » dans `IndicatorMenu`

### 1.1 Structure

Le panneau du menu Indicateurs gagne une **barre d'onglets** en tête :
`Techniques` | `Macro`. Les contenus sont montés **conditionnellement** (pas
masqués en CSS) : les boutons de l'onglet inactif n'existent pas dans le DOM,
donc le focus roving ↑/↓/Home/End (`button[data-item-indicateur]`, sélecteur
scopé à `panneauRef`) reste correct sans scoping supplémentaire.

- **Techniques** : contenu actuel inchangé (section « Actifs », recherche,
  catalogue groupé par catégorie).
- **Macro** : les 3 mesures, chacune = case à cocher + libellé + valeur +
  variation ~30 j + mini-trend, plus la note de sources.

### 1.2 Déménagement

Nouveau composant `apps/web/src/components/MacroIndicators.tsx` : le CORPS de
`MacroPanel` transplanté sans l'enveloppe `SidebarSection` — fetch
`Promise.allSettled` (stablecoins + M2), rafraîchissement ~15 min, bouton de
refresh manuel, helpers `lastValue` / `changePct` / `couleurTrend` /
`Sparkline` / `Measure`. Aucune modification de la logique de données.

`components/MacroPanel.tsx` est **supprimé** ; son montage disparaît d'`App.tsx`
(la sidebar passe à Watchlist / Alertes / Comparer / Santé).

### 1.3 Deux garde-fous vérifiés avant décision

- **Le poller cap-crypto est central** : `startMacroHistoryPolling` est appelé
  depuis `main.tsx`, pas depuis le panneau. Retirer `MacroPanel` de la sidebar
  n'interrompt PAS l'accumulation de la série persistée
  (`axiom:macroHistory:v1`). Aucune régression cachée.
- **La case M2 reste active sans clé FRED**. C'est le comportement actuel et il
  est correct : `MacroController.fetch` passe `getFredKey() ?? undefined` et le
  proxy `/fredapi` injecte une clé de repli `.env` — l'overlay du graphe marche
  sans clé perso. Seule la LECTURE CHIFFRÉE est conditionnée à `hasKey` et
  renvoie vers les Réglages. Ce découpage est conservé à l'identique ; ne pas
  hériter la garde `hasKey` sur la case à cocher.

### 1.4 Détails d'intégration

- Le badge du bouton « Indicateurs » compte aussi les macros actives (sinon,
  macros seules activées → il affiche le total du catalogue, ce qui se lit
  comme « aucune active »).
- L'onglet « Macro » porte son propre compteur d'actives.
- Le lien « Clé FRED — Réglages ⚙ » ferme le menu avant d'ouvrir le panneau
  Réglages (sinon le menu reste ouvert derrière le slide-over).

### 1.5 Hors périmètre explicite

`MacroController` (`chart/macro.ts`), `store/macro-overlays.ts` et la
persistance `macroOverlays` (session + workspaces) sont **inchangés**. Aucune
nouvelle série macro, aucun champ FRED libre.

---

## 2. Bouton de dénominateur (÷BTC · ÷ETH · ÷SOL)

### 2.1 Généralisation du module pur

`data/ratioBtc.ts` → `data/ratio.ts` (2 sites d'import seulement :
`SymbolBanner.tsx` et son test) :

```ts
export const DENOMINATEURS = ["BTC", "ETH", "SOL"] as const;
export type DenominateurId = (typeof DENOMINATEURS)[number];

/** Ticker de référence par dénominateur et par source jambe (format Binance normalisé). */
export const REFS: Record<DenominateurId, Partial<Record<ExchangeId, string>>>;

/** Symbole SYN du ratio X/DENOM, ou null si non basculable. */
export function symboleRatio(symbol: string, exchange: ExchangeId, denom: DenominateurId): string | null;

/** Ratio actif posé par un toggle + QUEL dénominateur, sinon null. */
export function estRatio(symbol: string, exchange: ExchangeId): { spec: SyntheticSpec; denom: DenominateurId } | null;
```

Refs : `BTC` = table `BTC_REF` actuelle ; `ETH` = ETHUSDT (binance, mexc) /
ETHUSD (kraken, coinbase) ; `SOL` = SOLUSDT (binance, mexc) / SOLUSD (kraken,
coinbase). Un couple (dénominateur, source) sans réf déclarée fait **disparaître
le bouton**, jamais un SYN mort.

Gardes conservées et généralisées : source sans réf → null ; `base === denom`
ou `quote === denom` → null ; `splitSymbol` qui lève → null (pas de throw) ;
`estRatio` exige `exchange === "synthetic"`, `op === "/"`, `exB === exA` et
`legB === REFS[denom][exA]`.

**Ne PAS toucher à `QUOTE_ASSETS` dans `data/symbol.ts`.** La garde
`base === denom || quote === denom` suffit. Cette liste porte l'avertissement
TUSD/FOOTUSD : y ajouter « SOL » serait une régression de découpage globale.

### 2.2 Séparation état actif / préférence

Deux choses distinctes, à ne jamais confondre :

- **Le ratio actif se déduit du SYMBOLE, sans état** (contrat actuel « Détoggle
  SANS ÉTAT »). `estRatio` renvoie *quel* dénominateur a matché — c'est lui qui
  décide quel bouton s'affiche en vert et vers quelle jambe A on revient.
- **Le dénominateur choisi est une préférence persistée**
  (`store/denominateur.ts`, défaut `ETH`), qui ne pilote QUE le libellé et
  l'action du bouton scindé.

Les confondre donnerait un bouton affichant ÷SOL alors qu'on est posé sur un
ratio ÷BTC.

### 2.3 Interface dans `SymbolBanner`

- `÷BTC` : **inchangé**, un clic, même libellé, même contrat.
- À côté, un bouton **scindé** `÷ETH ▾` : le libellé suit la préférence, le clic
  principal bascule (ou détoggle si c'est LUI le ratio actif), le chevron ouvre
  un menu à deux entrées (ETH · SOL) qui change la préférence et applique.
- Chaque bouton est vert (actif) quand `estRatio().denom` vaut son propre
  dénominateur.

**Recomposition depuis un ratio actif** : quand le marché EST déjà un ratio, les
boutons des AUTRES dénominateurs se composent depuis la jambe A du SYN
(`spec.exA` / `spec.legA`) plutôt que depuis le symbole synthétique courant.
Sans ça, passer de ÷SOL à ÷BTC exigerait de détoggler d'abord
(`symboleRatio` refuse la source `synthetic`). Avec, chaque dénominateur est à
un clic.

### 2.4 Persistance

`denominateur: DenominateurId` rejoint `PersistedSession` dans
`store/persist.ts` (instantané `currentSession()`, hydratation validée champ par
champ — valeur inconnue → défaut, jamais de throw — et souscription au store).
**Pas dans `store/workspaces.ts`** : un workspace décrit une vue de graphe, pas
une préférence de barre d'outils.

---

## 3. Vérification

- `data/ratio.test.ts` : les 13 cas de `ratioBtc.test.ts` conservés (ils
  passent avec `denom = "BTC"`) + composition ÷ETH/÷SOL sur les 4 sources +
  refus `base === denom` (SOLUSDT ÷SOL) + refus `quote === denom` +
  `estRatio` identifie le bon dénominateur + refus d'un legB étranger aux refs
  + recomposition depuis un ratio actif.
- `store/denominateur.test.ts` : défaut ETH, `set` valide, valeur persistée
  inconnue → repli sur le défaut.
- `components/IndicatorMenu.test.tsx` (patron `StrategyMenu.test.tsx`) :
  bascule d'onglet, la case macro appelle `macroOverlayStore.toggle`, le badge
  agrège techniques + macros, l'onglet inactif n'est pas dans le DOM.
- `store/persist.test.ts` : aller-retour du champ `denominateur`.
- `pnpm --filter @axiom/web test`, `typecheck`, `build` verts (puis
  `pnpm check`).
- **Gate visuel navigateur** : menu Indicateurs → onglet Macro (3 mesures,
  valeurs peuplées, cases pilotant le pane du graphe), sidebar sans le panneau
  Macro, bandeau avec ÷BTC + ÷ETH ▾, bascules ÷ETH → ÷SOL → ÷BTC en un clic
  chacune, rechargement de page qui conserve le dénominateur choisi.

---

## 4. Ce que ce lot ne fait pas

- Aucune nouvelle source macro (pas de NETLIQ / 2s10s / DXY / FRED libre en
  overlay) — reporté, décision explicite de Zaki.
- Aucun changement de `MacroController`, `macro-overlays.ts`, `symbol.ts`,
  `synthetic.ts`.
- Aucun changement de contrat pour `÷BTC`.
- Pas de recherche libre de dénominateur (PairSearch) : liste courte assumée.
