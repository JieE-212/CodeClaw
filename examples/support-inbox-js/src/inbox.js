export function selectInboxTickets(tickets, filters = {}) {
  return tickets.filter((ticket) => {
    if (filters.status && ticket.status !== filters.status) return false;
    if (filters.assignee && ticket.assignee !== filters.assignee) return false;
    if (filters.unreadOnly && !ticket.unread) return false;
    return true;
  });
}

export function createInboxState(tickets, filters = {}) {
  const visibleTickets = selectInboxTickets(tickets, filters);
  return {
    filters: { ...filters },
    total: visibleTickets.length,
    unread: visibleTickets.filter((ticket) => ticket.unread).length,
    byStatus: countBy(visibleTickets, "status"),
    rows: visibleTickets.map((ticket) => ({
      id: ticket.id,
      subject: ticket.subject,
      status: ticket.status,
      assignee: ticket.assignee,
      channel: ticket.channel,
      priority: ticket.priority,
      unread: ticket.unread
    }))
  };
}

function countBy(items, key) {
  return items.reduce((counts, item) => {
    counts[item[key]] = (counts[item[key]] || 0) + 1;
    return counts;
  }, {});
}
