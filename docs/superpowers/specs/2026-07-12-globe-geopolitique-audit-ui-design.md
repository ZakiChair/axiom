# AXIOM — Lot F2b/G : couche géopolitique du globe + audit UI complet

> **Spec validée le 2026-07-12** (brainstorming interactif, 3 sections approuvées une à une).
> S'appuie sur la recherche empirique `docs/research/08-globe-crises-geopolitiques-chokepoints-rendu.md`
> (2026-07-10) — sources vérifiées en direct, rien à re-vérifier ici.

## Demande d'origine

« Revoie le projet AXIOM, et améliore l'UI, également pour le globe : j'aimerais que les
conflits géopolitiques, changements de régime ou autre soient représentés sur la carte. »

Clarifications obtenues :
- Périmètre UI : **les quatre axes** — polish visuel global, ergonomie/UX, fenêtre GLOBE,
  audit complet avec fixes. Audit libre (pas d'irritants pré-identifiés), en évitant de
  re-labourer les 166 findings de l'uniformisation du 2026-07-09.
- Sources géopolitiques : **stack complète** GDELT + UCDP + ISW (option recommandée).
- Ordonnancement : **Approche A** — chantier globe d'abord, audit UI ensuite (l'audit
  couvre ainsi le nouveau code, zéro conflit de fichiers).

## Contraintes héritées (BUILD-CONTRACT + recherche 08)

- **Aucune nouvelle dépendance npm** : tout le rendu s'appuie sur `d3-geo` déjà présent ;
  le dézippage GDELT utilise zlib natif Bun côté daemon.
- Budget 0 $/mois : les trois sources sont gratuites et sans clé.
- Pattern rendu : canvas + refs + rAF, **zéro re-render React par frame** (pattern
  `GlobeWindow.tsx`/`MarketMapWindow.tsx` existant).
- Honnêteté des fraîcheurs : chaque couche affiche son âge réel (pattern `NoteSource`) —
  jamais présentée comme du « live seconde par seconde ».
- Le daemon ne proxifie jamais le chemin chaud (REST à quota mis en cache uniquement).

---

## Chantier 1 — Couche géopolitique du globe

### 1.1 Pipeline de données (daemon)

