# 2026-09-14 — Chantier « indicateurs gratuits vérifiés » : rapport

Demande du propriétaire : « Vois-tu de nouveaux indicateurs gratuits et fonctions
on-chain, analyse précise du prix, à ajouter ? », puis « Go pour tous les lots »,
avec les points a à d et les trois correctifs. Plan et contrat :
`docs/superpowers/plans/2026-09-14-indicateurs-gratuits.md` et exception G100 de
`BUILD-CONTRACT.md` (`bd72cde`).

Méthode : 45 candidats sondés par requêtes HTTP réelles sans clé, chaque endpoint
re-sondé et chaque lecture recalculée par un vérificateur indépendant ; les
modèles populaires sans effet démontré (Pi Cycle Top, Golden Ratio, FVG,
BOS/CHoCH, Metcalfe, opening range NY) écartés sur preuve. Six couloirs en
worktrees (`chart`, `omon`, `cycle`, `term`, `chain`, `des`), test qui échoue
d'abord, revue indépendante par couloir, intégration linéaire sur `main`.

## Lots livrés

| Lot | Contenu | Commits |
|---|---|---|
| 4 | Niveaux clés périodiques sur le chart maître (veille, semaine, mois, ouvertures J/S/M/T) ; clic droit → alerte accrochée au niveau exact | `21eef65` |
| 3 | Niveaux d'options Deribit : murs γ, deux flips libellés distinctement, max pain de l'échéance dominante | `ae6eb07` |
| 1-chart | Bandes implicites ±1σ/±2σ jour et semaine du DVOL Deribit, ancrées à l'ouverture UTC/lundi avec l'IV observée à l'ancre ; calibration affichée (78,0 % des clôtures jour dans ±1σ sur 998 jours, 76,8 % des semaines) | `a565890` |
| c-chart | Ligne « Coût Strategy » (coût moyen des trésoreries CoinGecko) sur le chart maître | `08f8d41` |
| 1-OMON | Mouvement attendu par échéance : straddle ATM au forward, ±1σ IV, dans Term IV | `a0dad04` |
| 8 | Vol forward entre échéances consécutives (variance additive) et move implicite d'événement ECO | `df10e1a` |
| 7 | Probabilités implicites P(clôture > K à T) (Breeden-Litzenberger centré) et P(toucher) en infobulle, vue Smile | `094397a` |
| 2 | Options IBIT et ETHA (CBOE, différé ~15 min) : GEX/DEX, murs, P/C, convertis en niveaux BTC/ETH au dernier échange Binance | `380d4c0` |
| 9 | Portage excédentaire : basis des futures datés Deribit − T-bill US (BEY converti act/365), courbe, tuile à maturité constante 90 j | `da9b579` |
| A+B | Sommet d'un cycle passé cherché avant son creux baissier ; repli Coin Metrics `CapMVRVCur` retiré de CYCLE, mention « embargo 7 j » | `2abcad1` |
| 5 | Distance à l'ATH alignée sur le pic, comparée au même J+N des cycles passés | `82e4efc` |
| 6 | Modèles de prix : multiple 200 semaines, prix / SMA 2 ans, Pi Cycle Bottom (calculés dans le store) | `c0243ee` |
| b | Flux nets BTC des exchanges via Coin Metrics community (`FlowInExNtv`/`FlowOutExNtv`, sondés sans clé depuis 2011-04-24) : nets 1/7/30 j et z-score, « labels Coin Metrics » ; la réserve n'est pas affichée (dérive du périmètre d'adresses) | `733bcff` |
| a | Réseau ETH via Coin Metrics community (un seul fetch, section multi-source, statut « flash » signalé) | `b752db5` |
| c | Trésoreries d'entreprises BTC via CoinGecko : un appel, cache 6 h, coalescence, repli périmé, prix de revient et sensibilité | `d1d897f` `edf6119` |
| d | OI des perps DEX (DefiLlama, catégorie Derivatives) : record et variations à périmètre constant, écart ≈ +29 % avec l'API Hyperliquid affiché | `fcda195` |
| C | En-tête de `coinmetrics.ts` corrigé (ETH servi en community) ; correction du rapport du lot on-chain | `bd72cde` `6cdaa8c` |

Invariants tenus : **39 fenêtres, 189 indicateurs, 9 identifiants de marché,
`@axiom/types` inchangé, aucune dépendance, aucun hôte nouveau, aucune
modification de `vercel.json`, `api/*`, `shared/extapi-hosts.ts`.** Toute la
logique nouvelle vit dans des chunks chargés à la demande.

## Revues indépendantes (un relecteur par couloir)

