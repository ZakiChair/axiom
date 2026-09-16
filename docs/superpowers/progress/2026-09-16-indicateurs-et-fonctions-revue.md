# 2026-09-16 — Indicateurs et fonctions de la revue : réalisation

Demande du propriétaire : « go implémenter les indicateurs et fonction suggérés »
(BT, concordance multi-échelle, gains rapides d'observabilité), après la revue du
16 septembre. Exception G100 consignée dans `BUILD-CONTRACT.md` (§ Extension
autorisée le 16 septembre 2026).

## Livré

**Dix indicateurs** (`@axiom/indicators`, catalogue 190 → **200**, un fichier et
un test par def) :

| Id | Catégorie | Note |
|---|---|---|
| `vpin` | orderflow | Buckets de VOLUME ; split taker requis → UNUSABLE hors Binance |
| `cointegrationAdf` | statistical | Engle-Granger roulant vs `refClose`, repère −3,34 (approximation documentée) |
| `spreadHalfLife` | statistical | Demi-vie du spread (barres) + β de couverture, noyau partagé `utils-cointegration.ts` |
| `corwinSchultz` | volatility | Spread effectif high-low (borné à 0) |
| `amihudIlliq` | volume | Illiquidité ×10⁶ |
| `kyleLambda` | orderflow | Impact par déséquilibre taker normalisé (pb) ; split requis → Binance |
| `garmanKlassVol`, `rogersSatchellVol`, `yangZhangVol` | volatility | Famille d'estimateurs OHLC complétée (Parkinson existait) |
| `skewKurt` | volatility | Skew + kurtosis d'excès des rendements log |

Câblage web : `indicatorUsability` (VOLUME_REEL exporté, SPLIT_VOLUME, forex),
filtre synthétique de `chart/indicators.ts` (source unique), alias FR de
recherche, compteurs de tests (200).

**BT — mode intrabar** (`params.intrabar`, case à cocher, défaut OFF) : stop et
objectif jugés sur le high/low des barres détenues, fill au niveau touché ou à
l'OPEN si gap, **stop prioritaire** dans la même barre ; les sorties par règle
restent clôture → open+1. `intrabar` entre dans la signature de run.
6 tests moteur (stop/target intrabar, priorité, gap, short, règle inchangée).

**BRIEF — concordance multi-échelle** : `data/multiEchelle.ts` (mesures pures +
chargement des 4 TF) et `brief/SectionMultiEchelle.tsx` (TableTriable), compteur
d'alignement, échelle en échec → « — ». 7 tests purs.

**Observabilité** : `/health` expose `collecteurs.whales`, `collecteurs.globe`
(GDELT/UCDP) et `base.octets` (taille SQLite) — défensif, champs à 0 si base
indisponible ; proxy : quarantaine par hôte après 429 (Retry-After borné à
15 min, repli 60 s), 429 local pendant la quarantaine, `retry-after` propagé
(5 tests) ; `navigateTo` cible le **slot focus** de la grille (2 tests).

**Budget JS** : les additions coûtaient ~12,7 ko bruts au chemin d'entrée (dépassement
constaté : 1 228 678 bruts / 361 981 gzip). Le contrôleur de heatmap des
liquidations est sorti du chunk d'entrée — commande LIQMODE déplacée vers
`chart/liquidationMarkers.ts`, helpers purs extraits dans `chart/rampesHeat.ts`,
classe chargée par `import()` à la première activation. Mesure locale finale :
**1 205 532 bruts / 355 397 gzip** (marges 14 468 / 4 603), soit sous la mesure
d'avant chantier (1 216 010 / 358 605). Plafond inchangé.

## Preuves

- `bash scripts/ci.sh` : typecheck ; **6 572 tests** (indicateurs 1 420,
  alertes 76, backtest 109, daemon 524, web 4 443 — comptes src+dist confondus
  pour les paquets) ; build web ; budget **PASS**.
- `pnpm check:e2e` : **73 parcours hermétiques** verts (1,7 min).
- Navigateur (serveur de dev, données Binance live) :
  - BRIEF : section « Concordance multi-échelle · BTCUSDT », alignement 1/4
    (hausse en 1 j), 15 min baisse RSI 44,1 ATR 0,25 % Δ −0,4 % / 1 h baisse
    41,3 0,54 % +0,3 % / 4 h baisse 36,5 1,11 % −1,5 % / 1 j hausse 48,3 2,88 %
    −5,7 % — ATR croissant avec l'échelle, valeurs cohérentes.
  - BT : BTCUSDT 1H 6 mois, stop 5 % + objectif 10 %, 27 trades — **sans**
    intrabar PnL +94,19 (+0,94 %), PF 1,26, Sharpe 0,72, perte moyenne −4,51 % ;
    **avec** intrabar PnL +122,40 (+1,22 %), PF 1,37, Sharpe 1,00, perte moyenne
    −4,08 % ; la note d'honnêteté bascule sur le libellé intrabar.
  - LIQMARK : la heatmap s'active (2 canvases visibles) — le chargement
    paresseux du contrôleur fonctionne ; aucun message console hors `/health`
    (daemon arrêté) et favicon.
  - Menu Indicateurs : « cointegration » trouve « Cointégration
    (Engle-Granger) » sous STATISTIQUES ; compteur 1/170 hors stratégies.

## Limites

- VPIN et λ de Kyle sont des mesures par bougies (approximations du tick) et
  Binance-only ; la cointégration garde biais de petit échantillon et repère
  critique approximatif ; le mode intrabar suppose l'exécution au niveau du stop
  (pas d'ordre réel, pas de profondeur) ; la quarantaine 429 est par hôte et par
  processus, non persistée.
- Les candidats on-chain de la revue (Delta Cap, CDD/dormancy, NRPL) n'ont PAS
  été implémentés : ils exigent une sonde HTTP réelle des fournisseurs, non
  faite ici.
- Vérification navigateur sur serveur de dev uniquement (pas de déploiement).
