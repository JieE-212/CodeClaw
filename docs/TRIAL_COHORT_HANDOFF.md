# CodeClaw Trial Cohort Handoff

Use this after at least two tester sessions have completed, after each tester has passed `trial:after-live`, and after `trial:cohort-summary` has been generated.

## Command

```bash
npm.cmd run trial:cohort-handoff -- --accept-review --accept-privacy --accepted-by <host-id>
```

Use the acceptance flags only after the host has reviewed repeated watch items, repeated safety themes, and privacy warnings.

## What It Checks

The handoff blocks when:

- cohort summary is missing or not ok
- fewer than two completed tester summaries exist
- a completed tester is missing after-live evidence
- after-live is blocked for any completed tester
- repeated watch items require host acceptance but `--accept-review` was not provided
- privacy warnings require host acceptance but `--accept-privacy` was not provided

## Outputs

```text
dist/TRIAL_COHORT_HANDOFF.md
dist/TRIAL_COHORT_HANDOFF.json
dist/COHORT_EXPANSION_HANDOFF.md
```

The expansion handoff includes:

- expansion instruction
- watch items for every next tester
- safety review items
- stop conditions
- evidence sources
- after-each-tester commands

## Decisions

```text
COHORT_HANDOFF_HOLD
COHORT_HANDOFF_REVIEW_REQUIRED
COHORT_HANDOFF_EXPAND_WITH_WATCH
COHORT_HANDOFF_READY_TO_EXPAND
```

Invite 3-5 testers only when the decision is `COHORT_HANDOFF_READY_TO_EXPAND` or `COHORT_HANDOFF_EXPAND_WITH_WATCH`.

If the decision is `COHORT_HANDOFF_REVIEW_REQUIRED`, do not expand until the host reviews repeated safety themes and decides whether to fix first.

## Recommended Loop

```bash
npm.cmd run trial:cohort-summary -- <completed-trials-folder>
npm.cmd run trial:cohort-handoff -- --accept-review --accept-privacy --accepted-by <host-id>
npm.cmd run trial:status
```

Keep raw tester records, rosters, screenshots, logs, project paths, source snippets, contact details, and secrets local-only.
