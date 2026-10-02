---
author: sillyspec-fr-index
created_at: 2026-09-28T13:29:09.736Z
---

# FR 索引 — backend

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/backend.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-auto-backend-001 ctx 打标会话身份锚定
变更：2026-09-11-agent-log-attribution-refactor
状态：active
摘要：默认场景
依据决策：D-001@v1、D-008@v1
场景正文：
- 场景：默认场景 — Given 某 agent 会话内执行 `sillyspec run --change X`（或 quick） zcode 进程（env 无会话 id） own 命中文件被；When CLI 探测本地日志文件 锚定器运行 组装 detected；Then 仅「本 run 所属 agent 会话（锚定主会话）及其子代理（zcode parent_id 链，不比 directory）」的条目被写入 ctx=X，其余条
全文：.sillyspec/changes/archive/2026-09-11-agent-log-attribution-refactor/requirements.md#FR-01
最近确认：353eb11b0

## FR-auto-backend-002 quick/change 双向互斥
变更：2026-09-11-agent-log-attribution-refactor
状态：active
摘要：默认场景
依据决策：D-006@v2
场景正文：
- 场景：默认场景 — Given quick 会话内的 run（quickId=quick-xxx） 普通变更 run（--change X）；When 更新 own 条目 更新 own 条目；Then entry 置 quick_id=quick-xxx 且 change_key=null entry 置 change_key=X 且 quick_id=nul
全文：.sillyspec/changes/archive/2026-09-11-agent-log-attribution-refactor/requirements.md#FR-02
最近确认：353eb11b0

## FR-auto-backend-003 平台 ctx-owner 归属解析
变更：2026-09-11-agent-log-attribution-refactor
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v1、D-006@v2
场景正文：
- 场景：默认场景 — Given 平台收到无 hub_session_id 的推送，条目 ctx=Q（quick_id 优先于 change_key） 平台 pi 会话已通过自身 run 登记变；When 解析 Q 的 owner 本地 zcode 推送 ctx=X 的条目 归属解析
全文：.sillyspec/changes/archive/2026-09-11-agent-log-attribution-refactor/requirements.md#FR-03
最近确认：353eb11b0

## FR-auto-backend-004 hub 分支 own-only 语义
变更：2026-09-11-agent-log-attribution-refactor
状态：active
摘要：默认场景
依据决策：D-007@v1
场景正文：
- 场景：默认场景 — Given daemon 派发会话（SILLYHUB_SESSION_ID 注入）内执行 run；When CLI 推送；Then payload entries = 留底条目 ∩ own 集合（按 log_path）；hub 会话名下不再出现非本会话产物（旧 CLI 过渡期除外，见 NFR
全文：.sillyspec/changes/archive/2026-09-11-agent-log-attribution-refactor/requirements.md#FR-04
最近确认：353eb11b0

## FR-auto-backend-005 存量清理与重建
变更：2026-09-11-agent-log-attribution-refactor
状态：active
摘要：默认场景
依据决策：D-004@v2
场景正文：
- 场景：默认场景 — Given 生产库存在错配时代数据；When 执行数据迁移（CLI 升级后一次性运维动作，不随 backend 发布自动前滚）；Then ① platform_agent_logs.agent_session_id 全置 NULL；② origin=tool_report 会话软删；③ chang
全文：.sillyspec/changes/archive/2026-09-11-agent-log-attribution-refactor/requirements.md#FR-05
最近确认：353eb11b0

## FR-auto-backend-006 无关日志零出现
变更：2026-09-11-agent-log-attribution-refactor
状态：active
摘要：默认场景
依据决策：D-001@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given 本地某会话从未执行 sillyspec run；When 其日志文件在 cwd 活跃窗口内被其它会话的 run 探测到；Then 该条目不出现在任何推送中，平台任何会话/变更/quicklog 视图不可见
全文：.sillyspec/changes/archive/2026-09-11-agent-log-attribution-refactor/requirements.md#FR-06
最近确认：353eb11b0

## FR-auto-backend-007 协议文档更新
变更：2026-09-11-agent-log-attribution-refactor
状态：active
摘要：默认场景
依据决策：D-006@v2、D-007@v1、D-008@v1
场景正文：
- 场景：默认场景 — Given 协议 docs/platform-agent-log-protocol.md；When 本变更发布；Then §1 推送范围改 own 条目、§3 补 per-harness 锚定规则与回退、会话化上下文改双向互斥与 ctx-owner 平台行为
全文：.sillyspec/changes/archive/2026-09-11-agent-log-attribution-refactor/requirements.md#FR-07
最近确认：353eb11b0

## FR-auto-backend-008 批量导出入口
变更：2026-09-14-session-export
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 会话列表某工作区组处于多选态且勾选了 1~N 个会话 勾选数为 0 请求 session_ids 数量 >50 或为空；When 用户点击批量操作条上的「导出选中（N）」并在档位下拉中选择「导出对话（Markdown）」或「导出完整信息（JSON+附件）」 批量栏渲染 请求到达后端；Then 前端以 POST 调用 `/api/daemon/sessions/export`（session_ids=勾选集，tier=所选档），按钮进入 loading
全文：.sillyspec/changes/archive/2026-09-14-session-export/requirements.md#FR-01
最近确认：8caa2f56b

## FR-auto-backend-009 两档内容口径
变更：2026-09-14-session-export
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个含多轮对话的普通会话 同一会话 群聊会话（含影子成员投影行）；When 导出 chat 档 导出 full 档 导出任一档；Then Markdown 含会话头（标题/时间/runtime/轮数）+ 按 run 分轮的用户消息（`user_input` 行）与助手正文（`stdout` 行经噪
全文：.sillyspec/changes/archive/2026-09-14-session-export/requirements.md#FR-02
最近确认：8caa2f56b

## FR-auto-backend-010 权限与存在性
变更：2026-09-14-session-export
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 会话属其他用户、或已软删、或群会话且请求者非参与者非 workspace admin；When 导出请求包含该会话；Then 整个请求 404（不泄露存在性，不做部分成功）
全文：.sillyspec/changes/archive/2026-09-14-session-export/requirements.md#FR-03
最近确认：8caa2f56b

