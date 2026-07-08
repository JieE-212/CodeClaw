export const tickets = [
  { id: "S-1001", subject: "Billing receipt missing", status: "open", assignee: "Nora", channel: "email", priority: "high", unread: true },
  { id: "S-1002", subject: "Cannot invite teammate", status: "pending", assignee: "Luis", channel: "chat", priority: "medium", unread: true },
  { id: "S-1003", subject: "Export finished late", status: "open", assignee: "Nora", channel: "chat", priority: "low", unread: false },
  { id: "S-1004", subject: "Invoice address update", status: "closed", assignee: "Mika", channel: "email", priority: "medium", unread: false },
  { id: "S-1005", subject: "Webhook retry question", status: "open", assignee: "Luis", channel: "forum", priority: "high", unread: true }
];

export function cloneTickets(items = tickets) {
  return items.map((item) => ({ ...item }));
}
