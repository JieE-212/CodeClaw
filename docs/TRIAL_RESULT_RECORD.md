# CodeClaw Hosted Trial Result Record

Fill this after the hosted trial. Keep it short and concrete.

After saving this with the tester feedback and observation checklist, run `npm.cmd run trial:record-draft -- --session <session-folder>` and review any missing fields. When all three records are confirmed, run `npm.cmd run trial:after-live -- --session <session-folder> --tester <tester-id> --force`.

## Session

- Tester:
- Date:
- Package:
- Host:
- Trial length:
- Trial scope: Demo / real read-only preflight / disposable patch
- Decision after trial: Continue / Fix first / Stop

## Outcomes

| Outcome | Result | Evidence |
| --- | --- | --- |
| App launched | Pass / Friction / Fail |  |
| Demo reached patch proposal or patch gate | Pass / Friction / Fail |  |
| Tester understood Demo vs real project mode | Pass / Friction / Fail |  |
| Real-project read-only preflight completed | Pass / Friction / Fail / N/A |  |
| No unexpected writes occurred | Pass / Friction / Fail |  |
| Tester understood Apply writes files | Pass / Friction / Fail |  |
| Tester understood Verify may run commands | Pass / Friction / Fail |  |
| Feedback template completed | Pass / Friction / Fail |  |

## Friction

- First stuck moment:
- Exact tester quote:
- Host intervention needed: Yes / No
- Time lost:
- Severity: Low / Medium / High

## Trust

- Strongest trust-building moment:
- Strongest trust concern:
- Did the tester feel safe trying read-only preflight on a real project? Yes / No / Maybe
- Did the tester feel safe trying a disposable patch next? Yes / No / Maybe

## Bugs Or Product Fixes

1.
2.
3.

## Go/No-Go For The Next Tester

- Proceed to the next tester: Yes / No
- Required fix before the next tester:
- Owner:
- Notes:
