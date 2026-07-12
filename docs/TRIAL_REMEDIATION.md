# Trial Remediation Gate

Use `trial:remediation` after a real session truthfully ended in `AFTER_LIVE_BLOCKED` because the product must be fixed before another controlled test. It closes the product-fix loop without changing the original human records, rerunning `after-live`, or pretending that the blocked session passed.

This is a Stage 3.0.9 gate, not a human retest result.

## Safety contract

- `TRIAL_AFTER_LIVE_REPORT.json` and all original session records are read-only evidence.
- A preserved `PRIVACY_HOLD`, structured `Stop` decision, consent problem, or active stop condition always produces `REMEDIATION_HOLD`.
- Every canonical P0 blocker needs an explicit `sourceRef`, a completed fix, and passing verification bound to the fix commit.
- Current readiness must have `sourceVersion.available` equal to `true`, `sourceVersion.commit` equal to the current Git commit, and `sourceVersion.dirty` equal to `false`.
- The worktree must be clean. The fix commit may be an ancestor of the current commit, but host acceptance must target the current commit and be later than readiness.
- The generated report contains hashes, stable refs, decisions, and counts. It does not copy tester quotes, notes, raw paths, screenshots, logs, or source excerpts.

The gate never runs `trial:after-live` and never writes into a session folder.

## Inputs

The default report folder is `dist`. The gate reads:

- `TRIAL_AFTER_LIVE_REPORT.json`
- `TRIAL_REVIEW_REPORT.json`
- `TRIAL_PRIVACY_REPORT.json`
- `TRIAL_FEEDBACK_SUMMARY.json`
- `TRIAL_FIX_BACKLOG.json`
- `TRIAL_SESSION_COMPLETION_REPORT.json`
- `TRIAL_READINESS_REPORT.json`
- the original session's `SESSION_PACK_MANIFEST.json`
- `TRIAL_REMEDIATION_CHECKLIST.json`
- `TRIAL_REMEDIATION_ACCEPTANCE.json`

All of these remain local-only under `dist/`. Do not commit them.

If the two remediation checklist files do not exist yet, run the gate once to produce a HOLD report. Its `unresolvedItems` list gives the stable `sourceRef` values to map. That discovery run does not generate or infer any human answer.

## Fix checklist

Create `dist/TRIAL_REMEDIATION_CHECKLIST.json` manually from confirmed engineering work:

```json
{
  "mode": "trial-remediation-checklist",
  "schemaVersion": 1,
  "createdAt": "2026-01-01T00:00:00.000Z",
  "testerId": "tester-x",
  "originalAfterLiveDecision": "AFTER_LIVE_BLOCKED",
  "fixCommit": "0123456789abcdef0123456789abcdef01234567",
  "items": [
    {
      "id": "FIX-001",
      "sourceRefs": [
        "backlog:p0-001"
      ],
      "status": "fixed",
      "verification": {
        "status": "passed",
        "verifiedCommit": "0123456789abcdef0123456789abcdef01234567",
        "checkedAt": "2026-01-01T00:00:00.000Z",
        "evidence": [
          {
            "kind": "test",
            "reference": "npm.cmd test -- --example",
            "passed": true
          }
        ]
      }
    }
  ]
}
```

One fix item may map several source refs when one verified change resolves the same underlying issue. A source ref must not appear under two fix items. Unknown, duplicated, unmapped, incomplete, or unverified refs hold the gate.

Use only non-sensitive verification references such as a test command, inspection checklist id, or generated report name. Do not paste tester quotes, project source, logs, screenshots, or private paths.

## Host acceptance checklist

After the final commit and a fresh successful `trial:ready`, the real host creates `dist/TRIAL_REMEDIATION_ACCEPTANCE.json`:

