# Task: stage:archive — Stage dispatch: archive
# Change: Change stage: archive

## Task
# Archive Stage

You are executing the **archive** stage for a SillySpec change.

## Context

- **Change**: Proposal: Agent 控制台日志回显宽度修复
- **Change Key**: 2026-06-05-agent-log-width
- **Workspace ID**: 3a5e2cb6-84e2-43d4-b9dc-9479bd3afda4

## Your Task

Run the SillySpec archive workflow to finalize and archive the completed change.

### Steps

1. **Start archive**:
   ```bash
   sillyspec run archive --change 2026-06-05-agent-log-width
   ```

2. **Follow the step prompt** output by the CLI. It will instruct you to perform archive tasks. Execute precisely.

3. **Mark step done** after completing each step:
   ```bash
   sillyspec run archive --done --change 2026-06-05-agent-log-width --output "<brief summary>"
   ```

4. **Repeat** until the archive stage is complete.

### Key Rules

- Always use `sillyspec` CLI commands.
- Update module documentation affected by this change.
- Move the change directory to the archive area as instructed.
- Confirm archive completion with a summary.


## Mode: WRITE
You may modify files in the worktree as needed.


## Available Tools
- **sillyspec**: Use `sillyspec init --dir <source_root>` to initialize spec space, then `sillyspec run scan --dir <source_root> --spec-root <spec_root>` to scan. Do NOT write .sillyspec files directly — always use the CLI.
