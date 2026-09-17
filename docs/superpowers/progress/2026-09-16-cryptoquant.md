# 2026-09-16 — CryptoQuant BASIC : flux takers toutes places (DES) et mineurs cotés (CHAIN)

Demande du propriétaire : « quel indicateur pertinent ajouter à AXIOM grâce à cette clé »
(offre BASIC souscrite), puis « les deux, dans cet ordre, sans nouvelle fenêtre ».
Spec : `docs/superpowers/specs/2026-09-16-cryptoquant-takers-mineurs-design.md`.
Exception consignée dans `BUILD-CONTRACT.md` (« Fournisseur CryptoQuant BASIC », à la fin
de la section « Extension autorisée le 16 septembre 2026 »).

## Décisions actées (2026-09-16)

- Nouveau fournisseur à clé PERSONNELLE, deux familles seulement : flux takers agrégés
  (`/v2/market/cq/{spot,swap}/trade`, `btc_all`/`eth_all`) et production des mineurs cotés
  (`/v1/btc/miner-data/companies`, neuf sociétés). BGeometrics reste la source unique de
  MVRV-Z, SOPR, NUPL et Puell.
- Aucune variable serveur sur Vercel ; repli `CRYPTOQUANT_API_KEY` de `apps/web/.env` pour
  le proxy Vite et le daemon `127.0.0.1` uniquement.
- Route `/cqapi` à liste fermée (`shared/cryptoquant-proxy.ts`) sur les trois chemins :
  GET seul, zéro redirection, `private, no-store`, en-têtes `x-ratelimit-*` relayés, aucune
  entrée de cache daemon.
- Archive côté client (localStorage + KV daemon, union, jamais destructive), aucun
  collecteur daemon ; requêtes toujours `window=day&limit=30`, jamais `from`/`to`.
- Sous-lots : B1 (socle + section DES), puis B2 (sous-section CHAIN).
- Défauts retenus par la spec (§11), contestables à la relecture : court-circuit « J-1
  archivé → zéro appel » et reprise 6 h ; déclenchement au montage de la fenêtre ; archive
  exclue de la sauvegarde JSON ; 401/403 mémorisés en session seulement ; badge Réglages
  sur la clé personnelle seule ; comparaison Binance hors lot.
- La clé collée dans la conversation d'origine est considérée compromise : le propriétaire
  la régénère et la renseigne lui-même ; aucun agent ne la lit.

## Budget JS initial (plafonds 1 220 000 bruts / 360 000 gzip niveau 9)

Chaque mesure est une section de niveau 3 intitulée « Budget » suivie de l'étape (`avant B1`
en B1-0, `après B1-3`, `après B1`, `après B2`, `final`), ajoutée en fin de fichier. Elle
contient une ligne « Commande : … » puis le bloc JSON complet imprimé par
`scripts/verifier-budget-build.mjs`, le script que lance `pnpm --filter @axiom/web build`
(champs `initial.octetsBruts` et `initial.octetsGzip` pour le chemin d'entrée). Le tableau
avant/après est dérivé de ces blocs à la clôture du lot. Mesures locales macOS ; le juge de
paix reste le runner GitHub (marge runner ≈ 3 365 gzip mesurée le 2026-09-16 sur `e14dc03`,
avant trois commits de code hors lot ; estimations à jour sous « Tableau du budget JS initial
(avant/après) »). Seuls les plafonds du script sont bloquants ; delta initial attendu
≤ ~40 octets gzip par sous-lot (nom du chunk partagé du store ajouté à `__vite__mapDeps`),
porte d'acceptation ≤ ~150 octets gzip sur l'ensemble de B1 ; si la marge runner tombait sous
~3 000 gzip, retirer d'abord le libellé DATA.

### Budget avant B1

Commande : `pnpm --filter @axiom/web build` (HEAD `a56700e`, mesure locale macOS, avant toute modification du lot) ; bloc ci-dessous = sortie de `node scripts/verifier-budget-build.mjs apps/web/dist`, le script que lance ce build.

```json
{
  "limites": {
    "octetsBruts": 1220000,
    "octetsGzip": 360000,
    "niveauGzip": 9
  },
  "initial": {
    "fichiers": [
      "assets/index-DmTeO9Y0.js",
      "assets/indicators-DMDb8A8f.js",
      "assets/vendor-klinecharts-B5HFhIGv.js",
      "assets/vendor-react-BPWy1Tn9.js"
    ],
    "octetsBruts": 1206105,
    "octetsGzip": 355595
  },
  "dynamique": {
    "fichiers": [
      "assets/BacktestWindow-DbyEW3vG.js",
      "assets/BriefWindow-sVELzyL7.js",
      "assets/BtcPowerLawWindow-CyBnJaM4.js",
      "assets/CbpremWindow-BhI4b284.js",
      "assets/ChartSyncControls-pR_e9JNo.js",
      "assets/CommandPalette-BDlj_3s4.js",
      "assets/CorrWindow-CBRWQVlo.js",
      "assets/CotWindow-CDnH0UVX.js",
      "assets/CycleWindow-ClUgamZJ.js",
      "assets/DataWindow-BslXSIag.js",
      "assets/DefillamaProPanel-C8nHRhjw.js",
      "assets/DerivativesWindow-BD0gwHNS.js",
      "assets/DistWindow-DoANVMiU.js",
      "assets/DomWindow-BkjYPAPl.js",
      "assets/EcoWindow-CzyQm6x5.js",
      "assets/EconomieChaines-BeeCaH-9.js",
      "assets/EvtsWindow-BmuAGgc-.js",
      "assets/ExpyWindow-BcbioCfW.js",
      "assets/FluxCapitaux-Cq90WZvD.js",
      "assets/FundWindow-BSCcUSBJ.js",
      "assets/FundingMatrixWindow-Cmt_jPVP.js",
      "assets/GlobeWindow-D007Zehk.js",
      "assets/LiquidationsWindow-B_cDzjKB.js",
      "assets/MacroRatesWindow-C689T3yv.js",
      "assets/MarketMapWindow-pe3Y4G5V.js",
      "assets/McapWindow-D6l9QmNS.js",
      "assets/MineWindow-BtM-UZ3v.js",
      "assets/NetliqWindow-DvXqtSY0.js",
      "assets/NewsWindow-n8vJ9I2t.js",
      "assets/NotesWindow-Ck4K7xGB.js",
      "assets/OnboardingOverlay-BqMIpnr1.js",
      "assets/OnchainWindow-yTsb9hdq.js",
      "assets/OptionsWindow-DCPNgvIf.js",
      "assets/PaperWindow-CJSCCSEY.js",
      "assets/PortfolioWindow-DokCuGd-.js",
      "assets/QualiteMetrique-d5OVi0IK.js",
      "assets/ReplayWindow-BEIujnfH.js",
      "assets/ScenWindow-C7LM1ohr.js",
      "assets/ScreenerWindow-aDcmyUca.js",
      "assets/SeasonalityWindow-BFEAStVU.js",
      "assets/SectWindow-Cp4Zo8K5.js",
      "assets/SettingsPanel-DPA2bSPJ.js",
      "assets/SqueezeWindow-CC-YTW3V.js",
      "assets/StablecoinsWindow-BvnDC_-g.js",
      "assets/TableTriable-DJIlKVED.js",
      "assets/TermStructureWindow-Dz7tKWp_.js",
      "assets/VolWindow-DuoY6KUg.js",
      "assets/WebGLSyncSpike-J_GTs7zr.js",
      "assets/WhalesWindow-deKzJxiH.js",
      "assets/bgeometrics-UJFAawjb.js",
      "assets/chart-sync-timeframes-C0GxytVO.js",
      "assets/composite-B0bVibIs.js",
      "assets/corr-D7yyFAyg.js",
      "assets/cot-DmlwnBgZ.js",
      "assets/csv-DChTGBa8.js",
      "assets/defillamaKey-D3Wqzcng.js",
      "assets/economieChaines-i_z13b0v.js",
      "assets/etherscan-BfIN99_w.js",
      "assets/expy-3I9sQwqM.js",
      "assets/fluxCapitaux-DN5UA3cH.js",
      "assets/fundingCrossExchange-fgEsBEKI.js",
      "assets/lienRetours-Bo4sHoSC.js",
      "assets/liquidationHeat-Dpx0lR7F.js",
      "assets/macroSeries-Hx71LxLl.js",
      "assets/mempool-CBcMEsXl.js",
      "assets/onchainMetriques-BpLCbl1P.js",
      "assets/portRisque-D4Ygg2bR.js",
      "assets/qualiteChain-CAJU1msR.js",
      "assets/squeezeWindow.util-BG8Pt5jT.js",
      "assets/thermocap-BH8vCa_r.js",
      "assets/treasuryYields-17bD9nQD.js",
      "assets/treemap-D9x5LE-E.js",
      "assets/tresoreriesBtc-CwhP_zEl.js",
      "assets/useDomaineZoom-Bxy48dSr.js",
      "assets/viewportSync-V8V9ukCI.js",
      "assets/volCone-BZveA2ku.js"
    ],
    "octetsBruts": 981078,
    "octetsGzip": 360141
  }
}
```

### Budget après B1-3

Commande : `pnpm --filter @axiom/web build` (bloc imprimé par `scripts/verifier-budget-build.mjs`, rejoué tel quel sur `apps/web/dist`).

```json
{
  "limites": {
    "octetsBruts": 1220000,
    "octetsGzip": 360000,
    "niveauGzip": 9
  },
  "initial": {
    "fichiers": [
      "assets/index-CvA2TH_T.js",
      "assets/indicators-DMDb8A8f.js",
      "assets/vendor-klinecharts-B5HFhIGv.js",
      "assets/vendor-react-BPWy1Tn9.js"
    ],
    "octetsBruts": 1206170,
    "octetsGzip": 355617
  },
  "dynamique": {
    "fichiers": [
      "assets/BacktestWindow-CflNv483.js",
      "assets/BriefWindow-DFC5CKn9.js",
      "assets/BtcPowerLawWindow-C8klMKe9.js",
      "assets/CbpremWindow-B8XODOWi.js",
      "assets/ChartSyncControls-oQVR8L1O.js",
      "assets/CommandPalette-B43hfLk0.js",
      "assets/CorrWindow-CNWQJ5IE.js",
      "assets/CotWindow-_dnKfv73.js",
      "assets/CycleWindow-CodZoAtS.js",
      "assets/DataWindow-XXbhpPou.js",
      "assets/DefillamaProPanel-C05BKgVY.js",
      "assets/DerivativesWindow-ByaJ-1rZ.js",
      "assets/DistWindow-DqnnKORw.js",
      "assets/DomWindow-aPn0Alt2.js",
      "assets/EcoWindow-CcQpSJPl.js",
      "assets/EconomieChaines-Dhv4deYP.js",
      "assets/EvtsWindow-BijIisDx.js",
      "assets/ExpyWindow-DtHHWtQ-.js",
      "assets/FluxCapitaux-BDp065r4.js",
      "assets/FundWindow-8jxnme6x.js",
      "assets/FundingMatrixWindow-CrgxDUzU.js",
      "assets/GlobeWindow-A-38sQTz.js",
      "assets/LiquidationsWindow-CyyVNsAA.js",
      "assets/MacroRatesWindow-BK-xKifN.js",
      "assets/MarketMapWindow-caYziwBy.js",
      "assets/McapWindow-xYmqmEBd.js",
      "assets/MineWindow-DDg5PzKO.js",
      "assets/NetliqWindow-DdI-Z2Ds.js",
      "assets/NewsWindow-eDnWdYsu.js",
      "assets/NotesWindow-D-3uFRUE.js",
      "assets/OnboardingOverlay-hZxMd3Ci.js",
      "assets/OnchainWindow-DFYSyk74.js",
      "assets/OptionsWindow-DCWhLzPs.js",
      "assets/PaperWindow-CU9P-9Tv.js",
      "assets/PortfolioWindow-BnuPykiV.js",
      "assets/QualiteMetrique-Bo16JgZF.js",
      "assets/ReplayWindow-DzMvZ3j4.js",
      "assets/ScenWindow-BU_FP5tO.js",
      "assets/ScreenerWindow-CvxnoCws.js",
      "assets/SeasonalityWindow-D348crBF.js",
      "assets/SectWindow-OrOkQ8Wc.js",
      "assets/SettingsPanel-D8Gb9ykx.js",
      "assets/SqueezeWindow-MQBWAtyO.js",
      "assets/StablecoinsWindow-cwadWlC2.js",
      "assets/TableTriable-PzR6DNM2.js",
      "assets/TermStructureWindow-C-gPiAMb.js",
      "assets/VolWindow-CBx5DYL5.js",
      "assets/WebGLSyncSpike-C6HAozDd.js",
      "assets/WhalesWindow-DBPAnH_u.js",
      "assets/bgeometrics-CwBfqZAg.js",
      "assets/chart-sync-timeframes-B5x5sK4B.js",
      "assets/composite-ncBiL0v-.js",
      "assets/corr-BeX07IIJ.js",
      "assets/cot-DJDOWYBk.js",
      "assets/csv-DChTGBa8.js",
      "assets/defillamaKey-DNlE8kXN.js",
      "assets/economieChaines-i_z13b0v.js",
      "assets/etherscan-Dgh5-pCF.js",
      "assets/expy-3I9sQwqM.js",
      "assets/fluxCapitaux-BdqS1gUV.js",
      "assets/fundingCrossExchange-CA3IE_fT.js",
      "assets/lienRetours-Bo4sHoSC.js",
      "assets/liquidationHeat-DqdR_9tR.js",
      "assets/macroSeries-Dto5xWah.js",
      "assets/mempool-CKZwIJIZ.js",
      "assets/onchainMetriques-BMNs69Ki.js",
      "assets/portRisque-OTN0j4lY.js",
      "assets/qualiteChain-BpX2QYau.js",
      "assets/squeezeWindow.util-CS38dTmm.js",
      "assets/thermocap-CV1WVS1g.js",
      "assets/treasuryYields-D4QcvnFb.js",
      "assets/treemap-D9x5LE-E.js",
      "assets/tresoreriesBtc-BsTOUFSC.js",
      "assets/useDomaineZoom-Bxy48dSr.js",
      "assets/viewportSync-CDykrb4H.js",
      "assets/volCone-BZveA2ku.js"
    ],
    "octetsBruts": 982093,
    "octetsGzip": 360457
  }
}
```

Store `store/cryptoquant.ts` dans `.vite/manifest.json` : aucun chunk partagé, store inclus dans `assets/SettingsPanel-D8Gb9ykx.js`. Delta initial depuis « Budget avant B1 » : +22 o gzip, +65 o bruts ; marge gzip locale 4383 o.

### Budget après B1

Commande : `set -o pipefail; pnpm --filter @axiom/web build 2>&1 | tee logs/axiom-b1-build.log` (poste local, commit `f40a8ac` de la tâche 15 ; bloc extrait du journal par la tâche 16, étape 5)

```json
{
  "limites": {
    "octetsBruts": 1220000,
    "octetsGzip": 360000,
    "niveauGzip": 9
  },
  "initial": {
    "fichiers": [
      "assets/index-DXzf3wFU.js",
      "assets/indicators-DMDb8A8f.js",
      "assets/vendor-klinecharts-B5HFhIGv.js",
      "assets/vendor-react-BPWy1Tn9.js"
    ],
    "octetsBruts": 1206209,
    "octetsGzip": 355644
  },
  "dynamique": {
    "fichiers": [
      "assets/BacktestWindow-8UetSkBt.js",
      "assets/BriefWindow-CqSWK1II.js",
      "assets/BtcPowerLawWindow-CoEb2WWa.js",
      "assets/CbpremWindow-CagrBimT.js",
      "assets/ChartSyncControls-BuiSnL-M.js",
      "assets/CommandPalette-CNvjeiH-.js",
      "assets/CorrWindow-D4tl2tAP.js",
      "assets/CotWindow-DSsULWzX.js",
      "assets/CycleWindow-BXnI9PT_.js",
      "assets/DataWindow-BRigbTqm.js",
      "assets/DefillamaProPanel-BdI90Knx.js",
      "assets/DerivativesWindow-DKgfpi5o.js",
      "assets/DistWindow-Cd7JbrOh.js",
      "assets/DomWindow-B1TSj2Gj.js",
      "assets/EcoWindow-ClLsyrVG.js",
      "assets/EconomieChaines-C4V0MUR9.js",
      "assets/EvtsWindow-BpmL8dY1.js",
      "assets/ExpyWindow-DJe_NiBR.js",
      "assets/FluxCapitaux-PlWlJ8YY.js",
      "assets/FundWindow-DumAVM04.js",
      "assets/FundingMatrixWindow-dfK8XJAx.js",
      "assets/GlobeWindow-CFtYzsEP.js",
      "assets/LiquidationsWindow-D7wU5568.js",
      "assets/MacroRatesWindow-BvTQQyPz.js",
      "assets/MarketMapWindow-D0xYgSLq.js",
      "assets/McapWindow-BjFgzcVU.js",
      "assets/MineWindow-Cc5mEgro.js",
      "assets/NetliqWindow-BIQgG5Di.js",
      "assets/NewsWindow-6JkQdoEk.js",
      "assets/NotesWindow-Xx_LS_Cp.js",
      "assets/OnboardingOverlay-BSK-GKEl.js",
      "assets/OnchainWindow-BdIB8bYX.js",
      "assets/OptionsWindow-DKsWmYg-.js",
      "assets/PaperWindow-Cjs1MJOK.js",
      "assets/PortfolioWindow-CBlURXjv.js",
      "assets/QualiteMetrique-CTzzcv5x.js",
      "assets/ReplayWindow-D8HmTaEY.js",
      "assets/ScenWindow-C1HQIYld.js",
      "assets/ScreenerWindow-CgvQjbeN.js",
      "assets/SeasonalityWindow-DM1C8QDF.js",
      "assets/SectWindow-DrAqWN3w.js",
      "assets/SettingsPanel-1SnCSMxq.js",
      "assets/SqueezeWindow-C6klttcw.js",
      "assets/StablecoinsWindow-D1e7KS6y.js",
      "assets/TableTriable-C3xzzbxK.js",
      "assets/TermStructureWindow-YXMb5BdO.js",
      "assets/VolWindow-DIAwMNn1.js",
      "assets/WebGLSyncSpike-CuOM8BW1.js",
      "assets/WhalesWindow-CZ-bzKjM.js",
      "assets/bgeometrics-B7-yYyRJ.js",
      "assets/chart-sync-timeframes-ClE3pJ1O.js",
      "assets/composite-DudimCMB.js",
      "assets/corr-Bu44P6VV.js",
      "assets/cot-RL4di_O8.js",
      "assets/cryptoquant-CWb-gmgq.js",
      "assets/cryptoquant-DWizfmto.js",
      "assets/csv-DChTGBa8.js",
      "assets/defillamaKey-DNlpN_t3.js",
      "assets/economieChaines-i_z13b0v.js",
      "assets/etherscan-BjzfDxuR.js",
      "assets/expy-3I9sQwqM.js",
      "assets/fluxCapitaux-C7e3zBhq.js",
      "assets/fundingCrossExchange-Dsg8l63z.js",
      "assets/lienRetours-Bo4sHoSC.js",
      "assets/liquidationHeat-C9RKaXwz.js",
      "assets/macroSeries-XcxPApdP.js",
      "assets/mempool-C3qerS1D.js",
      "assets/onchainMetriques-b18bpRK_.js",
      "assets/portRisque-CJzNYyIN.js",
      "assets/qualiteChain-BnnjF5A2.js",
      "assets/squeezeWindow.util-BqNVn_Xn.js",
      "assets/thermocap-D8tN-A8I.js",
      "assets/treasuryYields-mO6YeKd1.js",
      "assets/treemap-D9x5LE-E.js",
      "assets/tresoreriesBtc-C2pAEgpM.js",
      "assets/useDomaineZoom-Bxy48dSr.js",
      "assets/viewportSync-B4b5tSXQ.js",
      "assets/volCone-BZveA2ku.js"
    ],
    "octetsBruts": 1005687,
    "octetsGzip": 369308
  }
}
```

- Delta initial : +27 gzip / +39 bruts depuis « après B1-3 » (attendu ≤ ~40 gzip : nom du chunk partagé du store dans `__vite__mapDeps`) ; +49 gzip / +104 bruts sur l'ensemble de B1 depuis « avant B1 » (porte d'acceptation ≤ ~150 gzip).
- Marge locale 4356 gzip ; marge runner estimée 3118 gzip (écart runner − local du 2026-09-16 : 356 635 − 355 397 = 1 238, `docs/superpowers/progress/2026-09-16-indicateurs-et-fonctions-revue.md:49` et `:62`). Seules les limites 1220000 bruts / 360000 gzip bloquent le build.
- Chunk partagé du store (`.vite/manifest.json`, importé par DES) : `assets/cryptoquant-DWizfmto.js`.
- Client CryptoQuant : `assets/cryptoquant-CWb-gmgq.js`, entrée dynamique chargée par DES via `import()`, hors du graphe statique de l'entrée ; aucun fichier initial ne contient « Flux takers toutes places » ; garde-fou `apps/web/src/chunkCryptoquant.test.ts` vert.

