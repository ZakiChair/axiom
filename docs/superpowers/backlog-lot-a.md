# Backlog issu du Lot A « fondations durcies » (2026-07-16)

Findings Minor tracés par les reviews du lot (aucun bloquant — triés par la review finale).
Source : revue UI v2 (`docs/superpowers/audits/2026-07-16-revue-ui-v2.md`) + reviews de tâches.

## Reporté (décision documentée)
- GlobeWindow : substitution serie-5/serie-4 locale au composant (la remonter dans les tokens
  exigerait de redéfinir --serie-4 du thème dark pour tous ses consommateurs — risque > gain).

## Résolu (2026-07-22)
- Test d'unicité des mnémoniques étendu à 22 sources (`45bde7f`) — reste la limite « inline »
  ci-dessus.
- Doc sweep intégral : commentaires EST/FRATE/compteurs + export mort FundWindow (`58548b5`) ;
  la docstring MenuDeroulant avait déjà été corrigée en amont (chevron conditionnel documenté).

## Résolu (2026-07-23) — purge finale du lot
- Garde-fous : allowlist hex scopée à l'expression (strip des appels/replis/commentaires avant
  scan), `fichiersTs` récursif, verrou des mnémoniques inline par scan des sources App/Toolbar.
- UX/a11y (10 items) : « confirmer ? » PORT/ALRT (visible en état armé + aria-label armé) ;
  ⚙ Watchlist (prop `ariaLabel` de MenuDeroulant) ; aide « ? » en labels longs
  (`CATEGORIE_LABEL_LONG`) ; priceAlertMenu format signé pour niveau ≤ 0 (échelle %) ;
  CVD précision adaptative (`precisionCvd`, 0/2/4 décimales selon amplitude) ; Metric
  min-w-0/flex-wrap ; CorrWindow sur primitive Segmente (élargie à `string | number`) ;
  tuiles OI DERIV en --serie-5 (alignées sur la courbe de pane) ; wording toast « L » aligné
  sur la garde réelle ; `timeframePourCode` filtre Shift+symbole (QWERTY) sans casser AZERTY.