| Couloir | Commit | Points corrigés |
|---|---|---|
| chart | `7e3a3f8` | niveaux clés jamais muets après un succès ; bougie du jour absente réessayée ; toast sur les familles choisies |
| omon | `3928ccd` `9f79e43` `86e4714` | P(toucher) ancrée sur le prix courant, tests discriminants ; échéance CBOE par défaut = première non expirée à 16:00 New York (la du jour aux gammas résiduels est signalée, plus choisie) |
| cycle | `6edaaac` | tableau non tronqué, note Pi conditionnelle, sommet en UTC, EMA fixée, état mort retiré |
| term | `1f744ae` | T-bill plat au-delà du dernier nœud de la courbe ; note du repli Binance |
| chain | `d8d9c8b` | cache ETH resservi avant le délai CHAIN ; Strategy absente et motif d'échec CoinGecko explicités |
| des | `6dfee2e` | Δ7j/Δ30j recalculés à périmètre constant ; observation de plus de 2 jours marquée périmée |

## Contrôle navigateur sur données réelles → finitions (`b241b48`)

Le passage Chrome sur le serveur de dev a produit quatre corrections, intégrées
en tête de `main` le 15/09 :

- **Vol forward** : une fenêtre finissant après la couverture du calendrier ECO
  chargé (dernier événement daté par ForexFactory ou FRED ; les dates FOMC
  statiques vont plus loin mais seules) est marquée « calendrier non couvert » :
  absence d'événement non vérifiée, donc ni part d'événement ni place dans
  σ base ; la fin de couverture est affichée dans la note de la vue.
- **GEX/DEX** : étiquettes Y dédupliquées quand deux graduations se chevauchent
  (le zéro trop proche d'une borne n'est plus écrit par-dessus).
- **Coût Strategy** : après un échec de relecture CoinGecko, la dernière ligne
  reste affichée, suffixée « (conservée du \<date de récupération\>) » et
  annoncée par le toast, au lieu d'être muette.
- **OI perps DEX** : commentaire `observation` précisé (jour en cours actualisé
  ou jour antérieur, périmé au-delà de 2 jours).

## Preuves

- `bash scripts/ci.sh` sur l'arbre intégré (`b241b48` + `6cdaa8c`) : typecheck ;
  **6 502 tests unitaires** (indicateurs 1 376, alertes 76, backtest 103,
  daemon 519, web 4 428) ; build web vert.
- Budget JS initial bloquant : **1 214 933 octets bruts / 358 318 gzip** pour
  1 220 000 / 360 000, marge restante 5 067 bruts / 1 682 gzip. Mesure de départ
  1 210 751 / 356 821 : le chantier a consommé **4 182 bruts / 1 497 gzip** dans
  le chemin d'entrée (allocation : chart ≤ 2 000 gzip, omon/cycle/chain ≤ 150
  chacun, term/des 0). Bundler Vercel : 1 211 155 / 356 940.
- `pnpm check:e2e` : **73 parcours hermétiques verts** en 1,7 min, dont les cinq
  parcours du chantier (`niveaux-chart`, `omon-lectures-options`, `revue-cycle`,
  `term-portage-tbill`, `des-oi-perps-dex`) ajoutés à `scripts/ci.sh` par
  `ecb7d66`.
- Push : `3ba65fb..6cdaa8c` sur `origin/main` (29 commits du chantier et des
  jours précédents).
- Déploiement Vercel prébuilt production : `vercel pull --environment=production`,
  `vercel build --prod`, `vercel deploy --prebuilt --prod` → Ready en 13 s,
  aliased [axiom-iota-vert.vercel.app](https://axiom-iota-vert.vercel.app) ;
  alias HTTP 200, script d'entrée servi `index-CVrI36wC.js` **identique** au
  build local.
- Run GitHub Actions du push : `34931437837`, **succès** en 4 min 10 s
  (typecheck, tests, build et budget, 73 parcours hermétiques) — la marge gzip
  de 1 682 octets a tenu malgré le ~1,4 ko que le zlib Linux ajoute à la mesure
  macOS (point de vigilance consigné dans le rapport des résidus du 14/09).

## Limites connues

- Mouvement attendu, probabilités implicites et vol forward : mesures
  **risque-neutres** (prime de variance incluse), pas des prévisions ; les bandes
  implicites sont libellées « amplitude payée par les options, pas une borne ».
- Options IBIT/ETHA : différées ~15 min, marché US fermé nuits et week-ends ;
  conversion en prix BTC/ETH au `last_trade_time` de la bougie Binance 1 min.
- Trésoreries : avoirs déclaratifs **non horodatés** (badge « partiel »
  permanent) ; coût moyen historique, pas un seuil de liquidation.
- Coin Metrics community : données « flash » révisables ; la **réserve** BTC des
  exchanges n'est volontairement pas affichée (dérive ≈ +200 k BTC en 90 jours du
  périmètre d'adresses) — seuls les flux sont exposés.
- OI perps DEX : tous actifs de la catégorie Derivatives DefiLlama, compté
  ≈ +29 % au-dessus de l'API Hyperliquid (limite affichée dans la section) ;
  pas d'alerte associée.
- Portage excédentaire : échéances < 7 j exclues ; taux simple act/365 des deux
  côtés ; repli sur l'année N−1 quand le CSV Trésor de l'année courante est vide.
- Le contrôle navigateur a été fait sur le serveur de dev ; le déploiement de
  production n'a été vérifié que par requêtes HTTP (alias, script d'entrée), pas
  rejoué dans Chrome.
