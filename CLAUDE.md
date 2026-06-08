# Task: stage:verify — Stage dispatch: verify
# Change: Change stage: verify

## Task
# Verify Stage

You are executing the **verify** stage for a SillySpec change.

## Context

- **Change**: Proposal: Agent 控制台日志回显宽度修复
- **Change Key**: 2026-06-05-agent-log-width
- **Workspace ID**: 3a5e2cb6-84e2-43d4-b9dc-9479bd3afda4

## Your Task

Run the SillySpec verify workflow to validate the implementation against the design.

### Steps

1. **Start verify**:
   ```bash
   sillyspec run verify --change 2026-06-05-agent-log-width
   ```

2. **Follow the step prompt** output by the CLI. It will instruct you to perform verification checks. Execute precisely.

3. **Mark step done** after completing each step:
   ```bash
   sillyspec run verify --done --change 2026-06-05-agent-log-width --output "<brief summary of verification results>"
   ```

4. **Repeat** until the verify stage is complete.

### Key Rules

- Always use `sillyspec` CLI commands.
- Verify code quality, test coverage, edge cases, integration, and design conformance.
- Produce a clear PASS / FAIL verdict.
- If verification fails, describe the specific issues found.
- Write `verify-result.md` as instructed by the CLI.


## Mode: WRITE
You may modify files in the worktree as needed.


## Available Tools
- **sillyspec**: Use `sillyspec init --dir <spec_root>` to initialize spec space, then `sillyspec run scan --dir <spec_root>` to scan. Do NOT write .sillyspec files directly — always use the CLI.
