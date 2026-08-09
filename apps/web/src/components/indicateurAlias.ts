/**
 * Alias FRANÇAIS des indicateurs — le catalogue est intégralement en sigles anglais
 * (EMA, SMA, ATR, OBV…) alors que tout le terminal est en français : chercher
 * « moyenne mobile » dans un menu de 152 entrées renvoyait ZÉRO résultat
 * (revue du 2026-08-01 § 6.2, vérifié dans le navigateur).
 *
 * Table locale au menu plutôt qu'un champ sur `IndicatorDef` : c'est une affaire de
 * RECHERCHE, pas de définition — et elle n'a pas à traverser le paquet de calcul.
 * Clé = `IndicatorDef.id`. Les termes sont écrits sans accent ET sans casse : la
 * comparaison passe par `normaliser`, donc « écart-type » trouve « ecart type ».
 */

/** Minuscules, sans accents, tirets et apostrophes ramenés à l'espace. PURE. */
export function normaliser(texte: string): string {
  return texte
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’\-_/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Termes français par `defId`. Un même indicateur peut en porter plusieurs. */
export const ALIAS_INDICATEURS: Readonly<Record<string, readonly string[]>> = {
  // Moyennes — la famille la plus cherchée, et la moins trouvable.
  sma: ["moyenne mobile simple", "moyenne mobile", "moyenne"],
  ema: ["moyenne mobile exponentielle", "moyenne mobile", "moyenne"],
  wma: ["moyenne mobile ponderee", "moyenne mobile", "moyenne"],
  hma: ["moyenne mobile de hull", "moyenne mobile", "moyenne"],
  dema: ["moyenne mobile double exponentielle", "moyenne mobile", "moyenne"],
  tema: ["moyenne mobile triple exponentielle", "moyenne mobile", "moyenne"],
  zlema: ["moyenne mobile sans retard", "moyenne mobile", "moyenne"],
  vwma: ["moyenne mobile ponderee par le volume", "moyenne mobile", "moyenne"],
  gmma: ["faisceaux de moyennes", "guppy", "moyenne mobile"],
  vwap: ["prix moyen pondere par le volume", "prix moyen"],

  // Volatilité et bandes.
  bollinger: ["bandes de bollinger", "bandes", "volatilite"],
  keltner: ["canaux de keltner", "canaux", "volatilite"],
  donchian: ["canaux de donchian", "canaux", "plus haut plus bas"],
  atr: ["volatilite moyenne", "amplitude vraie moyenne", "volatilite"],
  atrPct: ["volatilite en pourcentage", "volatilite"],
  historicalVol: ["volatilite historique", "volatilite realisee", "ecart type"],
  stddev: ["ecart type", "dispersion"],

  // Momentum et oscillateurs.
  rsi: ["force relative", "surachat survente", "oscillateur"],
  stochastic: ["stochastique", "surachat survente", "oscillateur"],
  stochRsi: ["stochastique du rsi", "surachat survente", "oscillateur"],
  macd: ["convergence divergence des moyennes", "oscillateur"],
  cci: ["indice du canal des matieres premieres", "oscillateur"],
  williamsR: ["williams pourcent r", "surachat survente", "oscillateur"],
  roc: ["taux de variation", "momentum", "variation"],
  momentum: ["elan", "momentum"],
  adx: ["force de la tendance", "tendance", "directionnel"],

  // Volume et flux d'ordres.
  volume: ["volume", "quantite echangee"],
  obv: ["volume cumule", "volume equilibre", "flux"],
  cvd: ["delta de volume cumule", "flux acheteur vendeur", "flux"],
  mfi: ["flux monetaire", "flux"],
  vwapBands: ["bandes de prix moyen", "prix moyen"],

  // Tendance et retournements.
  supertrend: ["suivi de tendance", "tendance", "retournement"],
  psar: ["parabolique", "retournement", "tendance"],
  ichimoku: ["nuage", "kumo", "tendance"],
  zigzag: ["zig zag", "retournement", "vagues"],
  pivotHighLow: ["points pivots", "sommets et creux", "retournement"],
  fractals: ["fractales", "sommets et creux"],
};

/**
 * Une définition correspond-elle à la requête ? Cherche dans le nom, l'id, le libellé
 * de catégorie ET les alias français. PURE, testée.
 */
export function correspondAlias(defId: string, requeteNormalisee: string): boolean {
  if (requeteNormalisee === "") return false;
  const alias = ALIAS_INDICATEURS[defId];
  if (!alias) return false;
  return alias.some((a) => a.includes(requeteNormalisee));
}
