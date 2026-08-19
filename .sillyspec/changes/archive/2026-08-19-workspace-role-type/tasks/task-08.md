---
id: task-08
title: close-blast-surface-and-green-all-tests
title_zh: 破坏面收口与测试全绿——移动端、存量断言与新增测试回归
author: qinyi
created_at: 2026-08-18 23:11:29
priority: P0
depends_on: [task-01, task-02, task-03]
blocks: []
requirement_ids: [FR-08]
decision_ids: [D-006@v1]
allowed_paths:
  - frontend/src/app/m/workspaces/page.tsx
  - frontend/src/lib/workspace-types.ts
  - frontend/src/app/m/workspaces/__tests__/page.m-workspaces.test.tsx
  - frontend/src/components/workspace/__tests__/workspace-types.test.ts
  - backend/app/modules/workspace/tests/test_workspace_admin_management.py
  - backend/app/modules/workspace/tests/test_workspace_role_type.py
  - backend/app/modules/workspace/tests/test_router.py
  - backend/tests/modules/test_permission_cache.py
provides: []
expects_from:
  task-01:
    - contract: WORKSPACE_TYPE 词表常量
      needs: [WORKSPACE_TYPE_VALUES, WorkspaceTypeLiteral, YAML_TYPE_NORMALIZE_MAP]
goal: >
  按 design §5.6 破坏面清单收口移动端既有调用点与后端存量旧值断言，新增后端语义测试与前端 vitest，四套回归（pytest 加 vitest 加 tsc 加 mypy）全绿收尾（FR-08/D-006@v1）。
implementation:
  - 移动端 m/workspaces/page.tsx 筛选收口——TYPE_OPTIONS（66 行 daemon-client 旧值项）与 TYPE_LABELS（69 行）换成 frontend/src/lib/workspace-types.ts 的新词表导入（该 lib 由前端 batch 建，若执行时序在此前则本卡 import 即为首次消费），或按 design §5.6 最小改删类型筛选项；typeFilter（130 行 listWorkspaces 入参）改传新值并支持 unclassified 布尔入参（lib/workspaces.ts 的 list 参数类型由前端 batch 补齐，本卡只保证调用点不再传旧值）
  - 移动端创建收口——createWorkspace 调用（548-553 行）提交体补 type（最小实现默认 other，不加移动端新 UI，D-006@v1）；其余移动端逻辑零改动
  - test_workspace_admin_management.py 旧值断言改写——261-265 行 type=daemon-client 断言改为非法值 422 断言（新词表下旧值直接 Query 校验拒绝）；246-247 行 ws_type web 与 267-271 行 type=web 改为 frontend-code（web 经收编映射到 frontend-code，语义等价迁移）；非为通过而改测试——是 422 化的破坏面如实登记
  - task-01 审查发现的破坏面补收口——backend/app/modules/workspace/tests/test_router.py 11 处 POST json 体缺 type 与 1 处 PATCH 非法 type，补合法 type 入参（不改断言语义）；backend/tests/modules/test_permission_cache.py:499 WorkspaceCreate 构造缺 type，同法补齐（均为 Create.type 必填的设计内破坏面，plan 阶段盘点遗漏由 task-01 review 记录在案）
  - 新建 backend/app/modules/workspace/tests/test_workspace_role_type.py——覆盖 Create 必填与非法 422、合法八值全过、Update omit 不改 null 清空三字段一致、unclassified 只出空 type 行且与 type 同传 422、Brief 含 role 与 description（含 null 兜底）、parser 归一冒烟（frontend 到 frontend-code、未知原值）
  - 新建 frontend vitest——workspace-types helper 测试（徽标映射、NULL 未分类灰、未知原值灰）放 frontend/src/components/workspace/__tests__/workspace-types.test.ts；移动端 page 测试（mock lib/api 后渲染断言筛选不出现 daemon-client、创建提交体含 type）放 frontend/src/app/m/workspaces/__tests__/page.m-workspaces.test.tsx（目录与文件均新建）；移动端组件无既有测试则以后端契约测试兜底（design R-07）
  - 回归收尾——cd backend 加 uv run pytest app/modules/workspace/tests tests/modules/workspace -q 全绿；cd backend 加 uv run ruff format；cd backend 加 uv run mypy app；cd frontend 加 pnpm vitest run 加 pnpm exec tsc --noEmit 全绿；PG 上 alembic upgrade head 抽验（AC-06/AC-07）
acceptance:
  - 移动端列表不再出现 daemon-client 旧值选项且筛选请求不传旧值；创建请求体必含合法 type（AC-07 前端面）
  - admin_management 改写后测试绿——旧值 422、frontend-code 精确命中（AC-03 回归）
  - 新增后端与前端测试全绿；四套回归命令零红零 error（AC-07）
verify:
  - cd backend && uv run pytest app/modules/workspace/tests tests/modules/workspace -q
  - cd backend && uv run mypy app
  - cd frontend && pnpm vitest run && pnpm exec tsc --noEmit
constraints:
  - 移动端只做筛选旧值与创建补 type 两处最小改，禁加移动端新功能或动布局（D-006@v1/R-07）
  - api-types.ts 与 openapi.json 再生成归 gen:types 任务，本卡不手改生成物
  - 桌面端五个界面点归前端 batch，本卡不越界；发现桌面遗漏只登记不代改
related_tests:
  - path: backend/app/modules/workspace/tests/test_workspace_admin_management.py
    reason: 262 与 268 行用 daemon-client 与 web 旧值断言，type 参数枚举化后前者 422、后者需换 frontend-code，属破坏面如实改写
---
