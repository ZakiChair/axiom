import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Nom fonctionnel affiché et journalisé, sans exposer de détails internes à l'écran. */
  scope: string;
  /** Les boundaries embarquées dans une fenêtre utilisent une présentation compacte. */
  compact?: boolean;
  /**
   * Une promesse rejetée par `React.lazy` reste mémorisée par React : remonter le même
   * composant ne peut pas la relancer. Les boundaries qui entourent un chunk doivent donc
   * proposer un vrai rechargement de page ; les erreurs de rendu gardent le retry local.
   */
  recovery?: "retry" | "reload";
}

interface ErrorBoundaryState {
  error: Error | null;
  attempt: number;
}

/**
 * Dernier rempart React : une erreur de rendu ou de chunk ne doit jamais faire tomber
 * tout le terminal. Le retry force le remontage du sous-arbre ; les chunks rejetés utilisent
 * un rechargement explicite, seul moyen fiable de réinitialiser le cache de `React.lazy`.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[AXIOM] Erreur React isolée (${this.props.scope})`, error, info.componentStack);
  }

  private readonly retry = (): void => {
    this.setState((state) => ({ error: null, attempt: state.attempt + 1 }));
  };

  private readonly recover = (): void => {
    if (this.props.recovery === "reload") {
      window.location.reload();
      return;
    }
    this.retry();
  };

  override render(): ReactNode {
    const { error, attempt } = this.state;
    if (error === null) return <Fragment key={attempt}>{this.props.children}</Fragment>;

    const requiresReload = this.props.recovery === "reload";
    const classes = this.props.compact
      ? "m-3 rounded border border-down/40 bg-bg p-3 text-[11px] text-down"
      : "flex h-full min-h-48 w-full items-center justify-center bg-bg p-6 text-text";

    return (
      <div className={classes} role="alert">
        <div className={this.props.compact ? "" : "max-w-lg rounded border border-down/40 bg-surface p-5"}>
          <p className="font-semibold">{this.props.scope} indisponible</p>
          <p className="mt-1 text-text-dim">
            {requiresReload
              ? "Ce module n’a pas pu être chargé. Rechargez l’application pour réessayer."
              : "Une erreur inattendue a été isolée. Le reste du terminal reste actif."}
          </p>
          <button
            type="button"
            onClick={this.recover}
            className="mt-3 rounded border border-border px-2 py-1 text-text-dim hover:text-text"
          >
            {requiresReload ? "Recharger l’application" : "Réessayer"}
          </button>
        </div>
      </div>
    );
  }
}
