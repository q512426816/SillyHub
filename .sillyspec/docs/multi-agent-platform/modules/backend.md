---
author: qinyi
created_at: 2026-06-02T14:50:07+08:00
---

# backend

## Current State

- `SpecBootstrapService.bootstrap()` returns an async AgentRun contract for `/spec-bootstrap`; execution continues in `_execute_bootstrap_agent_run()`.
- Bootstrap execution uses `AgentSpecBundle -> ClaudeCodeAdapter -> AgentRunLog/SSE -> SpecValidator`, not a direct SillySpec CLI shortcut.
- `ClaudeCodeAdapter` builds a guarded Claude CLI command: Docker currently has `claude`, `sillyspec`, and `stdbuf`, while non-coreutils or Windows environments can still launch `claude` directly.
- Bootstrap writes and publishes an initial `stdout` AgentRunLog after the run enters `running`; adapter `on_log` callbacks are committed per event for DB replay while the adapter owns live stdout/tool_call Redis publication.
- Adapter subprocess spawn failures publish a `stderr` event followed by `done`, so SSE clients receive a visible failure instead of waiting on an empty stream.

## Change Index

| Date | Change | Summary |
|---|---|---|
| 2026-06-02 | 2026-06-02-spec-bootstrap-agent-stream-interaction | Fixed bootstrap AgentRun SSE empty output by fixing bootstrap Redis publish, committing adapter callback logs immediately, publishing a bootstrap start event, and guarding adapter spawn failures. |
