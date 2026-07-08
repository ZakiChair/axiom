# Golden tests — oracle pandas-ta-classic

Génération HORS-LIGNE des fixtures de non-régression numérique pour 4 défs de
`@axiom/indicators` : `adx`, `supertrend`, `ichimoku`, `psar`.

**Important (BUILD-CONTRACT.md)** : `pandas-ta-classic` n'est JAMAIS une
dépendance runtime. Ce script Python ne sert qu'à (re)générer, une fois, les
JSON committés dans `packages/indicators/src/golden/*.golden.json`. La suite
`vitest` (`packages/indicators/src/golden/golden.test.ts`) ne lit que ces
fichiers déjà générés — elle ne lance jamais Python.

## Installation

```bash
cd scripts/golden
python3 -m venv .venv          # environnement virtuel local, jamais committé
.venv/bin/pip install pandas-ta-classic
```

## (Re)générer les golden

```bash
scripts/golden/.venv/bin/python3 scripts/golden/generate.py
```

Lit `packages/indicators/src/golden/fixture-ohlcv.json` (300 bougies figées,
committées) et réécrit :

- `packages/indicators/src/golden/adx.golden.json`
- `packages/indicators/src/golden/supertrend.golden.json`
- `packages/indicators/src/golden/ichimoku.golden.json`
- `packages/indicators/src/golden/psar.golden.json`

Chaque fichier a la forme `{ params, series: { colonnePandasTa: (number|null)[] } }`.

À ne relancer QUE si `fixture-ohlcv.json` change ou si les paramètres testés
évoluent — sinon les golden committés suffisent, et sont ce que
`golden.test.ts` compare.

## Colonnes pandas-ta-classic utilisées

| Indicateur   | Appel                                            | Colonnes                                  |
| ------------ | ------------------------------------------------- | ------------------------------------------ |
| `adx`        | `ta.adx(high, low, close, length=14)`              | `ADX_14`, `DMP_14`, `DMN_14`                |
| `supertrend` | `ta.supertrend(high, low, close, length=10, multiplier=3)` | `SUPERT_10_3.0`, `SUPERTd_10_3.0`   |
| `ichimoku`   | `ta.ichimoku(high, low, close, tenkan=9, kijun=26, senkou=52)` | `ITS_9`, `IKS_26`, `ISA_9`, `ISB_26`, `ICS_26` |
| `psar`       | `ta.psar(high, low, af0=0.02, af=0.02, max_af=0.2)` (SANS `close`, voir commentaire dans `generate.py`) | `PSARl_0.02_0.2`, `PSARs_0.02_0.2` |

Version testée : `pandas-ta-classic==0.6.52` (Python 3.14).
