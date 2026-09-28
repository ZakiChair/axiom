import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

/** Parcours téléphones isolés du gate bureau, avec les deux moteurs mobiles. */
export default defineConfig({
  ...base,
  testMatch: "**/mobile*.e2e.ts",
  testIgnore: [],
  projects: [
    { name: "chromium-phone", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
    { name: "webkit-phone", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } },
  ],
});
