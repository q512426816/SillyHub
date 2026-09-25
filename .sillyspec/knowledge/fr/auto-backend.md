---
author: sillyspec-fr-index
created_at: 2026-09-22T17:00:51.578Z
---

# FR 索引 — auto-backend

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 伪域（auto- 前缀）：由文件路径段投票派生，无模块卡——为该域补模块卡后，新变更将自动落回真域

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
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — Given 前端七处硬编码触点（徽章映射/STATUS_BADGE/STAGE_OPTIONS 双副本/说明卡/概览卡两处旁路判断/移动端审批卡/时间线组标签）；When thin 变更出现在列表/详情/概览/移动端；Then 徽章「◈ 轻量变更」品牌紫阶（quick 改「快速任务（存量）」琥珀）；筛选下拉含「轻量变更」（桌面+移动两份副本）；详情页 thin 两段式说明卡（桌面+移动
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
## FR-auto-backend-026 命中锚点归一回退匹配
变更：2026-09-25-knowledge-anchor-match-tolerance
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-knowledge-anchor-match-tolerance/requirements.md#FR-01
最近确认：bf47e2a9402502c5aeaee1a70e923b5ff438ee50

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-knowledge-anchor-match-tolerance:flow:FR-01
  tests: backend/app/modules/knowledge/tests/test_parser.py | tests/test_hits.py
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
  tests: tests/test_hits.py
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
  tests: tests/test_hits.py
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
  tests: tests/test_hits.py | tests/test_parser.py
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
  tests: tests/test_stats.py
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
  tests: tests/test_stats.py
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
  tests: tests/test_stats.py
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
  tests: tests/test_stats.py
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
  tests: tests/test_full_sync_convergence.py
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
全文：.sillyspec/changes/archive/2026-09-25-full-sync-resurrect-missing/requirements.md#FR-02
最近确认：ff6779d4e9e2ecdc2020d32e3bb3418f31153978

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-full-sync-resurrect-missing:flow:FR-02
  tests: tests/test_full_sync_convergence.py
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
全文：.sillyspec/changes/archive/2026-09-25-full-sync-resurrect-missing/requirements.md#FR-03
最近确认：ff6779d4e9e2ecdc2020d32e3bb3418f31153978

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-full-sync-resurrect-missing:flow:FR-03
  tests: tests/test_full_sync_convergence.py
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
全文：.sillyspec/changes/archive/2026-09-25-full-sync-resurrect-missing/requirements.md#FR-04
最近确认：ff6779d4e9e2ecdc2020d32e3bb3418f31153978

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-full-sync-resurrect-missing:flow:FR-04
  tests: tests/test_full_sync_convergence.py
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
全文：.sillyspec/changes/archive/2026-09-25-full-sync-resurrect-missing/requirements.md#FR-05
最近确认：ff6779d4e9e2ecdc2020d32e3bb3418f31153978

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-full-sync-resurrect-missing:flow:FR-05
  tests: tests/test_full_sync_convergence.py
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
全文：.sillyspec/changes/archive/2026-09-25-full-sync-resurrect-missing/requirements.md#FR-06
最近确认：ff6779d4e9e2ecdc2020d32e3bb3418f31153978

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-full-sync-resurrect-missing:flow:FR-06
  tests: tests/test_full_sync_convergence.py
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
全文：.sillyspec/changes/archive/2026-09-25-full-sync-resurrect-missing/requirements.md#FR-07
最近确认：ff6779d4e9e2ecdc2020d32e3bb3418f31153978

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-full-sync-resurrect-missing:flow:FR-07
  tests: tests/test_full_sync_convergence.py
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
全文：.sillyspec/changes/archive/2026-09-25-full-sync-resurrect-missing/requirements.md#FR-08
最近确认：ff6779d4e9e2ecdc2020d32e3bb3418f31153978
