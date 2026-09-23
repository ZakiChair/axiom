# Analyse multidomaine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Root orchestre et vérifie, les développeurs possèdent des fichiers disjoints, le réviseur est indépendant.

**Goal:** Livrer les huit fonctions autorisées avec preuves datées, calculs vérifiables et usages opérationnels dans les fenêtres existantes.

**Architecture:** Calculs purs par domaine, composants chargés à la demande, registre vanilla léger de lectures acquises. Les dossiers copient ce registre au signal ; aucun calcul historique ne consulte un contexte futur.

**Tech Stack:** TypeScript strict, React/Vite existants, Zustand vanilla, Vitest/Playwright existants, aucun ajout de dépendance.

**Spec:** `docs/superpowers/specs/2026-09-23-analyse-multidomaine-design.md`

**Contrat math:** `docs/superpowers/specs/2026-09-23-analyse-multidomaine-contrat.md`

## Global Constraints

- 39 fenêtres, 214 indicateurs, 9 identifiants de marché ; aucune fenêtre, dépendance, infrastructure, clé de trading ni fournisseur nouveau.
- Budget initial maximal : 1 220 000 octets bruts et 360 000 octets gzip.
- Aucun changement de politique proxy, d'environnement Vercel ou de secret.
- Une absence n'est pas un zéro. Source, instrument, unité, période observée, récupération et éventuel millésime restent distincts.
- L'orchestrateur possède README/BUILD-CONTRACT/docs. Aucun Git, push, déploiement, redémarrage du daemon ni sous-agent lancé par un développeur.
- Les développeurs exécutent les tests ciblés de leur lot ; root sérialise `pnpm check` et `pnpm check:e2e`. Pas de suites globales concurrentes.
- Chaque lot rapporte fichiers, interfaces, TDD réel et limites dans `.superpowers/sdd/2026-09-23-analyse-multidomaine/task-N-report.md`.
- Workdir exclusif `/Users/zakichair/Projects/axiom/.worktrees/analyse-multidomaine` ; base `5ff567e`.

## Review Focus

1. Une acquisition lente arrive après changement de symbole/source/date : elle ne remplace pas le nouveau contexte. Couvrir T1/T2/T3 et T5.
2. Une région/chaîne/facteur manque : aucune normalisation silencieuse de l'univers, aucune contradiction fondée sur inconnu. Couvrir T1/T3/T4/T5.
3. Une preuve importée contient des dates futures, des champs inconnus ou une valeur non finie : rejet explicite, originaux conservés, ancien format compatible. Couvrir T1/T5/T6.
4. Le carnet disparaît, le funding s'inverse ou le modèle est colinéaire : résultat indisponible ou scénario correctement signé, jamais faux coût nul. Couvrir T2/T4.
5. Plusieurs dossiers se rattachent au même trade et un contexte est capturé après l'entrée : aucun double comptage ni attribution rétrospective. Couvrir T6.

## Ordre et interfaces

T1 et T2 sont indépendantes (T2 attend la signature du registre avant son raccordement).
T3 appartient au développeur A après T1. T4 appartient à B après T2 et contrat math.
T5 consomme T1/T2/T3. T6 consomme T1 et T5. T7 vérifie l'ensemble.

Le registre partagé ne dépend d'aucun loader. Signature publique à réaliser par T1 :

```ts
export type DomaineAnalyse = "quadrant" | "liquidite" | "rotation" | "geo" | "divergence";
export type StatutAnalyse = "frais" | "partiel" | "perime" | "indisponible";
export interface LectureAnalyse {
  id: string; domaine: DomaineAnalyse;
  nature: "observation" | "scenario-conditionnel";
  conclusion: string;
  tags: Array<{ cle: DomaineAnalyse; valeur: string }>;
  instrument: { symbol: string; source: ExchangeId } | null;
  horizon: { depuis: number; jusqua: number };
  unite: string | null; valeur: number | null;
  source: string; observeLe: number | null; recupereLe: number;
  validiteJusqua: number | null; statut: StatutAnalyse;
  couverture: { presentes: number; attendues: number } | null;
  limites: string[];
  preuve: { fenetre: "RATE" | "DOM" | "CHAIN" | "GLOBE" | "BRIEF"; reference: string };
}
export function validerLectureAnalyse(brut: unknown): LectureAnalyse | null;
export function statutLectureAnalyse(lecture: LectureAnalyse, maintenant: number): StatutAnalyse;
// store/analyseMultidomaine.ts : fonctions exportées, état vanilla en mémoire.
export function remplacerLectures(domaine: DomaineAnalyse, lectures: readonly LectureAnalyse[]): void;
export function lireLectures(maintenant: number): LectureAnalyse[];
export function capturerLectures(maintenant: number): LectureAnalyse[];
```

