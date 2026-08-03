---
author: WhaleFall
created_at: 2026-08-03 10:13:49
---

# 需求规格（Requirements）— daemon 会话实时流式回复「半截重复」修复

> 变更 `2026-08-03-session-stream-partial-revoke`

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户 | 在 `/runtimes` 会话面板与 agent 实时对话，期望回复不重复错乱 |
| 开发者 | 按 design 方案 A 改 backend SSE 透传 + frontend 撤回逻辑 |

## 功能需求

### FR-01: backend SSE envelope 透传 segment_id（覆盖 D-001@v1）
Given backend `run_sync/service.py` 处理一条 session 消息（partial 或 complete）
When 构造 `published_logs`（:595）与 `session_payload`（:164）
Then envelope 含 `segment_id` 字段；**partial 行 = `main:msg_xxx:N`（非空），complete/其他行 = `None`**；透传必须取 `log_entry.segment_id`（非循环顶部局部变量）。

### FR-02: backend override 信号 publish 到 SSE 且不落库（覆盖 D-001@v1）
Given backend override 分支（:413 thinking / :445 assistant）收到 `[ASSISTANT_OVERRIDE]/[THINKING_OVERRIDE] <segmentId>`
When 处理该信号
Then (1) 保留 task-14 的 `_revoke_committed_partials` DELETE + `flushed_partials.pop`（落库去重不回归）；(2) override envelope **append 到 `published_logs` 跳过 INSERT**（segment_id=被撤回 segmentId、stale=True、content 保留 `[*_OVERRIDE] <segmentId>` 文本），复用现成 publish 到 session SSE；(3) **不落库**（`agent_run_logs` 无 override 行）。

### FR-03: frontend SessionStreamEnvelope 加字段（覆盖 D-002@v1）
Given `frontend/src/lib/daemon.ts` `SessionStreamEnvelope`（:711）
When 定义类型
Then 含 `segment_id: string | null` 与 `stale: boolean`（默认 false，override 行 true）。

### FR-04: frontend classifySessionLog 识别 override（覆盖 D-002@v1）
Given `session-log-sanitize.ts` `classifySessionLog`（:60）收到 content
When content 匹配 `^\[(ASSISTANT_OVERRIDE|THINKING_OVERRIDE)\]\s+(\S+)`
Then 返回 `{kind:"override", segmentId:<捕获>, variant:"assistant"|"thinking", text:""}`；`SessionLogSegmentKind` 加 `"override"`、`SessionLogSegment` 加 `segmentId?`/`variant?`。
Given `sanitizeSessionLogContent` 收到 override 前缀文本（attach 历史防御）
When 处理
Then 返回 `""`（丢弃，不泄漏为正文）。

### FR-05: frontend onLog 按 segmentId 撤回 partial（覆盖 D-002@v1）
Given onLog 收到 `seg.kind==="reply"` 且 `env.segment_id` 非空（半截）
When 处理
Then 记录 `partialSegments[segmentId] = {outputStart: turn.output.length}`，再 concat 文本（ql-004 语义不变）。
Given onLog 收到 `seg.kind==="override"`
When 处理
Then 按 `seg.segmentId` 查 Map：reply → `turn.output = turn.output.slice(0, outputStart)`（截断撤回半截）；thinking → 从 processItems 移除该索引项；撤回后从 Map 删该 segmentId。
Given turn 边界（onTurnCompleted / clearCurrentRun）
When turn 收尾
Then 清空 `partialSegments` Map（防跨 turn 串扰）。
Given 多 segment 并发（主 agent `main:` + 子代理 `<tool_use_id>:`）
When 并发 partial + override
Then 按 segmentId 天然隔离，互不串扰。

### FR-06: frontend logsToTurns 历史兼容
Given 历史回看 `logsToTurns`
When 处理 GET `/sessions/{id}/logs` 返回的历史数据
Then 不加撤回逻辑（数据本就干净：partial 已 DELETE、override 不落库）；envelope 新字段在历史 GET 不返回（DTO 不含），`logsToTurns` 渲染不变。

### FR-07: 测试覆盖（覆盖 D-001/D-002/D-003）
Given backend + frontend 实现
When 跑测试
Then backend：override publish 到 SSE + 不落库（断言 `agent_run_logs` 无 override 行）+ segment_id 透传 + task-14 的 12 单测 + 7 次 DELETE 基线不回归；frontend：override 识别（assistant/thinking）+ 半截→override→全文撤回 + 多 segment 不串扰 + 历史兼容。

## 非功能需求

- **兼容性**：未升级前端时 backend 多发字段被忽略（运行时多字段无害）；未升级 backend 时前端字段 undefined → 撤回逻辑空转，行为同现状。
- **可回退**：override 分支改回 `continue` 即恢复 task-14 行为（实时重复回来但回显正常），前端撤回逻辑空转无副作用。
- **可测试**：segment_id 透传、override publish-only、segmentId 精确撤回均有可测断言。
- **跨平台**：纯逻辑改动，兼容 Windows/Linux/macOS。
- **性能**：override publish 复用现成 publish 路径，无额外开销；前端 Map 操作 O(1)。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-02, FR-07 | 允许动后端（纯前端不可行）→ backend 透传 segment_id + override publish |
| D-002@v1 | FR-03, FR-04, FR-05, FR-07 | 方案 A：前端按 segmentId 精确撤回（override 文本 publish，不落库） |
| D-003@v1 | FR-01, FR-02, FR-06 | Grill 澄清：override envelope append published_logs 跳 INSERT；透传用 log_entry.segment_id；DTO 不加字段 |
