---
author: qinyi
created_at: 2026-07-08T21:50:00
---

# Requirements

## 角色表
| 角色 | 说明 |
|---|---|
| 平台用户 | 触发 stage dispatch，接收 AskUserQuestion 人审弹框 |
| daemon | 执行 stage，注入 canUseTool，写校验 |
| backend | dispatch stage（manual_approval+ask_user_only），complete_lease 回写 stage |

## 功能需求

### FR-001: 所有 stage 统一 scan 模式
- Given: stage dispatch（verify/stage/brainstorm/plan/execute）
- When: backend 创建 lease
- Then: lease.metadata.manual_approval=true + ask_user_only=true（对齐 scan）

### FR-002: 撤回 635c0d4a
- Given: session-manager.ts:797
- When: 构建 driverOpts
- Then: permissionMode='default'（不再 bypassPermissions）

### FR-003: sillyspec 临时路径放行
- Given: permission-rules.ts CLI --settings + PolicyEngine allowed_roots
- When: sillyspec 写 c:\dev/null / 系统 temp / .sillyspec/.runtime
- Then: allow（不被 deny）

### FR-004: stage 状态回写
- Given: complete_lease 收尾，agent_runs.status=completed/failed
- When: complete_lease 执行
- Then: changes.stages.last_dispatch.status 推进 running→completed/failed（新增 _sync_stage_status_from_run，从 agent_runs 推导）

### FR-005: verify requires_worktree=false
- Given: verify stage config
- When: dispatch verify
- Then: requires_worktree=false（daemon-client 不用 worktree）

### FR-006: 人审入口保留
- Given: 任意 stage，agent 调 AskUserQuestion
- When: canUseTool 触发
- Then: 走 dialog 人审（前端弹框），不 5min 超时

### FR-007: 写安全兜底
- Given: 任意 stage，agent 写越界路径（非 allowed_roots + 非临时路径）
- When: canUseTool _wrapWithWriteGuard
- Then: deny（PolicyEngine + CLI deny 双重）

## 非功能需求
- 兼容 Windows/Linux/macOS（临时路径跨平台）
- 不破坏 scan 现有路径
- 不破坏 batch daemon-client 路径

## D-xxx@vN 覆盖关系
- D-001@v1 统一 scan 模式 → FR-001, FR-006
- D-002@v1 撤回 635c0d4a → FR-002
- D-003@v1 stage 从 agent_runs 推导 → FR-004
- D-004@v1 verify requires_worktree=false → FR-005
