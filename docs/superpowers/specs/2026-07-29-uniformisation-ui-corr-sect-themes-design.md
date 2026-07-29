# Programme « Terminal cohérent » — uniformisation UI, CORR v2, SECT, thèmes

**Date** : 2026-07-29 · **Statut** : validé par Zaki (4 lots, section par section)
**Organisation retenue** : « Fondations d'abord » — 4 lots séquentiels, chacun mergeable et testé indépendamment.

## Contexte et objectifs

AXIOM compte ~36 fenêtres flottantes. L'audit multi-agents du 2026-07-29 (6 lecteurs) a établi :

- une bibliothèque de primitives `ui.tsx` existe et est bonne, mais l'adoption est inégale :
  5 styles d'inputs, 3 langages de bouton primaire, 4 variantes de tuile KPI, 2 mécanismes
  de tableaux, 4 conventions de « ça charge », 3 conventions d'horodatage ;
- le canal de découverte n° 1 (menu Fonctions) est une liste plate de 36 entrées sans
  recherche ni regroupement, avec un badge « nouveau » porté par 15 entrées (signal mort) ;
- la gestion des fenêtres existe (snap Aero moitiés, mosaïque grille uniforme, workspaces
  nommés commutables) mais reste rudimentaire ;
- CORR est limité à la watchlist active (3×3 par défaut), sans persistance de ses réglages ;
- aucune jointure coin→secteur n'existe (l'onglet Secteurs de MAP est un agrégat inerte) ;
- 5 thèmes dont 4 avec des défauts de lisibilité mesurés (contrastes cités plus bas).

Objectifs : **uniformiser** (mêmes besoins → mêmes composants), **simplifier la
découverte et la gestion des fenêtres**, **conserver toutes les features existantes**,
ajouter **la matrice de corrélation N×N** et **la fenêtre secteurs**, ajouter **4 thèmes**
et corriger la lisibilité des 5 existants **sans toucher à leur identité**.

## Décisions actées (réponses de Zaki)

| Question | Décision |
| --- | --- |
| Frictions prioritaires | Trouver la bonne fenêtre · incohérences entre fenêtres · gestion des fenêtres pénible |
| Corrélations | Matrice N×N interactive (pas de vue « vs références » tradfi) |
| Groupes de cryptos | Fenêtre secteurs dédiée uniquement (pas de filtre screener ni treemap groupée) |
| Nouveaux thèmes | Papier (clair pro) + Void (OLED) + Tokyo (synthwave) + Nord (arctique) |
| Gestion fenêtres | Presets métier + snap magnétique + mosaïque intelligente + pilotage clavier (les 4) |
| Ordre | Lot 1 Socle UI → Lot 2 Navigation & fenêtres → Lot 3 CORR v2 + SECT → Lot 4 Thèmes |

## Hors périmètre (explicitement)

- Vue corrélations « vs références tradfi » (SPX, DXY, or) — non retenue.
- Filtre secteur dans le screener et treemap 2 niveaux dans MAP — non retenus
  (le mapping curé du Lot 3 les rendra possibles plus tard à faible coût).
- Toute suppression ou refonte fonctionnelle d'une fenêtre existante : le programme
  uniformise le contenant, pas le contenu métier.

---

## Lot 1 — Socle UI

### 1.1 Primitives consacrées dans `apps/web/src/components/ui.tsx`

Nouvelles primitives (chacune remplace des variantes locales recensées) :

