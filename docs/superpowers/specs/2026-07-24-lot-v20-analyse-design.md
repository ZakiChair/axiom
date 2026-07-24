# Lot v2.0 — Analyse (÷BTC, EVTS, SCEN, indicateurs & outils)

Date : 2026-07-24 · Origine : brainstorming features avec Zaki (ratio vs BTC +
AT, event study, stress-test, extension du catalogue d'analyse).

Invariants BUILD-CONTRACT habituels : renderer-first, indicateurs TS pur +
golden tests, dégradation gracieuse (jamais de vide muet), FR, `pnpm check`
vert par branche. Toute NOUVELLE fenêtre : pattern DerivativesWindow (non
modal, translatée hors écran), mnémonique + CommandPalette + **menu Fonctions
de la Toolbar (liste en dur — ne pas oublier)**. Zéro source de données
nouvelle : les 4 chantiers recombinent des flux déjà câblés.

Ordre de merge suggéré : C1 → C4 → C2 → C3 (indépendants, parallélisables).

## C1. « ÷BTC » en un clic (branche `feat/ratio-un-clic`) — S

Le moteur SYN (`data/synthetic.ts`) compose déjà des ratios live cross-exchange
et l'AT complète marche dessus. Il manque la découvrabilité :

- Bouton toggle `÷BTC` dans le SymbolBanner (chart maître). Actif : symbole
  courant `XUSDT`/`XUSD` (crypto, hors BTC) → bascule vers
  `<source>:X…|/|<source>:BTC…` (jambe B = quote BTC de la MÊME source ;
  Twelve Data exclu). Re-clic : retour au symbole précédent (mémorisé).
- Désactivé (avec title explicatif) si : symbole déjà synthétique, symbole
  = BTC, ou source sans paire BTC de référence.
- Presets « vs BTC » ajoutés à `SYNTHETIC_PRESETS` (ETH, SOL, + 2-3 majors).
- Convention volume=0 des SYN inchangée (indicateurs volume et orderflow
  inertes sur ratio, comme documenté) — hors périmètre de ce lot.

Tests : helper pur `symboleRatioBtc(symbol, source) → string | null`
(mapping + cas refusés) ; le bouton suit le patron toggle existant sans test
DOM.

## C2. EVTS — event study (branche `feat/evts-event-study`) — M

Fenêtre EVTS, mécanique sœur de SeasonalityWindow : « que fait le prix autour
de cet événement ? »

- Entrées : type d'événement (CPI US, FOMC, NFP — extensible), symbole
  (défaut = chart maître), fenêtre ±N barres (TF horaire/journalier), N
  derniers événements (défaut 12).
- Rendu : courbes alignées base 100 à H-0 (spaghetti discrètes + médiane
  épaisse + bande p25–p75), stats pré/post (perf médiane, vol réalisée,
  min/max), liste des occurrences (date, actuel vs prévu quand connu).
- Dates historiques : **listes statiques curées** dans
  `data/macro/eventDates.ts` (timestamps UTC de publication, 2020→présent),
  enrichies au fil de l'eau par le cache ECO (append des événements passés
  correspondants, dédupliqué). Choix assumé vs persistance daemon :
  déterministe, testable, offline-friendly (cohérent avec le fallback FOMC
  statique existant).
- Klines : adaptateurs existants (REST backfill), cache session comme CORR.
- Chart maître : le marqueur du PROCHAIN événement (contrôleur `ecoMarkers`
  existant) gagne un title enrichi « médiane ±24 h sur N derniers » quand
  EVTS a des stats pour ce type.
- Dégradation : source klines en panne → occurrences absentes listées comme
  telles ; jamais de moyenne calculée sur un échantillon différent de celui
  affiché.

Tests : purs — alignement/normalisation des fenêtres, médiane/percentiles,
fusion listes statiques + cache ECO (dédup). Rendu canvas sans test DOM.

## C3. SCEN — stress-test scénarios (branche `feat/scen-stress-test`) — M

Fenêtre SCEN : impact prospectif de chocs de facteurs sur le portefeuille
(complément prospectif de la VaR historique DIST).

- Positions : paper + portefeuille (stores existants), par symbole.
- Facteurs : BTC, ETH, DXY, SPX (proxy ETF Twelve Data), OR. Betas roulants
  90 j calculés sur klines 1d — même chemin de données et cache session que
  CORR, zéro source nouvelle.
- UI : sliders de chocs par facteur (−50 %…+50 %), table P&L estimé par
  position + total NETLIQ, jauge vs VaR95 de DIST quand disponible. Chaque
  position est rattachée à UN facteur de référence (crypto → BTC, sauf ETH
  → ETH ; tradfi → SPX/DXY/OR selon la classe) : P&L = beta × choc de ce
  facteur — pas de somme multi-facteurs (double comptage de la colinéarité).
- Presets : « Krach crypto −30 % », « Choc taux (DXY +3 %) », « Risk-on ».
- Modèle assumé : betas simples par facteur, PAS de régression multiple —
  la colinéarité est ignorée et DITE (mention permanente « approximation
  1-facteur, ordres de grandeur »). YAGNI documenté.
- Dégradation : beta incalculable (historique trop court, source en panne)
  → position listée « beta indisponible », exclue du total (compte affiché).

Tests : purs — beta roulant (fixtures), P&L scénario, agrégation avec
positions exclues. Mnémonique SCEN + palette + menu Toolbar.

## C4. Indicateurs & outils (branche `feat/indicateurs-outils`) — M

⚠️ Le catalogue est en avance sur la roadmap (`cvdSpotPerp`, `fundingZScore`,
`anchored-vwap`, catégorie derivatives complète : déjà livrés). Étape 0 du
chantier : **audit d'inventaire** des dettes § indicateurs de
`docs/research/03` — ne livrer que ce qui manque réellement.

### 4a. Dettes réelles restantes (sous réserve d'audit)
- Ancrage AVWAP **par clic** sur le chart (l'indicateur ancré par timestamp
  existe ; il manque l'interaction clic → param).
- Pivots sessionnés + VWAP à reset de session (les 2 simplifications MVP
  documentées).
- Input `source` câblé dans `engine.ts` (RSI sur hlc3…, déjà déclaré dans
  les types).
- Refresh intra-bougie throttlé (250 ms–1 s) — supprime le « retard d'une
  bougie » des oscillateurs.

### 4b. Nouvelles familles (package `@axiom/indicators`, golden tests)
- **Volume Profile** : session + fixed-range, approximation depuis klines
  (distribution du volume par buckets de prix H-L) — le footprint trades-based
  existant reste l'outil fin ; POC/VAH/VAL affichés.
- **Canal de régression linéaire** (`linreg` existe → canal ±kσ).
- **Divergences auto** : helper pur de détection (pivots prix vs pivots
  oscillateur, RSI et CVD en v1) → marqueurs chart régulière/cachée.

### 4c. Outils interactifs (chart, patron overlay existant)
- **Règle de mesure** : overlay 2 points → Δ%, nb de barres, durée ; style
  discret, supprimable comme les dessins.
- **Position sizing** : overlay entrée + stop, champ % risque → taille de
  position calculée sur l'équité PAPER courante, affichée sur le chart
  (et copiable). Aucun ordre créé — outil de lecture seulement.

Tests : indicateurs = golden tests package ; helpers purs (divergences,
sizing, mesure) ; interactions chart sans test DOM (patron dessins).
