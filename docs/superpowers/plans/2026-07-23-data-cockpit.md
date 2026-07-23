# Cockpit DATA — observabilité des sources — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fenêtre DATA — vue détaillée du `healthStore` existant : état, fraîcheur, quota et dernière erreur par source — spec `2026-07-23-lot-v16-onchain-expy-dist-data-design.md` §5.

**Architecture:** Une tâche : tri/formatage purs testés + fenêtre React abonnée au store (zéro nouvelle collecte) + enregistrement.

**Tech Stack:** TypeScript, vitest.

## Global Constraints

- Commentaires **français**. `git -C` systématique. ZÉRO nouvelle collecte/plomberie : la fenêtre LIT le healthStore tel quel ; la section « Caches » de la spec n'est incluse QUE si l'inventaire est déjà lisible sans plomberie (sinon omise, consigné).
- Fenêtre : id `data`, mnémonique `DATA`, `nouveau: true`, comptes windowManager.test à jour (compte constaté sur la base).
- Branche : `feat/data-cockpit`. Gate : `pnpm test` racine + tsc verts + gate visuel (contrôleur).

**Modèles à lire AVANT d'implémenter :**
- `apps/web/src/store/health.ts` (TOUT : forme des états, sources connues, quota {utilise, limite, fenetre}, marquerErreur) et la ligne santé existante de la barre du bas (comment elle consomme le store — chercher « Santé »)
- `apps/web/src/components/NetliqWindow.tsx` ou fenêtre listante simple récente pour le patron visuel

---

### Task 1: Fenêtre DATA

**Files:**
- Create: `apps/web/src/components/DataWindow.tsx` (+ `apps/web/src/data/dataCockpit.ts` pour le tri/formatage purs si non triviaux)
- Modify: `windowManager.ts`, `App.tsx`, `commands/windowPanels.ts`, `windowManager.test.ts`
- Test: tri/formatage purs

**Interfaces (Produces):**
```ts
export function trierSources(etats: /* forme du healthStore */): LigneData[];
// erreurs d'abord (plus récentes en tête), puis par dernierMessageTs desc ; LigneData = { id, libelle, etat, fraicheurMs, quota?, erreur? }
export function formatFraicheur(deltaMs: number): string; // « il y a 12 s » / « 3 min » / « 2 h » / « — »
```

- [ ] **Step 1: Tests rouges puis verts** — trierSources (erreurs en tête, tri interne), formatFraicheur (bornes s/min/h, négatif/absent → —).
- [ ] **Step 2:** Fenêtre : en-tête « N sources · M en erreur » (badge down si M > 0) ; liste : pastille couleur par état (ok = up, polling = accent, erreur = down — tokens), libellé source, fraîcheur relative (re-rendue via un tick léger 10 s OU au subscribe — préférer subscribe + tick d'affichage), barre de quota (utilise/limite, teinte down > 80 %) + fenêtre (« 10/h »), dernière erreur tronquée avec title complet.
- [ ] **Step 3:** Greffes (id `data`, DATA, nouveau) + comptes tests. `pnpm test` racine + tsc verts.
- [ ] **Step 4: Commit** — `feat(data): fenêtre DATA — observabilité des sources (états, quotas, fraîcheur, erreurs)`

Gate visuel (contrôleur) : toutes les sources actives listées (Binance/Deribit/BGeometrics/CFTC/FRED…), les 401 SoSoValue visibles en erreur, quota BGeometrics affiché, tri erreurs-d'abord, fraîcheurs qui vivent, badge d'en-tête cohérent avec la ligne santé du bas.
