---
author: qinyi
created_at: 2026-06-14T17:52:18
change: 2026-06-14-unified-agent-execution
stage: plan
id: task-08
title: A1 实时流等价验证 + A3 降级决策记录
priority: P1
depends_on: [task-05]
blocks: []
allowed_paths:
  - sillyhub-daemon/src/__tests__/daemon-parity.test.ts
---

# task-08: A1 实时流等价验证 + A3 降级决策记录

## 修改文件

- `sillyhub-daemon/src/__tests__/daemon-parity.test.ts`（新建）—— 包含 A1 channel 一致性测试 + A3 降级决策记录（决策段落直接以注释/文档块形式写在本测试文件头部 JSDoc，作为变更档案）。

> 注：A3 不做汇总文本生成实现。决策记录写在本文件顶部 JSDoc + 一个 `describe("A3 decision record")` 内的只读断言（仅 `expect(...)` 校验关键事实，无生产代码改动），保留为代码档案。

## 实现要求

1. **A1 测试目标**：验证 daemon 经 `submit_messages` → 后端 publish 到 Redis channel `agent_run:{agent_run_id}` 的 payload 与原 SERVER 路径 `_exec_stream` 直发语义等价。后端 `daemon/service.py:550-630` 的 `submit_messages`（核实点：`daemon/service.py:602-615` publish 调用）是唯一真相源；本测试覆盖其 payload 形态。

2. **A1 测试结构（vitest）**：
   - 用 fake/mock 的 `RedisClient`（vi.fn 抓 `publish`）+ 真实 `DaemonLeaseService.submit_messages`（或抽其 publish 段为可单测的纯函数；若直接 import 后端 Python 不可行，则**改测 daemon 侧 `_handleLine` → `client.submitMessages`** 调用契约，断言传给 server 的 `messages` 形态对齐 SERVER `_exec_stream` 的 publish 字段）。
   - **首选路径**：daemon 侧测试（TS）。构造一组 claude stream-json stdout 行（fixture，复用 `adapters/__tests__` 既有 stream-json fixtures），喂给 `TaskRunner._handleLine`，断言 `client.submitMessages(leaseId, claimToken, agentRunId, messages)` 被调用的 `messages` 数组每条含 `event_type/content/...` 字段，且与 SERVER `_event_to_message`（已删，对照 design §A1）语义一致。

3. **A1 关键断言（至少 5 条）**：
   - assistant text 行 → `messages[0].event_type === 'text' && messages[0].content === <期望文本>`。
   - tool_use 行 → `messages[i].event_type === 'tool_use' && messages[i].tool_name === <期望> && messages[i].call_id === <期望>`。
   - tool_result 行 → `messages[j].event_type === 'tool_result' && messages[j].call_id === <期望>`。
   - result 行 → 不产 submitMessages（终态）+ sessionId 提取正确。
   - 多事件单行（assistant 多 content block）→ 一次 submitMessages 提交多条 messages（batch 语义，对齐 SERVER 逐 event publish 的最终消费等价性）。

4. **A1 channel 等价性断言（可选断言，文档化为主）**：测试头部 JSDoc 或 `it("documents channel parity")` 显式记录：daemon `submit_messages` 调用 server，server 端 publish 到 `f"agent_run:{agent_run_id}"`（`daemon/service.py:612-615` 核实），payload 含 `event=messages|count|messages[]|agent_run_status`；前端 `streamAgentRunLogs`（`frontend/src/lib/agent.ts:99-140`）经 SSE `/api/workspaces/{ws}/agent/runs/{run}/stream` 订阅同 channel（后端 `agent/service.py:645`），消息可达性等价。本条不写跨进程集成测试（需起 Redis + 后端 + daemon，超出单测范围），仅以文档断言固化决策依据。

5. **A3 降级决策记录**（本任务核心产出之一）：在测试文件顶部 JSDoc 写一段「A3 Conversation Log 形态决策」，内容要点：
   - **决策**：保持 daemon 当前形态（`AgentRunLog` 逐行 + `output_redacted` 由 task-runner.ts:355 `outputParts` 累积），**不实现 SERVER 式的「按 turn 分段 + cost_info」汇总文本**。
   - **依据（前端消费路径核实）**：
     - 普通 agent run 前端经 `streamAgentRunLogs`（`frontend/src/lib/agent.ts:99`）订阅 SSE → 后端 `agent_run:{id}` channel（`agent/service.py:645`），**展示基于 `AgentRunLog` 结构化行**（`AgentRunLogEntry`，`frontend/src/lib/agent.ts:47`）+ `extractRunSummary`（`frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx:92-110`）由日志行重建摘要，**不依赖 `output_redacted` 汇总文本**。
     - Quick Chat（`frontend/src/app/(dashboard)/runtimes/page.tsx:350,373`）消费 `output_redacted`，已由 task-runner.ts:355 `outputParts` 累积覆盖（拼接文本，非 SERVER 的 cost_info 汇总格式）。
     - 结论：R-08 缺口**不成立**，无需补汇总文本生成。
   - **何时反悔**：若后续前端引入「按 turn 分段展示 + cost_info 汇总」的 UI 需求，再起独立 change 处理；本变更不埋点。
   - 在 `describe("A3 decision record")` 内放 1-2 条 `it("documents ...")`，断言关键事实（如 `outputParts.join('')` 在 task-runner.ts:355 存在；`extractRunSummary` 接收 `AgentRunLogEntry[]`），作为代码档案防止未来误删。

## 接口定义

