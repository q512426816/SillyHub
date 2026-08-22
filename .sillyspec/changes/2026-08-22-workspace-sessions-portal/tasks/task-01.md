---
id: task-01
title: extract-sessions-portal-component
title_zh: 提取共享会话门户组件
author: qinyi
created_at: 2026-08-22 17:10:00
priority: P0
depends_on: [task-04, task-05]
blocks: [task-02, task-03, task-06]
requirement_ids: [FR-01, FR-05]
decision_ids: [D-001@v1, D-004@v1]
allowed_paths:
  - frontend/src/components/sessions/sessions-portal.tsx
goal: >
  自 sessions/page.tsx 整块提取共享门户组件 SessionsPortal（可选 scope 判别联合 + ?session= 深链），作为三入口唯一渲染体，为 task-02/03/06 提供契约。
expects_from:
  task-04:
    - contract: list-panel-scope
      needs: [scope-workspace-change-switch, author-self-filter]
  task-05:
    - contract: form-bind-lock
      needs: [bind-workspace-id, bind-change-id-dual]
provides:
  - contract: sessions-portal
    fields: [scope-discriminated-union, session-deeplink, page-shell-embedded]
implementation:
  - 整块提取——useDaemonMachines 机器与 listProviders 供应商 react-query、selectedSessionId 状态、左 SessionListPanel 右两态（未选 NewSessionForm / 已选 SessionPanel mode=page）、key 重挂载契约、删除后清选中并 invalidate
  - props 仅可选 scope 判别联合——workspace 携 workspaceId、change 携 workspaceId 与 changeId、缺省等于全局门户现状
  - 按 scope 派生三处——SessionListPanel scope 透传（列表数据源切换）、NewSessionForm bindWorkspaceId/bindChangeId 透传（创建绑定）、PageHeader 标题「智能体会话」+ 范围后缀（PageContainer/PageHeader 进组件）
  - 深链恢复——挂载时 useSearchParams 解析 ?session= 设初始 selectedSessionId，无参或无效 id 静默忽略（自旧 workspace-session-section 迁移的语义）
acceptance:
  - 组件文件存在并导出 SessionsPortal，缺省渲染与 /sessions 现状行为等价（由 task-02 接线后 18 用例验证，测试归 task-08）
  - scope=workspace/change 时列表数据源与创建绑定按 expects_from 契约路由，标题带范围后缀
  - pnpm exec tsc --noEmit 零 error
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不动 SessionPanel 组件本体（page 分支实现不变，仅换装配位置）
  - useSearchParams 遵循 runtimes/page.tsx 先例，不加 Suspense 包裹
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
