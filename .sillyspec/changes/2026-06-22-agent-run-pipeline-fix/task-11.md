---
id: task-11
title: "[D1/D2][sillyhub-daemon] partial/完整 thinking 按 segmentId 去重"
priority: P1
depends_on: []
blocks: [task-12]
requirement_ids: [FR-07, FR-08]
decision_ids: [D-002@v1]
allowed_paths:
  - C:\Users\qinyi\IdeaProjects\multi-agent-platform\sillyhub-daemon\src\interactive\session-manager.ts
  - C:\Users\qinyi\IdeaProjects\multi-agent-platform\sillyhub-daemon\src\adapters\stream-json.ts
author: qinyi
created_at: 2026-06-22T21:19:09
---
# task-11: [D1/D2][sillyhub-daemon] partial/完整 thinking 按 segmentId 去重

## 修改文件
- `C:\Users\qinyi\IdeaProjects\multi-agent-platform\sillyhub-daemon\src\interactive\session-manager.ts`
  - 第 1269-1309 行：`_onMessage` —— 完整 `msgType==='assistant'` 时调 `_clearPartialBuffer(state.sessionId)`（:1302），只清 buffer 撤销不了已 flush 的 partial 行
  - 第 1323-1380 行：`_bufferPartial` —— 累积 thinking_delta 到 `buf.thinking`，启动 500ms timer
  - 第 1391-1444 行：`_flushPartial` —— 快照 `buf.thinking` 后清空，emit `[THINKING] <content>` 到 `onTurnMessage`（:1418-1425）
  - 第 1454-1465 行：`_clearPartialBuffer` —— 清 timer + 清 `buf.thinking/assistant/lastTokens/flushedTokens`（仅清未 flush 的尾部，不追溯已 flush 行）
- `C:\Users\qinyi\IdeaProjects\multi-agent-platform\sillyhub-daemon\src\adapters\stream-json.ts`
  - 第 148-149 行：`THINKING_FLUSH_CHARS = 80` / `THINKING_FLUSH_MS = 120` —— 节流阈值（保留不变）
  - 第 432-447 行：`content_block_delta` 分支 `deltaType === 'thinking_delta'` 累积到 `_thinkingBuf`，达阈值调 `_flushThinkingBuf`
  - 第 499-506 行：`_flushThinkingBuf` —— 返回 `[{type:'text', content, metadata:{thinking:true}}]`，清 buffer + 标记 `_currentTurnEmittedThinking`

## 覆盖来源 (design.md §5.3 / requirements.md FR-07 FR-08)
- design.md §5.3 根因：[THINKING] 两条独立 emit 路径。路径 A（partial 增量）：session-manager.ts:1323-1444 缓冲 + stream-json.ts:148-149 节流切片 flush。路径 B（完整累积）：完整 assistant message 到达，`_clearPartialBuffer`（:1454）只清 buffer 撤销不了已 flush 行；backend `_extract_sdk_messages` 又展开全文 [THINKING]。
- design.md §5.3 修复 1：partial/完整去重 —— 完整 assistant message 到达时，记录该 thinking segment 的 stable id；partial 行携带同 segment id。backend `submit_messages` 落库时（属 task-12），若该 segment 已有完整行，丢弃同 segment 的 partial 行；或前端 normalize 用完整行覆盖同 segment partial。
- design.md §5.3 风险：去重只在"完整 message 到达"时触发，partial 实时 flush 行为保留（折叠展示在前端，不阻塞流式）。
- design.md §13 自审存疑 1：segment id 方案需在 execute 时验证 SDK 事件是否提供稳定 thinking block id；若无，退化为前端 normalize 启发式去重（对照 `mergeAssistantPiece:208-237` 已对 assistant 做的去重）。
- requirements.md FR-07：[THINKING] 不再逐 token 碎片化（相邻合并为单条展示）。
- requirements.md FR-08：同一思考内容只出现一次（无增量段 + 完整段重复）。