**GDELT Event Database 2.0 (rapide, 15 min)** — route daemon dédiée `/globe/evenements` :
- Route **dédiée** (pas l'allowlist du proxy générique) : `data.gdeltproject.org` ne répond
  qu'en **http://** et le proxy générique force https.
- Étapes : `lastupdate.txt` → téléchargement `.export.CSV.zip` → dézippage (lecture
  d'en-tête ZIP locale ~40 lignes + inflate zlib Bun) → parse des **61 colonnes sans
  en-tête** (schéma en dur, doc officielle GDELT `gdeltproject.org/data/lookups`).
- Filtres côté daemon (logique précise) : garder un événement si `QuadClass` = 4 (conflit
  matériel), **ou** si `QuadClass` = 3 **et** racine CAMEO ∈ {14 protestations, 16 coercition}
  (le reste du conflit verbal — dénonciations, menaces diplomatiques — est du bruit pour une
  carte). La racine CAMEO sert aussi de **catégorie de rendu** : 18/19/20 → « conflit
  matériel », 16/17 → « coercition/répression », 14/15 → « protestation/instabilité ».
  Géolocalisation (`ActionGeo_Lat/Long`) non vide ; dédoublonnage par (position arrondie
  à 0,1°, racine CAMEO).
- Sortie : **JSON compact** (lat, lon, codeCameo, quadClass, goldstein, mentions, acteurs,
  date, urlSource) — quelques Ko au lieu de ~1 Mo de CSV. Cache 15 min (cadence GDELT).

**UCDP Candidate GED (confirmé, ~1 mois de lag)** — route daemon `/globe/conflits-ucdp` :
- CSV sans CORS → téléchargement + parse côté daemon, agrégation par zone : regroupement
  sur une grille de 0,5° (lat/lon arrondis), somme des morts `best`, acteurs
  `side_a`/`side_b` du groupe les plus meurtriers conservés pour le tooltip. Cache 24 h.

**ISW front Ukraine** — fetch **direct navigateur** (ArcGIS FeatureServer, CORS `*`) :
- Polygones GeoJSON du territoire contrôlé (`VIEW_RussiaCoTinUkraine_V3`). Cache 6 h.
- Source non contractuelle (même classe de risque documentée que CBOE GEX) : dégradable,
  jamais bloquante.

**Gestion d'erreur** : en cas d'échec amont, la route daemon sert le **dernier snapshot en
cache avec son âge** (pattern snapshots KV existant) — jamais d'écran vide si une donnée
ancienne existe. Côté front, une couche en échec affiche `ErreurBloc`/`NoteSource`, les
autres couches continuent de vivre.

### 1.2 Rendu et UI de la fenêtre GLOBE

**Trois nouvelles couches toggleables** ajoutées à `CouchesGlobe` (`store/globe-ui.ts`) :
`evenements` (GDELT), `conflits` (UCDP), `ukraine` (ISW). Dessin dans `lib/globeRender.ts` :

- **Événements GDELT** : points, rayon ∝ intensité (`GoldsteinScale` négatif + mentions),
  couleur par catégorie — rouge (conflit matériel : combats/assauts), orange
  (coercition/répression), violet (protestations/instabilité de régime). Événements < 1 h :
  halo pulsant discret, animé **seulement si la boucle rAF tourne déjà** (rotation auto) —
  on ne réveille pas la boucle pour l'animation, sinon halo statique.
- **Conflits UCDP** : cercles gradués par morts (échelle √), teinte plus sombre, dessinés
  **sous** les points GDELT (couche lente = fond de vérité).
- **Front ISW** : polygones translucides + liseré, clippés par l'hémisphère visible.

**Interactions** :
- Hit-test étendu aux nouveaux marqueurs ; survol = tooltip (type, acteurs, date, source).
- Clic = **panneau latéral détail** dans la fenêtre : événements de la zone cliquée triés
  par intensité, lien vers l'article source GDELT quand disponible.
- **Légende compacte en pied de fenêtre** : pastilles couleur + libellés, toggles de
  couches cliquables directement dessus, âge de chaque source affiché.

**Cohérence DA** : palette exclusivement via tokens canvas existants (`lireTokensCanvas`,
`--serie-1…6`), aucune couleur en dur, thèmes clair/sombre. Mots-clés de la commande
palette GLOBE enrichis (« conflits », « guerre », « coup d'état », « ukraine »…).

---

## Chantier 2 — Audit UI complet (après chantier 1)

**Méthode** : audit multi-agents sur l'**app qui tourne** (pas seulement le code).
1. Build + lancement, screenshots de chaque fenêtre dans les **deux thèmes**
   (Chrome DevTools MCP).
2. Fan-out de reviewers par dimension : hiérarchie visuelle & densité · typographie &
   lisibilité · couleur/contraste (2 thèmes) · ergonomie & navigation (toolbar, palette ⌘K,
   fenêtrage, découvrabilité) · cohérence inter-fenêtres · passage dédié à la fenêtre
   GLOBE enrichie.
3. **Vérification adversariale** de chaque finding avant backlog. Interdiction explicite
   aux reviewers de re-signaler ce qui est déjà conforme aux fondations `ui.tsx`/tokens
   (uniformisation du 2026-07-09, 166 findings déjà traités).
4. Fixes par vagues, du plus impactant au cosmétique.
5. **Gate visuel final** : screenshots avant/après soumis au jugement de l'utilisateur.

---

## Tests et critères de fin

- **Daemon** : tests unitaires sur le parseur ZIP/CSV GDELT (fixtures réelles committées),
  le filtre CAMEO/QuadClass, l'agrégation UCDP, les TTL de cache.
- **Front** : tests sur projection/hit-test des nouveaux marqueurs et le mapping
  catégorie→couleur (modules purs dans `globeRender.ts`, testables sans DOM).
- **Critère de fin** : suite complète verte (1341 tests existants + nouveaux), build prod
  OK, **budget bundle inchangé** (zéro nouvelle dépendance npm).
- Commits atomiques par étape : pipeline daemon → couches rendu → UI fenêtre → audit par
  vagues. Messages en français, comme l'historique.

## Hors périmètre (explicitement)

- ACLED (mur d'accès structurel, cf. recherche 08) ; API GEO 2.0 GDELT (morte) ;
  straits.live (side-project sans SLA, jamais en dépendance dure).
- Rendu WebGL/three.js (rejeté pour +86 à +187 % de bundle, cf. recherche 08).
- Persistance des toggles de couches (le store globe-ui reste éphémère, comme aujourd'hui).
