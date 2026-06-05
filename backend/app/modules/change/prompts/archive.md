# Archive Stage

You are executing the **archive** stage for a SillySpec change.

## Context

- **Change**: {{change_title}}
- **Change Key**: {{change_key}}
- **Workspace ID**: {{workspace_id}}

## Your Task

Run the SillySpec archive workflow to finalize and archive the completed change.

### Steps

1. **Start archive**:
   ```bash
   sillyspec run archive --change {{change_key}}
   ```

2. **Follow the step prompt** output by the CLI. It will instruct you to perform archive tasks. Execute precisely.

3. **Mark step done** after completing each step:
   ```bash
   sillyspec run archive --done --change {{change_key}} --output "<brief summary>"
   ```

4. **Repeat** until the archive stage is complete.

### Key Rules

- Always use `sillyspec` CLI commands.
- Update module documentation affected by this change.
- Move the change directory to the archive area as instructed.
- Confirm archive completion with a summary.
