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
待复核：2026-09-26-migration-chain-dedupe
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
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-change-center-thin-flow
  status: active
- row: 2026-09-25-change-center-thin-flow:task-01:acc-1-6259e0f9
  tests: backend/app/modules/change/tests/test_dispatch.py | backend/tests/modules/change/test_dispatch_stage_config.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-change-center-thin-flow
  status: active
- row: 2026-09-25-change-center-thin-flow:task-01:acc-2-ed98ef81
  tests: backend/app/modules/change/tests/test_dispatch.py | backend/tests/modules/change/test_dispatch_stage_config.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-change-center-thin-flow
  status: active

## FR-auto-backend-016 thin 派发 prompt 契约
变更：2026-09-25-change-center-thin-flow
状态：active
摘要：默认场景
待复核：2026-09-26-migration-chain-dedupe
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
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-change-center-thin-flow
  status: active
- row: 2026-09-25-change-center-thin-flow:task-02:acc-1-b3206f61
  tests: backend/app/modules/change/tests/test_thin_stage.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-change-center-thin-flow
  status: active
- row: 2026-09-25-change-center-thin-flow:task-02:acc-2-c6d1563c
  tests: backend/app/modules/change/tests/test_thin_stage.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-change-center-thin-flow
  status: active

## FR-auto-backend-017 写入分流 quick→thin
变更：2026-09-25-change-center-thin-flow
状态：active
摘要：默认场景
待复核：2026-09-26-migration-chain-dedupe
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
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-change-center-thin-flow
  status: active
- row: 2026-09-25-change-center-thin-flow:task-03:acc-1-cdf7329e
  tests: backend/app/modules/change_writer/tests/test_classifier.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-change-center-thin-flow
  status: active

## FR-auto-backend-018 flow 命令族会话绑定
变更：2026-09-25-change-center-thin-flow
状态：active
摘要：默认场景
待复核：2026-09-26-migration-chain-dedupe
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
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-change-center-thin-flow
  status: active
- row: 2026-09-25-change-center-thin-flow:task-04:acc-1-06326d42
  tests: backend/app/modules/change/tests/test_spec_binding.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-change-center-thin-flow
  status: active

## FR-auto-backend-019 阶段回洗双守卫
变更：2026-09-25-change-center-thin-flow
状态：active
摘要：默认场景
待复核：2026-09-26-migration-chain-dedupe
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
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-change-center-thin-flow
  status: active
- row: 2026-09-25-change-center-thin-flow:task-05:acc-1-e63707df
  tests: backend/app/modules/change/tests/test_thin_stage.py | backend/app/modules/platform_sync/tests/test_thin_stage_guard.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-change-center-thin-flow
  status: active

## FR-auto-backend-020 前端 thin 视觉与交互（显示名「轻量变更」，D-002@v1）
变更：2026-09-25-change-center-thin-flow
状态：active
摘要：默认场景
待复核：2026-09-26-migration-chain-dedupe
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — Given 前端七处硬编码触点（徽章映射/STATUS_BADGE/STAGE_OPTIONS 双副本/说明卡/概览卡两处旁路判断/移动端审批卡/时间线组标签）；When thin 变更出现在列表/详情/概览/移动端；Then 徽章「◈ 轻量变更」品牌紫阶（quick 改「快速任务（存量）」琥珀）；筛选下拉含「轻量变更」（桌面+移动两份副本）；详情页 thin 两段式说明卡（桌面+移动
全文：.sillyspec/changes/archive/2026-09-25-change-center-thin-flow/requirements.md#FR-06
最近确认：9c908b6ae

## FR-auto-backend-021 quick 存量软退役标注
变更：2026-09-25-change-center-thin-flow
状态：active
摘要：默认场景
待复核：2026-09-26-migration-chain-dedupe
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given quick 为存量过渡通道（CLI 横幅语义）；When 用户查看 quicklog 面板/quick 说明卡/统计卡/流程指引文档；Then quicklog tab 计数标「存量 · N」、空态文案换退役指引（桌面 quicklog-table:346 + 移动 :873 两处必改）；quick 说
全文：.sillyspec/changes/archive/2026-09-25-change-center-thin-flow/requirements.md#FR-07
最近确认：9c908b6ae

## FR-auto-backend-022 纵深防御与对账
变更：2026-09-25-change-center-thin-flow
状态：active
摘要：默认场景
待复核：2026-09-26-migration-chain-dedupe
场景正文：
- 场景：默认场景 — Given 上游 3.30.0 已有变更名白名单但平台入口无校验；watcher 事件按 change_name 字符串归属；When thin 变更派发/CLI 侧自建 thin 目录 reparse/watcher 事件上行；Then 派发入口对 thin 变更校验 change_key（`^[A-Za-z0-9_.\-]+$`，拒 `..`/`default`/`quick-<hex8>`）
全文：.sillyspec/changes/archive/2026-09-25-change-center-thin-flow/requirements.md#FR-08
最近确认：9c908b6ae

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-change-center-thin-flow:task-06:acc-0-2cf02565
  tests: backend/app/modules/change/tests/test_parser.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-change-center-thin-flow
  status: active
