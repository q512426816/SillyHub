---
id: task-14
title: '前端（D-004 两层）——会话列表小灯+悬浮卡/工作台总览卡片/面板徽章/idle 小红点/通知渲染 + pnpm gen:types'
title_zh: '前端（D-004 两层）——会话列表小灯+悬浮卡/工作台总览卡片/面板徽章/idle 小红点/通知渲染 + pnpm gen:types'
author: 'qinyi'
created_at: 2026-09-07 13:43:27
priority: P0
depends_on: ['task-08']
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-004@v1, D-001@v1]
expects_from:
  task-08:
    - contract: agent_log_state_fields
      needs: [state, state_derived_at, state_evidence, last_event_at]
allowed_paths:
  - frontend/src/components/agent-log/types.ts
  - frontend/src/components/agent-log/liveness-badge.tsx
  - frontend/src/components/sessions/session-list-panel.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
  - NEW:frontend/src/components/agent-log/agent-liveness-overview-card.tsx
  - frontend/src/components/daemon/agent-log-card.tsx
  - frontend/src/components/notifications/notification-bell.tsx
  - frontend/src/lib/agent-logs.ts
  - frontend/src/lib/api-types.ts
  - frontend/src/lib/agent-logs.ts
  - frontend/src/components/daemon/agent-log-card.tsx
  - frontend/src/components/daemon/__tests__/agent-log-card.test.tsx
  - frontend/src/components/notifications/notification-bell.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
  - backend/openapi.json
target_files:
  - NEW:frontend/src/components/agent-log/liveness-badge.tsx
  - NEW:frontend/src/components/agent-log/agent-liveness-overview-card.tsx
  - frontend/src/lib/api-types.ts
  - frontend/src/lib/agent-logs.ts
  - frontend/src/components/daemon/agent-log-card.tsx
  - frontend/src/components/daemon/__tests__/agent-log-card.test.tsx
  - frontend/src/components/notifications/notification-bell.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
  - backend/openapi.json
goal: >
  落地 D-004 两层状态展示：会话列表行尾 ~18px 状态小灯+悬停详情卡（不新增列不改布局）、
  工作台首页「Agent 状态总览」卡片、agent 日志面板逐行徽章+推导时间、idle 未读小红点、
  agent_blocked 通知渲染；后端 schema 已改（task-07/08），同步重生成 api-types。
implementation:
  - 先跑 pnpm gen:types（gen 前确认 node_modules 健康：pnpm exec tsc --version 能跑），api-types.ts 增 AgentLog 状态四字段，同 commit 提交 api-types.ts + backend/openapi.json（CLAUDE.md 规则 21）
  - 新建 frontend/src/components/agent-log/liveness-badge.tsx 共享组件：五态色映射+working/blocked 呼吸闪烁+徽章变体，状态可空归一 unknown，配色走 themes.ts 单一源；类型补充进 agent-log/types.ts
  - 会话列表 session-list-panel.tsx：每行行尾追加 ~18px 状态小灯（不新增列不改布局），取数经 lib/agent-logs.ts 按会话聚合最新状态；悬停弹自定义悬浮卡（非系统 title）：状态全名/静默时长=now-last_event_at/关联 change_key|quick_id/证据摘要/推导时间（对照原型 ①）
  - 工作台首页（workspaces/[id]/page.tsx）挂「Agent 状态总览」卡片 agent-liveness-overview-card.tsx（仿 changes-overview-card.tsx 模式）：按状态分组计数，"在等人"组列会话名+等待时长+跳转入口；idle 未读小红点＝working/blocked→idle 转移边+视图已读状态（对照原型 ①′）
  - 会话详情 agent 日志面板 daemon/agent-log-card.tsx：每行尾部追加状态徽章+state_derived_at 推导时间，面板骨架不变（组件级增量，对照原型 ③）
  - 通知渲染 notification-bell.tsx：TYPE_META 增 agent_blocked 条目（图标/中文文案），点击跳转对应会话处理
acceptance:
  - 会话列表零新增列、布局不变；每行行尾一枚五态小灯，悬停显示悬浮卡五项信息（状态全名/静默时长/关联 ctx/证据摘要/推导时间）
  - 工作台总览卡片分组计数正确，"在等人"组列出会话名+等待时长并可跳转；agent_blocked 通知在铃铛下拉正确渲染并可跳转
  - agent 日志面板每行有状态徽章+推导时间；旧落库行（无状态列值）显示 unknown
  - 双主题（blue/ai-native）下小灯/徽章/悬浮卡/总览卡片渲染正常（对照 prototype-agent-liveness-states.html）
  - pnpm gen:types 通过且 api-types.ts 与 backend/openapi.json 同步提交（gen:types:check exit 0）
verify:
  - cd frontend && pnpm gen:types && pnpm typecheck
  - cd frontend && pnpm test src/components/agent-log src/components/sessions src/components/notifications
constraints:
  - 双主题铁律：颜色取值单一源 frontend/src/styles/themes.ts（brand-* 语义阶随 data-theme 换肤；blue-* 仅真信息蓝；antd 组件色经 ConfigProvider token 不手写）
  - 不手写 api-types.ts（只经 pnpm gen:types 生成）；gen 暴露的无关旧测试债（mock 缺字段）按惯例顺手补齐而非改回手写
  - 会话列表不新增列不改布局、完整状态信息只出现在悬浮卡与工作台总览卡两处（D-004 约束）；悬浮卡为自定义卡片非系统 tooltip
  - 前端不自行猜测状态：后端字段可空一律归一 unknown 展示
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