Le validateur borne à 50 lectures, 10 tags/lecture, textes 500 caractères, limites
10×500, périodes finies et ordonnées, couverture entière 0≤présentes≤attendues,
tags cle connue/valeur non vide ≤80, identités de source réelles. Le registre refuse
les doublons et les entrées invalides ; capture par copie, requalification de
péremption sans redater. Capture interdit observeLe/recupereLe/horizon.jusqua dans
le futur ; un scénario peut décrire un horizon projeté dans le texte mais sa
preuve porte la fenêtre observée. Statut indisponible si motif, valeur inconnue.

### Task 1: Registre léger et quadrants MACRO — développeur A

**Files:** créer `data/analyseMultidomaine.ts`, `store/analyseMultidomaine.ts`, tests ; créer `data/macro/quadrants.ts`, `components/macro/QuadrantsMacro.tsx`, tests ; modifier `components/MacroSeriesTab.tsx`. Les chemins sont sous `apps/web/src/`. Autorisation additive `store/macroSeries.ts` seulement si le loader existant ne conserve pas les familles nécessaires ; aucune modification de transport sans retour root.

**Interfaces:** produit le registre ci-dessus et `calculerQuadrants` pur, exporté avec ses types ; un loader `chargerQuadrants` réutilise `demanderIndicateur`, utilisable par BRIEF sans montage UI.

- [ ] Écrire tests avant calcul : quatre mois consécutifs avec production a/a 1→2 et CPI 3→2 donne croissance accélère/inflation décélère ; mois manquant => inconnu ; changement de millésime n'écrase pas la vue active ; clone capturé ne change pas après mutation du producteur.
```ts
expect(statutLectureAnalyse({ ...lecture, validiteJusqua: 1000 }, 1000)).toBe("perime");
expect(validerLectureAnalyse({ ...lecture, valeur: Infinity })).toBeNull();
```
- [ ] Lancer les nouveaux tests et observer l'échec avant implémentation.
  Run: `pnpm --filter @axiom/web exec vitest run src/data/analyseMultidomaine.test.ts src/data/macro/quadrants.test.ts`
  Expected: échec des fonctions non réalisées, puis réussite après implémentation.
- [ ] Implémenter registre/validation et publier immédiatement les signatures à root/B. Aucun gros import de loader dans ces modules.
- [ ] Quadrant : variation en points du rythme annuel entre M et M−3 avec les quatre mois consécutifs requis, axe production industrielle et axe CPI au même mois. `abs(delta)<=1e-9` = stable ; un axe stable ne force pas un des quatre quadrants. PIB annuel trimestriel lu comme contexte distinct. Périodes et dernière fin de période visibles ; aucune date de publication inventée. ALFRED strict aux séries compatibles, autres régions indisponibles dans une vue connue-au.
- [ ] Vue en sous-section repliable accessible clavier dans MACRO, régions existantes, dernière classification et transitions historiques ; publier lectures datées dans registre. Chargement/annulation/erreur/prérequis clé visibles.
- [ ] Vérifier tests nouveaux + `macroSeries.test.ts`, `macroRatesView.test.ts`, typecheck web et parcours e2e lot dans `apps/web/e2e/analyse-macro.e2e.ts`. Résultat attendu : verts sans modifier les assertions métier existantes.

### Task 2: Stabilité de liquidité DOM — développeur B

**Files:** créer `data/depthStability.ts` et tests, `components/dom/DepthStabilityPanel.tsx` ; modifier `store/microstructure-diagnostic.ts` et test, `components/DomWindow.tsx`. `data/depthExecution.ts` reste source unique du coût ; toute modification doit avoir un test financier reproduisant son besoin.

**Interfaces:** consomme registre T1 ; produit fonction pure et vue bornée dans le diagnostic partagé. Le coût et le statut sont attachés à symbole/source/notionnel/côté.

- [ ] Tests : coûts [1,2,3,4,100] ont médiane3 et p95 par convention documentée ; seuls carnets couvrant toute la taille entrent dans les quantiles. Distinguer carnet invalide et taille insuffisante.
- [ ] Run: `pnpm --filter @axiom/web exec vitest run src/data/depthStability.test.ts src/store/microstructure-diagnostic.test.ts`
  Expected: nouvelle régression rouge puis suite verte.
