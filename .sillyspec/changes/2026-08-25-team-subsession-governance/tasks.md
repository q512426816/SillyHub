---
author: qinyi
created_at: 2026-08-25 20:05:00
---

# 任务清单（Tasks）— 团队分身子会话化 P1 治理地基

> Wave 分组与依赖关系在 plan 阶段（`sillyspec run plan`）细化；本文件为
> brainstorm 产出的粗粒度任务底稿，plan 会重排为可执行 Task 列表。

## Wave 1 数据模型

- task-01 alembic 迁移：agent_sessions 加 parent_session_id / worker_done_at + 索引
- task-02 model.py：AgentSession 字段 + mission_worker_sessions / resolve_mission_for_session（环检测）

## Wave 2 派发链路

- task-03 execution.py worktree 块抽共享 helper（git 探测 / direct 旁路 / worktree_add）
- task-04 placement.py：prepare_interactive_dispatch 增 stage 参数；代表 binding 钉定模式（跳属主校验）
- task-05 daemon/session/service.py：create_session 三元组模式参数化复用（parent / owner / stage / 首 run 双标记）
- task-06 mcp_tools._dispatch_worker_core 换子会话三元组派发（保留 scope/越权/治理门/在线预检/AgentRunWorkspace）
- task-07 mission_context.py 分身任务简报渲染（objective + worktree 约束 + worker_done 用法）

## Wave 3 完成信号与判据

- task-08 daemon mcp-server.ts 分身受限 server（worker_done 单工具 + env 门控 + per-session id 覆盖）
- task-09 daemon session-manager.ts _resolveMainAgentMcp 分身分支（create/restore/reload 三路）
- task-10 backend worker_done 端点（worker_done_at + summary 挂首 run + SETNX DEL 重开工 + 迟到 409 / include_terminal）
- task-11 mission.py is_worker_complete + mission_derive_status（虚拟 run 映射 + workers_only + 优先级）
- task-12 五处判据点 + 五个 derive 消费点替换（_converge_core / converge_explicit / schedule_loop / _team_mission_summary / _mission_status_core / workers_all_terminal_with_stats / cleanup_mission）

## Wave 4 生命周期与治理

- task-13 finalizer converge 沿树批量 end_session（merge 成功后；冲突不收口）
- task-14 control cancel 名单扩子会话 + can_dispatch_worker 口径 + cost_from_runs union
- task-15 patrol 孤儿子会话扫描补收口

## Wave 5 UI 与收尾

- task-16 daemon/schema.py + daemon/router.py：TeamMissionWorkerSummary 加 sub_session_id / first_run_id；_team_mission_summary 子会话行化
- task-17 pnpm gen:types + api-types.ts + openapi.json 同步
- task-18 team-task-block 分身行点击复用 session-panel
- task-19 测试补全（backend test_worker_subsession_* + daemon interactive 测试）+ 全量回归
