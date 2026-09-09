# Archives de publications économiques

Le bouton **Importer archive** de la fenêtre EVTS lit un document JSON version 2. Il est
validé entièrement avant toute écriture locale : les champs inconnus, les URLs avec
identifiants, les dates impossibles, les identités incohérentes et les consensus collectés
après l'annonce sont refusés.

L'exemple ci-dessous est une structure illustrative, non vérifiée : `example.org` ne
désigne aucune source de publication réelle.

```json
{
  "version": 2,
  "archives": [
    {
      "id": "cpi-2026-07",
      "type": "cpi",
      "mesure": "cpi-global-mm-sa",
      "country": "USD",
      "period": "2026-07",
      "publishedAt": 1786537800000,
      "timeApprox": false,
      "source": { "nom": "Organisme émetteur", "url": "https://example.org/release" },
      "actual": { "label": "CPI global m/m SA", "value": 0.1, "unit": "%", "transformation": "m/m SA" },
      "consensusAvantAnnonce": null
    }
  ],
  "capturesConsensus": []
}
```

Les paires `type` / `mesure` admises sont strictes : `cpi` / `cpi-global-mm-sa`, `nfp` /
`nfp-payems-change`, `pce` / `pce-core-mm-sa`, et `retail` / `retail-nominal-mm`. Une capture
de consensus contient aussi `title`, `publishedAt`, `timeApprox`, `consensus`, `source` et
`collectedAt`; `collectedAt` doit précéder strictement `publishedAt`. La première capture
valide d'une même annonce est conservée.

La surprise est affichée seulement si l'unité est comparable : NFP en milliers avec un
consensus `K`, ou inflation/vente en pourcentage avec un consensus `%`. Elle vaut
`actual − consensus`; les niveaux PAYEMS ALFRED ne servent jamais de variation NFP.
