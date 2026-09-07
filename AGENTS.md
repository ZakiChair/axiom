# Protocole de développement multi-modèle

Ce dépôt suit le protocole canonique : `~/DEV-PROTOCOL.md`.

- **Orchestrateur** : Fable 5 (`claude-fable-5`) — architecture, plan, review.
- **Exécutants** : Grok 4.6 (`grok-4.6`) et GPT 5.6 — implémentation, tests, bug fixes.
- **Rôle par défaut ici** : exécutant. Toute décision architecturale remonte à Fable 5.
- **Workflow** : Design (Fable 5) → Implémentation (Grok/GPT) → Review (Fable 5).
- **Règles** : français, simplicité d'abord, pas de modification architecturale sans accord de l'orchestrateur.
