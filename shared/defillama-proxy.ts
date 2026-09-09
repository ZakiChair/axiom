export const DEFILLAMA_PRO_HOST = "pro-api.llama.fi";
export const DEFILLAMA_PRO_HEADER = "x-defillama-pro-key";

/** Traduit l'URL locale dédiée vers l'un des trois contrats Pro, sans credential. */
export function cheminDefillamaAmont(pathname: string, search = ""): string | null {
  const local = pathname.replace(/^\/defillamapro\/?/, "");
  if (local === "emissions" && search === "") return "/api/emissions";
  const emission = /^emission\/([a-z0-9][a-z0-9-]{0,79})$/i.exec(local);
  if (emission && search === "") return `/api/emission/${emission[1]}`;
  const bridge = /^bridgevolume\/([A-Za-z0-9][A-Za-z0-9_-]{0,79})$/.exec(local);
  if (!bridge) return null;
  const params = new URLSearchParams(search);
  if ([...params.keys()].some((k) => k !== "id") || params.getAll("id").length > 1) return null;
  const id = params.get("id");
  if (id !== null && (!/^\d{1,9}$/.test(id) || Number(id) < 1)) return null;
  return `/bridges/bridgevolume/${bridge[1]}${id ? `?id=${id}` : ""}`;
}

export function cleDefillamaValide(value: string | null): value is string {
  return value !== null && /^[A-Za-z0-9_-]{8,256}$/.test(value);
}

export function redigerSecretDefillama(message: unknown, key: string): string {
  return String(message).split(key).join("***").replace(/pro-api\.llama\.fi\/[^/\s]+/gi, "pro-api.llama.fi/***");
}
