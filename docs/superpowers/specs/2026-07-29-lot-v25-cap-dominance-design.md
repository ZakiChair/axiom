# Lot v2.5 — Fenêtre CAP : capitalisation totale, TOTAL3 et dominances

Date : 2026-07-29 · Origine : demande Zaki (« ajoute 3 graphiques, TOTAL3, TOTAL
crypto, et BTC dominance, ajoute la possibilité de calculer d'autre dominance,
eth, sol, et autre alt »). Périmètre arrêté en brainstorming : **fenêtre dédiée**
(pas d'overlay sur le graphe principal), **dominance libre dans le top 100** plus
une dominance « alts » agrégée, **backfill navigateur** de l'historique.

Invariants BUILD-CONTRACT : aucune dépendance nouvelle ; TS strict
(`noUncheckedIndexedAccess`) ; docblocks FR ; aucune donnée haute fréquence dans
le state React (les capitalisations sont journalières — même régime basse
fréquence que `data/macro/`) ; `pnpm check` vert ; gate visuel navigateur en fin
de lot (les défauts d'UI ne se voient pas aux tests unitaires).

---

## 0. Constat fondateur — le backfill EST possible en gratuit

`data/macro/coingecko.ts` affirme aujourd'hui : « Aucun backfill possible en
gratuit (sources empiriquement écartées) ». **C'est faux, et cette phrase doit
être corrigée** — sinon la prochaine session re-dérive la mauvaise conclusion.
Mesures faites le 2026-07-29 depuis le réseau de Zaki, sans clé :

| Requête | Résultat |
| --- | --- |
| `/coins/{id}/market_chart?vs_currency=usd&days=365&interval=daily` | **200** — 366 points de capitalisation journalière |
| même requête avec `days=max` | **401** `error_code 10012` — le gratuit plafonne à **365 jours** |
| `/global/market_cap_chart?days=90` | **401** `error_code 10005` — réservé au tier Pro (déjà connu) |
| 15 appels rapides d'affilée, sans clé | **429 dès le 6ᵉ** — il faut cadencer |
| `/coins/markets?per_page=250` | **200** — 250 capitalisations courantes en **un seul** appel |

Ce qui est payant, c'est l'**agrégat global** ; l'historique **par pièce** est
gratuit. TOTAL se reconstruit donc par somme du top 100, recalibrée sur
`/global`. Couverture mesurée le même jour :

| Panier | Somme | Part du TOTAL `/global` | Facteur `k` |
| --- | --- | --- | --- |
| top 10 | 2 029,9 G$ | 88,91 % | 1,1247 |
| top 25 | 2 130,0 G$ | 93,29 % | 1,0719 |
| **top 100** | **2 232,2 G$** | **97,77 %** | **1,0228** |
| top 250 | 2 262,8 G$ | 99,11 % | 1,0090 |

Le top 100 est le point d'équilibre retenu : 97,8 % de couverture pour 100
appels de backfill, le reliquat étant absorbé par le recalibrage.

### Second constat — l'accumulation locale actuelle ne peut PAS construire d'historique

`store/macroHistory.ts` borne sa série à `MAX_POINTS = 1500` avec un poller à
`POLL_MS = 5 min`, soit 288 points par jour : **5,2 jours d'historique maximum**,
après quoi `slice(-MAX_POINTS)` évince les plus anciens. Le mécanisme « la série
s'étoffe au fil des sessions » décrit dans le docblock est donc inopérant au-delà
d'une semaine. Sans correctif, le backfill serait lui aussi évincé en cinq jours.
D'où la **compaction** spécifiée en §2.3 — elle fait partie du lot, pas d'un
« nettoyage adjacent ».

---

## 1. Pipeline de données — `apps/web/src/data/mcap.ts`

Un seul pipeline sert les trois graphiques et toutes les dominances.

### 1.1 Récupération

- `fetchHistoriquePiece(id, signal)` → `/coins/{id}/market_chart?vs_currency=usd&days=365&interval=daily`,
  ne garde que `market_caps`. Clé Demo optionnelle injectée comme dans
  `data/macro/coingecko.ts` (même stockage `axiom.coingecko.demoApiKey`).
- `fetchTopMarches(signal)` → `/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1`,
  projeté en `{ id, symbole, nom, mcap }[]`. Un seul appel pour les 250 valeurs
  courantes + le catalogue du sélecteur de dominance.
- L'instantané `/global` réutilise `fetchGlobalMcapSnapshot` **existant** (aucune
  duplication de fetch).

### 1.2 Fonctions pures (le cœur testable)

- `grilleJournaliere(serie)` : normalise chaque timestamp au **minuit UTC** de son
  jour et dédoublonne en gardant le **dernier** point du jour. Nécessaire parce
  que CoinGecko renvoie 365 minuits **plus** un point « maintenant » (vérifié :
  dernier timestamp = l'heure courante, pas un minuit) : sans normalisation, le
  jour courant compterait deux fois et les pièces ne s'aligneraient pas.
- `alignerSurGrille(serie, grille)` : forward-fill à l'intérieur de la plage
  connue de la pièce, **0 avant son premier point**. Une pièce listée en cours
  d'année contribue donc 0 avant sa cotation — ce qui est exact pour une somme —
  et un trou ponctuel est comblé par la dernière valeur connue plutôt que par 0.
- `reconstruireTotal(sérieAlignées, totalGlobalCourant)` : somme colonne par
  colonne, calcule `k = totalGlobalCourant / somme[dernier]`, renvoie la série
  multipliée par `k`. `k` n'est calculé que si `somme[dernier] > 0`, sinon `k = 1`
  et le drapeau `recalibre: false` remonte à l'UI.
- `dominance(sériePièce, sérieTotal)` : `100 × mcap / total`, `null` si le total
  est 0 ou non fini. **Divise par le total RECALIBRÉ, jamais par la somme brute** :
  la dominance est invariante d'échelle, et diviser une couche trop tôt gonfle
  BTC.D d'environ 1,3 point.
- `serieDifference(a, b…)` : TOTAL2 = TOTAL − BTC, TOTAL3 = TOTAL − BTC − ETH.
- `dominanceAlts(btcD, ethD)` : `100 − BTC.D − ETH.D`.

### 1.3 Cadence et repli 429

- `attenteApres429(essai, retryAfterSecondes)` — pure, donc testable sans timers :
  respecte `Retry-After` s'il est présent, sinon repli exponentiel
  `min(2^essai × 1 000, 60 000)` ms.
- Espacement nominal du backfill : **2 100 ms avec clé Demo** (≈ 28 appels/min) et
  **13 000 ms sans clé**. Le sans-clé est cadencé en AIMD : chaque échec retentable
  multiplie l'espacement courant par 1,5 (plafond 15 s), et 10 succès consécutifs le
  réduisent de 200 ms (plancher = la base).
- Un échec retentable déclenche l'attente ci-dessus puis **rejoue la même pièce**
  (jusqu'à 4 essais), sans perdre la progression. L'appel de catalogue initial est
  rejoué de la même façon : un seul échec ne doit pas tuer tout le backfill.

**Deux mesures faites APRÈS rédaction, qui corrigent cette section :**

1. **Un 429 CoinGecko arrive au NAVIGATEUR en erreur CORS.** Sa réponse d'erreur ne
   porte pas d'en-tête `Access-Control-Allow-Origin` : le navigateur bloque la réponse
   et `fetch` rejette avec un `TypeError`, `res.status` restant illisible. Tout repli
   conditionné à `status === 429` est donc **mort dans un navigateur**. Le rejet réseau
   doit être traité comme retentable (`STATUT_RESEAU`). ⚠️ En curl, la même requête
   renvoie un 429 parfaitement visible — le diagnostic en ligne de commande **ne
   reproduit pas le symptôme**.
2. **Le plafond keyless réel est de l'ordre de 5 appels/minute**, pas 20. Mesuré : 429
   dès le 6ᵉ appel d'une rafale, et encore à un espacement de 8 s, avec un en-tête
   `Retry-After: 60`. D'où 13 s de base et une durée annoncée de ~25 min sans clé.

---

## 2. Historique — `apps/web/src/store/mcapHistory.ts`

### 2.1 Backfill

Déclenché à la **première ouverture de la fenêtre CAP** (jamais au boot : 100
requêtes non sollicitées au démarrage seraient une régression pour tout le
monde). File séquentielle sur les 100 premiers ids de `fetchTopMarches`, avec :

- barre de progression `n/100` et bouton **Interrompre** ;
- curseur persisté (`axiom:mcap:backfill:v1` = ids restants + somme partielle) :
  fermer la fenêtre ou l'onglet en cours de route ne perd rien, la reprise
  repart où elle en était ;
- à la fin : recalibrage, écriture de l'historique, purge du curseur.

Durée attendue : **~3,5 min avec clé Demo**, **~25 min sans clé** (plafond keyless
mesuré ≈ 5 appels/min avec 60 s de pénalité). La clé Demo, gratuite, cesse d'être un
confort : la fenêtre la recommande explicitement.

Le curseur est écrit périodiquement **et sur le chemin d'erreur** : un abandon après
quatre échecs consécutifs conserve tout ce qui est acquis.

### 2.2 Persistance

Clé `axiom:mcap:v1` :

```ts
interface HistoriqueMcap {
  version: 1;
  majTs: number;                     // dernier recalcul
  k: number;                         // facteur de recalibrage appliqué
  grille: number[];                  // minuits UTC (ms), croissants
  total: number[];                   // TOTAL recalibré, aligné sur grille
  pieces: Record<string, number[]>;  // mcap par pièce, alignée sur grille
}
```

`pieces` ne conserve **que** BTC, ETH et les pièces choisies par l'utilisateur —
les 100 séries du backfill sont sommées puis jetées. Environ 60 Ko : aucun risque
de quota. Ajouter une dominance plus tard coûte **un** appel, mis en cache ici.
Lecture tolérante (absente / JSON corrompu / `version` inconnue → historique vide,
le backfill se propose à nouveau), écriture best-effort — même patron que le reste
du dépôt.

### 2.3 Prolongement et source unique

- **Prolongement** : à l'ouverture de la fenêtre et sur le bouton Rafraîchir (TTL
  10 min), un `fetchTopMarches` + un `/global` ajoutent — ou remplacent — le point
  du jour courant pour le TOTAL et pour chaque pièce suivie. Deux appels, pas cent.
- **Source unique préservée** : la série backfillée **alimente**
  `macroHistory` (`seed(points)`), au lieu de vivre à côté. L'invariant « le
  panneau Macro ET l'overlay du graphe lisent cette MÊME série » reste vrai, et
  l'overlay macro du graphe principal gagne d'un coup une année d'historique.
  `seed` fusionne, trie, dédoublonne par jour et n'écrase jamais un échantillon
  temps réel existant par un point journalier.
- **Compaction** (`compacter(snapshots, maintenant)`, pure) : au-delà de 48 h, un
  seul point par jour UTC (le dernier) ; en deçà, tous les échantillons.
  Corrige le plafond de 5,2 jours documenté en §0 ; `MAX_POINTS` reste à 1 500,
  ce qui représente alors plus de deux ans.

---

## 3. Fenêtre CAP

### 3.1 Registre et commandes

Entrée `{ id: "mcap", title: "Capitalisation & dominance", mnemonic: "CAP",
defaultWidth: 880, defaultHeight: 700, nouveau: true }` dans `WINDOW_REGISTRY`
(`DOM` est déjà pris par le carnet d'ordres, `CAP` est libre). Le menu Fonctions
en découle automatiquement ; il reste à ajouter le composant dans
`WINDOW_COMPONENTS` (App.tsx, sinon erreur de compilation) et une commande
`panneau:cap` dans `commands/windowPanels.ts` (mots-clés : capitalisation, total,
total2, total3, dominance, btc.d, altseason).

### 3.2 Découpage des fichiers

| Fichier | Rôle |
| --- | --- |
| `data/mcap.ts` (+ `.test.ts`) | fetchers + fonctions pures du §1 |
| `store/mcap.ts` (+ `.test.ts`) | store vanilla unique : état UI (période, dominances), historique persisté, backfill, prolongement, `seed` vers `macroHistory`, `mirrorOpenState("mcap", …)` |
| `components/McapWindow.tsx` | présentation pure : 3 canvas, sélecteur, états |
| `components/mcapWindow.util.ts` (+ `.test.ts`) | géométrie partagée dessin ⇄ survol, ticks, formatage |

### 3.3 Rendu

Patron NETLIQ/CBPREM à la lettre : canvas impératif en pixels CSS sous
`setTransform(dpr,…)`, `ResizeObserver`, couleurs lues **au dessin** via
`lireTokenCanvas` (donc correctes sur les 5 thèmes), et **géométrie partagée**
entre le dessin et le hit-testing du survol — mêmes littéraux de part et d'autre,
sinon le trait du curseur ne coïncide pas avec le point (leçon HEATMAP).

Trois graphiques empilés, hauteurs égales, axe des temps commun :

1. **TOTAL** — capitalisation totale, échelle en T$ / G$, domaine calé sur les
   extrêmes de la fenêtre (jamais forcé à contenir 0, cf. divergence assumée de
   NETLIQ : un niveau élevé écrasé contre le cadre est illisible).
2. **TOTAL3** — hors BTC et ETH, même traitement.
3. **Dominances** — courbes superposées en %, palette des six tokens `--serie-1`
   … `--serie-6` d'`index.css` (et non `COMPARE_PALETTE`, qui n'en expose que
   quatre pour un plafond de six courbes), échelle 0 → max + marge.

Chrome commun : `EnTeteFenetre`, `BarrePeriodes` (30 j / 90 j / 1 a / Tout),
`Fraicheur` sur le dernier point, `NoteSource` (« CoinGecko · reconstruction top
100 recalibrée, couverture 97,8 % · 365 j max en gratuit »), `ErreurBloc` non
destructif, `Chargement`, `Vide`.

**Réticule synchronisé** : un unique index de jour survolé en state React, partagé
par les trois canvas — le trait vertical est tracé sur les trois, l'`InfobulleGraphe`
n'apparaît que sur le graphique sous la souris. Le survol est la seule chose qui
vit dans React ; les séries restent dans le store vanilla.

### 3.4 Sélecteur de dominances

Sous le troisième graphique : pastilles activables **BTC**, **ETH**, **alts**
(= 100 − BTC.D − ETH.D), plus un bouton **+** ouvrant une liste filtrable des 100
premières pièces de `fetchTopMarches` (recherche par symbole ou par nom). Choisir
une pièce déclenche un appel unique, met la série en cache (§2.2) et ajoute sa
courbe. Une pastille se retire d'un clic sur sa croix. Sélection persistée
(`axiom:mcap:dominances`), défaut `["bitcoin", "ethereum"]`. Plafond de 6 courbes
simultanées — au-delà, le graphique devient illisible et la palette se répète.

---

## 4. Réglages

Un champ « Clé Demo CoinGecko (optionnelle) » dans la section **Clés API**
existante de `SettingsPanel`, écrivant dans `axiom.coingecko.demoApiKey` —
stockage déjà lu par `data/macro/coingecko.ts` et `data/marketOverview.ts`, mais
jusqu'ici non renseignable depuis l'UI. Libellé d'aide : accélère le backfill et
relève les quotas ; tout fonctionne sans.

---

## 5. Vérification

**Unitaires** (`pnpm --filter @axiom/web test`) :

- `grilleJournaliere` : dédoublonnage du point « maintenant », normalisation UTC.
- `alignerSurGrille` : forward-fill dans la plage, 0 avant le premier point, trou
  interne comblé.
- `reconstruireTotal` : somme correcte, `k` appliqué à toute la série, `k = 1` et
  `recalibre: false` si la somme courante est nulle.
- `dominance` : invariance d'échelle (multiplier numérateur **et** dénominateur ne
  change rien), `null` sur total 0 / NaN.
- TOTAL2 / TOTAL3 / `dominanceAlts`.
- `attenteApres429` : `Retry-After` prioritaire, repli exponentiel plafonné à 60 s.
- `compacter` : un point par jour au-delà de 48 h, tout conservé en deçà, ordre
  croissant, plafond respecté.
- `seed` : fusion sans doublon, pas d'écrasement d'un échantillon temps réel.
- `mcapWindow.util` : ticks, projection index → x, hit-test.

**Cohérence bout en bout** — un test sur fixtures qui rejoue la reconstruction et
vérifie qu'au **dernier point** le TOTAL reconstruit égale le `/global` fourni et
que BTC.D retombe sur `market_cap_percentage.btc` à 0,1 point près. C'est ce test
qui attrape l'erreur « divisé par la somme non recalibrée ».

**E2E Playwright** : `CAP` dans la palette ouvre la fenêtre ; les trois canvas
sont présents ; l'ajout d'une dominance (SOL) fait apparaître une pastille.

**Gate visuel navigateur** en fin de lot — obligatoire : les tests unitaires ne
voient ni un axe illisible, ni un réticule décalé, ni une courbe écrasée contre
le cadre.

---

## 6. Limites assumées, écrites dans le code

- **365 jours maximum** en gratuit (`error_code 10012` vérifié). Aucun contournement
  sans plan Pro ; la fenêtre le dit dans sa note de source.
- **Le backfill complet des 100 pièces n'a pas été exécuté de bout en bout** : trois
  tentatives ont été bloquées par le quota keyless (épuisé par les sondes de la
  session). La chaîne a été vérifiée sur **5 pièces réelles** — c'est ce qui répondait
  à la seule question ouverte (l'alignement de payloads réels entre pièces) ; le reste
  (recalibrage, dominance) est vrai par construction et verrouillé en test unitaire.
- Le recalibrage est un **facteur constant** : il corrige le niveau, pas la dérive
  de la part de la longue traîne au fil de l'année. L'erreur croît en remontant le
  temps.
- Les fournisseurs divergent entre eux : CoinPaprika annonçait 56,15 % de dominance
  BTC quand CoinGecko annonçait 56,62 % au même instant. Un demi-point d'écart
  méthodologique est le plancher de précision, indépendamment de la reconstruction.
- Dominance proposée pour le **top 100** seulement — au-delà, le poids de la pièce
  est inférieur au bruit du recalibrage.
