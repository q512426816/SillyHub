---
id: task-03
title: 'wire tree list and runtime lock into floating host drawer'
title_zh: '悬浮宿主抽屉加宽换工作区树并接锁定徽标与新建钉死'
author: 'qinyi'
created_at: 2026-08-25 15:35:26
priority: P0
depends_on: ['task-01', 'task-02']
blocks: [task-06]
requirement_ids: [FR-01, FR-02, FR-03, FR-04]
decision_ids: []
allowed_paths:
  - frontend/src/components/floating/floating-session-host.tsx
  - frontend/src/components/floating/floating-session-host.test.tsx
expects_from:
  task-01:
    - contract: FloatingSessionState
      needs: [lockedRuntime, openRuntimeSession, closeRuntimeLock]
  task-02:
    - contract: SessionListScope
      needs: [RuntimeScope]
goal: >
  悬浮抽屉加宽至约 960px，左栏由最近 10 条紧凑列表换成 /sessions 同款 SessionListPanel 工作区树，
  lockedRuntime 时头部渲染锁定徽标、树按 runtime scope 过滤、新建钉死该 runtime 不弹两步浮层
  （FR-01~04）。
implementation:
  - 抽屉宽度由 max-w 620px 改为 w min 960px 92vw（grid 列固定 320px 树栏加自适应面板）
  - 左栏 CompactSessionList 替换为 SessionListPanel（lockedRuntime 时传 scope 为 runtime 变体；无锁时同换树，对齐 ql-20260823-003 三入口一致裁决）
  - 头部加锁定徽标（lockedRuntime.machineLabel 与 providerLabel）
  - 新建按钮分支：lockedRuntime 时直接 startPreSession 携带锁定 runtimeId 与 workspaceId null，不再 setPickerOpen 弹 PreSessionPicker
  - 右栏 SessionPanel 的 preContext 透传锁定 runtimeId
  - floating-session-host.test.tsx 补锁定徽标渲染、scope 传递、新建不弹浮层三处断言
acceptance:
  - lockedRuntime 非空时抽屉头部显示含机器名与智能体名的锁定徽标
  - SessionListPanel 收到 kind 为 runtime 的 scope 且 runtimeId 等于 lockedRuntime.id
  - lockedRuntime 时新建按钮调用 startPreSession 且不渲染 PreSessionPicker
  - 抽屉宽度样式含 960px 与 320px 树栏列宽
  - pnpm exec vitest run floating-session-host 全绿
verify:
  - cd frontend && pnpm exec vitest run src/components/floating/floating-session-host.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 抽屉内布局禁用 tailwind md: 视口断点前缀（知识库坑：md: 是视口断点非容器断点，侧栏内嵌会挤崩），列宽用固定 grid
  - 互斥协议不动（门户三路由仍整体不渲染）
  - 无锁时换树不改 SessionPanel 右栏三分支语义（真会话/预会话/空态）
related_tests:
  - path: frontend/src/components/floating/floating-session-host.test.tsx
    reason: 左栏由紧凑列表换树后旧断言（最近会话条目/floating-session-list 测试锚点）失效需同步更新
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