## 实现要求 (编号步骤)
1. **segmentId 来源验证（execute 第一步）**：读 SDK driver 代码或抓流式事件，确认 `content_block_start` 事件的 `index` 字段（tool_use block 已知带 `id`，thinking block 需确认）是否稳定。优先方案：`segmentId = ${turnMsgId}:${contentBlockIndex}`（同一 assistant message 内 content block 数组的下标，跨 turn 用 message id 隔离）。退化方案：若 SDK 不给稳定 id，用 `segmentId = ${turnMsgId}:thinking`（假设同 message 内 thinking 连续，下标恒为首个 thinking block 的 index）。
2. **partial message 携带 segmentId**：在 `_bufferPartial`（:1323）解析 `content_block_delta` 时，从 `event` 里提取 content block 的 index（`content_block_delta` 事件通常带 `index` 字段），存入 `buf.currentSegmentId`。`_flushPartial`（:1391）emit `[THINKING]` 时，把 segmentId 注入 formatted message 的 metadata（或在 content 末尾加不可见标记，推荐 metadata）：
   ```ts
   const formatted = {
     event_type: 'text',
     content: `[THINKING] ${thinking}`,
     channel: 'stdout',
     metadata: { thinking: true, segmentId: buf.currentSegmentId, isPartial: true },
   };
   ```
3. **完整 assistant message 记录已覆盖的 segment**：在 `_onMessage`（:1301）`msgType === 'assistant'` 分支，从 message 的 content blocks 提取所有 thinking block 的 segmentId（`${msg.message.id}:${blockIndex}` 或退化方案），存入 `state.completedThinkingSegments: Set<string>`（新增字段）。然后调用扩展后的 `_clearPartialBuffer`。
4. **`_clearPartialBuffer` 扩展为标记 stale**：现有 :1454-1465 只清未 flush 的 buffer。扩展为：对同 session **已 flush 过的 partial 列表**（新增 `buf.flushedSegments: Array<{segmentId, logTimestamp}>`），emit 一条"覆盖信号"消息让 backend/前端知道"该 segmentId 的 partial 行已被完整覆盖"：
   ```ts
   // 新增：对每个已完成 segment，emit stale 标记
   for (const seg of buf.flushedSegments) {
     if (completedSegments.has(seg.segmentId)) {
       await this.deps.onTurnMessage(sessionId, runId, {
         event_type: 'text',
         content: `[THINKING_OVERRIDE] ${seg.segmentId}`,
         channel: 'stdout',
         metadata: { thinking: true, segmentId: seg.segmentId, stale: true },
       });
     }
   }
   ```
   说明：`[THINKING_OVERRIDE]` 是 daemon→backend 的新信号，task-12 backend 据此丢弃同 segmentId 的 partial 落库行；前端 normalize（本任务不涉及）也可据此覆盖。**退化方案**（若不想加新 event type）：daemon 不 emit 覆盖信号，只把 `completedThinkingSegments` 透传到完整 message 的 metadata，让 backend 自己判断（task-12 实现）。
5. **stream-json.ts 对齐**：`_flushThinkingBuf`（:499）emit 时同样注入 segmentId 到 metadata（与 session-manager 统一）。若 stream-json 与 session-manager 是互斥路径（不同 adapter），需分别改；若 stream-json 是 session-manager 的子组件，只改 session-manager 即可。execute 阶段确认两者关系（读 `stream-json.ts` 顶部注释 + task-runner 引用）。
6. **保留实时性**：`THINKING_FLUSH_CHARS=80` / `THINKING_FLUSH_MS=120`（:148-149）不变，partial 仍按 80字符/120ms flush，保证流式实时性。去重只在完整 message 到达时触发，不阻塞 flush。

