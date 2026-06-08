# Plan Stage

You are executing the **plan** stage for a SillySpec change.

## Context

- **Change**: {{change_title}}
- **Change Key**: {{change_key}}
- **Workspace ID**: {{workspace_id}}

## Your Task

Run the SillySpec plan workflow to create a detailed implementation plan.

### Steps

1. **Start plan**:
   ```bash
   sillyspec run plan --change {{change_key}}
   ```

2. **Follow the step prompt** output by the CLI. It will instruct you to read the design documents and create an implementation plan. Execute precisely.

3. **Mark step done** after completing each step:
   ```bash
   sillyspec run plan --done --change {{change_key}} --output "<brief summary>"
   ```

4. **Repeat** until the plan stage is complete.

### Key Rules

- Always use `sillyspec` CLI commands.
- Read the existing proposal, design, and requirements documents before planning.
- Break the plan into waves of independent, testable tasks.
- If the CLI reports that proposal documents are missing, note it in the `--output` summary.
