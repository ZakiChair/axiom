# Représentation GEX / DEX — carte des expositions

Demande du propriétaire, 28 septembre 2026 : « Change radicalement de vision et de graphique pour la representation du gex et dex ». Suite de la correction des données BTC/ETH, commit `3e9d6bb`. Refonte de la fenêtre OMON existante ; ni nouveau fournisseur, ni nouvelle fenêtre, ni dépendance runtime.

## Choix de lecture

L'ancien histogramme agrège toutes les maturités sur un axe de strikes et place le profil de sensibilité en miniature. Il rend mal visible la répartition de l'exposition après une expiration. La nouvelle représentation distingue deux questions :

- **Carte des expositions** : dans quelles zones de prix et quelles échéances se situe le GEX ou le DEX ?
- **Sensibilité au prix** : comment l'exposition modélisée change-t-elle lorsque le spot varie, à paramètres constants ?

La carte est la vue principale. La légende, les valeurs signées et les détails accessibles ne dépendent pas uniquement de la couleur. Le profil utilise la métrique choisie, y compris le DEX. Les greeks pré-calculés CBOE ne permettent pas cette simulation ; la carte reste utilisable avec une seule colonne d'échéance.

## Direction graphique

Le repère central est le **spot**, séparant les zones au-dessus et au-dessous. Les dates des colonnes représentent des catégories, et non une échelle de temps proportionnelle. Les bandes de distance sont également des catégories de largeurs différentes : elles ne dessinent pas un axe de prix linéaire.

Palette de référence du thème sombre : fond `#0a0a0a`, surface `#171717`, bordure `#262626`, texte `#e5e5e5`, positif bleu `#38bdf8`, négatif ambre `#f59e0b`. Les tokens sémantiques existants conservent la compatibilité des thèmes. Les signes d'exposition ne sont pas des prévisions haussières ou baissières.

Typographie : famille d'interface existante, chiffres tabulaires pour les montants, titres courts en casse phrase. Aucune police externe. Le graphique porte la hiérarchie ; les informations de qualité et le périmètre restent visibles, les conventions détaillées sont repliables.

```text
GEX net · DEX net · Spot                Portée commune
Carte des expositions | Sensibilité au prix

Distance au spot    échéance →         Total zone
 ≥ +30 %            ░ ▒ ░ ▓ ░ ░         montant
 +15 à +30 %        ░ ▒ ▓ ░ ░ ░         montant
 +5 à +15 %         ▒ ▓ ▓ ▒ ░ ░         montant
 0 à +5 %           ▓ ▒ ░ ░ ░ ░         montant
 ───────────────── Spot ──────────────────────
 −5 à 0 %           ▓ ▒ ░ ░ ░ ░         montant
 −15 à −5 %         ▒ ▓ ░ ░ ░ ░         montant
 −30 à −15 %        ░ ▒ ░ ░ ░ ░         montant
 < −30 %            ░ ▒ ░ ░ ░ ░         montant
Total échéance      montants signés

Détail de la cellule sélectionnée : prix, date, GEX, DEX, strikes
Niveaux de concentration · Conventions et hypothèses
```

## Invariants financiers et d'interaction

1. Toutes les expositions calculables de la portée sont conservées. Les huit bandes, définies sur `strike / spot − 1`, couvrent tous les strikes strictement positifs. Bornes basses incluses, bornes hautes exclues. Les bornes sont comparées en prix pour éviter les ambiguïtés d'arrondi sur les seuils exacts.
2. Sommes des cellules, des lignes et des colonnes égales aux totaux issus du calcul existant, à l'arrondi flottant près. Pas de filtre sur les petites contributions. Le GEX est un net signé, pas une intensité brute de positions.
3. Une cellule sans exposition calculable affiche une absence, distincte d'un net calculé égal à zéro. Les avertissements de couverture partielle restent visibles.
4. Une échelle de couleur linéaire commune et chiffrée par carte : `−max(abs(cellule))` à `+max(abs(cellule))`, propre à chaque métrique et portée. Pas de normalisation par échéance.
5. Sélection des cellules à la souris et au clavier, détail persistant lisible. Les cellules indiquent date et bande ; les principaux strikes sont classés selon la valeur absolue de la métrique active.
6. Profil de 41 spots simulés entre −15 % et +15 %, incluant exactement le spot courant. Réutilisation de `computeCryptoGexDex`, IV, OI, temps et ratio forward/index constants. Le point au spot rejoint le total de la carte. Ce profil n'est pas une prévision et ne mesure pas les portefeuilles dealers.
7. Même horloge, même actif, même portée sur la carte, les totaux, le profil et les niveaux. Les échéances expirées restent purgées au cutoff exact ; aucun mélange BTC/ETH pendant le chargement.
8. La petite fenêtre peut faire défiler la matrice horizontalement dans son propre conteneur. Le graphique et les textes ne provoquent pas de débordement global. Le mode agrandi rend la carte directement lisible.

## Lots et vérification

- Développeur B : transformations pures `data/carteExpositions.ts` et tests de conservation, bornes, absence/zéro, maturités, profil.
- Développeur A : composants de carte et de profil, intégration OMON, retrait de l'ancien rendu GEX/DEX, tests d'interactions et de non-régression.
- Réviseur indépendant : fidélité de l'agrégation, échelles, libellés, absence/zéro, périmètres et sens des simulations.
- Orchestrateur : documentation, arbitrage visuel dans le navigateur, contrôle global sous Node 24.13.0, parcours BTC/ETH et CBOE, preuves réelles et commit local après validation. Aucun déploiement dans ce lot.
