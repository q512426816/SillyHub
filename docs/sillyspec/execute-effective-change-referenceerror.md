# SillySpec execute outputStep effectiveChange ReferenceError

## Symptom

Running:

```bash
sillyspec run execute --change 2026-06-26-daemon-client-spec-sync-fix --skip-approval
```

prints the expected execute step header and worktree path, then crashes:

```text
ReferenceError: effectiveChange is not defined
    at outputStep (.../node_modules/sillyspec/src/run.js:782:80)
```

Observed environment:

- Windows PowerShell
- Node.js v24.15.0
- SillySpec execute stage, multi-change repository

## Impact

The execute prompt is visible, but the CLI exits non-zero. This makes the
normal `sillyspec run execute -> perform step -> sillyspec run execute --done`
loop fragile because the stage command cannot finish cleanly after printing the
step.

## Likely Cause

`outputStep()` references `effectiveChange` while composing:

```text
current-execute-run-id-${effectiveChange}
```

but that variable is not in scope in the function.

## Workaround

Use the printed worktree path and step prompt as the source of truth, then run
`sillyspec run execute --done --change <change> --output "<summary>"` after the
step has been completed. If `--done` is also affected, update progress manually
only after verifying the corresponding commits/tests.
