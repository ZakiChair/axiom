# AXIOM — Plan d’action post-revue globale

> **Date :** 2026-08-24
>
> **Statut :** approuvé, exécution différée
>
> **Point de départ :** `main` à `8348c54` avant ajout du présent plan
>
> **But :** faire passer AXIOM de « code-complete et très riche » à « stable, honnête et validé en conditions réelles ».

---

## 1. Décision de pilotage

Aucune nouvelle fenêtre ni fonctionnalité de surface ne doit être ajoutée avant la clôture du gate G100.

Règles d’exécution :

1. Un problème fonctionnel par lot et par commit autant que possible.
2. Écrire d’abord un test qui reproduit le défaut lorsque l’infrastructure le permet.
3. Ne pas ajouter de dépendance sans nécessité démontrée.
4. Préserver les invariants renderer-first : WebSockets marché directs, daemon hors chemin chaud, données haute fréquence hors state React.
5. Chaque lot doit être livrable, testable et réversible indépendamment.
6. Un lot n’est terminé qu’après tests ciblés, `pnpm check` et vérification manuelle adaptée.

### Ordre des lots

| Ordre | Lot | Priorité | Résultat attendu |
|---:|---|---|---|
| 0 | Vérité documentaire | P0 | Une source de vérité cohérente |
| 1 | Stabilité runtime | P0/P1 | L’application tient réseau lent et arrière-plan |
| 2 | Vérité du backtest | P1 | Les métriques et stratégies ne prêtent plus à confusion |
| 3 | Cohérence multi-chart | P1 | Chaque slot affiche uniquement ses propres données |
| 4 | QA, CI et G100 | P0 | Validation reproductible et verdict produit |
| 5 | Mémoire longue | P2 | Données et configuration durables |
| 6 | Optimisation opérationnelle | P2/P3 | Build et environnement reproductibles |

Dépendances :

```text
Lot 0
  └── Lot 1
        ├── Lot 2 ──┐
        ├── Lot 3 ──┼── Lot 4 / verdict G100
        └── Lot 4a ─┘
                       ├── Lot 5
                       └── Lot 6
```

`Lot 4a` désigne la préparation des tests déterministes et de la CI ; le verdict G100 final attend les Lots 1 à 3.

---

## 2. Baseline vérifiée le 2026-08-24

- `pnpm check` : PASS.
- Typecheck : PASS sur les workspaces.
- Tests unitaires/intégration : **4 012 PASS**.
- Build web : PASS.
- Bundle principal : **1,10 Mo minifié / 322,54 ko gzip**, avertissement Vite > 500 ko.
- `pnpm audit --prod` : aucune vulnérabilité connue.
- Playwright complet : **31/33 PASS** au premier passage.
  - G6 Screener n’a pas atteint « Terminé » dans le seuil de 15 s.
  - MAP est resté bloqué sur « Chargement… ».
- Relance ciblée des deux fichiers concernés : **3/3 PASS**.
- Conclusion E2E : câblage fonctionnel, mais dépendance réseau live non déterministe.
- Gate G100 manuel : toujours ouvert, notamment G1 (coupure réseau + tenue prolongée).

Cette baseline doit être conservée pour comparer les résultats de fin de programme.

---

## 3. Lot 0 — Rétablir la source de vérité

**Priorité : P0 · Complexité : faible · Préalable obligatoire**

### Tâches

- [ ] Mettre à jour `BUILD-CONTRACT.md` :
  - [ ] 179 indicateurs au lieu du jalon historique de 7 ;
  - [ ] sources multi-exchanges ;
  - [ ] paper trading réellement présent ;
  - [ ] état actuel du multi-chart et du daemon ;
  - [ ] séparer les décisions toujours verrouillées des jalons historiques.
- [ ] Corriger le README :
  - [ ] mentionner la CI GitHub ;
  - [ ] clarifier le statut du paper trading ;
  - [ ] décrire G100 comme automatisé partiellement mais encore non validé manuellement.
- [ ] Donner au tableau G100 trois états explicites : `NON EXÉCUTÉ`, `PASS`, `FAIL`.
- [ ] Reporter la baseline ci-dessus dans la documentation de gate si elle n’y figure pas déjà.

### Critère de sortie

Un nouvel agent doit pouvoir lire uniquement `BUILD-CONTRACT.md`, le README et le protocole G100 sans recevoir d’instruction contradictoire.

### Vérification

```bash
pnpm check
```

---

## 4. Lot 1 — « Tient » : stabilité runtime

