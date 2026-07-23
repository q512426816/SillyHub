---
author: qinyi
created_at: 2026-07-08T21:50:00
---

# Tasks

| Task | 文件路径 | 覆盖 |
|---|---|---|
| task-01: placement 强制 scan 模式 | backend/app/modules/agent/placement.py | FR-001, D-001 |
| task-02: 撤回 635c0d4a permissionMode | sillyhub-daemon/src/interactive/session-manager.ts | FR-002, D-002 |
| task-03: CLI deny 放行临时路径 | sillyhub-daemon/src/permission-rules.ts | FR-003 |
| task-04: PolicyEngine allowed_roots 放行临时路径 | sillyhub-daemon/src/policy（allowed_roots 配置） | FR-003 |
| task-05: complete_lease 补 stage 回写 | backend/app/modules/daemon/lease/service.py | FR-004, D-003 |
| task-06: verify requires_worktree=false | backend/app/modules/agent/service.py | FR-005, D-004 |
| task-07: 测试 - scan 模式 + 人审入口 | backend/tests + sillyhub-daemon/tests | FR-001, FR-006 |
| task-08: 测试 - 写安全兜底 | sillyhub-daemon/tests | FR-007 |
| task-09: 测试 - stage 回写 | backend/tests | FR-004 |
| task-10: bundle + 部署 daemon | sillyhub-daemon/scripts | R-04 |

细节在 plan 阶段展开。
