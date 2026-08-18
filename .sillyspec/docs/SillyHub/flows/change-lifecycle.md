---
author: qinyi
created_at: 2026-06-24T01:47:08
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
---

# SillySpec 变更生命周期流程

## 目标
驱动一个变更（change）从创建到归档的完整工作流。已会话驱动化 + 形态A 按需派发：新建变更走会话（无平台表单）、阶段推进以 CLI/daemon 上报的进度为权威（读时投影）、平台只在人工触发点显式派发 agent，无自动连轴。

## 参与模块
- change：变更域核心——目录解析入库（parser + `_module-map.yaml` 模块反查）、文档矩阵、transition / advance_stage / complete_stage / rerun_stage、四类人工审核面板（proposal_review / plan_review / human_test / archive_confirm）、check_archive_gate 归档门槛、dispatch 按需派发、projection 进度投影、quicklog 视图、ChangeSessionLink 会话绑定
- workflow：TaskFSM 任务流转 + ChangeReview / AuditLog 模型与查询（Change 状态机已内聚 change 模块，spec_guardian 现无生产调用方）
- change_writer：变更目录与 markdown 模板构造 + daemon 代写路径（HTTP 表单入口已下线，能力保留）
- task：`tasks/*.md` frontmatter 解析落库与看板（文件是 source of truth，状态经 workflow.transition_task 流转）
- runtime：`.runtime/` 只读读取器（sillyspec.db `mode=ro` 直读）
- platform_sync：CLI/daemon 回传进度/文档/审批/quicklog 落库（platform_change_progress），shpsync_ 鉴权
- spec_workspace：spec 文件增量落盘（apply_ops）与落盘后 reparse 触发
- agent：阶段派发执行（见 agent-run 流程）
- daemon：daemon 侧执行 + run_verify_gate（host_fs delegate 跑 `sillyspec gate verify`）+ 变更文件读写通道
- mcp_gateway：advance_change_stage / submit_stage_review / run_verify_gate / get_change_stage 四个对外 MCP 工具入口
- frontend_app / frontend_components：变更中心列表/详情 + 独立会话页（会话驱动）

## 流程摘要

```text
=== 创建（会话驱动）===
(用户)      变更中心已无新建表单 → 在会话中由 agent 创建变更
(daemon)    agent 在宿主 .sillyspec/changes/<key>/ 落四件套
     │      （平台侧需远端建目录时走 daemon 代写队列，见 daemon-change-write 流程）
     ▼
(daemon)    spec-sync 增量推送 → platform_sync spec-sync → spec_workspace.apply_ops 落盘
     ▼
(backend)   落盘后触发 change reparse（scoped；含 archive 路径转全量）
     │      parser 解析入库，_infer_affected_components 把涉及文件反查模块 id
     ▼
=== 进度同步与投影（current_stage 双轨）===
(CLI/daemon) SillySpec CLI 每阶段推进 → POST /api/changes/{name}/progress
     │      （shpsync_ token，base_ts 乐观锁，冲突返回平台侧 latest_progress 不改数据）
(backend)   platform_sync.upsert_progress 落 platform_change_progress
(backend)   变更中心读时 _project_current_stage 批量 join 投影
     │      → 权威 current_stage/completed_stages/latest_progress 覆盖落库值
     │      （CLI daemon 模式不主动推时，落库值与投影值短暂不一致是刻意设计，非 bug）
     ▼
=== 人工审核门（四类面板）===
(backend)   StageProjectionService 只读 sillyspec.db 的 stage 完成事件
     │      → 投影为 proposal_review / plan_review / human_test / archive_confirm 之一
(用户)      变更中心或绑定会话内放行 / 打回（打回走 _record_stage_rework）
     │      审批注入服务身份；阶段/审核事件经 _notify_bound_session 回推绑定会话
     ▼
=== 按需派发（形态A：auto_dispatch 已砍）===
(用户/外部) advance_stage（HTTP，可带 agent_profile_id）或 MCP advance_change_stage
(backend)   transition_with_dispatch → dispatch_next_step 显式派发
     │      ├─ execute → _dispatch_execute_team 多 worker 并行（GLM 兜底 mission 可选）
     │      ├─ verify → run_verify_gate：daemon 侧跑 sillyspec gate verify
     │      └─ 派发前 has_active_run + cleanup_before_dispatch（同 change 不并发多 run）
(daemon)    agent 执行 → lease complete 回调
     → _trigger_stage_completion_callback / _advance_team_stage 推阶段
     ▼
=== 归档 ===
(用户)      check_archive_gate 门槛校验 → archive_confirm 面板放行
(daemon)    会话内 agent 执行 sillyspec archive：changes/<key>/ → changes/archive/<key>/
(daemon)    spec-sync 推送归档变更 → apply_ops（archive 路径触发全量 reparse）
(backend)   归档变更转归档视图；task/scan_docs 索引对齐文件状态
```

quick 变更走独立 quick 阶段（不进 brainstorm→plan→execute→verify→archive 主线）；gate 判定仅 verify 阶段适用（`_gate_applicable`，勿扩大到任意 change run）；quicklog 条目经 platform_sync 上行与本地解析合并展示。

## 失败回滚

| 失败点 | 处理 |
|--------|------|
| 非法迁移（跳阶段） | FSM can_transition 校验，409 |
| 需写盘但未获 worktree lease | start_stage_dispatch 拒绝派发 |
| 同 change 并发派发 | has_active_run + cleanup_before_dispatch 保证单 run |
| verify gate 失败 | kickback 记录失败原因，停 verify 不自动归档 |
| 进度上行冲突（base_ts 过期） | platform_sync 返回平台侧 latest_progress，CLI 呈现冲突，不改任何数据 |
| daemon 离线 | 变更文件写路径不可用（host_fs 下发）；阶段停留，不自动推进 |
| execute worker 失败 | mission derive_status 聚合 worker 状态；单 worker 失败不崩 mission |
| 卡死 run | reconcile_stale_runs 只清理不推进；cleanup_stale_pending_runs 收口 |
| 投影读取失败 | 静默降级返回 None，调用侧不补抛异常（D-002 绝不写 CLI 的库） |
