---
schema_version: 1
doc_type: module-card
module_id: agent
author: qinyi
created_at: 2026-08-18 01:45:00
---

# Agent 运行编排（agent）

## 定位
后端「Agent 运行编排」功能域：把 SillySpec 阶段派发（stage dispatch）、扫描派发、init 派发、quick-chat/独立任务编排成 AgentRun，落到在线 daemon 执行；管理 mission（多 worker 协同团队）、AgentProfile 配置增强层（mcp/skill/凭证/allowed_roots/绑定供应商的档案）、幂等与断点续跑、审批、kill/输入、日志 SSE 流、借用（borrow）产物回存。
是「变更工作流」与「本地 daemon 执行」之间的中枢。

不负责：阶段流转规则与审核门（change）、daemon 侧执行与消息上行（daemon）、worktree 生命周期（worktree，经 lease 协作）。

## 契约摘要
- **API（tag=agent，workspace 级路径）**：
  - run 创建 / 详情 / 列表、kill、input（提交用户输入）、logs 与 SSE stream、任务维度 run 列表。run 详情 / kill / logs / stream 四端点带对象级授权（`_require_run_workspace`，2026-08-24 会话审查 P1）：run 必须关联路径 workspace（AgentRunWorkspace 行存在），未关联 → 403——权限依赖只校验「调用者在路径 workspace 有权限」，无此守卫任意 workspace 成员可越权读/杀其它工作区的 run（input 端点由 service.submit_run_input 内同款校验覆盖；quick-chat run 无关联走 /api/daemon-chat 专属归属链）。
  - 幂等续跑与审批：resume / approve / checkpoint（存/读）。
  - `/agent-sessions` 工作区活跃会话列表（include_ended 分支 P5 2026-08-24 起 limit/offset 分页默认 200，标题派生改窗口函数每会话取首条 user_input——与 daemon/change router 三处同步）；`/dialogs` 待处理权限对话框；missions 列表与 cancel；`GET /agent-runs/{id}/execution-context`。
  - 文件制品 `POST/GET /agent/file-artifacts`（file_artifacts.py，daemon sillyhub-file MCP 直传 + 前端产出文件区共用）。授权（ql-20260823-013 会话归属人制）：会话场景（X-Session-Id）上传者==`AgentSession.user_id` 即放行——无工作区的 runtime 会话同样可传可列；非归属人回退按会话 workspace 锚复核（POST=WORKSPACE_WRITE / GET=WORKSPACE_READ）。worker 场景（run_id）仍按 `target_workspace_id ?? mission ?? task` 锚链复核，锚 NULL 兜底 deny。
- **AgentService**：
  - `start_run`（独立任务/quick-chat）；无在线 daemon 抛 NoOnlineDaemonError 并标记 run。
  - `start_stage_dispatch`（阶段派发，需写盘时 `_try_acquire_lease` 申请 worktree lease）。
  - `start_scan_dispatch`（扫描派发）；`start_init_dispatch`（init 派发——daemon 侧真正执行 sillyspec init）。
  - `kill_run / submit_run_input / stream_run_logs / stream_session_logs / list_workspace_active_sessions / cleanup_stale_runs`。
  - `persist_borrow_run_output`（借用产物落库 + `_update_borrow_audit_usage` 审计用量）。
- **档案链路**：
  - `_resolve_dispatch_profile`（run 显式 → workspace 默认 → None）→ `_apply_profile_to_lease` 把 mcp/skills/凭证/allowed_roots/llm_provider_id 写进 lease.metadata；profile 查不到标 worker_profile_not_found failed，不崩 mission。
  - 会话侧 `apply_session_profile_to_lease` 同口径。
