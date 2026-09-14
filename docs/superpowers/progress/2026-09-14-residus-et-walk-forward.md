# Résidus et tenue par moitié — réalisation du 14 septembre 2026

Demande du propriétaire : corriger les bogues résiduels et ajouter une fonction
pertinente. Le présent rapport distingue ce qui a été mesuré de ce qui a été lu.

## Constat principal : deux lots validés enterrés dans une remise git

`git stash list` portait « stash pre-push 2026-09-08-12:21:17 » (reflog : `reset:
moving to HEAD` à cet instant, aucun `pop` ensuite). Elle contenait 829 lignes sur
11 fichiers suivis plus 7 fichiers non suivis : les deux lots du 7 septembre, tous
deux validés à l'époque mais jamais commités.

- **BPL** : horizon de projection porté à +50 ans, zoom/pan, axe log10(jours)
  (`btcPowerLaw.ts` +167 lignes, 21 tests, paramètre `marges` du hook de zoom).
- **Synchronisation multivue** : options persistées `syncTimeframe` /
  `syncViewport` / `syncCrosshair`, `demarrerSyncTimeframes`, contrôleur
  `viewportSync` chargé à la demande, boutons de grille, parcours `multivue`
  (plan `docs/superpowers/plans/2026-09-07-synchronisation-multivue.md`).

La remise s'appliquait encore proprement sur `main` (un seul conflit, la liste
e2e de `scripts/ci.sh`, résolu en conservant la liste longue plus `multivue`).
Restaurée en deux commits (`3e2e890`, `92736f1`) après `pnpm check` vert et 51
parcours hermétiques. **La remise est conservée** (`stash@{0}`) : elle est
redondante avec ces commits, sa suppression revient au propriétaire.

Le même risque pesait sur le lot « Cycle de la dette à long terme » (validé et
déployé le 11 septembre, non commité depuis) et sur le correctif du gel orderflow :
commités en tête de session (`177335b`, `16e7b17`).

## Correctifs

| Résidu | Origine | Correctif |
|---|---|---|
| Footprint : `start()` rendait avant `recomputeBucket()` (bucket 0,01 → ~1,1 M lignes par bougie BTC, onglet tué) | débogage du 13-09, non commité | `16e7b17`, test `orderflow.bucket.test.ts` |
| Pivot de molette et vitesse de pan calculés sur le canvas entier alors que VOL, RATE, TERM, OMON (smile) et BT dessinent avec des marges d'axe (VOL : tracé sur la moitié droite, pan à ~45 %) | dette repérée le 07-09 | `ce95866` : `zoneTrace` pur (4 tests), hook acceptant des marges constantes ou fonction de la largeur, cinq fenêtres passent les constantes de leur dessin |
| TS2550 `Object.hasOwn` émis par le bundler de fonctions Vercel sur `shared/nbs-series.ts` | rapport du 11-09 | `313ed62`, tests NBS 6/6 |

## Nouvelle fonction : tenue par moitié temporelle (BT)

Piste « walk-forward dans BacktestWindow » ouverte depuis la revue du 20 août
(`partagerMoities` n'existait que pour la campagne CLI). `partagerResultatMoities`
(`@axiom/backtest`, pur, 5 tests à valeurs calculées à la main) coupe le run
exécuté à la bougie médiane et agrège chaque moitié : PnL net rapporté à l'équité
de début de moitié, taux de réussite, facteur de profit, drawdown recalculé dans
la moitié, expectancy R. La fenêtre BT affiche deux colonnes sous l'équité, grise
une moitié sous 10 trades (même plancher que Monte-Carlo) et trace la frontière
en pointillés sur la courbe. Ce n'est pas une optimisation in/out-of-sample :
aucun paramètre n'est réglé sur la première moitié.

**Preuve réelle** (Chrome, serveur de dev, données Binance live, 08:21) :
BTCUSDT 1 h, 6 mois, preset « Croisement EMA 9/21 » → 98 trades, PnL global
−100,96 (−1,01 %). Moitiés : 16/03 → 15/06 : 51 trades, −135,68 (−1,36 %),
PF 0,58 ; 15/06 → 14/09 : 47 trades, +34,72 (+0,35 %), PF 1,11. Somme des
moitiés = PnL global, 51 + 47 = 98. Lecture attendue : l'edge ne tient pas sur
les deux moitiés.

Exception G100 consignée dans `BUILD-CONTRACT.md` (septième).

## Vérifications

- `pnpm check` sur l'arbre final : types, **5 981 tests** (indicateurs 1 376,
  alertes 70, backtest 98, daemon 513, web 3 924), build web. Chargement initial
  1 213 645 octets bruts / 358 679 gzip, inchangé (sous 1 220 000 / 360 000) ;
  le walk-forward vit dans les chunks paresseux (+3 ko).
