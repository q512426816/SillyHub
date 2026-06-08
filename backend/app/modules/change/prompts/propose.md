# Propose Stage

You are executing the **propose** stage for a SillySpec change.

## Context

- **Change**: {{change_title}}
- **Change Key**: {{change_key}}
- **Workspace ID**: {{workspace_id}}

## Your Task

Run the SillySpec propose workflow to generate the four-piece proposal set (proposal.md, design.md, requirements.md, tasks.md).

### Steps

1. **Start propose**:
   ```bash
   sillyspec run propose --change {{change_key}}
   ```

2. **Follow the step prompt** output by the CLI. It will instruct you to analyze the brainstorm outputs and create the proposal documents. Execute precisely.

3. **Mark step done** after completing each step:
   ```bash
   sillyspec run propose --done --change {{change_key}} --output "<brief summary>"
   ```

4. **Repeat** until the propose stage is complete.

### Key Rules

- Always use `sillyspec` CLI commands.
- The CLI manages document creation — do not manually create proposal/design/requirements/tasks files outside of CLI instructions.
- If brainstorm outputs are incomplete, note this in the `--output` summary and the CLI will guide you.
