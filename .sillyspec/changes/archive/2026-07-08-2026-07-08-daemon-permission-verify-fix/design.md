---
author: qinyi
created_at: 2026-07-08T21:30:00
---

# Design: daemon 权限模型 + verify stage 配置修复

## 1. 背景

智能体执行日志 a73e41a5（verify stage）失败：耗时 2h45min、103 turn、$4.37 后无果。深入分析暴露 4 个根因，且 635c0d4a 的修复基于错误前提、未生效。

### 根因链（代码 + 日志实证）

1. **5min 超时 = daemon 远程人审 resolver 超时**（`permission-resolver.ts:205`）。a73e41a5 走了 approvalReady=true 分支（manualApproval 实际 true），且 `ask_user_only=false`，导致所有非 AskUserQuestion 工具走 `resolver.register`（`session-manager.ts:1184`）等前端人审，前端无响应 → 5min 超时。
2. **635c0d4a 无效**：把 `permissionMode` 改 `bypassPermissions`，但 canUseTool 注入无条件（`session-manager.ts:807-864`），SDK 在 bypassPermissions 下仍调用注入的 canUseTool。日志"Runtime Policy 拒绝 c:\dev\null"是 PolicyEngine 中文文案，证明 canUseTool 被调用。
3. **scan 不超时**因为 `ask_user_only=true`（`session-manager.ts:1167-1170`）：非 AskUserQuestion 工具 allow-through。
4. **CLI deny 规则坑 sillyspec**（`permission-rules.ts`）：`deny Write(**)` + `allow [C:\Users\qinyi]`，sillyspec 写 `c:\dev\null` 等临时路径被拒。
5. **stage 状态不回写**：`sync_stage_status` 方法存在但生产代码未调用，`complete_lease` 收尾没回写 `stages.last_dispatch.status`，卡 running。
6. **verify requires_worktree=true 与 daemon-client 架构冲突**：worktree 已旁路（worktree-vestigial），verify 仍要求 worktree。

### 用户诉求
- 所有阶段保留人审入口（agent 问问题能弹框）
- 5min 超时消除
- sillyspec CLI 能跑
- 写安全不裸奔

## 2. 设计目标
- verify/stage 链路端到端跑通（sillyspec CLI 可执行、stage 状态回写、verify 在正确目录跑）
- 所有阶段保留 AskUserQuestion 人审入口
- 写安全等价兜底（canUseTool 写校验 + CLI deny 双重）

## 3. 非目标
- 不修 spec 双向同步（归 2026-06-28-daemon-client-spec-sync-strategy）
- 不修路径三重错位（归 2026-07-06-daemon-host-fs-delegate）
- 不恢复 worktree（YAGNI，worktree-vestigial 决策不变）
- 不改 scan 人审路径（已正常）

## 4. 拆分判断
4 问题点围绕"verify 链路跑通"目标，耦合度高（权限层+流程层+配置层），任务数<10，不满足拆分标准。一个变更修完端到端跑通。

## 5. 总体方案

### Phase 1: 权限模型统一 scan 模式
- **backend**: 所有 stage dispatch（verify/stage/brainstorm/plan/execute）强制 `manual_approval=true + ask_user_only=true`（对齐 scan，`placement.py prepare_interactive_dispatch`）
- **daemon**: 撤回 635c0d4a 的 `permissionMode=bypassPermissions`（改回 default），canUseTool 注入逻辑不变
- 效果: AskUserQuestion 走 dialog 人审（入口保留），非 AskUserQuestion allow-through（5min 超时消除）

### Phase 2: sillyspec 临时路径放行
- `permission-rules.ts`: CLI `--settings` allow 放行 sillyspec 临时路径（`c:\dev\null`、系统 temp、`.sillyspec/.runtime`）
- PolicyEngine allowed_roots: 同步放行
- 效果: sillyspec 写临时文件不被拒

### Phase 3: stage 状态回写
- backend `complete_lease`（`lease/service.py:279`）收尾: 补 stage 状态回写，从 `agent_runs.status` 推导（不依赖 sillyspec.db）
- `changes.stages.last_dispatch.status`: running → completed/failed
- verify 结果: 从 `agent_runs.output_redacted` 提取落 change
- 效果: verify 完成后 stage 推进