## Porte locale B1

Commit `57898a2`, base `2d45426` (commit initial de la spec ; la liste inclut la spec amendée et le plan).

Commande : `set -o pipefail; NO_COLOR=1 pnpm check 2>&1 | tee logs/axiom-b1-check.log`

```text
==> [ci] typecheck
==> [ci] test
packages/indicators test:  Test Files  206 passed (206)
packages/indicators test:       Tests  780 passed (780)
packages/alerts test:  Test Files  2 passed (2)
packages/alerts test:       Tests  59 passed (59)
packages/backtest test:  Test Files  4 passed (4)
packages/backtest test:       Tests  95 passed (95)
apps/daemon test:  608 pass
apps/daemon test:  0 fail
apps/daemon test: Ran 608 tests across 32 files. [649.00ms]
apps/web test:  Test Files  339 passed (339)
apps/web test:       Tests  4575 passed (4575)
==> [ci] build @axiom/web
==> [ci] OK
```

Commande : `set -o pipefail; NO_COLOR=1 pnpm check:e2e 2>&1 | tee logs/axiom-b1-e2e.log`

```text
  77 passed (1.7m)
```

Commande : `git log --oneline 2d45426..HEAD`

```text
57898a2 test(e2e): DES flux takers toutes places — montage, archive, 429 et 401 hermétiques
c07eb15 test(budget): garde-fou du client CryptoQuant à la demande et mesure du budget après B1
f40a8ac fix(des): repli d'erreur sur l'import du client taker et libellé honnête sans appel réseau
bff0ffd feat(des): section repliable flux takers toutes places (CryptoQuant) chargée au montage
84e0175 feat(des): modèle pur des flux takers toutes places et classement situer (CryptoQuant)
767df42 fix(cryptoquant): un majTs futur n'empêche plus la reprise 6 h
937d860 fix(cryptoquant): raisonOffre teste la clé sur le message entier avant troncage à 200
7e0ba84 feat(cryptoquant): orchestrateur — court-circuit J-1, reprise 6 h, refus de session, non-fuite de la clé, libellé DATA
1adc077 feat(cryptoquant): file unique 10 req/min, correction x-ratelimit et reprise 429 bornée
5d236b9 feat(cryptoquant): archive locale ∪ KV daemon — lecture tri-état, écriture gardée
ea915d6 feat(cryptoquant): archive par série — fusion non destructive, union, décodage tolérant, trous dérivés
760136d feat(cryptoquant): catalogue des 13 séries et parseur des jours clos
e375e17 feat(cryptoquant): champ de clé CryptoQuant dans les Réglages et budget après B1-3
361dad8 feat(cryptoquant): clé et archives CryptoQuant exclues des sauvegardes JSON
5ce75c2 feat(cryptoquant): store de la clé personnelle et message « clé requise » (sans import data)
e9bb6bc feat(vite): proxy de dev /cqapi — refus locaux, repli .env hors Vercel, réponse privée
fe911c2 feat(daemon): route /cqapi — gestionnaire dédié, repli .env local, quota relayé, jamais en cache
615d9bc feat(vercel): route /cqapi — Bearer personnel seul, liste fermée, zéro redirection, quota relayé
3d66546 feat(shared): liste fermée de la route /cqapi — trois chemins CryptoQuant BASIC, window=day, limit ≤ 30
3bf6298 docs(contrat,csp,rapport): exception CryptoQuant BASIC du 2026-09-16 — clé personnelle, route /cqapi, archive côté client
a56700e docs(plan): corrections du pré-vol — exécution séquentielle, racine du worktree, motifs de synthèse, écarts actés, renvois à la spec §12
39d0a00 docs(plan): plan d'implémentation CryptoQuant BASIC et arbitrages de planification dans la spec
```

