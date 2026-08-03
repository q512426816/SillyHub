---
author: WhaleFall
created_at: 2026-08-03 10:16:53
plan_level: light
---

# 轻量计划（Light Plan）：daemon 会话实时流式回复「半截重复」修复

> 变更 `2026-08-03-session-stream-partial-revoke` · 方案 A（详见 design.md）

## 来源
brainstorm 结论（design.md / requirements.md）：修复 daemon 会话实时流式回复「半截+全文」重复（实时重复、重新打开回显正常）。补全 task-14（`2026-07-31-daemon-heartbeat-dedup-fix`）后端落库去重漏掉的前端实时通道——backend 透传 segment_id + override 改 publish 不落库，前端按 segmentId 撤回已渲染半截。

## 范围
- **backend**：`backend/app/modules/daemon/run_sync/service.py`
- **frontend**：`frontend/src/lib/daemon.ts`、`frontend/src/components/daemon/session-log-sanitize.ts`、`frontend/src/components/daemon/interactive-session-panel.tsx`、`frontend/src/components/daemon/runtime-session-helpers.tsx`
- **测试**：`backend/app/modules/daemon/tests/test_run_sync_assistant_override.py`、`frontend/src/components/daemon/__tests__/session-log-sanitize.test.ts`、`frontend/src/components/daemon/__tests__/interactive-session-panel.test.tsx`
- **不改**：schema（复用 task-14 `segment_id` 列）、daemon emit 逻辑、后端落库去重机制（`_revoke_committed_partials`）、`AgentRunLogEntry` DTO

## Tasks
- [ ] task-01: service.py `published_logs`(:595)+`session_payload`(:164) 加 `segment_id` 字段，**取 `log_entry.segment_id`**（complete 行 None；勿用循环顶部局部变量，D-003）（覆盖：FR-01, D-001, D-003）
- [ ] task-02: service.py override 分支(:413 thinking / :445 assistant) 把 `continue` 改为 override envelope **append 到 `published_logs` 跳 INSERT**（segment_id=被撤回 id、stale=True、content 保留 `[*_OVERRIDE] <segmentId>` 文本）复用现成 publish；保留 `_revoke_committed_partials` DELETE + `flushed_partials.pop`（D-003 澄清：INSERT 与 publish 已解耦）（覆盖：FR-02, D-001, D-003）
- [ ] task-03: backend 测试 `test_run_sync_assistant_override.py` 加 override publish 到 SSE + 不落库（断言 `agent_run_logs` 无 override 行）+ segment_id 透传 + task-14 原有 12 单测 + 7 次 DELETE 基线全绿（覆盖：FR-02, FR-07, R-01, R-05）
- [ ] task-04: `daemon.ts` `SessionStreamEnvelope`(:711) 加 `segment_id` + `stale` 字段（覆盖：FR-03, D-002）
- [ ] task-05: `session-log-sanitize.ts` `classifySessionLog`(:60) 加 override kind（识别 `[ASSISTANT_OVERRIDE]/[THINKING_OVERRIDE]` 前缀 + 解析 segmentId）+ `sanitizeSessionLogContent` 丢弃 override 前缀；`SessionLogSegmentKind`/`SessionLogSegment` 扩字段（覆盖：FR-04, D-002, R-04）
- [ ] task-06: `interactive-session-panel.tsx` `onLog`(:302-373) 撤回——turn 维护 `partialSegments` Map，partial 记录起点 + append，override 按 segmentId 截断 output（reply）/ 移除 processItems 项（thinking），turn 边界清空 Map，多 segment 隔离（覆盖：FR-05, D-002, R-02）
- [ ] task-07: `runtime-session-helpers.tsx` `logsToTurns` 类型对齐（envelope 新字段），渲染不变（历史数据干净不加撤回）（覆盖：FR-06, D-003）
- [ ] task-08: frontend 测试 `session-log-sanitize.test.ts` + `interactive-session-panel.test.tsx` 加 override 识别 + 半截→override→全文撤回 + 多 segment 不串扰 + 历史兼容（覆盖：FR-04, FR-05, FR-07）
- [ ] task-09: 实跑验证——真实会话复现实时重复（如 Write 被运行时策略拦截、agent 分段输出），确认修后实时只剩 complete 全文（assistant+thinking），重新打开回显仍正常（覆盖：FR-07, R-03）

**依赖**：task-02←task-01（同文件 segment_id 先透传）；task-03←task-01/02；task-05/06/07←task-04（类型先加）；task-08←task-05/06；task-09←全部。

## 验收
- AC-01: backend SSE envelope 含 segment_id（partial 非空、complete 空），透传取 `log_entry.segment_id`
- AC-02: override 信号 publish 到 session SSE（前端能收到）且**不落库**（`agent_run_logs` 无 override 行）
- AC-03: task-14 落库去重不回归（`_revoke_committed_partials` DELETE 保留，12 单测 + 7 次 DELETE 基线全绿）
- AC-04: 前端 `classifySessionLog` 识别 `[ASSISTANT_OVERRIDE]/[THINKING_OVERRIDE]`（assistant + thinking 两种）
- AC-05: `onLog` 收到 override 按 segmentId 撤回已渲染半截（reply 截断 / thinking 移除），多 segment 不串扰
- AC-06: 实跑真实会话实时回复不再「半截+全文」重复，重新打开回显仍正常
- AC-07: 双向兼容（未升级一端不劣化：旧前端忽略新字段；新前端缺字段空转）

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-02, task-03 | AC-01, AC-02, AC-03 |
| D-002@v1 | task-04, task-05, task-06, task-08 | AC-04, AC-05, AC-06 |
| D-003@v1 | task-01, task-02, task-07 | AC-01, AC-02 |
