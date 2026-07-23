---
author: qinyi
created_at: 2026-07-08T21:55:00
plan_level: full
---

# 计划：daemon 权限模型 + verify stage 配置修复

## 来源
brainstorm 设计：所有阶段统一 scan 模式 + 放行 sillyspec 临时路径 + stage 回写从 agent_runs 推导 + verify requires_worktree=false。

## 范围
- backend: placement.py / lease/service.py / agent/service.py
- sillyhub-daemon: session-manager.ts / permission-rules.ts / policy allowed_roots

## Wave 分组与依赖

### Wave 1: 权限模型核心（解决 5min 超时）
- [x] task-01: placement 强制 scan 模式（backend/app/modules/agent/placement.py）— prepare_interactive_dispatch 强制 manual_approval=true + ask_user_only=true（覆盖：FR-001, D-001）
- [x] task-02: 撤回 635c0d4a permissionMode（sillyhub-daemon/src/interactive/session-manager.ts:797）— bypassPermissions 改回 default（覆盖：FR-002, D-002）

### Wave 2: sillyspec 临时路径放行（依赖 Wave 1）
- [x] task-03: CLI deny 放行临时路径（sillyhub-daemon/src/permission-rules.ts）— allow 加 c:\dev\null / 系统 temp / .sillyspec/.runtime（覆盖：FR-003）
- [x] task-04: PolicyEngine allowed_roots 放行（sillyhub-daemon/src/daemon.ts）— PolicyCache 3 处注入点 union 临时路径（覆盖：FR-003）

### Wave 3: stage 回写 + worktree（独立，可与 Wave 1/2 并行）
- [x] task-05: complete_lease 补 stage 回写（backend/app/modules/daemon/lease/service.py:279）— 新增 _sync_stage_status_from_run，从 agent_runs.status 推导，不复用 sync_stage_status（覆盖：FR-004, D-003）
- [x] task-06: verify requires_worktree=false（backend/app/modules/change/dispatch.py）— STAGE_AGENT_CONFIG VERIFY 项（覆盖：FR-005, D-004）

### Wave 4: 测试 + 部署（依赖 Wave 1/2/3）
- [x] task-07: 测试 scan 模式 + 人审入口（backend/tests + sillyhub-daemon/tests）— verify/stage manual_approval=true + AskUserQuestion dialog 不超时（覆盖：FR-001, FR-006）
- [x] task-08: 测试写安全兜底（sillyhub-daemon/tests）— 越界写 deny + 临时路径 allow（覆盖：FR-007）
- [x] task-09: 测试 stage 回写（backend/tests）— complete_lease 后 stages.last_dispatch.status 推进（覆盖：FR-004）
- [x] task-10: bundle + 部署 daemon（sillyhub-daemon/scripts）— pnpm bundle + rebuild backend + 重启 daemon（覆盖：R-04）【延后 deployment 阶段：verify 后单独跑】

## 依赖图
```
Wave 1 (task-01,02) ──→ Wave 2 (task-03,04) ──┐
                                               ├──→ Wave 4 (task-07,08,09,10)
Wave 3 (task-05,06) ──────────────────────────┘
```
Wave 3 独立于 Wave 1/2，可并行。

## 验收
- verify stage 重跑不 5min 超时（Wave 1）
- sillyspec CLI 能执行（Wave 2）
- stage 状态回写（Wave 3）
- 测试全绿（Wave 4）
- daemon 部署生效（Wave 4 task-10）

## 风险应对
- R-01 写安全：task-08 测试越界写 deny
- R-04 部署：task-10 bundle + 重启
- R-05 manualApproval 来源：task-01 execute 时确认（a73e41a5 config 空但走了人审，需查 daemon 创建 verify session 的 manualApproval 实际值）
