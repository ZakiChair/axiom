# Indicateurs gratuits vérifiés — plan du chantier

Demande du propriétaire du 14 septembre 2026 : « Vois-tu de nouveaux indicateurs
gratuits et fonctions on-chain, analyse précise du prix, à ajouter ? », puis
« Go pour tous les lots », avec les points a à d et les trois correctifs.

La recherche a sondé 45 candidats par des requêtes HTTP réelles sans clé ; un
vérificateur indépendant a re-sondé chaque endpoint, recalculé les lectures et
vérifié l'absence dans le code. Douze fonctions sont retenues ; les modèles
populaires sans effet démontré (Pi Cycle Top, Golden Ratio, FVG, BOS/CHoCH,
Metcalfe, opening range NY) sont écartés sur preuve.

## Périmètre

| Lot | Fonction | Surface existante |
|---|---|---|
| 1 | Bandes de mouvement attendu implicite (±1σ/±2σ jour et semaine) ; mouvement attendu par échéance (straddle ATM) | Chart maître ; OMON · Term IV |
| 2 | Options IBIT et ETHA (CBOE, différé ~15 min) : GEX/DEX, murs, P/C, convertis en prix BTC/ETH | OMON · classe Actions |
| 3 | Niveaux d'options : murs GEX, gamma flip, max pain de l'échéance dominante | Chart maître |
| 4 | Niveaux clés périodiques : veille, semaine, mois, ouvertures J/S/M/T ; clic droit → alerte | Chart maître |
| 5 | Distance à l'ATH alignée sur le pic, comparée aux cycles passés | CYCLE |
| 6 | Modèles de prix : multiple 200 semaines, prix / SMA 2 ans, Pi Cycle Bottom | CYCLE |
| 7 | Probabilités implicites P(clôture > K à T) (Breeden-Litzenberger centré) ; P(toucher) en infobulle | OMON · Smile |
| 8 | Vol forward entre échéances et mouvement implicite d'événement | OMON · Term IV |
| 9 | Portage excédentaire : basis des futures datés − T-bill US | TERM |
| a | Réseau ETH (Coin Metrics community) : flux et réserve exchanges, émission nette, prix réalisé | CHAIN · Réseau ETH |
| b | Flux nets BTC des exchanges (Coin Metrics community), flux seuls | CHAIN · Cohortes, flux de capitaux (BRIEF, STBL), alerte `flux-capitaux-seuil` |
| c | Trésoreries d'entreprises BTC et prix de revient (CoinGecko) ; ligne « Coût Strategy » | CHAIN · Flux de capitaux ; chart maître |
| d | Open interest des perps DEX (DefiLlama, catégorie Derivatives) | DES |
| A | Correctif : sommet d'un cycle passé cherché avant son creux baissier | CYCLE |
| B | Correctif : retrait du repli Coin Metrics `CapMVRVCur` de CYCLE ; mention « embargo 7 j » | CYCLE |
| C | Correctif : en-tête de `coinmetrics.ts` (ETH servi en community) ; rapport du lot on-chain | Code, docs |

Invariants : 39 fenêtres, 189 indicateurs, 9 identifiants de marché,
`@axiom/types` inchangé, aucune dépendance, aucun hôte nouveau (`cdn.cboe.com`,
`www.deribit.com`, `api.binance.com`, `community-api.coinmetrics.io`,
`api.coingecko.com`, `api.llama.fi`, `home.treasury.gov` sont déjà autorisés),
aucune modification de `vercel.json`, `api/*`, `shared/extapi-hosts.ts`.

## Décisions de l'orchestrateur

- **Bandes implicites (1, chart)** : ancrées sur l'ouverture du jour UTC et du
  lundi, avec l'IV **observée à l'ancre** : DVOL de clôture de la bougie
  précédente. C'est la mesure calibrée (78,0 % des clôtures quotidiennes dans
  ±1σ sur 998 jours, 76,8 % des semaines) : la calibration est affichée, les
  bandes sont libellées « amplitude payée par les options, pas une borne ».
  L'IV ATM de l'échéance qui encadre l'horizon sert au mouvement attendu **à
  partir de maintenant**, dans OMON (straddle et EM par échéance).
