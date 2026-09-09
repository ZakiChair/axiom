# Calendriers d’unlocks sourcés

Ce format JSON permet d’importer un calendrier dans **CAP** ou **SECT**, section
**Unlocks / bridges**, sans clé DefiLlama Pro. L’import vérifie la forme, les bornes
et la sécurité des URL. Il ne vérifie pas la véracité économique des données : chaque
token doit donc citer les documents qui justifient son calendrier.

L’exemple ci-dessous est entièrement synthétique. Le domaine `example.test` est réservé
aux exemples et ne désigne aucune source réelle. Aucune valeur de marché, aucun prix,
aucun volume et aucun flottant ajusté ne sont fournis.

```json
{
  "version": 1,
  "source": "Exemple synthétique sans valeur de marché",
  "sourcesValidees": true,
  "exporteLe": 1788998400000,
  "tokens": [
    {
      "id": "example-token",
      "nom": "Example Token",
      "offreCirculante": null,
      "flottantAjuste": null,
      "sources": [
        "https://example.test/tokenomics"
      ],
      "events": [
        {
          "date": 1792051200000,
          "quantite": 50000,
          "type": "lineaire",
          "categorie": "equipe",
          "description": "Événement synthétique"
        }
      ],
      "prochaineDate": 1792051200000,
      "prochaineQuantite": 50000,
      "capitalisationUsd": null,
      "denominateurs": {
        "prixUsd": null,
        "volume24hUsd": null,
        "flottantAjuste": null
      }
    }
  ]
}
```

## Contrat strict

Chaque objet doit contenir exactement les champs montrés. Un champ manquant ou inconnu
fait refuser tout le document. Le texte JSON est limité à 8 388 608 caractères.

- À la racine, `version` vaut `1`, `sourcesValidees` vaut exactement `true`, `source`
  est une chaîne de 300 caractères au plus, `exporteLe` est un timestamp Unix fini en
  millisecondes compris entre le 1er janvier 2009 et le 1er janvier 2200, et `tokens`
  contient au plus 5 000 entrées.
- `id` commence par un caractère alphanumérique puis contient au plus 79 caractères
  alphanumériques ou tirets. `nom` contient de 1 à 200 caractères.
- `sources` contient de 1 à 20 URL HTTPS, chacune longue de 2 000 caractères au plus.
  Les URL avec identifiant ou mot de passe intégré sont refusées. Les paramètres de
  requête nommés comme un credential (`api_key`, `key`, `token`, `access_token`,
  `authorization`, `secret`, `password`, `credential` et variantes tiretées) sont refusés.
- `events` contient au plus 10 000 entrées. `date` est un timestamp Unix fini en
  millisecondes, strictement postérieur au 1er janvier 2009 et antérieur au 1er janvier
  2200. `quantite` est finie, positive ou nulle et inférieure à `1e30`. `type` vaut
  `cliff`, `lineaire` ou `autre`. `categorie` est `null` ou une chaîne de 200 caractères
  au plus ; `description` est `null` ou une chaîne de 2 000 caractères au plus.
- `offreCirculante`, `flottantAjuste`, `prochaineDate`, `prochaineQuantite` et
  `capitalisationUsd` valent `null` ou un nombre fini, positif ou nul et inférieur ou
  égal à `1e30`. `prochaineDate`, lorsqu’elle existe, reste dans les bornes 2009–2200.
- Pour obtenir un badge `cliff` ou `linéaire`, l’événement correspondant doit avoir
  exactement le même timestamp que `prochaineDate`. Sinon le type suivant reste inconnu.

## Dénominateurs et dates

Les trois dénominateurs valent `null` lorsqu’ils ne sont pas connus. Aucun prix égal à 1,
aucun volume nul et aucun flottant dérivé de l’offre circulante ne doivent être inventés.
Sans dénominateur exploitable, AXIOM laisse le notionnel ou le ratio indisponible.

Un dénominateur non nul contient exactement `valeur`, `source` et `observeLe`.
Sa chaîne `source` est limitée à 500 caractères :

```json
{
  "valeur": 800000,
  "source": "https://example.test/float-methodology",
  "observeLe": 1788955200000
}
```

`valeur` doit être strictement positive, finie et inférieure à `1e30`. `observeLe` est
la date d’observation réelle du dénominateur, en millisecondes Unix ; elle doit être
postérieure au 1er janvier 2009 et ne peut pas dépasser l’heure courante de plus de cinq
minutes. Une date future d’unlock n’est jamais la date d’observation d’un prix, d’un
volume ou d’un flottant.

La source d’un flottant ajusté doit être une URL HTTPS sûre et `flottantAjuste` au niveau
du token doit être égal à sa `denominateurs.flottantAjuste.valeur`. Pour le prix et le
volume, une URL HTTPS sûre est acceptée ; la chaîne interne exacte
`CoinGecko /coins/markets (contexte actuel)` est réservée aux exports produits par AXIOM.
Un prix et un volume observés aujourd’hui décrivent le contexte actuel d’un unlock futur,
pas une prévision à sa date.

## Accès et export

Le bouton **Importer** reste disponible sans clé. Le chargement en direct des unlocks et
des bridges exige une clé personnelle et les droits DefiLlama Pro correspondants. Une
erreur 401, 402, 403 ou 429 est affichée pour le chargement direct ; l’import
personnel sourcé reste disponible.

Le bouton **Exporter** devient disponible lorsqu’au moins un token est présent après
un chargement ou un import valide. Il
reprend les calendriers et leurs provenances, mais jamais la clé DefiLlama Pro. Ne placez
aucune clé, aucun token d’accès ni aucun mot de passe dans `source`, `sources` ou les URL
de dénominateurs.