| Primitive | Remplace | Convention |
| --- | --- | --- |
| `Input`, `Select` | `inputClass` (ScreenerWindow.tsx:99), `inputCls` (PaperWindow.tsx:185), styles ad hoc CORR/CAP/BT/OMON | `rounded-md border border-border bg-bg px-2 py-1 text-[11px]`, focus unique `focus:ring-1 focus:ring-accent focus:border-accent/60` |
| `BoutonPrimaire` | vert bordé (EQS:790), accent plein (BT:1195), accent bordé (CAP:464) | accent bordé `border-accent/60 bg-accent/10 text-accent hover:bg-accent/20` |
| `BoutonSecondaire` | ~10 copies inline de `BTN_SECONDAIRE` | composant (plus seulement une constante de classes) |
| variante `danger` de bouton | « Annuler » dupliqué (EQS:415/782, BT:1187) | `hover:text-down` factorisé |
| `BoutonRafraichir` | ↻/⟳ divergents (CORR:443, CAP:421, RATE:592) | glyphe ↻ + libellé optionnel, TOUJOURS dans le slot actions de l'en-tête |
| `SegmenteCompact` | 5 duplications dans LiquidationsWindow (177, 254, 285, 311, 763) + recopies RATE:291, CHAIN:766 | conteneur `p-0.5`, items `px-1.5 py-0.5 text-[10px]` |
| `TuileStat` | `Metric` (ui.tsx:248), `StatCard` (BT:839), `StatMC` (BT:643), `Widget` (CHAIN:217) | dispositions `inline`/`empilee`, slots sparkline / `BadgeFiabilite` / `Fraicheur` |
| `TableTriable` | grilles triables EQS:825/BT:790/LIQ + `<table>` nus PAPER/RATE/STBL + `SortHeader` dupliqué (EQS:215, BT:753) | colonnes typées (libellé, alignement, format, triable), en-têtes `text-[10px] uppercase tracking-wide text-text-dim`, rangées `text-[11px] tabular-nums` |
| `Chip` | 3 gabarits / 2 glyphes (CORR:469, CAP:539, EQS:648, BT:950) | `px-1.5 py-0.5 text-[10px]`, croix `✕` |
| `BarreProgression` | EQS:436/803 et BT:1208 (bg-up) vs CAP:443 (bg-accent w-64) | piste `bg-bg`, remplissage `bg-accent`, pleine largeur |

`Metric` reste exporté comme alias déprécié de `TuileStat` disposition `inline` le temps de
la migration, puis est supprimé en fin de lot (aucun orphelin).

### 1.2 Structure racine des fenêtres

- **Correction du piège structurel** : le corps rendu par `FloatingWindow` (FloatingWindow.tsx:296)
  devient `flex min-h-0 flex-1 flex-col overflow-y-auto` — `flex-1` des enfants cesse d'être
  inerte, fin des doubles ascenseurs. Les contournements locaux (McapWindow.tsx:432,
  LiquidationsWindow.tsx:995) sont retirés.
- Densité standard du corps : `px-4 py-3`, rythme `space-y-3`, grilles de tuiles `gap-2`.
- Slot actions d'`EnTeteFenetre` : convention stricte — `BarrePeriodes` et/ou
  `BoutonRafraichir` et/ou UNE stat courte. Les contrôles riches (formulaires PAPER,
  sélecteurs conditionnels LIQ) redescendent dans le corps.
- `BarrePeriodes` : placement unique en tête de corps (les 6 fenêtres qui l'utilisent
  s'alignent ; CAP la sort de l'en-tête).
- Titres de section internes : un seul gabarit `h3 text-[10px] uppercase tracking-wide text-text-dim`.

### 1.3 États uniformes

- `Chargement` / `ErreurBloc` / `Vide` / `SansCle` obligatoires. CHAIN abandonne ses blocs
  « indisponible » ad hoc (OnchainWindow.tsx:470, 834, 889), CAP sa copie d'ErreurBloc
  (McapWindow.tsx:479), EQS/BT gardent leurs libellés de phase mais DANS `Chargement`.
- `Fraicheur` partout où une donnée est datée : LIQ, STBL, RATE, EVTS, PAPER la gagnent ;
  CHAIN (fmtAge maison, OnchainWindow.tsx:259) et RATE (« au {date} ») migrent dessus.
- Sémantique des couleurs d'échec : erreur bloquante = `text-down`, avertissement
  non bloquant = `text-warn`. (ScreenerWindow.tsx:367 passe de warn à down.)
- Menus flottants : tout popover maison (AjoutDominance, McapWindow.tsx:293 — sans Échap
  ni clic extérieur) migre sur `MenuDeroulant`.
- Polices canvas d'axes/étiquettes : un seul standard `10px ui-sans-serif` exposé par
  `canvasTokens` (constante partagée), consommé par les 7 fenêtres à canvas divergentes.

### 1.4 Garde-fous

- Tests unitaires de chaque primitive nouvelle (rendu, tri de `TableTriable`, formats).
- **Test de conventions** (`ui-conventions.test.ts`) : échoue si un composant de
  `src/components` redéclare `inputClass`/`inputCls`, rend un `<table>` hors `TableTriable`,
  recopie les classes de `BTN_SECONDAIRE`, ou définit un segmenté maison. Mécanisme : scan
  des sources par motifs (même esprit que le test-gardien des thèmes).
