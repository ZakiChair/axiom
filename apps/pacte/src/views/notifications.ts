export type Notification = {
  id: number;
  kind: "success" | "error";
  message: string;
};

export type ContextNotification = Notification & { contextId: string };

export function nextNotification(
  current: Notification | null,
  kind: Notification["kind"],
  message: string,
): Notification {
  return { id: (current?.id ?? 0) + 1, kind, message };
}

export function deliverContextNotification(
  current: ContextNotification | null,
  activeContextId: string | undefined,
  originContextId: string,
  kind: Notification["kind"],
  message: string,
): ContextNotification | null {
  if (activeContextId !== originContextId) return current;
  return { ...nextNotification(current, kind, message), contextId: originContextId };
}

export function consumeNotification(_current: Notification | null): null {
  return null;
}

export function notificationForContext(
  current: ContextNotification | null,
  contextId: string,
): ContextNotification | null {
  return current?.contextId === contextId ? current : null;
}
