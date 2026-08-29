---
id: task-10
title: 'frontend-suspended-session-display-fallback'
title_zh: '前端 suspended 会话展示与未知状态兜底（四入口同改）'
author: 'qinyi'
created_at: 2026-08-29 03:07:34
priority: P1
depends_on: [task-05, task-09]
blocks: [task-11]
requirement_ids: [FR-04, FR-06]
decision_ids: [D-001@v1, D-003@v1]
allowed_paths:
  - frontend/src/components/daemon/session-panel.tsx
  - frontend/src/components/daemon/session-list-layout.tsx
  - frontend/src/components/daemon/runtime-session-helpers.tsx
  - frontend/src/components/daemon/__tests__/session-suspended-display.test.tsx
expects_from:
  task-05:
    - contract: SessionStatusSuspended
      needs: [suspended]
goal: >
  前端四处入口补齐 suspended 会话展示——状态徽标「已挂起」、详情横幅与输入禁用、恢复中横幅，status 映射 default 分支兜底「未知状态」，对照原型状态⑤⑥让挂起会话可见且不可误操作。
implementation:
  - 开始前先跑 pnpm gen:types 刷新 api-types；类型尚未含 suspended 时以本地类型断言过渡（不改 api-types.ts 与 lib/daemon.ts，三端类型收口归 task-11）
  - session-list-layout.tsx 的 SESSION_STATUS_LABELS 增加 suspended「已挂起」，statusLabel 的 default 分支兜底显示「未知状态」（现状回显原始英文值）
  - runtime-session-helpers.tsx 的 ACTIVE_SESSION_VIEW_STATUSES 词表加 suspended（挂起会话保留在活跃视图），恢复按钮对 suspended 的可用性与提示按 D-001 自动恢复口径处理（canResumeSession/resumeDisabledTitle 同步）
  - session-panel.tsx 详情页 suspended 态加 info 色横幅「守护进程不在线，重新启动后自动恢复」+ 输入框禁用，reconnecting 时显示恢复中横幅（对照原型状态⑤⑥）；浮窗入口复用 session-panel 展示逻辑自动跟随，不单独改文件
  - 新增 __tests__/session-suspended-display.test.tsx 覆盖列表徽标、详情横幅与输入禁用、未知 status 兜底不崩溃、恢复流程状态翻转
acceptance:
  - suspended 会话在列表显示「已挂起」徽标，详情页显示 info 色横幅且输入框禁用
  - 未知 status（词表外值）不崩溃，展示兜底「未知状态」
  - 恢复流程后状态翻转正确——suspended 横幅消失、reconnecting 恢复中横幅出现、active 后回到正常输入态
  - session-suspended-display.test.tsx 全绿且 tsc 无新增错误
verify:
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/session-suspended-display.test.tsx && pnpm exec tsc --noEmit
constraints:
  - 不改 lib/daemon.ts 的 AgentSessionStatus 联合与 api-types.ts（suspended 契约消费自 task-05，类型过渡用局部断言）
  - 不动连接横幅/看门狗/审批重连逻辑（task-09 范围），不重构消息组件内存态
  - UI 文案中文并兼容明暗双主题，对照原型 prototype-session-connection-states.html 状态⑤⑥
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
