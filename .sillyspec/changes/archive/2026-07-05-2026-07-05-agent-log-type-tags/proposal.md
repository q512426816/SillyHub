---
author: qinyi
created_at: 2026-07-05 01:05:00
change: 2026-07-05-agent-log-type-tags
---

# Proposal

## 动机

Agent 执行日志查看器当前把**所有工具调用**归到一个「工具」类——agent 调用 `sillyspec` CLI、调用技能（Skill）、读文件、搜索代码、派子任务、调 MCP 工具，在日志里**长得一样**，全部标「工具」，无法区分。用户要在前端通过标签清晰看出每条工具调用具体是什么工具，并能多选筛选。

## 关键问题（现有方案为什么不够）

1. **分类列缺失**：`AgentRunLog` 表（`backend/app/modules/agent/model.py:285-358`）只有 `channel`（stdout/stderr/tool_call/user_input/pending_input）一个分类列，无 `type`/`tag`/`metadata` 结构化字段；工具种类信息只埋在 `content_redacted` 的 tool_call JSON 文本里，DB 层无法查询/聚合。
2. **采集端不打标**：daemon `task-runner.ts:1708-1798` 在 tool_use 时只发 `{tool_name, tool_input, tool_use_id}`，**没有**「这是 sillyspec / 这是技能」的标签。SillySpec CLI（在 Bash 里跑）和技能调用都被当成普通 tool_use。
3. **前端无子类型**：`classifyLog`（`frontend/src/components/agent-log/normalize.ts:334`）从 channel+文本前缀推导 10 个 `SemanticCategory`，无 sillyspec/skill 子类型；筛选 UI（`agent-log-viewer.tsx:711`）只有这 10 个按钮，工具调用这一类是「黑箱」。

## 变更范围

给 `AgentRunLog` 加结构化 `tool_kind` 列（参照 `AgentArtifact.kind` 先例），daemon + backend 双路径打标，前端在现有「日志类型」筛选下新增一层「工具类型」筛选，多选高亮，每条工具调用行渲染彩色徽标。覆盖三端：

- **backend**：model 加列 + alembic 迁移 + schema + `classify_tool_kind` 识别函数 + run_sync 落库/publish 填值 + GET `/logs` 加 `?tool_kind=` query
- **sillyhub-daemon**：`classifyToolKind` TS 函数 + task-runner tool_use 分支打标
- **frontend**：AgentRunLogEntry 加字段 + `toolKindMeta` 徽标映射 + agent-log-viewer 第二层筛选按钮 + 工具徽标渲染

## 不在范围内（显式清单）

- **不做** sillyspec 子命令细分（brainstorm/plan/execute/verify/...），所有 sillyspec 调用统一一个标签（D-001@v1）
- **不做** 技能名细分，所有技能调用统一一个标签
- **不做** 历史日志回填，旧日志 `tool_kind=NULL`，前端兼容显示通用徽标
- **不做** agent_run/session/lease 生命周期状态机改造，仅在已落库日志行加展示维度
- **不做** 现有 10 个 SemanticCategory 与第一层筛选按钮的改动
- **不做** 按标签的统计/聚合页面（仅预留 DB 列与索引支撑未来）

## 成功标准（可验证）

1. 跑一个真实 agent 任务（含 sillyspec CLI + skill + 多种工具调用），前端每条工具调用行显示专属彩色徽标（SillySpec/技能/命令行/读文件/...）。
2. 第二层「工具类型」按钮多选生效：点亮「SillySpec + 技能」，列表只显示这两类工具调用行；清除筛选恢复全部。
3. DB 中 `agent_run_logs.tool_kind` 列正确填充（tool_call 行有值，其他 channel 为 NULL）。
4. GET `/logs?tool_kind=sillyspec` 只返回 sillyspec 工具调用日志；不传参数返回全部（向后兼容）。
5. SSE 实时流的 publish payload 含 `tool_kind`（published_logs + session_payload 两处）。
6. daemon 与 backend 两份 `classify_tool_kind` 同输入同输出（共享单测用例）。
7. 旧日志（tool_kind=NULL）前端显示灰色通用「工具」徽标，第二层筛选不命中、不报错。
8. 三端测试全绿：backend pytest + daemon jest + frontend jest，零回归。
9. alembic 迁移正反可跑（upgrade 加列+索引 / downgrade 删列+索引），down_revision 接当前真实 head。