## FR-auto-backend-011 响应矩阵与文件名
变更：2026-09-14-session-export
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 单会话 chat 档请求 多会话 chat 或任一 full 请求；When 成功 成功；Then 响应 `text/markdown`，文件名 `{标题 sanitize}_{id前8}.md` 响应 `application/zip`，文件名 `会话导出_
全文：.sillyspec/changes/archive/2026-09-14-session-export/requirements.md#FR-04
最近确认：8caa2f56b

## FR-auto-backend-012 截断与体量防护
变更：2026-09-14-session-export
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 单会话日志 >20000 行（agent_run_logs 行，每会话独立计数） full 档整包附件总量（按附件元数据 bytes 预聚合）>512MB 单个；When 导出 导出请求 导出 full 档；Then 保留最早 20000 行，产物内标注 `truncated: true` + `dropped_rows`（丢弃行数） 返回 413 与明确提示（分批导出），预
全文：.sillyspec/changes/archive/2026-09-14-session-export/requirements.md#FR-05
最近确认：8caa2f56b

## FR-auto-backend-013 行级导出入口
变更：2026-09-14-session-export
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 会话行 hover；When 用户点击操作列新增的下载图标并选择档位；Then 以单会话 id 走同一导出链路
全文：.sillyspec/changes/archive/2026-09-14-session-export/requirements.md#FR-06
最近确认：8caa2f56b

## FR-auto-backend-014 类型同步
变更：2026-09-14-session-export
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 后端 `SessionExportRequest` schema 落地；When 跑 `pnpm gen:types`；Then `api-types.ts` 含该请求类型且对既有类型零破坏，`openapi.json` 同步提交
全文：.sillyspec/changes/archive/2026-09-14-session-export/requirements.md#FR-07
最近确认：8caa2f56b

## FR-auto-backend-015 THIN 辅助阶段与派发配置
变更：2026-09-25-change-center-thin-flow
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given StageEnum 现有 QUICK 辅助阶段先例（backend/app/modules/change/model.py:65-72）；When 变更中心为 quick 类型新变更派发 agent；Then StageEnum 含 THIN="thin"（进 spec_auxiliary_stages，不进 TRANSITIONS/STAGE_ORDER，跑完即终态
全文：.sillyspec/changes/archive/2026-09-25-change-center-thin-flow/requirements.md#FR-01
最近确认：9c908b6ae

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-change-center-thin-flow:task-01:acc-0-272c783f
  tests: backend/app/modules/change/tests/test_dispatch.py | backend/tests/modules/change/test_dispatch_stage_config.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 2f29e2693a12839bf3f71fb8684b5db57fc628b3
  source_change: 2026-09-25-change-center-thin-flow
  status: active
- row: 2026-09-25-change-center-thin-flow:task-01:acc-1-6259e0f9
  tests: backend/app/modules/change/tests/test_dispatch.py | backend/tests/modules/change/test_dispatch_stage_config.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 2f29e2693a12839bf3f71fb8684b5db57fc628b3
  source_change: 2026-09-25-change-center-thin-flow
  status: active
- row: 2026-09-25-change-center-thin-flow:task-01:acc-2-ed98ef81
  tests: backend/app/modules/change/tests/test_dispatch.py | backend/tests/modules/change/test_dispatch_stage_config.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 2f29e2693a12839bf3f71fb8684b5db57fc628b3
  source_change: 2026-09-25-change-center-thin-flow
  status: active

## FR-auto-backend-016 thin 派发 prompt 契约
变更：2026-09-25-change-center-thin-flow
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given thin 派发 agent 需执行 2 调用协议；When agent 收到派发 prompt；Then prompt 指示：flow start 带 --input 多行文本（动机行 + 独立节头行「成功标准：」+ 每行一条 `- <标准>`——单行内联会被清晰度
全文：.sillyspec/changes/archive/2026-09-25-change-center-thin-flow/requirements.md#FR-02
最近确认：9c908b6ae

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-change-center-thin-flow:task-02:acc-0-e8ac335f
  tests: backend/app/modules/change/tests/test_thin_stage.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 2f29e2693a12839bf3f71fb8684b5db57fc628b3
  source_change: 2026-09-25-change-center-thin-flow
  status: active
- row: 2026-09-25-change-center-thin-flow:task-02:acc-1-b3206f61
  tests: backend/app/modules/change/tests/test_thin_stage.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 2f29e2693a12839bf3f71fb8684b5db57fc628b3
  source_change: 2026-09-25-change-center-thin-flow
  status: active
- row: 2026-09-25-change-center-thin-flow:task-02:acc-2-c6d1563c
  tests: backend/app/modules/change/tests/test_thin_stage.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 2f29e2693a12839bf3f71fb8684b5db57fc628b3
  source_change: 2026-09-25-change-center-thin-flow
  status: active

## FR-auto-backend-017 写入分流 quick→thin
变更：2026-09-25-change-center-thin-flow
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given change_writer 分类器输出 change_type="quick"；When service.py/proxy.py 写入新变更；Then initial_stage="thin"（原 "quick"）；change_type 标签保留 "quick" 不改；stages JSON 初值含 thin
全文：.sillyspec/changes/archive/2026-09-25-change-center-thin-flow/requirements.md#FR-03
最近确认：9c908b6ae

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-change-center-thin-flow:task-03:acc-0-b4738f3e
  tests: backend/app/modules/change_writer/tests/test_classifier.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 2f29e2693a12839bf3f71fb8684b5db57fc628b3
  source_change: 2026-09-25-change-center-thin-flow
  status: active
- row: 2026-09-25-change-center-thin-flow:task-03:acc-1-cdf7329e
  tests: backend/app/modules/change_writer/tests/test_classifier.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 2f29e2693a12839bf3f71fb8684b5db57fc628b3
  source_change: 2026-09-25-change-center-thin-flow
  status: active

## FR-auto-backend-018 flow 命令族会话绑定
变更：2026-09-25-change-center-thin-flow
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given thin 派发 agent 在会话内执行 `sillyspec flow start|done|amend-draft --change <名>`；When daemon run_sync submit_commit 解析 bash 命令；Then extract_spec_bindings 产出 SpecCommandBinding(kind="change", change_key=<名>)，会话正确写
全文：.sillyspec/changes/archive/2026-09-25-change-center-thin-flow/requirements.md#FR-04
最近确认：9c908b6ae

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-change-center-thin-flow:task-04:acc-0-58d01e5a
  tests: backend/app/modules/change/tests/test_spec_binding.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 2f29e2693a12839bf3f71fb8684b5db57fc628b3
  source_change: 2026-09-25-change-center-thin-flow
  status: active
- row: 2026-09-25-change-center-thin-flow:task-04:acc-1-06326d42
  tests: backend/app/modules/change/tests/test_spec_binding.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 2f29e2693a12839bf3f71fb8684b5db57fc628b3
  source_change: 2026-09-25-change-center-thin-flow
  status: active

## FR-auto-backend-019 阶段回洗双守卫
变更：2026-09-25-change-center-thin-flow
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given thin 变更在 sillyspec.db 停留 current_stage='scan'/status='active'，归档翻 status='archiv；When ① daemon run_sync 回调 sync_stage_status（dispatch.py:1784 一带）或 ② CLI progress 上行 _；Then 平台 change.current_stage=='thin' 且 DB 行非 archived 时：不回写 current_stage、不写 stages['
全文：.sillyspec/changes/archive/2026-09-25-change-center-thin-flow/requirements.md#FR-05
最近确认：9c908b6ae

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-change-center-thin-flow:task-05:acc-0-504aa4f7
  tests: backend/app/modules/change/tests/test_thin_stage.py | backend/app/modules/platform_sync/tests/test_thin_stage_guard.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 2f29e2693a12839bf3f71fb8684b5db57fc628b3
  source_change: 2026-09-25-change-center-thin-flow
  status: active
- row: 2026-09-25-change-center-thin-flow:task-05:acc-1-e63707df
  tests: backend/app/modules/change/tests/test_thin_stage.py | backend/app/modules/platform_sync/tests/test_thin_stage_guard.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 2f29e2693a12839bf3f71fb8684b5db57fc628b3
  source_change: 2026-09-25-change-center-thin-flow
  status: active

## FR-auto-backend-020 前端 thin 视觉与交互（显示名「轻量变更」，D-002@v1）
变更：2026-09-25-change-center-thin-flow
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — Given 前端七处硬编码触点（徽章映射/STATUS_BADGE/STAGE_OPTIONS 双副本/说明卡/概览卡两处旁路判断/移动端审批卡/时间线组标签）；When thin 变更出现在列表/详情/概览/移动端；Then 徽章「◈ 轻量变更」品牌紫阶（quick 改「快速任务（存量）」琥珀）；筛选下拉含「轻量变更」（桌面+移动两份副本）；详情页 thin 只读说明卡（原两段式说明卡已按 2026-09-28-change-ux-detail-batch 用户裁决移除）（桌面+移动
全文：.sillyspec/changes/archive/2026-09-25-change-center-thin-flow/requirements.md#FR-06
最近确认：9c908b6ae

## FR-auto-backend-021 quick 存量软退役标注
变更：2026-09-25-change-center-thin-flow
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given quick 为存量过渡通道（CLI 横幅语义）；When 用户查看 quicklog 面板/quick 说明卡/统计卡/流程指引文档；Then quicklog tab 计数标「存量 · N」、空态文案换退役指引（桌面 quicklog-table:346 + 移动 :873 两处必改）；quick 说
全文：.sillyspec/changes/archive/2026-09-25-change-center-thin-flow/requirements.md#FR-07
最近确认：9c908b6ae

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulc92i5:frontend/src/components/changes/__tests__/quicklog-table.test.tsx
  tests: frontend/src/components/changes/__tests__/quicklog-table.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 2f29e2693a12839bf3f71fb8684b5db57fc628b3
  source_change: 2026-09-25-change-center-thin-flow
  status: active

## FR-auto-backend-022 纵深防御与对账
变更：2026-09-25-change-center-thin-flow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 上游 3.30.0 已有变更名白名单但平台入口无校验；watcher 事件按 change_name 字符串归属；When thin 变更派发/CLI 侧自建 thin 目录 reparse/watcher 事件上行；Then 派发入口对 thin 变更校验 change_key（`^[A-Za-z0-9_.\-]+$`，拒 `..`/`default`/`quick-<hex8>`）
全文：.sillyspec/changes/archive/2026-09-25-change-center-thin-flow/requirements.md#FR-08
最近确认：9c908b6ae

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-change-center-thin-flow:task-06:acc-0-2cf02565
  tests: backend/app/modules/change/tests/test_parser.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 2f29e2693a12839bf3f71fb8684b5db57fc628b3
  source_change: 2026-09-25-change-center-thin-flow
  status: active
- row: 2026-09-25-change-center-thin-flow:task-06:acc-1-b13aec10
  tests: backend/app/modules/change/tests/test_parser.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 2f29e2693a12839bf3f71fb8684b5db57fc628b3
  source_change: 2026-09-25-change-center-thin-flow
  status: active

## FR-auto-backend-023 批量 upsert 分片
变更：2026-09-25-spec-sync-pg-chunk
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 单批 spec-sync ops 含数千 add（归档移动整树形态）；When apply_ops 写 manifest；Then 按 500/批分片执行 pg_insert upsert，单语句绑定参数恒低于 asyncpg 32767 上限，行级语义（版本高位对齐/exists/幂等）逐
全文：.sillyspec/changes/archive/2026-09-25-spec-sync-pg-chunk/requirements.md#FR-01
最近确认：c72d04c8f196a81fce03d43ccfe9705e7d3390f8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-spec-sync-pg-chunk:flow:FR-01
  tests: backend/app/modules/spec_workspace/tests/test_spec_sync_chunk.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 2f29e2693a12839bf3f71fb8684b5db57fc628b3
  source_change: 2026-09-25-spec-sync-pg-chunk
  status: active

## FR-auto-backend-024 超大批全量落库
变更：2026-09-25-spec-sync-pg-chunk
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一次同步推送 1200 个 add；When 处理完成；Then 1200 行全落 manifest（批边界与尾批不丢行）、文件全写盘、版本/哈希正确
全文：.sillyspec/changes/archive/2026-09-25-spec-sync-pg-chunk/requirements.md#FR-02
最近确认：c72d04c8f196a81fce03d43ccfe9705e7d3390f8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulc8ym4:backend/app/modules/spec_workspace/tests/test_spec_sync_chunk.py
  tests: backend/app/modules/spec_workspace/tests/test_spec_sync_chunk.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 2f29e2693a12839bf3f71fb8684b5db57fc628b3
  source_change: 2026-09-25-spec-sync-pg-chunk
  status: active

## FR-auto-backend-025 既有增量同步零回归
变更：2026-09-25-spec-sync-pg-chunk
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 本变更交付；When 跑 spec_workspace 增量同步既有测试；Then 全绿（本次 33 passed 1 skipped，skip 为既有 Windows symlink 平台跳过）
全文：.sillyspec/changes/archive/2026-09-25-spec-sync-pg-chunk/requirements.md#FR-03
最近确认：c72d04c8f196a81fce03d43ccfe9705e7d3390f8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-spec-sync-pg-chunk:flow:FR-03
  tests: backend/app/modules/spec_workspace/tests/test_spec_sync_chunk.py | backend/app/modules/spec_workspace/tests/test_sync_incremental.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 2f29e2693a12839bf3f71fb8684b5db57fc628b3
  source_change: 2026-09-25-spec-sync-pg-chunk
  status: active

## FR-auto-backend-026 命中锚点归一回退匹配
变更：2026-09-25-knowledge-anchor-match-tolerance
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-knowledge-anchor-match-tolerance/requirements.md#FR-01
最近确认：bf47e2a9402502c5aeaee1a70e923b5ff438ee50

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-knowledge-anchor-match-tolerance:flow:FR-01
  tests: backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_parser.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-knowledge-anchor-match-tolerance
  status: active

## FR-auto-backend-027 歧义与真实内容漂移保守处理
变更：2026-09-25-knowledge-anchor-match-tolerance
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-knowledge-anchor-match-tolerance/requirements.md#FR-02
最近确认：bf47e2a9402502c5aeaee1a70e923b5ff438ee50

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-knowledge-anchor-match-tolerance:flow:FR-02
  tests: backend/app/modules/knowledge/tests/test_hits.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-knowledge-anchor-match-tolerance
  status: active

## FR-auto-backend-028 四项数值统一用解析后锚点
变更：2026-09-25-knowledge-anchor-match-tolerance
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-knowledge-anchor-match-tolerance/requirements.md#FR-03
最近确认：bf47e2a9402502c5aeaee1a70e923b5ff438ee50

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-knowledge-anchor-match-tolerance:flow:FR-03
  tests: backend/app/modules/knowledge/tests/test_hits.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-knowledge-anchor-match-tolerance
  status: active

## FR-auto-backend-029 存量真实数据复算收益
变更：2026-09-25-knowledge-anchor-match-tolerance
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-knowledge-anchor-match-tolerance/requirements.md#FR-04
最近确认：bf47e2a9402502c5aeaee1a70e923b5ff438ee50

## FR-auto-backend-030 单测覆盖三类漂移与两条边界
变更：2026-09-25-knowledge-anchor-match-tolerance
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-knowledge-anchor-match-tolerance/requirements.md#FR-05
最近确认：bf47e2a9402502c5aeaee1a70e923b5ff438ee50

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-knowledge-anchor-match-tolerance:flow:FR-05
  tests: backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/task/tests/test_parser.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-knowledge-anchor-match-tolerance
  status: active

## FR-auto-backend-031 既有行为零回归
变更：2026-09-25-knowledge-anchor-match-tolerance
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-knowledge-anchor-match-tolerance/requirements.md#FR-06
最近确认：bf47e2a9402502c5aeaee1a70e923b5ff438ee50

## FR-auto-backend-032 模块层实有分子只数模块文档
变更：2026-09-25-scan-docs-stats-caliber
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-scan-docs-stats-caliber/requirements.md#FR-01
最近确认：40d215410020316d1109efa73e51441798c6693f

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-scan-docs-stats-caliber:flow:FR-01
  tests: backend/app/modules/scan_docs/tests/test_stats.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-scan-docs-stats-caliber
  status: active

## FR-auto-backend-033 时间口径按源文件时间判定
变更：2026-09-25-scan-docs-stats-caliber
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-scan-docs-stats-caliber/requirements.md#FR-02
最近确认：40d215410020316d1109efa73e51441798c6693f

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-scan-docs-stats-caliber:flow:FR-02
  tests: backend/app/modules/scan_docs/tests/test_stats.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-scan-docs-stats-caliber
  status: active

## FR-auto-backend-034 有效时间口径单点实现
变更：2026-09-25-scan-docs-stats-caliber
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-scan-docs-stats-caliber/requirements.md#FR-03
最近确认：40d215410020316d1109efa73e51441798c6693f

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-scan-docs-stats-caliber:flow:FR-03
  tests: backend/app/modules/scan_docs/tests/test_stats.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-scan-docs-stats-caliber
  status: active

## FR-auto-backend-035 变更日志与登记表判定的纯函数
变更：2026-09-25-scan-docs-stats-caliber
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-scan-docs-stats-caliber/requirements.md#FR-04
最近确认：40d215410020316d1109efa73e51441798c6693f

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-scan-docs-stats-caliber:flow:FR-04
  tests: backend/app/modules/scan_docs/tests/test_stats.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-scan-docs-stats-caliber
  status: active

## FR-auto-backend-036 单测覆盖两条修正与临界形态
变更：2026-09-25-scan-docs-stats-caliber
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-scan-docs-stats-caliber/requirements.md#FR-05
最近确认：40d215410020316d1109efa73e51441798c6693f

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-scan-docs-stats-caliber:flow:FR-05
  tests: backend/app/modules/scan_docs/tests/test_stats.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-scan-docs-stats-caliber
  status: active

## FR-auto-backend-037 既有行为零回归
变更：2026-09-25-scan-docs-stats-caliber
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-scan-docs-stats-caliber/requirements.md#FR-06
最近确认：40d215410020316d1109efa73e51441798c6693f

## FR-auto-backend-038 同内容跳过须以「磁盘在位 + 行在线」为前提
变更：2026-09-25-full-sync-resurrect-missing
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-full-sync-resurrect-missing/requirements.md#FR-01
最近确认：ff6779d4e9e2ecdc2020d32e3bb3418f31153978

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-full-sync-resurrect-missing:flow:FR-01
  tests: backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 2f29e2693a12839bf3f71fb8684b5db57fc628b3
  source_change: 2026-09-25-full-sync-resurrect-missing
  status: active

## FR-auto-backend-039 复活态落盘语义
变更：2026-09-25-full-sync-resurrect-missing
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-full-sync-resurrect-missing/requirements.md#FR-02
最近确认：ff6779d4e9e2ecdc2020d32e3bb3418f31153978

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-full-sync-resurrect-missing:flow:FR-02
  tests: backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 2f29e2693a12839bf3f71fb8684b5db57fc628b3
  source_change: 2026-09-25-full-sync-resurrect-missing
  status: active

## FR-auto-backend-040 正常态零回归
变更：2026-09-25-full-sync-resurrect-missing
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-full-sync-resurrect-missing/requirements.md#FR-03
最近确认：ff6779d4e9e2ecdc2020d32e3bb3418f31153978

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-full-sync-resurrect-missing:flow:FR-03
  tests: backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 2f29e2693a12839bf3f71fb8684b5db57fc628b3
  source_change: 2026-09-25-full-sync-resurrect-missing
  status: active

## FR-auto-backend-041 单测覆盖三态
变更：2026-09-25-full-sync-resurrect-missing
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-full-sync-resurrect-missing/requirements.md#FR-04
最近确认：ff6779d4e9e2ecdc2020d32e3bb3418f31153978

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-full-sync-resurrect-missing:flow:FR-04
  tests: backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 2f29e2693a12839bf3f71fb8684b5db57fc628b3
  source_change: 2026-09-25-full-sync-resurrect-missing
  status: active

## FR-auto-backend-042 幽灵软删行用例
变更：2026-09-25-full-sync-resurrect-missing
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-full-sync-resurrect-missing/requirements.md#FR-05
最近确认：ff6779d4e9e2ecdc2020d32e3bb3418f31153978

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-full-sync-resurrect-missing:flow:FR-05
  tests: backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 2f29e2693a12839bf3f71fb8684b5db57fc628b3
  source_change: 2026-09-25-full-sync-resurrect-missing
  status: active

## FR-auto-backend-043 磁盘缺文件（行在线）用例
变更：2026-09-25-full-sync-resurrect-missing
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-full-sync-resurrect-missing/requirements.md#FR-06
最近确认：ff6779d4e9e2ecdc2020d32e3bb3418f31153978

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-full-sync-resurrect-missing:flow:FR-06
  tests: backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 2f29e2693a12839bf3f71fb8684b5db57fc628b3
  source_change: 2026-09-25-full-sync-resurrect-missing
  status: active

## FR-auto-backend-044 正常跳过态零回归用例
变更：2026-09-25-full-sync-resurrect-missing
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-full-sync-resurrect-missing/requirements.md#FR-07
最近确认：ff6779d4e9e2ecdc2020d32e3bb3418f31153978

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-full-sync-resurrect-missing:flow:FR-07
  tests: backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 2f29e2693a12839bf3f71fb8684b5db57fc628b3
  source_change: 2026-09-25-full-sync-resurrect-missing
  status: active

## FR-auto-backend-045 模块零回归
变更：2026-09-25-full-sync-resurrect-missing
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-full-sync-resurrect-missing/requirements.md#FR-08
最近确认：ff6779d4e9e2ecdc2020d32e3bb3418f31153978

## FR-auto-backend-046 墓碑行 heal 语义
变更：2026-09-26-manifest-heal-endpoint
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-26-manifest-heal-endpoint/requirements.md#FR-01
最近确认：21ff163ad11116668f0167aa68537ea552c365fb

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-manifest-heal-endpoint:flow:FR-01
  tests: backend/app/modules/spec_workspace/tests/test_platform_deleted_guard.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-manifest-heal-endpoint
  status: active

## FR-auto-backend-047 heal 即冲突闭环
变更：2026-09-26-manifest-heal-endpoint
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-26-manifest-heal-endpoint/requirements.md#FR-02
最近确认：21ff163ad11116668f0167aa68537ea552c365fb

## FR-auto-backend-048 输入校验与鉴权
变更：2026-09-26-manifest-heal-endpoint
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-26-manifest-heal-endpoint/requirements.md#FR-03
最近确认：21ff163ad11116668f0167aa68537ea552c365fb

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-manifest-heal-endpoint:flow:FR-03
  tests: backend/app/modules/spec_workspace/tests/test_platform_deleted_guard.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-manifest-heal-endpoint
  status: active

## FR-auto-backend-049 审计与幂等
变更：2026-09-26-manifest-heal-endpoint
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-26-manifest-heal-endpoint/requirements.md#FR-04
最近确认：21ff163ad11116668f0167aa68537ea552c365fb

## FR-auto-backend-050 零回归
变更：2026-09-26-manifest-heal-endpoint
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-26-manifest-heal-endpoint/requirements.md#FR-05
最近确认：21ff163ad11116668f0167aa68537ea552c365fb

## FR-auto-backend-051 测试绑定行附带手写原文（raw_binding）
变更：2026-09-26-assets-test-binding-raw-text
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given test-trace.json 摘录时截断 `::用例` 后缀，tests 数组只剩文件级路径，而含测试类/用例与描述的手写原文就在归档变更目录 require；When assets 聚合服务解析测试绑定（GET /changes/{cid}/assets），；Then 每条 ChangeTestRow 按锚点（FR-NN）匹配挂上新字段 `raw_binding`（绑定槽注释行之后的内容行原文，多行拼接）；requiremen
全文：.sillyspec/changes/archive/2026-09-26-assets-test-binding-raw-text/requirements.md#FR-01
最近确认：8f587cde7811c61df600f7b7d23c9c9eaedcd1b2

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-assets-test-binding-raw-text:flow:FR-01
  tests: backend/app/modules/change/tests/test_assets.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 2f29e2693a12839bf3f71fb8684b5db57fc628b3
  source_change: 2026-09-26-assets-test-binding-raw-text
  status: active

## FR-auto-backend-052 类型契约同步
变更：2026-09-26-assets-test-binding-raw-text
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given ChangeTestRow schema 新增字段，；When 后端 schema 变更落盘， 按 CLAUDE.md 规则 21 运行 `pnpm gen:types`，；Then `frontend/src/lib/api-types.ts` 与 `backend/openapi.json` 随提交更新，不落手写类型债。
全文：.sillyspec/changes/archive/2026-09-26-assets-test-binding-raw-text/requirements.md#FR-02
最近确认：8f587cde7811c61df600f7b7d23c9c9eaedcd1b2

## FR-auto-backend-053 前端资产卡显示原文
变更：2026-09-26-assets-test-binding-raw-text
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试绑定行的 raw_binding 存在且与 tests 文件路径列表不同值（即原文含用例级/描述信息），；When 资产卡渲染测试绑定组， 该行下方显示原文小字（muted 色，超长截断，悬停 title 可见全文）；raw_binding 为 None 或与 tests 等
全文：.sillyspec/changes/archive/2026-09-26-assets-test-binding-raw-text/requirements.md#FR-03
最近确认：8f587cde7811c61df600f7b7d23c9c9eaedcd1b2

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-assets-test-binding-raw-text:flow:FR-03
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 2f29e2693a12839bf3f71fb8684b5db57fc628b3
  source_change: 2026-09-26-assets-test-binding-raw-text
  status: active

## FR-auto-backend-054 测试与类型门禁全绿
变更：2026-09-26-assets-test-binding-raw-text
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 三处改动落盘，；When 运行后端 change 聚焦测试（test_assets 补「含绑定槽原文的 requirements 提取、无 requirements 容错为 None」两；Then 全部通过且 0 类型错误。
全文：.sillyspec/changes/archive/2026-09-26-assets-test-binding-raw-text/requirements.md#FR-04
最近确认：8f587cde7811c61df600f7b7d23c9c9eaedcd1b2

## FR-auto-backend-055 知识触达组——变更消费的知识条目可跳转
变更：2026-09-26-change-asset-transparency
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 知识注入的现行 FR/决策在知识库条目内有「待复核：<变更名>」反向标记（flow done 对触达域打标），；When assets 聚合解析（GET /changes/{cid}/assets），；Then 新增 knowledge_touch 组收录镜像 knowledge 的 fr 与 decisions 中节内含该标记的条目（id/标题/file），fail-
全文：.sillyspec/changes/archive/2026-09-26-change-asset-transparency/requirements.md#FR-01
最近确认：8846b46367fb931d6e806042b88c4d591a5e8781

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-change-asset-transparency:flow:FR-01
  tests: backend/app/modules/change/tests/test_assets.py::待复核反查金样本（fr+decisions | frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-change-asset-transparency
  status: active

## FR-auto-backend-056 模块触达组——变更触达的模块可点开模块文档
变更：2026-09-26-change-asset-transparency
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 变更交付文件清单（归档 change-patch.json file_list）与镜像模块图（docs/<项目>/modules/_module-map.yam；When assets 聚合解析，；Then 新增 touched_modules 组：file_list 对各项目模块图 paths 前缀/glob 匹配去重，收为 模块 id/所属项目/doc 路径，中
全文：.sillyspec/changes/archive/2026-09-26-change-asset-transparency/requirements.md#FR-02
最近确认：8846b46367fb931d6e806042b88c4d591a5e8781

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-change-asset-transparency:flow:FR-02
  tests: backend/app/modules/change/tests/test_assets.py::模块触达
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-change-asset-transparency
  status: active

## FR-auto-backend-057 两组展示语义与既有组一致
变更：2026-09-26-change-asset-transparency
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 两组新数据挂入沉淀资产卡，；When 卡片渲染，；Then 逐组「有数据才渲染」（fail-open 同款）、计数徽标并入卡头统计、空组不出现；既有四组零回归。
全文：.sillyspec/changes/archive/2026-09-26-change-asset-transparency/requirements.md#FR-03
最近确认：8846b46367fb931d6e806042b88c4d591a5e8781

## FR-auto-backend-058 测试与类型门禁全绿
变更：2026-09-26-change-asset-transparency
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 改动落盘，；When 运行后端聚焦测试（待复核反查金样本含 fr 与 decisions、无标记空组、模块 glob 匹配与中文名 h1 提取/回退）与前端组件测试（两组渲染、知识触；Then 全部通过、openapi.json 与 api-types.ts 随提交同步、0 类型错误。
全文：.sillyspec/changes/archive/2026-09-26-change-asset-transparency/requirements.md#FR-04
最近确认：8846b46367fb931d6e806042b88c4d591a5e8781

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-change-asset-transparency:flow:FR-04
  tests: backend/app/modules/change/tests/test_assets.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-change-asset-transparency
  status: active

## FR-auto-backend-059 批量探测多工作区时 git_probe 并发执行（gather），总耗时逼近最慢一个而非逐个累加
变更：2026-09-26-probe-concurrent-rpc
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 批量探测多工作区时 git_probe 并发执行（gather），总耗时逼近最慢一个而非逐个累加；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-26-probe-concurrent-rpc/requirements.md#FR-01
最近确认：43ee45c1ffc967e605e6a35482f84318e65d9e3d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-probe-concurrent-rpc:flow:FR-01
  tests: backend/app/modules/workspace/tests/test_probe_endpoint.py::TestProbeEndpoint::test_git_probe_concurrent_not_serial（barrier
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-probe-concurrent-rpc
  status: active

## FR-auto-backend-060 probe_workspace_git_mode 与 git_remote_url 的 RPC 预算
变更：2026-09-26-probe-concurrent-rpc
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When probe_workspace_git_mode 与 git_remote_url 的 RPC 预算收紧为 3 秒，超时仍归 unknown；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-26-probe-concurrent-rpc/requirements.md#FR-02
最近确认：43ee45c1ffc967e605e6a35482f84318e65d9e3d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-probe-concurrent-rpc:flow:FR-02
  tests: backend/app/modules/daemon/host_fs/tests/test_delegate_probe.py::TestProbeTriState::test_exists_true_dir_returns_git（delegate | backend/app/modules/workspace/tests/test_probe_endpoint.py::TestProbeEndpoint::test_probe_and_remote_rpc_use_short_timeout_budget（stat/git_remote
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-probe-concurrent-rpc
  status: active

## FR-auto-backend-061 None（三态语义与 fail-safe 不变）
变更：2026-09-26-probe-concurrent-rpc
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When None（三态语义与 fail-safe 不变）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-26-probe-concurrent-rpc/requirements.md#FR-03
最近确认：43ee45c1ffc967e605e6a35482f84318e65d9e3d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-probe-concurrent-rpc:flow:FR-03
  tests: backend/app/modules/daemon/host_fs/tests/test_delegate_probe.py::TestProbeUnavailable::test_rpc_timeout_returns_unknown | backend/app/modules/workspace/tests/test_probe_endpoint.py::TestProbeEndpoint::test_rpc_failure_returns_unknown_no_5xx（超时归
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-probe-concurrent-rpc
  status: active

## FR-auto-backend-062 probe 端点 git_remote_url 的逐工作区读取不再串行追加耗时（未识别的并发预取）
变更：2026-09-26-probe-concurrent-rpc
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 端点 相关模块就绪；When probe 端点 git_remote_url 的逐工作区读取不再串行追加耗时（未识别的并发预取）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-26-probe-concurrent-rpc/requirements.md#FR-04
最近确认：43ee45c1ffc967e605e6a35482f84318e65d9e3d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-probe-concurrent-rpc:flow:FR-04
  tests: backend/app/modules/workspace/tests/test_probe_endpoint.py::TestProbeEndpoint::test_git_mode_repo_url_detected_and_backfilled（回填语义回归） | backend/app/modules/workspace/tests/test_probe_endpoint.py::TestProbeEndpoint::test_probe_and_remote_rpc_use_short_timeout_budget（git_remote
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-probe-concurrent-rpc
  status: active

## FR-auto-backend-063 既有 test_probe_endpoint 全量用例回归全绿，新增并发行为用例（barrier 法
变更：2026-09-26-probe-concurrent-rpc
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 既有 test_probe_endpoint 全量用例回归全绿，新增并发行为用例（barrier 法证明并发）与超时预算透传用例；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-26-probe-concurrent-rpc/requirements.md#FR-05
最近确认：43ee45c1ffc967e605e6a35482f84318e65d9e3d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-probe-concurrent-rpc:flow:FR-05
  tests: backend/app/modules/daemon/host_fs/tests/test_delegate_probe.py | backend/app/modules/workspace/tests/test_probe_endpoint.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-probe-concurrent-rpc
  status: active

## FR-auto-backend-064 不改任何响应字段口径与既有日志事件语义
变更：2026-09-26-probe-concurrent-rpc
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 不改任何响应字段口径与既有日志事件语义；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-26-probe-concurrent-rpc/requirements.md#FR-06
最近确认：43ee45c1ffc967e605e6a35482f84318e65d9e3d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-probe-concurrent-rpc:flow:FR-06
  tests: backend/app/modules/agent/tests/test_mission_status.py | backend/app/modules/workspace/tests/test_probe_endpoint.py::TestProbeEndpoint::test_batch_multi_workspaces_git_and_direct（响应字段/顺序/机器口径存量断言不改仍绿）
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-probe-concurrent-rpc
  status: active

## FR-auto-backend-065 迁移链恢复单线：22194500→040000→090000→083000→新矫正迁移，删除 063
变更：2026-09-26-migration-chain-dedupe
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 迁移 相关模块就绪；When 迁移链恢复单线：22194500；Then 040000
全文：.sillyspec/changes/archive/2026-09-26-migration-chain-dedupe/requirements.md#FR-01
最近确认：a82bf152600857f3cc6980934b6a5a296fda5bdb

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-migration-chain-dedupe:flow:FR-01
  tests: backend/tests/test_align_platform_change_events_migration.py::TestMigrationStructure::test_083000_reattached_to_mainline（down_revision | backend/tests/test_align_platform_change_events_migration.py::TestMigrationStructure::test_duplicate_branch_purged（063000/3931ff71bd32 | backend/tests/test_align_platform_change_events_migration.py::TestMigrationStructure::test_file_exists_and_single_head_chain（单
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-migration-chain-dedupe
  status: active

## FR-auto-backend-066 040000 的建表 DDL 改写为与当前 ORM（platform_sync/model.py P
变更：2026-09-26-migration-chain-dedupe
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 040000 的建表 DDL 改写为与当前 ORM（platform_sync/model.py PlatformChangeEventORM）完全一致的结构（；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-26-migration-chain-dedupe/requirements.md#FR-02
最近确认：a82bf152600857f3cc6980934b6a5a296fda5bdb

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-migration-chain-dedupe:flow:FR-02
  tests: backend/tests/test_migrations_graph.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-migration-chain-dedupe
  status: active

## FR-auto-backend-067 新增条件矫正迁移：对已被 040000 旧结构建表的 PG 库做幂等对齐（ts timestampt
变更：2026-09-26-migration-chain-dedupe
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 迁移 / 幂等 相关模块就绪；When 新增条件矫正迁移：对已被 040000 旧结构建表的 PG 库做幂等对齐（ts timestamptz；Then varchar(64) 数据转 ISO 串、severity
全文：.sillyspec/changes/archive/2026-09-26-migration-chain-dedupe/requirements.md#FR-03
最近确认：a82bf152600857f3cc6980934b6a5a296fda5bdb

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-migration-chain-dedupe:flow:FR-03
  tests: backend/tests/test_align_platform_change_events_migration.py::TestAlignBehavior::test_old_shape_emits_full_alignment（旧结构 | backend/tests/test_align_platform_change_events_migration.py::TestAlignBehavior::test_sqlite_dialect_short_circuits（非 | backend/tests/test_align_platform_change_events_migration.py::TestAlignBehavior::test_target_shape_is_full_noop（目标结构
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-migration-chain-dedupe
  status: active

## FR-auto-backend-068 rule NULL 回填、severity varchar(32)→16、detail→text、D
变更：2026-09-26-migration-chain-dedupe
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When rule NULL 回填、severity varchar(32)；Then 16、detail
全文：.sillyspec/changes/archive/2026-09-26-migration-chain-dedupe/requirements.md#FR-04
最近确认：a82bf152600857f3cc6980934b6a5a296fda5bdb

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-migration-chain-dedupe:flow:FR-04
  tests: backend/tests/test_align_platform_change_events_migration.py::TestAlignBehavior::test_old_shape_emits_full_alignment（断言
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-migration-chain-dedupe
  status: active

## FR-auto-backend-069 tests/test_migrations_graph.py 守护通过（单头、引用闭合）
变更：2026-09-26-migration-chain-dedupe
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When tests/test_migrations_graph.py 守护通过（单头、引用闭合）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-26-migration-chain-dedupe/requirements.md#FR-05
最近确认：a82bf152600857f3cc6980934b6a5a296fda5bdb

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-migration-chain-dedupe:flow:FR-05
  tests: backend/tests/test_migrations_graph.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-migration-chain-dedupe
  status: active

## FR-auto-backend-070 新增矫正迁移的结构断言与链测试（仿 test_archive_tombstone_repair_mi
变更：2026-09-26-migration-chain-dedupe
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 迁移 / 测试 相关模块就绪；When 新增矫正迁移的结构断言与链测试（仿 test_archive_tombstone_repair_migration.py 先例）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-26-migration-chain-dedupe/requirements.md#FR-06
最近确认：a82bf152600857f3cc6980934b6a5a296fda5bdb

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-migration-chain-dedupe:flow:FR-06
  tests: backend/tests/test_align_platform_change_events_migration.py::TestMigrationStructure（文件存在/单
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-migration-chain-dedupe
  status: active

## FR-auto-backend-071 本地与远程 dogfood
变更：2026-09-26-migration-chain-dedupe
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 本地与远程 dogfood；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-26-migration-chain-dedupe/requirements.md#FR-07
最近确认：a82bf152600857f3cc6980934b6a5a296fda5bdb

## FR-auto-backend-072 生产 DB 经 stamp+upgrade head 后 alembic 版本落新 head 且后端
变更：2026-09-26-migration-chain-dedupe
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 生产 DB 经 stamp+upgrade head 后 alembic 版本落新 head 且后端正常启动（运维步骤在交付汇报中列明）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-26-migration-chain-dedupe/requirements.md#FR-08
最近确认：a82bf152600857f3cc6980934b6a5a296fda5bdb

## FR-auto-backend-073 不改 ORM、不改任何业务代码与接口行为
变更：2026-09-26-migration-chain-dedupe
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 接口 相关模块就绪；When 不改 ORM、不改任何业务代码与接口行为；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-26-migration-chain-dedupe/requirements.md#FR-09
最近确认：a82bf152600857f3cc6980934b6a5a296fda5bdb

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-migration-chain-dedupe:flow:FR-09
  tests: backend/tests/test_align_platform_change_events_migration.py | backend/tests/test_migrations_graph.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-migration-chain-dedupe
  status: active

## FR-auto-backend-074 任务锚窗口收窄：仅本变更 commit 事件的提交参与锚匹配（titles 映射仍可用全局 50 窗
变更：2026-09-28-timeline-anchor-scope
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 任务锚窗口收窄：仅本变更 commit 事件的提交参与锚匹配（titles 映射仍可用全局 50 窗口取标题——那是展示用途与锚定无关）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-timeline-anchor-scope/requirements.md#FR-01
最近确认：34d39ff7c1306f64976528484698bf7330463691

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-timeline-anchor-scope:flow:FR-01
  tests: backend/app/modules/change/tests/test_timeline.py「test_task_anchor_scoped_to_change_commits」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-timeline-anchor-scope
  status: active

## FR-auto-backend-075 全局窗口无本变更提交时锚为 None（显示无锚而非错锚）
变更：2026-09-28-timeline-anchor-scope
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 全局窗口无本变更提交时锚为 None（显示无锚而非错锚）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-timeline-anchor-scope/requirements.md#FR-02
最近确认：34d39ff7c1306f64976528484698bf7330463691

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-timeline-anchor-scope:flow:FR-02
  tests: backend/app/modules/change/tests/test_timeline.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-timeline-anchor-scope
  status: active

## FR-auto-backend-076 前端事件行图标表补 gate-run、config-change、fake-check-cleare
变更：2026-09-28-timeline-anchor-scope
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 前端 相关模块就绪；When 前端事件行图标表补 gate-run、config-change、fake-check-cleared 三个新事件 kind（watcher-signal-wi；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-timeline-anchor-scope/requirements.md#FR-03
最近确认：34d39ff7c1306f64976528484698bf7330463691

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-timeline-anchor-scope:flow:FR-03
  tests: frontend/src/components/changes/detail/__tests__/change-timeline-card.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-timeline-anchor-scope
  status: active

## FR-auto-backend-077 后端测试：锚定限本变更事件窗口（他变更提交含同号 token 不误锚）、无窗口提交时 None
变更：2026-09-28-timeline-anchor-scope
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 后端测试：锚定限本变更事件窗口（他变更提交含同号 token 不误锚）、无窗口提交时 None；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-timeline-anchor-scope/requirements.md#FR-04
最近确认：34d39ff7c1306f64976528484698bf7330463691

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-timeline-anchor-scope:flow:FR-04
  tests: backend/app/modules/change/tests/test_timeline.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-timeline-anchor-scope
  status: active

## FR-auto-backend-078 前端卡片测试补三个新 kind 图标渲染
变更：2026-09-28-timeline-anchor-scope
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 前端 / 测试 相关模块就绪；When 前端卡片测试补三个新 kind 图标渲染；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-timeline-anchor-scope/requirements.md#FR-05
最近确认：34d39ff7c1306f64976528484698bf7330463691

## FR-unmapped-002 平台托管规范空间
变更：2026-05-27-platform-native-sillyspec
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given workspace 创建成功 用户选择 `repo-mirrored`；When workspace 没有 repo-native `.sillyspec` 用户触发同步
全文：.sillyspec/changes/archive/2026-05-27-platform-native-sillyspec/requirements.md#FR-02
最近确认：c0af692c7

## FR-unmapped-003 Agent Spec Profile
变更：2026-05-27-platform-native-sillyspec
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 平台配置了 `C:\Users\qinyi\IdeaProjects\sillyspec` 作为 profile 来源 SillySpec profile 发生；When 平台加载 profile 平台检测到 manifest diff；Then 平台生成版本化 `SpecProfileManifest`，包含阶段、文档、门禁和 Agent 上下文契约 平台生成兼容性报告，需项目维护者确认迁移
全文：.sillyspec/changes/archive/2026-05-27-platform-native-sillyspec/requirements.md#FR-03
最近确认：c0af692c7

## FR-unmapped-004 规范冲突策略
变更：2026-05-27-platform-native-sillyspec
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 平台治理要求和 SillySpec 规范要求不一致 策略层无法自动决策；When 策略层可以自动决策 用户推进阶段或触发 Agent；Then 平台按硬门禁合并、更严格校验优先、extension metadata 或 adapter transform 处理 平台生成 conflict record，
全文：.sillyspec/changes/archive/2026-05-27-platform-native-sillyspec/requirements.md#FR-04
最近确认：c0af692c7

## FR-unmapped-005 Claude Code Agent 接入
变更：2026-05-27-platform-native-sillyspec
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given task 已从规范文档解析并确认 Agent 执行完成；When 用户触发 `claude_code` Agent run 平台收到退出码和输出
全文：.sillyspec/changes/archive/2026-05-27-platform-native-sillyspec/requirements.md#FR-05
最近确认：c0af692c7

## FR-unmapped-006 Agent 类型一致性
变更：2026-05-27-platform-native-sillyspec
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 前端创建 Agent run 后端收到未知 agent type；When 用户选择 Claude Code adapter registry 没有对应实现；Then 请求 payload 使用 `agent_type=claude_code` 返回明确错误和可用 agent type 列表
全文：.sillyspec/changes/archive/2026-05-27-platform-native-sillyspec/requirements.md#FR-06
最近确认：c0af692c7

## FR-unmapped-007 规范文件独立存储
变更：2026-05-27-platform-native-sillyspec
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given workspace 创建成功 spec root 目录内 已有的 component/scan_docs/change/task/parser；When 平台创建托管 spec root Agent 或 CLI 生成规范文件 需要读取规范文件；Then spec root 位于 `spec_data_root/{workspace_id}/`，为绝对路径，不与代码仓库混放 目录结构遵循 SillySpec 标准
全文：.sillyspec/changes/archive/2026-05-27-platform-native-sillyspec/requirements.md#FR-07
最近确认：c0af692c7

## FR-unmapped-008 SillySpec CLI 作为 Agent 工具
变更：2026-05-27-platform-native-sillyspec
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given AgentSpecBundle 构建 用户触发 spec-bootstrap 已有 `.sillyspec` 的项目；When 平台准备 Agent 执行上下文 Agent 在 spec_root 目录中执行 Agent 导入规范；Then `available_tools` 包含 `["sillyspec"]`，Agent prompt 指示使用 CLI 命令 Agent 调用 `sillyspe
全文：.sillyspec/changes/archive/2026-05-27-platform-native-sillyspec/requirements.md#FR-08
最近确认：c0af692c7

## FR-unmapped-009 SpecValidator 程序验证
变更：2026-05-27-platform-native-sillyspec
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 规范文件已生成（bootstrap 或 sync 后） 验证通过 验证失败；When 平台执行验证 平台更新状态 平台处理结果；Then `SpecValidator` 检查：YAML schema（每个 `projects/*.yaml` 必须有 `id`、`name`、`type`）、引用完整
全文：.sillyspec/changes/archive/2026-05-27-platform-native-sillyspec/requirements.md#FR-09
最近确认：c0af692c7