Commande : `git diff --stat 2d45426..HEAD`

```text
 BUILD-CONTRACT.md                                  |   55 +-
 api/_policy.ts                                     |   34 +-
 api/proxy.ts                                       |    9 +
 apps/daemon/src/cache.test.ts                      |    7 +
 apps/daemon/src/cryptoquantProxy.test.ts           |  175 +
 apps/daemon/src/env.test.ts                        |   29 +-
 apps/daemon/src/env.ts                             |    6 +
 apps/daemon/src/proxy.test.ts                      |  220 +-
 apps/daemon/src/proxy.ts                           |   76 +
 apps/daemon/src/vercelProxy.redirection.test.ts    |   82 +-
 apps/daemon/src/vercelProxy.test.ts                |  139 +-
 apps/daemon/tsconfig.json                          |    2 +-
 apps/web/.env.example                              |    8 +-
 apps/web/e2e/des-flux-takers.e2e.ts                |  294 +
 apps/web/src/chunkCryptoquant.test.ts              |   91 +
 apps/web/src/components/DerivativesWindow.tsx      |   11 +-
 apps/web/src/components/FluxTakersSection.test.tsx |  388 +
 apps/web/src/components/FluxTakersSection.tsx      |  463 +
 .../components/SettingsPanel.cryptoquant.test.ts   |   47 +
 apps/web/src/components/SettingsPanel.tsx          |   18 +
 apps/web/src/components/fluxTakers.util.test.ts    |  189 +
 apps/web/src/components/fluxTakers.util.ts         |  165 +
 apps/web/src/data/dataCockpit.test.ts              |    6 +
 apps/web/src/data/dataCockpit.ts                   |    1 +
 .../web/src/data/onchain/cryptoquant-fetch.test.ts |  467 +
 apps/web/src/data/onchain/cryptoquant.test.ts      |  120 +
 apps/web/src/data/onchain/cryptoquant.ts           |  625 ++
 apps/web/src/store/cryptoquant.test.ts             |  169 +
 apps/web/src/store/cryptoquant.ts                  |   83 +
 apps/web/src/store/persist.test.ts                 |   56 +
 apps/web/src/store/persist.ts                      |   23 +-
 apps/web/src/viteConfig.test.ts                    |  156 +
 apps/web/tsconfig.json                             |    2 +-
 apps/web/vite.config.ts                            |   76 +
 docs/csp-vercel.md                                 |   16 +-
 .../plans/2026-09-16-cryptoquant-takers-mineurs.md | 8971 ++++++++++++++++++++
 .../superpowers/progress/2026-09-16-cryptoquant.md |  369 +
 ...2026-09-16-cryptoquant-takers-mineurs-design.md |   34 +-
 scripts/ci.sh                                      |    2 +-
 shared/cryptoquant-proxy.ts                        |   71 +
 vercel.json                                        |    8 +
 41 files changed, 13726 insertions(+), 37 deletions(-)
```

## Revue indépendante B1

- Verdict : **ACCEPTÉ**
- Réviseur : Claude Opus 5 (1M context), agent réviseur distinct des développeurs des tâches 1 à 17 (rôle Réviseur, `.devin/provider-rules.md:34` et `:51`)
- Commit revu : `57898a2`, base `2d45426`, le 2026-09-17

### Points contrôlés

Chaque point est conforme, sauf s'il figure sous « Écarts relevés ». Les sorties brutes suivent, dans le même ordre.

| Point | Contrôle |
|---|---|
| A1 | aucun `CRYPTOQUANT_API_KEY` dans `api/` ni `vercel.json` : aucun repli serveur sur Vercel |
| A2 | une seule lecture `env[` dans `api/_policy.ts` |
| A3 | test structurel Vercel identique aux lignes 34-46 d'origine |
| A4 | store de clé dans les composants : imports, `version` dans DES, `hasKey`/`setKey`/`clearKey` dans Réglages, test structurel de la tâche 8 |
| A5 | `getCryptoquantKey` absent de tout fichier non-test hors store et client |
| A6 | tests de fuite (marqueur de clé factice des tâches 6, 7 et 13) présents (store, persist, client) et verts |
| A7 | clé seulement dans l'en-tête `Authorization`, aucun `console.` dans le client |
| A8 | `__CQ_CLE_ENV__` booléen gardé par `isVercelBuild` |
| A9 | e2e : clé en en-tête, absente des URL et de l'archive |
| B1 | tests Bun du module partagé, du daemon et de Vercel verts |
| B2 | tests du proxy de dev Vite verts |
| B3 | liste fermée portée par `shared/cryptoquant-proxy.ts` et appelée par les trois proxys |
| B4 | 401 avant tout fetch, 404 hors liste, 405 `allow: GET`, zéro redirection, `private, no-store`, quotas et corps relayés |
| B5 | aucun cache proxy pour `/cqapi` |
| B6 | `shared/extapi-hosts.ts` et `apps/daemon/src/cache.ts` inchangés |
| B7 | `vercel.json` : deux rewrites avant le repli SPA, CSP inchangée |
| C1 | tests du client et des stores verts (I1 à I8, I10) |
| C2 | écritures gardées, aucun jour supprimé, conflit au `majTs` le plus grand, une clé par série |
| C3 | e2e DES verts : union sans doublon, 429 sans réécriture, 401 en un appel |
| C4 | archive hors sauvegarde JSON (`resteSurLePoste`) |
| C5 | clé exclue des exports (`CLES_CREDENTIALS_LOCALES`) |
| D1 | budget après B1 consigné au format unique, deltas lus, chunk partagé du store nommé |
| D2 | build courant : manifeste sans erreur, client à la demande |
| D3 | garde-fou du chunk et vues verts |
| E1 | lectures fournisseur sans recalcul, spot et perp jamais additionnés, aucune comparaison Binance, jamais « 0 » inventé |
| E2 | BGeometrics seule source de valorisation |
| E3 | ni dépendance, ni `EXCHANGE_IDS`, ni fenêtre |
| E4 | porte locale B1 consignée |

### Commandes lancées

Journal complet : `logs/axiom-b1-revue.log` (journal local non suivi par git : `*.log` est ignoré ; les sorties utiles sont recopiées ci-dessous).

