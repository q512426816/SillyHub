---
id: task-05
title: 'migrate-isp-tests-to-session-panel-direct'
title_zh: '3 套 ISP 测试先行迁移直测 SessionPanel'
author: 'qinyi'
created_at: 2026-08-22 13:50:00
priority: P0
depends_on: []
blocks: [task-01]
allowed_paths:
  - frontend/src/components/daemon/__tests__/interactive-session-panel.test.tsx
  - frontend/src/components/daemon/__tests__/interactive-session-panel-offline.test.tsx
  - frontend/src/components/daemon/__tests__/interactive-session-panel-changeid.test.tsx
  - frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx
  - frontend/src/components/daemon/__tests__/session-panel-dialog-offline.test.tsx
  - frontend/src/components/daemon/__tests__/session-panel-dialog-changeid.test.tsx
  - frontend/src/components/__tests__/workspace-session-section.test.tsx
provides:
  - contract: tests-migrated-direct-sessionpanel
    fields: [56-cases-direct-sessionpanel, mocks-free-of-adapter]
goal: >
  适配层仍在场时把 3 套测试（56 用例 = 50+4+2）先行改为直测
  SessionPanel mode="dialog"，为删适配层扫清编译与断言障碍（design §4.C）。
implementation:
  - 主套 setupPanel 与 changeid 套 render 入口（:159/:67）统一替换为 SessionPanel mode="dialog"（attachSessionId ?? null 改传 sessionId）
  - offline 套 4 处内联 render 入口（:41/:55/:68/:79）逐处同规则替换
  - import 改指 @/components/daemon/session-panel 与 @/components/daemon/turn-timeline
  - git mv 三文件改名 session-panel-dialog*，顺手校正测试内指向旧套件名的陈旧注释
  - workspace-session-section.test.tsx:28 模块 mock 路径改指 session-panel
acceptance:
  - 56 用例全过且前后用例数对账 56=56（禁删用例）
  - 三文件新名 session-panel-dialog* 生效且旧名文件不存在
  - 本批 4 个测试文件无 interactive-session-panel import（含模块 mock）
verify:
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/session-panel-dialog.test.tsx src/components/daemon/__tests__/session-panel-dialog-offline.test.tsx src/components/daemon/__tests__/session-panel-dialog-changeid.test.tsx src/components/__tests__/workspace-session-section.test.tsx
constraints:
  - 禁删用例；断言语义保留（render 入口与 import 之外的断言不动）
  - 不改任何产品源码；本任务不删适配层（Wave 2 task-01 才删）
  - 仅改 mock 路径不动 mock 结构（模块路径 mock 与入口替换不冲突）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
