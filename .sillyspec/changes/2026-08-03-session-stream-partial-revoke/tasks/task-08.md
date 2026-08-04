---
id: task-08
title: frontend 测试 session-log-sanitize.test.ts + interactive-session-panel.test.tsx 加 override 识别（assistant/thinking）+ 半截→override→全文撤回 + 多 segment 不串扰 + 历史兼容
title_zh: 前端 override 识别与撤回测试
author: WhaleFall
created_at: 2026-08-03 10:23:11
priority: P0
no_deps_verify: true
depends_on: [task-05, task-06]
blocks: []
requirement_ids: [FR-04, FR-05, FR-07]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/components/daemon/__tests__/session-log-sanitize.test.ts
  - frontend/src/components/daemon/__tests__/interactive-session-panel.test.tsx
provides: []
expects_from:
  - contract: classifySessionLog override kind（task-05）
  - contract: onLog 撤回行为（task-06）
goal: >
  覆盖 override 识别（assistant+thinking 两种）、半截→override→complete 全文的撤回链路、多 segment 不串扰、历史回显兼容，锁定 task-05/06 的行为契约。
implementation:
  - session-log-sanitize.test.ts 的 classifySessionLog describe 块加用例：
    - "[ASSISTANT_OVERRIDE] main:msg_abc:1" → { kind:"override", segmentId:"main:msg_abc:1", variant:"assistant", text:"" }。
    - "[THINKING_OVERRIDE] tu_xyz:2" → { kind:"override", segmentId:"tu_xyz:2", variant:"thinking", text:"" }。
    - override 不被 [THINKING] 分支误吞（[THINKING_OVERRIDE] 不返回 kind:"thinking"）。
  - session-log-sanitize.test.ts 的 sanitizeSessionLogContent describe 块加用例：
    - "[ASSISTANT_OVERRIDE] main:m:1" → ""（R-04 不泄漏到正文）。
    - "[THINKING_OVERRIDE] tu:2" → ""。
  - interactive-session-panel.test.tsx 加用例（复用 makeEnvelope/makeStreamMock，给 envelope 带 segment_id/stale）：
    - 半截→override→全文：turn_started → log(content="[ASSISTANT] 半截", segment_id="main:m:1") → output 含「半截」 → log(event=log, content="[ASSISTANT_OVERRIDE] main:m:1", segment_id="main:m:1", stale=true) → output 被撤回（不再含「半截」）→ log(content="[ASSISTANT] 全文", segment_id=null) → output 只剩「全文」。
    - thinking 撤回：log(content="[THINKING] 半截思考", segment_id="tu:2") → log(content="[THINKING_OVERRIDE] tu:2", stale=true) → processItems 中该项移除（切「全部」视图断言不出现）。
    - 多 segment 不串扰：主 agent segment_id="main:m:1" 半截 + 子代理 segment_id="tu_xyz:9" 半截并存 → override 只撤回 main:m:1 → 子代理半截仍在。
    - 历史兼容：makeEnvelope 不带 segment_id/stale（旧 backend）时 onLog 不崩、不误撤回（env.segment_id undefined → 不记 Map → 无 override → 行为同现状，design §9）。
    - turn 边界清空：turn_completed 后再发同 segment_id 的 override → 不撤回新 turn 内容（Map 已清空）。
acceptance:
  - classifySessionLog 两个 override 用例（assistant+thinking）断言 segmentId/variant/text 全字段。
  - sanitizeSessionLogContent 两用例返回 ""。
  - 半截→override→全文用例：最终 output 只剩 complete 全文，无半截残留（AC-05 核心）。
  - 多 segment 用例：撤回 main:m:1 不影响 tu_xyz:9（AC-05 多 segment 不串扰）。
  - 历史兼容用例：缺 segment_id/stale 字段不崩、不误撤回（AC-07 双向兼容）。
  - turn 边界用例：turn_completed 后 Map 清空，迟到 override 不影响新 turn（R-02）。
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test src/components/daemon/__tests__/session-log-sanitize.test.ts
  - cd frontend && pnpm test src/components/daemon/__tests__/interactive-session-panel.test.tsx
  - cd frontend && pnpm exec eslint src/components/daemon/__tests__/
constraints:
  - 复用现有 makeEnvelope 工厂（test:128），通过 overrides 传 segment_id/stale，不新建工厂。
  - override envelope 的 log_id 用 null（与 task-02 design §7.1 对齐），event 仍为 "log"（backend override 走 default data 帧 onmessage 通道，design §7.1）。
  - 不为测撤回改 MarkdownText mock —— 现有 mock（test:22 渲染 content 纯文本）已够断言 output 文本出现/消失。
  - 测试覆盖 AC-04（override 识别）、AC-05（撤回+多 segment）、AC-07（历史兼容），与 plan.md 验收对齐。
---