- La suite complète (~2 900 unit + 25 E2E) reste verte ; gate visuel final : passage en
  revue des 36 fenêtres au zoom navigateur (léçon PixelHotel : le rendu réel prime).

### Critères de succès (Lot 1)

1. `grep` des motifs interdits vide (le test de conventions le prouve en CI).
2. Aucune fenêtre ne présente de double ascenseur (E2E de structure sur 6 fenêtres témoins).
3. Zéro régression fonctionnelle : suites unit + E2E vertes.

---

## Lot 2 — Navigation & gestion de fenêtres

### 2.1 Registre unique enrichi

`WINDOW_REGISTRY` (windowManager.ts:46-85) gagne un champ `categorie` :
`marche` (graphe, watchlist, replay, screener) · `derives` (DES, FUNDX, LIQ, OMON, TERM, DOM, SQZ, CBPREM) ·
`macro` (ECO, RATE, COT, NETLIQ, GLOBE, EVTS, CAP, BRIEF) · `onchain` (CHAIN, STBL, MINE, CYCLE) ·
`risque` (CORR, DIST, SCEN, VOL, SEAG, MAP, SECT au Lot 3) · `portefeuille` (PORT, PAPER, EXPY, NOTE) ·
`outils` (NEWS, FUND, BT, DATA, TICKER).

`windowPanels.ts` **dérive** ses commandes du registre (id, mnémonique, libellé, catégorie) —
fin de la triple maintenance constatée (ex. CAP déclaré aux deux endroits). Les panneaux à
comportement spécial (MAP/IMAP) déclarent leur exception au même endroit.

### 2.2 Menu Fonctions v2 (Toolbar.tsx:175-221)

- Champ de recherche en tête (filtre titre + mnémonique, insensible aux accents),
  navigation clavier roving — même patron qu'`IndicatorMenu`.
- Groupes repliables par `categorie` (état de pli persisté), tri alphabétique intra-groupe.
- Indicateur « ● ouverte » sur les fenêtres déjà ouvertes ; colonne mnémonique élargie
  (CBPREM/NETLIQ/REPLAY tronqués aujourd'hui, Toolbar.tsx:210).
- Badge « nouveau » : purge générale — réservé aux fenêtres livrées dans le lot courant.

### 2.3 Unification des canaux et pièges

- Menu ET palette : « ouvrir ou mettre au premier plan » (`openWindow`) ; plus aucun canal
  ne ferme silencieusement (windowPanels.ts:17 quitte `toggleWindow`). Fermeture = croix,
  taskbar, `WCLOSE`.
- **Piège 1M** : `1M` = mois dans TOUS les canaux (la palette mappe `1M`→mois, `1MIN`→minute,
  `MO` reste accepté ; registry.ts:122-128 et 378-383).
- **Collision Liq** : le bouton Toolbar « Liq » (heatmap chart) est renommé « Heat »
  (title explicite « Heatmap de liquidations sur le graphe ») ; la fenêtre garde LIQ.
- FUND / FUNDX : libellés de menu explicités (« Fiche société (actions) » /
  « Funding perp cross-exchange ») ; la recherche affiche les deux avec leurs libellés.
- Doublon MAP/IMAP en palette : une seule entrée visible (alias conservé en matching).
- Gardes d'indisponibilité alignées : bouton grisé, hotkey → toast, palette → toast
  (même prédicat partagé pour les trois canaux ; registry.ts:502-527, hotkeys.ts:323-345).
- Aide raccourcis : les mnémoniques s'affichent PAR catégorie avec libellés (fin de la
  ligne unique de ~40 codes, hotkeys.ts:115-129).

### 2.4 Gestion des fenêtres

- **Snap enrichi** (windowManager, zones du drag ; SnapOverlay inchangé en rendu) :
  coins = quarts · bords latéraux = moitiés · bord haut = maximiser. Aimantation aux bords
  des AUTRES fenêtres à ~8 px pendant drag et resize (avec seuil de relâche).
- **Mosaïque intelligente** : `tileOpenWindows` (windowManager.ts:748) pondère les cellules
  par les ratios `defaultWidth/defaultHeight` du registre (le chart et les grandes fenêtres
  gardent leur prépondérance) ; algorithme pur et testé dans le même module que
  `grilleMosaique`, qui reste le repli à N élevé.
