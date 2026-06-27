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
        // Encre sombre/claire posée SUR un fond d'accent vif (boutons actifs).
        "accent-ink": "var(--accent-ink)",
        grid: "var(--grid)",
        crosshair: "var(--crosshair)",

        // Rampe `neutral` repointée sur les variables de thème (--n-*) : tout le
        // chrome historique (bg-neutral-950, border-neutral-800,
        // hover:bg-neutral-700, text-neutral-300…) suit AUTOMATIQUEMENT le thème,
        // sans toucher aux composants. Merge partiel : la nuance 50 (inutilisée)
        // garde la valeur Tailwind par défaut.
        neutral: {
          100: "var(--n-100)",
          200: "var(--n-200)",
          300: "var(--n-300)",
          400: "var(--n-400)",
          500: "var(--n-500)",
          600: "var(--n-600)",
          700: "var(--n-700)",
          800: "var(--n-800)",
          900: "var(--n-900)",
          950: "var(--n-950)",
        },
        // Accents fonctionnels des bascules toolbar, réinterprétés par thème :
        // emerald = Timeframe actif / boutons « Enregistrer », cyan = Orderflow,
        // amber = Profil Vol. (Seules les nuances réellement utilisées.)
        emerald: {
          400: "var(--ui-emerald-hover)",
          500: "var(--ui-emerald)",
        },
        cyan: {
          500: "var(--ui-cyan)",
        },
        amber: {
          500: "var(--ui-amber)",
        },
      },
    },
  },
  plugins: [],
};