## 接口定义 (函数签名/DTO)
- partial message（daemon → backend `submit_messages`）扩展 metadata：
  ```ts
  type PartialThinkingMessage = {
    event_type: 'text';
    content: string;  // [THINKING] <partial>
    channel: 'stdout';
    metadata?: {
      thinking: true;
      segmentId: string;    // 新增：${turnMsgId}:${blockIndex} 或退化 ${turnMsgId}:thinking
      isPartial: true;      // 新增：标记增量段
    };
  };
  ```
- 完整 assistant message（daemon → backend）：携带 `msg.message.content[i]` 各 block 的 index（已有，SDK 标准），backend 据此重建 segmentId。
- 覆盖信号（可选，daemon → backend，新 event）：
  ```ts
  type ThinkingOverrideSignal = {
    event_type: 'text';
    content: `[THINKING_OVERRIDE] ${segmentId}`;
    channel: 'stdout';
    metadata: { thinking: true; segmentId: string; stale: true };
  };
  ```
- SessionState 新增字段：`completedThinkingSegments: Set<string>`（默认空 Set）。
- PartialFlushBuffer 新增字段：`currentSegmentId: string | null`、`flushedSegments: Array<{segmentId: string; logTimestamp: string}>`。

## 边界处理 (≥5条)
1. **segmentId 来源稳定性**：SDK `content_block_delta` 事件的 `index` 字段（content block 数组下标）在同 message 内稳定，但跨 message 必须拼 message id（`msg.message.id` 来自 `message_start` 事件）。execute 必须抓真实事件确认 `message.id` 存在且唯一；若无，退化为 `turnIndex`（当前 turn 序号，session 内递增）。
2. **跨多个 thinking block**：同一 assistant message 可能含多个 thinking block（中间夹 tool_use）。每个 thinking block 独立 segmentId（用 blockIndex 区分），`completedThinkingSegments` 记录所有已完成 segment，partial flush 时只覆盖同 segmentId 的行。
3. **partial 已 flush 无法物理撤销**：daemon 已通过 HTTP 把 partial 行发给 backend，backend 可能已落库 + Redis publish + SSE push。daemon 不可能"召回"已发数据。**只能靠 backend 落库前去重（task-12）+ 前端 normalize 覆盖（本任务范围外，normalize.ts）**。本任务的 `[THINKING_OVERRIDE]` 信号是"通知"而非"撤销"。
4. **实时性不阻塞 flush**：80字符/120ms 阈值（:148-149）保留，partial 仍实时 flush。去重逻辑只在完整 message 到达（`_onMessage` 的 `msgType==='assistant'` 分支）触发，不影响 flush 定时器。若去重逻辑耗时（如 emit 多条 override 信号），用 `Promise.all` 并发或批量合并成一条信号。
5. **完整 message 先到、partial 后到（罕见但可能）**：网络重排可能导致 partial flush 晚于完整 message 到达。此时 `completedThinkingSegments` 已记录该 segment，late partial 到达 `_bufferPartial` 时检查：若 `buf.currentSegmentId ∈ state.completedThinkingSegments`，直接丢弃（不累积、不 flush）。
6. **退化方案兜底**：若 execute 验证 SDK 完全不给稳定 id，segmentId 退化为 `turnIndex:thinking`（同 turn 所有 thinking 共享一个 segmentId），此时同一 turn 内多个 thinking block 会被误判为同 segment —— 接受这个精度损失（实际同一 turn 连续 thinking 通常语义连续，合并展示可接受）。
7. **turn 边界重置**：每个新 turn（`onTurnStart` 或 `_onMessage` 的 `message_start`）清空 `completedThinkingSegments`（新 turn 的 segmentId 空间独立），避免跨 turn 误覆盖。