## FR-unmapped-010 Agent stdout 逐行流式发布
变更：2026-05-28-agent-log-streaming
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Agent 运行中（status=running）；When ClaudeCodeAdapter 收到子进程 stdout 的一行输出；Then 平台通过 Redis Pub/Sub 发布到 channel `agent_run:{run_id}`，payload 包含 `channel`（stdout/
全文：.sillyspec/changes/archive/2026-05-28-agent-log-streaming/requirements.md#FR-01
最近确认：3cdaada90

## FR-unmapped-011 SSE 实时日志端点
变更：2026-05-28-agent-log-streaming
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 客户端连接 `GET /api/workspaces/{id}/agent/runs/{run_id}/stream` Agent 运行结束（status 变为；When Redis Pub/Sub channel `agent_run:{run_id}` 收到消息 SSE 端点检测到运行结束 端点收到请求；Then SSE 端点将消息作为 `data` event 推送给客户端 发送 `event: done` 并关闭连接 返回 200 并立即发送 `event: done
全文：.sillyspec/changes/archive/2026-05-28-agent-log-streaming/requirements.md#FR-02
最近确认：3cdaada90

## FR-unmapped-012 前端实时日志消费
变更：2026-05-28-agent-log-streaming
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Agent 状态为 running SSE 连接断开 Agent 状态变为 completed/failed；When 用户打开 Agent Console 或 Task Detail 页面 浏览器自动重连 前端收到 `event: done` 或检测到状态变更
全文：.sillyspec/changes/archive/2026-05-28-agent-log-streaming/requirements.md#FR-03
最近确认：3cdaada90

## FR-unmapped-013 DB 日志持久化不受影响
变更：2026-05-28-agent-log-streaming
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Agent 运行结束；When 平台处理完 stdout/stderr；Then 仍按现有逻辑写入 `AgentRunLog` 表，现有 `/logs` 端点行为不变
全文：.sillyspec/changes/archive/2026-05-28-agent-log-streaming/requirements.md#FR-04
最近确认：3cdaada90

## FR-unmapped-014 Workspace 吸收 Component 元数据
变更：2026-05-28-component-as-workspace
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 创建 Workspace 请求包含 `component_key`、`type`、`role`、`repo_url`、`default_branch`、`tec；When 平台保存 Workspace Workspace 已保存 Component 元数据；Then 这些字段保存到 `workspaces` 表 响应返回这些元数据字段
全文：.sillyspec/changes/archive/2026-05-28-component-as-workspace/requirements.md#FR-01
最近确认：c0af692c7

## FR-unmapped-015 移除旧 Component 核心数据面
变更：2026-05-28-component-as-workspace
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 后端启动 前端读取 Workspace 或拓扑；When API router 注册完成 页面加载数据；Then 不再把旧 `backend/app/modules/component/` router 作为核心入口 通过 Workspace API 获取数据，而不是依赖旧
全文：.sillyspec/changes/archive/2026-05-28-component-as-workspace/requirements.md#FR-02
最近确认：c0af692c7

## FR-unmapped-016 创建 WorkspaceRelation
变更：2026-05-28-component-as-workspace
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Workspace A 和 Workspace B 都存在 A 到 B 已存在 `depends_on` Workspace A 存在；When 创建 A `depends_on` B 再次创建同类型关系 创建 A 指向 A 的关系
全文：.sillyspec/changes/archive/2026-05-28-component-as-workspace/requirements.md#FR-03
最近确认：c0af692c7

## FR-unmapped-017 支持循环依赖图
变更：2026-05-28-component-as-workspace
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 已存在 A `depends_on` B 存在 A -> B -> C -> A；When 查询 A 的关系 查询全局拓扑；Then 响应同时包含出边 A -> B 和入边 B -> A 拓扑结果包含完整环路，不因循环依赖报错
全文：.sillyspec/changes/archive/2026-05-28-component-as-workspace/requirements.md#FR-04
最近确认：c0af692c7

## FR-unmapped-018 Change 支持多 Workspace
变更：2026-05-28-component-as-workspace
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 开发者创建 Change 并传入 `workspace_ids=[A,B]` 旧客户端只传 `workspace_id=A`；When 服务保存 Change 服务保存 Change；Then `change_workspaces` 包含 Change 到 A、B 的关联 Change 仍保存成功，并将 A 视为 primary Workspace
全文：.sillyspec/changes/archive/2026-05-28-component-as-workspace/requirements.md#FR-05
最近确认：c0af692c7

## FR-unmapped-019 Task 支持多 Workspace
变更：2026-05-28-component-as-workspace
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 开发者创建 Task 并传入 `workspace_ids=[A,B]` 查询 Workspace A 的任务；When 服务保存 Task Task 通过 `task_workspaces` 关联 A；Then `task_workspaces` 包含 Task 到 A、B 的关联 查询结果包含该 Task
全文：.sillyspec/changes/archive/2026-05-28-component-as-workspace/requirements.md#FR-06
最近确认：c0af692c7

## FR-unmapped-020 AgentRun 支持多 Workspace
变更：2026-05-28-component-as-workspace
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given AgentRun 由一个跨 Workspace Task 触发 查询 AgentRun 详情；When AgentRun 创建 该 run 涉及多个 Workspace；Then `agent_run_workspaces` 记录该 run 涉及的 Workspace 响应返回对应 Workspace 列表或 `workspace_ids
全文：.sillyspec/changes/archive/2026-05-28-component-as-workspace/requirements.md#FR-07
最近确认：c0af692c7

## FR-unmapped-021 AgentSpecBundle 基于 Workspace Graph 构建
变更：2026-05-28-component-as-workspace
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Task T 关联 Workspace A A -> B -> C 的依赖链；When 构建 AgentSpecBundle 构建上下文的 depth 为 1；Then bundle 包含 A 的 spec 摘要 bundle 只包含 A 的直接关联 Workspace，不递归拉取 C
全文：.sillyspec/changes/archive/2026-05-28-component-as-workspace/requirements.md#FR-08
最近确认：c0af692c7

## FR-unmapped-022 全局拓扑 API
变更：2026-05-28-component-as-workspace
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 平台存在多个 Workspace 和 WorkspaceRelation 某个 Workspace 被软删除或不可见；When 调用 `GET /api/workspaces/topology` 查询拓扑；Then 响应返回 nodes 和 edges 该 Workspace 不应作为 active 节点展示
全文：.sillyspec/changes/archive/2026-05-28-component-as-workspace/requirements.md#FR-09
最近确认：c0af692c7

## FR-unmapped-023 后续独立变更包边界
变更：2026-05-28-component-as-workspace
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 当前变更包正在实施；When 发现普通仓库接入、Workflow 控制面、Local Runner、Knowledge Lifecycle 或 Server Sandbox 需求；Then 只记录为后续独立变更包，不在当前包实现
全文：.sillyspec/changes/archive/2026-05-28-component-as-workspace/requirements.md#FR-10
最近确认：c0af692c7

## FR-unmapped-024 Router 统一挂载
变更：2026-05-29-harness-control-plane
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 后端启动；When 查询 OpenAPI 或调用模块 API；Then workflow、agent、tool_gateway、git_gateway、runtime、knowledge 的入口可用
全文：.sillyspec/changes/archive/2026-05-29-harness-control-plane/requirements.md#FR-01
最近确认：3cdaada90

## FR-unmapped-025 Workflow 状态流转
变更：2026-05-29-harness-control-plane
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Task 处于 draft；When 请求进入 ready；Then Workflow service 校验必要条件后完成流转
全文：.sillyspec/changes/archive/2026-05-29-harness-control-plane/requirements.md#FR-02
最近确认：3cdaada90

## FR-unmapped-026 Spec Guardian 门禁
变更：2026-05-29-harness-control-plane
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Task 关联 Workspace 缺少有效 SpecWorkspace；When 请求执行；Then Spec Guardian 拒绝执行并返回诊断
全文：.sillyspec/changes/archive/2026-05-29-harness-control-plane/requirements.md#FR-03
最近确认：3cdaada90

## FR-unmapped-027 Policy 校验
变更：2026-05-29-harness-control-plane
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Agent 请求高风险 shell 操作；When Policy 评估结果为 require_approval；Then 操作进入审批，不直接执行
全文：.sillyspec/changes/archive/2026-05-29-harness-control-plane/requirements.md#FR-04
最近确认：3cdaada90

## FR-unmapped-028 AuditLog
变更：2026-05-29-harness-control-plane
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户批准一个操作；When 决策保存；Then AuditLog 记录操作者、对象、动作、结果和时间
全文：.sillyspec/changes/archive/2026-05-29-harness-control-plane/requirements.md#FR-05
最近确认：3cdaada90

## FR-unmapped-029 创建 candidate
变更：2026-05-29-knowledge-lifecycle
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given AgentRun 产生可沉淀内容；When Agent 提交 candidate；Then candidate 保存为待审核状态，并记录来源 run/task/workspace
全文：.sillyspec/changes/archive/2026-05-29-knowledge-lifecycle/requirements.md#FR-01
最近确认：3cdaada90

## FR-unmapped-030 Reviewer 确认
变更：2026-05-29-knowledge-lifecycle
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given candidate 待审核；When Reviewer 确认；Then 系统创建或更新 knowledge item，状态为 confirmed
全文：.sillyspec/changes/archive/2026-05-29-knowledge-lifecycle/requirements.md#FR-02
最近确认：3cdaada90

## FR-unmapped-031 验证和推广
变更：2026-05-29-knowledge-lifecycle
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given knowledge item 已 confirmed item 已 verified；When Reviewer 标记验证通过 管理员推广；Then 状态进入 verified 状态进入 promoted
全文：.sillyspec/changes/archive/2026-05-29-knowledge-lifecycle/requirements.md#FR-03
最近确认：3cdaada90

## FR-unmapped-032 废弃
变更：2026-05-29-knowledge-lifecycle
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 知识不再适用；When Reviewer 标记 deprecated；Then 查询默认不返回该知识，除非显式包含 deprecated
全文：.sillyspec/changes/archive/2026-05-29-knowledge-lifecycle/requirements.md#FR-04
最近确认：3cdaada90

## FR-unmapped-033 查询过滤
变更：2026-05-29-knowledge-lifecycle
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Workspace A 有多条知识；When 用户按 type、status、source 查询；Then 返回匹配的知识列表
全文：.sillyspec/changes/archive/2026-05-29-knowledge-lifecycle/requirements.md#FR-05
最近确认：3cdaada90

## FR-unmapped-034 runtime 注册
变更：2026-05-29-local-runner-execution-loop
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 本机安装 Codex CLI；When Local daemon 启动；Then daemon 向 server 注册 provider=codex 的 runtime
全文：.sillyspec/changes/archive/2026-05-29-local-runner-execution-loop/requirements.md#FR-01
最近确认：3cdaada90

## FR-unmapped-035 heartbeat
变更：2026-05-29-local-runner-execution-loop
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given runtime 已注册；When daemon 定期发送 heartbeat；Then server 将 runtime 视为 online
全文：.sillyspec/changes/archive/2026-05-29-local-runner-execution-loop/requirements.md#FR-02
最近确认：3cdaada90

## FR-unmapped-036 claim task
变更：2026-05-29-local-runner-execution-loop
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Task 已 ready 且绑定 online runtime；When daemon claim task；Then server 原子分配任务给该 runtime
全文：.sillyspec/changes/archive/2026-05-29-local-runner-execution-loop/requirements.md#FR-03
最近确认：3cdaada90

## FR-unmapped-037 隔离执行环境
变更：2026-05-29-local-runner-execution-loop
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given daemon 已 claim task；When 准备执行；Then 创建独立 workdir/output/logs 并写入 AgentSpecBundle
全文：.sillyspec/changes/archive/2026-05-29-local-runner-execution-loop/requirements.md#FR-04
最近确认：3cdaada90

## FR-unmapped-038 消息流上报
变更：2026-05-29-local-runner-execution-loop
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given CLI 正在执行；When 产生 stdout、tool call、thinking 或 result message；Then daemon 批量上报到 server
全文：.sillyspec/changes/archive/2026-05-29-local-runner-execution-loop/requirements.md#FR-05
最近确认：3cdaada90

## FR-unmapped-039 执行完成
变更：2026-05-29-local-runner-execution-loop
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given CLI 返回成功；When runner 收集结果；Then server 保存 diff/test/artifact 并推进到 review gate
全文：.sillyspec/changes/archive/2026-05-29-local-runner-execution-loop/requirements.md#FR-06
最近确认：3cdaada90

## FR-unmapped-040 创建沙箱
变更：2026-05-29-server-sandbox-runner
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Task 已 ready；When Server Runner claim task；Then 平台创建绑定 tenant/user/workspace/task 的沙箱
全文：.sillyspec/changes/archive/2026-05-29-server-sandbox-runner/requirements.md#FR-01
最近确认：3cdaada90

## FR-unmapped-041 文件快照
变更：2026-05-29-server-sandbox-runner
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Workspace 有允许注入的路径；When 创建沙箱快照；Then 只复制白名单路径
全文：.sillyspec/changes/archive/2026-05-29-server-sandbox-runner/requirements.md#FR-02
最近确认：3cdaada90

## FR-unmapped-042 执行任务
变更：2026-05-29-server-sandbox-runner
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 沙箱已准备完成；When Runner 调用内部 Claude/Codex 执行能力；Then 日志通过统一 runner 协议写回 AgentRun
全文：.sillyspec/changes/archive/2026-05-29-server-sandbox-runner/requirements.md#FR-03
最近确认：3cdaada90

## FR-unmapped-043 导出结果
变更：2026-05-29-server-sandbox-runner
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 执行完成；When Runner 导出结果；Then 平台保存 diff、test result、artifact
全文：.sillyspec/changes/archive/2026-05-29-server-sandbox-runner/requirements.md#FR-04
最近确认：3cdaada90

## FR-unmapped-044 清理
变更：2026-05-29-server-sandbox-runner
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 沙箱超过保留周期；When GC 执行；Then 沙箱文件和临时凭据被清理
全文：.sillyspec/changes/archive/2026-05-29-server-sandbox-runner/requirements.md#FR-05
最近确认：3cdaada90

## FR-unmapped-045 普通 repo 注册
变更：2026-05-29-workspace-intake-spec-bootstrap
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个没有 `.sillyspec` 的代码仓库；When 管理员使用 `spec_strategy=bootstrap` 创建 Workspace；Then Workspace 创建成功
全文：.sillyspec/changes/archive/2026-05-29-workspace-intake-spec-bootstrap/requirements.md#FR-01
最近确认：3cdaada90

## FR-unmapped-046 导入已有规范
变更：2026-05-29-workspace-intake-spec-bootstrap
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given repo 内已有 `.sillyspec`；When 管理员使用 `spec_strategy=import`；Then 平台导入规范文件并记录来源路径
全文：.sillyspec/changes/archive/2026-05-29-workspace-intake-spec-bootstrap/requirements.md#FR-02
最近确认：3cdaada90

## FR-unmapped-047 规范同步
变更：2026-05-29-workspace-intake-spec-bootstrap
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Workspace 已有关联 SpecWorkspace；When 调用 `spec-sync`；Then 平台通过受控 CLI adapter 同步规范文件
全文：.sillyspec/changes/archive/2026-05-29-workspace-intake-spec-bootstrap/requirements.md#FR-03
最近确认：3cdaada90

## FR-unmapped-048 规范校验
变更：2026-05-29-workspace-intake-spec-bootstrap
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given SpecWorkspace 缺少必要 frontmatter；When 调用 `spec-validate`；Then 返回 error 级诊断并阻止进入执行阶段
全文：.sillyspec/changes/archive/2026-05-29-workspace-intake-spec-bootstrap/requirements.md#FR-04
最近确认：3cdaada90

## FR-unmapped-049 Kill 运行中的 Agent
变更：2026-05-30-agent-adapter
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-05-30-agent-adapter/requirements.md#FR-01
最近确认：c0af692c7

## FR-unmapped-050 Diff 收集
变更：2026-05-30-agent-adapter
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-05-30-agent-adapter/requirements.md#FR-02
最近确认：c0af692c7

## FR-unmapped-051 进程注册表
变更：2026-05-30-agent-adapter
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-05-30-agent-adapter/requirements.md#FR-03
最近确认：c0af692c7

## FR-unmapped-052 Stale Run 清理
变更：2026-05-30-agent-adapter
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-05-30-agent-adapter/requirements.md#FR-04
最近确认：c0af692c7

## FR-unmapped-053 Allowed Paths 隔离
变更：2026-05-30-agent-adapter
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-05-30-agent-adapter/requirements.md#FR-05
最近确认：c0af692c7

## FR-unmapped-054 输出脱敏
变更：2026-05-30-agent-adapter
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-05-30-agent-adapter/requirements.md#FR-06
最近确认：c0af692c7

## FR-unmapped-055 前端 Agent Run 列表页
变更：2026-05-30-agent-adapter
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-05-30-agent-adapter/requirements.md#FR-07
最近确认：c0af692c7

## FR-unmapped-056 前端 Agent Run 详情页
变更：2026-05-30-agent-adapter
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-05-30-agent-adapter/requirements.md#FR-08
最近确认：c0af692c7

## FR-unmapped-057 前端 SSE 日志流
变更：2026-05-30-agent-adapter
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-05-30-agent-adapter/requirements.md#FR-09
最近确认：c0af692c7

## FR-unmapped-058 tasks.md 模板生成
变更：2026-05-30-change-writer
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-05-30-change-writer/requirements.md#FR-01
最近确认：3cdaada90

## FR-unmapped-059 verification.md 模板生成
变更：2026-05-30-change-writer
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-05-30-change-writer/requirements.md#FR-02
最近确认：3cdaada90

## FR-unmapped-060 MASTER.md 格式增强
变更：2026-05-30-change-writer
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-05-30-change-writer/requirements.md#FR-03
最近确认：3cdaada90

## FR-unmapped-061 batch-generate 传递 lease_id
变更：2026-05-30-change-writer
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-05-30-change-writer/requirements.md#FR-04
最近确认：3cdaada90

## FR-unmapped-062 Git 提交并推送
变更：2026-05-30-change-writer
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-05-30-change-writer/requirements.md#FR-05
最近确认：3cdaada90

## FR-unmapped-063 创建 Pull Request
变更：2026-05-30-change-writer
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-05-30-change-writer/requirements.md#FR-06
最近确认：3cdaada90

## FR-unmapped-064 PAT 安全处理
变更：2026-05-30-change-writer
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-05-30-change-writer/requirements.md#FR-07
最近确认：3cdaada90

## FR-unmapped-065 幂等创建（idempotency_key）
变更：2026-05-30-execution-coordinator
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 开发者调用 start_run 并提供 idempotency_key = "abc123" 开发者调用 start_run 并提供 idempotency_k；When 该 key 不存在 该 key 已存在且对应 AgentRun 状态为 pending/running 该 key 已存在且对应 AgentRun 状态为 co；Then 正常创建 AgentRun（201），记录 idempotency_key 返回已有 AgentRun（200），不重复创建 返回已有 AgentRun（200
全文：.sillyspec/changes/archive/2026-05-30-execution-coordinator/requirements.md#FR-01
最近确认：c0af692c7

## FR-unmapped-066 执行恢复（resume_token）
变更：2026-05-30-execution-coordinator
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — When AgentRun.resume_token 不为 NULL resume_token 匹配 resume_token 不匹配 AgentRun 状态为 comp；Then 可通过 resume 端点恢复执行 AgentRun 状态重置为 pending → running，重新执行 返回 403 INVALID_RESUME_TO
全文：.sillyspec/changes/archive/2026-05-30-execution-coordinator/requirements.md#FR-02
最近确认：c0af692c7

## FR-unmapped-067 进度快照（checkpoint）
变更：2026-05-30-execution-coordinator
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个 AgentRun 正在执行（状态 running） 一个 AgentRun 已保存 checkpoint 调用 save_checkpoint 时指定 e；When 调用 save_checkpoint 并传入 data = {"step": 3, "files_modified": [...]} 调用 load_check
全文：.sillyspec/changes/archive/2026-05-30-execution-coordinator/requirements.md#FR-03
最近确认：c0af692c7

## FR-unmapped-068 乐观锁（optimistic_lock）
变更：2026-05-30-execution-coordinator
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个 AgentRun.version = 3 并发冲突返回 409；When 两个并发请求同时更新该 AgentRun 客户端重新获取最新 version 后重试；Then 第一个成功（version → 4），第二个检测到冲突返回 409 更新成功
全文：.sillyspec/changes/archive/2026-05-30-execution-coordinator/requirements.md#FR-04
最近确认：c0af692c7

## FR-unmapped-069 审批门（approval_token）
变更：2026-05-30-execution-coordinator
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个 AgentRun 被标记为需要审批 管理员调用 approve 端点并传入正确的 approval_token 管理员调用 approve 端点并传入错误；When 执行到高风险操作前 token 匹配 token 不匹配 超过审批超时（默认 1 小时）
全文：.sillyspec/changes/archive/2026-05-30-execution-coordinator/requirements.md#FR-05
最近确认：c0af692c7

## FR-unmapped-070 上下文一致性（context_fingerprint）
变更：2026-05-30-execution-coordinator
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 开发者调用 start_run 开发者调用 resume 端点 开发者调用 resume 端点；When AgentSpecBundle 构建 提供了 context_fingerprint 参数且与存储值不匹配 不提供 context_fingerprint 参数；Then 计算 proposal + design + plan + task_content 的 SHA-256 指纹，存入 context_fingerprint 返
全文：.sillyspec/changes/archive/2026-05-30-execution-coordinator/requirements.md#FR-06
最近确认：c0af692c7

## FR-unmapped-071 重试控制
变更：2026-05-30-execution-coordinator
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个 AgentRun 执行失败 一个 AgentRun 执行失败；When retry_count < max_retries retry_count >= max_retries；Then 可通过 resume 自动重试，retry_count 递增 不允许自动重试，返回 409 MAX_RETRIES_EXCEEDED
全文：.sillyspec/changes/archive/2026-05-30-execution-coordinator/requirements.md#FR-07
最近确认：c0af692c7

## FR-unmapped-072 ToolPolicy CRUD
变更：2026-05-30-tool-gateway
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个 workspace 存在 一个 workspace 已有 ToolPolicy 一个 ToolPolicy 存在 一个 ToolPolicy 存在；When 开发者 POST /api/workspaces/{ws_id}/tool-policies 并提供 name + 配置 开发者 GET /api/worksp；Then 创建 ToolPolicy 并返回 201 返回该 workspace 下所有 policy 列表 更新 policy 并返回 200 删除 policy，关联
全文：.sillyspec/changes/archive/2026-05-30-tool-gateway/requirements.md#FR-01
最近确认：c0af692c7

## FR-unmapped-073 AgentRun 关联 ToolPolicy
变更：2026-05-30-tool-gateway
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个 AgentRun 正在创建 一个 AgentRun 正在创建；When 指定 tool_policy_id 未指定 tool_policy_id；Then AgentRun 记录关联该 policy AgentRun 使用 default_policy（全量允许 + 全局安全限制）
全文：.sillyspec/changes/archive/2026-05-30-tool-gateway/requirements.md#FR-02
最近确认：c0af692c7

## FR-unmapped-074 策略校验 — 工具白名单
变更：2026-05-30-tool-gateway
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given ToolPolicy.allowed_tools = ["file_read", "file_list"] ToolPolicy.allowed_tools =；When Agent 调用 shell_exec Agent 调用 file_read；Then 返回 403 TOOL_OPERATION_FORBIDDEN 正常执行
全文：.sillyspec/changes/archive/2026-05-30-tool-gateway/requirements.md#FR-03
最近确认：c0af692c7

## FR-unmapped-075 策略校验 — 路径限制
变更：2026-05-30-tool-gateway
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given ToolPolicy.allowed_paths = ["src/", "tests/"] ToolPolicy.allowed_paths = ["."]；When Agent 调用 file_read path="../../etc/passwd" Agent 调用 file_read path="src/main.py"；Then 返回 403 TOOL_PATH_FORBIDDEN（路径逃逸） 正常执行
全文：.sillyspec/changes/archive/2026-05-30-tool-gateway/requirements.md#FR-04
最近确认：c0af692c7

## FR-unmapped-076 策略校验 — shell 命令黑名单
变更：2026-05-30-tool-gateway
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given ToolPolicy.blocked_commands = ["curl", "wget"] 全局 SHELL_BLOCKED_PATTERNS 包含 sudo；When Agent 调用 shell_exec command="curl" Agent 调用 shell_exec command="sudo"；Then 返回 403 TOOL_OPERATION_FORBIDDEN 返回 403 TOOL_OPERATION_FORBIDDEN（全局黑名单始终生效）
全文：.sillyspec/changes/archive/2026-05-30-tool-gateway/requirements.md#FR-05
最近确认：c0af692c7

## FR-unmapped-077 策略校验 — 资源限制
变更：2026-05-30-tool-gateway
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given ToolPolicy.max_timeout = 30 ToolPolicy.max_output_size = 32000；When Agent 调用 shell_exec timeout=60 工具输出 50000 字符；Then 实际超时被限制为 30s 输出被截断为 32000 字符
全文：.sillyspec/changes/archive/2026-05-30-tool-gateway/requirements.md#FR-06
最近确认：c0af692c7

## FR-unmapped-078 run_tests 工具
变更：2026-05-30-tool-gateway
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given lease 处于 locked 状态且 policy 允许 run_tests run_tests 执行超时；When Agent 调用 run_tests runner="pytest" path="tests/" 超过 policy.max_timeout；Then 在 lease root 下执行 pytest，返回结构化结果 (passed/failed/skipped 计数 + 失败列表) 终止进程，返回 result
全文：.sillyspec/changes/archive/2026-05-30-tool-gateway/requirements.md#FR-07
最近确认：c0af692c7

## FR-unmapped-079 http_get 工具
变更：2026-05-30-tool-gateway
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given ToolPolicy.allowed_domains = ["api.github.com", "pypi.org"] ToolPolicy.allowed_d；When Agent 调用 http_get url="https://api.github.com/repos/..." Agent 调用 http_get url="
全文：.sillyspec/changes/archive/2026-05-30-tool-gateway/requirements.md#FR-08
最近确认：c0af692c7

## FR-unmapped-080 审计双写
变更：2026-05-30-tool-gateway
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 任意工具调用执行成功 AuditLog 记录；When ToolGatewayService.execute() 完成 查看 details_json；Then 同时存在 ToolOperationLog 记录和 AuditLog 记录 包含 tool_type、params、result_code 信息
全文：.sillyspec/changes/archive/2026-05-30-tool-gateway/requirements.md#FR-09
最近确认：c0af692c7

## FR-unmapped-081 spec-bootstrap 创建异步 AgentRun
变更：2026-06-02-spec-bootstrap-agent-stream-interaction
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户拥有 `WORKSPACE_WRITE` 权限且 workspace 存在对应 SpecWorkspace 后台任务已启动；When 用户调用 `POST /api/workspaces/{workspace_id}/spec-bootstrap` Agent run 状态变为 `runnin；Then 后端创建 `AgentRun(status=pending)` 和 `AgentRunWorkspace` 关联，并立即返回 `agent_run_id`、`s
全文：.sillyspec/changes/archive/2026-06-02-spec-bootstrap-agent-stream-interaction/requirements.md#FR-01
最近确认：cfd794ddf

## FR-unmapped-082 bootstrap 通过 ClaudeCodeAdapter 执行
变更：2026-06-02-spec-bootstrap-agent-stream-interaction
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given `SpecBootstrapService` 已加载 `SpecWorkspace` 和 `Workspace`；When 后台执行 bootstrap run；Then 后端构造 `AgentSpecBundle` 并调用 `ClaudeCodeAdapter.run_with_bundle()`
全文：.sillyspec/changes/archive/2026-06-02-spec-bootstrap-agent-stream-interaction/requirements.md#FR-02
最近确认：cfd794ddf

## FR-unmapped-083 Agent 执行 init + scan + 验证
变更：2026-06-02-spec-bootstrap-agent-stream-interaction
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Agent 收到 bootstrap bundle Agent 执行结束；When `ClaudeCodeAdapter` 启动 Claude CLI 后端运行 `SpecValidator.validate(spec_root)`；Then prompt 必须包含 `sillyspec init --dir <spec_root>` 验证通过时 `SpecWorkspace.sync_status=
全文：.sillyspec/changes/archive/2026-06-02-spec-bootstrap-agent-stream-interaction/requirements.md#FR-03
最近确认：cfd794ddf

