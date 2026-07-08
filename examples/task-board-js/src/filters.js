export function filterTasks(tasks, filters = {}) {
  return tasks.filter((task) => {
    if (filters.status && task.status !== filters.status) return false;
    if (filters.assignee && task.assignee !== filters.assignee) return false;
    return true;
  });
}

export function sortTasksByTitle(tasks) {
  return [...tasks].sort((left, right) => left.title.localeCompare(right.title));
}
