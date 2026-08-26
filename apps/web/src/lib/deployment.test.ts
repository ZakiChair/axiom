import { describe, expect, it } from "vitest";
import { IS_VERCEL, isVercelDeployment } from "./deployment";

describe("isVercelDeployment", () => {
  it("reconnaît uniquement la valeur build-time vercel", () => {
    expect(isVercelDeployment("vercel")).toBe(true);
    expect(isVercelDeployment("local")).toBe(false);
    expect(isVercelDeployment("VERCEL")).toBe(false);
    expect(isVercelDeployment(true)).toBe(false);
    expect(isVercelDeployment(undefined)).toBe(false);
  });

  it("expose une constante booléenne", () => {
    expect(typeof IS_VERCEL).toBe("boolean");
  });
});