```text
### A1
(code 1)
### A2
api/_policy.ts:1
(code 0)
### A3
(code 0)
### A4
apps/web/src/components/FluxTakersSection.tsx:31:import { cryptoquantKeyStore, messageSansCleCq, RAISON_CLE_CRYPTOQUANT } from "../store/cryptoquant";
apps/web/src/components/FluxTakersSection.tsx:359:  const version = useStore(cryptoquantKeyStore, (s) => s.version);
apps/web/src/components/SettingsPanel.cryptoquant.test.ts:18:    expect(SOURCE).toContain('import { cryptoquantKeyStore } from "../store/cryptoquant";');
apps/web/src/components/SettingsPanel.cryptoquant.test.ts:23:    expect(SOURCE).toContain("useStore(cryptoquantKeyStore, (s) => s.hasKey)");
apps/web/src/components/SettingsPanel.cryptoquant.test.ts:24:    expect(SOURCE).toContain("useStore(cryptoquantKeyStore, (s) => s.setKey)");
apps/web/src/components/SettingsPanel.cryptoquant.test.ts:25:    expect(SOURCE).toContain("useStore(cryptoquantKeyStore, (s) => s.clearKey)");
apps/web/src/components/SettingsPanel.cryptoquant.test.ts:26:    expect(SOURCE).not.toContain("getCryptoquantKey");
apps/web/src/components/SettingsPanel.tsx:31:import { cryptoquantKeyStore } from "../store/cryptoquant";
apps/web/src/components/SettingsPanel.tsx:528:  const cryptoquantHasKey = useStore(cryptoquantKeyStore, (s) => s.hasKey);
apps/web/src/components/SettingsPanel.tsx:529:  const cryptoquantSetKey = useStore(cryptoquantKeyStore, (s) => s.setKey);
apps/web/src/components/SettingsPanel.tsx:530:  const cryptoquantClearKey = useStore(cryptoquantKeyStore, (s) => s.clearKey);
(code 0)
### A5
apps/web/src/components/SettingsPanel.cryptoquant.test.ts:26:    expect(SOURCE).not.toContain("getCryptoquantKey");
(code 0)
### A6
apps/web/src/data/onchain/cryptoquant-fetch.test.ts:1
apps/web/src/store/cryptoquant.test.ts:1
apps/web/src/store/persist.test.ts:4
apps/web/src/viteConfig.test.ts:10
(code 0)
### A7
apps/web/src/data/onchain/cryptoquant.ts:548:  if (cle !== null) headers["Authorization"] = `Bearer ${cle}`;
(code 0)
### A8
apps/web/vite.config.ts:88:  const CQ_CLE_ENV = !isVercelBuild && CRYPTOQUANT_API_KEY !== "";
apps/web/vite.config.ts:103:    __CQ_CLE_ENV__: JSON.stringify(CQ_CLE_ENV),
(code 0)
### A9
apps/web/e2e/des-flux-takers.e2e.ts:181:    expect(appel.url).not.toContain(CLE);
apps/web/e2e/des-flux-takers.e2e.ts:182:    expect(appel.authorization).toBe(`Bearer ${CLE}`);
apps/web/e2e/des-flux-takers.e2e.ts:210:  expect(brut).not.toContain(CLE);
(code 0)
### B1


 196 pass
 0 fail
 611 expect() calls
Ran 196 tests across 6 files. [186.00ms]
(code 0)
### B2

 Test Files  1 passed (1)
      Tests  20 passed (20)
   Start at  14:02:22
   Duration  229ms (transform 60ms, setup 0ms, import 130ms, tests 20ms, environment 0ms)

(code 0)
### B3
api/_policy.ts:4:import { CRYPTOQUANT_HOST, cheminCryptoQuantAmont, cleCryptoQuantValide } from "../shared/cryptoquant-proxy.js";
api/_policy.ts:374:      const allowedPath = cheminCryptoQuantAmont(`/cqapi/${path}`, localQuery ? `?${localQuery}` : "");
apps/daemon/src/proxy.ts:28:import { CRYPTOQUANT_HOST, CRYPTOQUANT_PREFIXE, cheminCryptoQuantAmont, cleCryptoQuantValide } from "../../../shared/cryptoquant-proxy";
apps/daemon/src/proxy.ts:982:  const chemin = cheminCryptoQuantAmont(url.pathname, url.search);
apps/web/vite.config.ts:8:import { CRYPTOQUANT_HOST, cheminCryptoQuantAmont, cleCryptoQuantValide } from "../../shared/cryptoquant-proxy";
apps/web/vite.config.ts:291:          return cheminCryptoQuantAmont(url.pathname, url.search) ?? "/__axiom_refuse__";
apps/web/vite.config.ts:304:                : cheminCryptoQuantAmont(url.pathname, url.search) === null
(code 0)
shared/cryptoquant-proxy.ts:11: * obligatoire, `limit` entier 1..30, jamais `from`/`to` (le fournisseur refuse toute
shared/cryptoquant-proxy.ts:24:const SYMBOLES_TAKER: ReadonlySet<string> = new Set(["btc_all", "eth_all"]);
shared/cryptoquant-proxy.ts:42: * refusée ; la query de sortie est reconstruite dans l'ordre symbol|miner, window, limit.
shared/cryptoquant-proxy.ts:56:    if (cle !== cleSujet && cle !== "window" && cle !== "limit") return null; // from, to, inconnue, casse
shared/cryptoquant-proxy.ts:62:  if (params.get("window") !== "day") return null;
shared/cryptoquant-proxy.ts:63:  const limit = params.get("limit");
shared/cryptoquant-proxy.ts:64:  if (limit !== null && (!MOTIF_LIMIT.test(limit) || Number(limit) > LIMIT_MAX)) return null;
shared/cryptoquant-proxy.ts:68:  sortie.set("window", "day");
shared/cryptoquant-proxy.ts:69:  if (limit !== null) sortie.set("limit", limit);
(code 0)
### B4
api/_policy.ts:135:  maxRedirects?: number;
api/_policy.ts:327:    : "private, no-store";
api/_policy.ts:413:    maxRedirects: route === "defillamapro" || route === "cqapi" ? 0 : undefined,
api/proxy.ts:161:        "cache-control": "private, no-store",
api/proxy.ts:279:    if (redirects >= (plan.maxRedirects ?? PROXY_MAX_REDIRECTS)) throw new ProxyPolicyError(502, "redirection amont refusée");
api/proxy.ts:361:      for (const nom of ["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"]) {
apps/daemon/src/proxy.ts:358:      maxRedirections: nbs ? 0 : undefined,
apps/daemon/src/proxy.ts:507:  maxRedirections?: number;
apps/daemon/src/proxy.ts:756:  const maxRedirections = Math.max(0, options.maxRedirections ?? EXTAPI_MAX_REDIRECTIONS);
apps/daemon/src/proxy.ts:812:        if (redirections >= maxRedirections) throw new ErreurPolitiqueExtapi("trop de redirections amont");
apps/daemon/src/proxy.ts:860:    "cache-control": "private, no-store",
apps/daemon/src/proxy.ts:915:    "cache-control": "private, no-store",
apps/daemon/src/proxy.ts:929:  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store", ...ENTETES_SECURITE_EXTAPI, ...entetesCors(req) };
apps/daemon/src/proxy.ts:938:      ...options, hotesAutorises: new Set([DEFILLAMA_PRO_HOST]), maxRedirections: 0,
apps/daemon/src/proxy.ts:953:const ENTETES_QUOTA_CRYPTOQUANT = ["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"] as const;
apps/daemon/src/proxy.ts:970:    "cache-control": "private, no-store",
apps/daemon/src/proxy.ts:992:      maxRedirections: 0,
apps/web/vite.config.ts:251:            res.setHeader("cache-control", "private, no-store");
apps/web/vite.config.ts:263:            res.setHeader("cache-control", "private, no-store");
apps/web/vite.config.ts:276:            if ("writeHead" in res && !res.headersSent) res.writeHead(502, { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" });
apps/web/vite.config.ts:310:            res.setHeader("cache-control", "private, no-store");
apps/web/vite.config.ts:337:            // (un res.setHeader serait écrasé). Les x-ratelimit-* passent tels quels.
apps/web/vite.config.ts:338:            proxyRes.headers["cache-control"] = "private, no-store";
apps/web/vite.config.ts:342:              res.writeHead(502, { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" });
(code 0)
### B5
apps/daemon/src/cache.test.ts:31:  test("/cqapi n'est jamais mis en cache : la clé de cache ignore Authorization", () => {
apps/daemon/src/cache.test.ts:33:    expect(ttlMsPourChemin("/cqapi/v2/market/cq/spot/trade")).toBe(0);
apps/daemon/src/cache.test.ts:34:    expect(ttlMsPourChemin("/cqapi/v1/btc/miner-data/companies")).toBe(0);
apps/daemon/src/cache.test.ts:35:    expect(ttlMsPourChemin("/cqapi")).toBe(0);
(code 0)
### B6
(code 0)
### B7
diff --git a/vercel.json b/vercel.json
index 1e1d245..f094444 100644
--- a/vercel.json
+++ b/vercel.json
@@ -86,6 +86,14 @@
       "source": "/defillamapro/:path*/",
       "destination": "/api/proxy?__axiom_route=defillamapro&__axiom_path=:path/"
     },
+    {
+      "source": "/cqapi/:path*",
+      "destination": "/api/proxy?__axiom_route=cqapi&__axiom_path=:path"
+    },
+    {
+      "source": "/cqapi/:path*/",
+      "destination": "/api/proxy?__axiom_route=cqapi&__axiom_path=:path/"
+    },
     {
       "source": "/(.*)",
       "destination": "/index.html"
(code 0)
0
(code 1)
### C1

 Test Files  83 passed (83)
      Tests  1040 passed (1040)
   Start at  14:03:04
   Duration  1.84s (transform 8.14s, setup 0ms, import 12.28s, tests 1.60s, environment 4ms)

(code 0)
### C2
apps/web/src/data/onchain/cryptoquant.ts:10:import { detectDaemon, kvPut, urlDaemon } from "../daemon";
apps/web/src/data/onchain/cryptoquant.ts:274:    localStorage.setItem(cleLocale(serie), texte);
apps/web/src/data/onchain/cryptoquant.ts:327:/** Jamais de `kvPut` après une lecture KV en erreur ni au-delà de 900 000 caractères. */
apps/web/src/data/onchain/cryptoquant.ts:333:  return { local, kv: (await kvPut(NS_KV, cleKv(serie), archive)) !== null };
(code 0)
### C3
Running 4 tests using 1 worker

  ✓  1 [chromium] › e2e/des-flux-takers.e2e.ts:153:1 › DES : flux takers chargés au montage (4 appels), repliés par défaut, sans appel sur segmentés, source ni réouverture (2.9s)
  ✓  2 [chromium] › e2e/des-flux-takers.e2e.ts:233:1 › DES : archive locale antérieure fusionnée sans doublon (début 2026-08-07) (652ms)
  ✓  3 [chromium] › e2e/des-flux-takers.e2e.ts:250:1 › DES : 429 CryptoQuant — délai de reprise affiché, archive servie et non réécrite (936ms)
  ✓  4 [chromium] › e2e/des-flux-takers.e2e.ts:278:1 › DES : 401 CryptoQuant — clé refusée affichée avec l'accès aux Réglages, un seul appel, rien d'archivé (933ms)

  4 passed (6.3s)
(code 0)
### C4
apps/web/src/store/persist.ts:795: * Archives CryptoQuant par série (`axiom:onchain:cq:<serie>:v1`, spec 2026-09-16 §4.4) :
apps/web/src/store/persist.ts:800:const PREFIXE_ARCHIVE_CRYPTOQUANT = "axiom:onchain:cq:";
apps/web/src/store/persist.ts:828: * (`axiom:onchain:cq:*`, licence personnelle) : leur durabilité vient du KV daemon.
(code 0)
### C5
apps/web/src/store/persist.ts:784:  "axiom:cryptoquant:key",
(code 0)
### D1
44:### Budget avant B1
150:### Budget après B1-3
258:### Budget après B1
366:- Delta initial : +27 gzip / +39 bruts depuis « après B1-3 » (attendu ≤ ~40 gzip : nom du chunk partagé du store dans `__vite__mapDeps`) ; +49 gzip / +104 bruts sur l'ensemble de B1 depuis « avant B1 » (porte d'acceptation ≤ ~150 gzip).
367:- Marge locale 4356 gzip ; marge runner estimée 3118 gzip (écart runner − local du 2026-09-16 : 356 635 − 355 397 = 1 238, `docs/superpowers/progress/2026-09-16-indicateurs-et-fonctions-revue.md:49` et `:62`). Seules les limites 1220000 bruts / 360000 gzip bloquent le build.
368:- Chunk partagé du store (`.vite/manifest.json`, importé par DES) : `assets/cryptoquant-DWizfmto.js`.
369:- Client CryptoQuant : `assets/cryptoquant-CWb-gmgq.js`, entrée dynamique chargée par DES via `import()`, hors du graphe statique de l'entrée ; aucun fichier initial ne contient « Flux takers toutes places » ; garde-fou `apps/web/src/chunkCryptoquant.test.ts` vert.
(code 0)
### D2
(code 0)
0
(code 1)
{"entree":"index.html","grapheStatique":4,"client":"assets/cryptoquant-CWb-gmgq.js","des":"assets/DerivativesWindow-DKgfpi5o.js","storePartage":["assets/cryptoquant-DWizfmto.js"]}
(code 0)
### D3

 Test Files  3 passed (3)
      Tests  31 passed (31)
   Start at  14:05:25
   Duration  271ms (transform 121ms, setup 0ms, import 164ms, tests 55ms, environment 0ms)

(code 0)
### E1
apps/web/src/components/fluxTakers.util.ts:128:    somme += l.qbv - l.qsv;
apps/web/src/components/fluxTakers.util.ts:156:    deltaQuote: fini(ligne.qbv - ligne.qsv),
(code 0)
apps/web/src/components/fluxTakers.util.ts:35:  vwap: number | null;
apps/web/src/components/fluxTakers.util.ts:52:  return "bsr" in ligne;
apps/web/src/components/fluxTakers.util.ts:103:    vwap: null,
apps/web/src/components/fluxTakers.util.ts:145:    courbe.push({ jour: j, valeur: l === undefined ? null : fini(l.bsr) });
apps/web/src/components/fluxTakers.util.ts:150:    ratio: fini(ligne.bsr),
apps/web/src/components/fluxTakers.util.ts:153:      entrees.map(([, l]) => l.bsr),
apps/web/src/components/fluxTakers.util.ts:154:      ligne.bsr,
apps/web/src/components/fluxTakers.util.ts:161:    vwap: fini(ligne.vwap),
(code 0)
apps/web/src/components/FluxTakersSection.tsx:13: * jamais recalculés, aucune comparaison Binance. Indépendante de la clé Coinalyze, du
(code 0)
### E2
(code 1)
### E3
(code 0)
### E4
1
(code 0)
```

### Écarts actés par l'orchestrateur (rappel, non bloquants)

- `situer` vit dans `apps/web/src/components/fluxTakers.util.ts`, et plus dans le client.
- `RAISON_CLE_CRYPTOQUANT` et `messageSansCleCq` vivent dans `apps/web/src/store/cryptoquant.ts` ; le client les ré-exporte.
- Bouton Réglages aussi sur une clé refusée (401) ; complément `.env`/Vercel seulement pour l'absence de clé.
- Proxys locaux : en-tête client s'il est valide, sinon `.env`. Vercel : POST sans clé → 405, méthode contrôlée d'abord.
- Archive de version inconnue : statut `erreur`, zéro appel, rien réécrit, bandeau dans la vue.
- `etatFileCq().enAttente` ne compte que les demandes en attente d'un créneau ; `repriseTs` couvre le 429 et `x-ratelimit-remaining: 0`.
- Archive illisible remplacée : détectée par la forme `statut "pret"` + `raison` non nulle, le client n'exposant cette raison qu'en valeur.

### Écarts relevés

- Aucun.

## B2 — production des mineurs cotés

### Budget après B2

Commande : `pnpm --filter @axiom/web build` (tâche 19, sous-section CHAIN et spec e2e livrées ; JSON réimprimé tel quel par `node scripts/verifier-budget-build.mjs apps/web/dist` sur le même `dist`).

