import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Configuration Vite minimale : plugin React (Fast Refresh + JSX).
// La résolution des packages workspace (@axiom/types) passe par les symlinks pnpm.
export default defineConfig({
  plugins: [react()],
});
