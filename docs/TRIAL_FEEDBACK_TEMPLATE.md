# CodeClaw Trial Feedback Template

Use this template after a local CodeClaw trial.

If the trial is observed live, also use `docs/HUMAN_TRIAL_OBSERVATION.md` during the session. This template is for the post-trial write-up.

After the host collects completed records, run `npm.cmd run trial:record-draft -- --session <session-folder>`, copy only confirmed values into the final records, then run `npm.cmd run trial:after-live -- --session <session-folder> --tester <tester-id> --force`.

## Tester

- Name:
- Date:
- OS:
- Node version:
- CodeClaw package/version:
- Trial host:
- Observed live: Yes / No

## Trial Scope

- Trial type: Demo / real read-only preflight / disposable patch
- Project type:
- Project size:
- Model used: Mock / DeepSeek Flash / DeepSeek Pro / other
- Goal:
- Started from: `start-codeclaw.cmd` / `npm.cmd run dev` / other
- First stuck step:

## Startup

| Check | Result | Notes |
| --- | --- | --- |
| `start-codeclaw.cmd` worked | Yes / No |  |
| Browser opened automatically | Yes / No |  |
| Error messages were understandable | Yes / No / N/A |  |
| Port issue occurred | Yes / No |  |

## First-run UX

| Check | Result | Notes |
| --- | --- | --- |
| Quick Start made the next step clear | Yes / No |  |
| Task Guide was understandable | Yes / No |  |
| Demo path was easy to find | Yes / No |  |
| Demo vs real project mode was clear | Yes / No |  |
| UI language was clear | Yes / No |  |

## Preflight

| Check | Result | Notes |
| --- | --- | --- |
| Preflight completed | Yes / No |  |
| No writes occurred | Yes / No |  |
| Context files looked relevant | Yes / No |  |
| Warnings/blockers were understandable | Yes / No / N/A |  |
| Patch gate felt trustworthy | Yes / No |  |

## Model Configuration

| Check | Result | Notes |
| --- | --- | --- |
| Model setup was clear | Yes / No / N/A |  |
| Flash vs Pro cost guidance was clear | Yes / No / N/A |  |
| API key handling felt safe | Yes / No / N/A |  |
| Model output was useful | Yes / No / N/A |  |

## Patch Flow

Only fill this section if a disposable patch was attempted.

| Check | Result | Notes |
| --- | --- | --- |
| Patch proposal was understandable | Yes / No |  |
| Changed files were expected | Yes / No |  |
| Apply confirmation was clear | Yes / No |  |
| Tester understood Apply writes files | Yes / No |  |
| Verification command was detected | Yes / No |  |
| Verify confirmation was clear | Yes / No |  |
| Verification passed | Yes / No |  |
| Revert worked | Yes / No |  |

## Trust And Safety

- Did you understand when CodeClaw would read files?
- Did you understand when CodeClaw would write files?
- Did any action feel surprising or risky?
- Did the audit trail help?

## Issues

List bugs, confusing moments, or missing information.

1.
2.
3.

## Overall

- Would you use CodeClaw again on a real project? Yes / No / Maybe
- Would you try one disposable patch next? Yes / No / Maybe
- What would need to improve first?
- Most useful part:
- Most confusing part:
- Suggested next feature:

## Host Notes

- Main observed friction:
- Main trust concern:
- Did the tester need help? Yes / No
- Should this build continue to the next tester? Yes / No