- [ ] Observer à cadence1s, maximum900 créneaux et 15min ; vues1/5/15min. Minimum20 observations valides pour quantiles, courant immédiatement si frais. Afficher séparément couverture de la fenêtre demandée et couverture de la durée réellement observée, sans inventer 15 min au démarrage. Un carnet encore frais peut représenter plusieurs créneaux temporels ; les observations ne sont pas présentées comme indépendantes. Conserver la convention de coutExecution : budget consommé en devise de cotation. Pas de répétition historique inventée lorsqu'un timer saute des créneaux.
- [ ] Réinitialiser identité, notionnel et callbacks reset/release ; un carnet stale n'est pas échantillonné comme coût valide. UI taille personnalisable positive bornée, achat/vente, courant/médiane/p95, couverture et durée. Publier lecture liquidité avec identité et expiration courte.
- [ ] Vérifier typecheck et `apps/web/e2e/analyse-liquidite.e2e.ts` (chauffage, taille insuffisante, changement symbole). Aucun troisième flux non multiplexé.

### Task 3: Rotation on-chain et transmission géopolitique — développeur A

**Files:** créer `data/onchain/rotationChaines.ts`, `components/onchain/RotationChaines.tsx`, `data/globe/transmission.ts`, `components/globe/TransmissionPanel.tsx`, tests ; modifier `components/onchain/EconomieChaines.tsx`, `components/GlobeDetailPanel.tsx`, `components/GlobeWindow.tsx` uniquement pour données/événement sélectionné. Raccordement prix dans un nouveau module `data/onchain/prixRotation.ts` utilisant les adapters existants pour ETHUSDT/SOLUSDT/ARBUSDT ; Base explicitement sans token.

**Interfaces:** consomme registre T1 et économieChainesStore ; fonctions pures exportées pour chargement BRIEF. Géopolitique publie seulement scénarios explicitement sélectionnés/qualifiés par l'utilisateur.

- [ ] Tests : cohorte100/100/100/100 puis200/100/100/100 => Ethereum25→40%, +15points ; une chaîne manquante interdit la part ; trou de jour brise la persistance. Prix Base absent. Signe et source d'un événement ne prédisent pas automatiquement l'exposition d'un ticker arbitraire.
- [ ] Run: `pnpm --filter @axiom/web exec vitest run src/data/onchain/rotationChaines.test.ts src/data/globe/transmission.test.ts`
  Expected: oracles rouges puis verts.
- [ ] Calculer parts historiques 4/4 à dates exactes pour chaque métrique ; 30/90j, comparer endpoints identiques. Afficher variation part et croissance niveau séparées. Préserver stocks/flux et qualité. Comparer variation prix sur mêmes dates exactes, uniquement token de référence explicite.
- [ ] GLOBE : événement sourcé sélectionné, canal choisi parmi énergie/transport/inflation/taux/dollar, texte de condition modifiable, relations documentées/liens sources fixes vérifiés. Montrer watchlist correspondante via mapping explicite des seuls instruments reconnus + inconnus signalés. Bouton chart respecte source ; scénario ouvre SCEN et invite à fixer chocs, sans préremplissage inventé.
- [ ] Si source ne fournit qu'un jour, réaction quotidienne seulement. Mesure avant/après via loaders existants, dates/horizon/couverture visibles ; futur => attente. Pas de réaction calculée sur la simple cellule agrégée si événement précis absent.
- [ ] Vérifier typecheck et `apps/web/e2e/analyse-chain-geo.e2e.ts` pour cohorte manquante, scénario conditionnel et liens exacts.

### Task 4: SCEN multifacteur et carry FUNDX — développeur B

**Files:** créer `data/scenMultifactor.ts`, `data/scenMultifactorLoader.ts`, `components/scen/ScenMultifactorPanel.tsx`, `data/fundingCarry.ts`, `data/fundingCarryQuotes.ts`, `components/fundx/CarryPanel.tsx`, tests ; modifier `data/scen.ts`/test (identité des caches/provenance PAPER), `components/ScenWindow.tsx`, `components/FundingMatrixWindow.tsx` pour intégration paresseuse.

**Interfaces:** respecter contrat math du réviseur. Facteurs prix btc/eth/spx/dxy/or sélectionnables et tauxréelUS DFII10 optionnel, défaut btc/spx/dxy ; séries quantité/source identifiées, aucune conversion d'instrument implicite. Modules purs sans store.

