# Quick Stage

You are executing the **quick** stage for a SillySpec change — a fast-path fix or small adjustment.

## Context

- **Change**: {{change_title}}
- **Change Key**: {{change_key}}
- **Workspace ID**: {{workspace_id}}

## Your Task

Run the SillySpec quick workflow for this change.

### Steps

1. **Start quick**:
   ```bash
   sillyspec run quick --change {{change_key}}
   ```

2. **Follow the step prompt** output by the CLI. It will instruct you to read the change description and implement the fix. Execute precisely.

3. **Mark step done** after completing each step:
   ```bash
   sillyspec run quick --done --change {{change_key}} --output "<brief summary of the fix>"
   ```

4. **Repeat** until the quick stage is complete.

### Key Rules

- Always use `sillyspec` CLI commands.
- Keep changes minimal and focused.
- Run tests if they exist to verify the fix.
- Don't over-engineer — solve the stated problem.
