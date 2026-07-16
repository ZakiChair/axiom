# Backlog issu du Lot A « fondations durcies » (2026-07-16)

Findings Minor tracés par les reviews du lot (aucun bloquant — triés par la review finale).
Source : revue UI v2 (`docs/superpowers/audits/2026-07-16-revue-ui-v2.md`) + reviews de tâches.

## Garde-fous (priorité)
- **Test d'unicité des mnémoniques : 3/19 sources couvertes** (registry.test.ts) — étendre aux
  sources externes restantes (eco, news, portfolio, dom, playbooks…). Sonde ponctuelle : 220
  commandes, 0 doublon. Le plus gros trou restant de la spec §8.
- Allowlist anti-hex ligne-scopée (gardeFous.test.ts) : un hex de dérive co-localisé avec
  `lireTokenCanvas` sur la même ligne passerait — durcissement par expression possible.
- `fichiersTs` des garde-fous non récursif : si `chart/`/`components/` gagnent des sous-dossiers,
  les étendre (ou asserter l'absence de sous-dossiers).

## Doc sweep (commentaires périmés, 1 commit)
- liquidationHeat.ts l.~1327/1417/1439/1549 : la couche EST est dite « orange » (faux sur bloomberg).
- ChartInstance.tsx:565 : « sous-panes OI/FUND » → FRATE.
- Docstring MenuDeroulant (ui.tsx) : chevron désormais conditionnel.
- Export `commandes` MORT dans FundWindow.tsx:62-67 (id dédupliqué, inerte) : à supprimer.

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