- [ ] Écrire les oracles du contrat : OLS à coefficients connus, constantes/colonnes colinéaires, facteurs absents, actifs auto-référencés, variation de taux en pp, source homonyme et dates non communes ; carry signé à quantité couverte avec quatre coûts, funding inverse et basis final non nul.
- [ ] Run: `pnpm --filter @axiom/web exec vitest run src/data/scenMultifactor.test.ts src/data/fundingCarry.test.ts src/data/fundingCarryQuotes.test.ts`
  Expected: échec avant moteur, puis tests verts.
- [ ] OLS descriptive jointe sur log-rendements prix et différences de taux en pp, constante ajustée. Chaque série calcule ses variations entre deux dates réellement présentes ; joindre les couples exacts (dateDébut, dateFin), sans inventer une heure ni reporter les valeurs. Les couples de dates non communs sont exclus. Pour les séries à date seule, cutoff conservateur D−2 UTC ; label permanent « variations quotidiennes par dates — clôtures non synchrones ; données révisées disponibles au calcul ». Cette vue ne reconstitue pas un millésime passé. Choc = exp(Σβprix×log1p(chocPrix)+βtaux×chocPb/100)−1, sans alpha. Exposer contributions au rendement log avant exponentiation, aucune fausse somme de P&L indépendants. Rang/VIF/refus/effectifs/stabilité selon contrat. Préserver le mode1facteur et corriger les mélanges de provenance nécessaires.
- [ ] Prix valorisation actuel distinct de l'estimation à barres closes. Fenêtre90/180/365j avec au moins max(30,10(k+1)) observations ; modèle complet choisi indisponible si facteur manque, pas de retrait silencieux. Identité exacte facteur/actif => exposition directe signalée (pas R² artificiel).
- [ ] Carry public Binance BTCUSDT/ETHUSDT : deux carnets REST et funding via transports existants ; timestamps acquis/observés distingués, recouvrement de fenêtres de requêtes contrôlé, deadline15s et abort. Prendre les prix exécutables de la profondeur pour la même quantité. Spot REST sans timestamp marché : acquisitions rapprochées via requêtes chevauchantes et bornées, fraîcheur de réception distincte de fraîcheur marché non certifiée ; le résultat porte cette limite. Frais utilisateur explicitement saisis, coûts de sortie hypothétiques distincts des coûts d'entrée observés. Horizon1/7/30j ; taux central éditable, nul/inversé, base finale éditable. Décomposition chiffrée et seuil de rentabilité ; aucun ordre.
- [ ] Vérifier typecheck, tests existants SCEN/FUNDX et `apps/web/e2e/analyse-risque-carry.e2e.ts`, notamment stale quotes, clés absentes et erreur indépendante du panneau historique.

### Task 5: Synthèse BRIEF et référence persistante — développeur A

**Files:** créer `data/analyseSynthese.ts`, `store/analyseBrief.ts`, `components/brief/SectionAnalyse.tsx`, tests ; modifier `components/BriefWindow.tsx`, `data/brief.ts`/test, `data/sauvegardeLocale.ts`/test pour clé `axiom:analyseBrief:v1`. Tout ajout daemon sauvegarde passe par root et attribution séparée.

**Interfaces:** registre T1, lectures acquises T1/T2/T3. Fonction pure de comparaison entre snapshots avec schemaVersion1, creeLe et au plus50 lectures ; copie JSON validée.

- [ ] Tests : différence horizon/source/unité/instrument => aucun delta chiffré ; donnée périmée/non comparable => aucune contradiction qualifiée ; sauvegarde en panne => état réessayable et ancienne référence conservée ; absence d'un domaine visible.
- [ ] Run: `pnpm --filter @axiom/web exec vitest run src/data/analyseSynthese.test.ts src/store/analyseBrief.test.ts src/data/brief.test.ts`
  Expected: rouges ciblés puis verts.
