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
        bg: "rgb(var(--bg-rgb) / <alpha-value>)",
        surface: "rgb(var(--surface-rgb) / <alpha-value>)",
        border: "rgb(var(--border-rgb) / <alpha-value>)",
        text: {
          DEFAULT: "rgb(var(--text-rgb) / <alpha-value>)",
          dim: "rgb(var(--text-dim-rgb) / <alpha-value>)",
        },
        up: "rgb(var(--up-rgb) / <alpha-value>)",
        down: "rgb(var(--down-rgb) / <alpha-value>)",
        accent: "rgb(var(--accent-rgb) / <alpha-value>)",
        // Encre sombre/claire posée SUR un fond d'accent vif (boutons actifs).
        "accent-ink": "rgb(var(--accent-ink-rgb) / <alpha-value>)",
        grid: "rgb(var(--grid-rgb) / <alpha-value>)",
        crosshair: "rgb(var(--crosshair-rgb) / <alpha-value>)",

        // Couleurs de série (courbes/valeurs multi-séries non sémantiques),
        // réinterprétées par thème : text-serie-1, bg-serie-3, …
        serie: {
          1: "rgb(var(--serie-1-rgb) / <alpha-value>)",
          2: "rgb(var(--serie-2-rgb) / <alpha-value>)",
          3: "rgb(var(--serie-3-rgb) / <alpha-value>)",
          4: "rgb(var(--serie-4-rgb) / <alpha-value>)",
          5: "rgb(var(--serie-5-rgb) / <alpha-value>)",
          6: "rgb(var(--serie-6-rgb) / <alpha-value>)",
        },

        // Rampe `neutral` repointée sur les variables de thème (--n-*) : tout le
        // chrome historique (bg-neutral-950, border-neutral-800,
        // hover:bg-neutral-700, text-neutral-300…) suit AUTOMATIQUEMENT le thème,
        // sans toucher aux composants. Merge partiel : la nuance 50 (inutilisée)
        // garde la valeur Tailwind par défaut.
        neutral: {
          100: "rgb(var(--n-100-rgb) / <alpha-value>)",
          200: "rgb(var(--n-200-rgb) / <alpha-value>)",
          300: "rgb(var(--n-300-rgb) / <alpha-value>)",
          400: "rgb(var(--n-400-rgb) / <alpha-value>)",
          500: "rgb(var(--n-500-rgb) / <alpha-value>)",
          600: "rgb(var(--n-600-rgb) / <alpha-value>)",
          700: "rgb(var(--n-700-rgb) / <alpha-value>)",
          800: "rgb(var(--n-800-rgb) / <alpha-value>)",
          900: "rgb(var(--n-900-rgb) / <alpha-value>)",
          950: "rgb(var(--n-950-rgb) / <alpha-value>)",
        },
        // Accents fonctionnels des bascules toolbar, réinterprétés par thème :
        // emerald = Timeframe actif / boutons « Enregistrer », cyan = Orderflow,
        // amber = Profil Vol. (Seules les nuances réellement utilisées.)
        emerald: {
          400: "rgb(var(--ui-emerald-hover-rgb) / <alpha-value>)",
          500: "rgb(var(--ui-emerald-rgb) / <alpha-value>)",
        },
        cyan: {
          500: "rgb(var(--ui-cyan-rgb) / <alpha-value>)",
        },
        amber: {
          500: "rgb(var(--ui-amber-rgb) / <alpha-value>)",
        },
        // Rôle sémantique « avertissement » (daemon dégradé, cache, partiel) :
        // alias de l'accent ambre thémé — voir Task 2.
        warn: "rgb(var(--ui-amber-rgb) / <alpha-value>)",
      },
    },
  },
  plugins: [],
};
