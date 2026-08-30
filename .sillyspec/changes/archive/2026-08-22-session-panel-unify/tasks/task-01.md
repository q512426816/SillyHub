---
id: task-01
title: 'delete-adapter-and-migrate-consumers'
title_zh: '删适配层并直迁 4 消费方'
author: 'qinyi'
created_at: 2026-08-22 13:50:00
priority: P0
depends_on: [task-05]
blocks: [task-02, task-04]
expects_from:
  task-05:
    - contract: tests-migrated-direct-sessionpanel
      needs: [56-cases-direct-sessionpanel, mocks-free-of-adapter]
provides:
  - contract: adapter-deleted
    fields: [file-removed, consumers-on-sessionpanel, types-from-turn-timeline]
allowed_paths:
  - frontend/src/components/daemon/interactive-session-panel.tsx
  - frontend/src/components/daemon/runtime-session-dialog.tsx
  - frontend/src/components/daemon/runtime-session-helpers.tsx
  - frontend/src/components/workspace-session-section.tsx
  - frontend/src/components/changes/change-session-section.tsx
goal: >
  删除 127 行适配层，4 个渲染消费方直连 SessionPanel mode="dialog"，
  类型 import 归位 turn-timeline（design §4.A / §6）。
implementation:
  - 4 消费方（runtime-session-dialog:338 / runtime-session-helpers:117 / workspace-session-section:253 / change-session-section:212）改 import SessionPanel 直连，5 个类型 import 归位 @/components/daemon/turn-timeline（已全导出零补）
  - 传参映射 attachSessionId ?? null 改传 sessionId、补 mode="dialog"、其余 12 props 同名直传、key 用法不动
  - git rm 删适配层文件，全仓 grep 守护无 dangling import
acceptance:
  - 适配层文件不存在且全仓 grep 无其 import（注释历史提及除外）；tsc --noEmit 零 error
  - task-05 迁移的 56 用例与消费方相关页面测试全绿
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/session-panel-dialog.test.tsx src/components/daemon/__tests__/session-panel-dialog-offline.test.tsx src/components/daemon/__tests__/session-panel-dialog-changeid.test.tsx
  - grep -rn "daemon/interactive-session-panel" frontend/src --include=*.ts* 应只剩注释
constraints:
  - 纯结构搬移零视觉变化；不改 SessionPanelProps 本体
  - 不动消费方 key 与外壳；不并行改 team-unify 文件（P1 门）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