- [ ] Règle opérationnelle minimale : TVL30j de chaque chaîne et rendement de son token de référence (ETH/SOL/ARB) sur les mêmes dates exactes closes. Δpart et rendement de signes opposés = divergence descriptive ; mêmes signes = concordance descriptive ; zéro = neutre ; absence, péremption, Base ou dates différentes = non comparable. Mapping chaîne/token explicite, effet-prix des stocks USD rappelé, aucune contradiction logique ou causalité inventée. Produire une lecture divergence datée avec les deux valeurs/unités dans la preuve, sans élargir LectureAnalyse.
- [ ] Tableau domaines/constat/horizon/qualité/preuve et règles nommées. Distinguer divergence descriptive et simple différence d'horizon. Pour prix/flux utiliser seulement même actif et mêmes périodes réelles ; sinon état non comparable. Règles explicites et testées, aucun score universel.
- [ ] Charger macro et on-chain à la demande sur actualisation BRIEF via imports dynamiques (caches), capturer micro disponible et géo choisi ; annulation/génération refuse réponses obsolètes. États indépendants si clé/daemon manque.
- [ ] Enregistrer la référence au clic ; comparaison avec point précédent, export JSON/Markdown, réessai de sauvegarde et invalidarchive conservée. Export reprend exactement l'instantané affiché.
- [ ] Vérifier typecheck et `apps/web/e2e/analyse-brief.e2e.ts` (charger, référence, changement, réouverture, état partiel). Publier signatures à T6.

### Task 6: Contexte au signal et cohortes EXPY — développeur B

**Files:** modifier `data/decisionDossier.ts`/test, `store/decisionDossiers.ts`/test, `alerts/runtime.ts`/test, `store/alerts.ts`/test si validation requise ; créer `data/expyContexte.ts`, `components/expy/ContexteResultats.tsx`, tests ; modifier `components/DecisionDossiers.tsx`, `components/ExpyWindow.tsx`, `data/expy.ts` commentaire incohérent seulement. Préserver les champs existants et formats d'archives.

**Interfaces:** `LectureAnalyse`, `capturerLectures(ts)` T1 et tags/règles T5. Nouveau champ optionnel `analyse?: {schemaVersion:1;captureLe:number;lectures:LectureAnalyse[]}` dans preuve/dossier, pas dans @axiom/types. Tout champ doit être validé lors lecture/import.

- [ ] Tests : contexte capturé à t puis registre changé à t+1 => ancien inchangé ; preuve future ou reçue après le signal rejetée ; ancien dossier sans analyse inchangé ; trade avec deux dossiers compté une fois ; contexte postérieur à l’entrée non attribué au contexte d’entrée ; R indéfini exclu avec effectif.
- [ ] Run: `pnpm --filter @axiom/web exec vitest run src/data/expyContexte.test.ts src/data/decisionDossier.test.ts src/store/decisionDossiers.test.ts src/alerts/runtime.test.ts`
  Expected: régressions rouges puis suites vertes.
- [ ] Capturer synchronement au déclenchement front, sans fetch. Daemon et anciens signaux sans preuve restent inconnus. Ouvrir un dossier tardivement ne crée pas de contexte rétrospectif. Une capture manuelle optionnelle porte la date présente et reste clairement distincte.
- [ ] Cohortes par tag choisi, trades fermés sourcés seulement, ordre chronologique des dossiers vérifié. Agrégats descriptifs : effectif, R moyen, R médian, dispersion ; incertitude selon contrat, exclusions et chevauchements signalés. Même identité instrument/source au rattachement ; aucune inférence des anciennes provenances.
- [ ] MAE/MFE uniquement si trajectoire effectivement présente ; sinon mention non mesurée, sans dérivation depuis entrée/sortie. Aucun score de validation de stratégie.
- [ ] Vérifier le typecheck et `apps/web/e2e/analyse-expy.e2e.ts` : signal→dossier→PAPER→EXPY, contexte figé, persistance, stats/exclusions.

### Task 7: Intégration, documentation et preuves — root + développeurs sur retour

**Files:** root `README.md`, `BUILD-CONTRACT.md`, `docs/revue-2026-09-23-analyse-multidomaine.md` ; développeur B `scripts/ci.sh` uniquement pour ajouter les six specs hermétiques à la liste existante. Corrections produit attribuées au propriétaire du lot.

- [ ] Revue indépendante de chaque lot et interfaces ; clore les Important/Critical avec tests réels.
- [ ] `pnpm check` → types/tests/build/budget verts ; journal complet conservé.
- [ ] `AXIOM_E2E_PORT=5267 pnpm check:e2e` → parcours hermétiques existants + nouveaux verts.
- [ ] Parcours réel Chromium sur serveur isolé : ouverture clavier des huit fonctions, affichage et export, aucune exception JS, captures des preuves. Réponses live bornées lorsqu’elles sont disponibles, aucune clé exposée.
- [ ] Documenter capacités, limites, sources, tests et choix d’arbitrage. Commit local par lots revus, espace de travail propre. Publication externe uniquement dans le périmètre autorisé ; cette demande porte les huit fonctions, aucune nouvelle publication n’est exigée.
