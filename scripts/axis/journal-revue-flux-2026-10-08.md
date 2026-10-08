# Journal de revue — test final de la couche flux d'AXIS (8 octobre 2026)

Revue indépendante du protocole et du runner AVANT toute lecture des données
de test (règle du projet : « Backtest / math / drawdown / expectancy →
Réviseur »). Le réviseur (agent séparé) n'a pas écrit ce code. Méthodes :
lecture ligne à ligne du manifeste, du runner, de `stratAxis.ts`, de
`utils.ts` et d'`engine.ts` ; comparaison avec le runner et le journal v2 ;
répétition `--essai` sur les quatre séries 4h déjà vues ; reproduction
indépendante du nul par décalage et mesure complémentaire de la volatilité
aux événements (`/tmp/axis-flux-revue/verif-vol.ts`, données vues seulement).
Aucune requête de données de marché, aucun cache de campagne écrit, aucun
fichier du dépôt modifié par le réviseur.

Verdict de la revue : **« figeage autorisé »** au premier passage — aucun
bloquant, aucun majeur, 4 mineurs et 5 remarques, tous traités ci-dessous
avant le figeage. Aucune erreur de calcul, de bornes ou d'anticipation n'a
été trouvée.

## Empreintes

| Objet | Revu | Final (figé) |
|---|---|---|
| Manifeste `manifeste-flux-2026-10-08.json` | candidat `594e9ca6943a0f15175dd2810cfb4a31a9baf1bd7dbe930ea43637617edf62d2` | `29d9449b8130d61adea69965f0e57debcfa6f2bcaa8ee952498f3e34efabfc88` (figé à 07:14Z) |
| Runner `scripts/valider-axis-flux.ts` | `90429af2…1168` (HASH_MANIFESTE = « A_FIGER ») | `cb0328ba85f4cac93af00610cebbba34199e4592e1039d17f302d1805483f104` (hash du manifeste épinglé) |
| Code figé (14 fichiers, `versions.codeAuFigeageSha256`) | tous identiques | inchangés (`stratAxis.ts` `09c347dc…f653`, modifié non commité, couvert par le hash) |
| `pnpm-lock.yaml` | `130d4fb6…c062` | inchangé ; Bun 1.4.2 |

Le manifeste ne peut pas contenir le hash du runner (le runner épingle le
sien) : le hash final ci-dessus est celui que le résultat doit reporter dans
`code.runnerSha256`.

## Répétition technique (données déjà vues, sans valeur probante)

Avant la revue, la répétition ne comptait que BTC et ETH : C2 (« 3 cellules
sur 4 ») échouait mécaniquement. Le manifeste, encore non figé, a reçu les
quatre séries 4h de l'exploration (BTC, ETH, XRP, SOL). Résultat de la
répétition finale : FAVORABLE, 522 forts achats, +152 bps à 12 bougies,
p ≤ 0,0005, 4 cellules sur 4 à moyenne > 0 ; fortes ventes sans suite
mesurable ; contrôles bloquants passés sur les quatre cellules ; aucun
avertissement avec le hash épinglé. Effectifs cohérents avec l'exploration
(BTC 263 forts mouvements contre 282 : l'écart est les bougies de signal AXIS
exclues).