- **AgentProfile 子域**（profile/）：配置增强层 CRUD + seed。平台角色模板已全部下线（CC×5 与 GLM×5 均移除），`ensure_role_template_profiles` 仅按 `_DEPRECATED_ROLE_TEMPLATE_IDS`（10 个确定性 UUID）回收 DB 残留；系统默认档案（Claude Code 默认 / Codex 默认，is_system_default=True）不受影响，作为兜底链。
- **协调与执行**：
  - ExecutionCoordinatorService：幂等 key、AgentSpecBundle 指纹（compute/validate）、resume token、checkpoint 存读、审批请求/通过。
  - MissionService + MissionControlService：mission 生命周期（多 worker）、`derive_status` 聚合 worker 状态、`can_dispatch_worker` 并发/成本预算校验、cancel。
  - MissionExecutionService：单 worker `dispatch_worker`（含 read_only 工具配置）、产物收集（collect_artifact / collect_completed_artifacts）。
- **辅助组件**：placement（选在线 daemon）、borrow_resolver/context_builder（借用工作区解析与上下文组装；`build_scan_bundle` 按 SpecWorkspace.strategy 三分支生成 scan 指令——platform-managed（含读取失败回退）/repo-mirrored 走平台参数模板，repo-native 走本地模板（`sillyspec run scan --dir <root>` 零平台参数、无 init，产物落源码 `.sillyspec/` 经 CLI 内置 sync 上行），与 stage 派发的 platform-managed 门禁共同消除 scan/stage 注入不对称（2026-08-23-repo-native-spec-backfill））、post_scan_validator（扫描后校验）、delegation（GLM 委派路由）、orchestrator、diff_collector/finalizer（execute 收口合并与清理）、skills_bundle_service（技能 bundle + `read_skill_md` 白名单固定读 SKILL.md 防穿越）、mcp_tools、tool_kind。

## 关键逻辑
```
# 阶段派发主流程
start_stage_dispatch(profile 解析) → 需写盘则 acquire worktree lease → placement 选 daemon
→ DaemonWsHub 唤醒 → daemon claim(lease payload 含 provider/profile 注入) → run running

# 幂等与续跑
check_idempotency(key) 命中返既有 run；否则 compute_fingerprint 入库
中断 → resume_run(token) → validate_fingerprint → load_checkpoint 续跑

# 档案透传
_apply_profile_to_lease(lease.metadata ← profile 的 mcp/skill/凭证/roots/llm_provider_id)
→ daemon lease/context build_claim_payload 消费（含 litellm_proxy 供应商解析）

# execute 团队
_dispatch_execute_team → 多 worker 并行 → 全员收敛 → daemon run_sync._advance_team_stage 推阶段
```

## 注意事项
- run 与 lease 强耦合：需写盘的派发先申请 worktree lease，daemon 完成后经 lease complete 回调驱动 stage 收口——改 lease 生命周期须同步 daemon run_sync 回调链。
- mission 状态派生的虚拟 run 映射（mission.py `_virtual_status` 与 daemon/router.py `_team_mission_summary` 本地展开**双源同改**）：分身 run 终态 failed/killed 但会话侧未收敛（active）或 ended 无强收标记时，靠「首 run 终态兜底」映射 failed——去掉该兜底会复发 mission 永卡 running（ql-20260828-013-a55b 实证）；守护用例在 test_derive_status_matrix.py。
- fingerprint（AgentSpecBundle 内容）变更使旧 resume token 失效；幂等 key 防同阶段重复派发；`reconcile_stale_runs`/`cleanup_stale_runs` 定时收敛卡死 run。
- 档案字段经 lease.metadata 透传给 daemon（lease/context 消费），两侧字段名是隐式契约；llm_provider_id 的归属校验在 daemon 侧解析时执行。
- 角色模板回收清单写死在 profile/seed.py：新增/回收模板须同步 `_DEPRECATED_ROLE_TEMPLATE_IDS`，否则产生孤儿模板行。
- 涉 LLM/delegation 的测试必须 monkeypatch GLMConfig.from_env 返 None，防本机环境变量泄漏打真实 LLM（烧 token 且测试漂移）。
- 借用（borrow）产物回存带审计用量更新，删除/重构 borrow 相关表须连带审计口径。
- AgentRunLog 的 segment_id 列是 daemon 消息去重的 DB 侧锚点，不入对外 API 响应（DB-only 去重字段）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
- 2026-08-20-session-multimodal-attachments：会话附件（图片多模态/文件落盘/multimodal 三态门控）涉及本模块（详见 changes 归档）
