import test from "node:test";
import assert from "node:assert/strict";
import { listTickets, updateTicketStatus } from "../src/api.js";
import { cloneTickets } from "../src/tickets.js";

test("listTickets filters by status", async () => {
  const result = await listTickets({ tickets: cloneTickets(), filters: { status: "open" } });
  assert.deepEqual(result.map((ticket) => ticket.id), ["S-1001", "S-1003", "S-1005"]);
});

test("listTickets filters by assignee", async () => {
  const result = await listTickets({ tickets: cloneTickets(), filters: { assignee: "Luis" } });
  assert.deepEqual(result.map((ticket) => ticket.id), ["S-1002", "S-1005"]);
});

test("updateTicketStatus returns an updated copy", async () => {
  const source = cloneTickets();
  const result = await updateTicketStatus({ tickets: source, id: "S-1002", status: "open" });
  assert.equal(result.find((ticket) => ticket.id === "S-1002").status, "open");
  assert.equal(source.find((ticket) => ticket.id === "S-1002").status, "pending");
});
