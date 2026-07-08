export function summarizeTasks(tasks) {
  return tasks.reduce((summary, task) => {
    summary.total += 1;
    summary.byStatus[task.status] = (summary.byStatus[task.status] || 0) + 1;
    summary.byAssignee[task.assignee] = (summary.byAssignee[task.assignee] || 0) + 1;
    return summary;
  }, { total: 0, byStatus: {}, byAssignee: {} });
}

export function formatSummary(summary) {
  return `${summary.total} task(s), ${Object.keys(summary.byStatus).length} status bucket(s)`;
}
