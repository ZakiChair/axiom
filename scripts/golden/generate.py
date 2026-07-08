#!/usr/bin/env python3
"""
scripts/golden/generate.py

Oracle de référence UNIQUEMENT (voir BUILD-CONTRACT.md) : ce script pandas-ta-classic
sert à (re)générer, une fois, les fixtures JSON committées dans
`packages/indicators/src/golden/`. Il n'est JAMAIS exécuté par la suite vitest —
`golden.test.ts` compare notre moteur TS pur aux fichiers `.golden.json` déjà écrits.

Usage :
    pip install pandas-ta-classic
    python3 scripts/golden/generate.py

Lit `packages/indicators/src/golden/fixture-ohlcv.json` (300 bougies figées,
committées) et écrit un fichier `{indicateur}.golden.json` par indicateur dans le
même dossier, au format :
    { "params": {...}, "series": { "nomColonnePandasTa": [number|null, ...] } }
"""

import json
import math
import pathlib

import pandas as pd
import pandas_ta_classic as ta

ROOT = pathlib.Path(__file__).resolve().parents[2]
GOLDEN_DIR = ROOT / "packages" / "indicators" / "src" / "golden"
FIXTURE_PATH = GOLDEN_DIR / "fixture-ohlcv.json"


def load_fixture() -> pd.DataFrame:
    with open(FIXTURE_PATH) as f:
        candles = json.load(f)
    return pd.DataFrame(candles)


def series_to_list(s: pd.Series) -> list:
    """Convertit une Series pandas en liste JSON-safe (NaN -> null)."""
    out = []
    for v in s.tolist():
        if v is None or (isinstance(v, float) and math.isnan(v)):
            out.append(None)
        else:
            out.append(float(v))
    return out


def write_golden(name: str, params: dict, series: dict) -> None:
    payload = {"params": params, "series": series}
    path = GOLDEN_DIR / f"{name}.golden.json"
    with open(path, "w") as f:
        json.dump(payload, f, indent=2)
    print(f"écrit {path.relative_to(ROOT)}")


def main() -> None:
    df = load_fixture()
    high, low, close = df["high"], df["low"], df["close"]

    # --- ADX(14) ---
    adx_params = {"length": 14}
    adx_df = ta.adx(high, low, close, length=adx_params["length"])
    write_golden(
        "adx",
        adx_params,
        {
            "ADX_14": series_to_list(adx_df["ADX_14"]),
            "DMP_14": series_to_list(adx_df["DMP_14"]),
            "DMN_14": series_to_list(adx_df["DMN_14"]),
        },
    )

    # --- SUPERTREND(10,3) ---
    st_params = {"length": 10, "multiplier": 3}
    st_df = ta.supertrend(
        high, low, close, length=st_params["length"], multiplier=st_params["multiplier"]
    )
    write_golden(
        "supertrend",
        st_params,
        {
            "SUPERT_10_3.0": series_to_list(st_df["SUPERT_10_3.0"]),
            "SUPERTd_10_3.0": series_to_list(st_df["SUPERTd_10_3.0"]),
        },
    )

    # --- ICHIMOKU(9,26,52) ---
    ich_params = {"tenkan": 9, "kijun": 26, "senkou": 52, "displacement": 26}
    ich_df, _span_df = ta.ichimoku(
        high,
        low,
        close,
        tenkan=ich_params["tenkan"],
        kijun=ich_params["kijun"],
        senkou=ich_params["senkou"],
    )
    write_golden(
        "ichimoku",
        ich_params,
        {
            "ITS_9": series_to_list(ich_df["ITS_9"]),
            "IKS_26": series_to_list(ich_df["IKS_26"]),
            "ISA_9": series_to_list(ich_df["ISA_9"]),
            "ISB_26": series_to_list(ich_df["ISB_26"]),
            "ICS_26": series_to_list(ich_df["ICS_26"]),
        },
    )

    # --- PSAR(0.02, 0.2) ---
    # NB : `close` volontairement NON passé à ta.psar() — avec `close`, pandas-ta
    # amorce le SAR à close[0] et classe long/short par comparaison au close ;
    # notre implémentation (psar.ts) amorce au plus bas/haut de la bougie 0 et ne
    # lit jamais `close` dans sa boucle. Omettre `close` aligne l'oracle sur notre
    # convention (SAR pur high/low, cf. Wilder original).
    psar_params = {"step": 0.02, "max": 0.2}
    psar_df = ta.psar(
        high, low, af0=psar_params["step"], af=psar_params["step"], max_af=psar_params["max"]
    )
    write_golden(
        "psar",
        psar_params,
        {
            "PSARl_0.02_0.2": series_to_list(psar_df["PSARl_0.02_0.2"]),
            "PSARs_0.02_0.2": series_to_list(psar_df["PSARs_0.02_0.2"]),
        },
    )


if __name__ == "__main__":
    main()
