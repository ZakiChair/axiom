/**
 * Capabilities du daemon `axiomd` — SOURCE UNIQUE partagée entre le serveur
 * (apps/daemon/src/index.ts, annoncées sur /health) et le client (apps/web/src/data/
 * daemon.ts, exigées par les appelants). Toute capability ajoutée au daemon doit
 * l'être ici, sinon le client ne pourra jamais la requérir (et inversement).
 *
 * Même mécanisme de partage que shared/extapi-hosts.ts : fichier relatif, ajouté à
 * l'`include` des deux tsconfig (web + daemon).
 */
export const DAEMON_CAPABILITIES = [
  "kv",
  "candles",
  "liquidations",
  "alerts",
  "replay",
  "globe",
  "snapshots",
  "proxy",
] as const;

export type DaemonCapability = (typeof DAEMON_CAPABILITIES)[number];
