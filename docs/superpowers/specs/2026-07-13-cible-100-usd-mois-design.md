# Design — Programme « Cible 100 $/mois » (G100)

**Date :** 2026-07-13  
**Statut :** approuvé pour exécution multi-agent  
**Plan d’implémentation :** `docs/superpowers/plans/2026-07-13-cible-100-usd-mois.md`

## Problème

AXIOM a la **surface** d’un terminal à forte valeur (chart orderflow, ~94 indicateurs, 21 fenêtres, daemon, alertes, globe…) mais pas encore le **willingness-to-pay 100 $/mois** face à TV + CoinGlass + Bookmap : l’edge n’est pas productisé en workflows, l’UI d’alertes est partielle, le packaging est dev-centrique, et la boucle alerte→chart→journal est incomplète.

## Objectif

Atteindre la **gate G100** (10 critères binaires dans le plan) sans violer `BUILD-CONTRACT.md`.

## Non-objectifs

Paper trading, heatmap liq maison, AggregationEngine multi-ex, Electron, Pine-like, empilement d’oscillateurs.

## Approche

Cinq vagues (W0 confiance/packaging → W1 edge → W2 liens/data → W3 boucle trader → W4 gate), DAG de 15 PR, max 3 agents en worktrees parallèles, ownership des fichiers goulots.

## Key Decisions

Voir §9 du plan d’implémentation (K1–K10) : ne pas refaire Phase 0 ; WTP = workflow ; funding alerts via poll daemon ; playbooks = composition de stores ; bus `navigateTo` ; budget data ≤30 $.

## Open Questions

Q1–Q4 du plan (budget API, CVD-div v1.1, CSV only, `pnpm up` = dev).

## PR Plan

Voir §8 du plan (PR-01 … PR-15).
