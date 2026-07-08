# CodeClaw Hosted Trial Result Record

## Session

- Tester: Sample Tester
- Date: 2026-07-08
- Package: CodeClaw-local-trial-20260708
- Host: Sample Host
- Trial length: 25 minutes
- Trial scope: Demo / real read-only preflight
- Decision after trial: Continue

## Outcomes

| Outcome | Result | Evidence |
| --- | --- | --- |
| App launched | Pass | Started from launcher. |
| Demo reached patch proposal or patch gate | Pass | Patch gate visible. |
| Tester understood Demo vs real project mode | Friction | Needed one hint. |
| Real-project read-only preflight completed | Pass | No write tools used. |
| No unexpected writes occurred | Pass | Audit showed read-only flow. |
| Tester understood Apply writes files | Pass | Tester explained before continuing. |
| Tester understood Verify may run commands | Pass | Tester explained before continuing. |
| Feedback template completed | Pass | Template completed after session. |

## Friction

- First stuck moment: Demo vs real project mode.
- Exact tester quote: I am not sure if this is still the demo folder.
- Host intervention needed: Yes
- Time lost: 20 seconds
- Severity: Medium

## Trust

- Strongest trust-building moment: Read-only preflight and Apply confirmation.
- Strongest trust concern: None.
- Did the tester feel safe trying read-only preflight on a real project? Yes
- Did the tester feel safe trying a disposable patch next? Maybe

## Bugs Or Product Fixes

1. Make Demo vs real project mode more visually obvious near the path controls.

## Go/No-Go For Tester 2

- Proceed to tester 2: Yes
- Required fix before tester 2: None.
- Owner: Product
- Notes: Watch for repeated mode confusion.
