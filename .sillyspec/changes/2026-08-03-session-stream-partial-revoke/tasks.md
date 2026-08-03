---
author: WhaleFall
created_at: 2026-08-03 10:13:49
---

# 任务清单（Tasks）— daemon 会话实时流式回复「半截重复」修复

> 变更 `2026-08-03-session-stream-partial-revoke` · 按 design §5 Phase 1-3 拆分。详细 Wave 分组 + 依赖关系由 plan 阶段细化。

## Wave 1 — backend（service.py，解阻塞实时通道）

- [ ] task-01: `published_logs`（service.py:595-613）+ `session_payload`（publish_submitted_messages :164-180）加 `segment_id` 字段，取 `log_entry.segment_id`（complete 行 None，**勿用循环顶部局部变量**）。【FR-01, D-001, D-003】
- [ ] task-02: override 分支（:413-434 thinking / :445-464 assistant）把结尾 `continue` 改为：保留 `_revoke_committed_partials` DELETE + `flushed_partials.pop`（task-14 不动），override envelope **append 到 `published_logs` 跳 INSERT**（segment_id=被撤回 segmentId、stale=True、content 保留 `[*_OVERRIDE] <segmentId>`），复用现成 publish 到 session SSE。【FR-02, D-001, D-003】
- [ ] task-03: backend 测试 `test_run_sync_assistant_override.py` 加：override publish 到 SSE（session channel 收到）+ **不落库**（`agent_run_logs` 无 override 行）+ `segment_id` 透传（partial 非空/complete 空）+ task-14 原有 12 单测 + 7 次 DELETE 基线全绿（不回归）。【FR-02, FR-07, R-01, R-05】

## Wave 2 — frontend（类型 + 识别 + 撤回）

- [ ] task-04: `SessionStreamEnvelope`（lib/daemon.ts:711）加 `segment_id: string | null` + `stale: boolean`。【FR-03, D-002】
- [ ] task-05: `classifySessionLog`（session-log-sanitize.ts:60）加 override kind——匹配 `^\[(ASSISTANT_OVERRIDE|THINKING_OVERRIDE)\]\s+(\S+)` 返回 `{kind:"override", segmentId, variant, text:""}`；`SessionLogSegmentKind` 加 `"override"`、`SessionLogSegment` 加 `segmentId?`/`variant?`；`sanitizeSessionLogContent` 同步识别并丢弃 override 前缀（返回 `""`）。【FR-04, D-002, R-04】
- [ ] task-06: `onLog`（interactive-session-panel.tsx:302-373）撤回逻辑——turn 维护 `partialSegments: Map<segmentId, {outputStart}|{itemIndex}>`；partial（segment_id 非空）记录起点 + append；override 按 segmentId 截断 output（reply）/移除 processItems 项（thinking）+ 删 Map；turn 边界（onTurnCompleted/clearCurrentRun）清空 Map。多 segment 按 segmentId 隔离。【FR-05, D-002, R-02】
- [ ] task-07: `logsToTurns`（runtime-session-helpers.tsx）类型对齐（envelope 新字段），渲染逻辑不变（历史数据干净不加撤回）。【FR-06, D-003】
- [ ] task-08: frontend 测试——`session-log-sanitize.test.ts` 加 override 识别（assistant/thinking + segmentId 解析 + sanitize 丢弃）；`interactive-session-panel.test.tsx` 加 onLog 撤回（半截 append → override → 只剩 complete 全文）+ 多 segment 不串扰 + turn 边界清空 + `logsToTurns` 历史兼容。【FR-04, FR-05, FR-07】

## Wave 3 — 实跑验证

- [ ] task-09: 真实会话实跑——复现实时重复场景（如 Write 被运行时策略拦截、agent 分段输出），确认修后实时只剩 complete 全文（assistant + thinking），重新打开回显仍正常；backend 日志确认 override publish + DELETE 基线。【FR-07, R-03】