- **Pilotage clavier** : ancrer moitié gauche/droite, quart, maximiser/restaurer, cycler le
  focus des fenêtres ouvertes (avant/arrière), réduire. Proposition par défaut (style
  Rectangle, plage ⌃⌥ peu utilisée par macOS/navigateur) : `⌃⌥←/→` moitiés, `⌃⌥↑`
  maximiser, `⌃⌥↓` restaurer/réduire, `⌃⌥U/I/J/K` quarts, `⌃⌥Tab`/`⌃⌥⇧Tab` cycle.
  Bindings par `event.code` (AZERTY-safe, comme hotkeys.ts existant) ; validés contre les
  conflits réels au plan d'implémentation, et documentés dans l'aide `?`.
- **Presets métier livrés** (workspaces d'usine, duplicables, non destructibles) :
  - *Desk dérivés* : chart + LIQ + FUNDX + OMON + DOM
  - *Macro* : RATE + ECO + NETLIQ + CAP + BRIEF
  - *On-chain* : CHAIN + STBL + MINE + CYCLE
  - *Risque* : DIST + SCEN + CORR + PORT
  Géométries définies via la mosaïque intelligente sur un viewport de référence puis
  adaptées au viewport courant (les workspaces stockent déjà `EtatFenetre`).
- Le `window.prompt("Nom du workspace :")` (Toolbar.tsx:73) est remplacé par un petit
  formulaire dans un `MenuDeroulant` (input + valider/annuler).

### Critères de succès (Lot 2)

1. Ouvrir n'importe quelle fenêtre en ≤ 3 gestes depuis le menu (recherche incluse) — E2E.
2. La même commande a le même effet via menu, palette et hotkey — tests unitaires sur le
   prédicat partagé + E2E open/focus.
3. Presets : E2E « appliquer Desk dérivés → 5 fenêtres ouvertes, aucune superposée ».
4. Mosaïque : propriété testée — aucune intersection, aires ∝ priorités, viewport couvert.

---

## Lot 3 — CORR v2 + fenêtre SECT

### 3.1 CORR v2 (CorrWindow.tsx, data/corr.ts)

- **Univers** : segmenté `Watchlist | Top 10 | Top 20 | Top 30`. Le top N par capitalisation
  vient des tuiles CoinGecko déjà chargées (`mcapStore.marches` / overview, top 250 en cache
  5 min) ; conversion ticker→paire via `toBinanceUsdtPair` ; stablecoins exclus de
  l'univers top-N via une liste d'exclusion locale dans `data/corr.ts` (USDT, USDC, DAI,
  USDe, FDUSD… — corréler USDT à USDC n'apporte rien). Un membre sans paire Binance ou en
  échec de chargement apparaît en **chip d'erreur** sous la matrice (plus de cellule vide
  silencieuse) ; les extras tapés à la main restent possibles et sont **persistés**.
- **Fenêtres** : `7j | 30j | 90j | 180j` (7 j ajouté ; `MAX_JOURS=260` inchangé).
- **Tri de la matrice** : `Watchlist` (ordre actuel) / `Alphabétique` / `Similarité` —
  ordonnancement glouton par corrélation moyenne (plus proche voisin depuis l'actif le plus
  corrélé au reste) : fait apparaître les blocs sans dépendance nouvelle ; fonction pure
  testée dans `data/corr.ts`.
- **Sparkline du détail** : fenêtre glissante = fenêtre sélectionnée de la matrice
  (fix du 30 j figé, CorrWindow.tsx:287-346) ; libellé de la fenêtre affiché dans le détail.
- **Onglet « Paires »** : liste `TableTriable` de toutes les paires (hors diagonale),
  triable par r, colonnes r / n / badge fiabilité (n < 20 = faible) ; raccourcis
  « 10 plus corrélées / 10 moins corrélées ».
- **Persistance** : `corrUiStore` persisté (`axiom:corr:v1`) — méthode, fenêtre, univers,
  extras, tri, onglet. Le cache séries reste en session.
- Le tooltip maison de la matrice reste (grille dense ≠ courbe temporelle → `InfobulleGraphe`
  inadapté) mais adopte le style visuel de l'infobulle partagée.

### 3.2 SECT — fenêtre secteurs (nouvelle)

- **Registre** : `{ id: "sect", title: "Secteurs crypto", mnemonic: "SECT",
  defaultWidth: 640, defaultHeight: 640, categorie: "risque", nouveau: true }`.
- **Mapping curé** `src/data/secteurs.ts` : ~10 groupes × 10-20 membres —
  L1 majors · Éco Ethereum (L2, LSD, DeFi ETH) · Éco Solana · RWA · IA · Memes ·
  Paiements · Exchange tokens · Gaming/Metaverse · Privacy. Par membre : id CoinGecko +
  ticker + paire Binance éventuelle (même patron que `TOKEN_TO_PROTOCOL`,
  protocolRevenue.ts). Un coin peut appartenir à plusieurs groupes (LINK : RWA ET oracle
  de l'éco ETH) — assumé et documenté dans le module.
- **Données** : réutilise le fetch `/coins/markets` top 250 **déjà budgété et caché 5 min**
  (marketOverview), en y ajoutant `price_change_percentage=24h,7d,30d` (même endpoint,
  zéro requête supplémentaire — le budget strict de 3 req/refresh est inchangé).
  Agrégats par groupe : perf pondérée par capitalisation, cap totale, nb de membres
  couverts / total. Membre hors top 250 = non couvert, compté et affiché (« 12/15
  membres ») — pas d'appel supplémentaire pour les traînards.
- **UI** : `TableTriable` des groupes (nom, perf 1j/7j/30j colorées up/down, cap totale,
  membres) → clic = drill-down membres (perf, cap, poids dans le groupe ; clic sur un
  membre coté Binance → ouvre la paire sur le chart, comme MAP). `Fraicheur` +
  `NoteSource` CoinGecko. États `Chargement`/`ErreurBloc`/repli cache périmé hérités du
  pipeline marketOverview.

### Critères de succès (Lot 3)

1. CORR : matrice 20×20 depuis « Top 20 » sans saisie manuelle ; réglages retrouvés après
   fermeture/réouverture (E2E). Tri par similarité testé sur cas synthétique (2 blocs → 2 blocs contigus).
2. SECT : perfs de groupe = moyenne pondérée vérifiée sur fixture ; drill-down et
   ouverture de paire E2E ; aucun appel réseau au-delà du budget existant (assertion sur
   le compteur de requêtes du module en test).

---

## Lot 4 — Thèmes

### 4.1 Corrections de lisibilité des 5 existants

Uniquement des ajustements de valeurs dans `index.css` (aucun changement d'architecture).
Contraintes chiffrées mesurées par l'audit → cibles :

| Thème | Problème mesuré | Correction (identité préservée) |
| --- | --- | --- |
| bloomberg | hausse #ffc400 ≈ texte #ffb000 ; grille 1.18:1, bordures 1.10:1 ; --ui-emerald=--text=--crosshair=--serie-1 | hausse → ~#ffd75e ; crosshair → ~#ffe9a3 ; grille/bordures remontées d'un cran ; serie-1 découplée du texte |
| matrix | up #5bff8f / down #019e34 = 2 verts (luminance seule) ; 4 séries sur 6 quasi identiques | écart up/down creusé (up clair plein / down sombre distinct) ; séries ré-étagées ; crosshair ~#aaffc0 |
| cute | bougies pastel < 3:1 (#20bfa0 = 2.18:1) ; accent #d946ef illisible en texte (3.24:1) | bougies → ~#0f9c81 / ~#f43f6b (≥ 3:1) ; #d946ef réservé aux aplats, variante texte assombrie |
| aurora | --serie-6 == --down et --serie-1 == --up (fausses lectures sémantiques) | serie-1 → ~#67e8f9, serie-6 → ~#fbbf24 (non sémantiques) ; crosshair neutralisé |
| tous | n-500 < 4.5:1 en texte dans 3 thèmes, n-600 partout (2.53–3.84) | n-500/600 remontés là où c'est du texte, ou usages `text-neutral-500/600` migrés vers text-dim |

Corrections d'infrastructure associées :
- `--crosshair` ajouté à `TOKENS_REQUIS` (themeTokens.test.ts:76-95 — aujourd'hui seul le
  jumeau RGB est gardé, ChartInstance.tsx:189 replierait sur chaîne vide) ;
- `REPLIS_SERIE` (canvasTokens.ts:39) : deux jeux de replis, sombre et clair, choisis selon
  le thème actif (les replis actuels sont les hex du dark — faux sur cute/papier) ;
- pastille cute du ThemeSwitcher resynchronisée (#ffd6ee n'existe dans aucune palette,
  ThemeSwitcher.tsx:25) ; le commentaire « à garder synchronisé » devient une dérivation
  (les pastilles lisent les variables du thème) ;
- sémantique `warn` : chaque thème doit fournir un `--ui-amber` perçu comme avertissement
  (le rose cute / vert-jaune matrix sont recalés dans la gamme du thème).

### 4.2 Quatre nouveaux thèmes

`THEMES` (theme.ts:15) passe à
`["dark", "papier", "void", "tokyo", "nord", "bloomberg", "matrix", "cute", "aurora"]`
(ordre du sélecteur : sobres d'abord, fantaisie ensuite). Chaque thème = jeu complet
(~69 variables + 31 jumeaux `--*-rgb`) validé par le test-gardien étendu.

| Thème | Identité | Ancres |
| --- | --- | --- |
| papier | clair professionnel « papier journal financier » | fond ivoire #faf7f0, encre #1c1917, up/down verts/rouges profonds imprimables, accent bleu encre, grille gris chaud discret |
| void | noir OLED haute densité | fond #000000, surfaces #0a0a0a, texte #e8e8e8, up/down saturés froids, accent cyan glacial, bordures nettes fines |
| tokyo | synthwave bleu nuit | fond #1a1b26, texte #c0caf5, accents néon violet #bb9af7 / cyan #7dcfff, up/down adaptés (vert d'eau / rose néon) |
| nord | arctique apaisé | palette Nord : fond #2e3440, texte #eceff4, up #a3be8c, down #bf616e, accent #88c0d0, séries dans la gamme frost/aurora |

Contraintes communes : texte ≥ 4.5:1 sur surface, éléments graphiques (bougies, séries,
grille utile) ≥ 3:1, up/down discernables autrement que par la seule luminance, aucune
série égale à up/down, `--candle-up/down` distincts de `--up/--down` si besoin d'ajustement
canvas (mécanisme existant).

Le `ThemeSwitcher` passe de la rangée de pastilles à un `MenuDeroulant` (9 entrées :
pastille + nom + mini aperçu up/down), pour ne pas surcharger le SettingsPanel.

### Critères de succès (Lot 4)

1. Test-gardien étendu vert : 9 thèmes × (18 tokens + `--crosshair` + 31 jumeaux RGB).
2. Test de contraste automatisé : pour chaque thème, ratios calculés depuis `index.css`
   (texte/surface ≥ 4.5, candle/bg ≥ 3, up≠down au-delà de la luminance seule via ΔE ou
   écart de teinte) — le test encode les exceptions d'identité assumées s'il y en a.
3. Gate visuel : capture chart + 3 fenêtres denses (LIQ, EQS, CAP) dans les 9 thèmes,
   passage en revue au zoom navigateur.

---

## Risques et gotchas connus (à respecter dans les plans)

- **CoinGecko** : budget strict 3 req/refresh (marketOverview.ts:13), plafond keyless
  ~5 req/min ; un 429 arrive au navigateur en **erreur CORS illisible** — toute extension
  passe par le cache 5 min existant. SECT n'ajoute AUCUN appel.
- **Clé Coinalyze localStorage** peut primer sur `.env` (gotcha Lot B) — sans impact ici,
  mais ne pas « nettoyer » ce comportement au passage.
- **paperStore** réécrit les positions à chaque tick → abonnements par signature stable
  obligatoires (gotcha Lot v2.0) — vigilance lors de la migration UI de PAPER.
- **Fermeture = démontage** (FloatingWindow ne monte que si `open && !minimized`) : tout
  état à conserver vit dans un store persisté, jamais en `useState` (leçon CORR actuelle).
- Migration de 36 fenêtres = gros diff mécanique : lot découpé en vagues committées par
  familles de fenêtres, suite de tests verte à chaque vague (modifications chirurgicales,
  pas d'« améliorations » opportunistes du code métier traversé).
- `SidebarSection` persiste le pli par TITRE et `focusPanneauSidebar` matche le texte
  d'en-tête : tout renommage FR doit mettre à jour ces deux points (registry.ts:319,
  SidebarSection.tsx:55).

## Stratégie de test globale

TDD par lot (leçons AXIOM : fonctions pures testées, composants gardés par E2E ciblés).
Chaque lot livre : unit tests des nouveaux modules purs, extension du test de conventions,
E2E Playwright pour les parcours nouveaux, suite complète verte avant merge (~2 905 unit +
25 E2E au départ), gate visuel navigateur en fin de lot. Un lot = une branche
`feat/coherent-lotN-*` mergée dans `main` après revue.
