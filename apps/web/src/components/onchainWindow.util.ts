/**
 * Utilitaires PURS de la fenêtre « On-chain » (CHAIN). Séparés du composant pour rester
 * testables hors navigateur (convention repo : la logique de formatage/sélection est
 * testée unitairement, le canvas/DOM ne l'est pas).
 */

/**
 * Formate un hashrate exprimé en TH/s (unité amont BGeometrics/bitcoin-data.com) en
 * l'unité lisible selon sa magnitude, à 3 CHIFFRES SIGNIFICATIFS, sans notation
 * scientifique :
 *   ≥ 1e6 TH/s → EH/s (÷1e6)   ex. 9.18e8 TH/s → « 918 EH/s »
 *   ≥ 1e3 TH/s → PH/s (÷1e3)   ex. 5.5e5  TH/s → « 550 PH/s »
 *   sinon        TH/s          ex. 9.18e2 TH/s → « 918 TH/s »
 * PURE. `undefined` / `null` / non-fini → « — ».
 */
export function formatHashrate(ths: number | null | undefined): string {
  if (ths === null || ths === undefined || !Number.isFinite(ths)) return "—";
  const abs = Math.abs(ths);
  let valeur: number;
  let unite: string;
  if (abs >= 1e6) {
    valeur = ths / 1e6;
    unite = "EH/s";
  } else if (abs >= 1e3) {
    valeur = ths / 1e3;
    unite = "PH/s";
  } else {
    valeur = ths;
    unite = "TH/s";
  }
  return `${arrondirSignificatif(valeur, 3)} ${unite}`;
}

/**
 * Arrondit `v` à `sig` chiffres significatifs et le rend en notation FIXE (jamais
 * scientifique). Les valeurs ≥ 10^sig gardent leur partie entière (0 décimale).
 * PURE.
 */
function arrondirSignificatif(v: number, sig: number): string {
  if (v === 0) return "0";
  const chiffresEntiers = Math.floor(Math.log10(Math.abs(v))) + 1;
  const decimales = Math.max(0, sig - chiffresEntiers);
  return v.toFixed(decimales);
}
