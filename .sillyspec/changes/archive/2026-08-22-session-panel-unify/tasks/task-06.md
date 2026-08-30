---
id: task-06
title: fix-stale-comment-anchors
title_zh: 校正指向已删适配层的注释锚点
author: qinyi
created_at: 2026-08-22 13:50:00
priority: P2
depends_on: [task-01]
blocks: [task-07]
requirement_ids: [FR-09]
decision_ids: []
expects_from:
  task-01:
    - contract: adapter-deleted
      needs: [file-removed]
allowed_paths:
  - frontend/src/components/ask-user-dialog-card.tsx
  - frontend/src/lib/daemon.ts
  - frontend/src/components/daemon/session-log-sanitize.ts
goal: >
  适配层删除后，把 3 个文件注释里指向 interactive-session-panel 的行号锚点
  按 CLAUDE.md 规则 18 校正为准确的历史或现状表述，消除注释与实现不一致。
implementation:
  - ask-user-dialog-card.tsx 第 15 行——父组件注释由指向适配层改为指向 session-panel 中按 dialog_kind 分流的现状表述
  - lib/daemon.ts 第 586 行——interactive-session-panel 第 1092 行号引用改为不指向已删文件的历史表述，对应逻辑现于 session-panel
  - session-log-sanitize.ts 第 4 行与第 12 行与第 22 行三处——演进史叙述保留，行号锚点改为文字描述或指向 session-panel 对应逻辑
acceptance:
  - 三文件 grep interactive-session-panel 仅存在于明确的历史演进叙述，无行号锚点指向已删文件
  - cd frontend && pnpm exec tsc --noEmit 零 error
  - 行为零变化——纯注释改动，git diff 仅注释行
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - grep -rn interactive-session-panel frontend/src 并逐处核对三文件残留仅为历史叙述
constraints:
  - 仅注释零逻辑改动——不改任何导入与类型与代码行
  - 范围限定 design §5 清单三文件，不顺手扩展其它文件的历史注释
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
