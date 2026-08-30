---
id: task-11
title: 'Frontend bell component notification-bell.tsx + top-bar.tsx mount (three themes brand-* tokens)'
title_zh: '前端铃铛组件 notification-bell.tsx + top-bar.tsx 顶栏挂载（三主题 brand-* 语义阶，对照原型）'
author: 'qinyi'
created_at: 2026-08-29 21:04:42
priority: P0
depends_on: ['task-10']
blocks: []
requirement_ids: [FR-09]
decision_ids: [D-005@v1]
allowed_paths:
  - frontend/src/components/notifications/notification-bell.tsx
  - frontend/src/components/notifications/__tests__/notification-bell.test.tsx
  - frontend/src/components/top-bar.tsx
expects_from:
  - task: task-10
    contract: notifications data layer
    needs: [useNotifications, useUnreadCount, useNotificationsStream]
goal: >
  实现通知铃铛 + antd Popover 下拉面板组件并在 top-bar.tsx 头像区挂载，
  三主题适配（brand-* 语义阶），UI 对照 prototype-notification-bell.html 原型。
implementation:
  - 新建 components/notifications/notification-bell.tsx：铃铛图标 + 未读徽标（>99 显示 99+）+ antd Popover 下拉面板
  - 面板条目 = 类型标签色块图标（待办橙/通过绿/驳回红/权限蓝/超时灰）+ 标题 + 摘要 + 相对时间
  - 条目点击 = markRead + router.push(link)；「全部已读」按钮；空态文案（无通知时与现状一致）
  - 样式用 brand-* 语义阶 + 主题 token 三主题适配，对照 FRONTEND_PAGE_STYLE.md §0.5 与原型 prototype-notification-bell.html
  - top-bar.tsx 用户头像区（~:155-159）挂载 <NotificationBell />，不动 app-shell.tsx
acceptance:
  - 三主题下铃铛/徽标/面板配色均走语义 token，无硬编码颜色
  - 点击未读条目后该条标记已读且跳转 link；「全部已读」后徽标清零
  - top-bar 挂载后 tsc 零错
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不实现数据层逻辑（hooks 归 task-10），只消费
  - 本 task 不新增测试用例（归 task-13），仅保证既有 top-bar.test.tsx 不因挂载而红（mock 补齐允许）
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
