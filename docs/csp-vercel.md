# CSP du déploiement Vercel — rationnel et procédure de bascule

`vercel.json` est du JSON strict validé contre le schéma Vercel : aucun commentaire n'y est
possible, et une clé `_comment` risquerait de faire rejeter le déploiement. Ce fichier est
donc le foyer du rationnel de l'en-tête `Content-Security-Policy-Report-Only` posée le
2026-09-02.

## Pourquoi une CSP

Le front déployé détient dans le `localStorage` du navigateur les **neuf clés personnelles**
saisies dans Réglages (Coinalyze, Twelve Data, FRED, BGeometrics, Finnhub, CoinDesk Data,
CoinGecko Demo, Etherscan, SoSoValue). Aucune n'est un secret partagé côté serveur — c'est le
choix mono-utilisateur du contrat — mais une injection de script sur la page les exfiltrerait
toutes. La CSP est la seule barrière qui reste à ce niveau.

## Pourquoi Report-Only, délibérément

Le mode bloquant sur une application à 39 fenêtres, deux workers, un canvas de chart, un
globe et une dizaine de préfixes de proxy casserait des surfaces sans prévenir, et le gate
G100 n'a toujours pas de verdict. `Report-Only` donne la même observation sans aucun risque
de régression.

Conséquence à connaître : sans directive `report-uri` ni `report-to`, **les violations
n'apparaissent que dans la console DevTools**, en lignes préfixées `[Report Only]`. Il n'y a
pas de collecte côté serveur.

`frame-ancestors` est ignoré en Report-Only. Il est conservé dans la politique pour être
actif dès la bascule.

## Avant de passer en bloquant

Exiger une session complète sur le déploiement Vercel, pas en local, avec **zéro violation
rapportée** sur :

- les 39 fenêtres de `WINDOW_REGISTRY`, ouvertes une à une ;
- l'export d'image du chart ;
- les workers screener et backtest, lancés chacun au moins une fois ;
- le globe et le fil d'actualités, qui chargent des ressources tierces ;
- un rechargement complet après vidage du cache navigateur.

La bascule consiste alors à renommer la clé d'en-tête `Content-Security-Policy-Report-Only`
en `Content-Security-Policy` dans `vercel.json`, sans toucher à la valeur.

## Maintenance de la liste `connect-src`

La politique énumère les WebSockets des exchanges et les hôtes appelés en direct. Toute
nouvelle source de données doit être répercutée ici **et** dans `shared/extapi-hosts.ts`
(whitelist du proxy) — les deux listes ont des raisons d'être distinctes et ne peuvent pas
être dérivées l'une de l'autre : `extapi-hosts` autorise le proxy à sortir, la CSP autorise
le navigateur à parler. Un oubli côté CSP se manifestera d'abord comme une ligne
`[Report Only]` en console, et comme une requête bloquée après la bascule.
