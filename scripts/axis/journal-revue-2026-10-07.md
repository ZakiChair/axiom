# Journal de revue — campagne de backtest AXIS (7 octobre 2026)

Revue indépendante du protocole et du runner AVANT tout calcul AXIS sur
données de marché (règle du projet : « Backtest / math / drawdown /
expectancy → Réviseur »). Revue sur lecture + exécutions sur données
SYNTHÉTIQUES uniquement (60 séries ; 0 écart moteur/rejeu, causalité, warmup,
prixSignal). Verdict de la revue : **réserves** — un bloquant, un majeur, six
mineurs ; aucun défaut capable de fabriquer un FAVORABLE à tort.

- Manifeste figé : `manifeste-2026-10-07.json`, SHA-256
  `a516571bace590b838c2811d831daaba1ff772122ed7ecda63743c585f63bf0f` (inchangé).
- Runner relu : `scripts/valider-axis.ts`, SHA-256 avant corrections
  `8c40c945…2667983`, après corrections `043a498e…96cddd`. Le manifeste ne
  fige pas le runner (il ne peut pas contenir son propre hash) : son hash est
  enregistré dans chaque résultat (`code.runnerSha256`).

## Corrections appliquées au runner (le manifeste est resté figé)

- **B1 (bloquant)** — Un écart de contrôle était absorbé en cellule
  « indisponible » et le rapport affirmait « contrôles bloquants passés »,
  contre le manifeste (« en cas d'écart : arrêt sans verdict »). Désormais :
  `EcartControle`, relancée par `cellule`, interceptée dans `main` → trace
  JSON (`verdict: null`, `arret: "ecart-controle"`), aucun rapport, sortie 1.
- **M1 (majeur)** — W2 n'avait aucun contrôle de chronologie (et
  `controlerCouts` pouvait y passer à vide). Désormais : rejeu filtré sur les
  décisions d'entrée `>= warmup − 1` (fill à l'open de la première bougie
  évaluée), `controlerChronologie` appliqué à chaque seuil sur W2 aussi.
- **m1** — Le détail des blocs C3 affiche les trades fermés et signale tout
  seuil atteint seulement grâce à la liquidation de fin de données (le
  comptage figé, hérité du runner OOS, n'a pas changé).
- **m2** — W1 vérifie ses bornes exactes (début, dernière clôture) comme W2 ;
  la cohérence `closeTime + 1 = time + tfMs` est exigée au téléchargement.
- **m3** — La série est validée AVANT l'écriture du cache.
- **m4** — Un code différent du figeage refuse la campagne avant le premier
  fetch (testé : modification temporaire d'`engine.ts` → refus, exit 1,
  fichier restauré à l'identique). Le hash du runner est affiché dans le
  rapport. Les cœurs d'AXIS (supertrend, adx, macd, rsi, cmf, moteur
  d'indicateurs, registre) ne font PAS partie de la liste figée — journalisé
  ici et dans le rapport.
- **m5** — Libellés : « Gagnants % (PnL ≥ 0) » au rejeu / « (PnL > 0) » à
  l'exécution, « Frais USDT (hors slippage) », signes des DD explicités ;
  profit factor `∞` affiché quand aucune perte.
- **m6** — `controlerAffichage` est un miroir complet de la logique `ref`
  (épisode initial silencieux et maintien du prix compris), à chaque seuil ;
  `controlerChronologie` compare le trade ouvert en sens ET indice d'entrée.

## Fumée du runner corrigé (données synthétiques, cache pré-semé, hors ligne)

8 séries aux bornes exactes (W1 : 18 180 / 4 545 bougies ; W2 : 1 880 / 620) ;
24 blocs produits ; chronologies NON VACUES comparées sans écart (ex. BTCUSDT
1h : 73 trades de rejeu, 74 à l'exécution dont 1 fin-données) ; verdict
synthétique NON CONCLUANT cohérent (cellules W2 sous 30 trades). Cache et
sorties synthétiques supprimés avant la campagne réelle.

## Faiblesses du protocole FIGÉ (constats du réviseur, journalisés sans modification)

- **P1 (majeur)** — C3 manque de puissance sur 4h : ~420 bougies de fenêtre,
  AXIS ne tradant que par épisodes, les cellules 4h resteront probablement
  sous 30 trades → « insuffisant ». FAVORABLE est donc quasiment
  inatteignable ; les issues réalistes sont DÉFAVORABLE et NON CONCLUANT. Un
  NON CONCLUANT ne doit pas se lire comme « presque favorable ».
- **P2 (majeur)** — W2 n'est pas un holdout vierge : ~60 % de chevauchement
  avec la fenêtre OOS du 2026-09-09, dont les résultats (dont Supertrend
  10 ×3, cœur d'AXIS) étaient connus avant la conception d'AXIS ; l'absence
  de consultation d'AXIS pendant le développement n'est pas attestable.
- **P3 (mineur, biais favorable)** — C2 n'est exigé qu'au coût x1 (0,05 % par
  côté), sous le tarif taker courant de Binance Spot ; shorts sans coût
  d'emprunt.
- **P4 (mineur)** — Asymétrie : en C1/C2 un seul trade négatif peut faire
  échec ; en C3 une cellule sous 30 trades à expectancy négative n'est
  qu'« insuffisante » (pousse vers NON CONCLUANT plutôt que DÉFAVORABLE).

P1–P4 sont rappelés dans la section « Limites » du rapport de campagne.
