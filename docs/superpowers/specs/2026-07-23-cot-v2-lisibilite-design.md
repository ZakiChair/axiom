# COT v2 — Lisibilité : COT Index, sparklines, normalisation net/OI (design)

Date : 2026-07-23 · Statut : validé sur périmètre par Zaki (sélection AskUser), spec à relire.

## But

La fenêtre COT affiche aujourd'hui un net spéculatif brut + delta 1 semaine, sans référentiel : « +181K » n'est pas interprétable, et l'échelle commune écrase BTC/argent face à l'or. Objectif : donner du **contexte historique** (où se situe le net vs son histoire) et une **comparaison inter-marchés honnête** (net rapporté à l'OI), sans changer la nature de la fenêtre (résumé visuel, pas un dump de table).

## Non-buts

- Pas de ventilation par catégories (Disaggregated/TFF, commercials) — lot ultérieur (2C).
- Pas de graphe temporel plein-écran par instrument — la sparkline suffit à ce lot.
- Pas de nouvelle source : même dataset Socrata Legacy `6dca-aqww`, mêmes 14 instruments, mêmes 5 champs.

## Données

`data/cot.ts` :
- Élargir la profondeur : `$limit` passe de 80 à **3000** (14 instruments × ~160 semaines ≈ 2 240 lignes ; Socrata accepte jusqu'à 50 000). Fenêtre cible : **3 ans** (`$where report_date >= <now-3y>` pour borner).
- La synthèse conserve désormais la **série complète** par instrument (triée chrono), plus seulement 2 rapports.
- Cache : clé versionnée `axiom:cot:cache:v2`, TTL 12 h inchangé. Taille estimée ~250-300 Ko JSON — sous la limite localStorage ; en cas de `QuotaExceededError`, dégrader silencieusement (pas de cache, fetch direct) — jamais d'exception.

## Calculs purs (dans `data/cot.ts`, testés)

- `serieNette(rows)` → `{ t, net, oi }[]` chrono par instrument.
- `cotIndex(serie, fenetreSem = 156)` → percentile-rank du net courant dans la fenêtre (0-100) ; `null` si < 26 semaines d'historique (un percentile sur 3 points ment).
- `deltaSemaines(serie, n)` → delta du net sur n semaines (1 et 4 utilisées).
- `netSurOi(net, oi)` → % (null si OI ≤ 0).

## UI (`CotWindow.tsx`)

Chaque ligne instrument devient : `[Libellé] [sparkline] [badge percentile] [barre net/OI] [net + delta]`.

- **Sparkline 52 semaines** du net (SVG inline léger, ~90×16 px) : ligne fine `text-dim`, dernier point marqué, zéro matérialisé par un trait discret. Pas d'axe (c'est une tendance, pas une mesure).
- **Badge COT Index** : `p92`-style, teinté `--up` si ≥ 80, `--down` si ≤ 20, neutre sinon ; « — » si historique insuffisant. C'est l'élément de lecture principal : extrême = signal.
- **Barre divergente normalisée** : remplacement de l'échelle absolue commune par le **net/OI %**, échelle fixe commune ±50 % avec graduations discrètes à ±25 % — BTC et l'or deviennent comparables et lisibles. La valeur nette absolue reste affichée en texte (inchangé).
- **Delta** : delta 1 sem conservé (flèche) ; delta 4 sem ajouté au survol de la ligne (title/tooltip natif suffit, pas d'infobulle canvas).
- **Hygiène (audit UI 2026-07-16)** : remplacer les états ad hoc par les primitives `ErreurBloc`/`Chargement`, et la note de bas de fenêtre par `NoteSource` ; la note explique le COT Index (« percentile du net spéculatif sur 3 ans »).

Tri et groupement par famille inchangés.

## Cas limites

- Instrument avec historique partiel (< 52 sem) → sparkline sur ce qui existe ; < 26 sem → badge « — ».
- Champ CFTC vide → NaN (convention `nombreCot` existante), point exclu de la série.
- OI nul/absent → barre absente (« — »), net absolu toujours affiché.
- Échec réseau → repli cache existant (comportement conservé) ; cache v1 obsolète ignoré (nouvelle clé).

## Tests / validation

- TDD sur `cotIndex` (percentile aux bornes, fenêtre incomplète, série constante → 50), `deltaSemaines`, `netSurOi`, parsing profond (tri chrono, multi-instruments entrelacés).
- Non-régression : `cot.test.ts` existant adapté (synthèse ne jette plus l'historique).
- Gate visuel : 14 lignes lisibles dans les deux thèmes, sparklines cohérentes avec les deltas, extrêmes teintés, fenêtre à largeur par défaut 520 px sans débordement.

## Contraintes

Français, tokens couleur, primitives UI du repo, dégradation gracieuse systématique, branche `feat/cot-v2-lisibilite`.
