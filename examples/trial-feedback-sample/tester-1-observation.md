# CodeClaw Human Trial Observation Checklist

## Friction Watchlist

| Moment | Observe | Result | Notes |
| --- | --- | --- | --- |
| Startup | Can they tell whether CodeClaw is running? | Pass |  |
| Language | Do they find the language switcher if needed? | Pass |  |
| Demo vs real project | Do they understand which mode they are in? | Friction | Tester hesitated for about 20 seconds. |
| Path entry | Do they paste a folder, not a file? | Pass |  |
| Path error | Can they recover from empty/file/missing path? | Pass |  |
| Read-only preflight | Do they understand no writes happened? | Pass |  |
| Patch gate | Do blockers/warnings make sense? | Pass |  |
| Apply review | Do changed files and risks feel inspectable? | Pass |  |
| Apply confirm | Do they understand this is the write boundary? | Pass |  |
| Verify confirm | Do they understand commands may run project scripts? | Pass |  |
| Audit | Can they find what happened afterward? | Pass |  |

## Host Summary

- Biggest friction: Demo vs real project mode label was not noticed immediately.
- Biggest trust concern: None.
- First point where host helped: Pointed out the path mode label.
- Recommended product fix: Make the mode cue more prominent near the path controls.
- Safe to continue to tester 2: Yes
