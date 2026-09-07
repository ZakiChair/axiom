/** Origine isolée, commune au serveur et aux fixtures réseau. Un port occupé échoue. */
const port = Number(process.env.AXIOM_E2E_PORT ?? "5197");
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("AXIOM_E2E_PORT doit être un port entier entre 1024 et 65535.");
}
export const E2E_PORT = port;
export const E2E_ORIGINE = `http://127.0.0.1:${port}`;
export const E2E_WS_ORIGINE = `ws://127.0.0.1:${port}`;