Chemin d'arrêt vérifié sur une copie volontairement cassée du runner (sous
`scripts/`, supprimée ensuite) : « ✋ écart de contrôle », trace horodatée
distincte sans valeur mesurée, code de sortie 1, aucun rapport. Arguments
invalides (`--campagn`, aucun) : sortie 2 avant toute lecture. Typage : `tsc
--strict` (options du `tsconfig.base.json`) propre sur le runner et
l'exploration après correction de trois erreurs (`pos` typé `number |
undefined`, trades clôturés filtrés sans assertion non nulle).

## Constats du réviseur et traitement

- **m1 (mineur, corrigé)** — Valeurs du protocole codées en dur dans le
  runner alors que le manifeste les énonce : coût aller-retour 0,14 %, règle
  « 3 cellules sur 4 », seuil de 30 ventes AXIS fortes, texte de l'infobulle
  DÉFAVORABLE. Désormais `criteres.minCellulesPositives`,
  `secondaires.coutAllerRetourPct`, `secondaires.minVentesFortesAxis`,
  `suites.infobulleDefavorable`, lus par le runner (garde : critères non
  finis → arrêt).
- **m2 (mineur, traité)** — Les événements sont conditionnés sur le volume,
  donc sur la volatilité ; le décalage circulaire ne préserve que leur
  regroupement. Mesure du réviseur sur données vues : σ(r₁₂) aux forts
  achats / σ toutes bougies = 0,92 BTC, 0,96 ETH, 1,37 XRP, 1,53 SOL ; σ de la
  somme sous le nul du runner 1,95 contre 2,03 sous un nul à instants
  préservés (le regroupement compense ici l'écart) ; p inchangée. Limite
  écrite dans `mesures.nul` et dans les « Limites » du rapport ; nul
  complémentaire pré-déclaré en DESCRIPTIF (`mesures.permutationSens`,
  1 999 tirages, graine 20261009) : permutation des sens parmi tous les forts
  mouvements de chaque cellule (instants, effectifs, volatilité préservés),
  question « les forts achats sont-ils suivis de plus de hausse que les forts
  mouvements en général ? ». Répétition : p = 0,0025 regroupé (moyenne nulle
  86 bps, achats 152 bps), conforme au chiffre indépendant du réviseur.
- **m3 (mineur, corrigé)** — Sur une source sans volume taker, les marqueurs
  existent avec un sens par corps seul (population non mesurée).
  `suites.gardeSourceSansTaker` : les infobulles mesurées ne s'affichent que
  sur une bougie dont le delta taker est disponible ; sinon « couche flux non
  mesurée » reste. Rappelé dans le rapport.
- **m4 (mineur, corrigé)** — Phrase de puissance : « quelques centaines
  d'événements regroupés (une centaine par cellule) ».
- **r1 (remarque, corrigé)** — p au plancher : « p ≤ 0.0005 » quand aucun
  tirage n'atteint l'observée (`mesures.formatP`, `suites.formatValeurs`) ;
  p des tableaux descriptifs à 4 décimales comme C1.
- **r2 (remarque, corrigé)** — « préserve la corrélation entre actifs » →
  « préserve en partie » (fins alignées, débuts et bougies manquantes
  différents), même réserve que P5 du journal v2.
- **r3 (remarque, consigné)** — Le contrôle « horizon » est une propriété de
  construction de la fenêtre (b = n − 2 − 42) ; il est re-vérifié bougie par
  bougie, le manifeste le dit maintenant.
- **r4 (remarque, corrigé)** — Une série trop courte pour une décision rend
  la cellule indisponible (au lieu d'un arrêt) ; borne exacte n ≥ 343.
- **r5 (remarque, suivi)** — Procédure : absence de `H-*` dans
  `scripts/.cache-klines/axis-flux/` vérifiée à 07:13Z (seuls les `E-*` de
  l'exploration) ; un `modeCalcul: "cache"` à la première exécution serait un
  signal d'alerte.

## Vérifié correct par le réviseur (RAS)

- Anticipation : SMA 20 bougie courante comprise (connue à la clôture), delta
  de la même bougie, dernière bougie exclue, `positionsAxis` causale (ensemble
  des signaux exclus causal), fill open[i+1], fenêtre a = 299, b = n − 44 ;
  rien dans `mesurer`, `evenementsDe`, `positionEtSignaux`, `fluxAxis` ne lit
  au-delà de i ; l'OI du chart ne touche ni les événements ni les positions.
- Statistique : k ∈ [0,1 Lmin, 0,9 Lmin[, indice décalé toujours dans [a, b],
  k commun, p = (1 + #{nul ≥ obs}) / (N + 1), mulberry32 conforme ; contrôle
  par sommes préfixes exact ; C2 et NON_CONCLUANT conformes au manifeste ; la
  disponibilité des données ne peut faire basculer que vers NON_CONCLUANT.
- Contrôles : marqueurs --accent (60 derniers) et signaux (120 derniers)
  comparés en longueur, indice et forme ; causalité : borne `coupe − 2`
  exacte ; en campagne l'écart ne livre que cellule et contrôle.
- Données : pagination, `endTime = fin − 1`, champ 9 exigé, `closeTime`,
  `raisonInvalide` complet, grille, croissance stricte, tolérances 24 h,
  manquantes ≤ 1 % ; la série mesurée est exactement celle hachée dans
  `sha256Ohlcv` ; les quatre séries sont acquises et validées avant le
  premier calcul.
- Cohérence manifeste ↔ runner et gabarits ↔ `formulations()` ; honnêteté des
  formulations ; pré-enregistrement sans degré de liberté restant ; risque
  de cellule sous 50 forts achats jugé faible (90 à 180 attendus par
  cellule).

## Avant le lancement

- `scripts/.cache-klines/axis-flux/` sans `H-*` (vérifié à 07:13Z, avec les
  hashes du runner et du manifeste ci-dessus).
- Commande unique : `bun scripts/valider-axis-flux.ts --campagne` (Bun
  1.4.2). Une interruption technique avant le verdict sera consignée ici
  (cause, correctif, revue) avant toute relance.

## Après l'exécution (consigné après coup)

- Lancement à 07:14:02Z, une seule exécution, aucune interruption, aucune
  relance. Les quatre séries ont été acquises par le réseau (`modeCalcul:
  "reseau"`, 07:14:05Z à 07:14:11Z), validées, puis mesurées ; contrôles
  bloquants passés sur les quatre cellules ; aucun avertissement ;
  `code.identiqueAuFigeage: true` ; `code.runnerSha256` =
  `cb0328ba…f104`, conforme au hash final ci-dessus ; `manifesteSha256` =
  `29d9449b…fc88`.
- Verdict pré-déclaré **FAVORABLE** : C1 tenu (690 forts achats, +161 bps à
  12 bougies, p unilatérale au plancher ≤ 0,0005), C2 tenu (3 cellules sur 4 à
  moyenne > 0 ; BNB −14 bps). Lecture honnête : 51 % de hausses seulement,
  médiane +10 bps ; nul complémentaire par permutation des sens p = 0,047
  (moyenne de tous les forts mouvements +112 bps). Fortes ventes : rien ;
  ventes AXIS « fortes » : rien (p 0,55) ; achats « forts » pas meilleurs que
  les ordinaires sur 3 cellules sur 4. Rapport :
  `scripts/axis/rapport-flux-2026-10-08.md` ; résultat :
  `scripts/axis/resultat-flux-2026-10-08.json`.
- Suites appliquées après l'exécution, conformément au manifeste : infobulles
  des forts achats et fortes ventes aux formulations pré-rédigées (avec la
  garde delta taker), infobulle des signaux « qualification descriptive, sans
  avantage mesuré pour les signaux « forts » » (écart de formulation par
  rapport à « non mesurée », plus informatif et pas plus favorable : le
  secondaire a été mesuré et n'a rien trouvé), documentation. `stratAxis.ts`
  diffère donc désormais du hash figé (`154f2ed2…a5e6` après les suites) :
  attendu, le résultat JSON consigne l'état figé au moment du calcul.
- Les données BNB/ADA/LINK/DOGE 4h sont consommées : aucune autre variante n'y
  sera jugée.
