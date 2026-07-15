import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

interface TestElementProps {
  children?: ReactNode;
  onClick?: () => void;
}

interface TestBoundaryState {
  error: Error | null;
  attempt: number;
}

function asElement(node: ReactNode): ReactElement<TestElementProps> {
  expect(isValidElement(node)).toBe(true);
  return node as ReactElement<TestElementProps>;
}

function fallbackParts(boundary: ErrorBoundary) {
  const outer = asElement(boundary.render());
  const panel = asElement(outer.props.children);
  const children = Children.toArray(panel.props.children);
  return {
    message: asElement(children[1]),
    button: asElement(children[2]),
  };
}

function installSynchronousSetState(boundary: ErrorBoundary): void {
  const testBoundary = boundary as unknown as {
    state: TestBoundaryState;
    setState: (
      update: Partial<TestBoundaryState> | ((state: TestBoundaryState) => Partial<TestBoundaryState>),
    ) => void;
  };
  testBoundary.setState = (update) => {
    const patch = typeof update === "function" ? update(testBoundary.state) : update;
    testBoundary.state = { ...testBoundary.state, ...patch };
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ErrorBoundary — récupération", () => {
  it("remonte localement le sous-arbre après une erreur de rendu", () => {
    const boundary = new ErrorBoundary({ scope: "Graphiques", children: <span>contenu</span> });
    boundary.state = { error: new Error("détail interne"), attempt: 0 };
    installSynchronousSetState(boundary);

    const { message, button } = fallbackParts(boundary);
    expect(message.props.children).toBe(
      "Une erreur inattendue a été isolée. Le reste du terminal reste actif.",
    );
    expect(button.props.children).toBe("Réessayer");

    button.props.onClick?.();
    expect(boundary.state).toEqual({ error: null, attempt: 1 });
  });

  it("recharge explicitement l’application pour une boundary de chunk", () => {
    const reload = vi.fn();
    vi.stubGlobal("window", { location: { reload } });
    const boundary = new ErrorBoundary({
      scope: "Fenêtre",
      compact: true,
      recovery: "reload",
      children: <span>contenu lazy</span>,
    });
    boundary.state = { error: new Error("Failed to fetch dynamically imported module"), attempt: 0 };

    const { message, button } = fallbackParts(boundary);
    expect(message.props.children).toBe(
      "Ce module n’a pas pu être chargé. Rechargez l’application pour réessayer.",
    );
    expect(button.props.children).toBe("Recharger l’application");

    button.props.onClick?.();
    expect(reload).toHaveBeenCalledOnce();
    expect(boundary.state.error).not.toBeNull();
  });
});
