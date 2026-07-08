# CodeClaw MVP Demos

These demos use `examples/demo-js` and the default mock model provider.

For an automated end-to-end check, run:

```bash
npm.cmd run smoke
```

For a read-only pilot on the CodeClaw engineering project itself, run:

```bash
npm.cmd run pilot:self
```

For a fake OpenAI-compatible model contract pilot, run:

```bash
npm.cmd run pilot:model
```

For the stage-three fixture pilot with a realistic multi-file feature change, run:

```bash
npm.cmd run pilot:fixture
```

For a real local or self-hosted OpenAI-compatible model trial, follow [`LOCAL_MODEL_TRIAL.md`](LOCAL_MODEL_TRIAL.md) and record results in [`LOCAL_MODEL_TRIALS.md`](LOCAL_MODEL_TRIALS.md).

## Demo 1: Understand a project

1. Run `npm.cmd run dev`.
2. Open `http://localhost:4173`.
3. Click `Demo`, then `Scan`.
4. Enter goal: `explain this project and how to verify it`.
5. Click `Generate plan`, then `Suggest`.

Expected result: CodeClaw scans the repo, creates a task, generates a plan, and records audit events.

## Demo 2: Add a test safely

1. Click `Demo`, then `Scan`.
2. Enter goal: `add divide by zero test and verify the project`.
3. Click `Generate plan`.
4. Click `Context`, keep the suggested test file selected, then click `Read selected`.
5. Click `Generate patch`.
6. Review the diff, click `Apply`, then confirm.
7. Click `Run` in Verification.

Expected result: the test file is patched and `npm run test` exits with code `0`.

## Demo 3: Revert a patch

1. Complete Demo 2 through `Apply`.
2. In `Patch proposal`, choose the active patch.
3. Click `Revert last`, then confirm.

Expected result: the test file returns to its previous content and the task records the reverted patch.

## Demo 4: Failure repair loop

1. Scan `examples/demo-js`.
2. Create a task and run a verification command before applying the expected patch, or temporarily make a failing assertion in the demo project.
3. Click `Run` in Verification.
4. After a non-zero exit, click `Fix failure`.

Expected result: CodeClaw stores the failed verification summary and asks the configured model for a concise repair suggestion.

## API smoke test used for MVP verification

The current MVP has been checked with this end-to-end path:

1. Start the local server on an alternate `CODECLAW_PORT`.
2. `POST /api/repo/scan` for `examples/demo-js`.
3. Create a task, generate a plan, suggest context, and read `test/calculator.test.js`.
4. Generate and apply the mock divide-by-zero test patch.
5. Run `npm run test` through the approved command tool.
6. Revert the applied patch.

Expected result: verification exits with code `0`, a Review draft is generated, the patch is reverted, and the demo test file is restored.
