---
id: task-10
title: 'Frontend data layer lib/notifications.ts + query-keys + SSE subscription hook (no refetchInterval)'
title_zh: '前端数据层 lib/notifications.ts + query-keys + SSE 订阅 hook（无 refetchInterval，事件驱动 invalidate）'
author: 'qinyi'
created_at: 2026-08-29 21:04:42
priority: P0
depends_on: ['task-09']
blocks: []
requirement_ids: [FR-09]
decision_ids: [D-005@v1]
allowed_paths:
  - frontend/src/lib/notifications.ts
  - frontend/src/lib/query-keys.ts
expects_from:
  - task: task-07
    contract: NotificationRead
    needs: [id, type, title, body, link, read_at, created_at]
goal: >
  建立通知前端数据层：四个 REST fetch 函数 + useNotifications/useUnreadCount +
  useNotificationsStream SSE 订阅 hook，SSE 事件驱动 invalidate（无 refetchInterval），
  为 task-11 铃铛组件提供数据与实时刷新能力。
implementation:
  - lib/notifications.ts 新建四个 REST 函数（列表/未读数/单条已读/全部已读），类型取 lib/api-types.ts 的 NotificationRead（gen:types 产物）
  - query-keys.ts 新增 notifications key 族（列表/未读数共用前缀，便于一次 invalidate 全失效）
  - useNotifications 首载 20 条 + refetchOnWindowFocus true，明确不设 refetchInterval（D-005@v1）
  - useNotificationsStream 用 lib/fetch-sse.ts 订阅 /api/notifications/events，token 自取 useSession（先例 lib/daemon.ts ~:1906）
  - notification 事件到达即 invalidateQueries notifications 全部 key；重连成功（连接建立）后再 invalidate 一次补拉断线期间漏发，对齐 session-permission-panel.tsx:222-244 fireConnectedOnce 先例
  - 退避重连与 401/403/404 停连照 session-permission-panel.tsx:81（PERMANENT_SSE_ERROR_STATUSES）与 :246-257 内联先例实现
acceptance:
  - 全仓 grep 确认 notifications 相关 useQuery 无 refetchInterval 配置
  - SSE notification 事件触发后列表与未读数 query 失效重取；401/403/404 永久停连不再重试
  - 重连成功后发生一次额外 invalidate（断线补拉）
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 本 task 不写 UI 组件（铃铛归 task-11）、不加测试（归 task-13）
  - 不改动 session-permission-panel.tsx 等既有 SSE 代码，仅参照先例
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
