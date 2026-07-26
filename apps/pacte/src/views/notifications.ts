export type Notification = {
  id: number;
  kind: "success" | "error";
  message: string;
};

export type ContextToken = Readonly<{
  contextId: string | undefined;
  generation: number;
}>;

export type ContextNotification = Notification & { context: ContextToken };

export function nextNotification(
  current: Notification | null,
  kind: Notification["kind"],
  message: string,
): Notification {
  return { id: (current?.id ?? 0) + 1, kind, message };
}

export function advanceContextToken(
  current: ContextToken,
  contextId: string | undefined,
): ContextToken {
  return { contextId, generation: current.generation + 1 };
}

export function deliverContextNotification(
  current: ContextNotification | null,
  activeContext: ContextToken,
  originContext: ContextToken,
  kind: Notification["kind"],
  message: string,
): ContextNotification | null {
  if (
    activeContext.contextId !== originContext.contextId
    || activeContext.generation !== originContext.generation
  ) return current;
  return { ...nextNotification(current, kind, message), context: originContext };
}

export function consumeNotification(_current: Notification | null): null {
  return null;
}

export function notificationForContext(
  current: ContextNotification | null,
  contextId: string,
): ContextNotification | null {
  return current?.context.contextId === contextId ? current : null;
}