```typescript
// sillyhub-daemon/src/__tests__/daemon-parity.test.ts
import { describe, it, expect, vi } from 'vitest';
import type { AgentEvent } from '../types.js';

// A1 测试用 fixture（stream-json stdout 行，可从 adapters/__tests__ fixtures 复用）
const FIXTURE_ASSISTANT_TEXT = '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hello"}]}}';
const FIXTURE_TOOL_USE = '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"tu_1","name":"Bash","input":{"cmd":"ls"}}]}}';
const FIXTURE_TOOL_RESULT = '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu_1","content":"file.txt"}]}}';
const FIXTURE_RESULT = '{"type":"result","result":"done","session_id":"s_1","is_error":false}';

describe('A1 daemon-parity: submit_messages payload 与 SERVER 等价', () => {
  // 构造 mock RunnerHubClient + 跑 TaskRunner._handleLine，断言 submitMessages 入参形态
  it('assistant text 行 → event_type=text + content', async () => { /* ... */ });
  it('tool_use 行 → event_type=tool_use + tool_name + call_id', async () => { /* ... */ });
  it('tool_result 行 → event_type=tool_result + call_id', async () => { /* ... */ });
  it('result 行 → 不产 submitMessages（终态）+ sessionId 提取', async () => { /* ... */ });
  it('assistant 多 content block → 单次 submitMessages 提交多条 messages', async () => { /* ... */ });
  it('documents channel parity: agent_run:{id} publish 链路（JSDoc 化断言）', () => {
    // 仅断言关键事实：submitMessages 签名含 agentRunId 参数（路由到 agent_run:{id} channel 的契约）
  });
});

describe('A3 decision record', () => {
  it('documents: 前端基于 AgentRunLog 重建，不依赖 output_redacted 汇总', () => {
    // 断言 task-runner.ts:355 outputParts.join('') 存在（grep 字符串校验）+
    // extractRunSummary 入参类型为 AgentRunLogEntry[]（类型断言）
  });
});
```

## 边界处理

1. **null/空值**：fixture 行含空 content（如 `{"type":"assistant","message":{"content":[{"type":"text","text":""}]}}`）→ `_eventToMessage` 返回 null → 不进 messages 数组（task-runner.ts:738 丢弃），测试覆盖此分支。

2. **兼容性 brownfield**：本任务不改任何生产代码（仅新增测试文件），无兼容性风险；A3 决策保持现状，存量 `AgentRun.output_redacted` 文本（task-runner.ts:355 累积）不变。

3. **异常不静默吞**：测试内 `submitMessages` mock throw → TaskRunner 仅 warn 不中断（task-runner.ts:686-689），测试覆盖「单行 submitMessages 失败不影响后续行」语义（A1 等价性的一部分：SERVER `_exec_stream` publish 失败也仅 log）。

4. **参数不可变**：测试 fixture 行字符串不可变；`_handleLine` 内部不应修改入参 line。若实现误改，断言 line 原文不变。

5. **歧义/冲突**：`_looksLikeResult` 粗判（task-runner.ts:848-854 含 `"result"` 子串）会误命中含 "result" 字样的 assistant 文本——这是已知 design 选择（保守优先关 stdin），A1 测试不修正此行为，仅记录在 `it("documents: _looksLikeResult 保守粗判")` 内（防止未来误以为 bug）。

6. **fixture 真实性**：fixture 行必须来自真实 claude stream-json 输出形态（与 `adapters/__tests__` 既有 fixtures 同源），不可手写简化版导致字段顺序/转义偏差；优先复用 `import` 既有 fixture 文件。

## 非目标

- 不做跨进程集成测试（起 Redis + 后端 + daemon 的 e2e）—— 单测范围足够验证契约等价。
- 不实现 SERVER 式汇总文本生成（A3 决策降级）。
- 不改 `submit_messages` 后端代码（后端 publish 链路已存在且正确，`daemon/service.py:612-615`）。
- 不改前端 `streamAgentRunLogs` / `extractRunSummary`（前端消费路径核实结论为等价，无需改）。
- 不优化高频输出时的 HTTP 往返开销（design B8，P2，本变更不做）。

## TDD 步骤

1. 写测试 → 在 `daemon-parity.test.ts` 写 5+ 条 A1 断言 + 2 条 A3 决策记录断言。
2. 确认失败 → 跑 `pnpm vitest run src/__tests__/daemon-parity.test.ts`，全部红（文件新建无实现）。
3. 写实现 → 本任务**无生产代码实现**（A1 是验证既有链路，A3 是决策记录）；若 A1 测试因 task-runner.ts 当前实现已有正确行为而直接通过，则 TDD 第 2 步改为「确认通过 + 文档化」——这本身是「等价性已验证」的证据。
4. 确认通过 → 全绿。
5. 回归 → `cd sillyhub-daemon && pnpm test` 全量回归。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `cd sillyhub-daemon && pnpm vitest run src/__tests__/daemon-parity.test.ts` | 全部用例通过（5+ A1 断言 + 2 A3 决策记录断言） |
| AC-02 | `grep -n "agent_run:" sillyhub-daemon/src/__tests__/daemon-parity.test.ts` | 命中（A1 channel parity 文档化断言存在） |
| AC-03 | `grep -n "extractRunSummary\|AgentRunLogEntry" sillyhub-daemon/src/__tests__/daemon-parity.test.ts` | 命中（A3 决策依据前端消费路径已记录） |
| AC-04 | `grep -n "A3 decision\|降级决策\|不实现汇总" sillyhub-daemon/src/__tests__/daemon-parity.test.ts` | 命中（A3 决策段落在文件顶部 JSDoc 或 describe 内显式记录） |
| AC-05 | 文件顶部 JSDoc 含「保持 AgentRunLog 逐行形态 + 不做 SERVER 式汇总」决策段落 | grep 命中关键字 + 内容可读 |
| AC-06 | 测试中 submitMessages mock 抓到的 messages 每条含 `event_type` 字段 | 断言通过，证明 payload 与 SERVER `_event_to_message` 语义对齐 |
