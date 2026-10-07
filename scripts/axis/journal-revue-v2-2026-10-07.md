# Journal de revue — test final d'AXIS v2 (7 octobre 2026)

Revue indépendante du protocole et du runner AVANT toute lecture des données
de test (règle du projet : « Backtest / math / drawdown / expectancy →
Réviseur »). Le réviseur n'a pas écrit ce code. Méthodes : lecture ligne à
ligne ; répétition `--essai` sur les données déjà vues ; séries synthétiques
aux bornes exactes de la campagne ; serveur Binance simulé en mémoire ;
injections de faute sur des copies dans `/tmp`. Aucune requête de données de
marché, aucun cache de campagne écrit, aucun fichier du dépôt modifié par le
réviseur.

Verdict de la revue : **réserves** au premier passage (2 bloquants, 1 majeur,
6 mineurs, 7 faiblesses du protocole), **« OK pour exécution »** à la
contre-revue, sous la condition d'écrire ce journal avant le lancement.
Aucune erreur de calcul, de bornes ou d'anticipation n'a été trouvée.

## Empreintes

| Objet | Revu | Final |
|---|---|---|
| Manifeste `manifeste-v2-2026-10-07.json` | candidat de 12:17Z, `48eafec263c58329fbde657eb3b32747e2cd320808bdc0a4a15c8de3b835870c` | re-figé à 12:54Z, `588aea2f961549923f81d60ed58d52569f5a61853ac796111255ebadf169af9e` |
| Runner `scripts/valider-axis-v2.ts` | `ecd92aa8…b9cd` (1er passage), `1f00ef42bfa153e2a1b076b0dd8e88ae92414a9e3089e0efc1f5c89e00b96021` (contre-revue) | `1e87c2deb120fb38cb497fd37c552b16d2a442dc34d1002ab8451ee62c4bc4aa` |
| `pnpm-lock.yaml` | `130d4fb6…c062` | inchangé |

Le runner final ne diffère du runner contre-revu que par les deux mineurs n1
et n2 ci-dessous (dénominateur de l'infobulle, libellé des bougies
manquantes). Le manifeste ne peut pas contenir le hash du runner (le runner
épingle le sien) : le hash final ci-dessus est celui que le résultat doit
reporter dans `code.runnerSha256`.

## Corrections du runner

- **B1 (bloquant)** — Un arrêt pour écart de contrôle affichait des mesures
  faites sur les données jamais vues (rendement capté, nombre de trades,
  position datée), alors qu'une relance est prévue. Désormais
  `EcartControle(cellule, controle, detail)` : en campagne, le message ne
  nomme que la cellule et le contrôle ; le détail n'apparaît qu'en
  répétition. Vérifié par trois injections de faute (position, timing,
  chronologie).
- **B2 (bloquant)** — `process.argv.includes("--essai")` : une faute de
  frappe (`--esai`, `--essai=1`…) lançait la campagne. Désormais exactement un
  argument parmi `--essai` et `--campagne`, sinon sortie 2 avant toute
  lecture.
- **M1 (majeur)** — Le rapport affirmait que le runner était « vérifié par
  SHA-256 ». Libellé corrigé : son hash est consigné ici avant l'exécution et
  reporté dans le rapport.
- **m1** — Une kline non finie ou à `closeTime` incohérent arrêtait tout le
  run. Elle est maintenant écartée (voir P4).
- **m3** — La trace d'arrêt écrasait le fichier de résultat : elle va dans un
  fichier horodaté distinct `arret-v2-<horodatage>.json`.
- **m4** — « Recalcul indépendant » renommé « recalcul direct depuis les
  fonctions exportées » : ce contrôle vérifie la chaîne registre →
  `prixSignal` → position, pas la logique du score (même code, couverte par
  les 23 tests unitaires).
- **m6** — `evaluation.bougiePremiereDecisionUtc` (open de la bougie 299) au
  lieu d'un champ ambigu ; `Infinity` sérialisé en `"Infinity"`.

## Re-figeage du manifeste (avant toute lecture des données de test)

Critères C1–C3, cellules, fenêtre, coûts et paramètres du timing inchangés.

- **P4** — Une seule kline incohérente rendait la cellule indisponible, donc
  le verdict NON CONCLUANT avec des données consommées. Désormais une bougie
  servie invalide (OHLCV non fini, open, close ou low ≤ 0, volume < 0,
  high/low incohérents, `closeTime` incohérent) est écartée, datée et
  comptée comme manquante sous le même plafond de 1 % ; tolérance de 24 h
  ajoutée pour la dernière clôture.