### 4.1 Cycle de vie de l’onglet

**Priorité : P0/P1 · Complexité : moyenne**

#### Tâches

- [ ] Créer un module léger de cycle de vie navigateur :
  - [ ] état `visible` / `hidden` ;
  - [ ] abonnement unique à `visibilitychange` ;
  - [ ] helper d’intervalle suspendable.
- [ ] Suspendre en arrière-plan les pollers non critiques :
  - [ ] FUNDX ;
  - [ ] MAP ;
  - [ ] TERM / OMON ;
  - [ ] Twelve Data ;
  - [ ] Globe / OpenSky ;
  - [ ] rafraîchissements d’overlays non nécessaires aux alertes.
- [ ] Définir et tester la politique d’alertes :
  - [ ] onglet visible → notification front ;
  - [ ] onglet masqué au-delà du seuil → relais daemon ;
  - [ ] retour visible → heartbeat immédiat ;
  - [ ] aucune double notification.
- [ ] Documenter explicitement les pollers autorisés à rester actifs en fond.

#### Critères de sortie

- Aucun poller non critique ne fait de requête pendant un onglet masqué.
- Le daemon prend le relais après le seuil prévu.
- Aucune notification en double.
- Les tests simulent horloge et changement de visibilité.

### 4.2 Deadlines et vraie annulation

**Priorité : P1 · Complexité : moyenne à forte**

#### Tâches

- [ ] Introduire un helper sans dépendance basé sur `AbortController` :
  - [ ] timeout explicite et annulable ;
  - [ ] composition avec le signal appelant ;
  - [ ] erreur normalisée ;
  - [ ] nettoyage systématique du timer.
- [ ] Corriger MAP :
  - [ ] rendre l’overview immédiatement depuis le cache ;
  - [ ] charger Fear & Greed séparément comme enrichissement optionnel ;
  - [ ] ne jamais bloquer la treemap sur cet enrichissement.
- [ ] Corriger le Screener :
  - [ ] propager un `AbortSignal` à toutes les requêtes ;
  - [ ] imposer une deadline globale compatible avec G6 ;
  - [ ] terminer réellement le worker sur « Annuler » ;
  - [ ] annuler le run précédent avant d’en démarrer un nouveau.
- [ ] Auditer les autres `Promise.all` où une source optionnelle peut bloquer une donnée principale.

#### Critères de sortie

- MAP s’affiche depuis son cache même si Fear & Greed ne répond jamais.
- « Annuler » ne laisse aucun worker ni fetch actif.
- Un fournisseur suspendu produit une erreur contrôlée, jamais un chargement infini.
- G6 termine ou échoue explicitement avant son seuil, sans état bloqué.

### 4.3 Quotas et maintenance daemon

**Priorité : P1 · Complexité : moyenne**

#### Tâches

- [ ] Appliquer réellement la limite Twelve Data de 800 crédits/jour :
  - [ ] bloquer avant le crédit 801 ;
  - [ ] afficher un toast explicite ;
  - [ ] marquer la source `quota épuisé` ;
  - [ ] reprendre automatiquement au changement de jour UTC.
- [ ] Côté daemon :
  - [ ] lire `Retry-After` ;
  - [ ] placer la source concernée en cooldown ;
  - [ ] ne pas faire de retry aveugle ;
  - [ ] appeler `purgerExpires()` depuis la boucle d’entretien horaire ;
  - [ ] exposer quota et cooldown pertinents dans `/health`.

#### Critères de sortie

- Le compteur Twelve Data ne dépasse jamais 800.
- Une source en 429 n’est plus sollicitée pendant son cooldown.
- Les entrées de cache expirées sont purgées périodiquement.

### Vérification du lot 1

```bash
pnpm --filter @axiom/web test
pnpm --filter @axiom/web typecheck
pnpm --filter @axiom/daemon test
pnpm check
```

Ajouter des scénarios Playwright déterministes pour MAP, Screener et la politique visible/hidden lorsque possible.

---

## 5. Lot 2 — « Ne ment pas » : vérité du backtest

### 5.1 Drawdown

**Priorité : P1 · Complexité : moyenne**

#### Tâches

- [ ] Correction immédiate : renommer la métrique actuelle en « Drawdown réalisé aux sorties ».
- [ ] Ajouter un test de non-régression :
  - entrée long à 100 ;
  - baisse à 50 pendant la position ;
  - remontée à 110 ;
  - sortie gagnante ;
  - drawdown attendu non nul.
