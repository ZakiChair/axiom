# Lot v1.5 — Lisibilité (SQZ, NETLIQ, CBPREM) + presets scénario EQS + alertes de preset (design)

Date : 2026-07-23 · Statut : périmètre validé par Zaki (AskUser — tout sélectionné + ajout lisibilité NETLIQ/CBPREM). Quatre branches.

## 1. SQZ — refonte lisibilité complète (`feat/sqz-lisibilite`)

**But** : passer d'un nuage austère à une lecture immédiate — comprendre POURQUOI chaque bulle est où elle est, et lire les meilleurs candidats sans survoler.

### Canvas
- **Zone neutre matérialisée** : rectangle central `[−SEUIL_FUNDING_PCT, +SEUIL_FUNDING_PCT] × [−SEUIL_DOI_PCT, +SEUIL_DOI_PCT]` rempli token dim à faible alpha (~0.06) + libellé « neutre » discret au centre. L'utilisateur VOIT les seuils.
- **Axes gradués** : 4-6 ticks par axe avec valeurs formatées (X : funding %/8 h ; Y : ΔOI %), libellés d'axes aux extrémités. Ticks générés par une fonction pure (réutiliser un helper d'axe existant si présent — `lib/domaineAxe` — sinon pas de grille complète, juste les ticks).
- **Couleurs 5 quadrants distinctes** : carburant-squeeze `--up` ; longs-crowded `--down` ; shorts-crowded `--accent` ; deleveraging `--serie-3` ; neutre `--text-dim` à opacité RÉDUITE (~0.25 fill) pour reculer visuellement. Légende compacte (pastille + libellé) sous le canvas.
- **Échelle robuste aux outliers** : domaine par axe = quantiles [2 %, 98 %] des valeurs, symétrisé autour de 0 et jamais plus petit que 2× le seuil de neutralité ; points hors domaine PLAQUÉS au bord avec un anneau (double trait) signalant l'écrêtage — la vraie valeur reste dans l'infobulle. Quantile = fonction pure testée.

### Score d'intensité + panneau « Top candidats »
- **Score pur** `scoreSqueeze(p, bornes)` : 0 si quadrant neutre ; sinon distance euclidienne normalisée `√((f/bF)² + (oi/bOi)²)` où bF/bOi = bornes du domaine (winsorisées). Testé (neutre → 0, coin du domaine → √2, clamp hors domaine).
- **Panneau latéral droit (~190 px)** : groupes « Carburant squeeze » (top 5 par score) et « Longs crowded » (top 5), puis « Autres » (top 3 tous quadrants restants) si la place le permet. Ligne = symbole + funding + ΔOI (teintés) + barre de score discrète. Clic ligne → `navigateTo` (même canal que le clic bulle). Le panneau se replie sous ~520 px de largeur de fenêtre (le canvas garde la priorité).
- Étiquettes du canvas : passer de « top 8 volumes » à « top 8 SCORES » (les candidats intéressants, pas les majors omniprésentes) — anti-collision conservé.

### Pont SQZ → EQS
- Les étiquettes de coin « Carburant squeeze » et « Longs crowded » deviennent cliquables (soulignées au survol, curseur pointer, `title` explicite) : clic → ouvre EQS avec le preset scénario correspondant chargé (`carburant-squeeze` → `builtin:long-potentiel`, `longs-crowded` → `builtin:short-potentiel`) + run lancé. Implémentation : `loadPreset(id)` + `openScreener()` + `run()` du screenerStore — zéro nouveau mécanisme. Les deux autres coins restent inertes.
- Dépendance : ids de presets de la branche 2 → la branche 1 NE crée PAS les presets ; si le preset est absent au runtime (branches mergées dans le désordre), le clic ouvre EQS sans charger (garde silencieuse). L'ordre de merge prévu (2 avant 1) rend le cas théorique.

## 2. EQS — presets scénario + catalogue étendu (`feat/eqs-presets-scenario`)

### Catalogue d'indicateurs screenables (worker)
- `INDICATOR_FIELDS` += `adx` (indicatorId `adx`, output `adx`, paramKey `length` défaut 14, derive `last`, unit "") et `bbw` (indicatorId `bbBandwidth`, output `bandwidth`, paramKey `length` défaut 20, derive **`lastPct`** — NOUVELLE dérive = dernière valeur ×100, la sortie brute est un ratio (upper−lower)/basis — unit "%").
- La dérive `lastPct` est ajoutée au worker (à côté de `last`/`distPct`) et testée.