- **P1** — C3 ne distingue pas AXIS d'un simple filtre EMA 200 (répétition :
  p commun 0,006 pour l'EMA 200 seule contre 0,0045 pour AXIS ; sur ETH, l'EMA
  200 seule fait mieux). Choix : pas de critère supplémentaire (la demande
  porte sur la pertinence des signaux), mais une comparaison pré-déclarée,
  sans effet sur le verdict, qui fixe la formulation de l'infobulle si le
  verdict est FAVORABLE (`suites.infobulleSiFavorable`). Le rapport donne
  aussi l'exposition et le timing de l'EMA 200 seule.
- **m2** — `packages/indicators/src/index.ts` (exécuté, identique au commit de
  base) ajouté au code figé, soit 17 fichiers.
- **m4** — Libellé du premier contrôle bloquant corrigé.

## Faiblesses du protocole, journalisées sans modification

- **P2** — Sous un nul sans prévisibilité mais avec dérive positive, C1 est
  tenu dans 68 % des réplications et C2 dans 33 % : C3 est le seul contrôle du
  timing. Taille globale correcte : FAVORABLE dans 3,0 % des cas avec dérive,
  0,3 % sans dérive.
- **P3** — Trades clos attendus : BTC ≈ 110, ETH ≈ 100, XRP ≈ 95, SOL ≈ 55
  à 60 ; le seuil de 30 sera probablement atteint. Les moitiés de C2 sont
  bruitées : un DÉFAVORABLE est plausible même avec un petit avantage réel, et
  il ne prouverait pas l'absence d'avantage.
- **P5** — Avec des cellules de longueurs différentes, le décalage commun ne
  préserve qu'en partie la corrélation entre actifs. Taille du test vérifiée
  sous des nuls iid et GARCH, avec et sans dérive : p ≤ 0,05 dans 4,8 % à
  5,5 % des cas.
- **P6** — Les quatre actifs dépendent d'un même facteur crypto ; les régimes
  de 2017 et 2021 sont connus de tous. La requête préalable des dates de
  cotation a touché des données antérieures au 2024-07-01 ; effet
  négligeable.
- **P7** — Périmètre de validation : Binance Spot, quatre actifs, 4h,
  2017-2024. Hors périmètre : forex sans volume (CMF neutre), historique
  chargé court (amorce de l'EMA 200 et armement différents). La restriction
  à l'unité 4h est cohérente.

P1–P7 sont rappelés dans la section « Limites » du rapport de campagne.

## Contre-revue des corrections

Toutes les vérifications ont été faites sur des copies, avec un garde qui
refuse le réseau ou un simulateur.

- Non-régression : répétition FAVORABLE identique (p 0,0045), 23/23 tests
  stratAxis ; hashes du manifeste, des 17 fichiers figés et du lock
  conformes.
- B1 : en campagne, stderr et trace ne contiennent que « contrôle « nom » en
  écart », traces horodatées distinctes, aucun résultat écrit ; détail
  présent en répétition.
- B2 : toutes les formes invalides sortent en code 2 sans fetch.
- P4 : bougies invalides servies (NaN, high/low incohérents, prix ≤ 0, volume
  négatif, `closeTime` incohérent, première et dernières bougies) écartées,
  datées et comptées ; cellule disponible à 83 manquantes sur 8 394 (seuil
  83,94), indisponible à 84 ; bougie hors grille → indisponible ; cache écrit
  puis relu sans fetch, mêmes résultats ; cache altéré → arrêt avant toute
  mesure.
- Reconstruction du timing de l'EMA 200 depuis ses fills : 13 cas sur 13
  conformes au calcul de référence (dont fin-données et entrée à la dernière
  décision) ; une reconstruction ratée donne « non calculé » sans bloquer.

Mineurs restants :
- **n1** (corrigé) : `{total}` de l'infobulle compte les cellules
  disponibles.
- **n2** (corrigé) : la liste des bougies manquantes mentionne aussi les
  bougies écartées.
- **n3** (consigné) : une série indisponible n'est jamais mise en cache ; en
  cas de relance après interruption, elle serait retéléchargée.
- **n4** (consigné) : une erreur d'acquisition ne laisse qu'un message sur
  stderr ; sa cause sera consignée ici en cas de relance.

Écarts déclarés par le réviseur : le runner réel a été lancé avec des
arguments invalides (sortie 2 avant toute lecture ou accès réseau) et une
fois en `--essai` sur le cache v1 ; sans effet sur la campagne.

## Avant le lancement

- `scripts/.cache-klines/axis-v2/` absent (vérifié à 13:08Z, avec les hashes
  du runner et du manifeste ci-dessus).
- Commande unique : `bun scripts/valider-axis-v2.ts --campagne` (Bun 1.3.11).
