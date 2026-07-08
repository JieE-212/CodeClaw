import { cloneTickets, tickets as seedTickets } from "./tickets.js";

export async function listTickets({ tickets = seedTickets, filters = {} } = {}) {
  return cloneTickets(tickets).filter((ticket) => {
    if (filters.status && ticket.status !== filters.status) return false;
    if (filters.assignee && ticket.assignee !== filters.assignee) return false;
    return true;
  });
}

export async function updateTicketStatus({ tickets = seedTickets, id, status }) {
  if (!id) throw new Error("Missing ticket id.");
  if (!status) throw new Error("Missing status.");
  return cloneTickets(tickets).map((ticket) => ticket.id === id ? { ...ticket, status } : ticket);
}