## 非目标
- 不改 `THINKING_FLUSH_CHARS` / `THINKING_FLUSH_MS`（:148-149）节流阈值（实时性优先）。
- 不改 backend `_extract_sdk_messages` 或 `submit_messages` 落库去重（属 task-12）。
- 不改前端 normalize.ts 的 thinking 合并展示（属前端 task，本任务只提供 segmentId 数据）。
- 不重写整个 partial 缓冲机制（仅扩展 metadata + 加 override 信号）。
- 不处理 assistant（非 thinking）文本的去重（design.md §5.3 聚焦 thinking；assistant 文本已有 `mergeAssistantPiece:208-237` 处理）。
- 不加 DB 字段（AgentRunLog.metadata 是 JSON 列，直接存 segmentId，无 migration）。

## TDD 步骤
1. **Red**：在 `sillyhub-daemon/src/interactive/__tests__/session-manager.partial-dedup.test.ts`（或现有测试文件）新增用例：mock SDK 流式事件序列 —— `content_block_start(thinking,index=0)` → 多个 `content_block_delta(thinking_delta,index=0)` 触发 partial flush（>80字符）→ 完整 `assistant` message（含 thinking block index=0 全文）。断言：
   - partial flush 时 emit 的 message 含 `metadata.segmentId` + `metadata.isPartial===true`
   - 完整 message 到达后 emit 了 `[THINKING_OVERRIDE] <segmentId>` 信号（或完整 message metadata 含 `completedSegments`）
   - `state.completedThinkingSegments` 包含该 segmentId
2. **Green**：按"实现要求"扩展 `_bufferPartial` / `_flushPartial` / `_clearPartialBuffer` / `_onMessage`，测试通过。
3. **Red**：补退化方案用例 —— mock SDK 不给 `message.id`，断言 segmentId 退化为 `turnIndex:thinking`，不崩。
4. **Green**：退化分支生效。
5. **Red**：补 late partial 用例 —— 完整 message 先到，partial 后到，断言 late partial 被丢弃（`buf.currentSegmentId ∈ completedThinkingSegments` 时 return early）。
6. **Green**：late partial 守卫生效。
7. **Red**：补多 thinking block 用例 —— 同一 message 含 2 个 thinking block（index 0 和 2），断言 segmentId 各自独立，override 信号分别 emit。
8. **Green**：多 block 场景通过。
9. **回归**：跑现有 session-manager 测试，确认 partial flush 实时性未退化（80字符/120ms 阈值不变）、`_clearPartialBuffer` 原有清 buffer 行为保留。
10. **手动验证**：在本机 daemon 跑一次 agent turn（用真实 Claude Code），抓 `submit_messages` 请求体，确认 partial message 含 `metadata.segmentId`、完整 message 后跟 override 信号。

## 验收标准 (表格)
| 验收点 | 期望 | 验证方式 |
|---|---|---|
| partial message 携带 segmentId | `_flushPartial` emit 的 message metadata 含 `segmentId` + `isPartial:true` | 单测断言 metadata 字段 |
| 完整 message 触发覆盖信号 | `_onMessage` 收到 assistant 后 emit `[THINKING_OVERRIDE] <segmentId>` | 单测 spy `onTurnMessage` |
| segmentId 来源稳定 | 同一 thinking block 的 partial 与完整 message 共享同一 segmentId | 单测对比 segmentId 值 |
| 多 thinking block 独立 | 同 message 多个 thinking block 的 segmentId 各不相同 | 单测 |
| late partial 被丢弃 | 完整 message 后到达的同 segment partial 不 flush | 单测（mock 乱序事件） |
| 实时性不退化 | 80字符/120ms flush 阈值不变，partial 仍实时 emit | 现有 partial flush 测试回归 |
| 退化方案兜底 | SDK 不给 stable id 时 segmentId 退化为 `turnIndex:thinking`，不崩 | 单测（mock 无 message.id） |
| turn 边界重置 | 新 turn 的 `completedThinkingSegments` 清空 | 单测跨 turn 场景 |
| 不影响 assistant 文本路径 | `[ASSISTANT]` flush 不带 segmentId（或独立逻辑） | 单测确认 assistant 不误带 thinking metadata |
