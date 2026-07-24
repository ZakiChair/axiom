# Lot v2.0 — Analyse (÷BTC, EVTS, SCEN, indicateurs & outils)

Date : 2026-07-24 · Origine : brainstorming features avec Zaki (ratio vs BTC +
AT, event study, stress-test, extension du catalogue d'analyse).

Invariants BUILD-CONTRACT habituels : renderer-first, indicateurs TS pur +
golden tests, dégradation gracieuse (jamais de vide muet), FR, `pnpm check`
vert par branche. Toute NOUVELLE fenêtre : pattern DerivativesWindow (non
modal, translatée hors écran), entrée `WINDOW_REGISTRY` + `WINDOW_COMPONENTS`
+ commande `windowPanels.ts` (le menu Fonctions de la Toolbar, la persistance
et la Taskbar en DÉCOULENT automatiquement — corrigé 2026-07-24, la « liste en
dur » n'existe plus). Zéro source de données nouvelle : les 4 chantiers
recombinent des flux déjà câblés.

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
- Dates historiques (amendé 2026-07-24 au plan) : **FRED `release/dates`**
  via le proxy `/fredapi` déjà câblé (release_id 10 = CPI, 50 = NFP) — dates
  exactes 2020→présent, futures incluses, cache localStorage TTL 24 h.
  FOMC : liste statique curée (source officielle Fed). L'« enrichissement par
  cache ECO » initialement prévu est SUPPRIMÉ (YAGNI). Heures de publication
  reconstruites en UTC avec DST US calculé (8:30 ET CPI/NFP, 14:00 ET FOMC).
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

## C4. Indicateurs & outils (branche `feat/indicateurs-divergences`) — S/M

**Audit d'inventaire FAIT (recon 2026-07-24) — le repo est très en avance sur
sa roadmap.** Existent DÉJÀ (ne rien re-livrer) : ancrage AVWAP par clic
(outil `avwapAnchor`), pivots sessionnés vrais (J-1 UTC, `utils-session`),
VWAP à reset de session, refresh intra-bougie throttlé 500 ms
(`recomputeThrottled`), input `source` câblé dans engine.ts, Volume Profile
(VPVR plage visible + VPFR plage fixe, POC/VAH/VAL), canal de régression
±kσ (`linreg`), règle de mesure (Shift+glisser : Δ%, barres, durée), outil
position sizing (`position` + `risqueStore`). 153 indicateurs au registre.

Périmètre RÉDUIT à ce qui manque réellement :
- **Divergences auto prix ↔ oscillateur** (le seul vrai manque) : helpers
  purs de détection (pivots fractals + appariement, régulières ET cachées)
  dans `@axiom/indicators`, puis deux defs `rsiDivergence` / `cvdDivergence`
  rendus en `points` overlay via la machinerie existante (zéro code chart).
- **Balayage de conformité `source`** : test générique — tout def déclarant
  l'input `source` doit réellement le consommer (des defs l'ignorent,
  révélé en recon) ; fixes chirurgicaux des fautifs.

Tests : fixtures construites à la main (pas d'oracle pandas-ta pour les
divergences) ; test de conformité paramétré sur tout le registre.
