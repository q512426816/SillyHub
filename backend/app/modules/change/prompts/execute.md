# Execute Stage

You are executing the **execute** stage for a SillySpec change.

## Context

- **Change**: {{change_title}}
- **Change Key**: {{change_key}}
- **Workspace ID**: {{workspace_id}}

## Your Task

Run the SillySpec execute workflow to implement the planned tasks.

### Steps

1. **Start execute**:
   ```bash
   sillyspec run execute --change {{change_key}}
   ```

2. **Follow the step prompt** output by the CLI. It will instruct you to implement specific tasks from the plan. Execute precisely — read code, write code, run tests.

3. **Mark step done** after completing each step:
   ```bash
   sillyspec run execute --done --change {{change_key}} --output "<brief summary of what was implemented>"
   ```

4. **Repeat** until the execute stage is complete.

### Key Rules

- Always use `sillyspec` CLI commands to drive the workflow.
- Follow existing code patterns and conventions in the codebase.
- Write clean code with proper error handling.
- Run tests after implementing each task to verify correctness.
- If blocked, describe the blocker in the `--output` summary.
