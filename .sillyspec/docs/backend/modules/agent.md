---
schema_version: 1
doc_type: module-card
module_id: agent
author: qinyi
created_at: 2026-08-18 01:45:00
updated_at: 2026-09-02 12:00:00
---

# 智能体执行引擎（agent）

## 定位
平台核心执行引擎：AI Agent（Claude Code / Codex / GLM 等）运行编排。负责 AgentRun 生命周期、
执行上下文（spec bundle → CLAUDE.md）构建、交互式 AgentSession、mission（多 agent 团队委派）
调度，以及 `profile/` AgentProfile 三层配置层（daemon→agent→workspace）。派发落地经
RunPlacementService 选 daemon 运行时 + lease，与 daemon 模块双向协作（agent 下发 / daemon
完成回调 run_sync）。

## 契约摘要
- 借用与共享写约束（2026-08-28-daemon-agent-share）：borrow_resolver 数据源切
  `daemon/grants/queries.resolve_granted_daemon_for_borrow`（语义等价+grant_id，`_grant_id`
  传输键贯通 placement 审计）；`DaemonBorrowAudit` 加 grant_id 可空列；execution 新增
  `platform_shared_tool_config()`（七工具白名单无 Bash/NotebookEdit、mode=acceptEdits——
  平台共享会话专用，D-009）。
- 文件制品面（2026-08-23-agent-file-upload-mcp）：`POST /api/agent/file-artifacts`
  （multipart file/description/run_id + X-Session-Id 会话场景；WORKSPACE_WRITE 双路径
  鉴权，落 File 行 owner_type=agent_session/agent_run + AgentRunLog 日志行
  channel=tool_call/tool_kind=FileUpload/dedup_key=file-upload:{file_id}（IntegrityError
  重放防护）+ Redis 双通道 publish（submit_run_input 同款模式，失败 WARNING 降级））；
  `GET /api/agent/file-artifacts?session_id=|run_id=`（WORKSPACE_READ + 锚复核，
  FileMetaResp 倒序）。daemon sillyhub-file MCP 的上传直连此端点。群会话
  （session_kind='group'）鉴权走群成员分支（成员表命中→workspace admin 兜底）。
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
    落 daemon_borrow_audit 审计）。pinned 钉定授权分支（2026-09-01-session-group-chat，
    D-010）：群成员影子懒建消费 `prepare_interactive_dispatch(pinned_skip_owner_check=False)`
    ——成员机器属主非群主时按属主命中或 workspace grant 放行（**不照抄** worker 的
    `pinned_skip_owner_check=True` 豁免，群成员机器是群主任意选择的必须走授权校验）；
    并加旗标误用守卫（该旗标只在钉定分支生效，skip_owner_check=True 恒不走授权分支）。
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
- 群聊数据模型（2026-09-01-session-group-chat）：`AgentSession.session_kind`
  （String(16) server_default 'chat'——chat 存量零变更 / group 群会话 /
  group_member 影子会话，索引 ix_agent_sessions_session_kind 供列表过滤）；
  `AgentRunLog.metadata_`（DB 列名 metadata、属性名避让 SQLAlchemy 保留名，
  JSON NULL）承载群聊桥接投影行身份 {member_id, member_name, source_log_id}；
  两张群表——`AgentGroupChat`（session_id UNIQUE FK 群时间线会话 1:1、
  workspace_id 权限锚、agent_cross_mention 默认 true / cross_mention_depth=2 /
  context_window=20 / settings_json 预留）与 `AgentGroupMember`（member_type
  user|agent；display_name=群内昵称即 @提及词，**UNIQUE(group_id, display_name)**
  用户与 agent 共用命名空间群内全局唯一、UNIQUE(group_id, user_id) 防重复邀请；
  agent 成员六要素 runtime_id/workspace_id/provider/llm_provider_id/
  agent_profile_id + config_snapshot 冗余快照免 N+1；shadow_session_id 反向
  指针 + shadow_status——影子**刻意不挂 parent_session_id**，群↔影子关联只经
  此指针，规避 worker 子会话判定链误杀）。

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