- row: 2026-09-25-change-center-thin-flow:task-06:acc-1-b13aec10
  tests: backend/app/modules/change/tests/test_parser.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-change-center-thin-flow
  status: active

## FR-auto-backend-023 批量 upsert 分片
变更：2026-09-25-spec-sync-pg-chunk
状态：active
摘要：默认场景
待复核：2026-09-26-manifest-heal-endpoint
场景正文：
- 场景：默认场景 — Given 单批 spec-sync ops 含数千 add（归档移动整树形态）；When apply_ops 写 manifest；Then 按 500/批分片执行 pg_insert upsert，单语句绑定参数恒低于 asyncpg 32767 上限，行级语义（版本高位对齐/exists/幂等）逐
全文：.sillyspec/changes/archive/2026-09-25-spec-sync-pg-chunk/requirements.md#FR-01
最近确认：c72d04c8f196a81fce03d43ccfe9705e7d3390f8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-spec-sync-pg-chunk:flow:FR-01
  tests: backend/app/modules/spec_workspace/tests/test_spec_sync_chunk.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-spec-sync-pg-chunk
  status: active

## FR-auto-backend-024 超大批全量落库
变更：2026-09-25-spec-sync-pg-chunk
状态：active
摘要：默认场景
待复核：2026-09-26-manifest-heal-endpoint
场景正文：
- 场景：默认场景 — Given 一次同步推送 1200 个 add；When 处理完成；Then 1200 行全落 manifest（批边界与尾批不丢行）、文件全写盘、版本/哈希正确
全文：.sillyspec/changes/archive/2026-09-25-spec-sync-pg-chunk/requirements.md#FR-02
最近确认：c72d04c8f196a81fce03d43ccfe9705e7d3390f8

## FR-auto-backend-025 既有增量同步零回归
变更：2026-09-25-spec-sync-pg-chunk
状态：active
摘要：默认场景
待复核：2026-09-26-manifest-heal-endpoint
场景正文：
- 场景：默认场景 — Given 本变更交付；When 跑 spec_workspace 增量同步既有测试；Then 全绿（本次 33 passed 1 skipped，skip 为既有 Windows symlink 平台跳过）
全文：.sillyspec/changes/archive/2026-09-25-spec-sync-pg-chunk/requirements.md#FR-03
最近确认：c72d04c8f196a81fce03d43ccfe9705e7d3390f8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-spec-sync-pg-chunk:flow:FR-03
  tests: backend/app/modules/spec_workspace/tests/test_spec_sync_chunk.py | backend/app/modules/spec_workspace/tests/test_sync_incremental.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
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
待复核：2026-09-26-manifest-heal-endpoint
全文：.sillyspec/changes/archive/2026-09-25-full-sync-resurrect-missing/requirements.md#FR-01
最近确认：ff6779d4e9e2ecdc2020d32e3bb3418f31153978

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-full-sync-resurrect-missing:flow:FR-01
  tests: backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-full-sync-resurrect-missing
  status: active

## FR-auto-backend-039 复活态落盘语义
变更：2026-09-25-full-sync-resurrect-missing
状态：active
摘要：（无场景名）
待复核：2026-09-26-manifest-heal-endpoint
全文：.sillyspec/changes/archive/2026-09-25-full-sync-resurrect-missing/requirements.md#FR-02
最近确认：ff6779d4e9e2ecdc2020d32e3bb3418f31153978

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-full-sync-resurrect-missing:flow:FR-02
  tests: backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-full-sync-resurrect-missing
  status: active

## FR-auto-backend-040 正常态零回归
变更：2026-09-25-full-sync-resurrect-missing
状态：active
摘要：（无场景名）
待复核：2026-09-26-manifest-heal-endpoint
全文：.sillyspec/changes/archive/2026-09-25-full-sync-resurrect-missing/requirements.md#FR-03
最近确认：ff6779d4e9e2ecdc2020d32e3bb3418f31153978

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-full-sync-resurrect-missing:flow:FR-03
  tests: backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-full-sync-resurrect-missing
  status: active

## FR-auto-backend-041 单测覆盖三态
变更：2026-09-25-full-sync-resurrect-missing
状态：active
摘要：（无场景名）
待复核：2026-09-26-manifest-heal-endpoint
全文：.sillyspec/changes/archive/2026-09-25-full-sync-resurrect-missing/requirements.md#FR-04
最近确认：ff6779d4e9e2ecdc2020d32e3bb3418f31153978

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-full-sync-resurrect-missing:flow:FR-04
  tests: backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-full-sync-resurrect-missing
  status: active

## FR-auto-backend-042 幽灵软删行用例
变更：2026-09-25-full-sync-resurrect-missing
状态：active
摘要：（无场景名）
待复核：2026-09-26-manifest-heal-endpoint
全文：.sillyspec/changes/archive/2026-09-25-full-sync-resurrect-missing/requirements.md#FR-05
最近确认：ff6779d4e9e2ecdc2020d32e3bb3418f31153978

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-full-sync-resurrect-missing:flow:FR-05
  tests: backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-full-sync-resurrect-missing
  status: active

