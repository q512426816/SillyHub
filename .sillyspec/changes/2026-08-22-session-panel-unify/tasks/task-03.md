---
id: task-03
title: antd-ize-turn-status-badge
title_zh: 消息流状态徽标 antd 化并适配断言
author: qinyi
created_at: 2026-08-22 13:50:00
priority: P0
depends_on: [task-02, task-04]
blocks: [task-07]
requirement_ids: [FR-04]
decision_ids: [D-003@v1]
expects_from:
  task-02:
    - contract: dialog-antd-chrome
      needs: [five-spots-antd]
  task-04:
    - contract: inputbar-antd
      needs: [send-primary]
provides:
  - contract: badge-antd
    fields: [status-mapping-applied, three-test-files-adapted]
allowed_paths:
  - frontend/src/components/daemon/turn-timeline.tsx
  - frontend/src/components/daemon/__tests__/turn-timeline-session-input-bar.test.tsx
  - frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx
  - frontend/src/components/sessions/__tests__/session-config-bar.test.tsx
related_tests:
  - frontend/src/components/daemon/__tests__/turn-timeline-session-input-bar.test.tsx
  - frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx
  - frontend/src/components/sessions/__tests__/session-config-bar.test.tsx
goal: >
  TurnStatusBadge（turn-timeline.tsx 约 :930-983）内部渲染从自写彩色 span 换 antd Badge status（签名与调用方零变化），3 个断言测试文件同步适配（design §4.B.2、FR-04）。
implementation:
  - TurnStatusBadge 内部渲染改 antd Badge status——running/interrupting 映射 processing、completed 映射 success、failed/killed 映射 error、pending 及其余中性态映射 default；组件对外签名（status/turn/inputTokens/outputTokens）与调用点零变化，statusLabel 文案与 token 显示（↑in ↓out）逻辑保留
  - 3 测试文件断言适配（禁删用例、语义保留）——turn-timeline-session-input-bar.test.tsx 约 :67-70、page.test.tsx 约 :752-754 与 :821、session-config-bar.test.tsx 约 :544 的徽标文本/结构断言按 antd Badge 输出适配；顺手校正测试文件头部指向旧套件名（interactive-session-panel 三套测试）的陈旧注释
acceptance:
  - turn-timeline.tsx 的 TurnStatusBadge 内无自写彩色 span 状态胶囊（tone 类映射移除，色档全走 antd Badge status）；双主题换肤无硬编码 hex 新增
  - 3 个测试文件全绿且用例数不减；tsc 零 error
verify:
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/turn-timeline-session-input-bar.test.tsx "src/app/(dashboard)/sessions/__tests__/page.test.tsx" src/components/sessions/__tests__/session-config-bar.test.tsx
constraints:
  - 仅改 TurnStatusBadge 内部渲染与测试断言；不动 TurnTimeline 布局与 MarkdownText
  - 语义色映射固定不许自创档位（D-003@v1 四档 processing/success/error/default）；测试适配禁删用例（CLAUDE.md 规则 9）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
