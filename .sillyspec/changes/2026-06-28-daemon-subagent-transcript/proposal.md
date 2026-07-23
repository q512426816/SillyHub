---
author: qinyi
created_at: 2026-06-28 12:31:26
change: 2026-06-28-daemon-subagent-transcript
---

# Proposal · daemon 子代理日志可见性

## 动机

主 agent（Claude Agent SDK 0.3.181）在执行中调用 Task/Agent tool 派生子代理（subagent）时，子代理的 thinking / text / tool 调用在 daemon→backend→前端 日志链路中**完全不可见**。用户在前端 agent session 日志里只能看到主 agent 发起了一个 Task tool 调用、最后收到一个 tool_result，而子代理内部"想了什么、读了哪些文件、调了什么工具、得出了什么结论"全部黑盒。这违背了可观测性的基本诉求——日志的价值就是让执行过程透明。

根因是四层链路全缺（详见 `design.md` §1）：SDK option `forwardSubagentText` 未开（子代理 text/thinking 被丢弃）、daemon 链路零识别 `parent_tool_use_id`、backend `_extract_sdk_messages` 平铺展开不读归属、前端无层级渲染概念。

## 关键问题（现有方案为何不够）

1. **SDK 层就丢数据**：`claude-sdk-driver.ts:343` 未设 `forwardSubagentText`，SDK 默认 `false` 时子代理只有 tool_use/tool_result 心跳进主流，text/thinking 直接丢弃——daemon 根本收不到，无从展示。这是"看不到"的根因，不是显示层 bug。
2. **链路无归属标识**：即便默认放行的心跳级 tool_use/tool_result 进来了（天然带 `parent_tool_use_id`/`subagent_type`，已核实 `sdk.d.ts:2647-2666/4127-4166`），daemon / backend / 前端**零处读取**（grep 三目录零命中），全部当成主 agent 工具调用混在一起，无法区分归属。
3. **无持久化**：归属信息从未落库（`agent_run_logs` 无归属列），即使用临时方案在前端实时推断，刷新页面 / 历史回看 / 断线重连后归属全丢——日志是持久资产，必须落库。

## 变更范围

跨 sillyhub-daemon + backend + frontend 三子项目的端到端链路改造（单一变更，不拆分）：

- **daemon**：driver 开 `forwardSubagentText`；session-manager partial buffer 按 `parent_tool_use_id` 分桶隔离 + `SessionState.subagentDepth` 维护 depth + `agentSessionId` 防御守卫；转发 msg 注入 depth。
- **backend**：`agent_run_logs` migration 加 `parent_tool_use_id`/`subagent_type`/`depth` 三列 + 索引；ORM + DTO 加字段；`_extract_sdk_messages` 每条 flat record 注入归属；`submit_messages` 落库写三列。
- **前端**：`agent-log-viewer` 读列渲染 `[子代理:<type>]` 徽标 + depth 缩进 + 同 parent 视觉归组。

## 不在范围内（显式清单）

- **不做嵌套折叠 UI**（树状 transcript）——本期平铺带标签，数据预留升级（N2/D-005）
- **不做 Codex provider**——`forwardSubagentText` 是 Claude SDK 特性，Codex 机制不同（N3/D-006）
- **不做 batch 路径**（task-runner spawn + stream-json）——独立路径，零命中归属字段（N6）
- **不改计费链路**——子代理 usage 照常聚合到 `AgentRun` 总量，不按子代理拆分计费（N1/D-008）
- **不做"按子代理聚合查询"前端入口**——列式承载支持但本期无 UI 需求（N5）
- **不新增生命周期事件 / 不改 lease/session/agent_run 状态机**——仅增强 submit message 载荷（N4）

## 成功标准（可验证）

- **SC-1**（兼容）：未升级 daemon / 历史日志（归属列 NULL）渲染为主 agent，行为与现状一致。
- **SC-2**（流出）：`forwardSubagentText=true` 后，真实 Claude 调 Task tool 派生子代理时，daemon consume 收到带 `parent_tool_use_id` 的子代理 assistant message（R-06 实测）。
- **SC-3**（持久化）：子代理的 thinking/text/tool_use/tool_result 落库 `agent_run_logs` 并带 `parent_tool_use_id`/`subagent_type`/`depth`；刷新页面后归属不丢。
- **SC-4**（隔离）：主 agent 与子代理并发时，partial buffer 按 `parent_tool_use_id` 分桶，互不清空、不白屏（R-02 回归测试通过）。
- **SC-5**（层级）：多层嵌套子代理（子→孙）depth 正确（主 0 / 子 1 / 孙 2），前端按 depth 缩进 + 徽标渲染。
- **SC-6**（migration）：alembic migration up + down 可逆，`down_revision` 接真实 head，单一 head 无分叉（R-01）。
- **SC-7**（init 安全）：子代理 system/init 不覆盖主 session `agentSessionId`（resume key 不断裂）。
