# CodeClaw Persona Trial Review

This review simulates a technically comfortable solo developer trying CodeClaw without prior product context.

## Persona

Name: Solo technical founder

Context:

- Works alone.
- Wants an AI coding assistant but worries about source privacy, accidental writes, and model cost.
- Is willing to run a local tool, but does not want to debug setup for long.
- Has no external tester available yet.

## Review Lens

The trial is judged by five questions:

1. Do I know what to click first?
2. Do I understand that real projects start read-only?
3. Do I know when CodeClaw may write files or run commands?
4. Do I understand model cost risk before entering an API key?
5. Can I stop safely if anything feels unclear?

## Journey Findings

### First Screen

Status: Improved

Before this review, the safety promise was present but scattered across panels. A first-time user could miss the relationship between local execution, read-only preflight, and write confirmation.

Change made:

- Added a first-screen safety strip:
  - Local run.
  - Read-only preflight first.
  - Confirmation before writes and commands.

Expected impact:

- A tester should feel safer before entering a real project path.
- The host has less explaining to do before Demo.

### Demo Path

Status: Pass

The simulated trial reaches Demo preflight, creates a plan, and generates a patch proposal without applying it.

Observed:

- Demo blockers: 0.
- Demo warnings: 0.
- Demo proposal file: `test/calculator.test.js`.
- No write occurred.

Remaining risk:

- A real user may still hesitate between `任务引导` and `快速开始`. This needs live observation.

### Real Project Read-only Preflight

Status: Pass

The simulated first real project preflight used the CodeClaw project itself as the target repository.

Observed:

- Blockers: 0.
- Warnings: 0.
- Context files selected: 5.
- Tools used: read/search only.
- No write or command execution occurred.

Remaining risk:

- Different project types may produce weaker context selection.
- Path entry on Windows can still confuse non-technical users.

### Apply And Command Confirmation

Status: Improved

Before this review, `Apply` confirmation said only which patch would be applied. For a cautious user, that is too thin.

Change made:

- `Apply` confirmation now explicitly says:
  - It will write local project files.
  - Demo, disposable copy, or disposable branch is recommended.
  - Recent patch can be reverted.
- Verification command confirmation now shows:
  - The exact command.
  - The permission risk.
  - A cancel recommendation when unsure.

Expected impact:

- Fewer accidental writes.
- More trust in the approval gate.

### Service Error Copy

Status: Improved

Before this review, disconnected service copy still mentioned `run-dev.cmd`, while trial users are guided toward `start-codeclaw.cmd`.

Change made:

- Error copy now says `start-codeclaw.cmd` or `npm.cmd run dev`.

Expected impact:

- Trial users can recover from a closed launcher window more easily.

### Model Cost

Status: Pass

The model panel already distinguishes:

- Mock as zero-cost.
- Flash as recommended default.
- Pro as higher-cost, higher-quality, non-default.

Remaining risk:

- API key setup still carries anxiety. First external trial should avoid API keys unless the goal is model configuration testing.

## Simulated Trial Result

Latest automated simulation:

```bash
npm.cmd run trial:simulate
```

Expected report:

```text
dist/SIMULATED_FIRST_TRIAL_REPORT.md
```

Pass conditions:

- First-screen safety strip is visible.
- Demo reaches patch proposal without writes.
- Real-project preflight uses only read/search tools.
- No blocker appears in the first safe path.

## Recommendation

For a solo founder without testers:

1. Run `npm.cmd run trial:simulate` after every productization change.
2. Treat failures as release blockers for local trial packages.
3. Do one self-hosted manual pass using the generated zip, not only the source project.
4. Do not test real-project `Apply` until read-only preflight feels boring and predictable.
5. When a human tester becomes available, ask them only to run Demo and real-project read-only preflight first.

## Next UX Improvement Candidates

Prioritize these only after the current safety path remains green:

1. Add a copy-path helper or clearer Windows path example near project path input.
2. Add a visible "Demo only / Real project read-only / Disposable patch" trial mode selector.
3. Add a post-preflight explanation for why each context file was selected in more human language.
4. Add a dry-run review screen before `Apply` that separates changed files, risk notes, and rollback option.