- **Overlays chart (1, 3, 4, c)** : un seul `NiveauxLignesController`
  supplémentaire nourri par un fournisseur composite, chart **maître seulement**,
  scellé à l'identité capturée du slot, coupé en rejeu, code des sources chargé
  par `import()` à la première activation. Défaut OFF, persistance dans
  `axiom:sessionUi:v1`, familles des niveaux clés par défaut J + S.
- **Prix de revient (c, chart)** : une seule ligne « Coût Strategy » (le coût
  pondéré s'écarte de 0,8 % : il reste dans la tuile CHAIN). Données lues par
  `import("../../data/onchain/tresoreriesBtc")` puis `chargerTresoreriesBtc` et
  `resumerTresoreries` (contrat du couloir CHAIN).
- **Niveaux d'options (3)** : deux flips libellés distinctement (« Flip GEX(S) »
  du profil, « Flip cumulé » par strike), convention calls + / puts − rappelée.
- **IBIT/ETHA (2)** : prix de conversion = clôture de la bougie Binance 1m au
  `last_trade_time` ; rafraîchissement 5 min ; étiquette « différé ~15 min,
  marché US fermé nuits et week-ends » ; filtre ±25 % avant stockage.
- **Probabilités (7)** : pentes centrées au milieu des intervalles, interpolation,
  monotonie imposée ; libellés « P(clôture > K à T), risque-neutre » et
  « P(toucher avant T), modèle log-normal ».
- **Vol forward (8)** : fenêtres dont une échéance a moins de 12 h masquées ;
  événements ECO d'impact fort USD ; bruit des IV quotidiennes mentionné.
- **Portage (9)** : taux simple act/365 des deux côtés (BEY Trésor converti
  au-delà de 182,5 j) ; échéances < 7 j exclues ; tuile à **maturité constante
  90 j** interpolée entre échéances encadrantes (aucune modification de
  `data/deribit.ts`) ; date de la courbe visible ; repli sur l'année N−1 quand le
  CSV de l'année courante est vide (janvier), qui corrige aussi RATE.
- **Réseau ETH (a)** : un seul fetch Coin Metrics ETH ; réserve avec avertissement
  « périmètre d'adresses révisable », aucun « plus bas depuis » ; « frais totaux »
  et non « part brûlée » ; statut flash signalé ; section multi-source.
- **Flux BTC (b)** : flux nets 1/7/30 j et z-score, étiquetés « labels Coin
  Metrics » ; la réserve n'est plus affichée (dérive de +200 k BTC en 90 jours) ;
  les définitions BGeometrics abonnement restent dans le code sans consommateur.
- **Trésoreries (c)** : un appel, cache 6 h, coalescence, repli périmé ; spot =
  prix implicite CoinGecko ; badge partiel permanent (avoirs non horodatés).
- **OI perps DEX (d)** : section de DES hors des branches conditionnelles ;
  record et variations calculés sur la série complète avant troncature ; écart
  ≈ +29 % avec l'API Hyperliquid affiché en limite ; pas d'alerte.
- **CYCLE (A, B, 5, 6)** : sommet = plus haut précédant le repli maximal du
  cycle clos (cycle courant : max courant) ; MVRV sans repli, « — » si
  BGeometrics échoue, mention « embargo 7 j » ; modèles calculés dans le store,
  jamais au rendu ; pas de heatmap 200 semaines ni de bande 5×.

## Couloirs et propriété des fichiers

Un couloir = un développeur = une branche `chantier/ig-<couloir>` dans
`.worktrees/ig-<couloir>`. Aucun fichier n'appartient à deux couloirs.