```json
{
  "limites": {
    "octetsBruts": 1220000,
    "octetsGzip": 360000,
    "niveauGzip": 9
  },
  "initial": {
    "fichiers": [
      "assets/index-BOKxOn2m.js",
      "assets/indicators-DMDb8A8f.js",
      "assets/vendor-klinecharts-B5HFhIGv.js",
      "assets/vendor-react-BPWy1Tn9.js"
    ],
    "octetsBruts": 1206212,
    "octetsGzip": 355637
  },
  "dynamique": {
    "fichiers": [
      "assets/BacktestWindow-DmvlsxDD.js",
      "assets/BriefWindow-Bs7zmkMk.js",
      "assets/BtcPowerLawWindow-MSGZEN-J.js",
      "assets/CbpremWindow-DxFo6jT3.js",
      "assets/ChartSyncControls-C5fyqNtv.js",
      "assets/CommandPalette-BUsGi4vK.js",
      "assets/CorrWindow-8X9ypZrP.js",
      "assets/CotWindow-BneP5ymo.js",
      "assets/CycleWindow-CgTHqand.js",
      "assets/DataWindow-DRSmJ8qg.js",
      "assets/DefillamaProPanel-Dxe9TU6F.js",
      "assets/DerivativesWindow-DrnOA6uT.js",
      "assets/DistWindow-DcdbaXvC.js",
      "assets/DomWindow-D2_iAGcd.js",
      "assets/EcoWindow-C7D4WtzI.js",
      "assets/EconomieChaines-CyhSP03H.js",
      "assets/EvtsWindow-BoJUxQ9d.js",
      "assets/ExpyWindow-DYPNI2du.js",
      "assets/FluxCapitaux-BWx0H876.js",
      "assets/FundWindow-CcPjp8Ju.js",
      "assets/FundingMatrixWindow-BD-nfVT3.js",
      "assets/GlobeWindow-SzlxWPHA.js",
      "assets/LiquidationsWindow-CQWgx1GM.js",
      "assets/MacroRatesWindow-CzJoLTLn.js",
      "assets/MarketMapWindow-DhqZiJ4o.js",
      "assets/McapWindow-CVDZ4m7o.js",
      "assets/MineWindow-DAEcQ2u_.js",
      "assets/NetliqWindow-BydTO59o.js",
      "assets/NewsWindow-B8SxFwYN.js",
      "assets/NotesWindow-BpDS-R_5.js",
      "assets/OnboardingOverlay-C60I16IS.js",
      "assets/OnchainWindow-6UealTc3.js",
      "assets/OptionsWindow-D-MUvVnm.js",
      "assets/PaperWindow-BVeKfRS7.js",
      "assets/PortfolioWindow-CTAaTVxU.js",
      "assets/QualiteMetrique-BrA9YWZb.js",
      "assets/ReplayWindow-B6ps0krq.js",
      "assets/ScenWindow-DMfurOjm.js",
      "assets/ScreenerWindow-o4UkgDHK.js",
      "assets/SeasonalityWindow-CR6Oq_Is.js",
      "assets/SectWindow-DsCsy05p.js",
      "assets/SettingsPanel-BlujH0lZ.js",
      "assets/SqueezeWindow-Bx0BQERp.js",
      "assets/StablecoinsWindow-CSa3_teR.js",
      "assets/TableTriable-C-cgIuiG.js",
      "assets/TermStructureWindow-6Zmttf-O.js",
      "assets/VolWindow-K9Q0RtGM.js",
      "assets/WebGLSyncSpike-gk5cdEXX.js",
      "assets/WhalesWindow-DxCleRgP.js",
      "assets/bgeometrics-DFZf7eli.js",
      "assets/chart-sync-timeframes-BjdLF6zU.js",
      "assets/composite-tP0ZcnLI.js",
      "assets/corr-B_X11ZaJ.js",
      "assets/cot-CawrzmbY.js",
      "assets/cryptoquant-D1SH6W9Y.js",
      "assets/cryptoquant-zr9BtcXT.js",
      "assets/csv-DChTGBa8.js",
      "assets/defillamaKey-DiCIx3Vw.js",
      "assets/economieChaines-i_z13b0v.js",
      "assets/etherscan-g8V-PYHm.js",
      "assets/expy-3I9sQwqM.js",
      "assets/fluxCapitaux-BOHlp1vJ.js",
      "assets/fundingCrossExchange-wJB5ktQL.js",
      "assets/lienRetours-Bo4sHoSC.js",
      "assets/liquidationHeat-Du3NHdqC.js",
      "assets/macroSeries-Sho-_KdO.js",
      "assets/mempool-7GkD8Txt.js",
      "assets/onchainMetriques-PcyvAT77.js",
      "assets/portRisque-Bi-CynnM.js",
      "assets/qualiteChain-DsYRT7VQ.js",
      "assets/squeezeWindow.util-CMxdrcHl.js",
      "assets/thermocap-Db3JVufw.js",
      "assets/treasuryYields-Bhqd6VfU.js",
      "assets/treemap-D9x5LE-E.js",
      "assets/tresoreriesBtc-Ij_nll_q.js",
      "assets/useDomaineZoom-Bxy48dSr.js",
      "assets/viewportSync-IhawcF2X.js",
      "assets/volCone-BZveA2ku.js"
    ],
    "octetsBruts": 1016836,
    "octetsGzip": 373028
  }
}
```

Contrôles I11 (B2) : client `assets/cryptoquant-zr9BtcXT.js` en entrée dynamique chargée par CHAIN via `import()` ; ni le client ni `OnchainWindow` dans le graphe statique de l'entrée (4 modules) ; aucun fichier initial ne contient « Production des mineurs cotés ».

Chunk partagé du store (`.vite/manifest.json`) : `assets/cryptoquant-D1SH6W9Y.js` ; nom présent dans `__vite__mapDeps` de l'entrée : oui.

Delta initial depuis « Budget après B1 » : -7 o gzip (attendu ≤ ~40 o gzip par sous-lot ; porte d'acceptation ≤ ~150 o gzip sur l'ensemble de B1 ; seule la limite 360 000 est bloquante) ; marge gzip locale 4363 o.

### Revue indépendante B2

- Verdict : **ACCEPTÉ**, rendu par le contrôleur après la correction `83d7393`.
- Réviseur : Claude Opus 5 (1M context). C'est un agent relecteur distinct du développeur des tâches 18 et 19 (rôle Réviseur, `.devin/provider-rules.md:33` et `:51`).
- Objet revu, le 2026-09-17 :
  - la sous-section CHAIN à l'état `d008175` (`MineursCotes.tsx`, `MineursCotes.test.tsx`, `Mineurs.tsx`) ;
  - le diff de la tâche 19 : parcours e2e, porte `scripts/ci.sh --e2e` et « Budget après B2 ».
- Source : registre local de la tâche 19 (`.superpowers/`, non suivi par git). Cette section en est la trace durable.

Points de la grille (sept points, tous confirmés après la correction) :

| Point | Contrôle | Résultat |
|---|---|---|
| 1 | Sommes d'affichage : Σ seulement si les 9 sociétés ont une ligne (`sommeOuNull`, sinon `null`) ; la courbe Σ n'a ni moyenne ni report d'un autre jour. | confirmé |
| 2 | `null` jamais 0 : production déclarée nulle → « non publié » ; société sans ligne → tiret avec motif ; aucun `?? 0` ni `\|\| 0` dans `MineursCotes.tsx`. | contesté au premier passage, puis confirmé après `83d7393` |
| 3 | Couverture partielle : `partiel` si moins de 9 sociétés ou s'il manque un jour ; `perime` seulement si toutes les séries archivées sont périmées ; `ageMaxMs` de 3 j justifié et testé. | confirmé |
| 4 | Aucun écart en % : production déclarée et cumul du mois affichés bruts. | confirmé |
| 5 | Bundle : client et module partagé en `import type` seulement ; un seul `await import("../../data/onchain/cryptoquant")` ; contrôles I11 revérifiés sur le manifeste réel. | confirmé |
| 6 | Effet : abandon vérifié après l'import et après chaque série ; qualité publiée une seule fois, après la boucle ; nettoyage (abandon et désabonnement de la file). | confirmé |
| 7 | Signaux et tri : cinq signaux rendus et testés ; bouton Réglages pour tout `cle-requise` ; complément `.env`/Vercel pour la seule clé absente ; tri porté par le conteneur. | confirmé (classement des sociétés sans ligne non revérifié : `trierLignes` et `TableTriable` sont hors du diff) |

- Point 2, premier passage : `MineursCotes.tsx:407` contenait `m.retardJours ?? 0`, un motif interdit par la grille. Le relecteur a jugé le risque réel nul, car ce repli ne pouvait pas s'appliquer à une valeur CryptoQuant manquante, mais la lettre de la grille n'était pas respectée.
- Correction `83d7393` (`fix(chain): corrections de la revue indépendante B2`, une ligne) : l'en-tête reste vide si `retardJours` est nul, et le repli `?? 0` disparaît.
- Budget après la correction : le cycle a été rejoué, et « Budget après B2 » ci-dessus est la nouvelle mesure. Le gzip initial passe de 355 661 à 355 637 octets. L'écart vient des nouveaux hash de chunks, pas du code.
- Écart restant : aucun.

## Clôture (tâche 20)

### Journal des commits (depuis la spec `2d45426`)

| Commit | Sujet |
|---|---|
| `39d0a00` | docs(plan): plan d'implémentation CryptoQuant BASIC et arbitrages de planification dans la spec |
| `a56700e` | docs(plan): corrections du pré-vol — exécution séquentielle, racine du worktree, motifs de synthèse, écarts actés, renvois à la spec §12 |
| `3bf6298` | docs(contrat,csp,rapport): exception CryptoQuant BASIC du 2026-09-16 — clé personnelle, route /cqapi, archive côté client |
| `3d66546` | feat(shared): liste fermée de la route /cqapi — trois chemins CryptoQuant BASIC, window=day, limit ≤ 30 |
| `615d9bc` | feat(vercel): route /cqapi — Bearer personnel seul, liste fermée, zéro redirection, quota relayé |
| `fe911c2` | feat(daemon): route /cqapi — gestionnaire dédié, repli .env local, quota relayé, jamais en cache |
| `e9bb6bc` | feat(vite): proxy de dev /cqapi — refus locaux, repli .env hors Vercel, réponse privée |
| `5ce75c2` | feat(cryptoquant): store de la clé personnelle et message « clé requise » (sans import data) |
| `361dad8` | feat(cryptoquant): clé et archives CryptoQuant exclues des sauvegardes JSON |
| `e375e17` | feat(cryptoquant): champ de clé CryptoQuant dans les Réglages et budget après B1-3 |
| `760136d` | feat(cryptoquant): catalogue des 13 séries et parseur des jours clos |
| `ea915d6` | feat(cryptoquant): archive par série — fusion non destructive, union, décodage tolérant, trous dérivés |
| `5d236b9` | feat(cryptoquant): archive locale ∪ KV daemon — lecture tri-état, écriture gardée |
| `1adc077` | feat(cryptoquant): file unique 10 req/min, correction x-ratelimit et reprise 429 bornée |
| `7e0ba84` | feat(cryptoquant): orchestrateur — court-circuit J-1, reprise 6 h, refus de session, non-fuite de la clé, libellé DATA |
| `937d860` | fix(cryptoquant): raisonOffre teste la clé sur le message entier avant troncage à 200 |
| `767df42` | fix(cryptoquant): un majTs futur n'empêche plus la reprise 6 h |
| `84e0175` | feat(des): modèle pur des flux takers toutes places et classement situer (CryptoQuant) |
| `bff0ffd` | feat(des): section repliable flux takers toutes places (CryptoQuant) chargée au montage |
| `f40a8ac` | fix(des): repli d'erreur sur l'import du client taker et libellé honnête sans appel réseau |
| `c07eb15` | test(budget): garde-fou du client CryptoQuant à la demande et mesure du budget après B1 |
| `57898a2` | test(e2e): DES flux takers toutes places — montage, archive, 429 et 401 hermétiques |
| `976b5f3` | docs(rapport): revue indépendante B1 — flux takers CryptoQuant acceptés |
| `9034a3b` | feat(chain): production des mineurs cotés CryptoQuant dans la section Mineurs |
| `d008175` | fix(chain): repli honnête sur le rejet de l'import() du client CryptoQuant dans Mineurs cotés |
| `83d7393` | fix(chain): corrections de la revue indépendante B2 |
| `2ff3b44` | test(chain): parcours e2e des mineurs cotés — neuf appels au montage, aucun à la réouverture |

Le commit de clôture (`docs(rapport): clôture CryptoQuant — preuves, budget avant/après, parcours e2e et preuve manuelle`) suit cette liste.

### Vérification finale

`pnpm check` puis `bash scripts/ci.sh --e2e`, lignes de synthèse :

