---
author: qinyi
created_at: 2026-07-08T21:50:00
---

# Proposal

## 动机
智能体执行日志 a73e41a5（verify stage）失败：2h45min/103 turn/$4.37 无果。verify 链路在 daemon-client 架构下完全跑不通，阻塞 SillySpec 流程。

## 关键问题
1. **5min 超时 = daemon 远程人审 resolver 超时**：verify/stage 走了 manualApproval=true 但 ask_user_only=false，所有工具走 resolver 等前端人审，前端无响应 → 5min 超时。635c0d4a 试图用 permissionMode=bypassPermissions 修，但基于错误前提（canUseTool 注入无条件，bypass 不阻止 SDK 调 canUseTool），未生效。
2. **CLI deny 规则坑 sillyspec**：permission-rules.ts 的 `deny Write(**)` + `allow [C:\Users\qinyi]`，sillyspec 写 `c:\dev\null` 等临时路径被拒，CLI 跑不起来。
3. **stage 状态不回写**：complete_lease 收尾没回写 `stages.last_dispatch.status`，卡 running，流程无法推进。
4. **verify requires_worktree 与架构冲突**：worktree 已旁路（YAGNI），verify 仍要求 worktree，agent 跑在错目录。

## 变更范围
- Phase 1: 所有 stage 统一 scan 模式（manual_approval=true + ask_user_only=true），撤回 635c0d4a
- Phase 2: CLI deny + PolicyEngine 放行 sillyspec 临时路径
- Phase 3: complete_lease 收尾补 stage 回写（从 agent_runs 推导，新增 `_sync_stage_status_from_run`）
- Phase 4: verify requires_worktree=false

## 不在范围内（显式清单）
- 不修 spec 双向同步（归 2026-06-28-daemon-client-spec-sync-strategy）
- 不修路径三重错位（归 2026-07-06-daemon-host-fs-delegate）
- 不恢复 worktree（YAGNI，worktree-vestigial 决策不变）
- 不改 scan 人审路径（已正常）

## 成功标准（可验证）
- verify stage 重跑不再 5min 超时
- sillyspec CLI 能执行（写临时文件不被拒）
- verify 完成后 `stages.last_dispatch.status` 推进到 completed/failed
- AskUserQuestion 在所有阶段能弹框人审（入口保留）
- 写安全：越界写仍被 deny（PolicyEngine + CLI deny 双重）
