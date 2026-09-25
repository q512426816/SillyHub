# Thin Stage（轻量变更）

You are executing the **thin** stage for a SillySpec change — a lightweight change
(轻量变更) running the 2-call SillySpec flow protocol.

## Context

- **Change**: {{change_title}}
- **Change Key**: {{change_key}}
- **Workspace ID**: {{workspace_id}}

## Your Task

Run the SillySpec lightweight-change flow for this change: `flow start` → do the
work → `flow done`. Exactly two SillySpec calls, nothing else.

### Steps

1. **Start the flow** (call 1 of 2):

   ```bash
   sillyspec flow start --change {{change_key}}{{platform_args}} --input "<多行需求文本>"
   ```

   The `--input` text MUST be multi-line and MUST follow this exact gate format
   (SillySpec clarity gate rejects anything else with exit code 2):

   - Line 1: one line of motivation (what and why, in Chinese).
   - Then a standalone section header line, exactly `成功标准：`
   - Then one criterion per line, each as a markdown list item:

   ```
   <一句话动机说明>
   成功标准：
   - <可验证的标准 1>
   - <可验证的标准 2>
   ```

   ⚠️ NEVER write the criteria inline on the header line (e.g.
   `成功标准：xxx` on a single line) — the gate rejects single-line inline
   criteria. The header line stands alone; every criterion is its own `- ` line.

2. **Do the work** (no SillySpec call): implement the change and its tests.
   Along the way, fill the AGENT slots the CLI creates:

   - In `design.md`: the four AGENT sections — each needs at least one line;
     `不适用：<理由>` is an acceptable answer where truly not applicable.
   - In `requirements.md`: the test-binding slots — same rule, at least one
     line each (`不适用：<理由>` counts).

   Unfilled slots make `flow done` fail — fill them as you go, not after.

3. **Finish the flow** (call 2 of 2):

   ```bash
   sillyspec flow done --change {{change_key}}{{platform_args}}
   ```

   Expect these semantics:

   - An intermediate `flow done` exit code 1 is NORMAL (empty-slot rejection,
     or automatic thickening when real tests fail). Fix the reported problem
     and re-run the SAME `flow done` command — it resumes from where it
     stopped (断点续).
   - A genuinely failing real test means the whole change fails
     (fail-closed). Do not mark it done.

4. **Done**: after `flow done` succeeds, the change is archived automatically.
   No further SillySpec command is needed.

### Key Rules

- Exactly two SillySpec calls (`flow start`, `flow done`); re-running `flow
  done` after fixing an intermediate failure is a resume, not a third call.
- Keep changes minimal and focused; run focused tests only (never the full
  suite — that is CI's job).
- All work happens inside this change's directory; never touch other changes.
- Write code comments and report in 简体中文.
