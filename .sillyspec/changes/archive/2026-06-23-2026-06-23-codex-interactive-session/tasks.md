---
author: qinyi
created_at: 2026-06-23 21:40:36
---

# Tasks

## Task List

- [ ] task-01: 抽象 interactive driver 与 provider-neutral input queue
  - paths: `sillyhub-daemon/src/interactive/driver.ts`, `sillyhub-daemon/src/interactive/input-queue.ts`, `sillyhub-daemon/src/interactive/types.ts`, `sillyhub-daemon/src/interactive/session-manager.ts`, `sillyhub-daemon/src/interactive/claude-sdk-driver.ts`
  - covers: FR-01, FR-02, FR-03, FR-08, FR-10, D-001@v1, D-006@v1, D-008@v1, D-009@v1

- [ ] task-02: 实现 CodexAppServerDriver 与 JSON-RPC server request 映射
  - paths: `sillyhub-daemon/src/interactive/codex-app-server-driver.ts`, `sillyhub-daemon/src/adapters/json-rpc.ts`, `sillyhub-daemon/tests/**`
  - covers: FR-01, FR-02, FR-03, FR-04, FR-08, FR-09, D-002@v1, D-004@v1, D-006@v1, D-010@v1

- [ ] task-03: daemon 接入 provider-specific interactive executable 与 recovery
  - paths: `sillyhub-daemon/src/daemon.ts`, `sillyhub-daemon/src/cli.ts`, `sillyhub-daemon/src/interactive/session-store-persistence.ts`, `sillyhub-daemon/tests/**`
  - covers: FR-01, FR-03, FR-05, FR-06, D-001@v1, D-002@v1, D-007@v1

- [ ] task-04: backend 放开 Codex reopen 并补齐 session/permission 测试
  - paths: `backend/app/modules/daemon/session/service.py`, `backend/app/modules/daemon/tests/test_session_service.py`, `backend/app/modules/daemon/tests/test_session_permissions.py`
  - covers: FR-06, FR-08, FR-09, D-003@v1, D-006@v1, D-007@v1, D-008@v1

- [ ] task-05: frontend `/runtimes` Codex 改走 interactive panel
  - paths: `frontend/src/components/daemon/runtime-session-dialog.tsx`, `frontend/src/components/daemon/runtime-session-helpers.tsx`, `frontend/src/components/daemon/runtime-session-dialog.test.tsx`, `frontend/src/components/daemon/__tests__/interactive-session-panel.test.tsx`, `frontend/src/components/ask-user-dialog-card.tsx`
  - covers: FR-01, FR-02, FR-05, FR-06, FR-07, FR-09, D-005@v1, D-010@v1

- [ ] task-06: 验证、文档同步与 quick fix 收敛
  - paths: `.sillyspec/docs/sillyhub-daemon/modules/daemon.md`, `.sillyspec/docs/backend/modules/daemon.md`, `.sillyspec/docs/SillyHub/modules/frontend_components.md`, `.sillyspec/docs/SillyHub/modules/frontend_lib.md`, `.sillyspec/knowledge/uncategorized.md`
  - covers: FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08, FR-09, FR-10
