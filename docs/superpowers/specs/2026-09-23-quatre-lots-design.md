# AXIOM — quatre lots de la revue du 23 septembre 2026

Le propriétaire a confirmé « Les quatre lots, avec les ajouts ». Les quatre défauts
initiaux sont déjà corrigés et vérifiés (7 283 tests, rapport `docs/revue-2026-09-23-quatre-corrections.md`).
Cette étape complète la feuille de route dans les fenêtres et transports existants.

## Contraintes communes

- Terminal personnel, local, français ; aucune nouvelle dépendance, infrastructure,
  source de marché, clé de trading ni exécution réelle.
- Conserver tous les changements présents avant ce chantier. Baseline complète :
  `/var/folders/yg/146k1d6j2f3dcll9_87gqp8c0000gn/T/axiom-quatre-lots-jk38f88l/`.
- Rendu et tokens visuels existants ; commandes accessibles au clavier, erreurs
  lisibles, état vide indiquant comment commencer. Pas de nouvelle fenêtre.
- Nouvelles vues et données lentes chargées à la demande. Plafonds initiaux
  inchangés : 1 220 000 octets bruts / 360 000 gzip ; point de départ 1 204 408 / 356 368.
- Calculs financiers purs, données manquantes distinctes de zéro, provenance et
  période effectives visibles. Aucun chiffre reconstitué présenté comme observé.
- Régressions significatives, revue indépendante des auteurs, contrôle global unique
  après intégration et parcours navigateur isolés sans notifications réelles.

## Lot 1 — fiabilité du travail personnel

Compléter les quatre corrections déjà livrées par l'état de sauvegarde NOTE/EXPY.
Une mutation reste disponible en mémoire si le stockage local échoue. Le formulaire
reste récupérable et l'interface indique « non enregistré sur cet appareil » avec
un réessai explicite. Le réessai écrit l'état courant sans créer un deuxième objet.
Édition, clôture et import suivent le même contrat. Une création en échec doit avoir
un identifiant stable pour que le formulaire conservé ne double pas l'objet.

Le succès local ne prétend pas que le miroir daemon différé a été confirmé.
Les nouveaux stores des autres lots doivent eux aussi exposer un échec de stockage.

## Lot 2 — historique BT et dossiers de décision

### Backtests

- Capturer une copie immuable de `ConfigRun` avant toute acquisition/calcul. Résultat,
  titre, signature et archive décrivent cette copie, même si le builder change.
- Conserver des versions nommées de la configuration complète, rechargeables
  atomiquement : marché, timeframe, plage, règles, direction, taille/risque, stops,
  objectif, capital, frais, slippage, funding et intrabar.
- Historique persistant des runs réussis : id, date, version du schéma et du moteur,
  configuration, signature, bornes réelles des données, source spot/perp, nombre de
  bougies, modèle/couverture funding et statistiques exactes. Pas de duplication OHLC.
- Archive volontairement synthétique : configuration et statistiques complètes,
  sans prétendre restaurer les bougies, la courbe ou toutes les exécutions. Le résultat
  détaillé courant reste disponible dans BT ; recharger une configuration ne relance
  pas automatiquement un calcul. Limite explicite de 50 runs et 50 versions, sans
  éviction silencieuse ; suppression et export JSON disponibles.
- Deux runs, même de configuration identique, conservent deux identifiants. Comparer
  côte à côte paramètres/statistiques. Les deltas ne sont calculés que pour mêmes
  symbole, source, timeframe et bornes réelles ; signaler les coûts/capitaux différents.
- Codec explicite pour les statistiques infinies (profit factor sans perte), jamais
  transformation silencieuse de `Infinity` en `null`. Hydratation validée par entrée.

### Dossiers

- Depuis un déclenchement d'alerte, créer un dossier dans EXPY : origine immuable,
  date, symbole/source, condition, valeur et contexte effectivement disponibles à
  cet instant. Les anciens journaux ou le daemon peuvent donner un dossier partiel,
  explicitement indiqué ; aucune donnée actuelle ne remplit un contexte passé.
- Saisir une hypothèse, une invalidation et une revue après le trade ; consulter
  l'origine, le contexte et les positions/trades liés, naviguer au contexte daté.
