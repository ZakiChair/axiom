export type Notification = {
  id: number;
  kind: "success" | "error";
  message: string;
};

export function nextNotification(
  current: Notification | null,
  kind: Notification["kind"],
  message: string,
): Notification {
  return { id: (current?.id ?? 0) + 1, kind, message };
}