```text
==> [ci] typecheck
==> [ci] test
packages/indicators test:  Test Files  206 passed (206)
packages/indicators test:       Tests  780 passed (780)
packages/alerts test:  Test Files  2 passed (2)
packages/alerts test:       Tests  59 passed (59)
packages/backtest test:  Test Files  4 passed (4)
packages/backtest test:       Tests  95 passed (95)
apps/daemon test:  608 pass
apps/daemon test:  0 fail
apps/daemon test: Ran 608 tests across 32 files. [513.00ms]
apps/web test:  Test Files  340 passed (340)
apps/web test:       Tests  4598 passed (4598)
==> [ci] build @axiom/web
==> [ci] OK
  79 passed (1.8m)
```

### Budget final

Commande : `pnpm check` (build `pnpm --filter @axiom/web build` de `scripts/ci.sh:35`, tâche 20 ; JSON réimprimé tel quel par `node scripts/verifier-budget-build.mjs apps/web/dist` sur le même `dist`).

```json
{
  "limites": {
    "octetsBruts": 1220000,
    "octetsGzip": 360000,
    "niveauGzip": 9
  },
  "initial": {
    "fichiers": [
      "assets/index-BOKxOn2m.js",
      "assets/indicators-DMDb8A8f.js",
      "assets/vendor-klinecharts-B5HFhIGv.js",
      "assets/vendor-react-BPWy1Tn9.js"
    ],
    "octetsBruts": 1206212,
    "octetsGzip": 355637
  },
  "dynamique": {
    "fichiers": [
      "assets/BacktestWindow-DmvlsxDD.js",
      "assets/BriefWindow-Bs7zmkMk.js",
      "assets/BtcPowerLawWindow-MSGZEN-J.js",
      "assets/CbpremWindow-DxFo6jT3.js",
      "assets/ChartSyncControls-C5fyqNtv.js",
      "assets/CommandPalette-BUsGi4vK.js",
      "assets/CorrWindow-8X9ypZrP.js",
      "assets/CotWindow-BneP5ymo.js",
      "assets/CycleWindow-CgTHqand.js",
      "assets/DataWindow-DRSmJ8qg.js",
      "assets/DefillamaProPanel-Dxe9TU6F.js",
      "assets/DerivativesWindow-DrnOA6uT.js",
      "assets/DistWindow-DcdbaXvC.js",
      "assets/DomWindow-D2_iAGcd.js",
      "assets/EcoWindow-C7D4WtzI.js",
      "assets/EconomieChaines-CyhSP03H.js",
      "assets/EvtsWindow-BoJUxQ9d.js",
      "assets/ExpyWindow-DYPNI2du.js",
      "assets/FluxCapitaux-BWx0H876.js",
      "assets/FundWindow-CcPjp8Ju.js",
      "assets/FundingMatrixWindow-BD-nfVT3.js",
      "assets/GlobeWindow-SzlxWPHA.js",
      "assets/LiquidationsWindow-CQWgx1GM.js",
      "assets/MacroRatesWindow-CzJoLTLn.js",
      "assets/MarketMapWindow-DhqZiJ4o.js",
      "assets/McapWindow-CVDZ4m7o.js",
      "assets/MineWindow-DAEcQ2u_.js",
      "assets/NetliqWindow-BydTO59o.js",
      "assets/NewsWindow-B8SxFwYN.js",
      "assets/NotesWindow-BpDS-R_5.js",
      "assets/OnboardingOverlay-C60I16IS.js",
      "assets/OnchainWindow-6UealTc3.js",
      "assets/OptionsWindow-D-MUvVnm.js",
      "assets/PaperWindow-BVeKfRS7.js",
      "assets/PortfolioWindow-CTAaTVxU.js",
      "assets/QualiteMetrique-BrA9YWZb.js",
      "assets/ReplayWindow-B6ps0krq.js",
      "assets/ScenWindow-DMfurOjm.js",
      "assets/ScreenerWindow-o4UkgDHK.js",
      "assets/SeasonalityWindow-CR6Oq_Is.js",
      "assets/SectWindow-DsCsy05p.js",
      "assets/SettingsPanel-BlujH0lZ.js",
      "assets/SqueezeWindow-Bx0BQERp.js",
      "assets/StablecoinsWindow-CSa3_teR.js",
      "assets/TableTriable-C-cgIuiG.js",
      "assets/TermStructureWindow-6Zmttf-O.js",
      "assets/VolWindow-K9Q0RtGM.js",
      "assets/WebGLSyncSpike-gk5cdEXX.js",
      "assets/WhalesWindow-DxCleRgP.js",
      "assets/bgeometrics-DFZf7eli.js",
      "assets/chart-sync-timeframes-BjdLF6zU.js",
      "assets/composite-tP0ZcnLI.js",
      "assets/corr-B_X11ZaJ.js",
      "assets/cot-CawrzmbY.js",
      "assets/cryptoquant-D1SH6W9Y.js",
      "assets/cryptoquant-zr9BtcXT.js",
      "assets/csv-DChTGBa8.js",
      "assets/defillamaKey-DiCIx3Vw.js",
      "assets/economieChaines-i_z13b0v.js",
      "assets/etherscan-g8V-PYHm.js",
      "assets/expy-3I9sQwqM.js",
      "assets/fluxCapitaux-BOHlp1vJ.js",
      "assets/fundingCrossExchange-wJB5ktQL.js",
      "assets/lienRetours-Bo4sHoSC.js",
      "assets/liquidationHeat-Du3NHdqC.js",
      "assets/macroSeries-Sho-_KdO.js",
      "assets/mempool-7GkD8Txt.js",
      "assets/onchainMetriques-PcyvAT77.js",
      "assets/portRisque-Bi-CynnM.js",
      "assets/qualiteChain-DsYRT7VQ.js",
      "assets/squeezeWindow.util-CMxdrcHl.js",
      "assets/thermocap-Db3JVufw.js",
      "assets/treasuryYields-Bhqd6VfU.js",
      "assets/treemap-D9x5LE-E.js",
      "assets/tresoreriesBtc-Ij_nll_q.js",
      "assets/useDomaineZoom-Bxy48dSr.js",
      "assets/viewportSync-IhawcF2X.js",
      "assets/volCone-BZveA2ku.js"
    ],
    "octetsBruts": 1016836,
    "octetsGzip": 373028
  }
}
```

### Tableau du budget JS initial (avant/après)

Gzip niveau 9 ; plafonds 1 220 000 octets bruts et 360 000 octets gzip. Valeurs lues dans les blocs json des sections « Budget … » (ci-dessus, et « Budget après la vague de correction finale » sous « Revue finale de branche »).

| Mesure | Octets bruts | Octets gzip | Δ gzip depuis « avant B1 » | Marge gzip locale |
|---|---|---|---|---|
| Budget avant B1 | 1206105 | 355595 | 0 | 4405 |
| Budget après B1-3 | 1206170 | 355617 | +22 | 4383 |
| Budget après B1 | 1206209 | 355644 | +49 | 4356 |
| Budget après B2 | 1206212 | 355637 | +42 | 4363 |
| Budget final (clôture `3fa31e6`) | 1206212 | 355637 | +42 | 4363 |
| Budget après la vague de correction finale | 1206265 | 355686 | +91 | 4314 |