## FR-unmapped-084 Workspace 页面实时展示消息流
变更：2026-06-02-spec-bootstrap-agent-stream-interaction
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given `/spec-bootstrap` 返回 `agent_run_id`；When Workspace 详情页收到响应；Then 页面立即连接该 run 的 SSE stream
全文：.sillyspec/changes/archive/2026-06-02-spec-bootstrap-agent-stream-interaction/requirements.md#FR-04
最近确认：cfd794ddf

## FR-unmapped-085 双入口用户确认/指导
变更：2026-06-02-spec-bootstrap-agent-stream-interaction
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Agent 输出需要用户确认或指导的事件 用户提交指导文本；When 前端解析到 pending input 状态 后端收到用户输入；Then Workspace 详情页展示轻量输入框 用户输入记录到 `AgentRunLog`
全文：.sillyspec/changes/archive/2026-06-02-spec-bootstrap-agent-stream-interaction/requirements.md#FR-05
最近确认：cfd794ddf

## FR-unmapped-086 后端 SSE 支持续传参数
变更：2026-06-02-sse-reliable-stream
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 调用者请求 `GET /api/workspaces/{ws}/agent/runs/{id}/stream?after={log_id}` 调用者未传 `af；When 后端处理 SSE stream 请求 后端处理请求；Then DB replay 阶段只返回 `id > after` 的 AgentRunLog 记录 行为与当前完全一致（返回所有日志）
全文：.sillyspec/changes/archive/2026-06-02-sse-reliable-stream/requirements.md#FR-01
最近确认：cfd794ddf

## FR-unmapped-087 SSE 事件携带 log_id
变更：2026-06-02-sse-reliable-stream
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 后端通过 SSE 推送日志事件；When 事件格式序列化；Then 每个事件包含 `log_id` 字段（AgentRunLog.id）
全文：.sillyspec/changes/archive/2026-06-02-sse-reliable-stream/requirements.md#FR-02
最近确认：cfd794ddf

## FR-unmapped-088 AgentRunStreamClient 连接管理
变更：2026-06-02-sse-reliable-stream
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 前端创建 `AgentRunStreamClient` 实例 调用 `disconnect()` 方法；When 调用 `connect(token)` 方法 连接处于任何状态；Then 内部创建 EventSource 并连接到对应 run 的 SSE 端点 关闭 EventSource，状态变为 `disconnected`
全文：.sillyspec/changes/archive/2026-06-02-sse-reliable-stream/requirements.md#FR-03
最近确认：cfd794ddf

## FR-unmapped-089 断线自动重连
变更：2026-06-02-sse-reliable-stream
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given SSE 连接处于 `connected` 状态 重连流程执行中 连续重试 5 次均失败；When EventSource 触发 `onerror` 获取新 token 失败或回填请求失败 达到最大重试次数；Then 自动执行重连流程：关闭旧连接 → 刷新 token → 回填日志 → 重建连接 计入重试次数，等待指数退避后重试 状态变为 `error`
全文：.sillyspec/changes/archive/2026-06-02-sse-reliable-stream/requirements.md#FR-04
最近确认：cfd794ddf

## FR-unmapped-090 断线日志回填
变更：2026-06-02-sse-reliable-stream
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given SSE 连接断开并准备重连 回填日志和 SSE 新事件存在重叠；When 获取到新 token 后 两者都包含相同 `log_id` 的事件；Then 调用 `GET /logs?after={lastLogId}` 获取断线期间日志 通过 `log_id` Set 去重，只处理一次
全文：.sillyspec/changes/archive/2026-06-02-sse-reliable-stream/requirements.md#FR-05
最近确认：cfd794ddf

## FR-unmapped-091 log_id 去重
变更：2026-06-02-sse-reliable-stream
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given SSE 事件携带 `log_id` 字段 回填日志和 SSE 推送可能重叠；When 前端收到事件 log_id 已存在于 Set 中；Then 维护 `Set<number>` 记录已处理的 log_id 该事件被安全丢弃，不触发 `onMessage`
全文：.sillyspec/changes/archive/2026-06-02-sse-reliable-stream/requirements.md#FR-06
最近确认：cfd794ddf

## FR-unmapped-092 Workspace 详情页集成
变更：2026-06-02-sse-reliable-stream
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Workspace 详情页使用 `AgentRunStreamClient`；When Bootstrap 按钮触发后；Then 使用新的 `AgentRunStreamClient` 替换手动 EventSource 管理
全文：.sillyspec/changes/archive/2026-06-02-sse-reliable-stream/requirements.md#FR-07
最近确认：cfd794ddf

## FR-unmapped-093 生成项目规范统一为 Bootstrap 流程并跳转详情页
变更：2026-06-03-workspace-bootstrap-flow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户在「添加 Workspace」弹窗已完成扫描，处于 ready 阶段；When 用户点击「生成项目规范」按钮；Then 前端调用 `scanGenerate(rootPath)` 创建（或幂等复用）workspace 与 scan run
全文：.sillyspec/changes/archive/2026-06-03-workspace-bootstrap-flow/requirements.md#FR-01
最近确认：98d3e56dd

## FR-unmapped-094 进入详情页自动检测并恢复进行中的 Bootstrap 回显
变更：2026-06-03-workspace-bootstrap-flow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 某 workspace 存在一个 `change_id` 为空、status 为 pending 或 running 的 scan run；When 用户进入 `/workspaces/{id}` 详情页（首次进入或刷新）；Then `load()` 通过 `listWorkspaceAgentRuns` 查到该进行中 run
全文：.sillyspec/changes/archive/2026-06-03-workspace-bootstrap-flow/requirements.md#FR-02
最近确认：98d3e56dd

## FR-unmapped-095 Bootstrap 执行期间防止重复触发
变更：2026-06-03-workspace-bootstrap-flow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 某 workspace 已有进行中（pending/running）的 scan run；When 用户（在详情页或另一标签页弹窗）再次发起 `scan-generate`；Then 后端不创建新 run，幂等返回现有进行中 run 的 id
全文：.sillyspec/changes/archive/2026-06-03-workspace-bootstrap-flow/requirements.md#FR-03
最近确认：98d3e56dd

## FR-unmapped-096 Bootstrap 成功后自动创建子组件
变更：2026-06-03-workspace-bootstrap-flow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given scan agent 执行成功（exit_code == 0）；When 后端 `_execute_scan_run` 进入成功收尾分支；Then 自动执行 reparse 逻辑，创建对应子 workspace 与 relations
全文：.sillyspec/changes/archive/2026-06-03-workspace-bootstrap-flow/requirements.md#FR-04
最近确认：98d3e56dd

## FR-unmapped-097 完成后详情页刷新子组件计数
变更：2026-06-03-workspace-bootstrap-flow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 详情页已连接的 Bootstrap SSE 流收到 done 事件；When `onDone` 回调触发；Then 调用 `load()` 重新拉取数据
全文：.sillyspec/changes/archive/2026-06-03-workspace-bootstrap-flow/requirements.md#FR-05
最近确认：98d3e56dd

## FR-unmapped-098 Gate 时机修正 — transition 时 gate=none
变更：2026-06-04-fix-agent-driven-change-center-flow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — When 调用 `transition(target_stage="brainstorm")` `complete_stage(stage="propose")` 被调用；Then `current_stage=brainstorm, human_gate=none`（不是 need_requirement_input） `human_ga
全文：.sillyspec/changes/archive/2026-06-04-fix-agent-driven-change-center-flow/requirements.md#FR-01
最近确认：f7f73d86c

## FR-unmapped-099 complete_stage 统一入口
变更：2026-06-04-fix-agent-driven-change-center-flow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Agent 完成任意阶段 brainstorm 完成，result="clear" brainstorm 完成，result="ambiguous" execu；When 系统调用 `complete_stage(workspace_id, change_id, stage, result)` `complete_stage(st；Then 根据 stage 和 result 执行对应后续动作（设 gate / transition / dispatch），不再散落在 transition / au
全文：.sillyspec/changes/archive/2026-06-04-fix-agent-driven-change-center-flow/requirements.md#FR-02
最近确认：f7f73d86c

## FR-unmapped-100 rerun_stage 同阶段重跑
变更：2026-06-04-fix-agent-driven-change-center-flow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个 Change 处于 propose 阶段，`human_gate=need_proposal_review` 一个 Change 处于 plan 阶段，`；When `proposal_review(decision="revise", comment="四件套缺少边界条件")` 被调用 `plan_review(decis；Then `human_gate=none`，重新 dispatch propose Agent，不触发 InvalidTransition `human_gate=no
全文：.sillyspec/changes/archive/2026-06-04-fix-agent-driven-change-center-flow/requirements.md#FR-03
最近确认：f7f73d86c

## FR-unmapped-101 verify→propose 回退边
变更：2026-06-04-fix-agent-driven-change-center-flow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个 Change 处于 verify 阶段，`human_gate=need_human_test`；When `human_test(result="doc_mismatch", comment="API 文档与实际不一致")` 被调用；Then `current_stage=propose, human_gate=none`，并 dispatch propose Agent
全文：.sillyspec/changes/archive/2026-06-04-fix-agent-driven-change-center-flow/requirements.md#FR-04
最近确认：f7f73d86c

## FR-unmapped-102 proposal-review 修正
变更：2026-06-04-fix-agent-driven-change-center-flow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个 Change 处于 propose 阶段，`human_gate=need_proposal_review` 任意 proposal_review 调用；When `proposal_review(decision="approve")` 被调用 `proposal_review(decision="unclear", c；Then `current_stage=plan, human_gate=none`，并 dispatch plan Agent `current_stage=brain
全文：.sillyspec/changes/archive/2026-06-04-fix-agent-driven-change-center-flow/requirements.md#FR-05
最近确认：f7f73d86c

## FR-unmapped-103 plan-review 修正
变更：2026-06-04-fix-agent-driven-change-center-flow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个 Change 处于 plan 阶段，`human_gate=need_plan_review`；Then `current_stage=execute, human_gate=none`，并 dispatch execute Agent `current_stage
全文：.sillyspec/changes/archive/2026-06-04-fix-agent-driven-change-center-flow/requirements.md#FR-06
最近确认：f7f73d86c

## FR-unmapped-104 human-test 修正
变更：2026-06-04-fix-agent-driven-change-center-flow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个 Change 处于 verify 阶段，`human_gate=need_human_test`；When `human_test(result="pass")` 被调用 `human_test(result="bug", comment="列表分页显示错误")` 被
全文：.sillyspec/changes/archive/2026-06-04-fix-agent-driven-change-center-flow/requirements.md#FR-07
最近确认：f7f73d86c

## FR-unmapped-105 archive-confirm API
变更：2026-06-04-fix-agent-driven-change-center-flow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个 Change 处于 archive 阶段，`human_gate=need_archive_confirm` 一个 Change 不处于 archive+；When `POST /api/workspaces/{ws_id}/changes/{id}/archive-confirm` 被调用 调用 archive-confi；Then `human_gate=none`，dispatch archive Agent 返回 400 错误 `current_stage=archived, huma
全文：.sillyspec/changes/archive/2026-06-04-fix-agent-driven-change-center-flow/requirements.md#FR-08
最近确认：f7f73d86c

## FR-unmapped-106 前端 Gate 面板 comment
变更：2026-06-04-fix-agent-driven-change-center-flow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 详情页显示 Gate 面板（任意 gate） revise / unclear / replan / bug / doc_mismatch 操作 approve；When 用户看到操作按钮 comment 为空 comment 为空；Then 每个面板都有一个 textarea 用于输入意见 按钮禁用或提交时提示"请填写意见" 允许提交（comment 可选）
全文：.sillyspec/changes/archive/2026-06-04-fix-agent-driven-change-center-flow/requirements.md#FR-09
最近确认：f7f73d86c

## FR-unmapped-107 归档确认按钮修正
变更：2026-06-04-fix-agent-driven-change-center-flow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 详情页显示 `need_archive_confirm` Gate 面板；When 用户点击"确认归档"；Then 调用 `archiveConfirm(workspaceId, changeId, comment)` API，不调用 `humanTest(pass)`
全文：.sillyspec/changes/archive/2026-06-04-fix-agent-driven-change-center-flow/requirements.md#FR-10
最近确认：f7f73d86c

## FR-unmapped-108 清理旧 UI 残留
变更：2026-06-04-fix-agent-driven-change-center-flow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 变更详情页代码；When 搜索 `ready_for_dev` / `accepted` / `executeChange` / `handleArchive` / `submitFee；Then 无匹配引用
全文：.sillyspec/changes/archive/2026-06-04-fix-agent-driven-change-center-flow/requirements.md#FR-11
最近确认：f7f73d86c

## FR-unmapped-116 类型列自动推断
变更：2026-06-08-2026-06-08-change-center-columns
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 变更目录包含 `tasks/` 子目录和 `plan.md`/`design.md` 变更目录名包含 "quick" 或仅包含 MASTER.md + requ；When Parser 扫描该目录 Parser 扫描该目录 Parser 扫描该目录 Parser 扫描该目录；Then `change_type` 被推断为 `"feature"` `change_type` 被推断为 `"quick"` `change_type` 被推断为 `
全文：.sillyspec/changes/archive/2026-06-08-2026-06-08-change-center-columns/requirements.md#FR-01
最近确认：8fbf8a5df

## FR-unmapped-117 影响组件自动推断
变更：2026-06-08-2026-06-08-change-center-columns
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 变更目录下有 `module-impact.md` 变更目录下无 `module-impact.md` 但有 `tasks.md` 或 `tasks/*.md`；When Parser 扫描该目录 Parser 扫描该目录 Parser 扫描该目录；Then `affected_components` 从 module-impact.md 提取模块名 `affected_components` 从文件路径中提取模块名
全文：.sillyspec/changes/archive/2026-06-08-2026-06-08-change-center-columns/requirements.md#FR-02
最近确认：8fbf8a5df

## FR-unmapped-118 reparse 覆盖策略
变更：2026-06-08-2026-06-08-change-center-columns
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given DB 中 `change_type` 为 null DB 中 `change_type` 已有非 null 值 reparse 执行时；When reparse 执行时 Parser 推断出 change_type reparse 执行时 Parser 推断出 affected_components；Then DB 中的 change_type 被更新为推断值 DB 中的 change_type 不被覆盖 DB 中的 affected_components 总是被更新
全文：.sillyspec/changes/archive/2026-06-08-2026-06-08-change-center-columns/requirements.md#FR-03
最近确认：8fbf8a5df

## FR-unmapped-119 状态列展示 human_gate
变更：2026-06-08-2026-06-08-change-center-columns
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 变更的 `human_gate` 不为空且不为 `"none"` 变更的 `human_gate` 为空或 `"none"`；When 前端渲染状态列 前端渲染状态列；Then 显示对应中文待办 Badge（如"待提案审核"、"待人工测试"） 根据 `current_stage` 显示阶段状态
全文：.sillyspec/changes/archive/2026-06-08-2026-06-08-change-center-columns/requirements.md#FR-04
最近确认：8fbf8a5df

## FR-unmapped-120 阶段列 null 兜底
变更：2026-06-08-2026-06-08-change-center-columns
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 变更的 `current_stage` 为 null 或 undefined；When 前端渲染阶段列；Then 显示 "draft" badge
全文：.sillyspec/changes/archive/2026-06-08-2026-06-08-change-center-columns/requirements.md#FR-05
最近确认：8fbf8a5df

## FR-unmapped-121 类型列颜色映射
变更：2026-06-08-2026-06-08-change-center-columns
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — When 前端渲染类型列 前端渲染类型列 前端渲染类型列；Then 显示蓝色 Badge 显示黄色 Badge 显示紫色 Badge
全文：.sillyspec/changes/archive/2026-06-08-2026-06-08-change-center-columns/requirements.md#FR-06
最近确认：8fbf8a5df

## FR-unmapped-137 Platform Admin 权限校验
变更：2026-06-10-user-management
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-10-user-management/requirements.md#FR-01
最近确认：98d3e56dd

## FR-unmapped-138 安全保护
变更：2026-06-10-user-management
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-10-user-management/requirements.md#FR-02
最近确认：98d3e56dd

## FR-unmapped-139 用户列表增强
变更：2026-06-10-user-management
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-10-user-management/requirements.md#FR-03
最近确认：98d3e56dd

## FR-unmapped-140 用户详情
变更：2026-06-10-user-management
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-10-user-management/requirements.md#FR-04
最近确认：98d3e56dd

## FR-unmapped-141 管理员重置密码
变更：2026-06-10-user-management
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-10-user-management/requirements.md#FR-05
最近确认：98d3e56dd

## FR-unmapped-142 审计日志
变更：2026-06-10-user-management
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-10-user-management/requirements.md#FR-06
最近确认：98d3e56dd

## FR-unmapped-143 单个会话撤销
变更：2026-06-10-user-management-v2
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户有活跃会话 会话不属于目标用户或已撤销；When Platform Admin 调用 DELETE /api/users/{id}/sessions/{session_id} 调用 DELETE /api/us；Then 该会话被标记为 revoked，写入审计日志 返回 404
全文：.sillyspec/changes/archive/2026-06-10-user-management-v2/requirements.md#FR-01
最近确认：8fbf8a5df

## FR-unmapped-144 批量撤销会话
变更：2026-06-10-user-management-v2
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户有 N 个活跃会话；When Platform Admin 调用 POST /api/users/{id}/sessions/revoke-all；Then 所有活跃会话被撤销，返回 revoked_count，写入审计日志
全文：.sillyspec/changes/archive/2026-06-10-user-management-v2/requirements.md#FR-02
最近确认：8fbf8a5df

## FR-unmapped-145 密码重置审计标记
变更：2026-06-10-user-management-v2
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Platform Admin 重置用户密码 传入 force_change_on_next_login=false 或不传；When 传入 force_change_on_next_login=true 重置密码；Then 审计日志 details_json 包含 force_change_on_next_login=true 标记 details_json 中 force_cha
全文：.sillyspec/changes/archive/2026-06-10-user-management-v2/requirements.md#FR-03
最近确认：8fbf8a5df

## FR-unmapped-146 用户 Workspace 角色查询
变更：2026-06-10-user-management-v2
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户属于 Workspace A (role: developer) 和 Workspace B (role: reviewer) 用户不属于任何 Worksp；When Platform Admin 调用 GET /api/users/{id}/workspaces 调用 GET /api/users/{id}/workspac；Then 返回 [{workspace_name: "A", workspace_slug: "a", role_name: "developer"}, ...] 返回空
全文：.sillyspec/changes/archive/2026-06-10-user-management-v2/requirements.md#FR-04
最近确认：8fbf8a5df

## FR-unmapped-147 前端操作列优化
变更：2026-06-10-user-management-v2
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户列表展示；When 管理员查看操作列；Then 只看到"详情"链接，点击打开 Drawer
全文：.sillyspec/changes/archive/2026-06-10-user-management-v2/requirements.md#FR-05
最近确认：8fbf8a5df

## FR-unmapped-148 Drawer 增强
变更：2026-06-10-user-management-v2
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户详情 Drawer 打开 会话 Tab 展示 会话 Tab 展示；When 查看"所属 Workspace" Tab 管理员点击某个会话的"撤销"按钮 管理员点击"撤销全部会话"；Then 显示 workspace name + role name 列表 该会话被撤销 所有活跃会话被撤销
全文：.sillyspec/changes/archive/2026-06-10-user-management-v2/requirements.md#FR-06
最近确认：8fbf8a5df

## FR-unmapped-159 Workspace 持久化默认 agent
变更：2026-06-14-2026-06-14-agent-runtime-selection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个已存在的 workspace（`default_agent` 列存在，可为 NULL） workspace 当前 `default_agent="claud；When 所有者通过 `PATCH /api/workspaces/{id}` 传 `{"default_agent": "claude"}` 所有者 PATCH 传 `；Then 该 workspace 的 `default_agent` 更新为 `"claude"`，`GET /api/workspaces/{id}` 返回 `defa
全文：.sillyspec/changes/archive/2026-06-14-2026-06-14-agent-runtime-selection/requirements.md#FR-01
最近确认：4b0733057

## FR-unmapped-160 provider 解析优先级（三入口共用）
变更：2026-06-14-2026-06-14-agent-runtime-selection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given workspace.default_agent="claude"，且未在触发时显式传 provider workspace.default_agent="cla；When 任意入口（start_run / start_stage_dispatch / start_scan_dispatch）分发 分发 分发；Then 透传给 `dispatch_to_daemon` 的 `provider="claude"` 透传的 `provider="codex"`（显式 > 默认） 透
全文：.sillyspec/changes/archive/2026-06-14-2026-06-14-agent-runtime-selection/requirements.md#FR-02
最近确认：4b0733057

## FR-unmapped-161 placement 严格匹配 + 无在线回退
变更：2026-06-14-2026-06-14-agent-runtime-selection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户有 claude（在线）、codex（在线）、hermes（在线）三个 runtime 用户仅有 codex（在线）、hermes（在线），claude 离；Then 返回 provider="claude" 的 runtime 返回 codex 或 hermes 中一个在线 runtime（ORDER BY last_hea
全文：.sillyspec/changes/archive/2026-06-14-2026-06-14-agent-runtime-selection/requirements.md#FR-03
最近确认：4b0733057

## FR-unmapped-162 自动调度链路自动使用默认 agent
变更：2026-06-14-2026-06-14-agent-runtime-selection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given workspace.default_agent="claude"，change 处于自动调度（`auto_dispatch_next_step` → `disp；When stage 自动分发执行；Then `start_stage_dispatch` 内部读 workspace.default_agent，命中 claude（无需改 dispatch.py 自动调
全文：.sillyspec/changes/archive/2026-06-14-2026-06-14-agent-runtime-selection/requirements.md#FR-04
最近确认：4b0733057

## FR-unmapped-163 task 触发支持显式 provider
变更：2026-06-14-2026-06-14-agent-runtime-selection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 前端 task 触发面板，用户在下拉选择 "codex"；When POST `/api/workspaces/{id}/agent/runs` body 含 `"provider": "codex"`；Then `create_agent_run` 透传给 `start_run(provider="codex")`，最终命中 codex
全文：.sillyspec/changes/archive/2026-06-14-2026-06-14-agent-runtime-selection/requirements.md#FR-05
最近确认：4b0733057

## FR-unmapped-164 手动 stage dispatch / scan-generate 支持显式 provider
变更：2026-06-14-2026-06-14-agent-runtime-selection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 前端手动重跑 stage / scan 触发面板，用户选择某 provider；When 对应 HTTP 入口收到 `provider` 字段；Then 透传到 `start_stage_dispatch` / `start_scan_dispatch`，覆盖 workspace.default_agent
全文：.sillyspec/changes/archive/2026-06-14-2026-06-14-agent-runtime-selection/requirements.md#FR-06
最近确认：4b0733057

## FR-unmapped-165 前端 workspace 设置页默认 agent 下拉
变更：2026-06-14-2026-06-14-agent-runtime-selection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given workspace 设置页打开，daemon 注册了 claude / codex / hermes（部分在线）；When 渲染"默认 Agent"下拉；Then 选项 = 在线 runtime 的 distinct provider（用 PROVIDER_META 显示 label/icon），含"未设置"选项；默认选中
全文：.sillyspec/changes/archive/2026-06-14-2026-06-14-agent-runtime-selection/requirements.md#FR-07
最近确认：4b0733057

