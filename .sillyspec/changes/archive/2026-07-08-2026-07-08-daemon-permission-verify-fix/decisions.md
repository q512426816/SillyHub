---
author: qinyi
created_at: 2026-07-08T21:50:00
---

# Decisions

## D-001@v1: 所有阶段统一 scan 模式
- type: architecture
- status: accepted
- source: user
- question: 如何保留人审入口同时消除 5min 超时？
- answer: 所有阶段 manual_approval=true + ask_user_only=true（scan 模式）。AskUserQuestion 走 dialog 人审（入口保留），非 AskUserQuestion allow-through（5min 超时消除）。
- normalized_requirement: verify/stage/brainstorm/plan/execute 全部走 scan 模式
- impacts: [FR-001, FR-006, task-01]

## D-002@v1: 撤回 635c0d4a
- type: premise
- status: accepted
- source: code
- question: 635c0d4a 的 permissionMode=bypassPermissions 是否保留？
- answer: 撤回。635c0d4a 基于错误前提（以为 permissionMode 能停 canUseTool），实际 canUseTool 注入无条件，bypass 不阻止 SDK 调用。改回 default，靠 ask_user_only 解决超时。
- normalized_requirement: session-manager.ts:797 permissionMode 改回 default
- impacts: [FR-002, task-02]

## D-003@v1: stage 回写从 agent_runs 推导
- type: architecture
- status: accepted
- source: code
- question: stage 回写依赖 sillyspec.db 还是 agent_runs？
- answer: agent_runs.status 推导。新增 _sync_stage_status_from_run，不复用 sync_stage_status（后者读 sillyspec.db，依赖 spec 同步，归 spec-sync-fix）。独立路径避免耦合。
- normalized_requirement: complete_lease 收尾从 agent_runs 推导 stage 状态
- impacts: [FR-004, task-05]

## D-004@v1: verify requires_worktree=false
- type: boundary
- status: accepted
- source: user
- question: verify worktree 矛盾怎么解？
- answer: 改配置不要求 worktree（YAGNI，worktree-vestigial 决策不变，配合 host-fs-delegate 让 cwd 正确）。
- normalized_requirement: verify stage requires_worktree=false
- impacts: [FR-005, task-06]
