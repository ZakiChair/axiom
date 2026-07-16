# Lot A — Fondations durcies + conformité — design

Date : 2026-07-16. Base : revue UI v2 (`docs/superpowers/audits/2026-07-16-revue-ui-v2.md`,
125 findings dont 17 haute CONFIRMÉ + annexe complète). Aucune feature nouvelle : correctifs
systémiques, réalignement sur le standard du 2026-07-09, et garde-fous automatiques anti-dérive.
Les lots B (lecture interprétée) et C (features) s'appuient sur ce socle.

## 1. Problème

Le standard consacré le 9 juillet (spec `2026-07-09-uniformisation-ui-features-design.md` §2 +
fondations `lib/format` / `ui.tsx` / `canvasTokens` / `--serie-1…6`) tient sur le périmètre migré,
mais tout ce qui a été construit ensuite a re-divergé, faute de garde-fou automatique. Trois
défauts systémiques dominent :

1. **Les modificateurs d'opacité Tailwind sur tokens sont des no-op.** Les couleurs sont
   déclarées `var(--…)` sans `<alpha-value>` dans `tailwind.config.js` : `bg-accent/15`,
   `border-down/40`, `bg-surface/80`… (15+ fichiers, dont `ErreurBloc`/`BadgeFiabilite` du module
   standard) ne génèrent aucune règle CSS. Vécu : sélection ⌘K invisible, SymbolBanner
   transparent, bordures d'erreur absentes. Le standard §2 prescrit lui-même `border-down/40`.
2. **Le chart a échappé aux tokens.** ~98 indicateurs enregistrés sans `styles` (palette
   klinecharts identique sur les 5 thèmes) ; toutes les séries post-lot en hex figés
   (`derivatives.ts`, `macro.ts`, `revenue.ts`, `ecoMarkers.ts`, `compare.ts`, `navigation.ts`) ;
   lecteur de tokens re-dupliqué dans 6 fichiers de `chart/` ; teinte des niveaux liq ESTIMÉS
   indiscernable de la rampe réelle sur Bloomberg.