Delta de B1 (après B1 − avant B1) : +49 o gzip (porte d'acceptation ≤ ~150 o gzip). Delta de B2 (après B2 − après B1) : -7 o gzip (attendu ≤ ~40 o gzip). Delta de la vague de correction (après la vague − final) : +49 o gzip, dont +38 à l'étape C (chunk `horloge` ajouté aux dépendances préchargées de DES). Seule la limite 360 000 o gzip est bloquante.

Marges de ce tableau : locales. Estimation runner, par la méthode de « Budget après B1 » (marge locale − 1 238, écart runner − local mesuré le 2026-09-16 : 356 635 − 355 397) :

- ≈ 3 167 gzip à la base du lot (4 405 − 1 238) ;
- ≈ 3 125 gzip après le lot, à `3fa31e6` (4 363 − 1 238) ;
- ≈ 3 076 gzip après la vague de correction finale : budget initial final **1 206 265 octets bruts / 355 686 gzip**, mesuré par `pnpm check` à l'étape D (marge locale 4 314 ; 4 314 − 1 238). Voir « Revue finale de branche ».

Les 3 365 gzip ont été mesurés sur le runner à `e14dc03`, avant trois commits de code hors lot (`7542bee`, `f8ef08f`, `278c452`) : ce n'est pas la marge du lot. Seuil de vigilance ~3 000 gzip (spec I11) : il reste environ 76 octets gzip sur le runner ; au prochain ajout au chemin d'entrée, retirer d'abord le libellé DATA. Budget du premier run GitHub de la branche : non relevé (branche non poussée) ; à lire au premier push.

### Parcours e2e du lot (sortie Playwright)

Instantané à la clôture (`3fa31e6`). État final, après la vague de correction (8 parcours, titres et lignes à jour) : « Contrôles » sous « Revue finale de branche ».

```text
  ✓   1 [chromium] › e2e/chain-mineurs-cotes.e2e.ts:106:1 › CHAIN : mineurs cotés — neuf appels au montage, lecture et tri au dépliage, aucun appel ensuite (3.2s)
  ✓   2 [chromium] › e2e/chain-mineurs-cotes.e2e.ts:185:1 › CHAIN : mineurs cotés — une société en 503, Σ partielle et couverture 8/9 (1.1s)
  ✓   8 [chromium] › e2e/des-flux-takers.e2e.ts:153:1 › DES : flux takers chargés au montage (4 appels), repliés par défaut, sans appel sur segmentés, source ni réouverture (1.4s)
  ✓   9 [chromium] › e2e/des-flux-takers.e2e.ts:233:1 › DES : archive locale antérieure fusionnée sans doublon (début 2026-08-07) (586ms)
  ✓  10 [chromium] › e2e/des-flux-takers.e2e.ts:250:1 › DES : 429 CryptoQuant — délai de reprise affiché, archive servie et non réécrite (879ms)
  ✓  11 [chromium] › e2e/des-flux-takers.e2e.ts:278:1 › DES : 401 CryptoQuant — clé refusée affichée avec l'accès aux Réglages, un seul appel, rien d'archivé (888ms)
```

- `apps/web/e2e/des-flux-takers.e2e.ts` (tâche 17) : parcours DES décrits par la spec §6 (4 appels au montage, section repliée, segmentés sans appel, archive locale sans `from`, réouverture sans appel, 429, 401).
- `apps/web/e2e/chain-mineurs-cotes.e2e.ts` (tâche 19) : ouverture de CHAIN → exactement 9 appels `miner=<id>&window=day&limit=30`, `Authorization: Bearer` relayé, bouton replié ; « Qualité des blocs » → « Mineurs cotés · CryptoQuant », couverture 9/9, partiel (jour manquant de HIVE) ; archive HIVE de 29 jours ; dépliage → 9 lignes, « 49.05 », « 396.96 », « $3.84M », « non publié », « 123.00 BTC », Σ 130.00 BTC/j, courbe ; tri par société décroissant puis croissant ; repli/dépliage puis fermeture/réouverture → toujours 9 appels. Second parcours : WULF en 503 → « Σ partielle 8/9 », couverture 8/9, « archive servie ».

### Preuve manuelle du propriétaire (hors CI, clé personnelle, jamais depuis un agent)

**Statut au 2026-09-17 : non réalisée — en attente du propriétaire ; aucun agent ne l'exécute.** Les cases ci-dessous ne sont pas cochées. Le propriétaire décide si la fusion de la branche attend cette preuve (spec §9 : curl du propriétaire et valeur de `x-ratelimit-reset`).

Préparation :

- **Saisie de la clé.** Utiliser `read -rs CQ_CLE`, sans `export` : la clé ne s'affiche pas et n'entre pas dans l'historique.
  - La variable reste propre au shell courant.
  - `pnpm daemon`, `pnpm dev` et les autres processus lancés ensuite n'en héritent pas.
- **Passage de la clé à curl.** L'en-tête `Authorization` passe par l'entrée standard (`printf … | curl -H @-`, curl ≥ 7.55).
  - `printf` est une commande interne du shell.
  - La clé n'apparaît donc jamais dans les arguments d'un processus visibles par `ps`.
- **Daemon.** Le lancer avec `pnpm daemon` ; il écoute sur `127.0.0.1:8787`.
- **URL.** Les écrire entre apostrophes : sans elles, le shell interprète `&`.

- [ ] Sans en-tête → 401 (ou 200 si `CRYPTOQUANT_API_KEY` est renseignée dans `apps/web/.env`) :
  `curl -i 'http://127.0.0.1:8787/cqapi/v2/market/cq/spot/trade?symbol=btc_all&window=day&limit=30'`
- [ ] Avec Bearer → 200, en-têtes `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset` et `cache-control: private, no-store` :
  `printf 'Authorization: Bearer %s\n' "$CQ_CLE" | curl -i -H @- 'http://127.0.0.1:8787/cqapi/v2/market/cq/spot/trade?symbol=btc_all&window=day&limit=30'`
- [ ] Chemin hors liste → 404 (refus local, aucun appel amont) :
  `printf 'Authorization: Bearer %s\n' "$CQ_CLE" | curl -i -H @- 'http://127.0.0.1:8787/cqapi/v1/btc/exchange-flows/netflow?exchange=all_exchange&window=day'`
- [ ] POST → 405 `allow: GET` :
  `printf 'Authorization: Bearer %s\n' "$CQ_CLE" | curl -i -X POST -H @- 'http://127.0.0.1:8787/cqapi/v2/market/cq/spot/trade?symbol=btc_all&window=day&limit=30'`
- [ ] Mineurs cotés → 200 :
  `printf 'Authorization: Bearer %s\n' "$CQ_CLE" | curl -i -H @- 'http://127.0.0.1:8787/cqapi/v1/btc/miner-data/companies?miner=mara&window=day&limit=30'`
- [ ] Même série sur le serveur Vite, avec les mêmes statuts attendus. `apps/web/vite.config.ts` ne fixe pas `server.host` : Vite écoute sur `localhost`, qui peut ne répondre qu'en IPv6 (`::1`). Deux façons de faire :
  - lancer `pnpm dev` et remplacer `http://127.0.0.1:8787` par `http://localhost:5173` (URL du README) ;
  - ou lancer `pnpm dev --host 127.0.0.1`, comme `apps/web/playwright.config.ts`, et utiliser `http://127.0.0.1:5173`.
- [ ] Projet Vercel : **aucune** variable `CRYPTOQUANT_API_KEY` (`vercel env ls`, environnements Production, Preview et Development).
- [ ] Session navigateur : panneau DATA « CryptoQuant x/10 min » ; première ouverture de DES → 4 appels `/cqapi` (onglet Réseau), réouverture → 0 ; première ouverture de CHAIN → 9 appels, réouverture → 0.
- [ ] Clé requise. Le court-circuit « J-1 archivé » (spec §4.3, étape 2) passe avant le test de la clé : ce contrôle ne s'observe que dans certaines conditions.
  - Conditions :
    - une série dont J-1 n'est pas encore archivé, par exemple le lendemain d'une session, avant d'ouvrir DES ;
    - `apps/web/.env` sans `CRYPTOQUANT_API_KEY` ;
    - la clé retirée dans les Réglages, puis DES ouvert.
  - Attendu : badge « clé requise pour actualiser » et archive affichée.
  - Hors de ces conditions :
    - si J-1 est déjà archivé : archive J-1 affichée, zéro appel, aucun badge ;
    - si `apps/web/.env` contient la clé : l'appel part avec la clé `.env` injectée par le proxy local, et aucun badge ne s'affiche.
- [ ] Valeur réelle de `x-ratelimit-reset` (secondes ; `6` observé lors du sondage du 2026-09-16) :
  `printf 'Authorization: Bearer %s\n' "$CQ_CLE" | curl -s -D - -o /dev/null -H @- 'http://127.0.0.1:8787/cqapi/v2/market/cq/spot/trade?symbol=btc_all&window=day&limit=30' | grep -i '^x-ratelimit-'`
  Valeur réelle de `x-ratelimit-reset` : en attente de la preuve manuelle du propriétaire (commande ci-dessus).
- [ ] Fin de session : `unset CQ_CLE`.

### Écarts actés à la spec (arbitrages du 2026-09-16)

- Qualité CHAIN « Mineurs cotés · CryptoQuant » : `ageMaxMs` vaut 3 jours, conformément à la spec §4.5 amendée (§12) ; la version initiale de la spec disait 2 jours. La couverture compte les sociétés ayant une ligne au dernier jour archivé commun (jour de référence), et non strictement J-1 (§12). Les observations sont datées à 00:00 UTC du jour clos : 3 j équivaut au seuil « dernier jour antérieur à aujourd'hui − 2 j » de `diagnostiquer`. C'est aussi le délai des séries quotidiennes de CHAIN (`apps/web/src/components/OnchainWindow.tsx:560` pour le hashrate et `:564` pour le thermocap, relevés à `2d45426`).
- Bouton Réglages aussi sur une clé refusée (401) :
  - `SansCle` affiche le bouton pour tout statut `cle-requise` à archive vide, en DES comme en CHAIN ;
  - en CHAIN, le CTA d'en-tête « clé CryptoQuant ⚙ » suit la même règle ;
  - le complément `.env`/Vercel (`messageSansCleCq`) ne s'ajoute qu'à « Clé CryptoQuant personnelle requise (Réglages ⚙) » ; une clé refusée affiche sa raison telle quelle.
- Proxys locaux (Vite, daemon) : la clé est l'en-tête client s'il est valide, sinon `CRYPTOQUANT_API_KEY` de `.env`. Vite injecte aussi `.env` quand l'en-tête est présent mais invalide. Vercel : un POST sans clé répond 405, car la méthode est contrôlée avant la clé.
- Archive de version inconnue : statut `erreur`, raison `RAISON_VERSION_CRYPTOQUANT`, zéro appel, rien n'est réécrit en local ni en KV. Un bandeau l'affiche dans les vues.
- Table CHAIN triable par l'utilisateur : BTC J-1 décroissant par défaut ; l'état du tri vit dans le conteneur `MineursCotes`, la vue reste pure.
- Affichage DES (tâche 15) : « vs méd. 30 j » au format `formatPct(v, 1)` ; VWAP en `$` + `formatPrice` ; taille d'archive en jours archivés ; quota « 10 req/min (compteur dans DATA) » ; en perp, base et VWAP en infobulle du volume.
- Un majTs situé dans le futur est traité comme expiré par la reprise 6 h (garde ajoutée à la tâche 13).

### Errata de la spec (relevés à `2d45426`)

- `NS_ONCHAIN` n'existe pas : `apps/web/src/data/onchain/cache.ts:18` déclare `const NS = "onchain"`, non exporté.
- `acquireSlot` de Coinalyze se trouve en `apps/web/src/data/coinalyze.ts:106-132`, avec `RATE_LIMIT = 40` (`:49`), et non en `:76-124` avec 10. La file CryptoQuant en reprend le principe avec 10 req / 60 s.
- `resteSurLePoste` se trouve en `apps/web/src/store/persist.ts:791-793` (la spec indique `:790-792`).
- Le prédicat Bearer de la fonction Vercel se trouve en `api/_policy.ts:276-284` (la spec §4.1 indique `:277-284`).
- Le quota « x/10 min » s'affiche dans le panneau DATA, pas dans la section DES, alors que la maquette §5.1 le plaçait en pied de section.
- §4.3 (ligne 237) : la non-fuite de la clé est l'invariant I8 (§6), non I9.

### Limites connues

- Collecte dépendante de l'usage : une série ne s'archive que si DES ou CHAIN est ouverte ; plus de 30 jours sans ouverture = jours perdus définitivement (affichés).
- Heure de publication de J-1 inconnue : la reprise 6 h peut repousser la collecte de J-1 au lendemain (trou récupérable dans la fenêtre).
- Archive hors sauvegarde JSON ; sur un poste sans daemon, vider le stockage du navigateur la perd (mention affichée dans les deux vues).
- Sémantique non documentée, affichée brute : composition de `btc_all`/`eth_all`, `inverse` et unités des swaps inverses, `reported_production`/`report_accuracy`, remise à zéro de `accumulated_monthly_rewards`.
- Noms usuels des neuf sociétés en infobulle : connaissance générale, non issue du sondage.
- Deux onglets peuvent dépasser 10 req/min : 429 puis reprise automatique.

## Revue finale de branche

La revue du 2026-09-17 porte sur `3fa31e6`, soit la branche `chantier/cryptoquant` depuis la spec `2d45426`.

Méthode :
- six relecteurs Claude Opus 5, un par zone : proxys, sécurité, client, DES, CHAIN, e2e et documentation ;
- puis une vérification adverse de chaque constat : réalité, scénario, preuve, sévérité et correction recommandée.

Verdicts par zone :
- proxys et sécurité : prêts ;
- client, DES, CHAIN, e2e et documentation : prêts avec corrections.

**Aucun constat critique. Quatre constats importants, tous corrigés.** Les mineurs retenus sont corrigés par une vague unique, en quatre étapes successives à partir de `3fa31e6` :
- A : proxys ;
- B : client ;
- C : vues ;
- D : e2e et rapport.

### Importants corrigés

| Constat | Défaut | Correction |
|---|---|---|
| `client:P1` | Aucune borne basse sur la date fournisseur : un jour aberrant (`0001-01-01`, `1970-01-01`) polluait l'archive locale et la KV, sans retour possible. | `dd07c93` : `parserLignes` écarte les jours antérieurs à J-40 (`JOURS_MAX_REPONSE = 40`). |
| `client:P2` | Avec la seule clé `.env`, le message d'un 403 amont s'affichait sans filtre (invariant I8). | `dd07c93` : le message amont ne s'affiche que si la clé personnelle est connue et absente du message ; sinon, raison par défaut. |
| `des:P1` | En DES, un rejet de l'`import()` du client s'affichait « série non encore archivée ». | `cf97439` : état `echecClient` et libellé « client CryptoQuant non chargé » ; parcours e2e `9f66edd`. |
| `chain:P1` | L'en-tête CHAIN restait muet sur une offre insuffisante, une erreur ou un quota écoulé ; l'échec était invisible quand une archive existait. | `3d35aa7` : fonction pure `resumeEnTeteMineurs`, une branche par état, chaque branche testée. |

### Mineurs corrigés

**Étape A — proxys** (`be42d79`, `a58f03c`)
- Vite `/cqapi` refuse en 403 les navigations, les requêtes cross-site et les destinations actives.
- Vite valide la clé `.env` une seule fois, avec le prédicat du daemon.
- Vite n'accepte aucune redirection : un 3xx devient un 502 sans `Location`. `cookie`, `referer` et `set-cookie` sont retirés.
- Vercel refuse `/cqapi//…`.
- Le prédicat Bearer est désormais strict : `^Bearer [\x21-\x7E]+$`, au plus 512 caractères.
- Le verrou « zéro lecture d'environnement » couvre aussi `process.env`, `Bun.env` et `Deno.env`.
- Nouveaux tests : `symbol` et `miner` dans la même requête ; 302 et 429 du daemon.

**Étape B — client** (`dd07c93`)
- Les jours `>=` aujourd'hui sont ignorés au décodage.
- `aujourdhui` est recalculé après l'obtention du créneau.
- Un 429 ne fait jamais reculer la reprise.
- `x-ratelimit-reset` est lu comme un epoch en ms, un epoch en s ou un délai relatif.
- L'écriture KV est bornée à 5 s.
- Une KV vide est amorcée avec l'union locale.
- Une clé saisie invalide donne « clé refusée », sans appel.
- Le quota « x/10 min » redescend quand la fenêtre se vide.
- Les garde-fous de chunk et d'import du store sont durcis.

**Étape C — vues** (`cf97439`, `3d35aa7`)
- DES :
  - horloge partagée, avec une nouvelle passe au changement de jour UTC ;
  - bandeau « aucune archive locale » ;
  - légende min/max calculée sur les données.
- CHAIN :
  - source « CryptoQuant BASIC » seulement après un appel réussi ;
  - raison conservée en « frais » ;
  - motif « non encore relue ou non publiée ».

**Étape D — e2e et rapport** (`9f66edd`, puis le commit `docs(rapport)` qui suit cette liste)
- Réouverture sans appel 6 h 30 plus tard, le même jour UTC : seul le court-circuit J-1 peut expliquer zéro appel.
- Fusion vérifiée sur quatre jours communs.
- Un cas « client CryptoQuant introuvable » par section.
- Preuve manuelle réécrite : statut, conditions de « clé requise », URL Vite, clé passée par l'entrée standard.
- Revue indépendante B2 consignée.
- Estimation de la marge runner corrigée.
- Journal local signalé comme non suivi.

### Mineurs laissés en l'état

- **429 ou 5xx amont en `text/html`.** Vercel et le daemon le changent en 502, sans `x-ratelimit-*`.
  - Raisons : le format réel des 429 CryptoQuant n'est pas établi, et l'aide du daemon est partagée avec d'autres fournisseurs.
  - La preuve manuelle du propriétaire tranchera.
- **Corps d'un 403 relayé tel quel par le daemon et Vite.**
  - Le client ne l'affiche plus sans clé personnelle vérifiable (correction B2 de la vague).
  - Il reste visible dans les outils réseau du navigateur du propriétaire, sur 127.0.0.1, pour une clé déjà en clair dans son `.env`.
- **Points du registre non promus**, cosmétiques ou bornés :
  - `jourFournisseur` plus strict que `slice(0,10)` ;
  - pas d'écouteur `storage` multi-onglets ;
  - un 401 sur la clé `.env` donne le message « personnelle requise » ;
  - un 200 vide est redemandé à chaque ouverture ;
  - une demande annulée est comptée dans `enAttente` ;
  - un `majTs` futur reste en KV (un appel par passe, sans gel) ;
  - `file.enAttente` est commune aux 13 séries (spec §10) ;
  - pas de remise à zéro des chargements à la rotation de clé ;
  - try/catch inutile en DES ;
  - tirets Σ sans infobulle ;
  - badge « périmé » calculé avec `some`, qualité avec `every` ;
  - « J-1 en attente (n/9) » compte aussi les séries en quota, en erreur ou sans clé ;
  - libellé « clé requise » sur un bandeau mixte ;
  - tri `null` et `SansCle` sur Vercel non testés ;
  - modèle CHAIN recalculé deux fois par rendu ;
  - accessibilité du tableau CHAIN (`columnheader`, `aria-sort`) ;
  - `waitForTimeout` utilisé comme preuve négative ;
  - sélecteur `div.bg-surface`.

### Budget après la vague de correction finale

Commande : `pnpm check` (build `pnpm --filter @axiom/web build` de `scripts/ci.sh:35`, étape D de la vague ; JSON imprimé par `scripts/verifier-budget-build.mjs`, identique sur les deux passages de l'étape, avant `9f66edd` et avant le commit `docs(rapport)`).

```json
{
  "limites": {
    "octetsBruts": 1220000,
    "octetsGzip": 360000,
    "niveauGzip": 9
  },
  "initial": {
    "fichiers": [
      "assets/index-5JsoAXen.js",
      "assets/indicators-DMDb8A8f.js",
      "assets/vendor-klinecharts-B5HFhIGv.js",
      "assets/vendor-react-BPWy1Tn9.js"
    ],
    "octetsBruts": 1206265,
    "octetsGzip": 355686
  },
  "dynamique": {
    "fichiers": [
      "assets/BacktestWindow-MuZRCPNw.js",
      "assets/BriefWindow-DazAYtGr.js",
      "assets/BtcPowerLawWindow-BCpY7mzU.js",
      "assets/CbpremWindow-Bz7u_dkn.js",
      "assets/ChartSyncControls-C1z83N7t.js",
      "assets/CommandPalette-CWooJQfE.js",
      "assets/CorrWindow-BlJrasya.js",
      "assets/CotWindow-CrQThFZj.js",
      "assets/CycleWindow-DLn8LBg-.js",
      "assets/DataWindow-7zAQZJqK.js",
      "assets/DefillamaProPanel-BrD9aGCh.js",
      "assets/DerivativesWindow-DOwK3NCb.js",
      "assets/DistWindow-BZ23hiXM.js",
      "assets/DomWindow-B9ay6wYq.js",
      "assets/EcoWindow-Sbn8eWS4.js",
      "assets/EconomieChaines-Aqqa1Bsu.js",
      "assets/EvtsWindow-uOK4Bmzg.js",
      "assets/ExpyWindow-CIK9Skjt.js",
      "assets/FluxCapitaux-D2Q_OY5Q.js",
      "assets/FundWindow-B-G_7mnb.js",
      "assets/FundingMatrixWindow-B6PM2w6L.js",
      "assets/GlobeWindow-DrjpqTVw.js",
      "assets/LiquidationsWindow-CKQ2xprs.js",
      "assets/MacroRatesWindow-BBrfcLjF.js",
      "assets/MarketMapWindow-KW5Whmgc.js",
      "assets/McapWindow-BrxIYnE9.js",
      "assets/MineWindow-BpGcY9Zk.js",
      "assets/NetliqWindow-CFLZmnsC.js",
      "assets/NewsWindow-Bo5-EKKB.js",
      "assets/NotesWindow-CIjYrjv-.js",
      "assets/OnboardingOverlay-C0cBCcqf.js",
      "assets/OnchainWindow-BBdAG62X.js",
      "assets/OptionsWindow-BVLWzsjX.js",
      "assets/PaperWindow-BWHqWXOu.js",
      "assets/PortfolioWindow-Dq3zXRgT.js",
      "assets/QualiteMetrique-CY5YIKHO.js",
      "assets/ReplayWindow-BJ5aFEoF.js",
      "assets/ScenWindow-Rkiy8dq1.js",
      "assets/ScreenerWindow-BUGvP2Ks.js",
      "assets/SeasonalityWindow-B1_2hB6_.js",
      "assets/SectWindow-DwjE-4Fy.js",
      "assets/SettingsPanel-BKbIERHO.js",
      "assets/SqueezeWindow-ZC7sA_JC.js",
      "assets/StablecoinsWindow-CK_As6de.js",
      "assets/TableTriable-DR-9eKBE.js",
      "assets/TermStructureWindow-CdGcWsWX.js",
      "assets/VolWindow-DeMqqPvJ.js",
      "assets/WebGLSyncSpike-CYwoDPRH.js",
      "assets/WhalesWindow-t4wlEWSX.js",
      "assets/bgeometrics-DsnFNPLz.js",
      "assets/chart-sync-timeframes-CReN7yrx.js",
      "assets/composite-BRZzuF3o.js",
      "assets/corr-iDBvqMEW.js",
      "assets/cot-DAUYItK1.js",
      "assets/cryptoquant-BiPFeca_.js",
      "assets/cryptoquant-CL-Euadw.js",
      "assets/csv-DChTGBa8.js",
      "assets/defillamaKey-w65eMbpN.js",
      "assets/economieChaines-i_z13b0v.js",
      "assets/etherscan-DZMAmNgI.js",
      "assets/expy-3I9sQwqM.js",
      "assets/fluxCapitaux-BYBF7znl.js",
      "assets/fundingCrossExchange-DGhRx7_c.js",
      "assets/horloge-B5kycDh1.js",
      "assets/lienRetours-Bo4sHoSC.js",
      "assets/liquidationHeat-DcCDM5Lf.js",
      "assets/macroSeries-CgJwjFe8.js",
      "assets/mempool-BIizKZuY.js",
      "assets/onchainMetriques-CAvmVhUN.js",
      "assets/portRisque-D1OBcCE_.js",
      "assets/qualiteChain-B09JoMLq.js",
      "assets/squeezeWindow.util-b1SkKz1T.js",
      "assets/thermocap-ByFKPheH.js",
      "assets/treasuryYields-DdRuQ3ii.js",
      "assets/treemap-D9x5LE-E.js",
      "assets/tresoreriesBtc-BoXt6OFl.js",
      "assets/useDomaineZoom-Bxy48dSr.js",
      "assets/viewportSync-Dx3Gnz4B.js",
      "assets/volCone-BZveA2ku.js"
    ],
    "octetsBruts": 1018998,
    "octetsGzip": 373863
  }
}
```

Budget initial final, mesuré par `pnpm check` à l'étape D : **1 206 265 octets bruts / 355 686 gzip** (plafonds : 1 220 000 / 360 000).
- Fichiers initiaux : `index`, `indicators`, `vendor-klinecharts`, `vendor-react`. Aucun chunk CryptoQuant n'en fait partie.
- Évolution au fil de la vague :

| Étape | Gzip initial | Cause |
|---|---|---|
| Clôture `3fa31e6` et étape A | 355 637 | — |
| Étape B | 355 648 | hash des chunks CryptoQuant |
| Étape C | 355 686 | chunk `horloge` ajouté aux dépendances préchargées de DES |
| Étape D | 355 686 | inchangé : les e2e n'entrent pas dans le bundle |

- Marge locale : 4 314 gzip. Marge runner estimée : ≈ 3 076 gzip, pour un seuil de vigilance d'environ 3 000 (détail sous « Tableau du budget JS initial (avant/après) »).

### Contrôles

- `pnpm check`, avant `9f66edd` puis avant le commit `docs(rapport)` : **vert**. Typecheck OK, build OK.

  | Paquet | Fichiers | Tests |
  |---|---|---|
  | indicators | 206 | 780 |
  | alerts | 2 | 59 |
  | backtest | 4 | 95 |
  | daemon | 32 | 630 (0 échec) |
  | web | 340 | 4 643 |

- `AXIOM_E2E_PORT=5239 bash scripts/ci.sh --e2e`, sur `9f66edd` : **81 passed (1.8m)**, aucun échec ni nouvel essai. Parcours du lot :

```text
  ✓   1 [chromium] › e2e/chain-mineurs-cotes.e2e.ts:129:1 › CHAIN : mineurs cotés — neuf appels au montage, lecture et tri au dépliage, aucun appel ensuite (3.3s)
  ✓   2 [chromium] › e2e/chain-mineurs-cotes.e2e.ts:213:1 › CHAIN : mineurs cotés — une société en 503, Σ partielle et couverture 8/9 (1.2s)
  ✓   3 [chromium] › e2e/chain-mineurs-cotes.e2e.ts:241:1 › CHAIN : mineurs cotés — client CryptoQuant introuvable (import() rejeté), en-tête et vue le disent, aucun appel (720ms)
  ✓   9 [chromium] › e2e/des-flux-takers.e2e.ts:180:1 › DES : flux takers chargés au montage (4 appels), repliés par défaut, sans appel sur segmentés, source ni réouverture (1.4s)
  ✓  10 [chromium] › e2e/des-flux-takers.e2e.ts:265:1 › DES : archive locale antérieure fusionnée sans doublon, jours communs à la valeur fournisseur (début 2026-08-07) (589ms)
  ✓  11 [chromium] › e2e/des-flux-takers.e2e.ts:295:1 › DES : 429 CryptoQuant — délai de reprise affiché, archive servie et non réécrite (879ms)
  ✓  12 [chromium] › e2e/des-flux-takers.e2e.ts:323:1 › DES : 401 CryptoQuant — clé refusée affichée avec l'accès aux Réglages, un seul appel, rien d'archivé (923ms)
  ✓  13 [chromium] › e2e/des-flux-takers.e2e.ts:341:1 › DES : client CryptoQuant introuvable (import() rejeté) — en-tête et vue le disent, aucun appel, archive intacte (612ms)
```

- Serveur des parcours : Vite de développement (`pnpm dev --host 127.0.0.1`).
  - Le client est demandé à `/src/data/onchain/cryptoquant.ts` (ressource `script`, sans paramètre).
  - Les cas « client introuvable » répondent 404 sur ce chemin exact.
- Preuves rouges, par mutation temporaire annulée avant le commit :

  | Mutation | Parcours | Avant la vague | Avec les parcours de la vague |
  |---|---|---|---|
  | Court-circuit J-1 neutralisé | réouverture DES et CHAIN | verts | rouges : 8 appels au lieu de 4, 18 au lieu de 9 |
  | `fusionner` garde l'ancienne valeur | fusion DES | vert | rouge sur le 2026-08-17 |
  | `setEchecClient(true)` retiré | cas « client introuvable » | — | rouges : en-têtes « série non encore archivée » (DES) et « archive vide » (CHAIN) |

- Preuve manuelle du propriétaire : toujours en attente (voir sa section).