### Phase 4: verify worktree 配置
- `agent/service.py`: verify stage 的 `requires_worktree` 改 false（daemon-client 不用 worktree）
- 配合 host-fs-delegate 让 agent cwd 正确

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/agent/placement.py | prepare_interactive_dispatch 强制 manual_approval=true + ask_user_only=true |
| 修改 | backend/app/modules/daemon/lease/service.py | complete_lease 收尾补 stage 状态回写（从 agent_runs.status 推导） |
| 修改 | backend/app/modules/change/dispatch.py | verify stage requires_worktree=false（STAGE_AGENT_CONFIG VERIFY 项；agent/service.py 是消费方不改） |
| 修改 | sillyhub-daemon/src/interactive/session-manager.ts | 撤回 635c0d4a permissionMode=bypassPermissions（改回 default） |
| 修改 | sillyhub-daemon/src/permission-rules.ts | CLI deny 放行 sillyspec 临时路径 |
| 修改 | sillyhub-daemon/src/daemon.ts | PolicyCache 注入点（:948-953）放行临时路径 |

## 7. 接口定义
（execute 阶段细化，核心：）
- `placement.prepare_interactive_dispatch(manual_approval=True, ask_user_only=True)` — 所有 stage
- `complete_lease → _sync_stage_status_from_run(run_id, status, output)` — **新增**内部方法，从 `agent_runs.status/output_redacted` 推导 stage 状态，直接更新 `changes.stages.last_dispatch.status`
- **不复用** `dispatch_svc.sync_stage_status`（后者读 sillyspec.db，依赖 spec 同步，归 2026-06-28-daemon-client-spec-sync-strategy；本变更独立路径避免耦合）

## 7.5 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| dispatch stage | backend | daemon | leaseId, manual_approval=true, ask_user_only=true | lease claimed |
| canUseTool (AskUserQuestion) | daemon SDK | daemon resolver | toolName, dialogKind | dialog 等待（不超时） |
| canUseTool (其他工具) | daemon SDK | daemon | toolName | allow-through（写校验靠 _wrapWithWriteGuard） |
| complete_lease | daemon | backend | leaseId, runId, status | run completed |
| sync_stage_status | backend complete_lease | backend change | run_id, status, output | stages.last_dispatch.status running→completed/failed |

## 8. 数据模型
无表结构变更。`changes.stages` JSON 字段 `last_dispatch.status` 推进。

## 9. 兼容策略
- scan 已用 `manual_approval=true + ask_user_only=true`，不受影响
- 未配置的 stage 默认走新 scan 模式（行为对齐 scan）
- 635c0d4a 的 bypassPermissions 撤回，恢复 default（不破坏现有，bypass 本就未生效）

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-01 | ask_user_only=true 时写工具 allow-through，写安全靠 PolicyEngine + CLI deny | P0 | 双重校验 + 测试越界写仍 deny |
| R-02 | sillyspec 临时路径放行扩大写安全范围 | P1 | 仅放行已知临时路径（c:\dev\null、系统 temp），不放行任意 |
| R-03 | stage 回写从 agent_runs 推导，可能和 sillyspec.db 真实状态不一致 | P1 | 推导只看 run status，sillyspec.db 同步归 spec-sync-fix |
| R-04 | 撤回 635c0d4a 需重新 bundle + 部署 daemon | P2 | execute 后 bundle + 重启 |

## 11. 决策追踪

### D-001@v1: 所有阶段统一 scan 模式
- type: architecture
- question: 如何保留人审入口同时消除 5min 超时？
- answer: 所有阶段 manual_approval=true + ask_user_only=true（scan 模式）
- normalized_requirement: verify/stage/brainstorm/plan/execute 全部走 scan 模式

### D-002@v1: 撤回 635c0d4a
- type: premise
- question: 635c0d4a 的 permissionMode=bypassPermissions 是否保留？
- answer: 撤回。基于错误前提（canUseTool 导致超时），实际超时是 ask_user_only=false 全工具人审。改回 default。
- normalized_requirement: session-manager.ts:797 permissionMode 改回 default

### D-003@v1: stage 回写从 agent_runs 推导
- type: architecture
- question: stage 回写依赖 sillyspec.db 还是 agent_runs？
- answer: agent_runs.status 推导（不依赖 spec 同步，独立可交付）
- normalized_requirement: complete_lease 收尾从 agent_runs 推导 stage 状态

### D-004@v1: verify requires_worktree=false
- type: boundary
- question: verify worktree 矛盾怎么解？
- answer: 改配置不要求 worktree（YAGNI，配合 host-fs-delegate）
- normalized_requirement: verify stage requires_worktree=false