| Couloir | Lots, ordre | Fichiers propres (principaux) | Port e2e |
|---|---|---|---|
| chart | 4 (+ clic droit), 3, 1-chart, c-chart | `chart/niveauxOverlays.ts`, `chart/niveaux/*`, `data/chaineOptionsCache.ts`, `chart/ChartInstance.tsx`, `chart/niveauxLignes.ts`, `chart/priceAlertMenu.ts`, `store/persist.ts`, `App.tsx`, `commands/registry.test.ts`, `components/DistWindow.tsx`, `e2e/niveaux-chart.e2e.ts` | 5241 |
| omon | 1-OMON, 8, 7, 2 | `data/cboe.ts`, `data/mouvementAttendu.ts`, `data/probaImplicite.ts`, `data/volForward.ts`, `components/OptionsWindow.tsx`, `components/omon/*`, `commands/windowPanels.ts`, `e2e/omon-lectures-options.e2e.ts` | 5242 |
| cycle | A, B, 5, 6 | `data/cycle.ts`, `data/cycleAth.ts`, `data/modelesPrix.ts`, `store/cycle.ts`, `components/CycleWindow.tsx`, `components/cycle/*`, `store/windowManager.ts`, `e2e/revue-cycle.e2e.ts` | 5243 |
| term | 9 | `data/portageExcedentaire.ts`, `data/macro/treasuryYields.ts`, `components/TermStructureWindow.tsx`, `e2e/term-portage-tbill.e2e.ts` | 5244 |
| chain | socle Coin Metrics, b, a, c | `data/onchain/{coinmetrics,fluxExchangesCm,reseauEthCm,tresoreriesBtc,fluxCapitaux,qualiteChain}.ts`, `components/OnchainWindow.tsx`, `components/onchain/*`, `e2e/onchain-complements.e2e.ts`, `e2e/revue-chain-rotation.e2e.ts` | 5245 |
| des | d | `data/onchain/oiPerpsDex.ts`, `components/OiPerpsDexSection.tsx`, `components/DerivativesWindow.tsx`, `e2e/des-oi-perps-dex.e2e.ts` | 5246 |

Tests unitaires associés : ceux des fichiers propres. Réservés à
l'orchestrateur : `BUILD-CONTRACT.md`, `scripts/ci.sh` (liste e2e, ajoutée à
l'intégration), ce plan, le rapport, `docs/superpowers/progress/2026-09-14-lot-onchain.md`.

Dépendances entre couloirs : 1-chart attend 1-OMON seulement s'il réutilise
`data/mouvementAttendu.ts` ; c-chart attend le lot c du couloir chain
(`data/onchain/tresoreriesBtc.ts`).

## Budget initial (bloquant)

Mesure de départ (HEAD 3ba65fb) : 1 210 751 octets bruts et 356 821 gzip pour
1 220 000 / 360 000, soit une marge de **9 249 bruts et 3 179 gzip**. Tous les
chemins d'entrée sont statiques depuis `main.tsx` → `App.tsx` → `ChartInstance.tsx`
et `store/persist.ts`.

Allocation : couloir chart ≤ 2 000 octets gzip (store des bascules, commandes
palette, enveloppe paresseuse) ; couloirs omon, cycle, chain ≤ 150 chacun ;
term et des 0. Toute logique vit dans des chunks paresseux : aucun import de
valeur de `chart/niveaux/*`, `data/mouvementAttendu.ts`, `data/probaImplicite.ts`,
`data/volForward.ts`, `data/portageExcedentaire.ts`, `data/onchain/{reseauEthCm,
fluxExchangesCm,tresoreriesBtc,oiPerpsDex}.ts` depuis un module d'entrée. Chaque
couloir construit et vérifie le budget à la fin de chaque lot ; l'orchestrateur
le re-mesure sur l'état intégré. Rognage prévu côté chart : aperçus des commandes
de familles, puis mots-clés, puis familles en commande unique.

## Méthode et critères de sortie

1. Contrat et plan commités sur `main`, puis six worktrees.
2. Chaque lot : test qui échoue d'abord, implémentation, tests ciblés verts,
   `pnpm --filter @axiom/web typecheck`, build avec budget, e2e hermétique du
   couloir sur son port, commit sur la branche du couloir.
3. Revue indépendante par couloir (calculs financiers, honnêteté des libellés,
   budget, régressions) ; corrections sur la même branche.
4. Intégration par rebase linéaire sur `main`, ajout des specs e2e à
   `scripts/ci.sh`, puis `bash scripts/ci.sh` et `pnpm check:e2e` verts.
5. Contrôle navigateur sur données réelles (dev), push, déploiement Vercel
   production, contrôle de l'alias.
6. Rapport `docs/superpowers/progress/2026-09-14-indicateurs-gratuits.md` avec
   les preuves réellement observées et les limites.
