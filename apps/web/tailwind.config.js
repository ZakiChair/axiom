/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Tokens sémantiques pilotés par les variables CSS (un set par thème via
      // [data-theme] sur :root, cf. src/index.css). On passe par `extend` : la
      // palette Tailwind PAR DÉFAUT est CONSERVÉE — les classes existantes
      // (neutral-*, emerald-*, cyan-*, red-*) ne cassent pas. Ces noms ajoutent
      // de NOUVELLES utilitaires : bg-bg, bg-surface, border-border, text-text,
      // text-text-dim, text-up, text-down, text-accent, bg-accent, …
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        border: "var(--border)",
        text: {
          DEFAULT: "var(--text)",
          dim: "var(--text-dim)",
        },
        up: "var(--up)",
        down: "var(--down)",
        accent: "var(--accent)",
        grid: "var(--grid)",
        crosshair: "var(--crosshair)",
      },
    },
  },
  plugins: [],
};
