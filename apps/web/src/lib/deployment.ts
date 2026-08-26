export type AxiomDeployment = "local" | "vercel";

export function isVercelDeployment(value: unknown): value is "vercel" {
  return value === "vercel";
}

export const IS_VERCEL = isVercelDeployment(import.meta.env.VITE_AXIOM_DEPLOYMENT);
