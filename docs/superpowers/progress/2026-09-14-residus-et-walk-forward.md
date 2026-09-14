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
- Aucun push, aucun déploiement. G100 manuel toujours ouvert.
