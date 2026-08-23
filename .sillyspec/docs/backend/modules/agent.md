---
schema_version: 1
doc_type: module-card
module_id: agent
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 智能体执行引擎（agent）

## 定位
平台核心执行引擎：AI Agent（Claude Code / Codex / GLM 等）运行编排。负责 AgentRun 生命周期、
执行上下文（spec bundle → CLAUDE.md）构建、交互式 AgentSession、mission（多 agent 团队委派）
调度，以及 `profile/` AgentProfile 三层配置层（daemon→agent→workspace）。派发落地经
RunPlacementService 选 daemon 运行时 + lease，与 daemon 模块双向协作（agent 下发 / daemon
完成回调 run_sync）。

## 契约摘要
- 文件制品面（2026-08-23-agent-file-upload-mcp）：`POST /api/agent/file-artifacts`
  （multipart file/description/run_id + X-Session-Id 会话场景；WORKSPACE_WRITE 双路径
  鉴权，落 File 行 owner_type=agent_session/agent_run + AgentRunLog 日志行
  channel=tool_call/tool_kind=FileUpload/dedup_key=file-upload:{file_id}（IntegrityError
  重放防护）+ Redis 双通道 publish（submit_run_input 同款模式，失败 WARNING 降级））；
  `GET /api/agent/file-artifacts?session_id=|run_id=`（WORKSPACE_READ + 锚复核，
  FileMetaResp 倒序）。daemon sillyhub-file MCP 的上传直连此端点。
- run 面：`POST /{wid}/agent/runs`（创建）+ 子路由
  `GET /agent/runs/{run_id}`（详情）、`/kill`（统一 kill 通道）、`/input`、
  `/logs`、`/stream`（SSE）、`/resume`、`/approve`、`GET|POST /checkpoint`；
  `GET /api/agent-runs/{run_id}/execution-context`（组装执行上下文）；
  `GET /{wid}/tasks/{task_id}/agent/runs`（任务维度）。
- 会话面：`GET /{wid}/agent-sessions?include_ended=`（false=active-only 最小字段，
  审批中心聚合用；true=全量含已结束完整 `AgentSessionListItem`，批量取作者展示名 +
  首条 user_input 截 30 字标题防 N+1，coalesce(last_active_at, created_at) desc，
  跨成员可见）；`GET|POST /{wid}/dialogs`；mission 面 `GET|POST /{wid}/missions`、
  `GET /missions/{mid}`、`POST /missions/{mid}/cancel`。
- 服务层：
  - `AgentService`（service.py）：start_run / kill_run / submit_run_input /
    resume / approve / start_stage_dispatch（change 阶段派发入口）/
    start_scan_dispatch / cleanup_stale_runs / stream_run_logs(_session_logs)。
  - `ExecutionCoordinatorService`（coordinator.py）：乐观锁 + 指纹校验 + token 校验。
  - `RunPlacementService`（placement.py）：选 daemon 后端，无在线抛
    `NoOnlineDaemonError`；含 borrow 解析（borrow_resolver.py，业务人员借用 daemon，
    落 daemon_borrow_audit 审计）。
  - mission：`MissionService`（start_mission 等）/ `MissionControlService` /
    `MissionExecutionService` / `orchestrator.py`（schedule_loop 编排）；
    `orchestration_mode: team|external`——external 放行进 team_mission_entry 但跳过
    orchestrator run / lease spawn。
  - `dispatch_worker`（execution.py / mcp_tools.py / router.py）：可选参
    `worktree_path` / `branch` / `worker_prompt`（caller-worktree 路径）。
  - profile 子包（profile/）：`AgentProfileService`——create / list / get / update /
    delete / copy / resolve_profile / list_visible_all；可见性 = 工作区成员可读 +
    属主可改 + 系统默认档案（is_system_default）不受删；`seed.py` 启动期补种系统默认
    （Claude Code 默认 / Codex 默认；平台角色模板已全部下线，仅按确定性 UUID 回收残留）。
  - 委派规划：`delegation.py`——`CoordinatorPlanner.plan` + `GLMConfig.from_env`
    （LLM 委派路由，route/parse_delegations；测试须 monkeypatch from_env 防打真 LLM）。
  - 支撑件：`context_builder.py`（build_spec_bundle / render_bundle_to_claude_md）、
    `finalizer.py`（run/mission 收尾 merge 与清理）、`post_scan_validator.py`
    （post-scan 校验）、`diff_collector.py`（产出物 diff）、
    `skills_bundle_service.py`（sillyspec skills 打包，daemon 分发源）、`control.py`。
- 模型：agent_runs（~45 字段：spec_strategy/provider/usage/gate_result/worktree_branch
  等）、agent_run_logs（tool_kind/subagent/dedup_key）、agent_sessions、agent_missions、
  agent_run_dependencies、agent_artifacts、daemon_borrow_audit。

## 关键逻辑
```
start_run:
  placement 选 daemon(无在线→NoOnlineDaemonError)
  _try_acquire_lease 占 worktree/daemon lease
  build_spec_bundle + render CLAUDE.md + 应用 profile(system_prompt 经 SDK
    systemPrompt={preset:claude_code, append} 注入, 写 lease.metadata)
  ExecutionCoordinatorService 启动 → 落 AgentRun
  后台监控 tool failure(should_warn_tool_failure 阈值告警不终止)

dispatch_worker caller-worktree(路径A):
  worktree_path 非空 → 跳过 git_worktree_add, 作 daemon root_path,
  且不写 run.worktree_branch(防 finalize 误 merge caller 主仓)
  worker_prompt 非 None → 覆写 render_worker_prompt(caller 注入约束)

mission external 三重防御: ①入口跳过 orchestrator/lease spawn
  ②converge 检测 external 跳过 finalize/cleanup(不 merge/不清 worktree)
  ③路径A 不写 worktree_branch(误进 finalize 也无 branch 可 merge)
```

## 注意事项
- agent↔daemon 双向引用：agent 选 runtime 并下发 lease，daemon 完成后回调 agent
  （run_sync 同步结果）；kill 走统一通道（daemon-kill-channel 后），`AgentKillResponse`
  为唯一契约。
- kill/resume/approve 有状态前置（AgentRunNotResumable / NotPendingApproval 等），
  改状态机需同步守护测试（test_kill_and_state_mapping.py 等）。
- spec bundle 是 agent 行为上下文的真相源，改 bundle 渲染影响所有 run；
  profile.system_prompt 注入写 lease.metadata.system_prompt（空不写键零回归）。
- stageProfileId 每阶段独立持久化 `change.stages[<stage>].profile_id`
  （PATCH 端点在 change 模块）。
- mission external 三重防御链（入口/converge/无 branch）任一改动都需回归
  `test_mission_external_mode.py`；路径A 不写 worktree_branch 是 D-008 定案。
- delegation 走真实 LLM（GLMConfig.from_env），测试必须 monkeypatch 防烧 token
  （本机 shell 网关变量会泄进 pytest）。
- 用户可见错误文案中文（error-message-l10n）；守护测试防回退。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
