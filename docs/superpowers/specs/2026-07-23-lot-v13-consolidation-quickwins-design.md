# Lot v1.3 — Consolidation & quick-wins (design)

Date : 2026-07-23 · Statut : périmètre validé par Zaki (AskUser), spec à relire. Trois branches parallèles.

## Branche 1 — `chore/hygiene-v13` (hygiène & dette)

### A1. Fixes sécurité restants (revue globale du 22/07, vérifiés encore ouverts le 23)
- `apps/web/src/store/sync.ts:29` : `ALLOWED_EXCHANGES` (5 entrées) désynchronisé de la liste autorisée par la persistance (9 : + bybit, okx, hyperliquid, synthetic) → la synchro inter-fenêtres rejette silencieusement ces exchanges. Fix : UNE source de vérité partagée (exporter la liste depuis le module qui fait autorité — regarder `persist.ts:91` — et l'importer dans sync.ts), + test qui casse si les deux listes divergent à nouveau.
- `apps/daemon/src/notify.ts:~106` : `console.error("… envoi Telegram échoué :", err)` — l'erreur brute peut contenir l'URL `api.telegram.org/bot<TOKEN>/…`. Fix : logger `err instanceof Error ? err.message : String(err)` passé par une rédaction qui masque le motif `/bot[^/]+/` → `/bot***/`, + test de la fonction de rédaction (pure).

### A3. Suite du registre indicateurs
- Nouveau `packages/indicators/src/registry.test.ts` : compte total = 150 (échouera à chaque ajout non compté — c'est voulu, il documente), unicité des `id`, chaque def a `category` valide et ≥ 1 output. (Suggestion revue finale ZKDJ : le compte ne vit aujourd'hui que dans un commentaire.)
- Commentaires de zones du registry (`— trend (27) —`, etc.) : corriger les comptes ou retirer les nombres (choix : retirer les nombres, ils re-périment à chaque ajout ; garder les noms de zones).
- Déménager `src/volume/cvd.ts` → `src/orderflow/cvd.ts` (cohérence dossier/catégorie relevée par 2 revues ; import registry + test déplacé ; AUCUN changement de code).
- Mettre à jour le commentaire d'en-tête d'imports « fichiers sous volume/ » (devenu inexact).

### A4. UX honnêteté cvdSpotPerp
- Timeframes sans jambe perp (sub-minute, 3M/6M/12M) : aujourd'hui CVD spot seul sans explication. Fix minimal dans le def : quand `ctx.aux.perpDelta` est absent ALORS que les bougies ont des données taker, ajouter un output texte n'est pas possible (contrat) → solution retenue : documenter dans le TOOLTIP du menu Indicateurs (champ description du def, lu par l'UI) : « Jambe perp : timeframes 1m-1M uniquement (Binance USDT-M) ; ailleurs, CVD spot seul » + une ligne sur l'échelle (« séries normalisées en écarts-types de flux — lire les croisements et le signe de l'histogramme, pas les niveaux »). Vérifier que l'UI menu affiche bien la description ; si non, l'ajouter au panneau de réglages de l'indicateur est HORS périmètre (noter seulement).

## Branche 2 — `chore/omon-extraction-ivrank`

### A2. Extraction des fonctions de dessin d'OptionsWindow (demande explicite de la revue finale v1.2)
- `OptionsWindow.tsx` (1693 lignes) → extraire les 4 fonctions de dessin pures-canvas (`dessinerSmile`, `dessinerBarres`, `dessinerHeatmapOi`, `dessinerTermIv`, ~600 lignes sans état React) + leurs constantes de padding partagées vers `apps/web/src/components/omon/dessins.ts`. ZÉRO changement de comportement — pur déplacement + imports. Les tests existants (aucun sur le rendu) et la suite complète restent verts ; le typecheck garantit les signatures.

### C1. IV Rank (DVOL percentile)
- Le store regime fetch déjà l'historique DVOL 90 j (`referentiels.ts:126`). Nouveau calcul pur `ivRank(dvolHistorique, dvolCourant)` → percentile 0-100 (même sémantique min-max que cotIndex ? NON — ici percentile-rank classique convient : position du DVOL courant dans la distribution 90 j ; préciser : rang strict / n). `null` si < 30 points.
- Affichage : métrique « IV Rank (90 j) » dans l'en-tête de la vue Smile OMON, à côté de DVOL, teintée `--down` si ≥ 80 (vol chère), `--up` si ≤ 20 (vol bon marché), neutre sinon. Tooltip natif : « percentile du DVOL sur 90 j ».
- Réutiliser la série du référentiel (cache TTL existant) — zéro fetch nouveau.

## Branche 3 — `feat/cbprem` (Coinbase premium)

- **But** : gap % spot Coinbase vs Binance (BTC-USD vs BTCUSDT), le signal « institutionnels US achètent » classique.
- **Fenêtre** `id:"cbprem"`, mnémonique `CBPREM`, `nouveau:true`, WINDOW_REGISTRY + lazy + windowPanels (patron SQZ exact).
- **Données** : klines 1h ~30 j des deux venues via les adapters EXISTANTS (Coinbase et Binance sont dans le sélecteur d'exchange — réutiliser leur fetch klines, pas de nouvelle URL si possible). Calcul pur `serieCbprem(klinesCb, klinesBn)` → `{ t, premiumPct }[]` alignés par openTime (points non appariés omis) ; premium = (closeCb − closeBn)/closeBn × 100.
- **Rendu** : ligne du premium 30 j (canvas patron CorrWindow), zéro matérialisé, remplissage léger up/down selon signe ; en-tête : premium courant (badge teinté), moyenne 7 j, z-score 30 j ; `NoteSource` (Coinbase + Binance, 1h) ; bouton Rafraîchir, run à l'ouverture, pas de polling continu.
- BTC par défaut, bascule BTC/ETH (`Segmente`).
- Cas limites : venue en panne → `ErreurBloc` avec repli sur données déjà chargées (patron SQZ v1.1) ; paires manquantes → message.

## Contraintes globales (les trois branches)

Français ; TDD sur toute logique pure ; tokens couleur ; dégradation gracieuse ; `git -C` systématique ; gates : suites + tsc verts par branche, revue par tâche + revue finale, gate visuel CBPREM/IV Rank, non-régression visuelle OMON après extraction (4 vues identiques).