## FR-auto-backend-043 磁盘缺文件（行在线）用例
变更：2026-09-25-full-sync-resurrect-missing
状态：active
摘要：（无场景名）
待复核：2026-09-26-manifest-heal-endpoint
全文：.sillyspec/changes/archive/2026-09-25-full-sync-resurrect-missing/requirements.md#FR-06
最近确认：ff6779d4e9e2ecdc2020d32e3bb3418f31153978

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-full-sync-resurrect-missing:flow:FR-06
  tests: backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-full-sync-resurrect-missing
  status: active

## FR-auto-backend-044 正常跳过态零回归用例
变更：2026-09-25-full-sync-resurrect-missing
状态：active
摘要：（无场景名）
待复核：2026-09-26-manifest-heal-endpoint
全文：.sillyspec/changes/archive/2026-09-25-full-sync-resurrect-missing/requirements.md#FR-07
最近确认：ff6779d4e9e2ecdc2020d32e3bb3418f31153978

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-full-sync-resurrect-missing:flow:FR-07
  tests: backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-full-sync-resurrect-missing
  status: active

## FR-auto-backend-045 模块零回归
变更：2026-09-25-full-sync-resurrect-missing
状态：active
摘要：（无场景名）
待复核：2026-09-26-manifest-heal-endpoint
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
待复核：2026-09-26-change-asset-transparency
场景正文：
- 场景：默认场景 — Given test-trace.json 摘录时截断 `::用例` 后缀，tests 数组只剩文件级路径，而含测试类/用例与描述的手写原文就在归档变更目录 require；When assets 聚合服务解析测试绑定（GET /changes/{cid}/assets），；Then 每条 ChangeTestRow 按锚点（FR-NN）匹配挂上新字段 `raw_binding`（绑定槽注释行之后的内容行原文，多行拼接）；requiremen
全文：.sillyspec/changes/archive/2026-09-26-assets-test-binding-raw-text/requirements.md#FR-01
最近确认：8f587cde7811c61df600f7b7d23c9c9eaedcd1b2

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-assets-test-binding-raw-text:flow:FR-01
  tests: backend/app/modules/change/tests/test_assets.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-assets-test-binding-raw-text
  status: active

## FR-auto-backend-052 类型契约同步
变更：2026-09-26-assets-test-binding-raw-text
状态：active
摘要：默认场景
待复核：2026-09-26-change-asset-transparency
场景正文：
- 场景：默认场景 — Given ChangeTestRow schema 新增字段，；When 后端 schema 变更落盘， 按 CLAUDE.md 规则 21 运行 `pnpm gen:types`，；Then `frontend/src/lib/api-types.ts` 与 `backend/openapi.json` 随提交更新，不落手写类型债。
全文：.sillyspec/changes/archive/2026-09-26-assets-test-binding-raw-text/requirements.md#FR-02
最近确认：8f587cde7811c61df600f7b7d23c9c9eaedcd1b2

## FR-auto-backend-053 前端资产卡显示原文
变更：2026-09-26-assets-test-binding-raw-text
状态：active
摘要：默认场景
待复核：2026-09-26-change-asset-transparency
场景正文：
- 场景：默认场景 — Given 测试绑定行的 raw_binding 存在且与 tests 文件路径列表不同值（即原文含用例级/描述信息），；When 资产卡渲染测试绑定组， 该行下方显示原文小字（muted 色，超长截断，悬停 title 可见全文）；raw_binding 为 None 或与 tests 等
全文：.sillyspec/changes/archive/2026-09-26-assets-test-binding-raw-text/requirements.md#FR-03
最近确认：8f587cde7811c61df600f7b7d23c9c9eaedcd1b2

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-assets-test-binding-raw-text:flow:FR-03
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-assets-test-binding-raw-text
  status: active

## FR-auto-backend-054 测试与类型门禁全绿
变更：2026-09-26-assets-test-binding-raw-text
状态：active
摘要：默认场景
待复核：2026-09-26-change-asset-transparency
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
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 本地与远程 dogfood；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-26-migration-chain-dedupe/requirements.md#FR-07
最近确认：a82bf152600857f3cc6980934b6a5a296fda5bdb

## FR-auto-backend-072 生产 DB 经 stamp+upgrade head 后 alembic 版本落新 head 且后端
变更：2026-09-26-migration-chain-dedupe
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 生产 DB 经 stamp+upgrade head 后 alembic 版本落新 head 且后端正常启动（运维步骤在交付汇报中列明）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-26-migration-chain-dedupe/requirements.md#FR-08
最近确认：a82bf152600857f3cc6980934b6a5a296fda5bdb

## FR-auto-backend-073 不改 ORM、不改任何业务代码与接口行为
变更：2026-09-26-migration-chain-dedupe
状态：active
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
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 前端 / 测试 相关模块就绪；When 前端卡片测试补三个新 kind 图标渲染；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-timeline-anchor-scope/requirements.md#FR-05
最近确认：34d39ff7c1306f64976528484698bf7330463691
