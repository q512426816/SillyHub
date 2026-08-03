---
id: task-05
title: session-log-sanitize.ts classifySessionLog(:60) 加 override kind（识别 ^\[(ASSISTANT_OVERRIDE|THINKING_OVERRIDE)\]\s+(\S+) 前缀 + 解析 segmentId + variant）+ sanitizeSessionLogContent 丢弃 override 前缀；SessionLogSegmentKind/Segment 扩字段
title_zh: 日志分类识别 override 撤回令箭
author: WhaleFall
created_at: 2026-08-03 10:23:11
priority: P0
depends_on: [task-04]
blocks: [task-06, task-08]
requirement_ids: [FR-04]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/components/daemon/session-log-sanitize.ts
provides:
  - contract: classifySessionLog override kind
    shape: "{ kind: 'override', segmentId: string, variant: 'assistant'|'thinking', text: '' }"
  - contract: SessionLogSegmentKind 新增 'override'；SessionLogSegment 新增 segmentId?/variant?
expects_from:
  - contract: SessionStreamEnvelope.segment_id（task-04）
goal: >
  classifySessionLog 能把 [ASSISTANT_OVERRIDE]/[THINKING_OVERRIDE] 前缀的 override 撤回令箭识别为 kind=override 并解析出 segmentId 与 variant，供 task-06 onLog 据此精确撤回。
implementation:
  - SessionLogSegmentKind（:48-53）联合类型追加 "override"。
  - SessionLogSegment（:55-58）追加 segmentId?: string、variant?: "assistant" | "thinking"（仅 override/partial 用，其余 kind 不填）。
  - classifySessionLog（:60）在「丢弃规则」之后、[THINKING] 分支（:80）之前插入 override 分支：匹配 /^\[(ASSISTANT_OVERRIDE|THINKING_OVERRIDE)\]\s+(\S+)/ → 返回 { kind: "override", segmentId: <捕获2>, variant: 捕获1==="ASSISTANT_OVERRIDE" ? "assistant" : "thinking", text: "" }。text 留空（override 不渲染正文）。
  - sanitizeSessionLogContent（:19）同步识别 override 前缀并丢弃返回 ""（与 classifySessionLog 同源规则，R-04 双重识别：attach 历史路径万一收到 override 文本不泄漏到正文）。在现有 [SYSTEM|RESULT] 丢弃规则之后、channel=stderr 分支之前加 /^\[(ASSISTANT_OVERRIDE|THINKING_OVERRIDE)\]\s+\S+/ → return ""。
  - 正则复用同一常量（如 const OVERRIDE_RE = /^\[(ASSISTANT_OVERRIDE|THINKING_OVERRIDE)\]\s+(\S+)/）避免两处不一致；classify 用捕获组、sanitize 只判命中。
acceptance:
  - classifySessionLog("[ASSISTANT_OVERRIDE] main:msg_abc:1") 返回 { kind:"override", segmentId:"main:msg_abc:1", variant:"assistant", text:"" }。
  - classifySessionLog("[THINKING_OVERRIDE] tu_xyz:2") 返回 { kind:"override", segmentId:"tu_xyz:2", variant:"thinking", text:"" }。
  - sanitizeSessionLogContent("[ASSISTANT_OVERRIDE] main:msg_abc:1") === ""（不泄漏到正文）。
  - 现有 reply/thinking/tool_use/tool_result/stderr 分支不受影响（回归通过 task-08）。
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test src/components/daemon/__tests__/session-log-sanitize.test.ts
  - cd frontend && pnpm exec eslint src/components/daemon/session-log-sanitize.ts
constraints:
  - override 分支必须在 [THINKING] 分支之前（否则 [THINKING_OVERRIDE] 会被 [THINKING] 前缀正则误吞前缀、丢了 _OVERRIDE 语义）。
  - segmentId 取第 2 捕获组（\S+，不含空白），不包含后续可能的正文残文（override 行正文应为空，仅作防御）。
  - variant 必须区分 assistant/thinking——task-06 据此决定截断 turn.output（reply）还是移除 processItems 项（thinking）。
  - 仅实时 onLog 路径会出现 override 文本（task-02 publish-only 不落库，design §2.4）；sanitize 兜底是防御性，不期望 attach 历史真收到。
---