- [ ] Construire une equity mark-to-market à chaque clôture de bougie.
- [ ] Inclure le P&L latent de la position ouverte.
- [ ] Calculer le vrai drawdown depuis cette série.
- [ ] Conserver séparément l’equity réalisée si utile à l’UI ou aux exports.
- [ ] Ajouter MAE/MFE uniquement après stabilisation du mark-to-market.

#### Critères de sortie

- Le scénario baisse puis récupération ne peut plus afficher 0 % de drawdown.
- Le libellé UI précise la convention de calcul.
- Les exports et graphiques utilisent la même convention.

### 5.2 Stratégies chart versus exécution

**Priorité : P1 · Complexité : moyenne**

#### Tâches

- [ ] Ajouter aux presets une métadonnée : `fidèle`, `approximation` ou `signal uniquement`.
- [ ] Renommer les presets concernés avec le préfixe `Approx.`.
- [ ] Afficher les différences exactes :
  - [ ] sorties ET versus OU ;
  - [ ] long-only versus long/short ;
  - [ ] stop ajouté ;
  - [ ] frais, slippage et fill open+1.
- [ ] Ajouter l’expectancy à la grille de résultats.
- [ ] Ajouter un split in-sample / out-of-sample adapté à `TradeResultat`.
- [ ] Ne pas étendre immédiatement le DSL en moteur stateful complexe.

#### Critères de sortie

- Aucun preset BT ne porte le même nom qu’une stratégie chart différente sans signaler l’approximation.
- Le rapport exporté contient le modèle d’exécution.
- Les résultats in-sample et out-of-sample sont distingués.

### Vérification du lot 2

```bash
pnpm --filter @axiom/backtest test
pnpm --filter @axiom/web test
pnpm check
```

---

## 6. Lot 3 — Cohérence multi-chart

**Priorité : P1 · Complexité : forte**

### Tâches

- [ ] Définir un contrat commun de contrôleur :
  - [ ] instance de chart ;
  - [ ] store du slot ;
  - [ ] identité exchange / symbole / timeframe ;
  - [ ] cycle `sync` / `dispose`.
- [ ] Migrer les singletons restants :
  - [ ] marqueurs de trades et notes ;
  - [ ] bulles whales ;
  - [ ] marqueurs backtest ;
  - [ ] événements économiques.
- [ ] Corriger la navigation depuis les panneaux :
  - [ ] agir sur le slot ayant le focus ;
  - [ ] ne plus supposer automatiquement le slot maître.
- [ ] Pour les contrôleurs lourds :
  - [ ] soit les rendre compatibles avec chaque slot ;
  - [ ] soit afficher « chart maître uniquement » et désactiver l’action sur un secondaire.
- [ ] Ajouter un test de cycle de vie garantissant qu’un changement de focus ne laisse aucun overlay orphelin.

### Scénario d’acceptation

En grille BTC / ETH / SOL :

1. focus ETH ;
2. les marqueurs affichés appartiennent à ETH ;
3. une navigation depuis LIQ ou ECO agit sur ETH ;
4. aucun overlay BTC ne fuit sur le slot ETH ;
5. le changement de focus nettoie correctement l’ancien slot.

### Vérification

```bash
pnpm --filter @axiom/web test
pnpm --filter @axiom/web typecheck
pnpm check
```

Ajouter un E2E déterministe multi-slot.

---

## 7. Lot 4 — QA, CI et clôture G100

### 7.1 Séparer les suites E2E

**Priorité : P0 · Complexité : moyenne**

Créer trois commandes :

```text
test:e2e:deterministic
test:e2e:live
test:gate
```

#### Suite déterministe

- [ ] Bouchonner toutes les APIs externes.
- [ ] Ne dépendre d’aucun RSS, CoinGecko ou Binance réel.
- [ ] Exécuter cette suite dans la CI à chaque PR.
- [ ] Conserver les tests structurels existants.

#### Suite live

- [ ] Conserver G6 et les critères dépendants des fournisseurs.
- [ ] Distinguer explicitement panne réseau, quota, timeout et régression UI.
- [ ] Conserver les résultats comme preuve opérationnelle.

#### Suite manuelle

- [ ] G1 : coupure réseau puis tenue prolongée.
- [ ] G5 : bannière macOS / Telegram.
- [ ] Interactions canvas non déterministes.
- [ ] Jugement visuel des badges et couches de liquidations.

### 7.2 Reproductibilité