per-worker worktree 创建失败(路径B): mark failed(worktree_create_failed)
  + 立即 best-effort git_worktree_remove 收残——git 被 timeout 杀掉时分支/
  注册元数据已落而 run.worktree_branch 为 None, finalizer 清理 SQL 永远漏掉
  (ql-20260902-001, remove 连带删 workers/<id> 分支)
finalizer cleanup: git_worktree_remove 传 branch=run.worktree_branch
  连带删 workers/<id> 分支(此前全链路无删分支调用, 分支永久堆积 ql-20260902-001)

mission external 三重防御: ①入口跳过 orchestrator/lease spawn
  ②converge 检测 external 跳过 finalize/cleanup(不 merge/不清 worktree)
  ③路径A 不写 worktree_branch(误进 finalize 也无 branch 可 merge)

worker_done 嵌套逐级回叫(quick-33956fb8): 孙 done 时直接父是树内中间层
  (≠mission 根)且空闲未 done → notify_parent_workers_done 注入父唤醒
  (幂等父×子粒度 Redis SETNX 6h)——否则中间层分身派完孙结束轮次后永不被
  叫醒, 不收孙产出不上报自己的 done, 全树恒未完成死锁(生产 ee24ba15 实证)
patrol 职责⑦②僵尸等待形态(回叫漏叫兜底): active+未done+无活跃turn+首run
  终态且 finished_at 超宽限 → 置 worker_force_ended_at; _virtual_status 强收
  映射同扩该 idle 形态按 failed 终态 → awaiting_input 超时收敛可触发
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

- 分身子会话（2026-08-25-team-subsession-governance）：dispatch_worker 派的是子会话三元组
  （AgentSession.parent_session_id 挂主控 + owner=mission.created_by + interactive lease
  stage=mission_worker + 首 run mission_id/role 双标记）；完成判据单一真相源
  is_worker_complete/mission_derive_status（mission.py，虚拟 run 映射），七处判据点禁自建口径；
  worker_done 端点（mcp_tools 四路由族）写 worker_done_at + summary 挂首 run + DEL→SETNX
  重开工唤醒 + 迟到 409；converge 成功后沿树批量 end_session（冲突/needs_manual 不收口），
  patrol 职责⑤孤儿扫描兜底；存量 batch 分身双判据兼容（is_worker_complete 内置 AgentRun 形态）。
- 分身递归开闸（2026-08-26-team-subsession-recursion）：tree_depth 列（NOT NULL DEFAULT 0，主控 0/分身 1/孙 2）
  + mission_worker_sessions_tree 递归 CTE 全树枚举（治理口径单一真相源，UNION 去重+深度 4 截断）；
  五端点统一调用方解析（parent 非空爬根禁懒建 miss=404，防分身误锚新 mission）；递归派发
  parent=调用会话 + MAX_DISPATCH_DEPTH=2（mcp_tools.py 单源，daemon mcp-config.ts 同值有锁漂移断言）；
  converge 层 0 收口（_enforce_converge_layer0 通道嗅探：Bearer 豁免/分身 403/apiKey 裸调 403）；
  patrol 职责⑥预算强收（先原子置位 constraints.budget_force_ended_at 后批量收口，虚拟映射
  「标记存在时 ended 未 done→failed」保证强收后可收敛 degraded）；分身调用 worktree_path 一律忽略。
- constraints 完整性双修（ql-20260831-008）：patrol `_json_merge_expr` 双方言加 object 类型守卫
  （PG `jsonb_typeof` / SQLite `json_type`；非 object——SQL NULL / JSON null / 历史损坏数组——一律回
  `'{}'` 再合并，修 PG `json-null || 对象` 产出数组并逐轮追加的根因，存量损坏行被下一次合并自愈）；
  AgentMission.constraints 列换 ConstraintsJSON TypeDecorator（读取端非 dict 归一 `{}`、None 保持
  None，DDL 仍 JSON 零迁移），中心化覆盖 finalizer/orchestrator/patrol/mcp_tools 全部
  `(mission.constraints or {})` 读取点（生产曾因数组化滚到 760KB：converge 500 + patrol 每轮
  AttributeError；数据已修，本卡堵代码层复发）。
## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