## FR-unmapped-166 前端触发面板 agent 下拉默认联动
变更：2026-06-14-2026-06-14-agent-runtime-selection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given workspace.default_agent="claude"；When 打开 task / stage / scan 触发面板；Then agent 下拉默认显示"claude"（或"使用默认(claude)"），用户可临时改选
全文：.sillyspec/changes/archive/2026-06-14-2026-06-14-agent-runtime-selection/requirements.md#FR-08
最近确认：4b0733057

## FR-unmapped-167 数据模型与迁移
变更：2026-06-16-admin-org-role-center
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-admin-org-role-center/requirements.md#FR-01
最近确认：98d3e56dd

## FR-unmapped-168 Permission 枚举扩展
变更：2026-06-16-admin-org-role-center
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-admin-org-role-center/requirements.md#FR-02
最近确认：98d3e56dd

## FR-unmapped-169 角色管理 - 列表与详情
变更：2026-06-16-admin-org-role-center
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-admin-org-role-center/requirements.md#FR-03
最近确认：98d3e56dd

## FR-unmapped-170 角色管理 - 创建
变更：2026-06-16-admin-org-role-center
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-admin-org-role-center/requirements.md#FR-04
最近确认：98d3e56dd

## FR-unmapped-171 角色管理 - 更新与状态切换
变更：2026-06-16-admin-org-role-center
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-admin-org-role-center/requirements.md#FR-05
最近确认：98d3e56dd

## FR-unmapped-172 角色管理 - 删除前置检查
变更：2026-06-16-admin-org-role-center
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-admin-org-role-center/requirements.md#FR-06
最近确认：98d3e56dd

## FR-unmapped-173 组织管理 - 树形结构
变更：2026-06-16-admin-org-role-center
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-admin-org-role-center/requirements.md#FR-07
最近确认：98d3e56dd

## FR-unmapped-174 组织管理 - 创建与更新
变更：2026-06-16-admin-org-role-center
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-admin-org-role-center/requirements.md#FR-08
最近确认：98d3e56dd

## FR-unmapped-175 组织管理 - 删除前置检查
变更：2026-06-16-admin-org-role-center
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-admin-org-role-center/requirements.md#FR-09
最近确认：98d3e56dd

## FR-unmapped-176 用户管理 - CRUD 扩展
变更：2026-06-16-admin-org-role-center
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-admin-org-role-center/requirements.md#FR-10
最近确认：98d3e56dd

## FR-unmapped-177 用户管理 - 自保护与最后管理员保护
变更：2026-06-16-admin-org-role-center
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-admin-org-role-center/requirements.md#FR-11
最近确认：98d3e56dd

## FR-unmapped-178 用户管理 - 登录权限控制
变更：2026-06-16-admin-org-role-center
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-admin-org-role-center/requirements.md#FR-12
最近确认：98d3e56dd

## FR-unmapped-179 现有 /api/users 端点兼容
变更：2026-06-16-admin-org-role-center
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-admin-org-role-center/requirements.md#FR-13
最近确认：98d3e56dd

## FR-unmapped-180 前端 /admin 路由鉴权
变更：2026-06-16-admin-org-role-center
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-admin-org-role-center/requirements.md#FR-14
最近确认：98d3e56dd

## FR-unmapped-181 前端 settings 剥离
变更：2026-06-16-admin-org-role-center
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-admin-org-role-center/requirements.md#FR-15
最近确认：98d3e56dd

## FR-unmapped-182 审计覆盖
变更：2026-06-16-admin-org-role-center
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-admin-org-role-center/requirements.md#FR-16
最近确认：98d3e56dd

## FR-unmapped-193 列出 workspace 成员
变更：2026-06-16-workspace-members
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-workspace-members/requirements.md#FR-01
最近确认：509d92bc6

## FR-unmapped-194 模糊搜索用户
变更：2026-06-16-workspace-members
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-workspace-members/requirements.md#FR-02
最近确认：509d92bc6

## FR-unmapped-195 添加成员
变更：2026-06-16-workspace-members
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-workspace-members/requirements.md#FR-03
最近确认：509d92bc6

## FR-unmapped-196 修改成员角色
变更：2026-06-16-workspace-members
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-workspace-members/requirements.md#FR-04
最近确认：509d92bc6

## FR-unmapped-197 移除成员
变更：2026-06-16-workspace-members
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-workspace-members/requirements.md#FR-05
最近确认：509d92bc6

## FR-unmapped-198 传递所有权
变更：2026-06-16-workspace-members
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-workspace-members/requirements.md#FR-06
最近确认：509d92bc6

## FR-unmapped-199 前端 Members tab
变更：2026-06-16-workspace-members
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-workspace-members/requirements.md#FR-07
最近确认：509d92bc6

## FR-unmapped-200 添加成员对话框
变更：2026-06-16-workspace-members
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-workspace-members/requirements.md#FR-08
最近确认：509d92bc6