- [ ] Épingler Bun sur la version validée localement et en CI.
- [ ] Conserver Node 22 comme référence CI.
- [ ] Ajouter les versions supportées dans le contrat de build.
- [ ] Ne pas mélanger cette stabilisation avec une migration majeure React/Vite/KLineChart.

### 7.3 Verdict G100

- [ ] Exécuter G1 à G10.
- [ ] Reporter chaque résultat dans le protocole.
- [ ] Laisser le gate ouvert au premier `FAIL`.
- [ ] Pour chaque échec, consigner scénario, logs, capture et correction attendue.
- [ ] Après correction, rejouer le gate entier, pas seulement le test concerné.
- [ ] Documenter la décision produit finale.

### Critère de sortie

Le tableau G100 ne contient plus de case indéterminée et la décision produit est étayée par des preuves reproductibles.

---

## 8. Lot 5 — Mémoire longue

**Priorité : P2 · Complexité : forte · À commencer après le verdict G100**

### Tâches

- [ ] Historiser les bougies Twelve Data et Coinalyze via `candlesPush`.
- [ ] Ajouter rétention, déduplication et bornes par source / symbole / timeframe.
- [ ] Étendre le miroir daemon aux états critiques, dans cet ordre :
  - [ ] `macroHistory` ;
  - [ ] dessins ;
  - [ ] workspaces ;
  - [ ] journal paper ;
  - [ ] notes importantes.
- [ ] Historiser FUNDX ou le renommer explicitement « snapshot live ».
- [ ] Tester la restauration après suppression complète du `localStorage`.
- [ ] Exposer la taille et les bornes de rétention dans `/health`.

### Critères de sortie

- Un profil navigateur vierge peut être restauré depuis le daemon.
- Un historique récemment observé reste disponible après disparition de la source externe.
- La taille SQLite reste bornée et observable.

---

## 9. Lot 6 — Optimisation opérationnelle

**Priorité : P2/P3 · À traiter après G100**

### Tâches

- [ ] Analyser le chunk initial de 1,10 Mo.
- [ ] Retarder le chargement des contrôleurs ou registres non nécessaires au boot.
- [ ] Définir un budget de bundle et un contrôle non bloquant, puis le resserrer progressivement.
- [ ] Planifier séparément les migrations majeures React, Vite, Vitest, Zustand et KLineChart.
- [ ] Ne pas effectuer de mise à niveau globale tant que l’audit de production reste propre.
- [ ] Vérifier périodiquement `pnpm audit --prod`.

### Critère de sortie

Le démarrage initial ne charge que les fonctions nécessaires au chart et aux surfaces visibles, sans compromettre la simplicité du terminal local.

---

## 10. Séquence de commits recommandée

1. `docs: aligner contrat, README et gate G100`
2. `fix(web): suspendre les pollers et transférer les alertes en arrière-plan`
3. `fix(web): ajouter deadlines et annulation réelle`
4. `fix(data): appliquer quotas et cooldowns`
5. `fix(backtest): rendre le drawdown et les stratégies explicites`
6. `fix(chart): scoper les overlays au slot actif`
7. `test(e2e): séparer suites déterministes et live`
8. `ci: lancer les e2e déterministes et épingler Bun`
9. `docs: enregistrer le verdict G100`
10. `feat(data): étendre la mémoire longue`

Les commits 2 à 4 peuvent être séparés davantage si les diffs deviennent difficiles à relire.

---

## 11. Définition de terminé commune

Un lot est terminé uniquement si :

- [ ] un test reproduit le défaut avant correction lorsque possible ;
- [ ] les tests ciblés sont verts ;
- [ ] `pnpm check` est vert ;
- [ ] les E2E déterministes concernés sont verts ;
- [ ] une vérification manuelle couvre le comportement live lorsque nécessaire ;
- [ ] aucun nouveau warning n’est laissé sans explication ;
- [ ] la documentation métier est alignée ;
- [ ] le diff Git reste limité au périmètre du lot.

---

## 12. Non-objectifs avant G100

- Nouvelle fenêtre.
- Nouveau fournisseur sans remplacement direct d’une source défaillante.
- Migration React 19, Vite 8, Zustand 5 ou KLineChart 10.
- Refactorisation générale du catalogue d’indicateurs.
- Fusion complète des moteurs « signal chart » et « exécution backtest ».
- Nouveau backend ou changement de l’architecture renderer-first.

**Point de départ à la prochaine session : Lot 0, puis Lot 1. Aucun travail du Lot 5 ou 6 ne doit retarder la clôture du Lot 4.**
