# CryptoQuant BASIC — flux takers toutes places (DES) et mineurs cotés (CHAIN) : plan d'implémentation

> **Pour les agents :** SOUS-SKILL REQUIS — utiliser superpowers:subagent-driven-development (recommandé) ou superpowers:executing-plans pour exécuter ce plan tâche par tâche. Les étapes utilisent la syntaxe de cases à cocher (`- [ ]`) pour le suivi.

**Objectif :** raccorder l'offre CryptoQuant BASIC du propriétaire à deux sections existantes — « Flux takers toutes places » dans DES (B1) et « Production des mineurs cotés » dans CHAIN (B2) — avec une route `/cqapi` à liste fermée sur les trois chemins, une clé personnelle, une archive côté client par série, sans nouvelle fenêtre ni variable serveur Vercel.

**Architecture :** trois clones du patron `/bgapi` (Vite dev, daemon `127.0.0.1`, fonction Vercel) durcis par un module partagé de chemins fermés (`shared/cryptoquant-proxy.ts`, patron DefiLlama Pro) ; un client en chunk à la demande (`apps/web/src/data/onchain/cryptoquant.ts`) qui cadence 10 req/min, court-circuite quand J-1 est déjà archivé, et fusionne chaque réponse dans une archive versionnée par série (localStorage ∪ KV daemon, jamais destructive) ; deux vues pures montées dans DES et CHAIN, repliées par défaut, chargées au montage de la fenêtre.

**Pile :** TypeScript strict (`noUncheckedIndexedAccess`), React + Zustand vanilla, Vite 6 (proxy dev, `define`), Bun (daemon, tests `bun test`), Vercel functions (`api/`), Vitest (web), Playwright (e2e hermétiques). Aucune dépendance nouvelle.

**Spec :** `docs/superpowers/specs/2026-09-16-cryptoquant-takers-mineurs-design.md` — le plan argumente depuis la spec ; l'exécutant lit les deux.

## Contraintes globales

- Français partout : commentaires, libellés, messages, commits. TDD strict : test rouge observé avant chaque implémentation ; `pnpm check` (typecheck + tests + build) vert avant chaque commit ; e2e via `scripts/ci.sh --e2e`.
- Aucune nouvelle dépendance, aucune fenêtre (39), aucun indicateur graphique (200), `EXCHANGE_IDS` à 9, `@axiom/types` inchangé, aucun hôte ajouté à `shared/extapi-hosts.ts`, CSP `connect-src` inchangée.
- Budget du bundle initial **bloquant** : 1 220 000 octets bruts / 360 000 gzip (marge runner ≈ 3 365 gzip) ; tout code nouveau en chunk à la demande ; le client CryptoQuant n'est importé que par `await import(...)` ; mesures avant/après consignées.
- Clé CryptoQuant **personnelle** : jamais dans le state, jamais exportée, jamais dans une URL, un log ou une raison d'erreur ; **aucune variable serveur sur Vercel** (test structurel `apps/daemon/src/vercelProxy.test.ts` : exactement une occurrence de `env[` dans `api/_policy.ts`) ; repli `.env` `CRYPTOQUANT_API_KEY` pour le proxy Vite et le daemon uniquement.
- Requêtes toujours `window=day&limit=30`, jamais `from`/`to` ; GET seul ; réponses `private, no-store` ; aucune entrée de cache proxy daemon (`TTL_SECONDES_PAR_PREFIXE` inchangé).
- Archive : une clé par série (`axiom:onchain:cq:<serie>:v1` / KV `onchain` `cq:<serie>:v1`), lecture = union locale ∪ KV (tri-état), jamais de suppression de jour, version inconnue jamais réécrite, exclue des sauvegardes JSON (préfixe dans `resteSurLePoste`), jamais de 0 pour une absence, trous affichés (perdus / manquants dans la fenêtre / J-1 en attente).
- Données fournisseur consommées telles quelles : aucun AggregationEngine, spot et perp jamais additionnés, ratios/VWAP jamais recalculés, `reported_production` brut (aucun écart %), Σ des 9 mineurs = somme d'affichage à 9/9 seulement. BGeometrics reste la source unique de MVRV-Z/SOPR/NUPL/Puell.
- Conventions UI (ratchet `uiConventions.test.ts`) : pas de `<table>` nu (TableTriable), SegmenteCompact, TuileStat, BadgeFiabilite en props libres (pas d'entrée catalogue `lib/fiabilite.ts`), SansCle, Vide, NoteSource ; formats de `lib/format.ts`.
- `BUILD-CONTRACT.md` et les docs de gouvernance ne sont modifiés qu'en tâche 1, sur ce brief explicite de l'orchestrateur ; toute divergence entre le plan et le code réel est remontée dans le rapport de tâche, pas corrigée en douce.
- Commits : un par tâche (sauf la tâche 17, qui commite la spec e2e puis la revue B1, et la tâche 19, dont la revue peut ajouter un commit `fix(chain)`), message en français, terminé par `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. Aucun push sans demande du propriétaire.

---

## Carte des fichiers

Tirée des blocs **Fichiers** des tâches (numéros de ligne retirés). Chaque fichier n'a qu'une responsabilité ; les fichiers créés sont en gras.

| Fichier | Action | Tâches |
|---|---|---|
| `BUILD-CONTRACT.md` | Modifier | 1 |
| `docs/csp-vercel.md` | Modifier | 1 |
| **`docs/superpowers/progress/2026-09-16-cryptoquant.md`** | Créer, Modifier, Tester | 1, 8, 16, 17, 19, 20 |
| **`apps/daemon/src/cryptoquantProxy.test.ts`** | Créer, Tester | 2 |
| `apps/daemon/tsconfig.json` | Modifier | 2 |
| `apps/web/tsconfig.json` | Modifier | 2 |
| **`shared/cryptoquant-proxy.ts`** | Créer | 2 |
| `api/_policy.ts` | Modifier | 3 |
| `api/proxy.ts` | Modifier | 3 |
| `apps/daemon/src/vercelProxy.redirection.test.ts` | Tester | 3 |
| `apps/daemon/src/vercelProxy.test.ts` | Tester | 3 |
| `vercel.json` | Modifier | 3 |
| `apps/daemon/src/cache.test.ts` | Tester | 4 |
| `apps/daemon/src/env.test.ts` | Tester | 4 |
| `apps/daemon/src/env.ts` | Modifier | 4 |
| `apps/daemon/src/proxy.test.ts` | Tester | 4 |
| `apps/daemon/src/proxy.ts` | Modifier | 4 |
| `apps/web/.env.example` | Modifier | 5 |
| `apps/web/src/viteConfig.test.ts` | Tester | 5 |
| `apps/web/vite.config.ts` | Modifier | 5 |
| **`apps/web/src/store/cryptoquant.test.ts`** | Créer, Tester | 6 |
| **`apps/web/src/store/cryptoquant.ts`** | Créer | 6 |
| `apps/web/src/store/persist.test.ts` | Tester | 7 |
| `apps/web/src/store/persist.ts` | Modifier | 7 |
| **`apps/web/src/components/SettingsPanel.cryptoquant.test.ts`** | Créer, Tester | 8 |
| `apps/web/src/components/SettingsPanel.tsx` | Modifier | 8 |
| **`apps/web/src/data/onchain/cryptoquant.test.ts`** | Créer, Modifier, Tester | 9, 10 |
| **`apps/web/src/data/onchain/cryptoquant.ts`** | Créer, Modifier | 9, 10, 11, 12, 13 |
| **`apps/web/src/data/onchain/cryptoquant-fetch.test.ts`** | Créer, Modifier, Tester | 11, 12, 13 |
| `apps/web/src/data/dataCockpit.test.ts` | Modifier | 13 |
| `apps/web/src/data/dataCockpit.ts` | Modifier | 13 |
| **`apps/web/src/components/fluxTakers.util.test.ts`** | Créer, Tester | 14 |
| **`apps/web/src/components/fluxTakers.util.ts`** | Créer | 14 |
| `apps/web/src/components/DerivativesWindow.tsx` | Modifier | 15 |
| **`apps/web/src/components/FluxTakersSection.test.tsx`** | Créer, Tester | 15 |
| **`apps/web/src/components/FluxTakersSection.tsx`** | Créer | 15 |
| **`apps/web/src/chunkCryptoquant.test.ts`** | Créer, Tester | 16 |
| **`apps/web/e2e/des-flux-takers.e2e.ts`** | Créer, Tester | 17 |
| `scripts/ci.sh` | Modifier | 17, 19 |
| `apps/web/src/components/onchain/Mineurs.tsx` | Modifier | 18 |
| **`apps/web/src/components/onchain/MineursCotes.test.tsx`** | Créer, Tester | 18 |
| **`apps/web/src/components/onchain/MineursCotes.tsx`** | Créer | 18 |
| **`apps/web/e2e/chain-mineurs-cotes.e2e.ts`** | Créer, Tester | 19 |

## Séquence et points de contrôle

| Sous-lot (spec §9) | Tâches | Point de contrôle |
|---|---|---|
| B1-0 contrat et rapport | 1 | `### Budget avant B1` consigné, arbre propre |
| B1-1 module partagé | 2 | tests bun du module verts |
| B1-2 trois proxys | 3, 4, 5 | `pnpm -r typecheck`, tests daemon et `viteConfig.test.ts` verts |
| B1-3 clé et Réglages | 6, 7, 8 | `### Budget après B1-3` |
| B1-4 client | 9 à 13 | invariants I1 à I10 côté client |
| B1-5 section DES | 14 à 17 | `### Budget après B1`, e2e `des-flux-takers`, **revue indépendante B1** (tâche 17) |
| B2 section CHAIN | 18, 19 | `### Budget après B2`, e2e `chain-mineurs-cotes`, **revue indépendante B2** (tâche 19) |
| Clôture | 20 | `pnpm check` + `scripts/ci.sh --e2e`, rapport complet, écarts actés, mémoire projet (orchestrateur) |

Toutes les tâches sont séquentielles. Les tâches 3, 4 et 5 touchent des fichiers disjoints, mais la tâche 4 laisse le typecheck du daemon rouge entre ses étapes, les tâches 3 et 5 exigent un typecheck vert, et les trois committent dans le même index : elles s'exécutent l'une après l'autre.

---

## Zone A — Contrat, module partagé et les trois proxys `/cqapi`

Toutes les commandes se lancent **depuis la racine du dépôt** (`pnpm --filter …` résout le paquet quel que soit le dossier courant). Tests daemon : `bun test` (script `"test": "bun test src"` de `apps/daemon/package.json`) ; tests web : Vitest 4.1.11. Bun n'exécute pas le typecheck : les erreurs de type se voient avec `pnpm --filter @axiom/daemon typecheck` / `pnpm --filter @axiom/web typecheck` / `pnpm -r typecheck`. Le dossier `api/` n'a pas de `tsconfig` propre : il est typé via les imports des tests daemon (`pnpm --filter @axiom/daemon typecheck`).

Les numéros de ligne cités sont ceux de `main` au commit `2d45426`, **avant** toute modification. Chaque ancre est aussi donnée par son contenu exact : dans un même fichier, appliquer les modifications du bas vers le haut (les numéros restent alors valables), ou se repérer au contenu cité.

### Tâche 1 : amendement du contrat, CSP documentée et ouverture du rapport (B1-0)

**Fichiers :**
- Modifier : `BUILD-CONTRACT.md:18` (fin de la puce « Fournisseurs de capitalisation »)
- Modifier : `BUILD-CONTRACT.md:48` (fin de la puce « Vercel »)
- Modifier : `BUILD-CONTRACT.md:50` (énumération des exceptions G100)
- Modifier : `BUILD-CONTRACT.md:59` (parenthèse des exceptions des anti-objectifs)
- Modifier : `BUILD-CONTRACT.md:263` (ajout du sous-bloc après la dernière ligne du fichier, fin de « Limites à ne pas masquer » `:258-263`)
- Modifier : `docs/csp-vercel.md:10-14` et `docs/csp-vercel.md:51` (ajout après la dernière ligne)
- Créer : `docs/superpowers/progress/2026-09-16-cryptoquant.md`
- Tester : aucune suite automatisée — vérification par `grep -cF` (compteurs avant/après), relecture du diff, `git diff --stat` et relecture JSON de la section `### Budget avant B1`

**Interfaces :**
- Consomme : rien (premier commit du lot, sur brief explicite de l'orchestrateur — `.devin/provider-rules.md`, « Garde-fous »). Prérequis : l'orchestrateur a déjà commité la spec amendée (§12, arbitrages) et le plan `docs/superpowers/plans/2026-09-16-cryptoquant-takers-mineurs.md`, et `git status --short` est vide avant l'étape 1. Sinon, les contrôles de l'étape 9 (tâche 1) et de l'étape 5 (tâche 20) échouent.
- Produit :
  - l'exception CryptoQuant BASIC écrite dans `BUILD-CONTRACT.md` (sous-bloc `### Fournisseur CryptoQuant BASIC (décision du propriétaire, 2026-09-16)`), et le décompte périmé « sept exceptions ACTÉES » de la puce « Gate G100 » remplacé par « des exceptions ACTÉES » ;
  - le rapport `docs/superpowers/progress/2026-09-16-cryptoquant.md`, ouvert avec les sections « Décisions actées » et « Budget JS initial » — sans tableau de budget ni journal des commits : la tâche 20 construit le tableau avant/après en lisant les blocs ```json des sections de budget, et génère le journal des commits depuis `git log` ;
  - le **format unique des mesures de budget**, repris par les tâches 8, 16, 19 et 20 : une section `### Budget <étape>` (étapes : `avant B1` ici, `après B1-3` en tâche 8, `après B1` en tâche 16, `après B2` en tâche 19, `final` en tâche 20), suivie d'une ligne « Commande : … » puis du bloc ```json **complet** imprimé par `scripts/verifier-budget-build.mjs` (le script que lance `pnpm --filter @axiom/web build`). La section est ajoutée en fin de fichier en un seul ajout (extraction scriptée ou `cat >> … <<EOF` explicite, jamais ligne à ligne) ; toute commande qui utilise `| tee` est précédée de `set -o pipefail;` ;
  - la section de référence `### Budget avant B1` (libellé exact, recherché par la tâche 20).

- [ ] **Étape 1 : écrire la vérification qui échoue** — ce script de comptage est le « test » de la tâche. Le lancer tel quel à la racine :

```bash
for motif in \
  "CryptoQuant BASIC le 2026-09-16" \
  "La clé CryptoQuant (2026-09-16) relève de cette règle" \
  "et le 2026-09-16 (fournisseur CryptoQuant BASIC" \
  "### Fournisseur CryptoQuant BASIC (décision du propriétaire, 2026-09-16)" \
  'une seule variable serveur, `BGEOMETRICS_API_KEY`' \
  "sept exceptions ACTÉES" \
  "des exceptions ACTÉES"; do
  printf 'BUILD-CONTRACT | %s → %s\n' "$motif" "$(grep -cF -- "$motif" BUILD-CONTRACT.md)"
done
for motif in "onze clés personnelles" "n'entrent pas dans"; do
  printf 'csp-vercel     | %s → %s\n' "$motif" "$(grep -cF -- "$motif" docs/csp-vercel.md)"
done
RAPPORT=docs/superpowers/progress/2026-09-16-cryptoquant.md
if test -f "$RAPPORT"; then
  printf 'rapport présent | ### Budget avant B1 → %s | Journal des commits → %s | tableau → %s\n' \
    "$(grep -c '^### Budget avant B1$' "$RAPPORT")" \
    "$(grep -c 'Journal des commits' "$RAPPORT")" \
    "$(grep -c '^| Étape |' "$RAPPORT")"
else
  echo "rapport absent"
fi
```

- [ ] **Étape 2 : lancer la vérification et constater l'état « avant »** — sortie attendue, dans cet ordre : `0`, `0`, `0`, `0`, `1` (le verrou `BGEOMETRICS_API_KEY` existe déjà et doit rester à 1), `1` (décompte périmé « sept exceptions ACTÉES » de la ligne 50), `0`, puis `0`, `0`, puis `rapport absent`.

- [ ] **Étape 3 : retouches 1 et 2 de `BUILD-CONTRACT.md`** — deux remplacements exacts (chaque ancien texte est unique dans le fichier).

Retouche 1 (`:18`). Ancien texte :

```text
Aucun autre fournisseur sans amendement du contrat.
```

Nouveau texte :

```text
Aucun autre fournisseur sans amendement du contrat (amendements : fournisseurs statistiques publics le 2026-09-06, CryptoQuant BASIC le 2026-09-16 — cf. « Extension autorisée le 16 septembre 2026 »).
```

Retouche 2 (`:48`, le verrou « une seule variable serveur, `BGEOMETRICS_API_KEY` » n'est PAS touché). Ancien texte :

```text
toute fenêtre partielle `PARTIAL` ; jamais de pane muet.
```

Nouveau texte :

```text
toute fenêtre partielle `PARTIAL` ; jamais de pane muet. La clé CryptoQuant (2026-09-16) relève de cette règle : personnelle, saisie dans les Réglages, repli `.env` pour le proxy Vite et le daemon `127.0.0.1` uniquement, JAMAIS de variable serveur sur Vercel (le test structurel continue d'exiger exactement une lecture d'environnement).
```

- [ ] **Étape 4 : retouches 3 et 4 de `BUILD-CONTRACT.md`**

Retouche 3 (`:50`), deux remplacements exacts sur la même ligne (chaque ancien texte y est unique).

Retouche 3a — le décompte « sept » ne suit déjà plus l'énumération (l'entrée du 2026-09-14 y porte à elle seule trois lots : section BT, lot ON-CHAIN, chantier « indicateurs gratuits vérifiés ») et serait faux de toute façon après l'ajout du 2026-09-16 : on retire le nombre. Ancien texte :

```text
— sept exceptions ACTÉES :
```

Nouveau texte :

```text
— des exceptions ACTÉES :
```

Retouche 3b — insertion avant « ; le gel reste la règle ». Ancien texte :

```text
aucun indicateur graphique nouveau) ; le gel reste la règle pour toute autre surface.
```

Nouveau texte :

```text
aucun indicateur graphique nouveau), et le 2026-09-16 (fournisseur CryptoQuant BASIC à clé personnelle sur décision du propriétaire : section repliable « Flux takers toutes places » dans DES et sous-section « Production des mineurs cotés » dans la section Mineurs de CHAIN — aucune fenêtre, aucun indicateur graphique, aucune dépendance, aucun hôte `/extapi` ; route dédiée `/cqapi` ; spec `docs/superpowers/specs/2026-09-16-cryptoquant-takers-mineurs-design.md`) ; le gel reste la règle pour toute autre surface.
```

Retouche 4 (`:59`, parenthèse des exceptions ; le « et » placé avant « fournisseurs statistiques » se déplace devant le dernier terme de l'énumération). Ancien texte :

```text
(exceptions ACTÉES : fournisseurs de capitalisation CMC/CCData, et fournisseurs statistiques publics OCDE/Eurostat/ONS le 2026-09-06 — cf. Décisions verrouillées)
```

Nouveau texte :

```text
(exceptions ACTÉES : fournisseurs de capitalisation CMC/CCData, fournisseurs statistiques publics OCDE/Eurostat/ONS le 2026-09-06, et CryptoQuant BASIC le 2026-09-16 sur décision explicite du propriétaire — **sans source défaillante remplacée**, l'exception est nommée comme telle — cf. Décisions verrouillées)
```

- [ ] **Étape 5 : sous-bloc en fin de `BUILD-CONTRACT.md`** — ancien texte (lignes 262-263, fin du fichier) :

```text
une exécution au prix du stop) ; la quarantaine 429 est par hôte et par
processus (pas de persistance).
```

Nouveau texte (Markdown plat, sans les `> ` de la citation de la spec) :

````markdown
une exécution au prix du stop) ; la quarantaine 429 est par hôte et par
processus (pas de persistance).

### Fournisseur CryptoQuant BASIC (décision du propriétaire, 2026-09-16)

Le propriétaire a souscrit l'offre BASIC de CryptoQuant (licence PERSONNELLE ; 10 req/min ;
10 000 req/mois ; fenêtre journalière seule ; 30 jours glissants, `limit` ≤ 30, `from`
antérieur à 30 j refusé ; aucune donnée on-chain, réservée au plan Professional) et
demande son raccordement à deux sections existantes : **DES — « Flux takers toutes
places »** (agrégat multi-places `spot/trade` et `swap/trade`, `btc_all`/`eth_all` : ratio
taker achat/vente, Δ taker en quote, volumes, VWAP, lus contre l'historique accumulé côté
client) et **CHAIN — « Production des mineurs cotés »** dans la section Mineurs
(`miner-data/companies`, neuf sociétés : production J-1, cumul mensuel fournisseur, USD,
production déclarée quand publiée ; Σ et parts sont des sommes d'affichage).

Règles : (1) clé PERSONNELLE saisie dans les Réglages, exclue des exports
(`CLES_CREDENTIALS_LOCALES`), repli `CRYPTOQUANT_API_KEY` de `apps/web/.env` pour le proxy
Vite et le daemon lié à `127.0.0.1` uniquement, JAMAIS de variable serveur sur Vercel —
sans clé personnelle sur Vercel : aucun appel, « clé personnelle requise » ; la règle
« une seule variable serveur `BGEOMETRICS_API_KEY` » reste intacte. (2) Route dédiée
`/cqapi` à liste FERMÉE (`shared/cryptoquant-proxy.ts`) sur les trois chemins — Vite,
daemon, fonction Vercel — GET seul, `Authorization: Bearer` relayé, `private, no-store`,
zéro redirection, en-têtes `x-ratelimit-*` relayés ; aucun ajout à `shared/extapi-hosts.ts`,
CSP inchangée, aucune entrée de cache proxy (`TTL_SECONDES_PAR_PREFIXE` inchangé) :
l'archive côté client est le cache. (3) Archive CÔTÉ CLIENT : à l'ouverture des fenêtres,
le client fusionne les jours nouveaux dans une archive versionnée par série (localStorage
`axiom:onchain:cq:<serie>:v1` + KV daemon `onchain/cq:<serie>:v1`, union des deux, jamais
destructive, hors export/import de sauvegarde) ; la fenêtre fournisseur de 30 j sans
rattrapage impose d'afficher la date de début de l'archive, ses jours manquants et ses
jours définitivement perdus ; aucun collecteur daemon. (4) Requêtes toujours
`window=day&limit=30` sans `from` ; cadencement client 10 req/min visible (« en attente du
quota »), garde « J-1 déjà archivé → aucun appel » et reprise 6 h — ≈ 390 req/mois nominal,
≤ 1 560 en pire cas, sur 10 000. (5) L'agrégat multi-places du fournisseur est CONSOMMÉ tel
quel — aucun AggregationEngine, spot et perp jamais additionnés, composition des places non
documentée et affichée comme limite. (6) BGeometrics reste la source unique de MVRV-Z,
SOPR, NUPL et Puell : CryptoQuant n'y est jamais substitué et ne fournit ici aucune
métrique de valorisation. (7) Aucune fenêtre (39), aucun indicateur graphique (200),
aucune dépendance, `EXCHANGE_IDS` à 9 ; tout code nouveau vit dans des chunks chargés à la
demande ; le budget initial reste bloquant (1 220 000 octets bruts, 360 000 gzip), mesures
avant/après consignées dans le rapport du lot. Exclus sans nouvel amendement : toute autre
série CryptoQuant, toute substitution de BGeometrics, tout collecteur daemon, tout
AggregationEngine.

Limites à ne pas masquer : dernière ligne = J-1 ; composition des places « cross-exchange
aggregate » non documentée ; sémantique de `base_volume`/`vwap` pour les swaps inverses et
de `reported_production`/`report_accuracy` non confirmée (affichées brutes, sans écart
calculé) ; `accumulated_monthly_rewards` est le cumul du fournisseur (non recalculé) ;
l'archive dépend de l'usage (pas de collecteur) et, sur un poste sans daemon, vider le
stockage du navigateur la perd.
````

- [ ] **Étape 6 : `docs/csp-vercel.md`** — deux modifications.

Remplacement des lignes 10-14. Ancien texte :

```text
Le front déployé détient dans le `localStorage` du navigateur les **neuf clés personnelles**
saisies dans Réglages (Coinalyze, Twelve Data, FRED, BGeometrics, Finnhub, CoinDesk Data,
CoinGecko Demo, Etherscan, SoSoValue). Aucune n'est un secret partagé côté serveur — c'est le
choix mono-utilisateur du contrat — mais une injection de script sur la page les exfiltrerait
toutes. La CSP est la seule barrière qui reste à ce niveau.
```

Nouveau texte :

```text
Le front déployé détient dans le `localStorage` du navigateur les **onze clés personnelles**
saisies dans Réglages (Coinalyze, Twelve Data, FRED, BGeometrics, Finnhub, CoinDesk Data,
CoinGecko Demo, Etherscan, SoSoValue, DefiLlama Pro, CryptoQuant ; liste de référence :
`CLES_CREDENTIALS_LOCALES` de `apps/web/src/store/persist.ts`). Aucune n'est un secret partagé
côté serveur — c'est le choix mono-utilisateur du contrat — mais une injection de script sur
la page les exfiltrerait toutes. La CSP est la seule barrière qui reste à ce niveau.
```

Ajout après la ligne 51 (fin du fichier, section « Maintenance de la liste `connect-src` ») :

```text

Les routes proxy **à préfixe** (`/extapi`, `/fredapi`, `/coinalyzeapi`, `/tdapi`, `/mexcapi`,
`/sosoapi`, `/bgapi`, `/ethscanapi`, `/ccdataapi`, `/defillamapro`, `/cqapi`) sont servies par
la même origine — réécritures de `vercel.json` vers `api/proxy.ts` — et relèvent donc de
`'self'` : elles n'entrent pas dans `connect-src`. La route `/cqapi` (CryptoQuant BASIC,
2026-09-16) n'a demandé aucun ajout à la politique ni à `shared/extapi-hosts.ts` ; seul un
appel direct du navigateur vers un nouvel hôte exige une entrée ici.
```

- [ ] **Étape 7 : créer le squelette du rapport** — `docs/superpowers/progress/2026-09-16-cryptoquant.md`, contenu complet (ni tableau de budget ni journal des commits : la tâche 20 les produit, le premier depuis les blocs ```json des sections `### Budget …`, le second depuis `git log`) :

````markdown
# 2026-09-16 — CryptoQuant BASIC : flux takers toutes places (DES) et mineurs cotés (CHAIN)

Demande du propriétaire : « quel indicateur pertinent ajouter à AXIOM grâce à cette clé »
(offre BASIC souscrite), puis « les deux, dans cet ordre, sans nouvelle fenêtre ».
Spec : `docs/superpowers/specs/2026-09-16-cryptoquant-takers-mineurs-design.md`.
Exception consignée dans `BUILD-CONTRACT.md` (« Fournisseur CryptoQuant BASIC », à la fin
de la section « Extension autorisée le 16 septembre 2026 »).

## Décisions actées (2026-09-16)

- Nouveau fournisseur à clé PERSONNELLE, deux familles seulement : flux takers agrégés
  (`/v2/market/cq/{spot,swap}/trade`, `btc_all`/`eth_all`) et production des mineurs cotés
  (`/v1/btc/miner-data/companies`, neuf sociétés). BGeometrics reste la source unique de
  MVRV-Z, SOPR, NUPL et Puell.
- Aucune variable serveur sur Vercel ; repli `CRYPTOQUANT_API_KEY` de `apps/web/.env` pour
  le proxy Vite et le daemon `127.0.0.1` uniquement.
- Route `/cqapi` à liste fermée (`shared/cryptoquant-proxy.ts`) sur les trois chemins :
  GET seul, zéro redirection, `private, no-store`, en-têtes `x-ratelimit-*` relayés, aucune
  entrée de cache daemon.
- Archive côté client (localStorage + KV daemon, union, jamais destructive), aucun
  collecteur daemon ; requêtes toujours `window=day&limit=30`, jamais `from`/`to`.
- Sous-lots : B1 (socle + section DES), puis B2 (sous-section CHAIN).
- Défauts retenus par la spec (§11), contestables à la relecture : court-circuit « J-1
  archivé → zéro appel » et reprise 6 h ; déclenchement au montage de la fenêtre ; archive
  exclue de la sauvegarde JSON ; 401/403 mémorisés en session seulement ; badge Réglages
  sur la clé personnelle seule ; comparaison Binance hors lot.
- La clé collée dans la conversation d'origine est considérée compromise : le propriétaire
  la régénère et la renseigne lui-même ; aucun agent ne la lit.

## Budget JS initial (plafonds 1 220 000 bruts / 360 000 gzip niveau 9)

Chaque mesure est une section de niveau 3 intitulée « Budget » suivie de l'étape (`avant B1`
en B1-0, `après B1-3`, `après B1`, `après B2`, `final`), ajoutée en fin de fichier. Elle
contient une ligne « Commande : … » puis le bloc JSON complet imprimé par
`scripts/verifier-budget-build.mjs`, le script que lance `pnpm --filter @axiom/web build`
(champs `initial.octetsBruts` et `initial.octetsGzip` pour le chemin d'entrée). Le tableau
avant/après est dérivé de ces blocs à la clôture du lot. Mesures locales macOS ; le juge de
paix reste le runner GitHub (marge runner ≈ 3 365 gzip au 2026-09-16). Seuls les plafonds du
script sont bloquants ; delta initial attendu ≤ ~40 octets gzip par sous-lot (nom du chunk
partagé du store ajouté à `__vite__mapDeps`), porte d'acceptation ≤ ~150 octets gzip sur
l'ensemble de B1 ; si la marge runner tombait sous ~3 000 gzip, retirer d'abord le libellé
DATA.
````

- [ ] **Étape 8 : mesurer le budget « avant » et l'inscrire** — aucune ligne de code n'a encore changé, le build de `HEAD` est donc la référence.

(a) Construire et vérifier le budget :

```bash
pnpm --filter @axiom/web build
echo "code de sortie du build : $?"
```

Attendu : `code de sortie du build : 0`, aucune ligne « Erreur budget build », et le JSON du budget imprimé après la sortie Vite. Si le code n'est pas `0`, s'arrêter : rien n'est écrit dans le rapport.

(b) Ajouter la section `### Budget avant B1` en un seul ajout (le JSON est relu par le même script, sur le même `apps/web/dist`, pour obtenir le bloc seul, sans la sortie Vite) :

```bash
node scripts/verifier-budget-build.mjs apps/web/dist > "${TMPDIR:-/tmp}/axiom-budget-avant-b1.json" && {
  printf '\n### Budget avant B1\n\nCommande : `pnpm --filter @axiom/web build` (HEAD `%s`, mesure locale macOS, avant toute modification du lot) ; bloc ci-dessous = sortie de `node scripts/verifier-budget-build.mjs apps/web/dist`, le script que lance ce build.\n\n```json\n' "$(git rev-parse --short HEAD)"
  cat "${TMPDIR:-/tmp}/axiom-budget-avant-b1.json"
  printf '```\n'
} >> docs/superpowers/progress/2026-09-16-cryptoquant.md
```

(c) Relire la section comme le fera la tâche 20, et vérifier que le bloc est bien la sortie exacte du script :

```bash
node -e '
const texte = require("node:fs").readFileSync(process.argv[1], "utf8");
const m = /^### Budget avant B1\n\nCommande : .+\n\n```json\n([\s\S]*?)\n```$/m.exec(texte);
if (!m) { console.error("section ### Budget avant B1 introuvable ou mal formée"); process.exit(1); }
const r = JSON.parse(m[1]);
const i = r.initial;
console.log(`avant B1 : ${i.octetsBruts} bruts / ${i.octetsGzip} gzip — marges ${r.limites.octetsBruts - i.octetsBruts} / ${r.limites.octetsGzip - i.octetsGzip} — ${i.fichiers.length} fichiers initiaux`);
' docs/superpowers/progress/2026-09-16-cryptoquant.md
node scripts/verifier-budget-build.mjs apps/web/dist | diff -q - "${TMPDIR:-/tmp}/axiom-budget-avant-b1.json" && echo "bloc identique à la sortie du script"
grep -c '^### Budget avant B1$' docs/superpowers/progress/2026-09-16-cryptoquant.md
```

Attendu : une ligne « avant B1 : … bruts / … gzip — marges … / … — … fichiers initiaux » avec des bruts ≤ 1 220 000, des gzip ≤ 360 000 et deux marges positives ou nulles (repère antérieur au lot A : 1 205 532 bruts / 355 397 gzip, `docs/superpowers/progress/2026-09-16-indicateurs-et-fonctions-revue.md:49` ; consigner la valeur mesurée telle quelle) ; puis `bloc identique à la sortie du script` ; puis `1`.

- [ ] **Étape 9 : relancer la vérification et relire le diff** — relancer le script de l'étape 1. Sortie attendue : `2`, `1`, `1`, `1`, `1`, `0`, `1`, puis `1`, `1`, puis `rapport présent | ### Budget avant B1 → 1 | Journal des commits → 0 | tableau → 0`. Ensuite :

```bash
git diff --stat
git diff -- BUILD-CONTRACT.md docs/csp-vercel.md
```

Attendu : `BUILD-CONTRACT.md` et `docs/csp-vercel.md` seuls modifiés (le rapport est encore non suivi) ; dans le diff du contrat, la phrase « une seule variable serveur, `BGEOMETRICS_API_KEY`, portée par `api/proxy.ts` … » est intacte, et seules les lignes 18, 48, 50, 59 changent plus l'ajout final.

- [ ] **Étape 10 : commit**

```bash
git add BUILD-CONTRACT.md docs/csp-vercel.md docs/superpowers/progress/2026-09-16-cryptoquant.md
git commit -m "docs(contrat,csp,rapport): exception CryptoQuant BASIC du 2026-09-16 — clé personnelle, route /cqapi, archive côté client" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

### Tâche 2 : module partagé `shared/cryptoquant-proxy.ts` (B1-1)

**Fichiers :**
- Créer : `shared/cryptoquant-proxy.ts`
- Créer : `apps/daemon/src/cryptoquantProxy.test.ts`
- Modifier : `apps/web/tsconfig.json:8`
- Modifier : `apps/daemon/tsconfig.json:7`
- Tester : `apps/daemon/src/cryptoquantProxy.test.ts`

**Interfaces :**
- Consomme : rien (module sans import, patron `shared/defillama-proxy.ts`).
- Produit (signatures exactes, imposées par le contrat d'interfaces) :
  - `export const CRYPTOQUANT_HOST = "api.cryptoquant.com";`
  - `export const CRYPTOQUANT_PREFIXE = "/cqapi";`
  - `export const IDS_MINEURS_CQ = ["bitf", "cipher", "clsk", "core", "hive", "iren", "mara", "riot", "wulf"] as const;`
  - `export type IdMineurCq = (typeof IDS_MINEURS_CQ)[number];`
  - `export function cleCryptoQuantValide(authorization: string | null | undefined): authorization is string;` — `/^Bearer\s+\S+$/i` et longueur ≤ 512.
  - `export function cheminCryptoQuantAmont(pathname: string, search: string): string | null;` — `pathname` commence par `/cqapi/` ; `search` avec ou sans `?` ; sortie `"<chemin amont>?<query normalisée symbol|miner, window, limit>"` ou `null`.
  - Import : `"../shared/cryptoquant-proxy.js"` depuis `api/` ; `"../../shared/cryptoquant-proxy"` depuis `apps/web/vite.config.ts` ; `"../../../shared/cryptoquant-proxy"` depuis `apps/daemon/src/` ; `"../../../../../shared/cryptoquant-proxy"` depuis `apps/web/src/data/onchain/`.

- [ ] **Étape 1 : écrire le test qui échoue** — créer `apps/daemon/src/cryptoquantProxy.test.ts` :

```ts
/**
 * Politique partagée de la route /cqapi (shared/cryptoquant-proxy.ts) : table exhaustive
 * des chemins et paramètres acceptés ou refusés, et du prédicat de clé. Module pur, sans réseau.
 */
import { describe, expect, test } from "bun:test";
import {
  CRYPTOQUANT_HOST,
  CRYPTOQUANT_PREFIXE,
  IDS_MINEURS_CQ,
  cheminCryptoQuantAmont,
  cleCryptoQuantValide,
} from "../../../shared/cryptoquant-proxy";

const SPOT = "/cqapi/v2/market/cq/spot/trade";
const SWAP = "/cqapi/v2/market/cq/swap/trade";
const MINEURS = "/cqapi/v1/btc/miner-data/companies";

describe("shared/cryptoquant-proxy — constantes", () => {
  test("hôte, préfixe et neuf identifiants de sociétés dans l'ordre du fournisseur", () => {
    expect(CRYPTOQUANT_HOST).toBe("api.cryptoquant.com");
    expect(CRYPTOQUANT_PREFIXE).toBe("/cqapi");
    expect([...IDS_MINEURS_CQ]).toEqual(["bitf", "cipher", "clsk", "core", "hive", "iren", "mara", "riot", "wulf"]);
  });

  test("le module partagé n'importe rien", async () => {
    const source = await Bun.file(new URL("../../../shared/cryptoquant-proxy.ts", import.meta.url)).text();
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/\brequire\(/);
  });
});

describe("cheminCryptoQuantAmont — acceptés (query normalisée : symbol|miner, window, limit)", () => {
  test.each([
    {
      nom: "spot BTC, requête type du client",
      chemin: SPOT,
      requete: "?symbol=btc_all&window=day&limit=30",
      attendu: "/v2/market/cq/spot/trade?symbol=btc_all&window=day&limit=30",
    },
    {
      nom: "spot ETH sans limit",
      chemin: SPOT,
      requete: "?symbol=eth_all&window=day",
      attendu: "/v2/market/cq/spot/trade?symbol=eth_all&window=day",
    },
    {
      nom: "perp BTC avec limit=1",
      chemin: SWAP,
      requete: "?symbol=btc_all&window=day&limit=1",
      attendu: "/v2/market/cq/swap/trade?symbol=btc_all&window=day&limit=1",
    },
    {
      nom: "perp ETH, clés dans le désordre",
      chemin: SWAP,
      requete: "?limit=30&window=day&symbol=eth_all",
      attendu: "/v2/market/cq/swap/trade?symbol=eth_all&window=day&limit=30",
    },
    {
      nom: "mineurs MARA",
      chemin: MINEURS,
      requete: "?miner=mara&window=day&limit=30",
      attendu: "/v1/btc/miner-data/companies?miner=mara&window=day&limit=30",
    },
    {
      nom: "search sans point d'interrogation initial",
      chemin: MINEURS,
      requete: "window=day&miner=wulf",
      attendu: "/v1/btc/miner-data/companies?miner=wulf&window=day",
    },
  ])("$nom", ({ chemin, requete, attendu }) => {
    expect(cheminCryptoQuantAmont(chemin, requete)).toBe(attendu);
  });

  test("les neuf sociétés sont acceptées", () => {
    for (const id of IDS_MINEURS_CQ) {
      expect(cheminCryptoQuantAmont(MINEURS, `?miner=${id}&window=day&limit=30`)).toBe(
        `/v1/btc/miner-data/companies?miner=${id}&window=day&limit=30`,
      );
    }
  });

  test("limit : chaque entier de 1 à 30 passe", () => {
    for (let n = 1; n <= 30; n += 1) {
      expect(cheminCryptoQuantAmont(SPOT, `?symbol=btc_all&window=day&limit=${n}`)).toBe(
        `/v2/market/cq/spot/trade?symbol=btc_all&window=day&limit=${n}`,
      );
    }
  });
});

describe("cheminCryptoQuantAmont — refusés (null)", () => {
  const BTC = "?symbol=btc_all&window=day&limit=30";
  test.each([
    { nom: "exchange-flows (plan Professional)", chemin: "/cqapi/v1/btc/exchange-flows/reserve", requete: "?exchange=all_exchange&window=day" },
    { nom: "market-indicator MVRV (plan Professional)", chemin: "/cqapi/v1/btc/market-indicator/mvrv", requete: "?window=day" },
    { nom: "miner-flows (plan Professional)", chemin: "/cqapi/v1/btc/miner-flows/reserve", requete: "?miner=f2pool&window=day" },
    { nom: "sans préfixe /cqapi", chemin: "/v2/market/cq/spot/trade", requete: BTC },
    { nom: "autre préfixe", chemin: "/bgapi/v2/market/cq/spot/trade", requete: BTC },
    { nom: "préfixe seul", chemin: "/cqapi", requete: BTC },
    { nom: "préfixe collé au chemin", chemin: "/cqapiv2/market/cq/spot/trade", requete: BTC },
    { nom: "slash final", chemin: `${SPOT}/`, requete: BTC },
    { nom: "casse du chemin", chemin: "/cqapi/v2/market/cq/SPOT/trade", requete: BTC },
    { nom: "séparateur encodé", chemin: "/cqapi/v2/market/cq/spot%2Ftrade", requete: BTC },
    { nom: "segment de traversée", chemin: "/cqapi/v2/market/cq/spot/../swap/trade", requete: BTC },
    { nom: "symbole hors liste", chemin: SPOT, requete: "?symbol=sol_all&window=day&limit=30" },
    { nom: "symbole d'une seule place", chemin: SPOT, requete: "?symbol=btc_usd&window=day" },
    { nom: "symbole en majuscules", chemin: SPOT, requete: "?symbol=BTC_ALL&window=day" },
    { nom: "symbole absent", chemin: SPOT, requete: "?window=day&limit=30" },
    { nom: "miner sur un chemin taker", chemin: SPOT, requete: "?miner=mara&window=day" },
    { nom: "symbol sur le chemin mineurs", chemin: MINEURS, requete: "?symbol=btc_all&window=day" },
    { nom: "société inconnue", chemin: MINEURS, requete: "?miner=inconnu&window=day" },
    { nom: "société en majuscules", chemin: MINEURS, requete: "?miner=MARA&window=day" },
    { nom: "société absente", chemin: MINEURS, requete: "?window=day&limit=30" },
    { nom: "window absente", chemin: SPOT, requete: "?symbol=btc_all&limit=30" },
    { nom: "window=hour (403 en BASIC)", chemin: SPOT, requete: "?symbol=btc_all&window=hour" },
    { nom: "window=block", chemin: SPOT, requete: "?symbol=btc_all&window=block" },
    { nom: "window en majuscules", chemin: SPOT, requete: "?symbol=btc_all&window=DAY" },
    { nom: "clé Window (casse)", chemin: SPOT, requete: "?symbol=btc_all&Window=day" },
    { nom: "clé Symbol (casse)", chemin: SPOT, requete: "?Symbol=btc_all&window=day" },
    { nom: "limit=0", chemin: SPOT, requete: "?symbol=btc_all&window=day&limit=0" },
    { nom: "limit=31", chemin: SPOT, requete: "?symbol=btc_all&window=day&limit=31" },
    { nom: "limit=100", chemin: SPOT, requete: "?symbol=btc_all&window=day&limit=100" },
    { nom: "limit=030 (zéro initial)", chemin: SPOT, requete: "?symbol=btc_all&window=day&limit=030" },
    { nom: "limit=1.5", chemin: SPOT, requete: "?symbol=btc_all&window=day&limit=1.5" },
    { nom: "limit=-1", chemin: SPOT, requete: "?symbol=btc_all&window=day&limit=-1" },
    { nom: "limit=+5 (encodé)", chemin: SPOT, requete: "?symbol=btc_all&window=day&limit=%2B5" },
    { nom: "limit vide", chemin: SPOT, requete: "?symbol=btc_all&window=day&limit=" },
    { nom: "limit=abc", chemin: SPOT, requete: "?symbol=btc_all&window=day&limit=abc" },
    { nom: "limit précédé d'un espace", chemin: SPOT, requete: "?symbol=btc_all&window=day&limit=%2030" },
    { nom: "from refusé", chemin: SPOT, requete: "?symbol=btc_all&window=day&from=20260901" },
    { nom: "to refusé", chemin: SPOT, requete: "?symbol=btc_all&window=day&to=20260915" },
    { nom: "from et to refusés (mineurs)", chemin: MINEURS, requete: "?miner=mara&window=day&from=20260801&to=20260915" },
    { nom: "paramètre inconnu", chemin: SPOT, requete: "?symbol=btc_all&window=day&format=json" },
    { nom: "clé API en query", chemin: SPOT, requete: "?symbol=btc_all&window=day&api_key=secret" },
    { nom: "nom de paramètre vide", chemin: SPOT, requete: "?symbol=btc_all&window=day&=x" },
    { nom: "doublon symbol identique", chemin: SPOT, requete: "?symbol=btc_all&symbol=btc_all&window=day" },
    { nom: "doublon symbol contradictoire", chemin: SPOT, requete: "?symbol=btc_all&symbol=sol_all&window=day" },
    { nom: "doublon window", chemin: SPOT, requete: "?symbol=btc_all&window=day&window=day" },
    { nom: "doublon limit", chemin: SPOT, requete: "?symbol=btc_all&window=day&limit=30&limit=30" },
    { nom: "doublon miner", chemin: MINEURS, requete: "?miner=mara&miner=riot&window=day" },
    { nom: "query vide", chemin: SPOT, requete: "" },
    { nom: "point d'interrogation seul", chemin: SPOT, requete: "?" },
  ])("$nom", ({ chemin, requete }) => {
    expect(cheminCryptoQuantAmont(chemin, requete)).toBeNull();
  });
});

describe("cleCryptoQuantValide", () => {
  test("accepte un Bearer non vide, casse indifférente, jusqu'à 512 caractères", () => {
    const limite = `Bearer ${"x".repeat(505)}`;
    expect(limite).toHaveLength(512);
    for (const valeur of ["Bearer abc", "bearer abc", "BEARER abc", "Bearer   abc", "Bearer\tabc", limite]) {
      expect(cleCryptoQuantValide(valeur)).toBe(true);
    }
  });

  test("refuse absence, autre schéma, jeton vide ou composé, espace initial et plus de 512 caractères", () => {
    for (const valeur of [
      null,
      undefined,
      "",
      "Bearer",
      "Bearer ",
      "Bearer a b",
      "Apikey abc",
      "Basic abc",
      "Token abc",
      "abc",
      " Bearer abc",
      `Bearer ${"x".repeat(506)}`,
    ]) {
      expect(cleCryptoQuantValide(valeur)).toBe(false);
    }
  });
});
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue**

```bash
pnpm --filter @axiom/daemon exec bun test src/cryptoquantProxy.test.ts
```

Échec attendu : le fichier ne se charge pas — `error: Cannot find module '../../../shared/cryptoquant-proxy' from '…/apps/daemon/src/cryptoquantProxy.test.ts'` ; résumé `0 pass`, `1 fail`, `1 error`.

- [ ] **Étape 3 : implémentation minimale** — créer `shared/cryptoquant-proxy.ts` :

```ts
/**
 * Politique UNIQUE de la route `/cqapi` — CryptoQuant BASIC, licence PERSONNELLE.
 *
 * Consommateurs (ne jamais dupliquer la liste ailleurs) :
 *   1. api/_policy.ts                          — fonction Vercel (import suffixé « .js »)
 *   2. apps/daemon/src/proxy.ts                — daemon 127.0.0.1 (import sans extension)
 *   3. apps/web/vite.config.ts                 — proxy de dev (import sans extension)
 *   4. apps/web/src/data/onchain/cryptoquant.ts — identifiants des sociétés (client)
 *
 * Liste FERMÉE : trois chemins éligibles à l'offre BASIC, fenêtre journalière
 * obligatoire, `limit` entier 1..30, jamais `from`/`to` (le fournisseur refuse toute
 * date antérieure à 30 jours). Zéro import : module pur partagé par les trois proxys.
 */

export const CRYPTOQUANT_HOST = "api.cryptoquant.com";
export const CRYPTOQUANT_PREFIXE = "/cqapi";
export const IDS_MINEURS_CQ = ["bitf", "cipher", "clsk", "core", "hive", "iren", "mara", "riot", "wulf"] as const;
export type IdMineurCq = (typeof IDS_MINEURS_CQ)[number];

/** Même borne que le relais Bearer BGeometrics de la fonction Vercel. */
const LONGUEUR_MAX_AUTORISATION = 512;
const CHEMINS_TAKER: ReadonlySet<string> = new Set(["/v2/market/cq/spot/trade", "/v2/market/cq/swap/trade"]);
const CHEMIN_MINEURS = "/v1/btc/miner-data/companies";
const SYMBOLES_TAKER: ReadonlySet<string> = new Set(["btc_all", "eth_all"]);
const MINEURS: ReadonlySet<string> = new Set<string>(IDS_MINEURS_CQ);
/** Entier 1..99 sans zéro initial ; la borne 30 est vérifiée à part. */
const MOTIF_LIMIT = /^[1-9]\d?$/;
const LIMIT_MAX = 30;

/** En-tête `Authorization: Bearer <jeton>` recevable (casse du schéma indifférente). */
export function cleCryptoQuantValide(authorization: string | null | undefined): authorization is string {
  return (
    typeof authorization === "string" &&
    authorization.length <= LONGUEUR_MAX_AUTORISATION &&
    /^Bearer\s+\S+$/i.test(authorization)
  );
}

/**
 * Traduit un chemin local `/cqapi/<chemin>` et sa query en chemin amont CryptoQuant, ou `null`
 * hors liste fermée. Toute clé de query inconnue, en double ou de casse différente est
 * refusée ; la query de sortie est reconstruite dans l'ordre symbol|miner, window, limit.
 */
export function cheminCryptoQuantAmont(pathname: string, search: string): string | null {
  if (!pathname.startsWith(`${CRYPTOQUANT_PREFIXE}/`)) return null;
  const chemin = pathname.slice(CRYPTOQUANT_PREFIXE.length);
  const taker = CHEMINS_TAKER.has(chemin);
  if (!taker && chemin !== CHEMIN_MINEURS) return null;
  const cleSujet = taker ? "symbol" : "miner";

  const params = new URLSearchParams(search);
  const vues = new Set<string>();
  for (const cle of params.keys()) {
    if (vues.has(cle)) return null; // doublon
    vues.add(cle);
    if (cle !== cleSujet && cle !== "window" && cle !== "limit") return null; // from, to, inconnue, casse
  }

  const sujet = params.get(cleSujet);
  const admis = taker ? SYMBOLES_TAKER : MINEURS;
  if (sujet === null || !admis.has(sujet)) return null;
  if (params.get("window") !== "day") return null;
  const limit = params.get("limit");
  if (limit !== null && (!MOTIF_LIMIT.test(limit) || Number(limit) > LIMIT_MAX)) return null;

  const sortie = new URLSearchParams();
  sortie.set(cleSujet, sujet);
  sortie.set("window", "day");
  if (limit !== null) sortie.set("limit", limit);
  return `${chemin}?${sortie.toString()}`;
}
```

- [ ] **Étape 4 : lancer le test et vérifier qu'il passe**

```bash
pnpm --filter @axiom/daemon exec bun test src/cryptoquantProxy.test.ts
pnpm --filter @axiom/daemon test
```

Attendu : `61 pass`, `0 fail` pour le nouveau fichier ; toute la suite daemon reste verte (aucun autre fichier ne change).

- [ ] **Étape 5 : déclarer le module dans les deux `tsconfig` et typer**

`apps/web/tsconfig.json`, ligne 8 — remplacer :

```json
  "include": ["src", "vite.config.ts", "../../shared/extapi-hosts.ts", "../../shared/daemon-capabilities.ts"]
```

par :

```json
  "include": ["src", "vite.config.ts", "../../shared/extapi-hosts.ts", "../../shared/daemon-capabilities.ts", "../../shared/cryptoquant-proxy.ts"]
```

`apps/daemon/tsconfig.json`, ligne 7 — remplacer :

```json
  "include": ["src", "../../shared/extapi-hosts.ts", "../../shared/daemon-capabilities.ts"]
```

par :

```json
  "include": ["src", "../../shared/extapi-hosts.ts", "../../shared/daemon-capabilities.ts", "../../shared/cryptoquant-proxy.ts"]
```

Puis :

```bash
pnpm -r typecheck
```

Attendu : aucun diagnostic (le module est désormais typé côté web même avant qu'un fichier web ne l'importe).

- [ ] **Étape 6 : commit**

```bash
git add shared/cryptoquant-proxy.ts apps/daemon/src/cryptoquantProxy.test.ts apps/web/tsconfig.json apps/daemon/tsconfig.json
git commit -m "feat(shared): liste fermée de la route /cqapi — trois chemins CryptoQuant BASIC, window=day, limit ≤ 30" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

### Tâche 3 : route `/cqapi` sur Vercel — politique, handler et rewrites (B1-2, brief Vercel)

**Fichiers :**
- Modifier : `api/_policy.ts:3` (import), `api/_policy.ts:24-34` (`ProxyRouteId`), `api/_policy.ts:41-51` (`FIXED_ROUTES`), `api/_policy.ts:53-64` (`ROUTE_IDS`), `api/_policy.ts:299-300` (relais Bearer dans `proxyUpstreamHeaders`), `api/_policy.ts:351-352` (branche `cqapi` de `planProxyRequest`), `api/_policy.ts:383` (`maxRedirects`)
- Modifier : `api/proxy.ts:356-357` (recopie des en-têtes de quota)
- Modifier : `vercel.json:88-89` (deux rewrites avant le repli SPA)
- Tester : `apps/daemon/src/vercelProxy.test.ts` (modifier `:3-12`, `:48-63`, `:113-126`, ajout après `:325`)
- Tester : `apps/daemon/src/vercelProxy.redirection.test.ts` (modifier `:15-19`, ajout après `:82`)

**Interfaces :**
- Consomme (Tâche 2) : `CRYPTOQUANT_HOST`, `cleCryptoQuantValide(authorization: string | null | undefined): authorization is string`, `cheminCryptoQuantAmont(pathname: string, search: string): string | null`, importés depuis `"../shared/cryptoquant-proxy.js"`.
- Produit :
  - `ProxyRouteId` inclut `"cqapi"` ; `FIXED_ROUTES.cqapi = { host: CRYPTOQUANT_HOST, methods: ["GET"] }`.
  - `planProxyRequest(requestUrl, method, headers, env?)` pour `cqapi`, contrôles dans cet ordre : non-GET → `ProxyPolicyError(405, "méthode proxy non autorisée", "GET")`, y compris un POST sans clé (méthode contrôlée d'abord ; écart acté à la spec §4.1, consigné au rapport en tâche 20) ; sans Bearer valide → `ProxyPolicyError(401, "clé CryptoQuant personnelle requise")` (aucun repli d'environnement) ; hors liste → `ProxyPolicyError(404, "chemin CryptoQuant refusé")` ; sinon `ProxyPlan` avec `target` = `https://api.cryptoquant.com<chemin>?<query normalisée>`, `cacheControl: "private, no-store"`, `privateResponse: true`, `maxRedirects: 0`.
  - Handler Vercel : corps d'erreur local `{ erreur: string, statut: number }` (`jsonError`) ; réponse amont relayée avec son statut et son corps JSON, plus `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset` quand l'amont les envoie. Le client (zone D) ne s'appuie que sur le **statut** et ces trois en-têtes.
  - `vercel.json` : `/cqapi/:path*` → `/api/proxy?__axiom_route=cqapi&__axiom_path=:path` et `/cqapi/:path*/` → `/api/proxy?__axiom_route=cqapi&__axiom_path=:path/`.

- [ ] **Étape 1 : écrire le test qui échoue (politique Vercel)** — dans `apps/daemon/src/vercelProxy.test.ts`, quatre modifications.

(a) Import, lignes 3-12 — remplacer le bloc par :

```ts
import {
  planProxyRequest,
  proxyCacheControl,
  proxyExtapiHostAllowed,
  ProxyPolicyError,
  proxyMimeAllowed,
  proxyNavigationForbidden,
  proxyRedirectAllowed,
  proxyRedirectTarget,
  proxyUpstreamHeaders,
} from "../../../api/_policy";
```

(b) Test des rewrites, lignes 48-63 — remplacer le titre et la liste `required` par :

```ts
  test("place les onze rewrites avant le fallback SPA", async () => {
    const config = (await Bun.file(new URL("../../../vercel.json", import.meta.url)).json()) as {
      rewrites: Array<{ source: string; destination: string }>;
    };
    const required = [
      "/extapi/:path*",
      "/fredapi/:path*",
      "/coinalyzeapi/:path*",
      "/tdapi/:path*",
      "/mexcapi/:path*",
      "/sosoapi/:path*",
      "/bgapi/:path*",
      "/ethscanapi/:path*",
      "/ccdataapi/:path*",
      "/defillamapro/:path*",
      "/cqapi/:path*",
    ];
```

(les lignes 64-71 du test restent identiques).

(c) Boucle des routes fixes, lignes 113-126 — remplacer le test entier par :

```ts
  test("fixe l'autorité des neuf routes spécifiques", () => {
    const bearer = new Headers({ authorization: "Bearer personnelle" });
    for (const [route, host, path, query, headers] of [
      ["fredapi", "api.stlouisfed.org", "v1/data", "", new Headers()],
      ["coinalyzeapi", "api.coinalyze.net", "v1/data", "", new Headers()],
      ["tdapi", "api.twelvedata.com", "v1/data", "", new Headers()],
      ["mexcapi", "api.mexc.com", "v1/data", "", new Headers()],
      ["sosoapi", "openapi.sosovalue.com", "v1/data", "", new Headers()],
      ["bgapi", "bitcoin-data.com", "v1/data", "", new Headers()],
      ["ethscanapi", "api.etherscan.io", "v1/data", "", new Headers()],
      ["ccdataapi", "min-api.cryptocompare.com", "v1/data", "", new Headers()],
      // CryptoQuant : liste fermée et Bearer personnel obligatoires (sinon 404 ou 401).
      ["cqapi", "api.cryptoquant.com", "v2/market/cq/spot/trade", "symbol=btc_all&window=day&limit=30", bearer],
    ] as const) {
      expect(planProxyRequest(url(route, path, query), "GET", headers).target.hostname).toBe(host);
    }
  });
```

(d) Ajouter à la fin du fichier (après la ligne 325) :

```ts
describe("route CryptoQuant /cqapi (licence personnelle, liste fermée)", () => {
  const CHEMIN = "v2/market/cq/spot/trade";
  const QUERY = "symbol=btc_all&window=day&limit=30";
  const CIBLE = "https://api.cryptoquant.com/v2/market/cq/spot/trade?symbol=btc_all&window=day&limit=30";
  // Variables serveur posées par erreur : aucune ne doit servir de repli CryptoQuant.
  const envServeur = { BGEOMETRICS_API_KEY: "repli-serveur", CRYPTOQUANT_API_KEY: "repli-cq-interdit" };
  const bearer = (): Headers =>
    new Headers({ authorization: "Bearer CLE-TEST-SECRETE", cookie: "session=secret", "x-extra": "interdit" });

  test("GET sans Authorization : 401 local, y compris avec des variables serveur", () => {
    for (const env of [{}, envServeur]) {
      const error = policyError(() => planProxyRequest(url("cqapi", CHEMIN, QUERY), "GET", new Headers(), env));
      expect(error.status).toBe(401);
      expect(error.message).toBe("clé CryptoQuant personnelle requise");
    }
  });

  test("Bearer personnel : cible exacte, en-tête relayé, sans cookie, privé, zéro redirection", () => {
    const plan = planProxyRequest(url("cqapi", CHEMIN, QUERY), "GET", bearer(), envServeur);
    expect(plan.route).toBe("cqapi");
    expect(plan.method).toBe("GET");
    expect(plan.target.toString()).toBe(CIBLE);
    expect(plan.upstreamHeaders.get("authorization")).toBe("Bearer CLE-TEST-SECRETE");
    expect(plan.upstreamHeaders.has("cookie")).toBe(false);
    expect(plan.upstreamHeaders.has("x-extra")).toBe(false);
    expect(plan.cacheControl).toBe("private, no-store");
    expect(plan.privateResponse).toBe(true);
    expect(plan.maxRedirects).toBe(0);
    expect([...plan.allowedRedirectHosts]).toEqual(["api.cryptoquant.com"]);
  });

  test("route publique et forme réécrite : même cible ; query normalisée sur les trois chemins", () => {
    const publique = planProxyRequest(`https://axiom.test/cqapi/${CHEMIN}?${QUERY}`, "GET", bearer());
    expect(publique.target.toString()).toBe(CIBLE);
    expect(
      planProxyRequest(url("cqapi", "v2/market/cq/swap/trade", "window=day&symbol=eth_all"), "GET", bearer())
        .target.toString(),
    ).toBe("https://api.cryptoquant.com/v2/market/cq/swap/trade?symbol=eth_all&window=day");
    expect(
      planProxyRequest(url("cqapi", "v1/btc/miner-data/companies", "limit=30&window=day&miner=mara"), "GET", bearer())
        .target.toString(),
    ).toBe("https://api.cryptoquant.com/v1/btc/miner-data/companies?miner=mara&window=day&limit=30");
  });

  test("404 pour tout chemin ou paramètre hors liste fermée", () => {
    for (const [path, query] of [
      ["v1/btc/exchange-flows/reserve", "exchange=all_exchange&window=day"],
      [CHEMIN, "symbol=sol_all&window=day&limit=30"],
      ["v1/btc/miner-data/companies", "miner=inconnu&window=day&limit=30"],
      [CHEMIN, "symbol=btc_all&window=hour&limit=30"],
      [CHEMIN, "symbol=btc_all&window=day&limit=31"],
      [CHEMIN, "symbol=btc_all&window=day&from=20260901"],
      [CHEMIN, "symbol=btc_all&window=day&inconnu=1"],
      [CHEMIN, "symbol=btc_all&symbol=btc_all&window=day"],
      [`${CHEMIN}/`, QUERY],
    ] as const) {
      const error = policyError(() => planProxyRequest(url("cqapi", path, query), "GET", bearer()));
      expect(error.status).toBe(404);
      expect(error.message).toBe("chemin CryptoQuant refusé");
    }
  });

  test("POST et HEAD : 405 allow GET, avec ou sans clé", () => {
    for (const method of ["POST", "HEAD"]) {
      for (const headers of [new Headers(), bearer()]) {
        const error = policyError(() => planProxyRequest(url("cqapi", CHEMIN, QUERY), method, headers));
        expect(error.status).toBe(405);
        expect(error.allow).toBe("GET");
      }
    }
  });

  test("Apikey, Basic, jeton vide ou en-tête de plus de 512 caractères : 401", () => {
    for (const authorization of [
      "Apikey CLE-TEST-SECRETE",
      "Basic CLE-TEST-SECRETE",
      "Bearer",
      `Bearer ${"x".repeat(600)}`,
    ]) {
      const error = policyError(() =>
        planProxyRequest(url("cqapi", CHEMIN, QUERY), "GET", new Headers({ authorization }), envServeur),
      );
      expect(error.status).toBe(401);
    }
  });

  test("aucune variable serveur ne part vers api.cryptoquant.com, le Bearer ne part vers aucun autre hôte fixe", () => {
    const plan = planProxyRequest(
      url("cqapi", CHEMIN, QUERY),
      "GET",
      new Headers({ authorization: "Bearer personnelle" }),
      envServeur,
    );
    expect(plan.upstreamHeaders.get("authorization")).toBe("Bearer personnelle");
    expect(proxyUpstreamHeaders(new Headers(), "api.cryptoquant.com", "GET", envServeur).has("authorization")).toBe(false);
    expect(
      proxyUpstreamHeaders(new Headers({ authorization: "Apikey x" }), "api.cryptoquant.com", "GET", envServeur)
        .has("authorization"),
    ).toBe(false);
    expect(
      planProxyRequest(
        url("fredapi", "fred/series/observations"),
        "GET",
        new Headers({ authorization: "Bearer personnelle" }),
        envServeur,
      ).upstreamHeaders.has("authorization"),
    ).toBe(false);
  });
});
```

Le test structurel des lignes 34-46 (« exactement une occurrence de `env[` ») n'est **pas** modifié : il devient la preuve qu'aucun repli CryptoQuant n'existe côté Vercel.

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue**

```bash
pnpm --filter @axiom/daemon exec bun test src/vercelProxy.test.ts
```

Résumé attendu : `18 pass`, `9 fail`. Échecs : « place les onze rewrites… » (`Expected: true`, `Received: false`) ; « fixe l'autorité des neuf routes… » (lève `route proxy inconnue`) ; dans le `describe` CryptoQuant, « GET sans Authorization » (`Expected: 401`, `Received: 404`), « 404 pour tout chemin… » (`Expected: "chemin CryptoQuant refusé"`, `Received: "route proxy inconnue"`), « POST et HEAD » (`Expected: 405`, `Received: 404`), « Apikey, Basic… » (`Expected: 401`, `Received: 404`), et les tests « Bearer personnel », « route publique », « aucune variable serveur » (lèvent `route proxy inconnue`). Le test structurel `env[` reste vert.

- [ ] **Étape 3 : implémentation minimale de la politique et des rewrites**

`api/_policy.ts`, ligne 3 — ajouter la ligne 4 juste après :

```ts
import { DEFILLAMA_PRO_HEADER, DEFILLAMA_PRO_HOST, cheminDefillamaAmont, cleDefillamaValide } from "../shared/defillama-proxy.js";
import { CRYPTOQUANT_HOST, cheminCryptoQuantAmont, cleCryptoQuantValide } from "../shared/cryptoquant-proxy.js";
```

`api/_policy.ts`, lignes 24-34 — remplacer le type par :

```ts
export type ProxyRouteId =
  | "extapi"
  | "fredapi"
  | "coinalyzeapi"
  | "tdapi"
  | "mexcapi"
  | "sosoapi"
  | "bgapi"
  | "ethscanapi"
  | "ccdataapi"
  | "defillamapro"
  | "cqapi";
```

`api/_policy.ts`, lignes 41-51 — remplacer la table par (le type `Exclude<ProxyRouteId, "extapi">` impose l'entrée : sans elle, `pnpm --filter @axiom/daemon typecheck` échoue) :

```ts
const FIXED_ROUTES: Readonly<Record<Exclude<ProxyRouteId, "extapi">, FixedRoute>> = {
  fredapi: { host: "api.stlouisfed.org", methods: ["GET", "HEAD"] },
  coinalyzeapi: { host: "api.coinalyze.net", methods: ["GET", "HEAD"] },
  tdapi: { host: "api.twelvedata.com", methods: ["GET", "HEAD"] },
  mexcapi: { host: "api.mexc.com", methods: ["GET", "HEAD"] },
  sosoapi: { host: "openapi.sosovalue.com", methods: ["GET", "HEAD", "POST"] },
  bgapi: { host: "bitcoin-data.com", methods: ["GET", "HEAD"] },
  ethscanapi: { host: "api.etherscan.io", methods: ["GET", "HEAD"] },
  ccdataapi: { host: "min-api.cryptocompare.com", methods: ["GET", "HEAD"] },
  defillamapro: { host: DEFILLAMA_PRO_HOST, methods: ["GET"] },
  // CryptoQuant BASIC (licence personnelle) : lecture seule, liste fermée dans planProxyRequest.
  cqapi: { host: CRYPTOQUANT_HOST, methods: ["GET"] },
};
```

`api/_policy.ts`, lignes 53-64 — remplacer par (le typage n'impose pas l'exhaustivité : un oubli ici compilerait et donnerait un 404 silencieux) :

```ts
// Liste NON vérifiée par le typage : toute nouvelle route doit y figurer (sinon 404 silencieux).
const ROUTE_IDS: readonly ProxyRouteId[] = [
  "extapi",
  "fredapi",
  "coinalyzeapi",
  "tdapi",
  "mexcapi",
  "sosoapi",
  "bgapi",
  "ethscanapi",
  "ccdataapi",
  "defillamapro",
  "cqapi",
];
```

`api/_policy.ts`, dans `proxyUpstreamHeaders`, insérer entre la ligne 299 (`  }` qui ferme le bloc `min-api.cryptocompare.com`) et la ligne 300 (`  const contentType = headers.get("content-type");`) :

```ts
  // CryptoQuant BASIC (licence PERSONNELLE) : seul le Bearer du client est relayé, et
  // uniquement vers son hôte. Aucun repli serveur : ce bloc ne lit aucune variable.
  if (host === CRYPTOQUANT_HOST && cleCryptoQuantValide(authorization)) {
    upstream.set("authorization", authorization);
  }
```

`api/_policy.ts`, dans `planProxyRequest`, insérer entre la ligne 351 (`    }` qui ferme `if (route === "defillamapro")`) et la ligne 352 (`  }` qui ferme le `else`) :

```ts
    if (route === "cqapi") {
      // CryptoQuant BASIC : méthode, clé personnelle puis liste FERMÉE, tous refusés
      // localement AVANT l'amont (même ordre que le proxy Vite et le daemon). Jamais de
      // repli serveur : sans Bearer valide, 401 même si une variable existe sur le déploiement.
      if (!methods.includes(normalizedMethod)) {
        throw new ProxyPolicyError(405, "méthode proxy non autorisée", methods.join(", "));
      }
      if (!cleCryptoQuantValide(headers.get("authorization"))) {
        throw new ProxyPolicyError(401, "clé CryptoQuant personnelle requise");
      }
      const localQuery = originalQuery(source).toString();
      const allowedPath = cheminCryptoQuantAmont(`/cqapi/${path}`, localQuery ? `?${localQuery}` : "");
      if (allowedPath === null) throw new ProxyPolicyError(404, "chemin CryptoQuant refusé");
      const [pathname = "", search = ""] = allowedPath.split("?", 2);
      // `target.pathname` est reconstruit plus bas avec un « / » initial.
      upstreamPath = pathname.replace(/^\/+/, "");
      // La query normalisée remplace la query entrante (relue par originalQuery ci-dessous).
      source.search = search;
    }
```

`api/_policy.ts`, ligne 383 — remplacer :

```ts
    maxRedirects: route === "defillamapro" ? 0 : undefined,
```

par :

```ts
    maxRedirects: route === "defillamapro" || route === "cqapi" ? 0 : undefined,
```

`vercel.json` — insérer entre la ligne 88 (`    },` qui ferme la rewrite `/defillamapro/:path*/`) et la ligne 89 (`    {` du repli `/(.*)`) :

```json
    {
      "source": "/cqapi/:path*",
      "destination": "/api/proxy?__axiom_route=cqapi&__axiom_path=:path"
    },
    {
      "source": "/cqapi/:path*/",
      "destination": "/api/proxy?__axiom_route=cqapi&__axiom_path=:path/"
    },
```

Aucune modification du `Content-Security-Policy-Report-Only` : `/cqapi` est même-origine (`connect-src 'self'`).

- [ ] **Étape 4 : lancer les tests de politique et vérifier qu'ils passent**

```bash
pnpm --filter @axiom/daemon exec bun test src/vercelProxy.test.ts
pnpm --filter @axiom/daemon typecheck
node -e 'JSON.parse(require("node:fs").readFileSync("vercel.json", "utf8")); console.log("vercel.json valide")'
```

Attendu : `0 fail` (dont le test structurel « une seule fonction Web Standard… » inchangé) ; typecheck sans diagnostic ; `vercel.json valide`.

- [ ] **Étape 5 : écrire le test qui échoue (handler Vercel)** — dans `apps/daemon/src/vercelProxy.redirection.test.ts`.

Lignes 15-19 — remplacer le helper par (compatible avec les appels existants) :

```ts
function url(route: string, path: string, query = ""): string {
  const params = new URLSearchParams({ __axiom_route: route, __axiom_path: path });
  params.append("path", path);
  if (query) {
    for (const [key, value] of new URLSearchParams(query)) params.append(key, value);
  }
  return `https://axiom.test/api/proxy?${params}`;
}
```

Ajouter à la fin du fichier (après la ligne 82) :

```ts
describe("route CryptoQuant /cqapi (handler complet)", () => {
  const CHEMIN = "v2/market/cq/spot/trade";
  const QUERY = "symbol=btc_all&window=day&limit=30";
  const cqOriginal = process.env["CRYPTOQUANT_API_KEY"];

  beforeEach(() => {
    // Une variable posée par erreur sur le déploiement ne doit JAMAIS servir de repli.
    process.env["CRYPTOQUANT_API_KEY"] = "repli-interdit";
  });
  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    if (cqOriginal === undefined) delete process.env["CRYPTOQUANT_API_KEY"];
    else process.env["CRYPTOQUANT_API_KEY"] = cqOriginal;
  });

  test("302 amont : refusé (502) après un seul appel, la clé n'est jamais renvoyée au client", async () => {
    const { default: proxyFunction } = await import("../../../api/proxy");
    const appels: string[] = [];
    globalThis.fetch = (async (entree: string | URL | Request, init?: RequestInit) => {
      const cible = new URL(entree instanceof Request ? entree.url : String(entree));
      appels.push(`${cible.href} ${new Headers(init?.headers).get("authorization") ?? "-"}`);
      return new Response(null, {
        status: 302,
        headers: { location: `https://api.cryptoquant.com/${CHEMIN}?${QUERY}` },
      });
    }) as typeof fetch;

    const reponse = await proxyFunction.fetch(
      new Request(url("cqapi", CHEMIN, QUERY), { headers: { authorization: "Bearer CLE-TEST-SECRETE" } }),
    );
    expect(reponse.status).toBe(502);
    expect(appels).toEqual([`https://api.cryptoquant.com/${CHEMIN}?${QUERY} Bearer CLE-TEST-SECRETE`]);
    expect(await reponse.text()).not.toContain("CLE-TEST-SECRETE");
  });

  test("429 amont : statut, trois en-têtes de quota et corps relayés, réponse privée", async () => {
    const { default: proxyFunction } = await import("../../../api/proxy");
    const corps = { status: { code: 429, message: "Too Many Requests" } };
    globalThis.fetch = (async () =>
      Response.json(corps, {
        status: 429,
        headers: {
          "x-ratelimit-limit": "10",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "42",
          "x-autre-entete": "non-relaye",
        },
      })) as unknown as typeof fetch;

    const reponse = await proxyFunction.fetch(
      new Request(url("cqapi", CHEMIN, QUERY), { headers: { authorization: "Bearer CLE-TEST-SECRETE" } }),
    );
    expect(reponse.status).toBe(429);
    expect(reponse.headers.get("x-ratelimit-limit")).toBe("10");
    expect(reponse.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(reponse.headers.get("x-ratelimit-reset")).toBe("42");
    expect(reponse.headers.has("x-autre-entete")).toBe(false);
    expect(reponse.headers.get("cache-control")).toBe("private, no-store");
    expect(await reponse.json()).toEqual(corps);
  });

  test("sans clé personnelle : 401 local et zéro appel, malgré la variable serveur", async () => {
    const { default: proxyFunction } = await import("../../../api/proxy");
    let appels = 0;
    globalThis.fetch = (async () => {
      appels += 1;
      return Response.json({});
    }) as unknown as typeof fetch;

    const reponse = await proxyFunction.fetch(new Request(url("cqapi", CHEMIN, QUERY)));
    expect(reponse.status).toBe(401);
    expect(appels).toBe(0);
    expect(reponse.headers.get("cache-control")).toBe("private, no-store");
    expect(await reponse.json()).toEqual({ erreur: "clé CryptoQuant personnelle requise", statut: 401 });
  });
});
```

- [ ] **Étape 6 : lancer les tests du handler et vérifier l'échec attendu**

```bash
pnpm --filter @axiom/daemon exec bun test src/vercelProxy.redirection.test.ts
```

Résumé attendu : `5 pass`, `1 fail`. Le test « 429 amont » échoue sur `x-ratelimit-limit` (`Expected: "10"`, `Received: null`) — `api/proxy.ts` reconstruit ses en-têtes et ne recopie encore aucun en-tête de quota. Les tests « 302 » et « sans clé » passent déjà grâce à l'étape 3 (`maxRedirects: 0`, 401 de politique) ; les trois tests BGeometrics existants restent verts.

- [ ] **Étape 7 : implémentation minimale du handler** — `api/proxy.ts`, insérer entre la ligne 356 (`    });` qui ferme `const responseHeaders = new Headers({…`) et la ligne 357 (`    if (plan.method === "HEAD" || BODYLESS_STATUSES.has(upstream.status)) {`) :

```ts
    if (plan.route === "cqapi") {
      // Quota CryptoQuant (10 req/min) : ensemble FERMÉ d'en-têtes amont recopiés pour la
      // cadence du client. Le corps amont (status.message) est relayé tel quel plus bas —
      // contrairement à defillamapro, la clé voyage en en-tête et jamais dans l'URL.
      for (const nom of ["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"]) {
        const valeur = upstream.headers.get(nom);
        if (valeur !== null) responseHeaders.set(nom, valeur);
      }
    }
```

- [ ] **Étape 8 : lancer les tests et vérifier qu'ils passent**

```bash
pnpm --filter @axiom/daemon exec bun test src/vercelProxy.test.ts src/vercelProxy.redirection.test.ts src/vercelProxy-requete-bornee.test.ts
pnpm --filter @axiom/daemon test
pnpm --filter @axiom/daemon typecheck
```

Attendu : `0 fail` sur les trois fichiers Vercel (le fichier de redirection passe à `6 pass`) puis sur toute la suite daemon ; typecheck sans diagnostic.

- [ ] **Étape 9 : commit**

```bash
git add api/_policy.ts api/proxy.ts vercel.json apps/daemon/src/vercelProxy.test.ts apps/daemon/src/vercelProxy.redirection.test.ts
git commit -m "feat(vercel): route /cqapi — Bearer personnel seul, liste fermée, zéro redirection, quota relayé" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

### Tâche 4 : route `/cqapi` du daemon — clé `.env`, gestionnaire dédié, jamais de cache (B1-2, brief daemon)

**Fichiers :**
- Modifier : `apps/daemon/src/env.ts:16-24` (`ProxyKeys`), `apps/daemon/src/env.ts:72-79` (`chargerCles`)
- Modifier : `apps/daemon/src/proxy.ts:10-11` (en-tête de fichier), `apps/daemon/src/proxy.ts:25` (import), `apps/daemon/src/proxy.ts:947-948` (nouveau gestionnaire après `traiterDefillamaPro`), `apps/daemon/src/proxy.ts:1115-1116` (`enregistrerProxy`)
- Tester : `apps/daemon/src/env.test.ts` (modifier `:1-2`, ajout après `:38`)
- Tester : `apps/daemon/src/cache.test.ts` (ajout entre `:29` et `:31`)
- Tester : `apps/daemon/src/proxy.test.ts` (modifier `:1-29`, ajout entre `:140` et `:141`, ajout après `:862`)

**Interfaces :**
- Consomme (Tâche 2) : `CRYPTOQUANT_HOST`, `CRYPTOQUANT_PREFIXE`, `cheminCryptoQuantAmont`, `cleCryptoQuantValide`, importés depuis `"../../../shared/cryptoquant-proxy"` ; `recupererExtapiSecurise`, `OptionsExtapi`, `ReponseAmontExtapi`, `requeteNavigationExtapiInterdite`, `entetesCors` (existants).
- Produit :
  - `ProxyKeys.CRYPTOQUANT_API_KEY: string` (chaîne vide si absente de `apps/web/.env`).
  - `export async function traiterCryptoQuant(req: Request, url: URL, cleEnv: string, options?: OptionsExtapi): Promise<Response>` — refus locaux AVANT tout fetch : navigation → 403, non-GET (HEAD compris) → 405 `allow: GET`, ni Bearer client valide ni `cleEnv` → 401, hors liste → 404 ; corps `{ erreur: string }`, `cache-control: private, no-store`. Clé relayée : l'en-tête client s'il est valide, sinon `Bearer <cleEnv>` — un en-tête présent mais invalide est donc remplacé par le repli `.env` (écart acté à la spec §4.1, consigné au rapport en tâche 20). Succès ou erreur amont : statut et corps amont relayés, `x-ratelimit-limit/remaining/reset` recopiés, `access-control-expose-headers: x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset`. Panne réseau ou politique → 502 `{ erreur, detail }` avec le jeton expurgé (`***`). Le corps de la fonction ne référence ni `lireCache` ni `ecrireCache` (verrou par lecture de la source dans `proxy.test.ts`).
  - Route daemon `GET /cqapi/...` enregistrée par `enregistrerProxy(routeur, cles)` ; aucune entrée dans `construireRoutesProxy`, aucune dans `TTL_SECONDES_PAR_PREFIXE`.

- [ ] **Étape 1 : écrire le test qui échoue (clé `.env`) et le verrou de cache**

`apps/daemon/src/env.test.ts`, lignes 1-2 — remplacer par :

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chargerCles, parseEnv } from "./env";
```

Ajouter à la fin du fichier (après la ligne 38) :

```ts
describe("chargerCles — repli CryptoQuant (proxy /cqapi local)", () => {
  test("parseEnv lit CRYPTOQUANT_API_KEY", () => {
    expect(parseEnv("CRYPTOQUANT_API_KEY=abc").CRYPTOQUANT_API_KEY).toBe("abc");
  });

  test("chargerCles expose CRYPTOQUANT_API_KEY depuis le fichier .env", () => {
    const dossier = mkdtempSync(join(tmpdir(), "axiom-env-"));
    try {
      const chemin = join(dossier, ".env");
      writeFileSync(chemin, "BGEOMETRICS_API_KEY=bg\nCRYPTOQUANT_API_KEY=abc\n");
      const cles = chargerCles(chemin);
      expect(cles.CRYPTOQUANT_API_KEY).toBe("abc");
      expect(cles.BGEOMETRICS_API_KEY).toBe("bg");
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });

  test("fichier absent : chaîne vide, jamais undefined", () => {
    const absent = join(tmpdir(), `axiom-env-absent-${process.pid}`, ".env");
    expect(chargerCles(absent).CRYPTOQUANT_API_KEY).toBe("");
  });
});
```

`apps/daemon/src/cache.test.ts` — insérer entre la ligne 29 (`  });` qui ferme « chemin inconnu → 0 ») et la ligne 31 (test « les constantes de TTL… », laissé intact) :

```ts

  test("/cqapi n'est jamais mis en cache : la clé de cache ignore Authorization", () => {
    // Une réponse obtenue avec une clé personnelle serait resservie à une autre clé.
    expect(ttlMsPourChemin("/cqapi/v2/market/cq/spot/trade")).toBe(0);
    expect(ttlMsPourChemin("/cqapi/v1/btc/miner-data/companies")).toBe(0);
    expect(ttlMsPourChemin("/cqapi")).toBe(0);
  });
```

- [ ] **Étape 2 : lancer les tests et vérifier l'échec**

```bash
pnpm --filter @axiom/daemon exec bun test src/env.test.ts src/cache.test.ts
```

Résumé attendu : `18 pass`, `2 fail`. Échecs dans `env.test.ts` : « chargerCles expose CRYPTOQUANT_API_KEY… » (`Expected: "abc"`, `Received: undefined`) et « fichier absent… » (`Expected: ""`, `Received: undefined`). « parseEnv lit CRYPTOQUANT_API_KEY » est déjà vert (parseur générique). Le nouveau test de `cache.test.ts` est un **verrou**, vert dès l'écriture (aucune entrée `/cqapi` n'existe) : il doit le rester ; le test « les constantes de TTL sont celles documentées » (`:31-39`) reste lui aussi inchangé et vert.

- [ ] **Étape 3 : implémentation minimale de `env.ts`**

Lignes 16-24 — remplacer l'interface par :

```ts
/** Clés injectées par le proxy (repli quand le front n'en fournit pas). */
export interface ProxyKeys {
  FRED_API_KEY: string;
  COINALYZE_API_KEY: string;
  TWELVE_DATA_KEY: string;
  SOSOVALUE_API_KEY: string;
  ETHERSCAN_API_KEY: string;
  BGEOMETRICS_API_KEY: string;
  /**
   * CryptoQuant BASIC (licence PERSONNELLE) : repli de la route /cqapi pour ce daemon lié
   * à 127.0.0.1 UNIQUEMENT. Aucune variable équivalente n'existe côté Vercel.
   */
  CRYPTOQUANT_API_KEY: string;
}
```

Lignes 72-79 — remplacer l'objet retourné par :

```ts
  return {
    FRED_API_KEY: env.FRED_API_KEY ?? "",
    COINALYZE_API_KEY: env.COINALYZE_API_KEY ?? "",
    TWELVE_DATA_KEY: env.TWELVE_DATA_KEY ?? "",
    SOSOVALUE_API_KEY: env.SOSOVALUE_API_KEY ?? "",
    ETHERSCAN_API_KEY: env.ETHERSCAN_API_KEY ?? "",
    BGEOMETRICS_API_KEY: env.BGEOMETRICS_API_KEY ?? "",
    CRYPTOQUANT_API_KEY: env.CRYPTOQUANT_API_KEY ?? "",
  };
```

- [ ] **Étape 4 : lancer les tests et vérifier qu'ils passent**

```bash
pnpm --filter @axiom/daemon exec bun test src/env.test.ts src/cache.test.ts
```

Attendu : `0 fail` (Bun ne vérifie pas les types). Le typecheck du daemon, lui, échoue à ce stade : le littéral `const CLES: ProxyKeys` de `proxy.test.ts:22-29` ne porte pas encore `CRYPTOQUANT_API_KEY` (`TS2741: Property 'CRYPTOQUANT_API_KEY' is missing`). L'étape 5 ajoute le champ et l'étape 8 vérifie le typecheck ; aucun commit n'intervient entre les deux.

- [ ] **Étape 5 : écrire le test qui échoue (gestionnaire daemon)** — `apps/daemon/src/proxy.test.ts`.

Lignes 1-29 — remplacer l'en-tête du fichier (imports et `CLES`) par :

```ts
import { describe, expect, spyOn, test } from "bun:test";
import {
  adresseIpPublique,
  appendApiKeyIfAbsent,
  construireRoutesProxy,
  construireUrlAmontExtapi,
  enregistrerProxy,
  EXTAPI_WHITELIST,
  mimeExtapiAutorise,
  parseExtapiChemin,
  recupererExtapiSecurise,
  requeteNavigationExtapiInterdite,
  traiterCcData,
  traiterCryptoQuant,
  traiterDefillamaPro,
  traiterExtapi,
  traiterProxy,
  ttlMsExtapi,
  userAgentPourHote,
  type FetchExtapi,
  type RouteProxy,
} from "./proxy";
import type { ProxyKeys } from "./env";
import { Routeur } from "./router";

const CLES: ProxyKeys = {
  FRED_API_KEY: "fredkey",
  COINALYZE_API_KEY: "coinkey",
  TWELVE_DATA_KEY: "tdkey",
  SOSOVALUE_API_KEY: "sosokey",
  ETHERSCAN_API_KEY: "ethkey",
  BGEOMETRICS_API_KEY: "bgkey",
  CRYPTOQUANT_API_KEY: "cqkey",
};
```

Insérer entre la ligne 140 (`  });` qui ferme « aucune route générique /ccdataapi… ») et la ligne 141 (`});` qui ferme le `describe` « construireRoutesProxy ») :

```ts

  test("aucune route générique /cqapi : le préfixe est servi par traiterCryptoQuant seul", () => {
    // Une RouteProxy passerait par traiterProxy, donc par le cache SQLite dont la clé
    // ignore Authorization : une réponse obtenue avec une clé serait resservie à une autre.
    expect(construireRoutesProxy(CLES).some((route) => route.prefix === "/cqapi")).toBe(false);
  });
```

Ajouter à la fin du fichier (après la ligne 862) :

```ts
describe("traiterCryptoQuant — licence personnelle, liste fermée, jamais en cache", () => {
  const LOCAL = "http://127.0.0.1:8787/cqapi/v2/market/cq/spot/trade?symbol=btc_all&window=day&limit=30";
  const CIBLE = "https://api.cryptoquant.com/v2/market/cq/spot/trade?symbol=btc_all&window=day&limit=30";
  const resoudrePublic = async (): Promise<readonly string[]> => ["104.18.10.10"];

  interface AppelAmont {
    url: string;
    authorization: string | null;
    redirect: RequestRedirect | undefined;
  }

  /** Amont simulé : mémorise l'URL, l'Authorization et le mode de redirection de chaque appel. */
  function amontSimule(repondre: () => Response): { appels: AppelAmont[]; fetchImpl: FetchExtapi } {
    const appels: AppelAmont[] = [];
    const fetchImpl: FetchExtapi = async (input, init) => {
      appels.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
        redirect: init?.redirect,
      });
      return repondre();
    };
    return { appels, fetchImpl };
  }

  const corps200 = { status: { code: 200, message: "success" }, result: { window: "DAY", data: [] } };
  const reponse200 = (): Response =>
    new Response(JSON.stringify(corps200), {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=600",
        "x-ratelimit-limit": "10",
        "x-ratelimit-remaining": "9",
        "x-ratelimit-reset": "6",
        "x-autre": "non-relaye",
      },
    });

  test("URL amont exacte, Bearer personnel relayé, redirect manual, private no-store, quota exposé", async () => {
    const { appels, fetchImpl } = amontSimule(reponse200);
    const req = new Request(LOCAL, {
      headers: { authorization: "Bearer CLE-TEST-SECRETE", origin: "http://localhost:5173" },
    });
    const rep = await traiterCryptoQuant(req, new URL(req.url), "envkey", { fetchImpl, resoudreHote: resoudrePublic });

    expect(rep.status).toBe(200);
    expect(appels).toEqual([{ url: CIBLE, authorization: "Bearer CLE-TEST-SECRETE", redirect: "manual" }]);
    expect(rep.headers.get("cache-control")).toBe("private, no-store");
    expect(rep.headers.get("x-content-type-options")).toBe("nosniff");
    expect(rep.headers.get("x-ratelimit-limit")).toBe("10");
    expect(rep.headers.get("x-ratelimit-remaining")).toBe("9");
    expect(rep.headers.get("x-ratelimit-reset")).toBe("6");
    expect(rep.headers.has("x-autre")).toBe(false);
    expect(rep.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(rep.headers.get("access-control-expose-headers")).toBe(
      "x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset",
    );
    expect(await rep.json()).toEqual(corps200);
  });

  test("normalise la query amont (ordre miner, window, limit)", async () => {
    const { appels, fetchImpl } = amontSimule(reponse200);
    const req = new Request("http://127.0.0.1:8787/cqapi/v1/btc/miner-data/companies?limit=30&window=day&miner=mara", {
      headers: { authorization: "Bearer CLE-TEST-SECRETE" },
    });
    const rep = await traiterCryptoQuant(req, new URL(req.url), "", { fetchImpl, resoudreHote: resoudrePublic });
    expect(rep.status).toBe(200);
    expect(appels.map((appel) => appel.url)).toEqual([
      "https://api.cryptoquant.com/v1/btc/miner-data/companies?miner=mara&window=day&limit=30",
    ]);
  });

  test("relaie le statut et le corps d'un refus amont (403 d'offre)", async () => {
    const corps = { status: { code: 403, message: "This metric requires Professional plan and above." } };
    const { fetchImpl } = amontSimule(
      () => new Response(JSON.stringify(corps), { status: 403, headers: { "content-type": "application/json" } }),
    );
    const req = new Request(LOCAL, { headers: { authorization: "Bearer CLE-TEST-SECRETE" } });
    const rep = await traiterCryptoQuant(req, new URL(req.url), "", { fetchImpl, resoudreHote: resoudrePublic });
    expect(rep.status).toBe(403);
    expect(rep.headers.get("cache-control")).toBe("private, no-store");
    expect(await rep.json()).toEqual(corps);
  });

  test("refus 403, 405, 404 puis 401 AVANT tout fetch", async () => {
    const { appels, fetchImpl } = amontSimule(reponse200);
    const options = { fetchImpl, resoudreHote: resoudrePublic };
    const bearer = { authorization: "Bearer CLE-TEST-SECRETE" };
    const cas: Array<{ req: Request; cleEnv: string; statut: number }> = [
      { req: new Request(LOCAL, { headers: { ...bearer, "sec-fetch-mode": "navigate" } }), cleEnv: "envkey", statut: 403 },
      { req: new Request(LOCAL, { headers: { ...bearer, "sec-fetch-dest": "script" } }), cleEnv: "envkey", statut: 403 },
      { req: new Request(LOCAL, { method: "POST", headers: bearer }), cleEnv: "envkey", statut: 405 },
      { req: new Request(LOCAL, { method: "HEAD", headers: bearer }), cleEnv: "envkey", statut: 405 },
      // Méthode contrôlée avant la clé : un POST sans aucune clé reste un 405.
      { req: new Request(LOCAL, { method: "POST" }), cleEnv: "", statut: 405 },
      {
        req: new Request("http://127.0.0.1:8787/cqapi/v1/btc/exchange-flows/reserve?exchange=all_exchange&window=day", { headers: bearer }),
        cleEnv: "envkey",
        statut: 404,
      },
      { req: new Request(`${LOCAL}&from=20260901`, { headers: bearer }), cleEnv: "envkey", statut: 404 },
      { req: new Request("http://127.0.0.1:8787/cqapi/v2/market/cq/spot/trade?symbol=sol_all&window=day"), cleEnv: "envkey", statut: 404 },
      { req: new Request(LOCAL), cleEnv: "", statut: 401 },
      { req: new Request(LOCAL, { headers: { authorization: "Apikey CLE-TEST-SECRETE" } }), cleEnv: "", statut: 401 },
      { req: new Request(LOCAL, { headers: { authorization: `Bearer ${"x".repeat(600)}` } }), cleEnv: "", statut: 401 },
    ];
    for (const { req, cleEnv, statut } of cas) {
      const rep = await traiterCryptoQuant(req, new URL(req.url), cleEnv, options);
      expect(rep.status).toBe(statut);
      expect(rep.headers.get("cache-control")).toBe("private, no-store");
      expect(rep.headers.get("allow")).toBe(statut === 405 ? "GET" : null);
      expect(await rep.text()).not.toContain("CLE-TEST-SECRETE");
    }
    expect(appels).toHaveLength(0);
  });

  test("repli .env sans en-tête, en-tête invalide remplacé, en-tête personnel prioritaire", async () => {
    const { appels, fetchImpl } = amontSimule(reponse200);
    const options = { fetchImpl, resoudreHote: resoudrePublic };
    const sansEntete = new Request(LOCAL);
    const invalide = new Request(LOCAL, { headers: { authorization: "Basic xyz" } });
    const perso = new Request(LOCAL, { headers: { authorization: "Bearer perso" } });
    expect((await traiterCryptoQuant(sansEntete, new URL(sansEntete.url), "envkey", options)).status).toBe(200);
    expect((await traiterCryptoQuant(invalide, new URL(invalide.url), "envkey", options)).status).toBe(200);
    expect((await traiterCryptoQuant(perso, new URL(perso.url), "envkey", options)).status).toBe(200);
    expect(appels.map((appel) => appel.authorization)).toEqual(["Bearer envkey", "Bearer envkey", "Bearer perso"]);
  });

  test("aucune sortie console ni réponse ne contient l'Authorization", async () => {
    const sorties: string[] = [];
    const capturer = (...args: unknown[]): void => {
      sorties.push(args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack ?? ""}` : String(arg))).join(" "));
    };
    const espions = [
      spyOn(console, "log").mockImplementation(capturer),
      spyOn(console, "info").mockImplementation(capturer),
      spyOn(console, "warn").mockImplementation(capturer),
      spyOn(console, "error").mockImplementation(capturer),
      spyOn(console, "debug").mockImplementation(capturer),
    ];
    try {
      const perso = new Request(LOCAL, { headers: { authorization: "Bearer CLE-TEST-SECRETE" } });
      const panne = await traiterCryptoQuant(perso, new URL(perso.url), "", {
        fetchImpl: async () => {
          throw new Error("échec amont avec Bearer CLE-TEST-SECRETE");
        },
        resoudreHote: resoudrePublic,
      });
      expect(panne.status).toBe(502);
      expect(await panne.text()).not.toContain("CLE-TEST-SECRETE");

      const repli = new Request(LOCAL);
      const panneRepli = await traiterCryptoQuant(repli, new URL(repli.url), "CLE-ENV-SECRETE", {
        fetchImpl: async () => {
          throw new Error("échec amont avec Bearer CLE-ENV-SECRETE");
        },
        resoudreHote: resoudrePublic,
      });
      expect(panneRepli.status).toBe(502);
      expect(await panneRepli.text()).not.toContain("CLE-ENV-SECRETE");

      const encore = new Request(LOCAL, { headers: { authorization: "Bearer CLE-TEST-SECRETE" } });
      const succes = await traiterCryptoQuant(encore, new URL(encore.url), "", {
        fetchImpl: amontSimule(reponse200).fetchImpl,
        resoudreHote: resoudrePublic,
      });
      expect(succes.status).toBe(200);
    } finally {
      for (const espion of espions) espion.mockRestore();
    }
    expect(sorties.join("\n")).not.toContain("CLE-TEST-SECRETE");
    expect(sorties.join("\n")).not.toContain("CLE-ENV-SECRETE");
  });

  test("le corps de traiterCryptoQuant ne référence ni lireCache ni ecrireCache (lecture de la source)", async () => {
    // Des espions de cache injectés par les options ne prouveraient rien : un appel direct
    // aux fonctions importées de ./cache les contournerait. On lit donc la source, de la
    // déclaration jusqu'à la fonction de premier niveau suivante.
    const source = await Bun.file(new URL("./proxy.ts", import.meta.url)).text();
    const declaration = "export async function traiterCryptoQuant(";
    const debut = source.indexOf(declaration);
    expect(debut).toBeGreaterThan(-1);
    const reste = source.slice(debut + declaration.length);
    const fin = reste.search(/\n(?:export )?(?:async )?function \w+[(<]/);
    expect(fin).toBeGreaterThan(0);
    const corps = reste.slice(0, fin);
    // Garde-fou du découpage : une tranche vide ou mal placée passerait sinon.
    expect(corps).toContain("cheminCryptoQuantAmont(");
    expect(corps).toContain("recupererExtapiSecurise(");
    expect(corps).not.toContain("lireCache");
    expect(corps).not.toContain("ecrireCache");
  });

  test("enregistrerProxy branche /cqapi sur traiterCryptoQuant (refus locaux, sans réseau)", async () => {
    const routeur = new Routeur();
    enregistrerProxy(routeur, CLES);
    const adresse = new URL(LOCAL);
    const post = await routeur.gerer(new Request(adresse, { method: "POST" }), adresse);
    expect(post?.status).toBe(405);
    expect(post?.headers.get("allow")).toBe("GET");
    // Repli « cqkey » présent dans CLES : le refus vient de la liste fermée, pas de la clé.
    const horsListe = new URL("http://127.0.0.1:8787/cqapi/v1/btc/market-indicator/mvrv?window=day");
    const refus = await routeur.gerer(new Request(horsListe), horsListe);
    expect(refus?.status).toBe(404);
  });
});
```

- [ ] **Étape 6 : lancer les tests et vérifier qu'ils échouent**

```bash
pnpm --filter @axiom/daemon exec bun test src/proxy.test.ts
pnpm --filter @axiom/daemon typecheck
```

Échecs attendus : Bun refuse de charger le fichier — `SyntaxError: Export named 'traiterCryptoQuant' not found in module '…/apps/daemon/src/proxy.ts'.` (résumé `0 pass`, `1 fail`, `1 error`) ; le typecheck signale `TS2305: Module '"./proxy"' has no exported member 'traiterCryptoQuant'`.

- [ ] **Étape 7 : implémentation minimale de `proxy.ts`** — quatre modifications.

En-tête de fichier, lignes 10-11 — remplacer par :

```ts
 *   /bgapi → bitcoin-data.com (Bearer)
 *   /ccdataapi → min-api.cryptocompare.com (Apikey) — gestionnaire dédié traiterCcData, hors table
 *   /cqapi → api.cryptoquant.com (Bearer personnel, repli .env local) — gestionnaire dédié
 *            traiterCryptoQuant, liste fermée (shared/cryptoquant-proxy.ts), JAMAIS en cache
```

Ligne 25 — ajouter la ligne 26 juste après l'import DefiLlama :

```ts
import { DEFILLAMA_PRO_HEADER, DEFILLAMA_PRO_HOST, cheminDefillamaAmont, cleDefillamaValide, redigerSecretDefillama } from "../../../shared/defillama-proxy";
import { CRYPTOQUANT_HOST, CRYPTOQUANT_PREFIXE, cheminCryptoQuantAmont, cleCryptoQuantValide } from "../../../shared/cryptoquant-proxy";
```

Insérer entre la ligne 947 (`}` qui ferme `traiterDefillamaPro`) et la ligne 949 (`/** TTL cache /extapi par défaut (RSS et calendriers sont lents). */`) — la ligne 948 est vide ; la fonction de premier niveau qui suit le nouveau gestionnaire reste `export function ttlMsExtapi(` (ligne 970), ce que le verrou de lecture de source de l'étape 5 exploite :

```ts

/** En-têtes de quota CryptoQuant recopiés vers le client (ensemble FERMÉ). */
const ENTETES_QUOTA_CRYPTOQUANT = ["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"] as const;

/**
 * /cqapi — CryptoQuant BASIC (licence PERSONNELLE). Gestionnaire dédié, hors table
 * `construireRoutesProxy` et hors cache SQLite : `cleCache` ignore Authorization, une
 * réponse obtenue avec une clé serait resservie à une autre ; l'archive côté client est le
 * cache. Refus locaux, tous AVANT le réseau : navigation 403, méthode 405, clé 401 (en-tête
 * personnel valide prioritaire, sinon repli `.env` de ce daemon 127.0.0.1), chemin 404.
 */
export async function traiterCryptoQuant(
  req: Request,
  url: URL,
  cleEnv: string,
  options: OptionsExtapi = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-store",
    ...ENTETES_SECURITE_EXTAPI,
    ...entetesCors(req),
  };
  const refus = (status: number, erreur: string, extra: Record<string, string> = {}): Response =>
    new Response(JSON.stringify({ erreur }), { status, headers: { ...headers, ...extra } });

  if (requeteNavigationExtapiInterdite(req)) return refus(403, "navigation CryptoQuant interdite");
  if (req.method !== "GET") return refus(405, "méthode CryptoQuant non autorisée", { allow: "GET" });
  const entete = req.headers.get("authorization");
  const authorization = cleCryptoQuantValide(entete) ? entete : cleEnv.length > 0 ? `Bearer ${cleEnv}` : null;
  if (!cleCryptoQuantValide(authorization)) return refus(401, "clé CryptoQuant personnelle requise");
  const chemin = cheminCryptoQuantAmont(url.pathname, url.search);
  if (chemin === null) return refus(404, "chemin CryptoQuant refusé");

  let amont: ReponseAmontExtapi;
  try {
    amont = await recupererExtapiSecurise(`https://${CRYPTOQUANT_HOST}${chemin}`, {
      ...options,
      method: "GET",
      entetesAmont: { accept: "application/json", authorization },
      hotesAutorises: new Set([CRYPTOQUANT_HOST]),
      maxRedirections: 0,
      libelleTimeout: "/cqapi",
    });
  } catch (err) {
    // Détail expurgé : le jeton ne doit apparaître dans aucune réponse, même si un message
    // d'erreur le recopiait (patron redigerSecretDefillama).
    const jeton = authorization.replace(/^Bearer\s+/i, "");
    const detail = (err instanceof Error ? err.message : String(err)).split(jeton).join("***");
    return new Response(
      JSON.stringify({
        erreur: err instanceof ErreurPolitiqueExtapi ? "amont CryptoQuant refusé" : "amont CryptoQuant injoignable",
        detail,
      }),
      { status: 502, headers },
    );
  }

  const entetes: Record<string, string> = {
    ...headers,
    "content-type": amont.contentType,
    "access-control-expose-headers": ENTETES_QUOTA_CRYPTOQUANT.join(", "),
  };
  for (const nom of ENTETES_QUOTA_CRYPTOQUANT) {
    const valeur = amont.headers.get(nom);
    if (valeur !== null) entetes[nom] = valeur;
  }
  const statutSansCorps = amont.status === 204 || amont.status === 205 || amont.status === 304;
  return new Response(statutSansCorps ? null : amont.corps, { status: amont.status, headers: entetes });
}
```

`enregistrerProxy`, insérer entre la ligne 1115 (`  routeur.enregistrerPrefixe("/defillamapro", (req, url) => traiterDefillamaPro(req, url));`) et la ligne 1116 (`  // Proxy générique /extapi (Phase 3) : hôtes whitelistés, GET only, cache TTL.`) :

```ts
  // /cqapi : CryptoQuant BASIC (licence personnelle) — gestionnaire DÉDIÉ, liste fermée,
  // repli `.env` local seulement, JAMAIS de cache SQLite (la clé de cache ignore Authorization).
  routeur.enregistrerPrefixe(CRYPTOQUANT_PREFIXE, (req, url) => traiterCryptoQuant(req, url, cles.CRYPTOQUANT_API_KEY));
```

`apps/daemon/src/cache.ts` n'est **pas** modifié (`TTL_SECONDES_PAR_PREFIXE` reste verrouillé par `cache.test.ts:31-39`).

- [ ] **Étape 8 : lancer les tests et vérifier qu'ils passent**

```bash
pnpm --filter @axiom/daemon exec bun test src/proxy.test.ts src/env.test.ts src/cache.test.ts
pnpm --filter @axiom/daemon test
pnpm --filter @axiom/daemon typecheck
git diff --quiet -- apps/daemon/src/cache.ts && echo "cache.ts inchangé"
```

Attendu : `0 fail` sur les trois fichiers puis sur toute la suite daemon (dont `proxy-quota.test.ts`, `cors.test.ts`, `router.test.ts`) ; typecheck sans diagnostic (le littéral `CLES` compile avec le nouveau champ) ; `cache.ts inchangé`.

- [ ] **Étape 9 : commit**

```bash
git add apps/daemon/src/env.ts apps/daemon/src/proxy.ts apps/daemon/src/env.test.ts apps/daemon/src/cache.test.ts apps/daemon/src/proxy.test.ts
git commit -m "feat(daemon): route /cqapi — gestionnaire dédié, repli .env local, quota relayé, jamais en cache" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

### Tâche 5 : proxy de dev Vite `/cqapi` et drapeau `__CQ_CLE_ENV__` (B1-2, brief Vite)

**Fichiers :**
- Modifier : `apps/web/vite.config.ts:7` (import), `apps/web/vite.config.ts:81-84` (clé et drapeau), `apps/web/vite.config.ts:93-97` (`define`), `apps/web/vite.config.ts:271-272` (entrée `/cqapi` après `/defillamapro`)
- Modifier : `apps/web/.env.example:7` et `apps/web/.env.example:46` (ajout après la dernière ligne)
- Tester : `apps/web/src/viteConfig.test.ts` (ajout après `:108`)

**Interfaces :**
- Consomme (Tâche 2) : `CRYPTOQUANT_HOST`, `cheminCryptoQuantAmont`, `cleCryptoQuantValide`, importés depuis `"../../shared/cryptoquant-proxy"`.
- Produit :
  - `define.__CQ_CLE_ENV__` = `"true"` si et seulement si le build n'est pas Vercel (`process.env.VERCEL !== "1"`) ET `CRYPTOQUANT_API_KEY` non vide après `loadEnv` ; `"false"` sinon. Consommé par `apps/web/src/data/onchain/cryptoquant.ts` via `declare const __CQ_CLE_ENV__: boolean;` et la garde `typeof __CQ_CLE_ENV__ !== "undefined" ? __CQ_CLE_ENV__ : false` (patron `data/onchain/bgeometrics.ts:53-55`). Sous Vitest, ce `define` sans point devient une **globale** de test valant la présence de la clé dans `apps/web/.env` du poste : les tests de la zone D la fixent avec `vi.stubGlobal("__CQ_CLE_ENV__", false)` (ou `true`).
  - Proxy de dev `server.proxy["/cqapi"]` : refus locaux 405 (`allow: GET`) → 401 (ni Bearer valide ni `.env`) → 404 (hors liste), corps `{ erreur }`, `cache-control: private, no-store` ; relais vers `https://api.cryptoquant.com` avec query normalisée ; `Authorization: Bearer <.env>` injecté seulement si le client n'envoie pas de Bearer valide — en-tête client s'il est valide, sinon `.env`, y compris quand l'en-tête est présent mais invalide (écart acté à la spec §4.1, qui ne visait que l'en-tête absent ; consigné au rapport en tâche 20) ; réponse amont forcée `private, no-store`, `x-ratelimit-*` transmis tels quels (même origine) ; panne → 502 `{ erreur: "amont CryptoQuant injoignable" }`.

- [ ] **Étape 1 : écrire le test qui échoue** — ajouter à la fin de `apps/web/src/viteConfig.test.ts` (après la ligne 108 ; `afterEach`, `describe`, `expect`, `it`, `viteConfig`, `Bypass`, `bypassPour` et `reponse` existent déjà dans le fichier) :

```ts
// ─────────────────────────── /cqapi — CryptoQuant BASIC ───────────────────────────

interface ProxyFactice {
  on: (evenement: string, gestionnaire: (...args: unknown[]) => void) => void;
}

interface EntreeProxyFactice {
  target?: string;
  followRedirects?: boolean;
  timeout?: number;
  proxyTimeout?: number;
  bypass?: Bypass;
  rewrite?: (chemin: string) => string;
  configure?: (proxy: ProxyFactice, options: object) => void;
}

interface ConfigFactice {
  define?: Record<string, string>;
  server?: { proxy?: Record<string, EntreeProxyFactice> };
}

function configPour(): ConfigFactice {
  const usine = viteConfig as unknown as (env: { mode: string }) => ConfigFactice;
  return usine({ mode: "test" });
}

function rewritePour(prefixe: string): (chemin: string) => string {
  const rewrite = configPour().server?.proxy?.[prefixe]?.rewrite;
  if (!rewrite) throw new Error(`rewrite ${prefixe} absent`);
  return rewrite;
}

describe("proxy /cqapi — CryptoQuant BASIC (licence personnelle)", () => {
  const URL_VALIDE = "/cqapi/v2/market/cq/spot/trade?symbol=btc_all&window=day&limit=30";
  const cleInitiale = process.env.CRYPTOQUANT_API_KEY;
  const vercelInitial = process.env.VERCEL;
  afterEach(() => {
    // process.env prime sur apps/web/.env dans loadEnv : chaque test fixe sa valeur, puis on restaure.
    if (cleInitiale === undefined) delete process.env.CRYPTOQUANT_API_KEY;
    else process.env.CRYPTOQUANT_API_KEY = cleInitiale;
    if (vercelInitial === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = vercelInitial;
  });

  it("build Vercel : drapeau faux même si la variable est posée, valeur jamais exposée", () => {
    process.env.VERCEL = "1";
    process.env.CRYPTOQUANT_API_KEY = "CLE-TEST-SECRETE";
    const define = configPour().define;
    expect(define?.__CQ_CLE_ENV__).toBe("false");
    expect(JSON.stringify(define)).not.toContain("CLE-TEST-SECRETE");
  });

  it("local : drapeau vrai avec une clé .env, faux sans", () => {
    delete process.env.VERCEL;
    process.env.CRYPTOQUANT_API_KEY = "CLE-TEST-SECRETE";
    const avecCle = configPour().define;
    expect(avecCle?.__CQ_CLE_ENV__).toBe("true");
    expect(JSON.stringify(avecCle)).not.toContain("CLE-TEST-SECRETE");
    process.env.CRYPTOQUANT_API_KEY = "";
    expect(configPour().define?.__CQ_CLE_ENV__).toBe("false");
  });

  it.each([
    ["POST", URL_VALIDE, "Bearer CLE-TEST-SECRETE", 405],
    ["GET", URL_VALIDE, undefined, 401],
    ["GET", URL_VALIDE, "Basic CLE-TEST-SECRETE", 401],
    ["GET", "/cqapi/v1/btc/exchange-flows/reserve?exchange=all_exchange&window=day", "Bearer CLE-TEST-SECRETE", 404],
    ["GET", "/cqapi/v2/market/cq/spot/trade?symbol=btc_all&window=day&from=20260901", "Bearer CLE-TEST-SECRETE", 404],
  ])("sans .env : refuse localement %s %s (%s → %i)", (method, url, authorization, status) => {
    process.env.CRYPTOQUANT_API_KEY = "";
    const res = reponse();
    const retour = bypassPour("/cqapi")({ url, method, headers: { authorization } }, res);
    expect(res.statusCode).toBe(status);
    expect(res.writableEnded).toBe(true);
    expect(res.entetes.get("cache-control")).toBe("private, no-store");
    expect(res.entetes.get("allow")).toBe(status === 405 ? "GET" : undefined);
    expect(res.corps).not.toContain("CLE-TEST-SECRETE");
    expect(retour).toBe(url);
  });

  it("avec le seul repli .env : un chemin hors liste reste refusé (404) et n'est jamais relayé", () => {
    process.env.CRYPTOQUANT_API_KEY = "CLEENV";
    const url = "/cqapi/v1/btc/market-indicator/mvrv?window=day";
    const res = reponse();
    const retour = bypassPour("/cqapi")({ url, method: "GET", headers: {} }, res);
    expect(res.statusCode).toBe(404);
    expect(res.writableEnded).toBe(true);
    expect(retour).toBe(url);
  });

  it("laisse relayer un GET valide porteur d'un Bearer personnel, ou couvert par le repli .env", () => {
    process.env.CRYPTOQUANT_API_KEY = "";
    const perso = reponse();
    expect(
      bypassPour("/cqapi")({ url: URL_VALIDE, method: "GET", headers: { authorization: "Bearer CLE-TEST-SECRETE" } }, perso),
    ).toBeUndefined();
    expect(perso.writableEnded).toBe(false);
    process.env.CRYPTOQUANT_API_KEY = "CLEENV";
    const repli = reponse();
    expect(bypassPour("/cqapi")({ url: URL_VALIDE, method: "GET", headers: {} }, repli)).toBeUndefined();
    expect(repli.writableEnded).toBe(false);
  });

  it("réécrit vers la liste fermée (query normalisée) et neutralise tout le reste", () => {
    const rewrite = rewritePour("/cqapi");
    expect(rewrite(URL_VALIDE)).toBe("/v2/market/cq/spot/trade?symbol=btc_all&window=day&limit=30");
    expect(rewrite("/cqapi/v1/btc/miner-data/companies?limit=30&window=day&miner=mara")).toBe(
      "/v1/btc/miner-data/companies?miner=mara&window=day&limit=30",
    );
    expect(rewrite("/cqapi/v1/btc/exchange-flows/reserve?window=day")).toBe("/__axiom_refuse__");
  });

  it("vise le seul hôte CryptoQuant, sans suivre de redirection, avec des délais bornés", () => {
    const entree = configPour().server?.proxy?.["/cqapi"];
    expect(entree?.target).toBe("https://api.cryptoquant.com");
    expect(entree?.followRedirects).toBe(false);
    expect(entree?.timeout).toBe(15_000);
    expect(entree?.proxyTimeout).toBe(15_000);
  });

  it("proxyReq : repli .env injecté seulement sans Bearer valide ; proxyRes : réponse forcée privée", () => {
    process.env.CRYPTOQUANT_API_KEY = "CLEENV";
    const gestionnaires = new Map<string, (...args: unknown[]) => void>();
    configPour().server?.proxy?.["/cqapi"]?.configure?.(
      { on: (evenement, gestionnaire) => { gestionnaires.set(evenement, gestionnaire); } },
      {},
    );
    const requeteAmont = (authorization?: string) => {
      const entetes = new Map<string, string>();
      if (authorization !== undefined) entetes.set("authorization", authorization);
      return {
        entetes,
        getHeader: (nom: string) => entetes.get(nom.toLowerCase()),
        setHeader: (nom: string, valeur: string) => {
          entetes.set(nom.toLowerCase(), valeur);
        },
      };
    };
    const sansEntete = requeteAmont();
    const invalide = requeteAmont("Basic x");
    const perso = requeteAmont("Bearer perso");
    for (const requete of [sansEntete, invalide, perso]) gestionnaires.get("proxyReq")?.(requete);
    expect(sansEntete.entetes.get("authorization")).toBe("Bearer CLEENV");
    expect(invalide.entetes.get("authorization")).toBe("Bearer CLEENV");
    expect(perso.entetes.get("authorization")).toBe("Bearer perso");

    const reponseAmont: { headers: Record<string, string> } = {
      headers: { "cache-control": "public, max-age=600", "x-ratelimit-remaining": "9" },
    };
    gestionnaires.get("proxyRes")?.(reponseAmont);
    expect(reponseAmont.headers["cache-control"]).toBe("private, no-store");
    expect(reponseAmont.headers["x-ratelimit-remaining"]).toBe("9");
    expect(gestionnaires.has("error")).toBe(true);
  });
});
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue**

```bash
pnpm --filter @axiom/web exec vitest run src/viteConfig.test.ts
```

Résumé attendu : 12 échecs (tous les nouveaux tests), 8 tests existants verts. Détail : les deux tests de drapeau (`expected undefined to be 'false'` / `'true'`) ; les tests de refus et de relais lèvent `Error: bypass /cqapi absent` ; le test de réécriture lève `Error: rewrite /cqapi absent` ; « vise le seul hôte » échoue (`expected undefined to be 'https://api.cryptoquant.com'`) ; le test `proxyReq` échoue (`expected undefined to be 'Bearer CLEENV'`). Les tests existants (`/defillamapro`, `/sosoapi`, manifeste) restent verts.

- [ ] **Étape 3 : implémentation minimale de `vite.config.ts`** — quatre modifications.

Ligne 7 — ajouter la ligne 8 juste après l'import DefiLlama :

```ts
import { DEFILLAMA_PRO_HEADER, DEFILLAMA_PRO_HOST, cheminDefillamaAmont, cleDefillamaValide } from "../../shared/defillama-proxy";
import { CRYPTOQUANT_HOST, cheminCryptoQuantAmont, cleCryptoQuantValide } from "../../shared/cryptoquant-proxy";
```

Lignes 81-84 — remplacer par :

```ts
  const BGEOMETRICS_API_KEY = loadEnv(mode, process.cwd(), "").BGEOMETRICS_API_KEY ?? "";
  // CryptoQuant BASIC (licence PERSONNELLE) : repli réservé au proxy de dev et au daemon local.
  const CRYPTOQUANT_API_KEY = loadEnv(mode, process.cwd(), "").CRYPTOQUANT_API_KEY ?? "";
  const isVercelBuild = process.env.VERCEL === "1";
  // `loadEnv` lit aussi process.env : une variable posée par erreur dans l'environnement de
  // build Vercel ne doit jamais faire croire au client qu'un repli existe (appels puis 401).
  const CQ_CLE_ENV = !isVercelBuild && CRYPTOQUANT_API_KEY !== "";
  const AXIOM_DEPLOYMENT = isVercelBuild ? "vercel" : "local";
  const TWELVE_DATA_API_BASE = isVercelBuild ? "https://api.twelvedata.com" : "/tdapi";
```

Lignes 93-97 — remplacer le bloc `define` par :

```ts
  define: {
    __BG_CLE_ENV__: JSON.stringify(BGEOMETRICS_API_KEY !== ""),
    // CryptoQuant : PRÉSENCE du repli local seulement (booléen), jamais sa valeur ; toujours
    // faux sur un build Vercel (aucun repli serveur, licence personnelle).
    __CQ_CLE_ENV__: JSON.stringify(CQ_CLE_ENV),
    "import.meta.env.VITE_AXIOM_DEPLOYMENT": JSON.stringify(AXIOM_DEPLOYMENT),
    "import.meta.env.VITE_TWELVE_DATA_API_BASE": JSON.stringify(TWELVE_DATA_API_BASE),
  },
```

Insérer entre la ligne 271 (`      },` qui ferme l'entrée `"/defillamapro"`) et la ligne 272 (commentaire `// MEXC …`) :

```ts
      // CryptoQuant BASIC (licence PERSONNELLE) — liste FERMÉE partagée avec le daemon et la
      // fonction Vercel (shared/cryptoquant-proxy.ts). Refus locaux AVANT le réseau ; un
      // Bearer personnel valide reste prioritaire sur le repli `.env`.
      "/cqapi": {
        target: `https://${CRYPTOQUANT_HOST}`,
        changeOrigin: true,
        secure: true,
        followRedirects: false,
        rewrite: (path) => {
          const url = new URL(path, "http://axiom.local");
          return cheminCryptoQuantAmont(url.pathname, url.search) ?? "/__axiom_refuse__";
        },
        // UN SEUL bypass : méthode (405), clé disponible (401), liste fermée (404).
        bypass: (req, res) => {
          if (res === undefined) return;
          const url = new URL(req.url ?? "", "http://axiom.local");
          const entete = typeof req.headers.authorization === "string" ? req.headers.authorization : null;
          const cleDisponible = cleCryptoQuantValide(entete) || CRYPTOQUANT_API_KEY.length > 0;
          const status =
            req.method !== "GET"
              ? 405
              : !cleDisponible
                ? 401
                : cheminCryptoQuantAmont(url.pathname, url.search) === null
                  ? 404
                  : null;
          if (status !== null) {
            res.statusCode = status;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.setHeader("cache-control", "private, no-store");
            if (status === 405) res.setHeader("allow", "GET");
            res.end(
              JSON.stringify({
                erreur:
                  status === 405
                    ? "méthode CryptoQuant non autorisée"
                    : status === 401
                      ? "clé CryptoQuant personnelle requise"
                      : "chemin CryptoQuant refusé",
              }),
            );
            // Vite 6 poursuit vers proxy.web quand bypass renvoie undefined, même après res.end().
            return req.url ?? "/";
          }
        },
        timeout: 15_000,
        proxyTimeout: 15_000,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            const entete = proxyReq.getHeader("authorization");
            if (!cleCryptoQuantValide(typeof entete === "string" ? entete : null) && CRYPTOQUANT_API_KEY.length > 0) {
              proxyReq.setHeader("Authorization", `Bearer ${CRYPTOQUANT_API_KEY}`);
            }
          });
          proxy.on("proxyRes", (proxyRes) => {
            // Écrit sur la réponse AMONT : http-proxy recopie ses en-têtes après cet évènement
            // (un res.setHeader serait écrasé). Les x-ratelimit-* passent tels quels.
            proxyRes.headers["cache-control"] = "private, no-store";
          });
          proxy.on("error", (_error, _req, res) => {
            if ("writeHead" in res && !res.headersSent) {
              res.writeHead(502, { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" });
            }
            if ("end" in res) res.end(JSON.stringify({ erreur: "amont CryptoQuant injoignable" }));
          });
        },
      },
```

- [ ] **Étape 4 : lancer le test et vérifier qu'il passe**

```bash
pnpm --filter @axiom/web exec vitest run src/viteConfig.test.ts
pnpm --filter @axiom/web typecheck
```

Attendu : `20 passed` (8 existants + 12 nouveaux) ; typecheck web sans diagnostic (le module partagé est dans l'`include` depuis la Tâche 2).

- [ ] **Étape 5 : documenter la variable dans `apps/web/.env.example`**

Ligne 7 — remplacer :

```text
#   • Vite en dev  (proxys /fredapi, /coinalyzeapi, /tdapi, /sosoapi, /ethscanapi)
```

par :

```text
#   • Vite en dev  (proxys /fredapi, /coinalyzeapi, /tdapi, /sosoapi, /ethscanapi, /bgapi, /cqapi)
```

Ajouter après la ligne 46 (`BGEOMETRICS_API_KEY=`, dernière ligne du fichier) :

```text

# CryptoQuant BASIC (flux takers toutes places — DES ; production des mineurs cotés — CHAIN)
# Licence PERSONNELLE : repli du proxy Vite (/cqapi) et du daemon 127.0.0.1 UNIQUEMENT,
# jamais sur Vercel (aucune variable serveur ; sans clé personnelle, aucun appel).
# Une clé saisie dans les Réglages reste prioritaire. Offre : https://cryptoquant.com/
CRYPTOQUANT_API_KEY=
```

Vérification :

```bash
grep -n "CRYPTOQUANT_API_KEY=" apps/web/.env.example
grep -n "/bgapi, /cqapi)" apps/web/.env.example
```

Attendu : une ligne chacune (`CRYPTOQUANT_API_KEY=` en fin de fichier ; la liste « Lue par » à la ligne 7).

- [ ] **Étape 6 : suites voisines et typecheck global**

```bash
pnpm --filter @axiom/web test
pnpm -r typecheck
```

Attendu : suite web verte (le `define` ajouté n'influence que les modules qui déclarent `__CQ_CLE_ENV__`, encore inexistants à ce stade) ; typecheck de tous les paquets sans diagnostic.

- [ ] **Étape 7 : commit**

```bash
git add apps/web/vite.config.ts apps/web/.env.example apps/web/src/viteConfig.test.ts
git commit -m "feat(vite): proxy de dev /cqapi — refus locaux, repli .env hors Vercel, réponse privée" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Zone C — Clé personnelle, exclusion des sauvegardes, Réglages (B1-3)

Toutes les commandes se lancent depuis la racine du dépôt, c'est-à-dire la racine du worktree d'exécution (jamais le checkout principal s'il diffère). Vitest tourne en environnement **node** (aucun bloc `test` dans `apps/web/vite.config.ts`, pas de jsdom) : `localStorage` n'existe pas et se bouchonne, comme dans `store/onchain.test.ts` et `store/persist.test.ts`.

---

### Tâche 6 : Store de la clé CryptoQuant personnelle et message « clé requise » (`store/cryptoquant.ts`)

**Fichiers :**
- Créer : `apps/web/src/store/cryptoquant.ts`
- Tester : `apps/web/src/store/cryptoquant.test.ts` (nouveau)

**Interfaces :**
- Consomme : rien des tâches précédentes. Seule dépendance : `createStore` et `type StoreApi` de `"zustand/vanilla"` (import déjà utilisé tel quel dans `apps/web/src/chart/niveauxOverlays.ts:11`).
- Produit :
  - `export const CLE_STOCKAGE_CRYPTOQUANT = "axiom:cryptoquant:key";`
  - `export const RAISON_CLE_CRYPTOQUANT = "Clé CryptoQuant personnelle requise (Réglages ⚙).";` : raison du statut `cle-requise` quand aucune clé n'est active. C'est la **seule définition** du dépôt : le client (tâche 13) la ré-exporte par `export { RAISON_CLE_CRYPTOQUANT } from "../../store/cryptoquant";`, et `FluxTakersSection.tsx` (tâche 15) et `MineursCotes.tsx` (tâche 18) l'importent depuis ce store (`fluxTakers.util.ts` n'en a pas besoin : il n'importe que des types du client).
  - `export function messageSansCleCq(vercel: boolean): string;` : message affiché par `SansCle`. Il reprend la constante sans son point final, ajoute le complément propre au déploiement (Vercel : « — licence personnelle, aucun repli serveur sur ce déploiement » ; local : « — ou CRYPTOQUANT_API_KEY dans apps/web/.env pour le proxy Vite et le daemon ») et se termine par un point unique. `FluxTakersSection.tsx` (tâche 15) et `MineursCotes.tsx` (tâche 18) l'importent depuis ce store. L'affichage ne l'utilise que si `raison === RAISON_CLE_CRYPTOQUANT` ; une clé refusée (401) garde sa raison telle quelle.
  - `export function getCryptoquantKey(): string | null;` : lecture tolérante, valeur rognée, `null` si la clé est absente ou vide ou si le stockage lève une erreur.
  - `export interface CryptoquantKeyState { hasKey: boolean; version: number; setKey: (cle: string) => void; clearKey: () => void }`
  - `export const cryptoquantKeyStore: StoreApi<CryptoquantKeyState>;` : `hasKey` indique qu'une clé **personnelle** est réellement persistée. `version` augmente de 1 à chaque `setKey` et à chaque `clearKey`. `setKey("   ")` équivaut à `clearKey`. La valeur de la clé n'entre jamais dans le state.
  - Pourquoi le message vit ici : ce module est déjà partagé par les Réglages, les sections DES et CHAIN et le client. Y placer le message n'ajoute donc aucun chunk.
  - Pour la Zone D : le store n'importe **aucun** module de données. Il ne peut donc pas effacer lui-même la mémoire des refus 403 comme le fait `store/onchain.ts:97,103` avec `oublierRefusAbonnementBg`. Le client doit mémoriser `cryptoquantKeyStore.getState().version` avec chaque refus et ignorer ce refus dès que `version` a changé.

- [ ] **Étape 1 : écrire le test qui échoue.** Créer `apps/web/src/store/cryptoquant.test.ts`. Le test suit le patron de `store/onchain.test.ts` (`vi.resetModules()`, `vi.stubGlobal`, import dynamique). La lecture de source suit le patron de `lib/themeTokens.test.ts:20`.

```ts
/**
 * Store de la clé CryptoQuant personnelle et message « clé requise » (spec 2026-09-16 §4.2,
 * invariant I8).
 *
 * Environnement vitest node : localStorage bouchonné en mémoire (patron store/onchain.test.ts).
 * `vi.resetModules()` + import dynamique : le store lit la clé à sa création, il faut donc
 * poser le stockage AVANT de charger le module pour tester l'hydratation.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CLE = "axiom:cryptoquant:key";
const SECRET = "CLE-TEST-SECRETE";

function stockage(): Storage {
  const valeurs = new Map<string, string>();
  return {
    getItem: (k) => valeurs.get(k) ?? null,
    setItem: (k, v) => void valeurs.set(k, v),
    removeItem: (k) => void valeurs.delete(k),
    clear: () => valeurs.clear(),
    key: (i) => [...valeurs.keys()][i] ?? null,
    get length() { return valeurs.size; },
  };
}

describe("clé CryptoQuant personnelle", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", stockage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("démarre sans clé : hasKey faux, version 0, lecture nulle, emplacement exact", async () => {
    const { cryptoquantKeyStore, getCryptoquantKey, CLE_STOCKAGE_CRYPTOQUANT } = await import("./cryptoquant");
    expect(CLE_STOCKAGE_CRYPTOQUANT).toBe(CLE);
    expect(cryptoquantKeyStore.getState().hasKey).toBe(false);
    expect(cryptoquantKeyStore.getState().version).toBe(0);
    expect(getCryptoquantKey()).toBeNull();
  });

  it("hydrate hasKey vrai depuis une clé déjà persistée", async () => {
    localStorage.setItem(CLE, SECRET);
    const { cryptoquantKeyStore, getCryptoquantKey } = await import("./cryptoquant");
    expect(cryptoquantKeyStore.getState().hasKey).toBe(true);
    expect(getCryptoquantKey()).toBe(SECRET);
  });

  it("stockage inaccessible dès le chargement : hasKey faux, aucune exception", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new DOMException("refusé", "SecurityError"); },
    });
    const { cryptoquantKeyStore, getCryptoquantKey } = await import("./cryptoquant");
    expect(cryptoquantKeyStore.getState().hasKey).toBe(false);
    expect(getCryptoquantKey()).toBeNull();
  });

  it("setKey normalise, persiste, et la valeur n'entre jamais dans le state", async () => {
    const { cryptoquantKeyStore, getCryptoquantKey } = await import("./cryptoquant");
    cryptoquantKeyStore.getState().setKey(`  ${SECRET}  `);
    const etat = cryptoquantKeyStore.getState();
    expect(etat.hasKey).toBe(true);
    expect(etat.version).toBe(1);
    expect(localStorage.getItem(CLE)).toBe(SECRET);
    expect(getCryptoquantKey()).toBe(SECRET);
    expect(JSON.stringify(etat)).not.toContain(SECRET);
    expect(Object.values(etat)).not.toContain(SECRET);
    expect(etat).not.toHaveProperty("key");
  });

  it("version +1 à chaque setKey/clearKey, y compris en rotation vraie → vraie", async () => {
    const { cryptoquantKeyStore } = await import("./cryptoquant");
    cryptoquantKeyStore.getState().setKey("premiere-cle");
    const apresPremiere = cryptoquantKeyStore.getState();
    cryptoquantKeyStore.getState().setKey(SECRET);
    const apresRotation = cryptoquantKeyStore.getState();
    expect(apresPremiere.hasKey).toBe(true);
    expect(apresRotation.hasKey).toBe(true);
    expect(apresRotation.version).toBe(apresPremiere.version + 1);
    expect(JSON.stringify(apresRotation)).not.toContain(SECRET);

    cryptoquantKeyStore.getState().clearKey();
    expect(cryptoquantKeyStore.getState().version).toBe(apresRotation.version + 1);
    // Un second clearKey (déjà sans clé) incrémente aussi : l'abonné est toujours notifié.
    cryptoquantKeyStore.getState().clearKey();
    expect(cryptoquantKeyStore.getState().version).toBe(apresRotation.version + 2);
  });

  it("setKey d'une chaîne blanche équivaut à clearKey", async () => {
    const { cryptoquantKeyStore, getCryptoquantKey } = await import("./cryptoquant");
    cryptoquantKeyStore.getState().setKey(SECRET);
    cryptoquantKeyStore.getState().setKey("   ");
    expect(cryptoquantKeyStore.getState().hasKey).toBe(false);
    expect(cryptoquantKeyStore.getState().version).toBe(2);
    expect(localStorage.getItem(CLE)).toBeNull();
    expect(getCryptoquantKey()).toBeNull();
  });

  it("clearKey supprime la clé persistée", async () => {
    localStorage.setItem(CLE, SECRET);
    const { cryptoquantKeyStore, getCryptoquantKey } = await import("./cryptoquant");
    cryptoquantKeyStore.getState().clearKey();
    expect(cryptoquantKeyStore.getState().hasKey).toBe(false);
    expect(localStorage.getItem(CLE)).toBeNull();
    expect(getCryptoquantKey()).toBeNull();
  });

  it("lecture tolérante : valeur blanche → null, valeur entourée d'espaces → rognée, stockage qui lève ou absent → null", async () => {
    const { getCryptoquantKey } = await import("./cryptoquant");
    localStorage.setItem(CLE, "   ");
    expect(getCryptoquantKey()).toBeNull();
    localStorage.setItem(CLE, `  ${SECRET} `);
    expect(getCryptoquantKey()).toBe(SECRET);
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new DOMException("refusé", "SecurityError"); },
    });
    expect(getCryptoquantKey()).toBeNull();
    vi.stubGlobal("localStorage", undefined);
    expect(getCryptoquantKey()).toBeNull();
  });

  it("stockage qui refuse l'écriture : aucune exception, hasKey reste faux, version avance", async () => {
    const { cryptoquantKeyStore } = await import("./cryptoquant");
    vi.stubGlobal("localStorage", {
      ...stockage(),
      setItem: () => { throw new DOMException("quota", "QuotaExceededError"); },
    });
    expect(() => cryptoquantKeyStore.getState().setKey(SECRET)).not.toThrow();
    expect(cryptoquantKeyStore.getState().hasKey).toBe(false);
    expect(cryptoquantKeyStore.getState().version).toBe(1);
  });

  it("raison « clé requise » : constante exacte, terminée par « ). »", async () => {
    const { RAISON_CLE_CRYPTOQUANT } = await import("./cryptoquant");
    expect(RAISON_CLE_CRYPTOQUANT).toBe("Clé CryptoQuant personnelle requise (Réglages ⚙).");
    // Garde-fou du slice(0, -1) de messageSansCleCq : seul le point final doit être retiré.
    expect(RAISON_CLE_CRYPTOQUANT.endsWith(").")).toBe(true);
  });

  it("messageSansCleCq : complément local (.env) ou Vercel (aucun repli), point final unique", async () => {
    const { messageSansCleCq } = await import("./cryptoquant");
    const local = messageSansCleCq(false);
    const vercel = messageSansCleCq(true);
    expect(local).toBe(
      "Clé CryptoQuant personnelle requise (Réglages ⚙) — ou CRYPTOQUANT_API_KEY dans apps/web/.env pour le proxy Vite et le daemon.",
    );
    expect(vercel).toBe(
      "Clé CryptoQuant personnelle requise (Réglages ⚙) — licence personnelle, aucun repli serveur sur ce déploiement.",
    );
    for (const message of [local, vercel]) {
      expect(message.endsWith(".")).toBe(true);
      expect(message.endsWith("..")).toBe(false);
      expect(message).not.toContain(").");
    }
    expect(vercel).not.toContain(".env");
    expect(vercel).not.toContain("CRYPTOQUANT_API_KEY");
  });

  it("n'importe aucun module de données (seul zustand/vanilla, aucun chargement dynamique)", () => {
    const source = readFileSync(fileURLToPath(new URL("./cryptoquant.ts", import.meta.url)), "utf8");
    const imports = [...source.matchAll(/^\s*import\s[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
    expect(imports).toEqual(["zustand/vanilla"]);
    expect(source).not.toMatch(/import\(/);
  });
});
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue.**
  `pnpm --filter @axiom/web exec vitest run src/store/cryptoquant.test.ts`
  Résultat attendu : **ÉCHEC**. Les onze tests à import dynamique échouent sur la résolution de `./cryptoquant`, avec une erreur de chargement de module Vite/Vitest du type « Failed to load url ./cryptoquant … Does the file exist? » ou « Cannot find module ». Le test structurel échoue sur `ENOENT: no such file or directory, open '…/apps/web/src/store/cryptoquant.ts'`.

- [ ] **Étape 3 : implémentation minimale.** Créer `apps/web/src/store/cryptoquant.ts`. Le patron est `store/sosovalue.ts` (champ `version`, aucune dépendance), et non `ccdata.ts`, qui nomme le compteur `revision`, ni `onchain.ts`, qui importe un module `data/`. Le commentaire ne doit contenir ni la chaîne `import(` ni une ligne commençant par `import`.

```ts
/**
 * Store de la clé CryptoQuant PERSONNELLE (offre BASIC, licence personnelle) — Zustand VANILLA.
 *
 * Spec 2026-09-16 §4.2. Même patron que store/sosovalue.ts et store/onchain.ts (BGeometrics) :
 *  - la VALEUR de la clé ne vit que dans localStorage (`axiom:cryptoquant:key`) et n'est lue
 *    qu'à la demande par `getCryptoquantKey` ; elle n'entre JAMAIS dans le state (ni rendue,
 *    ni loggée) ;
 *  - `hasKey` ne reflète que la clé personnelle réellement persistée : le repli `.env` du proxy
 *    Vite / daemon local n'est pas visible ici (badge Réglages cohérent avec BGeometrics/CCData) ;
 *  - `version` est incrémenté à CHAQUE setKey/clearKey : une rotation vraie → vraie laisse
 *    `hasKey` inchangé, les sections DES/CHAIN et le client s'abonnent donc à `version`
 *    (rechargement, oubli des refus 403 mémorisés en session).
 *
 * ZÉRO dépendance vers les modules de données : le client CryptoQuant
 * (data/onchain/cryptoquant.ts) reste dans un chunk chargé à la demande par les sections.
 * La clé est exclue des sauvegardes JSON par `CLES_CREDENTIALS_LOCALES` (store/persist.ts).
 *
 * Le message « clé requise » (`RAISON_CLE_CRYPTOQUANT`, `messageSansCleCq`) vit aussi ici :
 * ce module est déjà partagé par les Réglages, les sections DES et CHAIN et le client, il
 * n'ajoute donc aucun chunk. Le client ré-exporte la constante, les vues l'importent d'ici.
 */
import { createStore, type StoreApi } from "zustand/vanilla";

/** Emplacement localStorage de la clé personnelle (préfixe `axiom:`, exclu de l'export). */
export const CLE_STOCKAGE_CRYPTOQUANT = "axiom:cryptoquant:key";

/** Raison du statut `cle-requise` quand aucune clé n'est active (définition unique). */
export const RAISON_CLE_CRYPTOQUANT = "Clé CryptoQuant personnelle requise (Réglages ⚙).";
/** Message SansCle : base sans point final + complément selon le déploiement, point final unique. */
export function messageSansCleCq(vercel: boolean): string {
  const base = RAISON_CLE_CRYPTOQUANT.slice(0, -1);
  return vercel
    ? `${base} — licence personnelle, aucun repli serveur sur ce déploiement.`
    : `${base} — ou CRYPTOQUANT_API_KEY dans apps/web/.env pour le proxy Vite et le daemon.`;
}

/** Lecture tolérante : clé personnelle rognée, sinon `null` (absente, blanche, stockage refusé). */
export function getCryptoquantKey(): string | null {
  try {
    const valeur = localStorage.getItem(CLE_STOCKAGE_CRYPTOQUANT)?.trim() ?? "";
    return valeur.length > 0 ? valeur : null;
  } catch {
    return null;
  }
}

/** Écriture/suppression tolérante (quota, mode privé → silencieux ; `hasKey` relit ensuite). */
function ecrireCle(cle: string | null): void {
  try {
    if (cle === null) localStorage.removeItem(CLE_STOCKAGE_CRYPTOQUANT);
    else localStorage.setItem(CLE_STOCKAGE_CRYPTOQUANT, cle);
  } catch {
    /* best-effort : la persistance de la clé n'est pas bloquante */
  }
}

export interface CryptoquantKeyState {
  /** true si une clé PERSONNELLE est réellement persistée sur ce poste. */
  hasKey: boolean;
  /** Compteur sans secret, incrémenté à chaque setKey/clearKey (rotation vraie → vraie comprise). */
  version: number;
  /** Enregistre la clé personnelle ; une chaîne blanche équivaut à clearKey. */
  setKey: (cle: string) => void;
  /** Supprime la clé personnelle. */
  clearKey: () => void;
}

export const cryptoquantKeyStore: StoreApi<CryptoquantKeyState> = createStore<CryptoquantKeyState>((set) => ({
  hasKey: getCryptoquantKey() !== null,
  version: 0,

  setKey: (cle) => {
    const normalisee = cle.trim();
    ecrireCle(normalisee.length > 0 ? normalisee : null);
    // Relire plutôt que supposer : un stockage refusé ne doit pas afficher « configurée ».
    set((s) => ({ hasKey: getCryptoquantKey() !== null, version: s.version + 1 }));
  },

  clearKey: () => {
    ecrireCle(null);
    set((s) => ({ hasKey: getCryptoquantKey() !== null, version: s.version + 1 }));
  },
}));
```

- [ ] **Étape 4 : lancer le test et vérifier qu'il passe.**
  `pnpm --filter @axiom/web exec vitest run src/store/cryptoquant.test.ts`. Attendu : 12 tests verts.
  Tests voisins qui doivent rester verts : `pnpm --filter @axiom/web exec vitest run src/store/onchain.test.ts src/store/ccdata.test.ts src/store/sosovalue.test.ts src/store/defillamaKey.test.ts`
  Typecheck (strict, `noUncheckedIndexedAccess`) : `pnpm --filter @axiom/web typecheck`. Attendu : aucune erreur.

- [ ] **Étape 5 : commit.**

```bash
git add apps/web/src/store/cryptoquant.ts apps/web/src/store/cryptoquant.test.ts
git commit -m "$(cat <<'EOF'
feat(cryptoquant): store de la clé personnelle et message « clé requise » (sans import data)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Tâche 7 : Clé et archives CryptoQuant exclues des sauvegardes JSON (`persist.ts`)

**Fichiers :**
- Modifier : `apps/web/src/store/persist.ts:768-781` (`CLES_CREDENTIALS_LOCALES` et son commentaire)
- Modifier : `apps/web/src/store/persist.ts:787-793` (constante de préfixe et `resteSurLePoste`)
- Modifier : `apps/web/src/store/persist.ts:805-812` (commentaire d'`exporterSauvegarde`)
- Tester : `apps/web/src/store/persist.test.ts:62-66` (liste `CLES_CREDENTIALS`), `:550` (insertion dans le `describe` d'import, lignes 467-561) et `:627` (insertion dans le `describe` d'export, lignes 563-628). Les numéros sont ceux d'origine : insérer **de bas en haut** (627, puis 550, puis 62-66).

**Interfaces :**
- Consomme :
  - le littéral `"axiom:cryptoquant:key"`, égal à `CLE_STOCKAGE_CRYPTOQUANT` de la Tâche 6. Il est volontairement **non importé** : `persist.ts` appartient au bundle initial, alors que `SettingsPanel` est chargé en `lazy` (`App.tsx:224`).
  - le préfixe littéral `"axiom:onchain:cq:"`, préfixe de `cleLocale(serie) = \`axiom:onchain:cq:${serie}:v1\`` du client de la Zone D, lui aussi non importé. La tâche 11 fige ce lien par le test `cleLocale("taker:spot:btc") === "axiom:onchain:cq:taker:spot:btc:v1"`.
- Produit : aucun nouvel export. Comportement figé :
  - `exporterSauvegarde()` n'écrit jamais `axiom:cryptoquant:key` ni aucune clé `axiom:onchain:cq:*`.
  - `importerSauvegarde(json)` ignore ces clés dans le fichier et ne les supprime jamais localement.
  - Les autres clés `axiom:onchain:*` restent exportées.

- [ ] **Étape 1 : écrire les tests qui échouent** dans `apps/web/src/store/persist.test.ts`.

  (a) **Après la ligne 627** : le `});` qui ferme le test « n'embarque pas la mémoire BGeometrics… ». Insérer les lignes suivantes avant le `});` de la ligne 628, qui ferme le `describe("exporterSauvegarde — …")`. Le helper `capturerExport` est défini dans ce `describe` :

```ts
  it("n'embarque jamais la clé CryptoQuant personnelle", async () => {
    localStorage.setItem("axiom:cryptoquant:key", "CLE-TEST-SECRETE");
    localStorage.setItem(CHART_KEY, "{}");
    const dump = await capturerExport();
    expect(JSON.stringify(dump)).not.toContain("CLE-TEST-SECRETE");
    expect(dump["axiom:cryptoquant:key"]).toBeUndefined();
    expect(dump[CHART_KEY]).toBe("{}");
  });
  it("n'embarque pas les archives CryptoQuant (licence personnelle) et garde les autres caches on-chain", async () => {
    localStorage.setItem(
      "axiom:onchain:cq:taker:spot:btc:v1",
      JSON.stringify({ version: 1, serie: "taker:spot:btc", majTs: 1, jours: {} }),
    );
    localStorage.setItem("axiom:onchain:cq:mineur:mara:v1", "{}");
    localStorage.setItem("axiom:onchain:mempool:v1", "{}");
    localStorage.setItem(CHART_KEY, "{}");
    const dump = await capturerExport();
    expect(Object.keys(dump).filter((k) => k.startsWith("axiom:onchain:cq:"))).toEqual([]);
    expect(dump["axiom:onchain:mempool:v1"]).toBe("{}");
    expect(dump[CHART_KEY]).toBe("{}");
  });
```

  (b) **Après la ligne 550** : le `});` qui ferme le test « ignore la mémoire BGeometrics de refus d'abonnement… ». Insérer les lignes suivantes, qui restent dans le `describe("importerSauvegarde — …")` :

```ts

  it("préserve la clé CryptoQuant du poste et ignore celle d'un ancien fichier", () => {
    localStorage.setItem("axiom:cryptoquant:key", "CLE-TEST-SECRETE");

    expect(importerSauvegarde(JSON.stringify({
      "axiom:cryptoquant:key": "cle-d-un-autre-poste",
      "axiom:notes:v1": "notes importées",
    }))).toBe(true);

    expect(localStorage.getItem("axiom:cryptoquant:key")).toBe("CLE-TEST-SECRETE");
    expect(localStorage.getItem("axiom:notes:v1")).toBe("notes importées");
  });

  it("ne supprime ni ne remplace les archives CryptoQuant du poste (préfixe axiom:onchain:cq:)", () => {
    const spotBtc = "axiom:onchain:cq:taker:spot:btc:v1";
    const mara = "axiom:onchain:cq:mineur:mara:v1";
    const archiveSpot = JSON.stringify({ version: 1, serie: "taker:spot:btc", majTs: 1_789_580_000_000, jours: {} });
    localStorage.setItem(spotBtc, archiveSpot);
    localStorage.setItem(mara, "archive-mara-locale");

    // Fichier qui ne contient pas l'archive : l'import ne doit pas la purger.
    expect(importerSauvegarde(JSON.stringify({ "axiom:notes:v1": "notes importées" }))).toBe(true);
    expect(localStorage.getItem(spotBtc)).toBe(archiveSpot);
    expect(localStorage.getItem(mara)).toBe("archive-mara-locale");

    // Fichier d'un autre poste qui en contient une : ignorée, la copie locale reste.
    expect(importerSauvegarde(JSON.stringify({
      [mara]: "archive-mara-etrangere",
      "axiom:notes:v1": "autres notes",
    }))).toBe(true);
    expect(localStorage.getItem(mara)).toBe("archive-mara-locale");
    expect(localStorage.getItem(spotBtc)).toBe(archiveSpot);
    expect(localStorage.getItem("axiom:notes:v1")).toBe("autres notes");
  });
```

  (c) **Lignes 62-66** : remplacer la liste miroir par celle-ci. Les tests existants des lignes 522-533 (import) et 591-601 (export) couvrent alors aussi la nouvelle clé.

```ts
const CLES_CREDENTIALS = [
  "axiom:coinalyze:key", "axiom:twelvedata:key", "axiom:ccdata:key", "axiom:finnhub:key",
  "axiom:sosovalue:key", "axiom:bgeometrics:key", "axiom:etherscan:key", "axiom:fred:key",
  "axiom.fred.apiKey", "axiom.coingecko.demoApiKey", "axiom.defillama.proApiKey",
  "axiom:cryptoquant:key",
] as const;
```

- [ ] **Étape 2 : lancer les tests et vérifier qu'ils échouent.**
  `pnpm --filter @axiom/web exec vitest run src/store/persist.test.ts`
  Six échecs sont attendus :
  - « ignore les credentials d'une ancienne sauvegarde… » : `expected 'ancienne-11' to be 'locale-11'`.
  - « exclut tous les credentials utilisés… » : `expected false to be true`.
  - « préserve la clé CryptoQuant du poste… » : `expected 'cle-d-un-autre-poste' to be 'CLE-TEST-SECRETE'`.
  - « ne supprime ni ne remplace les archives CryptoQuant… » : `expected null to be '{"version":1,…}'`, car l'archive est purgée par le premier import.
  - « n'embarque jamais la clé CryptoQuant personnelle » : `expected '{"axiom:cryptoquant:key":…' not to contain 'CLE-TEST-SECRETE'`.
  - « n'embarque pas les archives CryptoQuant… » : `expected [ 'axiom:onchain:cq:taker:spot:btc:v1', 'axiom:onchain:cq:mineur:mara:v1' ] to deeply equal []`.

  Tous les autres tests du fichier restent verts.

- [ ] **Étape 3 : implémentation minimale** dans `apps/web/src/store/persist.ts`, en éditant de bas en haut.

  (a) **Lignes 805-812** : commentaire d'`exporterSauvegarde`. Remplacer :

```ts
/**
 * Exporte l'état `axiom:*` de localStorage en un fichier JSON horodaté (téléchargement
 * navigateur) : chart, watchlist, session, workspaces, thème, alertes et dessins.
 * Tous les emplacements de credentials fournisseurs sont exclus, y compris ceux qui
 * utilisent historiquement le préfixe `axiom:`. Ils restent locaux et doivent être
 * ressaisis sur un autre poste. La mémoire BGeometrics du refus d'abonnement, liée à la clé
 * du poste, est exclue de la même façon.
 */
```

  par :

```ts
/**
 * Exporte l'état `axiom:*` de localStorage en un fichier JSON horodaté (téléchargement
 * navigateur) : chart, watchlist, session, workspaces, thème, alertes et dessins.
 * Tous les emplacements de credentials fournisseurs sont exclus, y compris ceux qui
 * utilisent historiquement le préfixe `axiom:`. Ils restent locaux et doivent être
 * ressaisis sur un autre poste. La mémoire BGeometrics du refus d'abonnement, liée à la clé
 * du poste, est exclue de la même façon, ainsi que les archives CryptoQuant
 * (`axiom:onchain:cq:*`, licence personnelle) : leur durabilité vient du KV daemon.
 */
```

  (b) **Lignes 787-793** : remplacer :

```ts
/** États liés à la clé BGeometrics du poste (refus d'abonnement mémorisé) : traités comme les credentials. */
const ETATS_LOCAUX_NON_EXPORTES: ReadonlySet<string> = new Set([CLE_REFUS_ABONNEMENT, CLE_GENERATION_ABONNEMENT]);

/** Clé jamais exportée ni importée, et préservée localement lors d'un import. */
function resteSurLePoste(cle: string): boolean {
  return estCredentialLocal(cle) || ETATS_LOCAUX_NON_EXPORTES.has(cle);
}
```

  par :

```ts
/** États liés à la clé BGeometrics du poste (refus d'abonnement mémorisé) : traités comme les credentials. */
const ETATS_LOCAUX_NON_EXPORTES: ReadonlySet<string> = new Set([CLE_REFUS_ABONNEMENT, CLE_GENERATION_ABONNEMENT]);

/**
 * Archives CryptoQuant par série (`axiom:onchain:cq:<serie>:v1`, spec 2026-09-16 §4.4) :
 * données obtenues sous licence PERSONNELLE, jamais exportées ; un import ne doit ni les
 * remplacer ni les purger (une sauvegarde ancienne raccourcirait l'archive). Littéral
 * volontaire : le client CryptoQuant reste dans son chunk chargé à la demande.
 */
const PREFIXE_ARCHIVE_CRYPTOQUANT = "axiom:onchain:cq:";

/** Clé jamais exportée ni importée, et préservée localement lors d'un import. */
function resteSurLePoste(cle: string): boolean {
  return (
    estCredentialLocal(cle) ||
    ETATS_LOCAUX_NON_EXPORTES.has(cle) ||
    cle.startsWith(PREFIXE_ARCHIVE_CRYPTOQUANT)
  );
}
```

  (c) **Lignes 768-781** : remplacer :

```ts
/** Dix credentials fournisseurs ; FRED conserve aussi un ancien emplacement encore lu. */
const CLES_CREDENTIALS_LOCALES: ReadonlySet<string> = new Set([
  "axiom:coinalyze:key",
  "axiom:twelvedata:key",
  "axiom:ccdata:key",
  "axiom:finnhub:key",
  "axiom:sosovalue:key",
  "axiom:bgeometrics:key",
  "axiom:etherscan:key",
  "axiom:fred:key",
  "axiom.fred.apiKey",
  "axiom.coingecko.demoApiKey",
  "axiom.defillama.proApiKey",
]);
```

  par :

```ts
/** Onze credentials fournisseurs ; FRED conserve aussi un ancien emplacement encore lu. */
const CLES_CREDENTIALS_LOCALES: ReadonlySet<string> = new Set([
  "axiom:coinalyze:key",
  "axiom:twelvedata:key",
  "axiom:ccdata:key",
  "axiom:finnhub:key",
  "axiom:sosovalue:key",
  "axiom:bgeometrics:key",
  "axiom:etherscan:key",
  "axiom:fred:key",
  "axiom.fred.apiKey",
  "axiom.coingecko.demoApiKey",
  "axiom.defillama.proApiKey",
  // Littéral volontaire (= CLE_STOCKAGE_CRYPTOQUANT) : importer store/cryptoquant tirerait
  // ce store dans le chemin d'entrée, alors que seuls des modules paresseux le lisent
  // (Réglages, sections DES et CHAIN, client CryptoQuant).
  "axiom:cryptoquant:key",
]);
```

- [ ] **Étape 4 : lancer les tests et vérifier qu'ils passent.**
  `pnpm --filter @axiom/web exec vitest run src/store/persist.test.ts`. Attendu : tous verts, dont les quatre nouveaux tests et les deux tests existants étendus.
  Tests voisins : `pnpm --filter @axiom/web exec vitest run src/store src/components/Toolbar.test.tsx`. `Toolbar.test.tsx` bouchonne `store/persist` et doit rester vert.
  Typecheck : `pnpm --filter @axiom/web typecheck`.

- [ ] **Étape 5 : commit.**

```bash
git add apps/web/src/store/persist.ts apps/web/src/store/persist.test.ts
git commit -m "$(cat <<'EOF'
feat(cryptoquant): clé et archives CryptoQuant exclues des sauvegardes JSON

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Tâche 8 : Champ de clé CryptoQuant dans les Réglages et budget après B1-3

**Fichiers :**
- Modifier : `apps/web/src/components/SettingsPanel.tsx:30` (import, inséré après la ligne 30)
- Modifier : `apps/web/src/components/SettingsPanel.tsx:525` (hooks, insérés après la ligne 525)
- Modifier : `apps/web/src/components/SettingsPanel.tsx:709-710` (`<ApiKeyField>` inséré entre le `/>` du bloc DefiLlama Pro, ligne 709, et le `</div>` de la ligne 710)
- Modifier : `docs/superpowers/progress/2026-09-16-cryptoquant.md` (section `### Budget après B1-3` ajoutée en fin de fichier. Le rapport est ouvert par la tâche 1, qui y consigne `### Budget avant B1`.)
- Tester : `apps/web/src/components/SettingsPanel.cryptoquant.test.ts` (nouveau)

**Interfaces :**
- Consomme :
  - `cryptoquantKeyStore` de la Tâche 6, sélecteurs `s.hasKey`, `s.setKey`, `s.clearKey`.
  - `IS_VERCEL`, déjà importé à `SettingsPanel.tsx:34` et défini à `apps/web/src/lib/deployment.ts:7`.
  - `ApiKeyField` local (`SettingsPanel.tsx:45-184`), dont les props vérifiées sont `name`, `purpose`, `domain`, `signupUrl`, `signupLabel`, `placeholder`, `hasKey`, `onSave`, `onClear`.
  - la section `### Budget avant B1` du rapport, écrite par la tâche 1 au format unifié des budgets (spec §12) : titre, ligne « Commande : … », puis bloc de code `json` complet.
- Produit : aucun export. Libellés stables pour les e2e des Zones E/F :
  - nom du bloc « CryptoQuant (takers et mineurs cotés) » ;
  - placeholder « Clé API CryptoQuant (personnelle) » ;
  - badge « clé ✓ configurée » ou « non configurée » (`SettingsPanel.tsx:101-103`).
- Produit aussi, pour les tâches 16 et 20 : la section `### Budget après B1-3` du rapport. Elle suit le même format : ligne « Commande : … », bloc de code `json` complet imprimé par `scripts/verifier-budget-build.mjs`, puis une ligne qui donne le chunk du store observé dans `.vite/manifest.json` et le delta initial.

  Le test de ce lot lit la source. Aucun test de `SettingsPanel` n'existait, et un rendu React est impossible en vitest node : `store/theme.ts:64` appelle `applyTheme` au chargement du module, et cette fonction touche `document` (`store/theme.ts:41`). De plus, la chaîne onboarding → market tire les adaptateurs. Ce test suit le patron de `lib/gardeFous.test.ts:12` et de `components/uiConventions.test.ts:16`.

- [ ] **Étape 1 : écrire le test qui échoue.** Créer `apps/web/src/components/SettingsPanel.cryptoquant.test.ts`. Le nom contient `.test.`, ce qui l'exclut du scan de `uiConventions.test.ts`.

```ts
/**
 * Garde structurelle des Réglages CryptoQuant (spec 2026-09-16 §4.2).
 *
 * SettingsPanel n'est pas rendable en vitest node sans une chaîne de bouchons (store/theme
 * touche `document` au chargement, onboarding tire market et les adaptateurs). On lit donc la
 * source, patron lib/gardeFous.test.ts : le store de clé est branché, le client de données
 * CryptoQuant n'est jamais importé (bundle), le bloc suit DefiLlama Pro et porte les deux
 * textes Vercel / local.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(fileURLToPath(new URL("./SettingsPanel.tsx", import.meta.url)), "utf8");

describe("Réglages — clé CryptoQuant", () => {
  it("importe le store de clé et jamais le client de données CryptoQuant", () => {
    expect(SOURCE).toContain('import { cryptoquantKeyStore } from "../store/cryptoquant";');
    expect(SOURCE).not.toMatch(/data\/onchain\/cryptoquant/);
  });

  it("branche présence, enregistrement et suppression sur le store (jamais la valeur)", () => {
    expect(SOURCE).toContain("useStore(cryptoquantKeyStore, (s) => s.hasKey)");
    expect(SOURCE).toContain("useStore(cryptoquantKeyStore, (s) => s.setKey)");
    expect(SOURCE).toContain("useStore(cryptoquantKeyStore, (s) => s.clearKey)");
    expect(SOURCE).not.toContain("getCryptoquantKey");
  });

  it("place le bloc après DefiLlama Pro avec les deux textes Vercel / local de la spec", () => {
    const defillama = SOURCE.indexOf('name="DefiLlama Pro"');
    const cryptoquant = SOURCE.indexOf('name="CryptoQuant (takers et mineurs cotés)"');
    expect(defillama).toBeGreaterThan(-1);
    expect(cryptoquant).toBeGreaterThan(defillama);

    const bloc = SOURCE.slice(cryptoquant, SOURCE.indexOf("/>", cryptoquant));
    expect(bloc).toContain("purpose={IS_VERCEL");
    expect(bloc).toContain("clé personnelle requise — aucun repli serveur, licence personnelle");
    expect(bloc).toContain(
      "repli CRYPTOQUANT_API_KEY de .env pour le proxy Vite et le daemon local uniquement ; une clé saisie ici reste prioritaire",
    );
    expect(bloc).toContain('domain="api.cryptoquant.com, via la route locale /cqapi"');
    expect(bloc).toContain('signupUrl="https://cryptoquant.com"');
    expect(bloc).toContain("hasKey={cryptoquantHasKey}");
    expect(bloc).toContain("onSave={cryptoquantSetKey}");
    expect(bloc).toContain("onClear={cryptoquantClearKey}");
  });
});
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue.**
  `pnpm --filter @axiom/web exec vitest run src/components/SettingsPanel.cryptoquant.test.ts`
  Trois échecs sont attendus :
  - `expected '/**\n * SettingsPanel — panneau Réglages…' to contain 'import { cryptoquantKeyStore } from "../store/cryptoquant";'`
  - un message du même type pour `useStore(cryptoquantKeyStore, (s) => s.hasKey)` ;
  - `expected -1 to be greater than <index de DefiLlama Pro>`.

- [ ] **Étape 3 : implémentation minimale** dans `apps/web/src/components/SettingsPanel.tsx`, trois insertions de bas en haut.

  (a) **Entre la ligne 709 et la ligne 710** : la ligne 709 est le `/>` qui ferme le bloc « DefiLlama Pro », la ligne 710 est le `</div>` de la liste. Insérer :

```tsx
            <ApiKeyField
              name="CryptoQuant (takers et mineurs cotés)"
              purpose={IS_VERCEL
                ? "Flux takers toutes places (DES) et production des mineurs cotés (CHAIN), offre BASIC : clé personnelle requise — aucun repli serveur, licence personnelle."
                : "Flux takers toutes places (DES) et production des mineurs cotés (CHAIN), offre BASIC : repli CRYPTOQUANT_API_KEY de .env pour le proxy Vite et le daemon local uniquement ; une clé saisie ici reste prioritaire."}
              domain="api.cryptoquant.com, via la route locale /cqapi"
              signupUrl="https://cryptoquant.com"
              signupLabel="Offres CryptoQuant"
              placeholder="Clé API CryptoQuant (personnelle)"
              hasKey={cryptoquantHasKey}
              onSave={cryptoquantSetKey}
              onClear={cryptoquantClearKey}
            />
```

  (b) **Après la ligne 525** (`const defillamaClearKey = useStore(defillamaKeyStore, (s) => s.clearKey);`), insérer :

```tsx
  const cryptoquantHasKey = useStore(cryptoquantKeyStore, (s) => s.hasKey);
  const cryptoquantSetKey = useStore(cryptoquantKeyStore, (s) => s.setKey);
  const cryptoquantClearKey = useStore(cryptoquantKeyStore, (s) => s.clearKey);
```

  (c) **Après la ligne 30** (`import { defillamaKeyStore } from "../store/defillamaKey";`), insérer :

```tsx
import { cryptoquantKeyStore } from "../store/cryptoquant";
```

- [ ] **Étape 4 : lancer le test et vérifier qu'il passe.**
  `pnpm --filter @axiom/web exec vitest run src/components/SettingsPanel.cryptoquant.test.ts`. Attendu : 3 tests verts.
  Tests voisins (ratchets UI, garde-fous couleurs, stores) : `pnpm --filter @axiom/web exec vitest run src/components/uiConventions.test.ts src/lib/gardeFous.test.ts src/components/Toolbar.test.tsx src/store`
  Typecheck : `pnpm --filter @axiom/web typecheck`. Attendu : aucune erreur.

- [ ] **Étape 5 : mesurer le budget après B1-3.** Suivre le format unique du rapport et les attentes de budget (spec §12).

  (a) Construire. La commande imprime, après la sortie Vite, le JSON de `scripts/verifier-budget-build.mjs`.

```bash
pnpm --filter @axiom/web build
```

  Attendu : code de sortie 0 et aucune ligne « Erreur budget build ». Le script refuse un initial au-delà de 360 000 octets gzip niveau 9 ou de 1 220 000 octets bruts.

  (b) Consigner la section `### Budget après B1-3` à la fin du rapport. Elle contient une ligne « Commande : … », puis le bloc de code `json` **complet**. Ce bloc est le même JSON que celui du build : le script est rejoué tel quel sur le `apps/web/dist` que la commande (a) vient de produire. Aucun `| tee` n'est utilisé ici. Si vous en ajoutez un pour garder la sortie, faites précéder la commande de `set -o pipefail;`.

````bash
node scripts/verifier-budget-build.mjs apps/web/dist > "${TMPDIR:-/tmp}/axiom-budget-b1-3.json" && {
  printf '\n### Budget après B1-3\n\nCommande : `pnpm --filter @axiom/web build` (bloc imprimé par `scripts/verifier-budget-build.mjs`, rejoué tel quel sur `apps/web/dist`).\n\n```json\n'
  cat "${TMPDIR:-/tmp}/axiom-budget-b1-3.json"
  printf '```\n'
} >> docs/superpowers/progress/2026-09-16-cryptoquant.md; echo "(code $?)"
````

  (c) Consigner le chunk du store et le delta initial, **après** le bloc json. Cette ligne ne gêne pas la lecture des blocs par les tâches 16 et 20. Le script lit les blocs json des sections `### Budget avant B1` (écrite par la tâche 1) et `### Budget après B1-3`, ainsi que `apps/web/dist/.vite/manifest.json`. Il ajoute une ligne au rapport et l'imprime.

````bash
node - docs/superpowers/progress/2026-09-16-cryptoquant.md apps/web/dist/.vite/manifest.json <<'EOF'
const fs = require("node:fs");
const [rapport, cheminManifeste] = process.argv.slice(2);
const texte = fs.readFileSync(rapport, "utf8");
function blocBudget(etape) {
  const titre = `### Budget ${etape}\n`;
  const debut = texte.lastIndexOf(titre);
  if (debut < 0) throw new Error(`section absente du rapport : ${titre.trim()}`);
  const ouverture = texte.indexOf("```json\n", debut);
  const fermeture = ouverture < 0 ? -1 : texte.indexOf("\n```", ouverture + 8);
  if (fermeture < 0) throw new Error(`bloc json absent sous : ${titre.trim()}`);
  return JSON.parse(texte.slice(ouverture + 8, fermeture));
}
const avant = blocBudget("avant B1");
const apres = blocBudget("après B1-3");
const manifeste = JSON.parse(fs.readFileSync(cheminManifeste, "utf8"));
const partage = Object.entries(manifeste).find(([id, e]) => id.startsWith("_") && e.name === "cryptoquant");
const reglages = manifeste["src/components/SettingsPanel.tsx"];
if (reglages === undefined) throw new Error("SettingsPanel absent du manifeste");
const chunk = partage !== undefined
  ? `chunk partagé \`${partage[1].file}\``
  : `aucun chunk partagé, store inclus dans \`${reglages.file}\``;
const signe = (n) => (n >= 0 ? `+${n}` : `${n}`);
const deltaGzip = apres.initial.octetsGzip - avant.initial.octetsGzip;
const deltaBruts = apres.initial.octetsBruts - avant.initial.octetsBruts;
const ligne = `Store \`store/cryptoquant.ts\` dans \`.vite/manifest.json\` : ${chunk}. Delta initial depuis « Budget avant B1 » : ${signe(deltaGzip)} o gzip, ${signe(deltaBruts)} o bruts ; marge gzip locale ${apres.limites.octetsGzip - apres.initial.octetsGzip} o.`;
fs.appendFileSync(rapport, `\n${ligne}\n`);
console.log(ligne);
EOF
tail -n 3 docs/superpowers/progress/2026-09-16-cryptoquant.md
````

  Attendu : une seule ligne imprimée, de la forme « Store `store/cryptoquant.ts` dans `.vite/manifest.json` : aucun chunk partagé, store inclus dans `assets/SettingsPanel-….js`. Delta initial depuis « Budget avant B1 » : +N o gzip, +M o bruts ; marge gzip locale K o. ». `tail` montre la fin du bloc json suivie de cette ligne. Une ligne `Error:` signifie qu'une section manque ou n'a pas de bloc json : corriger le rapport avant de continuer.

  Lecture du résultat :
  - À ce stade, seul `SettingsPanel` (paresseux, `App.tsx:224`) importe le store. Rollup l'inclut donc normalement dans le chunk `SettingsPanel-….js`, sans créer `_cryptoquant-….js`. Le chunk partagé du store n'apparaît qu'une fois la section DES branchée : le client et la section l'importent aussi (tâches 13 à 15). Précédent : `_defillamaKey-….js`, partagé par les Réglages, `DefillamaProPanel.tsx` et `data/onchain/defillamaPro.ts`. La tâche 16 consigne ce nom.
  - Si un chunk partagé apparaît déjà ici, le noter tel quel. Chercher alors l'importateur supplémentaire avec `git grep -n "store/cryptoquant" -- apps/web/src`. Attendu : seul `SettingsPanel.tsx` l'importe. Les autres occurrences sont des commentaires (`persist.ts`) ou des chaînes de test (`SettingsPanel.cryptoquant.test.ts`).
  - Attentes de budget (spec §12) : « delta initial attendu ≤ ~40 o gzip par sous-lot (nom de chunk partagé) ; porte d'acceptation ≤ ~150 o gzip sur l'ensemble de B1 ; seule la limite 360 000 est bloquante ». Ici, le delta vient surtout des deux littéraux et du `startsWith` ajoutés à `persist.ts`, qui est dans le chemin d'entrée. Un delta supérieur à ~40 o gzip ne bloque pas : l'expliquer dans le rapport. La porte des ~150 o gzip sur l'ensemble de B1 est contrôlée en tâche 16.

- [ ] **Étape 6 : contrôle manuel.**
  1. Lancer `pnpm dev` et ouvrir l'URL affichée par Vite. Ouvrir ensuite les Réglages avec le bouton ⚙ « Ouvrir les réglages », en tête du panneau latéral « Panneaux » (`App.tsx:308-318`). Ce panneau est visible hors mode plein écran, à partir de la largeur `sm`.
  2. Vérifier que le bloc « CryptoQuant (takers et mineurs cotés) » apparaît juste sous « DefiLlama Pro ». Il doit porter le badge « non configurée » et le texte local qui mentionne « repli CRYPTOQUANT_API_KEY de .env ».
  3. Saisir `test` puis Entrée. Le badge passe à « clé ✓ configurée » et le champ se replie sur les boutons « Modifier » et « Supprimer ».
  4. Dans DevTools → Application → Local Storage, vérifier que `axiom:cryptoquant:key` vaut `test`.
  5. Cliquer « Supprimer ». Le badge revient à « non configurée » et l'entrée disparaît du Local Storage.
  6. Ne jamais saisir la vraie clé du propriétaire pour ce contrôle.

- [ ] **Étape 7 : commit.**

```bash
git add apps/web/src/components/SettingsPanel.tsx apps/web/src/components/SettingsPanel.cryptoquant.test.ts docs/superpowers/progress/2026-09-16-cryptoquant.md
git commit -m "$(cat <<'EOF'
feat(cryptoquant): champ de clé CryptoQuant dans les Réglages et budget après B1-3

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Zone D — client CryptoQuant

> Prérequis : Zone A (`shared/cryptoquant-proxy.ts` : `CRYPTOQUANT_PREFIXE`, `IDS_MINEURS_CQ`, `IdMineurCq`, `cheminCryptoQuantAmont`, fichier ajouté à `include` de `apps/web/tsconfig.json` ; define `__CQ_CLE_ENV__`) et tâche 6 (`store/cryptoquant.ts` : `getCryptoquantKey`, `cryptoquantKeyStore`, `RAISON_CLE_CRYPTOQUANT`, `messageSansCleCq` — spec §12 : la raison « clé requise » vit dans le store, le client ne fait que la ré-exporter en tâche 13). `situer` n'appartient pas au client (spec §12 : `components/fluxTakers.util.ts`, tâche 14). Commandes lancées depuis la racine (pnpm exécute vitest dans `apps/web`). Les lignes citées pour les fichiers créés ici sont celles obtenues en collant les blocs dans l'ordre. Sous vitest, un define sans point devient une propriété de `globalThis` : les tests posent `vi.stubGlobal("__CQ_CLE_ENV__", false)` (ou `true`) avant `await import("./cryptoquant")` (patron `bgeometrics-fetch.test.ts` : `vi.resetModules()` puis import dynamique).

### Tâche 9 : catalogue, jourUtc, cheminSerie, parserLignes

**Fichiers :**
- Créer : `apps/web/src/data/onchain/cryptoquant.ts`
- Tester : `apps/web/src/data/onchain/cryptoquant.test.ts` (création)

**Interfaces :**
- Consomme : Zone A — `CRYPTOQUANT_PREFIXE`, `IDS_MINEURS_CQ`, `IdMineurCq`, `cheminCryptoQuantAmont(pathname, search): string | null` ; `data/onchain/cohorts.ts:2-11` — `nombreOnchain(v: unknown): number | null`, `dateOnchain(v: unknown): number | null`.
- Produit : `SerieCq`, `SERIES_TAKER`, `SERIES_MINEURS`, `LigneTaker`, `LigneMineur`, `LigneCq`, `ArchiveCq`, `jourUtc(ms): string`, `cheminSerie(serie): string`, `parserLignes(serie, json, aujourdhuiUtc): Array<{ jour: string; ligne: LigneCq }>` (signatures du contrat) ; internes `estSerieMineur`, `estObjet`. Aucune définition locale de `RAISON_CLE_CRYPTOQUANT` (spec §12 : définie en tâche 6 dans le store, ré-exportée par le client en tâche 13).

- [ ] **Étape 1 : écrire le test qui échoue** — créer `cryptoquant.test.ts` (fixtures : spot BTC 2026-09-15 de la spec §4.4, MARA 2026-09-15 de la spec §2) :

```ts
import { describe, expect, it } from "vitest";
import { cheminCryptoQuantAmont } from "../../../../../shared/cryptoquant-proxy";
import {
  SERIES_MINEURS, SERIES_TAKER, cheminSerie, jourUtc, parserLignes,
  type LigneMineur, type LigneTaker,
} from "./cryptoquant";

const AUJ = "2026-09-16";
// Spot BTC du 2026-09-15 (spec §4.4) ; MARA du 2026-09-15 (spec §2 : 49,05 / 396,96 / 3,84 M$, reste illustratif).
const BTC = { datetime: "2026-09-15 00:00:00", symbol: "btc_all", trade_count: 12099486, base_volume: 156928.13,
  quote_volume: 12007360401.32, base_buy_volume: 77681.2, quote_buy_volume: 5944281632.44, base_sell_volume: 79246.93,
  quote_sell_volume: 6063078768.88, vwap: 76515.03, buy_ratio: 0.495, sell_ratio: 0.505, buy_sell_ratio: 0.9802,
  buy_count: 6133017, sell_count: 5966469 };
const L_BTC: LigneTaker = { n: 12099486, bv: 156928.13, qv: 12007360401.32, bbv: 77681.2, qbv: 5944281632.44,
  bsv: 79246.93, qsv: 6063078768.88, vwap: 76515.03, br: 0.495, bsr: 0.9802, bc: 6133017, sc: 5966469 };
const MARA = { date: "2026-09-15", coinbase_rewards: 48.9, other_mining_rewards: 0.15, total_rewards: 49.05,
  accumulated_monthly_rewards: 396.96, reported_production: null, report_accuracy: null, closing_usd: 78290,
  total_daily_rewards_closing_usd: 3840124.5, accumulated_monthly_rewards_closing_usd: 31077998.4 };
const L_MARA: LigneMineur = { r: 49.05, cr: 48.9, om: 0.15, cm: 396.96, usd: 3840124.5, cmu: 31077998.4, px: 78290, decl: null, prec: null };
const env = (data: unknown[], code = 200) => ({ status: { code }, result: { window: "day", data } });
const jours = (r: Array<{ jour: string }>) => r.map((x) => x.jour);

describe("CryptoQuant : catalogue", () => {
  it("13 séries, URL exactes acceptées telles quelles par la liste fermée, jamais from/to", () => {
    expect(SERIES_TAKER).toEqual(["taker:spot:btc", "taker:spot:eth", "taker:swap:btc", "taker:swap:eth"]);
    expect(SERIES_MINEURS).toEqual(["bitf", "cipher", "clsk", "core", "hive", "iren", "mara", "riot", "wulf"].map((id) => `mineur:${id}`));
    expect(cheminSerie("taker:swap:eth")).toBe("/cqapi/v2/market/cq/swap/trade?symbol=eth_all&window=day&limit=30");
    expect(cheminSerie("mineur:mara")).toBe("/cqapi/v1/btc/miner-data/companies?miner=mara&window=day&limit=30");
    for (const serie of [...SERIES_TAKER, ...SERIES_MINEURS]) {
      const url = new URL(cheminSerie(serie), "http://x");
      expect(url.searchParams.has("from") || url.searchParams.has("to")).toBe(false);
      expect(`/cqapi${cheminCryptoQuantAmont(url.pathname, url.search) ?? "REFUS"}`).toBe(cheminSerie(serie));
    }
    expect(jourUtc(Date.UTC(2026, 8, 16, 23, 59, 59))).toBe(AUJ);
  });
});

describe("CryptoQuant : parserLignes (I2)", () => {
  it("fixtures réelles → clés courtes, valeurs brutes, null conservés (jamais 0)", () => {
    expect(parserLignes("taker:spot:btc", env([BTC]), AUJ)).toEqual([{ jour: "2026-09-15", ligne: L_BTC }]);
    expect(parserLignes("mineur:mara", env([MARA]), AUJ)).toEqual([{ jour: "2026-09-15", ligne: L_MARA }]);
  });
  it("deux formats de date → même clé ; récent → ancien trié croissant, dédoublonné (dernier gagne)", () => {
    const data = [{ ...BTC, datetime: undefined, date: "2026-09-15" }, { ...BTC, datetime: "2026-09-14 00:00:00", vwap: 1 },
      { ...BTC, datetime: "2026-09-13 00:00:00" }, { ...BTC, datetime: "2026-09-14 00:00:00", vwap: 2 }];
    const r = parserLignes("taker:spot:btc", env(data), AUJ);
    expect(jours(r)).toEqual(["2026-09-13", "2026-09-14", "2026-09-15"]);
    expect((r[1]?.ligne as LigneTaker).vwap).toBe(2);
    expect(jours(parserLignes("mineur:mara", env([{ ...MARA, date: undefined, datetime: "2026-09-15 00:00:00" }]), AUJ))).toEqual(["2026-09-15"]);
  });
  it("aujourd'hui, futur, date invalide, ligne incomplète ignorés un par un", () => {
    const data = [{ ...BTC, datetime: "2026-09-17 00:00:00" }, { ...BTC, datetime: "2026-09-16 00:00:00" },
      { ...BTC, datetime: "2026-02-30 00:00:00" }, { ...BTC, datetime: "15/09/2026" },
      { ...BTC, datetime: "2026-09-14 00:00:00", vwap: null }, { ...BTC, datetime: "2026-09-13 00:00:00", buy_ratio: "NaN" }, null, BTC];
    expect(jours(parserLignes("taker:spot:btc", env(data), AUJ))).toEqual(["2026-09-15"]);
    expect(parserLignes("mineur:mara", env([{ ...MARA, total_rewards: null }]), AUJ)).toEqual([]);
  });
  it("status.code ≠ 200, data absent ou corps non objet → []", () => {
    expect(parserLignes("taker:spot:btc", env([BTC], 403), AUJ)).toEqual([]);
    expect(parserLignes("taker:spot:btc", { status: { code: 200 }, result: {} }, AUJ)).toEqual([]);
    expect(parserLignes("taker:spot:btc", { result: { data: [BTC] } }, AUJ)).toEqual([]);
    expect(parserLignes("taker:spot:btc", [BTC], AUJ)).toEqual([]);
  });
});
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue** — `pnpm --filter @axiom/web exec vitest run src/data/onchain/cryptoquant.test.ts` → le fichier de test échoue au chargement du module `./cryptoquant` (« Failed to load url ./cryptoquant » ou « Cannot find module », selon la version de Vitest), 0 test exécuté.

- [ ] **Étape 3 : implémentation minimale** — créer `cryptoquant.ts` (110 lignes) :

```ts
/**
 * CryptoQuant BASIC (flux takers toutes places, production des mineurs cotés). Chunk À LA DEMANDE :
 * importé uniquement par `await import()` depuis DES et CHAIN. Parties pures puis orchestrateur.
 * Aucune raison, aucun journal, aucune URL ne porte la clé.
 */
import { CRYPTOQUANT_PREFIXE, IDS_MINEURS_CQ, type IdMineurCq } from "../../../../../shared/cryptoquant-proxy";
import { dateOnchain, nombreOnchain } from "./cohorts";

// --- Catalogue ---

/** Les 13 séries admises (4 taker + 9 mineurs). */
export type SerieCq = "taker:spot:btc" | "taker:spot:eth" | "taker:swap:btc" | "taker:swap:eth" | `mineur:${IdMineurCq}`;
export const SERIES_TAKER: readonly SerieCq[] = ["taker:spot:btc", "taker:spot:eth", "taker:swap:btc", "taker:swap:eth"];
export const SERIES_MINEURS: readonly SerieCq[] = IDS_MINEURS_CQ.map((id): SerieCq => `mineur:${id}`);

/** Valeurs fournisseur BRUTES sous clés courtes, rien de dérivé. */
export interface LigneTaker { n: number; bv: number; qv: number; bbv: number; qbv: number; bsv: number; qsv: number; vwap: number; br: number; bsr: number; bc: number; sc: number }
/** `r` obligatoire ; le reste `null` si non publié (jamais 0). */
export interface LigneMineur { r: number; cr: number | null; om: number | null; cm: number | null; usd: number | null; cmu: number | null; px: number | null; decl: number | null; prec: number | null }
export type LigneCq = LigneTaker | LigneMineur;
/** Clé jour "YYYY-MM-DD" UTC ; `majTs` = dernier appel réussi. */
export interface ArchiveCq { version: 1; serie: SerieCq; majTs: number | null; jours: Record<string, LigneCq> }

const PREFIXE_SERIE_MINEUR = "mineur:";

export function jourUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function estSerieMineur(serie: SerieCq): serie is `mineur:${IdMineurCq}` {
  return serie.startsWith(PREFIXE_SERIE_MINEUR);
}

/** Toujours `window=day&limit=30`, jamais `from`/`to`. */
export function cheminSerie(serie: SerieCq): string {
  if (estSerieMineur(serie)) {
    return `${CRYPTOQUANT_PREFIXE}/v1/btc/miner-data/companies?miner=${serie.slice(PREFIXE_SERIE_MINEUR.length)}&window=day&limit=30`;
  }
  const marche = serie.startsWith("taker:spot:") ? "spot" : "swap";
  const actif = serie.endsWith(":eth") ? "eth" : "btc";
  return `${CRYPTOQUANT_PREFIXE}/v2/market/cq/${marche}/trade?symbol=${actif}_all&window=day&limit=30`;
}

// --- Parseur ---

function estObjet(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** "YYYY-MM-DD" (mineurs) ou "YYYY-MM-DD 00:00:00" (taker), validé par `dateOnchain`. */
function jourFournisseur(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T]\d{2}:\d{2}:\d{2})?$/.exec(v.trim());
  const jour = m?.[1];
  return jour !== undefined && dateOnchain(jour) !== null ? jour : null;
}

function requis(v: unknown): number | undefined {
  return nombreOnchain(v) ?? undefined;
}

function ligneTakerFournisseur(l: Record<string, unknown>): LigneTaker | null {
  const n = requis(l["trade_count"]), bv = requis(l["base_volume"]), qv = requis(l["quote_volume"]);
  const bbv = requis(l["base_buy_volume"]), qbv = requis(l["quote_buy_volume"]);
  const bsv = requis(l["base_sell_volume"]), qsv = requis(l["quote_sell_volume"]);
  const vwap = requis(l["vwap"]), br = requis(l["buy_ratio"]), bsr = requis(l["buy_sell_ratio"]);
  const bc = requis(l["buy_count"]), sc = requis(l["sell_count"]);
  if (n === undefined || bv === undefined || qv === undefined || bbv === undefined || qbv === undefined || bsv === undefined
    || qsv === undefined || vwap === undefined || br === undefined || bsr === undefined || bc === undefined || sc === undefined) return null;
  return { n, bv, qv, bbv, qbv, bsv, qsv, vwap, br, bsr, bc, sc };
}

function ligneMineurFournisseur(l: Record<string, unknown>): LigneMineur | null {
  const r = nombreOnchain(l["total_rewards"]);
  if (r === null) return null;
  return {
    r,
    cr: nombreOnchain(l["coinbase_rewards"]),
    om: nombreOnchain(l["other_mining_rewards"]),
    cm: nombreOnchain(l["accumulated_monthly_rewards"]),
    usd: nombreOnchain(l["total_daily_rewards_closing_usd"]),
    cmu: nombreOnchain(l["accumulated_monthly_rewards_closing_usd"]),
    px: nombreOnchain(l["closing_usd"]),
    decl: nombreOnchain(l["reported_production"]),
    prec: nombreOnchain(l["report_accuracy"]),
  };
}

/** Lignes croissantes, dédoublonnées ; `code ≠ 200` → [] ; jours ≥ aujourd'hui et lignes invalides ignorés un par un. */
export function parserLignes(serie: SerieCq, json: unknown, aujourdhuiUtc: string): Array<{ jour: string; ligne: LigneCq }> {
  if (!estObjet(json)) return [];
  const status = json["status"];
  const result = json["result"];
  if (!estObjet(status) || status["code"] !== 200 || !estObjet(result)) return [];
  const data = result["data"];
  if (!Array.isArray(data)) return [];
  const mineur = estSerieMineur(serie);
  const parJour = new Map<string, LigneCq>();
  for (const brut of data) {
    if (!estObjet(brut)) continue;
    const jour = jourFournisseur(typeof brut["datetime"] === "string" ? brut["datetime"] : brut["date"]);
    if (jour === null || jour >= aujourdhuiUtc) continue;
    const ligne = mineur ? ligneMineurFournisseur(brut) : ligneTakerFournisseur(brut);
    if (ligne !== null) parJour.set(jour, ligne);
  }
  return [...parJour.keys()].sort().flatMap((jour) => {
    const ligne = parJour.get(jour);
    return ligne === undefined ? [] : [{ jour, ligne }];
  });
}
```

- [ ] **Étape 4 : lancer le test et vérifier qu'il passe** — `pnpm --filter @axiom/web exec vitest run src/data/onchain/cryptoquant.test.ts src/data/onchain/cohorts.test.ts` (5 tests CryptoQuant verts) puis `pnpm --filter @axiom/web typecheck`.

- [ ] **Étape 5 : commit**

```bash
git add apps/web/src/data/onchain/cryptoquant.ts apps/web/src/data/onchain/cryptoquant.test.ts
git commit -m "feat(cryptoquant): catalogue des 13 séries et parseur des jours clos

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

### Tâche 10 : fusionner, unionArchives, decoderArchive, diagnostiquer

**Fichiers :**
- Modifier : `apps/web/src/data/onchain/cryptoquant.ts:110` (ajout en fin de fichier → lignes 111-228)
- Modifier : `apps/web/src/data/onchain/cryptoquant.test.ts:3-6` (import, même nombre de lignes) et `:64` (ajout en fin de fichier → lignes 65-120)
- Tester : `apps/web/src/data/onchain/cryptoquant.test.ts`

**Interfaces :**
- Consomme : tâche 9 — `jourUtc`, `estObjet`, `estSerieMineur`, types ; `dateOnchain`.
- Produit : `fusionner`, `unionArchives` (égalité de `majTs` → `a`, la copie locale), `DecodageCq`, `decoderArchive`, `DiagnosticCq`, `diagnostiquer` (signatures du contrat). Arbitrage (spec §12) : `situer` n'est **pas** dans le client (ni code ni test ici) ; il est exporté par `apps/web/src/components/fluxTakers.util.ts` et testé en tâche 14. Interne `validerArchive(valeur: unknown, serie: SerieCq): DecodageCq` pour la `valeur` déjà parsée du KV (tâche 11) ; internes `JOUR_MS`, `jourVersMs`, `decalerJour`, `trierJours`.

- [ ] **Étape 1 : écrire le test qui échoue** — remplacer les lignes 3-6 de `cryptoquant.test.ts` par :

```ts
import {
  SERIES_MINEURS, SERIES_TAKER, cheminSerie, decoderArchive, diagnostiquer, fusionner, jourUtc, parserLignes, unionArchives,
  type ArchiveCq, type LigneMineur, type LigneTaker,
} from "./cryptoquant";
```

puis ajouter en fin de fichier :

```ts

// --- Archive (tâche 10) ---
const J = (n: number): string => jourUtc(Date.UTC(2026, 8, 16) + n * 86_400_000); // J(-1) = hier
const plage = (de: number, a: number): string[] => Array.from({ length: a - de + 1 }, (_, i) => J(de + i));
const arch = (js: string[], majTs: number | null, vwap = 1): ArchiveCq =>
  ({ version: 1, serie: "taker:spot:btc", majTs, jours: Object.fromEntries(js.map((j) => [j, { ...L_BTC, vwap }])) });
const vwap = (a: ArchiveCq | null, j: string) => (a?.jours[j] as LigneTaker | undefined)?.vwap;

describe("CryptoQuant : fusionner et unionArchives (I1)", () => {
  it("{J-40..J-2} + {J-30..J-1} : J-1 ajouté, J-2..J-30 remplacés, J-31..J-40 conservés ; vide → inchangé", () => {
    const avant = arch(plage(-40, -2), 100);
    const apres = fusionner(avant, "taker:spot:btc", plage(-30, -1).map((jour) => ({ jour, ligne: { ...L_BTC, vwap: 2 } })), 500);
    expect(Object.keys(apres.jours)).toEqual(plage(-40, -1));
    expect([vwap(apres, J(-1)), vwap(apres, J(-30)), vwap(apres, J(-31)), apres.majTs]).toEqual([2, 2, 1, 500]);
    expect(fusionner(avant, "taker:spot:btc", [], 999)).toEqual(avant);
    expect(fusionner(null, "mineur:mara", [], 9)).toEqual({ version: 1, serie: "mineur:mara", majTs: null, jours: {} });
  });
  it("union : tous les jours, conflit → majTs le plus grand, null ignoré", () => {
    const local = arch([J(-3), J(-2)], 100, 1);
    const kv = arch([J(-2), J(-1)], 200, 2);
    const u = unionArchives(local, kv);
    expect([Object.keys(u?.jours ?? {}), vwap(u, J(-2)), u?.majTs]).toEqual([[J(-3), J(-2), J(-1)], 2, 200]);
    expect(vwap(unionArchives({ ...kv, majTs: 50 }, local), J(-2))).toBe(1);
    expect([unionArchives(null, kv), unionArchives(null, null)]).toEqual([kv, null]);
  });
});

describe("CryptoQuant : decoderArchive (I4)", () => {
  it("absente, illisible, version inconnue, série ou forme inattendue", () => {
    const d = (v: unknown) => decoderArchive(typeof v === "string" ? v : JSON.stringify(v), "taker:spot:btc").etat;
    expect(decoderArchive(null, "taker:spot:btc").etat).toBe("absente");
    expect([d("{pas du json"), d({ version: 2 }), d({ ...arch([], 1), serie: "taker:spot:eth" }), d({ version: 1, serie: "taker:spot:btc" })])
      .toEqual(["illisible", "versionInconnue", "illisible", "illisible"]);
  });
  it("version 1 : seul le jour invalide est ignoré ; null mineur conservés ; majTs invalide → null", () => {
    const brut = { ...arch([], 42), jours: { [J(-3)]: L_BTC, "2026-02-30": L_BTC, [J(-2)]: { ...L_BTC, vwap: "1" }, [J(-1)]: L_BTC } };
    expect(decoderArchive(JSON.stringify(brut), "taker:spot:btc"))
      .toEqual({ etat: "ok", archive: { ...arch([], 42), jours: { [J(-3)]: L_BTC, [J(-1)]: L_BTC } } });
    const mineur = { version: 1, serie: "mineur:mara", majTs: "hier", jours: { [J(-1)]: L_MARA, [J(-2)]: { ...L_MARA, usd: "3.8M" } } };
    expect(decoderArchive(JSON.stringify(mineur), "mineur:mara"))
      .toEqual({ etat: "ok", archive: { version: 1, serie: "mineur:mara", majTs: null, jours: { [J(-1)]: L_MARA } } });
  });
});

describe("CryptoQuant : diagnostiquer (I3)", () => {
  it("{J-60..J-45} puis {J-30..J-1} → début J-60, 14 perdus, 0 manquant ; sans J-10 → 1 manquant", () => {
    expect(diagnostiquer(arch([...plage(-60, -45), ...plage(-30, -1)], 1), AUJ))
      .toEqual({ debut: J(-60), dernier: J(-1), hierPresent: true, manquantsFenetre: [], perdus: plage(-44, -31), perime: false });
    expect(diagnostiquer(arch(plage(-30, -1).filter((j) => j !== J(-10)), 1), AUJ)).toMatchObject({ manquantsFenetre: [J(-10)], perdus: [] });
  });
  it("hier absent non compté ; périmé au-delà de 2 j ; archive vide → début null", () => {
    expect(diagnostiquer(arch(plage(-30, -2), 1), AUJ)).toMatchObject({ hierPresent: false, manquantsFenetre: [], perime: false });
    expect(diagnostiquer(arch(plage(-30, -3), 1), AUJ).perime).toBe(true);
    expect(diagnostiquer(null, AUJ)).toEqual({ debut: null, dernier: null, hierPresent: false, manquantsFenetre: [], perdus: [], perime: true });
  });
});
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue** — `pnpm --filter @axiom/web exec vitest run src/data/onchain/cryptoquant.test.ts` → 6 tests rouges en `TypeError` « fusionner is not a function » (idem `unionArchives`, `decoderArchive`, `diagnostiquer`) ; les 5 tests de la tâche 9 restent verts.

- [ ] **Étape 3 : implémentation minimale** — ajouter en fin de `cryptoquant.ts` :

```ts

// --- Archive (pure) ---

const JOUR_MS = 86_400_000;

function jourVersMs(jour: string): number {
  return Date.parse(`${jour}T00:00:00Z`);
}

function decalerJour(jour: string, n: number): string {
  return jourUtc(jourVersMs(jour) + n * JOUR_MS);
}

function trierJours(jours: Record<string, LigneCq>): Record<string, LigneCq> {
  const trie: Record<string, LigneCq> = {};
  for (const jour of Object.keys(jours).sort()) {
    const ligne = jours[jour];
    if (ligne !== undefined) trie[jour] = ligne;
  }
  return trie;
}

/** La ligne reçue remplace celle du jour, aucun jour supprimé ; réponse vide → inchangée. */
export function fusionner(archive: ArchiveCq | null, serie: SerieCq, lignes: ReadonlyArray<{ jour: string; ligne: LigneCq }>, now: number): ArchiveCq {
  const base: ArchiveCq = archive ?? { version: 1, serie, majTs: null, jours: {} };
  if (lignes.length === 0) return base;
  const jours: Record<string, LigneCq> = { ...base.jours };
  for (const { jour, ligne } of lignes) jours[jour] = ligne;
  return { version: 1, serie, majTs: now, jours: trierJours(jours) };
}

/** Conflit → copie au `majTs` le plus grand (égalité → `a`, la copie locale). */
export function unionArchives(a: ArchiveCq | null, b: ArchiveCq | null): ArchiveCq | null {
  if (a === null) return b;
  if (b === null) return a;
  const aGagne = (a.majTs ?? -1) >= (b.majTs ?? -1);
  const [perdante, gagnante] = aGagne ? [b, a] : [a, b];
  return { version: 1, serie: a.serie, majTs: gagnante.majTs ?? perdante.majTs, jours: trierJours({ ...perdante.jours, ...gagnante.jours }) };
}

export type DecodageCq = { etat: "absente" } | { etat: "illisible" } | { etat: "versionInconnue" } | { etat: "ok"; archive: ArchiveCq };

function fini(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function finiOuNull(v: unknown): number | null | undefined {
  if (v === null || v === undefined) return null;
  return fini(v) ? v : undefined;
}

function ligneTakerStockee(v: unknown): LigneTaker | null {
  if (!estObjet(v)) return null;
  const { n, bv, qv, bbv, qbv, bsv, qsv, vwap, br, bsr, bc, sc } = v;
  if (!fini(n) || !fini(bv) || !fini(qv) || !fini(bbv) || !fini(qbv) || !fini(bsv) || !fini(qsv)
    || !fini(vwap) || !fini(br) || !fini(bsr) || !fini(bc) || !fini(sc)) return null;
  return { n, bv, qv, bbv, qbv, bsv, qsv, vwap, br, bsr, bc, sc };
}

function ligneMineurStockee(v: unknown): LigneMineur | null {
  if (!estObjet(v) || !fini(v["r"])) return null;
  const cr = finiOuNull(v["cr"]), om = finiOuNull(v["om"]), cm = finiOuNull(v["cm"]), usd = finiOuNull(v["usd"]);
  const cmu = finiOuNull(v["cmu"]), px = finiOuNull(v["px"]), decl = finiOuNull(v["decl"]), prec = finiOuNull(v["prec"]);
  if (cr === undefined || om === undefined || cm === undefined || usd === undefined
    || cmu === undefined || px === undefined || decl === undefined || prec === undefined) return null;
  return { r: v["r"], cr, om, cm, usd, cmu, px, decl, prec };
}

/** Archive déjà parsée (local ou `valeur` KV) ; version 1 : un jour invalide est ignoré, pas le blob. */
function validerArchive(valeur: unknown, serie: SerieCq): DecodageCq {
  if (!estObjet(valeur)) return { etat: "illisible" };
  const version = valeur["version"];
  if (typeof version === "number" && Number.isInteger(version) && version > 1) return { etat: "versionInconnue" };
  const joursBruts = valeur["jours"];
  if (version !== 1 || valeur["serie"] !== serie || !estObjet(joursBruts)) return { etat: "illisible" };
  const majTs = fini(valeur["majTs"]) ? valeur["majTs"] : null;
  const mineur = estSerieMineur(serie);
  const jours: Record<string, LigneCq> = {};
  for (const [jour, brut] of Object.entries(joursBruts)) {
    if (dateOnchain(jour) === null) continue;
    const ligne = mineur ? ligneMineurStockee(brut) : ligneTakerStockee(brut);
    if (ligne !== null) jours[jour] = ligne;
  }
  return { etat: "ok", archive: { version: 1, serie, majTs, jours: trierJours(jours) } };
}

export function decoderArchive(brut: string | null, serie: SerieCq): DecodageCq {
  if (brut === null) return { etat: "absente" };
  let valeur: unknown;
  try {
    valeur = JSON.parse(brut);
  } catch {
    return { etat: "illisible" };
  }
  return validerArchive(valeur, serie);
}

export interface DiagnosticCq { debut: string | null; dernier: string | null; hierPresent: boolean; manquantsFenetre: string[]; perdus: string[]; perime: boolean }

/** Trous entre `debut` et avant-hier : perdus (< J-30) ou manquants ; hier absent n'est jamais un trou. */
export function diagnostiquer(archive: ArchiveCq | null, aujourdhuiUtc: string): DiagnosticCq {
  const jours = archive === null ? [] : Object.keys(archive.jours).sort();
  const presents = new Set(jours);
  const debut = jours[0] ?? null;
  const dernier = jours[jours.length - 1] ?? null;
  const avantHier = decalerJour(aujourdhuiUtc, -2);
  const limitePerdus = decalerJour(aujourdhuiUtc, -30);
  const manquantsFenetre: string[] = [];
  const perdus: string[] = [];
  if (debut !== null) {
    for (let jour = debut; jour <= avantHier; jour = decalerJour(jour, 1)) {
      if (presents.has(jour)) continue;
      if (jour < limitePerdus) perdus.push(jour);
      else manquantsFenetre.push(jour);
    }
  }
  const perime = dernier === null || jourVersMs(aujourdhuiUtc) - jourVersMs(dernier) > 2 * JOUR_MS;
  return { debut, dernier, hierPresent: presents.has(decalerJour(aujourdhuiUtc, -1)), manquantsFenetre, perdus, perime };
}
```

- [ ] **Étape 4 : lancer le test et vérifier qu'il passe** — `pnpm --filter @axiom/web exec vitest run src/data/onchain/cryptoquant.test.ts` (11 verts : catalogue, I2, I1 fusion/union, I4 décodage, I3) puis `pnpm --filter @axiom/web typecheck`. Contrôle « `situer` hors du client » : `rg -n "situer" apps/web/src/data/onchain/` ne renvoie rien.

- [ ] **Étape 5 : commit**

```bash
git add apps/web/src/data/onchain/cryptoquant.ts apps/web/src/data/onchain/cryptoquant.test.ts
git commit -m "feat(cryptoquant): archive par série — fusion non destructive, union, décodage tolérant, trous dérivés

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

### Tâche 11 : persistance — local ∪ KV tri-état, écriture gardée

**Fichiers :**
- Modifier : `apps/web/src/data/onchain/cryptoquant.ts:6-7` (imports → 4 lignes) et `:230` (ajout en fin de fichier → lignes 231-332)
- Créer : `apps/web/src/data/onchain/cryptoquant-fetch.test.ts`
- Tester : `apps/web/src/data/onchain/cryptoquant-fetch.test.ts`

**Interfaces :**
- Consomme : tâche 10 — `decoderArchive`, `validerArchive`, `unionArchives` ; `data/daemon.ts` — `detectDaemon(exigence?)` (`:257-276`, faux sans sonde sur Vercel), `urlDaemon(chemin)` (`:191-193`), `kvPut(ns, cle, valeur): Promise<number | null>` (`:346-349`, sérialisation par `ecrireKv` `:351-364`) ; `lib/deployment.ts:7` — `IS_VERCEL` ; KV réel `apps/daemon/src/kv.ts:116-128` (200 → `{ namespace, cle, valeur, majA }`, `valeur` déjà parsée ; 404 → `{ erreur: "absent" }`) et `:28` (1 048 576).
- Produit : `PersistanceCq` (`kv` : `null` = pas de daemon, `false` = lecture ou écriture KV en échec), `EtatKvCq = "sans-daemon" | "absente" | "erreur" | "presente"`, `LectureArchiveCq { archive; versionInconnue; localIllisible; kv; persistance }`, `lireArchiveCq(serie): Promise<LectureArchiveCq>`, `ecrireArchiveCq(serie, archive, kv: EtatKvCq): Promise<PersistanceCq>` ; `cleLocale(serie: SerieCq): string` → `axiom:onchain:cq:<serie>:v1` et `cleKv(serie: SerieCq): string` → `cq:<serie>:v1` (namespace KV `onchain`), **exportées** (noms camelCase actés à la place du `CLE_LOCALE` illustratif du contrat ; un test fige `cleLocale("taker:spot:btc") === "axiom:onchain:cq:taker:spot:btc:v1"`, préfixe exclu des sauvegardes par `resteSurLePoste` en tâche 7, où il n'est pas exporté : le lien est donc un littéral figé des deux côtés). Le mock de `../../store/cryptoquant` part du vrai module (`importOriginal`, patron `chart/orderflow.bucket.test.ts:47-48`) : `RAISON_CLE_CRYPTOQUANT` (spec §12, utilisée par le client en tâche 13) et `messageSansCleCq` y restent réels, seuls `getCryptoquantKey` et `cryptoquantKeyStore` sont pilotés. Le test fournit `reinitialiser`, `reseau`, `arch`, `poser`, `relire`, `kvOk`, `aucun`, `detecter`, `kvPutMock`, `cle`, `T0`, `J`, `plage`, `L`, `CLE_BTC`, `stockage` aux tâches 12-13.

- [ ] **Étape 1 : écrire le test qui échoue** — créer `cryptoquant-fetch.test.ts` (mocks : patrons `data/extapi.test.ts:5-9` et `alerts/runtime.test.ts:25-31` ; `IS_VERCEL` par `vi.doMock` comme `store/coinalyze.test.ts:24-50` ; stockage plein comme `store/persist.test.ts:501`) :

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArchiveCq, LigneTaker, SerieCq } from "./cryptoquant";

// Daemon et store de clé pilotés par le test.
const { detecter, kvPutMock, cle } = vi.hoisted(() => ({
  detecter: vi.fn(async (_e?: string): Promise<boolean> => false),
  kvPutMock: vi.fn(async (_ns: string, _cle: string, _v: unknown): Promise<number | null> => 1),
  cle: { valeur: null as string | null, version: 0 },
}));
vi.mock("../daemon", () => ({ detectDaemon: detecter, urlDaemon: (c: string) => `http://d${c}`, kvPut: kvPutMock }));
// Vrai store (`RAISON_CLE_CRYPTOQUANT` réel, ré-exporté par le client) ; clé et version pilotées.
vi.mock("../../store/cryptoquant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../store/cryptoquant")>()),
  getCryptoquantKey: () => cle.valeur,
  cryptoquantKeyStore: { getState: () => ({ hasKey: cle.valeur !== null, version: cle.version,
    setKey: (v: string) => { cle.valeur = v; cle.version++; }, clearKey: () => { cle.valeur = null; cle.version++; } }) },
}));

function stockage(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k),
    clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
const T0 = Date.UTC(2026, 8, 16, 12);
const J = (n: number): string => new Date(T0 + n * 86_400_000).toISOString().slice(0, 10);
const plage = (de: number, a: number): string[] => Array.from({ length: a - de + 1 }, (_, i) => J(de + i));
const L: LigneTaker = { n: 1, bv: 2, qv: 3, bbv: 4, qbv: 5, bsv: 6, qsv: 7, vwap: 8, br: 0.5, bsr: 1, bc: 9, sc: 10 };
const arch = (js: string[], majTs: number | null, vwap = 8, serie: SerieCq = "taker:spot:btc"): ArchiveCq =>
  ({ version: 1, serie, majTs, jours: Object.fromEntries(js.map((j) => [j, { ...L, vwap }])) });
const CLE_BTC = "axiom:onchain:cq:taker:spot:btc:v1";
const poser = (a: ArchiveCq) => localStorage.setItem(`axiom:onchain:cq:${a.serie}:v1`, JSON.stringify(a));
const relire = (s: SerieCq = "taker:spot:btc") => JSON.parse(localStorage.getItem(`axiom:onchain:cq:${s}:v1`) ?? "null") as ArchiveCq | null;
const kvOk = (valeur: unknown) => () => Response.json({ namespace: "onchain", cle: "x", valeur, majA: 1 });
type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;
const aucun: Route = () => { throw new Error("appel CryptoQuant inattendu"); };
/** `fetch` routé : URL commençant par `http://d/kv/` → KV simulé (404 par défaut), le reste → API simulée. */
function reseau(api: Route, kv: Route = () => Response.json({ erreur: "absent" }, { status: 404 })) {
  const f = vi.fn(async (u: RequestInfo | URL, init?: RequestInit) => (String(u).startsWith("http://d/kv/") ? kv(String(u), init) : api(String(u), init)));
  vi.stubGlobal("fetch", f);
  return f;
}
function reinitialiser(): void {
  vi.resetModules();
  vi.stubGlobal("localStorage", stockage());
  vi.stubGlobal("__CQ_CLE_ENV__", false);
  detecter.mockReset().mockResolvedValue(false);
  kvPutMock.mockReset().mockResolvedValue(1);
  cle.valeur = null;
  cle.version = 0;
}

describe("CryptoQuant : persistance locale ∪ KV (I1, I4)", () => {
  beforeEach(reinitialiser);
  afterEach(() => { vi.unstubAllGlobals(); vi.doUnmock("../../lib/deployment"); });

  it("emplacements figés : clé locale sous le préfixe exclu des sauvegardes (tâche 7), clé KV par série", async () => {
    const cq = await import("./cryptoquant");
    expect(cq.cleLocale("taker:spot:btc")).toBe("axiom:onchain:cq:taker:spot:btc:v1");
    expect(cq.cleLocale("taker:spot:btc")).toBe(CLE_BTC);
    expect(cq.cleKv("mineur:mara")).toBe("cq:mineur:mara:v1");
    const series = [...cq.SERIES_TAKER, ...cq.SERIES_MINEURS];
    expect(series.map(cq.cleLocale).filter((c) => !c.startsWith("axiom:onchain:cq:") || !c.endsWith(":v1"))).toEqual([]);
    expect(new Set(series.map(cq.cleKv)).size).toBe(13);
  });

  it("sans daemon : local seul, kv null ; Vercel : ni sonde ni KV", async () => {
    let cq = await import("./cryptoquant");
    poser(arch(plage(-3, -2), 10));
    const f = reseau(aucun);
    expect(await cq.lireArchiveCq("taker:spot:btc")).toMatchObject({ kv: "sans-daemon", persistance: { local: true, kv: null } });
    expect(detecter).toHaveBeenCalledWith("kv");
    vi.resetModules();
    vi.doMock("../../lib/deployment", () => ({ IS_VERCEL: true }));
    detecter.mockClear().mockResolvedValue(true);
    cq = await import("./cryptoquant");
    expect((await cq.lireArchiveCq("taker:spot:btc")).kv).toBe("sans-daemon");
    expect(detecter).not.toHaveBeenCalled();
    expect(f).not.toHaveBeenCalled();
  });

  it("local vide + KV 400 j → 400 j servis et réécrits ; après fusion kvPut reçoit 401 j", async () => {
    const cq = await import("./cryptoquant");
    detecter.mockResolvedValue(true);
    const f = reseau(aucun, kvOk(arch(plage(-401, -2), 20)));
    const l = await cq.lireArchiveCq("taker:spot:btc");
    expect(f.mock.calls[0]?.[0]).toBe("http://d/kv/onchain/cq%3Ataker%3Aspot%3Abtc%3Av1");
    expect(l).toMatchObject({ kv: "presente", persistance: { local: true, kv: true } });
    expect([Object.keys(relire()?.jours ?? {}).length, relire()?.majTs]).toEqual([400, 20]);
    const fusion = cq.fusionner(l.archive, "taker:spot:btc", [{ jour: J(-1), ligne: L }], 99);
    expect(await cq.ecrireArchiveCq("taker:spot:btc", fusion, l.kv)).toEqual({ local: true, kv: true });
    const [ns, cleKv, valeur] = kvPutMock.mock.calls[0] ?? [];
    expect([ns, cleKv, Object.keys((valeur as ArchiveCq).jours).length]).toEqual(["onchain", "cq:taker:spot:btc:v1", 401]);
  });

  it.each([
    ["HTTP 500", () => new Response(null, { status: 500 })],
    ["réseau", () => { throw new TypeError("échec"); }],
  ] as const)("KV en erreur (%s) → kvPut jamais appelé, local écrit", async (_n, kv) => {
    const cq = await import("./cryptoquant");
    detecter.mockResolvedValue(true);
    reseau(aucun, kv);
    const l = await cq.lireArchiveCq("taker:spot:btc");
    expect(l).toMatchObject({ archive: null, kv: "erreur", persistance: { kv: false } });
    expect(await cq.ecrireArchiveCq("taker:spot:btc", arch([J(-1)], 5), l.kv)).toEqual({ local: true, kv: false });
    expect(kvPutMock).not.toHaveBeenCalled();
    expect(relire()?.majTs).toBe(5);
  });

  it("conflit même jour → copie au majTs le plus grand, réécriture locale si enrichie", async () => {
    const cq = await import("./cryptoquant");
    detecter.mockResolvedValue(true);
    poser(arch([J(-3), J(-2)], 300, 1));
    reseau(aucun, kvOk(arch([J(-2)], 200, 2)));
    expect((await cq.lireArchiveCq("taker:spot:btc")).archive?.jours[J(-2)]).toMatchObject({ vwap: 1 });
    reseau(aucun, kvOk(arch([J(-2)], 400, 2)));
    expect((await cq.lireArchiveCq("taker:spot:btc")).archive?.jours[J(-2)]).toMatchObject({ vwap: 2 });
    expect([Object.keys(relire()?.jours ?? {}), relire()?.majTs]).toEqual([[J(-3), J(-2)], 400]);
  });

  it("version inconnue (locale ou KV) : servie vide, jamais réécrite ; JSON illisible : signalé puis remplacé", async () => {
    const cq = await import("./cryptoquant");
    detecter.mockResolvedValue(true);
    const futur = JSON.stringify({ version: 2 });
    localStorage.setItem(CLE_BTC, futur);
    const setItem = vi.spyOn(localStorage, "setItem");
    reseau(aucun, kvOk(arch(plage(-5, -2), 1)));
    expect(await cq.lireArchiveCq("taker:spot:btc")).toMatchObject({ archive: null, versionInconnue: true });
    localStorage.removeItem(CLE_BTC);
    reseau(aucun, kvOk({ version: 3 }));
    expect(await cq.lireArchiveCq("taker:spot:btc")).toMatchObject({ archive: null, versionInconnue: true });
    expect(setItem).not.toHaveBeenCalled();
    localStorage.setItem(CLE_BTC, "{pas du json");
    reseau(aucun);
    const l = await cq.lireArchiveCq("taker:spot:btc");
    expect(l).toMatchObject({ archive: null, localIllisible: true, kv: "absente" });
    await cq.ecrireArchiveCq("taker:spot:btc", arch([J(-1)], 7), l.kv);
    expect(relire()?.majTs).toBe(7);
  });

  it("stockage plein → local false ; > 900 000 caractères ou kvPut null → kv false", async () => {
    const cq = await import("./cryptoquant");
    const geante = arch(Array.from({ length: 12_000 }, (_, i) => new Date(Date.UTC(1990, 0, 1) + i * 86_400_000).toISOString().slice(0, 10)), 7);
    expect(JSON.stringify(geante).length).toBeGreaterThan(900_000);
    expect(await cq.ecrireArchiveCq("taker:spot:btc", geante, "presente")).toEqual({ local: true, kv: false });
    expect(kvPutMock).not.toHaveBeenCalled();
    kvPutMock.mockResolvedValue(null);
    expect(await cq.ecrireArchiveCq("taker:spot:btc", arch([J(-1)], 7), "absente")).toEqual({ local: true, kv: false });
    localStorage.setItem = () => { throw new DOMException("quota", "QuotaExceededError"); };
    kvPutMock.mockResolvedValue(1);
    expect(await cq.ecrireArchiveCq("taker:spot:btc", arch([J(-1)], 7), "absente")).toEqual({ local: false, kv: true });
  });
});
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue** — `pnpm --filter @axiom/web exec vitest run src/data/onchain/cryptoquant-fetch.test.ts` → 8 tests rouges `TypeError: cq.cleLocale is not a function` (test des emplacements figés) et `TypeError: cq.lireArchiveCq is not a function` (ou `cq.ecrireArchiveCq`) pour les 7 autres.

- [ ] **Étape 3 : implémentation minimale** — remplacer les lignes 6-7 de `cryptoquant.ts` par :

```ts
import { CRYPTOQUANT_PREFIXE, IDS_MINEURS_CQ, type IdMineurCq } from "../../../../../shared/cryptoquant-proxy";
import { IS_VERCEL } from "../../lib/deployment";
import { detectDaemon, kvPut, urlDaemon } from "../daemon";
import { dateOnchain, nombreOnchain } from "./cohorts";
```

puis ajouter en fin de fichier (ni `lireCache` ni `ecrireCache` : lecture sans union et `void kvPut`, `cache.ts:48-89`) :

```ts

// --- Persistance (localStorage ∪ KV daemon) ---

/** Mêmes namespace et préfixe que `data/onchain/cache.ts` (non exportés là-bas). */
const NS_KV = "onchain";

/** Clé localStorage d'une série ; le préfixe `axiom:onchain:cq:` est exclu des sauvegardes (`resteSurLePoste`). */
export function cleLocale(serie: SerieCq): string {
  return `axiom:onchain:cq:${serie}:v1`;
}

/** Clé KV daemon d'une série (namespace `onchain`). */
export function cleKv(serie: SerieCq): string {
  return `cq:${serie}:v1`;
}

/** Le daemon refuse au-delà de 1 048 576 caractères. */
const TAILLE_MAX_KV = 900_000;
const TIMEOUT_KV_MS = 5_000;

/** `kv` : null = pas de daemon, false = lecture ou écriture KV en échec. */
export interface PersistanceCq { local: boolean; kv: boolean | null }
export type EtatKvCq = "sans-daemon" | "absente" | "erreur" | "presente";
export interface LectureArchiveCq {
  archive: ArchiveCq | null;
  versionInconnue: boolean;
  localIllisible: boolean;
  kv: EtatKvCq;
  persistance: PersistanceCq;
}

function lireLocal(serie: SerieCq): string | null {
  try {
    return localStorage.getItem(cleLocale(serie));
  } catch {
    return null;
  }
}

function ecrireLocal(serie: SerieCq, texte: string): boolean {
  try {
    localStorage.setItem(cleLocale(serie), texte);
    return true;
  } catch {
    // Stockage plein : signalé par `local: false`.
    return false;
  }
}

/** Tri-état par fetch brut (`kvGet` confond 404 et erreur). */
async function lireKv(serie: SerieCq): Promise<{ etat: "absente" | "erreur" } | { etat: "presente"; decodage: DecodageCq }> {
  try {
    const res = await fetch(urlDaemon(`/kv/${encodeURIComponent(NS_KV)}/${encodeURIComponent(cleKv(serie))}`), { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_KV_MS) });
    if (res.status === 404) return { etat: "absente" };
    if (!res.ok) return { etat: "erreur" };
    const corps = (await res.json()) as unknown;
    if (!estObjet(corps) || !("valeur" in corps)) return { etat: "erreur" };
    return { etat: "presente", decodage: validerArchive(corps["valeur"], serie) };
  } catch {
    return { etat: "erreur" };
  }
}

function enrichit(union: ArchiveCq, local: ArchiveCq | null): boolean {
  if (local === null) return union.majTs !== null || Object.keys(union.jours).length > 0;
  return Object.keys(union.jours).length > Object.keys(local.jours).length || (union.majTs ?? 0) > (local.majTs ?? 0);
}

/** Local ∪ KV (jamais sur Vercel), réécriture locale si enrichie ; version inconnue jamais écrite. */
export async function lireArchiveCq(serie: SerieCq): Promise<LectureArchiveCq> {
  const daemon = !IS_VERCEL && (await detectDaemon("kv"));
  const local = decoderArchive(lireLocal(serie), serie);
  let kv: EtatKvCq = "sans-daemon";
  let archiveKv: ArchiveCq | null = null;
  let kvVersionInconnue = false;
  if (daemon) {
    const lu = await lireKv(serie);
    kv = lu.etat;
    if (lu.etat === "presente") {
      if (lu.decodage.etat === "ok") archiveKv = lu.decodage.archive;
      if (lu.decodage.etat === "versionInconnue") kvVersionInconnue = true;
    }
  }
  const persistanceKv = kv === "sans-daemon" ? null : kv !== "erreur";
  const versionInconnue = local.etat === "versionInconnue" || kvVersionInconnue;
  const localIllisible = local.etat === "illisible";
  if (versionInconnue) return { archive: null, versionInconnue, localIllisible, kv, persistance: { local: true, kv: persistanceKv } };
  const archiveLocale = local.etat === "ok" ? local.archive : null;
  const archive = unionArchives(archiveLocale, archiveKv);
  let localOk = true;
  if (archive !== null && enrichit(archive, archiveLocale)) localOk = ecrireLocal(serie, JSON.stringify(archive));
  return { archive, versionInconnue, localIllisible, kv, persistance: { local: localOk, kv: persistanceKv } };
}

/** Jamais de `kvPut` après une lecture KV en erreur ni au-delà de 900 000 caractères. */
export async function ecrireArchiveCq(serie: SerieCq, archive: ArchiveCq, kv: EtatKvCq): Promise<PersistanceCq> {
  const texte = JSON.stringify(archive);
  const local = ecrireLocal(serie, texte);
  if (kv === "sans-daemon") return { local, kv: null };
  if (kv === "erreur" || texte.length > TAILLE_MAX_KV) return { local, kv: false };
  return { local, kv: (await kvPut(NS_KV, cleKv(serie), archive)) !== null };
}
```

- [ ] **Étape 4 : lancer le test et vérifier qu'il passe** — `pnpm --filter @axiom/web exec vitest run src/data/onchain/cryptoquant-fetch.test.ts src/data/onchain/cryptoquant.test.ts src/data/daemon.test.ts` (8 + 11 verts, daemon inchangé) puis `pnpm --filter @axiom/web typecheck`.

- [ ] **Étape 5 : commit**

```bash
git add apps/web/src/data/onchain/cryptoquant.ts apps/web/src/data/onchain/cryptoquant-fetch.test.ts
git commit -m "feat(cryptoquant): archive locale ∪ KV daemon — lecture tri-état, écriture gardée

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

### Tâche 12 : cadence et santé — file 10 req / 60 s, en-têtes, reprise 429

**Fichiers :**
- Modifier : `apps/web/src/data/onchain/cryptoquant.ts:8` (import inséré avant) et `:333` (ajout en fin de fichier → lignes 334-459)
- Modifier : `apps/web/src/data/onchain/cryptoquant-fetch.test.ts:152` (ajout en fin de fichier → lignes 153-249)
- Tester : `apps/web/src/data/onchain/cryptoquant-fetch.test.ts`

**Interfaces :**
- Consomme : `store/health.ts:99-107` — `healthStore.getState().setQuota(source, { utilise, limite, fenetre })` ; patron `acquireSlot` `data/coinalyze.ts:106-132`.
- Produit : `acquerirCreneauCq(signal: AbortSignal): Promise<boolean>` (`false` = annulée, aucun créneau), `noterReponseCq(res: Response): void`, `etatFileCq(): { enAttente: number; repriseTs: number | null }`, `abonnerFileCq(cb: () => void): () => void` (contrat) ; internes `SOURCE_SANTE = "cryptoquant"`, `repriseTs` (429), `pauseJusquaTs` (`x-ratelimit-remaining: 0`). Une demande déjà en file pendant un 429 attend puis repart dans l'ordre ; une nouvelle passe répond `quota` (tâche 13, sur le seul `repriseTs` du 429 : la pause `remaining: 0` fait attendre la file, elle ne refuse rien).
- Sémantique de `etatFileCq()` (spec §12) : `enAttente` compte **uniquement** les demandes qui attendent un créneau — décrément dès le créneau obtenu, donc ni la requête en vol, ni les consommateurs coalescés (ils n'appellent jamais `acquerirCreneauCq`, contrôle en tâche 13) ; `repriseTs` = horodatage de reprise **le plus tardif** entre la suspension 429 et la pause `x-ratelimit-remaining: 0`, `null` s'il est passé. Les abonnés sont notifiés à la pose et à la levée de chacune des deux.

- [ ] **Étape 1 : écrire le test qui échoue** — ajouter en fin de `cryptoquant-fetch.test.ts` :

```ts

// --- File 10 req / 60 s (tâche 12) ---
const vider = async () => { for (let i = 0; i < 200; i++) await Promise.resolve(); };
const avancer = async (ms: number) => { await vi.advanceTimersByTimeAsync(ms); await vider(); };

describe("CryptoQuant : file 10 req / 60 s (I6, I7)", () => {
  beforeEach(() => { reinitialiser(); vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }); vi.setSystemTime(T0); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("13 demandes : 10 créneaux immédiats, 3 après 60 s ; quota publié ; abonnés notifiés", async () => {
    const cq = await import("./cryptoquant");
    const { healthStore } = await import("../../store/health");
    const notifie = vi.fn();
    cq.abonnerFileCq(notifie);
    let acquis = 0;
    const s = new AbortController().signal;
    const toutes = Array.from({ length: 13 }, () => cq.acquerirCreneauCq(s).then((ok) => { acquis += ok ? 1 : 0; return ok; }));
    await vider();
    expect([acquis, cq.etatFileCq()]).toEqual([10, { enAttente: 3, repriseTs: null }]);
    expect(healthStore.getState().sources.cryptoquant?.quota).toEqual({ utilise: 10, limite: 10, fenetre: "1min" });
    await avancer(59_999);
    expect(acquis).toBe(10);
    await avancer(1);
    expect(await Promise.all(toutes)).toEqual(Array.from({ length: 13 }, () => true));
    expect(healthStore.getState().sources.cryptoquant?.quota?.utilise).toBe(3);
    expect(notifie).toHaveBeenCalled();
  });

  it("x-ratelimit-remaining 0 + reset 42 : la suivante part après 42 s", async () => {
    const cq = await import("./cryptoquant");
    const s = new AbortController().signal;
    await cq.acquerirCreneauCq(s);
    cq.noterReponseCq(new Response(null, { headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "42" } }));
    let ok = false;
    void cq.acquerirCreneauCq(s).then((r) => { ok = r; });
    await avancer(41_999);
    expect(ok).toBe(false);
    await avancer(1);
    expect(ok).toBe(true);
  });

  it("etatFileCq : enAttente = demandes sans créneau ; repriseTs = reprise la plus tardive (429 ou remaining 0)", async () => {
    const cq = await import("./cryptoquant");
    const notifie = vi.fn();
    cq.abonnerFileCq(notifie);
    const s = new AbortController().signal;
    expect(await cq.acquerirCreneauCq(s)).toBe(true);
    // Créneau obtenu = requête en vol : elle ne compte plus.
    expect(cq.etatFileCq()).toEqual({ enAttente: 0, repriseTs: null });
    notifie.mockClear();
    cq.noterReponseCq(new Response(null, { headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "42" } }));
    expect([cq.etatFileCq(), notifie.mock.calls.length > 0]).toEqual([{ enAttente: 0, repriseTs: T0 + 42_000 }, true]);
    cq.noterReponseCq(new Response(null, { status: 429, headers: { "x-ratelimit-reset": "5" } }));
    expect(cq.etatFileCq().repriseTs).toBe(T0 + 42_000);
    cq.noterReponseCq(new Response(null, { status: 429, headers: { "x-ratelimit-reset": "100" } }));
    expect(cq.etatFileCq().repriseTs).toBe(T0 + 100_000);
    let ok = false;
    void cq.acquerirCreneauCq(s).then((r) => { ok = r; });
    await vider();
    expect([ok, cq.etatFileCq()]).toEqual([false, { enAttente: 1, repriseTs: T0 + 100_000 }]);
    notifie.mockClear();
    await avancer(100_000);
    expect([ok, cq.etatFileCq()]).toEqual([true, { enAttente: 0, repriseTs: null }]);
    expect(notifie).toHaveBeenCalled();
  });

  it("429 : demande en file conservée puis reprise ; reset absurde 1e9 → 15 min ; bornes et repli 60 s", async () => {
    const cq = await import("./cryptoquant");
    const s = new AbortController().signal;
    cq.noterReponseCq(new Response(null, { status: 429, headers: { "x-ratelimit-reset": "1000000000" } }));
    expect(cq.etatFileCq()).toEqual({ enAttente: 0, repriseTs: T0 + 900_000 });
    let ok = false;
    void cq.acquerirCreneauCq(s).then((r) => { ok = r; });
    await avancer(899_999);
    expect([ok, cq.etatFileCq().enAttente]).toEqual([false, 1]);
    await avancer(1);
    expect([ok, cq.etatFileCq()]).toEqual([true, { enAttente: 0, repriseTs: null }]);
    for (const [entetes, delai] of [[{}, 60_000], [{ "retry-after": "5" }, 5_000], [{ "x-ratelimit-reset": "0" }, 1_000]] as const) {
      cq.noterReponseCq(new Response(null, { status: 429, headers: entetes }));
      expect(cq.etatFileCq().repriseTs).toBe(Date.now() + delai);
    }
  });

  it("annulation pendant l'attente : false, aucun créneau consommé", async () => {
    const cq = await import("./cryptoquant");
    const { healthStore } = await import("../../store/health");
    const libre = new AbortController().signal;
    for (let i = 0; i < 10; i++) await cq.acquerirCreneauCq(libre);
    const ctrl = new AbortController();
    const attente = cq.acquerirCreneauCq(ctrl.signal);
    ctrl.abort();
    expect([await attente, cq.etatFileCq().enAttente]).toEqual([false, 0]);
    await avancer(60_000);
    await cq.acquerirCreneauCq(libre);
    expect(healthStore.getState().sources.cryptoquant?.quota?.utilise).toBe(1);
  });
});
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue** — `pnpm --filter @axiom/web exec vitest run src/data/onchain/cryptoquant-fetch.test.ts` → 5 tests rouges `TypeError: cq.abonnerFileCq is not a function` / `cq.acquerirCreneauCq is not a function` / `cq.noterReponseCq is not a function` ; les 8 tests de la tâche 11 restent verts.

- [ ] **Étape 3 : implémentation minimale** — insérer avant la ligne 8 (`import { detectDaemon, kvPut, urlDaemon } from "../daemon";`) de `cryptoquant.ts` :

```ts
import { healthStore } from "../../store/health";
```

puis ajouter en fin de fichier :

```ts

// --- Cadence : file unique 10 req / 60 s ---

const SOURCE_SANTE = "cryptoquant";
/** Offre BASIC : 10 req/min (copie adaptée d'`acquireSlot`, `data/coinalyze.ts`). */
const LIMITE_MIN = 10;
const FENETRE_MS = 60_000;
const REPRISE_MIN_MS = 1_000;
const REPRISE_MAX_MS = 15 * 60_000;

const horodatages: number[] = [];
let chaine: Promise<unknown> = Promise.resolve();
let enAttente = 0;
/** 429 : les demandes en file attendent, les nouvelles répondent `quota`. */
let repriseTs: number | null = null;
/** `x-ratelimit-remaining: 0` : retarde le créneau suivant (0 = aucune pause). */
let pauseJusquaTs = 0;
const abonnes = new Set<() => void>();

function notifier(): void {
  for (const cb of abonnes) {
    try {
      cb();
    } catch {
      /* abonné défaillant ignoré */
    }
  }
}

function attendre(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const fin = () => {
      clearTimeout(minuteur);
      signal.removeEventListener("abort", fin);
      resolve();
    };
    const minuteur = setTimeout(fin, Math.max(0, ms));
    signal.addEventListener("abort", fin, { once: true });
  });
}

/** File sérialisée des 13 séries ; quota publié à chaque créneau ; annulée → `false` sans créneau. */
export function acquerirCreneauCq(signal: AbortSignal): Promise<boolean> {
  enAttente++;
  notifier();
  const tour = chaine.then(async (): Promise<boolean> => {
    try {
      for (;;) {
        if (signal.aborted) return false;
        const now = Date.now();
        if (repriseTs !== null && now >= repriseTs) {
          repriseTs = null;
          notifier();
        }
        if (pauseJusquaTs !== 0 && now >= pauseJusquaTs) {
          pauseJusquaTs = 0;
          notifier();
        }
        const pause = Math.max(repriseTs ?? 0, pauseJusquaTs);
        if (now < pause) {
          await attendre(pause - now, signal);
          continue;
        }
        while (horodatages.length > 0) {
          const plusAncien = horodatages[0];
          if (plusAncien === undefined || now - plusAncien < FENETRE_MS) break;
          horodatages.shift();
        }
        if (horodatages.length < LIMITE_MIN) {
          horodatages.push(now);
          healthStore.getState().setQuota(SOURCE_SANTE, { utilise: horodatages.length, limite: LIMITE_MIN, fenetre: "1min" });
          return true;
        }
        const plusAncien = horodatages[0];
        await attendre(plusAncien === undefined ? FENETRE_MS : FENETRE_MS - (now - plusAncien), signal);
      }
    } finally {
      enAttente--;
      notifier();
    }
  });
  chaine = tour.catch(() => undefined);
  return tour;
}

function secondesEntete(valeur: string | null): number | null {
  if (valeur === null || !/^\d+$/.test(valeur.trim())) return null;
  const s = Number(valeur.trim());
  return Number.isFinite(s) ? s : null;
}

function borner(secondes: number): number {
  return Math.min(REPRISE_MAX_MS, Math.max(REPRISE_MIN_MS, secondes * 1000));
}

/** 429 → suspension bornée [1 s, 15 min] (reset, sinon retry-after, sinon 60 s) ; remaining 0 → pause. */
export function noterReponseCq(res: Response): void {
  const now = Date.now();
  const reset = secondesEntete(res.headers.get("x-ratelimit-reset"));
  if (res.status === 429) {
    repriseTs = now + borner(reset ?? secondesEntete(res.headers.get("retry-after")) ?? 60);
    notifier();
    return;
  }
  if (res.headers.get("x-ratelimit-remaining")?.trim() === "0") {
    pauseJusquaTs = Math.max(pauseJusquaTs, now + borner(reset ?? 60));
    notifier();
  }
}

/** `enAttente` : demandes sans créneau (ni requête en vol, ni consommateur coalescé) ; `repriseTs` : reprise la plus tardive (429 ou `remaining: 0`). */
export function etatFileCq(): { enAttente: number; repriseTs: number | null } {
  const reprise = Math.max(repriseTs ?? 0, pauseJusquaTs);
  return { enAttente, repriseTs: reprise > Date.now() ? reprise : null };
}

export function abonnerFileCq(cb: () => void): () => void {
  abonnes.add(cb);
  return () => {
    abonnes.delete(cb);
  };
}
```

- [ ] **Étape 4 : lancer le test et vérifier qu'il passe** — `pnpm --filter @axiom/web exec vitest run src/data/onchain/cryptoquant-fetch.test.ts src/data/coinalyze.test.ts src/store/health.test.ts` (13 verts dans `cryptoquant-fetch.test.ts` : 8 de la tâche 11, puis I6 rafale 10 + 3 et quota publié, reset 42 s, I7 429 borné à 15 min, annulation, file de requêtes ; `coinalyze.test.ts` et `health.test.ts` inchangés et verts) puis `pnpm --filter @axiom/web typecheck`.

- [ ] **Étape 5 : commit**

```bash
git add apps/web/src/data/onchain/cryptoquant.ts apps/web/src/data/onchain/cryptoquant-fetch.test.ts
git commit -m "feat(cryptoquant): file unique 10 req/min, correction x-ratelimit et reprise 429 bornée

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

### Tâche 13 : orchestrateur `chargerSerieCq`

**Fichiers :**
- Modifier : `apps/web/src/data/onchain/cryptoquant.ts:8` (import inséré avant) et `:460` (ajout en fin de fichier → lignes 461-620)
- Modifier : `apps/web/src/data/onchain/cryptoquant-fetch.test.ts:249` (ajout en fin de fichier → lignes 250-439)
- Modifier : `apps/web/src/data/dataCockpit.ts:48` (ligne insérée après → ligne 49, libellé DATA — spec §12)
- Modifier : `apps/web/src/data/dataCockpit.test.ts:106` (test inséré après → lignes 107-112)
- Tester : `apps/web/src/data/onchain/cryptoquant-fetch.test.ts`, `apps/web/src/data/dataCockpit.test.ts`

**Interfaces :**
- Consomme : tâche 6 — `getCryptoquantKey()`, `cryptoquantKeyStore.getState().version` (mémoire des refus comparée à la version, sans abonnement), `RAISON_CLE_CRYPTOQUANT` (spec §12 : importée du store pour l'usage local et ré-exportée telle quelle, aucune copie) ; tâches 9-12 ; `store/health.ts:56-60` — `setEtat`, `marquerErreur` ; coalescence `bgeometrics.ts:275-305`, signal `bgeometrics.ts:338`, garde `typeof` `bgeometrics.ts:53-55` ; `data/dataCockpit.ts:31-55` — `LIBELLES_SOURCE` (non exporté), lu par `libelleSource` (`:58-60`) et `trierSources` (`:68`) ; module importé par la seule fenêtre DATA (`components/DataWindow.tsx:23`), elle-même paresseuse (`App.tsx:204`).
- Produit : `StatutCq`, `ChargementCq`, `chargerSerieCq(serie, signal?)` (contrat) ; ré-export `export { RAISON_CLE_CRYPTOQUANT } from "../../store/cryptoquant";` (spec §12, le contrat du client reste vrai) ; raisons exportées `RAISON_CLE_REFUSEE_CRYPTOQUANT`, `RAISON_ERREUR_CRYPTOQUANT`, `RAISON_ARCHIVE_ILLISIBLE_CRYPTOQUANT`, `RAISON_VERSION_CRYPTOQUANT`, `RAISON_ANNULE_CRYPTOQUANT`. Ordre : archive → version inconnue (`erreur`, 0 appel) → J-1 présent → clé active (`clé perso` ou `__CQ_CLE_ENV__ && !IS_VERCEL`) → refus 401/403 de session → 429 en cours → `majTs` < 6 h → créneau → fetch. Un consommateur annulé reçoit `erreur` + `RAISON_ANNULE_CRYPTOQUANT`. Libellé DATA `cryptoquant` → « CryptoQuant » (spec §12).
- Arbitrage (spec §12, consigné au rapport en tâche 20) : archive de version inconnue, locale **ou** KV → `statut "erreur"`, raison `RAISON_VERSION_CRYPTOQUANT`, **zéro appel**, rien réécrit (ni `setItem` ni `kvPut`) ; les vues (tâches 15 et 18) l'affichent en bandeau.
- Arbitrage (spec §12) : deux consommateurs coalescés d'une même série pendant la requête en vol → `etatFileCq()` vaut `{ enAttente: 0, repriseTs: null }` (contrôlé dans le test de coalescence).

- [ ] **Étape 1 : écrire le test qui échoue** — ajouter en fin de `cryptoquant-fetch.test.ts` :

```ts

// --- Orchestrateur (tâche 13) ---
const brute = (jour: string) => ({ datetime: `${jour} 00:00:00`, trade_count: 1, base_volume: 2, quote_volume: 3, base_buy_volume: 4,
  quote_buy_volume: 5, base_sell_volume: 6, quote_sell_volume: 7, vwap: 8, buy_ratio: 0.5, buy_sell_ratio: 1, buy_count: 9, sell_count: 10 });
const api200 = () => Response.json({ status: { code: 200 }, result: { data: plage(-30, -1).reverse().map(brute) } });
const statut = (status: number, message = "", headers: Record<string, string> = {}) => Response.json({ status: { code: status, message } }, { status, headers });
const appels = (f: ReturnType<typeof reseau>) => f.mock.calls.filter(([u]) => String(u).startsWith("/cqapi/"));
const SIX_H = 6 * 3600_000;
const SECRET = "CLE-TEST-SECRETE";
/** Horloge réelle pour `setTimeout` (seul `Date` est simulé ici) : laisse avancer les promesses jusqu'à la condition. */
const jusqua = async (condition: () => boolean) => {
  for (let i = 0; i < 100 && !condition(); i++) await new Promise((r) => setTimeout(r, 0));
};

describe("CryptoQuant : chargerSerieCq (I5, I7, I9, I10)", () => {
  beforeEach(() => { reinitialiser(); cle.valeur = "perso"; vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(T0); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.doUnmock("../../lib/deployment"); });

  it("J-1 archivé ou appel < 6 h → 0 appel ; ≥ 6 h → 1 appel exact, fusion écrite, santé polling", async () => {
    const cq = await import("./cryptoquant");
    const { healthStore } = await import("../../store/health");
    const f = reseau(api200);
    poser(arch(plage(-30, -1), 0));
    expect(await cq.chargerSerieCq("taker:spot:btc")).toMatchObject({ statut: "pret", raison: null, appel: false, diagnostic: { hierPresent: true } });
    poser(arch(plage(-40, -2), T0 - SIX_H + 1));
    expect(await cq.chargerSerieCq("taker:spot:btc")).toMatchObject({ statut: "pret", appel: false });
    expect(appels(f)).toHaveLength(0);
    poser(arch(plage(-40, -2), T0 - SIX_H));
    const r = await cq.chargerSerieCq("taker:spot:btc");
    expect(appels(f)).toEqual([["/cqapi/v2/market/cq/spot/trade?symbol=btc_all&window=day&limit=30",
      expect.objectContaining({ cache: "no-store", redirect: "error", headers: { accept: "application/json", Authorization: "Bearer perso" }, signal: expect.any(AbortSignal) })]]);
    expect(r).toMatchObject({ statut: "pret", appel: true, persistance: { local: true, kv: null }, diagnostic: { debut: J(-40), dernier: J(-1), manquantsFenetre: [] } });
    expect([relire()?.majTs, Object.keys(relire()?.jours ?? {}).length]).toEqual([T0, 40]);
    expect(healthStore.getState().sources.cryptoquant).toMatchObject({ etat: "polling", quota: { utilise: 1, limite: 10, fenetre: "1min" } });
  });

  it.each([
    ["réseau", () => { throw new TypeError("échec"); }],
    ["HTTP 500", () => new Response("panne", { status: 500 })],
    ["HTTP 400", () => statut(400, "Out of allowed request range")],
  ] as const)("échec %s : erreur, majTs inchangé, archive servie, santé en erreur", async (_n, api) => {
    const cq = await import("./cryptoquant");
    const { healthStore } = await import("../../store/health");
    const avant = arch(plage(-30, -2), T0 - SIX_H);
    poser(avant);
    reseau(api);
    const r = await cq.chargerSerieCq("taker:spot:btc");
    expect(r).toMatchObject({ statut: "erreur", raison: "CryptoQuant injoignable ; archive affichée.", appel: true });
    expect([r.archive, relire(), healthStore.getState().sources.cryptoquant?.etat]).toEqual([avant, avant, "error"]);
  });

  it("429 : quota, aucune écriture, série suivante en quota sans appel", async () => {
    const cq = await import("./cryptoquant");
    poser(arch(plage(-30, -2), null));
    const setItem = vi.spyOn(localStorage, "setItem");
    const f = reseau(() => statut(429, "", { "x-ratelimit-reset": "30" }));
    expect(await cq.chargerSerieCq("taker:spot:btc")).toMatchObject({ statut: "quota", raison: "Quota CryptoQuant atteint (429) ; nouvel essai dans 30 s.", appel: true });
    expect(await cq.chargerSerieCq("mineur:riot")).toMatchObject({ statut: "quota", appel: false });
    expect([appels(f).length, setItem.mock.calls.length, kvPutMock.mock.calls.length]).toEqual([1, 0, 0]);
  });

  it("403 taker mémorisé par famille, effacé par setKey ; 401 → clé refusée, mémorisé jusqu'à la rotation", async () => {
    const cq = await import("./cryptoquant");
    const { cryptoquantKeyStore } = await import("../../store/cryptoquant");
    let f = reseau((u) => (u.includes("/market/") ? statut(403, "Professional plan and above") : Response.json({ status: { code: 200 }, result: { data: [{ date: J(-1), total_rewards: 1 }] } })));
    expect(await cq.chargerSerieCq("taker:spot:btc")).toMatchObject({ statut: "offre", raison: "Offre CryptoQuant insuffisante : Professional plan and above" });
    expect(await cq.chargerSerieCq("taker:swap:eth")).toMatchObject({ statut: "offre", appel: false });
    expect(await cq.chargerSerieCq("mineur:mara")).toMatchObject({ statut: "pret", appel: true });
    cryptoquantKeyStore.getState().setKey("nouvelle");
    expect(await cq.chargerSerieCq("taker:swap:eth")).toMatchObject({ statut: "offre", appel: true });
    expect(appels(f)).toHaveLength(3);
    f = reseau(() => statut(401, "Unauthorized"));
    expect(await cq.chargerSerieCq("mineur:riot")).toMatchObject({ statut: "cle-requise", raison: "Clé CryptoQuant refusée (Réglages ⚙).", appel: true });
    expect(await cq.chargerSerieCq("mineur:wulf")).toMatchObject({ statut: "cle-requise", appel: false });
    cryptoquantKeyStore.getState().clearKey();
    expect(await cq.chargerSerieCq("mineur:wulf")).toMatchObject({ statut: "cle-requise", raison: cq.RAISON_CLE_CRYPTOQUANT, appel: false });
    cryptoquantKeyStore.getState().setKey("autre");
    await cq.chargerSerieCq("mineur:wulf");
    expect(appels(f)).toHaveLength(2);
  });

  it("coalescence : 2 consommateurs = 1 appel, aucun « en attente » ; annulation avant le créneau : 0 appel, 0 créneau", async () => {
    const cq = await import("./cryptoquant");
    const { healthStore } = await import("../../store/health");
    let repondre = (_r: Response) => {};
    let f = reseau(() => new Promise<Response>((r) => { repondre = r; }));
    const deux = Promise.all([cq.chargerSerieCq("taker:spot:btc"), cq.chargerSerieCq("taker:spot:btc")]);
    await jusqua(() => appels(f).length > 0);
    // Requête en vol + consommateur coalescé : ni l'une ni l'autre n'attend un créneau.
    expect([appels(f).length, cq.etatFileCq()]).toEqual([1, { enAttente: 0, repriseTs: null }]);
    repondre(api200());
    const [a, b] = await deux;
    expect([appels(f).length, a.statut, b.statut]).toEqual([1, "pret", "pret"]);
    healthStore.getState().retirer("cryptoquant");
    let liberer = (_v: boolean) => {};
    detecter.mockReturnValueOnce(new Promise<boolean>((r) => { liberer = r; }));
    f = reseau(api200);
    const ctrl = new AbortController();
    const annule = cq.chargerSerieCq("taker:spot:eth", ctrl.signal);
    ctrl.abort();
    expect(await annule).toMatchObject({ statut: "erreur", raison: "Chargement CryptoQuant annulé.", appel: false });
    liberer(false);
    await new Promise((r) => setTimeout(r, 0));
    expect([appels(f).length, healthStore.getState().sources.cryptoquant]).toEqual([0, undefined]);
  });

  it("KV 400 j : kvPut reçoit 401 j après l'appel ; version inconnue locale ou KV : erreur, 0 appel, rien réécrit", async () => {
    let cq = await import("./cryptoquant");
    detecter.mockResolvedValue(true);
    reseau(api200, kvOk(arch(plage(-401, -2), T0 - SIX_H)));
    expect(await cq.chargerSerieCq("taker:spot:btc")).toMatchObject({ statut: "pret", persistance: { local: true, kv: true } });
    expect(Object.keys((kvPutMock.mock.calls[0]?.[2] as ArchiveCq).jours)).toHaveLength(401);
    vi.resetModules();
    kvPutMock.mockClear();
    vi.stubGlobal("localStorage", stockage());
    localStorage.setItem(CLE_BTC, JSON.stringify({ version: 2 }));
    const setItem = vi.spyOn(localStorage, "setItem");
    cq = await import("./cryptoquant");
    const f = reseau(api200);
    expect(await cq.chargerSerieCq("taker:spot:btc")).toMatchObject({ statut: "erreur", raison: cq.RAISON_VERSION_CRYPTOQUANT, archive: null, appel: false });
    expect([appels(f).length, setItem.mock.calls.length, kvPutMock.mock.calls.length]).toEqual([0, 0, 0]);
    // Version inconnue côté KV, archive locale saine : servie vide, rien réécrit ni en local ni en KV.
    vi.resetModules();
    vi.stubGlobal("localStorage", stockage());
    poser(arch(plage(-30, -2), null));
    const setItemKv = vi.spyOn(localStorage, "setItem");
    cq = await import("./cryptoquant");
    const g = reseau(api200, kvOk({ version: 3 }));
    expect(await cq.chargerSerieCq("taker:spot:btc")).toMatchObject({ statut: "erreur", raison: cq.RAISON_VERSION_CRYPTOQUANT, archive: null, appel: false });
    expect([appels(g).length, setItemKv.mock.calls.length, kvPutMock.mock.calls.length]).toEqual([0, 0, 0]);
    expect(relire()?.jours).toEqual(arch(plage(-30, -2), null).jours);
  });

  it("I9 — Vercel sans clé perso (drapeau env vrai) : 0 fetch, 0 créneau, aucun accès KV, archive servie", async () => {
    cle.valeur = null;
    vi.stubGlobal("__CQ_CLE_ENV__", true);
    vi.doMock("../../lib/deployment", () => ({ IS_VERCEL: true }));
    const cq = await import("./cryptoquant");
    const { healthStore } = await import("../../store/health");
    detecter.mockResolvedValue(true);
    poser(arch(plage(-30, -2), null));
    const f = reseau(aucun);
    const r = await cq.chargerSerieCq("taker:spot:btc");
    expect(r).toMatchObject({ statut: "cle-requise", raison: "Clé CryptoQuant personnelle requise (Réglages ⚙).", appel: false });
    expect([Object.keys(r.archive?.jours ?? {}).length, f.mock.calls.length, detecter.mock.calls.length]).toEqual([29, 0, 0]);
    expect(healthStore.getState().sources.cryptoquant).toBeUndefined();
  });

  it("I10 — local sans clé : 0 fetch sans drapeau ; drapeau vrai → fetch SANS Authorization", async () => {
    cle.valeur = null;
    let cq = await import("./cryptoquant");
    let f = reseau(aucun);
    expect(await cq.chargerSerieCq("taker:spot:btc")).toMatchObject({ statut: "cle-requise", archive: null });
    expect(f).not.toHaveBeenCalled();
    vi.resetModules();
    vi.stubGlobal("__CQ_CLE_ENV__", true);
    cq = await import("./cryptoquant");
    f = reseau(api200);
    expect((await cq.chargerSerieCq("taker:spot:btc")).statut).toBe("pret");
    expect(appels(f)[0]?.[1]?.headers).toEqual({ accept: "application/json" });
  });
});

describe("CryptoQuant : la clé n'apparaît nulle part (I8)", () => {
  beforeEach(() => { reinitialiser(); cle.valeur = SECRET; vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(T0); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("ni URL, ni raison, ni stockage, ni KV, ni console, ni santé", async () => {
    const cq = await import("./cryptoquant");
    const { healthStore } = await import("../../store/health");
    const consoles = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const setItem = vi.spyOn(localStorage, "setItem");
    detecter.mockResolvedValue(true);
    const f = reseau((u) => {
      if (u.includes("btc_all")) return api200();
      if (u.includes("eth_all")) return statut(403, `Invalid key ${SECRET}`);
      if (u.includes("mara")) return new Response(`erreur ${SECRET}`, { status: 500 });
      if (u.includes("riot")) throw new TypeError(`échec ${SECRET}`);
      return statut(429, SECRET, { "retry-after": "5" });
    });
    const res: Awaited<ReturnType<typeof cq.chargerSerieCq>>[] = [];
    for (const s of ["taker:spot:btc", "taker:spot:eth", "mineur:mara", "mineur:riot", "mineur:wulf"] as const) res.push(await cq.chargerSerieCq(s));
    expect(res.map((r) => r.statut)).toEqual(["pret", "offre", "erreur", "erreur", "quota"]);
    expect(appels(f)[0]?.[1]?.headers).toMatchObject({ Authorization: `Bearer ${SECRET}` });
    expect(kvPutMock).toHaveBeenCalled();
    const traces = [...f.mock.calls.map(([u]) => String(u)), ...res, ...setItem.mock.calls, ...kvPutMock.mock.calls,
      ...consoles.flatMap((s) => s.mock.calls), healthStore.getState().sources, cq.etatFileCq()].map((t) => JSON.stringify(t));
    expect(traces.filter((t) => t.includes(SECRET))).toEqual([]);
  });
});
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue** — `pnpm --filter @axiom/web exec vitest run src/data/onchain/cryptoquant-fetch.test.ts` → 11 tests rouges `TypeError: cq.chargerSerieCq is not a function` ; les 13 tests des tâches 11 et 12 restent verts.

- [ ] **Étape 3 : implémentation minimale** — insérer avant la ligne 8 (`import { healthStore } from "../../store/health";`) de `cryptoquant.ts` (import pour l'usage local de `RAISON_CLE_CRYPTOQUANT` : la ligne de ré-export `export { RAISON_CLE_CRYPTOQUANT } from "../../store/cryptoquant";` ne crée aucune liaison locale) :

```ts
import { RAISON_CLE_CRYPTOQUANT, cryptoquantKeyStore, getCryptoquantKey } from "../../store/cryptoquant";
```

puis ajouter en fin de fichier (aucun `console.*`, aucun `e.message` repris) :

```ts

// --- Orchestrateur ---

/** PRÉSENCE d'une clé `.env` côté proxy (define Vite, jamais la valeur). */
declare const __CQ_CLE_ENV__: boolean;
const CQ_CLE_ENV_PRESENTE: boolean = typeof __CQ_CLE_ENV__ !== "undefined" ? __CQ_CLE_ENV__ : false;

/** Reprise après un appel réussi sans J-1. */
const REPRISE_MS = 6 * 3600_000;
const TIMEOUT_MS = 15_000;

/** Définie dans le store (module déjà partagé par Réglages, DES et CHAIN), jamais recopiée ici. */
export { RAISON_CLE_CRYPTOQUANT } from "../../store/cryptoquant";
export const RAISON_CLE_REFUSEE_CRYPTOQUANT = "Clé CryptoQuant refusée (Réglages ⚙).";
export const RAISON_ERREUR_CRYPTOQUANT = "CryptoQuant injoignable ; archive affichée.";
export const RAISON_ARCHIVE_ILLISIBLE_CRYPTOQUANT = "Archive locale CryptoQuant illisible : remplacée à la prochaine écriture.";
export const RAISON_VERSION_CRYPTOQUANT = "Archive CryptoQuant écrite par une version plus récente d'AXIOM : ni lue ni réécrite.";
export const RAISON_ANNULE_CRYPTOQUANT = "Chargement CryptoQuant annulé.";
const RAISON_OFFRE_DEFAUT = "Offre CryptoQuant insuffisante pour cette série (403).";

function raisonQuota(restantMs: number): string {
  return `Quota CryptoQuant atteint (429) ; nouvel essai dans ${Math.max(1, Math.ceil(restantMs / 1000))} s.`;
}

export type StatutCq = "pret" | "cle-requise" | "quota" | "offre" | "erreur";
export interface ChargementCq { serie: SerieCq; statut: StatutCq; raison: string | null; archive: ArchiveCq | null; diagnostic: DiagnosticCq; persistance: PersistanceCq; appel: boolean }

/** Refus mémorisés en session pour la `version` de clé qui les a produits. */
type FamilleCq = "taker" | "mineurs";
const refusOffre = new Map<FamilleCq, { version: number; raison: string }>();
let refusCle: { version: number; raison: string } | null = null;

function familleSerie(serie: SerieCq): FamilleCq {
  return estSerieMineur(serie) ? "mineurs" : "taker";
}

function versionCle(): number {
  return cryptoquantKeyStore.getState().version;
}

/** `status.message` amont (403), borné, jamais s'il contient la clé. */
async function raisonOffre(res: Response, cle: string | null): Promise<string> {
  try {
    const corps = (await res.json()) as unknown;
    const status = estObjet(corps) ? corps["status"] : null;
    const message = estObjet(status) && typeof status["message"] === "string" ? status["message"].trim().slice(0, 200) : "";
    if (message === "" || (cle !== null && message.includes(cle))) return RAISON_OFFRE_DEFAUT;
    return `Offre CryptoQuant insuffisante : ${message}`;
  } catch {
    return RAISON_OFFRE_DEFAUT;
  }
}

function chargementAnnule(serie: SerieCq): ChargementCq {
  return { serie, statut: "erreur", raison: RAISON_ANNULE_CRYPTOQUANT, archive: null, diagnostic: diagnostiquer(null, jourUtc(Date.now())), persistance: { local: true, kv: null }, appel: false };
}

/** Ordre §4.3 ; l'archive existante est toujours renvoyée. */
async function chargerUneFois(serie: SerieCq, signal: AbortSignal): Promise<ChargementCq> {
  const aujourdhui = jourUtc(Date.now());
  const lecture = await lireArchiveCq(serie);
  let archive = lecture.archive;
  let persistance = lecture.persistance;
  const fin = (statut: StatutCq, raison: string | null, appel: boolean): ChargementCq =>
    ({ serie, statut, raison, archive, diagnostic: diagnostiquer(archive, aujourdhui), persistance, appel });
  const raisonLecture = lecture.localIllisible ? RAISON_ARCHIVE_ILLISIBLE_CRYPTOQUANT : null;

  if (lecture.versionInconnue) return fin("erreur", RAISON_VERSION_CRYPTOQUANT, false);
  if (diagnostiquer(archive, aujourdhui).hierPresent) return fin("pret", raisonLecture, false);
  const cle = getCryptoquantKey();
  if (cle === null && !(CQ_CLE_ENV_PRESENTE && !IS_VERCEL)) return fin("cle-requise", RAISON_CLE_CRYPTOQUANT, false);
  const version = versionCle();
  if (refusCle !== null && refusCle.version === version) return fin("cle-requise", refusCle.raison, false);
  const offre = refusOffre.get(familleSerie(serie));
  if (offre !== undefined && offre.version === version) return fin("offre", offre.raison, false);
  const now = Date.now();
  if (repriseTs !== null && now < repriseTs) return fin("quota", raisonQuota(repriseTs - now), false);
  if (archive !== null && archive.majTs !== null && now - archive.majTs < REPRISE_MS) return fin("pret", raisonLecture, false);
  if (!(await acquerirCreneauCq(signal))) return fin("erreur", RAISON_ANNULE_CRYPTOQUANT, false);

  // Clé personnelle seulement ; sans elle, le proxy Vite/daemon injecte le repli `.env`.
  const headers: Record<string, string> = { accept: "application/json" };
  if (cle !== null) headers["Authorization"] = `Bearer ${cle}`;
  try {
    const res = await fetch(cheminSerie(serie), {
      headers,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
    });
    noterReponseCq(res);
    if (res.status === 401) {
      const raison = cle !== null ? RAISON_CLE_REFUSEE_CRYPTOQUANT : RAISON_CLE_CRYPTOQUANT;
      if (versionCle() === version) refusCle = { version, raison };
      return fin("cle-requise", raison, true);
    }
    if (res.status === 403) {
      const raison = await raisonOffre(res, cle);
      if (versionCle() === version) refusOffre.set(familleSerie(serie), { version, raison });
      return fin("offre", raison, true);
    }
    if (res.status === 429) return fin("quota", raisonQuota((repriseTs ?? Date.now()) - Date.now()), true);
    if (res.status !== 200) {
      healthStore.getState().marquerErreur(SOURCE_SANTE, `CryptoQuant HTTP ${res.status}`);
      return fin("erreur", RAISON_ERREUR_CRYPTOQUANT, true);
    }
    const lignes = parserLignes(serie, (await res.json()) as unknown, aujourdhui);
    if (lignes.length === 0) {
      healthStore.getState().marquerErreur(SOURCE_SANTE, "CryptoQuant : réponse vide ou invalide");
      return fin("erreur", RAISON_ERREUR_CRYPTOQUANT, true);
    }
    archive = fusionner(archive, serie, lignes, Date.now());
    persistance = await ecrireArchiveCq(serie, archive, lecture.kv);
    healthStore.getState().setEtat(SOURCE_SANTE, "polling", { dernierMessageTs: Date.now() });
    return fin("pret", raisonLecture, true);
  } catch {
    if (signal.aborted) return fin("erreur", RAISON_ANNULE_CRYPTOQUANT, true);
    // Message fixe : jamais `e.message`.
    healthStore.getState().marquerErreur(SOURCE_SANTE, "CryptoQuant injoignable");
    return fin("erreur", RAISON_ERREUR_CRYPTOQUANT, true);
  }
}

interface TravailCq { promesse: Promise<ChargementCq>; controleur: AbortController; consommateurs: number }
const travaux = new Map<SerieCq, TravailCq>();

/** Coalescence par série ; le départ du dernier consommateur annule la passe. */
export function chargerSerieCq(serie: SerieCq, signal?: AbortSignal): Promise<ChargementCq> {
  if (signal?.aborted) return Promise.resolve(chargementAnnule(serie));
  let travail = travaux.get(serie);
  if (travail === undefined || travail.controleur.signal.aborted) {
    const controleur = new AbortController();
    const nouveau: TravailCq = {
      controleur,
      consommateurs: 0,
      promesse: chargerUneFois(serie, controleur.signal).catch((): ChargementCq => ({ ...chargementAnnule(serie), raison: RAISON_ERREUR_CRYPTOQUANT })),
    };
    travaux.set(serie, nouveau);
    void nouveau.promesse.then(() => {
      if (travaux.get(serie) === nouveau) travaux.delete(serie);
    });
    travail = nouveau;
  }
  const courant = travail;
  courant.consommateurs++;
  return new Promise((resolve) => {
    let termine = false;
    const finir = (r: ChargementCq) => {
      if (termine) return;
      termine = true;
      signal?.removeEventListener("abort", annuler);
      courant.consommateurs--;
      if (courant.consommateurs === 0) courant.controleur.abort();
      resolve(r);
    };
    const annuler = () => finir(chargementAnnule(serie));
    signal?.addEventListener("abort", annuler, { once: true });
    void courant.promesse.then(finir);
  });
}
```

- [ ] **Étape 4 : lancer le test et vérifier qu'il passe** — `pnpm --filter @axiom/web exec vitest run src/data/onchain/` (35 tests CryptoQuant verts : 11 dans `cryptoquant.test.ts`, 24 dans `cryptoquant-fetch.test.ts` dont I5, I7, I8, I9, I10, version inconnue et file de requêtes ; voisins `bgeometrics-fetch`, `historiques-fetch` verts), puis `pnpm --filter @axiom/web typecheck`. Contrôles : `rg -n 'from "[^"]*onchain/cryptoquant"' apps/web/src` ne renvoie rien ; `rg -n 'const RAISON_CLE_CRYPTOQUANT' apps/web/src` ne renvoie qu'une ligne, la définition de `apps/web/src/store/cryptoquant.ts` (spec §12 : aucune copie dans le client).

- [ ] **Étape 5 : écrire le test qui échoue (libellé DATA, spec §12)** — dans `apps/web/src/data/dataCockpit.test.ts`, insérer après la ligne 106 (fin du premier `it` du bloc `describe("libelleSource")`, patron des lignes 101-106) :

```ts

  it("nomme CryptoQuant (client à la demande : santé polling/erreur, quota 10/1min)", () => {
    expect(libelleSource("cryptoquant")).toBe("CryptoQuant");
    const [row] = trierSources({ cq: { source: "cryptoquant", etat: "polling", dernierMessageTs: 1_000, quota: { utilise: 4, limite: 10, fenetre: "1min" } } }, 2_000);
    expect([row?.libelle, row?.quota]).toEqual(["CryptoQuant", { utilise: 4, limite: 10, fenetre: "1min" }]);
  });
```

- [ ] **Étape 6 : lancer le test et vérifier qu'il échoue** — `pnpm --filter @axiom/web exec vitest run src/data/dataCockpit.test.ts` → 1 test rouge `AssertionError: expected 'cryptoquant' to be 'CryptoQuant'` (repli actuel sur `sourceLabel`, qui ne connaît pas la source) ; les 11 autres restent verts.

- [ ] **Étape 7 : implémentation minimale** — dans `apps/web/src/data/dataCockpit.ts`, insérer après la ligne 48 (`  coinmetrics: "Coin Metrics",`) de `LIBELLES_SOURCE` :

```ts
  cryptoquant: "CryptoQuant",
```

Aucune entrée dans `SOURCE_NAMES` de `components/HealthPanel.tsx` (bundle initial, spec §4.5) : `dataCockpit.ts` n'est chargé que par la fenêtre DATA, paresseuse.

- [ ] **Étape 8 : lancer les tests et vérifier qu'ils passent** — `pnpm --filter @axiom/web exec vitest run src/data/dataCockpit.test.ts` (12 verts), puis `pnpm --filter @axiom/web typecheck` et `pnpm --filter @axiom/web test` (suite web complète verte).

- [ ] **Étape 9 : commit**

```bash
git add apps/web/src/data/onchain/cryptoquant.ts apps/web/src/data/onchain/cryptoquant-fetch.test.ts apps/web/src/data/dataCockpit.ts apps/web/src/data/dataCockpit.test.ts
git commit -m "feat(cryptoquant): orchestrateur — court-circuit J-1, reprise 6 h, refus de session, non-fuite de la clé, libellé DATA

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Zone E — Section DES « Flux takers toutes places », budget, e2e et point de revue B1 (tâches 14 à 17)

> **Prérequis** : tâches 1 à 13 terminées et vertes :
> - module partagé et trois proxys `/cqapi` ;
> - store `apps/web/src/store/cryptoquant.ts`, qui exporte aussi `RAISON_CLE_CRYPTOQUANT` et `messageSansCleCq(vercel: boolean)` (tâche 6) ;
> - client `apps/web/src/data/onchain/cryptoquant.ts`, sans `situer` (tâche 10) ;
> - rapport `docs/superpowers/progress/2026-09-16-cryptoquant.md` ouvert en B1-0. Il contient déjà les sections `### Budget avant B1` (tâche 1) et `### Budget après B1-3` (tâche 8). Chacune suit le format unique du rapport : une ligne « Commande : » puis le bloc ```json complet imprimé par `scripts/verifier-budget-build.mjs`.
>
> **Commandes** : toutes se lancent depuis la racine du dépôt. `pnpm --filter @axiom/web exec` s'exécute
> dans `apps/web`, donc les chemins `src/` et `e2e/` qui suivent sont relatifs à `apps/web`. Toute commande qui
> passe par `| tee` est précédée de `set -o pipefail;`, pour qu'un échec en amont ne soit pas masqué.
>
> **Règle de la zone** : aucun fichier de `apps/web/src/components/` n'importe une **valeur** de
> `data/onchain/cryptoquant`, seulement des types (`import type`). Le client se charge par
> `await import("../data/onchain/cryptoquant")`. Un import de valeur ferait entrer le client dans un chunk
> partagé préchargé par l'entrée (patron déjà mesuré : `OiPerpsDexSection.tsx:15-17`). Les valeurs utiles à
> l'affichage viennent donc d'ailleurs :
> - le classement `situer` vit dans `fluxTakers.util.ts` (tâche 14), et plus dans le client ;
> - `RAISON_CLE_CRYPTOQUANT` et `messageSansCleCq` viennent du store `store/cryptoquant.ts`. Ce module est déjà partagé par Réglages, DES, CHAIN et le client : aucun chunk supplémentaire.
>
> La tâche 16 vérifie cette règle.

### Tâche 14 : modèle pur `fluxTakers.util.ts`

**Fichiers :**
- Créer : `apps/web/src/components/fluxTakers.util.ts`
- Créer : `apps/web/src/components/fluxTakers.util.test.ts`
- Tester : `apps/web/src/components/fluxTakers.util.test.ts`

**Interfaces :**
- Consomme : de `apps/web/src/data/onchain/cryptoquant.ts` (tâches 9-13), des **types seulement**, dans le module comme dans le test : `ArchiveCq`, `LigneCq`, `LigneTaker`, `SerieCq`.
- Produit :
  - Définitions du contrat : `type ActifTaker = "btc" | "eth"`, `type MarcheTaker = "spot" | "swap"`, `interface SelectionTaker { actif: ActifTaker; marche: MarcheTaker }`, `serieTaker(sel: SelectionTaker): SerieCq`, `interface ModeleFluxTakers` (champs exacts du contrat) et `construireModeleFluxTakers(archive: ArchiveCq | null, aujourdhuiUtc: string): ModeleFluxTakers`.
  - `situer(valeurs: readonly number[], v: number): { min: number; mediane: number; max: number; rang: number; n: number } | null`, exporté **ici** : il est retiré du client, ses tests aussi.
    - Seules les valeurs finies comptent.
    - `null` s'il reste moins de deux valeurs, ou si `v` n'est pas fini.
    - Rang 1 = plus bas. En cas d'ex æquo, rang = 1 + nombre de valeurs strictement inférieures.
    - Médiane paire = moyenne des deux valeurs centrales.
- Règles tranchées (documentées dans le module) :
  - **Jour affiché** : dernier jour clos de l'archive (antérieur à aujourd'hui UTC), soit J-1 quand il est publié.
  - **Lectures sans recalcul** : `ratio` = `bsr`, `partAcheteursPct` = `br × 100`, `volumeQuote` = `qv`, `volumeBase` = `bv`, `trades` = `n`, `vwap` = `vwap`.
  - **Δ taker** : `deltaQuote` = `qbv − qsv`.
  - **Situation** : `situer` appliqué au `bsr` du jour, parmi tous les `bsr` archivés.
  - **Cumul 7 j** : somme des `qbv − qsv` sur les 7 jours calendaires qui finissent au jour affiché. La `valeur` n'existe que si les 7 jours sont présents.
  - **Écart à la médiane** : `vsMediane30Pct` = `(qv / médiane des qv des 30 derniers jours présents − 1) × 100`, jour affiché inclus.
  - **Courbe** : chaque jour calendaire, du premier jour archivé au jour affiché, avec `valeur: null` aux jours absents.

- [ ] **Étape 1 : écrire le test qui échoue** — créer `apps/web/src/components/fluxTakers.util.test.ts` :

```ts
/**
 * Tests du modèle PUR de la section DES « Flux takers toutes places » : jour affiché,
 * lectures fournisseur non recalculées, Δ taker, cumul 7 j complet ou absent, situation dans
 * l'archive (`situer`, qui vit ici et non dans le client CryptoQuant), écart à la médiane de
 * volume et courbe à dates réelles.
 */
import { describe, expect, it } from "vitest";
import type { ArchiveCq, LigneTaker } from "../data/onchain/cryptoquant";
import { construireModeleFluxTakers, serieTaker, situer } from "./fluxTakers.util";

const JOUR_MS = 86_400_000;
const AUJOURDHUI = "2026-09-16";
const jourIso = (t: number) => new Date(t).toISOString().slice(0, 10);

function ligne(p: Partial<LigneTaker> = {}): LigneTaker {
  return {
    n: 1_000_000,
    bv: 150_000,
    qv: 11_500_000_000,
    bbv: 75_000,
    qbv: 6_000_000_000,
    bsv: 75_000,
    qsv: 6_050_000_000,
    vwap: 76_000,
    br: 0.5,
    bsr: 1,
    bc: 500_000,
    sc: 500_000,
    ...p,
  };
}

/** Archive spot BTC couvrant [debut, fin] (inclus), jours `exclus` retirés, lignes surchargées. */
function archive(
  debut: string,
  fin: string,
  exclus: readonly string[] = [],
  surcharges: Record<string, Partial<LigneTaker>> = {},
): ArchiveCq {
  const jours: Record<string, LigneTaker> = {};
  for (let t = Date.parse(`${debut}T00:00:00Z`); t <= Date.parse(`${fin}T00:00:00Z`); t += JOUR_MS) {
    const j = jourIso(t);
    if (!exclus.includes(j)) jours[j] = ligne(surcharges[j]);
  }
  return { version: 1, serie: "taker:spot:btc", majTs: Date.UTC(2026, 8, 16, 6), jours };
}

/** Ligne réelle du sondage (spot BTC, 2026-09-15). */
const DERNIER: Partial<LigneTaker> = {
  n: 12_099_486,
  bv: 156_928.13,
  qv: 12_007_360_401.32,
  bbv: 77_681.2,
  qbv: 5_944_281_632.44,
  bsv: 79_246.93,
  qsv: 6_063_078_768.88,
  vwap: 76_515.03,
  br: 0.495,
  bsr: 0.9802,
  bc: 6_133_017,
  sc: 5_966_469,
};

/** 2026-08-17 → 2026-09-15 sans le 1er et le 2 septembre : 28 jours. */
const NOMINALE = archive("2026-08-17", "2026-09-15", ["2026-09-01", "2026-09-02"], {
  "2026-08-20": { bsr: 0.91 },
  "2026-08-25": { bsr: 0.95 },
  "2026-08-30": { bsr: 0.97 },
  "2026-09-05": { bsr: 1.07 },
  "2026-09-15": DERNIER,
});

describe("serieTaker", () => {
  it("compose la série du catalogue CryptoQuant (marché puis actif)", () => {
    expect(serieTaker({ actif: "btc", marche: "spot" })).toBe("taker:spot:btc");
    expect(serieTaker({ actif: "eth", marche: "spot" })).toBe("taker:spot:eth");
    expect(serieTaker({ actif: "btc", marche: "swap" })).toBe("taker:swap:btc");
    expect(serieTaker({ actif: "eth", marche: "swap" })).toBe("taker:swap:eth");
  });
});

describe("situer", () => {
  it("min, médiane, max, rang (1 = plus bas), N ; null si N < 2 ou valeur non finie", () => {
    expect(situer([1.07, 0.91, 0.99, 0.98], 0.98)).toMatchObject({ min: 0.91, max: 1.07, rang: 2, n: 4 });
    expect(situer([1.07, 0.91, 0.99, 0.98], 0.98)?.mediane).toBeCloseTo(0.985, 10);
    expect(situer([3, 1, 2], 1)).toEqual({ min: 1, mediane: 2, max: 3, rang: 1, n: 3 });
    expect([situer([1], 1), situer([1, Number.NaN], 1), situer([1, 2], Number.NaN)]).toEqual([null, null, null]);
  });

  it("ex æquo : rang = 1 + nombre de valeurs strictement inférieures", () => {
    expect(situer([1, 1], 1)).toEqual({ min: 1, mediane: 1, max: 1, rang: 1, n: 2 });
    expect(situer([0.9, 1, 1, 1.1], 1)).toEqual({ min: 0.9, mediane: 1, max: 1.1, rang: 2, n: 4 });
    expect(situer([2, 1, 1, 1], 2)?.rang).toBe(4);
  });
});

describe("construireModeleFluxTakers", () => {
  it("lit le dernier jour clos tel que publié (aucun recalcul du ratio ni du VWAP)", () => {
    const m = construireModeleFluxTakers(NOMINALE, AUJOURDHUI);
    expect(m.jour).toBe("2026-09-15");
    expect(m.ratio).toBe(0.9802);
    expect(m.partAcheteursPct).toBeCloseTo(49.5, 10);
    expect(m.deltaQuote).toBeCloseTo(5_944_281_632.44 - 6_063_078_768.88, 2);
    expect(m.volumeQuote).toBe(12_007_360_401.32);
    expect(m.volumeBase).toBe(156_928.13);
    expect(m.trades).toBe(12_099_486);
    expect(m.vwap).toBe(76_515.03);
  });

  it("ignore un jour du jour UTC en cours ou futur", () => {
    const avecAujourdhui: ArchiveCq = {
      ...NOMINALE,
      jours: { ...NOMINALE.jours, "2026-09-16": ligne({ bsr: 2 }), "2026-09-17": ligne({ bsr: 3 }) },
    };
    const m = construireModeleFluxTakers(avecAujourdhui, AUJOURDHUI);
    expect(m.jour).toBe("2026-09-15");
    expect(m.ratio).toBe(0.9802);
    expect(m.situation?.n).toBe(28);
  });

  it("situe le ratio sur les N jours archivés (min, médiane, max, rang 1 = plus bas)", () => {
    const m = construireModeleFluxTakers(NOMINALE, AUJOURDHUI);
    expect(m.situation).toEqual({ min: 0.91, mediane: 1, max: 1.07, rang: 4, n: 28 });
  });

  it("cumul 7 j : somme des Δ quote quand les sept jours calendaires sont présents", () => {
    const m = construireModeleFluxTakers(NOMINALE, AUJOURDHUI);
    // Six jours à −50 M$ (6,00 G$ − 6,05 G$) et le dernier à −118,80 M$.
    expect(m.cumul7.presents).toBe(7);
    expect(m.cumul7.valeur).toBeCloseTo(6 * -50_000_000 + (5_944_281_632.44 - 6_063_078_768.88), 1);
  });

  it("cumul 7 j : aucune valeur quand un jour manque, seulement le nombre de présents", () => {
    // Jour affiché 2026-09-05 : la fenêtre 30/08 → 05/09 perd le 1er et le 2 septembre.
    const tronquee = archive("2026-08-17", "2026-09-05", ["2026-09-01", "2026-09-02"]);
    const m = construireModeleFluxTakers(tronquee, AUJOURDHUI);
    expect(m.jour).toBe("2026-09-05");
    expect(m.cumul7).toEqual({ valeur: null, presents: 5 });
  });

  it("écart du volume quote à la médiane des 30 derniers jours présents", () => {
    const m = construireModeleFluxTakers(NOMINALE, AUJOURDHUI);
    // Médiane = 11,5 G$ (27 jours sur 28) → 12,007 / 11,5 − 1 = +4,41 %.
    expect(m.vsMediane30Pct).toBeCloseTo(4.4118, 3);
    // Quarante jours dont dix anciens énormes : seuls les 30 plus récents comptent.
    const anciens = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [jourIso(Date.UTC(2026, 7, 7) + i * JOUR_MS), { qv: 99_000_000_000 }]),
    );
    const longue = archive("2026-08-07", "2026-09-15", [], { ...anciens, "2026-09-15": { qv: 12_650_000_000 } });
    expect(construireModeleFluxTakers(longue, AUJOURDHUI).vsMediane30Pct).toBeCloseTo(10, 6);
  });

  it("courbe : chaque jour calendaire de l'archive, null aux jours absents", () => {
    const m = construireModeleFluxTakers(NOMINALE, AUJOURDHUI);
    expect(m.courbe).toHaveLength(30);
    expect(m.courbe[0]).toEqual({ jour: "2026-08-17", valeur: 1 });
    expect(m.courbe.find((p) => p.jour === "2026-09-01")).toEqual({ jour: "2026-09-01", valeur: null });
    expect(m.courbe.find((p) => p.jour === "2026-09-02")).toEqual({ jour: "2026-09-02", valeur: null });
    expect(m.courbe.at(-1)).toEqual({ jour: "2026-09-15", valeur: 0.9802 });
  });

  it("un seul jour : ni situation, ni cumul, ni médiane — jamais 0 à la place", () => {
    const seul = archive("2026-09-15", "2026-09-15", [], { "2026-09-15": DERNIER });
    const m = construireModeleFluxTakers(seul, AUJOURDHUI);
    expect(m.situation).toBeNull();
    expect(m.cumul7).toEqual({ valeur: null, presents: 1 });
    expect(m.vsMediane30Pct).toBeNull();
    expect(m.courbe).toEqual([{ jour: "2026-09-15", valeur: 0.9802 }]);
  });

  it("archive absente ou sans jour clos : modèle vide, aucune valeur inventée", () => {
    const vide = {
      jour: null,
      ratio: null,
      partAcheteursPct: null,
      situation: null,
      deltaQuote: null,
      cumul7: { valeur: null, presents: 0 },
      volumeQuote: null,
      volumeBase: null,
      trades: null,
      vwap: null,
      vsMediane30Pct: null,
      courbe: [],
    };
    expect(construireModeleFluxTakers(null, AUJOURDHUI)).toEqual(vide);
    expect(construireModeleFluxTakers(archive("2026-09-16", "2026-09-17"), AUJOURDHUI)).toEqual(vide);
  });
});
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue**

```bash
pnpm --filter @axiom/web exec vitest run src/components/fluxTakers.util.test.ts
```

Attendu :
- `FAIL src/components/fluxTakers.util.test.ts` ;
- l'erreur de résolution `Error: Cannot find module './fluxTakers.util'`, suivie du chemin absolu du fichier de test ;
- puis `Tests  no tests`.

- [ ] **Étape 3 : implémentation minimale** — créer `apps/web/src/components/fluxTakers.util.ts` :

```ts
/**
 * Modèle d'affichage PUR de la section DES « Flux takers toutes places » (CryptoQuant).
 *
 * L'agrégat du fournisseur est consommé tel quel : ratio achat/vente, part acheteurs, volumes
 * et VWAP sont lus sans recalcul. Seuls des dérivés d'AFFICHAGE sont produits ici : Δ taker
 * en quote, cumul 7 j, situation du ratio dans l'archive (`situer`), écart du volume à sa
 * médiane et points de courbe à dates réelles.
 *
 * Ce module n'importe que des TYPES du client CryptoQuant : une valeur importée ici ferait
 * entrer le client dans le chunk de DES et casserait son chargement à la demande (garde-fou
 * `src/chunkCryptoquant.test.ts`). `situer`, qui ne sert qu'à l'affichage, vit donc ici et
 * non dans le client.
 */
import type { ArchiveCq, LigneCq, LigneTaker, SerieCq } from "../data/onchain/cryptoquant";

export type ActifTaker = "btc" | "eth";
export type MarcheTaker = "spot" | "swap";

export interface SelectionTaker {
  actif: ActifTaker;
  marche: MarcheTaker;
}

export interface ModeleFluxTakers {
  /** Jour affiché : dernier jour clos archivé (J-1 quand il est publié), sinon null. */
  jour: string | null;
  ratio: number | null;
  partAcheteursPct: number | null;
  situation: { min: number; mediane: number; max: number; rang: number; n: number } | null;
  deltaQuote: number | null;
  cumul7: { valeur: number | null; presents: number };
  volumeQuote: number | null;
  volumeBase: number | null;
  trades: number | null;
  vwap: number | null;
  vsMediane30Pct: number | null;
  courbe: Array<{ jour: string; valeur: number | null }>;
}

const JOUR_MS = 86_400_000;
/** Cumul du Δ taker : 7 jours CALENDAIRES se terminant au jour affiché, tous requis. */
const JOURS_CUMUL = 7;
/** Médiane de volume : 30 derniers jours PRÉSENTS, jour affiché inclus. */
const JOURS_MEDIANE = 30;

/** Série CryptoQuant de la sélection (marché puis actif, comme le catalogue du client). */
export function serieTaker(sel: SelectionTaker): SerieCq {
  return `taker:${sel.marche}:${sel.actif}` as const;
}

function estTaker(ligne: LigneCq): ligne is LigneTaker {
  return "bsr" in ligne;
}

function fini(v: number): number | null {
  return Number.isFinite(v) ? v : null;
}

/** Jour UTC « YYYY-MM-DD » décalé de `n` jours (négatif = passé). */
function decalerJour(jour: string, n: number): string {
  return new Date(Date.parse(`${jour}T00:00:00Z`) + n * JOUR_MS).toISOString().slice(0, 10);
}

/** Médiane d'une liste NON vide déjà triée par ordre croissant (paire : moyenne des centrales). */
function medianeTriee(tries: readonly number[]): number {
  const milieu = Math.floor(tries.length / 2);
  return tries.length % 2 === 1 ? tries[milieu]! : (tries[milieu - 1]! + tries[milieu]!) / 2;
}

/**
 * Situe `v` parmi `valeurs` : min · médiane · max · rang (1 = plus bas) · N, sur les seules
 * valeurs finies. Ex æquo : rang = 1 + nombre de valeurs STRICTEMENT inférieures. `null` sous
 * deux valeurs ou si `v` n'est pas fini : jamais un percentile sur trop peu de points.
 */
export function situer(
  valeurs: readonly number[],
  v: number,
): { min: number; mediane: number; max: number; rang: number; n: number } | null {
  const tries = valeurs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const min = tries[0];
  const max = tries[tries.length - 1];
  if (tries.length < 2 || !Number.isFinite(v) || min === undefined || max === undefined) return null;
  return {
    min,
    mediane: medianeTriee(tries),
    max,
    rang: 1 + tries.filter((x) => x < v).length,
    n: tries.length,
  };
}

function modeleVide(): ModeleFluxTakers {
  return {
    jour: null,
    ratio: null,
    partAcheteursPct: null,
    situation: null,
    deltaQuote: null,
    cumul7: { valeur: null, presents: 0 },
    volumeQuote: null,
    volumeBase: null,
    trades: null,
    vwap: null,
    vsMediane30Pct: null,
    courbe: [],
  };
}

/** Construit le modèle d'une série taker à partir de son archive. PURE. */
export function construireModeleFluxTakers(archive: ArchiveCq | null, aujourdhuiUtc: string): ModeleFluxTakers {
  // Jours clos uniquement (strictement avant aujourd'hui UTC), lignes taker, ordre croissant.
  const entrees = Object.entries(archive?.jours ?? {})
    .filter((e): e is [string, LigneTaker] => e[0] < aujourdhuiUtc && estTaker(e[1]))
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const premiere = entrees[0];
  const derniere = entrees.at(-1);
  if (premiere === undefined || derniere === undefined) return modeleVide();
  const [jour, ligne] = derniere;
  const parJour = new Map(entrees);

  // Cumul 7 j : une valeur seulement si les sept jours calendaires sont archivés.
  let presents = 0;
  let somme = 0;
  for (let k = 0; k < JOURS_CUMUL; k++) {
    const l = parJour.get(decalerJour(jour, -k));
    if (l === undefined) continue;
    presents += 1;
    somme += l.qbv - l.qsv;
  }

  // Volume quote du jour contre la médiane des 30 derniers jours présents (jour inclus).
  const volumes = entrees
    .slice(-JOURS_MEDIANE)
    .map(([, l]) => l.qv)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  const mediane = volumes.length >= 2 ? medianeTriee(volumes) : null;
  const vsMediane30Pct =
    mediane !== null && mediane > 0 && Number.isFinite(ligne.qv) ? (ligne.qv / mediane - 1) * 100 : null;

  // Courbe : chaque jour calendaire de l'archive, null quand il manque (ligne coupée).
  const courbe: ModeleFluxTakers["courbe"] = [];
  for (let j = premiere[0]; j <= jour; j = decalerJour(j, 1)) {
    const l = parJour.get(j);
    courbe.push({ jour: j, valeur: l === undefined ? null : fini(l.bsr) });
  }

  return {
    jour,
    ratio: fini(ligne.bsr),
    partAcheteursPct: Number.isFinite(ligne.br) ? ligne.br * 100 : null,
    situation: situer(
      entrees.map(([, l]) => l.bsr),
      ligne.bsr,
    ),
    deltaQuote: fini(ligne.qbv - ligne.qsv),
    cumul7: { valeur: presents === JOURS_CUMUL ? somme : null, presents },
    volumeQuote: fini(ligne.qv),
    volumeBase: fini(ligne.bv),
    trades: fini(ligne.n),
    vwap: fini(ligne.vwap),
    vsMediane30Pct,
    courbe,
  };
}
```

- [ ] **Étape 4 : lancer le test et vérifier qu'il passe**

```bash
pnpm --filter @axiom/web exec vitest run src/components/fluxTakers.util.test.ts src/components/derivativesWindow.util.test.ts
pnpm --filter @axiom/web typecheck
```

Attendu :
- `Test Files  2 passed` et `Tests  21 passed` : les 12 nouveaux tests, plus les 9 voisins inchangés ;
- typecheck sans erreur.

- [ ] **Étape 5 : commit**

```bash
git add apps/web/src/components/fluxTakers.util.ts apps/web/src/components/fluxTakers.util.test.ts
git commit -m "feat(des): modèle pur des flux takers toutes places et classement situer (CryptoQuant)" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

### Tâche 15 : section `FluxTakersSection.tsx` et insertion dans DES

**Fichiers :**
- Créer : `apps/web/src/components/FluxTakersSection.tsx`
- Créer : `apps/web/src/components/FluxTakersSection.test.tsx`
- Modifier : `apps/web/src/components/DerivativesWindow.tsx:15-16` (commentaire d'en-tête), `:69` (import) et `:769` (insertion après `<SectionOiPerpsDex />`)
- Tester : `apps/web/src/components/FluxTakersSection.test.tsx`

**Interfaces :**
- Consomme :
  - **Tâche 14** : `construireModeleFluxTakers`, `serieTaker`, et les types `ActifTaker`, `MarcheTaker`, `ModeleFluxTakers`, `SelectionTaker`.
  - **Store de clé (tâche 6)**, dans `apps/web/src/store/cryptoquant.ts` :
    - `cryptoquantKeyStore: StoreApi<CryptoquantKeyState>` ; le composant ne lit que `version`, jamais la clé ;
    - `RAISON_CLE_CRYPTOQUANT` ;
    - `messageSansCleCq(vercel: boolean): string`.
  - **Client (tâches 9-13), uniquement par `await import("../data/onchain/cryptoquant")`** :
    - `SERIES_TAKER` ;
    - `chargerSerieCq(serie: SerieCq, signal?: AbortSignal): Promise<ChargementCq>` ;
    - `etatFileCq(): { enAttente: number; repriseTs: number | null }`. `enAttente` ne compte que les demandes qui attendent un créneau. `repriseTs` est la reprise la plus tardive, entre une suspension 429 et `x-ratelimit-remaining: 0` ;
    - `abonnerFileCq(cb: () => void): () => void`.
  - **Client, en `import type`** : `ChargementCq`, `DiagnosticCq`, `SerieCq`. `ChargementCq` porte `statut`, `raison`, `archive`, `diagnostic`, `appel` et `persistance: { local: boolean; kv: boolean | null }` (`kv` vaut `null` sans daemon, `false` si la lecture ou l'écriture KV a échoué).
  - **Code existant** :
    - `IS_VERCEL` (`apps/web/src/lib/deployment.ts:7`).
    - Formats de `apps/web/src/lib/format.ts` : `formatCompact` (`:39`), `formatUsd` (`:51`), `formatPct` (`:62`), `formatPourcentage` (`:76`), `formatDec` (`:84`), `formatPrice` (`:29`), `formatUsdSigne` (`:167`) et `VALEUR_ABSENTE` (`:23`).
    - Primitives de `apps/web/src/components/ui.tsx` : `ErreurBloc` (`:312`), `Vide` (`:321`), `SansCle({ message, onOuvrirReglages })` (`:342`), `TuileStat({ label, valeur, disposition, ton, couleur, title, badge, extra, pied })` (`:363`), `Badge({ children, ton, title })` (`:438`), `SegmenteCompact({ options, actif, onChange, ariaLabel })` (`:582`), `NoteSource` (`:672`) et `BadgeFiabilite({ meta, niveau, label, title })` (`:692`).
    - `openSettingsFromWindow` (`DerivativesWindow.tsx:454`).
- Produit :
  - Définitions du contrat : `interface PropsVueFluxTakers`, `VueFluxTakers(props: PropsVueFluxTakers)` (PURE) et `SectionFluxTakers({ onOuvrirReglages }: { onOuvrirReglages: () => void })`.
  - Ajout défini ici : `resumeEnTeteFluxTakers(p: Omit<PropsVueFluxTakers, "onSelection" | "onOuvrirReglages">): string`. C'est le texte du côté droit de l'en-tête, visible même quand la section est repliée.
  - Surface DOM utilisée par la tâche 17 :
    - un bouton `aria-expanded` dont le nom contient « Flux takers toutes places » ;
    - les boutons segmentés `BTC`/`ETH` et `Spot`/`Perp` ;
    - l'image `img` « Ratio taker achat/vente quotidien » ;
    - les libellés « archive N j · J-1 AAAA-MM-JJ », « quota atteint, reprise N s », « clé personnelle requise », « clé CryptoQuant refusée », « Archive locale depuis », « N j archivés », « J-1 en attente de publication », « cache ou observation périmé » et « Ouvrir les réglages ⚙ ».
  - Signaux de persistance et d'archive, figés par les tests de vue :
    - « archive non persistée localement (stockage plein) » ;
    - « copie daemon non écrite » ;
    - « sans daemon : vider le stockage du navigateur perd l'archive » ;
    - « archive locale illisible remplacée ».
- Écarts assumés par rapport à la maquette §5.1 et à la spec :
  - **Médiane** : « vs méd. 30 j » utilise `formatPct(v, 1)` et affiche « +4.4% », format standard des variations. Aucune fonction du dépôt ne produit « +4.2 % ».
  - **VWAP** : affiché avec `$` + `formatPrice`, soit « $76,515.03 ». `formatUsd` donnerait « $76.52K ».
  - **Taille de l'archive** : affichée en nombre de jours archivés (« 28 j archivés »), pas en durée couverte.
  - **Quota** : le pied indique « quota 10 req/min (compteur dans DATA) », car `etatFileCq()` n'expose pas le compteur utilisé.
  - **Perp** : pas de tuile VWAP. La base et le VWAP passent dans l'infobulle du volume, avec la mention « unités fournisseur, champ inverse non documenté ».
  - **Clé refusée (écart acté)** : `SansCle` et son bouton « Ouvrir les réglages ⚙ » s'affichent pour tout `statut === "cle-requise"` à archive vide, y compris une clé refusée (401). La spec §4.2 réservait ce bouton à `RAISON_CLE_CRYPTOQUANT`. Le complément `.env`/Vercel (`messageSansCleCq`) ne s'ajoute que pour cette raison ; une clé refusée s'affiche telle quelle.
  - **Signaux jamais silencieux (spec §4.4 et §10)** :
    - `persistance.local === false` et `persistance.kv === false` donnent chacun un badge ;
    - `persistance.kv === null` ajoute une mention discrète dans la `NoteSource` ;
    - `diagnostic.perime` donne le badge « cache ou observation périmé ».
  - **Raison non nulle avec `statut "pret"`** : ce n'est pas une erreur, donc pas de bandeau. Le client (tâche 13) n'en produit qu'une, `RAISON_ARCHIVE_ILLISIBLE_CRYPTOQUANT`. Sa **valeur** ne peut pas être importée ici (règle de la zone). La vue lit donc la forme `statut === "pret" && raison !== null`, affiche le badge « archive locale illisible remplacée » et met la raison en infobulle.

- [ ] **Étape 1 : écrire le test qui échoue** — créer `apps/web/src/components/FluxTakersSection.test.tsx` :

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ArchiveCq, ChargementCq, DiagnosticCq, LigneTaker, SerieCq } from "../data/onchain/cryptoquant";
import { RAISON_CLE_CRYPTOQUANT } from "../store/cryptoquant";
import { resumeEnTeteFluxTakers, SectionFluxTakers, VueFluxTakers, type PropsVueFluxTakers } from "./FluxTakersSection";

// Espion d'évaluation du client CryptoQuant : la fabrique ne s'exécute qu'à l'import RÉEL du
// module. Ce fichier n'en importe que des types (effacés) et le rendu statique ne lance aucun
// effet : un import statique ajouté par erreur dans la section la déclencherait dès le
// chargement de ce test.
const { clientEvalue } = vi.hoisted(() => ({ clientEvalue: vi.fn() }));
vi.mock("../data/onchain/cryptoquant", async (importOriginal) => {
  clientEvalue();
  return importOriginal<typeof import("../data/onchain/cryptoquant")>();
});

const JOUR_MS = 86_400_000;
const NOW = Date.UTC(2026, 8, 16, 12);
/**
 * Raisons produites par le client (tâche 13), recopiées en littéraux : importer leur VALEUR
 * évaluerait le client et ferait échouer le test « client jamais évalué ».
 */
const RAISON_REFUSEE = "Clé CryptoQuant refusée (Réglages ⚙).";
const RAISON_ILLISIBLE = "Archive locale CryptoQuant illisible : remplacée à la prochaine écriture.";
const RAISON_VERSION = "Archive CryptoQuant écrite par une version plus récente d'AXIOM : ni lue ni réécrite.";
const jourIso = (t: number) => new Date(t).toISOString().slice(0, 10);

function ligne(p: Partial<LigneTaker> = {}): LigneTaker {
  return {
    n: 1_000_000,
    bv: 150_000,
    qv: 11_500_000_000,
    bbv: 75_000,
    qbv: 6_000_000_000,
    bsv: 75_000,
    qsv: 6_050_000_000,
    vwap: 76_000,
    br: 0.5,
    bsr: 1,
    bc: 500_000,
    sc: 500_000,
    ...p,
  };
}

function archive(
  serie: SerieCq,
  debut: string,
  fin: string,
  exclus: readonly string[] = [],
  surcharges: Record<string, Partial<LigneTaker>> = {},
): ArchiveCq {
  const jours: Record<string, LigneTaker> = {};
  for (let t = Date.parse(`${debut}T00:00:00Z`); t <= Date.parse(`${fin}T00:00:00Z`); t += JOUR_MS) {
    const j = jourIso(t);
    if (!exclus.includes(j)) jours[j] = ligne(surcharges[j]);
  }
  return { version: 1, serie, majTs: Date.UTC(2026, 8, 16, 6), jours };
}

/** Ligne réelle du sondage (spot BTC, 2026-09-15). */
const DERNIER: Partial<LigneTaker> = {
  n: 12_099_486,
  bv: 156_928.13,
  qv: 12_007_360_401.32,
  bbv: 77_681.2,
  qbv: 5_944_281_632.44,
  bsv: 79_246.93,
  qsv: 6_063_078_768.88,
  vwap: 76_515.03,
  br: 0.495,
  bsr: 0.9802,
  bc: 6_133_017,
  sc: 5_966_469,
};

const ARCHIVE_SPOT_BTC = archive("taker:spot:btc", "2026-08-17", "2026-09-15", ["2026-09-01", "2026-09-02"], {
  "2026-09-15": DERNIER,
});
const DIAG_SPOT_BTC: DiagnosticCq = {
  debut: "2026-08-17",
  dernier: "2026-09-15",
  hierPresent: true,
  manquantsFenetre: ["2026-09-01", "2026-09-02"],
  perdus: [],
  perime: false,
};
const DIAG_VIDE: DiagnosticCq = {
  debut: null,
  dernier: null,
  hierPresent: false,
  manquantsFenetre: [],
  perdus: [],
  perime: true,
};

function chargement(serie: SerieCq, p: Partial<ChargementCq> = {}): ChargementCq {
  return {
    serie,
    statut: "pret",
    raison: null,
    archive: null,
    diagnostic: DIAG_VIDE,
    persistance: { local: true, kv: null },
    appel: false,
    ...p,
  };
}

const PRET = chargement("taker:spot:btc", { archive: ARCHIVE_SPOT_BTC, diagnostic: DIAG_SPOT_BTC, appel: true });

function props(p: Partial<PropsVueFluxTakers> = {}): PropsVueFluxTakers {
  return {
    chargements: { "taker:spot:btc": PRET },
    selection: { actif: "btc", marche: "spot" },
    onSelection: () => undefined,
    enCours: false,
    recues: 4,
    attendues: 4,
    file: { enAttente: 0, repriseTs: null },
    now: NOW,
    onOuvrirReglages: () => undefined,
    ...p,
  };
}

const rendre = (p: Partial<PropsVueFluxTakers> = {}) => renderToStaticMarkup(<VueFluxTakers {...props(p)} />);

describe("section DES « Flux takers toutes places »", () => {
  beforeEach(() => vi.setSystemTime(NOW));
  afterEach(() => vi.useRealTimers());

  it("tuiles nominales : ratio, part acheteurs, Δ taker, volumes, VWAP, courbe, archive et limites", () => {
    const html = rendre();
    expect(html).toContain("Ratio taker achat/vente");
    expect(html).toContain('text-sm font-medium text-down">0.98<');
    expect(html).toContain("J-1 · CryptoQuant");
    expect(html).toContain("acheteurs 49.5 % · 28 j archivés : min 0.98 · méd. 1.00 · max 1.00 · 1ᵉʳ plus bas");
    expect(html).toContain("−$118.80M");
    expect(html).toContain("7 j −$418.80M (7/7 j)");
    expect(html).toContain("$12.01B");
    expect(html).toContain("Volume base 156.93K BTC");
    expect(html).toContain("12.10M trades · vs méd. 30 j +4.4%");
    expect(html).toContain("VWAP agrégé");
    expect(html).toContain("$76,515.03");
    expect(html).toContain("<svg");
    expect(html).toContain("observation 2026-09-15 (J-1) · récupéré 2026-09-16");
    expect(html).toContain("Archive locale depuis 2026-08-17 · 28 j archivés · 2 manquants dans la fenêtre · 0 perdu");
    expect(html).toContain("Manquants (récupérables sous 30 j) : 2026-09-01, 2026-09-02");
    expect(html).toContain("composition non documentée");
    expect(html).toContain("licence personnelle");
    expect(html).toContain("fenêtre 30 j sans rattrapage");
    // Sans daemon (kv null) : la perte possible de l'archive est dite, discrètement.
    expect(html).toContain("sans daemon : vider le stockage du navigateur perd l&#x27;archive");
    expect(html).toContain('aria-label="Actif des flux takers"');
    expect(html).toContain('aria-label="Marché des flux takers"');
    expect(html).not.toContain("J-1 en attente de publication");
    expect(html).not.toContain("périmé");
    expect(html).not.toContain("clé requise pour actualiser");
    expect(html).not.toContain("stockage plein");
    expect(html).not.toContain("copie daemon non écrite");
    expect(html).not.toContain("illisible");
    expect(html).not.toContain("border-down/40");
    expect(html).not.toContain("<table");
  });

  it("ton up quand le ratio est au moins 1", () => {
    const haussier = archive("taker:spot:btc", "2026-08-17", "2026-09-15", [], { "2026-09-15": { bsr: 1.05 } });
    const html = rendre({
      chargements: { "taker:spot:btc": chargement("taker:spot:btc", { archive: haussier, diagnostic: DIAG_SPOT_BTC }) },
    });
    expect(html).toContain('text-sm font-medium text-up">1.05<');
    expect(html).not.toContain('text-sm font-medium text-down">1.05<');
  });

  it("J-1 non publié : en attente, jamais compté en trou ; perdus définitifs", () => {
    const perdus = Array.from({ length: 14 }, (_, i) => jourIso(Date.UTC(2026, 7, 3) + i * JOUR_MS));
    const ancienne = archive("taker:spot:btc", "2026-07-20", "2026-09-14", perdus);
    const html = rendre({
      chargements: {
        "taker:spot:btc": chargement("taker:spot:btc", {
          archive: ancienne,
          diagnostic: { debut: "2026-07-20", dernier: "2026-09-14", hierPresent: false, manquantsFenetre: [], perdus, perime: false },
        }),
      },
    });
    expect(html).toContain("observation 2026-09-14 · récupéré 2026-09-16");
    expect(html).not.toContain("(J-1)");
    expect(html).toContain("0 manquant dans la fenêtre · 14 perdus (définitifs) · J-1 en attente de publication");
    expect(html).toContain("Perdus (hors fenêtre fournisseur) : 2026-08-03");
  });

  it("observation périmée : badge dédié au-dessus des tuiles", () => {
    const html = rendre({
      chargements: { "taker:spot:btc": { ...PRET, diagnostic: { ...DIAG_SPOT_BTC, perime: true } } },
    });
    expect(html).toContain("cache ou observation périmé");
    expect(html).toContain("0.98");
  });

  it("signaux de persistance : stockage plein et copie daemon non écrite, jamais silencieux", () => {
    const sansEcriture = rendre({
      chargements: { "taker:spot:btc": { ...PRET, persistance: { local: false, kv: false } } },
    });
    expect(sansEcriture).toContain("archive non persistée localement (stockage plein)");
    expect(sansEcriture).toContain("copie daemon non écrite");
    expect(sansEcriture).not.toContain("sans daemon");
    expect(sansEcriture).toContain("0.98");
    const avecDaemon = rendre({
      chargements: { "taker:spot:btc": { ...PRET, persistance: { local: true, kv: true } } },
    });
    expect(avecDaemon).not.toContain("stockage plein");
    expect(avecDaemon).not.toContain("copie daemon non écrite");
    expect(avecDaemon).not.toContain("sans daemon");
  });

  it("archive illisible remplacée : raison non nulle sur « pret », badge sans bandeau d'erreur", () => {
    const p = props({ chargements: { "taker:spot:btc": { ...PRET, raison: RAISON_ILLISIBLE } } });
    const html = renderToStaticMarkup(<VueFluxTakers {...p} />);
    expect(html).toContain("archive locale illisible remplacée");
    expect(html).toContain(`title="${RAISON_ILLISIBLE}"`);
    expect(html).not.toContain("border-down/40");
    expect(html).toContain("0.98");
    expect(resumeEnTeteFluxTakers(p)).toBe("archive 28 j · J-1 2026-09-15");
  });

  it("perp : mène avec le volume quote, base et VWAP en infobulle avec la limite fournisseur", () => {
    const perp = archive("taker:swap:eth", "2026-09-10", "2026-09-15", [], {
      "2026-09-15": { bsr: 1.1234, qv: 27_800_000_000, bv: 11_300_000, vwap: 2_450.5 },
    });
    const html = rendre({
      selection: { actif: "eth", marche: "swap" },
      chargements: { "taker:swap:eth": chargement("taker:swap:eth", { archive: perp, diagnostic: DIAG_SPOT_BTC }) },
    });
    expect(html).toContain("1.12");
    expect(html).toContain("$27.80B");
    expect(html).toContain("Volume base 11.30M ETH · VWAP $2,450.50 — unités fournisseur, champ inverse non documenté");
    expect(html).toContain("champ inverse non documenté");
    expect(html).not.toContain("VWAP agrégé");
  });

  it("chargement puis partiel : progression visible, jamais un chargement muet", () => {
    expect(rendre({ chargements: {}, enCours: true, recues: 0 })).toContain("Chargement des flux takers…");
    const partiel = rendre({
      selection: { actif: "eth", marche: "spot" },
      enCours: true,
      recues: 2,
      file: { enAttente: 2, repriseTs: null },
    });
    expect(partiel).toContain("2/4 reçues · en attente du quota CryptoQuant (10 req/min)");
    expect(partiel).toContain("Chargement des flux takers…");
  });

  it("quota, offre, erreur, version inconnue : bandeau au-dessus de l'archive servie", () => {
    const quota = rendre({
      chargements: {
        "taker:spot:btc": { ...PRET, statut: "quota", raison: "Quota CryptoQuant atteint (429) ; nouvel essai dans 42 s." },
      },
    });
    expect(quota).toContain("nouvel essai dans 42 s");
    expect(quota).toContain("border-down/40");
    expect(quota).toContain("0.98");
    const offre = rendre({ chargements: { "taker:spot:btc": { ...PRET, statut: "offre", raison: "Professional plan and above" } } });
    expect(offre).toContain("Professional plan and above");
    expect(offre).toContain("$12.01B");
    const erreur = rendre({
      chargements: { "taker:spot:btc": { ...PRET, statut: "erreur", raison: "CryptoQuant injoignable ; archive affichée." } },
    });
    expect(erreur).toContain("CryptoQuant injoignable ; archive affichée.");
    expect(erreur).toContain("Archive locale depuis 2026-08-17");
    // Archive d'une version future : erreur sans archive servie, zéro appel côté client.
    const version = rendre({
      chargements: { "taker:spot:btc": chargement("taker:spot:btc", { statut: "erreur", raison: RAISON_VERSION }) },
    });
    expect(version).toContain("écrite par une version plus récente d&#x27;AXIOM");
    expect(version).toContain("border-down/40");
    expect(version).toContain("Série non encore archivée.");
  });

  it("sans clé et archive vide : SansCle avec le repli local et le lien Réglages", () => {
    const html = rendre({
      chargements: {
        "taker:spot:btc": chargement("taker:spot:btc", { statut: "cle-requise", raison: RAISON_CLE_CRYPTOQUANT }),
      },
    });
    expect(html).toContain(
      "Clé CryptoQuant personnelle requise (Réglages ⚙) — ou CRYPTOQUANT_API_KEY dans apps/web/.env pour le proxy Vite et le daemon.",
    );
    expect(html).toContain("Ouvrir les réglages ⚙");
    expect(html).not.toContain("Ratio taker achat/vente");
  });

  it("clé refusée (401) et archive vide : raison telle quelle, lien Réglages, sans repli .env", () => {
    const html = rendre({
      chargements: { "taker:spot:btc": chargement("taker:spot:btc", { statut: "cle-requise", raison: RAISON_REFUSEE }) },
    });
    expect(html).toContain("Clé CryptoQuant refusée (Réglages ⚙).");
    expect(html).toContain("Ouvrir les réglages ⚙");
    expect(html).not.toContain("CRYPTOQUANT_API_KEY");
    expect(html).not.toContain("licence personnelle, aucun repli serveur");
  });

  it("sans clé mais archive présente : tuiles servies et badge « clé requise pour actualiser »", () => {
    const html = rendre({
      chargements: { "taker:spot:btc": { ...PRET, statut: "cle-requise", raison: RAISON_CLE_CRYPTOQUANT } },
    });
    expect(html).toContain("clé requise pour actualiser");
    expect(html).toContain("0.98");
    expect(html).not.toContain("Ouvrir les réglages");
    expect(html).not.toContain("illisible");
  });

  it("série sélectionnée absente : « Série non encore archivée. »", () => {
    expect(rendre({ chargements: {}, enCours: false })).toContain("Série non encore archivée.");
    const sansArchive = rendre({ chargements: { "taker:spot:btc": chargement("taker:spot:btc") } });
    expect(sansArchive).toContain("Série non encore archivée.");
    expect(sansArchive).not.toContain("périmé");
  });

  it("jamais « 0 » pour une valeur absente : cumul, situation et médiane incomplets", () => {
    const seul = archive("taker:spot:btc", "2026-09-15", "2026-09-15", [], { "2026-09-15": DERNIER });
    const html = rendre({
      chargements: {
        "taker:spot:btc": chargement("taker:spot:btc", {
          archive: seul,
          diagnostic: { debut: "2026-09-15", dernier: "2026-09-15", hierPresent: true, manquantsFenetre: [], perdus: [], perime: false },
        }),
      },
    });
    expect(html).toContain("7 j — (1/7 j)");
    expect(html).toContain("acheteurs 49.5 % · archive trop courte pour situer le ratio");
    expect(html).toContain("vs méd. 30 j —");
    expect(html).not.toContain("$0");
    expect(html).not.toContain("+0.0%");
    expect(html).not.toContain("min 0");
  });

  it("résumé d'en-tête : chargement, partiel, quota, clé, archive", () => {
    expect(resumeEnTeteFluxTakers(props({ chargements: {}, enCours: true, recues: 0 }))).toBe("chargement…");
    expect(resumeEnTeteFluxTakers(props({ enCours: true, recues: 2, file: { enAttente: 2, repriseTs: null } }))).toBe(
      "2/4 reçues · en attente du quota",
    );
    expect(
      resumeEnTeteFluxTakers(
        props({
          chargements: { "taker:spot:btc": { ...PRET, statut: "quota" } },
          file: { enAttente: 0, repriseTs: NOW + 42_000 },
        }),
      ),
    ).toBe("quota atteint, reprise 42 s");
    expect(
      resumeEnTeteFluxTakers(
        props({ chargements: { "taker:spot:btc": chargement("taker:spot:btc", { statut: "cle-requise" }) } }),
      ),
    ).toBe("clé personnelle requise");
    expect(
      resumeEnTeteFluxTakers(
        props({ chargements: { "taker:spot:btc": chargement("taker:spot:btc", { statut: "cle-requise", raison: RAISON_REFUSEE }) } }),
      ),
    ).toBe("clé CryptoQuant refusée");
    expect(resumeEnTeteFluxTakers(props())).toBe("archive 28 j · J-1 2026-09-15");
  });

  it("section repliée par défaut : bouton seul, aucun contenu, client jamais évalué", () => {
    const html = renderToStaticMarkup(<SectionFluxTakers onOuvrirReglages={() => undefined} />);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Flux takers toutes places (quotidien · CryptoQuant)");
    expect(html).toContain("chargement…");
    expect(html).not.toContain("Ratio taker");
    expect(html).not.toContain("Archive locale");
    expect(clientEvalue).not.toHaveBeenCalled();
  });
});
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue**

```bash
pnpm --filter @axiom/web exec vitest run src/components/FluxTakersSection.test.tsx
```

Attendu :
- `FAIL src/components/FluxTakersSection.test.tsx` ;
- l'erreur de résolution `Error: Cannot find module '/src/components/FluxTakersSection'`, suivie du chemin absolu du fichier de test ;
- puis `Tests  no tests`.

- [ ] **Étape 3 : implémentation minimale** — créer `apps/web/src/components/FluxTakersSection.tsx`. Pour respecter les ratchets de `uiConventions.test.ts:67-84`, n'écrivez aucune classe de segmenté ni de bouton secondaire à la main : passez par `SegmenteCompact`, `Badge` et `BadgeFiabilite`.

```tsx
/**
 * Section repliable « Flux takers toutes places (quotidien · CryptoQuant) » de DES.
 *
 * Vue PURE `VueFluxTakers` (testée en rendu statique) + conteneur `SectionFluxTakers`.
 * Le conteneur charge les QUATRE séries au MONTAGE de la fenêtre, pas au dépliage : la
 * collecte de l'archive côté client ne doit pas dépendre d'un clic (un jour non collecté
 * au-delà de 30 j est perdu), et les segmentés ne déclenchent ainsi aucun appel. La section
 * reste repliée par défaut. Le client CryptoQuant n'est chargé que par `import()` (chunk à
 * la demande) : ce fichier n'en importe que des TYPES. La raison « sans clé » et son
 * complément viennent du store de clé, déjà importé ici pour `version`.
 *
 * Agrégat fournisseur consommé tel quel : spot et perp jamais additionnés, ratio et VWAP
 * jamais recalculés, aucune comparaison Binance. Indépendante de la clé Coinalyze, du
 * symbole et de l'exchange. Courbe et sparkline LOCALES : un module commun DES/CHAIN
 * créerait un chunk préchargé par l'entrée.
 */
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { ChargementCq, DiagnosticCq, SerieCq } from "../data/onchain/cryptoquant";
import { IS_VERCEL } from "../lib/deployment";
import {
  formatCompact,
  formatDec,
  formatPct,
  formatPourcentage,
  formatPrice,
  formatUsd,
  formatUsdSigne,
  VALEUR_ABSENTE,
} from "../lib/format";
import { cryptoquantKeyStore, messageSansCleCq, RAISON_CLE_CRYPTOQUANT } from "../store/cryptoquant";
import {
  construireModeleFluxTakers,
  serieTaker,
  type ActifTaker,
  type MarcheTaker,
  type ModeleFluxTakers,
  type SelectionTaker,
} from "./fluxTakers.util";
import { Badge, BadgeFiabilite, ErreurBloc, NoteSource, SansCle, SegmenteCompact, TuileStat, Vide } from "./ui";

const JOUR_MS = 86_400_000;
/** Séries chargées par la section (spot/perp × BTC/ETH). */
const NB_SERIES_TAKER = 4;
const MENTION_PERP = "unités fournisseur, champ inverse non documenté";

const OPTIONS_ACTIF: ReadonlyArray<{ id: ActifTaker; label: string }> = [
  { id: "btc", label: "BTC" },
  { id: "eth", label: "ETH" },
];
const OPTIONS_MARCHE: ReadonlyArray<{ id: MarcheTaker; label: string; title?: string }> = [
  { id: "spot", label: "Spot" },
  { id: "swap", label: "Perp", title: "Perpétuels (swap) : volumes en unités fournisseur" },
];

const jourIso = (t: number | null) =>
  t !== null && Number.isFinite(t) && t > 0 ? new Date(t).toISOString().slice(0, 10) : VALEUR_ABSENTE;

const formatVwap = (v: number | null) => (v !== null && v > 0 ? `$${formatPrice(v)}` : VALEUR_ABSENTE);

const ordinal = (rang: number) => (rang === 1 ? "1ᵉʳ" : `${rang}ᵉ`);

export interface PropsVueFluxTakers {
  chargements: Partial<Record<SerieCq, ChargementCq>>;
  selection: SelectionTaker;
  onSelection: (s: SelectionTaker) => void;
  enCours: boolean;
  recues: number;
  attendues: number;
  file: { enAttente: number; repriseTs: number | null };
  now: number;
  onOuvrirReglages: () => void;
}

/** Mini-courbe de tendance récente (SVG inline) — copie locale de celle de DES. */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  const width = 64;
  const height = 20;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / span) * height).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={width} height={height} className="shrink-0" aria-hidden="true">
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.2} strokeLinejoin="round" />
    </svg>
  );
}

/** Ratio achat/vente à dates réelles : pointillé à 1.00, ligne coupée aux jours absents. */
function CourbeTakers({ points }: { points: ModeleFluxTakers["courbe"] }) {
  const valides = points.filter((p): p is { jour: string; valeur: number } => p.valeur !== null);
  const premier = points[0];
  const dernier = points.at(-1);
  if (valides.length < 2 || premier === undefined || dernier === undefined) return null;
  const temps = (jour: string) => Date.parse(`${jour}T00:00:00Z`);
  const x0 = temps(premier.jour);
  const x1 = temps(dernier.jour);
  const min = Math.min(1, ...valides.map((p) => p.valeur));
  const max = Math.max(1, ...valides.map((p) => p.valeur));
  const x = (jour: string) => 4 + ((temps(jour) - x0) / (x1 - x0 || 1)) * 292;
  const y = (v: number) => 56 - ((v - min) / (max - min || 1)) * 48;
  let rupture = true;
  const commandes: string[] = [];
  for (const p of points) {
    if (p.valeur === null) {
      rupture = true;
      continue;
    }
    commandes.push(`${rupture ? "M" : "L"}${x(p.jour).toFixed(1)},${y(p.valeur).toFixed(1)}`);
    rupture = false;
  }
  return (
    <figure className="mt-1" aria-label="Ratio taker achat/vente quotidien">
      <svg viewBox="0 0 300 64" className="h-16 w-full" role="img" aria-label="Ratio taker achat/vente quotidien">
        <title>{`Ratio taker achat/vente · ${premier.jour} au ${dernier.jour} · pointillé = 1.00`}</title>
        <line x1="4" x2="296" y1={y(1)} y2={y(1)} stroke="var(--border)" strokeDasharray="3 3" />
        <path d={commandes.join(" ")} fill="none" stroke="var(--serie-1)" strokeWidth="1.5" />
      </svg>
      <figcaption className="flex justify-between gap-1 text-[9px] text-text-dim">
        <span>{premier.jour}</span>
        <span>{`${formatDec(min, 2)} → ${formatDec(max, 2)}`}</span>
        <span>{dernier.jour}</span>
      </figcaption>
    </figure>
  );
}

function ligneSituation(partPct: number | null, s: ModeleFluxTakers["situation"]): string {
  const acheteurs = `acheteurs ${formatPourcentage(partPct, 1)}`;
  if (s === null) return `${acheteurs} · archive trop courte pour situer le ratio`;
  return (
    `${acheteurs} · ${s.n} j archivés : min ${formatDec(s.min, 2)} · méd. ${formatDec(s.mediane, 2)}` +
    ` · max ${formatDec(s.max, 2)} · ${ordinal(s.rang)} plus bas`
  );
}

/** Ligne d'archive : début, taille et trois états de trous (J-1 absent n'est jamais un trou). */
function ligneArchive(d: DiagnosticCq, nbJours: number): string {
  const k = d.manquantsFenetre.length;
  const p = d.perdus.length;
  const morceaux = [
    `Archive locale depuis ${d.debut ?? VALEUR_ABSENTE}`,
    `${nbJours} j archivés`,
    `${k} ${k > 1 ? "manquants" : "manquant"} dans la fenêtre`,
    p === 0 ? "0 perdu" : `${p} ${p > 1 ? "perdus (définitifs)" : "perdu (définitif)"}`,
  ];
  if (!d.hierPresent) morceaux.push("J-1 en attente de publication");
  return morceaux.join(" · ");
}

function titreTrous(d: DiagnosticCq): string | undefined {
  const lignes = [
    d.manquantsFenetre.length > 0 ? `Manquants (récupérables sous 30 j) : ${d.manquantsFenetre.join(", ")}` : "",
    d.perdus.length > 0 ? `Perdus (hors fenêtre fournisseur) : ${d.perdus.join(", ")}` : "",
  ].filter((l) => l !== "");
  return lignes.length > 0 ? lignes.join("\n") : undefined;
}

/** Résumé du côté droit de l'en-tête (visible même section repliée). PURE. */
export function resumeEnTeteFluxTakers(
  p: Omit<PropsVueFluxTakers, "onSelection" | "onOuvrirReglages">,
): string {
  if (p.enCours && p.file.enAttente > 0) return `${p.recues}/${p.attendues} reçues · en attente du quota`;
  const c = p.chargements[serieTaker(p.selection)];
  if (c === undefined) return p.enCours ? "chargement…" : "série non encore archivée";
  if (c.statut === "quota") {
    const secondes = p.file.repriseTs === null ? 0 : Math.ceil((p.file.repriseTs - p.now) / 1000);
    return secondes > 0 ? `quota atteint, reprise ${secondes} s` : "quota atteint, réessai à la prochaine ouverture";
  }
  if (c.statut === "cle-requise") return c.raison === null || c.raison === RAISON_CLE_CRYPTOQUANT ? "clé personnelle requise" : "clé CryptoQuant refusée";
  if (c.statut === "offre") return "offre CryptoQuant insuffisante";
  const nbJours = Object.keys(c.archive?.jours ?? {}).length;
  const dernier = c.diagnostic.dernier;
  if (dernier === null || nbJours === 0) return c.statut === "erreur" ? "CryptoQuant injoignable" : "archive vide";
  const archive = `archive ${nbJours} j · ${c.diagnostic.hierPresent ? "J-1" : "dernier"} ${dernier}`;
  return c.statut === "erreur" ? `CryptoQuant injoignable · ${archive}` : archive;
}

export function VueFluxTakers({
  chargements,
  selection,
  onSelection,
  enCours,
  recues,
  attendues,
  file,
  now,
  onOuvrirReglages,
}: PropsVueFluxTakers) {
  const hier = jourIso(now - JOUR_MS);
  const c = chargements[serieTaker(selection)];
  const archive = c?.archive ?? null;
  const nbJours = archive === null ? 0 : Object.keys(archive.jours).length;
  const m = construireModeleFluxTakers(archive, jourIso(now));
  const perp = selection.marche === "swap";

  const selecteurs = (
    <div className="flex flex-wrap items-center gap-2">
      <SegmenteCompact
        ariaLabel="Actif des flux takers"
        options={OPTIONS_ACTIF}
        actif={selection.actif}
        onChange={(actif) => onSelection({ ...selection, actif })}
      />
      <SegmenteCompact
        ariaLabel="Marché des flux takers"
        options={OPTIONS_MARCHE}
        actif={selection.marche}
        onChange={(marche) => onSelection({ ...selection, marche })}
      />
      {m.jour !== null && (
        <span className="ml-auto text-[10px] tabular-nums text-text-dim">
          {`observation ${m.jour}${m.jour === hier ? " (J-1)" : ""} · récupéré ${jourIso(archive?.majTs ?? null)}`}
        </span>
      )}
    </div>
  );
  const partiel = enCours && recues < attendues && (
    <p className="px-1 text-[10px] text-text-dim">
      {`${recues}/${attendues} reçues${file.enAttente > 0 ? " · en attente du quota CryptoQuant (10 req/min)" : ""}`}
    </p>
  );

  if (c === undefined) {
    return (
      <div className="space-y-2">
        {selecteurs}
        {partiel}
        <Vide>{enCours ? "Chargement des flux takers…" : "Série non encore archivée."}</Vide>
      </div>
    );
  }

  if (c.statut === "cle-requise" && nbJours === 0) {
    // Bouton Réglages pour toute clé absente OU refusée. Le complément `.env`/Vercel ne
    // concerne que l'absence de clé : une clé refusée (401) s'affiche telle quelle.
    const raison = c.raison ?? RAISON_CLE_CRYPTOQUANT;
    const message = raison === RAISON_CLE_CRYPTOQUANT ? messageSansCleCq(IS_VERCEL) : raison;
    return (
      <div className="space-y-2">
        {selecteurs}
        <SansCle message={message} onOuvrirReglages={onOuvrirReglages} />
      </div>
    );
  }

  const bandeau =
    c.statut === "quota" || c.statut === "offre" || c.statut === "erreur"
      ? (c.raison ?? "CryptoQuant indisponible ; archive affichée.")
      : null;
  const tonRatio = m.ratio === null ? undefined : m.ratio >= 1 ? "up" : "down";
  const sparkRatio = m.courbe
    .map((p) => p.valeur)
    .filter((v): v is number => v !== null)
    .slice(-30);
  const perime = c.diagnostic.perime && m.jour !== null;
  // Une raison non nulle avec « pret » n'est pas une erreur : le client n'en produit qu'une,
  // l'archive locale illisible remplacée. Sa valeur n'est pas importable ici (client chargé à
  // la demande) : la vue lit la forme et montre la raison en infobulle.
  const illisible = c.statut === "pret" && c.raison !== null;
  const stockagePlein = c.persistance.local === false;
  const kvNonEcrit = c.persistance.kv === false;
  const signaux = c.statut === "cle-requise" || perime || illisible || stockagePlein || kvNonEcrit;
  const volumeBase = `Volume base ${formatCompact(m.volumeBase)} ${selection.actif.toUpperCase()}`;
  const titreVolume = perp ? `${volumeBase} · VWAP ${formatVwap(m.vwap)} — ${MENTION_PERP}` : volumeBase;

  return (
    <div className="space-y-2">
      {selecteurs}
      {partiel}
      {bandeau !== null && <ErreurBloc>{bandeau}</ErreurBloc>}
      {signaux && (
        <div className="flex flex-wrap gap-1.5">
          {c.statut === "cle-requise" && (
            <Badge ton="warn" title={c.raison ?? undefined}>
              clé requise pour actualiser
            </Badge>
          )}
          {perime && <Badge ton="warn">cache ou observation périmé</Badge>}
          {illisible && (
            <Badge ton="warn" title={c.raison ?? undefined}>
              archive locale illisible remplacée
            </Badge>
          )}
          {stockagePlein && <Badge ton="warn">archive non persistée localement (stockage plein)</Badge>}
          {kvNonEcrit && <Badge ton="warn">copie daemon non écrite</Badge>}
        </div>
      )}
      {m.jour === null ? (
        <Vide>Série non encore archivée.</Vide>
      ) : (
        <>
          <TuileStat
            disposition="inline"
            label="Ratio taker achat/vente"
            valeur={formatDec(m.ratio, 2)}
            ton={tonRatio}
            badge={
              <BadgeFiabilite
                niveau="partiel"
                label="J-1 · CryptoQuant"
                title="Agrégat quotidien CryptoQuant publié à J-1 ; composition des places non documentée."
              />
            }
            extra={
              sparkRatio.length >= 2 && (
                <Sparkline values={sparkRatio} color={tonRatio === "up" ? "var(--up)" : "var(--down)"} />
              )
            }
          />
          <p className="px-1 text-[11px] tabular-nums text-text-dim">{ligneSituation(m.partAcheteursPct, m.situation)}</p>
          <TuileStat
            disposition="inline"
            label="Δ taker (quote)"
            valeur={formatUsdSigne(m.deltaQuote)}
            ton={m.deltaQuote === null ? undefined : m.deltaQuote >= 0 ? "up" : "down"}
            title="Volume acheteur − volume vendeur en quote (USD), valeurs du fournisseur"
          />
          <p className="px-1 text-[11px] tabular-nums text-text-dim">
            {m.cumul7.valeur === null
              ? `7 j ${VALEUR_ABSENTE} (${m.cumul7.presents}/7 j)`
              : `7 j ${formatUsdSigne(m.cumul7.valeur)} (7/7 j)`}
          </p>
          <TuileStat disposition="inline" label="Volume quote" valeur={formatUsd(m.volumeQuote)} title={titreVolume} />
          <p className="px-1 text-[11px] tabular-nums text-text-dim">
            {`${formatCompact(m.trades)} trades · vs méd. 30 j ${formatPct(m.vsMediane30Pct, 1)}`}
          </p>
          {perp ? (
            <p className="px-1 text-[10px] text-text-dim">
              {`Perp : volume base et VWAP en infobulle du volume (${MENTION_PERP}).`}
            </p>
          ) : (
            <TuileStat disposition="inline" label="VWAP agrégé" valeur={formatVwap(m.vwap)} />
          )}
          <CourbeTakers points={m.courbe} />
          <p className="px-1 text-[10px] text-text-dim" title={titreTrous(c.diagnostic)}>
            {ligneArchive(c.diagnostic, nbJours)}
          </p>
        </>
      )}
      <NoteSource>
        <BadgeFiabilite niveau="partiel" label="J-1 · CryptoQuant" /> · agrégat toutes places (composition non
        documentée) · licence personnelle · fenêtre 30 j sans rattrapage : un jour non collecté au-delà est
        perdu · quota 10 req/min (compteur dans DATA) · spot et perp jamais additionnés, ratio et VWAP tels que
        publiés
        {c.persistance.kv === null && " · sans daemon : vider le stockage du navigateur perd l'archive"}
      </NoteSource>
    </div>
  );
}

export function SectionFluxTakers({ onOuvrirReglages }: { onOuvrirReglages: () => void }) {
  // Rotation de clé (setKey/clearKey) → nouvelle passe ; la valeur de la clé n'est jamais lue ici.
  const version = useStore(cryptoquantKeyStore, (s) => s.version);
  const [ouvert, setOuvert] = useState(false);
  const [selection, setSelection] = useState<SelectionTaker>({ actif: "btc", marche: "spot" });
  const [chargements, setChargements] = useState<Partial<Record<SerieCq, ChargementCq>>>({});
  const [enCours, setEnCours] = useState(true);
  const [recues, setRecues] = useState(0);
  const [file, setFile] = useState<{ enAttente: number; repriseTs: number | null }>({
    enAttente: 0,
    repriseTs: null,
  });
  const [now, setNow] = useState(() => Date.now());

  // Chargement au MONTAGE (et à chaque rotation de clé) : boucle séquentielle, affichage
  // progressif série par série. Le client est importé à la demande ; démontage → annulation.
  useEffect(() => {
    const ctrl = new AbortController();
    const abonnement: { arreter: () => void } = { arreter: () => undefined };
    let vivant = true;
    setEnCours(true);
    setRecues(0);
    void (async () => {
      const cq = await import("../data/onchain/cryptoquant");
      if (!vivant) return;
      const majFile = () => {
        if (!vivant) return;
        setFile(cq.etatFileCq());
        setNow(Date.now());
      };
      abonnement.arreter = cq.abonnerFileCq(majFile);
      majFile();
      for (const serie of cq.SERIES_TAKER) {
        let resultat: ChargementCq;
        try {
          resultat = await cq.chargerSerieCq(serie, ctrl.signal);
        } catch {
          // Annulation au démontage ou échec inattendu : la série reste absente de l'écran.
          if (!vivant) return;
          continue;
        }
        if (!vivant) return;
        setChargements((precedents) => ({ ...precedents, [serie]: resultat }));
        setRecues((n) => n + 1);
        majFile();
      }
      if (vivant) setEnCours(false);
    })();
    return () => {
      vivant = false;
      ctrl.abort();
      abonnement.arreter();
    };
  }, [version]);

  // Compte à rebours de reprise après un 429 : une mise à jour par seconde jusqu'à l'échéance.
  useEffect(() => {
    const reprise = file.repriseTs;
    if (reprise === null || reprise <= Date.now()) return undefined;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= reprise) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [file.repriseTs]);

  const props: PropsVueFluxTakers = {
    chargements,
    selection,
    onSelection: setSelection,
    enCours,
    recues,
    attendues: NB_SERIES_TAKER,
    file,
    now,
    onOuvrirReglages,
  };

  return (
    <section className="mt-3 rounded-md border border-border bg-bg">
      <button
        type="button"
        onClick={() => setOuvert((v) => !v)}
        aria-expanded={ouvert}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="text-[10px] uppercase tracking-wide text-text-dim">
          Flux takers toutes places (quotidien · CryptoQuant)
        </span>
        <span className="flex shrink-0 items-center gap-2 text-[10px] tabular-nums text-text-dim">
          <span>{resumeEnTeteFluxTakers(props)}</span>
          <span className="text-[11px]">{ouvert ? "▾" : "▸"}</span>
        </span>
      </button>
      {ouvert && (
        <div className="border-t border-border px-3 py-2">
          <VueFluxTakers {...props} />
        </div>
      )}
    </section>
  );
}
```

- [ ] **Étape 4 : lancer le test et vérifier qu'il passe**

```bash
pnpm --filter @axiom/web exec vitest run src/components/FluxTakersSection.test.tsx src/components/fluxTakers.util.test.ts src/components/OiPerpsDexSection.test.tsx src/components/uiConventions.test.ts src/lib/gardeFous.test.ts
```

Attendu : `Test Files  5 passed` et `Tests  46 passed`, soit :
- 16 nouveaux tests ;
- 12 tests de la tâche 14 ;
- 6 tests d'OI perps DEX ;
- 10 ratchets UI ;
- 2 garde-fous de couleurs.

- [ ] **Étape 5 : insérer la section dans DES** — trois remplacements exacts dans `apps/web/src/components/DerivativesWindow.tsx`.
  - Les numéros de ligne sont ceux du fichier avant modification. Après les deux premiers remplacements, `<SectionOiPerpsDex />` passe en ligne 772.
  - Chaque texte à remplacer est unique dans le fichier : c'est lui qui fait foi.

Lignes 15-16 (commentaire d'en-tête), remplacer :

```tsx
 * Hors clé et hors exchange : OI BTC par exchange (BGeometrics) et OI perps DEX quotidien
 * tous actifs (DefiLlama), deux sections repliables chargées au premier dépliage.
```

par :

```tsx
 * Hors clé et hors exchange : OI BTC par exchange (BGeometrics) et OI perps DEX quotidien
 * tous actifs (DefiLlama), deux sections repliables chargées au premier dépliage ; flux
 * takers toutes places (CryptoQuant, clé personnelle), section repliable chargée au MONTAGE
 * de la fenêtre (archive côté client, aucun appel quand J-1 est déjà archivé).
```

Ligne 69, remplacer :

```tsx
import { SectionOiPerpsDex } from "./OiPerpsDexSection";
```

par :

```tsx
import { SectionOiPerpsDex } from "./OiPerpsDexSection";
import { SectionFluxTakers } from "./FluxTakersSection";
```

Ligne 769, remplacer :

```tsx
          <SectionOiPerpsDex />
```

par :

```tsx
          <SectionOiPerpsDex />

          {/* Flux takers toutes places (quotidien, CryptoQuant, clé personnelle) — INDÉPENDANT
              de Coinalyze et de l'exchange : hors des branches ci-dessus. Repliée par défaut,
              mais chargée au MONTAGE de la fenêtre (archive côté client ; aucun appel quand
              J-1 est déjà archivé). */}
          <SectionFluxTakers onOuvrirReglages={openSettingsFromWindow} />
```

La section se place hors des branches `!isBinance` / `!hasKey` (`:506-516`) : elle reste visible sur Bybit et sans clé Coinalyze.

- [ ] **Étape 6 : vérifier le typage et la suite web**

```bash
pnpm --filter @axiom/web typecheck
pnpm --filter @axiom/web test
```

Attendu :
- typecheck sans erreur ;
- suite web entièrement verte.

`DerivativesWindow.tsx` n'a pas de test unitaire. La tâche 17 couvre l'insertion en e2e : montage, dépliage, source Bybit et réouverture.

- [ ] **Étape 7 : commit**

```bash
git add apps/web/src/components/FluxTakersSection.tsx apps/web/src/components/FluxTakersSection.test.tsx apps/web/src/components/DerivativesWindow.tsx
git commit -m "feat(des): section repliable flux takers toutes places (CryptoQuant) chargée au montage" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

### Tâche 16 : budget, manifeste et garde-fou du chunk à la demande

**Fichiers :**
- Créer : `apps/web/src/chunkCryptoquant.test.ts`
- Modifier : `docs/superpowers/progress/2026-09-16-cryptoquant.md` (section `### Budget après B1` ajoutée en fin de fichier)
- Tester : `apps/web/src/chunkCryptoquant.test.ts`

**Interfaces :**
- Consomme :
  - `apps/web/src/components/FluxTakersSection.tsx` (tâche 15), qui contient le littéral `await import("../data/onchain/cryptoquant")`.
  - `scripts/verifier-budget-build.mjs`, qui produit `{ limites: { octetsBruts, octetsGzip, niveauGzip }, initial: { fichiers, octetsBruts, octetsGzip }, dynamique: { fichiers, octetsBruts, octetsGzip } }` (`:170-174`).
    - Il l'imprime en dernier, indenté sur deux espaces (`:180`).
    - Il est lancé par `pnpm --filter @axiom/web build` (`apps/web/package.json:8`).
    - En cas de dépassement, il écrit `Erreur budget build` sur stderr et sort en code 1.
  - `apps/web/dist/.vite/manifest.json`, produit grâce à `build.manifest: true` (`apps/web/vite.config.ts:107`).
  - Les sections `### Budget avant B1` (tâche 1) et `### Budget après B1-3` (tâche 8) du rapport. Chacune a une ligne « Commande : » puis un bloc ```json complet.
  - Écart runner − local du 2026-09-16 : mesure locale 355 397 gzip (`docs/superpowers/progress/2026-09-16-indicateurs-et-fonctions-revue.md:49`) et mesure runner 356 635 gzip (`:62`).
  - Précédent de chunk partagé : `store/defillamaKey.ts` est déjà émis comme chunk `_defillamaKey-` (plus l'empreinte Vite), importé par Réglages et le panneau DefiLlama Pro.
- Produit :
  - Le garde-fou vitest « client CryptoQuant chargé à la demande » (3 tests), exécuté par `pnpm check`.
  - La section `### Budget après B1` du rapport. Elle suit le format unique : ligne « Commande : », bloc ```json complet, puis lignes de delta et nom du chunk partagé du store. La revue B1 (tâche 17) et les tâches 19-20 la lisent comme mesure de fin de B1.
- Budget attendu :
  - Le store `store/cryptoquant.ts` est importé par Réglages, DES et le client. Il devient donc un chunk partagé, dont le nom entre dans `__vite__mapDeps` de l'entrée (précédent : `OiPerpsDexSection.tsx:15-17`, +37 o gzip).
  - Delta initial attendu : ≤ ~40 o gzip pour ce sous-lot.
  - Porte d'acceptation : ≤ ~150 o gzip sur l'ensemble de B1.
  - Seules les limites 1 220 000 bruts / 360 000 gzip bloquent le build.

- [ ] **Étape 1 : écrire le test qui échoue** — créer `apps/web/src/chunkCryptoquant.test.ts`. À ce stade, le fichier appelle des aides d'analyse que l'étape 3 ajoute :

```ts
/**
 * Garde-fou « chunk à la demande » du client CryptoQuant (spec 2026-09-16, invariant I11).
 *
 * `data/onchain/cryptoquant.ts` n'est chargé que par `import()` depuis les sections DES et
 * CHAIN. Un import statique hors de `data/onchain/` le ferait entrer dans un chunk partagé
 * dont le nom s'ajoute aux préchargements de l'entrée (budget initial bloquant). Les imports
 * de TYPES sont effacés à la compilation et restent permis ; un import mixte
 * (`import { a, type B }`) reste un import de valeur et est refusé. Le store de clé
 * `store/cryptoquant.ts` porte le même nom de fichier mais n'est pas le client. Les fichiers
 * de test ne sont pas bundlés : hors périmètre.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url)); // apps/web/src
describe("client CryptoQuant chargé à la demande", () => {
  it("détecte les imports de valeur et laisse passer types, import() et store homonyme", () => {
    const util = "components/fluxTakers.util.ts";
    expect(importsStatiquesDuClient(util, 'import { cheminSerie } from "../data/onchain/cryptoquant";')).toEqual([
      "components/fluxTakers.util.ts → ../data/onchain/cryptoquant",
    ]);
    expect(
      importsStatiquesDuClient(util, 'import { cheminSerie, type ArchiveCq } from "../data/onchain/cryptoquant";'),
    ).toHaveLength(1);
    expect(importsStatiquesDuClient(util, 'import "../data/onchain/cryptoquant.js";')).toHaveLength(1);
    expect(
      importsStatiquesDuClient(
        "components/onchain/MineursCotes.tsx",
        'export { chargerSerieCq } from "../../data/onchain/cryptoquant";',
      ),
    ).toHaveLength(1);
    expect(importsStatiquesDuClient(util, 'import type { ArchiveCq } from "../data/onchain/cryptoquant";')).toEqual([]);
    expect(
      importsStatiquesDuClient(util, 'import type {\n  ArchiveCq,\n  SerieCq,\n} from "../data/onchain/cryptoquant";'),
    ).toEqual([]);
    expect(importsStatiquesDuClient(util, 'const cq = await import("../data/onchain/cryptoquant");')).toEqual([]);
    // Un homonyme ailleurs n'est pas le client : ni `./onchain/cryptoquant`, ni le store de clé.
    expect(importsStatiquesDuClient(util, 'import { x } from "./onchain/cryptoquant";')).toEqual([]);
    expect(
      importsStatiquesDuClient(util, 'import { RAISON_CLE_CRYPTOQUANT } from "../store/cryptoquant";'),
    ).toEqual([]);
    // Un alias de type avant un vrai import ne masque pas ce dernier.
    expect(
      importsStatiquesDuClient(util, 'export type A = string;\nimport { cheminSerie } from "../data/onchain/cryptoquant";'),
    ).toHaveLength(1);
  });

  it("aucun fichier hors data/onchain/ n'importe statiquement le client", () => {
    const fautes = sources()
      .filter((f) => !f.startsWith("data/onchain/"))
      .flatMap((f) => importsStatiquesDuClient(f, readFileSync(join(SRC, f), "utf8")));
    expect(fautes).toEqual([]);
  });

  it("la section DES charge le client par import()", () => {
    const section = readFileSync(join(SRC, "components/FluxTakersSection.tsx"), "utf8");
    expect(section).toContain('await import("../data/onchain/cryptoquant")');
  });
});
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue**

```bash
pnpm --filter @axiom/web exec vitest run src/chunkCryptoquant.test.ts
```

Attendu :
- `ReferenceError: importsStatiquesDuClient is not defined` ;
- `ReferenceError: sources is not defined` ;
- `Tests  2 failed | 1 passed (3)`.

- [ ] **Étape 3 : implémentation minimale** — dans `apps/web/src/chunkCryptoquant.test.ts`, insérer le bloc ci-dessous entre deux lignes :
  - la ligne `const SRC = dirname(fileURLToPath(import.meta.url)); // apps/web/src` ;
  - la ligne `describe("client CryptoQuant chargé à la demande", () => {`.

Le bloc ignore :
- les imports et ré-exports de types seuls, y compris sur plusieurs lignes ;
- les `import()` dynamiques ;
- les homonymes situés dans un autre dossier, dont `store/cryptoquant`.

Il signale :
- les imports de valeur ;
- les imports mixtes (`import { a, type B }`) ;
- les imports à effet de bord ;
- les ré-exports.

Le scan exclut les fichiers `.test.`.

```ts
const CIBLE = "data/onchain/cryptoquant";
/** `import type { A } from "x"`, `import type * as M from "x"` et `export type { A } from "x"`, multi-lignes compris. */
const IMPORT_TYPE =
  /\b(?:import\s+type\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)|export\s+type\s*\{[^}]*\})\s*from\s*["'][^"']*["']/g;
/** Spécificateurs statiques : `from "x"` (import ou ré-export) et `import "x"` (effet de bord). */
const SPECIFIANT_STATIQUE = /\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g;

/** Chemin src-relatif, sans extension, d'un spécificateur relatif ; `null` pour un paquet. */
function resoudre(fichier: string, specifiant: string): string | null {
  if (!specifiant.startsWith(".")) return null;
  return posix.join(posix.dirname(fichier), specifiant).replace(/\.(ts|tsx|js)$/, "");
}

/** Imports statiques du client trouvés dans `texte` (fichier src-relatif, séparateurs « / »). */
function importsStatiquesDuClient(fichier: string, texte: string): string[] {
  const fautes: string[] = [];
  for (const m of texte.replace(IMPORT_TYPE, "").matchAll(SPECIFIANT_STATIQUE)) {
    const specifiant = m[1] ?? m[2];
    if (specifiant !== undefined && resoudre(fichier, specifiant) === CIBLE) fautes.push(`${fichier} → ${specifiant}`);
  }
  return fautes;
}

function sources(): string[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .map((f) => f.replace(/\\/g, "/"))
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes(".test."));
}
```

- [ ] **Étape 4 : lancer le test et vérifier qu'il passe, puis prouver qu'il mord**

```bash
pnpm --filter @axiom/web exec vitest run src/chunkCryptoquant.test.ts
```

Attendu : `Tests  3 passed (3)`.

Mutation temporaire : dans `apps/web/src/components/fluxTakers.util.ts`, ajoutez ces deux lignes juste sous la ligne `import type { ArchiveCq, LigneCq, LigneTaker, SerieCq } from "../data/onchain/cryptoquant";`. `cheminSerie` est une valeur réelle du client (tâche 9).

```ts
import { cheminSerie } from "../data/onchain/cryptoquant";
void cheminSerie;
```

```bash
pnpm --filter @axiom/web exec vitest run src/chunkCryptoquant.test.ts src/components/FluxTakersSection.test.tsx
```

Attendu : `Tests  2 failed | 17 passed (19)`, avec deux échecs :
- `AssertionError: expected [ Array(1) ] to deeply equal []`, sur le test « aucun fichier hors data/onchain/ n'importe statiquement le client » ;
- `AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times`, sur le test « client jamais évalué ».

Annulez ensuite la mutation et vérifiez :

```bash
git checkout -- apps/web/src/components/fluxTakers.util.ts
pnpm --filter @axiom/web exec vitest run src/chunkCryptoquant.test.ts src/components/FluxTakersSection.test.tsx
```

Attendu : `Tests  19 passed (19)`.

- [ ] **Étape 5 : construire et extraire le budget du journal**

```bash
mkdir -p logs
set -o pipefail; pnpm --filter @axiom/web build 2>&1 | tee logs/axiom-b1-build.log; echo "code de sortie du build : $?"
grep -c "cryptoquant.ts is dynamically imported" logs/axiom-b1-build.log
node --input-type=module - logs/axiom-b1-build.log apps/web/dist/budget-b1.json <<'EOF'
import { readFileSync, writeFileSync } from "node:fs";
const [journal, sortie] = process.argv.slice(2);
// Le build imprime le JSON du budget en dernier (`scripts/verifier-budget-build.mjs:180`,
// indentation de deux espaces) : on reprend le dernier objet de premier niveau, de la ligne
// « { » à la ligne « } » qui le ferme.
const lignes = readFileSync(journal, "utf8").split("\n");
const debut = lignes.lastIndexOf("{");
const fin = debut < 0 ? -1 : lignes.indexOf("}", debut);
if (fin < 0) throw new Error("JSON du budget introuvable dans le journal du build");
const budget = JSON.parse(lignes.slice(debut, fin + 1).join("\n"));
writeFileSync(sortie, `${JSON.stringify(budget, null, 2)}\n`);
console.log(`initial ${budget.initial.octetsBruts} bruts / ${budget.initial.octetsGzip} gzip`);
EOF
```

Attendu :
- `code de sortie du build : 0` (sinon arrêt, sans tenir compte de l'extraction qui suit), et le journal se termine sur le JSON du budget, sans `Erreur budget build` ;
- `grep -c` affiche `0` : Vite n'avertit pas que le client serait aussi importé statiquement. `grep` sort alors en code 1, ce qui est normal ;
- la dernière commande affiche une ligne qui commence par `initial` et donne les totaux bruts et gzip de l'initial. Elle écrit aussi `apps/web/dist/budget-b1.json`, qui contient le même JSON que le journal, bloc complet.

Les deux fichiers sont ignorés par git (`.gitignore:2` `dist/`, `.gitignore:5` `*.log`). Le dossier `logs/` n'est pas suivi : il est absent d'un worktree neuf, d'où le `mkdir -p logs`. Le JSON est écrit après le build, car Vite vide `dist/` au démarrage.

- [ ] **Étape 6 : contrôler le manifeste Vite**

```bash
node --input-type=module <<'EOF'
import { readFileSync } from "node:fs";
const CLIENT = "src/data/onchain/cryptoquant.ts";
const DES = "src/components/DerivativesWindow.tsx";
const manifeste = JSON.parse(readFileSync("apps/web/dist/.vite/manifest.json", "utf8"));
const entree = Object.keys(manifeste).find((id) => manifeste[id].isEntry === true);
if (entree === undefined) throw new Error("entrée absente du manifeste");
// Graphe STATIQUE de l'entrée (imports seulement, jamais dynamicImports).
const statiques = new Set();
const parcourir = (id) => {
  if (statiques.has(id)) return;
  statiques.add(id);
  for (const suivant of manifeste[id]?.imports ?? []) parcourir(suivant);
};
parcourir(entree);
const fautifs = [...statiques].filter(
  (id) => id === CLIENT || id === DES || /cryptoquant|FluxTakers/i.test(manifeste[id]?.file ?? id),
);
if (fautifs.length > 0) throw new Error(`graphe statique de l'entrée : ${fautifs.join(", ")}`);
// Aucun fichier du graphe initial ne contient le libellé de la section.
const initiauxAvecSection = [...statiques]
  .map((id) => manifeste[id].file)
  .filter((f) => readFileSync(`apps/web/dist/${f}`, "utf8").includes("Flux takers toutes places"));
if (initiauxAvecSection.length > 0) throw new Error(`section DES dans le bundle initial : ${initiauxAvecSection.join(", ")}`);
// Le client est une entrée dynamique, chargée par DES via import() et jamais statiquement.
if (manifeste[CLIENT]?.isDynamicEntry !== true) throw new Error("le client n'est pas une entrée dynamique");
if ((manifeste[DES]?.imports ?? []).includes(CLIENT)) throw new Error("DES importe le client statiquement");
if (!(manifeste[DES]?.dynamicImports ?? []).includes(CLIENT)) throw new Error("DES ne charge pas le client par import()");
// Le store de clé, importé par Réglages, DES et le client, forme un chunk partagé (clé
// `_cryptoquant-` suivie de l'empreinte) dont le nom entre dans `__vite__mapDeps` de l'entrée.
const storePartage = (manifeste[DES]?.imports ?? []).filter((id) => id.startsWith("_cryptoquant-"));
console.log(
  JSON.stringify({
    entree,
    grapheStatique: statiques.size,
    client: manifeste[CLIENT].file,
    des: manifeste[DES].file,
    storePartage: storePartage.map((id) => manifeste[id].file),
  }),
);
EOF
```

Attendu : une seule ligne JSON.
- `entree` vaut `index.html`.
- `client` est un fichier `assets/cryptoquant-` suivi de l'empreinte Vite.
- `des` est un fichier `assets/DerivativesWindow-` suivi de l'empreinte.
- `storePartage` est une liste d'**un** fichier `assets/cryptoquant-`, différent de `client` : c'est le store.

Toute ligne `Error:` bloque la suite : corrigez avant de continuer.

Une liste `storePartage` vide ne bloque pas : Rollup a alors placé le store ailleurs. L'étape 7 l'écrit « aucun », et il faut le signaler à l'orchestrateur.

Ne comparez jamais seulement les noms de fichiers : le manifeste liste aussi des entrées dynamiques importées statiquement par une autre fenêtre (c'est déjà le cas de `bgeometrics.ts` dans DES). Deux chunks portent en outre le nom `cryptoquant` : le client et le store.

- [ ] **Étape 7 : consigner la mesure dans le rapport** (format unique : section `### Budget après B1`, ligne « Commande : », bloc ```json complet, puis les lignes de lecture)

````bash
cat >> docs/superpowers/progress/2026-09-16-cryptoquant.md <<EOF

### Budget après B1

Commande : \`set -o pipefail; pnpm --filter @axiom/web build 2>&1 | tee logs/axiom-b1-build.log\` (poste local, commit \`$(git rev-parse --short HEAD)\` de la tâche 15 ; bloc extrait du journal par la tâche 16, étape 5)

\`\`\`json
$(cat apps/web/dist/budget-b1.json)
\`\`\`
EOF
node --input-type=module - docs/superpowers/progress/2026-09-16-cryptoquant.md apps/web/dist/.vite/manifest.json <<'EOF' >> docs/superpowers/progress/2026-09-16-cryptoquant.md
import { readFileSync } from "node:fs";
const [rapport, cheminManifeste] = process.argv.slice(2);
const texte = readFileSync(rapport, "utf8");
/** Bloc json complet placé sous « ### Budget <étape> » (format unique du rapport). */
const budget = (etape) => {
  const titre = texte.indexOf(`\n### Budget ${etape}\n`);
  const debut = titre < 0 ? -1 : texte.indexOf("```json\n", titre);
  const fin = debut < 0 ? -1 : texte.indexOf("\n```", debut + 8);
  if (fin < 0) throw new Error(`bloc json absent sous « ### Budget ${etape} »`);
  return JSON.parse(texte.slice(debut + 8, fin));
};
const avant = budget("avant B1");
const b13 = budget("après B1-3");
const b1 = budget("après B1");
const manifeste = JSON.parse(readFileSync(cheminManifeste, "utf8"));
const des = manifeste["src/components/DerivativesWindow.tsx"];
const store = (des?.imports ?? []).filter((id) => id.startsWith("_cryptoquant-")).map((id) => `\`${manifeste[id].file}\``);
const client = manifeste["src/data/onchain/cryptoquant.ts"];
const margeLocale = b1.limites.octetsGzip - b1.initial.octetsGzip;
const signe = (n) => (n > 0 ? `+${n}` : `${n}`);
const ecart = (a, b, champ) => signe(a.initial[champ] - b.initial[champ]);
console.log(
  [
    "",
    `- Delta initial : ${ecart(b1, b13, "octetsGzip")} gzip / ${ecart(b1, b13, "octetsBruts")} bruts depuis « après B1-3 » (attendu ≤ ~40 gzip : nom du chunk partagé du store dans \`__vite__mapDeps\`) ; ${ecart(b1, avant, "octetsGzip")} gzip / ${ecart(b1, avant, "octetsBruts")} bruts sur l'ensemble de B1 depuis « avant B1 » (porte d'acceptation ≤ ~150 gzip).`,
    `- Marge locale ${margeLocale} gzip ; marge runner estimée ${margeLocale - 1238} gzip (écart runner − local du 2026-09-16 : 356 635 − 355 397 = 1 238, \`docs/superpowers/progress/2026-09-16-indicateurs-et-fonctions-revue.md:49\` et \`:62\`). Seules les limites ${b1.limites.octetsBruts} bruts / ${b1.limites.octetsGzip} gzip bloquent le build.`,
    `- Chunk partagé du store (\`.vite/manifest.json\`, importé par DES) : ${store.length > 0 ? store.join(", ") : "**aucun** (signalé à l'orchestrateur)"}.`,
    `- Client CryptoQuant : \`${client?.file ?? "ABSENT"}\`, entrée dynamique chargée par DES via \`import()\`, hors du graphe statique de l'entrée ; aucun fichier initial ne contient « Flux takers toutes places » ; garde-fou \`apps/web/src/chunkCryptoquant.test.ts\` vert.`,
  ].join("\n"),
);
EOF
awk '/^### Budget après B1$/ { f = 1 } f' docs/superpowers/progress/2026-09-16-cryptoquant.md
````

Attendu :
- `awk` affiche la section `### Budget après B1`, dernière du rapport, dans cet ordre :
  - la ligne « Commande : » ;
  - le bloc ```json complet ;
  - quatre lignes : « Delta initial », « Marge locale », « Chunk partagé du store », « Client CryptoQuant ».
- Le script ne lève aucune erreur `bloc json absent`. Si elle apparaît, une section antérieure (tâche 1 ou tâche 8) ne suit pas le format unique : corrigez-la avant de continuer.
- La ligne « Client CryptoQuant » ne contient pas `ABSENT`.

**Budget : ce qui bloque et ce qui se tranche à la revue.**
- **Bloquant** : le build de l'étape 5 échoue (`Erreur budget build`, au-delà de 1 220 000 bruts ou de 360 000 gzip). Dans ce cas : arrêt, pas de commit, retour à l'orchestrateur.
- **Porte d'acceptation, tranchée à la revue B1 (tâche 17, point D)** : quatre signaux à surveiller.
  - Le delta sur l'ensemble de B1 dépasse ~150 gzip.
  - Le delta de ce sous-lot dépasse nettement ~40 gzip.
  - Le chunk partagé du store vaut « aucun ».
  - La marge runner estimée passe sous ~3 000 gzip.

  Dans ces cas, la mesure est tout de même commitée telle quelle, et l'écart est signalé à l'orchestrateur avant la tâche 17. L'orchestrateur tranche (spec I11).

Pour mémoire, le build de `main` au 2026-09-16 20:44 (après le lot A) mesurait déjà 355 591 gzip, soit une marge runner estimée d'environ 3 171 avant tout ajout.

- [ ] **Étape 8 : commit**

```bash
git add apps/web/src/chunkCryptoquant.test.ts docs/superpowers/progress/2026-09-16-cryptoquant.md
git commit -m "test(budget): garde-fou du client CryptoQuant à la demande et mesure du budget après B1" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

### Tâche 17 : e2e hermétique `des-flux-takers`, CI et point de revue B1

**Fichiers :**
- Créer : `apps/web/e2e/des-flux-takers.e2e.ts`
- Modifier : `scripts/ci.sh:22`
- Modifier : `docs/superpowers/progress/2026-09-16-cryptoquant.md` (sections `## Porte locale B1` et `## Revue indépendante B1` en fin de fichier)
- Tester : `apps/web/e2e/des-flux-takers.e2e.ts`

**Interfaces :**
- Consomme :
  - `bouchonnerReseau(page)` (`apps/web/e2e/helpers/reseau-bouchonne.ts:9`) et le port `AXIOM_E2E_PORT` (`apps/web/e2e/origine.ts:2`).
  - La surface DOM de la tâche 15.
  - La clé localStorage `axiom:cryptoquant:key` (tâche 6), lue en chaîne brute comme `store/ccdata.ts:7`.
  - La clé d'archive `axiom:onchain:cq:taker:spot:btc:v1` et le format `ArchiveCq` v1 (tâches 9-13).
  - Les chemins de `cheminSerie` : `/cqapi/v2/market/cq/spot/trade` et `/cqapi/v2/market/cq/swap/trade`, avec `symbol=btc_all` ou `symbol=eth_all`, puis `window=day&limit=30`.
  - Deux raisons produites par le client (tâche 13), vérifiées par des regex tolérantes :
    - « Quota CryptoQuant atteint (429) ; nouvel essai dans 30 s. » ;
    - `RAISON_CLE_REFUSEE_CRYPTOQUANT` = « Clé CryptoQuant refusée (Réglages ⚙). ».
  - Deux comportements du client (tâches 12-13) :
    - Après un 401, le refus est mémorisé pour la version de clé courante : les trois séries suivantes répondent `cle-requise` **sans appel**.
    - Après un 429, les trois séries suivantes répondent `quota` sans appel. L'horloge figée ne laisse jamais passer `repriseTs`.
- Produit :
  - La spec e2e, ajoutée à `pnpm check:e2e` (`package.json:18`), que la CI GitHub exécute (`.github/workflows/ci.yml:85-86`).
  - Les sections `## Porte locale B1` et `## Revue indépendante B1` du rapport.
- Fixtures :
  - 30 lignes descendantes par série, du 2026-09-15 au 2026-08-17.
  - Le spot BTC n'a ni le 2026-09-01 ni le 2026-09-02, soit 28 jours.
  - L'horloge est figée au 2026-09-16T12:00Z.

- [ ] **Étape 1 : écrire le test qui échoue** — créer `apps/web/e2e/des-flux-takers.e2e.ts` :

```ts
import { expect, test, type Page } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

/**
 * DES : section « Flux takers toutes places » (CryptoQuant BASIC, clé personnelle, archive
 * côté client). Réseau bouchonné, horloge figée au 2026-09-16 12:00 UTC (J-1 = 2026-09-15),
 * clé factice posée avant le chargement. Vérifie : quatre appels au MONTAGE de la fenêtre
 * alors que la section est repliée ; requêtes `window=day&limit=30` sans `from`/`to`, clé en
 * en-tête seulement ; aucun appel sur les segmentés, le changement de source ni la
 * réouverture (J-1 archivé) ; archive locale fusionnée sans doublon ; 429 et 401 affichés
 * après un seul appel, sans perdre ni réécrire l'archive.
 *
 * L'horloge figée gèle `Date.now()` : la fenêtre glissante 10 req/min ne se purge jamais,
 * d'où une spec séparée de CHAIN (4 appels ici, 9 là-bas, chacun sous 10). Le cas « sans
 * clé » n'est pas hermétique en e2e (le serveur de dev lit apps/web/.env) : il est couvert
 * en unitaire.
 */
const CLE = "CLE-E2E-FACTICE";
const CLE_ARCHIVE_SPOT_BTC = "axiom:onchain:cq:taker:spot:btc:v1";
const JOUR_MS = 86_400_000;
const J_MOINS_1 = Date.UTC(2026, 8, 15);
const EXCLUS_SPOT_BTC = new Set(["2026-09-01", "2026-09-02"]);

type Marche = "spot" | "swap";
type Symbole = "btc_all" | "eth_all";

/** Dernier jour de chaque série : des ratios distincts pour suivre les segmentés à l'écran. */
const DERNIERS: Record<`${Marche}:${Symbole}`, { bsr: number; qv: number }> = {
  "spot:btc_all": { bsr: 0.9802, qv: 12_007_360_401.32 },
  "spot:eth_all": { bsr: 1.0417, qv: 5_430_000_000 },
  "swap:btc_all": { bsr: 0.9533, qv: 61_200_000_000 },
  "swap:eth_all": { bsr: 1.1234, qv: 27_800_000_000 },
};

const jourIso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Ligne fournisseur `market/cq/{spot,swap}/trade` (champs du sondage du 2026-09-16). */
function ligneFournisseur(marche: Marche, symbole: Symbole, t: number) {
  const { bsr, qv } = t === J_MOINS_1 ? DERNIERS[`${marche}:${symbole}`] : { bsr: 1, qv: 11_500_000_000 };
  const br = bsr / (1 + bsr);
  return {
    datetime: `${jourIso(t)} 00:00:00`,
    symbol: symbole,
    base: symbole.slice(0, 3),
    quote: "all",
    trade_count: 12_099_486,
    base_volume: 156_928.13,
    quote_volume: qv,
    base_buy_volume: 77_681.2,
    quote_buy_volume: qv * br,
    base_sell_volume: 79_246.93,
    quote_sell_volume: qv * (1 - br),
    vwap: symbole === "btc_all" ? 76_515.03 : 2_450.5,
    buy_ratio: br,
    sell_ratio: 1 - br,
    buy_sell_ratio: bsr,
    buy_count: 6_133_017,
    sell_count: 5_966_469,
    ...(marche === "swap" ? { inverse: false } : {}),
  };
}

/** Enveloppe de 30 jours, du plus récent au plus ancien (ordre fournisseur) ; spot BTC troué. */
function reponseFournisseur(marche: Marche, symbole: Symbole) {
  const data = Array.from({ length: 30 }, (_, i) => J_MOINS_1 - i * JOUR_MS)
    .filter((t) => !(marche === "spot" && symbole === "btc_all" && EXCLUS_SPOT_BTC.has(jourIso(t))))
    .map((t) => ligneFournisseur(marche, symbole, t));
  return { status: { code: 200, message: "success" }, result: { window: "DAY", data } };
}

/** Archive spot BTC d'une session antérieure : dix jours du 2026-08-07 au 2026-08-16. */
function archivePrealable() {
  const jours: Record<string, Record<string, number>> = {};
  for (let i = 1; i <= 10; i++) {
    jours[jourIso(Date.UTC(2026, 7, 17) - i * JOUR_MS)] = {
      n: 11_000_000,
      bv: 150_000,
      qv: 11_000_000_000,
      bbv: 75_000,
      qbv: 5_400_000_000,
      bsv: 75_000,
      qsv: 5_600_000_000,
      vwap: 75_000,
      br: 0.4909,
      bsr: 0.9643,
      bc: 5_500_000,
      sc: 5_500_000,
    };
  }
  return { version: 1, serie: "taker:spot:btc", majTs: Date.UTC(2026, 7, 17, 6), jours };
}

interface Appel {
  url: string;
  authorization: string | undefined;
}

interface Reponse {
  status: number;
  headers?: Record<string, string>;
  json: unknown;
}

async function preparer(
  page: Page,
  options: { archive?: boolean; reponse?: (marche: Marche, symbole: Symbole) => Reponse } = {},
): Promise<Appel[]> {
  await bouchonnerReseau(page);
  await page.clock.setFixedTime(new Date("2026-09-16T12:00:00Z"));
  await page.addInitScript(
    ({ cle, cleArchive, archive }) => {
      localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
      localStorage.setItem("axiom:cryptoquant:key", cle);
      if (archive !== null) localStorage.setItem(cleArchive, archive);
    },
    {
      cle: CLE,
      cleArchive: CLE_ARCHIVE_SPOT_BTC,
      archive: options.archive === true ? JSON.stringify(archivePrealable()) : null,
    },
  );
  const appels: Appel[] = [];
  await page.route(
    (url) => url.pathname.startsWith("/cqapi/v2/market/cq/"),
    (route) => {
      const requete = route.request();
      const url = new URL(requete.url());
      appels.push({ url: requete.url(), authorization: requete.headers()["authorization"] });
      const marche: Marche = url.pathname.includes("/swap/") ? "swap" : "spot";
      const symbole: Symbole = url.searchParams.get("symbol") === "eth_all" ? "eth_all" : "btc_all";
      const reponse = options.reponse?.(marche, symbole) ?? { status: 200, json: reponseFournisseur(marche, symbole) };
      return route.fulfill(reponse);
    },
  );
  return appels;
}

async function ouvrirDes(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Produits dérivés" }).click();
  const des = page.getByRole("complementary", { name: "Produits dérivés" });
  const bouton = des.getByRole("button", { name: /Flux takers toutes places/i });
  const section = des
    .locator("section")
    .filter({ has: page.getByRole("button", { name: /Flux takers toutes places/i }) });
  return { des, bouton, section };
}

async function lireArchive(page: Page): Promise<string | null> {
  return page.evaluate((cle) => localStorage.getItem(cle), CLE_ARCHIVE_SPOT_BTC);
}

test("DES : flux takers chargés au montage (4 appels), repliés par défaut, sans appel sur segmentés, source ni réouverture", async ({ page }) => {
  const appels = await preparer(page);
  const { des, bouton, section } = await ouvrirDes(page);

  // Chargement au MONTAGE : la section reste repliée, l'en-tête résume l'archive.
  await expect(bouton).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => appels.length).toBe(4);
  await expect(bouton).toContainText("archive 28 j · J-1 2026-09-15");
  await expect(section).not.toContainText("Ratio taker");

  // Requêtes : les quatre séries, fenêtre journalière de 30 lignes, jamais from/to ; la clé
  // voyage dans l'en-tête Authorization, jamais dans l'URL.
  const series = appels.map((a) => {
    const u = new URL(a.url);
    return `${u.pathname}?${u.searchParams.get("symbol")}`;
  });
  expect(series.sort()).toEqual([
    "/cqapi/v2/market/cq/spot/trade?btc_all",
    "/cqapi/v2/market/cq/spot/trade?eth_all",
    "/cqapi/v2/market/cq/swap/trade?btc_all",
    "/cqapi/v2/market/cq/swap/trade?eth_all",
  ]);
  for (const appel of appels) {
    const u = new URL(appel.url);
    expect(u.searchParams.get("window")).toBe("day");
    expect(u.searchParams.get("limit")).toBe("30");
    expect(u.searchParams.has("from")).toBe(false);
    expect(u.searchParams.has("to")).toBe(false);
    expect(appel.url).not.toContain(CLE);
    expect(appel.authorization).toBe(`Bearer ${CLE}`);
  }

  // Dépliage : lectures du spot BTC.
  await bouton.click();
  await expect(bouton).toHaveAttribute("aria-expanded", "true");
  await expect(section).toContainText("0.98");
  await expect(section).toContainText("$12.01B");
  await expect(section).toContainText("observation 2026-09-15 (J-1)");
  await expect(section).toContainText("Archive locale depuis 2026-08-17");
  await expect(section).toContainText("2 manquants dans la fenêtre");
  await expect(section).toContainText("composition non documentée");
  await expect(section.getByRole("img", { name: "Ratio taker achat/vente quotidien" })).toBeVisible();

  // Segmentés : lecture des archives déjà chargées, aucun appel.
  await section.getByRole("button", { name: "ETH", exact: true }).click();
  await expect(section).toContainText("1.04");
  await section.getByRole("button", { name: "Perp", exact: true }).click();
  await expect(section).toContainText("1.12");
  await expect(section).toContainText("champ inverse non documenté");
  await section.getByRole("button", { name: "BTC", exact: true }).click();
  await expect(section).toContainText("0.95");
  await page.waitForTimeout(300);
  expect(appels).toHaveLength(4);

  // Archive locale : 28 jours (spot BTC sans le 1er ni le 2 septembre), version 1, sans la clé.
  const brut = await lireArchive(page);
  expect(brut).not.toBeNull();
  expect(brut).not.toContain(CLE);
  const archive = JSON.parse(brut ?? "{}") as { version?: number; jours?: Record<string, unknown> };
  expect(archive.version).toBe(1);
  expect(Object.keys(archive.jours ?? {})).toHaveLength(28);
  expect(Object.keys(archive.jours ?? {})).not.toContain("2026-09-01");
  expect(Object.keys(archive.jours ?? {})).toContain("2026-09-15");

  // Source hors Binance : la branche Coinalyze bascule, la section reste en place.
  await page.getByRole("combobox", { name: "Source" }).selectOption("bybit");
  await expect(des).toContainText("Binance uniquement");
  await expect(section).toContainText("0.95");
  expect(appels).toHaveLength(4);

  // Fermeture puis réouverture : J-1 archivé pour les quatre séries → aucun appel.
  await des.getByTitle("Fermer").click();
  await expect(des).toHaveCount(0);
  await page.getByRole("button", { name: "Produits dérivés" }).click();
  await expect(bouton).toHaveAttribute("aria-expanded", "false");
  await expect(bouton).toContainText("J-1 2026-09-15");
  await page.waitForTimeout(300);
  expect(appels).toHaveLength(4);
});

test("DES : archive locale antérieure fusionnée sans doublon (début 2026-08-07)", async ({ page }) => {
  const appels = await preparer(page, { archive: true });
  const { bouton, section } = await ouvrirDes(page);
  await expect.poll(() => appels.length).toBe(4);
  await bouton.click();
  await expect(section).toContainText("Archive locale depuis 2026-08-07");
  await expect(section).toContainText("38 j archivés");
  await expect(section).toContainText("0.98");

  const brut = (await lireArchive(page)) ?? "";
  const dates = brut.match(/"\d{4}-\d{2}-\d{2}"/g) ?? [];
  expect(dates).toHaveLength(38);
  expect(new Set(dates).size).toBe(dates.length);
  expect(dates).toContain('"2026-08-07"');
  expect(dates).toContain('"2026-09-15"');
});

test("DES : 429 CryptoQuant — délai de reprise affiché, archive servie et non réécrite", async ({ page }) => {
  const appels = await preparer(page, {
    archive: true,
    reponse: () => ({
      status: 429,
      headers: { "x-ratelimit-limit": "10", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "30" },
      json: { status: { code: 429, message: "Too Many Requests" } },
    }),
  });
  const { bouton, section } = await ouvrirDes(page);

  await expect(bouton).toContainText("quota atteint, reprise 30 s");
  await bouton.click();
  await expect(section).toContainText(/nouvel essai dans 30 s/);
  await expect(section).toContainText("Archive locale depuis 2026-08-07");
  await expect(section).toContainText("0.96");
  await expect(section).toContainText("cache ou observation périmé");
  await expect(section).toContainText("J-1 en attente de publication");

  // Spec §4.3 étape 4 : après le 429, les trois autres séries répondent « quota » sans appel.
  await page.waitForTimeout(300);
  expect(appels).toHaveLength(1);
  // 429 : aucune écriture de l'archive — toujours les dix mêmes jours et le même majTs.
  const apres = JSON.parse((await lireArchive(page)) ?? "{}") as { majTs?: number; jours?: Record<string, unknown> };
  expect(apres.majTs).toBe(archivePrealable().majTs);
  expect(Object.keys(apres.jours ?? {}).sort()).toEqual(Object.keys(archivePrealable().jours).sort());
});

test("DES : 401 CryptoQuant — clé refusée affichée avec l'accès aux Réglages, un seul appel, rien d'archivé", async ({ page }) => {
  const appels = await preparer(page, {
    reponse: () => ({ status: 401, json: { erreur: "clé CryptoQuant personnelle requise" } }),
  });
  const { bouton, section } = await ouvrirDes(page);

  await expect.poll(() => appels.length).toBe(1);
  await expect(bouton).toContainText("clé CryptoQuant refusée");
  await bouton.click();
  await expect(section).toContainText(/Clé CryptoQuant refusée/);
  await expect(section.getByRole("button", { name: "Ouvrir les réglages ⚙" })).toBeVisible();
  // Refus mémorisé pour la version de clé : les trois autres séries répondent sans appel.
  await page.waitForTimeout(300);
  expect(appels).toHaveLength(1);
  expect(appels.every((a) => !a.url.includes(CLE))).toBe(true);
  expect(await lireArchive(page)).toBeNull();
});
```

- [ ] **Étape 2 : vérifier qu'il échoue sans la section** — dans `apps/web/src/components/DerivativesWindow.tsx`, remplacez temporairement la ligne `          <SectionFluxTakers onOuvrirReglages={openSettingsFromWindow} />` par `          {null}`, puis lancez :

```bash
AXIOM_E2E_PORT=5239 pnpm --filter @axiom/web exec playwright test des-flux-takers
```

Attendu : `4 failed`.
- Les tests 1 et 3 échouent car `getByRole('button', { name: /Flux takers toutes places/i })` ne trouve aucun élément.
- Les tests 2 et 4 échouent car `expect.poll` reçoit 0 appel.

Rétablissez ensuite le fichier :

```bash
git checkout -- apps/web/src/components/DerivativesWindow.tsx
```

- [ ] **Étape 3 : lancer le test et vérifier qu'il passe**

```bash
AXIOM_E2E_PORT=5239 pnpm --filter @axiom/web exec playwright test des-flux-takers
AXIOM_E2E_PORT=5239 pnpm --filter @axiom/web exec playwright test des-oi-perps-dex
```

Attendu :
- `4 passed` pour `des-flux-takers` ;
- `2 passed` pour la spec voisine `des-oi-perps-dex`.

- [ ] **Étape 4 : ajouter la spec à la CI** — dans `scripts/ci.sh`, ligne 22, remplacer :

```bash
    niveaux-chart omon-lectures-options revue-cycle term-portage-tbill des-oi-perps-dex
```

par :

```bash
    niveaux-chart omon-lectures-options revue-cycle term-portage-tbill des-oi-perps-dex des-flux-takers
```

- [ ] **Étape 5 : lancer la sélection e2e complète**

```bash
pnpm check:e2e
```

Attendu : tout est vert, soit `77 passed`. C'est 73 parcours au 2026-09-16 (`docs/superpowers/progress/2026-09-16-indicateurs-et-fonctions-revue.md:57`), plus les 4 nouveaux.

- [ ] **Étape 6 : commit**

```bash
git add apps/web/e2e/des-flux-takers.e2e.ts scripts/ci.sh
git commit -m "test(e2e): DES flux takers toutes places — montage, archive, 429 et 401 hermétiques" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Étape 7 : POINT DE REVUE B1 — porte locale complète, consignée dans le rapport**

Lancer les deux portes, sorties conservées dans `logs/`. Le dossier n'est pas suivi par git : `mkdir -p logs` le crée au besoin. `*.log` est ignoré (`.gitignore:5`). `NO_COLOR=1` évite les codes couleur dans les journaux.

```bash
mkdir -p logs
set -o pipefail; NO_COLOR=1 pnpm check 2>&1 | tee logs/axiom-b1-check.log
set -o pipefail; NO_COLOR=1 pnpm check:e2e 2>&1 | tee logs/axiom-b1-e2e.log
```

Attendu :
- la première commande se termine par `==> [ci] OK`, en code 0 ;
- la seconde affiche `77 passed`, en code 0.

Si l'une échoue, **arrêt**, sans rien consigner : retour à la tâche fautive.

Consigner ensuite la section `## Porte locale B1`. Le script extrait des journaux les seules lignes de résumé, en retirant les codes ANSI résiduels. Il ajoute l'historique des commits et le bilan des fichiers depuis `2d45426`, le commit initial de la spec. La liste comprend donc aussi le commit de la spec amendée (§12) et du plan.

````bash
node --input-type=module - logs/axiom-b1-check.log logs/axiom-b1-e2e.log <<'EOF' >> docs/superpowers/progress/2026-09-16-cryptoquant.md
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const [journalCheck, journalE2e] = process.argv.slice(2);
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trimEnd().split("\n");
/** Lignes de résumé d'un journal, codes ANSI retirés. */
const resume = (fichier, motif) =>
  readFileSync(fichier, "utf8")
    .replace(/\[[0-9;]*m/g, "")
    .split("\n")
    .filter((ligne) => motif.test(ligne))
    .map((ligne) => ligne.trimEnd());
const bloc = (titre, lignes) => ["", titre, "", "```text", ...lignes, "```"];
console.log(
  [
    "",
    "## Porte locale B1",
    "",
    `Commit \`${git("rev-parse", "--short", "HEAD")[0]}\`, base \`2d45426\` (commit initial de la spec ; la liste inclut la spec amendée et le plan).`,
    ...bloc(
      "Commande : `set -o pipefail; NO_COLOR=1 pnpm check 2>&1 | tee logs/axiom-b1-check.log`",
      resume(journalCheck, /==> \[ci\]|Test Files|Tests\s+\d|\d+ (pass|fail)\b|Ran \d+ tests|Erreur budget build/),
    ),
    ...bloc(
      "Commande : `set -o pipefail; NO_COLOR=1 pnpm check:e2e 2>&1 | tee logs/axiom-b1-e2e.log`",
      resume(journalE2e, /\d+ (passed|failed|flaky|skipped|did not run)\b/),
    ),
    ...bloc("Commande : `git log --oneline 2d45426..HEAD`", git("log", "--oneline", "2d45426..HEAD")),
    ...bloc("Commande : `git diff --stat 2d45426..HEAD`", git("diff", "--stat", "2d45426..HEAD")),
  ].join("\n"),
);
EOF
awk '/^## Porte locale B1$/ { f = 1 } f' docs/superpowers/progress/2026-09-16-cryptoquant.md
````

Attendu : `awk` affiche la section `## Porte locale B1`, qui contient dans l'ordre :
- la ligne du commit ;
- un bloc `text` pour `pnpm check`, qui porte :
  - les quatre lignes `==> [ci]` (`typecheck`, `test`, `build @axiom/web`, `OK`) ;
  - les résumés `Test Files` et `Tests` de Vitest ;
  - les résumés `pass` / `fail` de Bun, tous à `0 fail` ;
  - aucune ligne `Erreur budget build` ;
- un bloc `text` pour `pnpm check:e2e`, avec `77 passed` ;
- la liste des commits depuis la spec : spec amendée et plan, puis tâches 1 à 17, étape 6 comprise ;
- le bilan `git diff --stat` depuis `2d45426`.

- [ ] **Étape 8 : POINT DE REVUE B1 — revue indépendante**

Cette étape revient au rôle **Réviseur** : la sécurité est revue systématiquement (`.devin/provider-rules.md:34`). Le réviseur est un agent qui n'a écrit aucune des tâches 1 à 17 (`.devin/provider-rules.md:51`).

Il procède en trois temps :
1. il lance le bloc de commandes ci-dessous, qui écrit toutes les sorties dans `logs/axiom-b1-revue.log` ;
2. il compare chaque sortie à l'attendu de la checklist ;
3. il consigne son verdict avec le gabarit qui suit.

**Checklist (identifiant, contrôle, attendu)**

**A. Fuite de clé**
- [ ] **A1** — aucun repli serveur sur Vercel. Attendu : aucune ligne `CRYPTOQUANT_API_KEY` dans `api/` ni `vercel.json`, `(code 1)`.
- [ ] **A2** — une seule lecture d'environnement dans la politique Vercel. Attendu : `api/_policy.ts:1`.
- [ ] **A3** — le test structurel « utilise une seule fonction Web Standard et des utilitaires non exposés » est identique aux lignes 34-46 d'origine de `apps/daemon/src/vercelProxy.test.ts`. Attendu : aucune différence, `(code 0)`.
- [ ] **A4** — usages du store de clé dans `apps/web/src/components`. Attendu : ces lignes, et seulement elles :
  - `FluxTakersSection.tsx` :
    - la ligne d'import `import { cryptoquantKeyStore, messageSansCleCq, RAISON_CLE_CRYPTOQUANT } from "../store/cryptoquant";` ;
    - `const version = useStore(cryptoquantKeyStore, (s) => s.version);`.
  - `SettingsPanel.tsx` :
    - la ligne d'import `import { cryptoquantKeyStore } from "../store/cryptoquant";` ;
    - les trois `useStore(cryptoquantKeyStore, (s) => s.hasKey)`, `s.setKey` et `s.clearKey`.
  - `SettingsPanel.cryptoquant.test.ts` (test structurel de la tâche 8) :
    - les quatre `expect(SOURCE).toContain(...)` qui recopient la ligne d'import et les trois `useStore` ;
    - `expect(SOURCE).not.toContain("getCryptoquantKey");`.

  Aucun `getCryptoquantKey` dans un composant non-test.
- [ ] **A5** — `getCryptoquantKey` hors du store et du client. Attendu : une seule ligne, `expect(SOURCE).not.toContain("getCryptoquantKey");` dans `apps/web/src/components/SettingsPanel.cryptoquant.test.ts`. Aucune ligne dans un fichier non-test.
- [ ] **A6** — marqueur des tests de fuite. Attendu : `CLE-TEST-SECRETE` est présent dans `apps/web/src/store/cryptoquant.test.ts`, dans `apps/web/src/store/persist.test.ts` et dans au moins un test de `apps/web/src/data/onchain/` (tâche 13). Ces tests sont verts en C1.
- [ ] **A7** — la clé ne voyage que dans l'en-tête. Attendu dans `apps/web/src/data/onchain/cryptoquant.ts` :
  - une seule ligne de code avec `Authorization`, `if (cle !== null) headers["Authorization"] = \`Bearer ${cle}\`;`, plus d'éventuels commentaires ;
  - aucun `console.`.

  Le réviseur relit `chargerSerieCq` : la clé n'apparaît ni dans une URL, ni dans une `raison`, ni dans l'archive, ni dans le KV.
- [ ] **A8** — drapeau de repli. Attendu dans `apps/web/vite.config.ts` :
  - `const CQ_CLE_ENV = !isVercelBuild && CRYPTOQUANT_API_KEY !== "";` ;
  - `__CQ_CLE_ENV__: JSON.stringify(CQ_CLE_ENV),`.

  Le `define` ne porte donc qu'un booléen, gardé par `isVercelBuild`.
- [ ] **A9** — le test e2e 1 vérifie la clé. Attendu : trois lignes de `apps/web/e2e/des-flux-takers.e2e.ts` :
  - `expect(appel.url).not.toContain(CLE);` ;
  - ``expect(appel.authorization).toBe(`Bearer ${CLE}`);`` ;
  - `expect(brut).not.toContain(CLE);`.

**B. Politique de route (trois proxys)**
- [ ] **B1** — tests Bun du module partagé, du daemon et de Vercel. Attendu : `0 fail`, `(code 0)`.
- [ ] **B2** — tests du proxy de dev Vite (`bypassPour("/cqapi")`, réécriture, drapeau). Attendu : tous verts, `(code 0)`.
- [ ] **B3** — liste fermée portée par le seul `shared/cryptoquant-proxy.ts`.
  - `api/_policy.ts`, `apps/daemon/src/proxy.ts` et `apps/web/vite.config.ts` importent et appellent `cheminCryptoQuantAmont`.
  - Le module partagé définit les symboles `btc_all`/`eth_all`, `window` obligatoire et `limit` 1..30. `from`, `to`, une clé inconnue, un doublon ou une casse différente sont refusés : la table exhaustive de `apps/daemon/src/cryptoquantProxy.test.ts` le fige, et B1 l'a exécutée.
- [ ] **B4** — réponses locales et en-têtes.
  - Chaque proxy montre `private, no-store`.
  - `api/_policy.ts` fixe `maxRedirects` à 0 pour `cqapi`, et `apps/daemon/src/proxy.ts` passe `maxRedirections: 0`.
  - `api/proxy.ts` et `apps/daemon/src/proxy.ts` recopient `x-ratelimit-limit`, `x-ratelimit-remaining` et `x-ratelimit-reset`.
  - Les tests exécutés en B1 et B2 figent le reste :
    - 401 local **avant tout fetch** (Vercel : « GET sans Authorization : 401 local, y compris avec des variables serveur » ; handler : « sans clé personnelle : 401 local et zéro appel, malgré la variable serveur ») ;
    - 404 hors liste (« 404 pour tout chemin ou paramètre hors liste fermée ») ;
    - 405 `allow: GET` (« POST et HEAD : 405 allow GET, avec ou sans clé ») ;
    - corps et quotas relayés (« 429 amont : statut, trois en-têtes de quota et corps relayés, réponse privée ») ;
    - refus 405/403/404/401 du daemon avant tout fetch (`proxy.test.ts`).
- [ ] **B5** — aucun cache proxy. Attendu :
  - aucune ligne `cqapi` dans `apps/daemon/src/cache.ts` ;
  - dans `apps/daemon/src/cache.test.ts`, le test « /cqapi n'est jamais mis en cache : la clé de cache ignore Authorization » et ses assertions `ttlMsPourChemin("/cqapi/v2/market/cq/spot/trade")` et `ttlMsPourChemin("/cqapi/v1/btc/miner-data/companies")` valant 0.
- [ ] **B6** — `shared/extapi-hosts.ts` et `apps/daemon/src/cache.ts` inchangés depuis `2d45426`. Attendu : aucune sortie.
- [ ] **B7** — `vercel.json`. Attendu :
  - le diff n'ajoute que les rewrites `/cqapi/:path*` et `/cqapi/:path*/`, placés avant le repli `/(.*)` ;
  - aucune ligne **ajoutée ou retirée** ne contient `Content-Security-Policy` : le second contrôle affiche `0`, `(code 1)`. Une ligne de contexte du diff ne compte pas.

**C. Fusion d'archive**
- [ ] **C1** — client et stores (I1 à I8, I10). Attendu : tous verts, `(code 0)`.
- [ ] **C2** — écritures gardées du client. Hors import et commentaires, `setItem(` et `kvPut` n'apparaissent que dans l'écriture de l'archive, avec trois gardes :
  - jamais pour une version inconnue : `chargerSerieCq` rend avant toute écriture ;
  - jamais de `kvPut` après une lecture KV en erreur ;
  - jamais de `kvPut` au-delà de 900 000 caractères.

  Aucun `removeItem`. Le réviseur relit aussi le client :
  - aucun jour n'est jamais supprimé ;
  - une réponse vide laisse `jours` et `majTs` inchangés ;
  - un 429, 401, 403 ou une erreur réseau n'écrit rien ;
  - en cas de conflit, l'union local ∪ KV garde la copie au `majTs` le plus grand ;
  - chaque série a sa propre clé de stockage.
- [ ] **C3** — e2e de la tâche 17. Attendu : `4 passed`. Le test 2 prouve l'union sans doublon (38 dates uniques). Le test 3 prouve que l'archive garde ses dix jours et son `majTs` après un 429. Le test 4 prouve un seul appel après un 401.
- [ ] **C4** — `axiom:onchain:cq:` figure dans `resteSurLePoste` de `apps/web/src/store/persist.ts`.
- [ ] **C5** — `axiom:cryptoquant:key` figure dans `CLES_CREDENTIALS_LOCALES` de `apps/web/src/store/persist.ts`.

**D. Budget**
- [ ] **D1** — le rapport contient les trois sections `### Budget avant B1`, `### Budget après B1-3` et `### Budget après B1`, ainsi que les lignes « Delta initial », « Marge locale », « Chunk partagé du store » et « Client CryptoQuant » de la tâche 16. Le réviseur vérifie :
  - initial ≤ 1 220 000 bruts et ≤ 360 000 gzip (bloquant) ;
  - delta sur l'ensemble de B1 ≤ ~150 gzip (porte d'acceptation) ;
  - delta du sous-lot ≤ ~40 gzip ;
  - chunk partagé du store nommé ;
  - marge runner estimée consignée. Sous ~3 000 gzip, c'est un écart à faire trancher par l'orchestrateur.
- [ ] **D2** — reconstruction et contrôle du manifeste sur le build courant. Attendu :
  - build en `(code 0)` ;
  - `grep -c` à `0` ;
  - une ligne JSON de manifeste, sans aucune ligne `Error:`, avec `storePartage` à un fichier.
- [ ] **D3** — garde-fou du chunk et vues. Attendu : `Test Files  3 passed` et `Tests  31 passed`.

**E. Affichage et périmètre**
- [ ] **E1** — lectures fournisseur :
  - `qbv`/`qsv` n'apparaissent, hors tests, que sur deux lignes de `fluxTakers.util.ts` : `somme += l.qbv - l.qsv;` et `deltaQuote: fini(ligne.qbv - ligne.qsv),`. Ce sont des lectures d'une seule série, donc spot et perp ne sont jamais additionnés.
  - Dans `fluxTakers.util.ts`, `bsr` et `vwap` ne sont que lus : `fini(ligne.bsr)`, `fini(l.bsr)`, `l.bsr`, `ligne.bsr`, `fini(ligne.vwap)`, le test de forme `"bsr" in ligne`, le champ `vwap: number | null` et la valeur `vwap: null` du modèle vide. Aucune division ni multiplication sur ces champs.
  - « Binance » n'apparaît que sur une ligne : le commentaire d'en-tête « aucune comparaison Binance » de `FluxTakersSection.tsx`.
  - Les tests « jamais 0 », exécutés en D3, sont verts.
- [ ] **E2** — BGeometrics reste la seule source de MVRV-Z, SOPR, NUPL et Puell. Attendu : aucune ligne `cryptoquant` dans `apps/web/src/data/onchain/bgeometrics.ts`, `(code 1)`.
- [ ] **E3** — aucun ajout hors périmètre (dépendance, `EXCHANGE_IDS`, fenêtre). Attendu : aucune sortie pour les manifestes de paquets, `pnpm-lock.yaml`, `packages/types` et `apps/web/src/App.tsx`.
- [ ] **E4** — la porte locale de l'étape 7 est consignée. Attendu : `1`.

**Bloc de commandes du réviseur** (à coller tel quel ; aucune ligne n'est indentée, pour que les `EOF` ferment bien leurs blocs) :

```bash
mkdir -p logs
set -o pipefail; {
echo "### A1"
git grep -n CRYPTOQUANT_API_KEY -- api vercel.json; echo "(code $?)"
echo "### A2"
git grep -c 'env\[' -- api/_policy.ts; echo "(code $?)"
echo "### A3"
diff <(git show 2d45426:apps/daemon/src/vercelProxy.test.ts | sed -n '34,46p') <(awk '/test[(]"utilise une seule fonction Web Standard/ { f = 1 } f { print } f && /^  [}][)];$/ { exit }' apps/daemon/src/vercelProxy.test.ts); echo "(code $?)"
echo "### A4"
git grep -n -e getCryptoquantKey -e cryptoquantKeyStore -- apps/web/src/components; echo "(code $?)"
echo "### A5"
git grep -n getCryptoquantKey -- apps/web/src ':(exclude)apps/web/src/store' ':(exclude)apps/web/src/data/onchain'; echo "(code $?)"
echo "### A6"
git grep -c CLE-TEST-SECRETE -- apps/web/src; echo "(code $?)"
echo "### A7"
git grep -n -e Authorization -e 'console\.' -- apps/web/src/data/onchain/cryptoquant.ts; echo "(code $?)"
echo "### A8"
git grep -n CQ_CLE_ENV -- apps/web/vite.config.ts; echo "(code $?)"
echo "### A9"
git grep -nF -e 'Bearer ${CLE}' -e 'not.toContain(CLE)' -- apps/web/e2e/des-flux-takers.e2e.ts; echo "(code $?)"
echo "### B1"
pnpm --filter @axiom/daemon exec bun test src/cryptoquantProxy.test.ts src/proxy.test.ts src/env.test.ts src/cache.test.ts src/vercelProxy.test.ts src/vercelProxy.redirection.test.ts 2>&1 | tail -n 6; echo "(code $?)"
echo "### B2"
pnpm --filter @axiom/web exec vitest run src/viteConfig.test.ts 2>&1 | tail -n 6; echo "(code $?)"
echo "### B3"
git grep -n cheminCryptoQuantAmont -- api/_policy.ts apps/daemon/src/proxy.ts apps/web/vite.config.ts; echo "(code $?)"
git grep -n -e btc_all -e eth_all -e window -e limit -- shared/cryptoquant-proxy.ts; echo "(code $?)"
echo "### B4"
git grep -n -e x-ratelimit -e 'private, no-store' -e maxRedirect -- api/_policy.ts api/proxy.ts apps/daemon/src/proxy.ts apps/web/vite.config.ts; echo "(code $?)"
echo "### B5"
git grep -n cqapi -- apps/daemon/src/cache.ts apps/daemon/src/cache.test.ts; echo "(code $?)"
echo "### B6"
git diff --stat 2d45426..HEAD -- shared/extapi-hosts.ts apps/daemon/src/cache.ts; echo "(code $?)"
echo "### B7"
git diff 2d45426..HEAD -- vercel.json; echo "(code $?)"
git diff 2d45426..HEAD -- vercel.json | grep -c '^[+-].*Content-Security-Policy'; echo "(code $?)"
echo "### C1"
pnpm --filter @axiom/web exec vitest run src/data/onchain src/store 2>&1 | tail -n 6; echo "(code $?)"
echo "### C2"
git grep -n -e kvPut -e 'setItem(' -e removeItem -- apps/web/src/data/onchain/cryptoquant.ts; echo "(code $?)"
echo "### C3"
AXIOM_E2E_PORT=5239 pnpm --filter @axiom/web exec playwright test des-flux-takers 2>&1 | tail -n 8; echo "(code $?)"
echo "### C4"
git grep -n 'axiom:onchain:cq:' -- apps/web/src/store/persist.ts; echo "(code $?)"
echo "### C5"
git grep -n 'axiom:cryptoquant:key' -- apps/web/src/store/persist.ts; echo "(code $?)"
echo "### D1"
grep -n -e '^### Budget' -e '^- Delta initial' -e '^- Marge locale' -e '^- Chunk partagé' -e '^- Client CryptoQuant' docs/superpowers/progress/2026-09-16-cryptoquant.md; echo "(code $?)"
echo "### D2"
pnpm --filter @axiom/web build > logs/axiom-b1-build-revue.log 2>&1; echo "(code $?)"
grep -c 'cryptoquant.ts is dynamically imported' logs/axiom-b1-build-revue.log; echo "(code $?)"
node --input-type=module <<'EOF'
import { readFileSync } from "node:fs";
const CLIENT = "src/data/onchain/cryptoquant.ts";
const DES = "src/components/DerivativesWindow.tsx";
const manifeste = JSON.parse(readFileSync("apps/web/dist/.vite/manifest.json", "utf8"));
const entree = Object.keys(manifeste).find((id) => manifeste[id].isEntry === true);
if (entree === undefined) throw new Error("entrée absente du manifeste");
const statiques = new Set();
const parcourir = (id) => {
  if (statiques.has(id)) return;
  statiques.add(id);
  for (const suivant of manifeste[id]?.imports ?? []) parcourir(suivant);
};
parcourir(entree);
const fautifs = [...statiques].filter(
  (id) => id === CLIENT || id === DES || /cryptoquant|FluxTakers/i.test(manifeste[id]?.file ?? id),
);
if (fautifs.length > 0) throw new Error(`graphe statique de l'entrée : ${fautifs.join(", ")}`);
const initiauxAvecSection = [...statiques]
  .map((id) => manifeste[id].file)
  .filter((f) => readFileSync(`apps/web/dist/${f}`, "utf8").includes("Flux takers toutes places"));
if (initiauxAvecSection.length > 0) throw new Error(`section DES dans le bundle initial : ${initiauxAvecSection.join(", ")}`);
if (manifeste[CLIENT]?.isDynamicEntry !== true) throw new Error("le client n'est pas une entrée dynamique");
if ((manifeste[DES]?.imports ?? []).includes(CLIENT)) throw new Error("DES importe le client statiquement");
if (!(manifeste[DES]?.dynamicImports ?? []).includes(CLIENT)) throw new Error("DES ne charge pas le client par import()");
const storePartage = (manifeste[DES]?.imports ?? []).filter((id) => id.startsWith("_cryptoquant-"));
console.log(
  JSON.stringify({
    entree,
    grapheStatique: statiques.size,
    client: manifeste[CLIENT].file,
    des: manifeste[DES].file,
    storePartage: storePartage.map((id) => manifeste[id].file),
  }),
);
EOF
echo "(code $?)"
echo "### D3"
pnpm --filter @axiom/web exec vitest run src/chunkCryptoquant.test.ts src/components/FluxTakersSection.test.tsx src/components/fluxTakers.util.test.ts 2>&1 | tail -n 6; echo "(code $?)"
echo "### E1"
git grep -n -e qbv -e qsv -- apps/web/src/components ':(exclude)*.test.*'; echo "(code $?)"
git grep -n -e bsr -e vwap -- apps/web/src/components/fluxTakers.util.ts; echo "(code $?)"
git grep -n -i binance -- apps/web/src/components/FluxTakersSection.tsx apps/web/src/components/fluxTakers.util.ts; echo "(code $?)"
echo "### E2"
git grep -n -i cryptoquant -- apps/web/src/data/onchain/bgeometrics.ts; echo "(code $?)"
echo "### E3"
git diff --stat 2d45426..HEAD -- package.json apps/web/package.json apps/daemon/package.json pnpm-lock.yaml packages/types apps/web/src/App.tsx; echo "(code $?)"
echo "### E4"
grep -c '^## Porte locale B1$' docs/superpowers/progress/2026-09-16-cryptoquant.md; echo "(code $?)"
} 2>&1 | tee logs/axiom-b1-revue.log
```

**Gabarit du verdict.** Le réviseur pose d'abord trois variables. Il les colle en tête du bloc d'ajout ci-dessous, dans le même appel shell : les variables ne survivent pas d'un appel à l'autre. Voici l'exemple d'une revue sans écart :

```bash
VERDICT="ACCEPTÉ"
ECARTS="- Aucun."
MODELE_REVISEUR="Claude Opus 5 (1M context), agent réviseur distinct des développeurs des tâches 1 à 17"
```

Pour une revue à reprendre :
- `VERDICT="À REPRENDRE"` ;
- `ECARTS` contient une ligne `- fichier:ligne — constat — tâche N` par écart, séparées par des retours à la ligne. Chaque écart cite l'identifiant du point (A1 à E4).

Puis il ajoute la section au rapport :

````bash
: "${VERDICT:?VERDICT vaut ACCEPTÉ ou À REPRENDRE}" "${ECARTS:?ECARTS vaut « - Aucun. » ou la liste des écarts}" "${MODELE_REVISEUR:?MODELE_REVISEUR nomme le modèle réviseur}"
cat >> docs/superpowers/progress/2026-09-16-cryptoquant.md <<EOF

## Revue indépendante B1

- Verdict : **${VERDICT}**
- Réviseur : ${MODELE_REVISEUR} (rôle Réviseur, \`.devin/provider-rules.md:34\` et \`:51\`)
- Commit revu : \`$(git rev-parse --short HEAD)\`, base \`2d45426\`, le $(date -u +%Y-%m-%d)

### Points contrôlés

Chaque point est conforme, sauf s'il figure sous « Écarts relevés ». Les sorties brutes suivent, dans le même ordre.

| Point | Contrôle |
|---|---|
| A1 | aucun \`CRYPTOQUANT_API_KEY\` dans \`api/\` ni \`vercel.json\` : aucun repli serveur sur Vercel |
| A2 | une seule lecture \`env[\` dans \`api/_policy.ts\` |
| A3 | test structurel Vercel identique aux lignes 34-46 d'origine |
| A4 | store de clé dans les composants : imports, \`version\` dans DES, \`hasKey\`/\`setKey\`/\`clearKey\` dans Réglages, test structurel de la tâche 8 |
| A5 | \`getCryptoquantKey\` absent de tout fichier non-test hors store et client |
| A6 | tests de fuite (marqueur de clé factice des tâches 6, 7 et 13) présents (store, persist, client) et verts |
| A7 | clé seulement dans l'en-tête \`Authorization\`, aucun \`console.\` dans le client |
| A8 | \`__CQ_CLE_ENV__\` booléen gardé par \`isVercelBuild\` |
| A9 | e2e : clé en en-tête, absente des URL et de l'archive |
| B1 | tests Bun du module partagé, du daemon et de Vercel verts |
| B2 | tests du proxy de dev Vite verts |
| B3 | liste fermée portée par \`shared/cryptoquant-proxy.ts\` et appelée par les trois proxys |
| B4 | 401 avant tout fetch, 404 hors liste, 405 \`allow: GET\`, zéro redirection, \`private, no-store\`, quotas et corps relayés |
| B5 | aucun cache proxy pour \`/cqapi\` |
| B6 | \`shared/extapi-hosts.ts\` et \`apps/daemon/src/cache.ts\` inchangés |
| B7 | \`vercel.json\` : deux rewrites avant le repli SPA, CSP inchangée |
| C1 | tests du client et des stores verts (I1 à I8, I10) |
| C2 | écritures gardées, aucun jour supprimé, conflit au \`majTs\` le plus grand, une clé par série |
| C3 | e2e DES verts : union sans doublon, 429 sans réécriture, 401 en un appel |
| C4 | archive hors sauvegarde JSON (\`resteSurLePoste\`) |
| C5 | clé exclue des exports (\`CLES_CREDENTIALS_LOCALES\`) |
| D1 | budget après B1 consigné au format unique, deltas lus, chunk partagé du store nommé |
| D2 | build courant : manifeste sans erreur, client à la demande |
| D3 | garde-fou du chunk et vues verts |
| E1 | lectures fournisseur sans recalcul, spot et perp jamais additionnés, aucune comparaison Binance, jamais « 0 » inventé |
| E2 | BGeometrics seule source de valorisation |
| E3 | ni dépendance, ni \`EXCHANGE_IDS\`, ni fenêtre |
| E4 | porte locale B1 consignée |

### Commandes lancées

Journal complet : \`logs/axiom-b1-revue.log\`.

\`\`\`text
$(cat logs/axiom-b1-revue.log)
\`\`\`

### Écarts actés par l'orchestrateur (rappel, non bloquants)

- \`situer\` vit dans \`apps/web/src/components/fluxTakers.util.ts\`, et plus dans le client.
- \`RAISON_CLE_CRYPTOQUANT\` et \`messageSansCleCq\` vivent dans \`apps/web/src/store/cryptoquant.ts\` ; le client les ré-exporte.
- Bouton Réglages aussi sur une clé refusée (401) ; complément \`.env\`/Vercel seulement pour l'absence de clé.
- Proxys locaux : en-tête client s'il est valide, sinon \`.env\`. Vercel : POST sans clé → 405, méthode contrôlée d'abord.
- Archive de version inconnue : statut \`erreur\`, zéro appel, rien réécrit, bandeau dans la vue.
- \`etatFileCq().enAttente\` ne compte que les demandes en attente d'un créneau ; \`repriseTs\` couvre le 429 et \`x-ratelimit-remaining: 0\`.
- Archive illisible remplacée : détectée par la forme \`statut "pret"\` + \`raison\` non nulle, le client n'exposant cette raison qu'en valeur.

### Écarts relevés

${ECARTS}
EOF
awk '/^## Revue indépendante B1$/ { f = 1 } f' docs/superpowers/progress/2026-09-16-cryptoquant.md | head -n 12
````

Attendu :
- l'en-tête de la section s'affiche : verdict, réviseur, commit revu et début du tableau ;
- le shell s'arrête avant l'ajout si l'une des trois variables est vide.

Suite selon le verdict :
- **À REPRENDRE** : retour aux tâches concernées. Ni commit de l'étape 9, ni merge, ni push de B1. Une fois les corrections faites, la revue est relancée depuis l'étape 7.
- **ACCEPTÉ** : étape 9.

- [ ] **Étape 9 : commit final de B1 (seulement après ACCEPTÉ)**

```bash
git add docs/superpowers/progress/2026-09-16-cryptoquant.md
git commit -m "docs(rapport): revue indépendante B1 — flux takers CryptoQuant acceptés" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

Vient ensuite la preuve manuelle du **propriétaire** (spec §6). **Jamais depuis un agent.**
- `curl -i "http://127.0.0.1:8787/cqapi/v2/market/cq/spot/trade?symbol=btc_all&window=day&limit=30"`, sans puis avec sa clé en `Authorization: Bearer`.
- Relevé de la valeur réelle de `x-ratelimit-reset`.
- Quatre appels à la première ouverture de DES, puis zéro à la réouverture.

B2 (tâches 18-20) ne démarre qu'après ce verdict.

---

## Zone F — sous-section CHAIN, e2e et clôture (B2)

> Prérequis : tâches 1 à 17 livrées (module partagé `shared/cryptoquant-proxy.ts`, store
> `apps/web/src/store/cryptoquant.ts` avec `RAISON_CLE_CRYPTOQUANT` et `messageSansCleCq` (tâche 6),
> client `apps/web/src/data/onchain/cryptoquant.ts`, section DES, garde-fou
> `apps/web/src/chunkCryptoquant.test.ts` (tâche 16), spec `des-flux-takers` (tâche 17), sections
> `### Budget avant B1`, `### Budget après B1-3` et `### Budget après B1` du rapport). Toutes les
> commandes se lancent **depuis la racine du dépôt** (`pnpm --filter @axiom/web exec <commande>` s'exécute
> dans `apps/web`, les chemins de test sont donc relatifs à `apps/web`).
>
> Règles propres à cette zone, vérifiées dans le code :
> - `MineursCotes.tsx` n'importe **à l'exécution** ni `data/onchain/cryptoquant.ts` ni
>   `shared/cryptoquant-proxy.ts` (seulement `import type`, et `await import()` du client dans le
>   conteneur) : le client reste un chunk à la demande (garde-fou `chunkCryptoquant.test.ts`,
>   tâche 16). `RAISON_CLE_CRYPTOQUANT` et `messageSansCleCq` viennent du store
>   `store/cryptoquant.ts` (tâche 6), déjà partagé par les Réglages, DES et le client : son chunk
>   partagé figure déjà dans `__vite__mapDeps` de l'entrée (précédent
>   `apps/web/src/components/OiPerpsDexSection.tsx:15-17`, +37 o gzip mesurés) ; l'importer depuis
>   CHAIN n'ajoute qu'une référence de dépendance (delta initial attendu ≤ ~40 o gzip). Une seule
>   copie locale, figée par test : l'ordre des neuf sociétés (= `IDS_MINEURS_CQ`).
> - Une série `statut: "pret"` qui porte une `raison` non nulle n'est pas en échec : c'est la seule
>   forme de l'archive locale illisible remplacée (`RAISON_ARCHIVE_ILLISIBLE_CRYPTOQUANT`, tâche 13).
>   La vue la signale par ce discriminant, sans importer la constante du client.
> - `TableTriable`, `CourbeOnchain` et `enregistrerQualite` sont déjà dans le graphe du chunk CHAIN
>   (`apps/web/dist/.vite/manifest.json` du 2026-09-16 : `OnchainWindow.tsx` importe déjà
>   `_TableTriable-*.js` et `_QualiteMetrique-*.js`).
> - Vitest tourne en environnement node (aucun bloc `test` dans `apps/web/vite.config.ts`) : les
>   effets ne s'exécutent jamais en test unitaire. Le conteneur n'est testé qu'en rendu statique
>   (replié) ; la qualité passe par la fonction pure `qualiteMineursCotes` ; le compte réel des
>   appels est prouvé en e2e.
> - L'application est montée en `StrictMode` (`apps/web/src/main.tsx:42`) : l'effet du conteneur
>   vérifie `ctrl.signal.aborted` après l'`import()` et après chaque `await`.
> - Les fenêtres ne montent leurs enfants qu'ouvertes (`apps/web/src/App.tsx:340-341`) et CHAIN
>   passe `open` à la section (`apps/web/src/components/OnchainWindow.tsx:772`) : fermer puis
>   rouvrir CHAIN remonte `MineursCotes`, dont le court-circuit « J-1 archivé » évite tout appel.

### Tâche 18 : sous-section « Production des mineurs cotés » (vue pure triable, en-tête, conteneur, qualité) et slot `children` de la section Mineurs

**Fichiers :**
- Créer : `apps/web/src/components/onchain/MineursCotes.tsx`
- Modifier : `apps/web/src/components/onchain/Mineurs.tsx:1-127` (en-tête 1-8, imports 9-22, signature de `VueMineurs` 35-43, insertion de `{children}` avant la `NoteSource` 100, conteneur `Mineurs` 109-127)
- Tester : `apps/web/src/components/onchain/MineursCotes.test.tsx` (nouveau) ; `apps/web/src/components/onchain/Mineurs.test.tsx` (inchangé, doit rester vert) ; `apps/web/src/chunkCryptoquant.test.ts` (tâche 16, doit rester vert)

**Interfaces :**
- Consomme :
  - tâche 2 : `export type IdMineurCq = (typeof IDS_MINEURS_CQ)[number]` et `IDS_MINEURS_CQ` (le second **dans le test uniquement**) depuis `shared/cryptoquant-proxy.ts` ;
  - tâche 6 : depuis `apps/web/src/store/cryptoquant.ts`, `cryptoquantKeyStore: StoreApi<CryptoquantKeyState>` (champ `version: number`), `RAISON_CLE_CRYPTOQUANT = "Clé CryptoQuant personnelle requise (Réglages ⚙)."` et `messageSansCleCq(vercel: boolean): string` ;
  - tâches 9-13 : types (`import type`) `SerieCq`, `LigneCq`, `LigneMineur`, `ArchiveCq`, `DiagnosticCq`, `ChargementCq` (dont `persistance: { local: boolean; kv: boolean | null }` et `statut: "pret" | "cle-requise" | "quota" | "offre" | "erreur"`) ; valeurs **par `await import()` seulement** : `SERIES_MINEURS: readonly SerieCq[]`, `chargerSerieCq(serie: SerieCq, signal?: AbortSignal): Promise<ChargementCq>`, `etatFileCq(): { enAttente: number; repriseTs: number | null }`, `abonnerFileCq(cb: () => void): () => void` ; dans les tests seulement, `RAISON_ARCHIVE_ILLISIBLE_CRYPTOQUANT` (série « prête » avec cette raison = archive locale illisible remplacée) ;
  - tâche 16 : garde-fou `apps/web/src/chunkCryptoquant.test.ts` (aucun import statique du client hors `data/onchain/`) ;
  - existant : `enregistrerQualite(id: string, libelle: string, qualite: QualiteMetrique): void` (`store/qualiteMetriques.ts:15`), `actualiserQualite` (`data/qualiteMetrique.ts:17`), `TableTriable`/`trierLignes`/`ColonneTable`/`TriTable` (`components/TableTriable.tsx:10-53` ; les boutons d'en-tête n'apparaissent que si la colonne porte `triable: true`, `valeurTri` et que `onTri` est fourni), `boutonHistorique`/`dateObservation`/`CourbeOnchain` (`onchain/HistoriqueCommun.tsx:5-41`), `Vide` (`ui.tsx:321`), `SansCle` (`ui.tsx:342`), `Badge` (`ui.tsx:438`), `NoteSource` (`ui.tsx:672`), `BadgeFiabilite` en props libres (`ui.tsx:692`), `settingsUiStore.openSettings` (`store/settings-ui.ts:20-24`), `useHorloge` (`lib/horloge.ts:29`), `IS_VERCEL` (`lib/deployment.ts:7`), `formatDec`/`formatUsd` (`lib/format.ts:84`, `:51`).
- Produit :
  - contrat : `export interface PropsVueMineursCotes { chargements: Partial<Record<SerieCq, ChargementCq>>; enCours: boolean; recues: number; file: { enAttente: number; repriseTs: number | null }; now: number; onOuvrirReglages: () => void; tri?: TriTable | null; onTri?: (tri: TriTable) => void }` (tri absent = BTC J-1 décroissant ; `null` = ordre fournisseur ; `onTri` absent = en-têtes non cliquables), `export function VueMineursCotes(props: PropsVueMineursCotes): JSX.Element` (pure, sans état), `export function MineursCotes(props: { onOuvrirReglages: () => void }): JSX.Element` (l'état du tri vit ici, `useState`, défaut BTC J-1 décroissant) ; `VueMineurs` gagne `children?: ReactNode` ;
  - ajouts de cette tâche (exportés pour les tests et la tâche 19) : `ID_QUALITE_MINEURS = "chain:mineurs-cotes"`, `LIBELLE_QUALITE_MINEURS = "Mineurs cotés · CryptoQuant"`, `IDS_SOCIETES: readonly IdMineurCq[]`, `interface LigneSociete { id: IdMineurCq; nom: string; ligne: LigneMineur | null; motif: string }`, `interface ModeleMineursCotes`, `construireModeleMineurs(chargements: Partial<Record<SerieCq, ChargementCq>>, now: number): ModeleMineursCotes`, `qualiteMineursCotes(chargements: Partial<Record<SerieCq, ChargementCq>>, now: number): QualiteMetrique` (`ageMaxMs` = 3 jours), `type PropsEnTeteMineursCotes = PropsVueMineursCotes & { ouvert: boolean; onBasculer: () => void }`, `EnTeteMineursCotes(props: PropsEnTeteMineursCotes): JSX.Element` ;
  - signaux affichés (jamais silencieux) : « archive non persistée localement (stockage plein) », « copie daemon non écrite », « sans daemon : vider le stockage du navigateur perd l'archive », « archive locale illisible remplacée », badge « cache ou observation périmé » ; `SansCle` avec bouton Réglages pour tout statut `cle-requise` à archive vide, complément `.env`/Vercel (`messageSansCleCq(IS_VERCEL)`) seulement pour `RAISON_CLE_CRYPTOQUANT` ; CTA d'en-tête « clé CryptoQuant ⚙ » pour tout statut `cle-requise` ;
  - contrat DOM pour la tâche 19 : bouton `aria-expanded` dont le nom contient « Production des mineurs cotés » ; `role="table"` nommé « Production des mineurs cotés » (10 `row`, en-têtes « Société », « BTC J-1 », « Cumul mois », « USD J-1 », « Déclaré (mois) » cliquables dans le conteneur) ; image SVG nommée « Production Σ 9 sociétés » ; entrée « Mineurs cotés · CryptoQuant » dans « Qualité des blocs » ; libellés « archive N j · J-1 AAAA-MM-JJ », « AAAA-MM-JJ (J-1) · n/9 sociétés » (suivi des Σ à 9/9, sinon de « Σ partielle n/9 »), « Σ 9 », « Σ partielle n/9 ».

- [ ] **Étape 1 : écrire le test qui échoue (modèle et qualité)** — créer `apps/web/src/components/onchain/MineursCotes.test.tsx` :

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDS_MINEURS_CQ, type IdMineurCq } from "../../../../../shared/cryptoquant-proxy";
import type { ArchiveCq, ChargementCq, DiagnosticCq, LigneMineur, SerieCq } from "../../data/onchain/cryptoquant";
import { actualiserQualite } from "../../data/qualiteMetrique";
import { RAISON_CLE_CRYPTOQUANT } from "../../store/cryptoquant";
import {
  construireModeleMineurs,
  ID_QUALITE_MINEURS,
  IDS_SOCIETES,
  LIBELLE_QUALITE_MINEURS,
  qualiteMineursCotes,
} from "./MineursCotes";

const JOUR_MS = 86_400_000;
/** Horloge des tests : 2026-09-16 12:00 UTC, donc J-1 = 2026-09-15. */
const MAINTENANT = Date.UTC(2026, 8, 16, 12);
const J1 = "2026-09-15";
/** Trente jours clos croissants, 2026-08-17 → 2026-09-15 (fenêtre de l'offre BASIC). */
const JOURS = Array.from({ length: 30 }, (_, i) =>
  new Date(Date.UTC(2026, 8, 15) - (29 - i) * JOUR_MS).toISOString().slice(0, 10),
);
/** BTC minés par jour, constants ; Σ = 130.00 BTC/j. */
const BTC: Record<IdMineurCq, number> = {
  bitf: 5.1,
  cipher: 7.2,
  clsk: 20.4,
  core: 3.3,
  hive: 4.4,
  iren: 18.5,
  mara: 49.05,
  riot: 15.6,
  wulf: 6.45,
};
const PX = 78_300;

type Chargements = Partial<Record<SerieCq, ChargementCq>>;
const serie = (id: IdMineurCq): SerieCq => `mineur:${id}`;

/**
 * MARA à J-1 = exemple réel du sondage (49.05 BTC, cumul 396.96, 3.84 M$) ; seule RIOT a publié
 * une production déclarée (123 BTC). Σ cumul J-1 = 396.96 + 80.95 × 15 = 1611.21 ;
 * Σ USD J-1 = 3 840 000 + 80.95 × 78 300 = 10 178 385.
 */
function ligne(id: IdMineurCq, jour: string): LigneMineur {
  const r = BTC[id];
  const maraJ1 = id === "mara" && jour === J1;
  return {
    r,
    cr: r - 0.05,
    om: 0.05,
    cm: maraJ1 ? 396.96 : r * Number(jour.slice(8, 10)),
    usd: maraJ1 ? 3_840_000 : r * PX,
    cmu: null,
    px: PX,
    decl: id === "riot" ? 123 : null,
    prec: null,
  };
}

function archive(id: IdMineurCq, jours: readonly string[] = JOURS): ArchiveCq {
  const lignes: Record<string, LigneMineur> = {};
  for (const jour of jours) lignes[jour] = ligne(id, jour);
  return { version: 1, serie: serie(id), majTs: MAINTENANT - 3_600_000, jours: lignes };
}

function diagnostic(surcharge: Partial<DiagnosticCq> = {}): DiagnosticCq {
  return {
    debut: "2026-08-17",
    dernier: J1,
    hierPresent: true,
    manquantsFenetre: [],
    perdus: [],
    perime: false,
    ...surcharge,
  };
}

function chargement(id: IdMineurCq, surcharge: Partial<ChargementCq> = {}): ChargementCq {
  return {
    serie: serie(id),
    statut: "pret",
    raison: null,
    archive: archive(id),
    diagnostic: diagnostic(),
    persistance: { local: true, kv: null },
    appel: true,
    ...surcharge,
  };
}

function tous(): Chargements {
  const resultat: Chargements = {};
  for (const id of IDS_SOCIETES) resultat[serie(id)] = chargement(id);
  return resultat;
}

/** Neuf séries sans clé active ni archive. */
function sansCle(): Chargements {
  const resultat: Chargements = {};
  for (const id of IDS_SOCIETES) {
    resultat[serie(id)] = chargement(id, {
      statut: "cle-requise",
      raison: RAISON_CLE_CRYPTOQUANT,
      archive: null,
      diagnostic: diagnostic({ debut: null, dernier: null, hierPresent: false, perime: true }),
      appel: false,
    });
  }
  return resultat;
}

describe("production des mineurs cotés : modèle et qualité", () => {
  beforeEach(() => vi.setSystemTime(MAINTENANT));
  afterEach(() => vi.useRealTimers());

  it("neuf sociétés dans l'ordre fournisseur ; identifiants de qualité stables", () => {
    expect(IDS_SOCIETES).toEqual([...IDS_MINEURS_CQ]);
    expect(ID_QUALITE_MINEURS).toBe("chain:mineurs-cotes");
    expect(LIBELLE_QUALITE_MINEURS).toBe("Mineurs cotés · CryptoQuant");
  });

  it("9/9 à J-1 : sommes d'affichage, courbe continue, archive, qualité fraîche", () => {
    const m = construireModeleMineurs(tous(), MAINTENANT);
    expect(m.jourRef).toBe(J1);
    expect(m.retardJours).toBe(1);
    expect(m.disponibles).toBe(9);
    expect(m.lignes.map((l) => l.id)).toEqual([...IDS_MINEURS_CQ]);
    expect(m.somme?.r).toBeCloseTo(130, 6);
    expect(m.somme?.cm).toBeCloseTo(1611.21, 6);
    expect(m.somme?.usd).toBeCloseTo(10_178_385, 3);
    expect(m.courbe).toHaveLength(30);
    expect(m.courbe.every((p) => p.value !== null)).toBe(true);
    expect(m.courbe.at(-1)?.time).toBe(Date.UTC(2026, 8, 15));
    expect(m.archive).toEqual({ debut: "2026-08-17", jours: 30, manquants: [], perdus: [], hierEnAttente: 0 });
    expect(m.recupereLe).toBe(MAINTENANT - 3_600_000);
    expect(qualiteMineursCotes(tous(), MAINTENANT)).toEqual({
      sourceId: "cryptoquant",
      sourceEffective: "CryptoQuant BASIC",
      observeLe: Date.UTC(2026, 8, 15),
      recupereLe: MAINTENANT - 3_600_000,
      cadenceMs: 86_400_000,
      ageMaxMs: 3 * 86_400_000,
      couverture: { disponibles: 9, attendus: 9 },
      estime: false,
      acces: "cle",
      statut: "frais",
    });
  });

  it("7/9 : aucune Σ, tiret motivé par société, qualité partielle avec couverture 7/9", () => {
    const chargements = tous();
    delete chargements[serie("wulf")];
    chargements[serie("hive")] = chargement("hive", {
      statut: "erreur",
      raison: "CryptoQuant injoignable ; archive affichée.",
      archive: archive("hive", JOURS.slice(0, -1)),
      diagnostic: diagnostic({ dernier: "2026-09-14", hierPresent: false }),
    });
    const m = construireModeleMineurs(chargements, MAINTENANT);
    expect(m.disponibles).toBe(7);
    expect(m.somme).toBeNull();
    expect(m.lignes).toHaveLength(9);
    expect(m.lignes.find((l) => l.id === "wulf")).toMatchObject({ ligne: null, motif: "Série non encore reçue." });
    expect(m.lignes.find((l) => l.id === "hive")).toMatchObject({
      ligne: null,
      motif: "CryptoQuant injoignable ; archive affichée.",
    });
    // Une série absente : aucun jour n'a ses neuf lignes, la courbe Σ est entièrement coupée.
    expect(m.courbe.every((p) => p.value === null)).toBe(true);
    expect(m.archive.hierEnAttente).toBe(1);
    const q = qualiteMineursCotes(chargements, MAINTENANT);
    expect(q.couverture).toEqual({ disponibles: 7, attendus: 9 });
    expect(q.statut).toBe("partiel");
    expect(q.raison).toBe("7/9 sociétés au 2026-09-15. CryptoQuant injoignable ; archive affichée.");
  });

  it("un jour manquant chez une société coupe la courbe Σ ce jour-là et rend la qualité partielle", () => {
    const chargements = tous();
    chargements[serie("hive")] = chargement("hive", {
      archive: archive("hive", JOURS.filter((j) => j !== "2026-09-10")),
      diagnostic: diagnostic({ manquantsFenetre: ["2026-09-10"] }),
    });
    const m = construireModeleMineurs(chargements, MAINTENANT);
    expect(m.somme?.r).toBeCloseTo(130, 6);
    expect(m.courbe.find((p) => p.time === Date.UTC(2026, 8, 10))?.value).toBeNull();
    expect(m.courbe.filter((p) => p.value === null)).toHaveLength(1);
    expect(m.archive.manquants).toEqual(["2026-09-10"]);
    const q = qualiteMineursCotes(chargements, MAINTENANT);
    expect(q.statut).toBe("partiel");
    expect(q.raison).toBe("9/9 sociétés au 2026-09-15. 1 jour manquant dans la fenêtre de 30 j.");
  });

  it("une valeur absente n'est jamais comptée 0 : Σ USD et Σ cumul absentes, Σ BTC conservée", () => {
    const chargements = tous();
    const a = archive("mara");
    a.jours[J1] = { ...ligne("mara", J1), usd: null, cm: null };
    chargements[serie("mara")] = chargement("mara", { archive: a });
    const s = construireModeleMineurs(chargements, MAINTENANT).somme;
    expect(s?.r).toBeCloseTo(130, 6);
    expect(s?.usd).toBeNull();
    expect(s?.cm).toBeNull();
  });

  it("sans clé ni archive : indisponible avec la raison du store ; dernier jour antérieur à J-2 : périmé", () => {
    const q = qualiteMineursCotes(sansCle(), MAINTENANT);
    expect(q).toMatchObject({
      statut: "indisponible",
      acces: "cle",
      observeLe: null,
      recupereLe: null,
      sourceEffective: "archive locale CryptoQuant",
      couverture: { disponibles: 0, attendus: 9 },
    });
    expect(q.raison).toBe("Clé CryptoQuant personnelle requise (Réglages ⚙).");

    const anciens: Chargements = {};
    for (const id of IDS_SOCIETES) {
      anciens[serie(id)] = chargement(id, {
        statut: "erreur",
        raison: "CryptoQuant injoignable ; archive affichée.",
        archive: archive(id, JOURS.slice(0, -2)),
        diagnostic: diagnostic({ dernier: "2026-09-13", hierPresent: false, perime: true }),
      });
    }
    expect(qualiteMineursCotes(anciens, MAINTENANT).statut).toBe("perime");
  });

  it("seuil de péremption : J-1 en attente le matin n'alerte pas, trois jours sans ligne alertent", () => {
    const q = qualiteMineursCotes(tous(), MAINTENANT);
    // Le 17 à 10 h UTC, le 16 (nouvel J-1) n'est pas encore publié : dernière ligne le 15, pas d'alerte.
    expect(actualiserQualite(q, Date.UTC(2026, 8, 17, 10)).statut).toBe("frais");
    // Le 18 à 1 h UTC, ni le 16 ni le 17 : même seuil que `diagnostiquer` (dernier < aujourd'hui − 2 j).
    expect(actualiserQualite(q, Date.UTC(2026, 8, 18, 1)).statut).toBe("perime");
  });

  it("archive locale illisible remplacée (série prête avec raison) : ni motif d'échec ni raison de qualité", async () => {
    const { RAISON_ARCHIVE_ILLISIBLE_CRYPTOQUANT } = await import("../../data/onchain/cryptoquant");
    const chargements = tous();
    chargements[serie("mara")] = chargement("mara", {
      raison: RAISON_ARCHIVE_ILLISIBLE_CRYPTOQUANT,
      archive: archive("mara", JOURS.slice(0, -1)),
      diagnostic: diagnostic({ dernier: "2026-09-14", hierPresent: false }),
    });
    const m = construireModeleMineurs(chargements, MAINTENANT);
    expect(m.lignes.find((l) => l.id === "mara")).toMatchObject({
      ligne: null,
      motif: "Aucune ligne publiée pour le 2026-09-15.",
    });
    const q = qualiteMineursCotes(chargements, MAINTENANT);
    expect(q.statut).toBe("partiel");
    expect(q.raison).toBe("8/9 sociétés au 2026-09-15.");
  });
});
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue**

```bash
pnpm --filter @axiom/web exec vitest run src/components/onchain/MineursCotes.test.tsx
```

Échec attendu : `Error: Failed to resolve import "./MineursCotes" from "src/components/onchain/MineursCotes.test.tsx". Does the file exist?` (0 test exécuté, fichier en échec).

- [ ] **Étape 3 : implémentation minimale (modèle et qualité)** — créer `apps/web/src/components/onchain/MineursCotes.tsx` :

```tsx
/**
 * Sous-section « Production des mineurs cotés » de la section Mineurs de CHAIN (CryptoQuant
 * BASIC, clé personnelle) : BTC minés au dernier jour clos attribués à neuf sociétés cotées,
 * cumul mensuel du fournisseur, valeur USD, production déclarée quand publiée. Σ = sommes
 * d'affichage des neuf lignes, affichées seulement à 9/9 (aucun moteur d'agrégation) ; toute
 * valeur absente s'affiche « — », jamais 0 ; aucun écart déclaré/observé n'est calculé.
 *
 * Aucun import d'exécution du client CryptoQuant ni de `shared/cryptoquant-proxy` : le client
 * reste un chunk chargé à la demande (`await import()` dans le conteneur, garde-fou
 * `chunkCryptoquant.test.ts`). Les messages « clé requise » viennent du store de clé, déjà
 * partagé par les Réglages, DES et le client.
 */
import type { IdMineurCq } from "../../../../../shared/cryptoquant-proxy";
import type { ChargementCq, LigneCq, LigneMineur, SerieCq } from "../../data/onchain/cryptoquant";
import type { QualiteMetrique } from "../../data/qualiteMetrique";
import { dateObservation } from "./HistoriqueCommun";

const JOUR_MS = 86_400_000;
/** Sociétés suivies par `miner-data/companies` (offre BASIC). */
const ATTENDUES = 9;

/** Identifiant publié dans « Qualité des blocs » (préfixe `chain:` filtré par OnchainWindow). */
export const ID_QUALITE_MINEURS = "chain:mineurs-cotes";
export const LIBELLE_QUALITE_MINEURS = "Mineurs cotés · CryptoQuant";

/**
 * Noms usuels affichés en infobulle (connaissance générale, non issue du sondage). L'ordre
 * d'écriture est celui de `IDS_MINEURS_CQ` ; le type `Record` impose exactement les neuf clés.
 */
const NOMS_SOCIETES: Record<IdMineurCq, string> = {
  bitf: "Bitfarms",
  cipher: "Cipher Mining",
  clsk: "CleanSpark",
  core: "Core Scientific",
  hive: "HIVE Digital",
  iren: "IREN",
  mara: "MARA Holdings",
  riot: "Riot Platforms",
  wulf: "TeraWulf",
};

/** Les neuf sociétés dans l'ordre fournisseur (égalité avec `IDS_MINEURS_CQ` figée par le test). */
export const IDS_SOCIETES: readonly IdMineurCq[] = Object.keys(NOMS_SOCIETES) as IdMineurCq[];

type Chargements = Partial<Record<SerieCq, ChargementCq>>;

const serieDe = (id: IdMineurCq): SerieCq => `mineur:${id}`;
const tempsJour = (jour: string): number => Date.parse(`${jour}T00:00:00Z`);
const accord = (n: number): string => (n > 1 ? "s" : "");

/** Garde de l'union `LigneCq` : seule une ligne mineur porte `r`. */
function estLigneMineur(ligne: LigneCq | undefined): ligne is LigneMineur {
  return ligne !== undefined && "r" in ligne;
}

/** Somme d'affichage : une seule valeur absente rend la somme absente (jamais comptée 0). */
function sommeOuNull(valeurs: ReadonlyArray<number | null>): number | null {
  let total = 0;
  for (const v of valeurs) {
    if (v === null || !Number.isFinite(v)) return null;
    total += v;
  }
  return total;
}

/** Chargements des neuf sociétés déjà reçus, dans l'ordre fournisseur. */
function recusDe(chargements: Chargements): ChargementCq[] {
  return IDS_SOCIETES.flatMap((id) => {
    const charge = chargements[serieDe(id)];
    return charge === undefined ? [] : [charge];
  });
}

/**
 * Raisons des séries en échec. Une série « prête » peut porter une raison : c'est l'archive
 * locale illisible, remplacée à l'écriture — un signal, pas un échec.
 */
function raisonsEchec(recus: readonly ChargementCq[]): string[] {
  return [...new Set(recus.flatMap((c) => (c.statut !== "pret" && c.raison !== null ? [c.raison] : [])))];
}

const union = (listes: ReadonlyArray<readonly string[]>): string[] => [...new Set(listes.flat())].sort();

export interface LigneSociete {
  id: IdMineurCq;
  nom: string;
  /** Ligne du jour de référence ; `null` si la société n'en a pas. */
  ligne: LigneMineur | null;
  /** Motif de l'absence, affiché en infobulle du tiret. */
  motif: string;
}

export interface ModeleMineursCotes {
  /** Jour de référence = dernier jour clos archivé, toutes sociétés confondues (J-1 en régime normal). */
  jourRef: string | null;
  /** Écart en jours entre aujourd'hui (UTC) et le jour de référence (1 = J-1). */
  retardJours: number | null;
  /** Toujours neuf lignes, dans l'ordre fournisseur. */
  lignes: LigneSociete[];
  /** Sociétés ayant une ligne au jour de référence. */
  disponibles: number;
  /** Sommes d'affichage des neuf lignes, `null` sous 9/9 ; chaque colonne absente dès qu'une valeur manque. */
  somme: { r: number; cm: number | null; usd: number | null } | null;
  /** Σ BTC/j par jour archivé ; `null` le jour où une société manque (ligne coupée). */
  courbe: Array<{ time: number; value: number | null }>;
  archive: { debut: string | null; jours: number; manquants: string[]; perdus: string[]; hierEnAttente: number };
  /** Dernier appel réussi (max des `majTs`). */
  recupereLe: number | null;
}

/** Modèle d'affichage PUR (aucune lecture d'horloge : `now` injecté). */
export function construireModeleMineurs(chargements: Chargements, now: number): ModeleMineursCotes {
  const societes = IDS_SOCIETES.map((id) => ({ id, charge: chargements[serieDe(id)] }));
  const archives = societes.map(({ charge }) => charge?.archive ?? null);
  const diagnostics = societes.flatMap(({ charge }) => (charge?.archive ? [charge.diagnostic] : []));
  const derniers = diagnostics.map((d) => d.dernier).filter((j): j is string => j !== null).sort();
  const jourRef = derniers.at(-1) ?? null;

  const lignes = societes.map(({ id, charge }): LigneSociete => {
    const brute = jourRef === null ? undefined : charge?.archive?.jours[jourRef];
    const motif =
      charge === undefined
        ? "Série non encore reçue."
        : charge.statut !== "pret" && charge.raison !== null
          ? charge.raison
          : jourRef === null
            ? "Aucune ligne archivée."
            : `Aucune ligne publiée pour le ${jourRef}.`;
    return { id, nom: NOMS_SOCIETES[id], ligne: estLigneMineur(brute) ? brute : null, motif };
  });
  const presentes = lignes.flatMap((l) => (l.ligne === null ? [] : [l.ligne]));
  const somme =
    presentes.length === ATTENDUES
      ? {
          r: presentes.reduce((total, l) => total + l.r, 0),
          cm: sommeOuNull(presentes.map((l) => l.cm)),
          usd: sommeOuNull(presentes.map((l) => l.usd)),
        }
      : null;

  const jours = [...new Set(archives.flatMap((a) => (a === null ? [] : Object.keys(a.jours))))].sort();
  const courbe = jours.map((jour): { time: number; value: number | null } => {
    const time = tempsJour(jour);
    let total = 0;
    for (const a of archives) {
      const ligne = a?.jours[jour];
      if (!estLigneMineur(ligne)) return { time, value: null };
      total += ligne.r;
    }
    return { time, value: total };
  });

  const debuts = diagnostics.map((d) => d.debut).filter((j): j is string => j !== null).sort();
  const majs = archives.map((a) => a?.majTs ?? null).filter((t): t is number => t !== null);
  const aujourdhui = dateObservation(now);
  return {
    jourRef,
    retardJours: jourRef === null ? null : Math.round((tempsJour(aujourdhui) - tempsJour(jourRef)) / JOUR_MS),
    lignes,
    disponibles: presentes.length,
    somme,
    courbe,
    archive: {
      debut: debuts[0] ?? null,
      jours: jours.length,
      manquants: union(diagnostics.map((d) => d.manquantsFenetre)),
      perdus: union(diagnostics.map((d) => d.perdus)),
      hierEnAttente: diagnostics.filter((d) => !d.hierPresent).length,
    },
    recupereLe: majs.length > 0 ? Math.max(...majs) : null,
  };
}

/**
 * Qualité du bloc « Mineurs cotés · CryptoQuant ». PURE. Indisponible sans aucune ligne archivée ;
 * périmée si toutes les séries archivées ont leur dernier jour antérieur à aujourd'hui − 2 j ;
 * partielle sous 9/9 ou avec un jour manquant récupérable ; fraîche sinon (J-1 en attente de
 * publication n'est pas un trou).
 */
export function qualiteMineursCotes(chargements: Chargements, now: number): QualiteMetrique {
  const m = construireModeleMineurs(chargements, now);
  const recus = recusDe(chargements);
  const diagnostics = recus.flatMap((c) => (c.archive ? [c.diagnostic] : []));
  const raisons = raisonsEchec(recus);
  const avecDonnees = m.archive.jours > 0;
  const statut: QualiteMetrique["statut"] = !avecDonnees
    ? "indisponible"
    : diagnostics.every((d) => d.perime)
      ? "perime"
      : m.disponibles < ATTENDUES || m.archive.manquants.length > 0
        ? "partiel"
        : "frais";
  const morceaux: string[] = [];
  if (m.jourRef !== null) morceaux.push(`${m.disponibles}/${ATTENDUES} sociétés au ${m.jourRef}.`);
  const n = m.archive.manquants.length;
  if (n > 0) morceaux.push(`${n} jour${accord(n)} manquant${accord(n)} dans la fenêtre de 30 j.`);
  morceaux.push(...raisons);
  const raison =
    statut === "frais"
      ? undefined
      : !avecDonnees
        ? raisons[0] ?? "Aucune ligne CryptoQuant archivée."
        : morceaux.join(" ");
  return {
    sourceId: "cryptoquant",
    sourceEffective: recus.some((c) => c.appel) ? "CryptoQuant BASIC" : "archive locale CryptoQuant",
    observeLe: m.jourRef === null ? null : tempsJour(m.jourRef),
    recupereLe: m.recupereLe,
    cadenceMs: JOUR_MS,
    // Observation datée au DÉBUT du jour clos (00:00 UTC) : 3 j équivaut à « dernier jour
    // antérieur à aujourd'hui − 2 j », le seuil de `diagnostiquer`, et reprend le délai des séries
    // quotidiennes de CHAIN (hashrate, thermocap). Avec 2 j, le bloc serait « périmé » chaque matin
    // où J-1 n'est pas encore publié (spec §4.5 amendée, §12).
    ageMaxMs: 3 * JOUR_MS,
    couverture: { disponibles: m.disponibles, attendus: ATTENDUES },
    estime: false,
    acces: "cle",
    statut,
    ...(raison === undefined ? {} : { raison }),
  };
}
```

- [ ] **Étape 4 : lancer le test et vérifier qu'il passe**

```bash
pnpm --filter @axiom/web exec vitest run src/components/onchain/MineursCotes.test.tsx
```

Attendu : `Tests  8 passed (8)`.

- [ ] **Étape 5 : écrire le test qui échoue (vue triable, signaux, en-tête, conteneur)** — dans `MineursCotes.test.tsx`, remplacer la ligne `import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";` par les trois lignes suivantes :

```tsx
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
```

puis remplacer le bloc d'import `./MineursCotes` (de `import {` à `} from "./MineursCotes";`) par :

```tsx
import {
  construireModeleMineurs,
  EnTeteMineursCotes,
  ID_QUALITE_MINEURS,
  IDS_SOCIETES,
  LIBELLE_QUALITE_MINEURS,
  MineursCotes,
  qualiteMineursCotes,
  VueMineursCotes,
  type PropsEnTeteMineursCotes,
  type PropsVueMineursCotes,
} from "./MineursCotes";
```

puis ajouter à la fin du fichier :

```tsx
const PROPS_VUE: PropsVueMineursCotes = {
  chargements: {},
  enCours: false,
  recues: 9,
  file: { enAttente: 0, repriseTs: null },
  now: MAINTENANT,
  onOuvrirReglages: () => {},
};
// renderToStaticMarkup échappe l'apostrophe.
const vue = (surcharge: Partial<PropsVueMineursCotes>): string =>
  renderToStaticMarkup(<VueMineursCotes {...PROPS_VUE} {...surcharge} />).replaceAll("&#x27;", "'");
const entete = (surcharge: Partial<PropsEnTeteMineursCotes>): string =>
  renderToStaticMarkup(<EnTeteMineursCotes ouvert={false} onBasculer={() => {}} {...PROPS_VUE} {...surcharge} />);
/** Raison d'une clé personnelle refusée (401), affichée telle quelle. */
const RAISON_REFUS = "Clé CryptoQuant refusée (Réglages ⚙).";

/** Neuf séries au même statut, sans archive. */
function sansArchive(statut: ChargementCq["statut"], raison: string): Chargements {
  const resultat: Chargements = {};
  for (const id of IDS_SOCIETES) {
    resultat[serie(id)] = chargement(id, {
      statut,
      raison,
      archive: null,
      diagnostic: diagnostic({ debut: null, dernier: null, hierPresent: false, perime: true }),
      appel: false,
    });
  }
  return resultat;
}

describe("production des mineurs cotés : vue, en-tête et conteneur", () => {
  beforeEach(() => vi.setSystemTime(MAINTENANT));
  afterEach(() => vi.useRealTimers());

  it("9/9 : neuf lignes triées par BTC J-1, valeurs brutes, Σ, courbe, archive et limites", () => {
    const html = vue({ chargements: tous() });
    expect(html.match(/role="row"/g)).toHaveLength(10); // en-tête + 9 sociétés ; la ligne Σ est hors tableau
    expect(html).not.toContain("<table");
    expect(html).toContain('title="MARA Holdings">MARA<');
    expect(html.indexOf(">MARA<")).toBeLessThan(html.indexOf(">CLSK<"));
    expect(html.indexOf(">CLSK<")).toBeLessThan(html.indexOf(">CORE<"));
    expect(html).toContain('title="coinbase 49.00 + autres 0.05 BTC">49.05<');
    expect(html).toContain("396.96");
    expect(html).toContain("$3.84M");
    expect(html).toContain("non publié");
    expect(html).toContain("123.00 BTC");
    expect(html).toContain(
      "2026-09-15 (J-1) · 9/9 sociétés · Σ 130.00 BTC/j · cumul mois Σ 1611.21 BTC · Σ $10.18M/j",
    );
    expect(html).toContain(">Σ 9<");
    expect(html).toContain(">1611.21<");
    expect(html).not.toContain("Σ partielle");
    expect(html).toContain("<svg");
    expect(html).toContain("Production Σ 9 sociétés");
    expect(html).toContain("Archive locale depuis 2026-08-17 · 30 j · 0 perdu");
    expect(html).not.toContain("J-1 en attente");
    expect(html).toContain("J-1 · CryptoQuant");
    expect(html).toContain("miner-data/companies (9 requêtes)");
    expect(html).toContain("périmètre non documenté");
    expect(html).toContain("sans daemon : vider le stockage du navigateur perd l'archive");
    expect(html).toContain("récupéré 2026-09-16");
    expect(html).not.toContain("cache ou observation périmé");
    expect(html).not.toContain("archive locale illisible");
    expect(html).not.toMatch(/\d %/); // aucun écart déclaré/observé en pourcentage
    expect(html).not.toContain("reçues");
  });

  it("chargement puis 7/9 en cours : progression du quota, tirets motivés, Σ partielle", () => {
    const vide = vue({ enCours: true, recues: 0 });
    expect(vide).toContain("0/9 reçues · chargement…");
    expect(vide).toContain("Chargement de la production des mineurs cotés…");
    const chargements = tous();
    delete chargements[serie("wulf")];
    delete chargements[serie("core")];
    const html = vue({ chargements, enCours: true, recues: 7, file: { enAttente: 2, repriseTs: null } });
    expect(html).toContain("7/9 reçues · en attente du quota CryptoQuant (10 req/min)");
    expect(html).toContain("Σ partielle 7/9");
    expect(html).not.toContain(">Σ 9<");
    expect(html).toContain('title="Série non encore reçue.">—<');
    expect(html.match(/role="row"/g)).toHaveLength(10);
    expect(html).not.toContain("<svg");
    expect(html).not.toMatch(/>0\.00</);
  });

  it("échec d'une société : bandeau « archive servie », motif en infobulle, J-1 en attente", () => {
    const chargements = tous();
    chargements[serie("hive")] = chargement("hive", {
      statut: "quota",
      raison: "Quota CryptoQuant atteint (429) ; nouvel essai dans 30 s.",
      archive: archive("hive", JOURS.slice(0, -1)),
      diagnostic: diagnostic({ dernier: "2026-09-14", hierPresent: false }),
    });
    const html = vue({ chargements });
    expect(html).toContain("archive servie");
    expect(html).toContain('title="Quota CryptoQuant atteint (429) ; nouvel essai dans 30 s.">—<');
    expect(html).toContain("Σ partielle 8/9");
    expect(html).toContain("J-1 en attente de publication (1/9)");
  });

  it("sans clé ni archive : SansCle avec le complément local, CTA d'en-tête, jamais de zéro", () => {
    const html = vue({ chargements: sansCle() });
    expect(html).toContain(
      "Clé CryptoQuant personnelle requise (Réglages ⚙) — ou CRYPTOQUANT_API_KEY dans apps/web/.env pour le proxy Vite et le daemon.",
    );
    expect(html).toContain("Ouvrir les réglages ⚙");
    expect(html).not.toContain('role="table"');
    expect(html).not.toContain("0.00");
    const tete = entete({ chargements: sansCle() });
    expect(tete).toContain("clé CryptoQuant ⚙");
    expect(tete).toContain("clé personnelle requise");
    // Archive existante sans clé : lignes servies avec « clé requise pour actualiser ».
    const avecArchive = tous();
    avecArchive[serie("mara")] = chargement("mara", {
      statut: "cle-requise",
      raison: RAISON_CLE_CRYPTOQUANT,
      archive: archive("mara", JOURS.slice(0, -1)),
      diagnostic: diagnostic({ dernier: "2026-09-14", hierPresent: false }),
      appel: false,
    });
    expect(vue({ chargements: avecArchive })).toContain("clé requise pour actualiser");
  });

  it("clé refusée (401) sans archive : raison telle quelle, bouton Réglages et CTA d'en-tête, sans complément .env", () => {
    const refus = sansArchive("cle-requise", RAISON_REFUS);
    const html = vue({ chargements: refus });
    expect(html).toContain(RAISON_REFUS);
    expect(html).toContain("Ouvrir les réglages ⚙");
    expect(html).not.toContain("CRYPTOQUANT_API_KEY");
    expect(html).not.toContain('role="table"');
    const tete = entete({ chargements: refus });
    expect(tete).toContain("clé CryptoQuant ⚙");
    expect(tete).toContain("clé CryptoQuant refusée");
    expect(tete).not.toContain("clé personnelle requise");
  });

  it("offre refusée sans archive : motif du fournisseur, ni réglages ni valeur inventée", () => {
    const refus = sansArchive("offre", "Professional plan and above");
    const html = vue({ chargements: refus });
    expect(html).toContain("Professional plan and above");
    expect(html).not.toContain("Ouvrir les réglages");
    expect(html).not.toContain('role="table"');
    expect(entete({ chargements: refus })).not.toContain("clé CryptoQuant ⚙");
  });

  it("en-tête : bouton replié, état de collecte, CTA réservé aux séries « clé requise »", () => {
    const pret = entete({ chargements: tous() });
    expect(pret).toContain('aria-expanded="false"');
    expect(pret).toContain("Production des mineurs cotés ▸");
    expect(pret).toContain("archive 30 j · J-1 2026-09-15");
    expect(pret).not.toContain("clé CryptoQuant ⚙");
    expect(entete({ chargements: tous(), ouvert: true })).toContain('aria-expanded="true"');
    const quota = tous();
    quota[serie("mara")] = chargement("mara", {
      statut: "quota",
      raison: "Quota CryptoQuant atteint (429) ; nouvel essai dans 30 s.",
    });
    expect(entete({ chargements: quota })).not.toContain("clé CryptoQuant ⚙");
    const refusee = tous();
    refusee[serie("mara")] = chargement("mara", { statut: "cle-requise", raison: RAISON_REFUS });
    const avecRefus = entete({ chargements: refusee });
    expect(avecRefus).toContain("clé CryptoQuant ⚙");
    expect(avecRefus).toContain("archive 30 j · J-1 2026-09-15");
    expect(entete({ chargements: quota, file: { enAttente: 0, repriseTs: MAINTENANT + 42_000 } })).toContain("quota atteint, reprise 42 s");
    expect(entete({ chargements: tous(), file: { enAttente: 0, repriseTs: MAINTENANT + 42_000 } })).not.toContain("quota atteint");
    expect(entete({ enCours: true, recues: 2, file: { enAttente: 3, repriseTs: null } })).toContain(
      "2/9 reçues · en attente du quota",
    );
    expect(entete({ enCours: true, recues: 0 })).toContain("chargement…");
  });

  it("signaux d'archive : stockage plein, copie daemon non écrite, archive illisible remplacée, périmé", async () => {
    const { RAISON_ARCHIVE_ILLISIBLE_CRYPTOQUANT } = await import("../../data/onchain/cryptoquant");
    const avecDaemon: Chargements = {};
    for (const id of IDS_SOCIETES) avecDaemon[serie(id)] = chargement(id, { persistance: { local: true, kv: true } });
    avecDaemon[serie("mara")] = chargement("mara", { persistance: { local: false, kv: true } });
    avecDaemon[serie("riot")] = chargement("riot", { persistance: { local: true, kv: false } });
    const html = vue({ chargements: avecDaemon });
    expect(html).toContain("archive non persistée localement (stockage plein)");
    expect(html).toContain("copie daemon non écrite");
    expect(html).not.toContain("sans daemon");
    expect(html).not.toContain("archive servie");
    expect(html).not.toContain("archive locale illisible remplacée");
    expect(html).not.toContain("cache ou observation périmé");

    const illisible = tous();
    illisible[serie("hive")] = chargement("hive", { raison: RAISON_ARCHIVE_ILLISIBLE_CRYPTOQUANT });
    const avecIllisible = vue({ chargements: illisible });
    expect(avecIllisible).toContain("archive locale illisible remplacée");
    expect(avecIllisible).not.toContain("archive servie");
    expect(avecIllisible).toContain(">Σ 9<");
    expect(entete({ chargements: illisible })).not.toContain("clé CryptoQuant ⚙");

    const anciens: Chargements = {};
    for (const id of IDS_SOCIETES) {
      anciens[serie(id)] = chargement(id, {
        archive: archive(id, JOURS.slice(0, -2)),
        diagnostic: diagnostic({ dernier: "2026-09-13", hierPresent: false, perime: true }),
      });
    }
    const perimee = vue({ chargements: anciens });
    expect(perimee).toContain("cache ou observation périmé");
    expect(perimee).toContain("2026-09-13 (J-3) · 9/9 sociétés");
    expect(perimee).toContain("J-1 en attente de publication (9/9)");
  });

  it("tri : BTC J-1 décroissant par défaut, tri imposé par le conteneur, en-têtes cliquables avec onTri", () => {
    const defaut = vue({ chargements: tous() });
    expect(defaut).not.toContain("<button");
    expect(defaut.indexOf(">MARA<")).toBeLessThan(defaut.indexOf(">CLSK<"));
    const parSociete = vue({ chargements: tous(), tri: { colonne: "societe", dir: 1 } });
    expect(parSociete.indexOf(">BITF<")).toBeLessThan(parSociete.indexOf(">CIPHER<"));
    expect(parSociete.indexOf(">CORE<")).toBeLessThan(parSociete.indexOf(">MARA<"));
    expect(parSociete.indexOf(">RIOT<")).toBeLessThan(parSociete.indexOf(">WULF<"));
    const cliquable = vue({ chargements: tous(), onTri: () => {} });
    expect(cliquable.match(/<button/g)).toHaveLength(5);
    expect(cliquable).toContain("BTC J-1<span>▾</span>");
    expect(vue({ chargements: tous(), tri: { colonne: "usd", dir: 1 }, onTri: () => {} })).toContain(
      "USD J-1<span>▴</span>",
    );
    // Une société sans ligne reste en fin de liste, quel que soit le sens.
    const partielle = tous();
    delete partielle[serie("bitf")];
    const croissant = vue({ chargements: partielle, tri: { colonne: "btc", dir: 1 } });
    expect(croissant.indexOf(">CORE<")).toBeLessThan(croissant.indexOf(">WULF<"));
    expect(croissant.indexOf(">MARA<")).toBeLessThan(croissant.indexOf(">BITF<"));
  });

  it("conteneur : sous-section repliée par défaut, aucun contenu rendu", () => {
    const html = renderToStaticMarkup(<MineursCotes onOuvrirReglages={() => {}} />);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Production des mineurs cotés");
    expect(html).not.toContain('role="table"');
    expect(html).not.toContain("Σ");
  });

  it("source : le client n'est chargé que par import(), client et module partagé importés en type seulement", () => {
    const source = readFileSync(new URL("./MineursCotes.tsx", import.meta.url), "utf8");
    expect(source).toContain('await import("../../data/onchain/cryptoquant")');
    const imports = source
      .split("\n")
      .filter((l) => /from "(?:\.\.\/)+(?:data\/onchain\/cryptoquant|shared\/cryptoquant-proxy)"/.test(l));
    expect(imports).toHaveLength(2);
    expect(imports.every((l) => l.startsWith("import type "))).toBe(true);
  });
});
```

- [ ] **Étape 6 : lancer le test et vérifier qu'il échoue**

```bash
pnpm --filter @axiom/web exec vitest run src/components/onchain/MineursCotes.test.tsx
```

Échec attendu : `Tests  11 failed | 8 passed (19)`. Les 8 tests du premier `describe` passent. Dix nouveaux tests échouent avec `Element type is invalid: expected a string (for built-in components) or a class/function (for composite components) but got: undefined.` (`VueMineursCotes`, `EnTeteMineursCotes` et `MineursCotes` ne sont pas encore exportés). Le test « source » échoue sur `expected '…' to contain 'await import("../../data/onchain/cryptoquant")'`.

- [ ] **Étape 7 : implémentation minimale (vue triable, signaux, en-tête, conteneur)** — dans `MineursCotes.tsx`, remplacer les quatre lignes d'import :

```tsx
import type { IdMineurCq } from "../../../../../shared/cryptoquant-proxy";
import type { ChargementCq, LigneCq, LigneMineur, SerieCq } from "../../data/onchain/cryptoquant";
import type { QualiteMetrique } from "../../data/qualiteMetrique";
import { dateObservation } from "./HistoriqueCommun";
```

par :

```tsx
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { IdMineurCq } from "../../../../../shared/cryptoquant-proxy";
import type { ChargementCq, LigneCq, LigneMineur, SerieCq } from "../../data/onchain/cryptoquant";
import type { QualiteMetrique } from "../../data/qualiteMetrique";
import { IS_VERCEL } from "../../lib/deployment";
import { formatDec, formatUsd } from "../../lib/format";
import { useHorloge } from "../../lib/horloge";
import { cryptoquantKeyStore, messageSansCleCq, RAISON_CLE_CRYPTOQUANT } from "../../store/cryptoquant";
import { enregistrerQualite } from "../../store/qualiteMetriques";
import { TableTriable, trierLignes, type ColonneTable, type TriTable } from "../TableTriable";
import { Badge, BadgeFiabilite, NoteSource, SansCle, Vide } from "../ui";
import { boutonHistorique, CourbeOnchain, dateObservation } from "./HistoriqueCommun";
```

puis ajouter à la fin du fichier :

```tsx
// ─────────────────────────── Vue, en-tête et conteneur ───────────────────────────

/** Tri par défaut : BTC J-1 décroissant ; les sociétés sans ligne restent en fin de liste. */
const TRI_DEFAUT: TriTable = { colonne: "btc", dir: -1 };

const abreger = (jours: readonly string[]): string =>
  jours.length <= 3 ? jours.join(", ") : `${jours[0] ?? ""} … ${jours.at(-1) ?? ""}`;

const tiret = (motif: string) => <span title={motif}>—</span>;

const COLONNES: ReadonlyArray<ColonneTable<LigneSociete>> = [
  {
    id: "societe",
    label: "Société",
    largeur: "minmax(0,1.2fr)",
    triable: true,
    valeurTri: (l) => l.id,
    rendu: (l) => <span title={l.nom}>{l.id.toUpperCase()}</span>,
  },
  {
    id: "btc",
    label: "BTC J-1",
    align: "right",
    triable: true,
    valeurTri: (l) => l.ligne?.r ?? null,
    rendu: (l) =>
      l.ligne === null ? (
        tiret(l.motif)
      ) : (
        <span title={`coinbase ${formatDec(l.ligne.cr)} + autres ${formatDec(l.ligne.om)} BTC`}>
          {formatDec(l.ligne.r)}
        </span>
      ),
  },
  {
    id: "cumul",
    label: "Cumul mois",
    align: "right",
    triable: true,
    valeurTri: (l) => l.ligne?.cm ?? null,
    rendu: (l) => (l.ligne === null ? tiret(l.motif) : formatDec(l.ligne.cm)),
  },
  {
    id: "usd",
    label: "USD J-1",
    align: "right",
    triable: true,
    valeurTri: (l) => l.ligne?.usd ?? null,
    rendu: (l) => (l.ligne === null ? tiret(l.motif) : formatUsd(l.ligne.usd)),
  },
  {
    id: "decl",
    label: "Déclaré (mois)",
    align: "right",
    largeur: "minmax(0,1.2fr)",
    triable: true,
    valeurTri: (l) => l.ligne?.decl ?? null,
    // Valeur brute publiée par la société ; aucun écart avec la production observée.
    rendu: (l) =>
      l.ligne === null ? tiret(l.motif) : l.ligne.decl === null ? "non publié" : `${formatDec(l.ligne.decl)} BTC`,
  },
];
/** Même gabarit de colonnes que TableTriable, pour la ligne Σ rendue hors tri. */
const GRILLE = COLONNES.map((c) => c.largeur ?? "1fr").join(" ");

function texteArchive(a: ModeleMineursCotes["archive"]): string {
  const morceaux = [`Archive locale depuis ${a.debut ?? "—"}`, `${a.jours} j`];
  const n = a.manquants.length;
  if (n > 0) morceaux.push(`${n} manquant${accord(n)} dans la fenêtre (${abreger(a.manquants)})`);
  const p = a.perdus.length;
  morceaux.push(p === 0 ? "0 perdu" : `${p} perdu${accord(p)} définitivement (${abreger(a.perdus)})`);
  if (a.hierEnAttente > 0) morceaux.push(`J-1 en attente de publication (${a.hierEnAttente}/${ATTENDUES})`);
  return morceaux.join(" · ");
}

/** Signaux de persistance et d'archive, jamais silencieux (une série prête avec raison = archive illisible remplacée). */
function signauxArchive(recus: readonly ChargementCq[]): string[] {
  const signaux: string[] = [];
  if (recus.some((c) => !c.persistance.local)) signaux.push("archive non persistée localement (stockage plein)");
  if (recus.some((c) => c.persistance.kv === false)) signaux.push("copie daemon non écrite");
  if (recus.some((c) => c.statut === "pret" && c.raison !== null)) signaux.push("archive locale illisible remplacée");
  return signaux;
}

export interface PropsVueMineursCotes {
  chargements: Partial<Record<SerieCq, ChargementCq>>;
  enCours: boolean;
  recues: number;
  file: { enAttente: number; repriseTs: number | null };
  now: number;
  onOuvrirReglages: () => void;
  /** Tri de la table ; absent = BTC J-1 décroissant, `null` = ordre fournisseur. */
  tri?: TriTable | null;
  /** Clic d'en-tête ; absent = en-têtes non cliquables (rendu statique). */
  onTri?: (tri: TriTable) => void;
}

/** Contenu déplié de la sous-section. PURE et sans état (rendu statique testé). */
export function VueMineursCotes({
  chargements,
  enCours,
  recues,
  file,
  now,
  onOuvrirReglages,
  tri = TRI_DEFAUT,
  onTri,
}: PropsVueMineursCotes) {
  const m = construireModeleMineurs(chargements, now);
  const recus = recusDe(chargements);
  const raisons = raisonsEchec(recus);
  const cleRequise = recus.some((c) => c.statut === "cle-requise");
  const progression = enCours ? (
    <NoteSource>
      {`${recues}/${ATTENDUES} reçues · ${file.enAttente > 0 ? "en attente du quota CryptoQuant (10 req/min)" : "chargement…"}`}
    </NoteSource>
  ) : null;

  if (m.archive.jours === 0) {
    if (enCours) {
      return (
        <div className="mt-2 space-y-2">
          {progression}
          <Vide>Chargement de la production des mineurs cotés…</Vide>
        </div>
      );
    }
    if (cleRequise) {
      // Clé absente : message complété selon le déploiement. Clé refusée (401) : raison telle quelle.
      const cleAbsente = recus.some((c) => c.statut === "cle-requise" && c.raison === RAISON_CLE_CRYPTOQUANT);
      const refus =
        recus.find((c) => c.statut === "cle-requise" && c.raison !== RAISON_CLE_CRYPTOQUANT)?.raison ?? null;
      return (
        <div className="mt-2">
          <SansCle
            message={cleAbsente || refus === null ? messageSansCleCq(IS_VERCEL) : refus}
            onOuvrirReglages={onOuvrirReglages}
          />
        </div>
      );
    }
    return (
      <div className="mt-2">
        <Vide>{raisons.length > 0 ? raisons.join(" ") : "Aucune ligne CryptoQuant archivée."}</Vide>
      </div>
    );
  }

  const s = m.somme;
  const entete =
    m.jourRef === null
      ? ""
      : [
          `${m.jourRef} (J-${m.retardJours ?? 0})`,
          `${m.disponibles}/${ATTENDUES} sociétés`,
          ...(s === null
            ? [`Σ partielle ${m.disponibles}/${ATTENDUES}`]
            : [
                `Σ ${formatDec(s.r)} BTC/j`,
                `cumul mois Σ ${s.cm === null ? "—" : `${formatDec(s.cm)} BTC`}`,
                `Σ ${formatUsd(s.usd)}/j`,
              ]),
        ].join(" · ");
  const signaux = signauxArchive(recus);
  const sansDaemon = recus.some((c) => c.persistance.kv === null);
  const perime = recus.some((c) => c.archive !== null && c.diagnostic.perime);

  return (
    <div className="mt-2 space-y-2">
      {progression}
      {raisons.length > 0 && (
        <NoteSource>
          <Badge ton="warn">{cleRequise ? "clé requise pour actualiser" : "archive servie"}</Badge> {raisons.join(" ")}
        </NoteSource>
      )}
      {entete !== "" && <p className="text-[11px] tabular-nums text-text">{entete}</p>}
      <TableTriable
        colonnes={COLONNES}
        lignes={trierLignes(m.lignes, COLONNES, tri)}
        tri={tri}
        onTri={onTri}
        cle={(l) => l.id}
        ariaLabel="Production des mineurs cotés"
      />
      <div
        className="grid items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[11px] font-medium tabular-nums"
        style={{ gridTemplateColumns: GRILLE }}
      >
        {s === null ? (
          <span className="col-span-full text-text-dim">
            {`Σ partielle ${m.disponibles}/${ATTENDUES} : somme affichée seulement quand les neuf sociétés ont une ligne au ${m.jourRef ?? "—"}.`}
          </span>
        ) : (
          <>
            <span>{`Σ ${ATTENDUES}`}</span>
            <span className="text-right">{formatDec(s.r)}</span>
            <span className="text-right">{formatDec(s.cm)}</span>
            <span className="text-right">{formatUsd(s.usd)}</span>
            <span className="text-right">—</span>
          </>
        )}
      </div>
      <CourbeOnchain points={m.courbe} label={`Production Σ ${ATTENDUES} sociétés`} unite="BTC/j" />
      <NoteSource>
        {texteArchive(m.archive)}
        {perime && (
          <>
            {" · "}
            <Badge ton="warn">cache ou observation périmé</Badge>
          </>
        )}
      </NoteSource>
      {signaux.length > 0 && (
        <NoteSource>
          <Badge ton="warn">archive</Badge>
          {` ${signaux.join(" · ")}`}
        </NoteSource>
      )}
      <NoteSource>
        <BadgeFiabilite
          niveau="partiel"
          label="J-1 · CryptoQuant"
          title="Offre BASIC : jours clos seulement (J-1), 30 jours glissants sans rattrapage, licence personnelle."
        />
        {` · CryptoQuant · miner-data/companies (${ATTENDUES} requêtes) · licence personnelle · attribution des blocs par le fournisseur (périmètre non documenté) · cumul mois = valeur fournisseur, non recalculée · « déclaré » = production publiée par la société, absente hors publication, sans écart calculé · Σ = sommes d'affichage des ${ATTENDUES} lignes, seulement à ${ATTENDUES}/${ATTENDUES}`}
        {sansDaemon ? " · sans daemon : vider le stockage du navigateur perd l'archive" : ""}
        {m.recupereLe !== null ? ` · récupéré ${dateObservation(m.recupereLe)}` : ""}
      </NoteSource>
    </div>
  );
}

export type PropsEnTeteMineursCotes = PropsVueMineursCotes & { ouvert: boolean; onBasculer: () => void };

/**
 * Ligne d'en-tête toujours visible : bouton replié par défaut, état de collecte à droite et CTA
 * « clé CryptoQuant ⚙ » dès qu'une série attend une clé (absente ou refusée par le fournisseur) ;
 * jamais sur un quota, une offre ou une panne, où les Réglages ne changeraient rien.
 */
export function EnTeteMineursCotes({
  ouvert,
  onBasculer,
  chargements,
  enCours,
  recues,
  file,
  now,
  onOuvrirReglages,
}: PropsEnTeteMineursCotes) {
  const m = construireModeleMineurs(chargements, now);
  const recus = recusDe(chargements);
  const cleRequise = recus.some((c) => c.statut === "cle-requise");
  const cleAbsente = recus.some((c) => c.statut === "cle-requise" && c.raison === RAISON_CLE_CRYPTOQUANT);
  // Reprise affichée seulement si une série est en quota (429) : une pause `remaining: 0` seule n'en est pas un.
  const enQuota = recus.some((c) => c.statut === "quota");
  const repriseS =
    enQuota && file.repriseTs !== null && file.repriseTs > now ? Math.ceil((file.repriseTs - now) / 1000) : null;
  const etat = enCours
    ? file.enAttente > 0
      ? `${recues}/${ATTENDUES} reçues · en attente du quota`
      : "chargement…"
    : repriseS !== null
      ? `quota atteint, reprise ${repriseS} s`
      : cleRequise && m.archive.jours === 0
        ? cleAbsente
          ? "clé personnelle requise"
          : "clé CryptoQuant refusée"
        : m.jourRef !== null && m.retardJours !== null
          ? `archive ${m.archive.jours} j · J-${m.retardJours} ${m.jourRef}`
          : "";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <button type="button" className={boutonHistorique} aria-expanded={ouvert} onClick={onBasculer}>
        {`Production des mineurs cotés ${ouvert ? "▾" : "▸"}`}
      </button>
      <span className="flex items-center gap-2 text-[10px] text-text-dim">
        {cleRequise && (
          <button
            type="button"
            onClick={onOuvrirReglages}
            className="text-[10px] text-accent hover:underline"
            title="Clé personnelle CryptoQuant (offre BASIC) à saisir dans les Réglages"
          >
            clé CryptoQuant ⚙
          </button>
        )}
        {etat !== "" && <span>{etat}</span>}
      </span>
    </div>
  );
}

/**
 * Conteneur : repliée par défaut, charge les neuf séries au MONTAGE (et à chaque changement de
 * clé, via `version`), affiche au fil de l'eau, publie la qualité après la boucle. Un abandon
 * (démontage, double montage du mode strict) ne publie rien et n'occupe aucun créneau. L'état du
 * tri vit ici ; la vue reste pure.
 */
export function MineursCotes({ onOuvrirReglages }: { onOuvrirReglages: () => void }) {
  const [ouvert, setOuvert] = useState(false);
  const [tri, setTri] = useState<TriTable>(TRI_DEFAUT);
  const [chargements, setChargements] = useState<Chargements>({});
  const [enCours, setEnCours] = useState(true);
  const [recues, setRecues] = useState(0);
  const [file, setFile] = useState<{ enAttente: number; repriseTs: number | null }>({
    enAttente: 0,
    repriseTs: null,
  });
  const version = useStore(cryptoquantKeyStore, (s) => s.version);
  const now = useHorloge();

  useEffect(() => {
    const ctrl = new AbortController();
    const abonnement: { fin: (() => void) | null } = { fin: null };
    setEnCours(true);
    setRecues(0);
    void (async () => {
      const cq = await import("../../data/onchain/cryptoquant");
      if (ctrl.signal.aborted) return;
      const publierFile = () => setFile(cq.etatFileCq());
      abonnement.fin = cq.abonnerFileCq(publierFile);
      publierFile();
      const recus: Chargements = {};
      let n = 0;
      for (const serie of cq.SERIES_MINEURS) {
        const charge = await cq.chargerSerieCq(serie, ctrl.signal);
        if (ctrl.signal.aborted) return;
        recus[serie] = charge;
        n += 1;
        setRecues(n);
        setChargements((precedents) => {
          const suivants: Chargements = { ...precedents };
          suivants[serie] = charge;
          return suivants;
        });
      }
      setEnCours(false);
      enregistrerQualite(ID_QUALITE_MINEURS, LIBELLE_QUALITE_MINEURS, qualiteMineursCotes(recus, Date.now()));
    })().catch(() => {
      // Abandon pendant une attente ou chunk introuvable : rien n'est publié pour ce cycle.
      if (!ctrl.signal.aborted) setEnCours(false);
    });
    return () => {
      ctrl.abort();
      abonnement.fin?.();
    };
  }, [version]);

  return (
    <div className="mt-3 space-y-1">
      <EnTeteMineursCotes
        ouvert={ouvert}
        onBasculer={() => setOuvert((v) => !v)}
        chargements={chargements}
        enCours={enCours}
        recues={recues}
        file={file}
        now={now}
        onOuvrirReglages={onOuvrirReglages}
      />
      {ouvert && (
        <VueMineursCotes
          chargements={chargements}
          enCours={enCours}
          recues={recues}
          file={file}
          now={now}
          onOuvrirReglages={onOuvrirReglages}
          tri={tri}
          onTri={setTri}
        />
      )}
    </div>
  );
}
```

- [ ] **Étape 8 : lancer le test et vérifier qu'il passe**

```bash
pnpm --filter @axiom/web exec vitest run src/components/onchain/MineursCotes.test.tsx src/components/uiConventions.test.ts
```

Attendu : les 19 tests de `MineursCotes.test.tsx` verts et tous les tests du ratchet `uiConventions.test.ts` verts. Le nouveau fichier ne contient aucun `<table` ni motif maison, même en commentaire. Ne jamais y écrire le mot anglais « Metric » isolé, interdit par le motif `metric-deprecie`.

- [ ] **Étape 9 : écrire le test qui échoue (emplacement dans la section Mineurs)** — dans `MineursCotes.test.tsx`, ajouter après le bloc d'import `./MineursCotes` la ligne :

```tsx
import { Mineurs, VueMineurs } from "./Mineurs";
```

puis ajouter à la fin du fichier :

```tsx
describe("section Mineurs : emplacement de la production des mineurs cotés", () => {
  it("les enfants de VueMineurs sont rendus avant la note de source", () => {
    const html = renderToStaticMarkup(
      <VueMineurs hashrate={null} revenus={null}>
        <p>sous-section-test</p>
      </VueMineurs>,
    );
    expect(html).toContain("sous-section-test");
    expect(html.indexOf("sous-section-test")).toBeLessThan(html.indexOf("Hash Ribbons : capitulation"));
  });

  it("le conteneur Mineurs monte la sous-section seulement fenêtre ouverte", () => {
    expect(renderToStaticMarkup(<Mineurs open hashrate={null} />)).toContain("Production des mineurs cotés");
    expect(renderToStaticMarkup(<Mineurs open={false} hashrate={null} />)).not.toContain(
      "Production des mineurs cotés",
    );
  });
});
```

- [ ] **Étape 10 : lancer le test et vérifier qu'il échoue**

```bash
pnpm --filter @axiom/web exec vitest run src/components/onchain/MineursCotes.test.tsx
```

Échec attendu : `Tests  2 failed | 19 passed (21)`. Les deux échecs sont `expected '<section>…' to contain 'sous-section-test'` (les enfants sont ignorés) et `expected '<section>…' to contain 'Production des mineurs cotés'`.

- [ ] **Étape 11 : implémentation minimale** — remplacer tout le contenu de `apps/web/src/components/onchain/Mineurs.tsx` (lignes 1-127) par :

```tsx
/**
 * Section « Mineurs » de CHAIN : Hash Ribbons (SMA 30 / 60 j du hashrate mempool.space,
 * déjà chargé par la fenêtre — aucun second appel) et hashprice (revenus mineurs
 * blockchain.info rapportés au hashrate du même jour UTC), puis la sous-section
 * « Production des mineurs cotés » (CryptoQuant) passée en `children`.
 *
 * Vue PURE `VueMineurs` (testée en rendu statique) + conteneur `Mineurs` qui charge les
 * revenus à l'ouverture (cache 6 h, dégradation gracieuse dans `data/onchain/mineurs.ts`).
 * `MineursCotes` garde son propre état, hors de l'effet des revenus : son court-circuit
 * « J-1 archivé → zéro appel » rend chaque montage de CHAIN sans coût.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import type { PointMetrique, SerieMetrique } from "../../data/onchain/coinmetrics";
import type { ResultatFrais } from "../../data/onchain/mempool";
import {
  calculerHashprice,
  calculerHashRibbons,
  fetchRevenusMineurs,
  RIBBONS_COURTE,
  RIBBONS_LONGUE,
  type EtatRibbons,
} from "../../data/onchain/mineurs";
import { formatDec, formatUsd } from "../../lib/format";
import { settingsUiStore } from "../../store/settings-ui";
import { Badge, NoteSource, TitreSection, TuileStat, Vide, type TonBadge } from "../ui";
import { CourbeOnchain, dateObservation, ProvenanceOnchain } from "./HistoriqueCommun";
import { MineursCotes } from "./MineursCotes";

const ETATS: Record<EtatRibbons, { texte: string; ton: TonBadge }> = {
  capitulation: { texte: "Capitulation", ton: "down" },
  reprise: { texte: "Reprise", ton: "up" },
  expansion: { texte: "Expansion", ton: "neutre" },
};

function ehs(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return "—";
  return `${(v / 1e18).toFixed(1)} EH/s`;
}

export function VueMineurs({
  hashrate,
  revenus,
  loading = false,
  children,
}: {
  hashrate: SerieMetrique | null;
  revenus: ResultatFrais<PointMetrique[]> | null;
  loading?: boolean;
  /** Sous-section rendue après la courbe et la provenance, avant la note de source. */
  children?: ReactNode;
}) {
  const points = hashrate?.points ?? [];
  const rubans = calculerHashRibbons(points);
  const hashprice = revenus === null ? null : calculerHashprice(revenus.donnee, points);
  const dernierRevenu = revenus?.donnee.at(-1);
  const etat = rubans.etat === null ? null : ETATS[rubans.etat];

  return (
    <section>
      <TitreSection>Mineurs</TitreSection>
      <div className="grid grid-cols-2 gap-2">
        <TuileStat
          label={`Hash Ribbons (${RIBBONS_COURTE}/${RIBBONS_LONGUE} j)`}
          valeur={etat?.texte ?? "—"}
          ton={rubans.etat === "capitulation" ? "down" : rubans.etat === "reprise" ? "up" : undefined}
          badge={etat === null ? undefined : <Badge ton={etat.ton}>hashrate</Badge>}
          pied={
            <>
              <span className="truncate" title="SMA courte / SMA longue du hashrate">
                {`SMA ${ehs(rubans.courte.at(-1)?.value)} / ${ehs(rubans.longue.at(-1)?.value)}`}
              </span>
              <span className="shrink-0" title="Dernier croisement des rubans">
                {rubans.croisement === null
                  ? ""
                  : `croisement ${rubans.croisement.sens === "haussier" ? "↑" : "↓"} ${dateObservation(rubans.croisement.time)}`}
              </span>
            </>
          }
        />
        <TuileStat
          label="Hashprice"
          valeur={hashprice?.dernier === undefined ? "—" : `${formatDec(hashprice.dernier.value, 2)} $/PH/j`}
          couleur="var(--serie-4)"
          pied={
            <>
              <span className="truncate">{`revenus / j ${formatUsd(dernierRevenu?.value)}`}</span>
              <span className="shrink-0">{dernierRevenu === undefined ? "" : dateObservation(dernierRevenu.time)}</span>
            </>
          }
        />
      </div>
      {loading && revenus === null ? (
        <Vide>Chargement des revenus mineurs…</Vide>
      ) : hashprice !== null && hashprice.points.length >= 2 ? (
        <CourbeOnchain points={hashprice.points} label="Hashprice" unite="$/PH/j" />
      ) : revenus === null ? (
        <Vide>Revenus mineurs indisponibles (blockchain.info).</Vide>
      ) : null}
      {revenus !== null && (
        <ProvenanceOnchain
          source="mempool.space + blockchain.info"
          sourceId="blockchain-info"
          observation={dernierRevenu?.time}
          recuperation={revenus.ts}
          perime={revenus.perime}
        />
      )}
      {children}
      <NoteSource>
        Hash Ribbons : capitulation quand la SMA {RIBBONS_COURTE} j du hashrate passe sous la SMA {RIBBONS_LONGUE} j,
        reprise pendant 30 j après le croisement inverse. Hashprice = revenus quotidiens des mineurs
        (subvention + frais, valorisés au prix du jour) ÷ hashrate moyen du même jour UTC.
      </NoteSource>
    </section>
  );
}

export function Mineurs({ open, hashrate }: { open: boolean; hashrate: ResultatFrais<SerieMetrique> | null }) {
  const [revenus, setRevenus] = useState<ResultatFrais<PointMetrique[]> | null>(null);
  const [loading, setLoading] = useState(false);
  // OnchainWindow ne transmet pas `openSettings` à la section : lecture directe du store UI.
  const openSettings = useStore(settingsUiStore, (s) => s.openSettings);
  useEffect(() => {
    if (!open) {
      setRevenus(null);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    void fetchRevenusMineurs(ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      setRevenus(r);
      setLoading(false);
    });
    return () => ctrl.abort();
  }, [open]);
  return (
    <VueMineurs hashrate={hashrate?.donnee ?? null} revenus={revenus} loading={loading}>
      {open && <MineursCotes onOuvrirReglages={openSettings} />}
    </VueMineurs>
  );
}
```

- [ ] **Étape 12 : lancer les tests et vérifier qu'ils passent, voisins compris**

```bash
pnpm --filter @axiom/web exec vitest run src/components/onchain/MineursCotes.test.tsx src/components/onchain/Mineurs.test.tsx src/components/onchain/ComplementsOnchain.test.tsx src/components/onchain/TresoreriesBtc.test.tsx src/components/uiConventions.test.ts src/chunkCryptoquant.test.ts
git diff --exit-code apps/web/src/components/onchain/Mineurs.test.tsx
pnpm --filter @axiom/web typecheck
pnpm --filter @axiom/web test
```

Attendu :
- `MineursCotes.test.tsx` : 21 tests passés.
- `Mineurs.test.tsx` : 3 tests passés **sans modification du fichier** (`git diff --exit-code` → code 0).
- Ratchet `uiConventions.test.ts` vert.
- Garde-fou de la tâche 16 (`apps/web/src/chunkCryptoquant.test.ts`, « aucun fichier hors data/onchain/ n'importe statiquement le client ») vert : `MineursCotes.tsx` ne contient que des `import type` et un `await import(...)` du client.
- `tsc --noEmit` sans erreur ; suite web complète verte.

- [ ] **Étape 13 : commit**

```bash
git add apps/web/src/components/onchain/MineursCotes.tsx apps/web/src/components/onchain/MineursCotes.test.tsx apps/web/src/components/onchain/Mineurs.tsx
git commit -m "feat(chain): production des mineurs cotés CryptoQuant dans la section Mineurs" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

### Tâche 19 : parcours e2e CHAIN, porte CI, budget, contrôles I11 et revue B2

**Fichiers :**
- Créer : `apps/web/e2e/chain-mineurs-cotes.e2e.ts`
- Modifier : `scripts/ci.sh:22` (liste des specs e2e ; la tâche 17 y a déjà ajouté `des-flux-takers`)
- Modifier : `docs/superpowers/progress/2026-09-16-cryptoquant.md` (ajout en fin de fichier de la section `### Budget après B2` ; fichier ouvert en tâche 1)
- Tester : `apps/web/e2e/chain-mineurs-cotes.e2e.ts`

**Interfaces :**
- Consomme :
  - tâche 18 : bouton `aria-expanded` nommé « Production des mineurs cotés ▸/▾ » ; `role="table"` nommé « Production des mineurs cotés », en-têtes cliquables « Société », « BTC J-1 », « Cumul mois », « USD J-1 », « Déclaré (mois) » (premier clic = décroissant, `basculerTri`) ; image « Production Σ 9 sociétés » ; libellés « archive 30 j · J-1 2026-09-15 », « 2026-09-15 (J-1) · 9/9 sociétés · Σ 130.00 BTC/j · cumul mois Σ 1611.21 BTC · Σ $10.18M/j », « Σ 9 », « Σ partielle 8/9 », « Archive locale depuis AAAA-MM-JJ », « archive servie » ; entrée de qualité `chain:mineurs-cotes` libellée « Mineurs cotés · CryptoQuant ».
  - tâches 9-13 (client) : `GET /cqapi/v1/btc/miner-data/companies?miner=<id>&window=day&limit=30`, `Authorization: Bearer <clé perso>`, archive `axiom:onchain:cq:mineur:<id>:v1`, court-circuit « J-1 archivé », raison « CryptoQuant injoignable ; archive affichée. » sur 5xx, abandon sans créneau.
  - tâche 6 : clé `axiom:cryptoquant:key`.
  - tâche 16 : section `### Budget après B1` du rapport (ligne « Commande : <commande> » puis bloc ```` ```json ```` imprimé par `scripts/verifier-budget-build.mjs`) ; contrôles I11 de DES, repris ici pour CHAIN.
  - existant : `bouchonnerReseau(page)` (`e2e/helpers/reseau-bouchonne.ts:9`), parcours Fonctions → On-chain (`e2e/onchain-complements.e2e.ts:63-65`), fermeture `getByTitle("Fermer")` (`e2e/des-oi-perps-dex.e2e.ts:114`), rendu « Qualité des blocs » (`components/OnchainWindow.tsx:654-665`, couverture « couverture n/m » dans `components/QualiteMetrique.tsx:36`), `scripts/verifier-budget-build.mjs` (JSON `{ limites, initial: { fichiers, octetsBruts, octetsGzip }, dynamique }`), `apps/web/dist/.vite/manifest.json` (`build.manifest: true`, `apps/web/vite.config.ts:107`).
- Produit : spec `chain-mineurs-cotes` dans `scripts/ci.sh --e2e` ; section `### Budget après B2` du rapport (ligne « Commande : <commande> », bloc ```` ```json ```` complet, contrôles I11 de B2, nom du chunk partagé du store, delta depuis `### Budget après B1`), lue par la tâche 20 ; verdict de revue B2.

- [ ] **Étape 1 : écrire le test** — créer `apps/web/e2e/chain-mineurs-cotes.e2e.ts` :

```ts
import { expect, test, type Page, type Route } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

/**
 * CHAIN : sous-section « Production des mineurs cotés » (CryptoQuant BASIC, clé personnelle).
 * Réseau bouchonné, horloge figée au 2026-09-16 12:00 UTC : sous horloge figée, la fenêtre
 * glissante du client (10 req / 60 s) ne se purge jamais, d'où une spec séparée de DES
 * (9 appels ici, 4 là-bas, chacune sous 10). Vérifie : exactement neuf appels au MONTAGE de
 * CHAIN, bouton replié, requêtes fermées `window=day&limit=30` sans `from`, clé personnelle
 * relayée ; au dépliage, les neuf sociétés (MARA non publiée, RIOT publiée, HIVE sans ligne le
 * 2026-09-10), Σ, courbe et tri interactif ; qualité publiée ; aucun appel de plus au
 * repli/dépliage ni à la réouverture ; une société en 503 donne une Σ partielle et une
 * couverture 8/9.
 */
const JOUR_MS = 86_400_000;
const MAINTENANT = new Date("2026-09-16T12:00:00Z");
const J1 = Date.UTC(2026, 8, 15);
const IDS = ["bitf", "cipher", "clsk", "core", "hive", "iren", "mara", "riot", "wulf"] as const;
type IdMineur = (typeof IDS)[number];
/** BTC minés par jour, constants ; Σ = 130.00 BTC/j. */
const BTC: Record<IdMineur, number> = {
  bitf: 5.1,
  cipher: 7.2,
  clsk: 20.4,
  core: 3.3,
  hive: 4.4,
  iren: 18.5,
  mara: 49.05,
  riot: 15.6,
  wulf: 6.45,
};
const PX = 78_300;
const HIVE_MANQUANT = "2026-09-10";
const CHEMIN = "/cqapi/v1/btc/miner-data/companies";
const TITRE = /Production des mineurs cotés/;

const estIdMineur = (v: string | null): v is IdMineur => IDS.some((id) => id === v);

/**
 * Trente lignes de la plus récente (J-1 = 2026-09-15) à la plus ancienne (2026-08-17), enveloppe
 * CryptoQuant v1. MARA à J-1 = exemple du sondage (49.05 BTC, cumul 396.96, 3.84 M$,
 * `reported_production` null) ; RIOT publie 123 BTC ; HIVE n'a pas de ligne le 2026-09-10.
 */
function fixtureMineur(id: IdMineur) {
  const data = Array.from({ length: 30 }, (_, i) => {
    const date = new Date(J1 - i * JOUR_MS).toISOString().slice(0, 10);
    const r = BTC[id];
    const maraJ1 = id === "mara" && i === 0;
    const jourDuMois = Number(date.slice(8, 10));
    return {
      date,
      coinbase_rewards: r - 0.05,
      other_mining_rewards: 0.05,
      total_rewards: r,
      accumulated_monthly_rewards: maraJ1 ? 396.96 : r * jourDuMois,
      unique_txn: 40,
      active_address_count: 12,
      reported_production: id === "riot" ? 123 : null,
      report_accuracy: null,
      closing_usd: PX,
      total_daily_rewards_closing_usd: maraJ1 ? 3_840_000 : r * PX,
      accumulated_monthly_rewards_closing_usd: r * jourDuMois * PX,
    };
  }).filter((ligne) => !(id === "hive" && ligne.date === HIVE_MANQUANT));
  return { status: { code: 200, message: "success" }, result: { window: "day", data } };
}

interface Appel {
  url: URL;
  authorization: string | undefined;
}

/** Réseau fermé, horloge figée, clé personnelle posée, route CryptoQuant comptée. */
async function preparer(page: Page, repondre: (id: IdMineur, route: Route) => Promise<void>): Promise<Appel[]> {
  await bouchonnerReseau(page);
  await page.clock.setFixedTime(MAINTENANT);
  await page.addInitScript(() => localStorage.setItem("axiom:cryptoquant:key", "fixture-personnelle"));
  const appels: Appel[] = [];
  await page.route(
    (url) => url.pathname === CHEMIN,
    async (route) => {
      const url = new URL(route.request().url());
      appels.push({ url, authorization: route.request().headers().authorization });
      const miner = url.searchParams.get("miner");
      if (!estIdMineur(miner)) {
        await route.fulfill({ status: 404, json: { erreur: "chemin CryptoQuant refusé" } });
        return;
      }
      await repondre(miner, route);
    },
  );
  return appels;
}

/** Calqué sur `ouvrirChainSansCle` (onchain-complements.e2e.ts:176-186) : une spec n'importe pas une autre spec. */
async function ouvrirChain(page: Page) {
  await page.addInitScript(() =>
    localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 })),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Fonctions" }).click();
  await page.getByRole("menuitem", { name: /On-chain/ }).click();
  return page.getByRole("complementary", { name: "On-chain", exact: true });
}

test("CHAIN : mineurs cotés — neuf appels au montage, lecture et tri au dépliage, aucun appel ensuite", async ({ page }) => {
  const appels = await preparer(page, (id, route) => route.fulfill({ json: fixtureMineur(id) }));
  const chain = await ouvrirChain(page);
  const bouton = chain.getByRole("button", { name: TITRE });
  await expect(bouton).toHaveAttribute("aria-expanded", "false");
  await expect(chain.getByRole("table", { name: "Production des mineurs cotés" })).toHaveCount(0);

  // Montage de CHAIN : les neuf séries, une fois chacune, requête fermée, clé personnelle relayée.
  await expect.poll(() => appels.length).toBe(9);
  expect(appels.map((a) => a.url.searchParams.get("miner")).sort()).toEqual([...IDS].sort());
  for (const { url, authorization } of appels) {
    expect(url.search).toMatch(/^\?miner=[a-z]+&window=day&limit=30$/);
    expect(url.searchParams.has("from")).toBe(false);
    expect(authorization).toBe("Bearer fixture-personnelle");
  }
  await expect(chain).toContainText("archive 30 j · J-1 2026-09-15");
  const qualite = chain
    .locator("details", { hasText: "Qualité des blocs" })
    .locator("div.bg-surface", { hasText: "Mineurs cotés · CryptoQuant" });
  await expect(qualite).toContainText("couverture 9/9");
  await expect(qualite).toContainText("partiel");
  await expect(qualite).toContainText("1 jour manquant dans la fenêtre de 30 j.");
  const hive = await page.evaluate(() => localStorage.getItem("axiom:onchain:cq:mineur:hive:v1"));
  expect(hive).not.toBeNull();
  expect(Object.keys((JSON.parse(hive ?? "{}") as { jours?: Record<string, unknown> }).jours ?? {})).toHaveLength(29);

  // Dépliage : lecture des neuf sociétés, sans appel.
  await bouton.click();
  await expect(bouton).toHaveAttribute("aria-expanded", "true");
  const tableau = chain.getByRole("table", { name: "Production des mineurs cotés" });
  const lignes = tableau.getByRole("row");
  await expect(lignes).toHaveCount(10);
  await expect(tableau).toContainText("MARA");
  await expect(tableau).toContainText("49.05");
  await expect(tableau).toContainText("396.96");
  await expect(tableau).toContainText("$3.84M");
  await expect(tableau).toContainText("non publié");
  await expect(tableau).toContainText("123.00 BTC");
  await expect(chain).toContainText(
    "2026-09-15 (J-1) · 9/9 sociétés · Σ 130.00 BTC/j · cumul mois Σ 1611.21 BTC · Σ $10.18M/j",
  );
  await expect(chain.getByText("Σ 9", { exact: true })).toBeVisible();
  await expect(chain).not.toContainText("Σ partielle");
  await expect(chain.getByRole("img", { name: "Production Σ 9 sociétés" })).toBeVisible();
  await expect(chain).toContainText(
    "Archive locale depuis 2026-08-17 · 30 j · 1 manquant dans la fenêtre (2026-09-10) · 0 perdu",
  );
  await expect(chain).toContainText("miner-data/companies (9 requêtes)");
  expect(appels).toHaveLength(9);

  // Tri interactif : défaut BTC J-1 décroissant ; « Société » → décroissant puis croissant.
  await expect(lignes.nth(1)).toContainText("MARA");
  await tableau.getByRole("button", { name: "Société" }).click();
  await expect(lignes.nth(1)).toContainText("WULF");
  await tableau.getByRole("button", { name: "Société" }).click();
  await expect(lignes.nth(1)).toContainText("BITF");
  expect(appels).toHaveLength(9);

  // Repli puis dépliage : l'état du conteneur sert, tri conservé, aucun appel.
  await bouton.click();
  await expect(bouton).toHaveAttribute("aria-expanded", "false");
  await bouton.click();
  await expect(tableau).toContainText("49.05");
  await expect(lignes.nth(1)).toContainText("BITF");
  await page.waitForTimeout(300);
  expect(appels).toHaveLength(9);

  // Fermeture puis réouverture de CHAIN : J-1 archivé pour les neuf séries → zéro appel.
  await chain.getByTitle("Fermer").click();
  await expect(chain).toHaveCount(0);
  await page.getByRole("button", { name: "Fonctions" }).click();
  await page.getByRole("menuitem", { name: /On-chain/ }).click();
  await expect(bouton).toHaveAttribute("aria-expanded", "false");
  await expect(chain).toContainText("archive 30 j · J-1 2026-09-15");
  await expect(qualite).toContainText("couverture 9/9");
  await page.waitForTimeout(500);
  expect(appels).toHaveLength(9);
});

test("CHAIN : mineurs cotés — une société en 503, Σ partielle et couverture 8/9", async ({ page }) => {
  const appels = await preparer(page, (id, route) =>
    id === "wulf"
      ? route.fulfill({ status: 503, json: { status: { code: 503, message: "Service Unavailable" } } })
      : route.fulfill({ json: fixtureMineur(id) }),
  );
  const chain = await ouvrirChain(page);
  await expect.poll(() => appels.length).toBe(9);
  const qualite = chain
    .locator("details", { hasText: "Qualité des blocs" })
    .locator("div.bg-surface", { hasText: "Mineurs cotés · CryptoQuant" });
  await expect(qualite).toContainText("couverture 8/9");
  await expect(qualite).toContainText("partiel");
  await expect(qualite).toContainText("CryptoQuant injoignable");

  await chain.getByRole("button", { name: TITRE }).click();
  await expect(chain).toContainText("2026-09-15 (J-1) · 8/9 sociétés · Σ partielle 8/9");
  await expect(chain).not.toContainText("Σ 130.00");
  await expect(chain.getByText("Σ 9", { exact: true })).toHaveCount(0);
  await expect(chain).toContainText("archive servie");
  const tableau = chain.getByRole("table", { name: "Production des mineurs cotés" });
  await expect(tableau.getByRole("row")).toHaveCount(10);
  await expect(tableau).toContainText("WULF");
  await expect(tableau).toContainText("MARA");
  await page.waitForTimeout(300);
  expect(appels).toHaveLength(9);
});
```

- [ ] **Étape 2 : vérifier l'échec de la porte CI** — le comportement est livré en tâche 18 ; le critère encore faux ici est « la spec fait partie de `scripts/ci.sh --e2e` » :

```bash
grep -c "chain-mineurs-cotes" scripts/ci.sh
```

Attendu : `0` (code de sortie 1). Lancer ensuite la spec seule, sur le port isolé de la CI, pour établir son état réel :

```bash
AXIOM_E2E_PORT=5239 pnpm --filter @axiom/web exec playwright test chain-mineurs-cotes
```

Attendu : `2 passed`. Si un parcours échoue, corriger le défaut dans `MineursCotes.tsx` (tâche 18) ou le signaler au lot du client (tâches 9-13). Ne jamais assouplir la spec.

- [ ] **Étape 3 : implémentation minimale** — dans `scripts/ci.sh`, remplacer la ligne 22 (telle que laissée par la tâche 17) :

```bash
    niveaux-chart omon-lectures-options revue-cycle term-portage-tbill des-oi-perps-dex des-flux-takers
```

par :

```bash
    niveaux-chart omon-lectures-options revue-cycle term-portage-tbill des-oi-perps-dex des-flux-takers chain-mineurs-cotes
```

- [ ] **Étape 4 : lancer la porte et vérifier qu'elle passe**

```bash
grep -c "chain-mineurs-cotes" scripts/ci.sh
bash scripts/ci.sh --e2e
```

Attendu : `1`, puis tous les parcours hermétiques verts (`scripts/ci.sh:16` fixe `AXIOM_E2E_PORT=5239`), dont `des-flux-takers.e2e.ts` et les deux tests de `chain-mineurs-cotes.e2e.ts` (dernière ligne `N passed`, aucune ligne `failed`).

- [ ] **Étape 5 : build, budget, contrôles I11 de B2 et section `### Budget après B2`**

Construire, puis réimprimer le JSON du budget à l'identique sur le même `dist` (le build l'imprime après la sortie Vite ; Vite vide `dist/` au démarrage, d'où la mesure après le build) :

```bash
PREUVES_B2="${TMPDIR:-/tmp}/axiom-b2"
mkdir -p "$PREUVES_B2"
set -o pipefail; pnpm --filter @axiom/web build 2>&1 | tee "$PREUVES_B2/build.log"
grep -c "cryptoquant.ts is dynamically imported" "$PREUVES_B2/build.log"
node scripts/verifier-budget-build.mjs apps/web/dist > "$PREUVES_B2/budget.json"
```

Attendu : le journal se termine sur le JSON du budget, sans « Erreur budget build » ; `grep -c` affiche `0` (Vite n'avertit pas que le client serait aussi importé statiquement) ; `budget.json` écrit.

Écrire le script de contrôle (mêmes contrôles que la tâche 16, appliqués à CHAIN), puis l'exécuter :

````bash
PREUVES_B2="${TMPDIR:-/tmp}/axiom-b2"
cat > "$PREUVES_B2/i11-b2.mjs" <<'EOF'
import { readFileSync } from "node:fs";

const [budgetChemin, rapportChemin] = process.argv.slice(2);
const DIST = "apps/web/dist";
const CLIENT = "src/data/onchain/cryptoquant.ts";
const CHAIN = "src/components/OnchainWindow.tsx";
const DES = "src/components/DerivativesWindow.tsx";
const LIBELLE = "Production des mineurs cotés";
const manifeste = JSON.parse(readFileSync(`${DIST}/.vite/manifest.json`, "utf8"));
const budget = JSON.parse(readFileSync(budgetChemin, "utf8"));
const fautes = [];

// 1. Graphe STATIQUE de l'entrée (imports seulement, jamais dynamicImports).
const entree = Object.keys(manifeste).find((id) => manifeste[id].isEntry === true);
if (entree === undefined) throw new Error("entrée absente du manifeste");
const statiques = new Set();
const parcourir = (id) => {
  if (statiques.has(id)) return;
  statiques.add(id);
  for (const suivant of manifeste[id]?.imports ?? []) parcourir(suivant);
};
parcourir(entree);
const fautifs = [...statiques].filter(
  (id) => id === CLIENT || id === CHAIN || /cryptoquant|MineursCotes/i.test(manifeste[id]?.file ?? id),
);
if (fautifs.length > 0) fautes.push(`graphe statique de l'entrée : ${fautifs.join(", ")}`);

// 2. Client : entrée dynamique, chargée par CHAIN via import(), jamais importée statiquement.
if (manifeste[CLIENT]?.isDynamicEntry !== true) fautes.push("le client n'est pas une entrée dynamique");
if ((manifeste[CHAIN]?.imports ?? []).includes(CLIENT)) fautes.push("CHAIN importe le client statiquement");
if (!(manifeste[CHAIN]?.dynamicImports ?? []).includes(CLIENT)) fautes.push("CHAIN ne charge pas le client par import()");

// 3. Aucun fichier du bundle initial ne contient le libellé de la sous-section.
const initiauxAvecLibelle = budget.initial.fichiers.filter((f) =>
  readFileSync(`${DIST}/${f}`, "utf8").includes(LIBELLE),
);
if (initiauxAvecLibelle.length > 0) fautes.push(`« ${LIBELLE} » dans le bundle initial : ${initiauxAvecLibelle.join(", ")}`);

// 4. Chunk partagé du store de clé : importé par DES et par CHAIN, distinct du client. On cible
//    les clés du manifeste, jamais un nom de fichier seul (store et client ont le même nom de base).
const importsChain = manifeste[CHAIN]?.imports ?? [];
const partages = (manifeste[DES]?.imports ?? []).filter(
  (cle) => importsChain.includes(cle) && cle !== CLIENT && /cryptoquant/i.test(cle),
);
const fichiersPartages = partages.map((cle) => manifeste[cle]?.file ?? cle);
const codeEntree = readFileSync(`${DIST}/${manifeste[entree].file}`, "utf8");
const dansMapDeps = fichiersPartages.some((f) => codeEntree.includes(f));

// 5. Delta initial depuis « ### Budget après B1 » (tâche 16). La dernière section d'une étape fait foi.
function blocsBudget(texte) {
  const blocs = new Map();
  let etape = null;
  let bloc = null;
  for (const ligne of texte.split("\n")) {
    const t = ligne.trim();
    if (bloc !== null) {
      if (t === "```") {
        if (bloc.json && etape !== null) {
          try {
            blocs.set(etape, JSON.parse(bloc.lignes.join("\n")));
          } catch {
            throw new Error(`bloc json illisible sous « ### Budget ${etape} »`);
          }
        }
        if (bloc.json) etape = null;
        bloc = null;
      } else {
        bloc.lignes.push(ligne);
      }
    } else if (t.startsWith("```")) {
      bloc = { json: t === "```json", lignes: [] };
    } else if (/^#{1,6} /.test(t)) {
      const titre = /^### Budget (.+)$/.exec(t);
      etape = titre === null ? null : titre[1];
    }
  }
  return blocs;
}
let b1;
try {
  b1 = blocsBudget(readFileSync(rapportChemin, "utf8")).get("après B1");
  if (b1 === undefined) fautes.push("section « ### Budget après B1 » (tâche 16) introuvable dans le rapport");
} catch (e) {
  fautes.push(e instanceof Error ? e.message : String(e));
}

if (fautes.length > 0) {
  console.error(fautes.map((f) => `Error: ${f}`).join("\n"));
  process.exit(1);
}
const delta = budget.initial.octetsGzip - b1.initial.octetsGzip;
const marge = budget.limites.octetsGzip - budget.initial.octetsGzip;
console.log(
  [
    `Contrôles I11 (B2) : client \`${manifeste[CLIENT].file}\` en entrée dynamique chargée par CHAIN via \`import()\` ; ni le client ni \`OnchainWindow\` dans le graphe statique de l'entrée (${statiques.size} modules) ; aucun fichier initial ne contient « ${LIBELLE} ».`,
    "",
    `Chunk partagé du store (\`.vite/manifest.json\`) : ${
      fichiersPartages.length > 0
        ? fichiersPartages.map((f) => `\`${f}\``).join(", ")
        : "non identifié (aucun import commun à DES et CHAIN nommé « cryptoquant »)"
    } ; nom présent dans \`__vite__mapDeps\` de l'entrée : ${dansMapDeps ? "oui" : "non"}.`,
    "",
    `Delta initial depuis « Budget après B1 » : ${delta > 0 ? "+" : ""}${delta} o gzip (attendu ≤ ~40 o gzip par sous-lot ; porte d'acceptation ≤ ~150 o gzip sur l'ensemble de B1 ; seule la limite 360 000 est bloquante) ; marge gzip locale ${marge} o.`,
  ].join("\n"),
);
EOF
node "$PREUVES_B2/i11-b2.mjs" "$PREUVES_B2/budget.json" docs/superpowers/progress/2026-09-16-cryptoquant.md > "$PREUVES_B2/i11-b2.md"
cat "$PREUVES_B2/i11-b2.md"
````

Attendu : code 0 et trois paragraphes, sans ligne `Error:`. Le premier nomme le client (`assets/cryptoquant-<hash>.js`). Le deuxième nomme le chunk partagé du store et indique s'il figure dans `__vite__mapDeps`. Le troisième donne le delta. Toute ligne `Error:` bloque la suite : corriger avant de continuer (`MineursCotes` vit dans le chunk `OnchainWindow`, il n'a pas de fichier propre).

**Budget attendu.** Delta initial ≤ ~40 o gzip par rapport à `### Budget après B1`. Seul le nom du chunk partagé du store peut entrer dans les dépendances préchargées de l'entrée ; `MineursCotes` vit dans le chunk CHAIN, qui importe déjà `_TableTriable` et `_QualiteMetrique`. Un delta plus élevé se consigne tel quel dans la section. Seule la limite de 360 000 o gzip est bloquante, et le build échoue de lui-même au-delà.

Consigner la mesure au format commun du rapport :

````bash
PREUVES_B2="${TMPDIR:-/tmp}/axiom-b2"
{
  printf '\n## B2 — production des mineurs cotés\n\n### Budget après B2\n\nCommande : `pnpm --filter @axiom/web build` (tâche 19, sous-section CHAIN et spec e2e livrées ; JSON réimprimé tel quel par `node scripts/verifier-budget-build.mjs apps/web/dist` sur le même `dist`).\n\n```json\n'
  cat "$PREUVES_B2/budget.json"
  printf '```\n\n'
  cat "$PREUVES_B2/i11-b2.md"
} >> docs/superpowers/progress/2026-09-16-cryptoquant.md
tail -n 30 docs/superpowers/progress/2026-09-16-cryptoquant.md
````

Attendu : la fin du rapport montre le titre `### Budget après B2`, la ligne qui commence par « Commande : `pnpm --filter @axiom/web build` », le bloc ```` ```json ```` complet (`limites`, `initial`, `dynamique`) puis les trois paragraphes de contrôle.

- [ ] **Étape 6 : revue indépendante B2** — confier la revue à un agent relecteur, qui ne doit pas être le développeur (`.devin/provider-rules.md:51`). Lui fournir le diff produit par ces commandes (la spec e2e est encore non suivie : `--intent-to-add` la fait apparaître) :

```bash
git add --intent-to-add apps/web/e2e/chain-mineurs-cotes.e2e.ts
git diff "$(git log --format=%H -n 1 --grep='feat(chain): production des mineurs cotés')~1" -- apps/web/src/components/onchain/MineursCotes.tsx apps/web/src/components/onchain/MineursCotes.test.tsx apps/web/src/components/onchain/Mineurs.tsx apps/web/e2e/chain-mineurs-cotes.e2e.ts scripts/ci.sh
```

Le relecteur confirme ou conteste chaque point de cette liste, avec preuve :
1. **Sommes d'affichage** : `construireModeleMineurs` n'additionne que les neuf lignes du jour de référence ; `somme` vaut `null` sous 9/9 ; `cm`/`usd` passent par `sommeOuNull` ; aucune somme ne mélange deux jours ; la courbe Σ vaut `null` dès qu'une archive n'a pas le jour.
2. **`null` jamais 0** :
   - `decl` null → « non publié » ;
   - `usd`/`cm` null → « — », y compris en Σ ;
   - société sans ligne → « — » avec infobulle `motif` ;
   - aucun `?? 0` ni `|| 0` dans `MineursCotes.tsx` : `grep -nE '\?\? 0|\|\| 0' apps/web/src/components/onchain/MineursCotes.tsx` ne renvoie aucune ligne.
3. **Couverture partielle** :
   - `qualiteMineursCotes` renvoie `partiel` sous 9/9 ou avec un jour manquant ;
   - `indisponible` sans aucune ligne ;
   - `perime` seulement quand toutes les séries archivées sont périmées ;
   - `ageMaxMs = 3 j` est justifié (commentaire du code, test « seuil de péremption ») ;
   - une série `pret` avec raison (archive illisible) n'est comptée ni en échec ni en raison de qualité.
4. **Aucun écart %** déclaré/observé ; « Cumul mois » = valeur fournisseur brute.
5. **Bundle** : `MineursCotes.tsx` n'importe le client et le module partagé que par `import type`. Il contient un seul `await import("../../data/onchain/cryptoquant")`. Les contrôles I11 de l'étape 5 sont verts.
6. **Effet** : l'abandon est vérifié après l'`import()` et après chaque `await`. La qualité n'est publiée qu'en fin de boucle. Le désabonnement de la file a lieu au démontage.
7. **Signaux et tri** :
   - les cinq signaux d'archive sont affichés (stockage plein, copie daemon, sans daemon, archive illisible, périmé) ;
   - le bouton Réglages apparaît pour tout `cle-requise` ;
   - le complément `.env`/Vercel est réservé à `RAISON_CLE_CRYPTOQUANT` ;
   - le tri vit dans le conteneur, avec BTC J-1 décroissant par défaut ; une société sans ligne reste en fin de liste.

Un point bloquant se corrige avant l'étape 7. La correction porte sur les fichiers de la tâche 18, dans un commit séparé :

```bash
git add apps/web/src/components/onchain/MineursCotes.tsx apps/web/src/components/onchain/MineursCotes.test.tsx apps/web/src/components/onchain/Mineurs.tsx
git commit -m "fix(chain): corrections de la revue indépendante B2" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

Une correction de la spec e2e ou de `scripts/ci.sh` rejoint au contraire le commit de l'étape 7. Après toute correction :
1. retirer la section `### Budget après B2` déjà ajoutée : `git checkout -- docs/superpowers/progress/2026-09-16-cryptoquant.md` rétablit le rapport tel que commité avant la tâche 19 ;
2. relancer les étapes 4 et 5.

- [ ] **Étape 7 : commit**

```bash
git add apps/web/e2e/chain-mineurs-cotes.e2e.ts scripts/ci.sh docs/superpowers/progress/2026-09-16-cryptoquant.md
git commit -m "test(chain): parcours e2e des mineurs cotés — neuf appels au montage, aucun à la réouverture" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

### Tâche 20 : clôture — rapport de preuves, vérification finale, commit et note mémoire

**Fichiers :**
- Modifier : `docs/superpowers/progress/2026-09-16-cryptoquant.md` (ajout en fin de fichier ; le fichier est créé en tâche 1, ses sections existantes ne sont pas réécrites)
- Tester : `docs/superpowers/progress/2026-09-16-cryptoquant.md` (présence de la section `## Clôture`, des cinq mesures de budget, absence de secret)
- Hors dépôt, non commitée (étape orchestrateur) : `~/.claude/projects/-Users-zakichair-Projects-axiom/memory/cryptoquant-basic-perimetre.md`

**Interfaces :**
- Consomme :
  - les sections budget du rapport, chacune au format commun (titre `### Budget <étape>`, ligne « Commande : <commande> », bloc ```` ```json ```` imprimé par `scripts/verifier-budget-build.mjs`, clés `limites`, `initial`, `dynamique`) :
    - `### Budget avant B1` (tâche 1) ;
    - `### Budget après B1-3` (tâche 8) ;
    - `### Budget après B1` (tâche 16) ;
    - `### Budget après B2` (tâche 19) ;
  - les commits depuis `2d45426` (spec) ;
  - `pnpm check` (= `bash scripts/ci.sh`, dont le build `scripts/ci.sh:35`) et `bash scripts/ci.sh --e2e`.
- Produit :
  - la section `## Clôture (tâche 20)` du rapport, composée de :
    - `### Journal des commits` ;
    - `### Vérification finale` ;
    - `### Budget final` (même format commun) ;
    - `### Tableau du budget JS initial (avant/après)`, construit en lisant les cinq blocs ```` ```json ```` ;
    - `### Parcours e2e du lot` ;
    - `### Preuve manuelle du propriétaire` ;
    - `### Écarts actés à la spec` ;
    - `### Errata de la spec` ;
    - `### Limites connues` ;
  - la note mémoire du projet, mise à jour hors dépôt.
  - `BUILD-CONTRACT.md` n'est pas modifié ici (amendement fait en tâche 1).

- [ ] **Étape 1 : écrire le test qui échoue** — critère de clôture : le rapport contient une section `## Clôture`, les cinq mesures de budget et aucune valeur de clé.

```bash
grep -c '^## Clôture' docs/superpowers/progress/2026-09-16-cryptoquant.md
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue**

Attendu : `0` (code de sortie 1) — la section n'existe pas encore.

- [ ] **Étape 3 : vérification finale réelle** — sorties conservées pour le rapport :

```bash
PREUVES="${TMPDIR:-/tmp}/axiom-cloture-cq"
mkdir -p "$PREUVES"
set -o pipefail; pnpm check 2>&1 | tee "$PREUVES/check.log"
set -o pipefail; bash scripts/ci.sh --e2e 2>&1 | tee "$PREUVES/e2e.log"
node scripts/verifier-budget-build.mjs apps/web/dist > "$PREUVES/budget-final.json"
```

Attendu :
- `check.log` se termine par `==> [ci] OK` ;
- la dernière ligne de synthèse Playwright de `e2e.log` est `N passed`, sans `failed` ;
- `budget-final.json` est écrit : le build de `pnpm check` vient de régénérer `apps/web/dist`, et ce JSON est celui que le build a imprimé.

Tout échec arrête la clôture. La correction se fait dans la tâche fautive, jamais dans le rapport.

- [ ] **Étape 4 : implémentation minimale — écrire la section de clôture à partir des sorties réelles**

Première partie : journal des commits, vérification finale et `### Budget final` au format commun.

````bash
PREUVES="${TMPDIR:-/tmp}/axiom-cloture-cq"
RAPPORT=docs/superpowers/progress/2026-09-16-cryptoquant.md
{
  printf '\n## Clôture (tâche 20)\n\n### Journal des commits (depuis la spec `2d45426`)\n\n| Commit | Sujet |\n|---|---|\n'
  git log --reverse --format='| `%h` | %s |' 2d45426..HEAD
  printf '\nLe commit de clôture (`docs(rapport): clôture CryptoQuant — preuves, budget avant/après, parcours e2e et preuve manuelle`) suit cette liste.\n\n### Vérification finale\n\n`pnpm check` puis `bash scripts/ci.sh --e2e`, lignes de synthèse :\n\n```text\n'
  grep -E '==> \[ci\]|Test Files|Tests\s+[0-9]|[0-9]+ (pass|fail)\b|Ran [0-9]+ tests|Erreur budget build' "$PREUVES/check.log"
  grep -E '[0-9]+ (passed|failed|flaky|skipped|did not run)\b' "$PREUVES/e2e.log"
  printf '```\n\n### Budget final\n\nCommande : `pnpm check` (build `pnpm --filter @axiom/web build` de `scripts/ci.sh:35`, tâche 20 ; JSON réimprimé tel quel par `node scripts/verifier-budget-build.mjs apps/web/dist` sur le même `dist`).\n\n```json\n'
  cat "$PREUVES/budget-final.json"
  printf '```\n'
} >> "$RAPPORT"
````

Seconde partie : le tableau avant/après se construit en lisant les blocs ```` ```json ```` des cinq sections `### Budget …`. Le script échoue si une étape manque. La suite comprend les parcours e2e, la preuve manuelle, les écarts actés, les errata et les limites.

````bash
PREUVES="${TMPDIR:-/tmp}/axiom-cloture-cq"
RAPPORT=docs/superpowers/progress/2026-09-16-cryptoquant.md
cat > "$PREUVES/tableau-budget.mjs" <<'EOF'
import { readFileSync } from "node:fs";

const [rapportChemin] = process.argv.slice(2);
const ATTENDUES = ["avant B1", "après B1-3", "après B1", "après B2", "final"];

/** Blocs json des sections « ### Budget <étape> » ; la dernière section d'une étape fait foi. */
function blocsBudget(texte) {
  const blocs = new Map();
  let etape = null;
  let bloc = null;
  for (const ligne of texte.split("\n")) {
    const t = ligne.trim();
    if (bloc !== null) {
      if (t === "```") {
        if (bloc.json && etape !== null) {
          try {
            blocs.set(etape, JSON.parse(bloc.lignes.join("\n")));
          } catch {
            throw new Error(`bloc json illisible sous « ### Budget ${etape} »`);
          }
        }
        if (bloc.json) etape = null;
        bloc = null;
      } else {
        bloc.lignes.push(ligne);
      }
    } else if (t.startsWith("```")) {
      bloc = { json: t === "```json", lignes: [] };
    } else if (/^#{1,6} /.test(t)) {
      const titre = /^### Budget (.+)$/.exec(t);
      etape = titre === null ? null : titre[1];
    }
  }
  return blocs;
}

let blocs;
try {
  blocs = blocsBudget(readFileSync(rapportChemin, "utf8"));
} catch (e) {
  console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
const manquantes = ATTENDUES.filter((e) => !blocs.has(e));
if (manquantes.length > 0) {
  console.error(`Error: sections « ### Budget <étape> » absentes du rapport : ${manquantes.join(", ")}`);
  process.exit(1);
}
const signe = (n) => `${n > 0 ? "+" : ""}${n}`;
const avant = blocs.get("avant B1");
const lignes = [
  "| Mesure | Octets bruts | Octets gzip | Δ gzip depuis « avant B1 » | Marge gzip locale |",
  "|---|---|---|---|---|",
];
for (const [etape, b] of blocs) {
  lignes.push(
    `| Budget ${etape} | ${b.initial.octetsBruts} | ${b.initial.octetsGzip} | ${signe(b.initial.octetsGzip - avant.initial.octetsGzip)} | ${b.limites.octetsGzip - b.initial.octetsGzip} |`,
  );
}
const deltaB1 = blocs.get("après B1").initial.octetsGzip - avant.initial.octetsGzip;
const deltaB2 = blocs.get("après B2").initial.octetsGzip - blocs.get("après B1").initial.octetsGzip;
lignes.push(
  "",
  `Delta de B1 (après B1 − avant B1) : ${signe(deltaB1)} o gzip (porte d'acceptation ≤ ~150 o gzip). Delta de B2 (après B2 − après B1) : ${signe(deltaB2)} o gzip (attendu ≤ ~40 o gzip). Seule la limite 360 000 o gzip est bloquante.`,
);
console.log(lignes.join("\n"));
EOF
node "$PREUVES/tableau-budget.mjs" "$RAPPORT" > "$PREUVES/tableau-budget.md" && {
  printf '\n### Tableau du budget JS initial (avant/après)\n\nGzip niveau 9 ; plafonds 1 220 000 octets bruts et 360 000 octets gzip. Valeurs lues dans les blocs json des sections « Budget … » ci-dessus.\n\n'
  cat "$PREUVES/tableau-budget.md"
  printf '\nMarge locale ; la marge mesurée sur le runner GitHub est plus faible (≈ 3 365 gzip avant le lot).\n\n### Parcours e2e du lot (sortie Playwright)\n\n```text\n'
  grep -E 'des-flux-takers|chain-mineurs-cotes' "$PREUVES/e2e.log"
  printf '```\n\n'
  cat <<'EOT'
- `apps/web/e2e/des-flux-takers.e2e.ts` (tâche 17) : parcours DES décrits par la spec §6 (4 appels au montage, section repliée, segmentés sans appel, archive locale sans `from`, réouverture sans appel, 429, 401).
- `apps/web/e2e/chain-mineurs-cotes.e2e.ts` (tâche 19) : ouverture de CHAIN → exactement 9 appels `miner=<id>&window=day&limit=30`, `Authorization: Bearer` relayé, bouton replié ; « Qualité des blocs » → « Mineurs cotés · CryptoQuant », couverture 9/9, partiel (jour manquant de HIVE) ; archive HIVE de 29 jours ; dépliage → 9 lignes, « 49.05 », « 396.96 », « $3.84M », « non publié », « 123.00 BTC », Σ 130.00 BTC/j, courbe ; tri par société décroissant puis croissant ; repli/dépliage puis fermeture/réouverture → toujours 9 appels. Second parcours : WULF en 503 → « Σ partielle 8/9 », couverture 8/9, « archive servie ».

### Preuve manuelle du propriétaire (hors CI, clé personnelle, jamais depuis un agent)

Saisir la clé sans l'afficher ni l'inscrire dans l'historique : `read -rs CQ_CLE && export CQ_CLE`. Daemon lancé (`pnpm daemon`, `127.0.0.1:8787`). Les URL sont entre apostrophes : sans elles, le shell interprète `&`.

- [ ] Sans en-tête → 401 (ou 200 si `CRYPTOQUANT_API_KEY` est renseignée dans `apps/web/.env`) :
  `curl -i 'http://127.0.0.1:8787/cqapi/v2/market/cq/spot/trade?symbol=btc_all&window=day&limit=30'`
- [ ] Avec Bearer → 200, en-têtes `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset` et `cache-control: private, no-store` :
  `curl -i -H "Authorization: Bearer $CQ_CLE" 'http://127.0.0.1:8787/cqapi/v2/market/cq/spot/trade?symbol=btc_all&window=day&limit=30'`
- [ ] Chemin hors liste → 404 (refus local, aucun appel amont) :
  `curl -i -H "Authorization: Bearer $CQ_CLE" 'http://127.0.0.1:8787/cqapi/v1/btc/exchange-flows/netflow?exchange=all_exchange&window=day'`
- [ ] POST → 405 `allow: GET` :
  `curl -i -X POST -H "Authorization: Bearer $CQ_CLE" 'http://127.0.0.1:8787/cqapi/v2/market/cq/spot/trade?symbol=btc_all&window=day&limit=30'`
- [ ] Mineurs cotés → 200 :
  `curl -i -H "Authorization: Bearer $CQ_CLE" 'http://127.0.0.1:8787/cqapi/v1/btc/miner-data/companies?miner=mara&window=day&limit=30'`
- [ ] Même série sur `pnpm dev` (Vite, `127.0.0.1:5173`) : les commandes ci-dessus en remplaçant `http://127.0.0.1:8787` par `http://127.0.0.1:5173`, mêmes statuts.
- [ ] Projet Vercel : **aucune** variable `CRYPTOQUANT_API_KEY` (`vercel env ls`, environnements Production, Preview et Development).
- [ ] Session navigateur : panneau DATA « CryptoQuant x/10 min » ; première ouverture de DES → 4 appels `/cqapi` (onglet Réseau), réouverture → 0 ; première ouverture de CHAIN → 9 appels, réouverture → 0 ; retrait de la clé dans les Réglages → « clé requise pour actualiser » avec l'archive affichée.
- [ ] Valeur réelle de `x-ratelimit-reset` (secondes ; `6` observé lors du sondage du 2026-09-16) :
  `curl -s -D - -o /dev/null -H "Authorization: Bearer $CQ_CLE" 'http://127.0.0.1:8787/cqapi/v2/market/cq/spot/trade?symbol=btc_all&window=day&limit=30' | grep -i '^x-ratelimit-'`
  Valeur réelle de `x-ratelimit-reset` : en attente de la preuve manuelle du propriétaire (commande ci-dessus).
- [ ] Fin de session : `unset CQ_CLE`.

### Écarts actés à la spec (arbitrages du 2026-09-16)

- Qualité CHAIN « Mineurs cotés · CryptoQuant » : `ageMaxMs` vaut 3 jours, conformément à la spec §4.5 amendée (§12) ; la version initiale de la spec disait 2 jours. La couverture compte les sociétés ayant une ligne au dernier jour archivé commun (jour de référence), et non strictement J-1 (§12). Les observations sont datées à 00:00 UTC du jour clos : 3 j équivaut au seuil « dernier jour antérieur à aujourd'hui − 2 j » de `diagnostiquer`. C'est aussi le délai des séries quotidiennes de CHAIN (`apps/web/src/components/OnchainWindow.tsx:560` pour le hashrate et `:564` pour le thermocap, relevés à `2d45426`).
- Bouton Réglages aussi sur une clé refusée (401) :
  - `SansCle` affiche le bouton pour tout statut `cle-requise` à archive vide, en DES comme en CHAIN ;
  - en CHAIN, le CTA d'en-tête « clé CryptoQuant ⚙ » suit la même règle ;
  - le complément `.env`/Vercel (`messageSansCleCq`) ne s'ajoute qu'à « Clé CryptoQuant personnelle requise (Réglages ⚙) » ; une clé refusée affiche sa raison telle quelle.
- Proxys locaux (Vite, daemon) : la clé est l'en-tête client s'il est valide, sinon `CRYPTOQUANT_API_KEY` de `.env`. Vite injecte aussi `.env` quand l'en-tête est présent mais invalide. Vercel : un POST sans clé répond 405, car la méthode est contrôlée avant la clé.
- Archive de version inconnue : statut `erreur`, raison `RAISON_VERSION_CRYPTOQUANT`, zéro appel, rien n'est réécrit en local ni en KV. Un bandeau l'affiche dans les vues.
- Table CHAIN triable par l'utilisateur : BTC J-1 décroissant par défaut ; l'état du tri vit dans le conteneur `MineursCotes`, la vue reste pure.
- Affichage DES (tâche 15) : « vs méd. 30 j » au format `formatPct(v, 1)` ; VWAP en `$` + `formatPrice` ; taille d'archive en jours archivés ; quota « 10 req/min (compteur dans DATA) » ; en perp, base et VWAP en infobulle du volume.

### Errata de la spec (relevés à `2d45426`)

- `NS_ONCHAIN` n'existe pas : `apps/web/src/data/onchain/cache.ts:18` déclare `const NS = "onchain"`, non exporté.
- `acquireSlot` de Coinalyze se trouve en `apps/web/src/data/coinalyze.ts:106-132`, avec `RATE_LIMIT = 40` (`:49`), et non en `:76-124` avec 10. La file CryptoQuant en reprend le principe avec 10 req / 60 s.
- `resteSurLePoste` se trouve en `apps/web/src/store/persist.ts:791-793` (la spec indique `:790-792`).
- Le prédicat Bearer de la fonction Vercel se trouve en `api/_policy.ts:276-284` (la spec §4.1 indique `:277-284`).
- Le quota « x/10 min » s'affiche dans le panneau DATA, pas dans la section DES, alors que la maquette §5.1 le plaçait en pied de section.

### Limites connues

- Collecte dépendante de l'usage : une série ne s'archive que si DES ou CHAIN est ouverte ; plus de 30 jours sans ouverture = jours perdus définitivement (affichés).
- Heure de publication de J-1 inconnue : la reprise 6 h peut repousser la collecte de J-1 au lendemain (trou récupérable dans la fenêtre).
- Archive hors sauvegarde JSON ; sur un poste sans daemon, vider le stockage du navigateur la perd (mention affichée dans les deux vues).
- Sémantique non documentée, affichée brute : composition de `btc_all`/`eth_all`, `inverse` et unités des swaps inverses, `reported_production`/`report_accuracy`, remise à zéro de `accumulated_monthly_rewards`.
- Noms usuels des neuf sociétés en infobulle : connaissance générale, non issue du sondage.
- Deux onglets peuvent dépasser 10 req/min : 429 puis reprise automatique.
EOT
} >> "$RAPPORT"
````

Attendu : les deux commandes réussissent (code 0), sans ligne `Error:`. Si une section `### Budget …` manque, le script s'arrête avant tout ajout : compléter la tâche fautive (1, 8, 16 ou 19), puis relancer seulement la seconde partie.

- [ ] **Étape 5 : lancer le test et vérifier qu'il passe**

```bash
grep -c '^## Clôture' docs/superpowers/progress/2026-09-16-cryptoquant.md
grep -c '^### Budget ' docs/superpowers/progress/2026-09-16-cryptoquant.md
grep -cE '^\| Budget (avant B1|après B1-3|après B1|après B2|final) \|' docs/superpowers/progress/2026-09-16-cryptoquant.md
grep -c 'en attente de la preuve manuelle du propriétaire' docs/superpowers/progress/2026-09-16-cryptoquant.md
grep -cE 'CLE-TEST-SECRETE|fixture-personnelle|Bearer [A-Za-z0-9_-]{16,}' docs/superpowers/progress/2026-09-16-cryptoquant.md
git status --short
git diff --exit-code -- BUILD-CONTRACT.md
```

Attendu, dans l'ordre :
- `1` ;
- `5` : une section par étape (`avant B1`, `après B1-3`, `après B1`, `après B2`, `final`) ;
- `5` : les cinq lignes du tableau ;
- `1` ;
- `0` : aucune valeur de clé, seul `$CQ_CLE` apparaît ;
- `git status --short` ne liste que ` M docs/superpowers/progress/2026-09-16-cryptoquant.md` ;
- `BUILD-CONTRACT.md` est inchangé (code 0).

Relire la section ajoutée : les blocs de sortie ne sont pas vides.

- [ ] **Étape 6 : commit**

```bash
git add docs/superpowers/progress/2026-09-16-cryptoquant.md
git commit -m "docs(rapport): clôture CryptoQuant — preuves, budget avant/après, parcours e2e et preuve manuelle" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Étape 7 (orchestrateur) : mettre à jour la note mémoire du projet** — hors dépôt, jamais ajoutée à git. L'index `MEMORY.md` pointe déjà vers cette note : il reste inchangé.

```bash
NOTE="$HOME/.claude/projects/-Users-zakichair-Projects-axiom/memory/cryptoquant-basic-perimetre.md"
test -f "$NOTE"
{
  printf '\n**Lot B livré (clôture du %s)** — spec `2d45426`, rapport `docs/superpowers/progress/2026-09-16-cryptoquant.md` (section « Clôture ») : route `/cqapi` à liste fermée sur Vite, daemon et Vercel ; clé personnelle `axiom:cryptoquant:key` (Réglages ; repli `CRYPTOQUANT_API_KEY` de `apps/web/.env` pour Vite et le daemon seulement) ; archive côté client `axiom:onchain:cq:<serie>:v1` et KV daemon `onchain/cq:<serie>:v1` ; DES « Flux takers toutes places » ; CHAIN « Production des mineurs cotés » dans la section Mineurs. Commits :\n\n' "$(date -u +%Y-%m-%d)"
  git log --reverse --format='- `%h` %s' 2d45426..HEAD
  cat <<'EOF'

Écarts actés à la spec : qualité CHAIN `ageMaxMs` 3 j (spec amendée) et couverture au jour de référence ; affichage DES (formats, quota dans DATA) ; bouton Réglages aussi sur clé refusée (401) ; proxys locaux « en-tête client s'il est valide, sinon `.env` » et POST Vercel sans clé → 405 ; archive de version inconnue → `erreur`, zéro appel, rien réécrit ; table CHAIN triable. Reste au propriétaire : la preuve manuelle (curl daemon et Vite, absence de `CRYPTOQUANT_API_KEY` sur Vercel) et la valeur réelle de `x-ratelimit-reset`, à inscrire dans le rapport.
EOF
} >> "$NOTE"
tail -n 25 "$NOTE"
git status --short
```

Attendu : `test -f` réussit ; la fin de la note montre le paragraphe « Lot B livré », la liste des commits (commit de clôture compris) et les écarts actés ; `git status --short` est vide (la note est hors dépôt).