### Quatre presets builtin « scénario »
Ids/valeurs de départ (calibrage affiné au gate — si un preset rend systématiquement 0 résultat sur l'univers réel, le seuil est ajusté et consigné) :
- `builtin:long-potentiel` « ▲ Long potentiel (rebond) » tf 4h : volume > 10 M$, funding < 0, ΔOI > 0, RSI(14) < 35. Logique : les shorts paient ET s'accumulent sur un actif survendu = carburant à squeeze haussier.
- `builtin:short-potentiel` « ▼ Short potentiel (euphorie) » tf 4h : volume > 20 M$, funding > 0.03, ΔOI > 2, L/S > 1.5, RSI(14) > 70. Logique : longs euphoriques, crowded, surachetés.
- `builtin:range` « ↔ Range / mean-reversion » tf 4h : volume > 5 M$, |Δ 24h| < 2, ADX(14) < 20, BBW(20) < 6 %. Logique : pas de tendance, volatilité contenue.
- `builtin:compression` « ◆ Compression (breakout) » tf 4h : volume > 5 M$, BBW(20) < 3 %. Logique : volatilité comprimée, cassure imminente, direction non préjugée.

### UI presets
- Le sélecteur de presets groupe : « Scénarios » (les 4 nouveaux, avec leur glyphe directionnel ▲▼↔◆ teinté up/down/dim/accent) puis « Filtres » (les 7 existants) puis « Mes presets ». Chaque preset porte un `title` natif d'une phrase expliquant la logique (celles ci-dessus).
- Zéro changement au builder ni au moteur de run (hors dérive `lastPct`).

## 3. EQS — alertes de preset (`feat/eqs-alertes-preset`, APRÈS merge de la branche 2)

**But** : « préviens-moi quand un actif ENTRE dans ce preset ».

- **Création** : bouton « ⏰ Alerte » à côté du sélecteur de presets EQS (actif quand un preset est chargé) → crée une alerte de type nouveau `screener-preset` portant : id+nom du preset, période (15 min si preset SANS filtre indicateur, 60 min sinon — affichée à la création), snapshot des conditions (une alerte survit à la modification du preset utilisateur).
- **Runtime** (patron des timers funding/liq-cascade de `alerts/runtime.ts`) : timer par période ; exécution = pipeline du run screener FACTORISÉ (extraire du store une fonction `executerScreener(conditions, tf, caps)` réutilisée par le store ET le runtime — le store reste l'unique écrivain de son état UI, le runtime n'y touche pas) avec caps réduits (30 candidats évalués max).
- **Déclenchement** : diff vs le dernier résultat mémorisé PAR alerte — seuls les symboles ENTRANTS déclenchent. Premier run d'une alerte = amorce silencieuse (pas de rafale à la création). Cooldown 6 h par (alerte, symbole). Notification via le canal existant (toast + Telegram si configuré) : « EQS ▲ Long potentiel : SOLUSDT entre dans le scan (RSI 32, funding −0.02 %) ».
- **Gestion** : les alertes de preset apparaissent dans le panneau Alertes existant (libellé, période, pause/suppression comme les autres). État runtime (dernier ensemble, cooldowns) en mémoire seulement — un reload ré-amorce silencieusement.
- Anti-coût : au plus 4 alertes de preset actives (limite affichée) ; le run d'alerte ne tourne que si l'onglet est visible (`document.visibilityState`) — pattern des timers existants à vérifier/reproduire.

## 4. NETLIQ + CBPREM — habillage lisibilité (`chore/lisibilite-netliq-cbprem`)

### NETLIQ
- **Overlay BTC** (la plus-value : VOIR la corrélation qui justifie la fenêtre) : bouton « ₿ BTC » dans l'en-tête (état local, défaut ON) → courbe BTC close 1d ~2 ans (klines Binance spot existants, 730 points en 1 appel), échelle Y propre (normalisée sur son propre min/max dans le même cadre), ligne `--serie-1`, PAS d'axe Y secondaire (c'est une lecture de forme, pas de niveau) — mention dans NoteSource. Échec du fetch BTC → overlay absent silencieusement (le cœur de la fenêtre ne dépend pas de l'overlay).
- Grille horizontale discrète : 3-4 lignes aux ticks Y, étiquettes en Md$ compactes (« 6 000 »), étiquettes X : 5-6 dates abrégées (« août 25 »).
- Remplissage dégradé sous la courbe netliq (alpha faible → 0), tooltip enrichi : date, netliq Md$, BTC $ (si overlay), Δ vs point précédent.

### CBPREM
- **Bandes statistiques** : moyenne de la série ± 2σ (stdev population, réutiliser les stats existantes si exposées, sinon calcul local pur) en lignes pointillées discrètes + remplissage très faible entre les bandes ; le zéro reste la référence principale (trait plein existant).
- Ligne « moyenne 7 j » pointillée (la stat du badge devient visible sur la courbe).
- Étiquettes Y en % (3-4 ticks) + étiquettes X datées comme NETLIQ ; tooltip enrichi : date, premium %, z du point vs la série ((p − moyenne)/σ).
- Cohérence : mêmes conventions de ticks/dates que NETLIQ (petits helpers partagés SI un module d'axe commun existe déjà — sinon dupliqué localement, PAS de nouveau module partagé pour 2 fenêtres).

## Contraintes globales

Français ; tokens couleur au dessin (aucune couleur en dur hors replis) ; paddings partagés dessin/survol ; logique pure testée (quantiles, score, ticks, dérive lastPct, diff d'alerte, cooldown) ; zéro nouvelle source de données (BTC overlay = fetch klines existant) ; dégradation gracieuse partout ; `git -C` ; gates habituels + gate visuel par fenêtre. Ordre d'exécution : branches 1/2/4 parallèles (le pont SQZ→EQS a une garde d'absence), branche 3 après merge de la 2.
