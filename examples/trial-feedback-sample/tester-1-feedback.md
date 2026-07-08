# CodeClaw Trial Feedback Template

## Tester

- Name: Sample Tester
- Date: 2026-07-08
- OS: Windows 11
- Node version: 22
- CodeClaw package/version: CodeClaw-local-trial-20260708
- Trial host: Sample Host
- Observed live: Yes

## Trial Scope

- Trial type: Demo / real read-only preflight
- Project type: JavaScript app
- Project size: Small
- Model used: Mock
- Goal: understand a small UI task safely
- Started from: start-codeclaw.cmd
- First stuck step: finding the difference between Demo mode and real project mode

## Startup

| Check | Result | Notes |
| --- | --- | --- |
| `start-codeclaw.cmd` worked | Yes |  |
| Browser opened automatically | Yes |  |
| Error messages were understandable | N/A | No startup error occurred. |
| Port issue occurred | No |  |

## First-run UX

| Check | Result | Notes |
| --- | --- | --- |
| Quick Start made the next step clear | Yes |  |
| Task Guide was understandable | Yes |  |
| Demo path was easy to find | Yes |  |
| Demo vs real project mode was clear | No | Tester hesitated before reading the mode label. |
| UI language was clear | Yes |  |

## Preflight

| Check | Result | Notes |
| --- | --- | --- |
| Preflight completed | Yes |  |
| No writes occurred | Yes |  |
| Context files looked relevant | Yes |  |
| Warnings/blockers were understandable | Yes |  |
| Patch gate felt trustworthy | Yes |  |

## Trust And Safety

- Did you understand when CodeClaw would read files? Yes.
- Did you understand when CodeClaw would write files? Yes, after Apply confirmation.
- Did any action feel surprising or risky? No.
- Did the audit trail help? Yes.

## Issues

1. Mode label was useful, but the tester noticed it only after host prompted them to look near the path field.

## Overall

- Would you use CodeClaw again on a real project? Maybe
- Would you try one disposable patch next? Yes
- What would need to improve first? Make Demo vs real mode more visually obvious.
- Most useful part: Read-only preflight.
- Most confusing part: Path mode.
- Suggested next feature: Stronger first-run mode cue.

## Host Notes

- Main observed friction: Demo vs real project mode.
- Main trust concern: None.
- Did the tester need help? Yes
- Should this build go to tester 2? Yes