## FR-unmapped-201 workspace 路径来源字段（覆盖 D-004@v1）
变更：2026-06-18-2026-06-18-workspace-client-path
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given workspaces 表 创建 path_source=daemon-client 的 workspace 现有/新 server-local workspac；When 应用迁移 提交 WorkspaceCreate 未指定 path_source；Then 新增 `path_source VARCHAR(20) NOT NULL DEFAULT 'server-local'` 与 `daemon_runtime_i
全文：.sillyspec/changes/archive/2026-06-18-2026-06-18-workspace-client-path/requirements.md#FR-01
最近确认：686ca0f7e

## FR-unmapped-202 agent run 强绑 daemon 路由 + 离线失败（覆盖 D-001@v1）
变更：2026-06-18-2026-06-18-workspace-client-path
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given path_source=daemon-client 的 workspace 发起 agent run 绑定 daemon 离线 path_source=serv；When dispatch_to_daemon 选 runtime dispatch dispatch；Then 使用 `workspace.daemon_runtime_id`（覆盖 `_get_online_runtime(user_id)` 的 user 级选择） 抛
全文：.sillyspec/changes/archive/2026-06-18-2026-06-18-workspace-client-path/requirements.md#FR-02
最近确认：686ca0f7e

## FR-unmapped-203 前端 daemon 目录树形浏览（覆盖 D-005@v1）
变更：2026-06-18-2026-06-18-workspace-client-path
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given 已选在线 daemon daemon 离线或 RPC 超时；When 用户在创建表单展开目录节点 list-dir 调用；Then 前端调 `POST /api/daemon/runtimes/{id}/list-dir {path}`，渲染返回的 `{name,type}[]` 子节点（懒
全文：.sillyspec/changes/archive/2026-06-18-2026-06-18-workspace-client-path/requirements.md#FR-03
最近确认：686ca0f7e

## FR-unmapped-204 list_dir allowed_roots 白名单（覆盖 D-002@v1）
变更：2026-06-18-2026-06-18-workspace-client-path
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given daemon config.allowed_roots 配置 allowed_roots 未显式配置；When list_dir 请求 path daemon 启动；Then daemon 校验 path 必须在某 allowed_root 之下；越界返回 error.code=forbidden（前端 403） 默认 `[homed
全文：.sillyspec/changes/archive/2026-06-18-2026-06-18-workspace-client-path/requirements.md#FR-04
最近确认：686ca0f7e

## FR-unmapped-205 spec 按需下发与回传（覆盖 D-003@v1, D-006@v1）
变更：2026-06-18-2026-06-18-workspace-client-path
状态：active
摘要：默认场景
依据决策：D-003@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given daemon-client workspace 的 agent run 准备执行 agent 执行完成 spec 列表/内容读取；When daemon task-runner 启动 daemon 收尾 前端查询；Then 调 `GET /api/spec-workspaces/{ws_id}/bundle` 拉 tar，解到本地 `~/.sillyhub/daemon/specs
全文：.sillyspec/changes/archive/2026-06-18-2026-06-18-workspace-client-path/requirements.md#FR-05
最近确认：686ca0f7e

## FR-unmapped-206 daemon-client 扫描派发（覆盖 D-003@v1）
变更：2026-06-18-2026-06-18-workspace-client-path
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 创建 daemon-client workspace daemon-client workspace 的 scan/scan-generate/reparse；When create 执行 触发；Then 跳过 `_ensure_spec_workspace` 本地 copytree（backend 读不到客户端路径） 判断 path_source，daemon-
全文：.sillyspec/changes/archive/2026-06-18-2026-06-18-workspace-client-path/requirements.md#FR-06
最近确认：686ca0f7e

## FR-unmapped-207 统一调度入口
变更：2026-06-19-agent-stage-dispatch-superseded
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-19-agent-stage-dispatch-superseded/requirements.md#FR-01
最近确认：98d3e56dd

## FR-unmapped-208 废弃子进程直跑路径
变更：2026-06-19-agent-stage-dispatch-superseded
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-19-agent-stage-dispatch-superseded/requirements.md#FR-02
最近确认：98d3e56dd

## FR-unmapped-209 CLAUDE.md 不被覆盖
变更：2026-06-19-agent-stage-dispatch-superseded
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-19-agent-stage-dispatch-superseded/requirements.md#FR-03
最近确认：98d3e56dd

## FR-unmapped-210 阶段配置完整
变更：2026-06-19-agent-stage-dispatch-superseded
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-19-agent-stage-dispatch-superseded/requirements.md#FR-04
最近确认：98d3e56dd

## FR-unmapped-211 AgentSpecBundle 含阶段上下文
变更：2026-06-19-agent-stage-dispatch-superseded
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-19-agent-stage-dispatch-superseded/requirements.md#FR-05
最近确认：98d3e56dd

## FR-unmapped-212 状态同步
变更：2026-06-19-agent-stage-dispatch-superseded
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-19-agent-stage-dispatch-superseded/requirements.md#FR-06
最近确认：98d3e56dd

## FR-unmapped-213 三字段边界
变更：2026-06-19-agent-stage-dispatch-superseded
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-19-agent-stage-dispatch-superseded/requirements.md#FR-07
最近确认：98d3e56dd

## FR-unmapped-214 工作目录正确
变更：2026-06-19-agent-stage-dispatch-superseded
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-19-agent-stage-dispatch-superseded/requirements.md#FR-08
最近确认：98d3e56dd

## FR-unmapped-215 Transition Response Model
变更：2026-06-19-agent-stage-dispatch-superseded
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-19-agent-stage-dispatch-superseded/requirements.md#FR-09
最近确认：98d3e56dd

## FR-unmapped-216 测试覆盖
变更：2026-06-19-agent-stage-dispatch-superseded
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-19-agent-stage-dispatch-superseded/requirements.md#FR-10
最近确认：98d3e56dd

## FR-unmapped-224 DaemonService facade 兼容，router.py 零改动
变更：2026-06-22-2026-06-22-daemon-service-split
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given `router.py` 的端点以 `svc = DaemonService(session)` 实例化并调用 `DaemonService` 的方法 任一 da；When 拆分完成，`DaemonService` 退化为持有 5 子 service 引用的 facade 拆分前后分别调用；Then `git diff backend/app/modules/daemon/router.py` 为空 HTTP 状态码、响应体、副作用（DB 写入 / Redi
全文：.sillyspec/changes/archive/2026-06-22-2026-06-22-daemon-service-split/requirements.md#FR-01
最近确认：7db5ab6b3

## FR-unmapped-225 51 方法按子域归位，5 子包分层
变更：2026-06-22-2026-06-22-daemon-service-split
状态：active
摘要：默认场景
依据决策：D-001@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given `DaemonService` 含 51 个方法，分布于 runtime/lease/run_sync/session/patch 五类（按操作主对象） 私有辅；When 按 design §6 文件变更清单归位 归位 统计各子域 service.py 行数；Then 每个方法存在于对应子域 `service.py`（RuntimeService/LeaseService/RunSyncService/SessionServi
全文：.sillyspec/changes/archive/2026-06-22-2026-06-22-daemon-service-split/requirements.md#FR-02
最近确认：7db5ab6b3

## FR-unmapped-226 DaemonLeaseService 原位保留，agent 跨模块调用不破
变更：2026-06-22-2026-06-22-daemon-service-split
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given `backend/app/modules/agent/service.py...:545` 执行 `from app.modules.daemon.lease_service import DaemonLe；When 拆分完成 迁移；Then import 成功；`cancel_lease` 行为不变；`lease_service.py` 文件未被移动/重命名/删除 迁入新 `lease/servic
全文：.sillyspec/changes/archive/2026-06-22-2026-06-22-daemon-service-split/requirements.md#FR-03
最近确认：7db5ab6b3

## FR-unmapped-227 生命周期契约不变（行为不变）
变更：2026-06-22-2026-06-22-daemon-service-split
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — When 拆分完成 拆分后运行；Then 状态转移、触发条件、关键字段、活动态/终态定义全部不变 全部通过（无逻辑变更导致的行为偏差）
全文：.sillyspec/changes/archive/2026-06-22-2026-06-22-daemon-service-split/requirements.md#FR-04
最近确认：7db5ab6b3

## FR-unmapped-228 异常类 re-export，import 路径兼容
变更：2026-06-22-2026-06-22-daemon-service-split
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given `backend/app/modules/daemon/router/__init__.py:55` 的 `from app.modules.daemon.service import (DaemonLeaseNotFound, D；When 异常类定义迁入各子包 execute 阶段以 `grep -rn "from app.modules.daemon.service import"` 全量收集
全文：.sillyspec/changes/archive/2026-06-22-2026-06-22-daemon-service-split/requirements.md#FR-05
最近确认：7db5ab6b3

## FR-unmapped-252 transport 全局配置开关
变更：2026-06-23-spec-transport-tar-sync
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — Given backend 未设置 `SPEC_TRANSPORT` env `SPEC_TRANSPORT=tar` `SPEC_TRANSPORT` 为非法值；When Settings 加载 Settings 加载 Settings 加载
全文：.sillyspec/changes/archive/2026-06-23-spec-transport-tar-sync/requirements.md#FR-01
最近确认：98d3e56dd

## FR-unmapped-253 shared 模式零改动（向后兼容）
变更：2026-06-23-spec-transport-tar-sync
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given `transport=shared`；When scan/stage dispatch；Then `build_claim_payload` 透传 spec_root（容器路径），prompt 用宿主路径
全文：.sillyspec/changes/archive/2026-06-23-spec-transport-tar-sync/requirements.md#FR-02
最近确认：98d3e56dd

## FR-unmapped-254 tar 模式 prompt 用 daemon 本地路径
变更：2026-06-23-spec-transport-tar-sync
状态：active
摘要：默认场景
依据决策：D-001@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given `transport=tar`；When `build_scan_bundle` / `start_stage_dispatch` 生成 prompt；Then `--spec-root = ~/.sillyhub/daemon/specs/{ws}`（`resolve_prompt_spec_root` helper）
全文：.sillyspec/changes/archive/2026-06-23-spec-transport-tar-sync/requirements.md#FR-03
最近确认：98d3e56dd

## FR-unmapped-255 tar 模式 build_claim_payload 透传 workspace_id + transport，不透传 spec_root
变更：2026-06-23-spec-transport-tar-sync
状态：active
摘要：默认场景
依据决策：D-007@v1
场景正文：
- 场景：默认场景 — Given `transport=tar` 且 interactive lease（scan/stage）；When `build_claim_payload`；Then 透传 `transport`/`transportMode` + `workspaceId`/`workspace_id`，**不 set**
全文：.sillyspec/changes/archive/2026-06-23-spec-transport-tar-sync/requirements.md#FR-04
最近确认：98d3e56dd

## FR-unmapped-256 tar 模式 interactive 路径 spec pull（session 开始）
变更：2026-06-23-spec-transport-tar-sync
状态：active
摘要：默认场景
依据决策：D-003@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given `transport=tar` 且 daemon 收到 interactive lease；When `_startInteractiveSession` 创建 session（driver 启动前）；Then 调 `spec-sync.pullSpecBundle(client, wsId)` 拉 backend spec bundle 解到
全文：.sillyspec/changes/archive/2026-06-23-spec-transport-tar-sync/requirements.md#FR-05
最近确认：98d3e56dd

## FR-unmapped-257 tar 模式 interactive 路径 postSpecSync（session 终态）
变更：2026-06-23-spec-transport-tar-sync
状态：active
摘要：默认场景
依据决策：D-003@v1、D-004@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given `transport=tar` 且 scan 所有 step 完成；When `onSessionEnd` 触发（session 终态）；Then 调 `spec-sync.postSpecSync` 打 tar 整树 → `POST /spec-workspace/sync`
全文：.sillyspec/changes/archive/2026-06-23-spec-transport-tar-sync/requirements.md#FR-06
最近确认：98d3e56dd

## FR-unmapped-258 backend apply_sync 接收 tar 回传（复用）
变更：2026-06-23-spec-transport-tar-sync
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given daemon `POST /spec-workspace/sync`（tar）；When `apply_sync(workspace_id, tar_bytes)`；Then 解 tar 覆盖 `/data/{ws}`（保留 `.runtime/`）+ reparse → ScanDocument 入库 +
全文：.sillyspec/changes/archive/2026-06-23-spec-transport-tar-sync/requirements.md#FR-07
最近确认：98d3e56dd

## FR-unmapped-259 过时测试断言修正
变更：2026-06-23-spec-transport-tar-sync
状态：active
摘要：默认场景
依据决策：D-006@v1
场景正文：
- 场景：默认场景 — Given `test_context_builder.py` 行 142/162；When 重写；Then tar 模式断言 prompt 含 `~/.sillyhub/daemon/specs/{ws}`，shared 模式含宿主路径；
全文：.sillyspec/changes/archive/2026-06-23-spec-transport-tar-sync/requirements.md#FR-08
最近确认：98d3e56dd

## FR-unmapped-260 后端 grace window(grace 内旧 token 重签、不误杀)
变更：2026-06-24-2026-06-24-concurrent-refresh-revoke
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — Given 用户已登录,有一 active session S1(refresh_token=T1);T1 被正常 rotate 产生 S2,`S2.rotated_at=；When 在 grace 窗口(`now - rotated_at < auth_refresh_grace_seconds`,默认 60s)内再次用 T1 调 `POS；Then 返回 200 + 全新 TokenPair;**不**触发 `revoke_all_user_sessions`;Sx 仍 active;新增一个 active
全文：.sillyspec/changes/archive/2026-06-24-2026-06-24-concurrent-refresh-revoke/requirements.md#FR-01
最近确认：29acb47ea

## FR-unmapped-261 Session.rotated_at 字段 + migration
变更：2026-06-24-2026-06-24-concurrent-refresh-revoke
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given `sessions` 表现状(无 rotated_at)；When 执行新 migration `202606241000_add_session_rotated_at`；Then 新增 `rotated_at TIMESTAMP WITH TIME ZONE NULL`;现有行 rotated_at 保持 NULL;`down_revis
全文：.sillyspec/changes/archive/2026-06-24-2026-06-24-concurrent-refresh-revoke/requirements.md#FR-02
最近确认：29acb47ea

## FR-unmapped-262 access token TTL 15min → 30min
变更：2026-06-24-2026-06-24-concurrent-refresh-revoke
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given `config.Settings` 默认值；When 调 `create_access_token` 签发；Then access token `exp = iat + 30min`;`/api/auth/refresh` 返回 `access_expires_in≈1800`
全文：.sillyspec/changes/archive/2026-06-24-2026-06-24-concurrent-refresh-revoke/requirements.md#FR-03
最近确认：29acb47ea

## FR-unmapped-263 前端单飞刷新锁
变更：2026-06-24-2026-06-24-concurrent-refresh-revoke
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 浏览器单 tab,N 个并发请求同时收到 401,store 内为同一 refreshToken；When 各自调用 `ensureFreshAccessToken()`；Then 仅发起 **1 次** `POST /api/auth/refresh`;所有调用共享同一结果;成功后 store 更新为新 token
全文：.sillyspec/changes/archive/2026-06-24-2026-06-24-concurrent-refresh-revoke/requirements.md#FR-04
最近确认：29acb47ea

## FR-unmapped-264 三处 401 刷新收口到单飞锁
变更：2026-06-24-2026-06-24-concurrent-refresh-revoke
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given `api.ts`(apiFetch 401 分支)、`ppm/export.ts`(downloadExcel 401 分支)、`auth.ts`(refres；When 任一处需要刷新；Then 统一调用 `ensureFreshAccessToken()`,删除各处内联的 fetch refresh;`/api/auth/*` 端点自身不触发刷新重试(
全文：.sillyspec/changes/archive/2026-06-24-2026-06-24-concurrent-refresh-revoke/requirements.md#FR-05
最近确认：29acb47ea

## FR-unmapped-265 AppShell 主动刷新定时器
变更：2026-06-24-2026-06-24-concurrent-refresh-revoke
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 用户处于登录态(accessToken 非空)；When AppShell 定时校验(每分钟)发现 `exp - now < (exp - iat)/3`(剩余 < 1/3 TTL)；Then 自动调 `ensureFreshAccessToken()` 续期;token 缺失/解析失败时静默跳过
全文：.sillyspec/changes/archive/2026-06-24-2026-06-24-concurrent-refresh-revoke/requirements.md#FR-06
最近确认：29acb47ea

## FR-unmapped-266 logout 调用点适配三元返回(Design Grill X-001)
变更：2026-06-24-2026-06-24-concurrent-refresh-revoke
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given `_consume_refresh_token` 返回值由二元组改为三元组 `(User, Session, is_grace)`；When `logout_session_by_refresh` 与 `refresh` 调用它；Then 两处解包正确(logout 用 `_, session, _`);logout 命中 grace 时幂等 revoke、**不签发新对**;`logout` 路
全文：.sillyspec/changes/archive/2026-06-24-2026-06-24-concurrent-refresh-revoke/requirements.md#FR-07
最近确认：29acb47ea

## FR-unmapped-272 平台管理员全局查看与操作资源
变更：2026-06-25-2026-06-25-admin-global-daemon-workspace-management
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 当前用户是平台管理员 当前用户是平台管理员 当前用户是平台管理员；When 访问 daemon runtime 分页列表 对非本人 runtime 执行别名更新、启用、禁用或删除 访问 workspace 列表；Then 返回全部用户的 runtime，并包含 owner 展示信息 后端允许操作，并沿用现有绑定 workspace 时删除返回 409 的保护 返回全部未删除 wo
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-admin-global-daemon-workspace-management/requirements.md#FR-01
最近确认：4389ebf90

## FR-unmapped-273 普通账号权限边界不扩大
变更：2026-06-25-2026-06-25-admin-global-daemon-workspace-management
状态：active
摘要：默认场景
依据决策：D-001@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given 当前用户不是平台管理员 当前用户不是平台管理员；When 查询 daemon runtime 分页列表 查询 workspace 列表并传入其他人的 `user_id`；Then 只返回该用户自己的 runtime 仍只返回该用户已有 `workspace:read` 权限的 workspace
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-admin-global-daemon-workspace-management/requirements.md#FR-02
最近确认：4389ebf90

## FR-unmapped-274 两类资源支持独立别名
变更：2026-06-25-2026-06-25-admin-global-daemon-workspace-management
状态：active
摘要：默认场景
依据决策：D-002@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given runtime 或 workspace 尚未设置 `display_alias` 用户在卡片中保存新的别名；When 前端渲染卡片标题 PATCH 对应资源的 `display_alias`；Then 标题回退到原始 `name`、`slug` 或 `provider` 后端持久化别名，列表刷新后标题优先显示该别名，原始名称仍在副标题展示
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-admin-global-daemon-workspace-management/requirements.md#FR-03
最近确认：4389ebf90

## FR-unmapped-275 服务端筛选与分页
变更：2026-06-25-2026-06-25-admin-global-daemon-workspace-management
状态：active
摘要：默认场景
依据决策：D-003@v1、D-005@v1
场景正文：
- 场景：默认场景 — Given 调用方传入 `q` 调用方传入 `type` 和 `status` 调用方传入 `limit` 和 `offset` 请求 `GET /api/daemon/r；When 查询 runtime 或 workspace 列表 查询 runtime 或 workspace 列表 查询 runtime 或 workspace 列表 Fa；Then 后端在 `display_alias`、原始名称和关键标识字段中做大小写不敏感匹配 后端按 provider/path_source/type 和 status
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-admin-global-daemon-workspace-management/requirements.md#FR-04
最近确认：4389ebf90

## FR-unmapped-276 两页卡片与分页 UI 统一
变更：2026-06-25-2026-06-25-admin-global-daemon-workspace-management
状态：active
摘要：默认场景
依据决策：D-003@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given 用户打开 `/runtimes` 或 `/workspaces` 当前用户是平台管理员 当前用户不是平台管理员；When 数据加载成功 页面渲染筛选条 页面渲染筛选条；Then 页面展示筛选条、摘要统计、卡片网格和分页器 展示人员筛选控件，并可通过 `lib-admin.listUsers` 搜索用户 不展示人员筛选控件
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-admin-global-daemon-workspace-management/requirements.md#FR-05
最近确认：4389ebf90

## FR-unmapped-277 兼容旧调用
变更：2026-06-25-2026-06-25-admin-global-daemon-workspace-management
状态：active
摘要：默认场景
依据决策：D-001@v1、D-005@v1
场景正文：
- 场景：默认场景 — Given 现有前端组件调用 `listDaemonRuntimes()` 现有调用不传 workspace 筛选参数；When 请求 `GET /api/daemon/runtimes` 请求 `GET /api/workspaces`；Then 响应仍为 `DaemonRuntimeRead[]` 响应结构仍为 `{ items, total }`，默认行为保持兼容
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-admin-global-daemon-workspace-management/requirements.md#FR-06
最近确认：4389ebf90

## FR-unmapped-314 变更中心移除生命周期流程图
变更：2026-07-02-2026-07-02-change-detail-file-tree-editor
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 变更中心列表页；When 用户打开 `/workspaces/{id}/changes`；Then 不再渲染「变更生命周期」SectionCard（扫描→…→归档）；列表/分页/搜索/新建/重新扫描均正常
全文：.sillyspec/changes/archive/2026-07-02-2026-07-02-change-detail-file-tree-editor/requirements.md#FR-01
最近确认：3849dbf33

## FR-unmapped-315 变更详情移除文档完整性面板 + DOC_TABS 查看器
变更：2026-07-02-2026-07-02-change-detail-file-tree-editor
状态：active
摘要：默认场景
依据决策：D-008@v1
场景正文：
- 场景：默认场景 — Given 变更详情页；When 用户打开 `/workspaces/{id}/changes/{cid}`；Then 不再渲染「变更文档完整性」section（828-914）与 DOC_TABS 只读查看器（916-993）；关联前端死代码（DOC_TABS/DOC_LABE
全文：.sillyspec/changes/archive/2026-07-02-2026-07-02-change-detail-file-tree-editor/requirements.md#FR-02
最近确认：3849dbf33

## FR-unmapped-316 文件树展示变更目录全部文件
变更：2026-07-02-2026-07-02-change-detail-file-tree-editor
状态：active
摘要：默认场景
依据决策：D-006@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given 变更详情页已加载 daemon-client 工作区 server-local 工作区；When 调用 `GET /changes/{cid}/files`；Then 返回该变更目录下递归全部文件清单 `[{path, name, size, last_modified_at, is_text}]`（path 相对变更目录，排
全文：.sillyspec/changes/archive/2026-07-02-2026-07-02-change-detail-file-tree-editor/requirements.md#FR-03
最近确认：3849dbf33

## FR-unmapped-317 读取单文件内容
变更：2026-07-02-2026-07-02-change-detail-file-tree-editor
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 文件树选中某文件 path 含 `../` 或绝对路径或符号链接越界；When 调用 `GET /changes/{cid}/files/content?path=<rel>`；Then 返回 `{path, content, exists}`，content ≤ 1MB 截断 返回 4xx（路径穿越守卫）
全文：.sillyspec/changes/archive/2026-07-02-2026-07-02-change-detail-file-tree-editor/requirements.md#FR-04
最近确认：3849dbf33

## FR-unmapped-318 编辑保存（path_source 分流）
变更：2026-07-02-2026-07-02-change-detail-file-tree-editor
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1、D-004@v1、D-006@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given 用户编辑文本文件（is_text=true） server-local 工作区 daemon-client 工作区 二进制文件（is_text=false）；When 调用 `POST /changes/{cid}/files/content` body `{path, content}`；Then path resolve 后必须落在变更目录内（否则 4xx），content ≤ 1MB（否则 4xx） `write_text` 到 `{root_path
全文：.sillyspec/changes/archive/2026-07-02-2026-07-02-change-detail-file-tree-editor/requirements.md#FR-05
最近确认：3849dbf33

## FR-unmapped-319 离线续传
变更：2026-07-02-2026-07-02-change-detail-file-tree-editor
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — Given daemon-client 工作区且 daemon 离线 同文件多次保存（daemon 仍离线）；When 用户保存；Then pending 行保持 pending（不翻 failed），daemon 重连后轮询 claim→写本机→complete 合并为单条 pending 行（更
全文：.sillyspec/changes/archive/2026-07-02-2026-07-02-change-detail-file-tree-editor/requirements.md#FR-06
最近确认：3849dbf33

## FR-unmapped-320 保存后 per-change resync
变更：2026-07-02-2026-07-02-change-detail-file-tree-editor
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given 写回成功（server-local 写盘 / daemon-client 镜像直写） daemon 回执 complete；When POST 返回前；Then 调用 `_resync_change_docs`：复用 `_parse_change` + `_sync_docs` 刷新 ChangeDocument 行 +
全文：.sillyspec/changes/archive/2026-07-02-2026-07-02-change-detail-file-tree-editor/requirements.md#FR-07
最近确认：3849dbf33

## FR-unmapped-321 待写回状态查询
变更：2026-07-02-2026-07-02-change-detail-file-tree-editor
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 文件树加载 / 保存后轮询；When 调用 `GET /changes/{cid}/files/pending`；Then 返回该变更 pending/claimed 的 DaemonChangeWrite 行 `[{path, status, created_at}]`（建议 ki
全文：.sillyspec/changes/archive/2026-07-02-2026-07-02-change-detail-file-tree-editor/requirements.md#FR-08
最近确认：3849dbf33

## FR-unmapped-322 前端文件树 + 编辑器 + 状态机
变更：2026-07-02-2026-07-02-change-detail-file-tree-editor
状态：active
摘要：默认场景
依据决策：D-003@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given 变更详情页 保存动作 文件有待回写 pending 行；When 渲染文件树；Then 左树（复用 scan-docs TreeView 范式）+ 右内容区双栏；文本文件→可编辑 textarea + 保存按钮 + 放弃修改；二进制→只读 状态机流
全文：.sillyspec/changes/archive/2026-07-02-2026-07-02-change-detail-file-tree-editor/requirements.md#FR-09
最近确认：3849dbf33

## FR-unmapped-332 AgentRunLog 加 tool_kind 结构化列
变更：2026-07-05-2026-07-05-agent-log-type-tags
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-05-2026-07-05-agent-log-type-tags/requirements.md#FR-01
最近确认：3849dbf33

## FR-unmapped-333 classify_tool_kind 识别函数（Python + TS 同逻辑）
变更：2026-07-05-2026-07-05-agent-log-type-tags
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-05-2026-07-05-agent-log-type-tags/requirements.md#FR-02
最近确认：3849dbf33

## FR-unmapped-334 daemon task-runner tool_use 分支打标（batch 路径）
变更：2026-07-05-2026-07-05-agent-log-type-tags
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-05-2026-07-05-agent-log-type-tags/requirements.md#FR-03
最近确认：3849dbf33

## FR-unmapped-335 backend _extract_sdk_messages interactive 打标
变更：2026-07-05-2026-07-05-agent-log-type-tags
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-05-2026-07-05-agent-log-type-tags/requirements.md#FR-04
最近确认：3849dbf33

## FR-unmapped-336 backend submit_messages batch 兜底
变更：2026-07-05-2026-07-05-agent-log-type-tags
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-05-2026-07-05-agent-log-type-tags/requirements.md#FR-05
最近确认：3849dbf33

## FR-unmapped-337 publish payload 两处带 tool_kind（SSE 实时流）
变更：2026-07-05-2026-07-05-agent-log-type-tags
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-05-2026-07-05-agent-log-type-tags/requirements.md#FR-06
最近确认：3849dbf33

## FR-unmapped-338 GET /logs 加 ?tool_kind= 筛选
变更：2026-07-05-2026-07-05-agent-log-type-tags
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-05-2026-07-05-agent-log-type-tags/requirements.md#FR-07
最近确认：3849dbf33

## FR-unmapped-339 前端 AgentRunLogEntry 加 tool_kind 字段
变更：2026-07-05-2026-07-05-agent-log-type-tags
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-05-2026-07-05-agent-log-type-tags/requirements.md#FR-08
最近确认：3849dbf33

## FR-unmapped-340 toolKindMeta 徽标映射
变更：2026-07-05-2026-07-05-agent-log-type-tags
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-05-2026-07-05-agent-log-type-tags/requirements.md#FR-09
最近确认：3849dbf33

## FR-unmapped-341 agent-log-viewer 第二层筛选按钮组（多选）
变更：2026-07-05-2026-07-05-agent-log-type-tags
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-05-2026-07-05-agent-log-type-tags/requirements.md#FR-10
最近确认：3849dbf33

## FR-unmapped-342 工具徽标渲染（含旧日志兼容）
变更：2026-07-05-2026-07-05-agent-log-type-tags
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-05-2026-07-05-agent-log-type-tags/requirements.md#FR-11
最近确认：3849dbf33

## FR-unmapped-348 AgentSession 持久化变更/工作空间绑定
变更：2026-07-09-2026-07-09-change-detail-session
状态：active
摘要：默认场景
依据决策：D-001@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given 一条交互会话在创建时携带 `change_id` 与 `workspace_id` 创建会话时未携带 `change_id`/`workspace_id`（ru；When `create_session` 写入 `AgentSession` `create_session` 执行；Then `AgentSession.change_id` / `workspace_id` 被持久化（可空）；`workspace_id` 非空时 `cwd` 写入该工
全文：.sillyspec/changes/archive/2026-07-09-2026-07-09-change-detail-session/requirements.md#FR-01
最近确认：af41fac1d

## FR-unmapped-349 创建端点接收变更/工作空间字段
变更：2026-07-09-2026-07-09-change-detail-session
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 前端调用 `POST /api/daemon/sessions`；When 请求体含可选 `change_id`/`workspace_id`；Then 后端接收并透传给 `create_session`；`AgentSessionRead` 响应回显这两字段。
全文：.sillyspec/changes/archive/2026-07-09-2026-07-09-change-detail-session/requirements.md#FR-02
最近确认：af41fac1d

## FR-unmapped-350 自动注入变更上下文前导
变更：2026-07-09-2026-07-09-change-detail-session
状态：active
摘要：默认场景
依据决策：D-003@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given 会话绑定 `change_id` 会话未绑定 `change_id`；When 创建会话首轮 dispatch 创建会话；Then daemon 收到的 dispatch prompt = `【变更上下文】前导 + 用户消息`；前导含变更标题、当前阶段、工作目录、变更文档路径（design/
全文：.sillyspec/changes/archive/2026-07-09-2026-07-09-change-detail-session/requirements.md#FR-03
最近确认：af41fac1d

## FR-unmapped-351 变更级会话列表
变更：2026-07-09-2026-07-09-change-detail-session
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given 工作空间成员访问变更详情页；When 调用 `GET /api/workspaces/{wid}/changes/{cid}/sessions`；Then 返回该变更下全部会话（跨成员，不过滤 user_id），按 `last_active_at` desc；每条含 `id/provider/status/turn
全文：.sillyspec/changes/archive/2026-07-09-2026-07-09-change-detail-session/requirements.md#FR-04
最近确认：af41fac1d

## FR-unmapped-352 变更详情页内嵌会话区块
变更：2026-07-09-2026-07-09-change-detail-session
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 用户进入变更详情页 用户切换历史会话；When 页面渲染 点击某条历史会话；Then 在「Agent 执行日志」区块之后出现「会话」区块：左侧该变更会话历史列表 + 「新建会话」按钮，右侧复用 `InteractiveSessionPanel`（
全文：.sillyspec/changes/archive/2026-07-09-2026-07-09-change-detail-session/requirements.md#FR-05
最近确认：af41fac1d

## FR-unmapped-359 AgentSession 持久化变更/工作空间绑定
变更：2026-07-09-change-detail-session
状态：active
摘要：默认场景
依据决策：D-001@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given 一条交互会话在创建时携带 `change_id` 与 `workspace_id` 创建会话时未携带 `change_id`/`workspace_id`（ru；When `create_session` 写入 `AgentSession` `create_session` 执行；Then `AgentSession.change_id` / `workspace_id` 被持久化（可空）；`workspace_id` 非空时 `cwd` 写入该工
全文：.sillyspec/changes/archive/2026-07-09-change-detail-session/requirements.md#FR-01
最近确认：af41fac1d

## FR-unmapped-360 创建端点接收变更/工作空间字段
变更：2026-07-09-change-detail-session
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 前端调用 `POST /api/daemon/sessions`；When 请求体含可选 `change_id`/`workspace_id`；Then 后端接收并透传给 `create_session`；`AgentSessionRead` 响应回显这两字段。
全文：.sillyspec/changes/archive/2026-07-09-change-detail-session/requirements.md#FR-02
最近确认：af41fac1d

## FR-unmapped-361 自动注入变更上下文前导
变更：2026-07-09-change-detail-session
状态：active
摘要：默认场景
依据决策：D-003@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given 会话绑定 `change_id` 会话未绑定 `change_id`；When 创建会话首轮 dispatch 创建会话；Then daemon 收到的 dispatch prompt = `【变更上下文】前导 + 用户消息`；前导含变更标题、当前阶段、工作目录、变更文档路径（design/
全文：.sillyspec/changes/archive/2026-07-09-change-detail-session/requirements.md#FR-03
最近确认：af41fac1d

## FR-unmapped-362 变更级会话列表
变更：2026-07-09-change-detail-session
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given 工作空间成员访问变更详情页；When 调用 `GET /api/workspaces/{wid}/changes/{cid}/sessions`；Then 返回该变更下全部会话（跨成员，不过滤 user_id），按 `last_active_at` desc；每条含 `id/provider/status/turn
全文：.sillyspec/changes/archive/2026-07-09-change-detail-session/requirements.md#FR-04
最近确认：af41fac1d

## FR-unmapped-363 变更详情页内嵌会话区块
变更：2026-07-09-change-detail-session
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 用户进入变更详情页 用户切换历史会话；When 页面渲染 点击某条历史会话；Then 在「Agent 执行日志」区块之后出现「会话」区块：左侧该变更会话历史列表 + 「新建会话」按钮，右侧复用 `InteractiveSessionPanel`（
全文：.sillyspec/changes/archive/2026-07-09-change-detail-session/requirements.md#FR-05
最近确认：af41fac1d

## FR-unmapped-364 删除 archive 死代码 + 补 status 投影
变更：2026-07-11-2026-07-11-daemon-client-container-overreach
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-11-2026-07-11-daemon-client-container-overreach/requirements.md#FR-1
最近确认：af41fac1d

## FR-unmapped-365 change_dir 删死路径
变更：2026-07-11-2026-07-11-daemon-client-container-overreach
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-11-2026-07-11-daemon-client-container-overreach/requirements.md#FR-2
最近确认：af41fac1d

## FR-unmapped-366 scanner/parser 扁平布局修复
变更：2026-07-11-2026-07-11-daemon-client-container-overreach
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-11-2026-07-11-daemon-client-container-overreach/requirements.md#FR-3
最近确认：af41fac1d

## FR-unmapped-375 per-worker 独立 worktree 创建
变更：2026-07-12-2026-07-12-worker-worktree-isolation
状态：active
摘要：（无场景名）
依据决策：D-001@v1、D-006@v1
全文：.sillyspec/changes/archive/2026-07-12-2026-07-12-worker-worktree-isolation/requirements.md#FR-01
最近确认：af41fac1d

## FR-unmapped-376 worker 在副本内写+commit（root_path 改向副本）
变更：2026-07-12-2026-07-12-worker-worktree-isolation
状态：active
摘要：（无场景名）
依据决策：D-002@v1、D-003@v1
全文：.sillyspec/changes/archive/2026-07-12-2026-07-12-worker-worktree-isolation/requirements.md#FR-02
最近确认：af41fac1d

## FR-unmapped-377 converge 分支合并
变更：2026-07-12-2026-07-12-worker-worktree-isolation
状态：active
摘要：（无场景名）
依据决策：D-003@v1、D-006@v1
全文：.sillyspec/changes/archive/2026-07-12-2026-07-12-worker-worktree-isolation/requirements.md#FR-03
最近确认：af41fac1d

## FR-unmapped-378 冲突主 agent 自动解决（converge_mission 可重入）
变更：2026-07-12-2026-07-12-worker-worktree-isolation
状态：active
摘要：（无场景名）
依据决策：D-004@v1
全文：.sillyspec/changes/archive/2026-07-12-2026-07-12-worker-worktree-isolation/requirements.md#FR-04
最近确认：af41fac1d

## FR-unmapped-379 合并后清理 + patch 采集
变更：2026-07-12-2026-07-12-worker-worktree-isolation
状态：active
摘要：（无场景名）
依据决策：D-005@v1
全文：.sillyspec/changes/archive/2026-07-12-2026-07-12-worker-worktree-isolation/requirements.md#FR-05
最近确认：af41fac1d

## FR-unmapped-380 worker 副本 git identity（X-002）
变更：2026-07-12-2026-07-12-worker-worktree-isolation
状态：active
摘要：（无场景名）
依据决策：D-008@v1
全文：.sillyspec/changes/archive/2026-07-12-2026-07-12-worker-worktree-isolation/requirements.md#FR-06
最近确认：af41fac1d

## FR-unmapped-393 明细变完成时自动创建关联任务
变更：2026-07-15-2026-07-15-milestone-detail-auto-task
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given 一条里程碑明细 `execute_user_id` 已填写 明细 `execute_user_id` 为空；Then 系统创建一条 `PlanTask`，字段按 D-002 映射（user_id←execute_user_id、content←task_theme、start/
全文：.sillyspec/changes/archive/2026-07-15-2026-07-15-milestone-detail-auto-task/requirements.md#FR-01
最近确认：43f3d65dc

## FR-unmapped-394 Excel 导入即完成的明细批量建任务
变更：2026-07-15-2026-07-15-milestone-detail-auto-task
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given import_commit 中某行必填字段齐全（required_filled=true → 落 done） 导入行必填缺失（→ draft）或 valid=f；When 导入提交 导入提交 异常冒泡；Then 为每个 done 明细各建一条任务（按 FR-01 映射），与明细入库在同一事务内 该行不建任务（draft 明细不触发） 整批导入（明细 + 任务）回滚，无脏
全文：.sillyspec/changes/archive/2026-07-15-2026-07-15-milestone-detail-auto-task/requirements.md#FR-02
最近确认：43f3d65dc

## FR-unmapped-395 编辑已完成明细同步更新关联任务
变更：2026-07-15-2026-07-15-milestone-detail-auto-task
状态：active
摘要：默认场景
依据决策：D-002@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given 一条明细已有 `ps_plan_node_detail_id` 关联任务 明细无关联任务（如 draft 明细被编辑）；When `update_detail` 修改了执行人 / 计划开始 / 计划完成 / 任务主题 / 工作量 / 所属模块 `update_detail`；Then 关联任务对应字段同步更新；`task.status` **不**被覆盖（保留任务自身推进） 不新建任务（仅变 done 才建）
全文：.sillyspec/changes/archive/2026-07-15-2026-07-15-milestone-detail-auto-task/requirements.md#FR-03
最近确认：43f3d65dc

## FR-unmapped-396 明细变更时任务迁移到新版本
变更：2026-07-15-2026-07-15-milestone-detail-auto-task
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 一条 done 明细已有任务 变更后的新版本 draft 随后被提交变 done；When `change_process`（旧 done→archived + 新建 draft 版本） `_transition`→DONE；Then 关联任务的 `ps_plan_node_detail_id` 迁移到新版本 draft.id（同事务） 命中已迁移的任务并更新字段（不新建第二条）
全文：.sillyspec/changes/archive/2026-07-15-2026-07-15-milestone-detail-auto-task/requirements.md#FR-04
最近确认：43f3d65dc

## FR-unmapped-397 删除明细解关联、保留任务
变更：2026-07-15-2026-07-15-milestone-detail-auto-task
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 一条明细有关联任务；When `delete_detail`；Then 关联任务 `ps_plan_node_detail_id` 置 null，任务行及其执行/工时记录保留
全文：.sillyspec/changes/archive/2026-07-15-2026-07-15-milestone-detail-auto-task/requirements.md#FR-05
最近确认：43f3d65dc

## FR-unmapped-398 强一致事务
变更：2026-07-15-2026-07-15-milestone-detail-auto-task
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 联动任一步（建/同步/迁移/解关联）失败；When 异常冒泡；Then 明细操作整体回滚（明细与任务同事务，要么都成功要么都回滚）
全文：.sillyspec/changes/archive/2026-07-15-2026-07-15-milestone-detail-auto-task/requirements.md#FR-06
最近确认：43f3d65dc

## FR-unmapped-399 历史数据不补建
变更：2026-07-15-2026-07-15-milestone-detail-auto-task
状态：active
摘要：默认场景
依据决策：D-006@v1
场景正文：
- 场景：默认场景 — Given 上线前已存在的 done 明细；When 无新的提交/编辑/变更/删除/导入操作；Then 不产生任何任务（联动仅在实时触发时生效，无回填脚本）
全文：.sillyspec/changes/archive/2026-07-15-2026-07-15-milestone-detail-auto-task/requirements.md#FR-07
最近确认：43f3d65dc

## FR-unmapped-408 左点负载按今天分界 — 过去看实际工时
变更：2026-07-15-workbench-calendar-load-actual
状态：active
摘要：（无场景名）
依据决策：D-001@v1、D-002@v1、D-004@v1、D-005@v1、D-006@v1
全文：.sillyspec/changes/archive/2026-07-15-workbench-calendar-load-actual/requirements.md#FR-01
最近确认：f7f73d86c

## FR-unmapped-409 过去无实际记录 → 灰点
变更：2026-07-15-workbench-calendar-load-actual
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-15-workbench-calendar-load-actual/requirements.md#FR-02
最近确认：f7f73d86c

## FR-unmapped-410 未来侧剩余负载
变更：2026-07-15-workbench-calendar-load-actual
状态：active
摘要：（无场景名）
依据决策：D-006@v1、D-007@v1
全文：.sillyspec/changes/archive/2026-07-15-workbench-calendar-load-actual/requirements.md#FR-03
最近确认：f7f73d86c

## FR-unmapped-411 已用 ≥ 计划总量 → 剩余 0
变更：2026-07-15-workbench-calendar-load-actual
状态：active
摘要：（无场景名）
依据决策：D-007@v1
全文：.sillyspec/changes/archive/2026-07-15-workbench-calendar-load-actual/requirements.md#FR-04
最近确认：f7f73d86c

## FR-unmapped-412 右点零回归
变更：2026-07-15-workbench-calendar-load-actual
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-15-workbench-calendar-load-actual/requirements.md#FR-05
最近确认：f7f73d86c

## FR-unmapped-413 actual 区间缺失兜底
变更：2026-07-15-workbench-calendar-load-actual
状态：active
摘要：（无场景名）
依据决策：D-003@v1
全文：.sillyspec/changes/archive/2026-07-15-workbench-calendar-load-actual/requirements.md#FR-06
最近确认：f7f73d86c

## FR-unmapped-414 未来侧兜底（无 work_load / 无 end_time）
变更：2026-07-15-workbench-calendar-load-actual
状态：active
摘要：（无场景名）
依据决策：D-007@v1
全文：.sillyspec/changes/archive/2026-07-15-workbench-calendar-load-actual/requirements.md#FR-07
最近确认：f7f73d86c

## FR-unmapped-415 前端图例口径说明
变更：2026-07-15-workbench-calendar-load-actual
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-15-workbench-calendar-load-actual/requirements.md#FR-08
最近确认：f7f73d86c

## FR-unmapped-425 TaskExecute 支持 file_urls 字段
变更：2026-07-22-2026-07-22-task-execute-attachments
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given `ppm_task_execute` 表；When migration 升级；Then 表新增 `file_urls` JSON 列（`nullable=False`, `server_default='[]'`），旧记录 `file_urls=[
全文：.sillyspec/changes/archive/2026-07-22-2026-07-22-task-execute-attachments/requirements.md#FR-01
最近确认：ce86a8f49

## FR-unmapped-426 计划任务执行填报上传附件（按天）
变更：2026-07-22-2026-07-22-task-execute-attachments
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v1、D-005@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given 进行中的计划任务，打开 `task-detail-modal` execute 模式，有 in-flight 记录；When 用户在填报区某天上传附件 + 填耗时/说明 + 提交；Then 当天附件 id 存入对应 `TaskExecute.file_urls`；重开时首天已上传附件回填预填；不传 file_urls 时保留原值不清空
全文：.sillyspec/changes/archive/2026-07-22-2026-07-22-task-execute-attachments/requirements.md#FR-02
最近确认：ce86a8f49

## FR-unmapped-427 问题执行填报上传附件（按天）
变更：2026-07-22-2026-07-22-task-execute-attachments
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v1、D-005@v1、D-006@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given 进行中的问题，打开 `problem-detail-modal` execute 模式，有 in-flight 记录；When 用户填报区上传附件 + 提交；Then `file_urls` 经 `problem/router.py` 拆包（`file_urls=body.file_urls`）→ `execute_probl
全文：.sillyspec/changes/archive/2026-07-22-2026-07-22-task-execute-attachments/requirements.md#FR-03
最近确认：ce86a8f49

## FR-unmapped-428 执行记录表回显附件
变更：2026-07-22-2026-07-22-task-execute-attachments
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 执行记录表（task/problem-detail-modal）；When 记录有 `file_urls`；Then 附件列行内 `FileViewer` 显示（图片缩略图点击预览 / 文件图标点击下载）；无附件显示空
全文：.sillyspec/changes/archive/2026-07-22-2026-07-22-task-execute-attachments/requirements.md#FR-04
最近确认：ce86a8f49

## FR-unmapped-429 跨天填报每天各自附件
变更：2026-07-22-2026-07-22-task-execute-attachments
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 跨天填报（多天 DetailDay）；When 每天各自上传附件 + 提交；Then 每天的 `executePlanTask`/`executeProblem` 携带当天 `file_urls`，各自落独立 `TaskExecute` 记录
全文：.sillyspec/changes/archive/2026-07-22-2026-07-22-task-execute-attachments/requirements.md#FR-05
最近确认：ce86a8f49

## FR-unmapped-430 daemon 共享标记（lender）
变更：2026-07-26-2026-07-25-daemon-borrow-for-business
状态：active
摘要：默认场景
依据决策：D-003@v1、D-005@v1
场景正文：
- 场景：默认场景 — Given 开发人员是某工作空间成员且已绑定自己的 daemon shared 已为 true；When 开发人员调用 `PUT /workspaces/{ws}/my-binding/shared {shared:true}` lender 设 `shared=f；Then 该 binding 行 `shared=True`，可被同工作空间业务人员借用 共享撤销，借用查询不再命中该 daemon
全文：.sillyspec/changes/archive/2026-07-26-2026-07-25-daemon-borrow-for-business/requirements.md#FR-01
最近确认：f608584d8

## FR-unmapped-431 owner 管理共享 daemon
变更：2026-07-26-2026-07-25-daemon-borrow-for-business
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 工作空间存在共享 daemon；When owner 调用 `GET /workspaces/{ws}/shared-daemons` owner 撤销某共享；Then 返回所有 shared daemon 列表（含 lender、在线状态、可撤销） 对应 binding `shared=false`
全文：.sillyspec/changes/archive/2026-07-26-2026-07-25-daemon-borrow-for-business/requirements.md#FR-02
最近确认：f608584d8

## FR-unmapped-432 业务人员借用权限 + 端点鉴权
变更：2026-07-26-2026-07-25-daemon-borrow-for-business
状态：active
摘要：默认场景
依据决策：D-001@v1、D-006@v2
场景正文：
- 场景：默认场景 — Given owner 把某用户加为 business_member 角色（`task:run_agent` + `daemon:borrow` + workspace 读；When 该用户（无自有 daemon）触发 agent run 触发 agent run 且无自有 daemon；Then 端点鉴权通过（`task:run_agent`），placement 发现无自有 daemon → 回退借用查询（需 `daemon:borrow`） 报"工作
全文：.sillyspec/changes/archive/2026-07-26-2026-07-25-daemon-borrow-for-business/requirements.md#FR-03
最近确认：f608584d8

## FR-unmapped-433 借用派发回退（4 路一致）
变更：2026-07-26-2026-07-25-daemon-borrow-for-business
状态：active
摘要：默认场景
依据决策：D-002@v1、D-008@v1
场景正文：
- 场景：默认场景 — Given actor 是 business_member，工作空间有 shared+online 的 daemon 工作空间无 shared 或全离线；When actor 触发 agent run（任意 SillySpec 阶段 / quick-chat） actor 触发借用；Then 4 路 resolver（`_resolve_dispatch_runtime` / `_resolve_decide_runtime` / `resolve_
全文：.sillyspec/changes/archive/2026-07-26-2026-07-25-daemon-borrow-for-business/requirements.md#FR-04
最近确认：f608584d8

## FR-unmapped-434 daemon 沙箱只读隔离
变更：2026-07-26-2026-07-25-daemon-borrow-for-business
状态：active
摘要：默认场景
依据决策：D-007@v2
场景正文：
- 场景：默认场景 — Given 借用 lease 派发到 lender daemon 借用 agent 尝试写 lender 代码区；When daemon 起 agent 进程；Then cwd=独立 sandbox（slug=`borrow-<actor>-<run>`），写策略按 lease 隔离只读 root_path，不命中 lender
全文：.sillyspec/changes/archive/2026-07-26-2026-07-25-daemon-borrow-for-business/requirements.md#FR-05
最近确认：f608584d8

## FR-unmapped-435 方案落文件中心
变更：2026-07-26-2026-07-25-daemon-borrow-for-business
状态：active
摘要：默认场景
依据决策：D-001@v1、D-009@v1、D-010@v1
场景正文：
- 场景：默认场景 — Given 借用 agent run 完成（`close_interactive_run` / `complete_lease` 回调）；When backend 拿到方案文本；Then 调 `FileService.upload_file` 落 file（`owner_type=workspace`, `uploaded_by=borrower
全文：.sillyspec/changes/archive/2026-07-26-2026-07-25-daemon-borrow-for-business/requirements.md#FR-06
最近确认：f608584d8

## FR-unmapped-436 借用审计
变更：2026-07-26-2026-07-25-daemon-borrow-for-business
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 每次借用发生；When lease 创建/完成；Then 写 `daemon_borrow_audit`（borrower / lender / daemon / workspace / agent_run / bor
全文：.sillyspec/changes/archive/2026-07-26-2026-07-25-daemon-borrow-for-business/requirements.md#FR-07
最近确认：f608584d8

## FR-unmapped-460 proxy-create 不再 500（消除 changes 表并发）
变更：2026-08-02-proxy-create-race-fix
状态：active
摘要：（无场景名）
依据决策：D-001@v2、D-006@v1
全文：.sillyspec/changes/archive/2026-08-02-proxy-create-race-fix/requirements.md#FR-01
最近确认：d089b492d

## FR-unmapped-461 change_documents 表无并发撞键（消除 docs 同源竞态）
变更：2026-08-02-proxy-create-race-fix
状态：active
摘要：（无场景名）
依据决策：D-001@v2、D-006@v1
全文：.sillyspec/changes/archive/2026-08-02-proxy-create-race-fix/requirements.md#FR-02
最近确认：d089b492d

## FR-unmapped-462 proxy 状态权威（owner_id 守卫）
变更：2026-08-02-proxy-create-race-fix
状态：active
摘要：（无场景名）
依据决策：D-002@v1
全文：.sillyspec/changes/archive/2026-08-02-proxy-create-race-fix/requirements.md#FR-03
最近确认：d089b492d

## FR-unmapped-463 极端并发撞键兜底
变更：2026-08-02-proxy-create-race-fix
状态：active
摘要：（无场景名）
依据决策：D-004@v1
全文：.sillyspec/changes/archive/2026-08-02-proxy-create-race-fix/requirements.md#FR-04
最近确认：d089b492d

## FR-unmapped-464 失败回滚
变更：2026-08-02-proxy-create-race-fix
状态：active
摘要：（无场景名）
依据决策：D-005@v1
全文：.sillyspec/changes/archive/2026-08-02-proxy-create-race-fix/requirements.md#FR-05
最近确认：d089b492d

## FR-unmapped-465 中文标题 change_key 可读
变更：2026-08-02-proxy-create-race-fix
状态：active
摘要：（无场景名）
依据决策：D-003@v1
全文：.sillyspec/changes/archive/2026-08-02-proxy-create-race-fix/requirements.md#FR-06
最近确认：d089b492d

## FR-unmapped-489 三端点路径契约（D-001）
变更：2026-08-10-sillyhub-platform-sync
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-10-sillyhub-platform-sync/requirements.md#FR-01
最近确认：9f7e0732f

## FR-unmapped-490 Bearer 鉴权（D-002）
变更：2026-08-10-sillyhub-platform-sync
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-10-sillyhub-platform-sync/requirements.md#FR-02
最近确认：9f7e0732f

## FR-unmapped-491 platform_change_progress 存储（D-003）
变更：2026-08-10-sillyhub-platform-sync
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-10-sillyhub-platform-sync/requirements.md#FR-03
最近确认：9f7e0732f

## FR-unmapped-492 base_ts 冲突检测算法（D-004 / 契约 §4.2）
变更：2026-08-10-sillyhub-platform-sync
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-10-sillyhub-platform-sync/requirements.md#FR-04
最近确认：9f7e0732f

## FR-unmapped-493 元字段走 HTTP header（D-005 / 契约 §4.1）
变更：2026-08-10-sillyhub-platform-sync
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-10-sillyhub-platform-sync/requirements.md#FR-05
最近确认：9f7e0732f

## FR-unmapped-494 冲突不 auto-merge（D-006 / 契约 §9）
变更：2026-08-10-sillyhub-platform-sync
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-10-sillyhub-platform-sync/requirements.md#FR-06
最近确认：9f7e0732f

## FR-unmapped-495 GET 响应裸形态（D-007 / 契约 §5/§6）
变更：2026-08-10-sillyhub-platform-sync
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-10-sillyhub-platform-sync/requirements.md#FR-07
最近确认：9f7e0732f

## FR-unmapped-496 name 全局唯一寻址（D-008 / 契约 §3）
变更：2026-08-10-sillyhub-platform-sync
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-10-sillyhub-platform-sync/requirements.md#FR-08
最近确认：9f7e0732f

## FR-unmapped-503 workspace-scoped token 签发
变更：2026-08-11-change-progress-projection
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given workspace 成员持 WORKSPACE_WRITE 权限；When 调 `POST /api/workspaces/{wid}/platform-sync-tokens`；Then 201 返回 `shpsync_` 明文 token 一次；`platform_sync_tokens` 存 sha256(token_hash) + work
全文：.sillyspec/changes/archive/2026-08-11-change-progress-projection/requirements.md#FR-01
最近确认：c769ce3d6

## FR-unmapped-504 收件箱按 workspace 隔离
变更：2026-08-11-change-progress-projection
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given `platform_change_progress` 加 workspace_id + 复合唯一 `(workspace_id, change_name)`；When 持 `shpsync_` token 上行 `POST /api/changes/{name}/progress`；Then `require_platform_sync` 派生 (User=created_by, workspace_id)，upsert 按复合键隔离；workspa
全文：.sillyspec/changes/archive/2026-08-11-change-progress-projection/requirements.md#FR-02
最近确认：c769ce3d6

## FR-unmapped-505 connect 自动下发 + 权限校验
变更：2026-08-11-change-progress-projection
状态：active
摘要：默认场景
依据决策：D-005@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given 用户跑 `sillyspec platform connect` 且持 user 级 shk_live_；When connect 调 `POST /api/workspaces/resolve-by-root-path`（body=root_path）；Then 反查 workspace（不到→404）→ 校验调用者 WORKSPACE_WRITE（无→403）→ 签发 shpsync_ 返回 `{workspace_i
全文：.sillyspec/changes/archive/2026-08-11-change-progress-projection/requirements.md#FR-03
最近确认：c769ce3d6

## FR-unmapped-506 变更中心实时 join 投影 current_stage
变更：2026-08-11-change-progress-projection
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 变更中心查列表/详情；When `enrich_summaries`（list 批量 IN join）/`enrich_with_workspace_ids`（single = 匹配）join；Then 取 `latest_progress.changes[0].current_stage` 覆盖猜值；read-only 不写 changes 表；无 N+1
全文：.sillyspec/changes/archive/2026-08-11-change-progress-projection/requirements.md#FR-04
最近确认：c769ce3d6

## FR-unmapped-507 未上行 fallback
变更：2026-08-11-change-progress-projection
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 工具从未上行的 change（或 quick-<uuid8> 不建目录）；When join 不命中；Then fallback 到 changes 表现有 current_stage，不崩
全文：.sillyspec/changes/archive/2026-08-11-change-progress-projection/requirements.md#FR-05
最近确认：c769ce3d6

## FR-unmapped-508 不投 status（已撤销 D-004@v2）
变更：2026-08-11-change-progress-projection
状态：active
摘要：默认场景
依据决策：D-004@v2
场景正文：
- 场景：默认场景 — Given sillyspec status 仅 active/archived 两值；When 投影；Then 只覆盖 current_stage；status 维持变更中心派生（current_stage==archive → 已归档）
全文：.sillyspec/changes/archive/2026-08-11-change-progress-projection/requirements.md#FR-06
最近确认：c769ce3d6

## FR-unmapped-509 gen:types 同步
变更：2026-08-11-change-progress-projection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — When 后端 schema 改动；Then 跑 `pnpm gen:types` 同步 `api-types.ts` + `openapi.json` 并提交
全文：.sillyspec/changes/archive/2026-08-11-change-progress-projection/requirements.md#FR-07
最近确认：c769ce3d6

## FR-unmapped-510 migration 棕地免回填
变更：2026-08-11-change-progress-projection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — When `alembic upgrade`；Then 建 `platform_sync_tokens` 表 + `platform_change_progress` 加 workspace_id 复合唯一；老数据不
全文：.sillyspec/changes/archive/2026-08-11-change-progress-projection/requirements.md#FR-08
最近确认：c769ce3d6

## FR-unmapped-517 init claim 时签发两个 workspace-scoped token
变更：2026-08-12-init-provision-local-yaml
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个 workspace 已 ensure_spec_workspace 且成员已绑定 daemon；When daemon claim 该 workspace 的 init lease（mode='init'）
全文：.sillyspec/changes/archive/2026-08-12-init-provision-local-yaml/requirements.md#FR-01
最近确认：a34d556ff

## FR-unmapped-518 get_or_issue 吊销旧未吊销 + 签新（逻辑复用，不堆积）
变更：2026-08-12-init-provision-local-yaml
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 同一 (workspace_id, created_by) 已存在未吊销的 shpsync_/shmcp_ token 同一 (workspace_id, cr；When init claim 调 get_or_issue init claim 调 get_or_issue；Then 旧 token 被 revoke（revoked_at=now），新 token 签发返回明文；同维度始终仅一条活 token 直接签新 token 返回明文
全文：.sillyspec/changes/archive/2026-08-12-init-provision-local-yaml/requirements.md#FR-02
最近确认：a34d556ff

## FR-unmapped-519 明文 token 不落 lease.metadata
变更：2026-08-12-init-provision-local-yaml
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given init lease 正被 claim；When build_claim_payload 注入 local_yaml；Then 明文 token 只存在于 claim 请求的内存 payload，**不写** lease.metadata_（DB 持久化 JSON 列、被审计服务读取）；
全文：.sillyspec/changes/archive/2026-08-12-init-provision-local-yaml/requirements.md#FR-03
最近确认：a34d556ff

## FR-unmapped-520 daemon 写 local.yaml platform 段（权威覆盖）
变更：2026-08-12-init-provision-local-yaml
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given daemon 收到含 local_yaml 的 init payload + rootPath；When handleInitLease 执行 writeLocalYaml；Then `<rootPath>/.sillyspec/local.yaml` 的 `platform:` 顶层段被文本级覆盖为 `{url: <serverOrigin
全文：.sillyspec/changes/archive/2026-08-12-init-provision-local-yaml/requirements.md#FR-04
最近确认：a34d556ff

## FR-unmapped-521 daemon 写 local.yaml mcp 段（有才留）
变更：2026-08-12-init-provision-local-yaml
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given daemon 收到含 local_yaml 的 init payload；When handleInitLease 执行 writeLocalYaml；Then 若 `mcp:` 顶层段**不存在**，写入 `{url: <serverOrigin>/mcp, token: <mcp_token>}`；若**已存在**（
全文：.sillyspec/changes/archive/2026-08-12-init-provision-local-yaml/requirements.md#FR-05
最近确认：a34d556ff

## FR-unmapped-522 url 由 daemon 端决定
变更：2026-08-12-init-provision-local-yaml
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given daemon 写 local.yaml；Then platform_url = daemon `config.server_url`（去尾斜杠），mcp_url = platform_url + `/mcp`；
全文：.sillyspec/changes/archive/2026-08-12-init-provision-local-yaml/requirements.md#FR-06
最近确认：a34d556ff

## FR-unmapped-523 写 local.yaml 失败 = init 整体失败
变更：2026-08-12-init-provision-local-yaml
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given writeLocalYaml 因任何原因失败（无写权限/磁盘满/路径无效）；When handleInitLease 第 4 步 catch 到错误；Then 返回 `ok:false`，`_runInitLease` 据 result.ok 走 `_finish(false)`，lease 标 failed，init
全文：.sillyspec/changes/archive/2026-08-12-init-provision-local-yaml/requirements.md#FR-07
最近确认：a34d556ff

## FR-unmapped-524 mcp token scope 合法
变更：2026-08-12-init-provision-local-yaml
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given McpTokenService.get_or_issue 签发；Then scope 必须取 `MCP_SCOPES` 合法值（read/dispatch/converge，backend/app/modules/mcp_gateway/auth.py:44）；init 场景用 `['dispat
全文：.sillyspec/changes/archive/2026-08-12-init-provision-local-yaml/requirements.md#FR-08
最近确认：a34d556ff

## FR-unmapped-525 主 tab 维度统一 + 待我处理聚焦筛选
变更：2026-08-13-change-center-rework
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-change-center-rework/requirements.md#FR-01
最近确认：b76ab5517

## FR-unmapped-526 「待我处理」语义 = 全局待人工
变更：2026-08-13-change-center-rework
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-change-center-rework/requirements.md#FR-02
最近确认：b76ab5517

## FR-unmapped-527 ChangeSummary 携带 pending_review（零 migration，走 PG 镜像）
变更：2026-08-13-change-center-rework
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-change-center-rework/requirements.md#FR-03
最近确认：b76ab5517

## FR-unmapped-528 默认排序「最近活动优先」+ 可切换
变更：2026-08-13-change-center-rework
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-change-center-rework/requirements.md#FR-04
最近确认：b76ab5517

## FR-unmapped-529 待办状态徽标
变更：2026-08-13-change-center-rework
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-change-center-rework/requirements.md#FR-05
最近确认：b76ab5517

## FR-unmapped-530 负责人列
变更：2026-08-13-change-center-rework
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-change-center-rework/requirements.md#FR-06
最近确认：b76ab5517

## FR-unmapped-531 查询区消除留白
变更：2026-08-13-change-center-rework
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-change-center-rework/requirements.md#FR-07
最近确认：b76ab5517

## FR-unmapped-532 新建变更升主按钮
变更：2026-08-13-change-center-rework
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-change-center-rework/requirements.md#FR-08
最近确认：b76ab5517

## FR-unmapped-533 空状态引导 CTA
变更：2026-08-13-change-center-rework
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-change-center-rework/requirements.md#FR-09
最近确认：b76ab5517

## FR-unmapped-534 tab 挂计数
变更：2026-08-13-change-center-rework
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-change-center-rework/requirements.md#FR-10
最近确认：b76ab5517

## FR-unmapped-535 副标题修正
变更：2026-08-13-change-center-rework
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-change-center-rework/requirements.md#FR-11
最近确认：b76ab5517

## FR-unmapped-536 删除死代码
变更：2026-08-13-change-center-rework
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-change-center-rework/requirements.md#FR-12
最近确认：b76ab5517

## FR-unmapped-537 接口类型同步
变更：2026-08-13-change-center-rework
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-change-center-rework/requirements.md#FR-13
最近确认：b76ab5517

## FR-unmapped-538 增量推送（只推变化）
变更：2026-08-13-platform-managed-file-sync
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-platform-managed-file-sync/requirements.md#FR-01
最近确认：a830df116

## FR-unmapped-539 多写者乐观锁
变更：2026-08-13-platform-managed-file-sync
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-platform-managed-file-sync/requirements.md#FR-02
最近确认：a830df116

## FR-unmapped-540 服务器权威清单（独立 spec_file_manifest 表）
变更：2026-08-13-platform-managed-file-sync
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-platform-managed-file-sync/requirements.md#FR-03
最近确认：a830df116

## FR-unmapped-541 软删除备份（move 出 spec_root）
变更：2026-08-13-platform-managed-file-sync
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-platform-managed-file-sync/requirements.md#FR-04
最近确认：a830df116

## FR-unmapped-542 rename 显式 op
变更：2026-08-13-platform-managed-file-sync
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-platform-managed-file-sync/requirements.md#FR-05
最近确认：a830df116

## FR-unmapped-543 `.runtime/` 移出增量范围
变更：2026-08-13-platform-managed-file-sync
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-platform-managed-file-sync/requirements.md#FR-06
最近确认：a830df116

## FR-unmapped-544 兼容
变更：2026-08-13-platform-managed-file-sync
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-13-platform-managed-file-sync/requirements.md#FR-07
最近确认：a830df116

## FR-unmapped-545 目录树浏览（懒加载）
变更：2026-08-18-workspace-file-browser
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given 用户已登录且对 workspace 有 workspace:read 权限，且当前用户有 daemon 绑定且 daemon 在线 daemon 离线 当前用户；When 打开「文件」标签页 / 展开某目录节点 打开文件页 打开文件页；Then 前端调用 `GET /explorer/tree?path=<rel>`，backend 按当前用户绑定解析 daemon 并转发 `explorer_list
全文：.sillyspec/changes/archive/2026-08-18-workspace-file-browser/requirements.md#FR-01
最近确认：860cfdb41

## FR-unmapped-546 文件预览
变更：2026-08-18-workspace-file-browser
状态：active
摘要：默认场景
依据决策：D-001@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given 用户在树中选中一个文件 文件为 utf8 解码失败的非文本文件；When 前端调用 `GET /explorer/file?path=<rel>` daemon explorer_read_file 处理；Then 按类型渲染：代码→语法高亮（react-syntax-highlighter）；Markdown→渲染视图；图片→blob 内联；二进制或 >10MB→元信息卡
全文：.sillyspec/changes/archive/2026-08-18-workspace-file-browser/requirements.md#FR-02
最近确认：860cfdb41

## FR-unmapped-547 文件下载
变更：2026-08-18-workspace-file-browser
状态：active
摘要：默认场景
依据决策：D-001@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given 用户选中任意已列出文件；When 点击下载；Then `GET /explorer/download?path=<rel>` 经 daemon `encoding=base64` 通道回传，StreamingRes
全文：.sillyspec/changes/archive/2026-08-18-workspace-file-browser/requirements.md#FR-03
最近确认：860cfdb41

## FR-unmapped-548 文件名全局搜索
变更：2026-08-18-workspace-file-browser
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given 用户已加载文件页；When 在搜索框输入关键词提交；Then `GET /explorer/search?q=` → daemon 全树递归（跳过 node_modules/.git 等噪声目录）大小写不敏感子串匹配文件名
全文：.sillyspec/changes/archive/2026-08-18-workspace-file-browser/requirements.md#FR-04
最近确认：860cfdb41

## FR-unmapped-549 路径安全
变更：2026-08-18-workspace-file-browser
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given 任意 explorer 端点收到恶意 path（`../`、绝对路径、UNC、工作区内 symlink 指向 root 外）；When backend 预检或 daemon 校验执行；Then backend 预检拒绝（422）或 daemon realpath 落点校验拒绝（forbidden→403），无任何 root 外内容泄漏
全文：.sillyspec/changes/archive/2026-08-18-workspace-file-browser/requirements.md#FR-05
最近确认：860cfdb41

## FR-unmapped-550 版本兼容降级
变更：2026-08-18-workspace-file-browser
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 用户本机 daemon 为旧版（未注册 explorer_* 方法）；When 调用任意 explorer 端点；Then daemon 回 method_not_found，backend 映射 422，前端显示「daemon 版本过旧请升级」卡；平台其它功能不受影响
全文：.sillyspec/changes/archive/2026-08-18-workspace-file-browser/requirements.md#FR-06
最近确认：860cfdb41

## FR-unmapped-611 Bash 命令实时反馈
变更：2026-08-24-platform-session-feedback-fix
状态：active
摘要：（无场景名）
依据决策：D-002@v1
全文：.sillyspec/changes/archive/2026-08-24-platform-session-feedback-fix/requirements.md#FR-01
最近确认：df0da49ed

## FR-unmapped-612 Plan 模式强确认
变更：2026-08-24-platform-session-feedback-fix
状态：active
摘要：（无场景名）
依据决策：D-001@v1、D-002@v1
全文：.sillyspec/changes/archive/2026-08-24-platform-session-feedback-fix/requirements.md#FR-02
最近确认：df0da49ed

## FR-unmapped-613 后台 Agent 任务进度可见
变更：2026-08-24-platform-session-feedback-fix
状态：active
摘要：（无场景名）
依据决策：D-002@v1
全文：.sillyspec/changes/archive/2026-08-24-platform-session-feedback-fix/requirements.md#FR-03
最近确认：df0da49ed

## FR-unmapped-614 AskUser 弹窗可最小化
变更：2026-08-24-platform-session-feedback-fix
状态：active
摘要：（无场景名）
依据决策：D-003@v1
全文：.sillyspec/changes/archive/2026-08-24-platform-session-feedback-fix/requirements.md#FR-04
最近确认：df0da49ed

## FR-unmapped-615 Git 日志列表与泳道拓扑展示
变更：2026-08-25-workspace-git-log
状态：active
摘要：默认场景
依据决策：D-001@v1、D-004@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given 工作区为 git 仓库（git_mode=git）且用户已绑定可用 daemon 仓库存在分叉与合并；When 用户打开「Git 日志」tab 渲染泳道；Then 显示泳道 SVG（commit 圆点按 lane 取色板、HEAD 虚线环）+ 提交列表（message/作者/短哈希/refs 标签/时间），默认全分支（gi
全文：.sillyspec/changes/archive/2026-08-25-workspace-git-log/requirements.md#FR-01
最近确认：5d86ddb17

## FR-unmapped-616 提交详情与变更文件目录树
变更：2026-08-25-workspace-git-log
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given 用户点击列表某行；When 打开右侧 Drawer；Then 展示哈希/作者/时间/message 全文 + 变更文件**目录树**（--numstat 平铺路径按 / 前端聚合，目录节点聚合 +x/-y，叶子显示单文件增
全文：.sillyspec/changes/archive/2026-08-25-workspace-git-log/requirements.md#FR-02
最近确认：5d86ddb17

## FR-unmapped-617 文件级 diff 查看
变更：2026-08-25-workspace-git-log
状态：active
摘要：默认场景
依据决策：D-003@v1、D-005@v1
场景正文：
- 场景：默认场景 — Given Drawer 文件树中某叶子文件被点击；When 按需请求该文件 diff（此前不请求）；Then 展示 unified diff（+绿/-红语义 token，行号列，hunk 头）；binary 文件显示「二进制文件」提示；超 64KB 截断并标记 trun
全文：.sillyspec/changes/archive/2026-08-25-workspace-git-log/requirements.md#FR-03
最近确认：5d86ddb17

## FR-unmapped-618 分支与作者过滤
变更：2026-08-25-workspace-git-log
状态：active
摘要：默认场景
依据决策：D-005@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given 工具栏分支下拉（数据源=响应 top-level branches[]，git_refs 全量）与作者文本输入框；When 用户设定过滤并触发；Then 请求携带 branch/author 参数（git log <branch> 替代 --all；--author 独立 argv），结果集更新；过滤后结果集外的
全文：.sillyspec/changes/archive/2026-08-25-workspace-git-log/requirements.md#FR-04
最近确认：5d86ddb17

## FR-unmapped-619 异常与降级形态
变更：2026-08-25-workspace-git-log
状态：active
摘要：默认场景
依据决策：D-002@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given 工作区非 git 仓库（probe=direct） daemon 离线 / RPC 超时 / 旧版 daemon（method_not_found）/ 用户未绑
全文：.sillyspec/changes/archive/2026-08-25-workspace-git-log/requirements.md#FR-05
最近确认：5d86ddb17

## FR-unmapped-620 分页与性能
变更：2026-08-25-workspace-git-log
状态：active
摘要：默认场景
依据决策：D-004@v1、D-005@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given 大仓库历史 长列表滚动；When 用户翻页（skip/limit，默认 100/页）；Then daemon 每页从 HEAD 拉 skip+limit+lookahead(50) 条，backend 全前缀确定性 lane 计算只返回窗口——任意页 la
全文：.sillyspec/changes/archive/2026-08-25-workspace-git-log/requirements.md#FR-06
最近确认：5d86ddb17

## FR-unmapped-621 只读与参数安全
变更：2026-08-25-workspace-git-log
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given 全部后端链路 sha/branch/author/path 输入；Then 只使用只读 git 子命令（log/for-each-ref/show/rev-parse），无 DB 写入，无状态迁移 sha 匹配 ^[0-9a-fA-F]
全文：.sillyspec/changes/archive/2026-08-25-workspace-git-log/requirements.md#FR-07
最近确认：5d86ddb17

## FR-unmapped-622 三主题视觉合规
变更：2026-08-25-workspace-git-log
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given blue / ai-native / dark 任一主题；When 打开 Git 日志页；Then 颜色全部走 themes.ts 消费链（CSS 变量 / brand-* / semantic token），泳道色板三主题各配亮暗档；tab 内无 md: 等
全文：.sillyspec/changes/archive/2026-08-25-workspace-git-log/requirements.md#FR-08
最近确认：5d86ddb17

## FR-unmapped-634 Office 高保真预览
变更：2026-08-26-onlyoffice-preview
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 预览的文件为 docx/xlsx/pptx/doc/xls/ppt 且 DS 已启用；When 打开预览窗；Then 经 DS 呈现高保真只读视图（样式/列宽/合并还原）；pdf/图片/md 走现有渲染器不变
全文：.sillyspec/changes/archive/2026-08-26-onlyoffice-preview/requirements.md#FR-01
最近确认：3f5e39780

## FR-unmapped-635 降级链
变更：2026-08-26-onlyoffice-preview
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given DS 未启用（config 503）、api.js 加载失败或 DocEditor 初始化出错；When office 文件预览；Then 自动回落本地渲染器（docx→docx-preview；xlsx/xls→SheetJS；ppt/pptx→fallback 下载），
全文：.sillyspec/changes/archive/2026-08-26-onlyoffice-preview/requirements.md#FR-02
最近确认：3f5e39780

## FR-unmapped-636 一次性文件令牌
变更：2026-08-26-onlyoffice-preview
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given DS 需拉取文件（无 JWT 能力）；When backend 签发 file token；Then token HS256 签名、TTL 5 分钟、redis jti 一次性消费（重放 410）、绑定 object_key；
全文：.sillyspec/changes/archive/2026-08-26-onlyoffice-preview/requirements.md#FR-03
最近确认：3f5e39780

## FR-unmapped-637 归属校验
变更：2026-08-26-onlyoffice-preview
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户请求 office-config（source=session_attachment|file, id）；When 附件/文件不属于该用户或不存在；Then 404（资源隐藏语义，与既有端点一致）
全文：.sillyspec/changes/archive/2026-08-26-onlyoffice-preview/requirements.md#FR-04
最近确认：3f5e39780

## FR-unmapped-638 前端零构建配置
变更：2026-08-26-onlyoffice-preview
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 局域网 IP/端口变化；When 运维仅改 .env 的 ONLYOFFICE_PUBLIC_URL 并重启 backend；Then 前端无需重新构建即用新地址（config 端点下发 ds_url）
全文：.sillyspec/changes/archive/2026-08-26-onlyoffice-preview/requirements.md#FR-05
最近确认：3f5e39780

## FR-unmapped-639 部署门禁
变更：2026-08-26-onlyoffice-preview
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Docker VM Total Memory < 6GB；When 尝试部署 onlyoffice 服务；Then 验证步骤明确拒绝并提示先调 Docker Desktop 内存（文档+检查命令）
全文：.sillyspec/changes/archive/2026-08-26-onlyoffice-preview/requirements.md#FR-06
最近确认：3f5e39780

## FR-unmapped-640 Git 状态数据端点
变更：2026-08-26-workspace-git-status
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 工作区为 git 仓库且用户已绑定在线 daemon；When GET /api/workspaces/{wid}/git-log/status；Then 返回 branch/detached/upstream/ahead/behind/dirty{files_changed,additions,deletions
全文：.sillyspec/changes/archive/2026-08-26-workspace-git-status/requirements.md#FR-01
最近确认：69bf8e3c5

## FR-unmapped-641 自动 fetch 与降级
变更：2026-08-26-workspace-git-status
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 打开任一挂载页；When useGitLogStatus 触发（staleTime 60s，两页共享缓存）；Then daemon 侧先 git fetch --quiet（15s 超时）；成功→ahead/behind 为新鲜值且 fetch.performed=true；超
全文：.sillyspec/changes/archive/2026-08-26-workspace-git-status/requirements.md#FR-02
最近确认：69bf8e3c5

## FR-unmapped-642 未提交改动统计
变更：2026-08-26-workspace-git-status
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 工作区有未提交改动；When 采集 git diff HEAD --numstat --no-renames；Then additions/deletions 为行数汇总（staged+unstaged 合并），files_changed ≡ numstat 行数（单源；inde
全文：.sillyspec/changes/archive/2026-08-26-workspace-git-status/requirements.md#FR-03
最近确认：69bf8e3c5

## FR-unmapped-643 状态条双形态展示
变更：2026-08-26-workspace-git-status
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given Git 日志页打开 会话页打开且 scope.kind=workspace 加载中 / fetch 失败；When 状态条渲染（variant=full） 状态条渲染（variant=compact，PageHeader actions 槽）；Then 分支徽标（⎇）+ 跟踪名 + ↑N 未推送 + ↓N 远程新提交 + 改动 +A/−D（N 文件）+ 未跟踪 N + "已同步 · HH:MM" 分支/↑/↓/
全文：.sillyspec/changes/archive/2026-08-26-workspace-git-status/requirements.md#FR-04
最近确认：69bf8e3c5

## FR-unmapped-644 边界形态
变更：2026-08-26-workspace-git-status
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 无 upstream（本地新分支）→ 无 ↑↓（ahead/behind null） detached HEAD → 分支徽标显示 head_short + "
全文：.sillyspec/changes/archive/2026-08-26-workspace-git-status/requirements.md#FR-05
最近确认：69bf8e3c5

## FR-unmapped-645 只读与安全
变更：2026-08-26-workspace-git-status
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 全链路；Then 本地零写操作（fetch 为网络同步）；root 唯一入参（零新增注入面）；全部 argv 独立经 execFile；无 DB 写入
全文：.sillyspec/changes/archive/2026-08-26-workspace-git-status/requirements.md#FR-06
最近确认：69bf8e3c5

## FR-unmapped-646 主题与缓存合规
变更：2026-08-26-workspace-git-status
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 三主题任一；Then 状态条颜色全走 themes.ts 消费链（brand 徽标/accent ↑/warning ↓与黄条/success +/error −）零硬编码 hex；
全文：.sillyspec/changes/archive/2026-08-26-workspace-git-status/requirements.md#FR-07
最近确认：69bf8e3c5

## FR-unmapped-647 daemon 消费 SDK 任务生命周期消息（D-001@v1）
变更：2026-08-27-background-subagent-progress
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — When daemon session-manager `_onMessage` 识别到上述 subtype；Then 注册/更新/注销会话级任务表，并发出对应 `agent_task_status` 事件：started→running（含 task_id/tool_use_i
全文：.sillyspec/changes/archive/2026-08-27-background-subagent-progress/requirements.md#FR-01
最近确认：c7f48562c

## FR-unmapped-648 异步启动回执解析兜底（D-001@v1）
变更：2026-08-27-background-subagent-progress
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Task/Agent 工具的 tool_result 文本含 "Async agent launched successfully" 与 agentId（CLI；When daemon user tool_result 分支解析命中；Then 以该 tool_use_id 注册任务表并发出 `agent_task_status {status:'running', async:true, task_i
全文：.sillyspec/changes/archive/2026-08-27-background-subagent-progress/requirements.md#FR-02
最近确认：c7f48562c

## FR-unmapped-649 [TASK_*] 持久日志行（D-002@v1）
变更：2026-08-27-background-subagent-progress
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given FR-01/02 的任一生命周期节点触发；When daemon 落库通道写入
全文：.sillyspec/changes/archive/2026-08-27-background-subagent-progress/requirements.md#FR-03
最近确认：c7f48562c

## FR-unmapped-650 backend 事件 schema 扩展与透传（D-001@v1）
变更：2026-08-27-background-subagent-progress
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given daemon 发出扩展字段的 agent_task_status；When backend `notify_agent_task_status` 接收并发布到 Redis `agent_session:{id}`；Then 新字段（status 终态值/tool_use_id/summary/last_tool_name/elapsed_ms/total_tokens/tool_u
全文：.sillyspec/changes/archive/2026-08-27-background-subagent-progress/requirements.md#FR-04
最近确认：c7f48562c

## FR-unmapped-651 子代理日志跨轮归位（D-003@v1）
变更：2026-08-27-background-subagent-progress
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given submit_messages 收到带 parent_tool_use_id 的日志行，且该 tool_use 属于早前已完成的派发 run；When backend 落库；Then 行的 run_id 归写为派发 run（进程内 LRU + tool_call 行冷启动反查）；查不到映射时保持现状不报错；历史行不迁移。
全文：.sillyspec/changes/archive/2026-08-27-background-subagent-progress/requirements.md#FR-05
最近确认：c7f48562c

## FR-unmapped-652 后台卡片全生命周期展示（D-005@v1）
变更：2026-08-27-background-subagent-progress
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 头部"后台"下拉中的 AgentTaskCard 处于 running；Then 显示"正在做什么"（last_tool_name+summary）、走秒计时（本地 tick + elapsed_ms 校准）、tokens/工具次数、最后活跃
全文：.sillyspec/changes/archive/2026-08-27-background-subagent-progress/requirements.md#FR-06
最近确认：c7f48562c

## FR-unmapped-653 子代理目录与会话块异步感知（D-005@v1）
变更：2026-08-27-background-subagent-progress
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 子代理块/目录行对应异步派发（async 标记或 [TASK_*] 元数据）；When tool_result（启动回执）到达；Then 块状态保持"后台运行中"且时长走秒（不判 done/不用往返差值）；终态由 TASK_NOTIFICATION 驱动显示服务端真实时长；前台（阻塞式）子代理状态
全文：.sillyspec/changes/archive/2026-08-27-background-subagent-progress/requirements.md#FR-07
最近确认：c7f48562c

## FR-unmapped-654 空 prompt 注入防御（D-004@v1）
变更：2026-08-27-background-subagent-progress
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 调用方 POST /inject 且 prompt strip 后为空；When backend `inject_session` 处理；Then 返回 422（中文文案，不创建 AgentRun/不写 user_input 行）；前端发送按钮对空内容 disabled。
全文：.sillyspec/changes/archive/2026-08-27-background-subagent-progress/requirements.md#FR-08
最近确认：c7f48562c

## FR-unmapped-655 spike 验证 SDK 运行时发射（R-01）
变更：2026-08-27-background-subagent-progress
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 本地 daemon + 后台 Agent 会话；When session-manager 记录 task_* 到达情况；Then 验证结论（发/不发、task_progress 频率）回填 design.md §10，确定兜底路径权重与节流参数。
全文：.sillyspec/changes/archive/2026-08-27-background-subagent-progress/requirements.md#FR-09
最近确认：c7f48562c

## FR-unmapped-665 sillyspec 版本显示
变更：2026-08-31-machine-sillyspec-version
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 机器在线且 daemon 已探测到本机 sillyspec 版本；When 用户查看机器列表；Then 机器卡 meta 行显示 `sillyspec <版本>` 徽标：已最新=常色；落后=橙色「当前 → 最新」+「有新版本」小标签；未安装=红色「未安装」
全文：.sillyspec/changes/archive/2026-08-31-machine-sillyspec-version/requirements.md#FR-01
最近确认：26abd5305

## FR-unmapped-666 手动远程升级
变更：2026-08-31-machine-sillyspec-version
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 机器在线；When 用户点击「升级 sillyspec」（未安装时文案为「安装 sillyspec」，失败后为「重试升级」）；Then 后端校验归属后经 WS `daemon:sillyspec_update` 触发 daemon 执行 `npm install -g sillyspec@lat
全文：.sillyspec/changes/archive/2026-08-31-machine-sillyspec-version/requirements.md#FR-02
最近确认：26abd5305

## FR-unmapped-667 升级过程可见
变更：2026-08-31-machine-sillyspec-version
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 升级已触发；When daemon 状态流转；Then 机器卡横幅按 `sillyspec_update.state` 显示四态：running=info「正在升级（from → to）」、deferred=warn
全文：.sillyspec/changes/archive/2026-08-31-machine-sillyspec-version/requirements.md#FR-03
最近确认：26abd5305

## FR-unmapped-668 运行期自动定期升级
变更：2026-08-31-machine-sillyspec-version
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given daemon 运行中且 `sillyspec_update_interval_sec` > 0（默认 3600）；When 定时循环发现本机落后于 npm 最新版或未安装；Then 自动触发升级（trigger=auto），机器忙时推迟不打断进行中的会话/任务（复用 `_isBusyForUpdate` 三臂忙判定）
全文：.sillyspec/changes/archive/2026-08-31-machine-sillyspec-version/requirements.md#FR-04
最近确认：26abd5305

## FR-unmapped-669 数据链与兼容
变更：2026-08-31-machine-sillyspec-version
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given daemon 与 backend 版本可能不齐；Then register 对 sillyspec_version/latest 直接落值（含 null）；心跳对二者非 None 才覆盖、对 sillyspec_upd
全文：.sillyspec/changes/archive/2026-08-31-machine-sillyspec-version/requirements.md#FR-05
最近确认：26abd5305

## FR-unmapped-670 统一 current_stage 枚举
变更：agent-driven-change-center
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Change 模型的 current_stage 字段；When 系统初始化；Then current_stage 枚举为：draft, scan, brainstorm, propose, plan, execute, verify, quick
全文：.sillyspec/changes/archive/agent-driven-change-center/requirements.md#FR-01
最近确认：98d3e56dd

## FR-unmapped-671 新增 human_gate 字段
变更：agent-driven-change-center
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Change 模型；When 执行 DB 迁移；Then Change 表新增 human_gate 字段（VARCHAR(50), DEFAULT 'none'）
全文：.sillyspec/changes/archive/agent-driven-change-center/requirements.md#FR-02
最近确认：98d3e56dd

## FR-unmapped-672 旧数据迁移
变更：agent-driven-change-center
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 已有 Change 记录的 current_stage 为 rework_required 已有 Change 记录的 current_stage 为 acce；When 迁移脚本执行 迁移脚本执行；Then current_stage 更新为 'verify'，human_gate 更新为 'blocked' current_stage 更新为 'verify'，h
全文：.sillyspec/changes/archive/agent-driven-change-center/requirements.md#FR-03
最近确认：98d3e56dd

## FR-unmapped-673 Agent 驱动流转规则
变更：agent-driven-change-center
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Change 的 current_stage 为 draft intake agent 判断需求明确 intake agent 判断需求不明确；When 创建完成 AgentRun 完成 AgentRun 完成；Then 自动 dispatch intake agent 分析需求 current_stage = propose，dispatch propose agent cur
全文：.sillyspec/changes/archive/agent-driven-change-center/requirements.md#FR-04
最近确认：98d3e56dd

## FR-unmapped-674 propose 文档确认 Gate
变更：agent-driven-change-center
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given propose agent 完成四件套生成；When AgentRun 状态为 completed；Then current_stage = propose，human_gate = need_proposal_review
全文：.sillyspec/changes/archive/agent-driven-change-center/requirements.md#FR-05
最近确认：98d3e56dd

## FR-unmapped-675 proposal-review API
变更：agent-driven-change-center
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given current_stage = propose 且 human_gate = need_proposal_review current_stage = prop；When POST /changes/{id}/proposal-review { decision: "approve" } POST /changes/{id}/pr；Then current_stage = plan，dispatch plan agent，human_gate = none dispatch propose agen
全文：.sillyspec/changes/archive/agent-driven-change-center/requirements.md#FR-06
最近确认：98d3e56dd

## FR-unmapped-676 plan 文档确认 Gate
变更：agent-driven-change-center
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given plan agent 完成计划生成；When AgentRun 状态为 completed；Then current_stage = plan，human_gate = need_plan_review
全文：.sillyspec/changes/archive/agent-driven-change-center/requirements.md#FR-07
最近确认：98d3e56dd

## FR-unmapped-677 plan-review API
变更：agent-driven-change-center
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given current_stage = plan 且 human_gate = need_plan_review current_stage = plan 且 huma；When POST /changes/{id}/plan-review { decision: "approve" } POST /changes/{id}/plan-r；Then current_stage = execute，dispatch execute agent，human_gate = none dispatch plan a
全文：.sillyspec/changes/archive/agent-driven-change-center/requirements.md#FR-08
最近确认：98d3e56dd

## FR-unmapped-678 execute 完成自动 verify
变更：agent-driven-change-center
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given execute agent 完成；When AgentRun 状态为 completed；Then 自动 dispatch verify agent，current_stage = verify，human_gate = none
全文：.sillyspec/changes/archive/agent-driven-change-center/requirements.md#FR-09
最近确认：98d3e56dd

## FR-unmapped-679 verify 自动修复闭环
变更：agent-driven-change-center
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given verify agent 完成 verify agent 完成 verify agent 完成；When AgentRun 状态为 completed 且验证通过 AgentRun 状态为 completed 且验证不通过 AgentRun 状态为 complete；Then current_stage = verify，human_gate = need_human_test dispatch quick agent 修复，修复后自
全文：.sillyspec/changes/archive/agent-driven-change-center/requirements.md#FR-10
最近确认：98d3e56dd

## FR-unmapped-680 human-test API
变更：agent-driven-change-center
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given current_stage = verify 且 human_gate = need_human_test current_stage = verify 且 h；When POST /changes/{id}/human-test { result: "pass" } POST /changes/{id}/human-test {；Then current_stage = archive，human_gate = need_archive_confirm dispatch quick agent c
全文：.sillyspec/changes/archive/agent-driven-change-center/requirements.md#FR-11
最近确认：98d3e56dd

## FR-unmapped-681 前端按 gate 渲染交互
变更：agent-driven-change-center
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Change 详情页加载；When 读取 human_gate 值；Then 按 human_gate 值渲染对应的操作面板（非技术阶段名）
全文：.sillyspec/changes/archive/agent-driven-change-center/requirements.md#FR-12
最近确认：98d3e56dd

## FR-unmapped-682 简化新建变更
变更：agent-driven-change-center
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户点击新建变更；When 填写需求描述（必填）和模块（可选）；Then 创建 Change（current_stage=draft, human_gate=none）
全文：.sillyspec/changes/archive/agent-driven-change-center/requirements.md#FR-13
最近确认：98d3e56dd

## FR-unmapped-683 归档 Gate
变更：agent-driven-change-center
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given current_stage = archive 且 human_gate = need_archive_confirm；When 所有检查项通过；Then 用户可确认归档
全文：.sillyspec/changes/archive/agent-driven-change-center/requirements.md#FR-14
最近确认：98d3e56dd

## FR-unmapped-684 创建变更
变更：change-center-redesign
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/change-center-redesign/requirements.md#FR-1
最近确认：98d3e56dd

## FR-unmapped-685 变更列表展示阶段
变更：change-center-redesign
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/change-center-redesign/requirements.md#FR-2
最近确认：98d3e56dd

## FR-unmapped-686 启动变更执行
变更：change-center-redesign
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/change-center-redesign/requirements.md#FR-3
最近确认：98d3e56dd

## FR-unmapped-687 实时进度展示
变更：change-center-redesign
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/change-center-redesign/requirements.md#FR-4
最近确认：98d3e56dd

## FR-unmapped-688 查看变更文档
变更：change-center-redesign
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/change-center-redesign/requirements.md#FR-5
最近确认：98d3e56dd

## FR-unmapped-689 变更执行完成
变更：change-center-redesign
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/change-center-redesign/requirements.md#FR-6
最近确认：98d3e56dd

## FR-unmapped-690 创建变更自动进入 clarifying 阶段
变更：change-workflow-engine
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/change-workflow-engine/requirements.md#FR-01
最近确认：98d3e56dd

## FR-unmapped-691 状态机转换必须遵循合法转换规则
变更：change-workflow-engine
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/change-workflow-engine/requirements.md#FR-02
最近确认：98d3e56dd

## FR-unmapped-692 Agent 仅在 ready_for_dev 阶段可启动执行
变更：change-workflow-engine
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/change-workflow-engine/requirements.md#FR-03
最近确认：98d3e56dd

## FR-unmapped-693 业务验收必须选择反馈分类
变更：change-workflow-engine
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/change-workflow-engine/requirements.md#FR-04
最近确认：98d3e56dd

## FR-unmapped-694 归档必须通过 6 项门禁检查
变更：change-workflow-engine
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/change-workflow-engine/requirements.md#FR-05
最近确认：98d3e56dd

## FR-unmapped-695 旧数据兼容迁移
变更：change-workflow-engine
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/change-workflow-engine/requirements.md#FR-06
最近确认：98d3e56dd

## FR-unmapped-696 配置 spec_data_root
变更：workspace-spec-root-managed-p0
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/workspace-spec-root-managed-p0/requirements.md#FR-01
最近确认：98d3e56dd

## FR-unmapped-697 补建 spec_workspaces 记录
变更：workspace-spec-root-managed-p0
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/workspace-spec-root-managed-p0/requirements.md#FR-02
最近确认：98d3e56dd

## FR-unmapped-698 迁移已有 scan 文档
变更：workspace-spec-root-managed-p0
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/workspace-spec-root-managed-p0/requirements.md#FR-03
最近确认：98d3e56dd

## FR-unmapped-699 ScanDocsService 从 spec_root 读取
变更：workspace-spec-root-managed-p0
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/workspace-spec-root-managed-p0/requirements.md#FR-04
最近确认：98d3e56dd

变更：workspace-spec-root-managed-p0
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/workspace-spec-root-managed-p0/requirements.md#FR-05
最近确认：98d3e56dd

变更：2026-09-20-workspace-member-visibility
状态：active
摘要：默认场景；非成员持平台级 workspace:read 访问工作区详情；非成员持平台级 mcp:read 读工作区 MCP 配置
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — Given 用户不是工作区 W 的成员，且不是平台管理员（`is_platform_admin=False` 且平台级角色不含 `platform:admin`），但平台级；When 以工作区 W 为上下文判定权限 P（`has_permission(workspace_id=W)`，即所有 `require_permission` 路由）；Then 判定为 False（403），P 为任意 Permission 枚举值均如此
- 场景：非成员持平台级 workspace:read 访问工作区详情 — Given 180490 绑定 developer 角色（平台级 `workspace:read`），不是工作区 W 成员；When GET /api/workspaces/{W}；Then HTTP 403
- 场景：非成员持平台级 mcp:read 读工作区 MCP 配置 — Given 同上用户，权限为 `mcp:read`；When 访问 W 的 mcp-config 读端点；Then HTTP 403
全文：.sillyspec/changes/archive/2026-09-20-workspace-member-visibility/requirements.md#FR-01
最近确认：3642c3d0

变更：2026-09-20-workspace-member-visibility
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 用户 `is_platform_admin=True`，或平台级角色含 `platform:admin`；When 访问任意工作区（成员或非成员）或列表；Then 行为与改动前完全一致（放行、全量列表）
全文：.sillyspec/changes/archive/2026-09-20-workspace-member-visibility/requirements.md#FR-02
最近确认：3642c3d0

变更：2026-09-20-workspace-member-visibility
状态：active
摘要：默认场景
依据决策：D-001@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given 用户非平台管理员、平台级角色不含 `platform:admin`，但持平台级 `workspace:read`；When GET /api/workspaces；Then 仅返回该用户为成员的工作区（无成员身份则空列表）；ql-20260917-007 的「平台级 workspace:read → 全量」分支废止
全文：.sillyspec/changes/archive/2026-09-20-workspace-member-visibility/requirements.md#FR-03
最近确认：3642c3d0

变更：2026-09-20-workspace-member-visibility
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 工作区 W 发生需广播事件（`list_user_ids_with_permission(workspace_id=W, permission=P)` 被调用）；When 查找收件人
全文：.sillyspec/changes/archive/2026-09-20-workspace-member-visibility/requirements.md#FR-04
最近确认：3642c3d0

变更：2026-09-20-workspace-member-visibility
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — Given 用户持平台级权限 P（如 developer 角色的 `workspace:read`）；When 以无工作区上下文判定 P（`require_permission_any`，如创建工作区前的入口校验）或经 `/api/auth/me` 聚合权限驱动菜单显隐；Then 行为与改动前完全一致（菜单仍可见、入口判定仍放行）
全文：.sillyspec/changes/archive/2026-09-20-workspace-member-visibility/requirements.md#FR-05
最近确认：3642c3d0

变更：2026-09-20-workspace-member-visibility
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 用户持平台级 `workspace:write` 并创建工作区；When 创建完成（新建/复用/复活任一路径，`backend/app/modules/workspace/service.py` `_ensure_creator_as；Then 创建者自动成为该工作区 `workspace_owner` 成员，随后对该工作区的访问走成员判定、正常放行
全文：.sillyspec/changes/archive/2026-09-20-workspace-member-visibility/requirements.md#FR-06
最近确认：3642c3d0
