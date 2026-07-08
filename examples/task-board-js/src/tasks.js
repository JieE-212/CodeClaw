export const tasks = [
  { id: "T-101", title: "Design onboarding flow", status: "todo", assignee: "Mina", priority: "high" },
  { id: "T-102", title: "Wire audit event list", status: "doing", assignee: "Kai", priority: "medium" },
  { id: "T-103", title: "Polish settings copy", status: "done", assignee: "Mina", priority: "low" },
  { id: "T-104", title: "Add failure recovery prompt", status: "doing", assignee: "Jo", priority: "high" }
];

export function cloneTasks(items = tasks) {
  return items.map((item) => ({ ...item }));
}