```json
{
  "mode": "trial-remediation-acceptance",
  "schemaVersion": 1,
  "testerId": "tester-x",
  "decision": "ACCEPTED_WITH_REVIEW",
  "acceptedBy": "host-1",
  "acceptedAt": "2026-01-01T00:00:00.000Z",
  "fixCommit": "0123456789abcdef0123456789abcdef01234567",
  "acceptedCommit": "89abcdef0123456789abcdef0123456789abcdef",
  "originalRecordsUnchanged": true,
  "hostChecks": [
    {
      "id": "desktop-sticky-navigation",
      "status": "passed",
      "method": "manual",
      "checkedAt": "2026-01-01T00:00:00.000Z"
    },
    {
      "id": "narrow-layout",
      "status": "passed",
      "method": "manual",
      "checkedAt": "2026-01-01T00:00:00.000Z"
    },
    {
      "id": "saved-session-choice",
      "status": "passed",
      "method": "manual",
      "checkedAt": "2026-01-01T00:00:00.000Z"
    },
    {
      "id": "chinese-demo-patch",
      "status": "passed",
      "method": "manual",
      "checkedAt": "2026-01-01T00:00:00.000Z"
    },
    {
      "id": "preflight-read-only-explanation",
      "status": "passed",
      "method": "manual",
      "checkedAt": "2026-01-01T00:00:00.000Z"
    },
    {
      "id": "apply-verify-boundaries",
      "status": "passed",
      "method": "manual",
      "checkedAt": "2026-01-01T00:00:00.000Z"
    },
    {
      "id": "demo-apply-verify-revert",
      "status": "passed",
      "method": "manual",
      "checkedAt": "2026-01-01T00:00:00.000Z"
    }
  ],
  "reviewedFixIds": [
    "fix-001"
  ],
  "acceptedWarnings": true
}
```

Allowed acceptance decisions are `ACCEPTED` and `ACCEPTED_WITH_REVIEW`. Use an anonymous host id such as `host-1`. The original session manifest and structured feedback—not a new assertion—remain the source of truth for tester consent and any Stop decision. Remediation must not ask an absent tester to reconfirm consent.

`originalRecordsUnchanged` and every required `hostChecks` entry must come from the host; automation must not fill them. Required host-check ids are `desktop-sticky-navigation`, `narrow-layout`, `saved-session-choice`, `chinese-demo-patch`, `preflight-read-only-explanation`, `apply-verify-boundaries`, and `demo-apply-verify-revert`. Each must have `status: "passed"`, `method: "manual"` or `"host-observed"`, and a valid `checkedAt` time.

Use `ACCEPTED_WITH_REVIEW` and `acceptedWarnings: true` when the preserved privacy report or backlog still carries watch items. `HOLD`, missing fields, stale commit acceptance, or an acceptance timestamp older than readiness blocks progress.

## Run

From the project root:

```powershell
npm.cmd run trial:remediation -- --tester tester-x
```

Useful path overrides:

```powershell
npm.cmd run trial:remediation -- --tester tester-x `
  --reports dist `
  --fix-checklist dist/TRIAL_REMEDIATION_CHECKLIST.json `
  --acceptance dist/TRIAL_REMEDIATION_ACCEPTANCE.json `
  --evidence-out dist/trial-remediation/tester-x-reviewed
```

The command writes:

```text
dist/TRIAL_REMEDIATION_REPORT.json
dist/TRIAL_REMEDIATION_REPORT.md
dist/trial-remediation/<tester-id>-<timestamp>/reports/TRIAL_REMEDIATION_REPORT.json
dist/trial-remediation/<tester-id>-<timestamp>/reports/TRIAL_REMEDIATION_REPORT.md
```

The evidence copy is created only for a ready decision and contains only the privacy-safe remediation report. HOLD runs write only the main diagnostic report. Use `--no-evidence-copy` for fixture or diagnostic runs that need only the main report.

## Decisions

### `REMEDIATION_HOLD`

At least one safety, evidence, mapping, verification, Git, readiness, or host-acceptance condition failed. Do not schedule or invite another tester.

### `REMEDIATION_READY_WITH_REVIEW`

All required blockers are verified as resolved, but privacy review or original watch items remain. This is eligible only for later integration into a controlled next-live gate, with the warnings carried forward.

### `REMEDIATION_READY_FOR_RETEST`

All required blockers are verified as resolved, current readiness matches a clean current commit, host acceptance is current, and no review warning remains. This permits planning a future controlled retest; it is not evidence that a human retest succeeded.

## Integration contract

Future `next-live`, `trial:status`, and cohort tools should consume these stable JSON fields:

- `testerId`
- `originalAfterLiveDecision`
- `originalAfterLiveRelativePath`
- `fixCommit`
- `currentCommit`
- `readinessCreatedAt`
- `packagePath`
- `readinessSourceVersion`
- `resolvedItems`
- `unresolvedItems`
- `hostAcceptance`
- `decision`
- `ok`

Integration must require both the preserved original `AFTER_LIVE_BLOCKED` report and a current ready remediation report. It must never overwrite the original decision or count remediation as a completed human session.
