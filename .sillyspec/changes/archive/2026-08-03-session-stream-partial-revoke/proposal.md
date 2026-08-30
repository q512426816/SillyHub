---
author: WhaleFall
created_at: 2026-08-03 10:13:49
---

# 提案书（Proposal）— daemon 会话实时流式回复「半截重复」修复

> 变更 `2026-08-03-session-stream-partial-revoke` · 方案 A

## 动机

daemon 会话（`/runtimes` 会话面板）实时流式回复出现段落重复/错乱，但重新打开会话（历史回显）正常。用户体验受损：实时看 agent 回复时「半截 + 全文」叠加、段落错位，必须刷新重开才恢复。根因是 task-14（`2026-07-31-daemon-heartbeat-dedup-fix`）只做了**后端落库去重**（override 信号 DELETE 半截落库行 → 回显正常），但**漏了前端实时通道**——override 撤回信号在 SSE 转发层被截断、segment_id 字段没透传，前端收不到「该撤回半截」的信号，导致实时重复。本次补全这「前端尾巴」。

## 关键问题（现有方案为何不够）

1. **override 信号被后端截断，根本不发到浏览器**：`service.py:434/464` 的 `continue` 让 `[ASSISTANT_OVERRIDE]/[THINKING_OVERRIDE]` 信号只用于 DELETE 落库行，不 publish 到 SSE。前端永远收不到「撤回令箭」。
2. **segment_id 在 SSE 层被抹掉**：`published_logs`（:595）/`session_payload`（:164）不写 `segment_id` 字段，前端无法识别「哪条是半截」「撤回哪段」。前端 envelope（`daemon.ts:711`）也无该字段。
3. **纯前端无解**：前端拿不到任何撤回所需信号（segmentId / override），巧妇难为无米之炊——必须后端配合透传。

## 变更范围

- **后端**（`run_sync/service.py`）：SSE envelope 加 `segment_id` 字段（partial 非空、complete 空）；override 分支由 `continue` 截断改为 publish 到 SSE（不落库，保留 task-14 设计）。
- **前端**：`SessionStreamEnvelope` 加 `segment_id`/`stale`；`classifySessionLog` 识别 override 前缀；`onLog` 维护 `segmentId→起点` Map，收到 override 按 segmentId 撤回已渲染半截（reply 截断 / thinking 移除）；`logsToTurns` 历史路径兼容不改。assistant + thinking 两种 override 都修。

## 不在范围内（Non-Goals）

- 不改 daemon（partial/complete/override emit 逻辑 task-14 已修正确）。
- 不改后端落库去重机制（task-14 `_revoke_committed_partials` 跨调用 DELETE 原样保留；override 仍不落库）。
- 不改 `AgentRunLog` schema（复用 task-14 已建 `segment_id` 列），不加 `AgentRunLogEntry` DTO 的 segment_id 字段（历史 GET 不返回）。
- 不改 lease/session/agent_run 状态机、heartbeat、WS 通道。
- 不改 agent 行为/提示词；不改 `logsToTurns` 历史渲染结果。
- 不消除 complete→override 之间的毫秒级中间态（R-03，留优化）。

## 成功标准（可验证）

- 实时会话中 agent 回复不再「半截 + 全文」重复；override 到达后只剩 complete 全文（assistant + thinking 均如此）。
- 重新打开会话（历史回显）仍正常（task-14 落库去重不回归：残留 partial 行 = 0、override 不落库）。
- backend 单测：override publish 到 SSE + 不落库 + `segment_id` 透传 + task-14 的 12 用例 + 7 次 DELETE 基线不回归。
- frontend 单测：override 识别 + 半截→override→全文撤回 + 多 segment 不串扰 + 历史兼容。
- 双向兼容：未升级一端时行为不劣化（旧前端忽略新字段；新前端缺字段时空转）。