- `pnpm check:e2e` : **51 parcours** hermétiques réussis (1,2 min), dont les 8
  parcours multivue et le parcours backtest.
- Journaux : `/private/tmp/claude-501/-Users-zakichair-axiom/a241464c-8a61-4bb1-a759-e4099e67d20e/scratchpad/{ci-final,e2e-final}.log`.

## Limites

- Les marges de zoom sont vérifiées par tests purs et lecture des constantes de
  dessin ; le geste réel (molette, pan) n'a pas été rejoué à la souris sur les
  cinq fenêtres.
- Les deux lots restaurés reprennent les preuves du 7 septembre (plan multivue,
  mémoire de session BPL) ; ils ont été revalidés par la CI et les parcours e2e
  d'aujourd'hui, pas réinspectés à l'œil.
- À cette première clôture : aucun push, aucun déploiement (voir la suite du même
  jour ci-dessous). G100 manuel toujours ouvert.

## Suite du même jour : MAE/MFE, budget de la CI GitHub et déploiement

Demande du propriétaire : continuer d'améliorer l'outil, intégrer dans `main`,
redéployer sur Vercel. Il n'y avait aucune branche à fusionner : les commits
étaient déjà sur `main`, ils ont été poussés sur `origin/main`.

### Excursions MAE / MFE (`f0eb0f8`)

Dernière brique manquante du lot « vérité du backtest » (revue du 20 août). Le
moteur calcule pour chaque trade la pire excursion adverse (MAE, ≤ 0) et la
meilleure excursion favorable (MFE, ≥ 0), en % du prix d'entrée, sur les barres
réellement détenues : la barre de fill d'une sortie ordinaire est exclue (sortie
à son open), la dernière barre d'une sortie fin-donnees est incluse (marquée à
son close) ; long et short symétriques, bornes à 0. Cinq tests à valeurs
calculées à la main dans `engine.test.ts` ; `calculerStats` expose les moyennes.
La fenêtre BT ajoute deux colonnes triables à la table des trades et une ligne
de moyennes sous les gains/pertes ; le parcours e2e du backtest vérifie la
section walk-forward, les colonnes et la ligne de moyennes.

### Budget JS de la CI GitHub (`f21f44e`)

