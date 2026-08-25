---
author: qinyi
created_at: 2026-08-25 20:05:00
---

# 任务清单（Tasks）— 团队分身子会话化 P1 治理地基

- [ ] task-01: 数据模型：alembic 迁移加 parent_session_id/worker_done_at + mission_worker_sessions/resolve_mission_for_session 环检测解析
- [ ] task-02: execution.py worktree 块抽共享 helper（git 探测/direct 旁路/worktree_add）
- [ ] task-03: placement 增 stage 参数写 lease metadata + 代表 binding 钉定模式（跳属主校验）
- [ ] task-04: create_session 三元组模式参数化复用（parent/owner/stage/首 run 双标记）+ mission_context 分身简报
- [ ] task-05: dispatch_worker 换子会话三元组派发（保留 scope/越权/治理门/在线预检/AgentRunWorkspace）
- [ ] task-06: daemon 分身受限 MCP server（worker_done 单工具 + env 门控 + session-manager 三路注入分支）
- [ ] task-07: backend worker_done 端点（worker_done_at + summary 挂首 run + SETNX DEL 重开工 + 迟到 409）
- [ ] task-08: is_worker_complete + mission_derive_status（虚拟 run 映射 + workers_only + 优先级）
- [ ] task-09: 判据点全面替换（_converge_core/converge_explicit/schedule_loop/_team_mission_summary/_mission_status_core/workers_all_terminal_with_stats/cleanup_mission）
- [ ] task-10: converge 沿树批量 end_session（merge 成功后收口，冲突不收口）
- [ ] task-11: control 治理口径（cancel 名单扩子会话 + can_dispatch_worker 混跑口径 + cost_from_runs union）
- [ ] task-12: patrol 孤儿子会话扫描补收口
- [ ] task-13: TeamMissionWorkerSummary 加 sub_session_id/first_run_id + _team_mission_summary 子会话行化 + gen:types 同步
- [ ] task-14: team-task-block 分身行点击复用 session-panel 打开
- [ ] task-15: 测试补全（backend + daemon）+ 三端全量回归 + 预期行为变更的既有断言更新（test_control_orchestrator_exclusion / test_session_team_mission / test_team_mission_create_block / test_mission_status / test_patrol / test_converge_mission_reentrant / cli-session-manager-injection / session-manager-main-agent-mcp）
