# 2026-09-21 — Volume piégé corrigé, bulles LIQBUL, source Hyperliquid partielle

Demande du propriétaire : « les chiffres des shorts et longs piégés semblent totalement
incohérents sur BTC et d'autres actifs, regarde où est le souci ; de plus j'aimerais que la
source d'info sur les liquidations provienne d'Hyperliquid et que tu intègres une façon lisible
et belle de les intégrer dans le graphique ». Plan de la source :
`docs/superpowers/plans/2026-09-21-liquidations-hyperliquid.md`. Amendement du contrat :
`BUILD-CONTRACT.md`, « Corrections et extension demandées le 21 septembre 2026 ».

## Diagnostic du « souci » (volume piégé)

Mesuré sur BTCUSDT 15m, fenêtre 96 : au plus haut 24 h, « Longs piégés : 3 BTC / Shorts
piégés : −24 365 BTC » = 100 % du volume de la fenêtre déclaré « shorts piégés » ; sauts de plus
de 30 % entre deux barres sur 127 barres sur 300. Cause : le volume TOTAL de chaque bougie était
distribué de part et d'autre du close courant — or chaque trade a un acheteur ET un vendeur.
Correctif (`59452a2`) : volume AGRESSIF seulement (`buyVolume` au nord, `sellVolume` au sud),
`undefined` sans split, UNUSABLE hors Binance, couleurs sémantiques `--down`/`--up`.

## Rendu (`c7c254f`)

Bulles de clusters (une par cellule bougie × prix ≥ P70, rayon ∝ √USD, côté dominant, pilules
USD sur les 4 plus grosses) dans le contrôleur de heatmap déjà chargé à la demande ; bascule
`bulles` persistée (défaut ON), commande ⌘K `LIQBUL`, bouton « Bulles » de la fenêtre LIQ.
Capture de revue `/tmp/axiom-captures/trapped.png` : rouge `--down` au-dessus de zéro, vert
`--up` en-dessous, valeurs finies (analyse pixels du pane).

## Source Hyperliquid — décision et faits vérifiés

Trois options présentées (fournisseur tiers à clé / minage officiel partiel / statu quo) ;
**minage officiel partiel retenu**. Faits vérifiés sur l'API le 2026-09-21 :

- aucun flux public de liquidations ; `WsFill.liquidation` sur les fills des adresses
  impliquées seulement ;
- vault HLP Liquidator `0x2e3d94f0562703b25c83308a05046ddaf9a8dd14` (`vaultDetails` : enfant de
  HLP, « liquidates positions on all coins as soon as they become liquidatable ») ; ses 2 000
  derniers fills (mai → août) ne portent que 2 liquidations `backstop` — le backstop est rare,
  le vault est suivi pour l'exhaustivité de la méthode, pas pour le volume ;
- fill du liquidé lui-même (`0xcb02…1f8b`, HMSTR, `side B`, `dir "Close Short"`,
  `liquidation.liquidatedUser` = lui-même) → convention « liquidé lui-même : B → short »
  confirmée ; fill du vault (`side A`, contrepartie) → « contrepartie : A → short » confirmée ;
- limites HL : 10 utilisateurs uniques par IP sur les souscriptions WS par utilisateur → 9 makers
  + vault.

## Preuve réelle (daemon local, 2026-09-21)

- `/health` à ~4 min puis ~9,4 min : `collecteurs.liquidations.hyperliquid = { dernierMessageTs:
  récent, derniereErreur: null, partiel: true, adressesSuivies: 10, couverture ≈ 0,48–0,50,
  derniereLiqTs: 0 }` — la 10e souscription est acceptée, aucun `channel:"error"`.
- `GET /liquidations/BTCUSDT?venue=hyperliquid` → `[]` sur ~10 min (aucune liquidation HL sur
  BTC/ETH/SOL dans l'intervalle — sporadique, pas un défaut) ; `venue=BAD!!` ignoré.
- Fenêtre LIQ (Vite :5173, Playwright) : ligne « Hyperliquid : 10 adresses suivies · couverture
  ≈ 48 % du flux makers · différé ≤ 30 s » lue dans le DOM (`/tmp/axiom-captures/hl-fenetre.png`).
- Limite de l'environnement de preuve : les WS directs Bybit/OKX étaient bloqués côté
  navigateur, donc aucune bulle réelle capturée ce jour — le rendu des bulles est couvert par
  les tests purs (`bullesDepuisGrille`) et le chemin d'ingestion HL par le test d'intégration
  WS factice (`hlLiqFeed.test.ts`).

## Vérifications

- `pnpm check` vert : indicators 1 425, alerts 76, backtest 109, daemon 658 (+26 HL), web 4 730.
- Budget d'entrée : 356 432 → **356 979 / 360 000 octets gzip** (+547 pour le poll HL et la
  santé partielle dans le chemin d'entrée) — marge 3 021, **au seuil de vigilance I11** : le
  prochain lot touchant le chemin d'entrée doit d'abord libérer des octets.

## Limites à ne pas masquer

- Couverture ≈ 50 % du flux makers mesuré, pas un taux de capture garanti ; les liquidations
  dont la contrepartie n'est pas suivie sont invisibles.
- Différé ≤ 30 s côté front (poll), ingestion immédiate côté daemon.
- Indisponible sans daemon (Vercel) ; la fenêtre n'affiche alors aucune ligne HL.
- Un `channel:"error"` HL (ex. coin sans perp HL) reste affiché dans la ligne d'honnêteté jusqu'à
  la prochaine insertion réussie — comportement voulu (l'erreur est vraie), à connaître.
