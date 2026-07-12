/**
 * Lecture MINIMALE d'un .zip GDELT : un seul fichier, compressé en DEFLATE brut.
 * On parse l'en-tête local (signature PK\x03\x04) puis inflateRawSync — zéro
 * dépendance npm. Vérifié empiriquement le 2026-07-12 sur une vraie tranche
 * (20260712001500.export.CSV.zip : 1243 lignes × 61 colonnes après dézippage).
 * Les zips à data-descriptor (tailles absentes de l'en-tête local, bit 3 des
 * drapeaux) sont rejetés explicitement — GDELT n'en produit pas.
 */
import { inflateRawSync } from "node:zlib";

const SIGNATURE_LOCALE = 0x04034b50;
const METHODE_STOCKE = 0;
const METHODE_DEFLATE = 8;

/** Extrait (et décompresse si besoin) le premier fichier d'un .zip mono-fichier. */
export function extraireFichierZip(zip: Uint8Array): Uint8Array {
  if (zip.byteLength < 30) throw new Error("zip tronqué (moins de 30 octets)");
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  if (dv.getUint32(0, true) !== SIGNATURE_LOCALE) throw new Error("signature d'en-tête local ZIP absente");
  const drapeaux = dv.getUint16(6, true);
  if ((drapeaux & 0x8) !== 0) throw new Error("zip à data-descriptor non géré");
  const methode = dv.getUint16(8, true);
  const tailleComp = dv.getUint32(18, true);
  const tailleNom = dv.getUint16(26, true);
  const tailleExtra = dv.getUint16(28, true);
  const debut = 30 + tailleNom + tailleExtra;
  if (tailleComp === 0 || debut + tailleComp > zip.byteLength) throw new Error("tailles d'en-tête local ZIP incohérentes");
  const donnees = zip.slice(debut, debut + tailleComp);
  if (methode === METHODE_STOCKE) return donnees;
  if (methode !== METHODE_DEFLATE) throw new Error(`méthode de compression zip ${methode} non gérée`);
  return new Uint8Array(inflateRawSync(donnees));
}
