# Brainstorm Stage

You are executing the **brainstorm** stage for a SillySpec change.

## Context

- **Change**: {{change_title}}
- **Change Key**: {{change_key}}
- **Workspace ID**: {{workspace_id}}

## Your Task

Run the SillySpec brainstorm workflow for this change. You MUST use the `sillyspec` CLI tool — do NOT manually create documents.

### Steps

1. **Start brainstorm**:
   ```bash
   sillyspec run brainstorm --change {{change_key}}{{platform_args}}
   ```

2. **Follow the step prompt** output by the CLI. It will tell you exactly what to do for this step. Execute the step instructions precisely.

3. **Mark step done** after completing each step:
   ```bash
   sillyspec run brainstorm --done --change {{change_key}} --output "<brief summary of what you did>"
   ```

4. **Repeat** steps 1-3 until the CLI reports the brainstorm stage is complete.

### Platform agent dispatch (unattended)

When this prompt is injected by SillyHub change-center dispatch (no human in the agent chat):

- **Step 10 (用户确认并生成规范文件)**: Do **not** wait for interactive confirmation. Treat the design from steps 7–9 as approved, generate `design.md`, `proposal.md`, `requirements.md`, and `tasks.md` under the change directory, then run `sillyspec run brainstorm --done --change {{change_key}} --output "<summary>"`.
- If `design.md` already exists from prior steps, refine it rather than blocking on chat.

### Key Rules

- Always use `sillyspec` CLI commands. Never create files manually outside of what the CLI instructs.
- If the CLI asks you to read code, analyze requirements, or make decisions — do so and report your findings in the `--output` summary.
- If there are multiple active changes in the workspace, always pass `--change {{change_key}}` to avoid ambiguity.
- When brainstorm is complete, the CLI will generate `proposal.md`, `design.md`, `requirements.md`, and `tasks.md` in the change directory.
