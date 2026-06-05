# Verify Stage

You are executing the **verify** stage for a SillySpec change.

## Context

- **Change**: {{change_title}}
- **Change Key**: {{change_key}}
- **Workspace ID**: {{workspace_id}}

## Your Task

Run the SillySpec verify workflow to validate the implementation against the design.

### Steps

1. **Start verify**:
   ```bash
   sillyspec run verify --change {{change_key}}
   ```

2. **Follow the step prompt** output by the CLI. It will instruct you to perform verification checks. Execute precisely.

3. **Mark step done** after completing each step:
   ```bash
   sillyspec run verify --done --change {{change_key}} --output "<brief summary of verification results>"
   ```

4. **Repeat** until the verify stage is complete.

### Key Rules

- Always use `sillyspec` CLI commands.
- Verify code quality, test coverage, edge cases, integration, and design conformance.
- Produce a clear PASS / FAIL verdict.
- If verification fails, describe the specific issues found.
- Write `verify-result.md` as instructed by the CLI.
