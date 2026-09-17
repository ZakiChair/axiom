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
paix reste le runner GitHub (marge runner ≈ 3 365 gzip au 2026-09-16). Seuls les plafonds du
script sont bloquants ; delta initial attendu ≤ ~40 octets gzip par sous-lot (nom du chunk
partagé du store ajouté à `__vite__mapDeps`), porte d'acceptation ≤ ~150 octets gzip sur
l'ensemble de B1 ; si la marge runner tombait sous ~3 000 gzip, retirer d'abord le libellé
DATA.

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