Le run GitHub du premier push (`34814380665`) a échoué à l'étape « build web et
budget JS initial » : **360 051 octets gzip pour un plafond de 360 000**, alors
que le même arbre mesurait 358 677 en local et 357 309 sous le bundler Vercel.
Le zlib du runner Linux produit environ 1,4 ko de plus que celui de macOS, et le
lot multivue restauré (+3 840 octets bruts dans le chunk d'entrée) avait consommé
la marge. Le run précédent sur `main` (`34458925098`, 10 septembre) échouait
déjà, à l'étape Playwright.

Correctif sans toucher au plafond, après classement des sources du chunk
d'entrée par `vite build --sourcemap` :

| Mesure | Bruts | Gzip |
|---|---|---|
| Avant (local, `f0eb0f8`) | 1 213 645 | 358 677 |
| `demarrerSyncTimeframes` extrait dans `store/chart-sync-timeframes.ts`, chargé à la demande par ChartGrid | 1 212 285 | 358 226 |
| + composant de spike M4 chargé paresseusement depuis `main.tsx` | 1 205 821 | 355 531 |
| Bundler Vercel, même arbre | | 354 110 |

Leçon consignée : viser au moins 3 ko de marge locale sous le plafond gzip, la
CI GitHub étant le juge de paix.

### Déploiements Vercel

Chemin retenu : `vercel pull --environment=production`, `vercel build --prod`
puis `vercel deploy --prebuilt --prod`. Seule la sortie `.vercel/output` est
envoyée : aucun `.env`, aucune base locale, aucun worktree — la copie filtrée
du 11 septembre n'est plus nécessaire. Aucun avertissement TS2550 dans les deux
builds (correctif `313ed62` sur le chemin Vercel).

| Déploiement | Commit | ID | Statut |
|---|---|---|---|
| 08:40 | `f0eb0f8` | `dpl_XuViDuuaRSyUTTMLcxUWuF22VW22` | Ready, alias attaché, remplacé |
| 08:51 | `f21f44e` | `dpl_8sN8LW2iZ5DioASMMSvJSte6ET48` | Ready, alias attaché, remplacé |
| 09:08 | `9e10a38` | `dpl_G24oKoLxwHNppb75MnjjYwQQBFE9` | Ready, alias attaché, **courant** |

Alias : [AXIOM](https://axiom-iota-vert.vercel.app). Contrôles après
publication du deuxième déploiement : alias HTTP 200 ; script d'entrée servi
`index-CPkA4IxH.js` identique au build local ; chunks paresseux
`chart-sync-timeframes` et `WebGLSyncSpike` présents ; proxy FRED sur
`/fredapi/fred/series/observations` : HTTP 400 de l'amont (clé absente), donc
fonction et module partagé opérationnels. Sur le premier déploiement, parcours
réel dans Chrome : ⌘K → BT, preset « Croisement EMA 9/21 » sur Binance live
(BTCUSDT 1 h, 6 mois, 98 trades, PnL −100,96) : section « Tenue par moitié »
identique au relevé local (51/47 trades, −1,36 % / +0,35 %), MAE moyenne
−0,90 %, MFE moyenne +1,63 %, colonnes MAE/MFE présentes. Le second déploiement
ne change que le découpage des chunks ; il a été contrôlé par les vérifications
HTTP ci-dessus, pas rejoué dans Chrome.

Le troisième déploiement (`9e10a38`, script d'entrée `index-1j-O6e-y.js`
identique au build local, alias HTTP 200, proxy FRED HTTP 400 amont) ne porte
que le correctif de l'avis de catalogue ci-dessous.

### Parcours hermétiques sur GitHub (`9e10a38`)

Le run du second push (`34815169456`) a passé le budget (l'étape « build web et
budget JS initial » est verte) mais a échoué à l'étape « e2e hermétiques » sur
deux causes propres au runner Linux, toutes deux antérieures à la session (le
run du 10 septembre échouait déjà à cette étape) :

- `macro-globale.e2e.ts` écrivait deux captures dans `/private/tmp/…`, un chemin
  qui n'existe que sur macOS (ENOENT sur Linux) → dossier de sortie Playwright du
  test (`test.info().outputPath`).
- `gate-v25-cap-dominance.e2e.ts` ne pouvait pas cliquer l'option TOTAL3 : sans
  accès à `api.binance.com` (bloqué géographiquement depuis les runners US), la
  recherche de paire affiche « Catalogue indisponible » **par-dessus la liste
  d'options**, et cet avis interceptait les clics. Défaut produit réel : sans
  catalogue, les symboles de capitalisation n'étaient plus sélectionnables à la
  souris. L'avis est désormais `pointer-events-none` (reproduit et prouvé en local
  avec `exchangeInfo` en HTTP 451, parcours jetable non conservé) et le parcours
  bouchonne `exchangeInfo` pour rester hermétique.

Run GitHub Actions du troisième push : `34816202729`, **succès** en 5 min 16 s
(typecheck, tests daemon/paquets/web, build et budget, 51 parcours hermétiques).
Premier run vert sur `main` depuis au moins le 10 septembre.
