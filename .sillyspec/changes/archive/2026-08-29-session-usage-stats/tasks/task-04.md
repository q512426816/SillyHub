---
id: task-04
title: 'session-panel dual-mode wiring + refreshSignal'
title_zh: 'session-panel page/dialog 双模式渲染点接线 + 轮次终态 refreshSignal 递增'
author: 'qinyi'
created_at: 2026-08-29 21:47:06
priority: P0
depends_on: [task-03]
blocks: [task-05]
requirement_ids: [FR-02, FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/components/daemon/session-panel.tsx
  - frontend/src/components/daemon/__tests__/session-usage-panel-mount.test.tsx
expects_from: 'task-03 provides：SessionUsageBar 组件（sessionId + refreshSignal props）'
goal: >
  把会话用量条接进 session-panel 的 page（会话头部下方）与 dialog（输入框上方）两处渲染点，并在轮次终态处理点递增 refreshSignal 触发重取。
implementation:
  - page 模式：头部区下方挂 <SessionUsageBar sessionId=... refreshSignal={usageRefresh} />；onTurnCompleted 既有处理点（session-panel.tsx ~1574 一带）递增 usageRefresh state
  - dialog 模式：输入框上方同款挂载；dialog 轮次终态处理点递增同一模式的信号（dialog 分支独立 state）
  - 新测试文件 session-usage-panel-mount.test.tsx：①page 模式渲染点存在（mock getSessionUsage）；②dialog 模式渲染点存在（无 QueryClientProvider 环境）；③轮次终态事件（模拟触发 onTurnCompleted 处理路径）后 getSessionUsage 被再次调用
  - 既有 panel 测试若因新挂载组件产生 mock 缺失（getSessionUsage 未 mock 报 fetch 噪声）——在测试 setup 层面统一 mock，不在本卡改无关断言
acceptance:
  - AC-03 双模式渲染 + AC-04 面板级验证通过；既有 session-panel 测试文件零回归
verify:
  - cd frontend && pnpm vitest run src/components/daemon/__tests__/session-usage-panel-mount.test.tsx src/components/daemon/__tests__/session-suspended-display.test.tsx src/components/daemon/__tests__/session-panel-connection.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不改 session-usage-bar.tsx / lib/daemon.ts（归 task-03）；不引入 react-query
  - dialog 分支不新增 QueryClientProvider 依赖（零 react-query 铁律）
  - 挂载位置遵从原型：page=会话头部下方，dialog=输入框上方
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