- « Préparer dans PAPER » ouvre un brouillon, sans ordre. L'utilisateur valide ensuite
  dans PAPER. Refuser une conversion silencieuse vers un autre instrument/source.
- Propager `decisionIds?: string[]` de l'ordre à la position puis au trade EXPY.
  Union dédoublonnée lors des renforts, préservation du stop initial corrigé. Les
  anciens objets sans lien restent valides ; références supprimées/orphelines visibles.
- Persistance bornée et validée, export global et miroir/snapshot personnel existants.
  Un dossier est une trace de raisonnement, pas une recommandation automatique.

## Lot 3 — indicateurs complémentaires

- **Liquidations / OI** : volumes USD longs et shorts du perp Binance divisés par
  l'OI USD observé à l'ouverture du même bucket (clôture du bucket précédent exactement
  adjacent), multipliés par 100. Source et intervalle identiques. Dénominateur nul,
  absent ou périmètre différent : inconnu. Aucun report d'un flux à travers un trou.
  Conservation des limites réelles de profondeur Coinalyze, sans promesse de 90 jours.
- **Corrélation baissière** et **bêta baissier** : rendements logarithmiques appariés
  du symbole et de la référence existante ; sélectionner seulement les observations
  où le rendement de référence est strictement négatif dans une fenêtre positionnelle.
  Pearson et covariance/variance centrées sur cet échantillon conditionnel. Fenêtre
  complète, nombre minimal de baisses configurable. Variance de référence nulle :
  deux valeurs indéfinies ; actif constant et référence variable : corrélation
  indéfinie, bêta zéro. Une paire manquante invalide la fenêtre entière, sans
  rendement fabriqué par report de prix ni remplacement hors de la fenêtre.
- **Dispersion historique du funding**, indicateur graphique et vue dans FUNDX : série de l'écart-type population
  des APR réalisés des quatre venues existantes (Binance, Bybit, OKX, Hyperliquid),
  sur une cohorte fixe et annoncée. Normalisation selon les règlements historiques,
  puis alignement causal avec expiration. Si une venue manque, point incomplet et
  dispersion indéfinie, jamais baisse artificielle par réduction de la cohorte.
  Conserver aussi minimum/maximum et couverture pour interprétation. OKX utilise
  `realizedRate`, pas le taux prédit ; ses cadences admissibles incluent 6 h.
  Les fenêtres demandées et la couverture réellement disponible restent distinctes.

Le catalogue gagne quatre définitions : `liquidationsOi`, `downsideCorrelation`,
`downsideBeta`, `fundingDispersion`. Le benchmark baissier utilise `refCloseStrict`
apparié exactement, afin de conserver le contrat des autres consommateurs de `refClose`.

Les détails des endpoints et oracles numériques sont validés par le réviseur financier
avant le brief de production. Aucun abonnement ou fournisseur supplémentaire.

## Lot 4 — usage quotidien

- Menu Indicateurs : favoris persistés, récents bornés, filtre « utilisables ici »
  combinable avec la recherche. Raisons d'indisponibilité conservées lorsque le filtre
  est désactivé ; ajout d'une instance effectif avant mise à jour des récents.
- Alertes : échéance optionnelle rétrocompatible, même règle `now >= expireTs` dans
  moteur, runtime front, daemon et alertes de scans. Une alerte expirée reste consultable
  mais ne se déclenche plus et ne maintient plus ses abonnements. Choix de durée à la
  création, prolongation explicite, aucune prolongation automatique à la réactivation.
- DATA : actions fondées sur des capacités connues. Actualiser seulement avec un vrai
  rechargement existant ; configurer ouvre Réglages ; ouvrir la vue ou une page publique
  utilise une destination fixe sans clé. Montrer le motif d'indisponibilité et le résultat
  d'une action ; aucune commande universelle fictive de réinitialisation des sources.

## Vérification produit

Parcours isolés : panne de sauvegarde puis réessai sans doublon ; deux versions/runs
comparés après rechargement ; alerte → dossier → brouillon PAPER → clôture → EXPY ;
favori retrouvé après rechargement et filtrage selon le marché ; alerte expirée non
déclenchée ; action DATA effective ; nouveaux indicateurs et historique FUNDX avec
données partielles clairement présentées. Aucun envoi Telegram ou notification réelle.
