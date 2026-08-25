# Règles de provider — routage par action

> Source de vérité du routage multi-modèles du projet. À lire par CHAQUE agent
> avant d'agir, au même titre que `BUILD-CONTRACT.md`.
>
> **Modèles** :
>
> | Rôle | Modèle | Usage |
> |---|---|---|
> | **Orchestrateur** | Fable | Planifie, arbitre, découpe en briefs, vérifie le résultat final |
> | **Pilote revues** | Opus | Revues critiques, sécurité, décisions à fort enjeu, verdict final |
> | **Développeur A** | GPT-sol | Implémentation sur brief (front web, features) |
> | **Développeur B** | DeepSeek | Implémentation sur brief (daemon, packages purs, données) |
>
> Règle générale : **l'orchestrateur ne produit pas** — il briefe, arbitre et
> vérifie. Les développeurs n'écrivent QUE ce qui est dans leur brief, avec les
> fichiers qu'on leur assigne.

---

## Matrice action → provider

| Action | Provider | Règle |
|---|---|---|
| Découper un lot en briefs | **Fable** | Un brief = un problème fonctionnel + fichiers ciblés + critère de sortie |
| Implémentation front (`apps/web/src/**`) | **GPT-sol** | Sur brief, fichiers assignés uniquement |
| Implémentation daemon (`apps/daemon/**`) | **DeepSeek** | Sur brief, fichiers assignés uniquement |
| Implémentation packages purs (`packages/*`) | **DeepSeek** ou **GPT-sol** | Selon l'assignation du brief (jamais les deux sur les mêmes fichiers) |
| Tests (rédaction, correction) | Le dev du lot | Avec le code, dans le même brief |
| Documentation / BUILD-CONTRACT / README | **Fable** (Lot 0) | Réécrit par l'orchestrateur, pas par les devs |
| Revues de code courantes | **Opus** | Après chaque lot, avant merge |
| Sécurité (secrets, proxy, `/extapi`, localhost) | **Opus** | Toujours ; jamais un dev seul |
| Backtest / math / drawdown / expectancy | **Opus** | Chantier à fort enjeu (Lot 2) : Opus pilote, GPT-sol/DeepSeek exécutent |
| Vérification finale (gate G100, verdict) | **Opus** + **Fable** | Opus vérifie, Fable entérine |
| Ménage CI / scripts | **DeepSeek** | Sur brief |

## Contrat de workflow

1. **Fable** lit le plan (`docs/superpowers/plans/2026-08-24-plan-action-revue-globale.md`), découpe le lot en briefs, et assigne chaque brief à **un seul** développeur.
2. **Le développeur** écrit le test qui reproduit le défaut (quand possible), implémente, vérifie `pnpm check`, et rend un rapport (état, tests, diff).
3. **Opus** revoit le diff du lot (code + tests) ; tout ce qui touche la sécurité est revu par Opus **systématiquement**.
4. **Fable** vérifie la conformité au plan, puis décide du commit ou du retour au développeur.
5. **Jamais deux développeurs sur les mêmes fichiers en parallèle** — un brief, un dev, des fichiers disjoints.

## Garde-fous

- Un développeur ne modifie **pas** `BUILD-CONTRACT.md`, le README, les plans, ni les règles du présent fichier (réservé à Fable).
- Un développeur ne décide **pas** seul d'un changement d'architecture ni d'une nouvelle dépendance — il le signale dans son rapport.
- Un dev ne revoit pas sa propre production : la revue de lot est toujours faite par un autre modèle (Opus par défaut).
- Toute divergence entre le brief et la réalité du code est remontée dans le rapport, pas corrigée en douce.
