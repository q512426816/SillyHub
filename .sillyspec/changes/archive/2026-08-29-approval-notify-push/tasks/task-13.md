---
id: task-13
title: 'Frontend tests (bell/SSE event-driven) + top-bar.test.tsx regression + tsc zero-error closeout'
title_zh: '前端测试（铃铛/SSE 事件驱动 + top-bar.test.tsx 既有用例回归）+ tsc 零错收口'
author: 'qinyi'
created_at: 2026-08-29 21:04:42
priority: P0
depends_on: ['task-10', 'task-11']
blocks: []
requirement_ids: [FR-09]
decision_ids: [D-005@v1]
allowed_paths:
  - frontend/src/components/notifications/__tests__/
  - frontend/src/components/__tests__/top-bar.test.tsx
  - frontend/src/lib/__tests__/
related_tests:
  - frontend/src/components/__tests__/top-bar.test.tsx
goal: >
  补齐前端测试：notification-bell 组件与 SSE 事件驱动数据层测试，
  修复 top-bar.test.tsx 因挂载铃铛导致的 mock 缺口，pnpm test 与 tsc 全绿收口。
implementation:
  - components/notifications/__tests__/notification-bell.test.tsx：渲染/徽标 99+/条目点击 markRead+跳转/全部已读/空态
  - SSE 事件驱动测试（放 lib/__tests__/，对齐既有 fetch-sse.test.ts 惯例）：notification 事件 → invalidate；401/403/404 停连；重连成功补拉 invalidate
  - top-bar.test.tsx 补铃铛相关 mock（数据层 hooks/SSE），既有用例断言全部保持通过
  - cd frontend && pnpm test 全绿 + pnpm exec tsc --noEmit 零错
acceptance:
  - 新增铃铛与 SSE 用例全部通过且覆盖验收点（事件 invalidate、停连、99+ 徽标、markRead 跳转）
  - top-bar.test.tsx 既有用例零失败
  - tsc --noEmit 零错
verify:
  - cd frontend && pnpm test
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不修改生产代码（铃铛/数据层归 task-10/11）；仅当测试暴露生产代码缺陷时回对应卡修
  - 不放宽既有用例断言，top-bar 既有断言只补 mock 不改语义
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
