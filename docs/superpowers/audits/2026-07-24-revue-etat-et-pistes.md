# AXIOM Terminal — Revue d'état et pistes d'amélioration

**Date :** 2026-07-24 · **Méthode :** revue inline (lecture du code + exécution du gate `pnpm check`), sans sous-agents.
**Périmètre :** monorepo complet à `5a04b2f` (main, arbre propre), 140 821 lignes TS/TSX, 357 fichiers de test (339 itemisés par vitest + 18 côté daemon, que `bun test` ne détaille pas).
**Filtre appliqué :** chaque piste ci-dessous a été confrontée aux anti-objectifs de `BUILD-CONTRACT.md` et aux 9 anti-recommandations de `docs/research/03`. Rien de ce qui suit ne demande Electron, Docker/Redis, un proxy WS, un SharedWorker, un recorder 24/7, une abstraction de moteur de chart, ni une dépendance nouvelle.

---

## 1. Verdict

**La qualité d'exécution est au-dessus de la moyenne, et ce n'est pas une politesse : c'est mesuré.**

| Mesure | Valeur observée |
|---|---|
| `pnpm check` | **exit 0** — typecheck + tests + build |
| Tests | **2 993 verts, 0 échec** (indicateurs 494 · web 2 196 · daemon 238 · backtest 31 · alertes 34) |
| Build front | 2,35 s, fenêtres code-splittées |
| `any` hors tests | **0** |
| `TODO`/`FIXME`/`@ts-ignore` | **0** (les 2 occurrences grep sont un symbole de test `XXXUSDT`) |
| Clés localStorage | 52, **toutes** préfixées `axiom:`, la plupart versionnées `:v1` |
| Garde-fous anti-dérive | `lib/gardeFous.test.ts` **existe et mord** (hex interdits dans `chart/`, allowlist scopée à l'expression) |

Le problème d'AXIOM aujourd'hui n'est donc **pas** la dette technique. C'est un **déséquilibre entre la vitesse d'ajout de surface et la vitesse de validation de cette surface** — et deux angles morts opérationnels que les tests unitaires, par construction, ne peuvent pas voir : le **budget d'API** et la **distinction périmé/cassé**.

Les constats sont classés en trois familles : **(a)** révélé par le code et absent des docs · **(b)** affirmation de doc devenue fausse · **(c)** repriorisation d'un item déjà connu.

---

## 2. Constats classés, par ordre de valeur

### P1 — Le gate G100 n'a jamais été clôturé, et deux lots ont été empilés par-dessus · (b)

Le projet a défini lui-même sa barre de valeur : 10 critères G1–G10 dans `docs/superpowers/plans/2026-07-13-cible-100-usd-mois.md` §14. L'automatisation est **réelle et verte** : 16 tests Playwright (G2/G3/G4/G6/G7/G8/G10) + `scripts/gate/g5-daemon-journal.sh` + `g9-up-smoke.sh`, premiers runs 16/16 PASS ×2, G5 PASS ×2, G9 PASS ×3.

Mais dans `2026-07-22-gate-g100-qa.md`, **toutes** les cases du noyau manuel §2 sont vides : coupure réseau 90 s, veille G1 de 30 min, alerte onglet fermé (G5), chrono screener ≤ 15 s (G6), onboarding ≤ 5 min (G10). Et les 3 tâches de clôture §3 (E2.1 reporter PASS/FAIL, E2.2 statuts définitifs, E2.3 README) sont vides aussi. Le tableau §14 dit encore « code-complete · **manual QA** » sur les 10 lignes.

Depuis cette date, **deux lots** ont été livrés en main : Lot A + screener signaux (23/07), Lot v2.0 « Analyse » (24/07). La surface a grandi ; la barre n'a pas été franchie.

C'est le constat n°1 non parce que du code manque, mais parce que **~30 minutes d'attention réelle transformeraient « je crois que ça vaut 100 $/mois » en « je l'ai vérifié »** — et le protocole est déjà écrit, il n'y a qu'à le dérouler.

**Et surtout : P1 n'est pas une case à cocher séparée des autres constats — c'est leur vérification.** Les 16 tests Playwright couvrent ce qui *peut* s'automatiser ; chaque case restée vide est précisément un critère qui exige d'observer un comportement réel — coupure réseau, dérive sur 30 min de live, notification reçue onglet fermé. Ce sont exactement les classes de défaillance décrites en P2, P3 et P4. Dérouler le noyau manuel **valide trois des quatre autres constats de cette revue** en une seule session.

> **Vérification :** les 10 lignes du §14 portent un PASS ou un FAIL daté, et les 3 cases §3 sont cochées.

---

### P2 — Le quota Twelve Data est compté et affiché, mais jamais appliqué · (a)

`data/twelvedata.ts` fait très bien la moitié du travail : limiteur 8 req/min à fenêtre glissante qui **attend** un créneau plutôt que de se faire jeter en 429, compteur journalier persisté (`axiom:twelvedata:daily:v1`) avec reset à minuit UTC, publication du quota dans `store/health` (« 142/800 j »).

Ce qui manque : **rien ne réagit quand le budget se vide.** Le compteur monte, s'affiche, et c'est tout.

Le calcul est défavorable, parce que le coût est **1 crédit par symbole**, pas par requête. Vérifié dans le code, pas supposé : `fetchQuotes` groupe bien les symboles en **une** requête HTTP (`symbol: symbols.join(",")`) mais fait `for (let i = 0; i < symbols.length; i++) await acquireSlot()`, et `acquireSlot` appelle `reportQuota()` → `bumpDailyCount()` **à chaque créneau**. La comptabilité interne est donc bien de N crédits par cycle, conforme au modèle de facturation par symbole que l'auteur a documenté en commentaire.

| Symboles tradfi en watchlist | Crédits/min à `TRADFI_POLL_MS` = 60 s | 800 crédits épuisés en |
|---|---|---|
| 1 | 1 | ~13 h |
| 5 | 5 | **~2 h 40** |
| 10 | 10 | **~1 h 20** |

À quoi s'ajoutent les `fetchKlines` du graphe, sur le **même budget de compte**. Un onglet laissé ouvert une matinée avec une watchlist tradfi fournie épuise la journée ; l'opérateur l'apprend quand le bandeau tradfi s'éteint — c'est-à-dire trop tard, le budget est consommé et le reset est à minuit UTC.

Nuance importante, et elle joue **contre** nous : mettre l'onglet en arrière-plan ne sauve rien ici. Les navigateurs plafonnent les timers de fond à ~1/min — un poller déjà à 60 s est donc **inchangé**. Le budget continue de brûler sur un onglet que personne ne regarde.

Effet de bord au-delà de 8 symboles tradfi : un cycle réclame plus de 8 créneaux, donc plus d'une minute à 8 req/min. Le poller ne rattrape jamais sa cadence et sature en permanence la chaîne de débit **partagée** — les `fetchKlines` du graphe attendent derrière.

> **Vérification :** watchlist chargée en tradfi, compteur forcé près de 800 → la cadence se dégrade (ou le poller s'arrête) **avant** l'épuisement, et un toast le dit.

---

### P3 — Aucune conscience de visibilité : 40 `setInterval`, 0 `visibilitychange` · (a)

Recherche exhaustive : `visibilitychange` et `document.hidden` sont **absents** de tout `apps/web/src`. Les 40 timers tournent tant que le composant est monté, que la fenêtre soit regardée ou non.

Tous ne se valent pas — le tri compte :

| Cadence | Timers | Enjeu réel |
|---|---|---|
| 5 s | `alerts/runtime` cascade liq, `data/mexc` | CPU en continu ; le plafonnement navigateur en arrière-plan les protège |
| 30–60 s | ticker crypto, **ticker tradfi**, **twelvedata**, Derivatives (Coinalyze), Options, TermStructure, FundingMatrix | **Quota** — et le plafonnement navigateur ne les ralentit pas |
| 1 s | SymbolBanner, HealthPanel, NewsWindow | Cosmétique (horloges) — négligeable |
| ≥ 3 min | news, opensky, gdelt, MarketMap, MacroPanel, régime | Négligeable |

La ligne qui compte est la deuxième : ce sont exactement les hôtes à quota. P2 et P3 sont donc **le même problème vu par deux bouts**, et se règlent au même endroit.

Le socle existe déjà : `data/pollLoop.ts` sait faire du backoff (`MAX_POLL_BACKOFF_MS`) et écrit dans `health`. Il est simplement contourné par les fenêtres qui posent leur `setInterval` en direct.

> **Vérification :** onglet masqué 10 min → le compteur journalier Twelve Data n'a pas bougé ; onglet réaffiché → rafraîchissement immédiat.

---

### P4 — « Périmé » et « cassé » sont indiscernables sur une partie de la couche data · (a)

221 `catch {` hors tests. La grande majorité est **légitime et documentée** : lecture/écriture localStorage best-effort, daemon optionnel qui renvoie `null` (c'est l'invariant « UI utilisable sans daemon », il est respecté). Il ne s'agit pas de les supprimer.

La sous-classe problématique est celle-ci, dont `data/marketOverview.ts:351` est l'archétype :

```ts
} catch {
  return cached?.data ?? null;   // échec réseau → on ressert le cache, sans le dire
}
```

Le panneau affiche une valeur. Elle est vieille. Rien à l'écran ne le signale. Sur un terminal de décision, c'est le pire mode de défaillance : pas une erreur, une **fausse fraîcheur**.

Le registre `store/health` est bien conçu pour ça (états `connected`/`stale`/`error`, `derniereErreur`, quota) et 20 modules l'alimentent. Mais le déséquilibre par module est net :

| Module | `catch` | écritures `health` |
|---|---|---|
| `liquidations.ts` | 5 | **0** |
| `twelvedata.ts` | 4 | **0** |
| `binance.ts` | 4 | **0** |
| `bybit` / `okx` / `kraken` / `hyperliquid` / `breadth` | 3 chacun | **0** |
| `marketOverview.ts` | 5 | 2 |

Ces modules peuvent échouer sans que le registre — donc HealthPanel et SessionStrip — n'en sache rien.

> **Vérification :** le test « coupure réseau 90 s » déjà prévu au §2 du protocole QA. Chaque panneau ouvert doit passer visiblement en stale ou en erreur ; aucun ne doit continuer à afficher un chiffre d'aplomb.

---

### P5 — La doctrine de fiabilité couvre 3 fenêtres sur 36 · (a)

`lib/fiabilite.ts` porte une vraie doctrine, écrite noir sur blanc : « toute métrique 🟡/🔴 doit afficher un badge honnête : jamais présenter un flux dégradé, throttlé ou un modèle comme un fait ». C'est le garde-fou anti-« heatmap maison » de l'anti-recommandation #7, et le critère G2.

Consommateurs réels : `OnchainWindow`, `ScreenerWindow`, `DerivativesWindow` (+ `ui.tsx` et `data/signaux.ts`). **3 fenêtres sur 36.**

G2 ne visait que DES/CHAIN/liq, donc ce n'est pas une régression sur le périmètre du gate. Mais une quinzaine de fenêtres ont atterri depuis (EVTS, SCEN, SQZ, OMON, REVENUE, PORT, RATE, TERM, VOL, COT, GLOBE…), dont plusieurs affichent des **modèles** et non des faits — SCEN produit un P&L estimé à partir de bêtas roulants, EVTS des médianes d'échantillon, les niveaux de liquidation sont explicitement des estimations. Ce sont précisément les cas que la doctrine vise.

Le précédent est instructif : la revue UI du 16/07 avait constaté que le standard de couleurs re-dérivait faute de verrou automatique. La réponse — `gardeFous.test.ts` — **a tenu**. Le même verrou n'existe pas pour la couverture des badges.

> **Vérification :** un test à la `gardeFous` qui énumère les fenêtres affichant une métrique modélisée et échoue si l'une d'elles n'appelle pas `metaSource`.

---

### P6 — Trois fenêtres sans garde anti-réponse-périmée · (a, faible)

20 fenêtres sur 36 ont un `AbortController` ou un drapeau `annule`. Trois font un chargement asynchrone sans aucune des deux : `CorrWindow.tsx`, `MacroRatesWindow.tsx`, `OptionsWindow.tsx`. Un changement rapide de symbole ou d'onglet peut y faire atterrir une réponse obsolète par-dessus la bonne.

C'est faible en sévérité, mais c'est la même famille que le piège déjà rencontré sur `paperStore` (abonnement par signature structurelle) : dans ce codebase, ce mode de défaillance est **vivant**, pas théorique.

> **Vérification :** changer de symbole 5 fois en 2 s, la valeur affichée correspond au dernier symbole.

---

### P7 — Dérives documentaires mineures · (b)

- `README.md` : « Pas de CI distante imposée » — `.github/workflows/ci.yml` existe depuis le 24/07 et rejoue `pnpm check` sur push/PR.
- `README.md` §Fonctionnalités : la liste des panneaux s'arrête avant SIG, EVTS, SCEN, SQZ, OMON.

> **Vérification :** relecture du README après clôture de P1 (E2.3 le prévoit déjà).

---

## 3. Ce que j'ai cherché et **pas** trouvé

À signaler, parce que ce sont les reproches habituels et qu'ils ne s'appliquent pas ici :

- **Fuite mémoire en session longue** : les chemins chauds sont bornés (`MAX_CANDLES` 5000, `MAX_FOOTPRINT_CANDLES` 120, `MAX_COLONNES` 1800, `MAX_BULLES` 200, `MAX_JOURNAL` 100…). Les tableaux repérés sans cap dans `chart/` sont des constructions par calcul à partir d'entrées déjà bornées, pas des accumulateurs.
- **Secrets dans l'historique git** : aucun `.env` ni fichier de credentials n'a jamais été traqué ; aucune clé en dur dans les sources.
- **Anarchie localStorage** : convention `axiom:` respectée sur les 52 clés, versionnement `:v1` majoritaire, migrations douces présentes (`migratePersistedIndicators`, watchlist ancien format).
- **Dérive du standard de couleurs** : `gardeFous.test.ts` la bloque ; les 22 hex restants dans `chart/` sont des formes de repli explicitement allowlistées.
- **`any` / dette de typage** : zéro, avec `noUncheckedIndexedAccess` actif.

---

## 4. Pistes, dans l'ordre où je les prendrais

**1. Clôturer G100** (P1) — ~30 min d'attention, protocole déjà écrit, rien de nouveau à coder. C'est le meilleur rapport valeur/effort de la liste : ça tranche la question « est-ce que ça vaut 100 $/mois », **et** la coupure réseau 90 s + la veille 30 min mesurent directement P3 et P4. À faire avant de coder quoi que ce soit d'autre — le résultat peut réordonner le reste.

**2. Un ordonnanceur de polling unique** (P2 + P3) — router les timers à quota (ticker tradfi, twelvedata, Coinalyze, Options, TermStructure, FundingMatrix) à travers `pollLoop`, et lui ajouter deux entrées : l'état de visibilité du document et le budget restant de la source. Trois comportements : pause en arrière-plan pour les cadences courtes, dégradation de cadence quand le budget journalier passe sous un seuil, arrêt franc + toast à l'épuisement. Compatible contrat (aucune dépendance, aucun backend), et ça remplace ~10 `setInterval` dispersés par un point d'entrée testable.

**3. Doctrine « périmé vs cassé »** (P4) — faire écrire dans `health` les modules à `catch=N/health=0`, et afficher la fraîcheur là où une valeur peut venir d'un cache de repli. Le vrai livrable est le test de coupure réseau 90 s, qui devient la vérification permanente.

**4. Généraliser le badge de fiabilité** (P5) — étendre le catalogue `fiabilite.ts` aux fenêtres à modèle (SCEN, EVTS, niveaux de liquidation en priorité), et poser le garde-fou automatique qui empêche la prochaine dérive.

**5. Les trois gardes anti-stale** (P6) — une heure, mécanique.

~~Ensuite seulement, les dettes déjà cataloguées dans `docs/research/03`…~~

**Correction (même jour, après vérification) : les 6 dettes indicateurs de `docs/research/03` sont SOLDÉES.** Cette revue les citait comme travail restant sur la foi du document, sans vérifier le code — à tort. Toutes ont du code et des tests livrés : throttle intra-bougie à 500 ms, input `source` câblé avec test de conformité dynamique, pivots sessionnés sur les 5 variantes, VWAP à reset UTC, AVWAP ancrée par timestamp avec picker de clic, 27 defs `derivatives` (NVT/MVRV/MVRV-Z inclus), goldens ADX/SuperTrend/Ichimoku/PSAR, `fundingZScore`, CVD spot/perp, famille ATR. Détail et preuves : section « Indicateurs — dettes » de `docs/research/03`, réécrite.

Il en reste **deux décisions** (pas du code) : l'oracle golden est pandas-ta et non TradingView — reformulation conforme au contrat, des goldens TradingView demanderaient un export CSV manuel ; et le score de régime compose la vol **implicite** (DVOL) et non la vol réalisée, alors que `atrRegime` existe.

**Ce que ça révèle, et qui appartient à cette revue** : rien ne relie le code livré au catalogue de dettes. C'est exactement la classe de problème décrite en P5 — une doctrine sans verrou automatique dérive, ici dans le sens inverse (le doc réclame du travail déjà fait). Le coût n'est pas nul : ce catalogue périmé a orienté à tort les recommandations de cette revue avant correction.

**Note de priorisation** *(c)* : la roadmap place le multi-chart 2×2 et le DOM en Phase 4 « gros chantiers différenciants ». Je les laisserais après les 5 points ci-dessus — ajouter des charts live multiplie mécaniquement la charge de polling et de rendu, or l'ordonnanceur (piste 2) est justement le préalable qui rend ce chantier mesurable.

---

## 5. Ce que cette revue n'a pas couvert

- **Aucune vérification visuelle en app live** (pas de session runtime dans cette revue) : les constats d'affichage viennent de la lecture du code, pas de l'écran.
- **Qualité numérique des indicateurs** non re-auditée (494 tests golden verts pris pour acquis).
- **Comportement réel sous coupure réseau** non testé — c'est justement ce que P1 et P4 demandent d'exécuter.
