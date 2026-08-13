---
schema_version: 1
doc_type: module-card
module_id: agent
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:33
---
# agent

## 定位
后端「Agent 运行时编排」功能域：把一次 SillySpec 阶段执行（stage dispatch）或独立任务派发成一条 AgentRun，落到在线 daemon 上执行，并管理 mission（多 worker 协同）、幂等/断点续跑、审批、日志流、工具失败监控。是连接「变更工作流」与「本地 daemon 执行」的中枢。

## 契约摘要
- API（tag=agent）：`POST /api/agent/runs`（创建 run）、`POST /api/agent/runs/{id}/kill`、`POST /api/agent/runs/{id}/input`（提交用户输入）、quick-chat、`GET .../runs/{id}/logs/stream`（SSE 日志流）、missions 系列（`POST /missions/{id}/cancel` 等）。
- `AgentService`：核心服务，`start_run` / `start_stage_dispatch` / `start_scan_dispatch` / `kill_run` / `submit_run_input` / `stream_run_logs` / `cleanup_stale_runs`。通过 `RunPlacementService` 选择在线 daemon，`NoOnlineDaemonError` 表示无可用 runtime。
- `ExecutionCoordinatorService`：幂等与断点续跑。`check_idempotency`、`compute_fingerprint`/`validate_fingerprint`（AgentSpecBundle 指纹）、`generate_resume_token`、`resume_run`、`save_checkpoint`/`load_checkpoint`、`request_approval`/`approve`。
- `MissionService` + `MissionControlService`：mission 生命周期（多 worker），`derive_status` 聚合 worker 状态，`can_dispatch_worker` 做并发/成本预算校验，`cancel` 取消。
- `MissionExecutionService`：单 worker 执行，`dispatch_worker`（含 read_only 工具配置）、`collect_artifact` / `collect_completed_artifacts`。
- **worker 档案透传**（2026-08-12-dispatch-bind-agent-profile，修 GAP-6）：`dispatch_worker` 在 `run.agent_profile_id` 非 None 时补调 `_apply_profile_to_lease`（`_apply_worker_profile_to_lease` helper），把 worker 档案的 mcp/skill/凭证/allowed_roots 写进 worker lease.metadata；profile 查不到标 `worker_profile_not_found` failed 不崩 mission（design §9）。
- 与 daemon 的协作：`start_run` 成功后通过 `DaemonWsHub` 通知 daemon 领任务；日志/事件经 daemon 上行回流。

## 关键逻辑
```
# 阶段派发主流程（start_stage_dispatch）
解析 stage 配置 → acquire worktree lease（需写盘时）→ ensure change dir in worktree
→ AgentService.start_run → RunPlacementService 选 daemon
→ DaemonWsHub.notify_task_available → daemon claim → run 进入 running
# 幂等与续跑
check_idempotency(key) 命中则返回既有 run；否则 compute_fingerprint 入库
运行中断 → resume_run(token) → validate_fingerprint → load_checkpoint 续跑
# 工具失败监控
aggregate_tool_failure(logs) → should_warn_tool_failure(threshold) → 告警
```

## 注意事项
- run 与 lease 强耦合：`start_run` 需要写盘时会 `acquire worktree lease`，daemon 完成后通过 lease complete 回调驱动 stage 完结（`_trigger_stage_completion_callback`）。
- fingerprint 变更（AgentSpecBundle 内容变）会使旧 resume token 失效；幂等 key 用于防止同阶段重复派发。
- `cleanup_stale_runs` / `reconcile_stale_runs` 定时清理卡死 run，daemon 重启后靠 `recover_session_after_daemon_restart` 收敛。
- 工具失败监控阈值 `_failure_threshold()` 受配置驱动，前端据此提示风险。

## 变更索引
- 2026-06-27-p0-perf-optimization | `AgentRunLog` 补 `ix_agent_run_logs_timestamp`（单列 timestamp）+ `ix_agent_run_logs_run_timestamp`（run_id, timestamp 联合）索引，优化「按时间范围查日志」与「按 run 查日志并按时间排序」的高频读；迁移 `202606271300`（down_revision `202606261130`），可回滚。该表无 started_at 字段（属 agent_runs）。
- 2026-07-30-daemon-heartbeat-dedup-fix | `AgentRunLog` 加 `segment_id` 列（String 200, nullable, indexed）；流式 partial 行（半截）写 metadata.segmentId、complete 行 NULL，供 backend run_sync override 信号（`[ASSISTANT_OVERRIDE]`/`[THINKING_OVERRIDE]`）跨 submit_messages 调用 DELETE 已落库 partial（task-14）；migration `202608310900`（down_revision `202607301000`）。不入对外 API 响应（DB-only 去重字段）。
- 2026-08-05-skill-content-viewer | `skills_bundle_service` 新增 `read_skill_md(skill_name)`：白名单（sillyspec-* glob 同源 `SKILLS_GLOB`）+ 固定读 SKILL.md（不拼 path，穿越免疫）+ 三分支异常（非白名单/缺失→FileNotFoundError、>1MiB→ValueError），供 daemon `GET /skills/{name}/content` 端点调；纯 stdlib 不引 FastAPI（router 层 catch 转 HTTPException）。

- 2026-08-11-agent-profile-bind-llm-provider | AgentProfile 新增 `llm_provider_id` FK（UUID nullable `ondelete=SET NULL`）+ migration `20260811104500`（单 head，parent `20260810150000`）；AgentProfileCreate/Update/Read DTO 加字段（显式 null=解绑，exclude_unset 语义）；service create/update/clone 透传；`_apply_profile_to_lease` 写 `lease.metadata["llm_provider_id"]`。
- ql-20260813-004-f29e | `backend/app/modules/agent/profile/seed.py` 新增 `ensure_role_template_profiles`：启动时按确定性 UUID 补种 CC / GLM × 5 专家角色模板（架构师、前端、后端、项目经理、测试工程师），含完整 `system_prompt`；`backend/app/main.py` lifespan 调用；`test_profile_seed.py` 补测试。模板 `is_system_default=False`，不影响兜底链。
- ql-20260813-005-7d39 | `backend/app/modules/agent/profile/seed.py` `ensure_role_template_profiles` 收窄为 CC × 5 角色：移除 `_ROLE_TEMPLATE_PROVIDERS` 的 glm 条目，新增 `_DEPRECATED_ROLE_TEMPLATE_IDS`（glm × 5 角色 确定性 UUID）启动时回收 DB 残留 GLM 模板，返回值改 `(inserted, pruned)`；`main.py` log 解构；`test_profile_seed.py` 测试 10→5 + 新增回收测试。删除安全：agent_profiles 被 workspaces/AgentRun 引用均 `ondelete=SET NULL`。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