3. **Formats et conventions re-fragmentés.** Panes OI/macro/CVD sans `shouldFormatBigNumber`
   (« 2,293,577,001,928.3072 » à l'écran) ; funding en 3 implémentations ; fraîcheur en
   4 variantes ; états actifs `bg-surface` invisibles sur corps `bg-surface` ; boutons/onglets
   recopiés à la main.

S'y ajoutent des pièges d'ergonomie confirmés : palette ⌘K qui bascule la paire globale
silencieusement (`DERIV` → DERIVUSDT vécu en session), collision de mnémonique FUND, aide « ? »
périmée et maintenue à la main, sémantique workspace divergente avant/après reload, raccourcis
chiffres cassés sur AZERTY, `toggleWindow` qui ferme une fenêtre minimisée.

## 2. A1 — Support alpha des tokens

- `apps/web/src/index.css` : chaque thème définit, pour chaque token couleur consommé par
  Tailwind (`--bg`, `--surface`, `--border`, `--text`, `--text-dim`, `--accent`, `--up`,
  `--down`, `--serie-1…6`, nouveau `--warn`), son triplet `--*-rgb: R G B`.
- `tailwind.config.js` : couleurs déclarées `"rgb(var(--x-rgb) / <alpha-value>)"`. Les classes
  pleines ET les variantes `/NN` fonctionnent ; les `var(--x)` directs (canvas, CSS inline)
  sont conservés tels quels.
- Garde-fou thèmes existant étendu : chaque skin doit définir tous les `--*-rgb` (test).
- `CommandPalette.tsx` : la sélection redevient visible mécaniquement ; ajouter au passage
  `role="listbox"`/`role="option"` + `aria-activedescendant`.
- Amender la spec 2026-07-09 §2 : les classes `/NN` sur tokens sont légitimes (documenter le
  mécanisme `--*-rgb`).

## 3. A2 — Le chart repasse sous les tokens

- `lib/canvasTokens.ts` : nouveau `serieCanvas(i, repli)` (lit `--serie-((i%6)+1)`). Les
  lecteurs locaux dupliqués de `chart/` (orderflow, liquidationHeat, etc. — 6 fichiers) migrent
  sur `canvasTokens`, replis unifiés par token.
- `chart/indicators.ts` (`ensureRegistered`) : chaque output des ~98 indicateurs reçoit
  `styles: () => ({ color: serieCanvas(i, repli) })` — pattern réévalué au rendu prouvé par
  `orderflow.ts:154`. Pas de re-registration au changement de thème.
- Migration hex → tokens : `derivatives.ts` (OI → `--serie-5`, funding → `--serie-3`),
  `macro.ts` (3 séries ; « Stablecoins » ne doit plus réutiliser la teinte de `--up`),
  `revenue.ts`, `ecoMarkers.ts` (couleur via `extendData`/rappel au redraw), `store/compare.ts`
  (palette → `--serie-1…6`), `commands/navigation.ts` (cyan → `--accent`).
  Côté fenêtres, le lien bouton↔courbe passe par les classes `text-serie-N` (suppression des
  constantes de couleur exportées : `OI_COLOR`, `FUNDING_COLOR`, `ECO_COLOR`…).
- `chart/liquidationHeat.ts` : `rampePourTheme` étendue d'une « teinte EST » par thème, choisie
  pour contraster avec la rampe réelle (Bloomberg → bleu clair, Matrix → orange, défaut →
  orange actuel), résolue 1×/frame dans `Tokens` comme `upRgb`/`downRgb`, repli RVB.
- `chart/orderflow.ts` : la ligne CVD s'aligne sur son jumeau CVD S/P (styles token-aware).

## 4. A3 — Formats numériques

- Panes chart : `precision: 0` + `shouldFormatBigNumber: true` sur l'indicateur OI
  (`derivatives.ts`) et `AXIOM_MACRO` (`macro.ts`), même mécanique que `revenue.ts` ; précision
  du CVD ramenée à 0. Le funding reste en précision 4 (standard).
- `lib/format.ts` (+ tests) : promotion de `formatFunding(rate)` et `formatUsdSigne(v)` ;
  suppression des 3 copies (`data/brief.ts:292`, `BriefWindow.tsx:112`,
  `DerivativesWindow.tsx:77`) et du formateur adaptatif local de `chart/priceAlertMenu.ts`
  (→ `formatPrice`).
- `FundingMatrixWindow.tsx` : funding → `formatPct(x, 4)`, APR/spread → `formatPct(x, 2)`
  (signé, % collé) ; `TermStructureWindow` basis aligné sur la même convention.
- DVOL unifié sur `formatPourcentage(x, 1)` (OptionsWindow s'aligne sur VolWindow).
- `ui.tsx` : primitive `<Fraicheur loading majTs cadence>` — « maj… » en chargement,
  « maj il y a X » (`formatAge`) si timestamp connu, sinon « maj ~cadence ». Adoptée par
  Options, TermStructure, MarketMap (garder « · cache »), Corr, Derivatives, et ajoutée à
  FundingMatrix. Amender la spec 2026-07-09 §2 (la forme « maj il y a X » devient canonique
  quand le timestamp existe).

## 5. A4 — Primitives & conformité fenêtres

- `ui.tsx` :
  - `MenuDeroulant` : neutral-* → tokens (`border-border bg-surface text-text/text-dim`) ;
    si la Toolbar veut rester en chrome neutre, elle passe une classe via prop.
    Adoption par le menu ⚙ de `Watchlist` (Échap, clic extérieur, flèches — comportements de
    la primitive).
  - Nouvelle primitive `Segmente` (groupe segmenté : conteneur `border border-border`, actif
    `bg-bg text-text`) — adoptée par CorrWindow (2 groupes) et OptionsWindow (5 groupes).
  - `Metric` : slot `labelExtra` (accueille le `BadgeFiabilite` de DERIV) ; suppression du
    `Metric` local de `DerivativesWindow`.
  - `EnTeteFenetre` : prop `mnemo` — rendu uniforme « MNEMO · Libellé » (décision : convention
    consacrée, style terminal). Toutes les fenêtres passent leur mnémonique ; CORR/EQS retirent
    le préfixe manuel de leur titre.
- Nouveau token sémantique `--warn` (+`--warn-rgb`) par thème ; remplace `amber-500` en dur
  (HealthPanel, ReplayWindow, `TONS_FIABILITE.partiel` de ui.tsx, SessionStrip…) ; l'état
  « daemon absent » de ReplayWindow passe par le pattern `Vide`+Badge de LIQ.
- Couleurs brutes restantes : `bg-violet-500` (toggle Liq Toolbar) → `bg-accent` (comme les
  autres toggles actifs de la Toolbar) ; `text-sky-400` (mnémoniques Playbooks) → `text-accent` ; `accent-emerald-500`
  (MacroPanel) → `accent-accent` (pattern ReplayWindow) ; `META_SOURCE` dupliqué
  (TickerBand/NewsWindow) consolidé en module partagé, hex gdelt → token série.
- États actifs `bg-surface` → `bg-bg` : MacroRatesWindow (bascule + chips), OnchainWindow
  (bascule ETF), NewsWindow (filtre #SYMBOLE).
- `Taskbar` : boutons « Tout restaurer »/« Mosaïque » sur `BTN_SECONDAIRE` ; `DomWindow` :
  rangée d'onglets → primitive `Onglets` ; `MarketMapWindow` : en-tête → `EnTeteFenetre`.
- `LiquidationsWindow` : un `EnTeteFenetre` unique (sous-titre variable selon l'onglet) puis
  `<Onglets>` en dessous, actions spécifiques dans `actions` — comme StablecoinsWindow ; le
  feed Live affiche la fenêtre temporelle du sélecteur (libellé « 60 derniers événements »
  explicite).
- `StablecoinsWindow` : bouton « Réessayer » du bloc d'erreur retiré (standard §2 : erreur
  textuelle sans retry).
- Canvas divers : `CourbeTaux.tsx` — `ctx.font` avec `var()` non résolu → police résolue via
  `getComputedStyle` ; `BacktestWindow` — alpha concaténé (`colDown + "33"`) → `globalAlpha`
  ou teinte `--*-rgb` ; `volumeRangeOverlay.ts` — opacité des barres VPFR alignée sur le VPVR
  (~0.55) pour ne plus masquer les bougies ; `GlobeWindow` — la substitution serie-5/serie-4
  par thème remonte dans les tokens d'`index.css`.

## 6. A5 — Palette & mnémoniques

- `CommandPalette` : les correspondances « paire » sont rendues dans une section distincte,
  libellées explicitement (« Changer la paire → DERIVUSDT ») ; jamais exécutées implicitement
  quand la saisie matche aussi un mnémonique de commande (la commande gagne, le symbole reste
  visible en dessous). Tout changement de paire déclenché depuis la palette émet un toast avec
  action « Annuler » (retour à la paire précédente).
- Collision `FUND` : le sous-pane funding du chart (`store/derivatives-chart.ts`) prend un
  nouveau mnémonique (proposition : `FRATE`), « funding » reste dans ses `motsCles` ; la
  fenêtre Fiche société garde `FUND`.
- Timeframes : mnémoniques `1m` (minute) vs `1M` (mois) désambiguïsés dans la palette
  (libellés « 1 minute » / « 1 mois » + mnémoniques distincts).
- Aide « ? » (`commands/hotkeys.ts`) : la liste des mnémoniques est dérivée du registre réel
  (`construireRegistre()` + commandes externes), rendue en plusieurs lignes groupées par
  catégorie. La chaîne maintenue à la main disparaît.

## 7. A6 — Fenêtres & workspaces

- `store/workspaces.ts` : sémantique unique — `open`/`minimized` sont persistés dans le
  snapshot et restaurés à l'`apply()`, y compris après reload (adaptation de
  `validateWindowGeometry` : elle plafonne la géométrie mais ne force plus `open:false` pour
  les fenêtres d'un workspace appliqué). La doc lignes 65-67 est mise à jour.
- `store/persist.ts` : l'état ouvert/minimisé des fenêtres survit au reload (même mécanique).
- `store/windowManager.ts` : `toggleWindow` sur une fenêtre ouverte-mais-minimisée la
  restaure (au lieu de la fermer) ; taille par défaut de première ouverture plafonnée au
  workspace courant.
- `Taskbar.tsx` : passage à la ligne (`flex-wrap`) au-delà de la largeur disponible ;
  actions au survol accessibles au clavier (plus de `hidden group-hover:flex` seul).
- `commands/hotkeys.ts` : raccourcis chiffres via `e.code` (`Digit1…9`) — AZERTY réparé ;
  touches O/L/R non supportées par la source active → toast explicatif (au lieu du silence).
- Sécurité de saisie : pattern de suppression destructive unifié sur le double-clic armé
  d'AlertsPanel (PortfolioWindow : ✕ d'une position ouverte) ; les formulaires
  Portfolio/Alerts signalent une saisie invalide (bordure `--down` + message court) au lieu
  d'ignorer le clic.

## 8. A7 — Garde-fous anti-dérive (tests ajoutés à la gate)

1. **Anti-hex de série dans `chart/`** : grep-test interdisant `#hex`/`rgb(` dans les modules
   de séries, avec liste d'exceptions documentée (rampes theme-aware de `liquidationHeat.ts`,
   replis RVB explicitement marqués `/* repli */`).
2. **Mnémoniques uniques** : test dans `registry.test.ts` sur le registre complet (commandes,
   panneaux, actions, indicateurs).
3. **Aide ⊇ registre** : chaque mnémonique du registre apparaît dans l'aide « ? » (trivial une
   fois l'aide dérivée du registre — le test fige le contrat).
4. **Tokens complets** : le garde-fou thèmes exige `--*-rgb` pour chaque token couleur, sur
   les 5 skins, `--warn` inclus.
5. **Anti-classes Tailwind brutes** : test scannant `components/` et `chart/` pour
   `(neutral|amber|emerald|violet|sky|cyan|pink)-[0-9]{3}` hors allowlist explicite (chrome
   Toolbar si conservé).

## 9. Vérification

`pnpm -r test` + `pnpm -r typecheck` + `pnpm --filter @axiom/web build` (gate BUILD-CONTRACT)
verts ; mise à jour des tests figés (HealthPanel.test.ts, windowManager.test.ts,
workspaces.test.ts, hotkeys.test.ts) ; contrôle visuel sur les 5 thèmes : sélection ⌘K,
SymbolBanner, ErreurBloc, heatmap+EST sur Bloomberg, MenuDeroulant sur cute, indicateurs
multi-séries sur matrix. Revue adversariale des diffs.

## 10. Hors périmètre

- Percentiles/zones/score de régime, chapeau BRIEF (→ Lot B, spec séparée).
- Features CVDX/DELTAMAP/JRNL-CHART/FOCUS/WS-KEYS/SNAP… (→ Lot C).
- Refonte du menu Indicateurs (navigation clavier/favoris) et garde d'empilement
  footprint×heatmap : documentés dans la revue, traités avec le Lot B (lisibilité chart).
- Les findings « basse » de la revue non listés ici : backlog.
