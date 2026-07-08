# CodeClaw Human Trial Observation Checklist

Use this checklist while observing a first-time tester. The goal is to record friction, hesitation, and trust concerns without coaching too early.

## Session Rules

- Start with `start-codeclaw.cmd`.
- Ask the tester to begin with Demo.
- Stop before applying a patch to a real project unless the project is a disposable copy or branch.
- Let the tester think aloud; only help after 30 seconds of visible confusion or a safety concern.

## Timing

| Step | Target | Actual | Notes |
| --- | ---: | ---: | --- |
| Launcher to browser ready | 2 min |  |  |
| Demo selected and preflight started | 2 min |  |  |
| Preflight result understood | 3 min |  |  |
| Plan generated | 3 min |  |  |
| Context selected/read | 4 min |  |  |
| Patch proposal understood | 5 min |  |  |
| Verification intent understood | 3 min |  |  |

## Friction Watchlist

| Moment | Observe | Result | Notes |
| --- | --- | --- | --- |
| Startup | Can they tell whether CodeClaw is running? | Pass / Friction / Fail |  |
| Language | Do they find the language switcher if needed? | Pass / Friction / Fail |  |
| Demo vs real project | Do they understand which mode they are in? | Pass / Friction / Fail |  |
| Path entry | Do they paste a folder, not a file? | Pass / Friction / Fail |  |
| Path error | Can they recover from empty/file/missing path? | Pass / Friction / Fail |  |
| Read-only preflight | Do they understand no writes happened? | Pass / Friction / Fail |  |
| Patch gate | Do blockers/warnings make sense? | Pass / Friction / Fail |  |
| Apply review | Do changed files and risks feel inspectable? | Pass / Friction / Fail |  |
| Apply confirm | Do they understand this is the write boundary? | Pass / Friction / Fail |  |
| Verify confirm | Do they understand commands may run project scripts? | Pass / Friction / Fail |  |
| Audit | Can they find what happened afterward? | Pass / Friction / Fail |  |

## Trust Questions

- When did CodeClaw read files?
- When would CodeClaw write files?
- Which screen made you feel safest?
- Which message made you hesitate?
- What would you need before trying a disposable real-project patch?

## Stop Conditions

Stop the trial and record the reason if:

- The tester cannot launch the app within 10 minutes.
- The tester cannot recover from path entry errors.
- Preflight blockers are unclear.
- The tester is about to apply a patch to a non-disposable real project.
- The tester cannot tell whether a command will run.

## Host Summary

- Biggest friction:
- Biggest trust concern:
- First point where host helped:
- Recommended product fix:
- Safe to continue to tester 2: Yes / No
