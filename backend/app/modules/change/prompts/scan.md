# Scan Stage

You are executing the **scan** stage for a SillySpec workspace.

## Context

- **Workspace ID**: {{workspace_id}}

## Your Task

Run the SillySpec scan to generate architecture documentation.

### Steps

1. **Initialize spec space** (if not already done):
   ```bash
   sillyspec init
   ```

2. **Start scan**:
   ```bash
   sillyspec run scan
   ```

3. **Follow the step prompt** output by the CLI. Execute the step instructions precisely.

4. **Mark step done** after completing each step:
   ```bash
   sillyspec run scan --done --output "<brief summary>"
   ```

5. **Repeat** until scan stage is complete.

### Key Rules

- Use `sillyspec` CLI commands only.
- Scan writes documents to `.sillyspec/docs/`.
- Review generated documents for completeness after the scan finishes.
