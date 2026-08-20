---
id: task-13
title: 会话页 AI 细节——流式光标/typing 三点/ctx-chip（globals.css utility + turn-timeline 样式，whoLine 数据源，reduced-motion 退化；SSE 协议零改动）（覆盖：FR-05, D-004@v1）
title_zh: 会话页 AI 细节——流式光标/typing 三点/ctx-chip（globals.css utility + turn-timeline 样式，whoLine 数据源，reduced-motion 退化；SSE 协议零改动）（覆盖：FR-05, D-004@v1）
author: qinyi
created_at: 2026-08-20 02:20:18
priority: P1
depends_on: [task-02]
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-004@v1]
allowed_paths:
  - frontend/src/app/globals.css
  - frontend/src/components/daemon/turn-timeline.tsx
  - frontend/src/components/daemon/turn-status-bar.tsx
goal: >
  会话页 AI 原生观感细节落地——流式输出光标、typing 三点指示、上下文引用 chip；仅表现层（globals.css utility + turn-timeline/turn-status-bar 样式），SSE 数据流零改动。
implementation:
  - globals.css 追加会话页 utility（不动 task-02 双套变量块）——.ai-caret 流式光标（inline-block 窄条 + blink 动画，色 var(--primary)）、.typing-dots 三点脉冲、.ctx-chip 引用 chip（小圆角浅底描边，色全走主题变量）
  - 同文件追加 @media (prefers-reduced-motion:reduce) 退化块——.ai-caret 停止闪烁常显、.typing-dots 三点静止半透明
  - turn-timeline.tsx v2 路径对话视图——isLiveTurn 且存在 streaming text 段时在最新文本段尾挂 .ai-caret，轮转终态不渲染；旧路径 output 气泡运行中同样处理（双路径一致）
  - turn-timeline.tsx ThinkingPlaceholder 三点改用 .typing-dots（替换内联 animate-pulse，动画统一由 utility 承担）；whoLine 区块改 .ctx-chip chip 呈现——数据源仍为 turn 快照 whoLine 三字段，缺省不渲染语义不变
  - turn-status-bar.tsx typing 指示叠加位——currentActivity 前的 live-dot 可换 .typing-dots 微型三点（如需），deriveTurnActivity 派生逻辑与 memo 结构不动
acceptance:
  - 流式中最新文本段尾部出现闪烁光标，轮终态（completed/failed/killed）光标消失
  - prefers-reduced-motion 下光标与三点动效全部退化直接呈现
  - whoLine chip、光标、三点在两主题下配色协调（无硬编码色值，全走 var）
  - git diff 不含 lib/daemon、session-log-assembler、interactive-session-panel 等数据流文件
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec eslint src/app/globals.css src/components/daemon/turn-timeline.tsx src/components/daemon/turn-status-bar.tsx
  - cd frontend && pnpm test -- turn
constraints:
  - SSE 数据流/协议/状态机零改动——不碰 session-log-assembler、lib/daemon、interactive-session-panel 等装配与业务逻辑
  - prefers-reduced-motion 下动效全部退化直接呈现，不做强制动画
  - ctx-chip 数据源=turn 快照 whoLine 既有字段；无自然接入位则仅交付样式 utility 不强行塞
  - globals.css 归 task-02（Wave 2），本卡（Wave 3）仅追加会话页 utility，不改双套变量与既有规则
  - 不新增依赖/第三方库，动效纯 CSS 实现
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
