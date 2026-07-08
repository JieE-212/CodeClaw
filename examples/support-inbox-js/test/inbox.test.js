import test from "node:test";
import assert from "node:assert/strict";
import { createInboxState, selectInboxTickets } from "../src/inbox.js";
import { cloneTickets } from "../src/tickets.js";

test("selectInboxTickets combines status and unread filters", () => {
  const result = selectInboxTickets(cloneTickets(), { status: "open", unreadOnly: true });
  assert.deepEqual(result.map((ticket) => ticket.id), ["S-1001", "S-1005"]);
});

test("createInboxState returns rows and counters", () => {
  const state = createInboxState(cloneTickets(), { assignee: "Nora" });
  assert.equal(state.total, 2);
  assert.equal(state.unread, 1);
  assert.deepEqual(state.byStatus, { open: 2 });
  assert.deepEqual(state.rows.map((row) => row.id), ["S-1001", "S-1003"]);
});
