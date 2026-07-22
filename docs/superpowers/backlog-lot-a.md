# Backlog issu du Lot A « fondations durcies » (2026-07-16)

Findings Minor tracés par les reviews du lot (aucun bloquant — triés par la review finale).
Source : revue UI v2 (`docs/superpowers/audits/2026-07-16-revue-ui-v2.md`) + reviews de tâches.

## Garde-fous (priorité)
- Allowlist anti-hex ligne-scopée (gardeFous.test.ts) : un hex de dérive co-localisé avec
  `lireTokenCanvas` sur la même ligne passerait — durcissement par expression possible.
- `fichiersTs` des garde-fous non récursif : si `chart/`/`components/` gagnent des sous-dossiers,
  les étendre (ou asserter l'absence de sous-dossiers).
- Unicité mnémoniques : les commandes INLINE de App.tsx (GRID*) et Toolbar.tsx (WS/BACKUP/
  RESTORE) ne sont couvertes que par un miroir statique dans registry.test.ts — une nouvelle
  commande inline ajoutée à ces deux composants échapperait au test (limite documentée).

## UX/a11y (non bloquants)
- Bouton « confirmer ? » (PORT/ALRT) peut redevenir invisible hors survol (opacity group-hover) ;
  aria-label inchangé en état armé.
- Watchlist ⚙ : aria-label remplacé par title (primitive MenuDeroulant).
- Libellés de catégorie de l'aide « ? » en clé courte (« tf : », « panneau : ») — second mapping
  de labels longs à prévoir.
- priceAlertMenu : libellé « — » si clic en échelle percentage avec valeur ≤ 0 (alerte correcte).
- CVD `precision: 0` : illisible si |CVD| < 1 (paires à très petit volume).
- Metric partagé : libellé sans min-w-0/flex-wrap (débordement label+badge longs possibles).
- CorrWindow : couture visuelle Segmente ↔ groupe manuel 30/90/180 (ids number) ; extension de
  primitive (ids non-string, className) si souhaité.
- DerivativesWindow : tuile OI Coinalyze en --serie-1 vs courbe de pane --serie-5 (le toggle est
  cohérent) — harmonisation possible.
- Wording toast « L » : « perp Bybit/OKX requis » vs garde réelle (pas tradfi/synthétique).
- timeframePourCode ne filtre pas Shift : Shift+5 change le TF sur QWERTY (contrepartie du fix AZERTY).

## Reporté (décision documentée)
- GlobeWindow : substitution serie-5/serie-4 locale au composant (la remonter dans les tokens
  exigerait de redéfinir --serie-4 du thème dark pour tous ses consommateurs — risque > gain).

## Résolu (2026-07-22)
- Test d'unicité des mnémoniques étendu à 22 sources (`45bde7f`) — reste la limite « inline »
  ci-dessus.
- Doc sweep intégral : commentaires EST/FRATE/compteurs + export mort FundWindow (`58548b5`) ;
  la docstring MenuDeroulant avait déjà été corrigée en amont (chevron conditionnel documenté).
