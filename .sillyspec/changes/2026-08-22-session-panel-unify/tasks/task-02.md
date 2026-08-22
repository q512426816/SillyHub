---
id: task-02
title: antd-ize-dialog-chrome
title_zh: dialog 分支 5 处基元 antd 化
author: qinyi
created_at: 2026-08-22 13:50:00
priority: P0
depends_on: [task-01]
blocks: [task-03, task-07]
requirement_ids: [FR-03]
decision_ids: [D-001@v1, D-004@v1]
expects_from:
  task-01:
    - contract: adapter-deleted
      needs: [file-removed, consumers-on-sessionpanel]
provides:
  - contract: dialog-antd-chrome
    fields: [five-spots-antd, alias-imports-removed, sizes-32-24-danger]
allowed_paths:
  - frontend/src/components/daemon/session-panel.tsx
goal: >
  把 session-panel dialog 分支 chrome 的 5 处 shadcn 基元（UiButton×4 +
  UiBadge×1）换成 antd 基元并删别名 import，使两模式观感统一（design
  §4.B.1/§4.B.5、FR-03）。
implementation:
  - UiButton×4 换 antd Button——新建会话（约 :2352）与团队分析（约 :2334）默认 32px；打断（约 :2398）size small 24px（对齐 page 分支 :1208 惯例）；结束会话（约 :2409）默认 32px 且加 danger（承接 variant destructive 语义）；onClick/disabled/title 逐处保持
  - UiBadge×1（约 :2363 提供方数量徽标「N 个提供方 / 未连接」）换 antd Tag，文案与显示条件不变
  - 删 :59-60 的 Badge as UiBadge / Button as UiButton 别名 import 及 :57-58 消歧注释，antd Badge/Button 正名直用（:53 已有 import）
acceptance:
  - 本文件 grep 无 UiBadge/UiButton 残留，无 @/components/ui/button 与 @/components/ui/badge import
  - 主操作 32px、打断 small 24px、结束会话 danger（原型 §①③ 对照）；双主题下无硬编码 hex 新增
  - session-panel-dialog 相关 56 用例 + /sessions page 18 用例全绿；tsc 零 error
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/session-panel-dialog.test.tsx "src/app/(dashboard)/sessions/__tests__/page.test.tsx"
constraints:
  - 不动 page 分支 chrome（已 antd，对照基准）；不动区域布局类名与信息层级
  - 原生控件不换——引擎 native select（:2372 附近）、对话/进度 tab pill 原生 button（:2316 附近）保持（design §3）
  - antd 色走 ConfigProvider token 零手写 hex；品牌色类名用 brand-* 语义阶（D-001@v1/D-004@v1、FR-07）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
