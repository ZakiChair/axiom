# Règles de provider — routage par action

> Source de vérité du routage multi-modèles du projet. À lire par CHAQUE agent
> avant d'agir, au même titre que `BUILD-CONTRACT.md`.
>
> **Rôles** (le routage se raisonne en RÔLES, pas en noms de modèles : ceux-ci
> changent au fil des versions et divergent d'un document à l'autre. Le modèle
> effectivement affecté à un rôle est annoncé dans le brief de lot) :
>
> | Rôle | Usage |
> |---|---|
> | **Orchestrateur** | Planifie, arbitre, découpe en briefs, vérifie le résultat final |
> | **Réviseur** | Revues critiques, sécurité, décisions à fort enjeu, verdict final |
> | **Développeur A** | Implémentation sur brief (front web, features) |
> | **Développeur B** | Implémentation sur brief (daemon, packages purs, données) |
>
> Règle générale : **l'orchestrateur ne produit pas** — il briefe, arbitre et
> vérifie. Les développeurs n'écrivent QUE ce qui est dans leur brief, avec les
> fichiers qu'on leur assigne.

---

## Matrice action → rôle

| Action | Rôle | Règle |
|---|---|---|
| Découper un lot en briefs | **Orchestrateur** | Un brief = un problème fonctionnel + fichiers ciblés + critère de sortie |
| Implémentation front (`apps/web/src/**`) | **Développeur A** | Sur brief, fichiers assignés uniquement |
| Implémentation daemon (`apps/daemon/**`) | **Développeur B** | Sur brief, fichiers assignés uniquement |
| Implémentation packages purs (`packages/*`) | **Développeur A** ou **B** | Selon l'assignation du brief (jamais les deux sur les mêmes fichiers) |
| Tests (rédaction, correction) | Le dev du lot | Avec le code, dans le même brief |
| Documentation / BUILD-CONTRACT / README | **Orchestrateur** (Lot 0) | Rédigé par l'orchestrateur, ou par un dev sur brief explicite de l'orchestrateur (cf. Garde-fous) |
| Revues de code courantes | **Réviseur** | Après chaque lot, avant merge |
| Sécurité (secrets, proxy, `/extapi`, localhost) | **Réviseur** | Toujours ; jamais un dev seul |
| Backtest / math / drawdown / expectancy | **Réviseur** | Chantier à fort enjeu (Lot 2) : le réviseur pilote, les devs exécutent |
| Vérification finale (gate G100, verdict) | **Réviseur** + **Orchestrateur** | Le réviseur vérifie, l'orchestrateur entérine |
| Ménage CI / scripts | **Développeur B** | Sur brief |

## Contrat de workflow

1. **L'orchestrateur** lit le plan courant (`docs/superpowers/plans/2026-09-01-corrections-revue-complete.md`), découpe le lot en briefs, et assigne chaque brief à **un seul** développeur.
2. **Le développeur** écrit le test qui reproduit le défaut (quand possible), implémente, vérifie `pnpm check`, et rend un rapport (état, tests, diff).
3. **Le réviseur** revoit le diff du lot (code + tests) ; tout ce qui touche la sécurité est revu **systématiquement**.
4. **L'orchestrateur** vérifie la conformité au plan, puis décide du commit ou du retour au développeur.
5. **Jamais deux développeurs sur les mêmes fichiers en parallèle** — un brief, un dev, des fichiers disjoints.

## Garde-fous

- Un développeur ne modifie **pas** de sa propre initiative `BUILD-CONTRACT.md`, le README, les plans, ni les règles du présent fichier (réservés à l'orchestrateur). **Exception explicite** : un brief d'orchestrateur peut confier à un développeur la mise à jour d'un de ces documents, à condition que le brief nomme les fichiers autorisés et le contenu attendu ; hors de ce cadre, la modification est un écart à signaler.
- Un développeur ne décide **pas** seul d'un changement d'architecture ni d'une nouvelle dépendance — il le signale dans son rapport.
- Un dev ne revoit pas sa propre production : la revue de lot est toujours faite par un autre modèle (le réviseur par défaut).
- Toute divergence entre le brief et la réalité du code est remontée dans le rapport, pas corrigée en douce.
