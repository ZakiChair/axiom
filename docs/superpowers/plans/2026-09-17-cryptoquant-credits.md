# Budget de crédits CryptoQuant — plan d'exécution

> **Pour les agents :** exécuté en Subagent-Driven Development (une tâche = un implémenteur, une revue, boucle de correction bornée), strictement dans l'ordre.

**Objectif :** tenir le quota mensuel réel de l'offre Basic (10 000 crédits, 15 par appel réussi) : 402 explicite, compteur de crédits glissant sur 31 jours avec plafond de sécurité, reprise 12 h, segment crédits dans DATA.

**Spec :** `docs/superpowers/specs/2026-09-16-cryptoquant-takers-mineurs-design.md`, **§13** (autorité ; tests C1 à C8). Preuve à l'origine : `docs/superpowers/progress/2026-09-16-cryptoquant.md`, section « Preuve manuelle ».

**Architecture :** tout le calcul vit dans le client chargé à la demande (`apps/web/src/data/onchain/cryptoquant.ts`, ou un module `data/onchain/` que seul le client importe). Le chemin d'entrée ne reçoit que le type `QuotaSource` étendu, le rendu du segment dans `formatQuota` et un littéral dans `persist.ts`.

## Contraintes globales

- Français partout ; TDD (test rouge pour la bonne raison, puis vert) ; `pnpm check` vert avant CHAQUE commit ; commits terminés par une ligne `Co-Authored-By:` qui nomme le modèle ayant réellement produit le commit (arbitrage du 2026-09-17 : l'exactitude de l'attribution primait sur l'uniformité demandée d'abord ; le lot porte donc des lignes Opus 5 et Sonnet 5).
- Constantes exactes (§13) : `PLAFOND_CREDITS_CQ = 9_000`, `COUT_CREDITS_DEFAUT_CQ = 15`, borne de `x-credit-cost` [0, 1 000] entier, fenêtre 31 jours UTC, clé `axiom:cryptoquant:credits:v1`, valeur `{ "v": 1, "jours": { "AAAA-MM-JJ": n } }`, mémoire 402 valable 24 h, `REPRISE_MS = 12 h`.
- Libellés exacts (§13) : `RAISON_CREDITS_EPUISES_CQ` = « Crédits mensuels CryptoQuant épuisés (402) : plus d'appel avant la remise à zéro mensuelle ; archive affichée. » ; `RAISON_BUDGET_CREDITS_CQ` = « Budget de crédits CryptoQuant atteint (≈ N/10 000 sur 31 j, ce navigateur) : appels suspendus pour préserver le mois ; archive affichée. » (N = somme entière) ; santé « CryptoQuant : crédits mensuels épuisés » ; en-têtes de section « crédits CryptoQuant épuisés » et « budget de crédits atteint » ; segment DATA « · ≈N/10 000 crédits 31 j ».
- Aucune clé réelle ni marqueur de clé dans un fichier commité ; aucune variable CryptoQuant dans `api/` ; le client ne se charge dans les vues que par `await import("../data/onchain/cryptoquant")` (littéral exact) et n'y est importé qu'en `import type`.
- Bundle initial : plafond bloquant 1 220 000 / 360 000 gzip ; delta visé ≤ ~60 o gzip pour tout le lot ; mesurer à chaque `pnpm check` et consigner.
- Travailler uniquement dans le worktree `/Users/zakichair/Projects/axiom/.worktrees/cryptoquant` ; jamais le checkout principal ; pas de `git stash`, push, merge ni `git worktree add` ; commandes shell simples à chemins littéraux (pas de `$(...)`, pas de variables, pas de pipeline mêlant git et d'autres outils) ; `mkdir -p logs` avant toute redirection vers `logs/` (non suivi) ; aucun sous-agent.
- Test instable connu antérieur : `apps/web/src/data/onchain/tresoreriesBtc.test.ts:151` ; relancer une fois s'il est le seul rouge.

---

### Tâche 1 : relais de `x-credit-cost` (daemon, Vercel) et contrat

**Fichiers :** `shared/cryptoquant-proxy.ts` ; `apps/daemon/src/proxy.ts` (`ENTETES_QUOTA_CRYPTOQUANT`, `Access-Control-Expose-Headers`) ; `api/proxy.ts` (liste vers la ligne 361, et l'exposition si elle existe) ; tests `apps/daemon/src/cryptoquantProxy.test.ts`, `apps/daemon/src/proxy.test.ts`, `apps/daemon/src/vercelProxy.test.ts` ; `BUILD-CONTRACT.md` (section « Fournisseur CryptoQuant BASIC »).

- Définir UNE liste exportée dans `shared/cryptoquant-proxy.ts`, `ENTETES_RELAYES_CQ = ["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "x-credit-cost"] as const`, et l'utiliser dans le daemon et dans la fonction Vercel (plus de listes recopiées). Le test structurel « le module partagé n'importe rien et ne lit aucun environnement » reste vert.
- `Access-Control-Expose-Headers` du daemon (et de Vercel s'il en pose un) liste les quatre en-têtes.
- Tests (C7) : un 200 amont portant `x-credit-cost: 15` et un en-tête `x-autre: 1` → la réponse porte `x-credit-cost: 15`, l'expose, et ne porte pas `x-autre` ; même contrôle côté Vercel.
- `BUILD-CONTRACT.md` : « 10 000 req/mois » devient « 10 000 crédits/mois (15 par appel réussi observé le 2026-09-17) » ; la phrase de cadence mentionne la reprise 12 h, le plafond de 9 000 crédits sur 31 jours glissants (par navigateur) et le 402 explicite ; « en-têtes `x-ratelimit-*` relayés » devient « en-têtes `x-ratelimit-*` et `x-credit-cost` relayés » ; l'arithmétique « ≈ 390 req/mois nominal, ≤ 1 560 en pire cas » est remplacée par « ≈ 195 crédits par passe DES + CHAIN ; plafond 9 000 / 31 j ».
- Commit : `fix(proxy): x-credit-cost relayé par le daemon et Vercel (liste partagée)` (ou `feat(proxy)`).

### Tâche 2 : client — compteur de crédits, 402, plafond, sauvegarde

**Fichiers :** `apps/web/src/data/onchain/cryptoquant.ts` (et, si plus lisible, un module pur `apps/web/src/data/onchain/cryptoquantCredits.ts` que seul le client importe) ; `cryptoquant-fetch.test.ts`, `cryptoquant.test.ts` (ou un test du module) ; `apps/web/src/store/health.ts` (type `QuotaSource` seulement) ; `apps/web/src/store/persist.ts` et `persist.test.ts` ; `apps/web/src/chunkCryptoquant.test.ts` si le nouveau module doit y être déclaré.

- `StatutCq` gagne `"credits"`. Exporter `RAISON_CREDITS_EPUISES_CQ` et une fonction `raisonBudgetCreditsCq(n: number): string` (ou une constante gabarit) pour que les vues reconnaissent les deux raisons sans importer de valeur du client (elles les recopieront en littéraux locaux à la tâche 5 : documenter ce contrat dans un commentaire).
- `QuotaSource` (store/health.ts) gagne `credits?: { utilise: number; limite: number; jours: number }` (type seulement, aucun code nouveau dans ce fichier).
- Compteur (§13) : lecture paresseuse de `axiom:cryptoquant:credits:v1` au premier besoin, copie mémoire source de vérité, élagage à 31 jours UTC à chaque écriture, illisible ou `v` inconnue → vide, écriture en échec tolérée (try/catch), somme sur 31 jours. Coût : 200 seulement, `x-credit-cost` entier dans [0, 1 000] sinon 15. Aucun comptage sur 401/402/403/429/5xx/réseau.
- Publication : `healthStore.getState().setQuota("cryptoquant", { utilise, limite: 10, fenetre: "1min", credits: { utilise: somme31j, limite: 10_000, jours: 31 } })` à chaque créneau et à chaque 200 (adapter la publication existante, ne pas en ajouter une seconde qui écraserait la première) ; au premier chargement du module, publier aussi la somme si elle est non nulle.
- 402 → `fin("credits", RAISON_CREDITS_EPUISES_CQ, true)`, mémoire globale `refusCredits = { version, ts }` (version de clé comme `refusCle`), `marquerErreur` avec le message exact ; corps amont jamais lu pour la raison. Mémoire active si même version et `now - ts < 24 h` ; effacée quand la version de clé change (même mécanisme que `refusCle`).
- Ordre dans `chargerUneFois` : après le contrôle de reprise (étape 5 actuelle, ligne « `majTs` futur… »), ajouter : mémoire 402 active → `fin("credits", RAISON_CREDITS_EPUISES_CQ, false)` ; plafond (`somme + 15 > 9 000`) → `fin("credits", raisonBudgetCreditsCq(somme), false)` ; puis le créneau ; après le créneau, re-contrôler plafond et mémoire 402 (une autre série a pu répondre entre-temps) — si l'un bloque, rendre le créneau n'est pas nécessaire mais aucun fetch ne part.
- `persist.ts` : ajouter le littéral `"axiom:cryptoquant:credits:v1"` aux états locaux non exportés (même traitement que la clé : ni exporté, ni écrasé, ni purgé à l'import) ; test dans `persist.test.ts`.
- Tests : C1, C2, C3, C4 de la spec §13, plus « la raison budget contient la somme entière » et « aucune trace du corps 402 dans les résultats, `etatFileCq` et la santé ».
- Commit : `feat(client): budget de crédits CryptoQuant — 402 explicite, compteur glissant 31 j, plafond 9 000`.

### Tâche 3 : client — cadence (reprise 12 h, 200 vide)

**Fichiers :** `apps/web/src/data/onchain/cryptoquant.ts`, `cryptoquant-fetch.test.ts`.

- `REPRISE_MS = 12 * 3600_000` ; commentaires et tests existants de la reprise 6 h mis à jour (C5 : `now − 11 h 59` → 0 fetch ; `now − 12 h` → 1 fetch ; garde du `majTs` futur conservée).
- 200 vide ou invalide : compté (tâche 2), heure mémorisée en session par série (`Map<SerieCq, number>`), et la reprise 12 h s'applique aussi à cette heure (C6) ; archive inchangée, statut et raison actuels conservés.
- Commit : `feat(client): reprise CryptoQuant 12 h et réponse vide mémorisée`.

### Tâche 4 : DATA — segment crédits

**Fichiers :** `apps/web/src/components/HealthPanel.tsx` et son test existant (le trouver) ; rapport `docs/superpowers/progress/2026-09-16-cryptoquant.md` (mesure du budget).

- `formatQuota(q)` : si `q.credits` est défini, ajouter « · ≈{utilise}/{limite} crédits {jours} j » après les segments existants, avec le séparateur de milliers du dépôt s'il en existe un déjà importé par ce fichier (sinon l'entier brut ; ne pas ajouter d'import qui grossirait le bundle initial). Exemple attendu sans séparateur : `3/10 min · ≈195/10000 crédits 31 j` ; si un formateur est déjà disponible, l'utiliser et tester sa sortie exacte.
- Test de `formatQuota` avec et sans `credits`, et avec `jour` + `credits`.
- Mesurer le bundle initial (`pnpm check` affiche le JSON) et l'écrire dans le rapport sous `### Budget après le lot crédits` (JSON complet + delta depuis 1 206 265 / 355 686).
- Commit : `feat(data): segment crédits CryptoQuant dans DATA`.

### Tâche 5 : vues DES et CHAIN, e2e, rapport

**Fichiers :** `apps/web/src/components/FluxTakersSection.tsx` (+ test), `apps/web/src/components/onchain/MineursCotes.tsx` (+ test), `apps/web/e2e/des-flux-takers.e2e.ts`, `apps/web/e2e/chain-mineurs-cotes.e2e.ts`, `docs/superpowers/progress/2026-09-16-cryptoquant.md`.

- DES `resumeEnTeteFluxTakers` et CHAIN `resumeEnTeteMineurs` : statut `credits` placé comme `offre` dans l'ordre des branches ; libellé « crédits CryptoQuant épuisés » si la raison est celle du 402, sinon « budget de crédits atteint ». Les raisons du client sont recopiées en littéraux locaux (pas d'import de valeur) avec un test qui compare ces littéraux aux exports du client (import de valeur autorisé dans un fichier de test seulement si le garde-fou de chunk l'accepte ; sinon comparaison au texte de la spec).
- Bandeau : la raison ; archive affichée ; `SansCle`/CTA non affichés pour `credits` ; qualité CHAIN : `credits` compte comme un échec (raison conservée, indisponible sans archive).
- Tests de rendu statique pour chaque libellé et chaque vue (avec et sans archive).
- e2e : (a) ajuster les parcours « réouverture » à la reprise 12 h (réouverture plus de 12 h plus tard sans changer de jour UTC : choisir des heures figées compatibles, par exemple 00:30 puis 12:45 UTC, en gardant J-1 identique) ; (b) nouveau parcours DES : la première série répond 402 → aucun autre appel `/cqapi` pendant le montage, en-tête « crédits CryptoQuant épuisés ».
- Rapport : section `## Lot crédits (2026-09-17)` : constat, décisions §13, commits, preuves de tests, budget, limites (compteur par navigateur, remise à zéro inconnue, 402 comme filet).
- `pnpm check` puis `AXIOM_E2E_PORT=5239 bash scripts/ci.sh --e2e` verts avant le commit.
- Commits : `feat(des,chain): statut crédits CryptoQuant` et `test(e2e): reprise 12 h et 402 CryptoQuant`, `docs(rapport): lot crédits`.
