---
author: qinyi
created_at: 2026-07-09 06:05:33
change: 2026-07-09-agent-log-display-fix
related: design.md, decisions.md, requirements.md, tasks.md
---

# Proposal · 智能体执行日志回显修复

## 动机

用户反馈智能体执行日志页面存在三类影响可用性的问题：工具标签对应不上、部分 token 数值显示空白、日志信息缺失。基于真实 run `8fab8465`（completed、75 轮、6.77 美元、1565 条日志）的根因调研，确认根因分布在 daemon 生成层、前端归一化层、token 采集/显示层三处，需系统性修复以让日志面板"看得清、对得上、不丢信息"。

## 关键问题（现有方案为何不够）

1. **一个工具调用被系统记三遍，且三份表示标签不一致**。daemon batch 路径（`task-runner.ts:1843-1880`，C-02 设计）对每次工具调用产生 3 条日志：可读 stdout `[TOOL_USE]`（无 tool_kind，灰「日志」徽标）、结构化 tool_call JSON（有 tool_kind，蓝「工具」徽标）、stdout `[TOOL_RESULT]`（无 tool_kind，绿「返回」徽标）。74 次调用 1:1:1 三写。前端现有去重只覆盖第一种合并进第二种，结果行（第三种）脱离工具卡片单独显示且丢失工具标签——用户看到同一工具的命令/卡片/结果散在三行、有的有标签有的没有，"对不上"。

2. **token 四维显示残缺**。DB 里 input/output/cache_read 有真实大值（714555/42962/4223680），但：(a) cache_creation_tokens 全表 594 条 run 恒 0（采集层疑漏或 Claude 不返回，待实证）；(b) killed/failed 任务的费用/轮数/时长全 NULL，前端空白无说明；(c) 交互式会话面板回调丢弃了缓存读/写两维（数据源有、代码没读）。

3. **系统/思考类日志被前端删除或吞掉**。`[SYSTEM:thinking_tokens]` 被 NOISE_PREFIXES 整条 filter 删；其余 `[SYSTEM:*]` 经 isThinkingContent 归入 thinking 合并块被"吞掉"（535 条 [SYSTEM] 多数不可见）。用户切到对话视图更觉得"日志丢了一大半"。

## 变更范围

采用**方案 B（daemon 源头治理 + 前端合并）**，分三个 Phase：

- **Phase 1（daemon）**：`_eventToMessages` tool_use 删 stdout `[TOOL_USE]` 文本行只留结构化 JSON；tool_result 补 `tool_use_id`。terminal 回显（renderAgentEvent）不动。
- **Phase 2（frontend）**：normalize 新增 tool_result 按 `parent_tool_use_id` 精确配对进 tool_call 卡片（全新逻辑，非扩展）；SYSTEM/thinking 改折叠（同时改 NOISE_PREFIXES filter + isThinkingContent 分类两处）；classifyLog 补 [TOOL_USE] 历史降级分支。
- **Phase 3（token）**：交互面板补 cache 两维；cache_creation 恒 0 实证后按三分支修（A1 修映射 / A2 修采集 / B 前端占位）；killed/failed 显示"已中断·未汇总"占位；历史回看补 token 四维。

## 不在范围内（显式清单）

- **N1**：不改 daemon terminal 回显路径（renderAgentEvent，独立于 backend 日志链路）。
- **N2**：不重写 normalize.ts 整体归一化架构（扩展 + 新增分支，非重写）。
- **N3**：不处理 codex/OpenAI 系的 cache 字段（其本就无 cache，尽力而为）。
- **N4**：不改 backend AgentRunLog 表结构（tool_kind/parent_tool_use_id 等列已存在，无需 migration）。
- **N5**：不做日志全文搜索 / 高级筛选增强。
- **N6**：不做 daemon self-update / 部署链路改动（代码改完按既有流程 cp bundle + rebuild）。

## 成功标准（可验证）

- **S1**：daemon 单测断言 `_eventToMessages(tool_use event)` 只产生 1 条 message（tool_call JSON），不再有 stdout `[TOOL_USE]`。
- **S2**：daemon 单测断言 `_eventToMessages(tool_result event)` 的 message 带 `tool_use_id`（当 metadata 有 id 时）。
- **S3**：前端单测——带 `parent_tool_use_id` 的 stdout `[TOOL_RESULT]` 行被合并进对应 tool_call 卡片并 hidden，不再独立成行。
- **S4**：前端组件测试——tool_call 卡片渲染工具徽标 + tool_kind 标签 + 参数 + 折叠结果区，点击可展开。
- **S5**：前端组件测试——`[SYSTEM:*]`/`[THINKING]` 行渲染为折叠摘要，点击展开原始内容（不再 filter 删除或 thinking 合并吞掉）。
- **S6**：前端组件测试——交互面板 token 显示四维（输入/输出/缓存读/缓存写）。
- **S7**：cache_creation 实证 task 产出三处 dump 值（result.usage / accumulated / assistant message.usage），并按分支落地修复或前端占位。
- **S8**：前端组件测试——run.status=killed/failed 且字段 NULL 时显示"已中断·未汇总"占位。
- **S9**：前端组件测试——历史回看（runtime-session-dialog）显示 token 四维。
- **S10**：端到端——真实 run 日志面板无三行分裂、工具标签一致、SYSTEM 可展开、token 四维非空白。
- **S11**：全量回归——backend pytest（cov≥60%）+ frontend vitest + daemon vitest 全绿，无既有测试回归。
