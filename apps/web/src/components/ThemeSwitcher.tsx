/**
 * ThemeSwitcher — sélecteur de thème pour la toolbar.
 *
 * Une pastille par thème (aperçu de palette en dégradé) ; un clic appelle
 * `setTheme` du `themeStore` (vanilla), qui pose [data-theme] sur <html> et
 * persiste le choix. Aucun re-render du canvas : Chart.tsx s'abonne au store et
 * réapplique les couleurs de façon impérative.
 */
import { useStore } from "zustand";
import { themeStore, THEMES, type ThemeId } from "../store/theme";

/** Libellé + aperçu (dégradé représentatif fond -> accent) de chaque thème. */
const THEME_META: Record<ThemeId, { label: string; swatch: string }> = {
  dark: { label: "Dark", swatch: "linear-gradient(135deg, #0a0a0a 0%, #10b981 100%)" },
  bloomberg: { label: "Bloomberg", swatch: "linear-gradient(135deg, #000000 0%, #ff9e00 100%)" },
  matrix: { label: "Matrix", swatch: "linear-gradient(135deg, #000000 0%, #00ff41 100%)" },
  cute: { label: "Cute", swatch: "linear-gradient(135deg, #fce7f3 0%, #d946ef 100%)" },
  aurora: { label: "Aurora", swatch: "linear-gradient(135deg, #22d3ee 0%, #a78bfa 100%)" },
};

export function ThemeSwitcher() {
  const theme = useStore(themeStore, (s) => s.theme);
  const setTheme = useStore(themeStore, (s) => s.setTheme);

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Thème">
      {THEMES.map((id) => {
        const meta = THEME_META[id];
        const active = theme === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setTheme(id)}
            aria-pressed={active}
            title={meta.label}
            className={`h-5 w-5 rounded border transition ${
              active
                ? "border-neutral-100 ring-1 ring-neutral-100"
                : "border-neutral-700 hover:border-neutral-400"
            }`}
            style={{ backgroundImage: meta.swatch }}
          >
            <span className="sr-only">{meta.label}</span>
          </button>
        );
      })}
    </div>
  );
}
